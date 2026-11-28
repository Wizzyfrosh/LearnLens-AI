import {
  TURNSTILE_MESSAGE_VERSION,
  type TurnstileHostedInit
} from "./protocol";

export interface TurnstileChallengeRequest {
  siteKey: string;
  action: string;
  cdata: string;
}

export interface TurnstileChallengePresenter {
  getResponse(request: TurnstileChallengeRequest): Promise<string>;
}

export interface IframePresenterOptions {
  hostedPageUrl: string;
  windowObject?: Window;
  documentObject?: Document;
  timeoutMs?: number;
}

function parseHostedPageUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch {
    throw new Error("The hosted security challenge URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("The hosted security challenge must use a clean HTTPS URL.");
  }
  return url;
}

function isExactMessage(
  value: unknown,
  keys: readonly string[],
  type: string,
  requestId: string
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (
    Object.keys(data).length === keys.length &&
    Object.keys(data).every((key) => keys.includes(key)) &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(data, key)) &&
    data.type === type &&
    data.version === TURNSTILE_MESSAGE_VERSION &&
    data.requestId === requestId
  );
}

export class IframeTurnstilePresenter implements TurnstileChallengePresenter {
  private readonly hostedUrl: URL;
  private readonly windowObject: Window;
  private readonly documentObject: Document;
  private readonly timeoutMs: number;

  constructor(options: IframePresenterOptions) {
    this.hostedUrl = parseHostedPageUrl(options.hostedPageUrl);
    this.windowObject = options.windowObject ?? window;
    this.documentObject = options.documentObject ?? document;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 10_000 || this.timeoutMs > 300_000) {
      throw new Error("The security challenge timeout is invalid.");
    }
  }

  getResponse(request: TurnstileChallengeRequest): Promise<string> {
    if (
      typeof request.siteKey !== "string" ||
      request.siteKey.length < 16 ||
      request.siteKey.length > 256 ||
      typeof request.action !== "string" ||
      !/^[a-z][a-z0-9_]{2,63}$/.test(request.action) ||
      typeof request.cdata !== "string" ||
      !/^[A-Za-z0-9_-]{16,255}$/.test(request.cdata)
    ) {
      return Promise.reject(new Error("The Turnstile challenge configuration is invalid."));
    }

    const requestId = this.windowObject.crypto.randomUUID();
    const overlay = this.documentObject.createElement("div");
    overlay.className = "learnlens-turnstile-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "LearnLens security verification");

    const closeButton = this.documentObject.createElement("button");
    closeButton.type = "button";
    closeButton.className = "learnlens-turnstile-close";
    closeButton.textContent = "Cancel verification";
    closeButton.setAttribute("aria-label", "Cancel security verification");

    const iframe = this.documentObject.createElement("iframe");
    iframe.title = "LearnLens security verification";
    iframe.src = this.hostedUrl.href;
    iframe.referrerPolicy = "no-referrer";
    iframe.className = "learnlens-turnstile-frame";

    overlay.append(closeButton, iframe);

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let initialized = false;

      const cleanup = () => {
        this.windowObject.removeEventListener("message", onMessage);
        closeButton.removeEventListener("click", onCancel);
        this.windowObject.clearTimeout(timeoutId);
        overlay.remove();
      };
      const finish = (error?: Error, token?: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else if (token) resolve(token);
        else reject(new Error("The security verification did not return a response."));
      };
      const onCancel = () => finish(new Error("Security verification was cancelled."));
      const postControl = (type: "LEARNLENS_TURNSTILE_CANCEL") => {
        iframe.contentWindow?.postMessage({
          type,
          version: TURNSTILE_MESSAGE_VERSION,
          requestId
        }, this.hostedUrl.origin);
      };

      const onMessage = (event: MessageEvent<unknown>) => {
        if (event.origin !== this.hostedUrl.origin || event.source !== iframe.contentWindow) return;
        const data = event.data;
        if (
          data !== null &&
          typeof data === "object" &&
          !Array.isArray(data) &&
          (data as Record<string, unknown>).type === "LEARNLENS_TURNSTILE_READY"
        ) {
          const ready = data as Record<string, unknown>;
          if (
            Object.keys(ready).length !== 2 ||
            Object.keys(ready).some((key) => !["type", "version"].includes(key)) ||
            ready.version !== TURNSTILE_MESSAGE_VERSION ||
            initialized
          ) return;
          initialized = true;
          const init: TurnstileHostedInit = {
            type: "LEARNLENS_TURNSTILE_INIT",
            version: TURNSTILE_MESSAGE_VERSION,
            requestId,
            siteKey: request.siteKey,
            action: request.action,
            cdata: request.cdata
          };
          iframe.contentWindow?.postMessage(init, this.hostedUrl.origin);
          return;
        }

        if (isExactMessage(data, ["type", "version", "requestId", "token"], "LEARNLENS_TURNSTILE_TOKEN", requestId)) {
          if (typeof data.token !== "string" || data.token.length === 0 || data.token.length > 2048) {
            finish(new Error("The security verification returned an invalid response."));
            return;
          }
          finish(undefined, data.token);
          return;
        }
        if (isExactMessage(data, ["type", "version", "requestId"], "LEARNLENS_TURNSTILE_EXPIRED", requestId)) {
          finish(new Error("The security verification expired. Please try again."));
          return;
        }
        if (isExactMessage(data, ["type", "version", "requestId", "code"], "LEARNLENS_TURNSTILE_ERROR", requestId)) {
          finish(new Error("The security verification could not be completed. Please try again."));
        }
      };

      const timeoutId = this.windowObject.setTimeout(
        () => finish(new Error("The security verification timed out. Please try again.")),
        this.timeoutMs
      );
      closeButton.addEventListener("click", onCancel);
      this.windowObject.addEventListener("message", onMessage);
      this.documentObject.body.append(overlay);

      // The hosted page has no access to Firebase session data. Only this
      // scoped init message contains the public site key and server cdata.
      iframe.addEventListener("load", () => {
        // The page will emit READY once its script and protocol are initialized.
      }, { once: true });

      // Keep cancellation control scoped to the request ID and validated origin.
      void postControl;
    });
  }
}
