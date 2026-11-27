import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { assertSyncCategoryDependencies } from "../../src/services/sync-policy";
import type { SyncCategory } from "../../src/services/session-store";
import { SyncBackendError } from "./errors";

export interface SyncSettingsInput {
  enabled: boolean;
  categories: Record<SyncCategory, boolean>;
}

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
  return { enabled: value.enabled, categories: categories as Record<SyncCategory, boolean> };
}

export async function saveSyncSettingsForAccount(
  uid: string,
  input: unknown,
  database: Firestore
): Promise<{ saved: true; enabled: boolean; categories: Record<SyncCategory, boolean> }> {
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
  return { saved: true, enabled: settings.enabled, categories: settings.categories };
}
