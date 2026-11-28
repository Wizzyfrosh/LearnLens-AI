# Phase 6.6.2F — Global abuse and cost-control architecture decision

**Status:** Sharded global daily budget implemented; CI verification pending  
**Branch:** `phase-6-6-2-turnstile-custom-provider-poc`  
**PR:** #2 (draft; not merged)

## Decision

Do not add a Cloudflare Worker or a single global Durable Object to the current Firebase callable bootstrap path yet.

Keep Firebase callable functions as the only challenge/token endpoints for the current POC. Retain the transactional per-UID limits already implemented. Add a bounded, sharded Firestore global budget before any live enablement. The first implementation is now in the isolated POC branch.

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

## Proposed next control: sharded global daily budget in Firestore

Keep the existing per-UID per-scope 60-second limit. Add a second independent global daily budget before expensive operations:
- Before Turnstile Siteverify calls.
- Before App Check token minting.
- Optionally before session creation if abuse/cost telemetry shows session creation is material.

Use UTC-day-scoped shard documents and a server-generated cryptographically random shard selection. Each shard has a transactional counter and a fixed hard ceiling. The sum of all shard ceilings is the maximum accepted daily operations, so the budget cannot be exceeded even though requests are distributed. This can reject early if a shard fills before others; that is an intentional availability trade-off for a hard upper bound.

The implementation uses 64 server-randomized shards with a hard ceiling of 100 operations per shard per UTC day (maximum 6,400 operations/day). It uses flat documents in the `appCheckChallengeGlobalBudgets` collection so Firestore TTL can clean them. The feature is controlled by `APP_CHECK_CHALLENGE_GLOBAL_BUDGET_ENABLED`, default false. This is a prototype ceiling and must be reviewed against expected traffic before any live enablement.

Each request should consume the global budget before calling Cloudflare or Firebase token minting. A failed upstream request still consumes budget because the upstream work/cost may already have occurred. No automatic refund is allowed unless an operation is provably not attempted.

The global budget is a coarse service-wide circuit breaker, not a user quota. Keep per-UID throttling independently. Each request consumes one unit before Siteverify or token minting; failed upstream attempts are not refunded. Session creation also consumes a unit when the global budget switch is enabled.

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

1. Implement and test a sharded global daily budget.
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
- The global budget is checked by create, complete and token-issuance services only when the separate server parameter is explicitly true.
- Both bootstrap switches default to false; this budget does not enable challenge callables.
- A random shard can fill early and reject requests before all other shards are exhausted. That conservative fail-closed trade-off is accepted for the low-volume POC.
