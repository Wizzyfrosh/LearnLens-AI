import type { Firestore } from "firebase-admin/firestore";
import { SyncBackendError } from "../errors";
import { enforceChallengeRateLimit } from "./challenge-rate-limit";
import {
  completeChallengeSession,
  consumeChallengeSession,
  createChallengeSession,
  getChallengeVerificationContext
} from "./challenge-sessions";
import { verifyTurnstileResponse } from "./turnstile-validation";


/** Fail-closed deployment switch for all challenge bootstrap operations. */
export function assertChallengeBootstrapEnabled(enabled: unknown): asserts enabled is true {
  if (enabled !== true) {
    throw new SyncBackendError(
      "failed-precondition",
      "LearnLens App Check challenge bootstrap is disabled."
    );
  }
}

export interface ChallengeServerConfig {
  appId: string;
  action: string;
  hostname: string;
  secret: string;
}

export interface ChallengeCompletionInput {
  sessionId: unknown;
  responseToken: unknown;
}

/**
 * Creates a challenge only for a Firebase-authenticated, verified account.
 * The caller must pass UID from callable auth context, never request.data.
 */
export async function createAuthenticatedChallengeSession(
  uid: string,
  config: Pick<ChallengeServerConfig, "appId" | "action">,
  database: Firestore,
  nowMs = Date.now()
) {
  await enforceChallengeRateLimit("create", uid, database, nowMs);
  return createChallengeSession(uid, config.appId, config.action, database, nowMs);
}

/**
 * Completes a challenge only when the pending session belongs to the
 * authenticated caller. Cloudflare Siteverify remains server-side.
 */
export async function completeAuthenticatedChallengeSession(
  uid: string,
  input: ChallengeCompletionInput,
  config: ChallengeServerConfig,
  database: Firestore,
  nowMs = Date.now(),
  fetchImpl?: typeof fetch
): Promise<{ verified: true; expiresAtMs: number }> {
  if (typeof uid !== "string" || uid.length === 0 || uid.length > 128) {
    throw new SyncBackendError("unauthenticated", "Sign in before completing the security challenge.");
  }
  if (
    typeof input.responseToken !== "string" ||
    input.responseToken.length === 0 ||
    input.responseToken.length > 2048
  ) {
    throw new SyncBackendError("invalid-argument", "A valid Turnstile response is required.");
  }

  // Rate limiting is keyed by the verified UID, never an arbitrary client ID.
  await enforceChallengeRateLimit("complete", uid, database, nowMs);

  const context = await getChallengeVerificationContext(input.sessionId, database);
  if (context.uid !== uid) {
    throw new SyncBackendError("permission-denied", "The challenge session does not belong to this account.");
  }
  if (context.state !== "pending") {
    throw new SyncBackendError("failed-precondition", "The challenge session is no longer pending.");
  }
  if (context.expiresAtMs <= nowMs) {
    throw new SyncBackendError("deadline-exceeded", "The challenge session has expired.");
  }
  if (
    typeof config.appId !== "string" ||
    config.appId.length < 8 ||
    context.appId !== config.appId ||
    context.action !== config.action
  ) {
    throw new SyncBackendError("failed-precondition", "The challenge session configuration is invalid.");
  }

  const verified = await verifyTurnstileResponse(input.responseToken, {
    secret: config.secret,
    expectedHostname: config.hostname,
    expectedAction: context.action,
    expectedCdata: context.cdata,
    nowMs,
    fetchImpl
  });

  await completeChallengeSession(
    input.sessionId,
    context.cdata,
    database,
    verified.verifiedAtMs
  );

  return { verified: true, expiresAtMs: context.expiresAtMs };
}

/**
 * Atomically consumes a verified session for a later App Check token-mint
 * attempt. This function does not mint or return an App Check token.
 */
export async function claimAuthenticatedChallengeSession(
  uid: string,
  sessionId: unknown,
  pollCredential: unknown,
  database: Firestore,
  nowMs = Date.now()
) {
  await enforceChallengeRateLimit("claim", uid, database, nowMs);
  return consumeChallengeSession(uid, sessionId, pollCredential, database, nowMs);
}
