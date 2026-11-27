import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import { pullSyncChanges } from "../src/sync-pull";
import { SyncBackendError } from "../src/errors";

let app: App;
let database: Firestore;

const cursorSecret = "learnlens-test-sync-cursor-secret-material-32-bytes-minimum";

before(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Sync pull tests require FIRESTORE_EMULATOR_HOST; refusing to contact a live project.");
  }
  app = initializeApp({ projectId: "demo-learnlens-functions" }, "learnlens-sync-pull-tests");
  database = getFirestore(app);
});

after(async () => {
  if (app) await deleteApp(app);
});

function newUid(): string {
  return "pull-user-" + randomUUID();
}

const deviceId = "22222222-2222-4222-8222-222222222222";

function categories() {
  return { lessonMetadata: true, notes: true, quizzes: true, attempts: true };
}

async function seedFeed(
  uid: string,
  events: Array<{ sequence: number; entityType: string; payload?: unknown }>,
  settings: { enabled?: boolean; categories?: Record<string, boolean> } = {}
): Promise<void> {
  const batch = database.batch();
  const root = "users/" + uid;
  batch.set(database.doc(root + "/settings/sync"), {
    schemaVersion: 1,
    enabled: settings.enabled ?? true,
    categories: settings.categories ?? categories(),
    updatedAt: FieldValue.serverTimestamp()
  });
  const maxSequence = events.reduce((maximum, event) => Math.max(maximum, event.sequence), 0);
  batch.set(database.doc(root + "/syncState/changeFeed"), {
    lastSequence: maxSequence,
    updatedAt: FieldValue.serverTimestamp()
  });

  for (const event of events) {
    const entityId = event.entityType === "lesson" ? "lesson-" + event.sequence : "artifact-" + event.sequence;
    const payload = event.payload ?? (event.entityType === "note" ? {
      title: "Note " + event.sequence,
      content: "Content for note " + event.sequence,
      createdAtMs: event.sequence,
      updatedAtMs: event.sequence
    } : {});
    batch.set(database.doc(root + "/syncChangePayloads/" + String(event.sequence)), {
      sequence: event.sequence,
      payload
    });
    batch.set(database.doc(root + "/syncChanges/" + String(event.sequence)), {
      sequence: event.sequence,
      entityType: event.entityType,
      lessonId: "lesson-" + event.sequence,
      entityId,
      revision: 1,
      isDeleted: false,
      payloadRef: String(event.sequence),
      payloadBytes: Buffer.byteLength(JSON.stringify(payload), "utf8")
    });
  }
  await batch.commit();
}

function pullRequest(category = "notes", cursor: string | null = null, id = deviceId) {
  return { protocolVersion: 1, deviceId: id, category, cursor };
}

