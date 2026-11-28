import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { SyncBackendError } from "../errors";

const SESSION_COLLECTION = "appCheckChallengeSessions";
const SESSION_TTL_MS = 5 * 60 * 1000;
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SESSION_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,128}$/;
const CDATA_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

type ChallengeSessionState = "pending" | "verified" | "consumed";

interface ChallengeSessionDocument {
  schemaVersion: 1;
  uid: string;
  appId: string;
  action: string;
  cdata: string;
  pollCredentialHash: string;
  state: ChallengeSessionState;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  verifiedAt: Timestamp | null;
  consumedAt: Timestamp | null;
}

export interface CreatedChallengeSession {
  sessionId: string;
  pollCredential: string;
  cdata: string;
  action: string;
  appId: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface ConsumedChallengeSession {
  appId: string;
  action: string;
  verifiedAtMs: number;
  consumedAtMs: number;
}

function hashCredential(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function credentialsMatch(presented: string, storedHex: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(storedHex)) return false;
  const presentedHash = hashCredential(presented);
  const storedHash = Buffer.from(storedHex, "hex");
  return timingSafeEqual(presentedHash, storedHash);
}

function assertUid(uid: string): void {
  if (!UID_PATTERN.test(uid)) {
    throw new SyncBackendError("permission-denied", "The authenticated account ID is invalid.");
  }
}

function assertSessionId(sessionId: unknown): asserts sessionId is string {
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new SyncBackendError("invalid-argument", "The challenge session ID is invalid.");
  }
}

function assertNow(nowMs: number): void {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new SyncBackendError("invalid-argument", "The challenge session time is invalid.");
  }
}

function parseSession(value: unknown): ChallengeSessionDocument {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SyncBackendError("failed-precondition", "The challenge session record is malformed.");
  }
  const data = value as Record<string, unknown>;
  const keys = [
    "schemaVersion", "uid", "appId", "action", "cdata", "pollCredentialHash",
    "state", "createdAt", "expiresAt", "verifiedAt", "consumedAt"
  ];
  if (
    Object.keys(data).length !== keys.length ||
    Object.keys(data).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(data, key))
  ) {
    throw new SyncBackendError("failed-precondition", "The challenge session record is malformed.");
  }
  if (
    data.schemaVersion !== 1 ||
    typeof data.uid !== "string" ||
    !UID_PATTERN.test(data.uid) ||
    typeof data.appId !== "string" ||
    data.appId.length < 8 ||
    data.appId.length > 256 ||
    typeof data.action !== "string" ||
    !/^[a-z][a-z0-9_-]{0,31}$/.test(data.action) ||
    typeof data.cdata !== "string" ||
    !CDATA_PATTERN.test(data.cdata) ||
    typeof data.pollCredentialHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.pollCredentialHash) ||
    !["pending", "verified", "consumed"].includes(String(data.state)) ||
    !(data.createdAt instanceof Timestamp) ||
    !(data.expiresAt instanceof Timestamp) ||
    !(data.verifiedAt === null || data.verifiedAt instanceof Timestamp) ||
    !(data.consumedAt === null || data.consumedAt instanceof Timestamp)
  ) {
    throw new SyncBackendError("failed-precondition", "The challenge session record is malformed.");
  }
  return data as unknown as ChallengeSessionDocument;
}

/**
 * Creates a short-lived challenge session for a server-authenticated user.
 * The caller must supply UID from verified Firebase Auth context and the
 * Firebase App ID/action from trusted server configuration, never request data.
 */
export async function createChallengeSession(
  uid: string,
  appId: string,
  action: string,
  database: Firestore,
  nowMs = Date.now()
): Promise<CreatedChallengeSession> {
  assertUid(uid);
  assertNow(nowMs);
  if (typeof appId !== "string" || appId.length < 8 || appId.length > 256) {
    throw new SyncBackendError("failed-precondition", "The LearnLens Firebase App ID is not configured.");
  }
  if (typeof action !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/.test(action)) {
    throw new SyncBackendError("failed-precondition", "The challenge action is not configured.");
  }

  const sessionId = randomUUID();
  const pollCredential = randomBytes(32).toString("base64url");
  const cdata = randomBytes(32).toString("base64url");
  const expiresAtMs = nowMs + SESSION_TTL_MS;
  const ref = database.doc(SESSION_COLLECTION + "/" + sessionId);

  const document: ChallengeSessionDocument = {
    schemaVersion: 1,
    uid,
    appId,
    action,
    cdata,
    pollCredentialHash: hashCredential(pollCredential).toString("hex"),
    state: "pending",
    createdAt: Timestamp.fromMillis(nowMs),
    expiresAt: Timestamp.fromMillis(expiresAtMs),
    verifiedAt: null,
    consumedAt: null
  };

  await database.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) {
      throw new SyncBackendError("already-exists", "A challenge session identifier collision occurred.");
    }
    transaction.create(ref, document);
  });

  return {
    sessionId,
    pollCredential,
    cdata,
    action,
    appId,
    createdAtMs: nowMs,
    expiresAtMs
  };
}

