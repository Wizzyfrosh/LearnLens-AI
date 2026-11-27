import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { initializeApp, type App } from "firebase-admin/app";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import { applySyncMutation } from "./sync-mutation";
import { saveSyncSettingsForAccount } from "./sync-settings";
import { SyncBackendError } from "./errors";

let app: App;
let database: Firestore;

before(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Sync backend integration tests require FIRESTORE_EMULATOR_HOST; refusing to contact a live project.");
  }
  app = initializeApp({ projectId: "demo-learnlens-functions" }, "learnlens-sync-tests");
  database = getFirestore(app);
});

after(async () => {
  if (app) await app.delete();
});

function newUid(): string {
  return "test-user-" + randomUUID();
}

function newRequestId(): string {
  return randomUUID();
}

const deviceId = "22222222-2222-4222-8222-222222222222";

function defaultCategories() {
  return { lessonMetadata: true, notes: true, quizzes: true, attempts: true };
}

async function enableSync(uid: string, categories = defaultCategories()): Promise<void> {
  await database.doc("users/" + uid + "/settings/sync").set({
    schemaVersion: 1,
    enabled: true,
    categories,
    updatedAt: FieldValue.serverTimestamp()
  });
}

function noteRequest(entityId = "note-1", requestId = newRequestId(), overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    requestId,
    deviceId,
    entityType: "note",
    lessonId: "lesson-1",
    entityId,
    operation: "upsert",
    baseRevision: 0,
    payloadSchemaVersion: 1,
    payload: {
      title: "Study note",
      content: "Mitochondria generate ATP.",
      createdAtMs: 100,
      updatedAtMs: 100
    },
    ...overrides
  };
}

const quizPayload = {
  title: "Cell biology quiz",
  scope: "whole_lesson",
  scopeLabel: "Whole lesson",
  createdAtMs: 100,
  questions: [{
    id: "q1",
    type: "multiple_choice",
    prompt: "Which organelle produces ATP?",
    options: ["Mitochondria", "Nucleus", "Ribosome"],
    correctAnswer: "Mitochondria",
    explanation: "Mitochondria generate ATP.",
    topic: "Cell biology",
    evidence: "Mitochondria generate ATP."
  }]
};

function quizRequest(requestId = newRequestId(), overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    requestId,
    deviceId,
    entityType: "quiz",
    lessonId: "lesson-1",
    entityId: "quiz-1",
    operation: "upsert",
    baseRevision: 0,
    payloadSchemaVersion: 1,
    payload: quizPayload,
    ...overrides
  };
}

function attemptRequest(requestId = newRequestId(), overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    requestId,
    deviceId,
    entityType: "attempt",
    lessonId: "lesson-1",
    entityId: "attempt-1",
    operation: "upsert",
    baseRevision: 0,
    payloadSchemaVersion: 1,
    payload: {
      quizId: "quiz-1",
      createdAtMs: 200,
      results: [{ questionId: "q1", answer: "Mitochondria", correct: true, feedback: "Correct." }],
      objectiveScore: 1,
      objectiveTotal: 1,
      topicsToReview: []
    },
    ...overrides
  };
}

describe("Firebase Admin sync settings adapter", () => {
  it("stores only the authenticated account consent and uses a server timestamp", async () => {
    const uid = newUid();
    const result = await saveSyncSettingsForAccount(uid, {
      enabled: true,
      categories: { lessonMetadata: false, notes: true, quizzes: true, attempts: true }
    }, database);
    assert.equal(result.saved, true);
    assert.equal(result.enabled, true);
    const stored = await database.doc("users/" + uid + "/settings/sync").get();
    assert.equal(stored.data()?.schemaVersion, 1);
    assert.equal(stored.data()?.categories?.notes, true);
    assert.equal(typeof stored.data()?.updatedAt?.toMillis, "function");
  });

  it("rejects attempts-only cloud consent before writing settings", async () => {
    const uid = newUid();
    await assert.rejects(
      saveSyncSettingsForAccount(uid, {
        enabled: true,
        categories: { lessonMetadata: false, notes: false, quizzes: false, attempts: true }
      }, database),
      (cause: unknown) => cause instanceof SyncBackendError && cause.code === "failed-precondition"
    );
    assert.equal((await database.doc("users/" + uid + "/settings/sync").get()).exists, false);
  });
});

