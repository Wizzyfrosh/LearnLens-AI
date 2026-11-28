import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  inMemoryPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type Auth
} from "firebase/auth/web-extension";
import type { AppCheck } from "firebase/app-check";
import {
  initializeTurnstileAppCheck,
  requestTurnstileAppCheckToken
} from "../turnstile-extension/src/firebase-integration";
import "./style.css";

interface LabConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  functionsBaseUrl: string;
  hostedPageUrl: string;
  siteKey: string;
}

const compiledHostedOrigin = import.meta.env.VITE_HOSTED_CHALLENGE_ORIGIN || "";
const extensionOrigin = chrome.runtime.getURL("").replace(/\/$/, "");

const configForm = document.getElementById("config-form");
const authForm = document.getElementById("auth-form");
const connectButton = document.getElementById("connect-button");
const signInButton = document.getElementById("sign-in-button");
const signOutButton = document.getElementById("sign-out-button");
const tokenButton = document.getElementById("token-button");
const clearLogButton = document.getElementById("clear-log");
const logList = document.getElementById("log");
const extensionOriginElement = document.getElementById("extension-origin");
const connectionState = document.getElementById("connection-state");
const authState = document.getElementById("auth-state");
const tokenState = document.getElementById("token-state");

if (
  !(configForm instanceof HTMLFormElement) ||
  !(authForm instanceof HTMLFormElement) ||
  !(connectButton instanceof HTMLButtonElement) ||
  !(signInButton instanceof HTMLButtonElement) ||
  !(signOutButton instanceof HTMLButtonElement) ||
  !(tokenButton instanceof HTMLButtonElement) ||
  !(clearLogButton instanceof HTMLButtonElement) ||
  !(logList instanceof HTMLOListElement) ||
  !(extensionOriginElement instanceof HTMLElement) ||
  !(connectionState instanceof HTMLElement) ||
  !(authState instanceof HTMLElement) ||
  !(tokenState instanceof HTMLElement)
) {
  throw new Error("The Turnstile lab page is incomplete.");
}

const logElement = logList as HTMLOListElement;
extensionOriginElement.textContent = extensionOrigin;

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;
let appCheck: AppCheck | null = null;
let activeConfig: LabConfig | null = null;
let stopAuthObserver: (() => void) | null = null;

function setText(element: HTMLElement, value: string): void {
  element.textContent = value;
}

function log(message: string, kind: "info" | "success" | "warning" | "error" = "info"): void {
  const item = document.createElement("li");
  item.textContent = new Date().toLocaleTimeString() + " — " + message;
  item.dataset.kind = kind;
  logElement.prepend(item);
}

function valueOf(id: string): string {
  const input = document.getElementById(id);
  return input instanceof HTMLInputElement ? input.value.trim() : "";
}

function parseConfiguration(): LabConfig {
  const config: LabConfig = {
    apiKey: valueOf("api-key"),
    authDomain: valueOf("auth-domain"),
    projectId: valueOf("project-id"),
    appId: valueOf("app-id"),
    functionsBaseUrl: valueOf("functions-url"),
    hostedPageUrl: valueOf("hosted-url"),
    siteKey: valueOf("site-key")
  };

  if (!Object.values(config).every(Boolean)) {
    throw new Error("Complete every configuration field before connecting.");
  }
  if (config.apiKey.length > 256 || config.projectId.length > 128 || config.appId.length > 256) {
    throw new Error("One or more Firebase configuration values are too long.");
  }

  let hostedUrl: URL;
  try { hostedUrl = new URL(config.hostedPageUrl); } catch {
    throw new Error("Enter a valid hosted challenge page URL.");
  }
  if (
    hostedUrl.protocol !== "https:" ||
    hostedUrl.username ||
    hostedUrl.password ||
    hostedUrl.search ||
    hostedUrl.hash ||
    hostedUrl.origin !== compiledHostedOrigin
  ) {
    throw new Error(
      "The hosted page must use the exact HTTPS origin compiled into this lab: " +
      (compiledHostedOrigin || "(not configured)")
    );
  }

  if (
    config.siteKey.length < 16 ||
    config.siteKey.length > 32 ||
    !/^[A-Za-z0-9_-]+$/.test(config.siteKey)
  ) {
    throw new Error("The Turnstile site key must be a valid 16–32 character public test key.");
  }

  const functionsUrl = new URL(config.functionsBaseUrl);
  const isLoopback = functionsUrl.hostname === "localhost" || functionsUrl.hostname === "127.0.0.1";
  const normalizedPath = functionsUrl.pathname.replace(/\/$/, "");
  const validEmulatorPath =
    /^\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/[a-z]+-[a-z0-9-]+$/.test(normalizedPath);
  if (
    functionsUrl.username ||
    functionsUrl.password ||
    functionsUrl.search ||
    functionsUrl.hash ||
    (functionsUrl.protocol === "https:"
      ? normalizedPath !== ""
      : !(isLoopback && functionsUrl.protocol === "http:" && validEmulatorPath))
  ) {
    throw new Error("Use an HTTPS Functions origin or a loopback Emulator URL with /<project-id>/<region>.");
  }

  return config;
}

function endpointPermissionPattern(functionsBaseUrl: string): string {
  const url = new URL(functionsBaseUrl);
  return url.origin + "/*";
}