describe("Firebase Admin category-scoped sync pull", () => {
  it("paginates a fixed snapshot and reuses the final checkpoint for a new snapshot", async () => {
    const uid = newUid();
    const events = Array.from({ length: 205 }, (_, index) => ({
      sequence: index + 1,
      entityType: "note"
    }));
    await seedFeed(uid, events);

    const first = await pullSyncChanges(uid, pullRequest(), database, cursorSecret);
    assert.equal(first.fromSequence, 0);
    assert.equal(first.snapshotSequence, 205);
    assert.equal(first.scannedThroughSequence, 100);
    assert.equal(first.changes.length, 100);
    assert.equal(first.hasMore, true);

    const second = await pullSyncChanges(uid, pullRequest("notes", first.nextCursor), database, cursorSecret);
    assert.equal(second.fromSequence, 100);
    assert.equal(second.snapshotSequence, 205);
    assert.equal(second.scannedThroughSequence, 200);
    assert.equal(second.changes.length, 100);
    assert.equal(second.hasMore, true);

    const third = await pullSyncChanges(uid, pullRequest("notes", second.nextCursor), database, cursorSecret);
    assert.equal(third.fromSequence, 200);
    assert.equal(third.snapshotSequence, 205);
    assert.equal(third.scannedThroughSequence, 205);
    assert.equal(third.changes.length, 5);
    assert.equal(third.hasMore, false);

    const batch = database.batch();
    const newPayload = {
      title: "New note",
      content: "A later note.",
      createdAtMs: 206,
      updatedAtMs: 206
    };
    batch.set(database.doc("users/" + uid + "/syncChangePayloads/206"), {
      sequence: 206,
      payload: newPayload
    });
    batch.set(database.doc("users/" + uid + "/syncChanges/206"), {
      sequence: 206,
      entityType: "note",
      lessonId: "lesson-206",
      entityId: "artifact-206",
      revision: 1,
      isDeleted: false,
      payloadRef: "206",
      payloadBytes: Buffer.byteLength(JSON.stringify(newPayload), "utf8")
    });
    batch.set(database.doc("users/" + uid + "/syncState/changeFeed"), {
      lastSequence: 206,
      updatedAt: FieldValue.serverTimestamp()
    });
    await batch.commit();

    const nextSnapshot = await pullSyncChanges(uid, pullRequest("notes", third.nextCursor), database, cursorSecret);
    assert.equal(nextSnapshot.fromSequence, 205);
    assert.equal(nextSnapshot.snapshotSequence, 206);
    assert.equal(nextSnapshot.changes.length, 1);
    assert.equal(nextSnapshot.changes[0].entityId, "artifact-206");
    assert.equal(nextSnapshot.hasMore, false);
  });

  it("caps total returned payload bytes below the callable response budget", async () => {
    const uid = newUid();
    const events = Array.from({ length: 20 }, (_, index) => ({
      sequence: index + 1,
      entityType: "note",
      payload: {
        title: "Large note " + (index + 1),
        content: "x".repeat(240 * 1024),
        createdAtMs: index + 1,
        updatedAtMs: index + 1
      }
    }));
    await seedFeed(uid, events);

    const first = await pullSyncChanges(uid, pullRequest(), database, cursorSecret);
    const returnedBytes = first.changes.reduce(
      (total, change) => total + Buffer.byteLength(JSON.stringify(change.payload), "utf8"),
      0
    );
    assert.ok(first.changes.length > 0);
    assert.ok(first.changes.length < events.length);
    assert.ok(returnedBytes <= 4 * 1024 * 1024);
    assert.equal(first.hasMore, true);

    const second = await pullSyncChanges(uid, pullRequest("notes", first.nextCursor), database, cursorSecret);
    assert.equal(first.changes.length + second.changes.length, events.length);
    assert.equal(second.hasMore, false);
  });

  it("scans past other categories while returning only the requested category", async () => {
    const uid = newUid();
    await seedFeed(uid, [
      { sequence: 1, entityType: "quiz" },
      { sequence: 2, entityType: "note" },
      { sequence: 3, entityType: "attempt" },
      { sequence: 4, entityType: "lesson" },
      { sequence: 5, entityType: "note" }
    ]);

    const page = await pullSyncChanges(uid, pullRequest("notes"), database, cursorSecret);
    assert.equal(page.changes.length, 2);
    assert.deepEqual(page.changes.map(change => change.sequence), [2, 5]);
    assert.equal(page.scannedThroughSequence, 5);
    assert.equal(page.hasMore, false);
  });

  it("binds cursors to the authenticated account, device, and category", async () => {
    const uid = newUid();
    await seedFeed(uid, [{ sequence: 1, entityType: "note" }]);
    const page = await pullSyncChanges(uid, pullRequest(), database, cursorSecret);

    await assert.rejects(
      pullSyncChanges(newUid(), pullRequest("notes", page.nextCursor), database, cursorSecret),
      (cause: unknown) => cause instanceof SyncBackendError && cause.code === "permission-denied"
    );
    await assert.rejects(
      pullSyncChanges(uid, pullRequest("notes", page.nextCursor, "33333333-3333-4333-8333-333333333333"), database, cursorSecret),
      (cause: unknown) => cause instanceof SyncBackendError && cause.code === "permission-denied"
    );
    await assert.rejects(
      pullSyncChanges(uid, pullRequest("quizzes", page.nextCursor), database, cursorSecret),
      (cause: unknown) => cause instanceof SyncBackendError && cause.code === "permission-denied"
    );
  });

  it("rejects a tampered cursor signature", async () => {
    const uid = newUid();
    await seedFeed(uid, [{ sequence: 1, entityType: "note" }]);
    const page = await pullSyncChanges(uid, pullRequest(), database, cursorSecret);
    const [body, signature] = page.nextCursor.split(".");
    const first = signature[0] === "A" ? "B" : "A";
    const tampered = body + "." + first + signature.slice(1);

    await assert.rejects(
      pullSyncChanges(uid, pullRequest("notes", tampered), database, cursorSecret),
      (cause: unknown) => cause instanceof SyncBackendError && cause.code === "invalid-argument"
    );
  });

  it("requires server-side sync consent for the requested category", async () => {
    const uid = newUid();
    await seedFeed(uid, [{ sequence: 1, entityType: "note" }], {
      categories: { lessonMetadata: true, notes: false, quizzes: true, attempts: true }
    });

    await assert.rejects(
      pullSyncChanges(uid, pullRequest(), database, cursorSecret),
      (cause: unknown) => cause instanceof SyncBackendError && cause.code === "failed-precondition"
    );
  });

  it("rejects missing feed sequence records instead of advancing over a gap", async () => {
    const uid = newUid();
    await seedFeed(uid, [{ sequence: 1, entityType: "note" }]);
    await database.doc("users/" + uid + "/syncState/changeFeed").update({ lastSequence: 2 });

    await assert.rejects(
      pullSyncChanges(uid, pullRequest(), database, cursorSecret),
      (cause: unknown) => cause instanceof SyncBackendError && cause.message.includes("missing sequence")
    );
  });

  it("rejects client-supplied sequence numbers and unsupported request fields", async () => {
    const uid = newUid();
    await seedFeed(uid, [{ sequence: 1, entityType: "note" }]);

    await assert.rejects(
      pullSyncChanges(uid, {
        ...pullRequest(),
        fromSequence: 0
      }, database, cursorSecret),
      (cause: unknown) => cause instanceof SyncBackendError && cause.code === "invalid-argument"
    );
  });
});
