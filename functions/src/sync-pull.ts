import { createHmac, timingSafeEqual } from "node:crypto";
import {
  Timestamp,
  type Firestore,
  type QueryDocumentSnapshot
} from "firebase-admin/firestore";
import { canonicalizeSyncServerValue } from "../../src/services/sync-server-contract";
import type {
  SyncCategory,
  SyncEntityType,
  SyncPreparedPayload
} from "../../src/services/session-store";
import {
  validateSyncPullPage,
  type SyncPullChangeRecord,
  type SyncPullPage
} from "../../src/services/sync-pull-contract";
import { SyncBackendError } from "./errors";

const PAGE_SIZE = 100;
const MAX_SCANNED_EVENTS = 500;
const MAX_PULL_PAYLOAD_BYTES = 4 * 1024 * 1024;
const MAX_CURSOR_LENGTH = 2048;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CATEGORIES: SyncCategory[] = ["lessonMetadata", "notes", "quizzes", "attempts"];
const ENTITY_BY_CATEGORY: Record<SyncCategory, SyncEntityType> = {
  lessonMetadata: "lesson",
  notes: "note",
  quizzes: "quiz",
  attempts: "attempt"
};

interface SyncPullRequest {
  protocolVersion: 1;
  deviceId: string;
  category: SyncCategory;
  cursor: string | null;
}

interface SignedCursor {
  version: 1;
  uid: string;
  deviceId: string;
  category: SyncCategory;
  snapshotSequence: number;
  scannedThroughSequence: number;
}

interface SyncSettings {
  enabled: boolean;
  categories: Record<SyncCategory, boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidArgument(message: string): never {
  throw new SyncBackendError("invalid-argument", message);
}

function invalidState(message: string): never {
  throw new SyncBackendError("failed-precondition", message);
}

function assertSequence(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalidState("The server sync feed has an invalid " + label + ".");
  }
}

function parseRequest(value: unknown): SyncPullRequest {
  if (!isRecord(value)) invalidArgument("Invalid sync pull request.");
  const allowed = ["protocolVersion", "deviceId", "category", "cursor"];
  if (
    Object.keys(value).length !== allowed.length ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    allowed.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) invalidArgument("Sync pull request contains missing or unsupported fields.");

  if (value.protocolVersion !== 1) invalidArgument("Unsupported sync pull protocol version.");
  if (typeof value.deviceId !== "string" || !UUID_V4_PATTERN.test(value.deviceId)) {
    invalidArgument("Invalid sync device ID.");
  }
  if (typeof value.category !== "string" || !CATEGORIES.includes(value.category as SyncCategory)) {
    invalidArgument("Invalid sync pull category.");
  }
  if (
    value.cursor !== null &&
    (typeof value.cursor !== "string" || value.cursor.length === 0 || value.cursor.length > MAX_CURSOR_LENGTH)
  ) invalidArgument("Invalid opaque sync pull cursor.");

  return {
    protocolVersion: 1,
    deviceId: value.deviceId,
    category: value.category as SyncCategory,
    cursor: value.cursor as string | null
  };
}

function parseSettings(value: unknown, category: SyncCategory): SyncSettings {
  if (!isRecord(value)) invalidState("Cloud sync has not been enabled for this account.");
  const allowed = ["schemaVersion", "enabled", "categories", "updatedAt"];
  if (
    Object.keys(value).length !== allowed.length ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    allowed.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    value.schemaVersion !== 1 ||
    typeof value.enabled !== "boolean" ||
    !(value.updatedAt instanceof Timestamp) ||
    !isRecord(value.categories)
  ) invalidState("The account sync settings are invalid.");

  const categoryKeys: SyncCategory[] = ["lessonMetadata", "notes", "quizzes", "attempts"];
  if (
    Object.keys(value.categories).length !== categoryKeys.length ||
    Object.keys(value.categories).some((key) => !categoryKeys.includes(key as SyncCategory)) ||
    categoryKeys.some((key) => typeof value.categories![key] !== "boolean")
  ) invalidState("The account sync categories are invalid.");

  const categories = value.categories as Record<SyncCategory, boolean>;
  if (categories.attempts && !categories.quizzes) {
    invalidState("Quiz attempts require Quiz definitions to be enabled.");
  }
  if (!value.enabled || !categories[category]) {
    invalidState("This sync category is not enabled for the account.");
  }
  return { enabled: true, categories };
}

function getSigningKey(secret: string): Buffer {
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    invalidState("The server sync cursor signing secret is not configured correctly.");
  }
  return Buffer.from(secret, "utf8");
}

function signCursor(payload: SignedCursor, secret: string): string {
  const key = getSigningKey(secret);
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", key).update(encoded, "utf8").digest("base64url");
  const token = encoded + "." + signature;
  if (token.length > MAX_CURSOR_LENGTH) invalidState("The generated sync cursor is too large.");
  return token;
}

