import { describe, expect, it, vi } from "vitest";
import { createTurnstileCustomProvider } from "./custom-provider";
import type { ChallengeHttpClient, CreatedChallengeSession } from "./types";

const SESSION: CreatedChallengeSession = {
  sessionId: "8a3f2a1b-2f7c-4d9a-8d2f-7a5f4b3c2d1e",
  pollCredential: "A".repeat(43),
  cdata: "B".repeat(43),
  action: "learnlens_app_check",
  appId: "1:123456789:web:learnlens",
  createdAtMs: Date.now(),
  expiresAtMs: Date.now() + 300_000
};

function providerHarness() {
  const client: ChallengeHttpClient = {
    createChallengeSession: vi.fn(async () => ({ ...SESSION })),
    completeChallenge: vi.fn(async () => undefined),
    claimAppCheckToken: vi.fn(async () => ({
      token: "firebase-app-check-token",
      expireTimeMillis: Date.now() + 30 * 60 * 1000
    }))
  };
  const presenter = {
    getResponse: vi.fn(async () => "turnstile-response-token")
  };
  const currentUser = {
    emailVerified: true,
    getIdToken: vi.fn(async () => "firebase-id-token")
  };
  const provider = createTurnstileCustomProvider({
    getCurrentUser: () => currentUser,
    challengeClient: client,
    challengePresenter: presenter,
    siteKey: "0x4AAAAAAAExamplePublicSiteKey"
  });
  return { provider, client, presenter, currentUser };
}

describe("LearnLens Turnstile CustomProvider coordinator", () => {
  it("returns the Firebase custom-provider token shape in the correct security order", async () => {
    const { provider, client, presenter } = providerHarness();
    const result = await provider.getToken();

    expect(result.token).toBe("firebase-app-check-token");
    expect(result.expireTimeMillis).toBeGreaterThan(Date.now());
    expect(client.createChallengeSession).toHaveBeenCalledOnce();
    expect(presenter.getResponse).toHaveBeenCalledWith({
      siteKey: "0x4AAAAAAAExamplePublicSiteKey",
      action: SESSION.action,
      cdata: SESSION.cdata
    });
    expect(client.completeChallenge).toHaveBeenCalledWith(SESSION.sessionId, "turnstile-response-token");
    expect(client.claimAppCheckToken).toHaveBeenCalledWith(SESSION.sessionId, SESSION.pollCredential);
  });

  it("coalesces concurrent getToken calls into one challenge flow", async () => {
    const { provider, client, presenter } = providerHarness();
    let release: ((value: string) => void) | undefined;
    presenter.getResponse = vi.fn(() => new Promise<string>((resolve) => {
      release = resolve;
    }));

    const first = provider.getToken();
    const second = provider.getToken();
    expect(client.createChallengeSession).toHaveBeenCalledOnce();
    expect(presenter.getResponse).toHaveBeenCalledOnce();
    release?.("turnstile-response-token");

    const [a, b] = await Promise.all([first, second]);
    expect(a.token).toBe(b.token);
    expect(client.claimAppCheckToken).toHaveBeenCalledOnce();
  });

  it("does not create a challenge for an unverified user", async () => {
    const { client } = providerHarness();
    const provider = createTurnstileCustomProvider({
      getCurrentUser: () => ({ emailVerified: false, getIdToken: async () => "firebase-id-token" }),
      challengeClient: client,
      challengePresenter: { getResponse: async () => "unused" },
      siteKey: "0x4AAAAAAAExamplePublicSiteKey"
    });
    await expect(provider.getToken()).rejects.toThrow("Verify your email");
    expect(client.createChallengeSession).not.toHaveBeenCalled();
  });

  it("does not retain its own token cache between completed provider invocations", async () => {
    const { provider, client } = providerHarness();
    await provider.getToken();
    await provider.getToken();
    expect(client.createChallengeSession).toHaveBeenCalledTimes(2);
    expect(client.claimAppCheckToken).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid provider token response", async () => {
    const { provider, client } = providerHarness();
    client.claimAppCheckToken = vi.fn(async () => ({
      token: "",
      expireTimeMillis: Date.now() + 30 * 60 * 1000
    }));
    await expect(provider.getToken()).rejects.toThrow("invalid App Check token");
  });
});
