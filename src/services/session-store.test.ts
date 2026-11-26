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
  searchLearningNotes
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
      timestampSeconds: null, createdAt: 1, updatedAt: 1
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
