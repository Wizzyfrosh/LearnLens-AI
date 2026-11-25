# LearnLens AI — Project Status and Continuity Checklist

**Last repository inspection:** 2026-11-25  
**Repository:** https://github.com/Wizzyfrosh/LearnLens-AI  
**Branch:** main  
**Current phase:** Automatic YouTube visible-caption capture and SPA context handling are implemented on `main`; current CI and Chrome runtime QA are pending.

> Read this file first on every returning session. File existence does not prove runtime completion. Verify against code, CI, and browser behavior.

## 1. Current checkpoint

**Vertical slice:** YouTube SPA detection → user-started visible-caption capture → local transcript → Firebase AI Logic tutor → grounded answer.

### Latest verified CI
- Last successful package-smoke run: https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/45563356591
- Commit: 5398e512007a7447f7648eb9d2a24f13b73352ec
- Result: SUCCESS.
- Verified steps: dependency installation, typecheck, unit tests, production build, and Chrome extension package smoke check.
- The smoke check validates Manifest V3 and the presence of referenced service worker, side-panel, content-script, and HTML assets.
- Active-tab context synchronization was updated to ignore URL changes in inactive tabs.
- Earlier green run 45561154300 covers transcript ingestion and IndexedDB session implementation (typecheck, tests, production build).
- Package-smoke run 45563356591 covers the built Manifest V3 package and initial active-tab synchronization.
- Later active-context broadcast and side-panel synchronization commits are not yet verified by CI; check the latest run before claiming they pass.

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
- [x] Add a post-build smoke check for Manifest V3, service worker, side panel, content script, and side-panel asset paths.
- [ ] Load dist in Chrome and test extension action/side panel.
- [ ] Verify active YouTube tab context and SPA navigation in Chrome.
- [x] Expand the content script to all YouTube routes so it can survive same-document navigation into `/watch`.
- [x] Add title/context refresh retries and testable URL/title parsing.
- [x] Add user-started visible-caption capture, live side-panel updates, and automatic local transcript persistence.
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
- [x] Confirm latest CI run for the preceding documentation commit passes; verify the new package-smoke-check commit separately.
- [ ] Review parser behavior against representative real VTT/SRT files in Chrome.

Acceptance: valid imports become timestamped/untimestamped segments accurately; invalid input is explained; preview matches parsed content.

### Task 2 — Extension package and runtime QA
- [x] Add CI validation that dist/manifest.json, side panel, service worker, content script, and referenced side-panel assets exist.
- [ ] Verify generated filenames in a real build and load dist in Chrome.
- [ ] Load unpacked in Chrome and inspect chrome://extensions errors.
- [ ] Test action opens side panel.
- [ ] Test YouTube watch page, SPA navigation, tab switching, and worker restart.
- [x] Fix stale YouTube context when the active tab changes or navigates away; refresh context on active-tab URL/completion updates.
- [x] Broadcast active-context changes to the side panel and ignore content-script context messages from inactive tabs.
- [ ] Review tab activation listener and permission footprint in Chrome.

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

1. Package-smoke CI passed on commit 5398e51. Later commits ed4f642, a708e78, f107d34, and 308307d update active-tab handling and side-panel synchronization; the newest code CI result must be checked separately. Chrome runtime behavior remains unverified.
2. Current main has no package lockfile; CI currently uses npm install with legacy peer deps.
3. IndexedDB session storage has not yet been verified in Chrome; CI validates compile/tests/build only.
4. Saved manual sessions currently restore the most recent manual import; there is not yet a full session history browser.
5. Automatic capture of visibly rendered YouTube captions is implemented in code; Chrome runtime QA is pending. Audio-only speech transcription is not implemented. Manual VTT/SRT/TXT remains fallback only.
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


## 9. Session update — 2026-11-25
- Commits: 18244db (extension build smoke script), b6b4c4b (package script), b82d6d4 (CI integration), decec33 (active-tab context synchronization), 34aeaf6 (preserve explicit null context).
- Tasks completed: CI now checks the built extension manifest and referenced assets; background worker refreshes active YouTube context on tab activation/navigation and clears stale context when leaving a YouTube watch page.
- Tests: the preceding docs commit CI passed. The newest code commits have not yet had a confirmed CI result at time of this update.
- Browser/runtime verification: not performed; requires loading the unpacked extension in Chrome.
- Known blockers: no package lockfile; Firebase project/App Check and real model inference remain unconfigured/unverified.
- Next exact task: inspect the latest CI run; then load dist in Chrome and execute the runtime QA checklist before adding features.


