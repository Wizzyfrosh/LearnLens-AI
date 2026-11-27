# LearnLens App Check Compatibility Lab

This is a standalone Manifest V3 extension used only to test Firebase's built-in reCAPTCHA Enterprise App Check provider from a real `chrome-extension://` extension page.

It is intentionally separate from the LearnLens product extension:

- It has its own manifest, name, ID, and output directory.
- It does not modify `public/manifest.json`, `src/services/firebase-ai.ts`, or any sync transport.
- It does not use Firebase Auth, Cloud Functions, Firestore, or cloud-sync callables.
- It does not store the Firebase configuration or App Check token.
- It uses the normal extension-page CSP. Do not weaken it to make a test pass.

## Build

From the repository root:

```bash
npm install
npm run poc:app-check:verify
```

The unpacked test extension is produced in:

```text
poc/app-check-extension/dist/
```

## Load it in Chrome

1. Open `chrome://extensions`.
2. Leave the existing **LearnLens AI** extension installed and enabled.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the folder `poc/app-check-extension/dist/`.
6. Open the new **LearnLens App Check Compatibility Lab** extension's Details page, then open its extension options page.
7. Confirm that the page origin begins with `chrome-extension://`. This is the isolated lab extension ID, not the LearnLens product extension ID.

Do not remove, reload from a different folder, or replace your existing LearnLens extension to run this experiment.

## Firebase test prerequisites

The test needs a dedicated non-production Firebase Web App registration configured for the reCAPTCHA Enterprise provider. Use only these public client values in the form:

- Firebase Web API key
- Firebase project ID
- Firebase Web App ID
- reCAPTCHA Enterprise Web site key registered for that Firebase App Check app

Do not change the current LearnLens Web App's App Check provider. Do not paste a service-account key, private key, OAuth client secret, user password, or debug token.

The Firebase App Check documentation describes a Web-type reCAPTCHA Enterprise key with allowed web domains. It does not document a `chrome-extension://` origin as a supported domain. This lab is intended to reveal the actual failure point, including any extension CSP violation. A successful result from this temporary lab ID would still not prove compatibility with the future Chrome Web Store ID.

## Interpret the result

- **Token acquired:** the built-in provider completed token acquisition for this particular lab ID and Firebase test registration. Record the extension ID, Firebase test app ID, browser version, date, and Network/CSP evidence. Do not infer that the final published ID will behave identically.
- **CSP violation:** record the blocked directive and resource. Do not add remote JavaScript hosts to `script-src`; that would violate Manifest V3 extension-page CSP restrictions.
- **Unsupported domain / invalid site key:** this may occur before the SDK can exchange a token. It is evidence that the configured reCAPTCHA key does not accept this extension origin; it is not proof that the Firebase SDK itself is defective.
- **App Check exchange rejected:** inspect the Network panel and Firebase error. The test app must be registered with the exact corresponding App Check provider and site key.

The harness intentionally disables automatic token refresh and requests only one token after the test button is clicked. Reload the options page to make another attempt.

## What this lab does not prove

This harness tests the built-in reCAPTCHA Enterprise provider only. It does not provide extension attestation, mint custom tokens, deploy a backend, change Firebase enforcement, or enable LearnLens cloud sync. The hosted-challenge/custom-provider alternative is documented separately in `docs/PHASE6_6_APPCHECK_POC.md` and remains an architecture experiment until its proof and abuse model are independently validated.
