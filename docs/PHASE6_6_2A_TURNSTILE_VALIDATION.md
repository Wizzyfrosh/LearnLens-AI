# Phase 6.6.2A — Turnstile validation core

**Status:** Isolated implementation; no live Cloudflare widget, secret, endpoint, or App Check token minting is configured.

## Scope

This slice implements only the server-side verification boundary for a Turnstile response. It does not create challenge sessions, persist session state, mint Firebase App Check tokens, or modify product sync.

Implementation:
- `functions/src/app-check-poc/turnstile-validation.ts`
- `functions/tests/turnstile-validation.test.ts`

The verifier calls Cloudflare Siteverify from the server and fails closed unless all of the following hold:
1. The input token is a non-empty string no longer than 2,048 characters.
2. Siteverify returns HTTP success and a parseable response.
3. Siteverify reports `success: true`.
4. The returned hostname exactly matches the configured challenge hostname.
5. The returned action exactly matches the expected LearnLens action.
6. The returned `cdata` exactly matches the expected opaque challenge-session binding.
7. The challenge timestamp parses and is no more than five minutes old, allowing at most 30 seconds of future clock skew.

The Siteverify secret and response token are sent in the POST body to Cloudflare. They are not put in the URL or logged. The verifier has a ten-second network timeout and returns sanitized backend errors.

## Important replay boundary

Cloudflare describes Turnstile tokens as single-use, but documents eventual consistency in duplicate redemption detection. This verifier does **not** treat Siteverify's duplicate detection as the application's replay control.

The caller must still perform an atomic, server-side, one-time transition on the LearnLens challenge-session record after successful verification. That session state transition is the next implementation slice. Do not issue an App Check token directly from this function.

## Tests

The Node test suite covers:
- valid response;
- Siteverify request destination and POST body;
- missing, non-string and oversized input;
- unsuccessful Siteverify response;
- hostname/action/cdata mismatch;
- malformed, expired and future timestamps;
- HTTP failure and malformed JSON;
- missing server configuration.

The test secret and tokens are fixtures only. No real Cloudflare request is made by unit tests.

## Not implemented / not approved

- No Turnstile widget or public site key.
- No Cloudflare secret or Firebase secret manager value.
- No hosted challenge page or hostname.
- No challenge-session store, polling credential, replay transaction, or rate limiter.
- No Firebase custom App Check provider client.
- No App Check token minting endpoint.
- No deployment, Firebase project changes, production secrets, or live sync.
- No change to the four disabled sync feature gates or existing `enforceAppCheck: true` callables.

This is an abuse-control prototype, not proof that a genuine LearnLens extension package is installed.
