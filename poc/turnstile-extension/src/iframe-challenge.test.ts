import { describe, expect, it } from "vitest";
import { IframeTurnstilePresenter } from "./iframe-challenge";
import { TURNSTILE_MESSAGE_VERSION } from "./protocol";

class FakeElement {
  className = "";
  textContent = "";
  type = "";
  title = "";
  src = "";
  referrerPolicy = "";
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  listeners = new Map<string, Array<(event: unknown) => void>>();
  contentWindow?: FakeContentWindow;
  removed = false;

  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  append(...elements: FakeElement[]): void { this.children.push(...elements); }
  remove(): void { this.removed = true; }
  addEventListener(name: string, listener: (event: unknown) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  removeEventListener(name: string, listener: (event: unknown) => void): void {
    this.listeners.set(name, (this.listeners.get(name) ?? []).filter((item) => item !== listener));
  }
  dispatch(name: string, event: unknown = {}): void {
    for (const listener of [...(this.listeners.get(name) ?? [])]) listener(event);
  }
}

class FakeContentWindow {
  messages: Array<{ data: unknown; targetOrigin: string }> = [];
  postMessage(data: unknown, targetOrigin: string): void {
    this.messages.push({ data, targetOrigin });
  }
}

class FakeWindow {
  crypto = { randomUUID: () => "8a3f2a1b-2f7c-4d9a-8d2f-7a5f4b3c2d1e" };
  listeners = new Map<string, Array<(event: unknown) => void>>();
  timers = new Map<number, () => void>();
  nextTimer = 1;

