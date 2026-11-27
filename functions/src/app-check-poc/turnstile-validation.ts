import { SyncBackendError } from "../errors";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN_LENGTH = 2048;
const TOKEN_MAX_AGE_MS = 5 * 60 * 1000;
const ALLOWED_FUTURE_SKEW_MS = 30 * 1000;

export interface TurnstileValidationExpectation {
  secret: string;
  expectedHostname: string;
  expectedAction: string;
  expectedCdata: string;
  nowMs?: number;
  fetchImpl?: typeof fetch;
}

interface SiteverifyResponse {
  success?: unknown;
  hostname?: unknown;
  action?: unknown;
  cdata?: unknown;
  challenge_ts?: unknown;
  "error-codes"?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validates a Turnstile response at the server boundary.
 *
 * This function deliberately does not create/consume a challenge session or
 * mint App Check tokens. Callers must perform their own atomic one-time
 * session transition after this check succeeds.
 */
export async function verifyTurnstileResponse(
  responseToken: unknown,
  expectation: TurnstileValidationExpectation
): Promise<{ verifiedAtMs: number; challengeAtMs: number }> {
  if (
    typeof expectation.secret !== "string" ||
    expectation.secret.length === 0 ||
    typeof expectation.expectedHostname !== "string" ||
    expectation.expectedHostname.length === 0 ||
    typeof expectation.expectedAction !== "string" ||
    expectation.expectedAction.length === 0 ||
    typeof expectation.expectedCdata !== "string" ||
    expectation.expectedCdata.length === 0
  ) {
    throw new SyncBackendError("failed-precondition", "Turnstile verification is not configured.");
  }

  if (
    typeof responseToken !== "string" ||
    responseToken.length === 0 ||
    responseToken.length > MAX_TOKEN_LENGTH
  ) {
    throw new SyncBackendError("invalid-argument", "A valid Turnstile response is required.");
  }

  const fetchImpl = expectation.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const body = new URLSearchParams({
      secret: expectation.secret,
      response: responseToken
    });
    const httpResponse = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal
    });

    if (!httpResponse.ok) {
      throw new SyncBackendError("unavailable", "Turnstile verification service is unavailable.");
    }

    let result: unknown;
    try {
      result = await httpResponse.json();
    } catch {
      throw new SyncBackendError("unavailable", "Turnstile returned an unreadable verification response.");
    }

    if (!isRecord(result)) {
      throw new SyncBackendError("unavailable", "Turnstile returned an invalid verification response.");
    }

    const verification = result as SiteverifyResponse;
    if (verification.success !== true) {
      throw new SyncBackendError("permission-denied", "Turnstile verification was not successful.");
    }
    if (verification.hostname !== expectation.expectedHostname) {
      throw new SyncBackendError("permission-denied", "Turnstile hostname verification failed.");
    }
    if (verification.action !== expectation.expectedAction) {
      throw new SyncBackendError("permission-denied", "Turnstile action verification failed.");
    }
    if (verification.cdata !== expectation.expectedCdata) {
      throw new SyncBackendError("permission-denied", "Turnstile challenge-session binding failed.");
    }

    if (typeof verification.challenge_ts !== "string") {
      throw new SyncBackendError("permission-denied", "Turnstile challenge timestamp is missing.");
    }
    const challengeAtMs = Date.parse(verification.challenge_ts);
    const verifiedAtMs = expectation.nowMs ?? Date.now();
    if (!Number.isFinite(challengeAtMs)) {
      throw new SyncBackendError("permission-denied", "Turnstile challenge timestamp is invalid.");
    }
    const ageMs = verifiedAtMs - challengeAtMs;
    if (ageMs < -ALLOWED_FUTURE_SKEW_MS || ageMs > TOKEN_MAX_AGE_MS) {
      throw new SyncBackendError("permission-denied", "Turnstile challenge response is expired or not yet valid.");
    }

    return { verifiedAtMs, challengeAtMs };
  } catch (cause) {
    if (cause instanceof SyncBackendError) throw cause;
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new SyncBackendError("unavailable", "Turnstile verification timed out.");
    }
    throw new SyncBackendError("unavailable", "Turnstile verification could not be completed.");
  } finally {
    clearTimeout(timeout);
  }
}
