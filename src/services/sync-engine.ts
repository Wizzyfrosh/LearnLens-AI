import {
  createSyncRequestSnapshot,
  getLocalSyncOperationSnapshots,
  getLocalSyncPreferences,
  getOrCreateSyncDeviceId
} from "./session-store";
import type {
  SyncOperationSnapshot,
  SyncPreparedPayload,
  SyncPreparationBlockReason,
  SyncRequestPreparationBlockReason,
  SyncRequestRecord,
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

/**
 * Persists immutable per-operation request snapshots. Repeated preparation
 * returns the same request ID and payload; a changed local operation receives
 * a new request snapshot, while unresolved older requests block later writes.
 */
export interface PreparedSyncRequestBatch {
  schemaVersion: 1;
  ownerUid: string;
  deviceId: string;
  preparedAtMs: number;
  requests: SyncRequestRecord[];
  blocked: Array<{
    entityKey: string;
    operationId: string;
    reason: SyncPreparationBlockReason | SyncRequestPreparationBlockReason;
  }>;
}

export async function prepareSyncRequests(
  ownerUid: string,
  limit = 25
): Promise<PreparedSyncRequestBatch> {
  const batch = await prepareSyncBatch(ownerUid, limit);
  const requests: SyncRequestRecord[] = [];
  const blocked = [...batch.blocked];

  for (const operation of batch.operations) {
    const result = await createSyncRequestSnapshot(
      ownerUid,
      batch.deviceId,
      operation.entityKey,
      operation.operationId
    );
    if (result.request && !result.blockedReason) {
      requests.push(result.request);
    } else {
      blocked.push({
        entityKey: operation.entityKey,
        operationId: operation.operationId,
        reason: result.blockedReason ?? "operation_changed"
      });
    }
  }

  return {
    schemaVersion: 1,
    ownerUid,
    deviceId: batch.deviceId,
    preparedAtMs: Date.now(),
    requests,
    blocked
  };
}
