import { describe, expect, it } from "vitest";
import type { QuizSyncDto } from "./sync-dto";
import type { SyncPreparedPayload } from "./session-store";
import {
  buildSyncFirestorePaths,
  canonicalizeSyncServerRequest,
  canonicalizeSyncServerValue,
  decideSyncServerMutation,
  validateSyncServerRequest,
  type SyncServerEntitySnapshot,
  type SyncServerMutationRequest
} from "./sync-server-contract";

const requestId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const fingerprint = "a".repeat(64);

const notePayload = {
  title: "Lecture notes",
  content: "The mitochondria generate ATP.",
  createdAtMs: 100,
  updatedAtMs: 200
};

function rawRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolVersion: 1,
    requestId,
    deviceId,
    entityType: "note",
    lessonId: "lesson-1",
    entityId: "note-1",
    operation: "upsert",
    baseRevision: 0,
    payloadSchemaVersion: 1,
    payload: notePayload,
    ...overrides
  };
}

function parseRequest(overrides: Record<string, unknown> = {}): SyncServerMutationRequest {
  return validateSyncServerRequest(rawRequest(overrides));
}

function currentNote(overrides: Partial<SyncServerEntitySnapshot> = {}): SyncServerEntitySnapshot {
  return {
    entityType: "note",
    lessonId: "lesson-1",
    entityId: "note-1",
    revision: 1,
    isDeleted: false,
    payload: notePayload,
    ...overrides
  };
}

const quizPayload: QuizSyncDto = {
  title: "Lesson quiz",
  scope: "whole_lesson",
  scopeLabel: "Whole lesson",
  createdAtMs: 100,
  questions: [
    {
      id: "q1",
      type: "multiple_choice",
      prompt: "Which molecule is produced?",
      options: ["ATP", "Oxygen", "Water"],
      correctAnswer: "ATP",
      explanation: "ATP is produced.",
      topic: "Cellular respiration",
      evidence: "Mitochondria generate ATP."
    },
    {
      id: "q2",
      type: "true_false",
      prompt: "ATP is energy currency.",
      options: ["True", "False"],
      correctAnswer: "True",
      explanation: "The lesson describes ATP as energy currency.",
      topic: "Cellular respiration",
      evidence: "ATP is the energy currency."
    },
    {
      id: "q3",
      type: "short_answer",
      prompt: "Name the organelle.",
      options: [],
      correctAnswer: "Mitochondria",
      explanation: "Mitochondria are the organelles.",
      topic: "Cell structure",
      evidence: "Mitochondria are organelles."
    }
  ]
};

