# LearnLens Turnstile CustomProvider Chrome test lab

This is a separate Manifest V3 test extension. It is not the LearnLens product extension and does not modify the product manifest or version 0.1.0.

It reuses the isolated coordinator from `poc/turnstile-extension/src/` and provides a real Chrome extension page where you can:
- enter public Firebase Web App configuration;
- request an optional host permission for the exact Functions origin;
- sign in with a dedicated verified Firebase test account;
- initialize the Firebase CustomProvider;
- manually request one App Check token through the hosted Turnstile challenge.

The Firebase Auth session uses in-memory persistence. The lab does not manually persist Firebase config, passwords, challenge credentials or Turnstile response tokens, and it never prints token values. Important distinction: Firebase's App Check SDK manages its own token cache in IndexedDB after a token is issued. The lab does not override or disable that SDK-managed persistence. Token values are never displayed or written to the test log.

## 1. Select the hosted challenge origin

You need an HTTPS origin for the static page under `poc/turnstile-hosted/`. No domain is selected or deployed by this repository.

Choose the origin before building the test extension. The origin is embedded into the test extension Manifest V3 `frame-src` policy so the iframe can load only that hosted origin.

For this example, replace `https://verify.example.com` with your actual hosted origin.

PowerShell:

```powershell
$env:VITE_HOSTED_CHALLENGE_ORIGIN = "https://verify.example.com"
$env:VITE_FUNCTIONS_ORIGIN = "https://us-central1-<project-id>.cloudfunctions.net"
npm run poc:turnstile-lab:verify
```

The lab embeds both origins in its Manifest V3 policy. Its iframe may load only the hosted page origin; network access may reach only the fixed Firebase Auth hosts and the compiled Functions origin. The Connect action requests optional permission for that exact Functions host. It does not grant or request arbitrary HTTPS origins.

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

The lab uses the Firebase Auth SDK with in-memory persistence. A page reload signs the test account out. The manual Chrome lab requires a deployed HTTPS Functions endpoint; it does not connect Firebase Auth Emulator, so do not point this UI at a local Functions Emulator URL.

## 6. Configure and deploy the test Functions environment

Perform this only in the dedicated test Firebase project. Do not point these commands at the main LearnLens project.

From the repository root, select the test project:

```powershell
firebase use <TEST_PROJECT_ID>
```

Create an untracked file at `functions/.env.<TEST_PROJECT_ID>` containing the test-only parameter values:

```dotenv
APP_CHECK_CHALLENGE_APP_ID=1:<TEST_NUMERIC_PROJECT_ID>:web:<TEST_WEB_APP_SUFFIX>
APP_CHECK_CHALLENGE_HOSTNAME=verify.example.com
APP_CHECK_CHALLENGE_EXTENSION_ORIGIN=chrome-extension://<TEST_EXTENSION_ID>
APP_CHECK_CHALLENGE_ACTION=learnlens_app_check
APP_CHECK_CHALLENGE_ENABLED=true
APP_CHECK_CHALLENGE_GLOBAL_BUDGET_ENABLED=false
```

Replace every placeholder. The hostname is only the hosted page hostname—no scheme, port or path. The extension origin must exactly match the ID shown by `chrome://extensions`. Protect this file and do not commit it. Firebase's parameterized configuration loader reads `.env.<project-id>` from the `functions/` directory; otherwise the CLI prompts for parameter values during deployment. <https://firebase.google.com/docs/functions/config-env>

Set the Cloudflare secret through Firebase Secret Manager:

```powershell
firebase functions:secrets:set TURNSTILE_SECRET --project <TEST_PROJECT_ID>
```

Paste only the Turnstile widget's **secret key** into the CLI prompt. Do not put it in the lab, Vite environment, manifest, source code or Git repository.

Deploy Firestore Rules and index/TTL configuration to the test project:

```powershell
firebase deploy --only firestore --project <TEST_PROJECT_ID>
```

Then deploy only the three bootstrap HTTPS functions—not every export in `functions/src/index.ts`:

```powershell
firebase deploy --only functions:createAppCheckChallengeSession,functions:completeAppCheckChallenge,functions:claimAppCheckChallengeSession --project <TEST_PROJECT_ID>
```

Firebase CLI supports deploying individual named functions with the comma-separated `--only functions:<name>` syntax. <https://firebase.google.com/docs/functions/manage-functions>

After deployment, confirm in Firebase Console that:
- all three HTTPS functions are deployed in the intended region;
- `APP_CHECK_CHALLENGE_ENABLED` is true only in this dedicated test project;
- `APP_CHECK_CHALLENGE_GLOBAL_BUDGET_ENABLED` remains false for the first manual test;
- `TURNSTILE_SECRET` is bound to the completion function;
- Firestore TTL policies for challenge sessions, per-user rate limits and global budget are active.

A successful CI TTL configuration check does not deploy TTL policies to Firebase. The emulator integration in CI uses fake local secrets and does not contact Cloudflare.

The bootstrap endpoints authenticate the extension using its Firebase ID token in the Authorization bearer header. Firebase Admin verifies the token and revocation status and requires `email_verified === true`. Exact origin CORS is an additional browser boundary, not the authentication mechanism.

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
- The lab does not manually store or print passwords, ID tokens, poll credentials, Turnstile response tokens or App Check token values. Firebase's App Check SDK separately manages the token cache/persistence as part of its normal operation.
- No resource is deployed by the test-lab build command.
- The product LearnLens extension remains unchanged at version 0.1.0.
- Keep the lab on a dedicated non-production Firebase/Cloudflare environment.

This lab does not yet prove production readiness. Production rollout still requires a final Chrome Web Store extension ID, a security review, pre-auth/perimeter abuse controls and billing alerts, and a fresh end-to-end test with the published extension origin.
