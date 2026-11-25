import type { TranscriptSegment } from "../shared/types";

function toSeconds(value: string): number {
  const parts = value.replace(",", ".").split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function parseTranscript(input: string): TranscriptSegment[] {
  const normalized = input.replace(/^\uFEFF/, "").replace(/\r/g, "");
  const lines = normalized.split("\n");
  const segments: TranscriptSegment[] = [];
  let index = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const match = line.match(/^(\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{3}/);
    if (!match) continue;

    const [startRaw, endRaw] = line.split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const startSeconds = toSeconds(startRaw);
    const endSeconds = toSeconds(endRaw);
    const textLines: string[] = [];
    i += 1;

    while (i < lines.length && lines[i].trim() && !/^\d+$/.test(lines[i].trim())) {
      const candidate = lines[i].trim();
      if (!candidate.startsWith("WEBVTT") && !candidate.startsWith("NOTE")) {
        textLines.push(candidate.replace(/<[^>]*>/g, ""));
      }
      i += 1;
    }

    const text = textLines.join(" ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
    if (text && endSeconds >= startSeconds) {
      segments.push({
        id: `segment-${index++}`,
        startSeconds,
        endSeconds,
        text,
        source: "manual"
      });
    }
  }

  if (segments.length > 0) return segments;

  return normalized.split("\n").map((line) => line.trim()).filter(Boolean).map((text, i) => ({
    id: `segment-${i}`,
    startSeconds: 0,
    endSeconds: 0,
    text,
    source: "manual" as const
  }));
}

export function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60).toString().padStart(2, "0")}:${(safe % 60).toString().padStart(2, "0")}`;
}

export function buildContextWindow(segments: TranscriptSegment[], maxChars = 12000): string {
  let remaining = maxChars;
  const selected: string[] = [];
  for (const segment of segments) {
    if (remaining <= 0) break;
    const line = `[${formatTimestamp(segment.startSeconds)}] ${segment.text}`;
    selected.push(line.slice(0, remaining));
    remaining -= line.length;
  }
  return selected.join("\n");
}