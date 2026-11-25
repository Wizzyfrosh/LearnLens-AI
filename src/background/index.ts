import type { ExtensionMessage, ActiveContextResponse } from "../shared/messages";
import type { VideoContext } from "../shared/types";

let activeContext: VideoContext | null = null;
let contextSyncVersion = 0;
let publishQueue: Promise<void> = Promise.resolve();
let captionCaptureTabId: number | null = null;
let audioCaptureTabId: number | null = null;
let audioCaptureVideoId = "";
const audioStateReady = chrome.storage.session.get(["audioCaptureTabId", "audioCaptureVideoId"]).then((stored) => {
  audioCaptureTabId = typeof stored.audioCaptureTabId === "number" ? stored.audioCaptureTabId : null;
  audioCaptureVideoId = typeof stored.audioCaptureVideoId === "string" ? stored.audioCaptureVideoId : "";
}).catch(() => undefined);

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
    // A tab that was already open when the extension was installed/updated may
    // not have received the static content script. Inject it once on demand.
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["assets/youtube.js"]
      });
      await chrome.tabs.sendMessage(tabId, { type: "LEARNLENS_CONTENT_START_CAPTION_CAPTURE" } satisfies ExtensionMessage);
    } catch {
      captionCaptureTabId = null;
      broadcast({ type: "LEARNLENS_CAPTURE_STATUS", payload: { status: "error", message: "LearnLens could not attach its YouTube caption reader. Reload the lesson tab and retry." } });
    }
  }
}


async function stopAudioCapture(tabId: number, message: string): Promise<void> {
  await audioStateReady;
  if (audioCaptureTabId !== tabId) return;
  audioCaptureTabId = null;
  audioCaptureVideoId = "";
  await chrome.storage.session.remove(["audioCaptureTabId", "audioCaptureVideoId"]).catch(() => undefined);
  try { await chrome.runtime.sendMessage({ type: "LEARNLENS_OFFSCREEN_STOP_AUDIO_CAPTURE" } satisfies ExtensionMessage); } catch {}
  broadcast({ type: "LEARNLENS_AUDIO_CAPTURE_STATUS", payload: { status: "idle", message } });
}
async function startAudioCapture(tabId: number, videoId: string, streamId: string): Promise<void> {
  await audioStateReady;
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab?.id !== tabId) throw new Error("Switch to the lesson tab before starting audio transcription.");
  const tab = await chrome.tabs.get(tabId);
  if (videoIdFromUrl(tab.url) !== videoId) throw new Error("The active YouTube lesson changed. Try again.");
  if (captionCaptureTabId !== null) await stopCaptionCapture(captionCaptureTabId, "Caption capture stopped because audio transcription started.");
  if (audioCaptureTabId !== null) await stopAudioCapture(audioCaptureTabId, "Previous audio capture stopped.");

  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA"],
      justification: "Capture active lesson tab audio only after the learner explicitly starts audio transcription."
    });
  }

  // The side panel acquires this stream ID synchronously from the learner's
  // click handler. Do not request it here: awaiting worker operations would
  // lose the user gesture required by Chrome tabCapture.
  if (!streamId) throw new Error("Chrome did not provide an audio stream ID for this lesson.");

  audioCaptureTabId = tabId;
  audioCaptureVideoId = videoId;
  await chrome.storage.session.set({ audioCaptureTabId, audioCaptureVideoId });

  const response = await chrome.runtime.sendMessage({
    type: "LEARNLENS_OFFSCREEN_START_AUDIO_CAPTURE",
    tabId,
    videoId,
    streamId
  } satisfies ExtensionMessage) as { ok?: boolean; error?: string } | undefined;

  if (!response?.ok) {
    audioCaptureTabId = null;
    audioCaptureVideoId = "";
    await chrome.storage.session.remove(["audioCaptureTabId", "audioCaptureVideoId"]).catch(() => undefined);
    throw new Error(response?.error || "The offscreen audio processor did not confirm that capture started.");
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.type === "LEARNLENS_VIDEO_CONTEXT") {
    const senderTabId = sender.tab?.id;
    if (senderTabId === undefined) return;
    if (senderTabId === audioCaptureTabId && message.payload?.videoId !== audioCaptureVideoId) {
      void stopAudioCapture(senderTabId, "Audio transcription stopped because the lesson changed.");
    }
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

  if (message.type === "LEARNLENS_START_AUDIO_CAPTURE") {
    if (sender.url !== chrome.runtime.getURL("sidepanel.html")) return;
    void startAudioCapture(message.tabId, message.videoId, message.streamId).then(() => {
      sendResponse({ ok: true });
    }).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : "Could not start audio transcription.";
      broadcast({ type: "LEARNLENS_AUDIO_CAPTURE_STATUS", payload: { status: "error", message: detail } });
      sendResponse({ ok: false, error: detail });
    });
    return true;
  }

  if (message.type === "LEARNLENS_STOP_AUDIO_CAPTURE") {
    if (sender.url !== chrome.runtime.getURL("sidepanel.html")) return;
    void stopAudioCapture(message.tabId, "Audio transcription stopped.").then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "LEARNLENS_AUDIO_CAPTURE_STATUS" || message.type === "LEARNLENS_AUDIO_CHUNK") {
    void audioStateReady.then(async () => {
      if (sender.url !== chrome.runtime.getURL("offscreen.html") || audioCaptureTabId === null) return;
      if (message.type === "LEARNLENS_AUDIO_CHUNK" && message.payload.videoId !== audioCaptureVideoId) return;
      broadcast(message);
      if (message.type === "LEARNLENS_AUDIO_CAPTURE_STATUS" && message.payload.status === "error") {
        audioCaptureTabId = null;
        audioCaptureVideoId = "";
        await chrome.storage.session.remove(["audioCaptureTabId", "audioCaptureVideoId"]).catch(() => undefined);
      }
    }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
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

function configureSidePanelAction(): void {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
    console.error("LearnLens could not configure toolbar side-panel behavior.", error);
  });
}

// Configure at worker startup as well as installation/update. The action
// listener is a fallback for Chrome states where the behavior was not applied.
chrome.runtime.onInstalled.addListener(configureSidePanelAction);
configureSidePanelAction();

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  void chrome.sidePanel.open({ tabId: tab.id }).catch((error: unknown) => {
    console.error("LearnLens could not open the side panel from the toolbar.", error);
  });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (captionCaptureTabId !== null && captionCaptureTabId !== tabId) {
    void stopCaptionCapture(captionCaptureTabId, "Capture paused because you switched to another tab.");
  }
  void audioStateReady.then(() => {
    if (audioCaptureTabId !== null && audioCaptureTabId !== tabId) {
      void stopAudioCapture(audioCaptureTabId, "Audio transcription stopped because you switched tabs.");
    }
  });
  void syncActiveTabContext(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    void audioStateReady.then(() => {
      if (audioCaptureTabId === tabId && videoIdFromUrl(changeInfo.url) !== audioCaptureVideoId) {
        void stopAudioCapture(tabId, "Audio transcription stopped because the lesson changed.");
      }
    });
  }
  if (tab.active && (changeInfo.url || changeInfo.title || changeInfo.status === "complete")) {
    void syncActiveTabContext(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void audioStateReady.then(() => {
    if (audioCaptureTabId === tabId) void stopAudioCapture(tabId, "Audio transcription stopped because the lesson tab was closed.");
  });
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
