# Phase 6.6.2F — Global abuse and cost-control architecture decision

**Status:** Implemented and CI-verified — [run 46086040038](https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/46086040038)  
**Branch:** `phase-6-6-2-turnstile-custom-provider-poc`  
**PR:** #2 (draft; not merged)

## Decision

Do not add a Cloudflare Worker or a single global Durable Object to the current Firebase HTTPS bootstrap path yet.

Keep Firebase Functions HTTPS `onRequest` handlers as the challenge/token endpoints for the current POC; existing sync operations remain callable functions. Retain the transactional per-UID limits already implemented. A bounded, sharded Firestore global budget is now implemented in the isolated POC branch and must remain disabled until a non-production rollout is explicitly approved.

## Why not a Cloudflare Rate Limiting binding as the strict global cap?

Cloudflare's Workers Rate Limiting API is deliberately approximate and local to the Cloudflare location handling the request. Counts synchronize asynchronously; requests can exceed the configured threshold, and separate locations do not share a worldwide allowance.

It can be useful for coarse edge abuse friction, but it is not a strict global financial/cost budget.

Official docs:
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

## Why not a single global Durable Object?

Cloudflare documents Durable Objects as the option for strict rate limits across locations. A single globally addressed object would serialize every challenge request through one coordination point. That creates a throughput bottleneck and a failure dependency for a low-value bootstrap operation.

The current account is budget-constrained and has no approved need for a new always-on edge service. Durable Objects are available on the Workers Free plan only with SQLite storage, but the free allowance is finite:
- 100,000 Durable Object requests/day.
- 13,000 GB-seconds/day.
- 5 million SQLite rows read/day.
- 100,000 SQLite rows written/day.

A strict global object would add infrastructure and operational complexity before we have measured traffic or an actual live abuse pattern.

Official docs:
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/best-practices/

## Implemented control: sharded global daily budget in Firestore

Keep the existing per-UID per-scope 60-second limit. Add a second independent global daily budget before expensive operations:
- Before Turnstile Siteverify calls.
- Before App Check token minting.
- Optionally before session creation if abuse/cost telemetry shows session creation is material.

Use UTC-day-scoped shard documents and a server-generated cryptographically random shard selection. Each shard has a transactional counter and a fixed hard ceiling. The sum of all shard ceilings is the maximum accepted daily operations, so the budget cannot be exceeded even though requests are distributed. This can reject early if a shard fills before others; that is an intentional availability trade-off for a hard upper bound.

The implementation uses 64 server-randomized shards with a hard ceiling of 100 operations per shard per UTC day (maximum 6,400 operations/day). It uses flat documents in the `appCheckChallengeGlobalBudgets` collection so Firestore TTL can clean them. The feature is controlled by `APP_CHECK_CHALLENGE_GLOBAL_BUDGET_ENABLED`, default false. This is a prototype ceiling and must be reviewed against expected traffic before any live enablement.

Session creation consumes one unit before the session is created. Turnstile completion consumes one unit before calling Cloudflare Siteverify. Token issuance first atomically validates and consumes the session with its high-entropy polling credential, then consumes one budget unit before Firebase token signing. Invalid or guessed polling credentials cannot burn global capacity. If the budget is exhausted after a valid session is consumed, the caller must start a fresh challenge after the circuit breaker resets. Failed upstream attempts are not refunded.

The global budget is a coarse service-wide circuit breaker, not a user quota. Keep per-UID throttling independently. Session creation consumes one unit before creating the session. Completion consumes one unit before Siteverify. Token issuance first validates and atomically consumes the session using its polling credential, then consumes one unit before calling Firebase Admin to mint the App Check token. Invalid/guessed polling credentials cannot burn global capacity. A valid session can be consumed even when the global budget has just become exhausted; that session cannot be reopened.

## Network/IP controls

Do not use a caller-provided IP header in Firebase Functions. If an edge proxy is introduced later:
- It must be the only network route to the protected bootstrap service, not an optional path that can be bypassed.
- It must overwrite, not trust, incoming forwarded-IP headers.
- Any proxy-to-origin authentication must use a server-held secret or signed request with replay protection; a bundled extension secret is never valid.
- IP throttling is secondary only. Nigerian mobile networks and carrier-grade NAT can put many legitimate users behind one public IP.
- A Cloudflare Rate Limiting binding may provide approximate per-IP friction, but it cannot be described as a strict global budget.

## Firebase callable protocol consideration

A Worker proxy must preserve Firebase callable protocol, including POST JSON envelope, auth bearer, error response shape, CORS preflight and App Check headers. The Firebase documentation recommends using Firebase client SDKs rather than manually implementing callable wire format where possible.

Do not proxy or rewrite the current callable endpoints until a concrete requirement justifies it and a complete compatibility test exists.

Reference:
- https://firebase.google.com/docs/functions/callable-reference

## Client custom-provider integration

Firebase's Web `CustomProvider.getToken()` must return:
- `token`
- `expireTimeMillis`

The App Check SDK handles caching. The custom provider should request a new token whenever `getToken()` is invoked; it should not build a second independent token cache. Automatic refresh must be explicitly enabled when initializing App Check.

References:
- https://firebase.google.com/docs/app-check/web/custom-provider
- https://firebase.google.com/docs/reference/js/app-check

## Exit criteria before live enablement

1. Verify the sharded global daily budget in the latest current-branch CI and a dedicated non-production deployment.
2. Add abuse telemetry without logging user content, Turnstile responses, poll credentials or App Check tokens.
3. Complete the hosted challenge page and extension messaging contract.
4. Integrate Firebase `CustomProvider` behind an independent local/test flag.
5. Verify refresh, concurrent calls, expired tokens, offline behavior and forced challenge restart.
6. Test against a dedicated non-production Firebase project and Cloudflare site key.
7. Confirm Firestore TTL policies are actually deployed in that test project.
8. Review the abuse/cost controls and failure behavior.
9. Keep the production bootstrap parameter disabled until explicit approval.

## Safeguards

- No Cloudflare Worker, Durable Object or custom domain has been created.
- No Firebase resources, secrets, parameters, TTL policies or Functions have been deployed.
- `APP_CHECK_CHALLENGE_ENABLED` remains default false.
- Existing sync callables retain `enforceAppCheck: true`.
- All four cloud-sync gates remain disabled.
- This remains bot-abuse friction, not cryptographic extension-package attestation.


## Implementation details

- Module: `functions/src/app-check-poc/global-challenge-budget.ts`
- Tests: `functions/tests/global-challenge-budget.test.ts`
- The service selects the shard with Node's cryptographic `randomInt`; the client cannot choose it.
- Firestore transactions enforce each shard's 100-operation ceiling under concurrency.
- UTC day is part of the document ID, so a new daily budget begins at UTC midnight.
- TTL policy on the `expiresAt` field is declared for `appCheckChallengeGlobalBudgets`.
- The global budget is checked by create, complete and token-issuance services only when the separate server parameter is explicitly true. For token issuance, the one-time credential claim happens before charging the budget.
- Both bootstrap switches default to false; this budget does not enable challenge callables.
- A random shard can fill early and reject requests before all other shards are exhausted. That conservative fail-closed trade-off is accepted for the low-volume POC.


## Bootstrap transport note

The bootstrap routes are plain Firebase Functions HTTPS `onRequest` endpoints, not Firebase callables. The extension sends its Firebase ID token in the `Authorization` header; Firebase Admin verifies the token and its revocation status and checks the verified-email claim. The hosted Turnstile iframe never receives that ID token, the session ID or the one-time polling credential. The extension's exact origin is allowlisted by the server CORS policy; CORS is not treated as user authentication.
