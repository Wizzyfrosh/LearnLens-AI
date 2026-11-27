# Phase 6.6.1 — Chrome extension attestation architecture decision

**Date:** 2026-11-27  
**Status:** Decision recorded; implementation not authorized/deployed  
**Scope:** LearnLens consumer Chrome Manifest V3 extension and Firebase sync protection  
**Related:** [Phase 6.6 POC](./PHASE6_6_APPCHECK_POC.md)

## Decision summary

Do not claim or design around cryptographic proof that an ordinary consumer Chrome request came from the genuine installed LearnLens extension. The public Chrome Extensions APIs reviewed do not document a general-purpose remote installation-attestation API for ordinary consumer extensions.

A Firebase custom App Check provider remains technically available, but its issuance proof must be described accurately. A hosted human/bot challenge can provide friction and risk signals; it does not attest the installed extension package.

For a consumer rollout, evaluate a hosted challenge plus custom App Check token issuance as an **abuse-control layer only**. Cloudflare Turnstile Free is the preferred first candidate for a cost-conscious isolated proof of concept, subject to verifying control of a dedicated HTTPS hostname and validating the complete flow. Do not implement production code or enable sync gates in this decision step.

If the product requirement is strict “only the official installed extension can sync,” the current consumer Chrome platform does not have a demonstrated solution. Do not represent this design as meeting that requirement.

## Evidence and platform constraints

### 1. Chrome extension identity is not remote attestation

- Chrome's **runtime.id** API returns the extension/app ID. It is an identifier, not a signed server-verifiable statement about the installed package.
- Chrome documents Chrome Web Store distribution as publishing signed extensions, and enterprise self-hosting for managed environments. Those distribution guarantees do not themselves provide a general remote attestation API to a LearnLens backend.
- The documented **chrome.enterprise.deviceAttributes** API is limited to ChromeOS and extensions force-installed through enterprise policy. Related enterprise APIs also require managed policy installation. This does not fit LearnLens's normal consumer audience.
- **chrome.identity.getAuthToken()** obtains an OAuth access token using the OAuth client ID and scopes declared in the extension manifest. It proves an OAuth authorization context, not that a genuine LearnLens package is installed.

Therefore, do not treat any of these as proof of installation:
- caller-supplied extension ID or Firebase App ID;
- Origin, Referer, user-agent, or other client-controlled request headers;
- a shared secret embedded in the extension bundle;
- an extension version string or client-reported package hash;
- a successful hosted CAPTCHA by itself.

### 2. Built-in reCAPTCHA Enterprise provider is not a viable default for the extension page

The dedicated Google Cloud key-creation attempt was cancelled when the Web key required a domain allowlist. No key was created and no verification setting was disabled.

A separately hosted HTTPS challenge page is a different architecture from loading the built-in reCAPTCHA provider inside the chrome-extension page. The hosted page can use its own registered hostname and normal web CSP, while the extension retains its strict Manifest V3 CSP. This removes the need to load Google's remote executable script inside the extension page, but still does not prove extension identity.

### 3. Firebase custom App Check is a token mechanism, not an attestation mechanism

Firebase's custom Web provider calls getToken() to send its proof to a token-acquisition service. The server independently assesses that proof and, only when satisfied, uses the Admin SDK appCheck().createToken(appId, options) to issue an App Check token.

Important constraints:
- The server must decide what evidence is meaningful; Firebase does not supply the missing Chrome package attestation.
- The App Check token is issued for a Firebase App ID, not bound to an individual Firebase Auth UID. UID binding in a challenge session does not make the resulting App Check bearer token user-bound.
- App Check tokens must never replace Firebase Authentication or per-user authorization.
- The documented custom-provider TTL range is 30 minutes to 7 days. The minimum supported TTL is 30 minutes; a five-minute App Check token is not available through this API.
- An App Check token can be copied and replayed until expiry if stolen. Keep it out of logs, URLs, analytics and diagnostics.

## Recommended candidate for an isolated abuse-control POC

### Candidate: hosted Cloudflare Turnstile + Firebase custom App Check provider

Turnstile Free is a reasonable first candidate because Cloudflare documents a Free plan, says Turnstile can be used independently of other Cloudflare services, and requires a configured hostname. A dedicated LearnLens HTTPS challenge hostname must be controlled by the project before creating a widget.

Turnstile's server validation remains mandatory:
- send the client token to the backend;
- validate it using Cloudflare Siteverify with the secret kept server-side;
- check success, exact expected hostname, exact expected action, and the challenge/session binding;
- reject expired, invalid, mismatched or previously consumed tokens.

Cloudflare documents Turnstile response tokens as valid for 300 seconds and intended for single use. Siteverify replay detection has a convergence window, so the LearnLens backend must also enforce its own atomic one-time session consumption. Do not rely on Turnstile alone for the application's replay state.

### Proposed flow — not implemented

