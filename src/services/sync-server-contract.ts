import type { SyncEntityType, SyncOperation, SyncPreparedPayload } from "./session-store";
import type { AttemptSyncDto, QuizSyncDto } from "./sync-dto";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_NOTE_BYTES = 256 * 1024;
const MAX_QUIZ_BYTES = 512 * 1024;
const MAX_ATTEMPT_BYTES = 512 * 1024;

export interface SyncServerMutationRequest {
  protocolVersion: 1;
  requestId: string;
  deviceId: string;
  entityType: SyncEntityType;
  lessonId: string;
  entityId: string;
  operation: SyncOperation;
  baseRevision: number;
  payloadSchemaVersion: 1;
  payload: SyncPreparedPayload | null;
}

export interface SyncServerEntitySnapshot {
  entityType: SyncEntityType;
  lessonId: string;
  entityId: string;
  revision: number;
  isDeleted: boolean;
  payload: SyncPreparedPayload | null;
}

export interface SyncServerReceiptSnapshot {
  requestId: string;
  requestFingerprint: string;
  outcome: "applied" | "conflict";
  resultRevision: number;
  conflictCode?: string;
}

export interface SyncServerReceiptWrite {
  requestId: string;
  requestFingerprint: string;
  deviceId: string;
  entityType: SyncEntityType;
  lessonId: string;
  entityId: string;
  operation: SyncOperation;
  baseRevision: number;
  outcome: "applied" | "conflict";
  resultRevision: number;
  conflictCode?: string;
}

export interface SyncServerConflictWrite {
  conflictId: string;
  requestId: string;
  deviceId: string;
  entityType: SyncEntityType;
  lessonId: string;
  entityId: string;
  operation: SyncOperation;
  baseRevision: number;
  remoteRevision: number;
  reason: "revision_conflict" | "entity_deleted" | "immutable_entity_exists";
  payloadSnapshot: SyncPreparedPayload | null;
  remotePayloadSnapshot: SyncPreparedPayload | null;
  remoteIsDeleted: boolean;
}

export type SyncServerDecision =
  | {
      kind: "apply";
      nextRevision: number;
      isDeleted: boolean;
      payload: SyncPreparedPayload | null;
      preserveCreatedAt: boolean;
      receipt: SyncServerReceiptWrite;
    }
  | {
      kind: "conflict";
      conflict: SyncServerConflictWrite;
      receipt: SyncServerReceiptWrite;
    }
  | {
      kind: "replay";
      outcome: "applied" | "conflict";
      resultRevision: number;
      conflictCode?: string;
    }
  | {
      kind: "reject";
      code: "invalid_request" | "invalid_fingerprint" | "idempotency_key_reused" | "corrupt_remote_record" | "entity_not_found";
    };


export interface SyncServerCategorySettings {
  attempts: boolean;
  quizzes: boolean;
}

export interface SyncServerReferencedQuiz {
  entityType: SyncEntityType;
  lessonId: string;
  entityId: string;
  revision: number;
  isDeleted: boolean;
  payload: SyncPreparedPayload | null;
}

/**
 * Attempt DTOs reference a quiz by ID. This check must run in the same
 * Firestore transaction as the attempt write, after reading the referenced
 * quiz from the same authenticated user's lesson path.
 */
