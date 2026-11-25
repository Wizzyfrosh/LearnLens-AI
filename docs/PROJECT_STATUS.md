# LearnLens AI — Project Status and Continuity Checklist

**Last repository inspection:** 2026-11-25  
**Repository:** https://github.com/Wizzyfrosh/LearnLens-AI  
**Branch:** main  
**Current phase:** CI green for transcript ingestion and local session persistence; Chrome runtime QA pending.

> Read this file first on every returning session. File existence does not prove runtime completion. Verify against code, CI, and browser behavior.

## 1. Current checkpoint

**Vertical slice:** YouTube page detection → manual transcript import → Firebase AI Logic tutor → answer with actual inference source.

### Latest verified CI
- Successful run: https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/45560326920
- Commit: b2884c2af1d3925c22517860dde3bf68037aff33
- Result: SUCCESS.
- The Firebase inference-source comparison now uses SDK `InferenceSource` constants.
- This green run predates the transcript parser/UI changes below. Do not claim those changes passed CI yet.
- Latest run for transcript test changes was cancelled by concurrency when newer commits arrived.
- Latest run for current main commit b93fe692575559df9ed5d1a0ccc60b3f07bbb116: https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/45560716109
- Latest green run: https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/45561154300
- Verified steps: dependency installation, TypeScript typecheck, unit tests, and production build all succeeded on commit 6eee3e48e69142a06a80e76c370b4e9a66eea59f. This run includes the preceding local-session implementation commits.

## 2. Completed / code present

- [x] Public repository and main branch.
- [x] Product name/tagline established.
- [x] Chrome Manifest V3 manifest and side panel scaffold.
- [x] React + TypeScript + Vite + Tailwind scaffold.
- [x] Basic YouTube watch-page context capture and background message handling.
- [x] VTT/SRT/plain-text transcript parser.
- [x] Transcript validation API: format detection, empty/oversized input rejection, cue validation, malformed-cue warnings, cue-count limit.
- [x] Timestamp preservation; plain text does not receive fabricated timestamps.
- [x] Context-window builder with character limit.
- [x] Expanded Vitest cases for malformed cues, skipped cues, oversized/empty input, format detection, markup stripping, and context limits.
- [x] Transcript UI displays source filename/paste source, detected format, validation errors/warnings, and first three segment previews.
- [x] IndexedDB session store with schema versioning and indexes for video ID, platform, and updated time.
- [x] Explicit save/remove controls for local sessions.
- [x] Restore the most recent saved session for the active YouTube video, or most recent manual session when no YouTube video is active.
- [x] Firebase AI Logic adapter calls generateContent.
- [x] Inference preferences: prefer on-device, on-device-only, cloud-only.
- [x] SDK inference-source mapping uses `InferenceSource.ON_DEVICE` and `InferenceSource.IN_CLOUD`.
- [x] CI workflow runs typecheck, tests, and production build.
- [x] Apache-2.0 LICENSE, README setup notes, .env.example.
- [x] PRD, hackathon brief, implementation plan, and continuity checklist.

## 3. In progress / requires verification

- [x] Verify transcript ingestion and IndexedDB implementation passes CI (typecheck, tests, production build) on commit 6eee3e48e69142a06a80e76c370b4e9a66eea59f.
- [ ] Inspect generated dist and verify manifest asset paths.
- [ ] Load dist in Chrome and test extension action/side panel.
- [ ] Verify active YouTube tab context and SPA navigation.
- [ ] Verify service worker message lifecycle and suspension/restart.
- [ ] Verify transcript import/preview in actual Chrome UI.
- [ ] Add and commit package-lock.json; change CI to npm ci. No lockfile is currently present.
- [ ] Add IndexedDB integration tests or a testable storage adapter.
- [ ] Verify local session save/restore/delete in actual Chrome extension runtime.
- [ ] Configure Firebase project and App Check; runtime not verified.
- [ ] Test cloud inference and on-device inference on supported Chrome desktop.
- [ ] Confirm on-device-only never falls back to cloud.
- [ ] Test actual transcript grounding and timestamp evidence.

## 4. Not implemented

