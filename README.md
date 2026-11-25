# LearnLens AI

**Watch. Understand. Remember. Apply.**

LearnLens AI is a context-aware learning companion for educational videos. It connects a video to its accessible transcript, then helps learners ask grounded questions and understand concepts with timestamp-aware answers.

## Project documentation

Read these files before contributing or handing this project to another AI coding agent:

- [Product Requirements Document](./docs/PRD.md) — complete product vision, features, workflows, architecture, security, and acceptance criteria.
- [Google #BuildHybridAI 2026 Hackathon Brief](./docs/HACKATHON_BRIEF.md) — official requirements, judging criteria, submission checklist, and AI-agent instructions.
- [Implementation Plan](./docs/IMPLEMENTATION_PLAN.md) — phased engineering roadmap and definition of done.
- [Project Status](./docs/PROJECT_STATUS.md) — current checkpoint, completed work, blockers, and exact next task. **Read this first when resuming work.**

## Current milestone: Chrome extension foundation

This repository contains the first extension scaffold:

- Chrome Extension Manifest V3 with a side panel
- React + TypeScript + Vite + Tailwind CSS
- YouTube watch-page detection and active-video context
- VTT/SRT/plain-text transcript import
- Timestamp-preserving transcript parsing
- Firebase AI Logic hybrid tutor adapter
- Explicit on-device-only, cloud-only, and prefer-on-device modes
- Inference source shown with each answer

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

- The extension detects YouTube videos but does not yet automatically retrieve every video's complete transcript.
- The first transcript path is user-provided VTT, SRT, or plain text. Automatic caption discovery will be added only where the page exposes a supported caption source.
- TikTok and Facebook support will be capability-based, not promised for every video.
- No private endpoint scraping, DRM circumvention, or unauthorized downloads.

## Security and privacy

- Never commit Firebase credentials, App Check debug tokens, or private keys.
- Transcript content is untrusted input and must never be treated as model instructions.
- Local-only inference uses `ONLY_ON_DEVICE`; it must not silently fall back to cloud.
- Transcripts are held in the side-panel session and are not uploaded by the extension unless the learner selects cloud inference.
- Firebase App Check enforcement and a production extension-compatible attestation strategy must be completed before release.

## Planned next steps

1. Validate this scaffold with a clean install, typecheck, and production build.
2. Add automated tests for transcript parsing and context-window construction.
3. Implement reliable YouTube caption access where supported.
4. Add notes, timestamp bookmarks, and quiz generation.
5. Add sign-in and optional learning-artifact sync after the core workflow is stable.

## License

Apache-2.0. See [LICENSE](./LICENSE).
