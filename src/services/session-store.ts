import type { TranscriptFormat } from "./transcript";
import type { QuizAttempt, QuizDefinition } from "./quiz";
import { toAttemptSyncDto, toLessonMetadataDto, toNoteSyncDto, toQuizSyncDto } from "./sync-dto";
import type { AttemptSyncDto, LessonMetadataDto, NoteSyncDto, QuizSyncDto } from "./sync-dto";

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
const DATABASE_VERSION = 7;
const SESSION_STORE = "learningSessions";
const NOTE_STORE = "learningNotes";
const QUIZ_STORE = "learningQuizzes";
const QUIZ_ATTEMPT_STORE = "quizAttempts";
const SYNC_METADATA_STORE = "syncMetadata";
const SYNC_OUTBOX_STORE = "syncOutbox";
const SYNC_DEVICE_STORE = "syncDevice";
const SYNC_PREFERENCES_STORE = "syncPreferences";

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
      if (!database.objectStoreNames.contains(SYNC_PREFERENCES_STORE)) {
        database.createObjectStore(SYNC_PREFERENCES_STORE, { keyPath: "ownerUid" });
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

export async function saveLearningSession(session: LearningSession): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([SESSION_STORE, SYNC_METADATA_STORE, SYNC_OUTBOX_STORE], "readwrite");
    const sessions = transaction.objectStore(SESSION_STORE);
    const metadata = transaction.objectStore(SYNC_METADATA_STORE);
    const outbox = transaction.objectStore(SYNC_OUTBOX_STORE);
    const request = sessions.get(session.id);
    request.onsuccess = () => {
      const previous = request.result as LearningSession | undefined;
      sessions.put(session);
      // Transcript-only autosaves must not enqueue a lesson metadata mutation.
      let changed = !previous;
      if (previous) {
        try {
          changed = JSON.stringify(toLessonMetadataDto(previous)) !== JSON.stringify(toLessonMetadataDto(session));
        } catch {
          // A malformed/oversized sync projection must not block local lesson capture.
          changed = false;
        }
      }
      if (changed) queueSyncOperationInTransaction(metadata, outbox, syncEntityKey("lesson", session.id, session.id), "upsert");
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the lesson locally."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Saving the lesson was cancelled."));
  }).finally(() => database.close());
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
    const transaction = database.transaction(
      [SESSION_STORE, NOTE_STORE, QUIZ_STORE, QUIZ_ATTEMPT_STORE, SYNC_METADATA_STORE, SYNC_OUTBOX_STORE],
      "readwrite"
    );
    const sessions = transaction.objectStore(SESSION_STORE);
    const notes = transaction.objectStore(NOTE_STORE);
    const quizzes = transaction.objectStore(QUIZ_STORE);
    const attempts = transaction.objectStore(QUIZ_ATTEMPT_STORE);
    const metadata = transaction.objectStore(SYNC_METADATA_STORE);
    const outbox = transaction.objectStore(SYNC_OUTBOX_STORE);
    const childRequests = [
      notes.index("sessionId").getAll(id),
      quizzes.index("sessionId").getAll(id),
      attempts.index("sessionId").getAll(id)
    ];
    const results: Array<Array<{ id: string; sessionId: string; quizId?: string }>> = [[], [], []];
    let completed = 0;
    for (let index = 0; index < childRequests.length; index += 1) {
      childRequests[index].onsuccess = () => {
        results[index] = childRequests[index].result as Array<{ id: string; sessionId: string; quizId?: string }>;
        completed += 1;
        if (completed !== childRequests.length) return;
        queueSyncOperationInTransaction(metadata, outbox, syncEntityKey("lesson", id, id), "delete");
        for (const note of results[0]) {
          queueSyncOperationInTransaction(metadata, outbox, syncEntityKey("note", id, note.id), "delete");
          notes.delete(note.id);
        }
        for (const quiz of results[1]) {
          queueSyncOperationInTransaction(metadata, outbox, syncEntityKey("quiz", id, quiz.id), "delete");
          quizzes.delete(quiz.id);
        }
        for (const attempt of results[2]) {
          queueSyncOperationInTransaction(metadata, outbox, syncEntityKey("attempt", id, attempt.id), "delete");
          attempts.delete(attempt.id);
        }
        sessions.delete(id);
      };
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not remove the saved lesson and its learning artifacts."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Removing the saved lesson was cancelled."));
  }).finally(() => database.close());
}

