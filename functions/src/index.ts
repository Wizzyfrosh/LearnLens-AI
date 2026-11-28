import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAppCheck } from "firebase-admin/app-check";
import { getAuth } from "firebase-admin/auth";
import type { Request, Response } from "express";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { defineBoolean, defineSecret, defineString } from "firebase-functions/params";
import { requireVerifiedAppCaller } from "./auth-guards";
import { SyncBackendError } from "./errors";
import { applySyncMutation } from "./sync-mutation";
import { getSyncSettingsForAccount, saveSyncSettingsForAccount } from "./sync-settings";
import { pullSyncChanges } from "./sync-pull";
import {
  issueAuthenticatedAppCheckToken,
  completeAuthenticatedChallengeSession,
  createAuthenticatedChallengeSession,
  assertChallengeBootstrapEnabled
} from "./app-check-poc/challenge-service";
import {
  assertChallengeHttpPostJson,
  challengeHttpStatus,
  getChallengeCorsHeaders,
  parseExactChallengeBody,
  requireVerifiedChallengeHttpUser
} from "./app-check-poc/challenge-http";

const adminApp = getApps()[0] ?? initializeApp();
const database = getFirestore(adminApp);
const adminAuth = getAuth(adminApp);
const appCheck = getAppCheck(adminApp);
const syncCursorHmacKey = defineSecret("SYNC_CURSOR_HMAC_KEY");
const turnstileSecret = defineSecret("TURNSTILE_SECRET");
const challengeAppId = defineString("APP_CHECK_CHALLENGE_APP_ID");
const challengeHostname = defineString("APP_CHECK_CHALLENGE_HOSTNAME");
const challengeAction = defineString("APP_CHECK_CHALLENGE_ACTION", { default: "learnlens_app_check" });
const challengeBootstrapEnabled = defineBoolean("APP_CHECK_CHALLENGE_ENABLED", { default: false });
const challengeGlobalBudgetEnabled = defineBoolean("APP_CHECK_CHALLENGE_GLOBAL_BUDGET_ENABLED", { default: false });
const challengeExtensionOrigin = defineString("APP_CHECK_CHALLENGE_EXTENSION_ORIGIN", { default: "" });

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
 * Shared transport boundary for the App Check bootstrap endpoints.
 *
 * These use plain authenticated HTTP rather than https.onCall. The Firebase
 * Functions client SDK attaches App Check tokens to callable requests when
 * an App Check instance exists. Calling a callable from CustomProvider.getToken
 * would invoke this same provider recursively during initial token acquisition.
 */
async function handleChallengeHttpRequest(
  request: Request,
  response: Response,
  handler: (uid: string) => Promise<unknown>
): Promise<void> {
  // These endpoints return single-use session credentials and App Check tokens.
  // Ensure browsers, shared proxies and intermediary caches never retain them.
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");

  const corsHeaders = getChallengeCorsHeaders(
    request.headers.origin,
    challengeExtensionOrigin.value()
  );
  if (!corsHeaders) {
    response.status(403).json({
      error: { code: "permission-denied", message: "This extension origin is not authorized." }
    });
    return;
  }

  for (const [name, value] of Object.entries(corsHeaders)) {
    response.setHeader(name, value);
  }

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  try {
    assertChallengeHttpPostJson({
      method: request.method,
      headers: request.headers,
      body: request.body,
      rawBody: "rawBody" in request && request.rawBody instanceof Uint8Array
        ? request.rawBody
        : undefined
    });
    assertChallengeBootstrapEnabled(challengeBootstrapEnabled.value());

    const uid = await requireVerifiedChallengeHttpUser(
      request.headers.authorization,
      (idToken) => adminAuth.verifyIdToken(idToken, true)
    );
    const result = await handler(uid);
    response.status(200).json({ data: result });
  } catch (cause) {
    if (cause instanceof SyncBackendError) {
      response.status(challengeHttpStatus(cause.code)).json({
        error: { code: cause.code, message: cause.message }
      });
      return;
    }
    console.error(
      "LearnLens challenge HTTP endpoint failed",
      cause instanceof Error ? cause.name : "unknown"
    );
    response.status(500).json({
      error: { code: "internal", message: "The security challenge could not be completed." }
    });
  }
}

/**
 * Creates a short-lived challenge session.
 *
 * Request: POST { "data": {} } is not used here; the plain HTTP contract is
 * an exact empty JSON object. Authentication is a verified Firebase ID token
 * in the Authorization bearer header. No App Check token is required.
 */
export const createAppCheckChallengeSession = onRequest(
  { cors: false, maxInstances: 3, memory: "256MiB", timeoutSeconds: 15 },
  async (request, response) => {
    await handleChallengeHttpRequest(request, response, async (uid) => {
      parseExactChallengeBody(request.body, []);
      return createAuthenticatedChallengeSession(
        uid,
        {
          appId: challengeAppId.value(),
          action: challengeAction.value()
        },
        database,
        Date.now(),
        challengeGlobalBudgetEnabled.value()
      );
    });
  }
);

/**
 * Verifies the one-time Turnstile response with Cloudflare Siteverify.
 * The Firebase ID token is sent directly by the extension; it is never
 * exposed to the hosted Turnstile page.
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
    await handleChallengeHttpRequest(request, response, async (uid) => {
      const data = parseExactChallengeBody(request.body, ["sessionId", "responseToken"]);
      if (
        typeof data.sessionId !== "string" ||
        typeof data.responseToken !== "string" ||
        data.responseToken.length === 0 ||
        data.responseToken.length > 2048
      ) {
        throw new SyncBackendError("invalid-argument", "The challenge completion request is invalid.");
      }
      return completeAuthenticatedChallengeSession(
        uid,
        { sessionId: data.sessionId, responseToken: data.responseToken },
        {
          appId: challengeAppId.value(),
          action: challengeAction.value(),
          hostname: challengeHostname.value(),
          secret: turnstileSecret.value()
        },
        database,
        Date.now(),
        undefined,
        challengeGlobalBudgetEnabled.value()
      );
    });
  }
);

/**
 * Atomically consumes the verified challenge session and issues one App Check
 * token. The request is authenticated by Firebase ID token, avoiding a
 * callable's implicit App Check lookup during CustomProvider.getToken().
 */
export const claimAppCheckChallengeSession = onRequest(
  { cors: false, maxInstances: 3, memory: "256MiB", timeoutSeconds: 20 },
  async (request, response) => {
    await handleChallengeHttpRequest(request, response, async (uid) => {
      const data = parseExactChallengeBody(request.body, ["sessionId", "pollCredential"]);
      if (
        typeof data.sessionId !== "string" ||
        typeof data.pollCredential !== "string"
      ) {
        throw new SyncBackendError("invalid-argument", "The challenge claim request is invalid.");
      }
      return issueAuthenticatedAppCheckToken(
        uid,
        data.sessionId,
        data.pollCredential,
        challengeAppId.value(),
        challengeAction.value(),
        appCheck,
        database,
        Date.now(),
        challengeGlobalBudgetEnabled.value()
      );
    });
  }
);
