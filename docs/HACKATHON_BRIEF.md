# LearnLens AI — Google #BuildHybridAI 2026 Agent Handoff

**For:** Any AI coding agent, reviewer, or contributor continuing this project.  
**Repository:** https://github.com/Wizzyfrosh/LearnLens-AI  
**Project:** LearnLens AI — Watch. Understand. Remember. Apply.  
**Submission platform:** Web / Chrome Extension.

## 1. Mandatory instructions to the next AI agent

This is an existing project. Do not restart it or replace the stack.

Before editing:
1. Read this file.
2. Read PRD.md for the product contract.
3. Read IMPLEMENTATION_PLAN.md for task order.
4. Read PROJECT_STATUS.md first for the latest checkpoint and blockers.
5. Inspect actual code, Git history, and latest CI; verify the checklist.
6. Make one focused change at a time.

Rules:
- Firebase AI Logic must remain the runtime AI integration.
- Never fake inference-source metadata.
- On-device-only must not fall back to cloud.
- Never invent transcript timestamps or citations.
- Never claim a UI mock means a feature works.
- No private endpoint scraping, DRM circumvention, unauthorized downloads, or broad browser permissions without justification.
- Never commit secrets, service-account keys, debug tokens, or user data.
- Run typecheck, tests, and build after meaningful changes.
- Update PROJECT_STATUS.md after every work session.
- Record blockers with exact logs, not assumptions.
- Keep architecture simple and modular; avoid speculative abstractions.
- Do not claim contest submission compliance until each requirement is verified.

## 2. What is being built

LearnLens AI is a context-aware learning companion that runs beside educational videos. It uses an accessible transcript to ground questions about the current lesson, then progressively turns learning sessions into notes, bookmarks, quizzes, and revision material.

The product is not a generic chatbot and not merely a video summarizer. Its differentiator is continuity between the current video, transcript, learner question, timestamp evidence, saved learning artifacts, and later revision.

## 3. Problem and impact

Learners lose context when switching from videos to chatbots, fail to capture important ideas, and mistake passive watching for understanding. LearnLens places a lesson-aware tutor beside the video and helps learners actively process, save, and test what they learn.

Audience: students, self-taught developers, online course learners, professionals learning new skills, teachers, and lifelong learners. English-first and globally useful, including markets with variable connectivity.

## 4. Scope

### Hackathon MVP
1. Detect a YouTube watch page.
2. Load a timestamped transcript from an accessible source or user import.
3. Ask a transcript-grounded question.
4. Route inference through Firebase AI Logic using selected hybrid mode.
5. Display answer and actual inference source.
6. Respect local-only privacy choice.
7. Deliver installable, demonstrable Chrome extension.

### Later
- Automatic caption discovery.
- Timestamp notes and bookmarks.
- Quiz generation, scoring, explanations.
- Local learning history/revision dashboard.
- Optional Firebase Auth/Firestore sync.
- TikTok/Facebook adapters only where permitted transcript access is demonstrated.
- Android after Chrome workflow is stable.

Do not sacrifice the core vertical slice by attempting every platform and future feature at once.

## 5. Official hackathon requirements

Google #BuildHybridAI 2026 asks entrants to build a generative AI application using Firebase AI Logic and supported Firebase products such as App Check, Remote Config, Firestore, and Authentication.

At least one platform is required:
- Web (Chrome), integrating Gemini Nano 4 via Firebase AI Logic; web apps and Chrome extensions are supported.
- Android, integrating Gemini Nano 4 via Firebase AI Logic.
- iOS, using Apple Foundation Models API for local execution via Firebase AI Logic.

Multi-platform is preferred, not mandatory. LearnLens deliberately selects Web/Chrome first to protect quality.

Firebase AI Logic requires App Check. Official rules say debug tokens are accepted in submissions. Keep debug tokens out of source control; a debug token is not a production attestation design.

The repository must demonstrate Firebase AI Logic at runtime: imported and actually called, not merely mentioned in README. Current code includes an adapter at src/services/firebase-ai.ts; it must remain connected to the real tutor flow and tested with a configured Firebase project.

Official sources:
- Rules: https://firebasehybridaihackathon.devpost.com/rules
- Contest: https://firebasehybridaihackathon.devpost.com/
- Schedule: https://firebasehybridaihackathon.devpost.com/details/dates
- Firebase AI Logic: https://firebase.google.com/docs/ai-logic
- Hybrid inference: https://firebase.google.com/docs/ai-logic/hybrid

## 6. Schedule and submission

Devpost schedule consulted 2026-11-25:
- Submission begins November 11, 2026 at 1:30 PM Pacific Time.
- Submission deadline November 30, 2026 at 2:00 PM Pacific Time.
- Judging December 10, 2026 at 9:00 AM PT through December 16, 2026 at 2:00 PM PT.
- Winners announced around December 21, 2026 at 12:00 PM PT.

For Nigeria (WAT, UTC+1), the listed deadline converts to November 30, 2026 at 11:00 PM WAT, assuming PST UTC-8 on that date. Re-check official page before submission.

### Submission checklist
- [ ] Submit through Devpost before deadline.
- [ ] Select Web/Chrome platform.
- [ ] English project description.
- [ ] Explain problem, target audience, value, features, and what was built during contest period.
- [ ] Explain Firebase AI Logic hybrid inference at runtime.
- [ ] Public GitHub/GitLab repository with source, assets, and setup instructions.
- [ ] Open-source license file; Apache-2.0 exists in repo. Verify GitHub shows license in repository metadata/About.
- [ ] Public YouTube demo, maximum 3 minutes.
- [ ] Video shows the project actually functioning on selected platform.
- [ ] English narration or English subtitles.
- [ ] Working demo/test build and instructions where possible.
- [ ] Project available free for judging/testing through judging period.
- [ ] No secrets, private data, production credentials in repository or submission.
- [ ] Clearly disclose incomplete/mock/simulated features.
- [ ] Provide accurate summary of what was built during submission period.

