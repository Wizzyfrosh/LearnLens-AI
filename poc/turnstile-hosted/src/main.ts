import {
  parseAllowedExtensionOrigins,
  parseTurnstileControlMessage,
  parseTurnstileInitMessage,
  TURNSTILE_MESSAGE_VERSION,
  type HostedPageMessage,
  type TurnstileInitMessage
} from "./protocol";

interface TurnstileApi {
  render(
    container: string | HTMLElement,
    options: {
      sitekey: string;
      action: string;
      cData: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    }
  ): string;
  reset(widgetId?: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const statusElement = document.getElementById("status");
const widgetElement = document.getElementById("turnstile-widget");
const turnstileScript = document.querySelector<HTMLScriptElement>("[data-turnstile-script]");
const allowedParentOrigins = parseAllowedExtensionOrigins(
  import.meta.env.VITE_ALLOWED_PARENT_ORIGINS
);

let activeInit: TurnstileInitMessage | null = null;
let activeParentOrigin = "";
let widgetId: string | null = null;
let tokenDelivered = false;
let scriptPromise: Promise<TurnstileApi> | null = null;

function setStatus(message: string): void {
  if (statusElement) statusElement.textContent = message;
}

function postToParent(message: HostedPageMessage): void {
  if (!activeParentOrigin || window.parent === window) return;
  window.parent.postMessage(message, activeParentOrigin);
}

function sendError(
  code: "invalid_init" | "script_unavailable" | "widget_error" | "already_initialized"
): void {
  if (!activeInit) return;
  postToParent({
    type: "LEARNLENS_TURNSTILE_ERROR",
    version: TURNSTILE_MESSAGE_VERSION,
    requestId: activeInit.requestId,
    code
  });
}

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    if (!turnstileScript) {
      reject(new Error("Turnstile script element is missing."));
      return;
    }

    const timeoutId = window.setTimeout(() => {
      reject(new Error("Turnstile script did not become available."));
    }, 12_000);

    turnstileScript.addEventListener("load", () => {
      window.clearTimeout(timeoutId);
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile loaded without exposing its API."));
    }, { once: true });

    turnstileScript.addEventListener("error", () => {
      window.clearTimeout(timeoutId);
      reject(new Error("Turnstile script could not be loaded."));
    }, { once: true });
  });

  return scriptPromise;
}

async function renderChallenge(init: TurnstileInitMessage): Promise<void> {
  setStatus("Preparing the security challenge…");
  try {
    const turnstile = await loadTurnstile();
    if (activeInit?.requestId !== init.requestId || !widgetElement) return;

    widgetId = turnstile.render(widgetElement, {
      sitekey: init.siteKey,
      action: init.action,
      cData: init.cdata,
      callback: (token) => {
        if (
          !activeInit ||
          activeInit.requestId !== init.requestId ||
          tokenDelivered ||
          typeof token !== "string" ||
          token.length === 0 ||
          token.length > 2048
        ) return;

        tokenDelivered = true;
        setStatus("Verification completed. Returning securely to LearnLens…");
        // The one-time response is sent only to the exact, validated extension
        // origin. It is never added to a URL, DOM attribute, log or storage.
        postToParent({
          type: "LEARNLENS_TURNSTILE_TOKEN",
          version: TURNSTILE_MESSAGE_VERSION,
          requestId: init.requestId,
          token
        });
      },
      "expired-callback": () => {
        if (!activeInit || activeInit.requestId !== init.requestId || tokenDelivered) return;
        setStatus("The verification expired. Return to LearnLens and retry.");
        postToParent({
          type: "LEARNLENS_TURNSTILE_EXPIRED",
          version: TURNSTILE_MESSAGE_VERSION,
          requestId: init.requestId
        });
      },
      "error-callback": () => {
        if (!activeInit || activeInit.requestId !== init.requestId || tokenDelivered) return;
        setStatus("Verification could not be completed. Return to LearnLens and retry.");
        sendError("widget_error");
      }
    });
    setStatus("Complete the security check to continue.");
  } catch {
    setStatus("The security check could not load. Return to LearnLens and try again.");
    sendError("script_unavailable");
  }
}

function removeActiveWidget(): void {
  if (widgetId && window.turnstile) {
    try { window.turnstile.remove(widgetId); } catch { /* Widget may already be gone. */ }
  }
  widgetId = null;
}

function handleParentMessage(event: MessageEvent<unknown>): void {
  if (event.source !== window.parent || window.parent === window) return;

  if (!activeInit) {
    const init = parseTurnstileInitMessage(
      event.data,
      event.origin,
      true,
      allowedParentOrigins
    );
    if (!init) return;

    activeInit = init;
    activeParentOrigin = event.origin;
    tokenDelivered = false;
    postToParent({
      type: "LEARNLENS_TURNSTILE_INIT_ACCEPTED",
      version: TURNSTILE_MESSAGE_VERSION,
      requestId: init.requestId
    });
    void renderChallenge(init);
    return;
  }

  if (event.origin !== activeParentOrigin) return;
  const control = parseTurnstileControlMessage(event.data, activeInit.requestId);
  if (control === "cancel") {
    removeActiveWidget();
    activeInit = null;
    activeParentOrigin = "";
    tokenDelivered = false;
    setStatus("Verification cancelled. You can close this window.");
    return;
  }

  if (control === "reset") {
    if (tokenDelivered || !widgetId || !window.turnstile) {
      sendError("invalid_init");
      return;
    }
    try {
      window.turnstile.reset(widgetId);
      setStatus("Try the security check again.");
    } catch {
      sendError("widget_error");
    }
  }
}

if (window.parent === window) {
  setStatus("This verification page must be opened securely from LearnLens.");
} else if (allowedParentOrigins.length === 0) {
  setStatus("This verification page has not been configured for an approved LearnLens extension yet.");
} else {
  setStatus("Waiting for a secure connection from LearnLens…");
  // This readiness signal contains no credentials. The parent must still
  // validate event.origin and event.source before sending initialization data.
  window.parent.postMessage({
    type: "LEARNLENS_TURNSTILE_READY",
    version: TURNSTILE_MESSAGE_VERSION
  }, "*");
  window.addEventListener("message", handleParentMessage);
}
