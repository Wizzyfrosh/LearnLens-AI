import { describe, expect, it } from "vitest";
import { buildContextWindow, formatTimestamp, MAX_TRANSCRIPT_CHARS, parseTranscript, parseTranscriptImport, serializeSegmentsAsVtt } from "./transcript";

describe("parseTranscriptImport", () => {
  it("parses SRT cues and preserves timestamps", () => {
    const result = parseTranscriptImport("1\n00:00:02,000 --> 00:00:04,500\nFirst concept\n\n2\n00:00:05,000 --> 00:00:06,000\nSecond concept");
    expect(result.errors).toEqual([]);
    expect(result.format).toBe("srt");
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({ startSeconds: 2, endSeconds: 4.5, text: "First concept" });
    expect(result.segments[1].startSeconds).toBe(5);
    expect(result.segments[0].hasTimestamp).toBe(true);
  });

  it("parses VTT cues, strips markup, and decodes entities", () => {
    const result = parseTranscriptImport("WEBVTT\n\n00:01:02.000 --> 00:01:04.000 align:start\n<c.green>Hello</c> &amp; <b>world</b>");
    expect(result.format).toBe("vtt");
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({ startSeconds: 62, text: "Hello & world" });
  });

  it("keeps plain text usable without inventing timestamps", () => {
    const result = parseTranscriptImport("A concept\nAnother concept");
    expect(result.format).toBe("plain-text");
    expect(result.segments.map((item) => item.text)).toEqual(["A concept", "Another concept"]);
    expect(result.segments[0].startSeconds).toBe(0);
    expect(result.segments[0].hasTimestamp).toBe(false);
    expect(buildContextWindow(result.segments)).toBe("A concept\nAnother concept");
  });

  it("rejects empty and oversized input", () => {
    expect(parseTranscriptImport("  ").errors[0]).toMatch(/empty/i);
    expect(parseTranscriptImport("x".repeat(MAX_TRANSCRIPT_CHARS + 1)).errors[0]).toMatch(/character limit/i);
  });

  it("does not silently treat malformed timed captions as plain text", () => {
    const result = parseTranscriptImport("WEBVTT\n\n00:99:99.000 --> 00:99:99.000\nBad cue");
    expect(result.segments).toEqual([]);
    expect(result.errors[0]).toMatch(/valid timestamped captions/i);
    expect(result.warnings[0]).toMatch(/invalid/i);
  });

  it("skips invalid cues while retaining valid cues", () => {
    const result = parseTranscriptImport("WEBVTT\n\n00:00:02.000 --> 00:00:01.000\nBad cue\n\n00:00:03.000 --> 00:00:04.000\nGood cue");
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe("Good cue");
    expect(result.warnings).toHaveLength(1);
  });

  it("throws a useful error through the legacy parser", () => {
    expect(() => parseTranscript("")).toThrow(/empty/i);
  });
});

describe("transcript context helpers", () => {
  it("formats timestamps", () => {
    expect(formatTimestamp(125)).toBe("02:05");
  });

  it("limits context length including separators", () => {
    const segments = parseTranscript("00:00:01.000 --> 00:00:02.000\nAlpha\n\n00:00:03.000 --> 00:00:04.000\nBeta");
    expect(buildContextWindow(segments, 15).length).toBeLessThanOrEqual(15);
  });

  it("returns an empty context for invalid limits", () => {
    expect(buildContextWindow(parseTranscript("hello"), 0)).toBe("");
  });

  it("selects a relevant passage near the end of a long lesson", () => {
    const segments = Array.from({ length: 80 }, (_, index) => ({
      id: `segment-${index}`,
      startSeconds: index * 10,
      endSeconds: index * 10 + 8,
      hasTimestamp: true,
      text: index === 72 ? "Mitochondria generate ATP through cellular respiration." : `Unrelated lesson passage number ${index}.`,
      source: "visible-captions" as const
    }));
    const context = buildContextWindow(segments, 120, "How do mitochondria generate ATP?");
    expect(context).toContain("Mitochondria generate ATP");
    expect(context.length).toBeLessThanOrEqual(120);
  });

  it("keeps generic-question context within the budget and samples beyond the opening", () => {
    const segments = Array.from({ length: 50 }, (_, index) => ({
      id: `segment-${index}`,
      startSeconds: index,
      endSeconds: index + 1,
      hasTimestamp: false,
      text: `Passage ${index} contains a distinct concept.`,
      source: "manual" as const
    }));
    const context = buildContextWindow(segments, 120, "Explain this lesson");
    expect(context.length).toBeLessThanOrEqual(120);
    expect(context).toContain("Passage 0");
    expect(context).toContain("Passage 49");
  });
});


describe("captured transcript serialization", () => {
  it("serializes visible caption segments into valid timestamped WebVTT", () => {
    const segments = [{
      id: "caption-1",
      startSeconds: 12.25,
      endSeconds: 13.5,
      hasTimestamp: true,
      text: "A captured lesson segment",
      source: "visible-captions" as const
    }];
    const vtt = serializeSegmentsAsVtt(segments);
    expect(vtt).toContain("WEBVTT");
    expect(vtt).toContain("00:00:12.250 --> 00:00:13.500");
    expect(parseTranscriptImport(vtt).segments[0].text).toBe("A captured lesson segment");
  });

  it("does not invent timestamps for untimed segments", () => {
    expect(serializeSegmentsAsVtt([{
      id: "plain",
      startSeconds: 0,
      endSeconds: 0,
      hasTimestamp: false,
      text: "Untimed text",
      source: "manual"
    }])).toBe("WEBVTT\n");
  });
});