describe("Firebase Admin sync mutation adapter", () => {
  it("atomically creates the entity, idempotency receipt, device record, and pull-feed event", async () => {
    const uid = newUid();
    await enableSync(uid);

    const request = noteRequest();
    const result = await applySyncMutation(uid, request, database);
    assert.deepEqual(result, { outcome: "applied", resultRevision: 1 });

    const entity = await database.doc("users/" + uid + "/lessons/lesson-1/notes/note-1").get();
    const receipt = await database.doc("users/" + uid + "/syncReceipts/" + request.requestId).get();
    const counter = await database.doc("users/" + uid + "/syncState/changeFeed").get();
    const events = await database.collection("users/" + uid + "/syncChanges").get();

    assert.equal(entity.data()?.revision, 1);
    assert.equal(entity.data()?.deletedAt, null);
    assert.equal(entity.data()?.payload?.content, "Mitochondria generate ATP.");
    assert.equal(receipt.data()?.outcome, "applied");
    assert.equal(counter.data()?.lastSequence, 1);
    assert.equal(events.size, 1);
    assert.equal(events.docs[0].data().sequence, 1);
    assert.equal((await database.doc("users/" + uid + "/devices/" + deviceId).get()).exists, true);
  });

  it("replays an identical request without creating another feed event and rejects key reuse", async () => {
    const uid = newUid();
    await enableSync(uid);
    const request = noteRequest();

    await applySyncMutation(uid, request, database);
    assert.deepEqual(await applySyncMutation(uid, request, database), {
      outcome: "applied", resultRevision: 1, replayed: true
    });

    await assert.rejects(
      applySyncMutation(uid, {
        ...request,
        payload: { ...request.payload as Record<string, unknown>, content: "Different content." }
      }, database),
      (cause: unknown) => cause instanceof SyncBackendError && cause.code === "already-exists"
    );
    const events = await database.collection("users/" + uid + "/syncChanges").get();
    assert.equal(events.size, 1);
  });

  it("stores stale requests as conflicts with both local and remote snapshots", async () => {
    const uid = newUid();
    await enableSync(uid);
    await applySyncMutation(uid, noteRequest());

    const stale = noteRequest("note-1", newRequestId(), {
      payload: {
        title: "Stale local note",
        content: "A different offline edit.",
        createdAtMs: 100,
        updatedAtMs: 300
      }
    });
    const result = await applySyncMutation(uid, stale, database);
    assert.deepEqual(result, {
      outcome: "conflict",
      resultRevision: 1,
      conflictCode: "revision_conflict"
    });

    const conflict = await database.doc("users/" + uid + "/syncConflicts/" + stale.requestId).get();
    const localSnapshotPath = conflict.data()?.localSnapshotPath as string;
    const remoteSnapshotPath = conflict.data()?.remoteSnapshotPath as string;
    const [localSnapshot, remoteSnapshot] = await Promise.all([
      database.doc(localSnapshotPath).get(),
      database.doc(remoteSnapshotPath).get()
    ]);
    assert.equal(localSnapshot.data()?.payload?.content, "A different offline edit.");
    assert.equal(remoteSnapshot.data()?.payload?.content, "Mitochondria generate ATP.");
    assert.equal(conflict.data()?.remoteIsDeleted, false);
    assert.equal((await database.collection("users/" + uid + "/syncChanges").get()).size, 1);
  });

  it("requires an existing active quiz before accepting a quiz attempt and blocks deleting its quiz", async () => {
    const uid = newUid();
    await enableSync(uid);

    await assert.rejects(
      applySyncMutation(uid, attemptRequest(), database),
      (cause: unknown) => cause instanceof SyncBackendError && cause.message.includes("quiz_not_found")
    );

    await applySyncMutation(uid, quizRequest());
    const attempt = await attemptRequest();
    await applySyncMutation(uid, attempt, database);

    await assert.rejects(
      applySyncMutation(uid, quizRequest(newRequestId(), {
        operation: "delete",
        payload: null,
        baseRevision: 1
      }), database),
      (cause: unknown) => cause instanceof SyncBackendError && cause.message.includes("quiz_has_attempts")
    );

    const quiz = await database.doc("users/" + uid + "/lessons/lesson-1/quizzes/quiz-1").get();
    assert.equal(quiz.data()?.deletedAt, null);
  });

  it("rejects an attempt that refers to a question absent from the referenced quiz", async () => {
    const uid = newUid();
    await enableSync(uid);
    await applySyncMutation(uid, quizRequest());

    await assert.rejects(
      applySyncMutation(uid, attemptRequest(newRequestId(), {
        payload: {
          quizId: "quiz-1",
          createdAtMs: 200,
          results: [{ questionId: "unknown-question", answer: "answer", correct: false, feedback: "" }],
          objectiveScore: 0,
          objectiveTotal: 1,
          topicsToReview: []
        }
      }), database),
      (cause: unknown) => cause instanceof SyncBackendError && cause.message.includes("quiz_reference_mismatch")
    );
  });

  it("serializes concurrent writes through the per-account feed counter", async () => {
    const uid = newUid();
    await enableSync(uid);

    const results = await Promise.all([
      applySyncMutation(uid, noteRequest("note-a"), database),
      applySyncMutation(uid, noteRequest("note-b"), database)
    ]);
    assert.deepEqual(results.map((result) => result.resultRevision).sort(), [1, 1]);

    const counter = await database.doc("users/" + uid + "/syncState/changeFeed").get();
    const events = await database.collection("users/" + uid + "/syncChanges").orderBy("sequence").get();
    assert.equal(counter.data()?.lastSequence, 2);
    assert.deepEqual(events.docs.map((event) => event.data().sequence), [1, 2]);
  });
});
