import type { TranscriptSegment } from "../shared/types";

export type QuizQuestionType = "multiple_choice" | "true_false" | "short_answer";

export interface QuizQuestion {
  id: string;
  type: QuizQuestionType;
  prompt: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  topic: string;
  evidence: string;
}

export interface QuizDefinition {
  id: string;
  sessionId: string;
  title: string;
  scope: "whole_lesson" | "topic" | "time_range";
  scopeLabel: string;
  rangeStartSeconds?: number;
  rangeEndSeconds?: number;
  createdAt: number;
  questions: QuizQuestion[];
}

export function getQuizFeedbackSegments(quiz: QuizDefinition, segments: TranscriptSegment[]): TranscriptSegment[] {
  if (quiz.scope !== "time_range") return segments;
  const start = quiz.rangeStartSeconds;
  const end = quiz.rangeEndSeconds;
  if (!Number.isFinite(start) || !Number.isFinite(end) || (start as number) < 0 || (end as number) <= (start as number)) {
    return [];
  }
  return segments.filter((segment) => segment.hasTimestamp && segment.endSeconds >= (start as number) && segment.startSeconds <= (end as number));
}

export interface QuizQuestionResult {
  questionId: string;
  answer: string;
  correct: boolean | null;
  feedback: string;
}

export interface QuizAttempt {
  id: string;
  quizId: string;
  sessionId: string;
  createdAt: number;
  results: QuizQuestionResult[];
  objectiveScore: number;
  objectiveTotal: number;
  topicsToReview: string[];
}

function normalizeEvidence(value: string): string {
  // buildContextWindow prefixes timestamped cues with labels such as [02:15].
  // Gemini may include those labels or vary punctuation when quoting a cue.
  // Normalize presentation only; preserve the actual words and their order.
  return (value.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
}

function readString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`Quiz question has an invalid ${field}.`);
  const result = value.trim();
  if (!result || result.length > maxLength) throw new Error(`Quiz question ${field} is empty or too long.`);
  return result;
}

function extractJsonObject(text: string): unknown {
  const source = text.trim().replace(/^\uFEFF/, "").replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "");
  const start = source.indexOf("{");
  if (start < 0) throw new Error("The AI response did not contain a JSON quiz.");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(start, index + 1)) as unknown;
    }
  }
  throw new Error("The AI response contained incomplete JSON. Generate the quiz again.");
}

