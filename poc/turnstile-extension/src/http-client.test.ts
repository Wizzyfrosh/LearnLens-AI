import { describe, expect, it, vi } from "vitest";
import {
  ChallengeHttpClient,
  type ChallengeAuthUser
} from "./http-client";

const TOKEN = "eyJ" + "a".repeat(150) + ".payload.signature";
const SESSION = {
  sessionId: "8a3f2a1b-2f7c-4d9a-8d2f-7a5f4b3c2d1e",
  pollCredential: "A".repeat(43),
  cdata: "B".repeat(43),
  action: "learnlens_app_check",
  appId: "1:123456789:web:learnlens",
  createdAtMs: 1_800_000_000_000,
  expiresAtMs: 1_800_000_300_000
};

function user(emailVerified = true): ChallengeAuthUser {
  return {
    emailVerified,
    getIdToken: vi.fn(async () => TOKEN)
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("ChallengeHttpClient", () => {
  it("posts the Firebase ID token in Authorization and sends only the operation payload", async () => {
    const currentUser = user();
    let captured: RequestInit | undefined;
    let url = "";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      captured = init;
      return jsonResponse(SESSION);
    });
    const client = new ChallengeHttpClient({
      functionsBaseUrl: "https://us-central1-demo-project.cloudfunctions.net",
      getCurrentUser: () => currentUser,
      fetchImpl
    });
    const created = await client.createChallengeSession();

    expect(created).toEqual(SESSION);
    expect(url).toBe("https://us-central1-demo-project.cloudfunctions.net/createAppCheckChallengeSession");
    expect(captured?.method).toBe("POST");
    expect(captured?.credentials).toBe("omit");
    expect(captured?.cache).toBe("no-store");
    expect(new Headers(captured?.headers).get("authorization")).toBe("Bearer " + TOKEN);
    expect(captured?.body).toBe("{}");
    expect(String(captured?.body)).not.toContain(TOKEN);
  });

  it("sends only session ID and Turnstile response during completion", async () => {
    let body = "";
    let headers = new Headers();
    const client = new ChallengeHttpClient({
      functionsBaseUrl: "https://us-central1-demo-project.cloudfunctions.net",
      getCurrentUser: () => user(),
      fetchImpl: async (_url, init) => {
        body = String(init?.body);
        headers = new Headers(init?.headers);
        return jsonResponse({ verified: true, expiresAtMs: SESSION.expiresAtMs });
      }
    });
    await client.completeChallenge(SESSION.sessionId, "turnstile-one-time-response");
    expect(JSON.parse(body)).toEqual({
      sessionId: SESSION.sessionId,
      responseToken: "turnstile-one-time-response"
    });
    expect(headers.get("authorization")).toBe("Bearer " + TOKEN);
  });

  it("parses a valid claim response but does not persist the token", async () => {
    const response = { token: "firebase-app-check-token", expireTimeMillis: 1_800_001_800_000 };
    const client = new ChallengeHttpClient({
      functionsBaseUrl: "https://us-central1-demo-project.cloudfunctions.net",
      getCurrentUser: () => user(),
      now: () => 1_800_000_000_000,
      fetchImpl: async () => jsonResponse(response)
    });
    await expect(client.claimAppCheckToken(SESSION.sessionId, SESSION.pollCredential)).resolves.toEqual(response);
  });

  it("rejects malformed session and token responses", async () => {
    const invalidSession = new ChallengeHttpClient({
      functionsBaseUrl: "https://us-central1-demo-project.cloudfunctions.net",
      getCurrentUser: () => user(),
      fetchImpl: async () => jsonResponse({ ...SESSION, uid: "must-not-be-returned" })
    });
    await expect(invalidSession.createChallengeSession()).rejects.toThrow("invalid challenge session");

    const invalidToken = new ChallengeHttpClient({
      functionsBaseUrl: "https://us-central1-demo-project.cloudfunctions.net",
      getCurrentUser: () => user(),
      now: () => 1_800_000_000_000,
      fetchImpl: async () => jsonResponse({ token: "", expireTimeMillis: 1_800_001_800_000 })
    });
    await expect(invalidToken.claimAppCheckToken(SESSION.sessionId, SESSION.pollCredential))
      .rejects.toThrow("invalid App Check token");
  });

  it("fails before network access if there is no authenticated verified user", async () => {
    const fetchImpl = vi.fn();
    const noUser = new ChallengeHttpClient({
      functionsBaseUrl: "https://us-central1-demo-project.cloudfunctions.net",
      getCurrentUser: () => null,
      fetchImpl
    });
    await expect(noUser.createChallengeSession()).rejects.toThrow("Sign in");
    expect(fetchImpl).not.toHaveBeenCalled();

    const unverified = new ChallengeHttpClient({
      functionsBaseUrl: "https://us-central1-demo-project.cloudfunctions.net",
      getCurrentUser: () => user(false),
      fetchImpl
    });
    await expect(unverified.createChallengeSession()).rejects.toThrow("Verify your email");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allows the Firebase Functions Emulator path only on localhost", async () => {
    let url = "";
    const client = new ChallengeHttpClient({
      functionsBaseUrl: "http://127.0.0.1:5001/demo-learnlens/us-central1/",
      getCurrentUser: () => user(),
      fetchImpl: async (input) => {
        url = String(input);
        return jsonResponse(SESSION);
      }
    });
    await client.createChallengeSession();
    expect(url).toBe("http://127.0.0.1:5001/demo-learnlens/us-central1/createAppCheckChallengeSession");
  });

  it("rejects insecure or malformed Functions base URLs", () => {
    const valid = { getCurrentUser: () => user() };
    expect(() => new ChallengeHttpClient({ ...valid, functionsBaseUrl: "http://example.com" })).toThrow("HTTPS");
    expect(() => new ChallengeHttpClient({ ...valid, functionsBaseUrl: "http://127.0.0.1:5001/invalid" })).toThrow("emulator");
    expect(() => new ChallengeHttpClient({ ...valid, functionsBaseUrl: "https://example.com/path" })).toThrow("HTTPS");
    expect(() => new ChallengeHttpClient({ ...valid, functionsBaseUrl: "https://user:pass@example.com" })).toThrow("HTTPS");
  });

  it("builds endpoint URLs beneath a validated local Functions Emulator base", async () => {
    let requestedUrl = "";
    const client = new ChallengeHttpClient({
      functionsBaseUrl: "http://127.0.0.1:5001/demo-project/us-central1",
      getCurrentUser: () => user(),
      fetchImpl: async (input) => {
        requestedUrl = String(input);
        return jsonResponse(SESSION);
      }
    });
    await client.createChallengeSession();
    expect(requestedUrl).toBe("http://127.0.0.1:5001/demo-project/us-central1/createAppCheckChallengeSession");
  });

  it("surfaces bounded server errors without exposing an unbounded response body", async () => {
    const client = new ChallengeHttpClient({
      functionsBaseUrl: "https://us-central1-demo-project.cloudfunctions.net",
      getCurrentUser: () => user(),
      fetchImpl: async () => new Response(
        JSON.stringify({ error: { code: "failed-precondition", message: "Verify your email address first." } }),
        { status: 412, headers: { "content-type": "application/json" } }
      )
    });
    await expect(client.createChallengeSession()).rejects.toThrow("Verify your email address first.");
  });
});
