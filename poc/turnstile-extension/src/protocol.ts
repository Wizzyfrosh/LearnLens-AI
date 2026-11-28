export const TURNSTILE_MESSAGE_VERSION = 1 as const;

export interface TurnstileHostedInit {
  type: "LEARNLENS_TURNSTILE_INIT";
  version: typeof TURNSTILE_MESSAGE_VERSION;
  requestId: string;
  siteKey: string;
  action: string;
  cdata: string;
}

export interface AppCheckChallengeToken {
  token: string;
  expireTimeMillis: number;
}
