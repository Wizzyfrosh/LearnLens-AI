import { describe, expect, it } from "vitest";
import { buildContextWindow, formatTimestamp, parseTranscript } from "./transcript";

describe("parseTranscript", () => {
  it("parses SRT cues and preserves timestamps", () => {
    const result = parseTranscript("1\n00:00:02,000 --> 00:00:04,500\nFirst concept\n\n2\n00:00:05,000 --> 00:00:06,000\nSecond concept");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ startSeconds: 2, endSeconds: 4.5, text: "First concept" });
    expect(result[1].startSeconds).toBe(5);
  });

  it("parses VTT cues and strips markup", () => {
    const result = parseTranscript("WEBVTT\n\n00:01:02.000 --> 00:01:04.000\n<c.green>Hello</c> world");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ startSeconds: 62, text: "Hello world" });
  });

  it("keeps plain text usable when timestamps are absent", () => {
    const result = parseTranscript("A concept\nAnother concept");
    expect(result.map((item) => item.text)).toEqual(["A concept", "Another concept"]);
    expect(result[0].startSeconds).toBe(0);\n    expect(result[0].hasTimestamp).toBe(false);\n    expect(buildContextWindow(result)).toBe("A concept\\nAnother concept");
  });
});

describe("transcript context helpers", () => {
  it("formats timestamps", () => {
    expect(formatTimestamp(125)).toBe("02:05");
  });

  it("limits context length", () => {
    const segments = parseTranscript("00:00:01.000 --> 00:00:02.000\nAlpha\n\n00:00:03.000 --> 00:00:04.000\nBeta");
    expect(buildContextWindow(segments, 15).length).toBeLessThanOrEqual(15);
  });
});
