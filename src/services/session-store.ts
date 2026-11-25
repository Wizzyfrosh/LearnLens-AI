import type { TranscriptFormat } from "./transcript";

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

const DATABASE_NAME = "learnlens-local";
const DATABASE_VERSION = 2;
const SESSION_STORE = "learningSessions";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Local session storage is unavailable in this browser context."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SESSION_STORE)) {
        const store = database.createObjectStore(SESSION_STORE, { keyPath: "id" });
        store.createIndex("videoId", "videoId", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
        store.createIndex("platform", "platform", { unique: false });
      } else {
        const store = request.transaction?.objectStore(SESSION_STORE);
        if (store && !store.indexNames.contains("platform")) {
          store.createIndex("platform", "platform", { unique: false });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local session storage."));
    request.onblocked = () => reject(new Error("Local session storage is blocked by another open LearnLens tab."));
  });
}

export async function saveLearningSession(session: LearningSession): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(SESSION_STORE, "readwrite");
      transaction.objectStore(SESSION_STORE).put(session);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the learning session."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Saving the learning session was cancelled."));
    });
  } finally {
    database.close();
  }
}

export async function getLatestSessionForVideo(videoId: string): Promise<LearningSession | null> {
  if (!videoId) return null;
  const database = await openDatabase();
  try {
    return await new Promise<LearningSession | null>((resolve, reject) => {
      const transaction = database.transaction(SESSION_STORE, "readonly");
      const request = transaction.objectStore(SESSION_STORE).index("videoId").getAll(videoId);
      request.onsuccess = () => {
        const sessions = request.result as LearningSession[];
        sessions.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(sessions[0] ?? null);
      };
      request.onerror = () => reject(request.error ?? new Error("Could not load the saved lesson."));
    });
  } finally {
    database.close();
  }
}

export async function getLatestManualSession(): Promise<LearningSession | null> {
  const database = await openDatabase();
  try {
    return await new Promise<LearningSession | null>((resolve, reject) => {
      const transaction = database.transaction(SESSION_STORE, "readonly");
      const request = transaction.objectStore(SESSION_STORE).index("platform").getAll("manual");
      request.onsuccess = () => {
        const sessions = (request.result as LearningSession[])
          .sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(sessions[0] ?? null);
      };
      request.onerror = () => reject(request.error ?? new Error("Could not load the saved lesson."));
    });
  } finally {
    database.close();
  }
}

export async function deleteLearningSession(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(SESSION_STORE, "readwrite");
      transaction.objectStore(SESSION_STORE).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not delete the saved lesson."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Deleting the saved lesson was cancelled."));
    });
  } finally {
    database.close();
  }
}
