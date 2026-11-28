import { describe, expect, it } from "vitest";
import {
  isAllowedExtensionOrigin,
  parseAllowedExtensionOrigins,
  parseTurnstileControlMessage,
  parseTurnstileInitMessage,
  TURNSTILE_MESSAGE_VERSION
} from "./protocol";

const extensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const requestId = "8a3f2a1b-2f7c-4d9a-8d2f-7a5f4b3c2d1e";
const validInit = {
  type: "LEARNLENS_TURNSTILE_INIT",
  version: TURNSTILE_MESSAGE_VERSION,
  requestId,
  siteKey: "0x4AAAAAAAExamplePublicSiteKey",
  action: "learnlens_app_check",
  cdata: "0123456789abcdefghijklmnopqrstuvABCDEFG"
};

describe("Turnstile hosted-page message contract", () => {
  it("accepts only exact Chrome extension origins in the deployment allowlist", () => {
    const origins = parseAllowedExtensionOrigins(
      extensionOrigin + ", https://example.com, chrome-extension://invalid"
    );
    expect(origins).toEqual([extensionOrigin]);
    expect(isAllowedExtensionOrigin(extensionOrigin, origins)).toBe(true);
    expect(isAllowedExtensionOrigin("https://example.com", origins)).toBe(false);
  });

  it("rejects wildcard and malformed parent-origin configuration", () => {
    expect(parseAllowedExtensionOrigins("*")).toEqual([]);
    expect(parseAllowedExtensionOrigins("chrome-extension://abcdefghijklmnop")).toEqual([]);
    expect(parseAllowedExtensionOrigins("chrome-extension://abcdefghijklmnopabcdefghijklmnopa")).toEqual([]);
  });

  it("accepts a valid init only from the iframe's direct, allowlisted parent", () => {
    expect(parseTurnstileInitMessage(validInit, extensionOrigin, true, [extensionOrigin])).toEqual(validInit);
    expect(parseTurnstileInitMessage(validInit, extensionOrigin, false, [extensionOrigin])).toBeNull();
    expect(parseTurnstileInitMessage(validInit, "https://attacker.example", true, [extensionOrigin])).toBeNull();
  });

  it("rejects extra fields so credentials cannot accidentally cross the page boundary", () => {
    expect(parseTurnstileInitMessage(
      { ...validInit, pollCredential: "must-not-be-sent" },
      extensionOrigin,
      true,
      [extensionOrigin]
    )).toBeNull();
    expect(parseTurnstileInitMessage(
      { ...validInit, sessionId: "must-not-be-sent" },
      extensionOrigin,
      true,
      [extensionOrigin]
    )).toBeNull();
  });

  it("rejects malformed IDs, site keys, actions and cdata", () => {
    for (const invalid of [
      { ...validInit, requestId: "not-a-uuid" },
      { ...validInit, siteKey: "short" },
      { ...validInit, action: "LearnLens-App-Check" },
      { ...validInit, action: "a".repeat(33) },
      { ...validInit, cdata: "contains spaces" },
      { ...validInit, version: 2 },
      { ...validInit, cdata: "x".repeat(256) }
    ]) {
      expect(parseTurnstileInitMessage(invalid, extensionOrigin, true, [extensionOrigin])).toBeNull();
    }
  });

  it("accepts reset/cancel only for the active request ID and protocol version", () => {
    expect(parseTurnstileControlMessage({
      type: "LEARNLENS_TURNSTILE_RESET",
      version: TURNSTILE_MESSAGE_VERSION,
      requestId
    }, requestId)).toBe("reset");
    expect(parseTurnstileControlMessage({
      type: "LEARNLENS_TURNSTILE_CANCEL",
      version: TURNSTILE_MESSAGE_VERSION,
      requestId
    }, requestId)).toBe("cancel");
    expect(parseTurnstileControlMessage({
      type: "LEARNLENS_TURNSTILE_RESET",
      version: TURNSTILE_MESSAGE_VERSION,
      requestId: "other"
    }, requestId)).toBeNull();
    expect(parseTurnstileControlMessage({
      type: "LEARNLENS_TURNSTILE_RESET",
      version: TURNSTILE_MESSAGE_VERSION,
      requestId,
      pollCredential: "must-not-cross-the-page-boundary"
    }, requestId)).toBeNull();
  });
});
