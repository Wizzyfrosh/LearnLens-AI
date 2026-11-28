export const TURNSTILE_MESSAGE_VERSION = 1 as const;

export interface TurnstileInitMessage {
  type: "LEARNLENS_TURNSTILE_INIT";
  version: typeof TURNSTILE_MESSAGE_VERSION;
  requestId: string;
  siteKey: string;
  action: string;
  cdata: string;
}

export type HostedPageMessage =
  | { type: "LEARNLENS_TURNSTILE_READY"; version: typeof TURNSTILE_MESSAGE_VERSION }
  | { type: "LEARNLENS_TURNSTILE_INIT_ACCEPTED"; version: typeof TURNSTILE_MESSAGE_VERSION; requestId: string }
  | { type: "LEARNLENS_TURNSTILE_TOKEN"; version: typeof TURNSTILE_MESSAGE_VERSION; requestId: string; token: string }
  | { type: "LEARNLENS_TURNSTILE_EXPIRED"; version: typeof TURNSTILE_MESSAGE_VERSION; requestId: string }
  | { type: "LEARNLENS_TURNSTILE_ERROR"; version: typeof TURNSTILE_MESSAGE_VERSION; requestId: string; code: "invalid_init" | "script_unavailable" | "widget_error" | "already_initialized" }
  | { type: "LEARNLENS_TURNSTILE_RESET"; version: typeof TURNSTILE_MESSAGE_VERSION; requestId: string }
  | { type: "LEARNLENS_TURNSTILE_CANCEL"; version: typeof TURNSTILE_MESSAGE_VERSION; requestId: string };

const EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/[a-p]{32}$/;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CDATA_PATTERN = /^[A-Za-z0-9_-]{16,255}$/;
const ACTION_PATTERN = /^[a-z][a-z0-9_]{2,31}$/;

export function parseAllowedExtensionOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((part) => part.trim()).filter((origin) =>
    EXTENSION_ORIGIN_PATTERN.test(origin)
  ))];
}

export function isAllowedExtensionOrigin(
  origin: string,
  allowedOrigins: readonly string[]
): boolean {
  return EXTENSION_ORIGIN_PATTERN.test(origin) && allowedOrigins.includes(origin);
}

export function parseTurnstileInitMessage(
  value: unknown,
  origin: string,
  sourceIsParent: boolean,
  allowedOrigins: readonly string[]
): TurnstileInitMessage | null {
  if (!sourceIsParent || !isAllowedExtensionOrigin(origin, allowedOrigins)) return null;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;

  const data = value as Record<string, unknown>;
  const expectedKeys = ["type", "version", "requestId", "siteKey", "action", "cdata"];
  if (
    Object.keys(data).length !== expectedKeys.length ||
    Object.keys(data).some((key) => !expectedKeys.includes(key)) ||
    expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(data, key)) ||
    data.type !== "LEARNLENS_TURNSTILE_INIT" ||
    data.version !== TURNSTILE_MESSAGE_VERSION ||
    typeof data.requestId !== "string" ||
    !REQUEST_ID_PATTERN.test(data.requestId) ||
    typeof data.siteKey !== "string" ||
    data.siteKey.length < 16 ||
    data.siteKey.length > 256 ||
    typeof data.action !== "string" ||
    !ACTION_PATTERN.test(data.action) ||
    typeof data.cdata !== "string" ||
    !CDATA_PATTERN.test(data.cdata)
  ) {
    return null;
  }

  return {
    type: "LEARNLENS_TURNSTILE_INIT",
    version: TURNSTILE_MESSAGE_VERSION,
    requestId: data.requestId,
    siteKey: data.siteKey,
    action: data.action,
    cdata: data.cdata
  };
}

export function parseTurnstileControlMessage(
  value: unknown,
  activeRequestId: string
): "reset" | "cancel" | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (
    data.version !== TURNSTILE_MESSAGE_VERSION ||
    data.requestId !== activeRequestId
  ) return null;

  if (data.type === "LEARNLENS_TURNSTILE_RESET") return "reset";
  if (data.type === "LEARNLENS_TURNSTILE_CANCEL") return "cancel";
  return null;
}