  setTimeout(callback: () => void): number {
    const id = this.nextTimer++;
    this.timers.set(id, callback);
    return id;
  }
  clearTimeout(id: number): void { this.timers.delete(id); }
  addEventListener(name: string, listener: (event: unknown) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  removeEventListener(name: string, listener: (event: unknown) => void): void {
    this.listeners.set(name, (this.listeners.get(name) ?? []).filter((item) => item !== listener));
  }
  dispatchMessage(event: unknown): void {
    for (const listener of [...(this.listeners.get("message") ?? [])]) listener(event);
  }
}

function harness() {
  const fakeWindow = new FakeWindow();
  const fakeBody = new FakeElement();
  const fakeDocument = {
    body: fakeBody,
    createElement: () => new FakeElement()
  };
  const presenter = new IframeTurnstilePresenter({
    hostedPageUrl: "https://verify.example/turnstile/",
    windowObject: fakeWindow as unknown as Window,
    documentObject: fakeDocument as unknown as Document
  });
  const promise = presenter.getResponse({
    siteKey: "0x4AAAAAAAExamplePublicSiteKey",
    action: "learnlens_app_check",
    cdata: "A".repeat(43)
  });
  const overlay = fakeBody.children[0];
  const closeButton = overlay.children[0];
  const iframe = overlay.children[1];
  const contentWindow = new FakeContentWindow();
  iframe.contentWindow = contentWindow;
  const send = (data: unknown, overrides: { origin?: string; source?: unknown } = {}) => {
    fakeWindow.dispatchMessage({
      data,
      origin: overrides.origin ?? "https://verify.example",
      source: overrides.source ?? contentWindow
    });
  };
  return { fakeWindow, fakeBody, overlay, closeButton, iframe, contentWindow, promise, send };
}

describe("Hosted Turnstile iframe presenter", () => {
  it("sends only the public challenge bindings to the exact hosted origin", async () => {
    const h = harness();
    h.send({ type: "LEARNLENS_TURNSTILE_READY", version: TURNSTILE_MESSAGE_VERSION });
    const init = h.contentWindow.messages[0];
    expect(init.targetOrigin).toBe("https://verify.example");
    expect(init.data).toEqual({
      type: "LEARNLENS_TURNSTILE_INIT",
      version: TURNSTILE_MESSAGE_VERSION,
      requestId: "8a3f2a1b-2f7c-4d9a-8d2f-7a5f4b3c2d1e",
      siteKey: "0x4AAAAAAAExamplePublicSiteKey",
      action: "learnlens_app_check",
      cdata: "A".repeat(43)
    });
    const data = init.data as Record<string, unknown>;
    expect(data).not.toHaveProperty("sessionId");
    expect(data).not.toHaveProperty("pollCredential");
    expect(data).not.toHaveProperty("uid");
    expect(data).not.toHaveProperty("idToken");

    h.send({
      type: "LEARNLENS_TURNSTILE_TOKEN",
      version: TURNSTILE_MESSAGE_VERSION,
      requestId: data.requestId,
      token: "turnstile-response-token"
    });
    await expect(h.promise).resolves.toBe("turnstile-response-token");
    expect(h.overlay.removed).toBe(true);
  });

  it("ignores a correct-looking token sent by the wrong origin or iframe", async () => {
    const h = harness();
    h.send({ type: "LEARNLENS_TURNSTILE_READY", version: TURNSTILE_MESSAGE_VERSION }, { origin: "https://attacker.example" });
    h.send({ type: "LEARNLENS_TURNSTILE_READY", version: TURNSTILE_MESSAGE_VERSION }, { source: {} });

    expect(h.contentWindow.messages).toHaveLength(0);

    h.send({ type: "LEARNLENS_TURNSTILE_READY", version: TURNSTILE_MESSAGE_VERSION });
    const init = h.contentWindow.messages[0].data as Record<string, unknown>;
    const token = {
      type: "LEARNLENS_TURNSTILE_TOKEN",
      version: TURNSTILE_MESSAGE_VERSION,
      requestId: init.requestId,
      token: "valid-token"
    };
    h.send(token, { origin: "https://attacker.example" });
    h.send(token, { source: {} });
    h.send({ ...token, requestId: "different-request" });
    h.send({ ...token, pollCredential: "unexpected-field" });

    h.send(token);
    await expect(h.promise).resolves.toBe("valid-token");
  });

  it("rejects expired and invalid hosted challenge responses", async () => {
    const expired = harness();
    expired.send({ type: "LEARNLENS_TURNSTILE_EXPIRED", version: TURNSTILE_MESSAGE_VERSION, requestId: "8a3f2a1b-2f7c-4d9a-8d2f-7a5f4b3c2d1e" });
    await expect(expired.promise).rejects.toThrow("expired");

    const invalid = harness();
    invalid.send({ type: "LEARNLENS_TURNSTILE_READY", version: TURNSTILE_MESSAGE_VERSION });
    const init = invalid.contentWindow.messages[0].data as Record<string, unknown>;
    invalid.send({
      type: "LEARNLENS_TURNSTILE_TOKEN",
      version: TURNSTILE_MESSAGE_VERSION,
      requestId: init.requestId,
      token: "x".repeat(2049)
    });
    // Oversized tokens are rejected before they can reach the Firebase endpoint.
    await expect(invalid.promise).rejects.toThrow("invalid response");
  });

  it("sends request-bound cancellation before removing the iframe", async () => {
    const h = harness();
    h.closeButton.dispatch("click");
    expect(h.contentWindow.messages[0]).toEqual({
      targetOrigin: "https://verify.example",
      data: {
        type: "LEARNLENS_TURNSTILE_CANCEL",
        version: TURNSTILE_MESSAGE_VERSION,
        requestId: "8a3f2a1b-2f7c-4d9a-8d2f-7a5f4b3c2d1e"
      }
    });
    await expect(h.promise).rejects.toThrow("cancelled");
    expect(h.overlay.removed).toBe(true);
  });

  it("rejects non-HTTPS, query-bearing or credential-bearing hosted page URLs", () => {
    const fakeWindow = new FakeWindow() as unknown as Window;
    const fakeDocument = { body: new FakeElement(), createElement: () => new FakeElement() } as unknown as Document;
    for (const hostedPageUrl of [
      "http://verify.example",
      "https://user:pass@verify.example",
      "https://verify.example/path?token=leak",
      "https://verify.example/path#token"
    ]) {
      expect(() => new IframeTurnstilePresenter({ hostedPageUrl, windowObject: fakeWindow, documentObject: fakeDocument }))
        .toThrow("HTTPS");
    }
  });
});
