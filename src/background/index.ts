import type { ExtensionMessage, ActiveContextResponse } from "../shared/messages";
import type { VideoContext } from "../shared/types";

let activeContext: VideoContext | null = null;
let contextSyncVersion = 0;

async function publishActiveContext(context: VideoContext | null) {
  activeContext = context;
  await chrome.storage.session.set({ activeVideoContext: context });
  try {
    await chrome.runtime.sendMessage({
      type: "LEARNLENS_ACTIVE_CONTEXT_CHANGED",
      payload: context
    } satisfies ExtensionMessage);
  } catch {
    // The side panel may be closed; its next open reads the stored/current tab context.
  }
}

async function syncActiveTabContext(tabId: number) {
  const version = ++contextSyncVersion;
  try {
    const tab = await chrome.tabs.get(tabId);
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (version !== contextSyncVersion || activeTab?.id !== tabId) return;

    let context: VideoContext | null = null;
    if (tab.url) {
      const url = new URL(tab.url);
      const videoId = url.hostname === "www.youtube.com" && url.pathname === "/watch"
        ? url.searchParams.get("v")
        : null;
      if (videoId) {
        context = {
          videoId,
          title: tab.title?.replace(" - YouTube", "") ?? "YouTube video",
          url: tab.url,
          platform: "youtube"
        };
      }
    }
    await publishActiveContext(context);
  } catch {
    // Tabs can disappear between activation/update events; ignore stale events.
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.type === "LEARNLENS_VIDEO_CONTEXT") {
    const senderTabId = sender.tab?.id;
    if (senderTabId === undefined) return;
    void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (tab?.id !== senderTabId) return;
      const version = ++contextSyncVersion;
      void chrome.storage.session.set({ activeVideoContext: message.payload }).then(() => {
        if (version !== contextSyncVersion) return;
        activeContext = message.payload;
        try {
          void chrome.runtime.sendMessage({
            type: "LEARNLENS_ACTIVE_CONTEXT_CHANGED",
            payload: message.payload
          } satisfies ExtensionMessage).catch(() => undefined);
        } catch {
          // Side panel may be closed.
        }
      });
    }).catch(() => undefined);
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
  void syncActiveTabContext(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.status === "complete")) {
    void syncActiveTabContext(tabId);
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  void chrome.tabs.query({ active: true, windowId }).then(([tab]) => {
    if (tab?.id !== undefined) void syncActiveTabContext(tab.id);
  }).catch(() => undefined);
});