function verifyCursor(
  token: string,
  uid: string,
  request: SyncPullRequest,
  secret: string
): SignedCursor {
  const key = getSigningKey(secret);
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
      !/^[A-Za-z0-9_-]+$/.test(parts[1])) {
    invalidArgument("The sync pull cursor is malformed.");
  }

  const expectedSignature = createHmac("sha256", key).update(parts[0], "utf8").digest();
  const suppliedSignature = Buffer.from(parts[1], "base64url");
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) invalidArgument("The sync pull cursor signature is invalid.");

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    invalidArgument("The sync pull cursor payload is invalid.");
  }
  if (!isRecord(decoded)) invalidArgument("The sync pull cursor payload is invalid.");
  const allowed = ["version", "uid", "deviceId", "category", "snapshotSequence", "scannedThroughSequence"];
  if (
    Object.keys(decoded).length !== allowed.length ||
    Object.keys(decoded).some((key) => !allowed.includes(key)) ||
    allowed.some((key) => !Object.prototype.hasOwnProperty.call(decoded, key)) ||
    decoded.version !== 1 ||
    typeof decoded.uid !== "string" ||
    typeof decoded.deviceId !== "string" ||
    typeof decoded.category !== "string"
  ) invalidArgument("The sync pull cursor payload is invalid.");

  assertSequence(decoded.snapshotSequence, "cursor snapshot sequence");
  assertSequence(decoded.scannedThroughSequence, "cursor scan sequence");
  if (decoded.scannedThroughSequence > decoded.snapshotSequence) {
    invalidArgument("The sync pull cursor is outside its snapshot.");
  }
  if (decoded.uid !== uid || decoded.deviceId !== request.deviceId || decoded.category !== request.category) {
    throw new SyncBackendError("permission-denied", "This sync pull cursor belongs to another account, device, or category.");
  }
  return decoded as unknown as SignedCursor;
}

interface SyncFeedEnvelope {
  sequence: number;
  entityType: SyncEntityType;
  lessonId: string;
  entityId: string;
  revision: number;
  isDeleted: boolean;
  payloadRef: string | null;
  payloadBytes: number;
}

function parseFeedDocument(
  document: QueryDocumentSnapshot,
  expectedSequence: number
): SyncFeedEnvelope {
  const value = document.data();
  const allowed = ["sequence", "entityType", "lessonId", "entityId", "revision", "isDeleted", "payloadRef", "payloadBytes"];
  if (
    !isRecord(value) ||
    Object.keys(value).length !== allowed.length ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    allowed.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) invalidState("The account change feed contains an unsupported record.");

  assertSequence(value.sequence, "feed event sequence");
  if (
    value.sequence !== expectedSequence ||
    document.id !== String(expectedSequence) ||
    (value.entityType !== "lesson" && value.entityType !== "note" &&
      value.entityType !== "quiz" && value.entityType !== "attempt") ||
    typeof value.lessonId !== "string" || !ID_PATTERN.test(value.lessonId) ||
    typeof value.entityId !== "string" || !ID_PATTERN.test(value.entityId) ||
    !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 ||
    typeof value.isDeleted !== "boolean" ||
    !Number.isSafeInteger(value.payloadBytes) || (value.payloadBytes as number) < 0 ||
    (value.payloadBytes as number) > 512 * 1024 ||
    (value.isDeleted
      ? value.payloadRef !== null || value.payloadBytes !== 0
      : value.payloadRef !== String(expectedSequence) || value.payloadBytes === 0)
  ) invalidState("The account change feed contains a malformed record.");

  if (value.entityType === "lesson" && value.entityId !== value.lessonId) {
    invalidState("The account change feed contains a malformed lesson identity.");
  }
  return {
    sequence: value.sequence,
    entityType: value.entityType,
    lessonId: value.lessonId,
    entityId: value.entityId,
    revision: value.revision as number,
    isDeleted: value.isDeleted,
    payloadRef: value.payloadRef as string | null,
    payloadBytes: value.payloadBytes as number
  };
}

async function readPayloadSnapshot(
  database: Firestore,
  root: string,
  envelope: SyncFeedEnvelope
): Promise<SyncPreparedPayload> {
  const snapshot = await database.doc(
    root + "/syncChangePayloads/" + String(envelope.sequence)
  ).get();
  if (!snapshot.exists) invalidState("The account change feed is missing a payload snapshot.");
  const value = snapshot.data();
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    value.sequence !== envelope.sequence ||
    !Object.prototype.hasOwnProperty.call(value, "payload") ||
    !isRecord(value.payload)
  ) invalidState("The account change feed payload snapshot is malformed.");
  const actualBytes = Buffer.byteLength(canonicalizeSyncServerValue(value.payload), "utf8");
  if (actualBytes !== envelope.payloadBytes) {
    invalidState("The account change feed payload snapshot failed its integrity check.");
  }
  return value.payload as SyncPreparedPayload;
}

function readSnapshotSequence(value: unknown): number {
  if (value === undefined) return 0;
  if (!isRecord(value)) invalidState("The account change-feed counter is malformed.");
  assertSequence(value.lastSequence, "last sequence");
  return value.lastSequence;
}

/**
 * Reads a fixed, account-scoped feed snapshot. Signed cursors bind progress to
 * the authenticated UID, installation device, category, and original snapshot.
 * The final checkpoint is reused to open the next snapshot on the next call.
 */
