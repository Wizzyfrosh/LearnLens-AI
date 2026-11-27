# Phase 6.6.2C — Challenge endpoint layer

**Status:** Endpoint implementation committed; CI verification pending  
**Branch:** `phase-6-6-2-turnstile-custom-provider-poc`  
**PR:** #2 (draft; not merged)

## Added

### Callable: `createAppCheckChallengeSession`
- Requires Firebase Authentication and verified email.
- Deliberately does not require App Check because it is the bootstrap operation that precedes the first App Check token.
- Applies a per-UID transactional rate limit.
- Takes App ID and action from server parameters, not client input.
- Creates the five-minute pending session and returns the session bootstrap values.

### HTTPS endpoint: `completeAppCheckChallenge`
- Accepts POST with JSON only.
- Accepts exactly `sessionId` and `responseToken`.
- Loads cdata, App ID, action and expiry from Firestore; the client cannot supply expected values.
- Applies a per-session transactional rate limit.
- Calls Cloudflare Siteverify from the server using the secret parameter.
- Validates success, configured hostname, expected action, cdata and challenge timestamp.
- Only then moves the session from pending to verified.
- Does not expose the Cloudflare secret or raw Siteverify response.

### Callable: `claimAppCheckChallengeSession`
- Requires Firebase Authentication and verified email.
- Requires exactly the session ID and polling credential.
- Applies a per-UID transactional rate limit.
- Atomically consumes the session using the existing one-time claim logic.
- Does not mint an App Check token yet.

### Rate limiter
`functions/src/app-check-poc/challenge-rate-limit.ts` stores hashed scope/subject keys and enforces a fixed five-request-per-minute window through Firestore transactions. Current scopes are create (UID), complete (session ID), and claim (UID).

## Required server configuration before deployment

The following parameters/secrets are referenced but must not be configured in production yet:
- Secret: `TURNSTILE_SECRET`
- Parameter: `APP_CHECK_CHALLENGE_APP_ID`
- Parameter: `APP_CHECK_CHALLENGE_HOSTNAME`
- Parameter: `APP_CHECK_CHALLENGE_ACTION` (defaults to `learnlens_app_check`)

No Cloudflare site key, production secret, Firebase parameter, deployed endpoint, or Firebase resource has been created by this change.

## Important remaining work

- Add dedicated unit/integration tests for rate limiting and endpoint handlers.
- Add Firestore rules denying all client reads/writes to `appCheckChallengeSessions` and `appCheckChallengeRateLimits` (Admin SDK currently bypasses rules; rules still document the intended boundary).
- Add scheduled TTL cleanup for session and rate-limit documents.
- Add an explicit allowlist for the expected challenge hostname and enforce HTTPS/origin policy at the hosted challenge boundary.
- Review Cloud Functions request body limits and public endpoint abuse/cost controls.
- Implement App Check custom token issuance only after a consumed session, with a carefully designed failure/retry contract.
- Build and test the hosted challenge page and extension flow.

## Safeguards

- The existing sync callables continue to use `enforceAppCheck: true`.
- The four cloud sync gates remain disabled.
- The challenge endpoints are isolated from sync operations.
- Do not deploy until endpoint tests, Firestore rules, TTL cleanup, production configuration, abuse controls and security review are complete.