- [ ] Automatic YouTube transcript/caption retrieval.
- [ ] Formal platform adapter interface.
- [ ] TikTok and Facebook adapters.
- [x] IndexedDB persistence / saved learning sessions (initial implementation; browser QA pending).
- [ ] Timestamp-aware notes and bookmarks.
- [ ] Markdown/PDF export.
- [ ] Quiz generation, attempts, scoring, and explanations.
- [ ] Learning history/dashboard and weak-topic revision.
- [ ] Firebase Authentication, Firestore sync, and security rules.
- [ ] Remote Config.
- [ ] Account/data export and deletion.
- [ ] Android companion.
- [ ] Public demo video and Devpost submission.

## 5. Immediate task queue

### Task 1 — Validate transcript import changes (BLOCKING)
- [x] Add transcript format detection and import validation.
- [x] Reject empty and oversized transcripts.
- [x] Skip malformed timed cues with warnings; reject when no valid cues remain.
- [x] Add preview and provenance label in UI.
- [x] Add parser tests.
- [ ] Confirm latest CI run passes on current main.
- [ ] Review parser behavior against representative real VTT/SRT files in Chrome.

Acceptance: valid imports become timestamped/untimestamped segments accurately; invalid input is explained; preview matches parsed content.

### Task 2 — Extension runtime QA
- [ ] Verify dist/manifest.json, sidepanel.html, assets/background.js, assets/youtube.js.
- [ ] Load unpacked in Chrome and inspect chrome://extensions errors.
- [ ] Test action opens side panel.
- [ ] Test YouTube watch page, SPA navigation, tab switching, and worker restart.
- [ ] Review tab activation listener and permission footprint.

Acceptance: extension installs without errors and detects active YouTube context reliably.

### Task 3 — Reproducible CI and Firebase runtime
- [ ] Generate and commit package-lock.json.
- [ ] Change CI to npm ci; remove legacy-peer-deps unless a documented dependency conflict requires it.
- [ ] Configure Firebase AI Logic and App Check.
- [ ] Test cloud, local, hybrid fallback, local unavailable, network/quota failure.
- [ ] Confirm on-device-only never sends transcript to cloud.

Acceptance: reproducible CI and real AI requests with truthful inference-source reporting.

### Task 4 — Local learning sessions
- [ ] Design IndexedDB/Dexie schema for lesson sessions and transcript metadata.
- [ ] Persist learner-approved session metadata and learning artifacts locally.
- [ ] Keep full transcripts local by default and set retention/clear controls.
- [ ] Add migrations and tests.
- [ ] Only then implement notes and bookmarks.

Acceptance: sessions survive extension reloads; data can be cleared; no transcript upload by default.

### Task 5 — Notes, bookmarks, quiz, submission
See IMPLEMENTATION_PLAN.md for the detailed phases and exit criteria.

## 6. Known caveats

1. Latest CI passes typecheck, parser unit tests, and production build for transcript and IndexedDB changes; Chrome runtime behavior remains unverified.
2. Current main has no package lockfile; CI currently uses npm install with legacy peer deps.
3. IndexedDB session storage has not yet been verified in Chrome; CI validates compile/tests/build only.
4. Saved manual sessions currently restore the most recent manual import; there is not yet a full session history browser.
5. Automatic transcript retrieval is not implemented; manual VTT/SRT/TXT is the current route.
6. TikTok and Facebook are not implemented.
7. Firebase project/App Check and runtime inference are not configured/verified.
8. Unsaved UI state remains in memory; only explicitly saved transcript sessions persist locally.
9. Vite build success alone does not prove Chrome extension runtime correctness.
10. Review background worker tab activation listener against declared permissions; keep permissions minimal.
11. Do not claim offline support until model setup and local inference are tested.

## 7. Session update template

At the end of every session update:
- Date:
- Commit(s):
- Tasks completed:
- Tests run and exact results:
- Browser/runtime verification:
- Known failures/blockers:
- Next exact task:

## 8. Document map

- PRD.md — complete product requirements.
- HACKATHON_BRIEF.md — contest requirements and AI-agent handoff.
- IMPLEMENTATION_PLAN.md — phased engineering roadmap.
- PROJECT_STATUS.md — current checkpoint and checklist.
