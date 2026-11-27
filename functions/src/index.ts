import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAppCheck } from "firebase-admin/app-check";
import { HttpsError, onCall } from "firebase-functions/v2/https";
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

const adminApp = getApps()[0] ?? initializeApp();
const database = getFirestore(adminApp);
const appCheck = getAppCheck(adminApp);
const syncCursorHmacKey = defineSecret("SYNC_CURSOR_HMAC_KEY");
const turnstileSecret = defineSecret("TURNSTILE_SECRET");
const challengeAppId = defineString("APP_CHECK_CHALLENGE_APP_ID");
const challengeHostname = defineString("APP_CHECK_CHALLENGE_HOSTNAME");
const challengeAction = defineString("APP_CHECK_CHALLENGE_ACTION", { default: "learnlens_app_check" });
const challengeBootstrapEnabled = defineBoolean("APP_CHECK_CHALLENGE_ENABLED", { default: false });

function toHttpsError(cause: unknown): HttpsError {
  if (cause instanceof SyncBackendError) {
    return new HttpsError(cause.code, cause.message);
  }
  // Do not log or return request payloads, note bodies, quiz keys, or tokens.
  console.error("LearnLens sync backend failed", cause instanceof Error ? cause.name : "unknown");
  return new HttpsError("internal", "LearnLens could not complete the sync request.");
}

/** Requires Firebase Auth and a verified email for bootstrap operations. */
function requireVerifiedChallengeUser(
  auth: { uid: string; token: { email_verified?: unknown } } | null | undefined
): string {
  if (!auth || typeof auth.uid !== "string") {
    throw new SyncBackendError("unauthenticated", "Sign in before starting the security challenge.");
  }
  if (auth.token?.email_verified !== true) {
    throw new SyncBackendError("failed-precondition", "Verify your email address before continuing the security challenge.");
  }
  return auth.uid;
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
 * Bootstrap: requires Firebase Authentication and verified email, but not
 * App Check because this operation creates the session needed to obtain the
 * first App Check token. This is isolated from all sync callables.
 */
export const createAppCheckChallengeSession = onCall(
  { enforceAppCheck: false, maxInstances: 3, memory: "256MiB" },
  async (request) => {
    try {
      assertChallengeBootstrapEnabled(challengeBootstrapEnabled.value());
      const uid = requireVerifiedChallengeUser(request.auth);
      return await createAuthenticatedChallengeSession(
        uid,
        {
          appId: challengeAppId.value(),
          action: challengeAction.value()
        },
        database
      );
    } catch (cause) {
      throw toHttpsError(cause);
    }
  }
);

/**
 * Authenticated challenge completion. The hosted challenge page returns the
 * short-lived Turnstile response to the extension; the extension calls this
 * callable with its Firebase Auth context. Firebase credentials are never
 * passed to the hosted challenge page.
 */
export const completeAppCheckChallenge = onCall(
  {
    enforceAppCheck: false,
    maxInstances: 3,
    memory: "256MiB",
    timeoutSeconds: 20,
    secrets: [turnstileSecret]
  },
  async (request) => {
    try {
      assertChallengeBootstrapEnabled(challengeBootstrapEnabled.value());
      const uid = requireVerifiedChallengeUser(request.auth);
      const data = request.data as unknown;
      if (
        data === null || typeof data !== "object" || Array.isArray(data) ||
        Object.keys(data as Record<string, unknown>).length !== 2 ||
        typeof (data as Record<string, unknown>).sessionId !== "string" ||
        typeof (data as Record<string, unknown>).responseToken !== "string"
      ) {
        throw new SyncBackendError("invalid-argument", "The challenge completion request is invalid.");
      }
      const { sessionId, responseToken } = data as {
        sessionId: string;
        responseToken: string;
      };
      if (responseToken.length === 0 || responseToken.length > 2048) {
        throw new SyncBackendError("invalid-argument", "A valid Turnstile response is required.");
      }
      return await completeAuthenticatedChallengeSession(
        uid,
        { sessionId, responseToken },
        {
          appId: challengeAppId.value(),
          action: challengeAction.value(),
          hostname: challengeHostname.value(),
          secret: turnstileSecret.value()
        },
        database
      );
    } catch (cause) {
      throw toHttpsError(cause);
    }
  }
);

/**
 * Authenticated one-time claim. App Check is not required because no App
 * Check token has been minted yet. This consumes the session only; token
 * minting is intentionally a later implementation slice.
 */
export const claimAppCheckChallengeSession = onCall(
  { enforceAppCheck: false, maxInstances: 3, memory: "256MiB" },
  async (request) => {
    try {
      assertChallengeBootstrapEnabled(challengeBootstrapEnabled.value());
      const uid = requireVerifiedChallengeUser(request.auth);
      const data = request.data as unknown;
      if (
        data === null || typeof data !== "object" || Array.isArray(data) ||
        Object.keys(data as Record<string, unknown>).length !== 2 ||
        typeof (data as Record<string, unknown>).sessionId !== "string" ||
        typeof (data as Record<string, unknown>).pollCredential !== "string"
      ) {
        throw new SyncBackendError("invalid-argument", "The challenge claim request is invalid.");
      }
      const { sessionId, pollCredential } = data as {
        sessionId: string;
        pollCredential: string;
      };
      return await issueAuthenticatedAppCheckToken(
        uid,
        sessionId,
        pollCredential,
        challengeAppId.value(),
        challengeAction.value(),
        appCheck,
        database
      );
    } catch (cause) {
      throw toHttpsError(cause);
    }
  }
);
