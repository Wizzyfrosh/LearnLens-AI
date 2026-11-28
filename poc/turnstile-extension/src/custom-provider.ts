import { CustomProvider, type AppCheckToken } from "firebase/app-check";
import type {
  AppCheckChallengeToken,
  CreatedChallengeSession,
  ChallengeHttpClient
} from "./types";
import type { TurnstileChallengePresenter } from "./iframe-challenge";

export interface CurrentFirebaseUser {
  readonly emailVerified: boolean;
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

export interface CustomProviderCoordinatorOptions {
  getCurrentUser: () => CurrentFirebaseUser | null;
  challengeClient: Pick<
    ChallengeHttpClient,
    "createChallengeSession" | "completeChallenge" | "claimAppCheckToken"
  >;
  challengePresenter: TurnstileChallengePresenter;
  siteKey: string;
}

export interface ChallengeHttpClient {
  createChallengeSession(): Promise<CreatedChallengeSession>;
  completeChallenge(sessionId: string, responseToken: string): Promise<void>;
  claimAppCheckToken(sessionId: string, pollCredential: string): Promise<AppCheckChallengeToken>;
}

export interface CreatedChallengeSession {
  sessionId: string;
  pollCredential: string;
  cdata: string;
  action: string;
  appId: string;
  createdAtMs: number;
  expiresAtMs: number;
}

/**
 * Firebase's CustomProvider delegates every token acquisition to this
 * coordinator. The Firebase SDK owns token caching; this class only
 * coalesces concurrent in-flight acquisitions.
 */
export function createTurnstileCustomProvider(
  options: CustomProviderCoordinatorOptions
): CustomProvider {
  let inFlight: Promise<AppCheckToken> | null = null;

  const acquire = async (): Promise<AppCheckToken> => {
    const user = options.getCurrentUser();
    if (!user) throw new Error("Sign in before requesting an App Check token.");
    if (user.emailVerified !== true) {
      throw new Error("Verify your email address before continuing.");
    }

    let pollCredential = "";
    let responseToken = "";
    try {
      const session = await options.challengeClient.createChallengeSession();
      pollCredential = session.pollCredential;

      responseToken = await options.challengePresenter.getResponse({
        siteKey: options.siteKey,
        action: session.action,
        cdata: session.cdata
      });
      if (typeof responseToken !== "string" || responseToken.length === 0 || responseToken.length > 2048) {
        throw new Error("The security challenge returned an invalid response.");
      }

      await options.challengeClient.completeChallenge(session.sessionId, responseToken);
      responseToken = "";

      const result = await options.challengeClient.claimAppCheckToken(
        session.sessionId,
        pollCredential
      );

      if (
        typeof result.token !== "string" ||
        result.token.length === 0 ||
        result.token.length > 16_384 ||
        !Number.isSafeInteger(result.expireTimeMillis) ||
        result.expireTimeMillis <= Date.now()
      ) {
        throw new Error("Firebase returned an invalid App Check token.");
      }

      return {
        token: result.token,
        expireTimeMillis: result.expireTimeMillis
      };
    } finally {
      // Do not retain one-time credentials or Turnstile response after use.
      pollCredential = "";
      responseToken = "";
    }
  };

  return new CustomProvider({
    getToken: () => {
      if (!inFlight) {
        const current = acquire().finally(() => {
          if (inFlight === current) inFlight = null;
        });
        inFlight = current;
      }
      return inFlight;
    }
  });
}
