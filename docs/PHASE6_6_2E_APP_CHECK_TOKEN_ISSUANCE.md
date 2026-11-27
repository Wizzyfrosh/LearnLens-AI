# Phase 6.6.2E — One-time Firebase App Check token issuance

**Status:** Implemented and CI-verified — [run 46085254191](https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/46085254191)  
**Branch:** `phase-6-6-2-turnstile-custom-provider-poc`  
**PR:** #2 (draft; not merged)

## Endpoint behavior

The authenticated callable `claimAppCheckChallengeSession` now issues the first Firebase App Check token instead of returning only consumed-session metadata.

The callable still requires:
- Firebase Authentication.
- A verified email.
- `APP_CHECK_CHALLENGE_ENABLED === true`.
- A valid session ID and one-time polling credential.
- A session belonging to the authenticated UID.
- A verified, unexpired session.
- The App ID and action to match trusted server configuration.

The client cannot choose the target Firebase App ID, token TTL, or claims.

## Token issuance flow

1. Apply the per-UID claim rate limit.
2. Read the server-owned session context.
3. Validate account owner, verified state, expiry, configured App ID and action.
4. Atomically consume the session with its one-time polling credential.
5. Call Firebase Admin `getAppCheck(adminApp).createToken(appId, { ttlMillis })`.
6. Return only `{ token, expireTimeMillis }` to the authenticated extension caller.

The token is not logged or persisted in Firestore. The App ID comes from the server-owned session and is checked against the current server parameter. The action is also checked.

## Token lifetime

The prototype requests a 30-minute token lifetime, the minimum supported by the Firebase Admin App Check custom-token API. The returned `ttlMillis` is validated and used to calculate `expireTimeMillis`.

This is a deliberate conservative choice for a POC. Shorter than 30 minutes is not supported by this API. A short token lifetime means the custom provider must perform challenge acquisition more frequently; the client integration is not implemented yet.

Reference:
- https://firebase.google.com/docs/reference/admin/node/firebase-admin.app-check.appchecktokenoptions
- https://firebase.google.com/docs/reference/admin/node/firebase-admin.app-check.appcheck
- https://firebase.google.com/docs/app-check/web/custom-provider

## Failure and replay behavior

Session consumption is irreversible. If Firebase token signing fails after consumption:
- The endpoint returns a sanitized `unavailable` error.
- The session remains `consumed`.
- The same session cannot be retried or reopened.
- The caller must start a new challenge.

This can require the user to complete Turnstile again after a transient signing/network problem, but it avoids replaying a consumed challenge or accidentally issuing multiple tokens for one session.

Concurrent-claim tests assert that only one request can consume the session and call the token issuer. Tests use a fake issuer; no real Firebase App Check token is minted in CI.

## Test coverage

- Token issuer receives only the server-selected App ID.
- Requested TTL is exactly 30 minutes.
- Response returns token and absolute expiry in the custom-provider shape.
- Wrong configured App ID is rejected before consumption.
- Token issuer failure returns a sanitized error and does not reopen the session.
- Replays are rejected.
- Concurrent claim attempts mint at most one token.

CI run 46085254191 passed: 11 Firestore Rules tests, 8 Turnstile validator tests, and 23 Firestore Emulator tests passed; Functions TypeScript build and TTL configuration validation also passed. Token issuance uses a fake issuer in tests; no live App Check token was requested.

## Explicit non-goals / remaining work

- No Firebase custom-provider client is initialized in LearnLens.
- No extension challenge-popup/hosted-page bridge exists yet.
- No real token is requested from a deployed Firebase project.
- No live Cloudflare challenge is configured or verified.
- No production sync gates are changed or enabled.
- The Turnstile flow remains an abuse-friction layer, not proof of a genuine installed extension.
- Global/perimeter abuse and cost controls remain necessary before any live rollout.

## Safeguards

- `APP_CHECK_CHALLENGE_ENABLED` defaults to `false`.
- Existing sync callables retain `enforceAppCheck: true`.
- All four cloud-sync gates remain disabled.
- No secrets, parameters, TTL policies, functions or hosted pages are deployed.
- Extension version remains `0.1.0`.
