import { describe, expect, it, vi } from "vitest";
import type {
  SyncSettingsDependencies,
  SyncSettingsReadDependencies
} from "./sync-settings-client";
import {
  runSyncSettingsStatusRead,
  runSyncSettingsUpdate,
  validateSyncSettingsRequest,
  validateSyncSettingsStatus
} from "./sync-settings-client";

const ownerUid = "user-a";
const categories = {
  lessonMetadata: true,
  notes: true,
  quizzes: true,
  attempts: false
};
const request = { enabled: true, categories };
const status = {
  configured: true,
  enabled: true,
  categories,
  updatedAtMs: 1_800_000_000_000
};
const emptyStatus = {
  configured: false,
  enabled: false,
  categories: {
    lessonMetadata: false,
    notes: false,
    quizzes: false,
    attempts: false
  },
  updatedAtMs: null
};

function user(overrides: Partial<{
  uid: string;
  emailVerified: boolean;
  getIdToken: () => Promise<string>;
}> = {}) {
  return {
    uid: ownerUid,
    emailVerified: true,
    getIdToken: vi.fn().mockResolvedValue("fresh-token"),
    ...overrides
  };
}

function updateDependencies(
  overrides: Partial<SyncSettingsDependencies> = {}
): SyncSettingsDependencies {
  return {
    getCurrentUser: () => user(),
    save: vi.fn().mockResolvedValue({ saved: true, ...status }),
    ...overrides
  };
}

function readDependencies(
  overrides: Partial<SyncSettingsReadDependencies> = {}
): SyncSettingsReadDependencies {
  return {
    getCurrentUser: () => user(),
    load: vi.fn().mockResolvedValue(status),
    ...overrides
  };
}

describe("server sync consent client", () => {
  it("rejects the write release gate before reading Auth or calling the server", async () => {
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
      updateDependencies({ getCurrentUser: () => user({ uid: "another-user" }), save }),
      true
    )).rejects.toThrow(/same account/i);
    expect(save).not.toHaveBeenCalled();
  });

  it("requires a verified email before saving consent", async () => {
    const save = vi.fn();
    await expect(runSyncSettingsUpdate(
      ownerUid,
      request,
      updateDependencies({ getCurrentUser: () => user({ emailVerified: false }), save }),
      true
    )).rejects.toThrow(/verify your email/i);
    expect(save).not.toHaveBeenCalled();
  });

  it("refreshes the Auth token and saves the exact selected categories", async () => {
    const currentUser = user();
    const save = vi.fn().mockResolvedValue({ saved: true, ...status });
    const result = await runSyncSettingsUpdate(
      ownerUid,
      request,
      updateDependencies({ getCurrentUser: () => currentUser, save }),
      true
    );

    expect(currentUser.getIdToken).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(request);
    expect(result).toEqual({ saved: true, ...status });
  });

  it("rejects attempts when quiz definitions are not selected", () => {
    expect(() => validateSyncSettingsRequest({
      enabled: true,
      categories: { ...categories, quizzes: false, attempts: true }
    })).toThrow(/Quiz attempts can only be synced/i);
  });

  it("rejects enabling cloud sync with no selected categories", () => {
    expect(() => validateSyncSettingsRequest({
      enabled: true,
      categories: { lessonMetadata: false, notes: false, quizzes: false, attempts: false }
    })).toThrow(/at least one category/i);
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
      updateDependencies({
        save: vi.fn().mockResolvedValue({
          saved: true,
          ...status,
          categories: { ...categories, notes: false }
        })
      }),
      true
    )).rejects.toThrow(/different cloud-sync settings/i);
  });

  it("accepts explicit withdrawal and requires the server to confirm all categories are off", async () => {
    const withdrawal = {
      enabled: false,
      categories: {
        lessonMetadata: false,
        notes: false,
        quizzes: false,
        attempts: false
      }
    };
    const withdrawnStatus = {
      configured: true,
      enabled: false,
      categories: withdrawal.categories,
      updatedAtMs: status.updatedAtMs + 100
    };
    const result = await runSyncSettingsUpdate(
      ownerUid,
      withdrawal,
      updateDependencies({
        save: vi.fn().mockResolvedValue({ saved: true, ...withdrawnStatus })
      }),
      true
    );
    expect(result).toEqual({ saved: true, ...withdrawnStatus });
  });
});

describe("server sync consent status read", () => {
  it("rejects the read release gate before reading Auth or the server", async () => {
    const getCurrentUser = vi.fn();
    const load = vi.fn();
    await expect(runSyncSettingsStatusRead(
      ownerUid,
      { getCurrentUser, load },
      false
    )).rejects.toThrow(/status is unavailable/i);
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("requires a matching signed-in account and verified email", async () => {
    const load = vi.fn();
    await expect(runSyncSettingsStatusRead(
      ownerUid,
      readDependencies({ getCurrentUser: () => user({ uid: "different-user" }), load }),
      true
    )).rejects.toThrow(/same account/i);
    await expect(runSyncSettingsStatusRead(
      ownerUid,
      readDependencies({ getCurrentUser: () => user({ emailVerified: false }), load }),
      true
    )).rejects.toThrow(/verify your email/i);
    expect(load).not.toHaveBeenCalled();
  });

  it("reads and validates the saved server consent", async () => {
    const currentUser = user();
    const load = vi.fn().mockResolvedValue(status);
    const result = await runSyncSettingsStatusRead(
      ownerUid,
      readDependencies({ getCurrentUser: () => currentUser, load }),
      true
    );
    expect(currentUser.getIdToken).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledOnce();
    expect(result).toEqual(status);
  });

  it("returns a verified unconfigured status separately from an explicit withdrawal", async () => {
    expect(validateSyncSettingsStatus(emptyStatus)).toEqual(emptyStatus);
    expect(validateSyncSettingsStatus({
      configured: true,
      enabled: false,
      categories: emptyStatus.categories,
      updatedAtMs: 1_800_000_000_000
    })).toMatchObject({ configured: true, enabled: false, updatedAtMs: 1_800_000_000_000 });
  });

  it("rejects malformed or inconsistent server status instead of silently defaulting", () => {
    expect(() => validateSyncSettingsStatus({ ...status, extra: true })).toThrow(/invalid cloud-sync consent status/i);
    expect(() => validateSyncSettingsStatus({ ...status, updatedAtMs: null })).toThrow(/timestamp/i);
    expect(() => validateSyncSettingsStatus({
      ...status,
      enabled: false,
      categories: { ...categories, notes: false }
    })).not.toThrow();
    expect(() => validateSyncSettingsStatus({
      configured: false,
      enabled: true,
      categories,
      updatedAtMs: null
    })).toThrow(/inconsistent unconfigured/i);
    expect(() => validateSyncSettingsStatus({
      ...status,
      enabled: true,
      categories: { lessonMetadata: false, notes: false, quizzes: false, attempts: false }
    })).toThrow(/at least one category/i);
  });
});