export async function saveLearningNote(note: LearningNote): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([NOTE_STORE, SYNC_METADATA_STORE, SYNC_OUTBOX_STORE], "readwrite");
    transaction.objectStore(NOTE_STORE).put(note);
    queueSyncOperationInTransaction(
      transaction.objectStore(SYNC_METADATA_STORE),
      transaction.objectStore(SYNC_OUTBOX_STORE),
      syncEntityKey("note", note.sessionId, note.id),
      "upsert"
    );
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the note locally."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Saving the note was cancelled."));
  }).finally(() => database.close());
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

export async function deleteLearningNote(id: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([NOTE_STORE, SYNC_METADATA_STORE, SYNC_OUTBOX_STORE], "readwrite");
    const notes = transaction.objectStore(NOTE_STORE);
    const request = notes.get(id);
    request.onsuccess = () => {
      const note = request.result as LearningNote | undefined;
      if (note) queueSyncOperationInTransaction(
        transaction.objectStore(SYNC_METADATA_STORE),
        transaction.objectStore(SYNC_OUTBOX_STORE),
        syncEntityKey("note", note.sessionId, note.id),
        "delete"
      );
      notes.delete(id);
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not delete the note."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Deleting the note was cancelled."));
  }).finally(() => database.close());
}

export async function saveQuiz(quiz: QuizDefinition): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([QUIZ_STORE, SYNC_METADATA_STORE, SYNC_OUTBOX_STORE], "readwrite");
    transaction.objectStore(QUIZ_STORE).put(quiz);
    queueSyncOperationInTransaction(
      transaction.objectStore(SYNC_METADATA_STORE),
      transaction.objectStore(SYNC_OUTBOX_STORE),
      syncEntityKey("quiz", quiz.sessionId, quiz.id),
      "upsert"
    );
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the quiz locally."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Saving the quiz was cancelled."));
  }).finally(() => database.close());
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
    const transaction = database.transaction([QUIZ_STORE, QUIZ_ATTEMPT_STORE, SYNC_METADATA_STORE, SYNC_OUTBOX_STORE], "readwrite");
    const quizzes = transaction.objectStore(QUIZ_STORE);
    const attempts = transaction.objectStore(QUIZ_ATTEMPT_STORE);
    const metadata = transaction.objectStore(SYNC_METADATA_STORE);
    const outbox = transaction.objectStore(SYNC_OUTBOX_STORE);
    const quizRequest = quizzes.get(id);
    quizRequest.onsuccess = () => {
      const quiz = quizRequest.result as QuizDefinition | undefined;
      if (quiz) queueSyncOperationInTransaction(metadata, outbox, syncEntityKey("quiz", quiz.sessionId, quiz.id), "delete");
      const request = attempts.index("quizId").getAll(id);
      request.onsuccess = () => {
        const related = request.result as QuizAttempt[];
        for (const attempt of related) {
          queueSyncOperationInTransaction(metadata, outbox, syncEntityKey("attempt", attempt.sessionId, attempt.id), "delete");
          attempts.delete(attempt.id);
        }
        quizzes.delete(id);
      };
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not remove the quiz and its attempts."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Quiz deletion was cancelled."));
  }).finally(() => database.close());
}