### Existing-project rule
Rules permit normal tools, frameworks, libraries, templates, and AI coding assistants. A project that existed before the submission period must be significantly updated after the period begins. Submission must summarize what was built during the contest period. Disclose pre-existing code and third-party components accurately; do not claim the whole project was built from scratch if that is not true.

### Eligibility
Rules require entrants to be above the age of majority in their jurisdiction and exclude specified countries/territories, including Brazil, Quebec, Crimea, Cuba, Iran, Syria, North Korea, Sudan, Belarus, Russia, and Italy, plus other sanctions restrictions. Entrant must independently verify current eligibility and official terms. This is not legal advice.

### Quota request
Rules list the final Google Account Quota request cutoff as Wednesday, November 25 at 10:00 AM PT, with accounts scheduled Friday, November 27. Approval is discretionary; accounts are valid four days; costs outside quota remain entrant responsibility. Check the official page/form; do not assume quota is approved.

## 7. Judging criteria

Stage One is a pass/fail viability screen: submission requirements met, challenge addressed, required technology reasonably applied.

Stage Two uses four equally weighted criteria, each scored 1–5:

### Technological implementation
Demonstrate Firebase AI Logic runtime calls, correct hybrid modes, actual inference-source metadata, tested on-device and cloud paths, App Check, sound code and error handling.

### Design
Demonstrate coherent polished Chrome side-panel workflow, useful empty/loading/error states, clear video/transcript context, and visible privacy controls. Judges want a complete experience, not only a technical proof of concept.

### Potential impact
Show a concrete learning problem, specific audience, believable reduction in context switching, timestamp-aware learning and retrieval practice. Use real user feedback if available; never fabricate metrics or testimonials.

### Quality of idea
Explain why LearnLens is more than a summarizer/chatbot, how transcript context/timestamps/notes/quizzes/revision work together, and why hybrid local/cloud execution matters.

All criteria are equally weighted. Balance technical quality, design, impact, and idea quality.

## 8. Firebase AI Logic implementation expectations

- Firebase AI Logic is mandatory for the AI runtime.
- App Check is required.
- Current code exposes preferences: prefer on-device, on-device-only, cloud-only.
- Show SDK-reported inference source, not selected preference.
- Prefer-on-device may fall back to cloud; disclose before transcript context is sent.
- On-device-only must never silently fall back.
- Cloud-only explicitly uses cloud.
- Do not claim all browsers/devices support Gemini Nano. Test a supported Chrome desktop setup.
- Current tutor request is single-turn with transcript context. Do not assume native multi-turn chat or tools/function calling on-device; app may include recent history explicitly in each request within context limits.
- Verify model identifier and SDK behavior against current docs before release.
- Firebase web config values are public client identifiers; server secrets and App Check debug tokens must not be committed.

## 9. Transcript and platform limitations

The product promise is support for sources with accessible captions/transcripts, not guaranteed extraction from every video.

- Prefer native tracks, user-visible captions, or documented authorized APIs.
- Keep VTT/SRT/TXT import as universal fallback.
- YouTube captions.download requires authorization to edit the video; do not depend on it for arbitrary public videos.
- TikTok Display API is not a general public transcript API.
- Facebook Graph API video access is permission-limited.
- No hidden endpoint scraping, private API reverse engineering, access-control bypass, DRM circumvention, or unauthorized video download.
- Expose source provenance and timestamp availability.

References:
- YouTube captions download: https://developers.google.com/youtube/v3/docs/captions/download
- TikTok Display API: https://developers.tiktok.com/doc/display-api-overview/
- Facebook video reference: https://developers.facebook.com/docs/graph-api/reference/video/

## 10. Current repository

Stack: Chrome MV3, React 19, TypeScript, Vite 7, Tailwind 4, Firebase JS SDK/Firebase AI Logic, Vitest, GitHub Actions.

Current files:
- public/manifest.json
- src/background/index.ts
- src/content/youtube.ts
- src/services/firebase-ai.ts
- src/services/transcript.ts
- src/services/transcript.test.ts
- src/shared/types.ts
- src/shared/messages.ts
- src/ui/App.tsx
- .github/workflows/ci.yml

This is an early scaffold. File existence does not prove runtime completion. Read PROJECT_STATUS.md for actual verified state.

## 11. Suggested demo (<= 3 minutes)

1. State the learning problem.
2. Open a real educational YouTube video and LearnLens.
3. Show detected title/context.
4. Import a legally usable timestamped transcript.
5. Ask a question tied to one transcript concept.
6. Show grounded answer and timestamp reference.
7. Show actual inference source.
8. If supported hardware is available, demonstrate local and cloud modes accurately.
9. Describe notes/quizzes/revision as implemented or planned, without misrepresenting status.

Never use fake responses, fake source badges, or fabricated transcripts.

## 12. Agent handoff protocol

At start: read status, inspect latest commit and CI, select one task from plan, identify acceptance criteria.

At end: run checks, record exact results, update status, update plan if sequencing changed, update README if setup/capabilities changed, commit clearly. Never mark a feature done when only its UI exists or tests are absent.

## 13. Sources and rule freshness

Official rules and schedule consulted on 2026-11-25. Rules may change; re-check before submission. This summary does not replace binding official rules.
