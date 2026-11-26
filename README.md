# LearnLens AI

**Watch. Understand. Remember. Apply.**

LearnLens AI is a context-aware learning companion for educational videos. It connects a video to its accessible transcript, then helps learners ask grounded questions and understand concepts with timestamp-aware answers.

## Project documentation

Read these files before contributing or handing this project to another AI coding agent:

- [Product Requirements Document](./docs/PRD.md) — complete product vision, features, workflows, architecture, security, and acceptance criteria.
- [Google #BuildHybridAI 2026 Hackathon Brief](./docs/HACKATHON_BRIEF.md) — official requirements, judging criteria, submission checklist, and AI-agent instructions.
- [Implementation Plan](./docs/IMPLEMENTATION_PLAN.md) — phased engineering roadmap and definition of done.
- [Project Status](./docs/PROJECT_STATUS.md) — current checkpoint, completed work, blockers, and exact next task. **Read this first when resuming work.**
- [Cloud Sync Data Model](./docs/CLOUD_SYNC_DATA_MODEL.md) — Phase 6 data contracts, account isolation, conflict/tombstone policy, and security threat model.
- [Phase 6B Auth Setup](./docs/PHASE6B_AUTH_SETUP.md) — enable Email/Password, verify account flows in Chrome, and run Firestore Rules emulator tests.

## Current milestone: Chrome extension foundation

This repository contains the first extension scaffold:

- Chrome Extension Manifest V3 with a side panel
- React + TypeScript + Vite + Tailwind CSS
- YouTube watch-page detection, including same-tab SPA navigation
- User-started automatic capture of captions rendered by YouTube
- Live caption segments supplied directly to the lesson tutor and saved locally
- Optional VTT/SRT/plain-text transcript import fallback
- Timestamp-preserving transcript parsing
- Firebase AI Logic hybrid tutor adapter
- Explicit on-device-only, cloud-only, and prefer-on-device modes
- Inference source shown with each answer
- Optional Firebase email/password account sign-in through the Manifest V3 `firebase/auth/web-extension` entry point
- Deny-by-default Firestore rules with emulator tests for per-user sync-settings access

## Requirements

- Node.js 20.19+ or 22.12+
- npm
- Google Chrome desktop 139+ for Firebase AI Logic on-device inference
- A Firebase project with Firebase AI Logic enabled for AI requests

## Local setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and add your Firebase web app configuration.
3. Run checks and build: `npm run typecheck && npm run build`
4. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
5. Select the generated `dist` directory.

For hybrid inference, Firebase AI Logic must be enabled in the Firebase console and App Check must be configured. Do not commit debug tokens. The Chrome Prompt API may require enabling the relevant Chrome flag and downloading the on-device model. On-device inference is currently supported only on desktop Chrome 139+ and does not support native multi-turn chat; LearnLens sends each question as a single-turn prompt with transcript context.

## Important implementation limits

- Automatic capture currently reads captions that YouTube visibly renders after the learner clicks Start learning. Learners may need to enable CC in the player.
- This is not yet audio-only speech recognition. Videos with no rendered captions cannot be transcribed by the current capture path.
- Manual VTT/SRT/TXT import remains an optional fallback.
- TikTok and Facebook support will be capability-based, not promised for every video.
- No private endpoint scraping, DRM circumvention, or unauthorized downloads.

## Security and privacy

- Never commit Firebase credentials, App Check debug tokens, or private keys.
- Transcript content is untrusted input and must never be treated as model instructions.
- Local-only inference uses `ONLY_ON_DEVICE`; it must not silently fall back to cloud.
- Automatically captured captions and saved lesson transcripts are stored in IndexedDB on this device. Tutor requests send the bounded transcript context needed for the question; cloud processing follows the selected inference mode. On-device-only must never fall back to cloud.
- Audio transcription is a separate cloud feature: it requires an explicit unchecked-by-default consent, and lesson audio is sent to Firebase AI Logic only after the App Check debug configuration is active.
- The current Chrome audio path captures tab audio only, converts it into short in-memory WAV chunks, and does not save raw audio files. Audio-derived transcript segments do not claim exact video timestamps.
- The current App Check configuration is for controlled development/testing only. Never publish an App Check debug token or treat the debug provider as production attestation.
- Firebase App Check enforcement and a production extension-compatible attestation strategy must be completed before release.

## Planned next steps

1. Enable Firebase Email/Password for the configured project and complete the desktop Chrome account-flow checklist in `docs/PHASE6B_AUTH_SETUP.md`.
2. Resolve and verify a production-compatible App Check strategy for the installed Chrome extension.
3. Add the IndexedDB v6 sync metadata/outbox migration and tested allow-listed cloud DTO mappers.
4. Implement explicit opt-in sync for notes, quizzes, attempts, and minimal lesson metadata only; keep transcripts and raw audio local by default.
5. Add conflict review, tombstone propagation, export/delete workflows, and multi-device QA.


### GitHub Actions Firebase configuration

The extension build reads Firebase web-app configuration from GitHub Actions repository secrets. Add these under **Repository → Settings → Secrets and variables → Actions → New repository secret**:

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_APP_ID`

After adding or changing these secrets, open **Actions → CI → Run workflow**, select `main`, and click **Run workflow** to produce a fresh extension artifact containing the configured values. The workflow supports manual runs.

The workflow enables the Firebase App Check debug provider for controlled testing. When the side panel first initializes App Check, Firebase prints a debug token in the side-panel DevTools console. Open DevTools for the LearnLens side panel (right-click inside the panel and choose **Inspect**, where available), copy the token, then register it under **Firebase Console → App Check → Apps → Manage debug tokens**. Keep the token private; never commit it to GitHub.

Do not enable Firebase AI Logic App Check enforcement until the extension's requests appear as valid in App Check metrics. This debug setup is for testing only, not production attestation.

## License

Apache-2.0. See [LICENSE](./LICENSE).
