import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyTurnstileResponse } from "../src/app-check-poc/turnstile-validation";
import { SyncBackendError } from "../src/errors";

const NOW = Date.parse("2026-11-27T12:00:00.000Z");
const expectation = {
  secret: "server-only-test-secret",
  expectedHostname: "verify.example.test",
  expectedAction: "learnlens_app_check",
  expectedCdata: "opaque-session-binding",
  nowMs: NOW
};

function siteverifyResponse(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    success: true,
    hostname: expectation.expectedHostname,
    action: expectation.expectedAction,
    cdata: expectation.expectedCdata,
    challenge_ts: new Date(NOW - 10_000).toISOString(),
    ...overrides
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function fakeFetch(response: Response, inspect?: (url: string, init?: RequestInit) => void): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    inspect?.(String(input), init);
    return response;
  }) as typeof fetch;
}

describe("Turnstile server-side response validation", () => {
  it("accepts a fresh token only when hostname, action and cdata all match", async () => {
    const result = await verifyTurnstileResponse("valid-token", {
      ...expectation,
      fetchImpl: fakeFetch(siteverifyResponse())
    });
    assert.equal(result.verifiedAtMs, NOW);
    assert.equal(result.challengeAtMs, NOW - 10_000);
  });

  it("sends the secret and response only to Cloudflare Siteverify in the POST body", async () => {
    let inspected = false;
    await verifyTurnstileResponse("valid-token", {
      ...expectation,
      fetchImpl: fakeFetch(siteverifyResponse(), (url, init) => {
        inspected = true;
        assert.equal(url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
        assert.equal(init?.method, "POST");
        assert.equal(init?.headers && (init.headers as Record<string, string>)["content-type"], "application/x-www-form-urlencoded");
        const body = init?.body as URLSearchParams;
        assert.equal(body.get("secret"), expectation.secret);
        assert.equal(body.get("response"), "valid-token");
        assert.equal(url.includes(expectation.secret), false);
      })
    });
    assert.equal(inspected, true);
  });

  it("rejects missing, non-string and oversized response tokens before network access", async () => {
    const neverFetch = (async () => { throw new Error("must not call network"); }) as typeof fetch;
    for (const token of [null, "", 12, "x".repeat(2049)]) {
      await assert.rejects(
        verifyTurnstileResponse(token, { ...expectation, fetchImpl: neverFetch }),
        (error: unknown) => error instanceof SyncBackendError
      );
    }
  });

  it("rejects unsuccessful Siteverify responses", async () => {
    await assert.rejects(
      verifyTurnstileResponse("token", {
        ...expectation,
        fetchImpl: fakeFetch(siteverifyResponse({ success: false }))
      }),
      /Turnstile verification was not successful/
    );
  });

  it("rejects hostname, action and session-binding mismatches", async () => {
    for (const override of [
      { hostname: "attacker.example.test" },
      { action: "different_action" },
      { cdata: "different-session" }
    ]) {
      await assert.rejects(
        verifyTurnstileResponse("token", {
          ...expectation,
          fetchImpl: fakeFetch(siteverifyResponse(override))
        }),
        SyncBackendError
      );
    }
  });

  it("rejects invalid, expired and implausibly future challenge timestamps", async () => {
    for (const challenge_ts of [
      "not-a-date",
      new Date(NOW - 301_000).toISOString(),
      new Date(NOW + 31_000).toISOString()
    ]) {
      await assert.rejects(
        verifyTurnstileResponse("token", {
          ...expectation,
          fetchImpl: fakeFetch(siteverifyResponse({ challenge_ts }))
        }),
        SyncBackendError
      );
    }
  });

  it("rejects non-success HTTP and malformed JSON responses", async () => {
    await assert.rejects(
      verifyTurnstileResponse("token", {
        ...expectation,
        fetchImpl: fakeFetch(new Response("unavailable", { status: 503 }))
      }),
      /Turnstile verification service is unavailable/
    );
    await assert.rejects(
      verifyTurnstileResponse("token", {
        ...expectation,
        fetchImpl: fakeFetch(new Response("not-json", { status: 200 }))
      }),
      /unreadable verification response/
    );
  });

  it("fails closed when required server configuration is absent", async () => {
    await assert.rejects(
      verifyTurnstileResponse("token", {
        ...expectation,
        secret: "",
        fetchImpl: fakeFetch(siteverifyResponse())
      }),
      /Turnstile verification is not configured/
    );
  });
});
