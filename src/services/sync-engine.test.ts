import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  acknowledgeSyncOperation,
  markSyncOperationInFlight,
  claimSyncEntity,
  deleteLearningNote,
  queueSyncOperation,
  saveLearningNote,
  saveLearningSession,
  saveLocalSyncPreferences
} from "./session-store";
import { prepareSyncBatch } from "./sync-engine";

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("learnlens-local");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Database deletion was blocked."));
  });
}

const noteCategories = {
  lessonMetadata: false,
  notes: true,
  quizzes: false,
  attempts: false
};

describe("local sync batch preparation", () => {
  beforeEach(async () => {
    await deleteDatabase();
  });

  it("prepares only selected account-owned DTOs and excludes transcript data", async () => {
    const session = {
      id: "prep-lesson", videoId: "dQw4w9WgXcQ", title: "Prepared lesson",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", platform: "youtube" as const,
      transcriptText: "PRIVATE TRANSCRIPT MUST NEVER BE INCLUDED",
      transcriptFormat: "plain-text" as const, transcriptSource: "youtube-captions", updatedAt: 10
    };
    const note = {
      id: "prep-note", sessionId: session.id, videoId: session.videoId,
      title: "Prepared note", content: "Opted-in note content", createdAt: 11, updatedAt: 12
    };
    await saveLearningSession(session);
    await saveLearningNote(note);
    await claimSyncEntity({
      entityKey: "lesson:prep-lesson:prep-lesson", entityType: "lesson",
      lessonId: "prep-lesson", entityId: "prep-lesson", ownerUid: "user-a",
      syncCategory: "lessonMetadata"
    });
    await claimSyncEntity({
      entityKey: "note:prep-lesson:prep-note", entityType: "note",
      lessonId: "prep-lesson", entityId: "prep-note", ownerUid: "user-a",
      syncCategory: "notes"
    });
    await queueSyncOperation("lesson:prep-lesson:prep-lesson", "user-a", "upsert");
    await queueSyncOperation("note:prep-lesson:prep-note", "user-a", "upsert");
    await saveLocalSyncPreferences("user-a", {
      lessonMetadata: true, notes: true, quizzes: false, attempts: false
    });

    const batch = await prepareSyncBatch("user-a", 10);
    expect(batch.schemaVersion).toBe(1);
    expect(batch.deviceId).toBeTruthy();
    expect(batch.operations).toHaveLength(2);
    expect(batch.blocked).toEqual([]);

    const lesson = batch.operations.find((operation) => operation.entityType === "lesson");
    expect(lesson?.payload).toMatchObject({ platform: "youtube", title: "Prepared lesson" });
    expect(lesson?.payload).not.toHaveProperty("transcriptText");
    expect(lesson?.payload).not.toHaveProperty("transcriptSource");
    expect(lesson?.payload).not.toHaveProperty("audio");
    const preparedNote = batch.operations.find((operation) => operation.entityType === "note");
    expect(preparedNote?.payload).toMatchObject({ title: "Prepared note", content: "Opted-in note content" });
  });

  it("prepares remote deletions as payload-free tombstones", async () => {
    await saveLearningNote({
      id: "deleted-note", sessionId: "deleted-lesson", videoId: "deleted-lesson",
      title: "Deleted note", content: "This content is removed locally.", createdAt: 1, updatedAt: 2
    });
    const entityKey = "note:deleted-lesson:deleted-note";
    await claimSyncEntity({
      entityKey, entityType: "note", lessonId: "deleted-lesson",
      entityId: "deleted-note", ownerUid: "user-a", syncCategory: "notes"
    });
    const initial = await queueSyncOperation(entityKey, "user-a", "upsert");
    await markSyncOperationInFlight(entityKey, "user-a", initial!.operationId, initial!.baseRevision);
    await acknowledgeSyncOperation(entityKey, "user-a", initial!.operationId, 1);
    await deleteLearningNote("deleted-note");
    await saveLocalSyncPreferences("user-a", noteCategories);

    const batch = await prepareSyncBatch("user-a");
    expect(batch.operations).toHaveLength(1);
    expect(batch.operations[0]).toMatchObject({
      entityKey, operation: "delete", baseRevision: 1, payload: null
    });
  });

  it("blocks missing local upserts instead of turning them into deletes", async () => {
    const entityKey = "note:missing-lesson:missing-note";
    await claimSyncEntity({
      entityKey, entityType: "note", lessonId: "missing-lesson",
      entityId: "missing-note", ownerUid: "user-a", syncCategory: "notes"
    });
    await queueSyncOperation(entityKey, "user-a", "upsert");
    await saveLocalSyncPreferences("user-a", noteCategories);

    const batch = await prepareSyncBatch("user-a");
    expect(batch.operations).toEqual([]);
    expect(batch.blocked).toEqual([{
      entityKey,
      operationId: expect.any(String),
      reason: "local_record_missing"
    }]);
  });

  it("does not expose another account's queued operations", async () => {
    await saveLearningNote({
      id: "private-note", sessionId: "private-lesson", videoId: "private-lesson",
      title: "Private note", content: "User A only", createdAt: 1, updatedAt: 2
    });
    const entityKey = "note:private-lesson:private-note";
    await claimSyncEntity({
      entityKey, entityType: "note", lessonId: "private-lesson",
      entityId: "private-note", ownerUid: "user-a", syncCategory: "notes"
    });
    await queueSyncOperation(entityKey, "user-a", "upsert");
    await saveLocalSyncPreferences("user-b", noteCategories);

    const batch = await prepareSyncBatch("user-b");
    expect(batch.operations).toEqual([]);
    expect(batch.blocked).toEqual([]);
  });
});
