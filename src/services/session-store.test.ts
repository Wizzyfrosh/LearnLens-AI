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
  getOrCreateSyncDeviceId,
  getSyncMetadata,
  listSyncOutbox,
  queueSyncOperation
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
    expect(names).toEqual(expect.arrayContaining(["syncMetadata", "syncOutbox", "syncDevice"]));
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
    expect(version).toBe(5);
  });
});
