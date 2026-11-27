import { describe, expect, it, vi } from "vitest";
import type { SyncCategory, SyncPullApplyResult, SyncPullCursorRecord } from "./session-store";
import type { SyncPullPage } from "./sync-pull-contract";
import { getSyncPullReadiness, runSyncPullPages } from "./sync-pull-client";

const ownerUid = "user-a";
const deviceId = "22222222-2222-4222-8222-222222222222";
const category: SyncCategory = "notes";

function page(
  fromSequence: number,
  scannedThroughSequence: number,
  snapshotSequence: number,
  hasMore: boolean,
  nextCursor: string
): SyncPullPage {
  return {
    protocolVersion: 1,
    category,
    fromSequence,
    scannedThroughSequence,
    snapshotSequence,
    changes: [],
    hasMore,
    nextCursor
  };
}

function cursor(
  cursorValue: string,
  scannedThroughSequence: number,
  snapshotSequence: number
): SyncPullCursorRecord {
  return {
    ownerUid,
    deviceId,
    category,
    cursor: cursorValue,
    scannedThroughSequence,
    snapshotSequence,
    updatedAtMs: 100
  };
}

function applyResult(saved: SyncPullCursorRecord): SyncPullApplyResult {
  return {
    applied: 0,
    remoteOnly: 0,
    preservedLocal: 0,
    ignoredStale: 0,
    duplicatePage: false,
    cursor: saved
  };
}

describe("read-only sync pull pagination", () => {
  it("uses the saved opaque cursor for each next page and stops at the completed snapshot", async () => {
    const firstPage = page(0, 2, 5, true, "opaque-page-1");
    const secondPage = page(2, 5, 5, false, "opaque-final");
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);
    const applyPage = vi.fn()
      .mockResolvedValueOnce(applyResult(cursor("opaque-page-1", 2, 5)))
      .mockResolvedValueOnce(applyResult(cursor("opaque-final", 5, 5)));

    const result = await runSyncPullPages(
      ownerUid,
      deviceId,
      category,
      {
        getCursor: vi.fn().mockResolvedValue(null),
        fetchPage,
        applyPage
      }
    );

    expect(fetchPage).toHaveBeenNthCalledWith(1, {
      protocolVersion: 1, deviceId, category, cursor: null
    });
    expect(fetchPage).toHaveBeenNthCalledWith(2, {
      protocolVersion: 1, deviceId, category, cursor: "opaque-page-1"
    });
    expect(applyPage).toHaveBeenNthCalledWith(
      1, ownerUid, deviceId, category, null, firstPage
    );
    expect(applyPage).toHaveBeenNthCalledWith(
      2, ownerUid, deviceId, category, "opaque-page-1", secondPage
    );
    expect(result).toMatchObject({
      pagesApplied: 2,
      hasMore: false,
      cursor: cursor("opaque-final", 5, 5)
    });
  });

  it("continues from a previously committed cursor instead of restarting from zero", async () => {
    const saved = cursor("already-saved", 4, 4);
    const nextPage = page(4, 4, 4, false, "next-snapshot-checkpoint");
    const getCursor = vi.fn().mockResolvedValue(saved);
    const fetchPage = vi.fn().mockResolvedValue(nextPage);
    const applyPage = vi.fn().mockResolvedValue(
      applyResult(cursor("next-snapshot-checkpoint", 4, 4))
    );

    await runSyncPullPages(ownerUid, deviceId, category, {
      getCursor, fetchPage, applyPage
    });

    expect(fetchPage).toHaveBeenCalledWith({
      protocolVersion: 1, deviceId, category, cursor: "already-saved"
    });
    expect(applyPage).toHaveBeenCalledWith(
      ownerUid, deviceId, category, "already-saved", nextPage
    );
  });

  it("does not apply an invalid page or advance the saved cursor", async () => {
    const invalidPage = {
      ...page(0, 1, 1, false, "bad-page"),
      category: "quizzes"
    };
    const applyPage = vi.fn();

    await expect(runSyncPullPages(ownerUid, deviceId, category, {
      getCursor: vi.fn().mockResolvedValue(null),
      fetchPage: vi.fn().mockResolvedValue(invalidPage),
      applyPage
    })).rejects.toThrow(/protocol or category mismatch/i);

    expect(applyPage).not.toHaveBeenCalled();
  });

  it("stops after the configured page budget and returns the persisted continuation state", async () => {
    let sequence = 0;
    const fetchPage = vi.fn(async () => {
      sequence += 1;
      return page(sequence - 1, sequence, 10, true, "cursor-" + sequence);
    });
    const applyPage = vi.fn(async (
      _uid: string,
      _id: string,
      _selectedCategory: SyncCategory,
      _requestCursor: string | null,
      nextPage: SyncPullPage
    ) => applyResult(cursor(
      nextPage.nextCursor, nextPage.scannedThroughSequence, nextPage.snapshotSequence
    )));

    const result = await runSyncPullPages(ownerUid, deviceId, category, {
      getCursor: vi.fn().mockResolvedValue(null),
      fetchPage,
      applyPage
    }, 2);

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(applyPage).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      pagesApplied: 2,
      hasMore: true,
      cursor: cursor("cursor-2", 2, 10)
    });
  });

  it("rejects unbounded page budgets", async () => {
    await expect(runSyncPullPages(ownerUid, deviceId, category, {
      getCursor: vi.fn(),
      fetchPage: vi.fn(),
      applyPage: vi.fn()
    }, 21)).rejects.toThrow(/between 1 and 20 pages/i);
  });

  it("keeps the live pull gate closed pending production release approvals", () => {
    expect(getSyncPullReadiness()).toEqual({
      enabled: false,
      authenticatedUserRequired: true,
      verifiedEmailRequired: true,
      productionAppCheckRequired: true,
      serverConsentRequired: true,
      reason: "production_sync_release_gates_not_approved"
    });
  });
});
