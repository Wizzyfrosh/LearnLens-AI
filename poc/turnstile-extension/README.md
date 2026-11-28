# LearnLens Turnstile CustomProvider proof of concept

This directory contains an isolated client-side proof of concept. It is not imported by the production LearnLens side panel and does not change `public/manifest.json` or the extension version.

## Included modules

- `http-client.ts`: calls the three authenticated HTTPS bootstrap endpoints using a Firebase ID token in an Authorization bearer header.
- `iframe-challenge.ts`: opens an extension-owned overlay and embeds the hosted HTTPS challenge page. It validates exact origin, exact iframe source, request ID, message shape and response length.
- `custom-provider.ts`: coordinates create → challenge → server verification → one-time claim. It exposes a token getter to Firebase's CustomProvider and coalesces only concurrent in-flight requests.
- `firebase-integration.ts`: initializes Firebase App Check with `CustomProvider` and automatic refresh disabled.

## Required runtime configuration

The integrator must supply values at runtime:
- `functionsBaseUrl`: HTTPS origin of the Firebase Functions endpoints, with no path/query/credentials. Local HTTP is accepted only for localhost emulator tests.
- `hostedPageUrl`: clean HTTPS URL of the deployed hosted challenge page.
- `siteKey`: public Turnstile site key. It is not secret.
- Existing Firebase Auth instance and the same Firebase App instance used for App Check.

Do not hardcode the Cloudflare secret, Firebase service-account credentials or any private credential in extension code.

## Backend configuration required before a non-production end-to-end test

The Firebase Functions project must be configured with:
- `APP_CHECK_CHALLENGE_APP_ID`: target Firebase Web App ID.
- `APP_CHECK_CHALLENGE_HOSTNAME`: exact hosted-page hostname assessed by Turnstile.
- `APP_CHECK_CHALLENGE_ACTION`: default `learnlens_app_check`, maximum 32 supported characters.
- `APP_CHECK_CHALLENGE_EXTENSION_ORIGIN`: exact `chrome-extension://<id>` origin; empty default denies all browser origins.
- `TURNSTILE_SECRET`: Cloudflare secret stored only as a Firebase Functions secret.
- `APP_CHECK_CHALLENGE_ENABLED`: remains `false` until an explicitly approved test deployment.
- `APP_CHECK_CHALLENGE_GLOBAL_BUDGET_ENABLED`: remains `false` until an explicitly approved test deployment.

The endpoint verifies Firebase ID token revocation and the email-verified claim. The extension origin is a browser/CORS boundary only; it is not treated as proof of extension authenticity or as authentication.

## Browser security configuration still needed

After the final published Chrome extension ID and hosted domain are selected:
1. Add the exact hosted page origin to the extension's Manifest V3 `frame-src` policy.
2. Add only the Firebase Functions hostname to extension host permissions, scoped to the bootstrap functions if Chrome's match-pattern rules permit.
3. Build the hosted page with `VITE_ALLOWED_PARENT_ORIGINS=chrome-extension://<final-id>`.
4. Configure the host's HTTP `Content-Security-Policy: frame-ancestors chrome-extension://<final-id>`, `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff`.
5. Keep `script-src` on the hosted site limited to `'self' https://challenges.cloudflare.com`; no remote executable scripts are added to the extension.
6. Register the hosted page hostname in the Turnstile widget's allowed domains.
7. Configure the server-side Turnstile secret only in the test Firebase project's secret manager.

Do not use temporary unpacked extension IDs for the final allowlist. LearnLens is not yet published and does not have the final Chrome Web Store ID.

## Token lifecycle

The Firebase SDK owns App Check token storage, caching and refresh. The custom provider does not maintain a second token cache. This POC sets `isTokenAutoRefreshEnabled: false` and does not enable background challenge popups. Explicit foreground token acquisition must be tested first.

The bootstrap flow uses direct HTTP fetch, not `httpsCallable`. The Firebase callable SDK itself requests App Check tokens when the App Check instance exists, which would recursively call `CustomProvider.getToken()` during first-token acquisition.

## Verify locally

From the repository root:

```sh
npm run poc:turnstile-extension:verify
```

This type-checks the isolated coordinator and runs its unit tests, including HTTP client, origin/source and single-flight tests.

## Not yet tested against live infrastructure

- No Cloudflare widget or key has been created.
- No hosted page has been deployed.
- No Firebase project parameter, secret or Functions handler has been deployed.
- No real App Check token has been minted by this flow.
- No Chrome extension browser test has exercised the overlay.
- No production manifest/CSP/host permission was changed.
- The production extension remains version `0.1.0`.

This is a code- and CI-verified integration prototype only. It must not be merged into the production extension until browser tests and a non-production end-to-end test pass.