## 10. Session update — 2026-11-25 (continued)
- Commit: 5398e51 — extension package smoke validation and active-tab context synchronization; CI run 45563356591 passed all eight steps.
- Commit: ed4f642 — ignore URL navigation events from inactive tabs so they cannot overwrite the active lesson context.
- Tests: package smoke check, typecheck, unit tests, and production build passed on 5398e51. The follow-up ed4f642 commit is awaiting CI.
- Browser/runtime verification: still requires local Chrome; not claimed complete.
- Dependency reproducibility: package-lock.json is absent; npm ci migration is blocked until a real lockfile is generated from the repository dependency graph. Do not hand-author a lockfile.
- Next exact task: verify ed4f642 CI, then establish reproducible npm ci install and add IndexedDB integration tests before expanding features.


## 11. Session update — 2026-11-25 (active context sync)
- Commits: a708e78 (active context update message), f107d34 (background rejects inactive content-script context and broadcasts active tab changes), 308307d (side panel subscribes to context changes and reloads the matching saved lesson).
- Problem discovered: App.tsx queried the active tab only once on mount. Background updates therefore did not update an already-open side panel; additionally, content scripts from inactive tabs could publish stale context.
- Fix: side panel now listens for active-context updates, clears old video transcript state when switching videos, and restores only the matching saved session. Background validates sender tab against the active tab and broadcasts context changes. Focus changes trigger context resync.
- Tests: CI must verify these latest commits; no browser runtime claim made.
- Remaining: Chrome runtime QA, package-lock/npm ci, IndexedDB integration tests, Firebase/App Check runtime.


## 12. Session update — 2026-11-25 (automatic lesson capture)

User-tested runtime issue:
- YouTube video changes in the same tab did not refresh LearnLens context.
- Switching tabs did refresh context, indicating the side panel's tab lifecycle path worked while YouTube's same-document route change path did not.
- A refreshed watch page sometimes exposed the URL before the title metadata was ready.

Code changes committed directly to `main`:
- `9adcea9` — define typed capture commands, capture status, and caption-segment messages.
- `c6b1491` — add pure YouTube watch-context parser.
- `3dbf431` — add unit tests for YouTube URL/title parsing and caption whitespace.
- `00b6b04` — expand YouTube content-script matching to the full host, refresh context on YouTube SPA events/title changes, and add user-started visible-caption observation.
- `9b2c4cd` — update Manifest V3 content-script matching and run timing.
- `b0dd056` — route capture commands and validate active capture tab in the service worker; serialize context storage writes.
- `be51121` — add WebVTT serialization for locally persisted captured caption segments.
- `f299b68` — make automatic visible-caption capture the primary side-panel workflow; move transcript import to optional fallback; add automatic local saves.
- `711d2c7` — add capture status and transcript interface styling.
- `d74815f` — add transcript serialization round-trip tests.
- `09522ad`, `8e688fe`, `358d001` — update PRD and implementation plan for automatic capture and separate audio transcription.

Current implemented behavior:
- Learner selects **Start learning** in the side panel.
- LearnLens observes captions actually rendered by the YouTube player; learner may need to enable CC.
- New caption segments appear in the side panel and are automatically saved in IndexedDB as WebVTT.
- Captured segments are passed into the existing tutor context without a file import.
- Manual VTT/SRT/TXT import is retained only as a fallback.
- Capture stops when the learner stops it, the learner changes tabs, or the same tab navigates to a different video.

Important limitation:
- This is automatic *visible-caption capture*, not yet audio-only speech recognition. It cannot transcribe a video when YouTube does not render captions.
- Chrome tab audio capture requires explicit learner action. Firebase AI Logic audio transcription is a cloud path; Firebase AI Logic Live API is Preview and does not provide hybrid/on-device inference. Do not upload lesson audio silently or claim this is implemented.
- Do not call this change fully verified until CI passes and Chrome runtime tests cover SPA navigation, captions on/off, persistence, tab switch, and stop behavior.

Next exact task:
1. Verify the latest main-branch GitHub Actions run; fix any type/test/build failures.
2. Provide the updated extension artifact for Chrome runtime testing.
3. Test same-tab navigation and the new Start learning → visible captions → auto-save → Ask tutor workflow.
4. Only after runtime validation, design and implement audio-only transcription with separate consent and App Check.
