# LearnLens AI — Phase 6B Firebase Auth Setup

**Status:** Email/password authentication and initial Firestore Rules are implemented in the extension code. Live Firebase Console configuration and desktop Chrome verification are still required. Cloud sync is not implemented.

## 1. Enable Email/Password sign-in

1. Open the Firebase project used by LearnLens AI.
2. Go to **Authentication → Sign-in method**.
3. Enable **Email/Password**.
4. Save the provider configuration.
5. In **Authentication → Templates**, review the email verification and password reset templates, sender name, and reply-to address.

Do not enable Google or other OAuth providers for this first auth slice. OAuth popup/redirect support in Manifest V3 needs an offscreen-document flow and is intentionally deferred.

## 2. Check the existing Firebase web configuration

The extension build reads these GitHub Actions repository secrets:

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_APP_ID`

Confirm these values belong to the same Firebase project where Email/Password was enabled. Do not paste the values into source code or commit them. They are public Firebase web-app identifiers, but the repo keeps them in build configuration to avoid project drift.

The manifest now grants host permissions for Firebase Authentication's Identity Toolkit and Secure Token endpoints. No OAuth popup endpoints or App Check production provider were added.

## 3. What the new Account tab does

- Create an account with email and password (minimum eight characters in the UI).
- Send a Firebase email verification message after account creation.
- Sign in with email and password.
- Resend the verification message.
- Reload the Firebase user to refresh the email-verified state after clicking the email link.
- Request a password reset email.
- Sign out.
- Restore Firebase Auth's persisted user session when the side panel opens again.

Sign-in is optional. Lesson capture, local transcript storage, notes, quizzes, and quiz history remain available when signed out. Signing in does **not** turn on cloud sync and does **not** upload local data.

Email verification is a prerequisite for writing the sync-settings document under the new Firestore Rules. The current app does not yet write that document.

## 4. Desktop Chrome verification checklist

After the latest CI artifact is downloaded and loaded into the existing unpacked extension folder (keep the current extension ID), open the Account tab and verify:

1. Create a test account with an email address you control.
2. Confirm Firebase sends the verification email.
3. Open the link, return to the extension, and click **Check verification**. LearnLens reloads the Firebase user and forces an ID-token refresh so Firestore Rules receive the updated `email_verified` claim.
4. Sign out and sign back in.
5. Use **Forgot password?** and confirm the reset email arrives.
6. Close and reopen the side panel; confirm the signed-in session is restored.
7. Sign out and confirm lessons/notes/quizzes remain usable and unchanged.

Use a test account, not a primary account holding unrelated data. Do not share passwords or verification links in chat.

## 5. Firestore Rules and emulator tests

The checked-in `firestore.rules` file is deny-by-default. It permits a verified user to read/create/update only their own `users/{uid}/settings/sync` document, with a strict field allow-list and server timestamp validation.

All lesson, note, quiz, attempt, device, receipt, and conflict paths remain denied until the sync engine and matching schema validators are implemented.

Run locally with Node.js 24 and Java 21:

```bash
npm install
npm test
npm run test:rules
```

The CI emulator suite currently verifies unauthenticated access, verified/unverified user behavior, cross-user isolation, malformed settings, client timestamps, immutable schema version, delete denial, and continued denial of artifact paths.

**Do not deploy these rules to the live Firebase project yet** until the project ID is confirmed and the owner has reviewed the deny-by-default effect on any existing Firestore data. When ready, the deploy command is:

```bash
npx firebase deploy --only firestore:rules --project YOUR_CONFIRMED_PROJECT_ID
```

## 6. Important release gate: App Check

The current AI Logic setup still uses a development debug-token App Check provider. That is not production attestation. This Phase 6B work does not enable Firestore App Check enforcement or cloud synchronization.

Before enabling sync in production, verify a production-compatible App Check strategy with the actual installed Chrome extension ID and a non-debug provider. Strict Firestore Auth/Rules checks are necessary but do not replace App Check abuse protection.