export async function pullSyncChanges(
  uid: string,
  input: unknown,
  database: Firestore,
  cursorSecret: string
): Promise<SyncPullPage> {
  if (!ID_PATTERN.test(uid)) {
    throw new SyncBackendError("permission-denied", "The authenticated account ID is invalid.");
  }
  const request = parseRequest(input);
  getSigningKey(cursorSecret);
  const cursor = request.cursor
    ? verifyCursor(request.cursor, uid, request, cursorSecret)
    : null;

  const root = "users/" + uid;
  const settingsRef = database.doc(root + "/settings/sync");
  const counterRef = database.doc(root + "/syncState/changeFeed");
  const feed = database.collection(root + "/syncChanges");

  const plan = await database.runTransaction(async (transaction) => {
    const settingsDocument = await transaction.get(settingsRef);
    parseSettings(settingsDocument.data(), request.category);

    const fromSequence = cursor?.scannedThroughSequence ?? 0;
    let snapshotSequence = cursor?.snapshotSequence ?? 0;
    const cursorCompleted = cursor === null ||
      cursor.scannedThroughSequence === cursor.snapshotSequence;

    if (cursorCompleted) {
      const counterDocument = await transaction.get(counterRef);
      snapshotSequence = readSnapshotSequence(
        counterDocument.exists ? counterDocument.data() : undefined
      );
      if (snapshotSequence < fromSequence) {
        invalidState("The account change-feed counter moved backwards.");
      }
    }

    let scannedThroughSequence = fromSequence;
    const selectedEnvelopes: SyncFeedEnvelope[] = [];

    if (snapshotSequence > fromSequence) {
      const query = feed
        .select("sequence", "entityType", "lessonId", "entityId", "revision", "isDeleted", "payloadRef", "payloadBytes")
        .where("sequence", ">", fromSequence)
        .where("sequence", "<=", snapshotSequence)
        .orderBy("sequence", "asc")
        .limit(MAX_SCANNED_EVENTS);
      const page = await transaction.get(query);
      let reachedPageLimit = false;
      let payloadBytes = 0;

      for (const document of page.docs) {
        const nextSequence = scannedThroughSequence + 1;
        const envelope = parseFeedDocument(document, nextSequence);
        if (envelope.entityType === ENTITY_BY_CATEGORY[request.category]) {
          if (payloadBytes + envelope.payloadBytes > MAX_PULL_PAYLOAD_BYTES) {
            // Do not advance past this event. The next cursor will retry it.
            reachedPageLimit = true;
            break;
          }
          selectedEnvelopes.push(envelope);
          payloadBytes += envelope.payloadBytes;
          scannedThroughSequence = envelope.sequence;
          if (selectedEnvelopes.length >= PAGE_SIZE || payloadBytes >= MAX_PULL_PAYLOAD_BYTES) {
            reachedPageLimit = true;
            break;
          }
        } else {
          // Other categories carry no learner payload in the feed metadata.
          scannedThroughSequence = envelope.sequence;
        }
      }

      if (!reachedPageLimit && page.docs.length < MAX_SCANNED_EVENTS) {
        if (scannedThroughSequence !== snapshotSequence) {
          invalidState("The account change feed has a missing sequence inside its snapshot.");
        }
      }
    }

    const hasMore = scannedThroughSequence < snapshotSequence;
    const nextCursor = signCursor({
      version: 1,
      uid,
      deviceId: request.deviceId,
      category: request.category,
      snapshotSequence,
      scannedThroughSequence
    }, cursorSecret);

    return {
      fromSequence,
      snapshotSequence,
      scannedThroughSequence,
      hasMore,
      nextCursor,
      selectedEnvelopes
    };
  });

  // Feed events and their payload snapshots are committed atomically and are
  // immutable. Read only the selected snapshots, in parallel, after the
  // bounded metadata transaction has chosen a payload-byte budget.
  const payloadBySequence = new Map<number, SyncPreparedPayload>();
  const payloadEnvelopes = plan.selectedEnvelopes.filter((item) => !item.isDeleted);
  const payloads = await Promise.all(
    payloadEnvelopes.map((item) => readPayloadSnapshot(database, root, item))
  );
  payloadEnvelopes.forEach((item, index) => payloadBySequence.set(item.sequence, payloads[index]));

  const changes: SyncPullChangeRecord[] = plan.selectedEnvelopes.map((item) => ({
    sequence: item.sequence,
    entityType: item.entityType,
    lessonId: item.lessonId,
    entityId: item.entityId,
    revision: item.revision,
    isDeleted: item.isDeleted,
    payload: item.isDeleted ? null : payloadBySequence.get(item.sequence) ?? null
  }));

  const response = {
    protocolVersion: 1 as const,
    category: request.category,
    fromSequence: plan.fromSequence,
    snapshotSequence: plan.snapshotSequence,
    scannedThroughSequence: plan.scannedThroughSequence,
    changes,
    hasMore: plan.hasMore,
    nextCursor: plan.nextCursor
  };
  return validateSyncPullPage(response, request.category, plan.fromSequence);
}
