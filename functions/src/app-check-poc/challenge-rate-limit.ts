import { createHash } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { SyncBackendError } from "../errors";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 5;

export async function enforceChallengeRateLimit(
  scope: "create" | "complete" | "claim",
  subject: string,
  database: Firestore,
  nowMs = Date.now()
): Promise<void> {
  if (!subject || subject.length > 512 || !Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new SyncBackendError("invalid-argument", "The challenge request is invalid.");
  }
  const key = createHash("sha256").update(scope + ":" + subject, "utf8").digest("hex");
  const ref = database.doc("appCheckChallengeRateLimits/" + key);
  await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const value = snapshot.exists ? snapshot.data() : undefined;
    let windowStartMs = nowMs;
    let count = 0;
    if (value) {
      if (
        !(value.windowStartedAt instanceof Timestamp) ||
        !Number.isSafeInteger(value.count) ||
        (value.count as number) < 0
      ) {
        throw new SyncBackendError("failed-precondition", "Challenge rate-limit state is invalid.");
      }
      const storedStart = value.windowStartedAt.toMillis();
      if (nowMs >= storedStart && nowMs - storedStart < WINDOW_MS) {
        windowStartMs = storedStart;
        count = value.count as number;
      }
    }
    if (count >= MAX_REQUESTS_PER_WINDOW) {
      throw new SyncBackendError("resource-exhausted", "Too many challenge requests. Please wait before trying again.");
    }
    transaction.set(ref, {
      schemaVersion: 1,
      scope,
      windowStartedAt: Timestamp.fromMillis(windowStartMs),
      count: count + 1,
      expiresAt: Timestamp.fromMillis(windowStartMs + WINDOW_MS * 2)
    });
  });
}
