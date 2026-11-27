# Phase 6.6.2B — Transactional challenge-session lifecycle

**Status:** Implemented and CI-verified in run [46078968718](https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/46078968718)  
**Branch:** `phase-6-6-2-turnstile-custom-provider-poc`  
**Scope:** Firestore session state only. No callable/HTTP endpoint, hosted challenge page, secret, token minting or product sync integration is included.

## Implementation

- `functions/src/app-check-poc/challenge-sessions.ts`
- `functions/tests/app-check-challenge-sessions.test.ts`

### Session creation

`createChallengeSession(uid, appId, action, database, nowMs?)`:
- Expects UID from verified Firebase Authentication context.
- Expects Firebase App ID and action from trusted server configuration, not caller request fields.
- Generates a cryptographically random UUID session ID.
- Generates a 256-bit polling credential and a separate 256-bit cdata binding.
- Persists only the SHA-256 hash of the polling credential.
- Stores the session in `appCheckChallengeSessions/{sessionId}` with state `pending`.
- Sets a five-minute expiry.

The raw polling credential is returned once to the caller and must remain in extension memory. It must never be placed in a URL, browser history, logs, analytics, or the hosted challenge page.

### Challenge completion

`completeChallengeSession(sessionId, verifiedCdata, database, nowMs?)`:
- Is intended to be called only after the backend has called Cloudflare Siteverify and validated success, exact hostname, exact action, cdata and challenge timestamp.
- Checks the stored session exists, is still pending, is not expired and its cdata exactly matches the Siteverify-validated cdata.
- Uses a Firestore transaction to move `pending -> verified`.
- Rejects repeat completion, expired sessions, malformed records and cdata mismatch.

This method does not itself call Cloudflare. The future HTTP endpoint must call Siteverify first and then pass the verified cdata into this transition.

### Poll/claim consumption

`consumeChallengeSession(uid, sessionId, pollCredential, database, nowMs?)`:
- Requires the currently authenticated UID and the high-entropy polling credential.
- Compares the supplied credential's SHA-256 hash using constant-time comparison.
- Requires state `verified` and an unexpired session.
- Uses a Firestore transaction to move `verified -> consumed`.
- Returns only server-stored App ID/action and timestamps; it does not return the poll credential or cdata.
- A second or concurrent consumer cannot claim the same session.

The state transition is a one-time claim for a later token-issuance attempt. If App Check token minting fails after consumption, the safe recovery is a new challenge session. The next implementation slice must preserve that behavior or design an explicit, bounded idempotent issuance protocol; it must not reopen consumed sessions.

## State machine

```text
pending --(Siteverify passed + cdata/session/expiry checks)--> verified
verified --(authenticated UID + poll credential + atomic claim)--> consumed

pending --(expiry)--> rejected
verified --(expiry)--> rejected
consumed --(any replay)--> rejected
```

There is no transition backwards and no client-controlled state update.

## Tests

Firestore Emulator integration tests cover:
- creation, five-minute expiry and hashed-only polling credential storage;
- valid pending-to-verified transition;
- wrong cdata rejection without state mutation;
- expiry at verification and consumption;
- wrong UID and wrong polling credential;
- successful single consumption and replay rejection;
- malformed identifiers and invalid trusted configuration;
- concurrent consumption with exactly one successful claimant;
- no completion after consumption.

The tests refuse to run without `FIRESTORE_EMULATOR_HOST`, preventing accidental use of a live Firebase project. CI starts the Firestore Emulator for this suite.

## Security and operational gaps intentionally left for later

- No endpoint is exported, so there is currently no network-accessible session creation/completion/claim API.
- No Firebase Auth callable wrapper or App Check bootstrap policy has been implemented.
- No per-UID/IP/global rate limiting or active-session quota exists yet.
- No Firestore TTL policy or scheduled cleanup is configured. Expired sessions are rejected in code, but documents require a later cleanup policy.
- No hosted HTTPS challenge page, Turnstile widget/site key, Cloudflare secret, or Siteverify endpoint wiring exists.
- No Firebase App Check token is minted or returned.
- No production Firebase resource, secret or deployment was changed.

## Non-negotiable safeguards

- Keep all four cloud-sync gates disabled.
- Keep existing sync callables at `enforceAppCheck: true`.
- Do not add an App Check bypass to existing sync endpoints.
- Do not accept UID, App ID, action, expected hostname or secret from an untrusted client.
- Do not store raw polling credentials or log tokens/secrets.
- Do not claim this is cryptographic proof of genuine extension installation.
- Keep product extension version `0.1.0`.