export function validateSyncServerMutationDependencies(
  request: SyncServerMutationRequest,
  categories: SyncServerCategorySettings,
  referencedQuiz: SyncServerReferencedQuiz | null,
  hasActiveAttemptsForQuiz = false
): { kind: "allow" } | {
  kind: "reject";
  code: "category_not_enabled" | "quiz_category_required" | "quiz_not_found" | "quiz_deleted" | "quiz_reference_mismatch" | "quiz_has_attempts";
} {
  let validated: SyncServerMutationRequest;
  try {
    validated = validateSyncServerRequest(request);
  } catch {
    return { kind: "reject", code: "category_not_enabled" };
  }
  if (
    typeof categories.attempts !== "boolean" ||
    typeof categories.quizzes !== "boolean"
  ) return { kind: "reject", code: "category_not_enabled" };
  if (validated.entityType === "quiz" && validated.operation === "delete" && hasActiveAttemptsForQuiz) {
    return { kind: "reject", code: "quiz_has_attempts" };
  }
  if (validated.entityType !== "attempt") return { kind: "allow" };
  if (!categories.attempts) return { kind: "reject", code: "category_not_enabled" };
  if (!categories.quizzes) return { kind: "reject", code: "quiz_category_required" };
  if (validated.operation === "delete") return { kind: "allow" };

  const quizId = (validated.payload as AttemptSyncDto).quizId;
  if (!referencedQuiz) return { kind: "reject", code: "quiz_not_found" };
  if (referencedQuiz.isDeleted) return { kind: "reject", code: "quiz_deleted" };
  if (
    referencedQuiz.entityType !== "quiz" ||
    referencedQuiz.lessonId !== validated.lessonId ||
    referencedQuiz.entityId !== quizId ||
    !Number.isSafeInteger(referencedQuiz.revision) ||
    referencedQuiz.revision < 1 ||
    referencedQuiz.payload === null
  ) {
    return { kind: "reject", code: "quiz_reference_mismatch" };
  }
  try {
    validateSyncServerRequest({
      protocolVersion: 1,
      requestId: "11111111-1111-4111-8111-111111111111",
      deviceId: "22222222-2222-4222-8222-222222222222",
      entityType: "quiz",
      lessonId: referencedQuiz.lessonId,
      entityId: referencedQuiz.entityId,
      operation: "upsert",
      baseRevision: referencedQuiz.revision - 1,
      payloadSchemaVersion: 1,
      payload: referencedQuiz.payload
    });
  } catch {
    return { kind: "reject", code: "quiz_reference_mismatch" };
  }
  const quizPayload = referencedQuiz.payload as QuizSyncDto;
  const knownQuestionIds = new Set(quizPayload.questions.map((question) => question.id));
  const attemptPayload = validated.payload as AttemptSyncDto;
  if (attemptPayload.results.some((result) => !knownQuestionIds.has(result.questionId))) {
    return { kind: "reject", code: "quiz_reference_mismatch" };
  }
  return { kind: "allow" };
}

export interface SyncFirestorePaths {
  entity: string;
  receipt: string;
  conflict: string;
  device: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = []
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error("Sync request is missing a required field: " + key);
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error("Sync request contains an unsupported field: " + key);
  }
}

function assertString(value: unknown, field: string, maxLength: number, allowEmpty = true): asserts value is string {
  if (typeof value !== "string" || value.length > maxLength || (!allowEmpty && value.length === 0)) {
    throw new Error("Invalid sync " + field + ".");
  }
}

function assertId(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new Error("Invalid sync " + field + ".");
  }
}

function assertTimestamp(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("Invalid sync " + field + " timestamp.");
  }
}

function assertFiniteNonNegative(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Invalid sync " + field + ".");
  }
}

function assertPayloadSize(value: unknown, maximumBytes: number, field: string): void {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  if (encoded.byteLength > maximumBytes) throw new Error("Sync " + field + " exceeds its cloud size limit.");
}

function validateLessonPayload(value: unknown): void {
  if (!isRecord(value)) throw new Error("Invalid lesson sync payload.");
  assertExactKeys(value, ["platform", "videoId", "title", "url"]);
  if (value.platform !== "youtube" && value.platform !== "manual") throw new Error("Invalid lesson platform.");
  assertString(value.videoId, "lesson video ID", 128);
  assertString(value.title, "lesson title", 500);
  assertString(value.url, "lesson URL", 2048);
  if (value.platform === "youtube") {
    if (!ID_PATTERN.test(value.videoId) || value.url !== "https://www.youtube.com/watch?v=" + value.videoId) {
      throw new Error("YouTube lesson metadata is not canonical.");
    }
  } else {
    if (value.videoId !== "") throw new Error("Manual lessons cannot declare a YouTube video ID.");
    if (value.url !== "" && !/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{1,128}$/.test(value.url)) {
      throw new Error("Manual lesson URL is not an approved canonical YouTube URL.");
    }
  }
  assertPayloadSize(value, 16 * 1024, "lesson metadata");
}

function validateNotePayload(value: unknown): void {
  if (!isRecord(value)) throw new Error("Invalid note sync payload.");
  assertExactKeys(value, ["title", "content", "createdAtMs", "updatedAtMs"]);
  assertString(value.title, "note title", 500);
  assertString(value.content, "note content", MAX_NOTE_BYTES * 2);
  assertTimestamp(value.createdAtMs, "note creation");
  assertTimestamp(value.updatedAtMs, "note update");
  assertPayloadSize(value, MAX_NOTE_BYTES, "note");
}

