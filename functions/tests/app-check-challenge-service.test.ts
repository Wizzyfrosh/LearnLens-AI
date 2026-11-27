import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  assertChallengeBootstrapEnabled,
  completeAuthenticatedChallengeSession,
  createAuthenticatedChallengeSession,
  issueAuthenticatedAppCheckToken
} from "../src/app-check-poc/challenge-service";
import { SyncBackendError } from "../src/errors";

let app: App;
let database: Firestore;

const NOW = Date.parse("2026-11-27T12:00:00.000Z");
const APP_ID = "1:123456789:web:learnlenspoc";
const ACTION = "learnlens_app_check";
const CONFIG = {
  appId: APP_ID,
  action: ACTION,
  hostname: "verify.example.test",
  secret: "server-only-test-secret"
};

function uniqueUid(): string {
  return "challenge-service-" + randomUUID();
}

function siteverifyFetch(overrides: Record<string, unknown> = {}): typeof fetch {
  return (async () => new Response(JSON.stringify({
    success: true,
    hostname: CONFIG.hostname,
    action: ACTION,
    cdata: "placeholder",
    challenge_ts: new Date(NOW - 10_000).toISOString(),
    ...overrides
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
}

before(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Challenge service tests require FIRESTORE_EMULATOR_HOST; refusing to contact a live project.");
  }
  app = initializeApp({ projectId: "demo-learnlens-functions" }, "learnlens-app-check-service-tests");
  database = getFirestore(app);
});

after(async () => {
  if (app) await deleteApp(app);
});

describe("Authenticated App Check challenge service", () => {
  it("keeps the bootstrap disabled unless an explicit true server parameter is supplied", () => {
    assert.throws(
      () => assertChallengeBootstrapEnabled(false),
      (error: unknown) => error instanceof SyncBackendError && error.code === "failed-precondition"
    );
    assert.throws(
      () => assertChallengeBootstrapEnabled(undefined),
      (error: unknown) => error instanceof SyncBackendError && error.code === "failed-precondition"
    );
    assert.doesNotThrow(() => assertChallengeBootstrapEnabled(true));
  });

  it("creates a session using server-selected App ID and action", async () => {
    const uid = uniqueUid();
    const created = await createAuthenticatedChallengeSession(
      uid,
      { appId: APP_ID, action: ACTION },
      database,
      NOW
    );
    assert.equal(created.appId, APP_ID);
    assert.equal(created.action, ACTION);
    assert.equal(created.expiresAtMs, NOW + 5 * 60 * 1000);
    assert.equal((await database.doc("appCheckChallengeSessions/" + created.sessionId).get()).data()?.uid, uid);
  });

  it("completes a challenge only for the authenticated owner and server configuration", async () => {
    const uid = uniqueUid();
    const created = await createAuthenticatedChallengeSession(
      uid,
      { appId: APP_ID, action: ACTION },
      database,
      NOW
    );
    const stored = (await database.doc("appCheckChallengeSessions/" + created.sessionId).get()).data();
    const cdata = stored?.cdata as string;
    let called = false;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      called = true;
      assert.equal(String(input), "https://challenges.cloudflare.com/turnstile/v0/siteverify");
      const body = init?.body as URLSearchParams;
      assert.equal(body.get("secret"), CONFIG.secret);
      assert.equal(body.get("response"), "valid-turnstile-response");
      return new Response(JSON.stringify({
        success: true,
        hostname: CONFIG.hostname,
        action: ACTION,
        cdata,
        challenge_ts: new Date(NOW - 10_000).toISOString()
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const result = await completeAuthenticatedChallengeSession(
      uid,
      { sessionId: created.sessionId, responseToken: "valid-turnstile-response" },
      CONFIG,
      database,
      NOW,
      fetchImpl
    );
    assert.deepEqual(result, { verified: true, expiresAtMs: created.expiresAtMs });
    assert.equal(called, true);
    assert.equal((await database.doc("appCheckChallengeSessions/" + created.sessionId).get()).data()?.state, "verified");
  });

  it("rejects a different authenticated account before calling Siteverify", async () => {
    const ownerUid = uniqueUid();
    const otherUid = uniqueUid();
    const created = await createAuthenticatedChallengeSession(
      ownerUid,
      { appId: APP_ID, action: ACTION },
      database,
      NOW
    );
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      throw new Error("Siteverify must not be called");
    }) as typeof fetch;

    await assert.rejects(
      completeAuthenticatedChallengeSession(
        otherUid,
        { sessionId: created.sessionId, responseToken: "valid-turnstile-response" },
        CONFIG,
        database,
        NOW,
        fetchImpl
      ),
      (error: unknown) => error instanceof SyncBackendError && error.code === "permission-denied"
    );
    assert.equal(called, false);
    assert.equal((await database.doc("appCheckChallengeSessions/" + created.sessionId).get()).data()?.state, "pending");
  });

  it("rejects a configuration mismatch without contacting Siteverify", async () => {
    const uid = uniqueUid();
    const created = await createAuthenticatedChallengeSession(
      uid,
      { appId: APP_ID, action: ACTION },
      database,
      NOW
    );
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      throw new Error("Siteverify must not be called");
    }) as typeof fetch;

    await assert.rejects(
      completeAuthenticatedChallengeSession(
        uid,
        { sessionId: created.sessionId, responseToken: "valid-turnstile-response" },
        { ...CONFIG, appId: "1:999999999:web:anotherapp" },
        database,
        NOW,
        fetchImpl
      ),
      (error: unknown) => error instanceof SyncBackendError && error.code === "failed-precondition"
    );
    assert.equal(called, false);
    assert.equal((await database.doc("appCheckChallengeSessions/" + created.sessionId).get()).data()?.state, "pending");
  });

  it("leaves the session pending when Siteverify rejects the challenge", async () => {
    const uid = uniqueUid();
    const created = await createAuthenticatedChallengeSession(
      uid,
      { appId: APP_ID, action: ACTION },
      database,
      NOW
    );
    const stored = (await database.doc("appCheckChallengeSessions/" + created.sessionId).get()).data();
    const fetchImpl = siteverifyFetch({
      success: false,
      cdata: stored?.cdata
    });

    await assert.rejects(
      completeAuthenticatedChallengeSession(
        uid,
        { sessionId: created.sessionId, responseToken: "invalid-turnstile-response" },
        CONFIG,
        database,
        NOW,
        fetchImpl
      ),
      (error: unknown) => error instanceof SyncBackendError && error.code === "permission-denied"
    );
    assert.equal((await database.doc("appCheckChallengeSessions/" + created.sessionId).get()).data()?.state, "pending");
  });

  it("issues a 30-minute App Check token only after an authenticated one-time claim", async () => {
    const uid = uniqueUid();
    const created = await createAuthenticatedChallengeSession(
      uid,
      { appId: APP_ID, action: ACTION },
      database,
      NOW
    );
    const stored = (await database.doc("appCheckChallengeSessions/" + created.sessionId).get()).data();
    const fetchImpl = siteverifyFetch({ cdata: stored?.cdata });
    await completeAuthenticatedChallengeSession(
      uid,
      { sessionId: created.sessionId, responseToken: "valid-turnstile-response" },
      CONFIG,
      database,
      NOW,
      fetchImpl
    );

    let mintCalls = 0;
    const issuer = {
      createToken: async (appId: string, options: { ttlMillis: number }) => {
        mintCalls += 1;
        assert.equal(appId, APP_ID);
        assert.equal(options.ttlMillis, 30 * 60 * 1000);
        return { token: "fake-app-check-token", ttlMillis: options.ttlMillis };
      }
    };

    const issued = await issueAuthenticatedAppCheckToken(
      uid,
      created.sessionId,
      created.pollCredential,
      APP_ID,
      ACTION,
      issuer,
      database,
      NOW + 20_000
    );
    assert.deepEqual(issued, {
      token: "fake-app-check-token",
      expireTimeMillis: NOW + 20_000 + 30 * 60 * 1000
    });
    assert.equal(mintCalls, 1);
    assert.equal((await database.doc("appCheckChallengeSessions/" + created.sessionId).get()).data()?.state, "consumed");

    await assert.rejects(
      issueAuthenticatedAppCheckToken(
        uid,
        created.sessionId,
        created.pollCredential,
        APP_ID,
        ACTION,
        issuer,
        database,
        NOW + 30_000
      ),
      (error: unknown) => error instanceof SyncBackendError && error.code === "failed-precondition"
    );
    assert.equal(mintCalls, 1);
  });

  it("rejects a mismatched configured App ID before consuming the session", async () => {
    const uid = uniqueUid();
    const created = await createAuthenticatedChallengeSession(
      uid,
      { appId: APP_ID, action: ACTION },
      database,
      NOW
    );
    const stored = (await database.doc("appCheckChallengeSessions/" + created.sessionId).get()).data();
    await completeAuthenticatedChallengeSession(
      uid,
      { sessionId: created.sessionId, responseToken: "valid-turnstile-response" },
      CONFIG,
      database,
      NOW,
      siteverifyFetch({ cdata: stored?.cdata })
    );
    let mintCalls = 0;
    const issuer = {
      createToken: async () => {
        mintCalls += 1;
        return { token: "should-not-mint", ttlMillis: 30 * 60 * 1000 };
      }
    };

    await assert.rejects(
      issueAuthenticatedAppCheckToken(
        uid,
        created.sessionId,
        created.pollCredential,
        "1:999999999:web:unexpected",
        ACTION,
        issuer,
        database,
        NOW + 20_000
      ),
      (error: unknown) => error instanceof SyncBackendError && error.code === "failed-precondition"
    );
    assert.equal(mintCalls, 0);
    assert.equal((await database.doc("appCheckChallengeSessions/" + created.sessionId).get()).data()?.state, "verified");
  });

  it("does not reopen a consumed session when Firebase token minting fails", async () => {
    const uid = uniqueUid();
    const created = await createAuthenticatedChallengeSession(
      uid,
      { appId: APP_ID, action: ACTION },
      database,
      NOW
    );
    const stored = (await database.doc("appCheckChallengeSessions/" + created.sessionId).get()).data();
    await completeAuthenticatedChallengeSession(
      uid,
      { sessionId: created.sessionId, responseToken: "valid-turnstile-response" },
      CONFIG,
      database,
      NOW,
      siteverifyFetch({ cdata: stored?.cdata })
    );

    let mintCalls = 0;
    const failingIssuer = {
      createToken: async () => {
        mintCalls += 1;
        throw new Error("simulated signing failure");
      }
    };
    await assert.rejects(
      issueAuthenticatedAppCheckToken(
        uid,
        created.sessionId,
        created.pollCredential,
        APP_ID,
        ACTION,
        failingIssuer,
        database,
        NOW + 20_000
      ),
      (error: unknown) => error instanceof SyncBackendError && error.code === "unavailable"
    );
    assert.equal(mintCalls, 1);
    assert.equal((await database.doc("appCheckChallengeSessions/" + created.sessionId).get()).data()?.state, "consumed");

    await assert.rejects(
      issueAuthenticatedAppCheckToken(
        uid,
        created.sessionId,
        created.pollCredential,
        APP_ID,
        ACTION,
        failingIssuer,
        database,
        NOW + 30_000
      ),
      (error: unknown) => error instanceof SyncBackendError && error.code === "failed-precondition"
    );
    assert.equal(mintCalls, 1);
  });

  it("mints at most one App Check token under concurrent claim attempts", async () => {
    const uid = uniqueUid();
    const created = await createAuthenticatedChallengeSession(
      uid,
      { appId: APP_ID, action: ACTION },
      database,
      NOW
    );
    const stored = (await database.doc("appCheckChallengeSessions/" + created.sessionId).get()).data();
    await completeAuthenticatedChallengeSession(
      uid,
      { sessionId: created.sessionId, responseToken: "valid-turnstile-response" },
      CONFIG,
      database,
      NOW,
      siteverifyFetch({ cdata: stored?.cdata })
    );

    let mintCalls = 0;
    const issuer = {
      createToken: async (appId: string, options: { ttlMillis: number }) => {
        mintCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { token: "single-use-app-check-token", ttlMillis: options.ttlMillis };
      }
    };
    const attempts = await Promise.allSettled([
      issueAuthenticatedAppCheckToken(uid, created.sessionId, created.pollCredential, APP_ID, ACTION, issuer, database, NOW + 20_000),
      issueAuthenticatedAppCheckToken(uid, created.sessionId, created.pollCredential, APP_ID, ACTION, issuer, database, NOW + 20_000)
    ]);
    assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);
    assert.equal(mintCalls, 1);
    assert.equal((await database.doc("appCheckChallengeSessions/" + created.sessionId).get()).data()?.state, "consumed");
  });
});
