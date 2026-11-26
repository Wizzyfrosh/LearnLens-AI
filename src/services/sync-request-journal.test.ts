import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  acknowledgeSyncRequest,
  claimSyncEntity,
  deleteLearningNote,
  getSyncConflict,
  getSyncRequest,
  listSyncConflicts,
  listSyncOutbox,
  listSyncRequests,
  markSyncRequestConflicted,
  markSyncRequestFailed,
  pruneSyncRequestHistory,
  markSyncRequestInFlight,
  queueSyncOperation,
  saveLearningNote,
  saveLocalSyncPreferences
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