function validateQuizPayload(value: unknown): void {
  if (!isRecord(value)) throw new Error("Invalid quiz sync payload.");
  assertExactKeys(
    value,
    ["title", "scope", "scopeLabel", "createdAtMs", "questions"],
    ["rangeStartSeconds", "rangeEndSeconds"]
  );
  assertString(value.title, "quiz title", 500);
  assertString(value.scopeLabel, "quiz scope label", 500);
  if (value.scope !== "whole_lesson" && value.scope !== "topic" && value.scope !== "time_range") {
    throw new Error("Invalid quiz scope.");
  }
  assertTimestamp(value.createdAtMs, "quiz creation");
  if (Object.prototype.hasOwnProperty.call(value, "rangeStartSeconds")) {
    assertFiniteNonNegative(value.rangeStartSeconds, "quiz range start");
  }
  if (Object.prototype.hasOwnProperty.call(value, "rangeEndSeconds")) {
    assertFiniteNonNegative(value.rangeEndSeconds, "quiz range end");
  }
  if (value.scope === "time_range") {
    if (typeof value.rangeStartSeconds !== "number" || typeof value.rangeEndSeconds !== "number" ||
      value.rangeEndSeconds <= value.rangeStartSeconds) {
      throw new Error("Time-range quizzes require a valid start and end.");
    }
  }
  if (!Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 10) {
    throw new Error("Quiz questions must contain between 1 and 10 items.");
  }
  const questionIds = new Set<string>();
  for (const question of value.questions) {
    if (!isRecord(question)) throw new Error("Invalid quiz question.");
    assertExactKeys(question, ["id", "type", "prompt", "options", "correctAnswer", "explanation", "topic", "evidence"]);
    assertString(question.id, "question ID", 64, false);
    if (questionIds.has(question.id)) throw new Error("Quiz question IDs must be unique.");
    questionIds.add(question.id);
    assertString(question.prompt, "question prompt", 500, false);
    assertString(question.correctAnswer, "correct answer", 500, false);
    assertString(question.explanation, "question explanation", 1200);
    assertString(question.topic, "question topic", 100);
    assertString(question.evidence, "question evidence", 500);
    if (!Array.isArray(question.options) || question.options.length > 5 ||
      !question.options.every((option) => typeof option === "string" && option.length <= 180)) {
      throw new Error("Invalid quiz answer options.");
    }
    if (question.type === "multiple_choice") {
      if (question.options.length < 3) throw new Error("Multiple-choice questions require at least three options.");
      if (!question.options.some((option) => (option as string).toLocaleLowerCase() === (question.correctAnswer as string).toLocaleLowerCase())) {
        throw new Error("Multiple-choice correct answers must match an allowed option.");
      }
    } else if (question.type === "true_false") {
      const normalized = question.options.map((option) => (option as string).toLocaleLowerCase());
      if (normalized.length !== 2 || !normalized.includes("true") || !normalized.includes("false") ||
        (question.correctAnswer !== "true" && question.correctAnswer !== "false" &&
          question.correctAnswer !== "True" && question.correctAnswer !== "False")) {
        throw new Error("True/false questions must use True and False options.");
      }
    } else if (question.type === "short_answer") {
      if (question.options.length !== 0) throw new Error("Short-answer questions cannot include answer options.");
    } else {
      throw new Error("Unsupported quiz question type.");
    }
  }
  assertPayloadSize(value, MAX_QUIZ_BYTES, "quiz");
}

function validateAttemptPayload(value: unknown): void {
  if (!isRecord(value)) throw new Error("Invalid quiz attempt sync payload.");
  assertExactKeys(value, ["quizId", "createdAtMs", "results", "objectiveScore", "objectiveTotal", "topicsToReview"]);
  assertId(value.quizId, "attempt quiz ID");
  assertTimestamp(value.createdAtMs, "attempt creation");
  assertFiniteNonNegative(value.objectiveScore, "attempt objective score");
  assertFiniteNonNegative(value.objectiveTotal, "attempt objective total");
  if (value.objectiveScore > value.objectiveTotal) throw new Error("Attempt score cannot exceed its total.");
  if (!Array.isArray(value.results) || value.results.length > 100) throw new Error("Invalid attempt results.");
  for (const result of value.results) {
    if (!isRecord(result)) throw new Error("Invalid attempt result.");
    assertExactKeys(result, ["questionId", "answer", "correct", "feedback"]);
    assertString(result.questionId, "attempt question ID", 64, false);
    assertString(result.answer, "learner answer", 2000);
    if (result.correct !== null && typeof result.correct !== "boolean") throw new Error("Invalid attempt correctness value.");
    assertString(result.feedback, "attempt feedback", 1200);
  }
  if (!Array.isArray(value.topicsToReview) || value.topicsToReview.length > 100 ||
    !value.topicsToReview.every((topic) => typeof topic === "string" && topic.length <= 100)) {
    throw new Error("Invalid attempt review topics.");
  }
  assertPayloadSize(value, MAX_ATTEMPT_BYTES, "quiz attempt");
}

