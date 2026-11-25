import { describe, expect, it } from "vitest";
import { normalizeVisibleCaptionText, readYouTubeVideoContext } from "./youtube-context";

describe("readYouTubeVideoContext", () => {
  it("detects a watch page and prefers the rendered heading title", () => {
    expect(readYouTubeVideoContext(
      "https://www.youtube.com/watch?v=abc123",
      "Old title - YouTube",
      "Current lesson title"
    )).toEqual({
      videoId: "abc123",
      title: "Current lesson title",
      url: "https://www.youtube.com/watch?v=abc123",
      platform: "youtube"
    });
  });

  it("uses the document title while the watch heading is not rendered", () => {
    expect(readYouTubeVideoContext(
      "https://www.youtube.com/watch?v=abc123",
      "Current lesson - YouTube"
    )?.title).toBe("Current lesson");
  });

  it("uses a safe title fallback instead of leaving metadata blank", () => {
    expect(readYouTubeVideoContext(
      "https://www.youtube.com/watch?v=abc123",
      "YouTube"
    )?.title).toBe("YouTube video");
  });

  it("rejects non-watch routes and unsupported hosts", () => {
    expect(readYouTubeVideoContext("https://www.youtube.com/", "YouTube")).toBeNull();
    expect(readYouTubeVideoContext("https://www.youtube.com/shorts/abc123", "YouTube")).toBeNull();
    expect(readYouTubeVideoContext("https://example.com/watch?v=abc123", "Example")).toBeNull();
  });

  it("normalizes visible caption whitespace", () => {
    expect(normalizeVisibleCaptionText("  one  line\n another  ")).toBe("one line another");
  });
});
