import type { TranscriptSegment } from "../shared/types";
import type { ExtensionMessage } from "../shared/messages";
import { normalizeVisibleCaptionText, readYouTubeVideoContext } from "./youtube-context";

let lastContextKey = "__initial__";
let refreshTimers: number[] = [];
let isCaptionCaptureActive = false;
let captionObserver: MutationObserver | null = null;
let captionDiscoveryObserver: MutationObserver | null = null;
let captionDebounceTimer: number | null = null;
let lastCaptionText = "";
let lastCaptionAt = -Infinity;
let captionSequence = 0;
let captureVideoId = "";

function send(message: ExtensionMessage): void {
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

function readCurrentContext() {
  const heading = document.querySelector("h1.ytd-watch-metadata")?.textContent ?? "";
  return readYouTubeVideoContext(window.location.href, document.title, heading);
}

function publishContext(): void {
  const context = readCurrentContext();
  const key = context
    ? [context.videoId, context.title, context.url].join("|")
    : "no-supported-video";

  if (key === lastContextKey) return;

  if (isCaptionCaptureActive && context?.videoId !== captureVideoId) {
    stopCaptionCapture("The lesson changed. Start learning again to capture the new video.");
  }

  lastContextKey = key;
  send({ type: "LEARNLENS_VIDEO_CONTEXT", payload: context });
}

function clearRefreshTimers(): void {
  refreshTimers.forEach((timer) => window.clearTimeout(timer));
  refreshTimers = [];
}

function scheduleContextRefresh(): void {
  clearRefreshTimers();
  // YouTube updates URL, title and player metadata at slightly different times.
  // Retry briefly after SPA navigation instead of trusting the first stale DOM read.
  for (const delay of [0, 120, 400, 900]) {
    refreshTimers.push(window.setTimeout(publishContext, delay));
  }
}

function emitCaptureStatus(status: "idle" | "waiting_for_captions" | "capturing" | "unsupported" | "error", message: string): void {
  send({ type: "LEARNLENS_CAPTURE_STATUS", payload: { status, message } });
}

function disconnectCaptionObservers(): void {
  captionObserver?.disconnect();
  captionDiscoveryObserver?.disconnect();
  captionObserver = null;
  captionDiscoveryObserver = null;
  if (captionDebounceTimer !== null) {
    window.clearTimeout(captionDebounceTimer);
    captionDebounceTimer = null;
  }
}

function publishVisibleCaption(): void {
  if (!isCaptionCaptureActive) return;
  const text = normalizeVisibleCaptionText(
    [...document.querySelectorAll(".ytp-caption-segment")]
      .map((element) => element.textContent ?? "")
      .join(" ")
  );
  if (!text) return;

  const video = document.querySelector("video");
  const startSeconds = video?.currentTime ?? 0;
  if (text === lastCaptionText && startSeconds - lastCaptionAt < 2) return;

  const context = readCurrentContext();
  if (!context || context.videoId !== captureVideoId) {
    stopCaptionCapture("The active lesson changed. Start learning again to continue.");
    return;
  }

  lastCaptionText = text;
  lastCaptionAt = startSeconds;
  captionSequence += 1;
  const segment: TranscriptSegment = {
    id: `caption-${context.videoId}-${Math.round(startSeconds * 1000)}-${captionSequence}`,
    startSeconds,
    endSeconds: startSeconds + 1,
    hasTimestamp: true,
    text,
    source: "visible-captions"
  };
  send({ type: "LEARNLENS_CAPTION_SEGMENT", payload: segment });
}

function scheduleCaptionRead(): void {
  if (captionDebounceTimer !== null) window.clearTimeout(captionDebounceTimer);
  captionDebounceTimer = window.setTimeout(() => {
    captionDebounceTimer = null;
    publishVisibleCaption();
  }, 180);
}

function attachCaptionObserver(): boolean {
  const container = document.querySelector(".ytp-caption-window-container");
  if (!container) return false;

  captionDiscoveryObserver?.disconnect();
  captionDiscoveryObserver = null;
  captionObserver?.disconnect();
  captionObserver = new MutationObserver(scheduleCaptionRead);
  captionObserver.observe(container, {
    childList: true,
    subtree: true,
    characterData: true
  });

  emitCaptureStatus("capturing", "Capturing captions currently rendered by YouTube.");
  scheduleCaptionRead();
  return true;
}

function startCaptionCapture(): void {
  const context = readCurrentContext();
  if (!context) {
    emitCaptureStatus("unsupported", "Open a supported YouTube watch page before starting a lesson.");
    return;
  }

  disconnectCaptionObservers();
  isCaptionCaptureActive = true;
  captureVideoId = context.videoId;
  lastCaptionText = "";
  lastCaptionAt = -Infinity;
  captionSequence = 0;

  if (attachCaptionObserver()) return;

  emitCaptureStatus("waiting_for_captions", "Turn on CC in the YouTube player. LearnLens is waiting for rendered captions.");
  captionDiscoveryObserver = new MutationObserver(() => {
    if (isCaptionCaptureActive) attachCaptionObserver();
  });
  captionDiscoveryObserver.observe(document.documentElement, { childList: true, subtree: true });
}

function stopCaptionCapture(message = "Lesson capture stopped."): void {
  isCaptionCaptureActive = false;
  captureVideoId = "";
  disconnectCaptionObservers();
  emitCaptureStatus("idle", message);
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === "LEARNLENS_CONTENT_START_CAPTION_CAPTURE") startCaptionCapture();
  if (message.type === "LEARNLENS_CONTENT_STOP_CAPTION_CAPTURE") stopCaptionCapture();
});

document.addEventListener("yt-navigate-finish", scheduleContextRefresh);
document.addEventListener("yt-page-data-updated", scheduleContextRefresh);
document.addEventListener("yt-navigate-start", () => {
  // Clear context immediately only when navigation leaves the supported watch route.
  if (!readYouTubeVideoContext(window.location.href, document.title)) publishContext();
});
window.addEventListener("popstate", scheduleContextRefresh);
window.addEventListener("hashchange", scheduleContextRefresh);

const titleElement = document.querySelector("title");
if (titleElement) {
  new MutationObserver(scheduleContextRefresh).observe(titleElement, {
    childList: true,
    characterData: true,
    subtree: true
  });
}

scheduleContextRefresh();