/**
 * Validates untrusted JSON at the server boundary. The UID is deliberately not
 * accepted in this body; the endpoint must derive it from the verified token.
 */
export function validateSyncServerRequest(value: unknown): SyncServerMutationRequest {
  if (!isRecord(value)) throw new Error("Invalid sync request.");
  assertExactKeys(value, [
    "protocolVersion", "requestId", "deviceId", "entityType", "lessonId",
    "entityId", "operation", "baseRevision", "payloadSchemaVersion", "payload"
  ]);
  if (value.protocolVersion !== 1 || value.payloadSchemaVersion !== 1) {
    throw new Error("Unsupported sync protocol or payload schema version.");
  }
  if (typeof value.requestId !== "string" || !UUID_V4_PATTERN.test(value.requestId)) {
    throw new Error("Invalid sync request ID.");
  }
  if (typeof value.deviceId !== "string" || !UUID_V4_PATTERN.test(value.deviceId)) {
    throw new Error("Invalid sync device ID.");
  }
  if (value.entityType !== "lesson" && value.entityType !== "note" &&
    value.entityType !== "quiz" && value.entityType !== "attempt") {
    throw new Error("Unsupported sync entity type.");
  }
  assertId(value.lessonId, "lesson ID");
  assertId(value.entityId, "entity ID");
  if (value.entityType === "lesson" && value.entityId !== value.lessonId) {
    throw new Error("Lesson entity ID must equal its lesson ID.");
  }
  if (value.operation !== "upsert" && value.operation !== "delete") {
    throw new Error("Unsupported sync operation.");
  }
  if (!Number.isSafeInteger(value.baseRevision) || (value.baseRevision as number) < 0) {
    throw new Error("Invalid sync base revision.");
  }

  if (value.operation === "delete") {
    if (value.payload !== null) throw new Error("Delete requests cannot include a payload.");
  } else {
    if (value.payload === null || !isRecord(value.payload)) throw new Error("Upsert requests require a payload.");
    switch (value.entityType) {
      case "lesson": validateLessonPayload(value.payload); break;
      case "note": validateNotePayload(value.payload); break;
      case "quiz": validateQuizPayload(value.payload); break;
      case "attempt": validateAttemptPayload(value.payload); break;
    }
  }

  return value as unknown as SyncServerMutationRequest;
}

