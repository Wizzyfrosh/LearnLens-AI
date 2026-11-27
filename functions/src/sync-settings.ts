import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { assertSyncCategoryDependencies } from "../../src/services/sync-policy";
import type { SyncCategory } from "../../src/services/session-store";
import { SyncBackendError } from "./errors";

export interface SyncSettingsInput {
  enabled: boolean;
  categories: Record<SyncCategory, boolean>;
}

export interface SyncSettingsStatus {
  configured: boolean;
  enabled: boolean;
  categories: Record<SyncCategory, boolean>;
  updatedAtMs: number | null;
}

const EMPTY_SYNC_CATEGORIES: Record<SyncCategory, boolean> = {
  lessonMetadata: false,
  notes: false,
  quizzes: false,
  attempts: false
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertKeys(value: Record<string, unknown>, required: string[]): void {
  const keys = Object.keys(value);
  if (
    keys.length !== required.length ||
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    keys.some((key) => !required.includes(key))
  ) {
    throw new SyncBackendError("invalid-argument", "Sync settings contain missing or unsupported fields.");
  }
}

export function validateSyncSettingsInput(value: unknown): SyncSettingsInput {
  if (!isRecord(value)) {
    throw new SyncBackendError("invalid-argument", "Invalid sync settings.");
  }
  assertKeys(value, ["enabled", "categories"]);
  if (typeof value.enabled !== "boolean" || !isRecord(value.categories)) {
    throw new SyncBackendError("invalid-argument", "Invalid sync settings values.");
  }
  assertKeys(value.categories, ["lessonMetadata", "notes", "quizzes", "attempts"]);
  const categories = {
    lessonMetadata: value.categories.lessonMetadata,
    notes: value.categories.notes,
    quizzes: value.categories.quizzes,
    attempts: value.categories.attempts
  };
  try {
    assertSyncCategoryDependencies(categories as Record<SyncCategory, boolean>);
  } catch (cause) {
    throw new SyncBackendError(
      "failed-precondition",
      cause instanceof Error ? cause.message : "Invalid sync category dependency."
    );
  }
  if (value.enabled && !Object.values(categories).some((selected) => selected === true)) {
    throw new SyncBackendError("failed-precondition", "Choose at least one sync category when enabling cloud sync.");
  }
  return { enabled: value.enabled, categories: categories as Record<SyncCategory, boolean> };
}

export async function getSyncSettingsForAccount(
  uid: string,
  database: Firestore
): Promise<SyncSettingsStatus> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
    throw new SyncBackendError("permission-denied", "The authenticated account ID is not valid for sync.");
  }

  const snapshot = await database.doc("users/" + uid + "/settings/sync").get();
  if (!snapshot.exists) {
    return {
      configured: false,
      enabled: false,
      categories: { ...EMPTY_SYNC_CATEGORIES },
      updatedAtMs: null
    };
  }

  const stored = snapshot.data();
  try {
    if (!isRecord(stored)) throw new Error("Stored sync settings are not an object.");
    assertKeys(stored, ["schemaVersion", "enabled", "categories", "updatedAt"]);
    if (stored.schemaVersion !== 1 || !(stored.updatedAt instanceof Timestamp)) {
      throw new Error("Stored sync settings have an unsupported schema or timestamp.");
    }

    const settings = validateSyncSettingsInput({
      enabled: stored.enabled,
      categories: stored.categories
    });
    const updatedAtMs = stored.updatedAt.toMillis();
    if (!Number.isSafeInteger(updatedAtMs) || updatedAtMs < 0) {
      throw new Error("Stored sync settings timestamp is invalid.");
    }

    return {
      configured: true,
      enabled: settings.enabled,
      categories: settings.categories,
      updatedAtMs
    };
  } catch {
    // Never reinterpret malformed persisted consent as an opt-in or opt-out.
    throw new SyncBackendError("internal", "Saved cloud-sync settings could not be read safely.");
  }
}

export async function saveSyncSettingsForAccount(
  uid: string,
  input: unknown,
  database: Firestore
): Promise<{ saved: true } & SyncSettingsStatus> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
    throw new SyncBackendError("permission-denied", "The authenticated account ID is not valid for sync.");
  }
  const settings = validateSyncSettingsInput(input);
  await database.doc("users/" + uid + "/settings/sync").set({
    schemaVersion: 1,
    enabled: settings.enabled,
    categories: settings.categories,
    updatedAt: FieldValue.serverTimestamp()
  });

  const saved = await getSyncSettingsForAccount(uid, database);
  if (!saved.configured) {
    throw new SyncBackendError("internal", "Saved cloud-sync settings were not found after update.");
  }
  return { saved: true, ...saved };
}
