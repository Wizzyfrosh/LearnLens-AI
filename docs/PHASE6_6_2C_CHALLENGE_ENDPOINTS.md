# Phase 6.6.2C — Authenticated challenge endpoint layer

**Status:** Implemented and CI-verified — [run 46084701021](https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/46084701021)  
**Branch:** `phase-6-6-2-turnstile-custom-provider-poc`  
**PR:** #2 (draft; not merged)

## Exported callable endpoints

All three endpoints are Firebase HTTPS `onRequest` handlers, not `onCall` callables. The extension sends a Firebase ID token in `Authorization: Bearer ...`; the server verifies the token (including revocation) with Firebase Admin and requires `email_verified === true`. Exact CORS allowlisting is enforced for the configured extension origin. The handlers do not require App Check because they form the bootstrap sequence that runs before the first custom App Check token exists. They are isolated from all existing sync callables.

### `createAppCheckChallengeSession`
- Requires a valid Firebase ID token and verified email claim.
- Applies a transactional rate limit of five creation requests per authenticated UID per minute.
- Takes Firebase App ID and action from server parameters, never request data.
- Creates a five-minute pending session.
- Returns the one-time polling credential, session ID and cdata to the extension. The polling credential must remain in extension memory and must never be placed in URLs, browser history, logs, analytics or the hosted challenge page.

### `completeAppCheckChallenge`
- Requires a valid Firebase ID token and verified email claim.
- Accepts exactly `sessionId` and `responseToken`; response tokens are capped at 2,048 characters.
- Rate-limits by the verified Firebase UID, not by the caller-supplied session ID.
- Loads the UID, App ID, action, cdata, state and expiry from Firestore.
- Rejects a session owned by another UID, a non-pending/expired session or a mismatch with server configuration before contacting Cloudflare.
- Calls Siteverify server-side using the `TURNSTILE_SECRET` secret.
- Requires exact configured hostname, action, cdata and a fresh challenge timestamp.
- Moves the matching session from pending to verified transactionally only after Siteverify succeeds.

### `claimAppCheckChallengeSession`
- Requires a valid Firebase ID token and verified email claim.
- Accepts exactly the session ID and polling credential.
- Applies a transactional rate limit of five claims per authenticated UID per minute.
- Atomically consumes the verified session using the UID and high-entropy polling credential.
- Does not mint or return an App Check token yet.

## Endpoint design correction

The first draft used a public HTTPS completion endpoint and rate-limited by the untrusted session ID. That could let arbitrary callers create unbounded rate-limit records using random IDs.

The completion operation is now a Firebase callable requiring verified Firebase Auth. Its rate-limit key is derived from the authenticated UID, and the service independently confirms that the stored session belongs to that UID. The hosted challenge page must not receive the Firebase Auth token or polling credential; the extension calls these HTTPS endpoints directly using `fetch` and its existing Firebase Auth session. Using Firebase `httpsCallable` from `CustomProvider.getToken()` would recurse: the callable SDK's context provider itself calls `AppCheck.getToken()` when App Check is initialized.

## Rate limiter

`functions/src/app-check-poc/challenge-rate-limit.ts`:
- Stores only a SHA-256-derived scope/subject key.
- Uses a Firestore transaction for atomic fixed-window counters.
- Allows five requests per scope/subject per 60-second window.
- Does not reset an active window if the server clock moves backwards.
- Rejects malformed stored state rather than silently resetting it.

Current scopes are `create`, `complete` and `claim`. This is per-account throttling, not a global or network-edge limit. A production rollout still requires an explicit multi-account abuse strategy and global cost controls.

## Firestore access boundary

The following collections have explicit client read/write denial in `firestore.rules`:
- `appCheckChallengeSessions`
- `appCheckChallengeRateLimits`

Admin SDK access remains server-side and bypasses Firestore Security Rules as designed.

## Required server configuration before deployment

The following parameters/secrets are referenced but must not be configured in production yet:
- Secret: `TURNSTILE_SECRET`
- Parameter: `APP_CHECK_CHALLENGE_APP_ID`
- Parameter: `APP_CHECK_CHALLENGE_HOSTNAME`
- Parameter: `APP_CHECK_CHALLENGE_ACTION` (defaults to `learnlens_app_check`)
- Parameter: `APP_CHECK_CHALLENGE_EXTENSION_ORIGIN` (defaults to empty; must be the exact `chrome-extension://<id>` origin before browser requests can pass CORS)

No Cloudflare widget/site key, production secret, Firebase parameter, deployed endpoint, or Firebase resource has been created by this change.

## Tests added

- Authenticated challenge service tests: creation, ownership binding, configuration mismatch, Siteverify rejection and claim/replay.
- Firestore Emulator rate-limit tests: limit boundary, clock rollback, window reset, scope isolation and malformed input.
- Existing session lifecycle and Turnstile validator tests remain part of the isolated CI workflow.

## Remaining work

- The Functions TypeScript build, Turnstile validator tests and all 19 Firestore Emulator tests passed in CI run 46084701021.
- Add scheduled TTL cleanup or configure Firestore TTL for challenge and rate-limit records.
- Add global/perimeter abuse controls suitable for multiple accounts; per-UID limits alone are not a production cost boundary.
- Review the hosted challenge page origin, HTTPS deployment and strict extension/page messaging contract.
- Implement App Check custom token issuance only after a consumed session, with a bounded, explicit failure/retry contract.
- Build and test the hosted challenge page and extension flow.
- Complete a security review before any deployment.

## Safeguards

- Existing sync callables continue to use `enforceAppCheck: true`.
- All four cloud sync gates remain disabled.
- Challenge callables do not invoke sync operations.
- No secret, site key, Firebase parameter or endpoint is configured in production.
- Keep product extension version `0.1.0`.
- This is a bot-abuse mitigation prototype, not cryptographic proof that the genuine extension package is installed.


## Transport correction — direct authenticated HTTP

The three bootstrap handlers now use Firebase Functions HTTPS `onRequest` instead of `onCall`. This avoids the Firebase callable SDK's implicit App Check token retrieval while `CustomProvider.getToken()` is executing.

The extension sends the Firebase ID token directly in the bearer header. The server validates it with `adminAuth.verifyIdToken(idToken, true)`, checks email verification, checks exact origin/CORS and validates the JSON payload. This origin check is a browser cross-origin boundary, not authentication; the verified Firebase ID token remains the authentication mechanism.

Only the three bootstrap routes use this transport. Existing sync routes remain callable and retain `enforceAppCheck: true`.
