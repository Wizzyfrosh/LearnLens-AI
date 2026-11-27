import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { requireVerifiedAppCaller } from "./auth-guards";
import { SyncBackendError } from "./errors";
import { applySyncMutation } from "./sync-mutation";
import { getSyncSettingsForAccount, saveSyncSettingsForAccount } from "./sync-settings";
import { pullSyncChanges } from "./sync-pull";
import { createChallengeSession, completeChallengeSession, consumeChallengeSession, getChallengeVerificationContext } from "./app-check-poc/challenge-sessions";
import { enforceChallengeRateLimit } from "./app-check-poc/challenge-rate-limit";
import { verifyTurnstileResponse } from "./app-check-poc/turnstile-validation";

const adminApp = getApps()[0] ?? initializeApp();
const database = getFirestore(adminApp);
const syncCursorHmacKey = defineSecret("SYNC_CURSOR_HMAC_KEY");
const turnstileSecret = defineSecret("TURNSTILE_SECRET");
const challengeAppId = defineString("APP_CHECK_CHALLENGE_APP_ID");
const challengeHostname = defineString("APP_CHECK_CHALLENGE_HOSTNAME");
const challengeAction = defineString("APP_CHECK_CHALLENGE_ACTION", { default: "learnlens_app_check" });

function toHttpsError(cause: unknown): HttpsError {
  if (cause instanceof SyncBackendError) {
    return new HttpsError(cause.code, cause.message);
  }
  // Do not log or return request payloads, note bodies, quiz keys, or tokens.
  console.error("LearnLens sync backend failed", cause instanceof Error ? cause.name : "unknown");
  return new HttpsError("internal", "LearnLens could not complete the sync request.");
}

/**
 * Stores the account's explicit cloud-sync consent. The UID comes from the
 * verified callable context, never from request.data.
 */
export const updateSyncSettings = onCall(
  { enforceAppCheck: true, maxInstances: 5, memory: "256MiB" },
  async (request) => {
    try {
      const uid = requireVerifiedAppCaller(request.auth, request.app);
      return await saveSyncSettingsForAccount(uid, request.data, database);
    } catch (cause) {
      throw toHttpsError(cause);
    }
  }
);

/**
 * Reads only the authenticated account's persisted sync-consent state.
 * App Check and verified Auth are required just like consent updates.
 */
export const getSyncSettings = onCall(
  { enforceAppCheck: true, maxInstances: 5, memory: "256MiB" },
  async (request) => {
    try {
      const uid = requireVerifiedAppCaller(request.auth, request.app);
      return await getSyncSettingsForAccount(uid, database);
    } catch (cause) {
      throw toHttpsError(cause);
    }
  }
);

/**
 * Applies exactly one immutable local journal request. Writes, receipts,
 * conflicts, and feed sequence allocation are committed in one Firestore
 * transaction. This callable is not yet invoked by the extension.
 */
export const syncMutation = onCall(
  { enforceAppCheck: true, maxInstances: 5, memory: "256MiB", timeoutSeconds: 30 },
  async (request) => {
    try {
      const uid = requireVerifiedAppCaller(request.auth, request.app);
      return await applySyncMutation(uid, request.data, database);
    } catch (cause) {
      throw toHttpsError(cause);
    }
  }
);


/**
 * Returns a bounded, category-scoped page from one fixed account feed
 * snapshot. Signed cursor tokens are bound to UID, device and category.
 */
export const syncPull = onCall(
  {
    enforceAppCheck: true,
    maxInstances: 5,
    memory: "256MiB",
    timeoutSeconds: 30,
    secrets: [syncCursorHmacKey]
  },
  async (request) => {
    try {
      const uid = requireVerifiedAppCaller(request.auth, request.app);
      return await pullSyncChanges(uid, request.data, database, syncCursorHmacKey.value());
    } catch (cause) {
      throw toHttpsError(cause);
    }
  }
);


/**
 * Bootstrap endpoint: requires verified Firebase Auth but intentionally does
 * not require App Check, because this flow obtains the first App Check token.
 * It is isolated from all sync callables and rate-limited per authenticated UID.
 */
