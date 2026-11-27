import { describe, expect, it } from "vitest";
import {
  decideSyncPullMerge,
  validateSyncPullPage,
  type SyncPullChangeRecord
} from "./sync-pull-contract";

const noteChange: SyncPullChangeRecord = {
  sequence: 4,
  entityType: "note",
  lessonId: "lesson-1",
  entityId: "note-1",
  revision: 2,
  isDeleted: false,
  payload: {
    title: "Updated notes",
    content: "A remote note snapshot.",
    createdAtMs: 100,
    updatedAtMs: 200
  }
};

function page(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    category: "notes",
    fromSequence: 3,
    snapshotSequence: 8,
    scannedThroughSequence: 5,
    changes: [noteChange],
    hasMore: true,
    nextCursor: "opaque-signed-cursor",
    ...overrides
  };
}

describe("category-scoped sync pull contract", () => {
  it("accepts a valid page and preserves its opaque cursor", () => {
    expect(validateSyncPullPage(page(), "notes", 3)).toMatchObject({
      category: "notes",
      fromSequence: 3,
      scannedThroughSequence: 5,
      nextCursor: "opaque-signed-cursor"
    });
  });

  it("rejects stale local cursor positions and category mismatches", () => {
    expect(() => validateSyncPullPage(page(), "notes", 2)).toThrow(/locally committed cursor/i);
    expect(() => validateSyncPullPage(page(), "quizzes", 3)).toThrow(/category mismatch/i);
  });

  it("rejects out-of-order, duplicate, cross-category, and out-of-range changes", () => {
    expect(() => validateSyncPullPage(page({
      changes: [noteChange, { ...noteChange, sequence: 4 }]
    }), "notes", 3)).toThrow(/out of order/i);
    expect(() => validateSyncPullPage(page({
      changes: [{ ...noteChange, entityType: "quiz" }]
    }), "notes", 3)).toThrow(/another category/i);
    expect(() => validateSyncPullPage(page({
      changes: [{ ...noteChange, sequence: 6 }]
    }), "notes", 3)).toThrow(/outside the scanned range/i);
  });

  it("requires completed pages to reach the fixed snapshot watermark", () => {
    expect(() => validateSyncPullPage(page({
      scannedThroughSequence: 5,
      hasMore: false
    }), "notes", 3)).toThrow(/snapshot watermark/i);
    const completed = validateSyncPullPage(page({
      scannedThroughSequence: 8,
      hasMore: false,
      nextCursor: "completed-checkpoint"
    }), "notes", 3);
    expect(completed.hasMore).toBe(false);
    expect(completed.nextCursor).toBe("completed-checkpoint");
  });

  it("rejects payloads on tombstones and unknown payload fields", () => {
    expect(() => validateSyncPullPage(page({
      changes: [{ ...noteChange, isDeleted: true }]
    }), "notes", 3)).toThrow(/cannot contain learner content/i);
    expect(() => validateSyncPullPage(page({
      changes: [{ ...noteChange, payload: { ...noteChange.payload, transcriptText: "secret" } }]
    }), "notes", 3)).toThrow(/unsupported field/i);
  });

  it("rejects a page that does not advance while more snapshot records remain", () => {
    expect(() => validateSyncPullPage(page({
      changes: [],
      scannedThroughSequence: 3
    }), "notes", 3)).toThrow(/made no progress/i);
  });

  it("routes a missing remote child artifact to the remote-only library", () => {
    expect(decideSyncPullMerge(noteChange, {
      exists: false,
      lastRemoteRevision: null,
      hasPendingLocalWrite: false,
      isConflicted: false
    })).toBe("store_remote_only");
  });

  it("does not overwrite local edits or unresolved conflict state", () => {
    expect(decideSyncPullMerge(noteChange, {
      exists: true,
      lastRemoteRevision: 1,
      hasPendingLocalWrite: true,
      isConflicted: false
    })).toBe("preserve_local_conflict");
    expect(decideSyncPullMerge(noteChange, {
      exists: true,
      lastRemoteRevision: 1,
      hasPendingLocalWrite: false,
      isConflicted: true
    })).toBe("preserve_local_conflict");
  });

  it("preserves local transcript data after a remote lesson tombstone", () => {
    expect(decideSyncPullMerge({
      ...noteChange,
      entityType: "lesson",
      entityId: "lesson-1",
      isDeleted: true,
      payload: null
    }, {
      exists: true,
      lastRemoteRevision: 1,
      hasPendingLocalWrite: false,
      isConflicted: false,
      hasLocalTranscript: true
    })).toBe("keep_lesson_transcript_local_only");
  });

  it("ignores repeated/stale events and tombstones for absent records", () => {
    expect(decideSyncPullMerge(noteChange, {
      exists: true,
      lastRemoteRevision: 2,
      hasPendingLocalWrite: false,
      isConflicted: false
    })).toBe("ignore_stale_change");
    expect(decideSyncPullMerge({
      ...noteChange, isDeleted: true, payload: null
    }, {
      exists: false,
      lastRemoteRevision: null,
      hasPendingLocalWrite: false,
      isConflicted: false
    })).toBe("ignore_missing_tombstone");
  });
});
