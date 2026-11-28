# Phase 6.6.3C — Isolated Chrome CustomProvider test lab

**Status:** Implemented and CI-verified — [run 46133642749 passed](https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/46133642749)  
**Branch:** `phase-6-6-2-turnstile-custom-provider-poc`  
**PR:** #2 (draft; not merged)

## Purpose

A separate Manifest V3 extension now provides a real Chrome UI for a manual, non-production test of the custom Firebase App Check provider. It does not modify the LearnLens product extension, its manifest or version 0.1.0.

Package source:
- `poc/turnstile-extension-lab/`
- Shared coordinator: `poc/turnstile-extension/src/`
- Hosted page: `poc/turnstile-hosted/`

The lab allows a tester to enter public Firebase Web App configuration, specify exact hosted-page and Functions HTTPS origins, connect to a dedicated Firebase test project, sign in with an email-verified test account and manually request one App Check token through the hosted Turnstile flow.

## Lab behavior

- Firebase Auth uses `inMemoryPersistence`; the password field is cleared after sign-in.
- It requests optional host access only for the exact Functions HTTPS origin compiled into the test build.
- Its Manifest V3 `frame-src` allows only the exact hosted challenge origin compiled into the test build.
- Its `connect-src` allows only Firebase Auth endpoints and the exact compiled Functions origin. No generic `https:` scheme or wildcard Functions domain is allowed.
- It uses the existing isolated CustomProvider coordinator and keeps automatic token refresh disabled.
- It explicitly calls App Check `getToken` from the button; token values are not displayed or logged.
- The lab never manually persists the Firebase password, Firebase ID token, challenge session ID, poll credential or Turnstile response token.
- Firebase App Check SDK manages its own token cache/persistence after token issuance. This is separate from the Auth in-memory persistence and is not overridden by the lab.
- The test extension uses version 0.0.1 and a separate unpacked extension ID.

## Exact build configuration

PowerShell, from the repository root:

```powershell
$env:VITE_HOSTED_CHALLENGE_ORIGIN = "https://verify.example.com"
$env:VITE_FUNCTIONS_ORIGIN = "https://us-central1-<TEST_PROJECT_ID>.cloudfunctions.net"
npm run poc:turnstile-lab:verify
```

Both origins are embedded into the test extension manifest and client. Changing either origin requires rebuilding the test lab.

The manifest generator emits:
- required Firebase Auth host permissions only for `identitytoolkit.googleapis.com` and `securetoken.googleapis.com`;
- one optional Functions host permission for the exact compiled Functions origin;
- `connect-src` for the two Firebase Auth hosts and exact Functions origin;
- `frame-src` for the exact hosted challenge origin;
- no remote JavaScript source in extension `script-src`.

The verifier checks those constraints and asserts the lab source's 16–32 character Turnstile site-key limit and exact Functions-origin match.

## Manual Chrome procedure — not yet run by the user

1. Build the lab with the actual test hosted page origin and Firebase Functions origin using the PowerShell commands above.
2. Open `chrome://extensions` in desktop Chrome.
3. Leave the installed LearnLens AI product extension installed and enabled.
4. Enable Developer mode and choose **Load unpacked**.
5. Select `poc/turnstile-extension-lab/dist/`.
6. Open the test extension's Details page and copy its extension ID.
7. Build the hosted challenge page with the exact test extension origin:

   ```powershell
   $env:VITE_ALLOWED_PARENT_ORIGINS = "chrome-extension://<TEST_LAB_EXTENSION_ID>"
   npm run poc:turnstile-hosted:build
   ```

8. Deploy the contents of `poc/turnstile-hosted/dist/` to the selected HTTPS host.
9. Configure its HTTP response headers:
   - `Content-Security-Policy: frame-ancestors chrome-extension://<TEST_LAB_EXTENSION_ID>`
   - `Referrer-Policy: no-referrer`
   - `X-Content-Type-Options: nosniff`
10. Create a dedicated Cloudflare Turnstile widget allowing only the hosted page hostname. Put the public site key into the test lab; keep the secret only in Firebase Functions Secret Manager.
11. Create a dedicated non-production Firebase project, register a Web App, enable Email/Password, create a dedicated test user and verify that user's email.
12. Configure the test Functions project and deploy only the three bootstrap HTTPS endpoints. The full command sequence is in `poc/turnstile-extension-lab/README.md`.
13. Open the test lab Options page, enter the public Firebase Web App values, exact Functions URL, hosted challenge URL and public site key, then click **Connect**.
14. Sign in with the verified test account.
15. Click **Run security challenge and request token**, complete the Turnstile iframe challenge and confirm the lab reports success without displaying the token.

The manual procedure has not been run in desktop Chrome yet. No test Firebase project, Cloudflare widget, hosted domain or secret has been created in this work.

## CI verification

[Run 46133642749 passed](https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/46133642749) at executable commit `1d67389366ddbce7d5e1279b1688447f9048dd63`. The current branch changes after that code commit are documentation-only.

Verified:
- Functions TypeScript build and Firestore TTL configuration (Node 24 build stage; Functions emulator runs on Node 22).
- Hosted Turnstile page: typecheck, 6 protocol tests, static build and bundle boundary verification.
- Extension coordinator: typecheck and 20 HTTP/iframe/CustomProvider tests.
- Test lab: TypeScript build, Vite build, MV3 manifest generation and exact-origin/static security verifier.
- Firestore Rules tests: 11 passed.
- Turnstile validator tests: 8 passed.
- Firestore emulator suites: 37 passed.
- Auth/Functions/Firestore HTTP emulator integration: passed, covering Firebase ID-token verification, email verification, CORS, Firestore session creation, ownership checks, pending-session rejection and no-store headers.

This does not constitute a real Cloudflare Siteverify call, a live Firebase Admin App Check token mint, deployed Firebase TTL policy verification or a desktop Chrome runtime test.

## Outstanding blockers

- LearnLens is not published; the product's final Chrome Web Store ID is still unknown. The lab has its own temporary unpacked extension ID.
- No hosted challenge domain or HTTPS hosting project is selected.
- No Turnstile widget, public site key or Turnstile secret has been created.
- No dedicated non-production Firebase project, parameters, secret or functions have been configured/deployed.
- The lab has not yet been loaded in desktop Chrome.
- After publication, repeat the parent-origin and `frame-ancestors` checks with the final product extension ID.
- Pre-auth/perimeter abuse controls and billing alerts still require review before any live rollout.

## Safety state

- PR #2 remains draft and unmerged.
- No Firebase or Cloudflare resources were deployed or configured by this implementation.
- `APP_CHECK_CHALLENGE_ENABLED` and `APP_CHECK_CHALLENGE_GLOBAL_BUDGET_ENABLED` remain false by default.
- All four production sync gates remain disabled.
- Existing sync callables continue to enforce App Check.
- Product extension manifest/version remains unchanged at 0.1.0.


Final workflow: [46133642749](https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/46133642749). It uses Node 24 for the extension/browser toolchain and switches to Node 22 for Functions emulator behavior, matching the Functions runtime declaration. The source commit exercised by this run is 1d67389366ddbce7d5e1279b1688447f9048dd63; the branch updates after it are documentation-only.


## Final Node.js-aligned CI result

[Run 46133642749 passed](https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/46133642749) with Node.js 22 used for Functions install/build and emulator execution. All 82 automated tests passed, including the Auth + Functions + Firestore HTTP integration. The manual desktop Chrome test remains outstanding.