export async function saveQuizAttempt(attempt: QuizAttempt): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([QUIZ_ATTEMPT_STORE, SYNC_METADATA_STORE, SYNC_OUTBOX_STORE], "readwrite");
    transaction.objectStore(QUIZ_ATTEMPT_STORE).put(attempt);
    queueSyncOperationInTransaction(
      transaction.objectStore(SYNC_METADATA_STORE),
      transaction.objectStore(SYNC_OUTBOX_STORE),
      syncEntityKey("attempt", attempt.sessionId, attempt.id),
      "upsert"
    );
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the quiz attempt locally."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Saving the quiz attempt was cancelled."));
  }).finally(() => database.close());
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


function syncEntityKey(type: SyncEntityType, lessonId: string, entityId: string): string {
  return `${type}:${lessonId}:${entityId}`;
}

/** Must be called inside the same read/write transaction as the local mutation. */
function queueSyncOperationInTransaction(
  metadataStore: IDBObjectStore,
  outboxStore: IDBObjectStore,
  entityKey: string,
  operation: SyncOperation
): void {
  const metadataRequest = metadataStore.get(entityKey);
  metadataRequest.onsuccess = () => {
    const metadata = metadataRequest.result as SyncMetadataRecord | undefined;
    if (!metadata) return; // Local-only records are never queued implicitly.
    if (operation === "delete" && metadata.remoteRevision === 0) {
      outboxStore.delete(entityKey);
      metadataStore.delete(entityKey);
      return;
    }
    // A new local mutation must invalidate any in-flight acknowledgement for an
    // older payload. Retries keep this ID; a subsequent edit gets a fresh one.
    outboxStore.put({
      entityKey,
      operationId: crypto.randomUUID(),
      ownerUid: metadata.ownerUid,
      entityType: metadata.entityType,
      lessonId: metadata.lessonId,
      entityId: metadata.entityId,
      operation,
      baseRevision: metadata.remoteRevision,
      payloadSchemaVersion: 1,
      queuedAtMs: Date.now(),
      retryCount: 0
    } satisfies SyncOutboxRecord);
  };
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
      if (!pending || pending.ownerUid !== ownerUid) {
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
        if (pending.operationId === operationId) {
          outboxStore.delete(entityKey);
          return;
        }

        // The server accepted an older in-flight operation after a newer local
        // mutation replaced it. Advance the base revision but keep the newer
        // operation queued so the latest payload is still uploaded.
        const rebased = {
          ...pending,
          baseRevision: newRevision,
          queuedAtMs: Date.now(),
          retryCount: 0
        };
        delete rebased.lastErrorCode;
        outboxStore.put(rebased);
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


export interface SyncCategoryPreferences {
  lessonMetadata: boolean;
  notes: boolean;
  quizzes: boolean;
  attempts: boolean;
}

export interface LocalSyncPreferences {
  ownerUid: string;
  categories: SyncCategoryPreferences;
  updatedAtMs: number;
}

export interface SyncCandidateCategoryCounts {
  total: number;
  unclaimed: number;
  ownedByCurrentAccount: number;
  ownedByOtherAccount: number;
}

export type SyncCandidateCounts = Record<SyncCategory, SyncCandidateCategoryCounts>;

const EMPTY_SYNC_CATEGORIES: SyncCategoryPreferences = {
  lessonMetadata: false,
  notes: false,
  quizzes: false,
  attempts: false
};

export async function getLocalSyncPreferences(ownerUid: string): Promise<LocalSyncPreferences> {
  validateSyncIdentity(ownerUid, "account ID");
  return runTransaction<LocalSyncPreferences>(SYNC_PREFERENCES_STORE, "readonly", (store, resolve) => {
    const request = store.get(ownerUid);
    request.onsuccess = () => {
      const saved = request.result as LocalSyncPreferences | undefined;
      resolve(saved ?? { ownerUid, categories: { ...EMPTY_SYNC_CATEGORIES }, updatedAtMs: 0 });
    };
  });
}

export async function saveLocalSyncPreferences(
  ownerUid: string,
  categories: SyncCategoryPreferences
): Promise<LocalSyncPreferences> {
  validateSyncIdentity(ownerUid, "account ID");
  for (const value of Object.values(categories)) {
    if (typeof value !== "boolean") throw new Error("Invalid local sync category preference.");
  }
  const preferences: LocalSyncPreferences = {
    ownerUid,
    categories: {
      lessonMetadata: categories.lessonMetadata,
      notes: categories.notes,
      quizzes: categories.quizzes,
      attempts: categories.attempts
    },
    updatedAtMs: Date.now()
  };
  return runTransaction<LocalSyncPreferences>(SYNC_PREFERENCES_STORE, "readwrite", (store, resolve) => {
    store.put(preferences);
    resolve(preferences);
  });
}

export type SyncPreparedPayload =
  | LessonMetadataDto
  | NoteSyncDto
  | QuizSyncDto
  | AttemptSyncDto;

export type SyncPreparationBlockReason =
  | "invalid_outbox"
  | "metadata_missing"
  | "ownership_mismatch"
  | "stale_base_revision"
  | "local_record_missing"
  | "local_record_present_for_tombstone"
  | "invalid_payload"
  | "invalid_tombstone";

export interface SyncOperationSnapshot {
  outbox: SyncOutboxRecord;
  payload: SyncPreparedPayload | null;
  blockedReason: SyncPreparationBlockReason | null;
}

/**
 * Reads a bounded, account-owned snapshot of queued operations and maps upserts
 * through the allow-listed DTOs. This is preparation only: it performs no network
 * requests and never writes to Firebase or Firestore.
 */
export async function getLocalSyncOperationSnapshots(
  ownerUid: string,
  categories: SyncCategoryPreferences,
  limit = 25
): Promise<SyncOperationSnapshot[]> {
  validateSyncIdentity(ownerUid, "account ID");
  for (const value of Object.values(categories)) {
    if (typeof value !== "boolean") throw new Error("Invalid local sync category selection.");
  }
  const safeLimit = Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.floor(limit) : 25));
  const categoryByType: Partial<Record<string, SyncCategory>> = {
    lesson: "lessonMetadata", note: "notes", quiz: "quizzes", attempt: "attempts"
  };
  const storeByType: Partial<Record<string, string>> = {
    lesson: SESSION_STORE, note: NOTE_STORE, quiz: QUIZ_STORE, attempt: QUIZ_ATTEMPT_STORE
  };

  const database = await openDatabase();
  return new Promise<SyncOperationSnapshot[]>((resolve, reject) => {
    const transaction = database.transaction(
      [SESSION_STORE, NOTE_STORE, QUIZ_STORE, QUIZ_ATTEMPT_STORE, SYNC_METADATA_STORE, SYNC_OUTBOX_STORE],
      "readonly"
    );
    const outboxRequest = transaction.objectStore(SYNC_OUTBOX_STORE).index("ownerUid").getAll(ownerUid);
    let snapshots: SyncOperationSnapshot[] = [];

    outboxRequest.onsuccess = () => {
      const entries = (outboxRequest.result as SyncOutboxRecord[])
        .filter((entry) => {
          const category = categoryByType[String(entry.entityType)];
          return entry.ownerUid === ownerUid && (!category || categories[category]);
        })
        .sort((a, b) => {
          const left = Number.isSafeInteger(a.queuedAtMs) ? a.queuedAtMs : 0;
          const right = Number.isSafeInteger(b.queuedAtMs) ? b.queuedAtMs : 0;
          return left - right;
        })
        .slice(0, safeLimit);

      snapshots = entries.map((entry) => ({
        outbox: entry,
        payload: null,
        blockedReason: null
      }));

      for (const snapshot of snapshots) {
        const entry = snapshot.outbox;
        const category = categoryByType[String(entry.entityType)];
        const storeName = storeByType[String(entry.entityType)];
        let identityValid = Boolean(category && storeName);
        try {
          if (entry.ownerUid !== ownerUid) identityValid = false;
          validateSyncIdentity(entry.ownerUid, "account ID");
          validateSyncIdentity(entry.lessonId, "lesson ID");
          validateSyncIdentity(entry.entityId, "entity ID");
          if (entry.entityKey !== syncEntityKey(entry.entityType, entry.lessonId, entry.entityId)) identityValid = false;
        } catch {
          identityValid = false;
        }
        if (
          !identityValid ||
          (entry.operation !== "upsert" && entry.operation !== "delete") ||
          typeof entry.operationId !== "string" || !entry.operationId || entry.operationId.length > 128 ||
          !Number.isSafeInteger(entry.baseRevision) || entry.baseRevision < 0 ||
          entry.payloadSchemaVersion !== 1 ||
          !Number.isSafeInteger(entry.queuedAtMs) || entry.queuedAtMs < 0
        ) {
          snapshot.blockedReason = "invalid_outbox";
          continue;
        }

        const metadataRequest = transaction.objectStore(SYNC_METADATA_STORE).get(entry.entityKey);
        metadataRequest.onsuccess = () => {
          const metadata = metadataRequest.result as SyncMetadataRecord | undefined;
          if (!metadata) {
            snapshot.blockedReason = "metadata_missing";
            return;
          }
          if (
            metadata.ownerUid !== ownerUid ||
            metadata.entityKey !== entry.entityKey ||
            metadata.entityType !== entry.entityType ||
            metadata.lessonId !== entry.lessonId ||
            metadata.entityId !== entry.entityId
          ) {
            snapshot.blockedReason = "ownership_mismatch";
            return;
          }
          if (
            metadata.syncCategory !== category ||
            metadata.remoteRevision !== entry.baseRevision
          ) {
            snapshot.blockedReason = "stale_base_revision";
            return;
          }

          const entityRequest = transaction.objectStore(storeName as string).get(entry.entityId);
          entityRequest.onsuccess = () => {
            const entity = entityRequest.result as
              | LearningSession | LearningNote | QuizDefinition | QuizAttempt | undefined;

            if (entry.operation === "delete") {
              if (entry.baseRevision < 1) {
                snapshot.blockedReason = "invalid_tombstone";
                return;
              }
              if (entity) {
                snapshot.blockedReason = "local_record_present_for_tombstone";
                return;
              }
              snapshot.payload = null;
              return;
            }

            if (!entity) {
              snapshot.blockedReason = "local_record_missing";
              return;
            }
            try {
              if (entry.entityType === "lesson") snapshot.payload = toLessonMetadataDto(entity as LearningSession);
              else if (entry.entityType === "note") snapshot.payload = toNoteSyncDto(entity as LearningNote);
              else if (entry.entityType === "quiz") snapshot.payload = toQuizSyncDto(entity as QuizDefinition);
              else if (entry.entityType === "attempt") snapshot.payload = toAttemptSyncDto(entity as QuizAttempt);
              else snapshot.blockedReason = "invalid_outbox";
            } catch {
              snapshot.blockedReason = "invalid_payload";
              snapshot.payload = null;
            }
          };
        };
      }
    };

    transaction.oncomplete = () => resolve(snapshots);
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not prepare local sync operations."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Preparing local sync operations was cancelled."));
  }).finally(() => database.close());
}

