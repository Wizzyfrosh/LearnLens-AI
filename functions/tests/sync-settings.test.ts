import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateSyncSettingsInput } from "../src/sync-settings";

describe("server sync settings consent validation", () => {
  it("accepts the exact consent shape with dependent quiz categories enabled", () => {
    assert.deepEqual(validateSyncSettingsInput({
      enabled: true,
      categories: { lessonMetadata: false, notes: true, quizzes: true, attempts: true }
    }), {
      enabled: true,
      categories: { lessonMetadata: false, notes: true, quizzes: true, attempts: true }
    });
  });

  it("rejects attempts consent without quiz-definition consent", () => {
    assert.throws(() => validateSyncSettingsInput({
      enabled: true,
      categories: { lessonMetadata: false, notes: false, quizzes: false, attempts: true }
    }), /Quiz definitions are also enabled/i);
  });

  it("rejects client-supplied UID, timestamps, and unknown category fields", () => {
    assert.throws(() => validateSyncSettingsInput({
      uid: "victim",
      enabled: true,
      categories: { lessonMetadata: false, notes: true, quizzes: false, attempts: false }
    }), /missing or unsupported fields/i);
    assert.throws(() => validateSyncSettingsInput({
      enabled: true,
      updatedAt: Date.now(),
      categories: { lessonMetadata: false, notes: true, quizzes: false, attempts: false }
    }), /missing or unsupported fields/i);
    assert.throws(() => validateSyncSettingsInput({
      enabled: true,
      categories: { lessonMetadata: false, notes: true, quizzes: false, attempts: false, transcript: true }
    }), /missing or unsupported fields/i);
  });

  it("rejects enabling cloud sync with no selected categories", () => {
    assert.throws(() => validateSyncSettingsInput({
      enabled: true,
      categories: { lessonMetadata: false, notes: false, quizzes: false, attempts: false }
    }), /at least one sync category/i);
  });

  it("allows a fully disabled settings state without enabling any category", () => {
    assert.equal(validateSyncSettingsInput({
      enabled: false,
      categories: { lessonMetadata: false, notes: false, quizzes: false, attempts: false }
    }).enabled, false);
  });
});
