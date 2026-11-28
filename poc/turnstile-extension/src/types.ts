export interface AppCheckChallengeToken {
  token: string;
  expireTimeMillis: number;
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

export interface ChallengeHttpClient {
  createChallengeSession(): Promise<CreatedChallengeSession>;
  completeChallenge(sessionId: string, responseToken: string): Promise<void>;
  claimAppCheckToken(sessionId: string, pollCredential: string): Promise<AppCheckChallengeToken>;
}
