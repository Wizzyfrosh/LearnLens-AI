import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  consumeGlobalChallengeBudget,
  GLOBAL_CHALLENGE_BUDGET_PER_SHARD_PER_DAY,
  GLOBAL_CHALLENGE_BUDGET_SHARDS
} from "../src/app-check-poc/global-challenge-budget";
import { SyncBackendError } from "../src/errors";

let app: App;
let database: Firestore;

const DAY_ONE = Date.parse("2026-11-27T12:00:00.000Z");
const DAY_TWO = Date.parse("2026-11-28T00:00:01.000Z");

before(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Global challenge budget tests require FIRESTORE_EMULATOR_HOST; refusing to contact a live project.");
  }
  app = initializeApp({ projectId: "demo-learnlens-functions" }, "learnlens-global-challenge-budget-tests");
  database = getFirestore(app);
});

after(async () => {
  if (app) await deleteApp(app);
});

describe("Sharded global daily challenge budget", () => {
  it("consumes one unit in the selected shard and returns its remaining allowance", async () => {
    const result = await consumeGlobalChallengeBudget(database, { nowMs: DAY_ONE, shardIndex: 0 });
    assert.equal(result.remainingInShard, GLOBAL_CHALLENGE_BUDGET_PER_SHARD_PER_DAY - 1);
    assert.equal(result.dailyMaximum, GLOBAL_CHALLENGE_BUDGET_SHARDS * GLOBAL_CHALLENGE_BUDGET_PER_SHARD_PER_DAY);
  });

  it("enforces a hard per-shard ceiling transactionally", async () => {
    const shardIndex = 1;
    for (let i = 0; i < GLOBAL_CHALLENGE_BUDGET_PER_SHARD_PER_DAY; i += 1) {
      await consumeGlobalChallengeBudget(database, { nowMs: DAY_ONE, shardIndex });
    }
    await assert.rejects(
      consumeGlobalChallengeBudget(database, { nowMs: DAY_ONE, shardIndex }),
      (error: unknown) => error instanceof SyncBackendError && error.code === "resource-exhausted"
    );
  });

  it("allows only one request when concurrent attempts compete for the final shard slot", async () => {
    const shardIndex = 2;
    for (let i = 0; i < GLOBAL_CHALLENGE_BUDGET_PER_SHARD_PER_DAY - 1; i += 1) {
      await consumeGlobalChallengeBudget(database, { nowMs: DAY_ONE, shardIndex });
    }
    const attempts = await Promise.allSettled([
      consumeGlobalChallengeBudget(database, { nowMs: DAY_ONE, shardIndex }),
      consumeGlobalChallengeBudget(database, { nowMs: DAY_ONE, shardIndex })
    ]);
    assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((item) => item.status === "rejected").length, 1);
  });

  it("uses a separate UTC-day budget", async () => {
    const result = await consumeGlobalChallengeBudget(database, { nowMs: DAY_TWO, shardIndex: 1 });
    assert.equal(result.remainingInShard, GLOBAL_CHALLENGE_BUDGET_PER_SHARD_PER_DAY - 1);
  });

  it("rejects invalid shard identifiers and timestamps", async () => {
    await assert.rejects(
      consumeGlobalChallengeBudget(database, { nowMs: DAY_ONE, shardIndex: GLOBAL_CHALLENGE_BUDGET_SHARDS }),
      (error: unknown) => error instanceof SyncBackendError && error.code === "invalid-argument"
    );
    await assert.rejects(
      consumeGlobalChallengeBudget(database, { nowMs: -1, shardIndex: 0 }),
      (error: unknown) => error instanceof SyncBackendError && error.code === "invalid-argument"
    );
  });
});