1. A signed-in user explicitly starts a cloud-sync action that requires a challenge. No background worker or silent token refresh may open a tab or launch an unexpected challenge.
2. The extension sends its Firebase ID token to a dedicated HTTPS token-session endpoint. The endpoint verifies the ID token with Firebase Admin and derives the UID from the verified token. It does not accept a body-supplied UID.
3. The server creates a random challenge session bound to the verified UID, the fixed LearnLens Firebase App ID, the exact action, creation time and short expiry (for example, five minutes). Store only a hash of a separate high-entropy poll credential. Do not put Firebase ID tokens, poll credentials or App Check tokens in URLs.
4. The extension opens a separately hosted HTTPS challenge page on a hostname configured in the Turnstile widget. The page receives only a non-secret session identifier and runs the Turnstile widget. The extension itself does not load Turnstile's remote script.
5. The challenge page submits the Turnstile response to the backend. The backend calls Siteverify and validates success, exact hostname, exact action, freshness and session state. It never accepts a client-supplied success flag or risk score.
6. The server marks the session challenge as passed using a transaction/atomic state transition. Repeated completion attempts, expired sessions and action/UID mismatches are rejected.
7. The extension polls with its separate poll credential and a newly verified Firebase Auth identity. The backend verifies both, atomically consumes the passed session, and creates one App Check token for the fixed LearnLens Firebase App ID.
8. The extension custom provider returns the token and server-reported expiry to the Firebase SDK. Use the shortest documented App Check TTL (30 minutes) for the POC; measure latency and challenge frequency before deciding whether the UX is acceptable.
9. All sync callables continue to enforce App Check and independently require Firebase Auth, derive the UID from callable Auth context, verify server-side consent, enforce ownership, validate payload shape/size, apply quotas/rate limits, and write audit events.

### Token-mint endpoint bootstrap boundary

The token-mint/session endpoints cannot require an App Check token that the user is trying to obtain. They must therefore be a narrowly scoped bootstrap exception to App Check enforcement, not anonymous unrestricted endpoints.

Before any production consideration, they must require:
- verified Firebase Auth on every endpoint;
- server-derived UID and fixed server-side Firebase App ID;
- per-UID, per-IP/network and global rate limits;
- limits on active challenge sessions and polling attempts;
- short session expiry and atomic one-time state transitions;
- strict request size/schema validation and HTTPS;
- server-only Turnstile secret and Admin SDK credentials;
- alerting, audit logs without secrets/tokens, and a kill switch.

The challenge only gates token issuance. Because the App Check token itself is not UID-bound, each protected sync call must still authenticate and authorize the user independently.

### Refresh and user experience

The Firebase SDK may need a token when no user gesture is active. A custom provider must not silently launch a browser tab from getToken(), a service worker, a timer or background token refresh.

The POC must test an explicit flow:
- user clicks Sync or Verify to continue;
- UI indicates that verification is required;
- extension opens the challenge page;
- user completes the challenge;
- extension returns to the original action;
- custom provider obtains the App Check token and retries the original action once.

Set App Check auto-refresh behavior deliberately. A failed challenge must leave sync unavailable and show a recoverable error; it must never fall back to an App Check-disabled sync callable.

## Alternatives rejected or limited

| Option | Decision | Reason |
|---|---|---|
| Built-in reCAPTCHA Enterprise directly in extension page | Not selected | Web domain allowlist and strict extension CSP are not documented as compatible with chrome-extension origins |
| Trust extension ID / Origin / bundled secret | Rejected | Public or client-controlled; not proof |
| Chrome Identity OAuth token as extension attestation | Rejected | OAuth identity/authorization is not package integrity proof |
| Chrome Enterprise device attributes | Not applicable | Restricted to managed enterprise deployment and ChromeOS for device attributes |
| Hosted Turnstile + custom provider | Candidate only | Abuse friction and server-verified challenge; not extension attestation |
| Remove App Check enforcement from existing sync callables | Rejected | Weakens the explicit protection boundary and does not solve the provider problem |

## Exit criteria before implementation

1. Confirm the hosted challenge hostname is controlled by LearnLens and is accepted by the Turnstile Free widget configuration.
2. Build a separate hosted-challenge prototype; do not add the remote widget script to extension pages.
3. Demonstrate Siteverify success, hostname/action checking, short session expiry and atomic replay rejection in a non-production environment.
4. Demonstrate that the challenge session is bound to the Firebase Auth UID and fixed App ID, while recognizing that the final App Check token is not user-bound.
5. Test extension tab hand-off, return-to-sync behavior, browser restart, cancellation, failed challenges, network failures, and token refresh after the 30-minute minimum TTL.
6. Load-test and set per-user, per-IP/network and global issuance caps, alerting and a kill switch.
7. Review the hosted flow and permissions against Chrome Web Store policies.
8. Keep the final published extension ID test as a separate release check; a POC extension ID cannot approve production.

## Current non-negotiable safeguards

- Keep SYNC_SERVER_CONSENT_READS_ENABLED, SYNC_SERVER_CONSENT_WRITES_ENABLED, SYNC_CLOUD_PULL_ENABLED, and SYNC_CLOUD_WRITES_ENABLED false.
- Keep existing sync callables' enforceAppCheck: true.
- Do not deploy a token-mint endpoint, create production secrets, register a production provider, or perform live sync.
- Do not merge the draft Phase 6.6 POC PR based only on this architecture review.
- Keep product extension version 0.1.0.
- Do not describe custom App Check plus Turnstile as cryptographic extension attestation.

## References

- Firebase [custom App Check provider for Web](https://firebase.google.com/docs/app-check/web/custom-provider)
- Firebase [custom provider server implementation and token creation](https://firebase.google.com/docs/app-check/custom-provider)
- Firebase Admin SDK [AppCheck.createToken](https://firebase.google.com/docs/reference/admin/node/firebase-admin.app-check.appcheck)
- Chrome [runtime API](https://developer.chrome.com/docs/extensions/reference/api/runtime)
- Chrome [extension distribution](https://developer.chrome.com/docs/extensions/how-to/distribute)
- Chrome [extension API reference — enterprise APIs](https://developer.chrome.com/docs/extensions/reference/api)
- Chrome [Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
- Cloudflare [Turnstile plans](https://developers.cloudflare.com/turnstile/plans/)
- Cloudflare [Turnstile hostname management](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/)
- Cloudflare [Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
