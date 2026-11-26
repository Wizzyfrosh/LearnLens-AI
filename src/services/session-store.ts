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
  createdAt: number;
  updatedAt: number;
}

const DATABASE_NAME = "learnlens-local";
const DATABASE_VERSION = 6;
const SESSION_STORE = "learningSessions";
const NOTE_STORE = "learningNotes";
const QUIZ_STORE = "learningQuizzes";
const QUIZ_ATTEMPT_STORE = "quizAttempts";
const SYNC_METADATA_STORE = "syncMetadata";
const SYNC_OUTBOX_STORE = "syncOutbox";
const SYNC_DEVICE_STORE = "syncDevice";

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

      // Remove the retired timestamp-bookmark store and strip legacy note timestamps.
      // Learner notes are now standalone study documents, not timestamp anchors.
      if (database.objectStoreNames.contains("learningBookmarks")) {
        database.deleteObjectStore("learningBookmarks");
      }
      const notesStore = transaction?.objectStore(NOTE_STORE);
      if (notesStore) {
        const cursorRequest = notesStore.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const note = cursor.value as Record<string, unknown>;
          if ("timestampSeconds" in note) {
            delete note.timestampSeconds;
            cursor.update(note);
          }
          cursor.continue();
        };
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

      // v6 adds empty sync infrastructure stores. Existing learning records are
      // deliberately not claimed or queued during migration.
      if (!database.objectStoreNames.contains(SYNC_METADATA_STORE)) {
        const store = database.createObjectStore(SYNC_METADATA_STORE, { keyPath: "entityKey" });
        store.createIndex("ownerUid", "ownerUid", { unique: false });
        store.createIndex("lessonId", "lessonId", { unique: false });
      }
      if (!database.objectStoreNames.contains(SYNC_OUTBOX_STORE)) {
        const store = database.createObjectStore(SYNC_OUTBOX_STORE, { keyPath: "entityKey" });
        store.createIndex("ownerUid", "ownerUid", { unique: false });
        store.createIndex("queuedAtMs", "queuedAtMs", { unique: false });
      }
      if (!database.objectStoreNames.contains(SYNC_DEVICE_STORE)) {
        database.createObjectStore(SYNC_DEVICE_STORE, { keyPath: "key" });
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

export function getLatestSavedSession(): Promise<LearningSession | null> {
  return runTransaction<LearningSession | null>(SESSION_STORE, "readonly", (store, resolve) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const sessions = (request.result as LearningSession[]).sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(sessions[0] ?? null);
    };
  });
}