export function validateQuizResponse(text: string, segments: TranscriptSegment[]): QuizQuestion[] {
  let parsed: unknown;
  try {
    parsed = extractJsonObject(text);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("The AI returned malformed quiz JSON. Generate the quiz again.");
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { questions?: unknown }).questions)) {
    throw new Error("The AI response is missing its questions array.");
  }

  const rawQuestions = (parsed as { questions: unknown[] }).questions;
  if (rawQuestions.length < 3 || rawQuestions.length > 10) {
    throw new Error("A quiz must contain between 3 and 10 questions.");
  }

  const transcript = normalizeEvidence(segments.map((segment) => segment.text).join(" "));
  const ids = new Set<string>();
  const questions: QuizQuestion[] = rawQuestions.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`Quiz question ${index + 1} is not an object.`);
    const item = raw as Record<string, unknown>;
    const id = readString(item.id, "id", 64);
    if (ids.has(id)) throw new Error("Quiz question IDs must be unique.");
    ids.add(id);

    const type = item.type as QuizQuestionType;
    if (type !== "multiple_choice" && type !== "true_false" && type !== "short_answer") {
      throw new Error(`Quiz question ${index + 1} has an unsupported type.`);
    }
    const prompt = readString(item.prompt, "prompt", 500);
    const correctAnswer = readString(item.correctAnswer, "correct answer", 500);
    const explanation = readString(item.explanation, "explanation", 1200);
    const topic = readString(item.topic, "topic", 100);
    const evidence = readString(item.evidence, "evidence", 500);
    if (!transcript.includes(normalizeEvidence(evidence))) {
      throw new Error(`Quiz question ${index + 1} includes evidence that is not present in the lesson transcript.`);
    }

    if (!Array.isArray(item.options) || !item.options.every((option) => typeof option === "string")) {
      throw new Error(`Quiz question ${index + 1} has invalid answer options.`);
    }
    const options = (item.options as string[]).map((option) => option.trim());
    if (new Set(options.map((option) => option.toLocaleLowerCase())).size !== options.length) {
      throw new Error(`Quiz question ${index + 1} contains duplicate answer options.`);
    }
    const evidenceWordCount = evidence.split(/\s+/).length;
    if (evidenceWordCount < 3 || evidenceWordCount > 25) {
      throw new Error(`Quiz question ${index + 1} evidence must be a short, exact transcript excerpt.`);
    }
    if (type === "multiple_choice") {
      if (options.length < 3 || options.length > 5 || options.some((option) => !option || option.length > 180)) {
        throw new Error(`Multiple-choice question ${index + 1} must have 3 to 5 valid options.`);
      }
      if (!options.some((option) => option.toLocaleLowerCase() === correctAnswer.toLocaleLowerCase())) {
        throw new Error(`The correct answer for question ${index + 1} must match one of its options.`);
      }
    } else if (type === "true_false") {
      if (options.length !== 2 || !options.some((option) => option.toLocaleLowerCase() === "true") || !options.some((option) => option.toLocaleLowerCase() === "false") || !["true", "false"].includes(correctAnswer.toLocaleLowerCase())) {
        throw new Error(`True/false question ${index + 1} must have True/False options and a boolean answer.`);
      }
    } else if (options.length !== 0) {
      throw new Error(`Short-answer question ${index + 1} must not include multiple-choice options.`);
    }

    if (type !== "true_false" && !transcript.includes(normalizeEvidence(correctAnswer))) {
      throw new Error(`The correct answer for question ${index + 1} is not explicitly supported by the lesson transcript.`);
    }

    return { id, type, prompt, options, correctAnswer, explanation, topic, evidence };
  });
  if (new Set(questions.map((question) => question.type)).size !== 3) {
    throw new Error("The quiz must include multiple-choice, true/false, and short-answer questions.");
  }
  return questions;
}

export function scoreObjectiveAnswers(
  questions: QuizQuestion[],
  answers: Record<string, string>
): { results: QuizQuestionResult[]; score: number; total: number; topicsToReview: string[] } {
  let score = 0;
  let total = 0;
  const weakTopics = new Set<string>();
  const results = questions.map((question) => {
    const answer = (answers[question.id] ?? "").trim();
    if (question.type === "short_answer") {
      return { questionId: question.id, answer, correct: null, feedback: answer ? "AI feedback is pending; this response is not included in the objective score." : "No answer submitted. Expected answer: " + question.correctAnswer };
    }
    total += 1;
    const correct = answer.toLocaleLowerCase() === question.correctAnswer.toLocaleLowerCase();
    if (correct) score += 1;
    else weakTopics.add(question.topic);
    return {
      questionId: question.id,
      answer,
      correct,
      feedback: correct ? question.explanation : `Correct answer: ${question.correctAnswer}. ${question.explanation}`
    };
  });
  return { results, score, total, topicsToReview: [...weakTopics] };
}

export function parseShortAnswerFeedback(
  text: string,
  expectedQuestionIds: string[]
): Record<string, string> {
  let parsed: unknown;
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    parsed = JSON.parse(cleaned) as unknown;
  } catch {
    throw new Error("The AI returned invalid short-answer feedback.");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { feedback?: unknown }).feedback)) {
    throw new Error("The AI feedback response is missing its feedback list.");
  }
  const expected = new Set(expectedQuestionIds);
  const result: Record<string, string> = {};
  for (const item of (parsed as { feedback: unknown[] }).feedback) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.questionId !== "string" || !expected.has(entry.questionId)) continue;
    if (typeof entry.feedback !== "string" || !entry.feedback.trim() || entry.feedback.length > 1200) continue;
    result[entry.questionId] = entry.feedback.trim();
  }
  return result;
}
