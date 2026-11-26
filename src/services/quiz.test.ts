import { describe, expect, it } from "vitest";
import { parseShortAnswerFeedback, scoreObjectiveAnswers, validateQuizResponse } from "./quiz";
import type { TranscriptSegment } from "../shared/types";

const segments: TranscriptSegment[] = [
  { id: "1", startSeconds: 0, endSeconds: 5, hasTimestamp: true, text: "Mitochondria produce ATP through cellular respiration.", source: "visible-captions" },
  { id: "2", startSeconds: 5, endSeconds: 10, hasTimestamp: true, text: "Chlorophyll absorbs light energy during photosynthesis.", source: "visible-captions" }
];

const payload = {
  questions: [
    { id: "q1", type: "multiple_choice", prompt: "What do mitochondria produce?", options: ["ATP", "Glucose", "Oxygen", "Water"], correctAnswer: "ATP", explanation: "The lesson states that mitochondria produce ATP.", topic: "Cellular respiration", evidence: "Mitochondria produce ATP" },
    { id: "q2", type: "true_false", prompt: "Chlorophyll absorbs light energy.", options: ["True", "False"], correctAnswer: "true", explanation: "Chlorophyll absorbs light energy.", topic: "Photosynthesis", evidence: "Chlorophyll absorbs light energy" },
    { id: "q3", type: "short_answer", prompt: "What process is associated with ATP production in this lesson?", options: [], correctAnswer: "Cellular respiration", explanation: "The lesson links ATP production to cellular respiration.", topic: "Cellular respiration", evidence: "through cellular respiration" }
  ]
};

describe("lesson quiz validation and scoring", () => {
  it("accepts a valid quiz with transcript-grounded evidence", () => {
    const questions = validateQuizResponse(JSON.stringify(payload), segments);
    expect(questions).toHaveLength(3);
    expect(questions[0].type).toBe("multiple_choice");
  });

  it("accepts JSON wrapped in a markdown code fence", () => {
    expect(validateQuizResponse("```json\n" + JSON.stringify(payload) + "\n```", segments)).toHaveLength(3);
  });

  it("rejects malformed JSON and unsupported question types", () => {
    expect(() => validateQuizResponse("{not json}", segments)).toThrow(/malformed/i);
    const invalid = structuredClone(payload);
    (invalid.questions[0] as { type: string }).type = "essay";
    expect(() => validateQuizResponse(JSON.stringify(invalid), segments)).toThrow(/unsupported type/i);
  });

  it("rejects unsupported evidence and invalid correct options", () => {
    const unsupported = structuredClone(payload);
    unsupported.questions[0].evidence = "The sun is made of cheese";
    expect(() => validateQuizResponse(JSON.stringify(unsupported), segments)).toThrow(/not present/i);
    const wrongAnswer = structuredClone(payload);
    wrongAnswer.questions[0].correctAnswer = "Not an option";
    expect(() => validateQuizResponse(JSON.stringify(wrongAnswer), segments)).toThrow(/match one of its options/i);
  });

  it("rejects true/false questions with invalid option labels", () => {
    const invalid = structuredClone(payload);
    invalid.questions[1].options = ["Yes", "No"];
    expect(() => validateQuizResponse(JSON.stringify(invalid), segments)).toThrow(/True\/False options/i);
  });

  it("scores objective questions and leaves short answers outside objective scoring", () => {
    const questions = validateQuizResponse(JSON.stringify(payload), segments);
    const result = scoreObjectiveAnswers(questions, { q1: "ATP", q2: "false", q3: "cell respiration" });
    expect(result.score).toBe(1);
    expect(result.total).toBe(2);
    expect(result.topicsToReview).toEqual(["Photosynthesis"]);
    expect(result.results[2].correct).toBeNull();
    expect(result.results[2].feedback).toMatch(/AI feedback/i);
  });

  it("validates short-answer feedback and ignores unknown question IDs", () => {
    const feedback = parseShortAnswerFeedback(JSON.stringify({ feedback: [
      { questionId: "q3", feedback: "Partly correct. Explain the process more clearly." },
      { questionId: "other", feedback: "Ignore this unrelated entry." }
    ] }), ["q3"]);
    expect(feedback.q3).toMatch(/Partly correct/);
    expect(feedback.other).toBeUndefined();
    expect(() => parseShortAnswerFeedback("not json", ["q3"])).toThrow(/invalid/i);
  });

  it("requires between three and ten questions and unique IDs", () => {
    const tooFew = { questions: payload.questions.slice(0, 2) };
    expect(() => validateQuizResponse(JSON.stringify(tooFew), segments)).toThrow(/between 3 and 10/i);
    const duplicate = structuredClone(payload);
    duplicate.questions[1].id = "q1";
    expect(() => validateQuizResponse(JSON.stringify(duplicate), segments)).toThrow(/unique/i);
  });
});
