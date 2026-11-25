import { describe, expect, it } from "vitest";
import { readVisibleCaptionText } from "./youtube-context";

describe("readVisibleCaptionText", () => {
  it("joins visible caption segments and normalizes whitespace", () => {
    expect(readVisibleCaptionText(["The first part", "of the lesson"], "fallback"))
      .toBe("The first part of the lesson");
  });

  it("falls back to caption container text when segment nodes are unavailable", () => {
    expect(readVisibleCaptionText([], "  already   rendered captions  "))
      .toBe("already rendered captions");
  });
});
