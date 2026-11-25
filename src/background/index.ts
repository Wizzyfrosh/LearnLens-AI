import type { ExtensionMessage, ActiveContextResponse } from "../shared/messages";
import type { VideoContext } from "../shared/types";

let activeContext: VideoContext | null = null;

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === "LEARNLENS_VIDEO_CONTEXT") {
    activeContext = message.payload;
    chrome.storage.session.set({ activeVideoContext: activeContext });
    return;
  }

  if (message.type === "LEARNLENS_GET_ACTIVE_CONTEXT") {
    chrome.storage.session.get("activeVideoContext", (result) => {
      const response: ActiveContextResponse = {
        context: (result.activeVideoContext as VideoContext | undefined) ?? activeContext
      };
      sendResponse(response);
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url?.includes("youtube.com/watch")) {
    const url = new URL(tab.url);
    activeContext = {
      videoId: url.searchParams.get("v") ?? "",
      title: tab.title?.replace(" - YouTube", "") ?? "YouTube video",
      url: tab.url,
      platform: "youtube"
    };
    await chrome.storage.session.set({ activeVideoContext: activeContext });
  }
});