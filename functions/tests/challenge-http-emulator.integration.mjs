import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "demo-learnlens-emulator";
const AUTH_EMULATOR = "http://127.0.0.1:9099";
const FUNCTIONS_EMULATOR = "http://127.0.0.1:5001";
const REGION = "us-central1";
const EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const API_KEY = "fake-api-key";

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = PROJECT_ID;

const adminApp = initializeApp({ projectId: PROJECT_ID }, "learnlens-challenge-http-integration");
const auth = getAuth(adminApp);
const database = getFirestore(adminApp);
const baseUrl = `${FUNCTIONS_EMULATOR}/${PROJECT_ID}/${REGION}`;

async function createAccount(emailVerified) {
  const suffix = randomUUID();
  const email = `challenge-${suffix}@example.test`;
  const password = `Test-${randomUUID()}-Aa1!`;
  const user = await auth.createUser({
    email,
    password,
    emailVerified,
    displayName: "LearnLens emulator test"
  });

  const response = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    }
  );
  const payload = await response.json();
  assert.equal(response.status, 200, payload.error?.message ?? "Auth Emulator sign-in failed.");
  assert.equal(payload.localId, user.uid);
  assert.ok(typeof payload.idToken === "string" && payload.idToken.length > 100);

  return { uid: user.uid, email, idToken: payload.idToken };
}

async function callEndpoint(operation, idToken, body, origin = EXTENSION_ORIGIN) {
  const headers = {
    origin,
    "content-type": "application/json"
  };
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  const response = await fetch(`${baseUrl}/${operation}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "error"
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

function errorCode(payload) {
  const error = payload.error;
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

async function cleanup(accounts) {
  await Promise.all(accounts.map(async (account) => {
    await auth.deleteUser(account.uid).catch(() => undefined);
  }));
  await deleteApp(adminApp);
}

async function main() {
  const accounts = [];
  try {
    // Missing credentials must fail before any session record is written.
    const unauthenticated = await callEndpoint("createAppCheckChallengeSession", undefined, {});
    assert.equal(unauthenticated.status, 401);
    assert.equal(errorCode(unauthenticated.payload), "unauthenticated");

    // Browser-origin allowlisting is independent of user authentication.
    const invalidOriginAccount = await createAccount(true);
    accounts.push(invalidOriginAccount);
    const blockedOrigin = await callEndpoint(
      "createAppCheckChallengeSession",
      invalidOriginAccount.idToken,
      {},
      "https://attacker.example"
    );
    assert.equal(blockedOrigin.status, 403);
    assert.equal(errorCode(blockedOrigin.payload), "permission-denied");

    // A signed-in but unverified user must not start a challenge.
    const unverified = await createAccount(false);
    accounts.push(unverified);
    const unverifiedResult = await callEndpoint(
      "createAppCheckChallengeSession",
      unverified.idToken,
      {}
    );
    assert.equal(unverifiedResult.status, 412);
    assert.equal(errorCode(unverifiedResult.payload), "failed-precondition");

    // A verified Auth Emulator account can create a real Firestore-backed session.
    const owner = await createAccount(true);
    accounts.push(owner);
    const created = await callEndpoint("createAppCheckChallengeSession", owner.idToken, {});
    assert.equal(created.status, 200, JSON.stringify(created.payload));
    assert.ok(created.payload.data && typeof created.payload.data === "object");

    const session = created.payload.data;
    assert.equal(session.appId, "1:123456789:web:learnlens-emulator");
    assert.equal(session.action, "learnlens_app_check");
    assert.ok(typeof session.sessionId === "string");
    assert.ok(typeof session.pollCredential === "string");
    assert.ok(typeof session.cdata === "string");
    assert.ok(Number.isSafeInteger(session.expiresAtMs));

    const sessionSnapshot = await database.doc(
      `appCheckChallengeSessions/${session.sessionId}`
    ).get();
    assert.equal(sessionSnapshot.exists, true);
    const storedSession = sessionSnapshot.data();
    assert.equal(storedSession?.uid, owner.uid);
    assert.equal(storedSession?.state, "pending");
    assert.equal(typeof storedSession?.pollCredentialHash, "string");
    assert.equal(Object.prototype.hasOwnProperty.call(storedSession ?? {}, "pollCredential"), false);

    // A different verified account cannot submit a Turnstile result for this session.
    const other = await createAccount(true);
    accounts.push(other);
    const crossAccountCompletion = await callEndpoint(
      "completeAppCheckChallenge",
      other.idToken,
      {
        sessionId: session.sessionId,
        responseToken: "emulator-test-turnstile-response"
      }
    );
    assert.equal(crossAccountCompletion.status, 403);
    assert.equal(errorCode(crossAccountCompletion.payload), "permission-denied");

    // Invalid completion data is rejected before the Cloudflare Siteverify call.
    const malformedCompletion = await callEndpoint(
      "completeAppCheckChallenge",
      owner.idToken,
      {
        sessionId: session.sessionId,
        responseToken: ""
      }
    );
    assert.equal(malformedCompletion.status, 400);
    assert.equal(errorCode(malformedCompletion.payload), "invalid-argument");

    // A pending session cannot mint an App Check token; the external token issuer is never reached.
    const pendingClaim = await callEndpoint(
      "claimAppCheckChallengeSession",
      owner.idToken,
      {
        sessionId: session.sessionId,
        pollCredential: session.pollCredential
      }
    );
    assert.equal(pendingClaim.status, 412);
    assert.equal(errorCode(pendingClaim.payload), "failed-precondition");

    // A preflight response contains CORS headers only for the exact configured extension origin.
    const preflight = await fetch(`${baseUrl}/createAppCheckChallengeSession`, {
      method: "OPTIONS",
      headers: { origin: EXTENSION_ORIGIN }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), EXTENSION_ORIGIN);
    assert.equal(preflight.headers.get("cache-control"), "no-store, max-age=0");

    // Wrong origins are rejected before CORS headers are reflected.
    const blockedPreflight = await fetch(`${baseUrl}/createAppCheckChallengeSession`, {
      method: "OPTIONS",
      headers: { origin: "https://attacker.example" }
    });
    assert.equal(blockedPreflight.status, 403);
    assert.equal(blockedPreflight.headers.get("access-control-allow-origin"), null);

    console.log("Challenge HTTPS emulator integration passed: Auth ID-token verification, email verification, CORS, Firestore session creation, ownership checks, pending-session rejection and no-store headers.");
  } finally {
    await cleanup(accounts);
  }
}

main().catch((error) => {
  console.error("Challenge HTTP emulator integration failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