async function requestEndpointPermission(functionsBaseUrl: string): Promise<void> {
  const pattern = endpointPermissionPattern(functionsBaseUrl);
  // Call permissions.request directly from the Connect click handler, before
  // any asynchronous work, so Chrome sees a user gesture.
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) {
    throw new Error("Chrome did not grant access to the configured Firebase Functions host.");
  }
}

function updateAuthUi(user: Auth["currentUser"]): void {
  const signedIn = Boolean(user);
  const verified = user?.emailVerified === true;
  signInButton.disabled = !firebaseAuth || signedIn;
  signOutButton.disabled = !signedIn;
  tokenButton.disabled = !appCheck || !verified;

  if (!user) {
    setText(authState, "No test account is signed in.");
    return;
  }
  setText(
    authState,
    user.emailVerified
      ? "Signed in with a verified test account."
      : "The account email is not verified. Verify it in Firebase before running the challenge."
  );
}

configForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  connectButton.disabled = true;
  setText(connectionState, "Connecting…");
  try {
    const config = parseConfiguration();

    // Request only the exact user-supplied Functions host. The manifest
    // declares this as an optional host permission, so Chrome prompts here.
    await requestEndpointPermission(config.functionsBaseUrl);

    stopAuthObserver?.();
    stopAuthObserver = null;
    if (firebaseAuth) await signOut(firebaseAuth).catch(() => undefined);
    if (firebaseApp) {
      const oldApp = firebaseApp;
      firebaseApp = null;
      firebaseAuth = null;
      await deleteApp(oldApp);
    }

    firebaseApp = initializeApp({
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      appId: config.appId
    }, "learnlens-turnstile-custom-provider-lab");

    firebaseAuth = getAuth(firebaseApp);
    // Test credentials and the Auth session are memory-only in this isolated lab.
    await setPersistence(firebaseAuth, inMemoryPersistence);
    stopAuthObserver = onAuthStateChanged(firebaseAuth, updateAuthUi);

    activeConfig = config;
    appCheck = null;
    signInButton.disabled = false;
    tokenButton.disabled = true;
    setText(connectionState, "Connected to test Firebase config");
    setText(authState, "Sign in with a verified test account.");
    setText(tokenState, "App Check is not initialized yet.");
    log("Firebase configuration accepted. The exact Functions host permission is granted.", "success");
    log("Configuration and auth persistence remain in memory; no storage write was made.", "info");
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Could not connect to the test project.";
    setText(connectionState, "Connection failed");
    setText(authState, message);
    log(message, "error");
  } finally {
    connectButton.disabled = false;
  }
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!firebaseApp || !firebaseAuth || !activeConfig) {
    log("Connect the Firebase test configuration first.", "warning");
    return;
  }

  signInButton.disabled = true;
  const email = valueOf("email");
  const passwordInput = document.getElementById("password");
  const password = passwordInput instanceof HTMLInputElement ? passwordInput.value : "";
  try {
    if (!email || !password) throw new Error("Enter the test account email and password.");
    const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
    if (!credential.user.emailVerified) {
      await signOut(firebaseAuth);
      throw new Error("This test account is not email-verified. Verify the email, then sign in again.");
    }

    if (!appCheck) {
      appCheck = initializeTurnstileAppCheck(firebaseApp, firebaseAuth, {
        functionsBaseUrl: activeConfig.functionsBaseUrl,
        hostedPageUrl: activeConfig.hostedPageUrl,
        siteKey: activeConfig.siteKey
      });
    }
    setText(authState, "Signed in with a verified test account. App Check is initialized.");
    setText(tokenState, "Ready for a manual challenge.");
    tokenButton.disabled = false;
    signOutButton.disabled = false;
    log("Verified test account signed in. CustomProvider initialized with automatic refresh disabled.", "success");
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Could not sign in to the test account.";
    setText(authState, message);
    log(message, "error");
  } finally {
    if (passwordInput instanceof HTMLInputElement) passwordInput.value = "";
    signInButton.disabled = Boolean(firebaseAuth?.currentUser);
  }
});

signOutButton.addEventListener("click", async () => {
  if (!firebaseAuth) return;
  try {
    await signOut(firebaseAuth);
    setText(tokenState, "Signed out. The in-memory Firebase Auth session has ended.");
    log("Test account signed out.", "info");
  } catch {
    log("Firebase could not sign out this test account.", "error");
  }
});

tokenButton.addEventListener("click", async () => {
  if (!appCheck || !firebaseAuth?.currentUser?.emailVerified) {
    log("Sign in with a verified test account before requesting a token.", "warning");
    return;
  }
  tokenButton.disabled = true;
  setText(tokenState, "Waiting for Turnstile verification…");
  try {
    const result = await requestTurnstileAppCheckToken(appCheck, true);
    if (!result.token) throw new Error("Firebase returned an empty App Check token.");
    setText(tokenState, "PASS — Firebase returned an App Check token. Token value was not displayed.");
    log("PASS — App Check token acquired. Token value was not printed or persisted.", "success");
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The App Check challenge failed.";
    setText(tokenState, message);
    log(message, "error");
  } finally {
    tokenButton.disabled = !firebaseAuth?.currentUser?.emailVerified;
  }
});

clearLogButton.addEventListener("click", () => logElement.replaceChildren());

setText(extensionOriginElement, extensionOrigin);
log("Lab ready. Use only a dedicated non-production Firebase project and test account.", "info");
