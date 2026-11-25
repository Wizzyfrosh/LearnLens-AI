import type { TranscriptSegment } from "../shared/types";

export const MAX_TRANSCRIPT_CHARS = 500_000;
export const MAX_TRANSCRIPT_SEGMENTS = 10_000;

export type TranscriptFormat = "vtt" | "srt" | "plain-text";

export interface TranscriptImportResult {
  segments: TranscriptSegment[];
  format: TranscriptFormat;
  warnings: string[];
  errors: string[];
}

function parseTimestamp(value: string): number | null {
  const normalized = value.replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length !== 2 && parts.length !== 3) return null;

  const secondsPart = parts.at(-1) ?? "";
  const [secondsText, millisecondsText] = secondsPart.split(".");
  if (!/^\d{2}$/.test(secondsText) || !/^\d{3}$/.test(millisecondsText ?? "")) return null;

  const seconds = Number(secondsText);
  const minutes = Number(parts.at(-2));
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) return null;
  if (!Number.isInteger(hours) || hours < 0) return null;
  if (seconds > 59) return null;

  return hours * 3600 + minutes * 60 + seconds + Number(millisecondsText) / 1000;
}

function cleanCueText(lines: string[]): string {
  return lines
    .join(" ")
    .replace(/<\/?(?:c(?:\.[^ >]+)?|v(?: [^>]*)?|lang(?: [^>]*)?|i|b|u|ruby|rt)[^>]*>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function makeSegment(
  index: number,
  text: string,
  startSeconds = 0,
  endSeconds = 0,
  hasTimestamp = false
): TranscriptSegment {
  return {
    id: `segment-${index}`,
    startSeconds,
    endSeconds,
    hasTimestamp,
    text,
    source: "manual"
  };
}

/**
 * Parses a user-supplied VTT, SRT, or plain-text transcript.
 * Invalid timed cues are reported; they are never silently reinterpreted as plain text.
 */
export function parseTranscriptImport(input: string): TranscriptImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const normalized = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();

  if (!normalized) {
    return { segments: [], format: "plain-text", warnings, errors: ["Transcript is empty."] };
  }
  if (normalized.length > MAX_TRANSCRIPT_CHARS) {
    return {
      segments: [],
      format: "plain-text",
      warnings,
      errors: [`Transcript exceeds the ${MAX_TRANSCRIPT_CHARS.toLocaleString()} character limit.`]
    };
  }

  const lines = normalized.split("\n");
  const isVtt = /^WEBVTT(?:\s|$)/i.test(lines[0] ?? "");
  const hasTimingMarker = lines.some((line) => line.includes("-->"));
  const format: TranscriptFormat = isVtt ? "vtt" : hasTimingMarker ? "srt" : "plain-text";

  if (!hasTimingMarker) {
    const textLines = lines.map((line) => line.trim()).filter(Boolean);
    if (!textLines.length) errors.push("Transcript contains no readable text.");
    if (textLines.length > MAX_TRANSCRIPT_SEGMENTS) errors.push("Transcript contains too many lines.");
    return {
      segments: errors.length ? [] : textLines.map((line, index) => makeSegment(index, line)),
      format,
      warnings,
      errors
    };
  }

  const segments: TranscriptSegment[] = [];
  let malformedCues = 0;
  let i = 0;

  while (i < lines.length) {
    const timingLine = lines[i].trim();
    if (!timingLine.includes("-->")) {
      i += 1;
      continue;
    }

    const match = timingLine.match(/^((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})(?:\s+.*)?$/);
    if (!match) {
      malformedCues += 1;
      i += 1;
      continue;
    }

    const startSeconds = parseTimestamp(match[1]);
    const endSeconds = parseTimestamp(match[2]);
    const cueLines: string[] = [];
    i += 1;

    while (i < lines.length && lines[i].trim()) {
      const line = lines[i].trim();
      if (!line.startsWith("NOTE") && !line.startsWith("STYLE") && !line.startsWith("REGION")) {
        cueLines.push(line);
      }
      i += 1;
    }

    const text = cleanCueText(cueLines);
    if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds || !text) {
      malformedCues += 1;
      continue;
    }

    segments.push(makeSegment(segments.length, text, startSeconds, endSeconds, true));
    if (segments.length > MAX_TRANSCRIPT_SEGMENTS) {
      errors.push(`Transcript exceeds the ${MAX_TRANSCRIPT_SEGMENTS.toLocaleString()} cue limit.`);
      break;
    }
  }

  if (malformedCues > 0) {
    warnings.push(`${malformedCues} invalid or empty caption cue(s) were skipped.`);
  }
  if (!segments.length && !errors.length) {
    errors.push("No valid timestamped captions were found. Check that the file is valid VTT or SRT.");
  }

  return { segments: errors.length ? [] : segments, format, warnings, errors };
}

/** Backwards-compatible parser for callers that only need segments. */
export function parseTranscript(input: string): TranscriptSegment[] {
  const result = parseTranscriptImport(input);
  if (result.errors.length) throw new Error(result.errors[0]);
  return result.segments;
}

export function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60).toString().padStart(2, "0")}:${(safe % 60).toString().padStart(2, "0")}`;
}

export function buildContextWindow(segments: TranscriptSegment[], maxChars = 12_000): string {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return "";
  let output = "";
  for (const segment of segments) {
    const line = segment.hasTimestamp ? `[${formatTimestamp(segment.startSeconds)}] ${segment.text}` : segment.text;
    const separator = output ? "\n" : "";
    const remaining = maxChars - output.length - separator.length;
    if (remaining <= 0) break;
    output += separator + line.slice(0, remaining);
  }
  return output;
}
