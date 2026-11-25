import type { TranscriptSegment } from "../shared/types";
import type { ExtensionMessage } from "../shared/messages";
import { readVisibleCaptionText, readYouTubeVideoContext } from "./youtube-context";
(() => {
  const isolatedWindow = window as Window & { __learnLensYouTubeContentScriptReady?: boolean };
  if (isolatedWindow.__learnLensYouTubeContentScriptReady) return;
  isolatedWindow.__learnLensYouTubeContentScriptReady = true;


let lastContextKey = "__initial__";
let refreshTimers: number[] = [];
let isCaptionCaptureActive = false;
let captionObserver: MutationObserver | null = null;
let captionDebounceTimer: number | null = null;
let lastCaptionText = "";
let lastCaptionAt = -Infinity;
let captionSequence = 0;
let captureVideoId = "";
let hasCapturedCaption = false;

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
  captionObserver = null;
  if (captionDebounceTimer !== null) {
    window.clearTimeout(captionDebounceTimer);
    captionDebounceTimer = null;
  }
}

function publishVisibleCaption(): void {
  if (!isCaptionCaptureActive) return;
  const captionSegments = [...document.querySelectorAll(".ytp-caption-segment")]
    .map((element) => element.textContent ?? "");
  const captionContainerText = document.querySelector(".ytp-caption-window-container")?.textContent ?? "";
  const text = readVisibleCaptionText(captionSegments, captionContainerText);
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
  if (!hasCapturedCaption) {
    hasCapturedCaption = true;
    emitCaptureStatus("capturing", "Capturing captions currently rendered by YouTube.");
  }
}

function scheduleCaptionRead(): void {
  if (captionDebounceTimer !== null) window.clearTimeout(captionDebounceTimer);
  captionDebounceTimer = window.setTimeout(() => {
    captionDebounceTimer = null;
    publishVisibleCaption();
  }, 180);
}

function attachCaptionObserver(): boolean {
  // Observe the stable player root, not just the current caption container.
  // YouTube can create or replace its caption container after CC is enabled.
  const observationRoot = document.querySelector("#movie_player")
    ?? document.querySelector(".html5-video-player")
    ?? document.documentElement
    ?? document;
  if (!observationRoot) return false;

  captionObserver?.disconnect();
  captionObserver = new MutationObserver(scheduleCaptionRead);
  captionObserver.observe(observationRoot, {
    childList: true,
    subtree: true,
    characterData: true
  });

  emitCaptureStatus(
    "waiting_for_captions",
    "Checking the YouTube player for captions. Captions already enabled will be captured automatically."
  );
  // Read immediately as existing captions may not mutate after observer setup.
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
  hasCapturedCaption = false;

  if (!attachCaptionObserver()) {
    isCaptionCaptureActive = false;
    captureVideoId = "";
    emitCaptureStatus("error", "LearnLens could not attach to the YouTube player.");
  }
}

function stopCaptionCapture(message = "Lesson capture stopped."): void {
  isCaptionCaptureActive = false;
  captureVideoId = "";
  hasCapturedCaption = false;
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

})();
