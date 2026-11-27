import type { SyncCategory, SyncEntityType, SyncPreparedPayload } from "./session-store";
import { validateSyncServerRequest } from "./sync-server-contract";

const CURSOR_MAX_LENGTH = 2048;
const PAGE_MAX_CHANGES = 100;
const VALID_CATEGORIES: SyncCategory[] = ["lessonMetadata", "notes", "quizzes", "attempts"];

const TYPE_BY_CATEGORY: Record<SyncCategory, SyncEntityType> = {
  lessonMetadata: "lesson",
  notes: "note",
  quizzes: "quiz",
  attempts: "attempt"
};

export interface SyncPullChangeRecord {
  sequence: number;
  entityType: SyncEntityType;
  lessonId: string;
  entityId: string;
  revision: number;
  isDeleted: boolean;
  payload: SyncPreparedPayload | null;
}

export interface SyncPullPage {
  protocolVersion: 1;
  category: SyncCategory;
  fromSequence: number;
  snapshotSequence: number;
  scannedThroughSequence: number;
  changes: SyncPullChangeRecord[];
  /** Whether more pages remain in this fixed snapshot. */
  hasMore: boolean;
  /** Always returned: the opaque checkpoint used for the next page or next snapshot. */
  nextCursor: string;
}

export type SyncPullMergeAction =
  | "apply_remote_snapshot"
  | "store_remote_only"
  | "ignore_missing_tombstone"
  | "preserve_local_conflict"
  | "keep_lesson_transcript_local_only"
  | "ignore_stale_change";

export interface SyncPullLocalState {
  exists: boolean;
  lastRemoteRevision: number | null;
  hasPendingLocalWrite: boolean;
  isConflicted: boolean;
  /** True only for an existing local lesson that still has its transcript. */
  hasLocalTranscript?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertSequence(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("Invalid sync pull " + field + ".");
  }
}

function validateChange(value: unknown): SyncPullChangeRecord {
  if (!isRecord(value)) throw new Error("Invalid sync pull change.");
  const allowed = ["sequence", "entityType", "lessonId", "entityId", "revision", "isDeleted", "payload"];
  if (Object.keys(value).some((key) => !allowed.includes(key)) ||
      allowed.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error("Sync pull change contains missing or unsupported fields.");
  }
  assertSequence(value.sequence, "change sequence");
  if (value.sequence < 1) throw new Error("Sync pull change sequence must be positive.");
  if (value.entityType !== "lesson" && value.entityType !== "note" &&
      value.entityType !== "quiz" && value.entityType !== "attempt") {
    throw new Error("Unsupported sync pull entity type.");
  }
  if (typeof value.lessonId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.lessonId) ||
      typeof value.entityId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.entityId)) {
    throw new Error("Invalid sync pull entity identity.");
  }
  if (value.entityType === "lesson" && value.entityId !== value.lessonId) {
    throw new Error("Lesson pull identity must use the lesson ID.");
  }
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1 ||
      typeof value.isDeleted !== "boolean") {
    throw new Error("Invalid sync pull revision or deletion state.");
  }
  if (value.isDeleted && value.payload !== null) {
    throw new Error("Deleted sync pull records cannot contain learner content.");
  }
  if (!value.isDeleted && (!isRecord(value.payload) || value.payload === null)) {
    throw new Error("Active sync pull records require a payload.");
  }

  // Reuse the mutation boundary's DTO allow-list and nested size validation.
  // These fixed IDs are validation scaffolding only; no identity is returned.
  validateSyncServerRequest({
    protocolVersion: 1,
    requestId: "11111111-1111-4111-8111-111111111111",
    deviceId: "22222222-2222-4222-8222-222222222222",
    entityType: value.entityType,
    lessonId: value.lessonId,
    entityId: value.entityId,
    operation: value.isDeleted ? "delete" : "upsert",
    baseRevision: (value.revision as number) - 1,
    payloadSchemaVersion: 1,
    payload: value.payload
  });

  return value as unknown as SyncPullChangeRecord;
}

/**
 * Validates a category-scoped pull page. The cursor is intentionally opaque:
 * only the server can authenticate and interpret it. fromSequence must match
 * the caller's locally committed scan watermark.
 */