/** Counts local records without reading or returning transcript contents. */
export async function getLocalSyncCandidateCounts(ownerUid: string): Promise<SyncCandidateCounts> {
  validateSyncIdentity(ownerUid, "account ID");
  const database = await openDatabase();
  return new Promise<SyncCandidateCounts>((resolve, reject) => {
    const transaction = database.transaction(
      [SESSION_STORE, NOTE_STORE, QUIZ_STORE, QUIZ_ATTEMPT_STORE, SYNC_METADATA_STORE],
      "readonly"
    );
    const requests = [
      transaction.objectStore(SESSION_STORE).getAll(),
      transaction.objectStore(NOTE_STORE).getAll(),
      transaction.objectStore(QUIZ_STORE).getAll(),
      transaction.objectStore(QUIZ_ATTEMPT_STORE).getAll(),
      transaction.objectStore(SYNC_METADATA_STORE).getAll()
    ];
    const results: unknown[][] = [[], [], [], [], []];
    let completed = 0;
    for (let index = 0; index < requests.length; index += 1) {
      requests[index].onsuccess = () => {
        results[index] = requests[index].result as unknown[];
        completed += 1;
        if (completed !== requests.length) return;
        const metadata = new Map((results[4] as SyncMetadataRecord[]).map((entry) => [entry.entityKey, entry]));
        const count = (category: SyncCategory, entities: Array<{ id: string; sessionId?: string }>) => {
          let unclaimed = 0;
          let ownedByCurrentAccount = 0;
          let ownedByOtherAccount = 0;
          for (const entity of entities) {
            const lessonId = entity.sessionId ?? entity.id;
            const entityType: SyncEntityType = category === "lessonMetadata" ? "lesson"
              : category === "notes" ? "note" : category === "quizzes" ? "quiz" : "attempt";
            const entityKey = syncEntityKey(entityType, lessonId, entity.id);
            const claim = metadata.get(entityKey);
            if (!claim) unclaimed += 1;
            else if (claim.ownerUid === ownerUid) ownedByCurrentAccount += 1;
            else ownedByOtherAccount += 1;
          }
          return { total: entities.length, unclaimed, ownedByCurrentAccount, ownedByOtherAccount };
        };
        resolve({
          lessonMetadata: count("lessonMetadata", (results[0] as LearningSession[]).map((item) => ({ id: item.id }))),
          notes: count("notes", (results[1] as LearningNote[]).map((item) => ({ id: item.id, sessionId: item.sessionId }))),
          quizzes: count("quizzes", (results[2] as QuizDefinition[]).map((item) => ({ id: item.id, sessionId: item.sessionId }))),
          attempts: count("attempts", (results[3] as QuizAttempt[]).map((item) => ({ id: item.id, sessionId: item.sessionId })))
        });
      };
    }
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not count local sync candidates."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Counting local sync candidates was cancelled."));
  }).finally(() => database.close());
}


