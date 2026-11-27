import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  completeChallengeSession,
  consumeChallengeSession,
  createChallengeSession
} from "../src/app-check-poc/challenge-sessions";
import { SyncBackendError } from "../src/errors";

let app: App;
let database: Firestore;

const NOW = Date.parse("2026-11-27T12:00:00.000Z");
const UID = "challenge-user-123";
const APP_ID = "1:123456789:web:learnlenspoc";
const ACTION = "learnlens_app_check";

before(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Challenge session tests require FIRESTORE_EMULATOR_HOST; refusing to contact a live project.");
  }
  app = initializeApp({ projectId: "demo-learnlens-functions" }, "learnlens-app-check-challenge-tests");
  database = getFirestore(app);
});

after(async () => {
  if (app) await deleteApp(app);
});

async function createSession(nowMs = NOW) {
  return createChallengeSession(UID, APP_ID, ACTION, database, nowMs);
}

describe("App Check challenge session lifecycle", () => {
  it("creates a pending session with short expiry and only stores a hash of the poll credential", async () => {
    const created = await createSession();
    assert.equal(created.expiresAtMs - created.createdAtMs, 5 * 60 * 1000);
    assert.equal(created.appId, APP_ID);
    assert.equal(created.action, ACTION);
    assert.match(created.pollCredential, /^[A-Za-z0-9_-]{40,128}$/);

    const stored = (await database.doc("appCheckChallengeSessions/" + created.sessionId).get()).data();
    assert.equal(stored?.state, "pending");
    assert.equal(stored?.uid, UID);
    assert.equal(stored?.cdata, created.cdata);
    assert.equal(stored?.pollCredential, undefined);
    assert.notEqual(stored?.pollCredentialHash, created.pollCredential);
    assert.match(stored?.pollCredentialHash, /^[a-f0-9]{64}$/);
  });

  it("moves a valid pending session to verified once", async () => {
    const created = await createSession();
    const result = await completeChallengeSession(created.sessionId, created.cdata, database, NOW + 20_000);
    assert.deepEqual(result, {
      verified: true,
      verifiedAtMs: NOW + 20_000,
      expiresAtMs: created.expiresAtMs
    });
    const stored = (await database.doc("appCheckChallengeSessions/" + created.sessionId).get()).data();
    assert.equal(stored?.state, "verified");
    assert.equal(stored?.verifiedAt?.toMillis(), NOW + 20_000);
  });

  it("rejects wrong cdata and leaves the session pending", async () => {
    const created = await createSession();
    await assert.rejects(
      completeChallengeSession(created.sessionId, "A".repeat(43), database, NOW + 10_000),
      (error: unknown) => error instanceof SyncBackendError && error.code === "permission-denied"
    );
    assert.equal((await database.doc("appCheckChallengeSessions/" + created.sessionId).get()).data()?.state, "pending");
  });

  it("rejects expired sessions at verification and consumption", async () => {
    const created = await createSession();
    await assert.rejects(
      completeChallengeSession(created.sessionId, created.cdata, database, created.expiresAtMs),
      (error: unknown) => error instanceof SyncBackendError && error.code === "deadline-exceeded"
    );

    const second = await createSession();
    await completeChallengeSession(second.sessionId, second.cdata, database, NOW + 10_000);
    await assert.rejects(
      consumeChallengeSession(UID, second.sessionId, second.pollCredential, database, second.expiresAtMs),
      (error: unknown) => error instanceof SyncBackendError && error.code === "deadline-exceeded"
    );
  });

  it("rejects another account and incorrect poll credentials", async () => {
    const created = await createSession();
    await completeChallengeSession(created.sessionId, created.cdata, database, NOW + 10_000);
    await assert.rejects(
      consumeChallengeSession("another-user", created.sessionId, created.pollCredential, database, NOW + 20_000),
      (error: unknown) => error instanceof SyncBackendError && error.code === "permission-denied"
    );
    await assert.rejects(
      consumeChallengeSession(UID, created.sessionId, "A".repeat(43), database, NOW + 20_000),
      (error: unknown) => error instanceof SyncBackendError && error.code === "permission-denied"
    );
    assert.equal((await database.doc("appCheckChallengeSessions/" + created.sessionId).get()).data()?.state, "verified");
  });

  it("consumes a verified session once and returns only trusted server fields", async () => {
    const created = await createSession();
    await completeChallengeSession(created.sessionId, created.cdata, database, NOW + 10_000);
    const result = await consumeChallengeSession(UID, created.sessionId, created.pollCredential, database, NOW + 20_000);
    assert.deepEqual(result, {
      appId: APP_ID,
      action: ACTION,
      verifiedAtMs: NOW + 10_000,
      consumedAtMs: NOW + 20_000
    });
    assert.equal((await database.doc("appCheckChallengeSessions/" + created.sessionId).get()).data()?.state, "consumed");
    await assert.rejects(
      consumeChallengeSession(UID, created.sessionId, created.pollCredential, database, NOW + 30_000),
      (error: unknown) => error instanceof SyncBackendError && error.code === "failed-precondition"
    );
  });

  it("rejects malformed session identifiers and invalid server inputs", async () => {
    await assert.rejects(
      completeChallengeSession("../../settings/sync", "x", database, NOW),
      (error: unknown) => error instanceof SyncBackendError && error.code === "invalid-argument"
    );
    await assert.rejects(createChallengeSession("bad/uid", APP_ID, ACTION, database, NOW), SyncBackendError);
    await assert.rejects(createChallengeSession(UID, "", ACTION, database, NOW), SyncBackendError);
  });

  it("does not allow completion after a session was already consumed", async () => {
    const created = await createSession();
    await completeChallengeSession(created.sessionId, created.cdata, database, NOW + 10_000);
    await consumeChallengeSession(UID, created.sessionId, created.pollCredential, database, NOW + 20_000);
    await assert.rejects(
      completeChallengeSession(created.sessionId, created.cdata, database, NOW + 30_000),
      (error: unknown) => error instanceof SyncBackendError && error.code === "already-exists"
    );
  });
});
