import type { VideoContext } from "../shared/types";
import type { ExtensionMessage } from "../shared/messages";

function readVideoContext(): VideoContext | null {
  const url = new URL(window.location.href);
  const videoId = url.searchParams.get("v");
  if (!videoId || !url.pathname.startsWith("/watch")) return null;

  return {
    videoId,
    title: document.querySelector("h1.ytd-watch-metadata")?.textContent?.trim() || document.title.replace(" - YouTube", ""),
    url: window.location.href,
    platform: "youtube"
  };
}

function publishContext() {
  const context = readVideoContext();
  if (!context) return;
  const message: ExtensionMessage = { type: "LEARNLENS_VIDEO_CONTEXT", payload: context };
  chrome.runtime.sendMessage(message).catch(() => undefined);
}

publishContext();
document.addEventListener("yt-navigate-finish", publishContext);
window.addEventListener("popstate", publishContext);