/**
 * Marks a session verified only after the caller has completed Cloudflare
 * Siteverify and checked hostname/action/cdata/timestamp against this session.
 * The transaction guarantees that a session can be verified only once.
 */
export async function completeChallengeSession(
  sessionId: unknown,
  verifiedCdata: unknown,
  database: Firestore,
  nowMs = Date.now()
): Promise<{ verified: true; verifiedAtMs: number; expiresAtMs: number }> {
  assertSessionId(sessionId);
  assertNow(nowMs);
  if (typeof verifiedCdata !== "string" || !CDATA_PATTERN.test(verifiedCdata)) {
    throw new SyncBackendError("permission-denied", "The challenge session binding is invalid.");
  }

  const ref = database.doc(SESSION_COLLECTION + "/" + sessionId);
  return database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) {
      throw new SyncBackendError("not-found", "The challenge session was not found.");
    }
    const session = parseSession(snapshot.data());
    if (session.state !== "pending") {
      throw new SyncBackendError("already-exists", "The challenge session has already been completed.");
    }
    if (session.expiresAt.toMillis() <= nowMs) {
      throw new SyncBackendError("deadline-exceeded", "The challenge session has expired.");
    }
    if (session.cdata !== verifiedCdata) {
      throw new SyncBackendError("permission-denied", "The challenge session binding does not match.");
    }

    transaction.update(ref, {
      state: "verified",
      verifiedAt: Timestamp.fromMillis(nowMs)
    });
    return {
      verified: true as const,
      verifiedAtMs: nowMs,
      expiresAtMs: session.expiresAt.toMillis()
    };
  });
}

/**
 * Atomically claims a verified challenge session for one token-issuance attempt.
 * The high-entropy polling credential is compared by hash; the raw credential
 * is never persisted. If token minting subsequently fails, the user must start
 * a new challenge rather than replaying this consumed session.
 */
export async function consumeChallengeSession(
  uid: string,
  sessionId: unknown,
  pollCredential: unknown,
  database: Firestore,
  nowMs = Date.now()
): Promise<ConsumedChallengeSession> {
  assertUid(uid);
  assertSessionId(sessionId);
  assertNow(nowMs);
  if (typeof pollCredential !== "string" || !TOKEN_PATTERN.test(pollCredential)) {
    throw new SyncBackendError("permission-denied", "The challenge session credentials are invalid.");
  }

  const ref = database.doc(SESSION_COLLECTION + "/" + sessionId);
  return database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) {
      throw new SyncBackendError("not-found", "The challenge session was not found.");
    }
    const session = parseSession(snapshot.data());

    if (session.uid !== uid || !credentialsMatch(pollCredential, session.pollCredentialHash)) {
      throw new SyncBackendError("permission-denied", "The challenge session credentials are invalid.");
    }
    if (session.state !== "verified" || !session.verifiedAt) {
      throw new SyncBackendError("failed-precondition", "The challenge has not been verified or was already consumed.");
    }
    if (session.expiresAt.toMillis() <= nowMs) {
      throw new SyncBackendError("deadline-exceeded", "The challenge session has expired.");
    }

    transaction.update(ref, {
      state: "consumed",
      consumedAt: Timestamp.fromMillis(nowMs)
    });
    return {
      appId: session.appId,
      action: session.action,
      verifiedAtMs: session.verifiedAt.toMillis(),
      consumedAtMs: nowMs
    };
  });
}

export interface ChallengeVerificationContext {
  uid: string;
  appId: string;
  action: string;
  cdata: string;
  expiresAtMs: number;
  state: ChallengeSessionState;
}

/** Loads only the server-owned values required before calling Siteverify. */
export async function getChallengeVerificationContext(
  sessionId: unknown,
  database: Firestore
): Promise<ChallengeVerificationContext> {
  assertSessionId(sessionId);
  const snapshot = await database.doc(SESSION_COLLECTION + "/" + sessionId).get();
  if (!snapshot.exists) {
    throw new SyncBackendError("not-found", "The challenge session was not found.");
  }
  const session = parseSession(snapshot.data());
  return {
    uid: session.uid,
    appId: session.appId,
    action: session.action,
    cdata: session.cdata,
    expiresAtMs: session.expiresAt.toMillis(),
    state: session.state
  };
}
