# LearnLens Turnstile CustomProvider Chrome test lab

This is a separate Manifest V3 test extension. It is not the LearnLens product extension and does not modify the product manifest or version 0.1.0.

It reuses the isolated coordinator from `poc/turnstile-extension/src/` and provides a real Chrome extension page where you can:
- enter public Firebase Web App configuration;
- request an optional host permission for the exact Functions origin;
- sign in with a dedicated verified Firebase test account;
- initialize the Firebase CustomProvider;
- manually request one App Check token through the hosted Turnstile challenge.

The Firebase Auth session uses in-memory persistence. The test page does not write Firebase config, email/password, challenge session credentials, Turnstile response tokens or App Check tokens to extension storage. The password field is cleared after each sign-in attempt. Token values are never printed.

## 1. Select the hosted challenge origin

You need an HTTPS origin for the static page under `poc/turnstile-hosted/`. No domain is selected or deployed by this repository.

Choose the origin before building the test extension. The origin is embedded into the test extension Manifest V3 `frame-src` policy so the iframe can load only that hosted origin.

For this example, replace `https://verify.example.com` with your actual hosted origin.

PowerShell:

```powershell
$env:VITE_HOSTED_CHALLENGE_ORIGIN = "https://verify.example.com"
npm run poc:turnstile-lab:verify
```

The lab build outputs to:

```text
poc/turnstile-extension-lab/dist/
```

The default CI-only origin is `https://verify.example.test`; it is not a deployed page and cannot complete a real challenge.

## 2. Load the test extension and record its ID

1. Open `chrome://extensions` in desktop Chrome.
2. Leave the installed **LearnLens AI** product extension installed and enabled.
3. Enable Developer mode.
4. Select **Load unpacked**.
5. Choose `poc/turnstile-extension-lab/dist/`.
6. Open the new **LearnLens Turnstile CustomProvider Lab** extension's Details page.
7. Copy its extension ID from the Details page or its extension URL. It must look like `chrome-extension://<32-character-id>`.
8. Keep using the same output directory when rebuilding the lab so you can keep track of the test ID. Confirm the ID again after reload.

Do not remove or replace the existing LearnLens product extension.

## 3. Build and deploy the hosted page with that exact extension ID

Set the page's parent-origin allowlist to the test extension ID:

PowerShell:

```powershell
$env:VITE_ALLOWED_PARENT_ORIGINS = "chrome-extension://<test-extension-id>"
npm run poc:turnstile-hosted:build
```

Deploy the contents of `poc/turnstile-hosted/dist/` to your selected HTTPS static host. The hosted page must be built after you know the test extension ID.

Configure these HTTP response headers at the host:
- `Content-Security-Policy: frame-ancestors chrome-extension://<test-extension-id>`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`

The page's HTML already supplies a restrictive CSP meta policy for the official Cloudflare Turnstile script, frame and connection endpoints. The `frame-ancestors` directive must be an HTTP response header; it does not work in a meta CSP tag.

Do not add Cloudflare's remote JavaScript to the extension manifest or extension `script-src`.

## 4. Create a dedicated non-production Turnstile widget

In Cloudflare:
1. Create a new Turnstile widget for the hosted page's exact hostname.
2. Allow only that hostname.
3. Use the test widget's public site key in the Chrome lab.
4. Keep the Turnstile secret on the server only.

Do not paste the Turnstile secret into the lab. The secret belongs only in Firebase Functions Secret Manager as `TURNSTILE_SECRET`.

## 5. Create a dedicated non-production Firebase project

In Firebase:
1. Use a separate test project, not the LearnLens production project.
2. Register a Web App and copy its public config: API key, Auth domain, Project ID and App ID.
3. Enable the Email/Password sign-in provider.
4. Create a dedicated test user and verify its email address.
5. Keep any production users and project separate from this lab.

The lab uses the Firebase Auth SDK with in-memory persistence. A page reload signs the test account out.

## 6. Configure the test Functions environment

Deploy the three bootstrap HTTPS endpoints from this POC branch to the dedicated test project:
- `createAppCheckChallengeSession`
- `completeAppCheckChallenge`
- `claimAppCheckChallengeSession`

Set the required server parameters:
- `APP_CHECK_CHALLENGE_APP_ID`: the test Firebase Web App ID.
- `APP_CHECK_CHALLENGE_HOSTNAME`: the exact hosted page hostname, without scheme or path.
- `APP_CHECK_CHALLENGE_EXTENSION_ORIGIN`: `chrome-extension://<test-extension-id>`.
- `APP_CHECK_CHALLENGE_ACTION`: `learnlens_app_check` (or the exact action configured for the test widget).
- `APP_CHECK_CHALLENGE_ENABLED`: enable only in this dedicated test project, after review.
- `APP_CHECK_CHALLENGE_GLOBAL_BUDGET_ENABLED`: leave disabled initially; the budget's behavior is covered by emulator tests.

