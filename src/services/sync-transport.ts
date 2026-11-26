import type { SyncRequestRecord } from "./session-store";

/**
 * Cloud writes remain deliberately disabled. The current extension build uses
 * a debug App Check provider for AI features; that does not satisfy the
 * production App Check release requirement for artifact synchronization.
 */
export const SYNC_CLOUD_WRITES_ENABLED = false as const;

export interface SyncTransportReadiness {
  enabled: false;
  authenticatedUserRequired: true;
  verifiedEmailRequired: true;
  productionAppCheckRequired: true;
  reason: "production_auth_and_app_check_not_approved";
}

export function getSyncTransportReadiness(): SyncTransportReadiness {
  return {
    enabled: false,
    authenticatedUserRequired: true,
    verifiedEmailRequired: true,
    productionAppCheckRequired: true,
    reason: "production_auth_and_app_check_not_approved"
  };
}

/**
 * There is intentionally no fetch/Firestore call here yet. This fails closed
 * even if an environment variable is added accidentally; production transport
 * must be implemented only after the release gates are explicitly approved.
 */
export async function dispatchSyncRequest(_request: SyncRequestRecord): Promise<never> {
  throw new Error(
    "LearnLens cloud sync is disabled. Verify live Firebase Auth and configure production App Check before enabling artifact uploads."
  );
}
