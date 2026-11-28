# Phase 6.6.3B — Extension CustomProvider coordinator

**Status:** Implemented in isolated POC and CI-verified — [run 46131641231 passed](https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/46131641231)  
**Branch:** `phase-6-6-2-turnstile-custom-provider-poc`  
**PR:** #2 (draft; not merged)

## Why the bootstrap transport is direct HTTPS

Firebase's callable-functions SDK prepares auth, messaging and App Check headers for every callable request. When App Check is initialized, its context provider calls `AppCheck.getToken()`. Therefore, calling `httpsCallable` from inside Firebase `CustomProvider.getToken()` can recurse into the same provider before the first token exists.

The three bootstrap endpoints have been changed to HTTPS `onRequest` handlers:
- `createAppCheckChallengeSession`
- `completeAppCheckChallenge`
- `claimAppCheckChallengeSession`

They are authenticated by the Firebase ID token in `Authorization: Bearer <id-token>`. Firebase Admin verifies token signature, expiry and revocation (`verifyIdToken(token, true)`) and requires `email_verified === true`. Exact extension-origin CORS is an additional browser boundary, not authentication. Existing sync callables remain `enforceAppCheck: true`.

## Server HTTP boundary

File: `functions/src/app-check-poc/challenge-http.ts`

- Exact configured `chrome-extension://<id>` origin only.
- Explicit OPTIONS preflight support.
- POST and JSON content type only.
- 8 KB request body cap, checking content length and parsed raw bytes where available.
- Strict exact-key JSON payload validation.
- Bounded bearer ID-token length and syntax.
- Sanitized auth failure details and bounded status mapping.
- Explicit `Cache-Control: no-store`, `Pragma: no-cache`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` on bootstrap responses.
- No caller-supplied UID is accepted.

The production bootstrap parameter remains disabled by default. The extension-origin parameter defaults to empty and therefore denies browser origins until explicitly configured.

## Client HTTP wrapper

File: `poc/turnstile-extension/src/http-client.ts`

- Uses direct `fetch`; no `httpsCallable`.
- Sends ID token in the Authorization header only.
- `credentials: "omit"`, `cache: "no-store"`, `redirect: "error"`, and `referrerPolicy: "no-referrer"`.
- Validates function base URL, response envelope, schema, challenge expiry and App Check token expiry.
- Production accepts an HTTPS Functions origin only. Local development accepts only `localhost`/`127.0.0.1` with the exact emulator path `/<project-id>/<region>`; all other HTTP URLs and malformed paths are rejected.
- Limits response bodies to 32 KB and response token length to 16 KB.
- The hosted iframe never sees the Firebase ID token.

## Hosted challenge presenter

File: `poc/turnstile-extension/src/iframe-challenge.ts`

- Creates a dialog overlay in the foreground extension UI (side panel) and loads the hosted HTTPS page in an iframe. It must not run in the background service worker or offscreen document because those contexts do not have a DOM.
- Validates the exact HTTPS origin and `event.source === iframe.contentWindow`.
- Requires protocol version 1 and the active request UUID.
- Accepts public Turnstile site keys of 16–32 allowed characters; key contents are passed through unchanged.
- Rejects extra fields, invalid token types and tokens over 2 KB.
- Sends only the public site key, action, cdata and request ID to the hosted page.
- The session ID, Firebase UID, ID token and one-time poll credential remain in the extension process.
- Supports cancellation and a bounded 120-second challenge timeout.

## CustomProvider coordinator

File: `poc/turnstile-extension/src/custom-provider.ts`

1. Requires a currently signed-in Firebase Auth user with verified email.
2. Creates a short-lived challenge session over direct HTTPS.
3. Opens the hosted Turnstile page and waits for a one-time response.
4. Sends the response token to the authenticated completion endpoint; Cloudflare Siteverify remains server-side.
5. Claims the verified session with the one-time poll credential.
6. Returns `{ token, expireTimeMillis }` to Firebase's custom provider.
7. Clears local references to the one-time response and poll credential in `finally`.

Concurrent `getToken()` calls are coalesced while a single challenge flow is in flight. This is not a second cache: after a flow completes, the Firebase App Check SDK remains responsible for token caching and refresh.

File: `poc/turnstile-extension/src/firebase-integration.ts`

- Initializes App Check with the custom Turnstile provider.
- Requires Firebase Auth and App Check to share the same Firebase App.
- Leaves `isTokenAutoRefreshEnabled: false`.
- Exposes explicit foreground token acquisition for controlled testing.

## Automated tests being run

- HTTP client: bearer token/header, allowed URLs, exact payloads, response envelope and bounded errors.
- Custom provider: correct operation order, single-flight concurrency, verified-email gate, no second token cache and invalid token rejection.
- iframe presenter: exact host origin/source, request ID, extra fields, cancellation, expiry, token length and URL safety.
- Hosted page: allowlisted extension origin, strict initialization/control message schemas and no Firebase secret/credential leakage.
- Functions: HTTPS boundary, verified ID token, CORS allowlist, request size/body validation, challenge flow and Firestore emulator tests.

Integrated CI run 46131641231 passed: 6 hosted-page protocol tests, 19 extension HTTP/iframe/CustomProvider tests, 11 Firestore Rules tests, 8 Turnstile validator tests and 37 Firestore Emulator tests. Functions TypeScript build, TTL validation, hosted static bundle verification and extension TypeScript checks also passed.

## Remaining blockers before Chrome/browser test

1. LearnLens is not yet published, so its final Chrome Web Store extension ID is unavailable.
2. No production/QA hosted domain has been chosen.
3. No non-production Turnstile widget/site key/secret has been created.
4. No dedicated non-production Firebase project has been configured for the HTTP endpoints.
5. No function parameters/secrets have been set and no Functions deployment has happened.
6. The production extension Manifest V3 CSP/host permissions have not been changed; they must be updated only after the final hosted domain and stable extension ID are known. A later integration must add the narrowly-scoped Functions host permission for `fetch` and ensure the hosted page can be embedded, without adding Cloudflare's remote script to the extension's `script-src`.
7. The hosted domain must return an HTTP `frame-ancestors` header restricted to the exact extension origin.

## Safeguards

- This client integration is isolated under `poc/turnstile-extension/`.
- No production side-panel imports this code.
- Main extension version remains `0.1.0`.
- Existing sync callables retain App Check enforcement.
- All four production sync gates remain disabled.
- Both challenge bootstrap and global budget flags default to false.
- No cloud resource is deployed and no real App Check token has been minted.
- PR #2 remains draft and unmerged.

## Next action after CI — manual and non-production verification

Run the isolated coordinator and hosted page in desktop Chrome using a dedicated non-production Firebase project and Turnstile widget. Validate the stable test extension ID first; repeat origin/CSP checks later using the final published ID. Keep automatic token refresh disabled until manual acquisition, retry, cancellation and expiry behavior pass.


## Manifest and foreground-context integration notes

Chrome's extension documentation states that host permissions enable cross-origin `fetch()` from extension pages and workers. For this flow, the eventual product manifest should include only the exact Firebase Functions host needed by the three bootstrap requests. The iframe host must also be permitted by the extension page's effective frame policy. The hosted Turnstile page executes its own scripts on its HTTPS origin; the extension must not load Cloudflare's script as an extension script or add it to the extension's `script-src`.

The current extension architecture has a foreground side panel, a background service worker and an offscreen document. The custom provider must initialize and run only in the side panel, where the interactive iframe can be rendered. If background work later requires an App Check token, it needs a runtime-message handoff to the foreground side panel; it must not initialize an interactive CustomProvider in the service worker/offscreen context.

Official Chrome references:
- https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions/
- https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy/
- https://developer.chrome.com/docs/extensions/develop/migrate/improve-security/


## Latest CI verification

Run [46131641231](https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/46131641231) passed for the current implementation code: Functions TypeScript build; Firestore TTL configuration; hosted-page suite (6 tests); extension CustomProvider suite (19 tests); Firestore Security Rules (11 tests); Turnstile validator (8 tests); and Firestore Emulator suites (37 tests). That is 81 passing tests across the new suites. The run also built the hosted page and verified that its bundle contains no Firebase credentials or polling credential.

This is still unit/CI and emulator evidence. It is not a live Cloudflare Siteverify test, a real Firebase App Check token mint, an end-to-end Firebase Auth + Functions Emulator browser test, or a desktop Chrome runtime test.


## CI evidence and scope

The run was executed at commit `aba2553abbfc35e49fddfe4235114eff21211422`. The branch changes after that commit were documentation-only; the executable files at the current branch head are covered by this run.

The successful run proves compilation, static bundle validation, message-contract/unit tests, Firestore Rules tests and emulator-backed session/service/rate-limit/global-budget/HTTP boundary behavior. It does not prove a real Turnstile widget, live Firebase Admin App Check token issuance, deployed CORS configuration, deployed TTL policies, extension iframe CSP or real Chrome runtime behavior.

The emulator client accepts local HTTP only for loopback hosts with the exact Functions Emulator base shape `/<project-id>/<region>`; other HTTP hosts and malformed paths are rejected. Production endpoints must use HTTPS.


## Auth + Functions + Firestore Emulator integration

An additional integration harness exercises the real HTTP handlers with a local Firebase Emulator Suite:

- Authentication emulator issues signed-in test ID tokens.
- Functions emulator runs the deployed-shape HTTPS onRequest handlers.
- Firestore emulator stores the generated challenge session.
- Admin SDK verifies the test ID tokens with revocation checking enabled.

The test verifies:
1. Missing bearer token is rejected.
2. An unapproved Origin is rejected and not reflected by CORS.
3. A signed-in user whose email is not verified is rejected.
4. A verified user can create a session through the actual HTTP endpoint.
5. The session is persisted under that user's UID.
6. Firestore stores only the polling-credential hash, never the raw credential.
7. Another verified user cannot complete a session they do not own.
8. Empty/malformed Turnstile responses are rejected before Siteverify.
9. A pending challenge cannot be claimed for an App Check token.
10. OPTIONS preflight returns exact-origin CORS and Cache-Control: no-store.

This integration does not simulate a successful Turnstile verification or App Check token mint. It deliberately stops before the Cloudflare Siteverify request and Firebase Admin createToken call. The previous unit tests cover those services with injected fake dependencies. No live service is contacted.

### Run locally (Windows PowerShell)

Create the project-scoped Functions emulator configuration:

~~~powershell
@'
APP_CHECK_CHALLENGE_APP_ID=1:123456789:web:learnlens-emulator
APP_CHECK_CHALLENGE_HOSTNAME=verify.example.test
APP_CHECK_CHALLENGE_ACTION=learnlens_app_check
APP_CHECK_CHALLENGE_EXTENSION_ORIGIN=chrome-extension://abcdefghijklmnopabcdefghijklmnop
APP_CHECK_CHALLENGE_ENABLED=true
APP_CHECK_CHALLENGE_GLOBAL_BUDGET_ENABLED=false
'@ | Set-Content functions/.env.demo-learnlens-emulator

@'
TURNSTILE_SECRET=local-emulator-only-not-a-real-secret
'@ | Set-Content functions/.secret.local

npm run test:challenge-http-emulator
~~~

Both files are local-only and ignored by Git. The secret value above is a dummy used only to satisfy the emulator secret binding; it is not a valid Cloudflare credential. The CLI starts only Auth, Functions and Firestore emulators and stops them when the test exits.

The integration script creates temporary Auth Emulator accounts and deletes them in its cleanup. Challenge documents are stored only in the disposable Firestore Emulator instance.

### CI

The same script runs in GitHub Actions using dynamically-created .env.demo-learnlens-emulator and .secret.local files. The workflow removes these files when the job finishes. The emulator project ID is demo-learnlens-emulator and cannot access a live Firebase project.