export interface SyncClaimCandidate {
  entityKey: string;
  category: SyncCategory;
  title: string;
  lessonTitle: string;
  updatedAtMs: number;
  ownership: "unclaimed" | "current_account" | "other_account" | "invalid";
}

export async function getLocalSyncClaimCandidates(
  ownerUid: string,
  categories: SyncCategoryPreferences
): Promise<SyncClaimCandidate[]> {
  validateSyncIdentity(ownerUid, "account ID");
  const database = await openDatabase();
  return new Promise<SyncClaimCandidate[]>((resolve, reject) => {
    const transaction = database.transaction(
      [SESSION_STORE, NOTE_STORE, QUIZ_STORE, QUIZ_ATTEMPT_STORE, SYNC_METADATA_STORE],
      "readonly"
    );
    const requests = [
      transaction.objectStore(SESSION_STORE).getAll(),
      transaction.objectStore(NOTE_STORE).getAll(),
      transaction.objectStore(QUIZ_STORE).getAll(),
      transaction.objectStore(QUIZ_ATTEMPT_STORE).getAll(),
      transaction.objectStore(SYNC_METADATA_STORE).getAll()
    ];
    const values: unknown[][] = [[], [], [], [], []];
    let complete = 0;
    requests.forEach((request, index) => {
      request.onsuccess = () => {
        values[index] = request.result as unknown[];
        complete += 1;
        if (complete !== requests.length) return;
        const sessions = values[0] as LearningSession[];
        const lessonTitles = new Map(sessions.map((item) => [item.id, item.title]));
        const metadata = new Map((values[4] as SyncMetadataRecord[]).map((item) => [item.entityKey, item]));
        const candidates: SyncClaimCandidate[] = [];
        const add = (category: SyncCategory, type: SyncEntityType, records: Array<{id:string;sessionId?:string;title?:string;updatedAt?:number;createdAt?:number;quizId?:string}>) => {
          if (!categories[category]) return;
          for (const record of records) {
            const lessonId = type === "lesson" ? record.id : record.sessionId ?? "";
            let entityKey: string;
            try {
              validateSyncIdentity(lessonId, "lesson ID");
              validateSyncIdentity(record.id, "entity ID");
              entityKey = syncEntityKey(type, lessonId, record.id);
            } catch { continue; }
            const claim = metadata.get(entityKey);
            let valid = true;
            try {
              if (type === "lesson") toLessonMetadataDto(record as LearningSession);
              else if (type === "note") toNoteSyncDto(record as LearningNote);
              else if (type === "quiz") toQuizSyncDto(record as QuizDefinition);
              else toAttemptSyncDto(record as QuizAttempt);
            } catch { valid = false; }
            candidates.push({
              entityKey, category,
              title: record.title || (type === "attempt" ? `Quiz attempt ${record.quizId ?? ""}` : type === "lesson" ? "Untitled lesson" : "Untitled record"),
              lessonTitle: lessonTitles.get(lessonId) ?? "Lesson unavailable",
              updatedAtMs: record.updatedAt ?? record.createdAt ?? 0,
              ownership: !valid ? "invalid" : !claim ? "unclaimed" : claim.ownerUid === ownerUid ? "current_account" : "other_account"
            });
          }
        };
        add("lessonMetadata","lesson",values[0] as LearningSession[]);
        add("notes","note",values[1] as LearningNote[]);
        add("quizzes","quiz",values[2] as QuizDefinition[]);
        add("attempts","attempt",values[3] as QuizAttempt[]);
        candidates.sort((a,b)=>b.updatedAtMs-a.updatedAtMs);
        resolve(candidates);
      };
    });
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not prepare the local claim review."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local claim review was cancelled."));
  }).finally(() => database.close());
}

