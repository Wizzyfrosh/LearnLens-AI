# Phase 6.6 — Chrome extension App Check proof-of-concept

**Status:** isolated built-in-provider harness implemented; manual browser test and production-provider decision remain open.  
**Product extension version:** 0.1.0 (unchanged).  
**No live Firebase changes or requests were made while preparing this POC.**

## 1. Why the POC is isolated

LearnLens is not yet published to the Chrome Web Store, so there is no final, stable store extension ID to validate. The POC therefore uses a separate Manifest V3 extension with its own ID. It must not replace or modify the installed LearnLens extension.

A result from an unpacked POC ID is diagnostic only. The final production compatibility check must use the published LearnLens ID.

## 2. Finding A — built-in reCAPTCHA Enterprise provider

Firebase documents reCAPTCHA Enterprise as the built-in provider for Web apps. The documented setup uses a Web-type key with allowed web domains and registers a Firebase app with that provider. The current Firebase guide does not explicitly document `chrome-extension://<id>` as an accepted reCAPTCHA key domain or as a supported App Check Web runtime.

There is an important distinction: Firebase Authentication documents adding a `chrome-extension://<id>` URI to Authentication's authorized-domain list for certain OAuth flows. That does **not** establish that a reCAPTCHA Enterprise Web key accepts an extension origin. Authentication authorized domains and reCAPTCHA Enterprise key domain restrictions are separate controls.

Chrome Manifest V3 extension pages run at `chrome-extension://<id>`. Their minimum extension-page CSP does not permit remote JavaScript sources in `script-src`. Adding a host permission or adding a remote domain to `connect-src` does not permit loading remote executable JavaScript. The reCAPTCHA Enterprise SDK may therefore encounter a CSP block if it needs to load Google's remote script directly in the extension page.

### Isolated test harness

Source: `poc/app-check-extension/`

- Uses the Firebase SDK installed by the repository.
- Initializes `ReCaptchaEnterpriseProvider` from an extension options page.
- Requests one token only after a manual button click.
- Captures browser CSP violations and reports whether a token was returned.
- Does not print or persist the token.
- Uses a strict extension-page CSP; no remote script exceptions.
- Uses a separate output folder and manifest; the production manifest and Firebase service are untouched.

Build and verify:

```bash
npm run poc:app-check:verify
```

Output directory:

```text
poc/app-check-extension/dist/
```

Manual browser steps and result interpretation are in `poc/app-check-extension/README.md`.

**Expected test limitations:** a dedicated non-production Firebase Web App/App Check registration and a reCAPTCHA Enterprise Web key are prerequisites. Do not change the existing LearnLens App Check registration. Google/Firebase do not document the extension origin as a supported reCAPTCHA domain, so a configuration/domain failure is a valid negative result. Even a successful result on the temporary ID must be repeated using the final published ID.

## 3. Finding B — hosted challenge + Firebase custom App Check provider

Firebase supports a custom provider for platforms that need a custom authenticity assessment. Its Web SDK provider calls a custom `getToken()` implementation; the implementation exchanges proof with a token-acquisition service. A trusted server can mint a Firebase App Check token with the Admin SDK's `appCheck().createToken(appId, options)`.

This provides a supported token-minting path, but **does not make a weak challenge into strong extension attestation**. A hosted score-based reCAPTCHA/Turnstile challenge proves only that a browser session passed the challenge assessment at a particular time. It does not cryptographically prove that the request originated from the authentic installed extension. A copied challenge URL, automation, or a separately written client could still request a challenge.

### Candidate flow to evaluate (not deployed)

1. The extension starts the flow only after an authenticated, user-initiated sync action. The backend verifies the Firebase ID token and derives the UID from that token.
2. The backend creates a random, single-use challenge session bound server-side to the UID, expected Firebase App ID, expected action, and a short expiry. Store only hashes of one-time client poll credentials; never put Firebase ID tokens or App Check tokens in URLs.
3. A separately hosted HTTPS challenge page executes a score-based reCAPTCHA Enterprise action under its own allow-listed hostname. The extension itself does not load Google's remote script.
4. The backend independently creates/retrieves the reCAPTCHA Enterprise assessment and validates all of: token validity, exact hostname, exact action, acceptable risk score, timestamp/freshness, challenge-session binding, and one-time consumption. The client cannot submit its own score or claim that verification passed.
5. After a successful, atomic one-time consume, the backend mints an App Check token for the fixed LearnLens Firebase App ID using the Firebase Admin SDK.
6. The extension's custom provider returns that token and the server-reported expiry to the Firebase SDK. Every protected callable still independently verifies Auth, derives UID from callable context, checks consent and ownership, validates payloads, rate-limits, and audits sensitive operations.

