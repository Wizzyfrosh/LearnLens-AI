import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirebaseApp } from "./firebase-app";
import { getFirebaseAuth } from "./firebase-auth";
import {
  applyLocalSyncPullPage,
  getLocalSyncPullCursor,
  getOrCreateSyncDeviceId,
  getLocalSyncPreferences
} from "./session-store";
import type {
  SyncCategory,
  SyncPullApplyResult,
  SyncPullCursorRecord
} from "./session-store";
import { validateSyncPullPage } from "./sync-pull-contract";
import type { SyncPullPage } from "./sync-pull-contract";

/**
 * Pull remains deliberately disabled until live verified Auth, server consent,
 * production App Check, the intended Firebase project and deployment are
 * approved. This gate is independent from the mutation-upload gate.
 */
export const SYNC_CLOUD_PULL_ENABLED = false as const;
export const DEFAULT_SYNC_PULL_MAX_PAGES = 3;

export interface SyncPullCallableInput {
  protocolVersion: 1;
  deviceId: string;
  category: SyncCategory;
  cursor: string | null;
}

export interface SyncPullRunSummary {
  ownerUid: string;
  deviceId: string;
  category: SyncCategory;
  pagesApplied: number;
  applied: number;
  remoteOnly: number;
  preservedLocal: number;
  ignoredStale: number;
  hasMore: boolean;
  cursor: SyncPullCursorRecord | null;
}

export interface SyncPullPageDependencies {
  getCursor(
    ownerUid: string,
    deviceId: string,
    category: SyncCategory
  ): Promise<SyncPullCursorRecord | null>;
  fetchPage(input: SyncPullCallableInput): Promise<unknown>;
  applyPage(
    ownerUid: string,
    deviceId: string,
    category: SyncCategory,
    requestCursor: string | null,
    page: SyncPullPage
  ): Promise<SyncPullApplyResult>;
}

function assertMaxPages(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 20) {
    throw new Error("A sync pull run must request between 1 and 20 pages.");
  }
  return value;
}

/**
 * Runs a bounded read-only pull. Every response is validated against the
 * locally committed sequence watermark before the IndexedDB applier receives
 * it. The applier commits each page and its opaque cursor atomically.
 *
 * This function accepts injected dependencies so pagination, retry boundaries
 * and cursor handling can be tested without making Firebase network requests.
 */
export async function runSyncPullPages(
  ownerUid: string,
  deviceId: string,
  category: SyncCategory,
  dependencies: SyncPullPageDependencies,
  maxPages = DEFAULT_SYNC_PULL_MAX_PAGES
): Promise<SyncPullRunSummary> {
  const pageLimit = assertMaxPages(maxPages);
  if (!ownerUid || ownerUid.length > 128 || !deviceId || deviceId.length > 128) {
    throw new Error("A valid account and device identity are required for sync pull.");
  }

  let cursor = await dependencies.getCursor(ownerUid, deviceId, category);
  let pagesApplied = 0;
  let applied = 0;
  let remoteOnly = 0;
  let preservedLocal = 0;
  let ignoredStale = 0;
  let hasMore = true;

  while (pagesApplied < pageLimit && hasMore) {
    const requestCursor = cursor?.cursor ?? null;
    const expectedFromSequence = cursor?.scannedThroughSequence ?? 0;
    const rawPage = await dependencies.fetchPage({
      protocolVersion: 1,
      deviceId,
      category,
      cursor: requestCursor
    });
    const page = validateSyncPullPage(rawPage, category, expectedFromSequence);
    const result = await dependencies.applyPage(
      ownerUid,
      deviceId,
      category,
      requestCursor,
      page
    );

    cursor = result.cursor;
    pagesApplied += 1;
    applied += result.applied;
    remoteOnly += result.remoteOnly;
    preservedLocal += result.preservedLocal;
    ignoredStale += result.ignoredStale;
    hasMore = page.hasMore;
  }

  return {
    ownerUid,
    deviceId,
    category,
    pagesApplied,
    applied,
    remoteOnly,
    preservedLocal,
    ignoredStale,
    hasMore,
    cursor
  };
}

export interface SyncPullReadiness {
  enabled: false;
  authenticatedUserRequired: true;
  verifiedEmailRequired: true;
  productionAppCheckRequired: true;
  serverConsentRequired: true;
  reason: "production_sync_release_gates_not_approved";
}

export function getSyncPullReadiness(): SyncPullReadiness {
  return {
    enabled: false,
    authenticatedUserRequired: true,
    verifiedEmailRequired: true,
    productionAppCheckRequired: true,
    serverConsentRequired: true,
    reason: "production_sync_release_gates_not_approved"
  };
}

/**
 * Firebase callable wrapper. The callable SDK attaches Firebase Auth and
 * App Check tokens when configured. The function stays unreachable while the
 * hard gate above is false; no pull request is sent by the current extension.
 */
export async function pullSyncCategoryFromFirebase(
  ownerUid: string,
  category: SyncCategory,
  maxPages = DEFAULT_SYNC_PULL_MAX_PAGES
): Promise<SyncPullRunSummary> {
  if (!SYNC_CLOUD_PULL_ENABLED) {
    throw new Error(
      "Cloud pull is disabled until verified live Auth, server consent, production App Check and deployment are approved."
    );
  }

  const user = getFirebaseAuth().currentUser;
  if (!user || user.uid !== ownerUid) {
    throw new Error("Sign in with the same account before pulling synced learning data.");
  }
  if (!user.emailVerified) {
    throw new Error("Verify your email address before pulling synced learning data.");
  }

  // Refresh an expired token before the callable SDK sends the request. The
  // server independently verifies UID, email verification and App Check.
  await user.getIdToken();
  const preferences = await getLocalSyncPreferences(ownerUid);
  if (!preferences.categories[category]) {
    throw new Error("Select and review this sync category on this device first.");
  }

  const deviceId = await getOrCreateSyncDeviceId();
  // No explicit region is configured on the Functions exports, so use the
  // Firebase SDK's default us-central1 endpoint.
  const functions = getFunctions(getFirebaseApp());
  const pullCallable = httpsCallable<SyncPullCallableInput, unknown>(functions, "syncPull");

  return runSyncPullPages(
    ownerUid,
    deviceId,
    category,
    {
      getCursor: getLocalSyncPullCursor,
      fetchPage: async (input) => (await pullCallable(input)).data,
      applyPage: applyLocalSyncPullPage
    },
    maxPages
  );
}