export async function deleteLearningSession(id: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([SESSION_STORE, NOTE_STORE, QUIZ_STORE, QUIZ_ATTEMPT_STORE], "readwrite");
    transaction.objectStore(SESSION_STORE).delete(id);
    for (const storeName of [NOTE_STORE, QUIZ_STORE, QUIZ_ATTEMPT_STORE]) {
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


export type SyncEntityType = "lesson" | "note" | "quiz" | "attempt";
export type SyncCategory = "lessonMetadata" | "notes" | "quizzes" | "attempts";
export type SyncOperation = "upsert" | "delete";

export interface SyncMetadataRecord {
  entityKey: string;
  entityType: SyncEntityType;
  lessonId: string;
  entityId: string;
  ownerUid: string;
  remoteRevision: number;
  lastSyncedAtMs: number | null;
  syncCategory: SyncCategory;
}

export interface SyncOutboxRecord {
  entityKey: string;
  operationId: string;
  ownerUid: string;
  entityType: SyncEntityType;
  lessonId: string;
  entityId: string;
  operation: SyncOperation;
  baseRevision: number;
  payloadSchemaVersion: 1;
  queuedAtMs: number;
  retryCount: number;
  lastErrorCode?: string;
}

export interface SyncDeviceRecord {
  key: "installation";
  deviceId: string;
  createdAtMs: number;
}

function validateSyncIdentity(value: string, field: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error(`Invalid sync ${field}.`);
  }
}

export async function getSyncMetadata(entityKey: string): Promise<SyncMetadataRecord | null> {
  return runTransaction<SyncMetadataRecord | null>(SYNC_METADATA_STORE, "readonly", (store, resolve) => {
    const request = store.get(entityKey);
    request.onsuccess = () => resolve((request.result as SyncMetadataRecord | undefined) ?? null);
  });
}

/** Explicitly binds a local record to one account. It never reassigns another account's data. */
export async function claimSyncEntity(input: Omit<SyncMetadataRecord, "remoteRevision" | "lastSyncedAtMs">): Promise<SyncMetadataRecord> {
  validateSyncIdentity(input.ownerUid, "account ID");
  validateSyncIdentity(input.lessonId, "lesson ID");
  validateSyncIdentity(input.entityId, "entity ID");
  if (input.entityKey !== `${input.entityType}:${input.lessonId}:${input.entityId}`) {
    throw new Error("Sync entity key does not match its typed identity.");
  }
  const expectedCategory: Record<SyncEntityType, SyncCategory> = {
    lesson: "lessonMetadata", note: "notes", quiz: "quizzes", attempt: "attempts"
  };
  if (input.syncCategory !== expectedCategory[input.entityType]) {
    throw new Error("Sync entity category does not match its entity type.");
  }
  const database = await openDatabase();
  return new Promise<SyncMetadataRecord>((resolve, reject) => {
    const transaction = database.transaction(SYNC_METADATA_STORE, "readwrite");
    const store = transaction.objectStore(SYNC_METADATA_STORE);
    let result: SyncMetadataRecord | null = null;
    const request = store.get(input.entityKey);
    request.onsuccess = () => {
      const existing = request.result as SyncMetadataRecord | undefined;
      if (existing && existing.ownerUid !== input.ownerUid) {
        transaction.abort();
        return;
      }
      result = existing ?? { ...input, remoteRevision: 0, lastSyncedAtMs: null };
      store.put(result);
    };
    transaction.oncomplete = () => resolve(result as SyncMetadataRecord);
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not claim this local record for sync."));
    transaction.onabort = () => reject(transaction.error ?? new Error("This local record belongs to another account."));
  }).finally(() => database.close());
}

/** Coalesces pending changes by entity. No payload or transcript is copied into the outbox. */
export async function queueSyncOperation(
  entityKey: string,
  ownerUid: string,
  operation: SyncOperation
): Promise<SyncOutboxRecord | null> {
  validateSyncIdentity(ownerUid, "account ID");
  if (!/^(lesson|note|quiz|attempt):[A-Za-z0-9_-]{1,128}:[A-Za-z0-9_-]{1,128}$/.test(entityKey)) {
    throw new Error("Invalid sync entity key.");
  }
  const database = await openDatabase();
  return new Promise<SyncOutboxRecord | null>((resolve, reject) => {
    const transaction = database.transaction([SYNC_METADATA_STORE, SYNC_OUTBOX_STORE], "readwrite");
    const metadataStore = transaction.objectStore(SYNC_METADATA_STORE);
    const outboxStore = transaction.objectStore(SYNC_OUTBOX_STORE);
    let result: SyncOutboxRecord | null = null;
    const metadataRequest = metadataStore.get(entityKey);
    metadataRequest.onsuccess = () => {
      const metadata = metadataRequest.result as SyncMetadataRecord | undefined;
      if (!metadata || metadata.ownerUid !== ownerUid) {
        transaction.abort();
        return;
      }
      const pendingRequest = outboxStore.get(entityKey);
      pendingRequest.onsuccess = () => {
        const pending = pendingRequest.result as SyncOutboxRecord | undefined;
        if (pending && pending.ownerUid !== ownerUid) {
          transaction.abort();
          return;
        }
        if (operation === "delete" && metadata.remoteRevision === 0 && pending?.operation === "upsert") {
          outboxStore.delete(entityKey);
          result = null;
          return;
        }
        const operationId = pending && pending.operation === operation
          ? pending.operationId
          : crypto.randomUUID();
        result = {
          entityKey,
          operationId,
          ownerUid,
          entityType: metadata.entityType,
          lessonId: metadata.lessonId,
          entityId: metadata.entityId,
          operation,
          baseRevision: metadata.remoteRevision,
          payloadSchemaVersion: 1,
          queuedAtMs: Date.now(),
          retryCount: pending?.operation === operation ? pending.retryCount : 0
        };
        outboxStore.put(result);
      };
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not queue the local sync operation."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Sync operation rejected because account ownership did not match."));
  }).finally(() => database.close());
}

