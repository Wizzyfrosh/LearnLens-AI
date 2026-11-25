import type { ExtensionMessage, ActiveContextResponse } from "../shared/messages";
import type { VideoContext } from "../shared/types";

let activeContext: VideoContext | null = null;

async function syncActiveTabContext(tabId: number) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) {
      activeContext = null;
    } else {
      const url = new URL(tab.url);
      const videoId = url.hostname === "www.youtube.com" && url.pathname === "/watch"
        ? url.searchParams.get("v")
        : null;

      activeContext = videoId
        ? {
            videoId,
            title: tab.title?.replace(" - YouTube", "") ?? "YouTube video",
            url: tab.url,
            platform: "youtube"
          }
        : null;
    }

    await chrome.storage.session.set({ activeVideoContext: activeContext });
  } catch {
    // Tabs can disappear between activation/update events; ignore stale events.
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === "LEARNLENS_VIDEO_CONTEXT") {
    activeContext = message.payload;
    chrome.storage.session.set({ activeVideoContext: activeContext });
    return;
  }

  if (message.type === "LEARNLENS_GET_ACTIVE_CONTEXT") {
    chrome.storage.session.get("activeVideoContext", (result) => {
      const response: ActiveContextResponse = {
        context: (result.activeVideoContext as VideoContext | null | undefined) ?? activeContext
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
  if (changeInfo.url || (changeInfo.status === "complete" && tab.active)) {
    void syncActiveTabContext(tabId);
  }
});
