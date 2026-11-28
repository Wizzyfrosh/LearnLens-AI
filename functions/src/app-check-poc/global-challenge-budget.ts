import { randomInt } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { SyncBackendError } from "../errors";

export const GLOBAL_CHALLENGE_BUDGET_SHARDS = 64;
export const GLOBAL_CHALLENGE_BUDGET_PER_SHARD_PER_DAY = 100;
export const GLOBAL_CHALLENGE_BUDGET_MAX_PER_DAY =
  GLOBAL_CHALLENGE_BUDGET_SHARDS * GLOBAL_CHALLENGE_BUDGET_PER_SHARD_PER_DAY;

export interface GlobalChallengeBudgetOptions {
  nowMs?: number;
  shardIndex?: number;
}

/**
 * Consumes one unit from a server-selected shard of the UTC daily budget.
 *
 * Each shard has an independent hard ceiling. The sum of all shard ceilings
 * is the maximum accepted daily work, without a single hot global document.
 * Random shard assignment can reject early if one shard fills before others;
 * this is intentional fail-closed behavior.
 */
export async function consumeGlobalChallengeBudget(
  database: Firestore,
  options: GlobalChallengeBudgetOptions = {}
): Promise<{ remainingInShard: number; dailyMaximum: number }> {
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new SyncBackendError("invalid-argument", "The challenge budget request is invalid.");
  }

  const shardIndex = options.shardIndex ?? randomInt(0, GLOBAL_CHALLENGE_BUDGET_SHARDS);
  if (
    !Number.isInteger(shardIndex) ||
    shardIndex < 0 ||
    shardIndex >= GLOBAL_CHALLENGE_BUDGET_SHARDS
  ) {
    throw new SyncBackendError("invalid-argument", "The challenge budget shard is invalid.");
  }

  const day = new Date(nowMs).toISOString().slice(0, 10).replaceAll("-", "");
  const ref = database.doc(
    "appCheckChallengeGlobalBudgets/" + day + "_" + String(shardIndex).padStart(2, "0")
  );
  const expiresAtMs = Date.parse(
    new Date(Date.UTC(
      new Date(nowMs).getUTCFullYear(),
      new Date(nowMs).getUTCMonth(),
      new Date(nowMs).getUTCDate() + 2
    )).toISOString()
  );

  return database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists ? snapshot.data() : undefined;
    let count = 0;

    if (data) {
      if (
        data.schemaVersion !== 1 ||
        data.day !== day ||
        !Number.isSafeInteger(data.count) ||
        (data.count as number) < 0 ||
        !(data.expiresAt instanceof Timestamp)
      ) {
        throw new SyncBackendError("failed-precondition", "Global challenge budget state is invalid.");
      }
      count = data.count as number;
    }

    if (count >= GLOBAL_CHALLENGE_BUDGET_PER_SHARD_PER_DAY) {
      throw new SyncBackendError("resource-exhausted", "The daily security-challenge capacity has been reached. Try again tomorrow.");
    }

    transaction.set(ref, {
      schemaVersion: 1,
      day,
      count: count + 1,
      expiresAt: Timestamp.fromMillis(expiresAtMs)
    });

    return {
      remainingInShard: GLOBAL_CHALLENGE_BUDGET_PER_SHARD_PER_DAY - count - 1,
      dailyMaximum: GLOBAL_CHALLENGE_BUDGET_MAX_PER_DAY
    };
  });
}