export function validateSyncPullPage(
  value: unknown,
  expectedCategory: SyncCategory,
  expectedFromSequence: number
): SyncPullPage {
  if (!VALID_CATEGORIES.includes(expectedCategory)) throw new Error("Invalid sync pull category.");
  assertSequence(expectedFromSequence, "expected cursor sequence");
  if (!isRecord(value)) throw new Error("Invalid sync pull page.");
  const allowed = [
    "protocolVersion", "category", "fromSequence", "snapshotSequence",
    "scannedThroughSequence", "changes", "hasMore", "nextCursor"
  ];
  if (Object.keys(value).some((key) => !allowed.includes(key)) ||
      allowed.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error("Sync pull page contains missing or unsupported fields.");
  }
  if (value.protocolVersion !== 1 || value.category !== expectedCategory) {
    throw new Error("Unsupported sync pull protocol or category mismatch.");
  }
  assertSequence(value.fromSequence, "page start sequence");
  assertSequence(value.snapshotSequence, "snapshot sequence");
  assertSequence(value.scannedThroughSequence, "scanned sequence");
  if (value.fromSequence !== expectedFromSequence ||
      (value.snapshotSequence as number) < (value.fromSequence as number) ||
      (value.scannedThroughSequence as number) < (value.fromSequence as number) ||
      (value.scannedThroughSequence as number) > (value.snapshotSequence as number)) {
    throw new Error("Sync pull page does not continue the locally committed cursor.");
  }
  if (!Array.isArray(value.changes) || value.changes.length > PAGE_MAX_CHANGES) {
    throw new Error("Sync pull page exceeds its change limit.");
  }

  for (const candidate of value.changes) {
    if (!isRecord(candidate) || candidate.entityType !== TYPE_BY_CATEGORY[expectedCategory]) {
      throw new Error("Sync pull page contains a change from another category.");
    }
  }
  const changes = value.changes.map(validateChange);
  let priorSequence = value.fromSequence as number;
  for (const change of changes) {
    if (change.sequence <= priorSequence || change.sequence > (value.scannedThroughSequence as number)) {
      throw new Error("Sync pull changes are out of order or outside the scanned range.");
    }
    if (change.entityType !== TYPE_BY_CATEGORY[expectedCategory]) {
      throw new Error("Sync pull page contains a change from another category.");
    }
    priorSequence = change.sequence;
  }

  if (typeof value.hasMore !== "boolean") throw new Error("Invalid sync pull continuation state.");
  if (typeof value.nextCursor !== "string" || value.nextCursor.length === 0 || value.nextCursor.length > CURSOR_MAX_LENGTH) {
    throw new Error("Invalid opaque sync pull cursor.");
  }
  if (!value.hasMore && value.scannedThroughSequence !== value.snapshotSequence) {
    throw new Error("A completed sync pull page must scan through its snapshot watermark.");
  }
  if (value.hasMore && value.scannedThroughSequence === value.snapshotSequence) {
    throw new Error("A completed snapshot cannot advertise another page.");
  }
  if (value.hasMore && value.scannedThroughSequence === value.fromSequence) {
    throw new Error("Sync pull page made no progress while more snapshot records remain.");
  }
  if (value.changes.length === 0 && value.scannedThroughSequence === value.fromSequence &&
      value.snapshotSequence > value.fromSequence) {
    throw new Error("A sync pull page made no progress.");
  }

  return value as unknown as SyncPullPage;
}

/** Pure policy shared by the future IndexedDB pull applier and its tests. */
export function decideSyncPullMerge(
  change: SyncPullChangeRecord,
  local: SyncPullLocalState
): SyncPullMergeAction {
  if (local.lastRemoteRevision !== null && change.revision <= local.lastRemoteRevision) {
    return "ignore_stale_change";
  }
  if (local.hasPendingLocalWrite || local.isConflicted) {
    return "preserve_local_conflict";
  }
  if (change.entityType === "lesson" && change.isDeleted && local.exists && local.hasLocalTranscript) {
    return "keep_lesson_transcript_local_only";
  }
  if (!local.exists) {
    return change.isDeleted ? "ignore_missing_tombstone" : "store_remote_only";
  }
  return "apply_remote_snapshot";
}
