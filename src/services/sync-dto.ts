import type { LearningNote, LearningSession } from "./session-store";
import type { QuizAttempt, QuizDefinition } from "./quiz";

export interface LessonMetadataDto {
  platform: "youtube" | "manual";
  videoId: string;
  title: string;
  url: string;
}

export interface NoteSyncDto {
  title: string;
  content: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface QuizSyncDto {
  title: string;
  scope: QuizDefinition["scope"];
  scopeLabel: string;
  rangeStartSeconds?: number;
  rangeEndSeconds?: number;
  createdAtMs: number;
  questions: QuizDefinition["questions"];
}

export interface AttemptSyncDto {
  quizId: string;
  createdAtMs: number;
  results: QuizAttempt["results"];
  objectiveScore: number;
  objectiveTotal: number;
  topicsToReview: string[];
}

const MAX_NOTE_BYTES = 256 * 1024;
const MAX_QUIZ_BYTES = 512 * 1024;
const MAX_ATTEMPT_BYTES = 512 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function assertText(value: string, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`The ${field} is too large or invalid for cloud sync.`);
  }
  return value;
}

function assertSize(value: unknown, maxBytes: number, label: string): void {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > maxBytes) throw new Error(`${label} exceeds the cloud sync size limit and will remain local.`);
}

function safeYouTubeUrl(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "";
    if (!["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(parsed.hostname)) return "";
    const videoId = parsed.hostname === "youtu.be"
      ? parsed.pathname.split("/").filter(Boolean)[0] ?? ""
      : parsed.searchParams.get("v") ?? "";
    if (!ID_PATTERN.test(videoId)) return "";
    return `https://www.youtube.com/watch?v=${videoId}`;
  } catch {
    return "";
  }
}

/** Explicit projection: transcriptText, transcriptFormat and transcriptSource never cross this boundary. */
export function toLessonMetadataDto(session: LearningSession): LessonMetadataDto {
  const videoId = session.platform === "youtube" && ID_PATTERN.test(session.videoId) ? session.videoId : "";
  const url = session.platform === "youtube" && videoId
    ? `https://www.youtube.com/watch?v=${videoId}`
    : safeYouTubeUrl(session.url);
  const dto: LessonMetadataDto = {
    platform: session.platform,
    videoId,
    title: assertText(session.title, "lesson title", 500),
    url
  };
  assertSize(dto, 16 * 1024, "Lesson metadata");
  return dto;
}

export function toNoteSyncDto(note: LearningNote): NoteSyncDto {
  const dto: NoteSyncDto = {
    title: assertText(note.title, "note title", 500),
    content: assertText(note.content, "note content", MAX_NOTE_BYTES),
    createdAtMs: note.createdAt,
    updatedAtMs: note.updatedAt
  };
  assertSize(dto, MAX_NOTE_BYTES, "Note");
  return dto;
}

export function toQuizSyncDto(quiz: QuizDefinition): QuizSyncDto {
  const dto: QuizSyncDto = {
    title: assertText(quiz.title, "quiz title", 500),
    scope: quiz.scope,
    scopeLabel: assertText(quiz.scopeLabel, "quiz scope label", 500),
    ...(Number.isFinite(quiz.rangeStartSeconds) ? { rangeStartSeconds: quiz.rangeStartSeconds } : {}),
    ...(Number.isFinite(quiz.rangeEndSeconds) ? { rangeEndSeconds: quiz.rangeEndSeconds } : {}),
    createdAtMs: quiz.createdAt,
    questions: quiz.questions.map((question) => ({
      id: assertText(question.id, "question ID", 64),
      type: question.type,
      prompt: assertText(question.prompt, "question prompt", 500),
      options: question.options.map((option) => assertText(option, "answer option", 180)),
      correctAnswer: assertText(question.correctAnswer, "correct answer", 500),
      explanation: assertText(question.explanation, "question explanation", 1200),
      topic: assertText(question.topic, "question topic", 100),
      evidence: assertText(question.evidence, "question evidence", 500)
    }))
  };
  assertSize(dto, MAX_QUIZ_BYTES, "Quiz");
  return dto;
}

export function toAttemptSyncDto(attempt: QuizAttempt): AttemptSyncDto {
  const dto: AttemptSyncDto = {
    quizId: assertText(attempt.quizId, "quiz ID", 128),
    createdAtMs: attempt.createdAt,
    results: attempt.results.map((result) => ({
      questionId: assertText(result.questionId, "question ID", 64),
      answer: assertText(result.answer, "learner answer", 2000),
      correct: result.correct,
      feedback: assertText(result.feedback, "answer feedback", 1200)
    })),
    objectiveScore: attempt.objectiveScore,
    objectiveTotal: attempt.objectiveTotal,
    topicsToReview: attempt.topicsToReview.map((topic) => assertText(topic, "review topic", 100))
  };
  assertSize(dto, MAX_ATTEMPT_BYTES, "Quiz attempt");
  return dto;
}
