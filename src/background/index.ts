import type { ExtensionMessage, ActiveContextResponse } from "../shared/messages";
import type { VideoContext } from "../shared/types";

let activeContext: VideoContext | null = null;
let contextSyncVersion = 0;
let publishQueue: Promise<void> = Promise.resolve();
let captionCaptureTabId: number | null = null;
let audioCaptureTabId: number | null = null;
let audioCaptureVideoId = "";

function videoIdFromUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.hostname === "www.youtube.com" && url.pathname === "/watch"
      ? url.searchParams.get("v")
      : null;
  } catch {
    return null;
  }
}

function broadcast(message: ExtensionMessage): void {
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

function publishActiveContext(context: VideoContext | null, version: number): Promise<void> {
  activeContext = context;
  // Serialize storage writes so a slow older write cannot become the final value.
  publishQueue = publishQueue.then(async () => {
    if (version !== contextSyncVersion) return;
    await chrome.storage.session.set({ activeVideoContext: context });
    if (version !== contextSyncVersion) return;
    broadcast({ type: "LEARNLENS_ACTIVE_CONTEXT_CHANGED", payload: context });
  }).catch(() => undefined);
  return publishQueue;
}

async function syncActiveTabContext(tabId: number): Promise<void> {
  const version = ++contextSyncVersion;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (version !== contextSyncVersion || activeTab?.id !== tabId) return;

    const tab = await chrome.tabs.get(tabId);
    if (version !== contextSyncVersion) return;
    const videoId = videoIdFromUrl(tab.url);
    const context: VideoContext | null = videoId
      ? {
          videoId,
          title: tab.title?.replace(/\s+-\s+YouTube\s*$/i, "").trim() || "YouTube video",
          url: tab.url ?? "",
          platform: "youtube"
        }
      : null;
    await publishActiveContext(context, version);
  } catch {
    // Tabs can disappear between activation/update events; ignore stale events.
  }
}

async function stopCaptionCapture(tabId: number, message: string): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "LEARNLENS_CONTENT_STOP_CAPTION_CAPTURE" } satisfies ExtensionMessage);
  } catch {
    // The tab may have navigated away or closed.
  }
  if (captionCaptureTabId === tabId) {
    captionCaptureTabId = null;
    broadcast({ type: "LEARNLENS_CAPTURE_STATUS", payload: { status: "idle", message } });
  }
}

async function startCaptionCapture(tabId: number): Promise<void> {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab?.id !== tabId) {
    broadcast({ type: "LEARNLENS_CAPTURE_STATUS", payload: { status: "error", message: "Switch to the lesson tab before starting capture." } });
    return;
  }

  const tab = await chrome.tabs.get(tabId);
  if (!videoIdFromUrl(tab.url)) {
    broadcast({ type: "LEARNLENS_CAPTURE_STATUS", payload: { status: "unsupported", message: "Open a YouTube watch page before starting lesson capture." } });
    return;
  }

  if (captionCaptureTabId !== null && captionCaptureTabId !== tabId) {
    await stopCaptionCapture(captionCaptureTabId, "Previous lesson capture stopped.");
  }

  captionCaptureTabId = tabId;
  try {
    await chrome.tabs.sendMessage(tabId, { type: "LEARNLENS_CONTENT_START_CAPTION_CAPTURE" } satisfies ExtensionMessage);
  } catch {
    captionCaptureTabId = null;
    broadcast({ type: "LEARNLENS_CAPTURE_STATUS", payload: { status: "error", message: "LearnLens could not connect to this YouTube page. Reload the page and try again." } });
  }
}


async function stopAudioCapture(tabId: number, message: string): Promise<void> {
  if (audioCaptureTabId !== tabId) return;
  audioCaptureTabId = null;
  audioCaptureVideoId = "";
  try { await chrome.runtime.sendMessage({ type: "LEARNLENS_OFFSCREEN_STOP_AUDIO_CAPTURE" } satisfies ExtensionMessage); } catch {}
  broadcast({ type: "LEARNLENS_AUDIO_CAPTURE_STATUS", payload: { status: "idle", message } });
}
async function startAudioCapture(tabId: number, videoId: string, streamId: string): Promise<void> {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab?.id !== tabId) throw new Error("Switch to the lesson tab before starting audio transcription.");
  const tab = await chrome.tabs.get(tabId);
  if (videoIdFromUrl(tab.url) !== videoId || !streamId) throw new Error("The active YouTube lesson changed. Try again.");
  if (captionCaptureTabId !== null) await stopCaptionCapture(captionCaptureTabId, "Caption capture stopped because audio transcription started.");
  if (audioCaptureTabId !== null) await stopAudioCapture(audioCaptureTabId, "Previous audio capture stopped.");
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["USER_MEDIA"], justification: "Capture active lesson tab audio only after the learner explicitly starts audio transcription." });
  }
  audioCaptureTabId = tabId;
  audioCaptureVideoId = videoId;
  await chrome.runtime.sendMessage({ type: "LEARNLENS_OFFSCREEN_START_AUDIO_CAPTURE", tabId, videoId, streamId } satisfies ExtensionMessage);
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.type === "LEARNLENS_VIDEO_CONTEXT") {
    const senderTabId = sender.tab?.id;
    if (senderTabId === undefined) return;
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id !== senderTabId) return;
      const tabVideoId = videoIdFromUrl(tab.url);
      if (message.payload?.videoId !== (tabVideoId ?? undefined)) {
        if (message.payload !== null || tabVideoId !== null) return;
      }
      const version = ++contextSyncVersion;
      await publishActiveContext(message.payload, version);
    })().catch(() => undefined);
    return;
  }

  if (message.type === "LEARNLENS_START_CAPTION_CAPTURE") {
    void startCaptionCapture(message.tabId).catch(() => {
      broadcast({ type: "LEARNLENS_CAPTURE_STATUS", payload: { status: "error", message: "Could not start lesson capture." } });
    });
    return;
  }

  if (message.type === "LEARNLENS_STOP_CAPTION_CAPTURE") {
    void stopCaptionCapture(message.tabId, "Lesson capture stopped.");
    return;
  }

  if (message.type === "LEARNLENS_CAPTURE_STATUS" || message.type === "LEARNLENS_CAPTION_SEGMENT") {
    const senderTabId = sender.tab?.id;
    if (senderTabId === undefined || senderTabId !== captionCaptureTabId) return;
    broadcast(message);
    return;
  }

  if (message.type === "LEARNLENS_GET_ACTIVE_CONTEXT") {
    chrome.storage.session.get("activeVideoContext", (result) => {
      const response: ActiveContextResponse = {
        context: Object.prototype.hasOwnProperty.call(result, "activeVideoContext")
          ? (result.activeVideoContext as VideoContext | null)
          : activeContext
      };
      sendResponse(response);
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (captionCaptureTabId !== null && captionCaptureTabId !== tabId) {
    void stopCaptionCapture(captionCaptureTabId, "Capture paused because you switched to another tab.");
  }
  void syncActiveTabContext(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.title || changeInfo.status === "complete")) {
    void syncActiveTabContext(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (captionCaptureTabId === tabId) {
    captionCaptureTabId = null;
    broadcast({ type: "LEARNLENS_CAPTURE_STATUS", payload: { status: "idle", message: "Capture stopped because the lesson tab was closed." } });
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  void chrome.tabs.query({ active: true, windowId }).then(([tab]) => {
    if (tab?.id !== undefined) void syncActiveTabContext(tab.id);
  }).catch(() => undefined);
});
