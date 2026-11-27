import { initializeApp } from "firebase/app";
import {
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider
} from "firebase/app-check";
import "./style.css";

const originElement = document.getElementById("page-origin");
const form = document.getElementById("config-form");
const runButton = document.getElementById("run-test");
const clearButton = document.getElementById("clear-log");
const logList = document.getElementById("log");

if (!(form instanceof HTMLFormElement) ||
    !(runButton instanceof HTMLButtonElement) ||
    !(clearButton instanceof HTMLButtonElement) ||
    !(logList instanceof HTMLOListElement)) {
  throw new Error("The App Check compatibility lab UI is incomplete.");
}

if (originElement) {
  originElement.textContent = window.location.origin;
}

let testStarted = false;

function log(message: string, kind: "info" | "success" | "warning" | "error" = "info"): void {
  const item = document.createElement("li");
  item.className = `log-entry log-${kind}`;
  item.textContent = `${new Date().toLocaleTimeString()} — ${message}`;
  logList.prepend(item);
}

function readInput(id: string): string {
  const input = document.getElementById(id);
  return input instanceof HTMLInputElement ? input.value.trim() : "";
}

window.addEventListener("securitypolicyviolation", (event: SecurityPolicyViolationEvent) => {
  const blocked = event.blockedURI || "unknown resource";
  log(
    `CSP blocked ${event.violatedDirective} from ${blocked}. This is relevant evidence; do not weaken the extension CSP.`,
    "error"
  );
});

window.addEventListener("error", (event: ErrorEvent) => {
  if (event.message) log(`Browser error: ${event.message}`, "error");
});

clearButton.addEventListener("click", () => {
  logList.replaceChildren();
});

form.addEventListener("submit", async (event: SubmitEvent) => {
  event.preventDefault();
  if (testStarted) {
    log("This page has already attempted initialization. Reload the test extension page before retrying.", "warning");
    return;
  }

  const apiKey = readInput("api-key");
  const projectId = readInput("project-id");
  const appId = readInput("app-id");
  const siteKey = readInput("site-key");

  if (![apiKey, projectId, appId, siteKey].every(Boolean)) {
    log("All four configuration values are required.", "error");
    return;
  }

  testStarted = true;
  runButton.disabled = true;
  runButton.textContent = "Testing…";
  log("Starting the Firebase SDK's built-in ReCAPTCHA Enterprise provider.", "info");
  log(`Extension page origin: ${window.location.origin}`, "info");
  log("No remote script is manually injected by this test harness.", "info");

  try {
    const app = initializeApp({ apiKey, projectId, appId }, "learnlens-app-check-compatibility-poc");
    const appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: false
    });

    log("Firebase App Check initialized. Requesting one token now…", "info");
    const result = await getToken(appCheck, true);

    if (!result.token) {
      log("The SDK completed without returning a token.", "error");
      return;
    }

    const expiresAt = new Date(result.expireTimeMillis);
    log(`PASS: Firebase returned an App Check token. Expiry reported as ${expiresAt.toISOString()}.`, "success");
    log("The token value was deliberately not printed or persisted.", "success");
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    log(`Provider test failed: ${message}`, "error");
    log("Inspect the CSP entries above and the extension page Network panel. Do not add remote script sources to extension_pages.", "warning");
  } finally {
    runButton.textContent = "Test attempted — reload to retry";
  }
});

log("Lab ready. Enter only public Firebase Web App configuration and a reCAPTCHA site key.", "info");