export const createAppCheckChallengeSession = onCall(
  { enforceAppCheck: false, maxInstances: 3, memory: "256MiB" },
  async (request) => {
    try {
      if (!request.auth || typeof request.auth.uid !== "string") {
        throw new SyncBackendError("unauthenticated", "Sign in before starting the security challenge.");
      }
      if (request.auth.token?.email_verified !== true) {
        throw new SyncBackendError("failed-precondition", "Verify your email address before starting the security challenge.");
      }
      const uid = request.auth.uid;
      await enforceChallengeRateLimit("create", uid, database);
      const created = await createChallengeSession(
        uid,
        challengeAppId.value(),
        challengeAction.value(),
        database
      );
      return created;
    } catch (cause) {
      throw toHttpsError(cause);
    }
  }
);

/**
 * Public challenge callback. Siteverify is performed server-side; callers
 * cannot choose expected hostname, action, cdata, UID or App ID.
 */
export const completeAppCheckChallenge = onRequest(
  {
    cors: false,
    maxInstances: 3,
    memory: "256MiB",
    timeoutSeconds: 20,
    secrets: [turnstileSecret]
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.set("Allow", "POST").status(405).json({ error: "method-not-allowed" });
      return;
    }
    if (!request.is("application/json")) {
      response.status(415).json({ error: "unsupported-media-type" });
      return;
    }
    try {
      const body = request.body as unknown;
      if (
        body === null || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body as Record<string, unknown>).length !== 2 ||
        typeof (body as Record<string, unknown>).sessionId !== "string" ||
        typeof (body as Record<string, unknown>).responseToken !== "string"
      ) {
        throw new SyncBackendError("invalid-argument", "The challenge completion request is invalid.");
      }
      const { sessionId, responseToken } = body as { sessionId: string; responseToken: string };
      await enforceChallengeRateLimit("complete", sessionId, database);
      const context = await getChallengeVerificationContext(sessionId, database);
      if (context.state !== "pending" || context.expiresAtMs <= Date.now()) {
        throw new SyncBackendError("deadline-exceeded", "The challenge session has expired or is no longer pending.");
      }
      if (context.appId !== challengeAppId.value() || context.action !== challengeAction.value()) {
        throw new SyncBackendError("failed-precondition", "The challenge session configuration is invalid.");
      }
      const verified = await verifyTurnstileResponse(responseToken, {
        secret: turnstileSecret.value(),
        expectedHostname: challengeHostname.value(),
        expectedAction: context.action,
        expectedCdata: context.cdata
      });
      await completeChallengeSession(sessionId, context.cdata, database, verified.verifiedAtMs);
      response.status(200).json({ verified: true, expiresAtMs: context.expiresAtMs });
    } catch (cause) {
      const error = toHttpsError(cause);
      const status = error.code === "invalid-argument" ? 400
        : error.code === "unauthenticated" ? 401
        : error.code === "permission-denied" ? 403
        : error.code === "resource-exhausted" ? 429
        : error.code === "unavailable" ? 503
        : error.code === "deadline-exceeded" ? 410
        : error.code === "not-found" ? 404
        : 400;
      response.status(status).json({ error: error.code, message: error.message });
    }
  }
);

/**
 * Authenticated one-time claim. App Check token minting is intentionally a
 * later phase; this endpoint only consumes the verified challenge session.
 */
export const claimAppCheckChallengeSession = onCall(
  { enforceAppCheck: false, maxInstances: 3, memory: "256MiB" },
  async (request) => {
    try {
      if (!request.auth || typeof request.auth.uid !== "string") {
        throw new SyncBackendError("unauthenticated", "Sign in before claiming the security challenge.");
      }
      if (request.auth.token?.email_verified !== true) {
        throw new SyncBackendError("failed-precondition", "Verify your email address before claiming the security challenge.");
      }
      const data = request.data as Record<string, unknown>;
      if (
        data === null || typeof data !== "object" || Array.isArray(data) ||
        Object.keys(data).length !== 2 ||
        typeof data.sessionId !== "string" ||
        typeof data.pollCredential !== "string"
      ) {
        throw new SyncBackendError("invalid-argument", "The challenge claim request is invalid.");
      }
      await enforceChallengeRateLimit("claim", request.auth.uid, database);
      return await consumeChallengeSession(
        request.auth.uid,
        data.sessionId,
        data.pollCredential,
        database
      );
    } catch (cause) {
      throw toHttpsError(cause);
    }
  }
);
