import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirebaseApp } from "./firebase-app";
import { getFirebaseAuth } from "./firebase-auth";
import type { User } from "firebase/auth";
import type { SyncCategoryPreferences } from "./session-store";
import { assertSyncCategoryDependencies } from "./sync-policy";

/**
 * Consent reads and writes are separate from artifact transfer. Both remain
 * disabled until production Firebase Auth and App Check are reviewed.
 */
export const SYNC_SERVER_CONSENT_READS_ENABLED = false as const;
export const SYNC_SERVER_CONSENT_WRITES_ENABLED = false as const;

export interface SyncSettingsInput {
  enabled: boolean;
  categories: SyncCategoryPreferences;
}

export interface SyncSettingsStatus {
  configured: boolean;
  enabled: boolean;
  categories: SyncCategoryPreferences;
  updatedAtMs: number | null;
}

export interface SyncSettingsSaveResult extends SyncSettingsStatus {
  saved: true;
}

export interface SyncSettingsUser {
  uid: string;
  emailVerified: boolean;
  getIdToken(): Promise<string>;
}

export interface SyncSettingsDependencies {
  getCurrentUser(): SyncSettingsUser | null;
  save(input: SyncSettingsInput): Promise<unknown>;
}

export interface SyncSettingsReadDependencies {
  getCurrentUser(): SyncSettingsUser | null;
  load(): Promise<unknown>;
}

const EMPTY_CATEGORIES: SyncCategoryPreferences = {
  lessonMetadata: false,
  notes: false,
  quizzes: false,
  attempts: false
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const CATEGORY_KEYS = ["lessonMetadata", "notes", "quizzes", "attempts"] as const;

function validateCategories(value: unknown): SyncCategoryPreferences {
  if (!isRecord(value) || Object.keys(value).length !== CATEGORY_KEYS.length ||
      CATEGORY_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
      Object.values(value).some((selected) => typeof selected !== "boolean")) {
    throw new Error("Choose valid cloud-sync categories.");
  }

  const categories: SyncCategoryPreferences = {
    lessonMetadata: value.lessonMetadata as boolean,
    notes: value.notes as boolean,
    quizzes: value.quizzes as boolean,
    attempts: value.attempts as boolean
  };
  assertSyncCategoryDependencies(categories);
  return categories;
}

export function validateSyncSettingsRequest(value: unknown): SyncSettingsInput {
  if (!isRecord(value) || Object.keys(value).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(value, "enabled") ||
      !Object.prototype.hasOwnProperty.call(value, "categories") ||
      typeof value.enabled !== "boolean") {
    throw new Error("Invalid cloud-sync consent request.");
  }

  const categories = validateCategories(value.categories);
  if (value.enabled && !Object.values(categories).some(Boolean)) {
    throw new Error("Select at least one category before enabling cloud sync.");
  }

  return { enabled: value.enabled, categories };
}

export function validateSyncSettingsStatus(value: unknown): SyncSettingsStatus {
  if (!isRecord(value) || Object.keys(value).length !== 4 ||
      !Object.prototype.hasOwnProperty.call(value, "configured") ||
      !Object.prototype.hasOwnProperty.call(value, "enabled") ||
      !Object.prototype.hasOwnProperty.call(value, "categories") ||
      !Object.prototype.hasOwnProperty.call(value, "updatedAtMs") ||
      typeof value.configured !== "boolean" || typeof value.enabled !== "boolean") {
    throw new Error("The server returned an invalid cloud-sync consent status.");
  }

  const categories = validateCategories(value.categories);
  if (!value.configured) {
    if (value.enabled || Object.values(categories).some(Boolean) || value.updatedAtMs !== null) {
      throw new Error("The server returned an inconsistent unconfigured consent status.");
    }
    return {
      configured: false,
      enabled: false,
      categories: { ...EMPTY_CATEGORIES },
      updatedAtMs: null
    };
  }

  if (typeof value.updatedAtMs !== "number" ||
      !Number.isSafeInteger(value.updatedAtMs) || value.updatedAtMs < 0) {
    throw new Error("The server returned an invalid cloud-sync consent timestamp.");
  }

  // Reuse the request validator so a persisted enabled state cannot bypass the
  // same category dependency checks used when consent is first submitted.
  const settings = validateSyncSettingsRequest({
    enabled: value.enabled,
    categories
  });

  return {
    configured: true,
    enabled: settings.enabled,
    categories: settings.categories,
    updatedAtMs: value.updatedAtMs
  };
}

function validateSyncSettingsSaveResult(
  value: unknown,
  expected: SyncSettingsInput
): SyncSettingsSaveResult {
  if (!isRecord(value) || value.saved !== true) {
    throw new Error("The server did not confirm the requested cloud-sync consent.");
  }

  const status = validateSyncSettingsStatus({
    configured: value.configured,
    enabled: value.enabled,
    categories: value.categories,
    updatedAtMs: value.updatedAtMs
  });

  if (!status.configured || status.enabled !== expected.enabled ||
      CATEGORY_KEYS.some((key) => status.categories[key] !== expected.categories[key])) {
    throw new Error("The server returned different cloud-sync settings than requested.");
  }

  return { saved: true, ...status };
}

function validateOwnerUid(ownerUid: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ownerUid)) {
    throw new Error("A valid account is required for cloud-sync settings.");
  }
}

