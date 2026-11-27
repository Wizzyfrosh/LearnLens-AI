import { describe, expect, it, vi } from "vitest";
import type { SyncSettingsDependencies } from "./sync-settings-client";
import {
  runSyncSettingsUpdate,
  validateSyncSettingsRequest
} from "./sync-settings-client";

const ownerUid = "user-a";
const categories = {
  lessonMetadata: true,
  notes: true,
  quizzes: true,
  attempts: false
};
const request = { enabled: true, categories };

function dependencies(
  overrides: Partial<SyncSettingsDependencies> = {}
): SyncSettingsDependencies {
  return {
    getCurrentUser: () => ({
      uid: ownerUid,
      emailVerified: true,
      getIdToken: vi.fn().mockResolvedValue("fresh-token")
    }),
    save: vi.fn().mockResolvedValue({ saved: true, enabled: true, categories }),
    ...overrides
  };
}

describe("server sync consent client", () => {
  it("rejects the release gate before reading Auth or calling the server", async () => {
    const getCurrentUser = vi.fn();
    const save = vi.fn();
    await expect(runSyncSettingsUpdate(
      ownerUid,
      request,
      { getCurrentUser, save },
      false
    )).rejects.toThrow(/production Firebase Auth and App Check/i);
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("requires the authenticated account to match the requested owner", async () => {
    const save = vi.fn();
    await expect(runSyncSettingsUpdate(
      ownerUid,
      request,
      dependencies({ getCurrentUser: () => ({
        uid: "another-user",
        emailVerified: true,
        getIdToken: vi.fn()
      }), save }),
      true
    )).rejects.toThrow(/same account/i);
    expect(save).not.toHaveBeenCalled();
  });

  it("requires a verified email before saving consent", async () => {
    const save = vi.fn();
    await expect(runSyncSettingsUpdate(
      ownerUid,
      request,
      dependencies({ getCurrentUser: () => ({
        uid: ownerUid,
        emailVerified: false,
        getIdToken: vi.fn()
      }), save }),
      true
    )).rejects.toThrow(/verify your email/i);
    expect(save).not.toHaveBeenCalled();
  });

  it("refreshes the Auth token and saves the exact selected categories", async () => {
    const getIdToken = vi.fn().mockResolvedValue("fresh-token");
    const save = vi.fn().mockResolvedValue({ saved: true, enabled: true, categories });
    const result = await runSyncSettingsUpdate(
      ownerUid,
      request,
      dependencies({
        getCurrentUser: () => ({ uid: ownerUid, emailVerified: true, getIdToken }),
        save
      }),
      true
    );

    expect(getIdToken).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(request);
    expect(result).toEqual({ saved: true, ...request });
  });

  it("rejects attempts when quiz definitions are not selected", () => {
    expect(() => validateSyncSettingsRequest({
      enabled: true,
      categories: { ...categories, quizzes: false, attempts: true }
    })).toThrow(/Quiz attempts can only be synced/i);
  });

  it("rejects unknown category fields", () => {
    expect(() => validateSyncSettingsRequest({
      enabled: true,
      categories: { ...categories, transcripts: true }
    })).toThrow(/valid cloud-sync categories/i);
  });

  it("rejects a server response that changes the requested scope", async () => {
    await expect(runSyncSettingsUpdate(
      ownerUid,
      request,
      dependencies({
        save: vi.fn().mockResolvedValue({
          saved: true,
          enabled: true,
          categories: { ...categories, notes: false }
        })
      }),
      true
    )).rejects.toThrow(/different cloud-sync categories/i);
  });

  it("accepts explicit withdrawal while preserving a valid category shape", async () => {
    const withdrawal = {
      enabled: false,
      categories: { lessonMetadata: false, notes: false, quizzes: false, attempts: false }
    };
    const save = vi.fn().mockResolvedValue({
      saved: true,
      enabled: false,
      categories: withdrawal.categories
    });
    const result = await runSyncSettingsUpdate(
      ownerUid,
      withdrawal,
      dependencies({ save }),
      true
    );
    expect(result).toEqual({ saved: true, ...withdrawal });
  });
});
