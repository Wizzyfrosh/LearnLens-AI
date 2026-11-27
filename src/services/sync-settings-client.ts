import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirebaseApp } from "./firebase-app";
import { getFirebaseAuth } from "./firebase-auth";
import type { User } from "firebase/auth";
import type { SyncCategoryPreferences } from "./session-store";
import { assertSyncCategoryDependencies } from "./sync-policy";

/**
 * Consent writes are kept separate from artifact writes and remain disabled
 * until the production Firebase project, verified Auth and production App
 * Check have been reviewed and approved.
 */
export const SYNC_SERVER_CONSENT_WRITES_ENABLED = false as const;

export interface SyncSettingsInput {
  enabled: boolean;
  categories: SyncCategoryPreferences;
}

export interface SyncSettingsResult extends SyncSettingsInput {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateSyncSettingsRequest(value: unknown): SyncSettingsInput {
  if (!isRecord(value) || Object.keys(value).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(value, "enabled") ||
      !Object.prototype.hasOwnProperty.call(value, "categories") ||
      typeof value.enabled !== "boolean" || !isRecord(value.categories)) {
    throw new Error("Invalid cloud-sync consent request.");
  }

  const categoryKeys = ["lessonMetadata", "notes", "quizzes", "attempts"];
  if (Object.keys(value.categories).length !== categoryKeys.length ||
      categoryKeys.some((key) => !Object.prototype.hasOwnProperty.call(value.categories, key)) ||
      Object.values(value.categories).some((selected) => typeof selected !== "boolean")) {
    throw new Error("Choose valid cloud-sync categories.");
  }

  const categories: SyncCategoryPreferences = {
    lessonMetadata: value.categories.lessonMetadata as boolean,
    notes: value.categories.notes as boolean,
    quizzes: value.categories.quizzes as boolean,
    attempts: value.categories.attempts as boolean
  };
  assertSyncCategoryDependencies(categories);

  return { enabled: value.enabled, categories };
}

function validateSyncSettingsResult(value: unknown, expected: SyncSettingsInput): SyncSettingsResult {
  if (!isRecord(value) || value.saved !== true ||
      value.enabled !== expected.enabled || !isRecord(value.categories)) {
    throw new Error("The server did not confirm the requested cloud-sync consent.");
  }
  const categories = value.categories;
  if (categories.lessonMetadata !== expected.categories.lessonMetadata ||
      categories.notes !== expected.categories.notes ||
      categories.quizzes !== expected.categories.quizzes ||
      categories.attempts !== expected.categories.attempts ||
      Object.keys(categories).length !== 4) {
    throw new Error("The server returned different cloud-sync categories than requested.");
  }
  return { saved: true, enabled: expected.enabled, categories: { ...expected.categories } };
}

/**
 * Injectable orchestration keeps identity checks and response validation
 * testable without Firebase network access.
 */
export async function runSyncSettingsUpdate(
  ownerUid: string,
  value: unknown,
  dependencies: SyncSettingsDependencies,
  writesEnabled: boolean
): Promise<SyncSettingsResult> {
  if (!writesEnabled) {
    throw new Error(
      "Cloud-sync consent cannot be submitted until production Firebase Auth and App Check are approved."
    );
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ownerUid)) {
    throw new Error("A valid account is required to save cloud-sync consent.");
  }

  const settings = validateSyncSettingsRequest(value);
  const user = dependencies.getCurrentUser();
  if (!user || user.uid !== ownerUid) {
    throw new Error("Sign in with the same account before saving cloud-sync consent.");
  }
  if (!user.emailVerified) {
    throw new Error("Verify your email address before saving cloud-sync consent.");
  }

  await user.getIdToken();
  const result = await dependencies.save(settings);
  return validateSyncSettingsResult(result, settings);
}

/**
 * Firebase callable wrapper. The hard gate is checked before Auth, Functions,
 * App Check or network initialization, so the current build makes no request.
 */
export async function updateSyncSettingsForFirebase(
  ownerUid: string,
  value: unknown
): Promise<SyncSettingsResult> {
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
