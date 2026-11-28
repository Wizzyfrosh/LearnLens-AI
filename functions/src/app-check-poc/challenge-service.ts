import type { Firestore } from "firebase-admin/firestore";
import { SyncBackendError } from "../errors";
import { enforceChallengeRateLimit } from "./challenge-rate-limit";
import { consumeGlobalChallengeBudget } from "./global-challenge-budget";
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
  nowMs = Date.now(),
  globalBudgetEnabled = false
) {
  await enforceChallengeRateLimit("create", uid, database, nowMs);
  if (globalBudgetEnabled) await consumeGlobalChallengeBudget(database, { nowMs });
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
  fetchImpl?: typeof fetch,
  globalBudgetEnabled = false
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

  if (globalBudgetEnabled) await consumeGlobalChallengeBudget(database, { nowMs });

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

export interface AppCheckTokenIssuer {
  createToken(
    appId: string,
    options: { ttlMillis: number }
  ): Promise<{ token: string; ttlMillis: number }>;
}

const APP_CHECK_TOKEN_TTL_MS = 30 * 60 * 1000;
const APP_CHECK_TOKEN_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Consumes one verified session and mints one Firebase App Check token.
 *
 * The App ID/action are compared against trusted server configuration before
 * the irreversible consume transition. Once consumed, any minting failure
 * requires a fresh challenge; this method never reopens or replays a session.
 */
export async function issueAuthenticatedAppCheckToken(
  uid: string,
  sessionId: unknown,
  pollCredential: unknown,
  expectedAppId: string,
  expectedAction: string,
  tokenIssuer: AppCheckTokenIssuer,
  database: Firestore,
  nowMs = Date.now(),
  globalBudgetEnabled = false
): Promise<{ token: string; expireTimeMillis: number }> {
  if (typeof uid !== "string" || uid.length === 0 || uid.length > 128) {
    throw new SyncBackendError("unauthenticated", "Sign in before requesting an App Check token.");
  }
  if (
    typeof expectedAppId !== "string" ||
    expectedAppId.length < 8 ||
    expectedAppId.length > 256 ||
    typeof expectedAction !== "string" ||
    !/^[a-z][a-z0-9_-]{0,31}$/.test(expectedAction)
  ) {
    throw new SyncBackendError("failed-precondition", "The App Check challenge configuration is invalid.");
  }

  await enforceChallengeRateLimit("claim", uid, database, nowMs);

  const context = await getChallengeVerificationContext(sessionId, database);
  if (context.uid !== uid) {
    throw new SyncBackendError("permission-denied", "The challenge session does not belong to this account.");
  }
  if (context.state !== "verified") {
    throw new SyncBackendError("failed-precondition", "The challenge has not been verified or was already consumed.");
  }
  if (context.expiresAtMs <= nowMs) {
    throw new SyncBackendError("deadline-exceeded", "The challenge session has expired.");
  }
  if (context.appId !== expectedAppId || context.action !== expectedAction) {
    throw new SyncBackendError("failed-precondition", "The challenge session does not match the configured Firebase app.");
  }

  if (globalBudgetEnabled) await consumeGlobalChallengeBudget(database, { nowMs });

  const consumed = await consumeChallengeSession(
    uid,
    sessionId,
    pollCredential,
    database,
    nowMs
  );
  if (consumed.appId !== expectedAppId || consumed.action !== expectedAction) {
    // Immutable session fields are checked both before and during the claim.
    throw new SyncBackendError("failed-precondition", "The consumed challenge session configuration is invalid.");
  }

  let issued: { token: string; ttlMillis: number };
  try {
    issued = await tokenIssuer.createToken(consumed.appId, {
      ttlMillis: APP_CHECK_TOKEN_TTL_MS
    });
  } catch {
    // Do not log the token issuer error or any credential material.
    throw new SyncBackendError(
      "unavailable",
      "Firebase could not issue the App Check token. Start a new security challenge."
    );
  }

  if (
    !issued ||
    typeof issued.token !== "string" ||
    issued.token.length === 0 ||
    issued.token.length > 16_384 ||
    !Number.isSafeInteger(issued.ttlMillis) ||
    issued.ttlMillis < APP_CHECK_TOKEN_TTL_MS ||
    issued.ttlMillis > APP_CHECK_TOKEN_MAX_TTL_MS
  ) {
    throw new SyncBackendError(
      "unavailable",
      "Firebase returned an invalid App Check token response. Start a new security challenge."
    );
  }

  return {
    token: issued.token,
    expireTimeMillis: nowMs + issued.ttlMillis
  };
}
