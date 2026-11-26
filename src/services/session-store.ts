import type { TranscriptFormat } from "./transcript";
import type { QuizAttempt, QuizDefinition } from "./quiz";

export interface LearningSession {
  id: string;
  videoId: string;
  title: string;
  url: string;
  platform: "youtube" | "manual";
  transcriptText: string;
  transcriptFormat: TranscriptFormat;
  transcriptSource: string;
  updatedAt: number;
}

export interface LearningNote {
  id: string;
  sessionId: string;
  videoId: string;
  title: string;
  content: string;
  timestampSeconds: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface LearningBookmark {
  id: string;
  sessionId: string;
  videoId: string;
  label: string;
  timestampSeconds: number;
  createdAt: number;
}

const DATABASE_NAME = "learnlens-local";
const DATABASE_VERSION = 4;
const SESSION_STORE = "learningSessions";
const NOTE_STORE = "learningNotes";
const BOOKMARK_STORE = "learningBookmarks";
const QUIZ_STORE = "learningQuizzes";
const QUIZ_ATTEMPT_STORE = "quizAttempts";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Local session storage is unavailable in this browser context."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const transaction = request.transaction;
      if (!database.objectStoreNames.contains(SESSION_STORE)) {
        const store = database.createObjectStore(SESSION_STORE, { keyPath: "id" });
        store.createIndex("videoId", "videoId", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
        store.createIndex("platform", "platform", { unique: false });
      } else {
        const store = transaction?.objectStore(SESSION_STORE);
        if (store && !store.indexNames.contains("platform")) {
          store.createIndex("platform", "platform", { unique: false });
        }
      }

      if (!database.objectStoreNames.contains(NOTE_STORE)) {
        const store = database.createObjectStore(NOTE_STORE, { keyPath: "id" });
        store.createIndex("sessionId", "sessionId", { unique: false });
        store.createIndex("videoId", "videoId", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      if (!database.objectStoreNames.contains(BOOKMARK_STORE)) {
        const store = database.createObjectStore(BOOKMARK_STORE, { keyPath: "id" });
        store.createIndex("sessionId", "sessionId", { unique: false });
        store.createIndex("videoId", "videoId", { unique: false });
        store.createIndex("timestampSeconds", "timestampSeconds", { unique: false });
      }

      if (!database.objectStoreNames.contains(QUIZ_STORE)) {
        const store = database.createObjectStore(QUIZ_STORE, { keyPath: "id" });
        store.createIndex("sessionId", "sessionId", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }

      if (!database.objectStoreNames.contains(QUIZ_ATTEMPT_STORE)) {
        const store = database.createObjectStore(QUIZ_ATTEMPT_STORE, { keyPath: "id" });
        store.createIndex("sessionId", "sessionId", { unique: false });
        store.createIndex("quizId", "quizId", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open local session storage."));
    request.onblocked = () => reject(new Error("Local session storage is blocked by another open LearnLens tab. Close other LearnLens panels and retry."));
  });
}

function runTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason: Error) => void) => void
): Promise<T> {
  return openDatabase().then((database) => new Promise<T>((resolve, reject) => {
    let settled = false;
    let result: T = undefined as T;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      database.close();
      callback();
    };
    try {
      const transaction = database.transaction(storeName, mode);
      transaction.oncomplete = () => finish(() => resolve(result));
      transaction.onerror = () => finish(() => reject(transaction.error ?? new Error("Local storage transaction failed.")));
      transaction.onabort = () => finish(() => reject(transaction.error ?? new Error("Local storage transaction was cancelled.")));
      operation(
        transaction.objectStore(storeName),
        (value) => { result = value; },
        (error) => finish(() => reject(error))
      );
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error("Could not start local storage transaction.")));
    }
  }));
}

export function saveLearningSession(session: LearningSession): Promise<void> {
  return runTransaction<void>(SESSION_STORE, "readwrite", (store) => {
    store.put(session);
  });
}

export function listLearningSessions(): Promise<LearningSession[]> {
  return runTransaction<LearningSession[]>(SESSION_STORE, "readonly", (store, resolve) => {
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result as LearningSession[]).sort((a, b) => b.updatedAt - a.updatedAt));
  });
}

export function getLatestSessionForVideo(videoId: string): Promise<LearningSession | null> {
  if (!videoId) return Promise.resolve(null);
  return runTransaction<LearningSession | null>(SESSION_STORE, "readonly", (store, resolve) => {
    const request = store.index("videoId").getAll(videoId);
    request.onsuccess = () => {
      const sessions = request.result as LearningSession[];
      sessions.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(sessions[0] ?? null);
    };
  });
}

export function getLatestManualSession(): Promise<LearningSession | null> {
  return runTransaction<LearningSession | null>(SESSION_STORE, "readonly", (store, resolve) => {
    const request = store.index("platform").getAll("manual");
    request.onsuccess = () => {
      const sessions = (request.result as LearningSession[]).sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(sessions[0] ?? null);
    };
  });
}

