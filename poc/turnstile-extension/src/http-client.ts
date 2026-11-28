export interface ChallengeAuthUser {
  readonly emailVerified: boolean;
  getIdToken(forceRefresh?: boolean): Promise<string>;
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

export interface AppCheckTokenResponse {
  token: string;
  expireTimeMillis: number;
}

export type ChallengeOperation =
  | "createAppCheckChallengeSession"
  | "completeAppCheckChallenge"
  | "claimAppCheckChallengeSession";

export interface ChallengeHttpClientOptions {
  functionsBaseUrl: string;
  getCurrentUser: () => ChallengeAuthUser | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const MAX_RESPONSE_BYTES = 32 * 1024;
const MAX_TOKEN_LENGTH = 16_384;

function parseFunctionsBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The Firebase Functions base URL is invalid.");
  }
  const isLocalEmulator =
    (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
    url.protocol === "http:";
  if (
    (url.protocol !== "https:" && !isLocalEmulator) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("The Firebase Functions URL must be an HTTPS origin with no path, query or credentials.");
  }
  return url.origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readSession(value: unknown, nowMs: number): CreatedChallengeSession {
  if (!isRecord(value)) throw new Error("Firebase returned an invalid challenge session.");
  const keys = ["sessionId", "pollCredential", "cdata", "action", "appId", "createdAtMs", "expiresAtMs"];
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    typeof value.sessionId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(value.sessionId) ||
    typeof value.pollCredential !== "string" ||
    !/^[A-Za-z0-9_-]{40,128}$/.test(value.pollCredential) ||
    typeof value.cdata !== "string" ||
    !/^[A-Za-z0-9_-]{16,255}$/.test(value.cdata) ||
    typeof value.action !== "string" ||
    !/^[a-z][a-z0-9_]{2,63}$/.test(value.action) ||
    typeof value.appId !== "string" ||
    value.appId.length < 8 ||
    !Number.isSafeInteger(value.createdAtMs) ||
    !Number.isSafeInteger(value.expiresAtMs) ||
    (value.expiresAtMs as number) <= (value.createdAtMs as number) ||
    (value.expiresAtMs as number) <= nowMs
  ) {
    throw new Error("Firebase returned an invalid challenge session.");
  }
  return value as unknown as CreatedChallengeSession;
}

function readTokenResponse(value: unknown, nowMs: number): AppCheckTokenResponse {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    typeof value.token !== "string" ||
    value.token.length === 0 ||
    value.token.length > MAX_TOKEN_LENGTH ||
    !Number.isSafeInteger(value.expireTimeMillis) ||
    (value.expireTimeMillis as number) <= nowMs ||
    (value.expireTimeMillis as number) > nowMs + 7 * 24 * 60 * 60 * 1000 + 60_000
  ) {
    throw new Error("Firebase returned an invalid App Check token response.");
  }
  return {
    token: value.token,
    expireTimeMillis: value.expireTimeMillis as number
  };
}

export class ChallengeHttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: ChallengeHttpClientOptions) {
    this.baseUrl = parseFunctionsBaseUrl(options.functionsBaseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async createChallengeSession(): Promise<CreatedChallengeSession> {
    const result = await this.post("createAppCheckChallengeSession", {});
    const session = readSession(result, this.now());
    if (session.expiresAtMs <= this.now()) {
      throw new Error("Firebase returned an expired challenge session. Start again.");
    }
    return session;
  }

  async completeChallenge(sessionId: string, responseToken: string): Promise<void> {
    if (
      typeof sessionId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(sessionId) ||
      typeof responseToken !== "string" ||
      responseToken.length === 0 ||
      responseToken.length > 2048
    ) {
      throw new Error("The security challenge response is invalid.");
    }
    const result = await this.post("completeAppCheckChallenge", { sessionId, responseToken });
    if (
      !isRecord(result) ||
      Object.keys(result).length !== 2 ||
      result.verified !== true ||
      !Number.isSafeInteger(result.expiresAtMs) ||
      (result.expiresAtMs as number) <= this.now()
    ) {
      throw new Error("Firebase did not confirm the security challenge.");
    }
  }

  async claimAppCheckToken(
    sessionId: string,
    pollCredential: string
  ): Promise<AppCheckTokenResponse> {
    if (
      typeof sessionId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(sessionId) ||
      typeof pollCredential !== "string" ||
      !/^[A-Za-z0-9_-]{40,128}$/.test(pollCredential)
    ) {
      throw new Error("The challenge session credentials are invalid.");
    }
    return readTokenResponse(
      await this.post("claimAppCheckChallengeSession", { sessionId, pollCredential }),
      this.now()
    );
  }

  private async post(
    operation: ChallengeOperation,
    payload: Record<string, string>
  ): Promise<unknown> {
    const user = this.options.getCurrentUser();
    if (!user) throw new Error("Sign in before requesting a security challenge.");
    if (user.emailVerified !== true) {
      throw new Error("Verify your email address before continuing.");
    }

    let idToken: string;
    try {
      idToken = await user.getIdToken();
    } catch {
      throw new Error("Your sign-in session could not be refreshed. Sign in again.");
    }
    if (typeof idToken !== "string" || idToken.length < 100 || idToken.length > 8192) {
      throw new Error("Firebase returned an invalid sign-in token.");
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl + "/" + operation, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: {
          "Authorization": "Bearer " + idToken,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000)
      });
    } catch {
      throw new Error("Could not reach the LearnLens security service. Check your connection and retry.");
    } finally {
      idToken = "";
    }

    let raw: string;
    try {
      raw = await response.text();
    } catch {
      throw new Error("The security service returned an unreadable response.");
    }
    if (new TextEncoder().encode(raw).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("The security service response exceeded the allowed size.");
    }

    let envelope: unknown;
    try {
      envelope = JSON.parse(raw);
    } catch {
      throw new Error("The security service returned an invalid response.");
    }
    if (!isRecord(envelope)) throw new Error("The security service response is malformed.");

    if (!response.ok) {
      const error = isRecord(envelope.error) ? envelope.error : null;
      const message = typeof error?.message === "string"
        ? error.message.slice(0, 240)
        : "The security service rejected the request.";
      throw new Error(message);
    }
    if (!Object.prototype.hasOwnProperty.call(envelope, "data")) {
      throw new Error("The security service response is missing its data field.");
    }
    return envelope.data;
  }
}
