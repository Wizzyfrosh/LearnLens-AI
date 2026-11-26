import {
  getLocalSyncOperationSnapshots,
  getLocalSyncPreferences,
  getOrCreateSyncDeviceId
} from "./session-store";
import type {
  SyncOperationSnapshot,
  SyncPreparedPayload,
  SyncPreparationBlockReason,
  SyncOperation,
  SyncEntityType
} from "./session-store";

export interface PreparedSyncOperation {
  entityKey: string;
  operationId: string;
  entityType: SyncEntityType;
  operation: SyncOperation;
  baseRevision: number;
  payloadSchemaVersion: 1;
  payload: SyncPreparedPayload | null;
}

export interface PreparedSyncBatch {
  schemaVersion: 1;
  ownerUid: string;
  deviceId: string;
  preparedAtMs: number;
  operations: PreparedSyncOperation[];
  blocked: Array<{
    entityKey: string;
    operationId: string;
    reason: SyncPreparationBlockReason;
  }>;
}

/**
 * Prepares a bounded upload batch from explicitly selected, account-owned
 * local records. This function is intentionally transport-free: it does not
 * fetch auth tokens, request App Check tokens, or contact Firebase/Firestore.
 */
export async function prepareSyncBatch(
  ownerUid: string,
  limit = 25
): Promise<PreparedSyncBatch> {
  const preferences = await getLocalSyncPreferences(ownerUid);
  const snapshots: SyncOperationSnapshot[] = await getLocalSyncOperationSnapshots(
    ownerUid,
    preferences.categories,
    limit
  );
  const deviceId = await getOrCreateSyncDeviceId();

  return {
    schemaVersion: 1,
    ownerUid,
    deviceId,
    preparedAtMs: Date.now(),
    operations: snapshots
      .filter((snapshot) => snapshot.blockedReason === null)
      .map((snapshot) => ({
        entityKey: snapshot.outbox.entityKey,
        operationId: snapshot.outbox.operationId,
        entityType: snapshot.outbox.entityType,
        operation: snapshot.outbox.operation,
        baseRevision: snapshot.outbox.baseRevision,
        payloadSchemaVersion: snapshot.outbox.payloadSchemaVersion,
        payload: snapshot.payload
      })),
    blocked: snapshots
      .filter((snapshot) => snapshot.blockedReason !== null)
      .map((snapshot) => ({
        entityKey: snapshot.outbox.entityKey,
        operationId: snapshot.outbox.operationId,
        reason: snapshot.blockedReason as SyncPreparationBlockReason
      }))
  };
}
