# Phase 6.6.3A — Hosted Turnstile challenge page

**Status:** Implemented and CI-verified — [run 46131641231](https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/46131641231)  
**Branch:** `phase-6-6-2-turnstile-custom-provider-poc`  
**PR:** #2 (draft; not merged)

## Phase 6.6.2F verification

The sharded global challenge budget is verified by [CI run 46086040038](https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/46086040038):
- Functions TypeScript build passed.
- Firestore TTL configuration validation passed.
- Firestore Security Rules suite: 11 passed.
- Turnstile validator suite: 8 passed.
- Firestore Emulator suites: 28 passed, 0 failed (sessions, authenticated service, rate limiting and global budget).

This is emulator/unit verification. No live Firebase, Cloudflare or production resource was configured.

## Hosted page implementation

The standalone site is under `poc/turnstile-hosted/`. It is intentionally separate from the extension's Manifest V3 execution context because the Turnstile widget runs in a normal HTTPS webpage.

The page:
- Loads the official Turnstile explicit-render API from `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`.
- Accepts initialization only from its direct parent window and an exact `chrome-extension://<id>` origin present in `VITE_ALLOWED_PARENT_ORIGINS`.
- Rejects wildcard, malformed, non-extension, or unconfigured parent origins.
- Enforces a versioned message shape with an exact allowlist of keys.
- Validates request UUID, public site key length, action syntax and cdata syntax.
- Returns the one-time Turnstile response only to the exact validated parent origin.
- Does not include Firebase SDK, authentication, UID/email, challenge session ID, polling credential or App Check token.
- Does not place tokens or challenge bindings in query parameters, browser storage, logs or analytics.
- Supports a request-ID-bound reset/cancel control protocol.

The page has a restrictive CSP meta policy for the Turnstile script, frame and connection origins. A response-header `frame-ancestors` policy is still required from the eventual hosting platform, restricted to the final published extension origin.

## Message contract

### Parent to hosted page

`LEARNLENS_TURNSTILE_INIT` fields:
- `version: 1`
- `requestId`: extension-generated random UUID
- `siteKey`: public Turnstile site key
- `action`: configured challenge action
- `cdata`: server-generated session binding

The hosted page does not receive Firebase credentials, UID, session ID or the one-time polling credential.

The parent can send request-ID-bound `RESET` or `CANCEL` messages with exact protocol keys only.

### Hosted page to parent

- `READY`: generic readiness signal without sensitive values. Parent must still verify source and hosted origin.
- `INIT_ACCEPTED`: initialization confirmation.
- `TOKEN`: single-use Turnstile response, sent to the exact configured extension origin.
- `EXPIRED` or `ERROR`: non-secret status codes.

The extension integration must validate:
1. `event.origin` equals the exact hosted-page origin.
2. `event.source` equals the expected iframe's `contentWindow`.
3. Protocol version and request ID match the active challenge.
4. Token is a non-empty string no longer than 2,048 characters.
5. No token or polling credential is logged, persisted or placed in a URL.

## CI/build commands

- `npm run poc:turnstile-hosted:typecheck`
- `npm run poc:turnstile-hosted:test`
- `npm run poc:turnstile-hosted:build`
- `npm run poc:turnstile-hosted:verify`

The isolated workflow now runs the hosted page verification when its source or supporting package script changes. CI run 46131641231 passed all six hosted-page protocol tests, the Vite build and static bundle verification.

## Deployment blockers

Do not deploy or connect the production extension yet:
- Final Chrome Web Store extension ID is not available because LearnLens is not published.
- No hosted domain has been selected.
- No Cloudflare Turnstile widget/site key/secret exists for this POC.
- No hosting project or HTTPS headers have been configured.
- The extension's own `frame-src` policy must be configured for the exact hosted origin once selected.
- The hosted response header must set `frame-ancestors` to the exact final extension origin; a meta policy is insufficient for this directive.

## Next implementation slice

**Phase 6.6.3B — Extension iframe parent and challenge coordinator — implemented and CI-verified.**

The isolated implementation now:
1. Create the challenge session from the extension's existing authenticated Firebase Auth context.
2. Keep session ID and polling credential in extension memory only.
3. Open an extension-owned challenge page with an iframe to the hosted HTTPS page.
4. Transfer only site key, action, cdata and request ID to the hosted page.
5. Validate the iframe's origin, source window, message schema and request ID.
6. Call the authenticated Firebase HTTPS completion and one-time claim endpoints using direct `fetch` with the Firebase ID token in the Authorization bearer header. Do not use `httpsCallable` inside `CustomProvider.getToken()` because the callable SDK itself attempts App Check token retrieval.
7. Return the minted App Check token to the Firebase CustomProvider.
8. Keep automatic token refresh disabled until manual challenge acquisition, retry and expiry paths have passed tests.

## Safeguards

- No hosted page has been deployed.
- No site key, Turnstile secret, Firebase parameter, or TTL policy has been configured in a live project.
- Both bootstrap and global-budget switches remain disabled by default.
- Existing sync callables retain `enforceAppCheck: true`.
- All four cloud sync gates remain disabled.
- Production extension version remains `0.1.0`.
- PR #2 remains draft and unmerged.


## Bootstrap transport note

The bootstrap routes are plain HTTPS `onRequest` endpoints, not Firebase callables. The extension sends its Firebase ID token in the `Authorization` header; Firebase Admin verifies the token and its revocation status and checks the verified-email claim. The hosted Turnstile iframe never receives that ID token, the session ID or the one-time polling credential. The extension's exact origin is allowlisted by the server CORS policy; CORS is not treated as user authentication.


## Integrated CI verification

[CI run 46133642749 completed successfully](https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/46131641231). It verified the Functions build, TTL configuration, hosted page typecheck/protocol tests/build/static bundle, extension coordinator typecheck and tests, 11 Firestore Rules tests, 8 Turnstile validator tests and 37 Firestore Emulator tests (challenge sessions, authenticated service, rate limits, global budget and HTTP boundary). No live Cloudflare or Firebase deployment or desktop Chrome test occurred.


Final integrated verification is [run 46133642749](https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/46133642749), which also builds and verifies the separate Chrome test lab and executes the Auth/Functions/Firestore HTTP emulator integration. The current branch head after that run contains documentation-only changes.


The final workflow [46133642749](https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/46133642749) also verified Functions installation/build on Node 22 and the Auth/Functions emulator integration on the Node 22 runtime. The only branch changes after its tested executable commit were documentation updates.
