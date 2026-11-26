import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  acknowledgeSyncRequest,
  claimSyncEntity,
  getSyncMetadata,
  deleteLearningNote,
  getSyncConflict,
  getSyncRequest,
  listLearningNotes,
  listLearningSessions,
  listSyncConflicts,
  listSyncOutbox,
  listSyncRequests,
  markSyncRequestConflicted,
  markSyncRequestFailed,
  pruneSyncRequestHistory,
  markSyncRequestInFlight,
  queueSyncOperation,
  resolveSyncConflict,
  saveLearningNote,
  saveLearningSession,
  saveLocalSyncPreferences,
  saveQuiz
} from "./session-store";
import { prepareSyncRequests } from "./sync-engine";
import { dispatchSyncRequest, getSyncTransportReadiness } from "./sync-transport";

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("learnlens-local");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Database deletion was blocked."));
  });
}

const categories = {
  lessonMetadata: false,
  notes: true,
  quizzes: false,
  attempts: false
};

async function createQueuedNote(noteId: string, content: string) {
  const note = {
    id: noteId,
    sessionId: "journal-lesson",
    videoId: "journal-lesson",
    title: "Journal note",
    content,
    createdAt: 1,
    updatedAt: 2
  };
  await saveLearningNote(note);
  const entityKey = `note:journal-lesson:${noteId}`;
  await claimSyncEntity({
    entityKey,
    entityType: "note",
    lessonId: "journal-lesson",
    entityId: noteId,
    ownerUid: "user-a",
    syncCategory: "notes"
  });
  await queueSyncOperation(entityKey, "user-a", "upsert");
  await saveLocalSyncPreferences("user-a", categories);
  return { note, entityKey };
}

