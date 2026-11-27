import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { requireVerifiedAppCaller } from "./auth-guards";
import { SyncBackendError } from "./errors";
import { applySyncMutation } from "./sync-mutation";
import { saveSyncSettingsForAccount } from "./sync-settings";

const adminApp = getApps()[0] ?? initializeApp();
const database = getFirestore(adminApp);

function toHttpsError(cause: unknown): HttpsError {
  if (cause instanceof SyncBackendError) {
    return new HttpsError(cause.code, cause.message);
  }
  // Do not log or return request payloads, note bodies, quiz keys, or tokens.
  console.error("LearnLens sync backend failed", cause instanceof Error ? cause.name : "unknown");
  return new HttpsError("internal", "LearnLens could not complete the sync request.");
}

/**
 * Stores the account's explicit cloud-sync consent. The UID comes from the
 * verified callable context, never from request.data.
 */
export const updateSyncSettings = onCall(
  { enforceAppCheck: true, maxInstances: 5, memory: "256MiB" },
  async (request) => {
    try {
      const uid = requireVerifiedAppCaller(request.auth, request.app);
      return await saveSyncSettingsForAccount(uid, request.data, database);
    } catch (cause) {
      throw toHttpsError(cause);
    }
  }
);

/**
 * Applies exactly one immutable local journal request. Writes, receipts,
 * conflicts, and feed sequence allocation are committed in one Firestore
 * transaction. This callable is not yet invoked by the extension.
 */
export const syncMutation = onCall(
  { enforceAppCheck: true, maxInstances: 5, memory: "256MiB", timeoutSeconds: 30 },
  async (request) => {
    try {
      const uid = requireVerifiedAppCaller(request.auth, request.app);
      return await applySyncMutation(uid, request.data, database);
    } catch (cause) {
      throw toHttpsError(cause);
    }
  }
);