/** Canonical JSON shared by request fingerprints and immutable payload byte accounting. */
export function canonicalizeSyncServerValue(value: unknown): string {
  function canonical(item: unknown): string {
    if (item === null || typeof item !== "object") return JSON.stringify(item);
    if (Array.isArray(item)) return "[" + item.map(canonical).join(",") + "]";
    const entries = Object.entries(item as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return "{" + entries.map(([key, nested]) => JSON.stringify(key) + ":" + canonical(nested)).join(",") + "}";
  }
  return canonical(value);
}

/** Stable JSON used by the server to compute SHA-256 before opening its transaction. */
export function canonicalizeSyncServerRequest(request: SyncServerMutationRequest): string {
  return canonicalizeSyncServerValue(request);
}

/** Build paths only after parsing the request and deriving uid from verified Auth claims. */
export function buildSyncFirestorePaths(uid: string, request: SyncServerMutationRequest): SyncFirestorePaths {
  assertId(uid, "authenticated account ID");
  const validatedRequest = validateSyncServerRequest(request);
  const root = "users/" + uid;
  const lessonPath = root + "/lessons/" + validatedRequest.lessonId;
  const entity = validatedRequest.entityType === "lesson"
    ? lessonPath
    : lessonPath + "/" + ({
        note: "notes",
        quiz: "quizzes",
        attempt: "attempts"
      } as const)[validatedRequest.entityType] + "/" + validatedRequest.entityId;
  return {
    entity,
    receipt: root + "/syncReceipts/" + validatedRequest.requestId,
    conflict: root + "/syncConflicts/" + validatedRequest.requestId,
    device: root + "/devices/" + validatedRequest.deviceId
  };
}

/**
 * Pure transaction decision logic. A Firebase Admin adapter must read the
 * receipt and entity inside one Firestore transaction, call this function,
 * then atomically write the returned entity/receipt/conflict plan.
 */
export function decideSyncServerMutation(
  request: SyncServerMutationRequest,
  current: SyncServerEntitySnapshot | null,
  existingReceipt: SyncServerReceiptSnapshot | null,
  requestFingerprint: string
): SyncServerDecision {
  try {
    request = validateSyncServerRequest(request);
  } catch {
    return { kind: "reject", code: "invalid_request" };
  }
  if (!/^[a-f0-9]{64}$/i.test(requestFingerprint)) return { kind: "reject", code: "invalid_fingerprint" };
  const normalizedFingerprint = requestFingerprint.toLowerCase();

  if (existingReceipt) {
    if (existingReceipt.requestId !== request.requestId ||
      existingReceipt.requestFingerprint.toLowerCase() !== normalizedFingerprint ||
      (existingReceipt.outcome !== "applied" && existingReceipt.outcome !== "conflict") ||
      !Number.isSafeInteger(existingReceipt.resultRevision) ||
      existingReceipt.resultRevision < 0) {
      return { kind: "reject", code: "idempotency_key_reused" };
    }
    return {
      kind: "replay",
      outcome: existingReceipt.outcome,
      resultRevision: existingReceipt.resultRevision,
      ...(existingReceipt.conflictCode ? { conflictCode: existingReceipt.conflictCode } : {})
    };
  }

  const remoteRevision = current?.revision ?? 0;
  if (current && (
    current.entityType !== request.entityType ||
    current.lessonId !== request.lessonId ||
    current.entityId !== request.entityId ||
    !Number.isSafeInteger(current.revision) ||
    current.revision < 1 ||
    typeof current.isDeleted !== "boolean"
  )) {
    return { kind: "reject", code: "corrupt_remote_record" };
  }

  const receiptBase = {
    requestId: request.requestId,
    requestFingerprint: normalizedFingerprint,
    deviceId: request.deviceId,
    entityType: request.entityType,
    lessonId: request.lessonId,
    entityId: request.entityId,
    operation: request.operation,
    baseRevision: request.baseRevision
  };

  const makeConflict = (
    reason: SyncServerConflictWrite["reason"]
  ): SyncServerDecision => {
    const receipt: SyncServerReceiptWrite = {
      ...receiptBase,
      outcome: "conflict",
      resultRevision: remoteRevision,
      conflictCode: reason
    };
    return {
      kind: "conflict",
      conflict: {
        conflictId: request.requestId,
        requestId: request.requestId,
        deviceId: request.deviceId,
        entityType: request.entityType,
        lessonId: request.lessonId,
        entityId: request.entityId,
        operation: request.operation,
        baseRevision: request.baseRevision,
        remoteRevision,
        reason,
        payloadSnapshot: request.payload,
        remotePayloadSnapshot: current?.isDeleted ? null : current?.payload ?? null,
        remoteIsDeleted: current?.isDeleted ?? false
      },
      receipt
    };
  };

  if (request.baseRevision !== remoteRevision) return makeConflict("revision_conflict");
  if (request.operation === "upsert" && current?.isDeleted) return makeConflict("entity_deleted");
  if (request.operation === "upsert" && current &&
    (request.entityType === "quiz" || request.entityType === "attempt")) {
    return makeConflict("immutable_entity_exists");
  }
  if (request.operation === "delete" && !current) {
    return { kind: "reject", code: "entity_not_found" };
  }

  const nextRevision = remoteRevision + 1;
  const receipt: SyncServerReceiptWrite = {
    ...receiptBase,
    outcome: "applied",
    resultRevision: nextRevision
  };
  return {
    kind: "apply",
    nextRevision,
    isDeleted: request.operation === "delete",
    // A delete removes learner content; the tombstone keeps only the envelope.
    payload: request.operation === "delete" ? null : request.payload,
    preserveCreatedAt: current !== null,
    receipt
  };
}