export async function listSyncOutbox(ownerUid: string, limit = 100): Promise<SyncOutboxRecord[]> {
  validateSyncIdentity(ownerUid, "account ID");
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  return runTransaction<SyncOutboxRecord[]>(SYNC_OUTBOX_STORE, "readonly", (store, resolve) => {
    const request = store.index("ownerUid").getAll(ownerUid);
    request.onsuccess = () => resolve((request.result as SyncOutboxRecord[])
      .sort((a, b) => a.queuedAtMs - b.queuedAtMs)
      .slice(0, safeLimit));
  });
}

export async function acknowledgeSyncOperation(
  entityKey: string,
  ownerUid: string,
  operationId: string,
  newRevision: number
): Promise<void> {
  if (!Number.isSafeInteger(newRevision) || newRevision < 1) throw new Error("Invalid acknowledged sync revision.");
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([SYNC_METADATA_STORE, SYNC_OUTBOX_STORE], "readwrite");
    const metadataStore = transaction.objectStore(SYNC_METADATA_STORE);
    const outboxStore = transaction.objectStore(SYNC_OUTBOX_STORE);
    const request = outboxStore.get(entityKey);
    request.onsuccess = () => {
      const pending = request.result as SyncOutboxRecord | undefined;
      if (!pending || pending.ownerUid !== ownerUid || pending.operationId !== operationId) {
        transaction.abort();
        return;
      }
      if (newRevision !== pending.baseRevision + 1) {
        transaction.abort();
        return;
      }
      const metadataRequest = metadataStore.get(entityKey);
      metadataRequest.onsuccess = () => {
        const metadata = metadataRequest.result as SyncMetadataRecord | undefined;
        if (!metadata || metadata.ownerUid !== ownerUid || metadata.remoteRevision !== pending.baseRevision) {
          transaction.abort();
          return;
        }
        metadataStore.put({ ...metadata, remoteRevision: newRevision, lastSyncedAtMs: Date.now() });
        outboxStore.delete(entityKey);
      };
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not acknowledge the sync operation."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Sync acknowledgement was stale or did not match the pending operation."));
  }).finally(() => database.close());
}

export async function recordSyncRetry(
  entityKey: string,
  operationId: string,
  errorCode: string
): Promise<void> {
  const safeCode = errorCode.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  if (!safeCode) throw new Error("Invalid sync error code.");
  return runTransaction<void>(SYNC_OUTBOX_STORE, "readwrite", (store) => {
    const request = store.get(entityKey);
    request.onsuccess = () => {
      const pending = request.result as SyncOutboxRecord | undefined;
      if (!pending || pending.operationId !== operationId) return;
      store.put({ ...pending, retryCount: Math.min(20, pending.retryCount + 1), lastErrorCode: safeCode });
    };
  });
}

export async function getOrCreateSyncDeviceId(): Promise<string> {
  const database = await openDatabase();
  return new Promise<string>((resolve, reject) => {
    const transaction = database.transaction(SYNC_DEVICE_STORE, "readwrite");
    const store = transaction.objectStore(SYNC_DEVICE_STORE);
    let deviceId = "";
    const request = store.get("installation");
    request.onsuccess = () => {
      const existing = request.result as SyncDeviceRecord | undefined;
      deviceId = existing?.deviceId ?? crypto.randomUUID();
      if (!existing) store.put({ key: "installation", deviceId, createdAtMs: Date.now() } satisfies SyncDeviceRecord);
    };
    transaction.oncomplete = () => resolve(deviceId);
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not initialize the local sync device ID."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Could not initialize the local sync device ID."));
  }).finally(() => database.close());
}
