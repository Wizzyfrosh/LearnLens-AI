import { SyncBackendError } from "../errors";

export interface ChallengeHttpRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  rawBody?: Uint8Array;
}

export interface VerifiedChallengeIdentity {
  uid: string;
  email_verified?: unknown;
}

export type IdTokenVerifier = (idToken: string) => Promise<VerifiedChallengeIdentity>;

const EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/[a-p]{32}$/;
const BEARER_TOKEN_PATTERN = /^[A-Za-z0-9._~-]+$/;
const MAX_HTTP_BODY_BYTES = 8 * 1024;
const MAX_ID_TOKEN_LENGTH = 8192;

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const value = headers[name.toLowerCase()] ?? headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Returns CORS headers only for one configured extension origin.
 * Origin is a browser boundary, never an authentication mechanism.
 */
export function getChallengeCorsHeaders(
  requestOrigin: string | undefined,
  configuredExtensionOrigin: string
): Record<string, string> | null {
  if (
    typeof requestOrigin !== "string" ||
    !EXTENSION_ORIGIN_PATTERN.test(configuredExtensionOrigin) ||
    requestOrigin !== configuredExtensionOrigin
  ) return null;

  return {
    "Access-Control-Allow-Origin": configuredExtensionOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
}

export function assertChallengeHttpPostJson(request: ChallengeHttpRequest): void {
  if (request.method !== "POST") {
    throw new SyncBackendError("invalid-argument", "Only POST requests are supported.");
  }

  const contentType = headerValue(request.headers, "content-type") ?? "";
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType.trim())) {
    throw new SyncBackendError("invalid-argument", "Content-Type must be application/json.");
  }

  const contentLength = headerValue(request.headers, "content-length");
  if (contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_HTTP_BODY_BYTES) {
      throw new SyncBackendError("invalid-argument", "The challenge request body is too large or malformed.");
    }
  }

  const actualLength = request.rawBody?.byteLength ??
    Buffer.byteLength(JSON.stringify(request.body ?? null), "utf8");
  if (actualLength > MAX_HTTP_BODY_BYTES) {
    throw new SyncBackendError("invalid-argument", "The challenge request body is too large.");
  }
}

export function readChallengeBearerToken(authorization: string | undefined): string {
  if (typeof authorization !== "string" || authorization.length > MAX_ID_TOKEN_LENGTH + 7) {
    throw new SyncBackendError("unauthenticated", "Sign in before continuing the security challenge.");
  }
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization);
  const token = match?.[1];
  if (!token || token.length < 100 || token.length > MAX_ID_TOKEN_LENGTH || !BEARER_TOKEN_PATTERN.test(token)) {
    throw new SyncBackendError("unauthenticated", "A valid Firebase ID token is required.");
  }
  return token;
}

export async function requireVerifiedChallengeHttpUser(
  authorization: string | undefined,
  verifyIdToken: IdTokenVerifier
): Promise<string> {
  const idToken = readChallengeBearerToken(authorization);
  let identity: VerifiedChallengeIdentity;
  try {
    identity = await verifyIdToken(idToken);
  } catch {
    throw new SyncBackendError("unauthenticated", "Your sign-in session is invalid or expired. Sign in again.");
  }

  if (
    !identity ||
    typeof identity.uid !== "string" ||
    identity.uid.length === 0 ||
    identity.uid.length > 128
  ) {
    throw new SyncBackendError("unauthenticated", "Your sign-in session is invalid or expired. Sign in again.");
  }
  if (identity.email_verified !== true) {
    throw new SyncBackendError("failed-precondition", "Verify your email address before continuing the security challenge.");
  }
  return identity.uid;
}

export function parseExactChallengeBody(
  body: unknown,
  expectedKeys: readonly string[]
): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new SyncBackendError("invalid-argument", "The challenge request body is invalid.");
  }
  const data = body as Record<string, unknown>;
  if (
    Object.keys(data).length !== expectedKeys.length ||
    Object.keys(data).some((key) => !expectedKeys.includes(key)) ||
    expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(data, key))
  ) {
    throw new SyncBackendError("invalid-argument", "The challenge request body contains unexpected or missing fields.");
  }
  return data;
}

export function challengeHttpStatus(code: SyncBackendError["code"]): number {
  switch (code) {
    case "invalid-argument": return 400;
    case "unauthenticated": return 401;
    case "permission-denied": return 403;
    case "not-found": return 404;
    case "already-exists": return 409;
    case "deadline-exceeded": return 410;
    case "failed-precondition": return 412;
    case "resource-exhausted": return 429;
    case "unavailable": return 503;
    case "internal": return 500;
  }
}