The challenge session should expire quickly (for example, a few minutes) and be consumed atomically. The Firebase App Check token lifetime is a separate setting: the documented custom-provider TTL range is **30 minutes to 7 days**, so a sub-30-minute App Check token cannot be configured through the documented Admin SDK API. The shortest TTL increases reassessment frequency, latency, and assessment consumption.

### Open design risks

- **No proof of extension identity:** a challenge-backed token is abuse friction, not cryptographic proof of a genuine installed extension.
- **Replay:** a challenge response must be single-use and server-bound to its original UID/session/action. Reject reused, expired, mismatched, or already-consumed sessions.
- **Token theft/reuse:** App Check tokens are bearer credentials until expiry. Keep them out of logs, URLs, analytics, and client-visible diagnostic output. Use HTTPS and avoid broad sharing.
- **Interactive refresh:** Firebase may request a token when no user gesture is active. A custom provider that needs a visible challenge must define a safe, user-friendly refresh path; it must not unexpectedly open tabs or silently fail during background refresh. This requires a separate UX spike.
- **Public app identifiers:** Firebase App ID, extension ID, API key, request Origin, and client-supplied UID are not secrets and cannot be accepted as independent proof.
- **Abuse and cost:** enforce per-account, IP/network, challenge-session and global rate limits; cap concurrent pending sessions; meter Enterprise assessments; add alerting and circuit breakers. Do not deploy an unlimited token-mint endpoint.
- **Provider availability:** token-minting requires the Admin SDK service identity to have the required App Check token-creation permissions. Keep those credentials server-side.
- **Store policy/CSP:** do not load remotely hosted executable code in extension pages. Any hosted page/iframe or external navigation approach needs a separate Chrome Web Store policy review and browser test.

**Assessment:** the custom-provider mechanism is technically supported by Firebase, but the hosted challenge does not solve the missing extension-attestation primitive. It may be appropriate as a measured abuse-control layer only after the interactive refresh design, verification logic, cost controls, and Chrome Web Store review are proven. It must not be marketed internally as proof of genuine extension identity.

## 4. Security controls that remain mandatory

App Check is an additional request-abuse layer, not an authorization system. Regardless of provider:

- Require verified Firebase Auth for every sync callable.
- Derive the account UID from trusted callable Auth context; never trust a request-body UID.
- Enforce explicit server-side consent for each sync category.
- Enforce owner-scoped authorization, strict schema/size validation, quotas, rate limits, and audit events.
- Keep Firestore Rules deny-by-default.
- Never put a service-account secret or shared signing secret in the extension bundle.
- Never accept a caller-supplied extension ID or unverified Origin header as attestation.
- Never bypass `enforceAppCheck: true` to compensate for an incompatible client provider.

## 5. Current decision and gates

- No production provider selected.
- No Firebase App Check app registration, reCAPTCHA key, Secret Manager value, endpoint, Cloud Function, or custom token has been created.
- No Firebase deployment, live token request, live sync request, or two-device test has occurred.
- The POC harness is not included in the production LearnLens extension package.
- The final extension is not yet published; final-ID verification remains mandatory.
- All four sync gates remain false:
  - `SYNC_SERVER_CONSENT_READS_ENABLED`
  - `SYNC_SERVER_CONSENT_WRITES_ENABLED`
  - `SYNC_CLOUD_PULL_ENABLED`
  - `SYNC_CLOUD_WRITES_ENABLED`

## 6. Official references

- Firebase [reCAPTCHA Enterprise provider for Web](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)
- Firebase [custom App Check provider for Web](https://firebase.google.com/docs/app-check/web/custom-provider)
- Firebase [custom provider implementation and token minting](https://firebase.google.com/docs/app-check/custom-provider)
- Firebase Admin SDK [AppCheck.createToken reference](https://firebase.google.com/docs/reference/admin/node/firebase-admin.app-check.appcheck)
- Firebase [Authenticate with Firebase in a Chrome extension](https://firebase.google.com/docs/auth/web/chrome-extension)
- Chrome [Improve extension security for Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)
- Chrome [Manifest content security policy](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- Chrome Web Store [troubleshooting remotely hosted code violations](https://developer.chrome.com/docs/webstore/troubleshooting)
