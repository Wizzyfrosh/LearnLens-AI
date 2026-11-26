import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteQuiz,
  deleteLearningSession,
  deleteLearningNote,
  getLatestSessionForVideo,
  listLearningSessions,
  listQuizzes,
  listQuizAttempts,
  listLearningNotes,
  saveLearningNote,
  saveLearningSession,
  saveQuiz,
  saveQuizAttempt,
  searchLearningNotes,
  acknowledgeSyncOperation,
  claimSyncEntity,
  claimSelectedLocalSyncRecords,
  getLocalSyncClaimCandidates,
  getOrCreateSyncDeviceId,
  getSyncMetadata,
  getLocalSyncOperationSnapshots,
  listSyncOutbox,
  queueSyncOperation,
  getLocalSyncCandidateCounts,
  getLocalSyncPreferences,
  saveLocalSyncPreferences
} from "./session-store";

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("learnlens-local");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Database deletion was blocked."));
  });
}

describe("local learning artifact storage", () => {
  beforeEach(async () => {
    await deleteDatabase();
  });

  it("adds the bounded outbox index during v7 migration without losing queued records", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("learnlens-local", 7);
      request.onupgradeneeded = () => {
        const database = request.result;
        const notes = database.createObjectStore("learningNotes", { keyPath: "id" });
        notes.createIndex("sessionId", "sessionId");
        notes.createIndex("videoId", "videoId");
        notes.createIndex("updatedAt", "updatedAt");
        const metadata = database.createObjectStore("syncMetadata", { keyPath: "entityKey" });
        metadata.createIndex("ownerUid", "ownerUid");
        metadata.createIndex("lessonId", "lessonId");
        const outbox = database.createObjectStore("syncOutbox", { keyPath: "entityKey" });
        outbox.createIndex("ownerUid", "ownerUid");
        outbox.createIndex("queuedAtMs", "queuedAtMs");
      };
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(
          ["learningNotes", "syncMetadata", "syncOutbox"],
          "readwrite"
        );
        transaction.objectStore("learningNotes").put({
          id: "migration-note", sessionId: "migration-lesson", videoId: "migration-lesson",
          title: "Preserved note", content: "Keep queued content local.", createdAt: 1, updatedAt: 2
        });
        transaction.objectStore("syncMetadata").put({
          entityKey: "note:migration-lesson:migration-note",
          entityType: "note", lessonId: "migration-lesson", entityId: "migration-note",
          ownerUid: "user-a", remoteRevision: 0, lastSyncedAtMs: null, syncCategory: "notes"
        });
        transaction.objectStore("syncOutbox").put({
          entityKey: "note:migration-lesson:migration-note",
          operationId: "legacy-queued-operation", ownerUid: "user-a", entityType: "note",
          lessonId: "migration-lesson", entityId: "migration-note", operation: "upsert",
          baseRevision: 0, payloadSchemaVersion: 1, queuedAtMs: 100, retryCount: 0
        });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });

    const [snapshot] = await getLocalSyncOperationSnapshots("user-a", {
      lessonMetadata: false, notes: true, quizzes: false, attempts: false
    }, 10);
    expect(snapshot).toMatchObject({
      outbox: { operationId: "legacy-queued-operation", baseRevision: 0 },
      payload: { title: "Preserved note", content: "Keep queued content local." },
      blockedReason: null
    });

    const schema = await new Promise<{ version: number; indexes: string[] }>((resolve, reject) => {
      const request = indexedDB.open("learnlens-local");
      request.onsuccess = () => {
        const database = request.result;
        resolve({
          version: database.version,
          indexes: Array.from(database.transaction("syncOutbox").objectStore("syncOutbox").indexNames)
        });
        database.close();
      };
      request.onerror = () => reject(request.error);
    });
    expect(schema.version).toBe(8);
    expect(schema.indexes).toContain("ownerUidEntityTypeQueuedAtMs");
  });

  it("upgrades version 5 without changing existing learning records and creates empty sync stores", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("learnlens-local", 5);
      request.onupgradeneeded = () => {
        const db = request.result;
        const sessions = db.createObjectStore("learningSessions", { keyPath: "id" });
        sessions.createIndex("videoId", "videoId");
        sessions.createIndex("updatedAt", "updatedAt");
        sessions.createIndex("platform", "platform");
        const notes = db.createObjectStore("learningNotes", { keyPath: "id" });
        notes.createIndex("sessionId", "sessionId");
        notes.createIndex("videoId", "videoId");
        notes.createIndex("updatedAt", "updatedAt");
        const quizzes = db.createObjectStore("learningQuizzes", { keyPath: "id" });
        quizzes.createIndex("sessionId", "sessionId");
        quizzes.createIndex("createdAt", "createdAt");
        const attempts = db.createObjectStore("quizAttempts", { keyPath: "id" });
        attempts.createIndex("sessionId", "sessionId");
        attempts.createIndex("quizId", "quizId");
        attempts.createIndex("createdAt", "createdAt");
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(["learningSessions", "learningNotes"], "readwrite");
        tx.objectStore("learningSessions").put({
          id: "legacy-v5", videoId: "legacy-v5", title: "Preserved lesson",
          url: "https://www.youtube.com/watch?v=legacy-v5", platform: "youtube",
          transcriptText: "Private transcript stays local", transcriptFormat: "plain-text",
          transcriptSource: "captions", updatedAt: 100
        });
        tx.objectStore("learningNotes").put({
          id: "legacy-note", sessionId: "legacy-v5", videoId: "legacy-v5",
          title: "Preserved note", content: "Keep local", createdAt: 1, updatedAt: 2
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
    expect(await getLatestSessionForVideo("legacy-v5")).toMatchObject({ title: "Preserved lesson", transcriptText: "Private transcript stays local" });
    expect(await listLearningNotes("legacy-v5")).toMatchObject([{ id: "legacy-note", content: "Keep local" }]);
    const names = await new Promise<string[]>((resolve, reject) => {
      const request = indexedDB.open("learnlens-local");
      request.onsuccess = () => { const db = request.result; const result = Array.from(db.objectStoreNames); db.close(); resolve(result); };
      request.onerror = () => reject(request.error);
    });
    expect(names).toEqual(expect.arrayContaining(["syncMetadata", "syncOutbox", "syncDevice", "syncPreferences", "syncRequests"]));
    expect(await listSyncOutbox("user-a")).toEqual([]);
  });

  it("binds claimed records to one account and coalesces their pending operations", async () => {
    const claim = {
      entityKey: "note:lesson-1:note-1", entityType: "note" as const,
      lessonId: "lesson-1", entityId: "note-1", ownerUid: "user-a",
      syncCategory: "notes" as const
    };
    await claimSyncEntity(claim);
    const first = await queueSyncOperation(claim.entityKey, "user-a", "upsert");
    const second = await queueSyncOperation(claim.entityKey, "user-a", "upsert");
    expect(first?.operationId).toBe(second?.operationId);
    expect(await listSyncOutbox("user-a")).toHaveLength(1);
    await expect(claimSyncEntity({ ...claim, ownerUid: "user-b" })).rejects.toThrow();
    await expect(queueSyncOperation(claim.entityKey, "user-b", "upsert")).rejects.toThrow();
    await expect(acknowledgeSyncOperation(claim.entityKey, "user-a", "wrong-operation", 1)).rejects.toThrow();
    await acknowledgeSyncOperation(claim.entityKey, "user-a", first!.operationId, 1);
    expect(await getSyncMetadata(claim.entityKey)).toMatchObject({ ownerUid: "user-a", remoteRevision: 1 });
    expect(await listSyncOutbox("user-a")).toEqual([]);
  });

  it("cancels a never-uploaded upsert when that local record is deleted", async () => {
    const claim = {
      entityKey: "note:lesson-2:note-2", entityType: "note" as const,
      lessonId: "lesson-2", entityId: "note-2", ownerUid: "user-a",
      syncCategory: "notes" as const
    };
    await claimSyncEntity(claim);
    await queueSyncOperation(claim.entityKey, "user-a", "upsert");
    expect(await queueSyncOperation(claim.entityKey, "user-a", "delete")).toBeNull();
    expect(await listSyncOutbox("user-a")).toEqual([]);
  });

  it("rejects acknowledgements for a superseded queued operation", async () => {
    const note = {
      id: "stale-ack-note", sessionId: "stale-ack-lesson", videoId: "stale-ack-lesson",
      title: "Original note", content: "Original body", createdAt: 1, updatedAt: 2
    };
    await saveLearningNote(note);
    const claim = {
      entityKey: "note:stale-ack-lesson:stale-ack-note", entityType: "note" as const,
      lessonId: "stale-ack-lesson", entityId: "stale-ack-note", ownerUid: "user-a",
      syncCategory: "notes" as const
    };
    await claimSyncEntity(claim);
    const original = await queueSyncOperation(claim.entityKey, "user-a", "upsert");
    expect(original).not.toBeNull();

    await saveLearningNote({ ...note, content: "Newer body", updatedAt: 3 });
    const [latest] = await listSyncOutbox("user-a");
    expect(latest.operationId).not.toBe(original!.operationId);
    await expect(acknowledgeSyncOperation(claim.entityKey, "user-a", original!.operationId, 1)).rejects.toThrow();
    expect(await getSyncMetadata(claim.entityKey)).toMatchObject({ ownerUid: "user-a", remoteRevision: 0 });
    expect(await listSyncOutbox("user-a")).toMatchObject([{
      operationId: latest.operationId, baseRevision: 0, operation: "upsert"
    }]);

    await acknowledgeSyncOperation(claim.entityKey, "user-a", latest.operationId, 1);
    expect(await getSyncMetadata(claim.entityKey)).toMatchObject({ ownerUid: "user-a", remoteRevision: 1 });
  });

  it("queues claimed note saves atomically but leaves unclaimed local notes alone", async () => {
    const note = {
      id: "sync-note", sessionId: "sync-lesson", videoId: "sync-lesson",
      title: "Local first", content: "Only the opted-in copy is queued.",
      createdAt: 1, updatedAt: 2
    };
    await saveLearningNote(note);
    expect(await listSyncOutbox("user-a")).toEqual([]);
    await claimSyncEntity({
      entityKey: "note:sync-lesson:sync-note", entityType: "note",
      lessonId: "sync-lesson", entityId: "sync-note", ownerUid: "user-a",
      syncCategory: "notes"
    });
    await saveLearningNote({ ...note, content: "Updated content", updatedAt: 3 });
    const queued = await listSyncOutbox("user-a");
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      entityKey: "note:sync-lesson:sync-note", operation: "upsert",
      ownerUid: "user-a", baseRevision: 0
    });
    expect(queued[0]).not.toHaveProperty("content");
  });

  it("does not enqueue transcript-only lesson autosaves but queues metadata changes", async () => {
    const session = {
      id: "sync-video-123", videoId: "sync-video-123", title: "Lesson title",
      url: "https://www.youtube.com/watch?v=sync-video-123", platform: "youtube" as const,
      transcriptText: "First transcript", transcriptFormat: "plain-text" as const,
      transcriptSource: "captions", updatedAt: 1
    };
    await saveLearningSession(session);
    await claimSyncEntity({
      entityKey: "lesson:sync-video-123:sync-video-123", entityType: "lesson",
      lessonId: "sync-video-123", entityId: "sync-video-123", ownerUid: "user-a",
      syncCategory: "lessonMetadata"
    });
    await saveLearningSession({ ...session, transcriptText: "Transcript expanded", updatedAt: 2 });
    expect(await listSyncOutbox("user-a")).toEqual([]);
    await saveLearningSession({ ...session, title: "Corrected lesson title", transcriptText: "Transcript expanded", updatedAt: 3 });
    expect(await listSyncOutbox("user-a")).toMatchObject([{ operation: "upsert", entityKey: "lesson:sync-video-123:sync-video-123" }]);
  });

  it("queues tombstones for claimed artifacts during lesson cascade deletion", async () => {
    const sessionId = "cascade-lesson";
    await saveLearningSession({
      id: sessionId, videoId: sessionId, title: "Cascade lesson",
      url: "https://www.youtube.com/watch?v=cascade-lesson", platform: "youtube",
      transcriptText: "Private transcript", transcriptFormat: "plain-text",
      transcriptSource: "captions", updatedAt: 1
    });
    const note = { id: "cascade-note", sessionId, videoId: sessionId, title: "Note", content: "Note body", createdAt: 1, updatedAt: 1 };
    const quiz = { id: "cascade-quiz", sessionId, title: "Quiz", scope: "whole_lesson" as const, scopeLabel: "Whole lesson", createdAt: 1, questions: [] };
    const attempt = { id: "cascade-attempt", quizId: quiz.id, sessionId, createdAt: 1, results: [], objectiveScore: 0, objectiveTotal: 0, topicsToReview: [] };
    await saveLearningNote(note);
    await saveQuiz(quiz);
    await saveQuizAttempt(attempt);
    const claims = [
      { entityKey: `lesson:${sessionId}:${sessionId}`, entityType: "lesson" as const, lessonId: sessionId, entityId: sessionId, syncCategory: "lessonMetadata" as const },
      { entityKey: `note:${sessionId}:${note.id}`, entityType: "note" as const, lessonId: sessionId, entityId: note.id, syncCategory: "notes" as const },
      { entityKey: `quiz:${sessionId}:${quiz.id}`, entityType: "quiz" as const, lessonId: sessionId, entityId: quiz.id, syncCategory: "quizzes" as const },
      { entityKey: `attempt:${sessionId}:${attempt.id}`, entityType: "attempt" as const, lessonId: sessionId, entityId: attempt.id, syncCategory: "attempts" as const }
    ];
    for (const claim of claims) await claimSyncEntity({ ...claim, ownerUid: "user-a" });
    for (const claim of claims) await acknowledgeSyncOperation(
      claim.entityKey, "user-a",
      (await queueSyncOperation(claim.entityKey, "user-a", "upsert"))!.operationId, 1
    );
    await deleteLearningSession(sessionId);
    const queued = await listSyncOutbox("user-a");
    expect(queued).toHaveLength(4);
    expect(queued.every((entry) => entry.operation === "delete" && entry.baseRevision === 1)).toBe(true);
    expect(await listLearningNotes(sessionId)).toEqual([]);
    expect(await listQuizzes(sessionId)).toEqual([]);
    expect(await listQuizAttempts(sessionId)).toEqual([]);
  });

  it("rejects sync metadata with a mismatched entity key or category", async () => {
    await expect(claimSyncEntity({
      entityKey: "note:lesson-1:other-note", entityType: "note",
      lessonId: "lesson-1", entityId: "note-1", ownerUid: "user-a",
      syncCategory: "notes"
    })).rejects.toThrow(/entity key/i);
    await expect(claimSyncEntity({
      entityKey: "note:lesson-1:note-1", entityType: "note",
      lessonId: "lesson-1", entityId: "note-1", ownerUid: "user-a",
      syncCategory: "quizzes"
    })).rejects.toThrow(/category/i);
  });

  it("stores category choices locally per account without enabling uploads", async () => {
    const defaults = await getLocalSyncPreferences("user-a");
    expect(defaults.categories).toEqual({
      lessonMetadata: false, notes: false, quizzes: false, attempts: false
    });
    await saveLocalSyncPreferences("user-a", {
      lessonMetadata: false, notes: true, quizzes: true, attempts: false
    });
    await saveLocalSyncPreferences("user-b", {
      lessonMetadata: true, notes: false, quizzes: false, attempts: true
    });
    expect(await getLocalSyncPreferences("user-a")).toMatchObject({
      categories: { lessonMetadata: false, notes: true, quizzes: true, attempts: false }
    });
    expect(await getLocalSyncPreferences("user-b")).toMatchObject({
      categories: { lessonMetadata: true, notes: false, quizzes: false, attempts: true }
    });
  });

  it("previews counts by category and account ownership without returning lesson content", async () => {
    await saveLearningSession({
      id: "preview-lesson", videoId: "preview-lesson", title: "Preview lesson",
      url: "https://www.youtube.com/watch?v=preview-lesson", platform: "youtube",
      transcriptText: "Private transcript must not be returned", transcriptFormat: "plain-text",
      transcriptSource: "captions", updatedAt: 1
    });
    await saveLearningNote({
      id: "preview-note", sessionId: "preview-lesson", videoId: "preview-lesson",
      title: "Preview note", content: "Private note body", createdAt: 1, updatedAt: 1
    });
    await saveQuiz({
      id: "preview-quiz", sessionId: "preview-lesson", title: "Preview quiz",
      scope: "whole_lesson", scopeLabel: "Whole lesson", createdAt: 1, questions: []
    });
    await saveQuizAttempt({
      id: "preview-attempt", quizId: "preview-quiz", sessionId: "preview-lesson",
      createdAt: 1, results: [], objectiveScore: 0, objectiveTotal: 0, topicsToReview: []
    });
    await claimSyncEntity({
      entityKey: "note:preview-lesson:preview-note", entityType: "note",
      lessonId: "preview-lesson", entityId: "preview-note", ownerUid: "user-a",
      syncCategory: "notes"
    });
    await claimSyncEntity({
      entityKey: "attempt:preview-lesson:preview-attempt", entityType: "attempt",
      lessonId: "preview-lesson", entityId: "preview-attempt", ownerUid: "user-b",
      syncCategory: "attempts"
    });
    const counts = await getLocalSyncCandidateCounts("user-a");
    expect(counts.lessonMetadata).toMatchObject({ total: 1, unclaimed: 1 });
    expect(counts.notes).toMatchObject({ total: 1, ownedByCurrentAccount: 1 });
    expect(counts.quizzes).toMatchObject({ total: 1, unclaimed: 1 });
    expect(counts.attempts).toMatchObject({ total: 1, ownedByOtherAccount: 1 });
    expect(JSON.stringify(counts)).not.toContain("Private transcript");
    expect(JSON.stringify(counts)).not.toContain("Private note body");
  });

  it("creates one stable installation-scoped device ID", async () => {
    const first = await getOrCreateSyncDeviceId();
    const second = await getOrCreateSyncDeviceId();
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("creates the current schema and persists notes by session", async () => {
    await saveLearningSession({
      id: "video-1", videoId: "video-1", title: "Biology lesson",
      url: "https://www.youtube.com/watch?v=video-1", platform: "youtube",
      transcriptText: "Mitochondria produce ATP.", transcriptFormat: "plain-text",
      transcriptSource: "YouTube live captions", updatedAt: 10
    });
    await saveLearningNote({
      id: "note-1", sessionId: "video-1", videoId: "video-1",
      title: "ATP production", content: "Mitochondria generate ATP through cellular respiration.",
      createdAt: 11, updatedAt: 12
    });
    expect(await getLatestSessionForVideo("video-1")).toMatchObject({ title: "Biology lesson" });
    expect(await listLearningNotes("video-1")).toMatchObject([{ id: "note-1", content: "Mitochondria generate ATP through cellular respiration." }]);
  });


  it("restores the most recently saved lesson even when it is a YouTube session", async () => {
    await saveLearningSession({
      id: "older-manual", videoId: "", title: "Imported lesson",
      url: "", platform: "manual", transcriptText: "Older transcript",
      transcriptFormat: "plain-text", transcriptSource: "Pasted transcript", updatedAt: 10
    });
    await saveLearningSession({
      id: "newer-youtube", videoId: "youtube-lesson", title: "Latest YouTube lesson",
      url: "https://www.youtube.com/watch?v=youtube-lesson", platform: "youtube",
      transcriptText: "Latest transcript", transcriptFormat: "plain-text",
      transcriptSource: "YouTube live captions", updatedAt: 20
    });
    const { getLatestSavedSession } = await import("./session-store");
    expect(await getLatestSavedSession()).toMatchObject({ id: "newer-youtube", title: "Latest YouTube lesson" });
  });

  it("lists saved sessions newest first", async () => {
    const base = {
      videoId: "history-video", title: "History lesson",
      url: "https://www.youtube.com/watch?v=history-video", platform: "youtube" as const,
      transcriptText: "Lesson content", transcriptFormat: "plain-text" as const,
      transcriptSource: "YouTube live captions"
    };
    await saveLearningSession({ ...base, id: "older", updatedAt: 10 });
    await saveLearningSession({ ...base, id: "newer", updatedAt: 20, title: "Newer lesson" });
    expect((await listLearningSessions()).map((session) => session.id)).toEqual(["newer", "older"]);
  });

  it("searches notes case-insensitively and supports updates and deletion", async () => {
    const note = {
      id: "note-2", sessionId: "video-2", videoId: "video-2",
      title: "Photosynthesis", content: "Chlorophyll absorbs light energy.",
      timestampSeconds: null, createdAt: 1, updatedAt: 1
    };
    await saveLearningNote(note);
    await saveLearningNote({ ...note, content: "Chlorophyll absorbs sunlight.", updatedAt: 2 });
    expect(await searchLearningNotes("video-2", "CHLOROPHYLL")).toHaveLength(1);
    expect((await listLearningNotes("video-2"))[0].content).toBe("Chlorophyll absorbs sunlight.");
    await deleteLearningNote("note-2");
    expect(await listLearningNotes("video-2")).toEqual([]);
  });

  it("removes a session and its associated notes atomically", async () => {
    await saveLearningSession({
      id: "remove-me", videoId: "remove-me", title: "Temporary lesson",
      url: "https://www.youtube.com/watch?v=remove-me", platform: "youtube",
      transcriptText: "Temporary", transcriptFormat: "plain-text",
      transcriptSource: "YouTube live captions", updatedAt: 1
    });
    await saveLearningNote({
      id: "remove-note", sessionId: "remove-me", videoId: "remove-me",
      title: "Temporary note", content: "Delete with parent session.",
      createdAt: 1, updatedAt: 1
    });
    await deleteLearningSession("remove-me");
    expect(await getLatestSessionForVideo("remove-me")).toBeNull();
    expect(await listLearningNotes("remove-me")).toEqual([]);
  });

  it("persists quizzes and attempts by lesson and deletes them with the session", async () => {
    await saveLearningSession({ id: "quiz-lesson", videoId: "quiz-lesson", title: "Quiz lesson", url: "https://www.youtube.com/watch?v=quiz-lesson", platform: "youtube", transcriptText: "Lesson", transcriptFormat: "plain-text", transcriptSource: "YouTube live captions", updatedAt: 1 });
    const quiz = { id: "quiz-1", sessionId: "quiz-lesson", title: "Lesson quiz", scope: "whole_lesson" as const, scopeLabel: "Whole lesson", createdAt: 10, questions: [] };
    const attempt = { id: "attempt-1", quizId: "quiz-1", sessionId: "quiz-lesson", createdAt: 20, results: [], objectiveScore: 1, objectiveTotal: 2, topicsToReview: ["Photosynthesis"] };
    await saveQuiz(quiz);
    await saveQuizAttempt(attempt);
    expect(await listQuizzes("quiz-lesson")).toMatchObject([{ id: "quiz-1" }]);
    expect(await listQuizAttempts("quiz-lesson")).toMatchObject([{ id: "attempt-1", topicsToReview: ["Photosynthesis"] }]);
    await deleteQuiz("quiz-1");
    expect(await listQuizzes("quiz-lesson")).toEqual([]);
    expect(await listQuizAttempts("quiz-lesson")).toEqual([]);
    await saveQuiz(quiz);
    await deleteLearningSession("quiz-lesson");
    expect(await listQuizzes("quiz-lesson")).toEqual([]);
    expect(await listQuizAttempts("quiz-lesson")).toEqual([]);
  });

  it("upgrades a version-3 database, preserves notes, and retires timestamp bookmarks", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("learnlens-local", 3);
      request.onupgradeneeded = () => {
        const database = request.result;
        const sessions = database.createObjectStore("learningSessions", { keyPath: "id" });
        sessions.createIndex("videoId", "videoId", { unique: false });
        sessions.createIndex("updatedAt", "updatedAt", { unique: false });
        sessions.createIndex("platform", "platform", { unique: false });
        const notes = database.createObjectStore("learningNotes", { keyPath: "id" });
        notes.createIndex("sessionId", "sessionId", { unique: false });
        notes.createIndex("videoId", "videoId", { unique: false });
        notes.createIndex("updatedAt", "updatedAt", { unique: false });
        const bookmarks = database.createObjectStore("learningBookmarks", { keyPath: "id" });
        bookmarks.createIndex("sessionId", "sessionId", { unique: false });
        bookmarks.createIndex("videoId", "videoId", { unique: false });
        bookmarks.createIndex("timestampSeconds", "timestampSeconds", { unique: false });
      };
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(["learningSessions", "learningNotes", "learningBookmarks"], "readwrite");
        transaction.objectStore("learningSessions").put({
          id: "v3-lesson", videoId: "v3-lesson", title: "Existing lesson",
          url: "https://www.youtube.com/watch?v=v3-lesson", platform: "youtube",
          transcriptText: "Existing transcript", transcriptFormat: "plain-text",
          transcriptSource: "YouTube live captions", updatedAt: 10
        });
        transaction.objectStore("learningNotes").put({
          id: "v3-note", sessionId: "v3-lesson", videoId: "v3-lesson",
          title: "Existing note", content: "Keep this note", timestampSeconds: 12,
          createdAt: 10, updatedAt: 10
        });
        transaction.objectStore("learningBookmarks").put({
          id: "v3-bookmark", sessionId: "v3-lesson", videoId: "v3-lesson",
          label: "Keep this bookmark", timestampSeconds: 12, createdAt: 10
        });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });

    expect(await getLatestSessionForVideo("v3-lesson")).toMatchObject({ title: "Existing lesson" });
    expect(await listLearningNotes("v3-lesson")).toMatchObject([{ id: "v3-note", content: "Keep this note" }]);
    expect((await listLearningNotes("v3-lesson"))[0]).not.toHaveProperty("timestampSeconds");
    const upgraded = await new Promise<DOMStringList>((resolve, reject) => {
      const request = indexedDB.open("learnlens-local");
      request.onsuccess = () => { const database = request.result; const names = database.objectStoreNames; database.close(); resolve(names); };
      request.onerror = () => reject(request.error);
    });
    expect(Array.from(upgraded)).not.toContain("learningBookmarks");
    expect(await listQuizzes("v3-lesson")).toEqual([]);
    expect(await listQuizAttempts("v3-lesson")).toEqual([]);
  });

  it("migrates real version-4 data without losing notes or quiz history", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("learnlens-local", 4);
      request.onupgradeneeded = () => {
        const database = request.result;
        const sessions = database.createObjectStore("learningSessions", { keyPath: "id" });
        sessions.createIndex("videoId", "videoId", { unique: false });
        sessions.createIndex("updatedAt", "updatedAt", { unique: false });
        sessions.createIndex("platform", "platform", { unique: false });
        const notes = database.createObjectStore("learningNotes", { keyPath: "id" });
        notes.createIndex("sessionId", "sessionId", { unique: false });
        notes.createIndex("videoId", "videoId", { unique: false });
        notes.createIndex("updatedAt", "updatedAt", { unique: false });
        const bookmarks = database.createObjectStore("learningBookmarks", { keyPath: "id" });
        bookmarks.createIndex("sessionId", "sessionId", { unique: false });
        bookmarks.createIndex("videoId", "videoId", { unique: false });
        bookmarks.createIndex("timestampSeconds", "timestampSeconds", { unique: false });
        const quizzes = database.createObjectStore("learningQuizzes", { keyPath: "id" });
        quizzes.createIndex("sessionId", "sessionId", { unique: false });
        quizzes.createIndex("createdAt", "createdAt", { unique: false });
        const attempts = database.createObjectStore("quizAttempts", { keyPath: "id" });
        attempts.createIndex("sessionId", "sessionId", { unique: false });
        attempts.createIndex("quizId", "quizId", { unique: false });
        attempts.createIndex("createdAt", "createdAt", { unique: false });
      };
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(
          ["learningSessions", "learningNotes", "learningBookmarks", "learningQuizzes", "quizAttempts"],
          "readwrite"
        );
        transaction.objectStore("learningSessions").put({
          id: "v4-lesson", videoId: "v4-lesson", title: "Existing v4 lesson",
          url: "https://www.youtube.com/watch?v=v4-lesson", platform: "youtube",
          transcriptText: "Existing transcript", transcriptFormat: "plain-text",
          transcriptSource: "YouTube live captions", updatedAt: 30
        });
        transaction.objectStore("learningNotes").put({
          id: "v4-note", sessionId: "v4-lesson", videoId: "v4-lesson",
          title: "Existing v4 note", content: "Keep this note after upgrade.",
          timestampSeconds: 42, createdAt: 20, updatedAt: 25
        });
        transaction.objectStore("learningBookmarks").put({
          id: "v4-bookmark", sessionId: "v4-lesson", videoId: "v4-lesson",
          label: "Retired bookmark", timestampSeconds: 42, createdAt: 20
        });
        transaction.objectStore("learningQuizzes").put({
          id: "v4-quiz", sessionId: "v4-lesson", title: "Existing quiz",
          scope: "whole_lesson", scopeLabel: "Whole lesson", createdAt: 21, questions: []
        });
        transaction.objectStore("quizAttempts").put({
          id: "v4-attempt", quizId: "v4-quiz", sessionId: "v4-lesson",
          createdAt: 22, results: [], objectiveScore: 2, objectiveTotal: 3,
          topicsToReview: ["Photosynthesis"]
        });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });

    expect(await getLatestSessionForVideo("v4-lesson")).toMatchObject({ title: "Existing v4 lesson" });
    expect(await listLearningNotes("v4-lesson")).toMatchObject([{ id: "v4-note", content: "Keep this note after upgrade." }]);
    expect((await listLearningNotes("v4-lesson"))[0]).not.toHaveProperty("timestampSeconds");
    expect(await listQuizzes("v4-lesson")).toMatchObject([{ id: "v4-quiz", title: "Existing quiz" }]);
    expect(await listQuizAttempts("v4-lesson")).toMatchObject([{ id: "v4-attempt", objectiveScore: 2 }]);
    const storeNames = await new Promise<string[]>((resolve, reject) => {
      const request = indexedDB.open("learnlens-local");
      request.onsuccess = () => {
        const database = request.result;
        const names = Array.from(database.objectStoreNames);
        database.close();
        resolve(names);
      };
      request.onerror = () => reject(request.error);
    });
    expect(storeNames).not.toContain("learningBookmarks");
  });

  it("upgrades an existing version-2 database without losing sessions", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("learnlens-local", 2);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("learningSessions", { keyPath: "id" });
        store.createIndex("videoId", "videoId", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
        store.createIndex("platform", "platform", { unique: false });
      };
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("learningSessions", "readwrite");
        transaction.objectStore("learningSessions").put({
          id: "legacy-video", videoId: "legacy-video", title: "Existing lesson",
          url: "https://www.youtube.com/watch?v=legacy-video", platform: "youtube",
          transcriptText: "Legacy transcript", transcriptFormat: "plain-text",
          transcriptSource: "YouTube live captions", updatedAt: 5
        });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });

    expect(await getLatestSessionForVideo("legacy-video")).toMatchObject({ title: "Existing lesson" });
    const version = await new Promise<number>((resolve, reject) => {
      const request = indexedDB.open("learnlens-local");
      request.onsuccess = () => { resolve(request.result.version); request.result.close(); };
      request.onerror = () => reject(request.error);
    });
    expect(version).toBe(9);
  });

  it("requires explicit category selection, claims eligible records atomically, and isolates other accounts", async () => {
    await saveLearningNote({
      id: "claim-note-a", sessionId: "claim-lesson-a", videoId: "claim-lesson-a",
      title: "Eligible note", content: "This content is validated but never copied into the outbox.",
      createdAt: 10, updatedAt: 11
    });
    await saveLearningNote({
      id: "claim-note-b", sessionId: "claim-lesson-b", videoId: "claim-lesson-b",
      title: "Other owner's note", content: "Keep ownership isolated.",
      createdAt: 12, updatedAt: 13
    });
    await claimSyncEntity({
      entityKey: "note:claim-lesson-b:claim-note-b", entityType: "note",
      lessonId: "claim-lesson-b", entityId: "claim-note-b", ownerUid: "user-b",
      syncCategory: "notes"
    });


    const review = await getLocalSyncClaimCandidates("user-a", {
      lessonMetadata: false, notes: true, quizzes: false, attempts: false
    });
    expect(review.map((item) => item.entityKey).sort()).toEqual([
      "note:claim-lesson-a:claim-note-a", "note:claim-lesson-b:claim-note-b"
    ].sort());
    expect(review.find((item) => item.entityKey.endsWith("claim-note-b"))?.ownership).toBe("other_account");

    const nothingSelected = await claimSelectedLocalSyncRecords("user-a", {
      lessonMetadata: false, notes: false, quizzes: false, attempts: false
    }, []);
    expect(nothingSelected.totalQueued).toBe(0);

    const result = await claimSelectedLocalSyncRecords("user-a", {
      lessonMetadata: false, notes: true, quizzes: false, attempts: false
    }, ["note:claim-lesson-a:claim-note-a", "note:claim-lesson-b:claim-note-b"]);
    expect(result.claimed.notes).toBe(1);
    expect(result.skippedOtherAccount.notes).toBe(1);
    expect(result.totalQueued).toBe(1);
    expect(await getSyncMetadata("note:claim-lesson-a:claim-note-a")).toMatchObject({ ownerUid: "user-a" });
    expect(await getSyncMetadata("note:claim-lesson-b:claim-note-b")).toMatchObject({ ownerUid: "user-b" });
    const outbox = await listSyncOutbox("user-a");
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ entityKey: "note:claim-lesson-a:claim-note-a", operation: "upsert" });
    expect(outbox[0]).not.toHaveProperty("content");
    expect(outbox[0]).not.toHaveProperty("transcriptText");

    const repeat = await claimSelectedLocalSyncRecords("user-a", {
      lessonMetadata: false, notes: true, quizzes: false, attempts: false
    }, ["note:claim-lesson-a:claim-note-a", "note:claim-lesson-b:claim-note-b"]);
    expect(repeat.claimed.notes).toBe(0);
    expect(repeat.alreadyOwned.notes).toBe(1);
    expect(repeat.skippedOtherAccount.notes).toBe(1);
    expect(repeat.totalQueued).toBe(0);
    expect(await listSyncOutbox("user-a")).toHaveLength(1);
  });

});