export async function deleteLearningSession(id: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([SESSION_STORE, NOTE_STORE, BOOKMARK_STORE, QUIZ_STORE, QUIZ_ATTEMPT_STORE], "readwrite");
    transaction.objectStore(SESSION_STORE).delete(id);
    for (const storeName of [NOTE_STORE, BOOKMARK_STORE, QUIZ_STORE, QUIZ_ATTEMPT_STORE]) {
      const store = transaction.objectStore(storeName);
      const request = store.index("sessionId").getAllKeys(id);
      request.onsuccess = () => {
        for (const key of request.result) store.delete(key);
      };
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not remove the saved lesson and its learning artifacts."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Removing the saved lesson was cancelled."));
  }).finally(() => database.close());
}

export function saveLearningNote(note: LearningNote): Promise<void> {
  return runTransaction<void>(NOTE_STORE, "readwrite", (store) => {
    store.put(note);
  });
}

export function listLearningNotes(sessionId: string): Promise<LearningNote[]> {
  if (!sessionId) return Promise.resolve([]);
  return runTransaction<LearningNote[]>(NOTE_STORE, "readonly", (store, resolve) => {
    const request = store.index("sessionId").getAll(sessionId);
    request.onsuccess = () => resolve((request.result as LearningNote[]).sort((a, b) => b.updatedAt - a.updatedAt));
  });
}

export function searchLearningNotes(sessionId: string, query: string): Promise<LearningNote[]> {
  const normalized = query.trim().toLocaleLowerCase();
  return listLearningNotes(sessionId).then((notes) => normalized
    ? notes.filter((note) => `${note.title}\n${note.content}`.toLocaleLowerCase().includes(normalized))
    : notes);
}

export function deleteLearningNote(id: string): Promise<void> {
  return runTransaction<void>(NOTE_STORE, "readwrite", (store) => {
    store.delete(id);
  });
}

export function saveLearningBookmark(bookmark: LearningBookmark): Promise<void> {
  if (!Number.isFinite(bookmark.timestampSeconds) || bookmark.timestampSeconds < 0) {
    return Promise.reject(new Error("A bookmark requires a valid non-negative lesson timestamp."));
  }
  return runTransaction<void>(BOOKMARK_STORE, "readwrite", (store) => {
    store.put(bookmark);
  });
}

export function listLearningBookmarks(sessionId: string): Promise<LearningBookmark[]> {
  if (!sessionId) return Promise.resolve([]);
  return runTransaction<LearningBookmark[]>(BOOKMARK_STORE, "readonly", (store, resolve) => {
    const request = store.index("sessionId").getAll(sessionId);
    request.onsuccess = () => resolve((request.result as LearningBookmark[]).sort((a, b) => a.timestampSeconds - b.timestampSeconds));
  });
}

export function deleteLearningBookmark(id: string): Promise<void> {
  return runTransaction<void>(BOOKMARK_STORE, "readwrite", (store) => {
    store.delete(id);
  });
}

export function saveQuiz(quiz: QuizDefinition): Promise<void> {
  return runTransaction<void>(QUIZ_STORE, "readwrite", (store) => { store.put(quiz); });
}

export function listQuizzes(sessionId: string): Promise<QuizDefinition[]> {
  if (!sessionId) return Promise.resolve([]);
  return runTransaction<QuizDefinition[]>(QUIZ_STORE, "readonly", (store, resolve) => {
    const request = store.index("sessionId").getAll(sessionId);
    request.onsuccess = () => resolve((request.result as QuizDefinition[]).sort((a, b) => b.createdAt - a.createdAt));
  });
}

export async function deleteQuiz(id: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([QUIZ_STORE, QUIZ_ATTEMPT_STORE], "readwrite");
    transaction.objectStore(QUIZ_STORE).delete(id);
    const attempts = transaction.objectStore(QUIZ_ATTEMPT_STORE);
    const request = attempts.index("quizId").getAllKeys(id);
    request.onsuccess = () => { for (const key of request.result) attempts.delete(key); };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not remove the quiz and its attempts."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Quiz deletion was cancelled."));
  }).finally(() => database.close());
}

export function saveQuizAttempt(attempt: QuizAttempt): Promise<void> {
  return runTransaction<void>(QUIZ_ATTEMPT_STORE, "readwrite", (store) => { store.put(attempt); });
}

export function listQuizAttempts(sessionId: string): Promise<QuizAttempt[]> {
  if (!sessionId) return Promise.resolve([]);
  return runTransaction<QuizAttempt[]>(QUIZ_ATTEMPT_STORE, "readonly", (store, resolve) => {
    const request = store.index("sessionId").getAll(sessionId);
    request.onsuccess = () => resolve((request.result as QuizAttempt[]).sort((a, b) => b.createdAt - a.createdAt));
  });
}
