import { createHash } from "node:crypto";
import {
  FieldValue,
  Timestamp,
  type DocumentSnapshot,
  type Firestore
} from "firebase-admin/firestore";
import type { SyncEntityType, SyncPreparedPayload } from "../../src/services/session-store";
import type { AttemptSyncDto } from "../../src/services/sync-dto";
import {
  buildSyncFirestorePaths,
  canonicalizeSyncServerRequest,
  decideSyncServerMutation,
  validateSyncServerMutationDependencies,
  validateSyncServerRequest
} from "../../src/services/sync-server-contract";
import type {
  SyncServerEntitySnapshot,
  SyncServerMutationRequest,
  SyncServerReceiptSnapshot
} from "../../src/services/sync-server-contract";
import { SyncBackendError } from "./errors";


interface SyncServerSettings {
  enabled: boolean;
  categories: {
    lessonMetadata: boolean;
    notes: boolean;
    quizzes: boolean;
    attempts: boolean;
  };
}

export interface SyncMutationResponse {
  outcome: "applied" | "conflict";
  resultRevision: number;
  conflictCode?: string;
  replayed?: true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function failCorruptRemote(): never {
  throw new SyncBackendError("failed-precondition", "A remote sync record is malformed and requires administrator review.");
}

function parseSettings(value: unknown, entityType: SyncEntityType): SyncServerSettings {
  if (!isRecord(value)) {
    throw new SyncBackendError("failed-precondition", "Cloud sync has not been enabled for this account.");
  }
  const allowed = ["schemaVersion", "enabled", "categories", "updatedAt"];
  if (
    Object.keys(value).length !== allowed.length ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    allowed.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new SyncBackendError("failed-precondition", "The account sync settings are invalid.");
  }
  if (
    value.schemaVersion !== 1 ||
    typeof value.enabled !== "boolean" ||
    !(value.updatedAt instanceof Timestamp) ||
    !isRecord(value.categories)
  ) {
    throw new SyncBackendError("failed-precondition", "The account sync settings are invalid.");
  }
  const rawCategories = value.categories;
  const categoryKeys = ["lessonMetadata", "notes", "quizzes", "attempts"];
  if (
    Object.keys(rawCategories).length !== categoryKeys.length ||
    Object.keys(rawCategories).some((key) => !categoryKeys.includes(key)) ||
    categoryKeys.some((key) => typeof rawCategories[key] !== "boolean")
  ) {
    throw new SyncBackendError("failed-precondition", "The account sync categories are invalid.");
  }
  const categories = rawCategories as SyncServerSettings["categories"];
  if (categories.attempts && !categories.quizzes) {
    throw new SyncBackendError("failed-precondition", "Quiz attempts require Quiz definitions to be enabled.");
  }
  if (value.enabled !== true) {
    throw new SyncBackendError("failed-precondition", "Cloud sync is disabled for this account.");
  }
  const categoryByType: Record<SyncEntityType, keyof SyncServerSettings["categories"]> = {
    lesson: "lessonMetadata",
    note: "notes",
    quiz: "quizzes",
    attempt: "attempts"
  };
  if (!categories[categoryByType[entityType]]) {
    throw new SyncBackendError("failed-precondition", "This sync category is not enabled for the account.");
  }
  return { enabled: true, categories };
}

function parseReceipt(value: unknown): SyncServerReceiptSnapshot {
  const data = isRecord(value) ? value : {};
  return {
    requestId: typeof data.requestId === "string" ? data.requestId : "",
    requestFingerprint: typeof data.requestFingerprint === "string" ? data.requestFingerprint : "",
    outcome: data.outcome as "applied" | "conflict",
    resultRevision: Number.isSafeInteger(data.resultRevision) ? data.resultRevision as number : -1,
    ...(typeof data.conflictCode === "string" ? { conflictCode: data.conflictCode } : {})
  };
}

function parseEntitySnapshot(
  document: DocumentSnapshot,
  expected: { entityType: SyncEntityType; lessonId: string; entityId: string }
): { snapshot: SyncServerEntitySnapshot; createdAt: Timestamp } | null {
  if (!document.exists) return null;
  const value = document.data();
  if (!isRecord(value)) return failCorruptRemote();

  const allowed = [
    "schemaVersion", "entityType", "lessonId", "entityId", "revision",
    "createdAt", "updatedAt", "clientUpdatedAtMs", "modifiedByDeviceId",
    "deletedAt", "lastOperationId", "payload"
  ];
  if (
    Object.keys(value).length !== allowed.length ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    allowed.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) return failCorruptRemote();

  if (
    value.schemaVersion !== 1 ||
    value.entityType !== expected.entityType ||
    value.lessonId !== expected.lessonId ||
    value.entityId !== expected.entityId ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    !(value.createdAt instanceof Timestamp) ||
    !(value.updatedAt instanceof Timestamp) ||
    !(value.deletedAt === null || value.deletedAt instanceof Timestamp) ||
    !(
      value.clientUpdatedAtMs === null ||
      (Number.isSafeInteger(value.clientUpdatedAtMs) && (value.clientUpdatedAtMs as number) >= 0)
    ) ||
    typeof value.modifiedByDeviceId !== "string" ||
    typeof value.lastOperationId !== "string"
  ) return failCorruptRemote();

  const isDeleted = value.deletedAt instanceof Timestamp;
  try {
    validateSyncServerRequest({
      protocolVersion: 1,
      requestId: value.lastOperationId,
      deviceId: value.modifiedByDeviceId,
      entityType: expected.entityType,
      lessonId: expected.lessonId,
      entityId: expected.entityId,
      operation: isDeleted ? "delete" : "upsert",
      baseRevision: (value.revision as number) - 1,
      payloadSchemaVersion: 1,
      payload: value.payload
    });
  } catch {
    return failCorruptRemote();
  }

  return {
    snapshot: {
      entityType: expected.entityType,
      lessonId: expected.lessonId,
      entityId: expected.entityId,
      revision: value.revision as number,
      isDeleted,
      payload: value.payload as SyncPreparedPayload | null
    },
    createdAt: value.createdAt
  };
}

function decisionError(code: string): SyncBackendError {
  switch (code) {
    case "idempotency_key_reused":
      return new SyncBackendError("already-exists", "This request ID was already used with a different payload.");
    case "entity_not_found":
      return new SyncBackendError("not-found", "The remote record does not exist and cannot be deleted.");
    case "corrupt_remote_record":
      return new SyncBackendError("failed-precondition", "A remote sync record is malformed and requires administrator review.");
    default:
      return new SyncBackendError("invalid-argument", "The sync request is invalid.");
  }
}

function payloadClientTimestamp(payload: SyncPreparedPayload | null): number | null {
  if (!payload) return null;
  if ("updatedAtMs" in payload) return payload.updatedAtMs;
  if ("createdAtMs" in payload) return payload.createdAtMs;
  return null;
}

export async function applySyncMutation(
  uid: string,
  input: unknown,
  database: Firestore
): Promise<SyncMutationResponse> {
  let request: SyncServerMutationRequest;
  try {
    request = validateSyncServerRequest(input);
  } catch (cause) {
    throw new SyncBackendError(
      "invalid-argument",
      cause instanceof Error ? cause.message : "Invalid sync mutation request."
    );
  }

  let paths: ReturnType<typeof buildSyncFirestorePaths>;
  try {
    paths = buildSyncFirestorePaths(uid, request);
  } catch {
    throw new SyncBackendError("permission-denied", "The authenticated account or sync entity ID is invalid.");
  }

  const fingerprint = createHash("sha256")
    .update(canonicalizeSyncServerRequest(request), "utf8")
    .digest("hex");

  const root = "users/" + uid;
  const settingsRef = database.doc(root + "/settings/sync");
  const entityRef = database.doc(paths.entity);
  const receiptRef = database.doc(paths.receipt);
  const conflictRef = database.doc(paths.conflict);
  const deviceRef = database.doc(paths.device);
  const counterRef = database.doc(root + "/syncState/changeFeed");

  return database.runTransaction(async (transaction) => {
    // Every document reference needed by the normal mutation is read before
    // any write. The feed counter serializes sequence allocation per account.
    const [settingsDocument, receiptDocument, entityDocument, counterDocument, deviceDocument] =
      await Promise.all([
        transaction.get(settingsRef),
        transaction.get(receiptRef),
        transaction.get(entityRef),
        transaction.get(counterRef),
        transaction.get(deviceRef)
      ]);

    if (receiptDocument.exists) {
      const priorReceipt = parseReceipt(receiptDocument.data());
      const replay = decideSyncServerMutation(request, null, priorReceipt, fingerprint);
      if (replay.kind === "replay") {
        return {
          outcome: replay.outcome,
          resultRevision: replay.resultRevision,
          ...(replay.conflictCode ? { conflictCode: replay.conflictCode } : {}),
          replayed: true
        };
      }
      if (replay.kind === "reject") throw decisionError(replay.code);
      throw new SyncBackendError("internal", "The sync receipt could not be replayed safely.");
    }

    const settings = parseSettings(settingsDocument.data(), request.entityType);
    const currentEntity = parseEntitySnapshot(entityDocument, {
      entityType: request.entityType,
      lessonId: request.lessonId,
      entityId: request.entityId
    });

    let referencedQuiz: SyncServerEntitySnapshot | null = null;
    let hasActiveAttemptsForQuiz = false;

    if (request.entityType === "attempt" && request.operation === "upsert") {
      const quizId = (request.payload as AttemptSyncDto).quizId;
      const quizDocument = await transaction.get(
        database.doc(root + "/lessons/" + request.lessonId + "/quizzes/" + quizId)
      );
      const parsedQuiz = parseEntitySnapshot(quizDocument, {
        entityType: "quiz",
        lessonId: request.lessonId,
        entityId: quizId
      });
      referencedQuiz = parsedQuiz?.snapshot ?? null;
    }

    if (request.entityType === "quiz" && request.operation === "delete") {
      const attemptsQuery = database
        .collection(root + "/lessons/" + request.lessonId + "/attempts")
        .where("payload.quizId", "==", request.entityId);
      const attempts = await transaction.get(attemptsQuery);
      hasActiveAttemptsForQuiz = !attempts.empty;
    }

    const dependencies = validateSyncServerMutationDependencies(
      request,
      settings.categories,
      referencedQuiz,
      hasActiveAttemptsForQuiz
    );
    if (dependencies.kind === "reject") {
      throw new SyncBackendError(
        "failed-precondition",
        "The sync mutation dependency check failed: " + dependencies.code + "."
      );
    }

    const decision = decideSyncServerMutation(
      request,
      currentEntity?.snapshot ?? null,
      null,
      fingerprint
    );
    if (decision.kind === "reject") throw decisionError(decision.code);

    const deviceData = deviceDocument.exists && isRecord(deviceDocument.data())
      ? deviceDocument.data() as Record<string, unknown>
      : {};
    transaction.set(deviceRef, {
      schemaVersion: 1,
      deviceId: request.deviceId,
      createdAt: deviceData.createdAt instanceof Timestamp
        ? deviceData.createdAt
        : FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp()
    }, { merge: true });

    if (decision.kind === "conflict") {
      const localSnapshotPath = root + "/syncConflictSnapshots/" + request.requestId + "_local";
      const remoteSnapshotPath = root + "/syncConflictSnapshots/" + request.requestId + "_remote";
      transaction.create(conflictRef, {
        schemaVersion: 1,
        conflictId: decision.conflict.conflictId,
        requestId: decision.conflict.requestId,
        deviceId: decision.conflict.deviceId,
        entityType: decision.conflict.entityType,
        lessonId: decision.conflict.lessonId,
        entityId: decision.conflict.entityId,
        operation: decision.conflict.operation,
        baseRevision: decision.conflict.baseRevision,
        remoteRevision: decision.conflict.remoteRevision,
        reason: decision.conflict.reason,
        localSnapshotPath: decision.conflict.payloadSnapshot === null ? null : localSnapshotPath,
        remoteSnapshotPath: decision.conflict.remotePayloadSnapshot === null ? null : remoteSnapshotPath,
        remoteIsDeleted: decision.conflict.remoteIsDeleted,
        createdAt: FieldValue.serverTimestamp()
      });
      if (decision.conflict.payloadSnapshot !== null) {
        transaction.create(database.doc(localSnapshotPath), {
          schemaVersion: 1,
          requestId: request.requestId,
          snapshotKind: "local",
          payload: decision.conflict.payloadSnapshot,
          createdAt: FieldValue.serverTimestamp()
        });
      }
      if (decision.conflict.remotePayloadSnapshot !== null) {
        transaction.create(database.doc(remoteSnapshotPath), {
          schemaVersion: 1,
          requestId: request.requestId,
          snapshotKind: "remote",
          payload: decision.conflict.remotePayloadSnapshot,
          createdAt: FieldValue.serverTimestamp()
        });
      }
      transaction.create(receiptRef, {
        schemaVersion: 1,
        ...decision.receipt,
        createdAt: FieldValue.serverTimestamp()
      });
      return {
        outcome: "conflict",
        resultRevision: decision.conflict.remoteRevision,
        conflictCode: decision.conflict.reason
      };
    }

    const existingCounter: Record<string, unknown> =
      counterDocument.exists && isRecord(counterDocument.data())
        ? counterDocument.data()
        : {};
    const currentSequence = counterDocument.exists
      ? existingCounter.lastSequence
      : 0;
    if (!Number.isSafeInteger(currentSequence) || (currentSequence as number) < 0 ||
        (currentSequence as number) >= Number.MAX_SAFE_INTEGER) {
      throw new SyncBackendError("failed-precondition", "The account change-feed counter is invalid.");
    }
    const nextSequence = (currentSequence as number) + 1;

    transaction.set(entityRef, {
      schemaVersion: 1,
      entityType: request.entityType,
      lessonId: request.lessonId,
      entityId: request.entityId,
      revision: decision.nextRevision,
      createdAt: currentEntity?.createdAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      clientUpdatedAtMs: payloadClientTimestamp(decision.payload),
      modifiedByDeviceId: request.deviceId,
      deletedAt: decision.isDeleted ? FieldValue.serverTimestamp() : null,
      lastOperationId: request.requestId,
      payload: decision.payload
    });
    transaction.create(receiptRef, {
      schemaVersion: 1,
      ...decision.receipt,
      createdAt: FieldValue.serverTimestamp()
    });
    transaction.set(counterRef, {
      lastSequence: nextSequence,
      updatedAt: FieldValue.serverTimestamp()
    });
    transaction.create(database.doc(root + "/syncChanges/" + String(nextSequence)), {
      sequence: nextSequence,
      entityType: request.entityType,
      lessonId: request.lessonId,
      entityId: request.entityId,
      revision: decision.nextRevision,
      isDeleted: decision.isDeleted,
      payload: decision.payload
    });

    return { outcome: "applied", resultRevision: decision.nextRevision };
  });
}
