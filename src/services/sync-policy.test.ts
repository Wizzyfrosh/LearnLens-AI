import { describe, expect, it } from "vitest";
import {
  assertSyncCategoryDependencies,
  normalizeSyncCategoryPreferences
} from "./sync-policy";

describe("sync category dependency policy", () => {
  it("requires quiz definitions whenever quiz attempts are selected", () => {
    expect(() => assertSyncCategoryDependencies({
      lessonMetadata: false, notes: false, quizzes: false, attempts: true
    })).toThrow(/Quiz definitions are also enabled/i);
  });

  it("allows attempts when quiz definitions are enabled", () => {
    expect(() => assertSyncCategoryDependencies({
      lessonMetadata: false, notes: false, quizzes: true, attempts: true
    })).not.toThrow();
  });

  it("normalizes legacy invalid preferences without silently enabling quiz uploads", () => {
    expect(normalizeSyncCategoryPreferences({
      lessonMetadata: true, notes: true, quizzes: false, attempts: true
    })).toEqual({
      lessonMetadata: true, notes: true, quizzes: false, attempts: false
    });
  });

  it("does not mutate the saved preference object", () => {
    const original = { lessonMetadata: false, notes: false, quizzes: true, attempts: true };
    normalizeSyncCategoryPreferences(original);
    expect(original.attempts).toBe(true);
  });
});