Set `TURNSTILE_SECRET` as a Firebase Functions secret. Never place it in the Vite build environment, extension manifest, lab page or Git repository.

Deploy the Firestore Rules and TTL/index configuration to the test project. Confirm TTL policies are active in that project; a successful local config validation does not deploy them.

The bootstrap endpoints authenticate the extension using its Firebase ID token in the Authorization bearer header. They verify the token and revocation status and require `email_verified === true`. Exact origin CORS is an additional browser boundary, not the authentication mechanism.

## 7. Run the lab in Chrome

Open the test extension's Options page.

1. Enter the four public Firebase Web App values.
2. Enter the deployed Functions base URL. For example, `https://us-central1-<project-id>.cloudfunctions.net`.
3. Enter the full hosted challenge page URL.
4. Enter the public Turnstile site key.
5. Click **Connect to test Firebase project**. Chrome prompts for optional access to only the exact Functions host you entered.
6. Sign in with the dedicated verified test user.
7. Confirm the page says the CustomProvider is initialized.
8. Click **Run security challenge and request token**.
9. Complete the Turnstile challenge in the iframe.
10. Confirm the lab reports **PASS** without displaying the App Check token.

The Firebase SDK is initialized with automatic token refresh disabled. This test performs an explicit foreground request only.

## 8. What to record when the test fails

Record the desktop Chrome version, test extension ID, hosted page hostname, Firebase test App ID, workflow commit and sanitized error text. Do not copy tokens, passwords, Firebase ID tokens, poll credentials or the Turnstile secret into logs or chat.

Check these likely failure points:
- CORS origin must exactly match the test extension ID.
- Hosted page parent-origin allowlist must contain the exact extension origin.
- Hosted response `frame-ancestors` header must allow that extension origin.
- The test extension was built with the exact hosted page origin in its manifest `frame-src`.
- The Turnstile widget must allow the hosted hostname and use the same action/cdata binding.
- Firebase test Functions parameters and `TURNSTILE_SECRET` must belong to the same test project as the registered Web App.
- The test user must be email-verified.

## Important security boundaries

- This is a separate unpacked test extension with version 0.0.1.
- Its optional HTTPS host permission is requested only for the Functions origin entered by the tester. The manifest allows the browser to request an exact optional host; it does not grant every HTTPS host by default.
- Its CSP permits the exact compiled hosted-page origin in `frame-src`; it does not permit remote executable JavaScript.
- Firebase Auth persistence is in memory only.
- Config, password, ID token, poll credential, Turnstile response token and App Check token are not written to extension storage or printed.
- No resource is deployed by the test-lab build command.
- The product LearnLens extension remains unchanged at version 0.1.0.
- Keep the lab on a dedicated non-production Firebase/Cloudflare environment.

This lab does not yet prove production readiness. Production rollout still requires a final Chrome Web Store extension ID, a security review, pre-auth/perimeter abuse controls and billing alerts, and a fresh end-to-end test with the published extension origin.
