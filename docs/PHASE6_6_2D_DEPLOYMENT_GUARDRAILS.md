# Phase 6.6.2D — Deployment guardrails and challenge data retention

**Status:** Implemented; CI verification pending  
**Branch:** `phase-6-6-2-turnstile-custom-provider-poc`  
**PR:** #2 (draft; not merged)

## 1. Fail-closed bootstrap activation

All three challenge callables now check the server-side parameter:

`APP_CHECK_CHALLENGE_ENABLED`

It is declared as a Firebase boolean parameter with a default of `false`. The shared guard rejects any value other than literal boolean `true` with `failed-precondition`.

The guard is applied to:
- `createAppCheckChallengeSession`
- `completeAppCheckChallenge`
- `claimAppCheckChallengeSession`

This means deploying the isolated branch does not activate challenge operations unless an operator explicitly enables the parameter. This switch does not change any sync feature gate or sync callable's App Check enforcement.

The POC still binds `TURNSTILE_SECRET` to the completion callable. A deployment of this branch may therefore prompt for that secret even while the challenge switch is false. Do not supply a production secret or deploy this branch into production as part of this test.

## 2. Firestore TTL configuration

`firebase.json` now references `firestore.indexes.json`.

The index configuration declares TTL policies on the `expiresAt` timestamp for:
- Collection group `appCheckChallengeSessions`
- Collection group `appCheckChallengeRateLimits`

The TTL fields are not queried by this code, so their single-field indexing is exempted with empty `indexes` arrays. This follows Firestore guidance to avoid indexing sequential TTL timestamps when the application does not query them.

TTL is a storage-cleanup mechanism, not an authorization or expiry enforcement mechanism. Firestore documents that TTL deletion is asynchronous and typically occurs within 24 hours after expiry. The callable/service logic must continue to compare `expiresAt` against server time and reject expired records even while the document remains stored.

No TTL policy has been enabled in a live Firebase database. This is declarative repository configuration only; the policy takes effect only when deployed to a chosen Firebase project.

## 3. Firestore client access tests

The Firestore Rules test suite now explicitly checks that authenticated clients cannot read or write:
- `appCheckChallengeSessions/{sessionId}`
- `appCheckChallengeRateLimits/{rateLimitId}`

The Admin SDK service remains the only intended reader/writer for these records.

## 4. Rate-limit limits still open

The current limiter is transactional and per verified Firebase UID, with five requests per minute for each of the create, complete and claim scopes. It stores a hash of the scope/subject as the document ID and tolerates backwards clock movement without resetting an active window.

This is not a global abuse or cost boundary. A determined attacker can create multiple verified Firebase accounts. A single Firestore global counter would introduce a hot document and contention risk, so this repository does not add a naive global counter.

Before any live rollout, choose and verify an edge/platform-level quota or another distributed budget mechanism that has explicit fail-open/fail-closed behavior and measured cost limits. The POC remains disabled until that decision and the hosted challenge flow are complete.

## 5. CI verification

The isolated workflow now:
1. Builds the Firebase Functions TypeScript.
2. Validates the Firestore TTL declarations and their Firebase CLI registration.
3. Runs Firestore Security Rules tests, including challenge collection denial.
4. Runs Turnstile validator tests.
5. Runs Firestore Emulator tests for session lifecycle, authenticated service and per-UID rate limits.

CI result is pending for this slice.

## Safeguards

- `APP_CHECK_CHALLENGE_ENABLED` defaults to `false`.
- No production Firebase parameter, TTL policy, Turnstile widget, site key or secret has been configured.
- No Functions deployment has occurred.
- Existing sync callables remain `enforceAppCheck: true`.
- All four cloud-sync gates remain disabled.
- Product extension version remains `0.1.0`.
- Turnstile is abuse friction, not proof of genuine extension installation.
