import { initializeAppCheck, getToken, type AppCheck, type AppCheckTokenResult } from "firebase/app-check";
import type { FirebaseApp } from "firebase/app";
import type { Auth } from "firebase/auth/web-extension";
import { ChallengeHttpClient } from "./http-client";
import { IframeTurnstilePresenter } from "./iframe-challenge";
import { createTurnstileCustomProvider } from "./custom-provider";

export interface TurnstileAppCheckConfig {
  functionsBaseUrl: string;
  hostedPageUrl: string;
  siteKey: string;
  fetchImpl?: typeof fetch;
}

/**
 * Initializes Firebase App Check with the custom Turnstile provider.
 *
 * The App Check SDK owns token persistence and caching. Automatic refresh is
 * deliberately disabled until the complete challenge/refresh experience has
 * passed interactive Chrome tests.
 */
export function initializeTurnstileAppCheck(
  app: FirebaseApp,
  auth: Auth,
  config: TurnstileAppCheckConfig
): AppCheck {
  if (auth.app !== app) {
    throw new Error("Firebase Auth and App Check must use the same Firebase app instance.");
  }

  const challengeClient = new ChallengeHttpClient({
    functionsBaseUrl: config.functionsBaseUrl,
    getCurrentUser: () => auth.currentUser,
    fetchImpl: config.fetchImpl
  });
  const challengePresenter = new IframeTurnstilePresenter({
    hostedPageUrl: config.hostedPageUrl
  });
  const provider = createTurnstileCustomProvider({
    getCurrentUser: () => auth.currentUser,
    challengeClient,
    challengePresenter,
    siteKey: config.siteKey
  });

  return initializeAppCheck(app, {
    provider,
    isTokenAutoRefreshEnabled: false
  });
}

/** Explicit test/foreground request; the SDK still owns its internal cache. */
export function requestTurnstileAppCheckToken(
  appCheck: AppCheck,
  forceRefresh = true
): Promise<AppCheckTokenResult> {
  return getToken(appCheck, forceRefresh);
}