describe("server-side sync mutation contract", () => {
  it("canonicalizes nested payload objects while preserving array order", () => {
    expect(canonicalizeSyncServerValue({
      z: 1,
      a: { y: 2, x: 3 },
      list: ["second", "first"]
    })).toBe('{"a":{"x":3,"y":2},"list":["second","first"],"z":1}');
  });


  it("accepts the exact request envelope and allow-listed note DTO", () => {
    expect(parseRequest()).toMatchObject({
      protocolVersion: 1,
      requestId,
      deviceId,
      entityType: "note",
      operation: "upsert",
      payload: notePayload
    });
  });

  it("rejects client-supplied account identity and unknown request fields", () => {
    expect(() => validateSyncServerRequest(rawRequest({ ownerUid: "victim-user" })))
      .toThrow(/unsupported field/i);
    expect(() => validateSyncServerRequest(rawRequest({ uid: "victim-user" })))
      .toThrow(/unsupported field/i);
  });

  it("rejects unsafe IDs, mismatched lesson identity, and non-UUID request IDs", () => {
    expect(() => validateSyncServerRequest(rawRequest({ lessonId: "../other-user" })))
      .toThrow(/lesson ID/i);
    expect(() => validateSyncServerRequest(rawRequest({ entityType: "lesson", entityId: "different-id" })))
      .toThrow(/must equal/i);
    expect(() => validateSyncServerRequest(rawRequest({ requestId: "request-1" })))
      .toThrow(/request ID/i);
  });

  it("rejects delete payloads and upserts without payloads", () => {
    expect(() => validateSyncServerRequest(rawRequest({ operation: "delete", payload: notePayload })))
      .toThrow(/cannot include a payload/i);
    expect(() => validateSyncServerRequest(rawRequest({ payload: null })))
      .toThrow(/require a payload/i);
  });

  it("rejects unexpected DTO properties such as transcript data", () => {
    expect(() => validateSyncServerRequest(rawRequest({
      payload: { ...notePayload, transcriptText: "private lesson transcript" }
    }))).toThrow(/unsupported field/i);
  });

  it("enforces server-side payload byte limits instead of trusting client mappers", () => {
    expect(() => validateSyncServerRequest(rawRequest({
      payload: { ...notePayload, content: "x".repeat(256 * 1024) }
    }))).toThrow(/size limit/i);
  });

  it("validates nested quiz and attempt DTO shapes", () => {
    expect(validateSyncServerRequest(rawRequest({
      entityType: "quiz",
      entityId: "quiz-1",
      payload: quizPayload
    })).entityType).toBe("quiz");

    expect(validateSyncServerRequest(rawRequest({
      entityType: "attempt",
      entityId: "attempt-1",
      payload: {
        quizId: "quiz-1",
        createdAtMs: 300,
        results: [{ questionId: "q1", answer: "ATP", correct: true, feedback: "Correct." }],
        objectiveScore: 1,
        objectiveTotal: 1,
        topicsToReview: []
      }
    })).entityType).toBe("attempt");

    expect(() => validateSyncServerRequest(rawRequest({
      entityType: "quiz",
      entityId: "quiz-1",
      payload: { ...quizPayload, transcriptText: "must not be accepted" }
    }))).toThrow(/unsupported field/i);
  });


  it("rejects duplicate quiz question IDs and incorrect multiple-choice keys", () => {
    const duplicateQuestions = { ...quizPayload, questions: [quizPayload.questions[0], quizPayload.questions[0]] };
    expect(() => validateSyncServerRequest(rawRequest({
      entityType: "quiz",
      entityId: "quiz-1",
      payload: duplicateQuestions
    }))).toThrow(/IDs must be unique/i);

    const incorrectAnswer = {
      ...quizPayload,
      questions: quizPayload.questions.map((question, index) =>
        index === 0 ? { ...question, correctAnswer: "Not an option" } : question
      )
    };
    expect(() => validateSyncServerRequest(rawRequest({
      entityType: "quiz",
      entityId: "quiz-1",
      payload: incorrectAnswer
    }))).toThrow(/must match an allowed option/i);
  });

  it("revalidates typed requests before deriving server mutation paths or decisions", () => {
    const forged = { ...rawRequest(), entityId: "../escape" } as unknown as SyncServerMutationRequest;
    expect(() => buildSyncFirestorePaths("verified-user", forged)).toThrow(/entity ID/i);
    expect(decideSyncServerMutation(forged, null, null, fingerprint))
      .toEqual({ kind: "reject", code: "invalid_request" });
  });

  it("derives all Firestore paths from authenticated UID and validated IDs", () => {
    const request = parseRequest();
    expect(buildSyncFirestorePaths("verified-user", request)).toEqual({
      entity: "users/verified-user/lessons/lesson-1/notes/note-1",
      receipt: "users/verified-user/syncReceipts/" + requestId,
      conflict: "users/verified-user/syncConflicts/" + requestId,
      device: "users/verified-user/devices/" + deviceId
    });
    expect(() => buildSyncFirestorePaths("user/a", request)).toThrow(/account ID/i);
  });

  it("canonicalizes object key order for a server-computed request fingerprint", () => {
    const request = parseRequest();
    const reordered = validateSyncServerRequest({
      ...rawRequest(),
      payload: {
        updatedAtMs: 200,
        content: "The mitochondria generate ATP.",
        createdAtMs: 100,
        title: "Lecture notes"
      }
    });
    expect(canonicalizeSyncServerRequest(request)).toBe(canonicalizeSyncServerRequest(reordered));
  });

  it("applies a new entity using revision one and a server-owned envelope plan", () => {
    const decision = decideSyncServerMutation(parseRequest(), null, null, fingerprint);
    expect(decision).toMatchObject({
      kind: "apply",
      nextRevision: 1,
      isDeleted: false,
      payload: notePayload,
      preserveCreatedAt: false,
      receipt: { outcome: "applied", resultRevision: 1, requestId }
    });
  });

  it("updates a mutable note only when its base revision matches", () => {
    const updatedPayload = { ...notePayload, content: "A revised body", updatedAtMs: 300 };
    const request = parseRequest({ baseRevision: 1, payload: updatedPayload });
    const decision = decideSyncServerMutation(request, currentNote(), null, fingerprint);
    expect(decision).toMatchObject({
      kind: "apply",
      nextRevision: 2,
      isDeleted: false,
      payload: updatedPayload,
      preserveCreatedAt: true
    });
  });

  it("preserves a stale local edit as a conflict rather than overwriting the remote revision", () => {
    const decision = decideSyncServerMutation(parseRequest(), currentNote({ revision: 2 }), null, fingerprint);
    expect(decision).toMatchObject({
      kind: "conflict",
      conflict: {
        reason: "revision_conflict",
        baseRevision: 0,
        remoteRevision: 2,
        payloadSnapshot: notePayload,
        remotePayloadSnapshot: notePayload,
        remoteIsDeleted: false
      },
      receipt: { outcome: "conflict", resultRevision: 2 }
    });
  });


  it("replays a recorded conflict instead of creating a second conflict on retry", () => {
    const first = decideSyncServerMutation(parseRequest(), currentNote({ revision: 2 }), null, fingerprint);
    if (first.kind !== "conflict") throw new Error("Expected a revision conflict.");
    expect(decideSyncServerMutation(
      parseRequest(),
      currentNote({ revision: 2 }),
      {
        requestId,
        requestFingerprint: fingerprint,
        outcome: "conflict",
        resultRevision: 2,
        conflictCode: "revision_conflict"
      },
      fingerprint
    )).toEqual({
      kind: "replay",
      outcome: "conflict",
      resultRevision: 2,
      conflictCode: "revision_conflict"
    });
  });

  it("does not let a stale delete remove a newer remote edit", () => {
    const request = parseRequest({ operation: "delete", payload: null, baseRevision: 0 });
    const decision = decideSyncServerMutation(request, currentNote({ revision: 3 }), null, fingerprint);
    expect(decision).toMatchObject({
      kind: "conflict",
      conflict: { reason: "revision_conflict", remoteRevision: 3, payloadSnapshot: null }
    });
  });

  it("never resurrects a tombstoned record through an ordinary upsert", () => {
    const request = parseRequest({ baseRevision: 4 });
    const decision = decideSyncServerMutation(request, currentNote({ revision: 4, isDeleted: true, payload: null }), null, fingerprint);
    expect(decision).toMatchObject({
      kind: "conflict",
      conflict: { reason: "entity_deleted", remoteRevision: 4 }
    });
  });

  it("treats quiz and attempt creation as immutable after the first successful write", () => {
    const request = validateSyncServerRequest(rawRequest({
      entityType: "quiz",
      entityId: "quiz-1",
      payload: quizPayload,
      baseRevision: 1
    }));
    const current: SyncServerEntitySnapshot = {
      entityType: "quiz",
      lessonId: "lesson-1",
      entityId: "quiz-1",
      revision: 1,
      isDeleted: false,
      payload: quizPayload
    };
    expect(decideSyncServerMutation(request, current, null, fingerprint)).toMatchObject({
      kind: "conflict",
      conflict: { reason: "immutable_entity_exists" }
    });
  });

  it("writes a content-free tombstone plan when a delete is based on the current revision", () => {
    const request = parseRequest({ operation: "delete", payload: null, baseRevision: 1 });
    const decision = decideSyncServerMutation(request, currentNote(), null, fingerprint);
    expect(decision).toMatchObject({
      kind: "apply",
      nextRevision: 2,
      isDeleted: true,
      payload: null,
      receipt: { outcome: "applied", resultRevision: 2 }
    });
  });

  it("rejects deleting a document that has never existed remotely", () => {
    const request = parseRequest({ operation: "delete", payload: null, baseRevision: 0 });
    expect(decideSyncServerMutation(request, null, null, fingerprint))
      .toEqual({ kind: "reject", code: "entity_not_found" });
  });

  it("replays the first result for an identical idempotency key and request fingerprint", () => {
    const receipt = {
      requestId,
      requestFingerprint: fingerprint,
      outcome: "applied" as const,
      resultRevision: 1
    };
    expect(decideSyncServerMutation(parseRequest(), null, receipt, fingerprint)).toEqual({
      kind: "replay",
      outcome: "applied",
      resultRevision: 1
    });
  });

  it("rejects reuse of an idempotency key with a different body fingerprint", () => {
    const receipt = {
      requestId,
      requestFingerprint: fingerprint,
      outcome: "applied" as const,
      resultRevision: 1
    };
    expect(decideSyncServerMutation(parseRequest(), null, receipt, "b".repeat(64)))
      .toEqual({ kind: "reject", code: "idempotency_key_reused" });
  });

  it("requires an active quiz in the same lesson before accepting an attempt", async () => {
    const { validateSyncServerMutationDependencies } = await import("./sync-server-contract");
    const attemptRequest = validateSyncServerRequest(rawRequest({
      entityType: "attempt",
      entityId: "attempt-1",
      payload: {
        quizId: "quiz-1",
        createdAtMs: 300,
        results: [{ questionId: "q1", answer: "ATP", correct: true, feedback: "Correct." }],
        objectiveScore: 1,
        objectiveTotal: 1,
        topicsToReview: []
      }
    }));
    const quiz = {
      entityType: "quiz" as const,
      lessonId: "lesson-1",
      entityId: "quiz-1",
      revision: 1,
      isDeleted: false,
      payload: quizPayload
    };
    expect(validateSyncServerMutationDependencies(attemptRequest, {
      attempts: true, quizzes: false
    }, quiz)).toEqual({ kind: "reject", code: "quiz_category_required" });
    expect(validateSyncServerMutationDependencies(attemptRequest, {
      attempts: true, quizzes: true
    }, null)).toEqual({ kind: "reject", code: "quiz_not_found" });
    expect(validateSyncServerMutationDependencies(attemptRequest, {
      attempts: true, quizzes: true
    }, { ...quiz, isDeleted: true })).toEqual({ kind: "reject", code: "quiz_deleted" });
    expect(validateSyncServerMutationDependencies(attemptRequest, {
      attempts: true, quizzes: true
    }, quiz)).toEqual({ kind: "allow" });
    expect(validateSyncServerMutationDependencies(attemptRequest, {
      attempts: false, quizzes: true
    }, quiz)).toEqual({ kind: "reject", code: "category_not_enabled" });
    expect(validateSyncServerMutationDependencies(attemptRequest, {
      attempts: true, quizzes: true
    }, { ...quiz, payload: { ...quizPayload, transcriptText: "not allowed" } as unknown as SyncPreparedPayload }))
      .toEqual({ kind: "reject", code: "quiz_reference_mismatch" });
  });

  it("prevents deletion of a quiz while active attempts still reference it", async () => {
    const { validateSyncServerMutationDependencies } = await import("./sync-server-contract");
    const quizDelete = validateSyncServerRequest(rawRequest({
      entityType: "quiz",
      entityId: "quiz-1",
      operation: "delete",
      payload: null,
      baseRevision: 1
    }));
    expect(validateSyncServerMutationDependencies(quizDelete, {
      attempts: true, quizzes: true
    }, null, true)).toEqual({ kind: "reject", code: "quiz_has_attempts" });
    expect(validateSyncServerMutationDependencies(quizDelete, {
      attempts: true, quizzes: true
    }, null, false)).toEqual({ kind: "allow" });
  });

  it("rejects an attempt containing a question ID absent from the referenced quiz", async () => {
    const { validateSyncServerMutationDependencies } = await import("./sync-server-contract");
    const attemptRequest = validateSyncServerRequest(rawRequest({
      entityType: "attempt",
      entityId: "attempt-1",
      payload: {
        quizId: "quiz-1",
        createdAtMs: 300,
        results: [{ questionId: "not-in-quiz", answer: "ATP", correct: true, feedback: "Correct." }],
        objectiveScore: 1,
        objectiveTotal: 1,
        topicsToReview: []
      }
    }));
    expect(validateSyncServerMutationDependencies(attemptRequest, {
      attempts: true, quizzes: true
    }, {
      entityType: "quiz",
      lessonId: "lesson-1",
      entityId: "quiz-1",
      revision: 1,
      isDeleted: false,
      payload: quizPayload
    })).toEqual({ kind: "reject", code: "quiz_reference_mismatch" });
  });

  it("rejects an attempt whose quiz ID points to another lesson or entity", async () => {
    const { validateSyncServerMutationDependencies } = await import("./sync-server-contract");
    const attemptRequest = validateSyncServerRequest(rawRequest({
      entityType: "attempt",
      entityId: "attempt-1",
      payload: {
        quizId: "quiz-1",
        createdAtMs: 300,
        results: [],
        objectiveScore: 0,
        objectiveTotal: 0,
        topicsToReview: []
      }
    }));
    expect(validateSyncServerMutationDependencies(attemptRequest, {
      attempts: true, quizzes: true
    }, {
      entityType: "quiz",
      lessonId: "another-lesson",
      entityId: "quiz-1",
      revision: 1,
      isDeleted: false,
      payload: quizPayload
    })).toEqual({ kind: "reject", code: "quiz_reference_mismatch" });
  });

  it("rejects a malformed receipt fingerprint and corrupt remote revisions", () => {
    expect(decideSyncServerMutation(parseRequest(), null, null, "bad"))
      .toEqual({ kind: "reject", code: "invalid_fingerprint" });
    expect(decideSyncServerMutation(parseRequest(), currentNote({ revision: -1 }), null, fingerprint))
      .toEqual({ kind: "reject", code: "corrupt_remote_record" });
  });
});
