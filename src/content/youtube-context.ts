import type { VideoContext } from "../shared/types";

const YOUTUBE_HOSTS = new Set(["www.youtube.com", "youtube.com", "m.youtube.com"]);

function cleanTitle(value: string): string {
  return value.replace(/\s+-\s+YouTube\s*$/i, "").replace(/\s+/g, " ").trim();
}

/**
 * Converts the current YouTube URL and the best available page title into
 * a stable lesson context. Kept pure so URL/title edge cases can be tested.
 */
export function readYouTubeVideoContext(
  href: string,
  documentTitle: string,
  headingTitle = ""
): VideoContext | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  if (!YOUTUBE_HOSTS.has(url.hostname) || url.pathname !== "/watch") return null;
  const videoId = url.searchParams.get("v")?.trim();
  if (!videoId) return null;

  const pageTitle = cleanTitle(documentTitle);
  const usablePageTitle = pageTitle.toLowerCase() === "youtube" ? "" : pageTitle;
  const title = cleanTitle(headingTitle) || usablePageTitle || "YouTube video";
  return {
    videoId,
    title,
    url: url.href,
    platform: "youtube"
  };
}

export function normalizeVisibleCaptionText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
