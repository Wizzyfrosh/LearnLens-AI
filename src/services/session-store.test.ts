import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteLearningBookmark,
  deleteQuiz,
  deleteLearningSession,
  deleteLearningNote,
  getLatestSessionForVideo,
  listLearningBookmarks,
  listLearningSessions,
  listQuizzes,
  listQuizAttempts,
  listLearningNotes,
  saveLearningBookmark,
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

  it("creates the current schema and persists notes and bookmarks by session", async () => {
    await saveLearningSession({
      id: "video-1", videoId: "video-1", title: "Biology lesson",
      url: "https://www.youtube.com/watch?v=video-1", platform: "youtube",
      transcriptText: "Mitochondria produce ATP.", transcriptFormat: "plain-text",
      transcriptSource: "YouTube live captions", updatedAt: 10
    });
    await saveLearningNote({
      id: "note-1", sessionId: "video-1", videoId: "video-1",
      title: "ATP production", content: "Mitochondria generate ATP through cellular respiration.",
      timestampSeconds: 42, createdAt: 11, updatedAt: 12
    });
    await saveLearningBookmark({
      id: "bookmark-1", sessionId: "video-1", videoId: "video-1",
      label: "Cellular respiration explanation", timestampSeconds: 42, createdAt: 13
    });

    expect(await getLatestSessionForVideo("video-1")).toMatchObject({ title: "Biology lesson" });
    expect(await listLearningNotes("video-1")).toMatchObject([{ id: "note-1", timestampSeconds: 42 }]);
    expect(await listLearningBookmarks("video-1")).toMatchObject([{ id: "bookmark-1", timestampSeconds: 42 }]);
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

  it("deletes bookmarks and rejects invalid timestamps", async () => {
    const base = {
      id: "bookmark-2", sessionId: "video-3", videoId: "video-3",
      label: "Key moment", timestampSeconds: 0, createdAt: 1
    };
    await saveLearningBookmark(base);
    await expect(saveLearningBookmark({ ...base, id: "bad", timestampSeconds: -1 })).rejects.toThrow(/valid non-negative/i);
    await deleteLearningBookmark("bookmark-2");
    expect(await listLearningBookmarks("video-3")).toEqual([]);
  });

  it("removes a session and its associated notes and bookmarks atomically", async () => {
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
    await saveLearningBookmark({
      id: "remove-bookmark", sessionId: "remove-me", videoId: "remove-me",
      label: "Temporary bookmark", timestampSeconds: 3, createdAt: 1
    });

    await deleteLearningSession("remove-me");
    expect(await getLatestSessionForVideo("remove-me")).toBeNull();
    expect(await listLearningNotes("remove-me")).toEqual([]);
    expect(await listLearningBookmarks("remove-me")).toEqual([]);
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
    expect(version).toBe(4);
  });
});
