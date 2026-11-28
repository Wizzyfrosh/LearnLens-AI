import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertChallengeHttpPostJson,
  challengeHttpStatus,
  getChallengeCorsHeaders,
  parseExactChallengeBody,
  readChallengeBearerToken,
  requireVerifiedChallengeHttpUser
} from "../src/app-check-poc/challenge-http";
import { SyncBackendError } from "../src/errors";

const ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const ID_TOKEN = "a".repeat(160) + ".payload.signature";

describe("Authenticated challenge HTTP boundary", () => {
  it("returns CORS headers only for the exact configured extension origin", () => {
    const headers = getChallengeCorsHeaders(ORIGIN, ORIGIN);
    assert.equal(headers?.["Access-Control-Allow-Origin"], ORIGIN);
    assert.equal(headers?.["Access-Control-Allow-Methods"], "POST, OPTIONS");
    assert.equal(headers?.["Access-Control-Allow-Headers"], "Authorization, Content-Type");
    assert.equal(getChallengeCorsHeaders("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ORIGIN), null);
    assert.equal(getChallengeCorsHeaders("https://attacker.example", ORIGIN), null);
    assert.equal(getChallengeCorsHeaders(ORIGIN, ""), null);
    assert.equal(getChallengeCorsHeaders(ORIGIN, "*"), null);
  });

  it("requires POST with JSON and rejects oversized request bodies", () => {
    assert.doesNotThrow(() => assertChallengeHttpPostJson({
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", "content-length": "2" },
      body: {}
    }));
    assert.throws(
      () => assertChallengeHttpPostJson({ method: "GET", headers: {}, body: {} }),
      (error: unknown) => error instanceof SyncBackendError && error.code === "invalid-argument"
    );
    assert.throws(
      () => assertChallengeHttpPostJson({ method: "POST", headers: { "content-type": "text/plain" }, body: {} }),
      (error: unknown) => error instanceof SyncBackendError && error.code === "invalid-argument"
    );
    assert.throws(
      () => assertChallengeHttpPostJson({
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "9000" },
        body: {}
      }),
      (error: unknown) => error instanceof SyncBackendError && error.code === "invalid-argument"
    );
  });

  it("rejects a large raw body even when Content-Length is absent", () => {
    await assert.rejects(
      Promise.resolve().then(() => assertChallengeHttpPostJson({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: {},
        rawBody: new Uint8Array(9000)
      })),
      (error: unknown) => error instanceof SyncBackendError && error.code === "invalid-argument"
    );
  });

  it("accepts only a syntactically valid Firebase Bearer token", () => {
    assert.equal(readChallengeBearerToken("Bearer " + ID_TOKEN), ID_TOKEN);
    for (const value of [undefined, "", "Basic " + ID_TOKEN, "Bearer short", "Bearer " + "x".repeat(9000)]) {
      assert.throws(
        () => readChallengeBearerToken(value),
        (error: unknown) => error instanceof SyncBackendError && error.code === "unauthenticated"
      );
    }
  });

  it("verifies the ID token server-side and returns only its UID", async () => {
    let checkedToken = "";
    const uid = await requireVerifiedChallengeHttpUser("Bearer " + ID_TOKEN, async (token) => {
      checkedToken = token;
      return { uid: "verified-user-1", email_verified: true };
    });
    assert.equal(checkedToken, ID_TOKEN);
    assert.equal(uid, "verified-user-1");
  });

  it("rejects an unverified email claim", async () => {
    await assert.rejects(
      requireVerifiedChallengeHttpUser("Bearer " + ID_TOKEN, async () => ({
        uid: "unverified-user",
        email_verified: false
      })),
      (error: unknown) => error instanceof SyncBackendError && error.code === "failed-precondition"
    );
  });

  it("maps invalid/revoked ID tokens to a sanitized unauthenticated error", async () => {
    await assert.rejects(
      requireVerifiedChallengeHttpUser("Bearer " + ID_TOKEN, async () => {
        throw new Error("private auth verification details");
      }),
      (error: unknown) => error instanceof SyncBackendError &&
        error.code === "unauthenticated" &&
        !error.message.includes("private")
    );
  });

  it("requires an exact request body shape", () => {
    assert.deepEqual(parseExactChallengeBody({}, []), {});
    assert.deepEqual(parseExactChallengeBody({ sessionId: "session", token: "response" }, ["sessionId", "token"]), {
      sessionId: "session",
      token: "response"
    });
    for (const value of [
      null,
      [],
      { sessionId: "session", token: "response", uid: "attacker" },
      { sessionId: "session" }
    ]) {
      assert.throws(
        () => parseExactChallengeBody(value, ["sessionId", "token"]),
        (error: unknown) => error instanceof SyncBackendError && error.code === "invalid-argument"
      );
    }
  });

  it("maps application errors to bounded HTTP response statuses", () => {
    assert.equal(challengeHttpStatus("invalid-argument"), 400);
    assert.equal(challengeHttpStatus("unauthenticated"), 401);
    assert.equal(challengeHttpStatus("permission-denied"), 403);
    assert.equal(challengeHttpStatus("resource-exhausted"), 429);
    assert.equal(challengeHttpStatus("unavailable"), 503);
    assert.equal(challengeHttpStatus("internal"), 500);
  });
});