describe("durable sync request journal", () => {
  beforeEach(async () => {
    await deleteDatabase();
  });

  it("persists an immutable DTO snapshot and reconciles a newer edit after acknowledgement", async () => {
    const { note, entityKey } = await createQueuedNote("immutable-note", "Original body");
    const prepared = await prepareSyncRequests("user-a", 10);
    expect(prepared.requests).toHaveLength(1);
    expect(prepared.blocked).toEqual([]);

    const first = prepared.requests[0];
    expect(first).toMatchObject({
      entityKey,
      operation: "upsert",
      baseRevision: 0,
      status: "prepared",
      payloadSnapshot: { title: "Journal note", content: "Original body" }
    });

    const repeated = await prepareSyncRequests("user-a", 10);
    expect(repeated.requests).toHaveLength(1);
    expect(repeated.requests[0].requestId).toBe(first.requestId);
    expect(repeated.requests[0].payloadSnapshot).toEqual(first.payloadSnapshot);

    const inFlight = await markSyncRequestInFlight(first.requestId, "user-a");
    expect(inFlight.status).toBe("in_flight");
    expect(inFlight.attemptCount).toBe(1);

    await saveLearningNote({ ...note, content: "Updated after send", updatedAt: 3 });
    const storedSnapshot = await getSyncRequest(first.requestId);
    expect(storedSnapshot?.payloadSnapshot).toMatchObject({ content: "Original body" });
    const [latestOutbox] = await listSyncOutbox("user-a");
    expect(latestOutbox.operationId).not.toBe(first.operationId);
    expect(latestOutbox.baseRevision).toBe(0);

    await acknowledgeSyncRequest(first.requestId, "user-a", 1);
    const [rebasedOutbox] = await listSyncOutbox("user-a");
    expect(rebasedOutbox).toMatchObject({
      operation: "upsert",
      baseRevision: 1,
      operationId: latestOutbox.operationId
    });
    expect((await getSyncRequest(first.requestId))?.status).toBe("acknowledged");

    const next = await prepareSyncRequests("user-a", 10);
    expect(next.requests).toHaveLength(1);
    expect(next.requests[0]).toMatchObject({
      baseRevision: 1,
      payloadSnapshot: { content: "Updated after send" }
    });
  });

  it("preserves a tombstone when a note is deleted during an in-flight create", async () => {
    const { note, entityKey } = await createQueuedNote("delete-flight-note", "Delete me");
    const batch = await prepareSyncRequests("user-a", 10);
    const create = batch.requests[0];
    await markSyncRequestInFlight(create.requestId, "user-a");

    await deleteLearningNote(note.id);
    const [tombstone] = await listSyncOutbox("user-a");
    expect(tombstone).toMatchObject({ entityKey, operation: "delete", baseRevision: 0 });

    await acknowledgeSyncRequest(create.requestId, "user-a", 1);
    const [rebasedTombstone] = await listSyncOutbox("user-a");
    expect(rebasedTombstone).toMatchObject({ entityKey, operation: "delete", baseRevision: 1 });

    const deleteBatch = await prepareSyncRequests("user-a", 10);
    expect(deleteBatch.requests).toHaveLength(1);
    expect(deleteBatch.requests[0]).toMatchObject({
      entityKey,
      operation: "delete",
      baseRevision: 1,
      payloadSnapshot: null
    });
  });

  it("retries an uncertain request with the same ID and exact payload snapshot", async () => {
    await createQueuedNote("retry-note", "Retry this exact content");
    const prepared = await prepareSyncRequests("user-a", 10);
    const first = prepared.requests[0];

    await markSyncRequestInFlight(first.requestId, "user-a");
    await markSyncRequestFailed(first.requestId, "user-a", "network_timeout");

    const [retryable] = await listSyncRequests("user-a", ["retryable"]);
    expect(retryable).toMatchObject({
      requestId: first.requestId,
      status: "retryable",
      attemptCount: 1,
      payloadSnapshot: first.payloadSnapshot,
      lastErrorCode: "network_timeout"
    });

    const retried = await markSyncRequestInFlight(first.requestId, "user-a");
    expect(retried).toMatchObject({
      requestId: first.requestId,
      status: "in_flight",
      attemptCount: 2,
      payloadSnapshot: first.payloadSnapshot
    });
    await acknowledgeSyncRequest(first.requestId, "user-a", 1);
    expect((await getSyncRequest(first.requestId))?.status).toBe("acknowledged");
  });

  it("supersedes a prepared but unsent snapshot when the learner edits the record", async () => {
    const { note } = await createQueuedNote("prepared-edit-note", "Before send");
    const prepared = await prepareSyncRequests("user-a", 10);
    const first = prepared.requests[0];

    await saveLearningNote({ ...note, content: "Changed before send", updatedAt: 3 });
    expect((await getSyncRequest(first.requestId))?.status).toBe("superseded");
    await expect(markSyncRequestInFlight(first.requestId, "user-a")).rejects.toThrow();
    expect((await getSyncRequest(first.requestId))?.payloadSnapshot).toMatchObject({ content: "Before send" });

    const latest = await prepareSyncRequests("user-a", 10);
    expect(latest.requests).toHaveLength(1);
    expect(latest.requests[0].requestId).not.toBe(first.requestId);
    expect(latest.requests[0].payloadSnapshot).toMatchObject({ content: "Changed before send" });
    expect((await listSyncRequests("user-a", ["superseded"]))).toHaveLength(1);
  });

  it("keeps later operations blocked while an earlier request has an uncertain outcome", async () => {
    const { note } = await createQueuedNote("ordered-note", "First version");
    const firstBatch = await prepareSyncRequests("user-a", 10);
    const first = firstBatch.requests[0];

    await markSyncRequestInFlight(first.requestId, "user-a");
    await markSyncRequestFailed(first.requestId, "user-a", "connection_lost");
    await saveLearningNote({ ...note, content: "Second version", updatedAt: 3 });

    const blocked = await prepareSyncRequests("user-a", 10);
    expect(blocked.requests).toEqual([]);
    expect(blocked.blocked).toMatchObject([{
      entityKey: first.entityKey,
      reason: "prior_request_pending"
    }]);

    // Resolve the uncertain first request before preparing the new state.
    await markSyncRequestInFlight(first.requestId, "user-a");
    await acknowledgeSyncRequest(first.requestId, "user-a", 1);
    const next = await prepareSyncRequests("user-a", 10);
    expect(next.requests).toHaveLength(1);
    expect(next.requests[0]).toMatchObject({
      baseRevision: 1,
      payloadSnapshot: { content: "Second version" }
    });
  });

  it("persists a server conflict and permanently blocks automatic retry", async () => {
    await createQueuedNote("conflicted-note", "Local content that must be preserved");
    const prepared = await prepareSyncRequests("user-a", 10);
    const request = prepared.requests[0];
    await markSyncRequestInFlight(request.requestId, "user-a");

    const conflict = await markSyncRequestConflicted(
      request.requestId,
      "user-a",
      3,
      "revision_conflict",
      { title: "Remote title", content: "Remote version", createdAtMs: 1, updatedAtMs: 4 }
    );
    expect(conflict).toMatchObject({
      requestId: request.requestId,
      ownerUid: "user-a",
      baseRevision: 0,
      remoteRevision: 3,
      conflictCode: "revision_conflict",
      status: "open",
      localPayloadSnapshot: { content: "Local content that must be preserved" },
      remotePayloadSnapshot: { content: "Remote version" }
    });
    expect((await getSyncRequest(request.requestId))?.status).toBe("conflicted");
    await expect(markSyncRequestInFlight(request.requestId, "user-a")).rejects.toThrow();
    await expect(acknowledgeSyncRequest(request.requestId, "user-a", 1)).rejects.toThrow();
    expect(await listSyncRequests("user-a", ["conflicted"])).toHaveLength(1);
    expect(await listSyncConflicts("user-a", ["open"])).toHaveLength(1);
    expect(await getSyncConflict(request.requestId, "user-a")).toEqual(conflict);
    expect(await getSyncConflict(request.requestId, "user-b")).toBeNull();

    const preparedAgain = await prepareSyncRequests("user-a", 10);
    expect(preparedAgain.requests).toEqual([]);
    expect(preparedAgain.blocked).toMatchObject([{
      entityKey: request.entityKey,
      reason: "request_terminal"
    }]);
    expect(await listSyncOutbox("user-a")).toHaveLength(1);
  });

  it("rejects malformed remote snapshots instead of storing untrusted conflict data", async () => {
    await createQueuedNote("bad-remote-snapshot", "Preserve local note");
    const [request] = (await prepareSyncRequests("user-a", 10)).requests;
    await markSyncRequestInFlight(request.requestId, "user-a");
    await expect(markSyncRequestConflicted(
      request.requestId,
      "user-a",
      1,
      "revision_conflict",
      { title: "Remote", content: "Remote body", createdAtMs: 1, updatedAtMs: 2, transcriptText: "not allowed" } as never
    )).rejects.toThrow();
    expect((await getSyncRequest(request.requestId))?.status).toBe("in_flight");
    expect(await listSyncConflicts("user-a")).toEqual([]);
  });

  it("replays an identical conflict response without duplicating or changing its record", async () => {
    await createQueuedNote("idempotent-conflict", "Local snapshot");
    const [request] = (await prepareSyncRequests("user-a", 10)).requests;
    await markSyncRequestInFlight(request.requestId, "user-a");
    const first = await markSyncRequestConflicted(
      request.requestId, "user-a", 2, "entity_deleted", null, true
    );
    const replay = await markSyncRequestConflicted(
      request.requestId, "user-a", 2, "entity_deleted", null, true
    );
    expect(replay).toEqual(first);
    expect(await listSyncConflicts("user-a")).toHaveLength(1);
  });

  it("blocks a newer local edit behind an unresolved conflict and isolates account ownership", async () => {
    const { note } = await createQueuedNote("conflict-edit", "Original local version");
    const [request] = (await prepareSyncRequests("user-a", 10)).requests;
    await markSyncRequestInFlight(request.requestId, "user-a");
    await markSyncRequestConflicted(request.requestId, "user-a", 1, "revision_conflict");

    await saveLearningNote({ ...note, content: "New edit after conflict", updatedAt: 10 });
    const blocked = await prepareSyncRequests("user-a", 10);
    expect(blocked.requests).toEqual([]);
    expect(blocked.blocked).toMatchObject([{
      entityKey: request.entityKey,
      reason: "prior_request_pending"
    }]);
    await expect(markSyncRequestConflicted(request.requestId, "user-b", 1, "revision_conflict")).rejects.toThrow();
    expect(await listSyncConflicts("user-b")).toEqual([]);
    expect((await listSyncConflicts("user-a"))[0].localPayloadSnapshot).toMatchObject({
      content: "Original local version"
    });
  });

  it("does not prune unresolved conflict history", async () => {
    await createQueuedNote("retained-conflict", "Keep this conflict");
    const [request] = (await prepareSyncRequests("user-a", 10)).requests;
    await markSyncRequestInFlight(request.requestId, "user-a");
    await markSyncRequestConflicted(request.requestId, "user-a", 2, "revision_conflict");
    expect(await pruneSyncRequestHistory("user-a", 0)).toBe(0);
    expect((await getSyncRequest(request.requestId))?.status).toBe("conflicted");
    expect(await listSyncConflicts("user-a")).toHaveLength(1);
  });

  it("keeps the remote note atomically and marks the request and conflict resolved", async () => {
    const { entityKey, note } = await createQueuedNote("keep-remote-note", "Local content");
    const [request] = (await prepareSyncRequests("user-a", 10)).requests;
    await markSyncRequestInFlight(request.requestId, "user-a");
    const remotePayload = {
      title: "Remote title",
      content: "Remote content",
      createdAtMs: note.createdAt,
      updatedAtMs: 900
    };
    await markSyncRequestConflicted(
      request.requestId, "user-a", 4, "revision_conflict", remotePayload
    );

    const resolved = await resolveSyncConflict(request.requestId, "user-a", "keep_remote");
    expect(resolved).toMatchObject({
      status: "resolved",
      resolution: "keep_remote",
      remoteRevision: 4
    });
    expect((await getSyncRequest(request.requestId))?.status).toBe("resolved");
    expect(await listSyncOutbox("user-a")).toEqual([]);
    expect(await getSyncMetadata(entityKey)).toMatchObject({
      ownerUid: "user-a",
      remoteRevision: 4
    });
    const notes = await listLearningNotes("journal-lesson");
    expect(notes.find((item) => item.id === note.id)).toMatchObject({
      title: "Remote title",
      content: "Remote content",
      createdAt: note.createdAt,
      updatedAt: 900
    });
    expect(await resolveSyncConflict(request.requestId, "user-a", "keep_remote")).toEqual(resolved);
  });

  it("retains a newer local edit in conflict history when the learner keeps remote", async () => {
    const { note } = await createQueuedNote("remote-with-new-local-edit", "Original in-flight body");
    const [request] = (await prepareSyncRequests("user-a", 10)).requests;
    await markSyncRequestInFlight(request.requestId, "user-a");
    await saveLearningNote({ ...note, title: "Newer local title", content: "Newer local body", updatedAt: 400 });
    await markSyncRequestConflicted(
      request.requestId,
      "user-a",
      2,
      "revision_conflict",
      { title: "Remote title", content: "Remote body", createdAtMs: note.createdAt, updatedAtMs: 300 }
    );

    const resolved = await resolveSyncConflict(request.requestId, "user-a", "keep_remote");
    expect(resolved.latestLocalPayloadSnapshot).toMatchObject({
      title: "Newer local title",
      content: "Newer local body"
    });
    expect((await listLearningNotes("journal-lesson")).find((item) => item.id === note.id)).toMatchObject({
      title: "Remote title",
      content: "Remote body"
    });
  });

  it("keeps the latest local note as a new operation based on the remote revision", async () => {
    const { note, entityKey } = await createQueuedNote("keep-local-note", "Original local content");
    const [request] = (await prepareSyncRequests("user-a", 10)).requests;
    await markSyncRequestInFlight(request.requestId, "user-a");
    await saveLearningNote({ ...note, content: "Latest local content", updatedAt: 300 });
    await markSyncRequestConflicted(
      request.requestId,
      "user-a",
      7,
      "revision_conflict",
      { title: "Remote title", content: "Remote content", createdAtMs: 1, updatedAtMs: 200 }
    );

    const resolved = await resolveSyncConflict(request.requestId, "user-a", "keep_local");
    expect(resolved).toMatchObject({ status: "resolved", resolution: "keep_local" });
    expect((await getSyncRequest(request.requestId))?.status).toBe("resolved");
    const [pending] = await listSyncOutbox("user-a");
    expect(pending).toMatchObject({
      entityKey,
      operation: "upsert",
      baseRevision: 7
    });
    expect(pending.operationId).not.toBe(request.operationId);
    expect(await getSyncMetadata(entityKey)).toMatchObject({ remoteRevision: 7 });
    const next = await prepareSyncRequests("user-a", 10);
    expect(next.requests).toHaveLength(1);
    expect(next.requests[0]).toMatchObject({
      baseRevision: 7,
      payloadSnapshot: { content: "Latest local content" }
    });
  });

  it("keeps a local deletion by rebasing its tombstone onto the active remote revision", async () => {
    const { note, entityKey } = await createQueuedNote("keep-local-delete", "Local content");
    const [request] = (await prepareSyncRequests("user-a", 10)).requests;
    await markSyncRequestInFlight(request.requestId, "user-a");
    await deleteLearningNote(note.id);
    await markSyncRequestConflicted(
      request.requestId,
      "user-a",
      6,
      "revision_conflict",
      { title: note.title, content: note.content, createdAtMs: note.createdAt, updatedAtMs: note.updatedAt }
    );

    await resolveSyncConflict(request.requestId, "user-a", "keep_local");
    const [pending] = await listSyncOutbox("user-a");
    expect(pending).toMatchObject({
      entityKey,
      operation: "delete",
      baseRevision: 6
    });
    expect(pending.operationId).not.toBe(request.operationId);
    expect(await getSyncMetadata(entityKey)).toMatchObject({ remoteRevision: 6 });
  });

  it("clears a never-created remote entity when keeping a local deletion at revision zero", async () => {
    const { note, entityKey } = await createQueuedNote("keep-local-delete-zero", "Local content");
    const [request] = (await prepareSyncRequests("user-a", 10)).requests;
    await markSyncRequestInFlight(request.requestId, "user-a");
    await deleteLearningNote(note.id);
    await markSyncRequestConflicted(
      request.requestId, "user-a", 0, "revision_conflict", null
    );

    await resolveSyncConflict(request.requestId, "user-a", "keep_local");
    expect(await getSyncMetadata(entityKey)).toBeNull();
    expect(await listSyncOutbox("user-a")).toEqual([]);
    expect((await getSyncRequest(request.requestId))?.status).toBe("resolved");
  });

  it("keeps a remote tombstone by removing the local record and its pending operation", async () => {
    const { note, entityKey } = await createQueuedNote("remote-delete-note", "Local content");
    const [request] = (await prepareSyncRequests("user-a", 10)).requests;
    await markSyncRequestInFlight(request.requestId, "user-a");
    await deleteLearningNote(note.id);
    await markSyncRequestConflicted(
      request.requestId, "user-a", 5, "entity_deleted", null, true
    );

    await resolveSyncConflict(request.requestId, "user-a", "keep_remote");
    expect(await listLearningNotes("journal-lesson")).toEqual([]);
    expect(await getSyncMetadata(entityKey)).toBeNull();
    expect(await listSyncOutbox("user-a")).toEqual([]);
    expect((await getSyncRequest(request.requestId))?.status).toBe("resolved");
  });

  it("preserves the local-only lesson transcript when accepting a remote lesson deletion", async () => {
    const session = {
      id: "lesson-with-transcript",
      videoId: "lesson-with-transcript",
      title: "Local lesson",
      url: "https://www.youtube.com/watch?v=lesson-with-transcript",
      platform: "youtube" as const,
      transcriptText: "This full transcript must remain on this device.",
      transcriptFormat: "plain-text" as const,
      transcriptSource: "visible captions",
      updatedAt: 100
    };
    await saveLearningSession(session);
    const entityKey = "lesson:lesson-with-transcript:lesson-with-transcript";
    await claimSyncEntity({
      entityKey,
      entityType: "lesson",
      lessonId: session.id,
      entityId: session.id,
      ownerUid: "user-a",
      syncCategory: "lessonMetadata"
    });
    await queueSyncOperation(entityKey, "user-a", "upsert");
    await saveLocalSyncPreferences("user-a", {
      lessonMetadata: true, notes: false, quizzes: false, attempts: false
    });
    const [request] = (await prepareSyncRequests("user-a", 10)).requests;
    await markSyncRequestInFlight(request.requestId, "user-a");
    await markSyncRequestConflicted(
      request.requestId, "user-a", 3, "entity_deleted", null, true
    );

    await resolveSyncConflict(request.requestId, "user-a", "keep_remote");
    expect(await listLearningSessions()).toMatchObject([{
      id: session.id,
      transcriptText: session.transcriptText
    }]);
    expect(await getSyncMetadata(entityKey)).toBeNull();
    expect(await listSyncOutbox("user-a")).toEqual([]);
  });

  it("does not allow a local edit to resurrect a remote tombstone", async () => {
    const { note } = await createQueuedNote("no-resurrection-note", "Local content");
    const [request] = (await prepareSyncRequests("user-a", 10)).requests;
    await markSyncRequestInFlight(request.requestId, "user-a");
    await markSyncRequestConflicted(
      request.requestId, "user-a", 5, "entity_deleted", null, true
    );
    await expect(resolveSyncConflict(request.requestId, "user-a", "keep_local")).rejects.toThrow();
    expect((await getSyncRequest(request.requestId))?.status).toBe("conflicted");
    expect((await listLearningNotes("journal-lesson"))[0]).toEqual(note);
  });

  it("keeps an immutable quiz from being overwritten under the same remote ID", async () => {
    const quiz = {
      id: "immutable-local-quiz",
      sessionId: "journal-lesson",
      title: "Local quiz",
      scope: "whole_lesson" as const,
      scopeLabel: "Whole lesson",
      createdAt: 100,
      questions: [
        { id: "q1", type: "multiple_choice" as const, prompt: "Q1", options: ["A", "B", "C"], correctAnswer: "A", explanation: "A", topic: "T", evidence: "Evidence one" },
        { id: "q2", type: "true_false" as const, prompt: "Q2", options: ["True", "False"], correctAnswer: "True", explanation: "True", topic: "T", evidence: "Evidence two" },
        { id: "q3", type: "short_answer" as const, prompt: "Q3", options: [], correctAnswer: "Three", explanation: "Three", topic: "T", evidence: "Evidence three" }
      ]
    };
    await saveQuiz(quiz);
    const entityKey = "quiz:journal-lesson:immutable-local-quiz";
    await claimSyncEntity({
      entityKey, entityType: "quiz", lessonId: "journal-lesson",
      entityId: quiz.id, ownerUid: "user-a", syncCategory: "quizzes"
    });
    await queueSyncOperation(entityKey, "user-a", "upsert");
    await saveLocalSyncPreferences("user-a", {
      lessonMetadata: false, notes: false, quizzes: true, attempts: false
    });
    const [request] = (await prepareSyncRequests("user-a", 10)).requests;
    await markSyncRequestInFlight(request.requestId, "user-a");
    await markSyncRequestConflicted(
      request.requestId,
      "user-a",
      3,
      "immutable_entity_exists",
      {
        title: "Remote quiz",
        scope: "whole_lesson",
        scopeLabel: "Whole lesson",
        createdAtMs: 100,
        questions: quiz.questions
      }
    );
    await expect(resolveSyncConflict(request.requestId, "user-a", "keep_local")).rejects.toThrow();
    expect((await getSyncRequest(request.requestId))?.status).toBe("conflicted");
  });

  it("fails closed because cloud writes remain disabled pending production Auth and App Check", async () => {
    const readiness = getSyncTransportReadiness();
    expect(readiness).toMatchObject({
      enabled: false,
      authenticatedUserRequired: true,
      verifiedEmailRequired: true,
      productionAppCheckRequired: true
    });
    await expect(dispatchSyncRequest({} as never)).rejects.toThrow(/cloud sync is disabled/i);
  });
});
