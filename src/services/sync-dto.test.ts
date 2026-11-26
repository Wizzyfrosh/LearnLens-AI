import { describe, expect, it } from "vitest";
import {
  toAttemptSyncDto,
  toLessonMetadataDto,
  toNoteSyncDto,
  toQuizSyncDto
} from "./sync-dto";
import type { LearningSession, LearningNote } from "./session-store";
import type { QuizAttempt, QuizDefinition } from "./quiz";

const session: LearningSession = {
  id: "video_1234567", videoId: "video_1234567", title: "  Biology  ",
  url: "https://www.youtube.com/watch?v=video_1234567&feature=share",
  platform: "youtube", transcriptText: "PRIVATE FULL TRANSCRIPT",
  transcriptFormat: "plain-text", transcriptSource: "visible captions", updatedAt: 123
};

describe("allow-listed cloud sync DTOs", () => {
  it("projects only minimal lesson metadata and canonicalizes YouTube URLs", () => {
    const dto = toLessonMetadataDto(session);
    expect(dto).toEqual({
      platform: "youtube", videoId: "video_1234567", title: "  Biology  ",
      url: "https://www.youtube.com/watch?v=video_1234567"
    });
    expect(dto).not.toHaveProperty("transcriptText");
    expect(JSON.stringify(dto)).not.toContain("PRIVATE FULL TRANSCRIPT");
  });

  it("drops untrusted and non-YouTube lesson URLs", () => {
    expect(toLessonMetadataDto({
      ...session, platform: "manual", videoId: "", url: "https://example.com/lesson"
    }).url).toBe("");
    expect(toLessonMetadataDto({
      ...session, url: "javascript:alert(1)"
    }).url).toBe("https://www.youtube.com/watch?v=video_1234567");
  });

  it("projects note content without local IDs or lesson transcript fields", () => {
    const note: LearningNote = {
      id: "note-1", sessionId: "video_1234567", videoId: "video_1234567",
      title: "Cell notes", content: "Mitochondria produce ATP.", createdAt: 1, updatedAt: 2
    };
    const dto = toNoteSyncDto(note);
    expect(dto).toEqual({
      title: "Cell notes", content: "Mitochondria produce ATP.",
      createdAtMs: 1, updatedAtMs: 2
    });
    expect(dto).not.toHaveProperty("sessionId");
  });

  it("includes quiz answer keys and evidence only in the explicit quiz DTO", () => {
    const quiz: QuizDefinition = {
      id: "quiz-1", sessionId: "video_1234567", title: "Biology quiz",
      scope: "whole_lesson", scopeLabel: "Whole lesson", createdAt: 10,
      questions: [{
        id: "q1", type: "multiple_choice", prompt: "What do mitochondria produce?",
        options: ["ATP", "Oxygen", "Water"], correctAnswer: "ATP",
        explanation: "The lesson says ATP.", topic: "Cellular respiration",
        evidence: "Mitochondria produce ATP"
      }]
    };
    const dto = toQuizSyncDto(quiz);
    expect(dto.questions[0]).toMatchObject({ correctAnswer: "ATP", evidence: "Mitochondria produce ATP" });
    expect(dto).not.toHaveProperty("sessionId");
    expect(JSON.stringify(dto)).not.toContain("PRIVATE FULL TRANSCRIPT");
  });

  it("projects learner answers and feedback only in the attempt DTO", () => {
    const attempt: QuizAttempt = {
      id: "attempt-1", quizId: "quiz-1", sessionId: "video_1234567", createdAt: 20,
      results: [{ questionId: "q1", answer: "ATP", correct: true, feedback: "Correct." }],
      objectiveScore: 1, objectiveTotal: 1, topicsToReview: []
    };
    expect(toAttemptSyncDto(attempt)).toEqual({
      quizId: "quiz-1", createdAtMs: 20,
      results: [{ questionId: "q1", answer: "ATP", correct: true, feedback: "Correct." }],
      objectiveScore: 1, objectiveTotal: 1, topicsToReview: []
    });
  });

  it("rejects oversized note payloads rather than truncating learner content", () => {
    const note: LearningNote = {
      id: "note-large", sessionId: "lesson", videoId: "lesson",
      title: "Large note", content: "x".repeat(256 * 1024 + 1), createdAt: 1, updatedAt: 1
    };
    expect(() => toNoteSyncDto(note)).toThrow(/exceeds the cloud sync size limit/i);
  });
});
