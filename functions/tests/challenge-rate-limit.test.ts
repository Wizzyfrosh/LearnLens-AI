import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { enforceChallengeRateLimit } from "../src/app-check-poc/challenge-rate-limit";
import { SyncBackendError } from "../src/errors";

let app: App;
let database: Firestore;

const NOW = Date.parse("2026-11-27T12:00:00.000Z");

function uniqueSubject(): string {
  return "rate-limit-subject-" + randomUUID();
}

before(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Challenge rate-limit tests require FIRESTORE_EMULATOR_HOST; refusing to contact a live project.");
  }
  app = initializeApp({ projectId: "demo-learnlens-functions" }, "learnlens-app-check-rate-limit-tests");
  database = getFirestore(app);
});

after(async () => {
  if (app) await deleteApp(app);
});

describe("App Check challenge rate limiter", () => {
  it("allows five requests per subject and rejects the sixth in the same minute", async () => {
    const subject = uniqueSubject();
    for (let index = 0; index < 5; index += 1) {
      await enforceChallengeRateLimit("create", subject, database, NOW);
    }
    await assert.rejects(
      enforceChallengeRateLimit("create", subject, database, NOW + 1),
      (error: unknown) => error instanceof SyncBackendError && error.code === "resource-exhausted"
    );
  });

  it("does not let a backwards clock reset an active window", async () => {
    const subject = uniqueSubject();
    for (let index = 0; index < 5; index += 1) {
      await enforceChallengeRateLimit("complete", subject, database, NOW);
    }
    await assert.rejects(
      enforceChallengeRateLimit("complete", subject, database, NOW - 10_000),
      (error: unknown) => error instanceof SyncBackendError && error.code === "resource-exhausted"
    );
  });

  it("starts a new window after sixty seconds and keeps scopes independent", async () => {
    const subject = uniqueSubject();
    for (let index = 0; index < 5; index += 1) {
      await enforceChallengeRateLimit("claim", subject, database, NOW);
    }
    await enforceChallengeRateLimit("claim", subject, database, NOW + 60_000);
    await enforceChallengeRateLimit("create", subject, database, NOW);
  });

  it("rejects malformed subjects and timestamps", async () => {
    await assert.rejects(
      enforceChallengeRateLimit("create", "", database, NOW),
      (error: unknown) => error instanceof SyncBackendError && error.code === "invalid-argument"
    );
    await assert.rejects(
      enforceChallengeRateLimit("create", "subject", database, 1.5),
      (error: unknown) => error instanceof SyncBackendError && error.code === "invalid-argument"
    );
  });
});