export interface SyncClaimResult {
  claimed: Record<SyncCategory, number>;
  alreadyOwned: Record<SyncCategory, number>;
  skippedOtherAccount: Record<SyncCategory, number>;
  skippedInvalid: Record<SyncCategory, number>;
  totalQueued: number;
}

/**
 * Claims the currently selected local records for one verified account.
 * The ownership metadata and payload-free outbox entries are committed atomically.
 * DTO mappers are run as a privacy/size validation gate; their payloads are discarded.
 */
export async function claimSelectedLocalSyncRecords(
  ownerUid: string,
  categories: SyncCategoryPreferences,
  reviewedEntityKeys: string[]
): Promise<SyncClaimResult> {
  validateSyncIdentity(ownerUid, "account ID");
  for (const value of Object.values(categories)) {
    if (typeof value !== "boolean") throw new Error("Invalid local sync category selection.");
  }
  const emptyCounts = (): Record<SyncCategory, number> => ({
    lessonMetadata: 0, notes: 0, quizzes: 0, attempts: 0
  });
  const result: SyncClaimResult = {
    claimed: emptyCounts(), alreadyOwned: emptyCounts(),
    skippedOtherAccount: emptyCounts(), skippedInvalid: emptyCounts(), totalQueued: 0
  };
  if (!Object.values(categories).some(Boolean) || reviewedEntityKeys.length === 0) return result;
  const reviewedKeys = new Set(reviewedEntityKeys);
  if (reviewedKeys.size !== reviewedEntityKeys.length || reviewedKeys.size > 10000) throw new Error("Invalid or duplicated local claim review selection.");

  const database = await openDatabase();
  return new Promise<SyncClaimResult>((resolve, reject) => {
    const transaction = database.transaction(
      [SESSION_STORE, NOTE_STORE, QUIZ_STORE, QUIZ_ATTEMPT_STORE, SYNC_METADATA_STORE, SYNC_OUTBOX_STORE],
      "readwrite"
    );
    const sessions = transaction.objectStore(SESSION_STORE);
    const notes = transaction.objectStore(NOTE_STORE);
    const quizzes = transaction.objectStore(QUIZ_STORE);
    const attempts = transaction.objectStore(QUIZ_ATTEMPT_STORE);
    const metadataStore = transaction.objectStore(SYNC_METADATA_STORE);
    const outboxStore = transaction.objectStore(SYNC_OUTBOX_STORE);
    const requests = [
      sessions.getAll(), notes.getAll(), quizzes.getAll(), attempts.getAll(), metadataStore.getAll()
    ];
    const values: unknown[][] = [[], [], [], [], []];
    let completed = 0;

    const process = () => {
      const metadata = new Map((values[4] as SyncMetadataRecord[]).map((entry) => [entry.entityKey, entry]));
      const groups: Array<{
        category: SyncCategory; type: SyncEntityType;
        records: Array<LearningSession | LearningNote | QuizDefinition | QuizAttempt>;
        validate: (record: LearningSession | LearningNote | QuizDefinition | QuizAttempt) => unknown;
      }> = [
        { category: "lessonMetadata", type: "lesson", records: values[0] as LearningSession[], validate: (record) => toLessonMetadataDto(record as LearningSession) },
        { category: "notes", type: "note", records: values[1] as LearningNote[], validate: (record) => toNoteSyncDto(record as LearningNote) },
        { category: "quizzes", type: "quiz", records: values[2] as QuizDefinition[], validate: (record) => toQuizSyncDto(record as QuizDefinition) },
        { category: "attempts", type: "attempt", records: values[3] as QuizAttempt[], validate: (record) => toAttemptSyncDto(record as QuizAttempt) }
      ];
      for (const group of groups) {
        if (!categories[group.category]) continue;
        for (const record of group.records) {
          const entity = record as LearningSession & LearningNote & QuizDefinition & QuizAttempt;
          const lessonId = group.type === "lesson" ? entity.id : entity.sessionId;
          const entityId = entity.id;
          let entityKey: string;
          try {
            validateSyncIdentity(lessonId, "lesson ID");
            validateSyncIdentity(entityId, "entity ID");
            entityKey = syncEntityKey(group.type, lessonId, entityId);
            group.validate(record);
          } catch {
            result.skippedInvalid[group.category] += 1;
            continue;
          }
          if (!reviewedKeys.has(entityKey)) continue;
          const existing = metadata.get(entityKey);
          if (existing && existing.ownerUid !== ownerUid) {
            result.skippedOtherAccount[group.category] += 1;
            continue;
          }
          const wasOwned = Boolean(existing);
          const claim: SyncMetadataRecord = existing ?? {
            entityKey, entityType: group.type, lessonId, entityId, ownerUid,
            remoteRevision: 0, lastSyncedAtMs: null, syncCategory: group.category
          };
          metadataStore.put(claim);
          if (wasOwned) result.alreadyOwned[group.category] += 1;
          else result.claimed[group.category] += 1;

          const pending = outboxStore.get(entityKey);
          pending.onsuccess = () => {
            const prior = pending.result as SyncOutboxRecord | undefined;
            if (prior && prior.ownerUid !== ownerUid) {
              transaction.abort();
              return;
            }
            if (!prior || prior.operation !== "upsert") {
              outboxStore.put({
                entityKey, operationId: crypto.randomUUID(), ownerUid,
                entityType: group.type, lessonId, entityId, operation: "upsert",
                baseRevision: claim.remoteRevision, payloadSchemaVersion: 1,
                queuedAtMs: Date.now(), retryCount: 0
              } satisfies SyncOutboxRecord);
              result.totalQueued += 1;
            }
          };
        }
      }
    };
    requests.forEach((request, index) => {
      request.onsuccess = () => {
        values[index] = request.result as unknown[];
        completed += 1;
        if (completed === requests.length) process();
      };
    });
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not claim selected local records."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Claim cancelled because local account ownership changed."));
  }).finally(() => database.close());
}