function requireVerifiedMatchingUser(
  ownerUid: string,
  getCurrentUser: () => SyncSettingsUser | null
): SyncSettingsUser {
  const user = getCurrentUser();
  if (!user || user.uid !== ownerUid) {
    throw new Error("Sign in with the same account before accessing cloud-sync settings.");
  }
  if (!user.emailVerified) {
    throw new Error("Verify your email address before accessing cloud-sync settings.");
  }
  return user;
}

/**
 * Injectable read orchestration. The gate is checked before reading Auth or
 * invoking the network dependency.
 */
export async function runSyncSettingsStatusRead(
  ownerUid: string,
  dependencies: SyncSettingsReadDependencies,
  readsEnabled: boolean
): Promise<SyncSettingsStatus> {
  if (!readsEnabled) {
    throw new Error(
      "Saved cloud-sync status is unavailable until production Firebase Auth and App Check are approved."
    );
  }

  validateOwnerUid(ownerUid);
  const user = requireVerifiedMatchingUser(ownerUid, dependencies.getCurrentUser);
  await user.getIdToken();
  return validateSyncSettingsStatus(await dependencies.load());
}

/**
 * Injectable update orchestration. The gate is checked before reading Auth
 * or invoking the network dependency.
 */
export async function runSyncSettingsUpdate(
  ownerUid: string,
  value: unknown,
  dependencies: SyncSettingsDependencies,
  writesEnabled: boolean
): Promise<SyncSettingsSaveResult> {
  if (!writesEnabled) {
    throw new Error(
      "Cloud-sync consent cannot be submitted until production Firebase Auth and App Check are approved."
    );
  }

  validateOwnerUid(ownerUid);
  const settings = validateSyncSettingsRequest(value);
  const user = requireVerifiedMatchingUser(ownerUid, dependencies.getCurrentUser);
  await user.getIdToken();
  return validateSyncSettingsSaveResult(await dependencies.save(settings), settings);
}

/**
 * Read-only callable wrapper. It performs no Firebase initialization while
 * the independent status-read gate is closed.
 */
export async function getSyncSettingsStatusForFirebase(
  ownerUid: string
): Promise<SyncSettingsStatus> {
  const dependencies: SyncSettingsReadDependencies = {
    getCurrentUser: () => {
      const user: User | null = getFirebaseAuth().currentUser;
      return user;
    },
    load: async () => {
      const callable = httpsCallable<void, unknown>(
        getFunctions(getFirebaseApp()),
        "getSyncSettings"
      );
      return (await callable()).data;
    }
  };

  return runSyncSettingsStatusRead(
    ownerUid,
    dependencies,
    SYNC_SERVER_CONSENT_READS_ENABLED
  );
}

/**
 * Writes explicit consent through the account-scoped callable. The callable
 * independently verifies Auth and App Check on the server.
 */
export async function updateSyncSettingsForFirebase(
  ownerUid: string,
  value: unknown
): Promise<SyncSettingsSaveResult> {
  const dependencies: SyncSettingsDependencies = {
    getCurrentUser: () => {
      const user: User | null = getFirebaseAuth().currentUser;
      return user;
    },
    save: async (settings) => {
      const callable = httpsCallable<SyncSettingsInput, unknown>(
        getFunctions(getFirebaseApp()),
        "updateSyncSettings"
      );
      return (await callable(settings)).data;
    }
  };

  return runSyncSettingsUpdate(
    ownerUid,
    value,
    dependencies,
    SYNC_SERVER_CONSENT_WRITES_ENABLED
  );
}

/**
 * Withdrawal is an explicit consent update. It disables the account-level
 * setting and clears every category; it does not delete previously stored data.
 */
export async function withdrawSyncSettingsForFirebase(
  ownerUid: string
): Promise<SyncSettingsSaveResult> {
  return updateSyncSettingsForFirebase(ownerUid, {
    enabled: false,
    categories: { ...EMPTY_CATEGORIES }
  });
}
