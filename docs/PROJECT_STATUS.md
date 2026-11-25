# LearnLens AI — Project Status and Continuity Checklist

**Last repository inspection:** 2026-11-25  
**Repository:** https://github.com/Wizzyfrosh/LearnLens-AI  
**Branch:** main  
**Current phase:** Phase 0 baseline; Phase 1 foundation stabilization in progress.

> This is the first file every returning developer or AI agent must read. File existence does not prove runtime completion. Verify against code and CI.

## 1. Current checkpoint

**Vertical slice:** YouTube page detection → transcript import → Firebase AI Logic tutor → answer with actual inference source.

**Next exact task:** Fix the Firebase SDK inference-source TypeScript error, rerun CI, then validate the built extension in Chrome.

### Latest inspected CI evidence
- Run: https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/45559432781
- Result: FAILED.
- Dependency installation succeeded.
- Typecheck failed in src/services/firebase-ai.ts at comparisons against "ON_DEVICE" and "IN_CLOUD".
- Unit tests and production build were skipped after typecheck failed.
- Do not describe CI/build as passing.

## 2. Completed / code present

- [x] Repository Wizzyfrosh/LearnLens-AI and main branch.
- [x] Product name/tagline established.
- [x] Chrome Manifest V3 manifest.
- [x] React + TypeScript + Vite + Tailwind scaffold.
- [x] Side Panel entry point.
- [x] Basic YouTube watch-page content script capturing video ID/title/URL.
- [x] Background message handling for video context.
- [x] VTT/SRT/plain-text parser.
- [x] Explicit timestamp-presence metadata; plain text does not get fake timestamps.
- [x] Context-window builder with character limit.
- [x] Initial Vitest transcript tests.
- [x] Firebase AI Logic adapter calls generateContent.
- [x] Inference preferences in code: prefer on-device, on-device-only, cloud-only.
- [x] UI attempts to show SDK inference source (mapping currently fails typecheck).
- [x] UI disclosure that prefer-on-device may fall back to cloud.
- [x] GitHub Actions typecheck/test/build workflow.
- [x] Apache-2.0 LICENSE file.
- [x] README setup and capability limitations.
- [x] .env.example Firebase client configuration placeholders.
- [x] Manifest currently declares sidePanel, activeTab, storage permissions.

## 3. In progress / requires verification

- [ ] Fix inference-source enum/type mapping.
- [ ] Get green typecheck.
- [ ] Run Vitest successfully in CI.
- [ ] Run production build successfully in CI.
- [ ] Verify dist includes manifest, side panel HTML, background worker, and content script at referenced paths.
- [ ] Load dist in Chrome.
- [ ] Verify extension action opens side panel.
- [ ] Verify current YouTube tab detection and SPA navigation.
- [ ] Verify message lifecycle and service-worker behavior.
- [ ] Verify transcript import in actual Chrome UI.
- [ ] Configure Firebase project and Firebase AI Logic.
- [ ] Configure App Check and test real model requests.
- [ ] Test on-device inference on supported Chrome desktop.
- [ ] Test cloud mode and hybrid fallback.
- [ ] Confirm on-device-only never falls back to cloud.

## 4. Not implemented

- [ ] Automatic YouTube transcript/caption retrieval.
- [ ] Formal platform adapter interface.
- [ ] TikTok adapter and validated transcript access.
- [ ] Facebook adapter and validated transcript access.
- [ ] Transcript preview/source provenance UI.
- [ ] Timestamp-aware note creation/edit/delete.
- [ ] Notes export (Markdown/PDF).
- [ ] Timestamp bookmarks and player seek.
- [ ] Quiz generation, quiz taking, scoring, explanations.
- [ ] Learning history/dashboard and weak-topic revision.
- [ ] IndexedDB persistence.
- [ ] Firebase Authentication.
- [ ] Firestore sync and security rules.
- [ ] Remote Config.
- [ ] Account/data export and deletion.
- [ ] Android companion.
- [ ] Public demo video.
- [ ] Devpost submission.

## 5. Immediate task queue

### Task 1 — Fix CI type error (BLOCKING)
- [ ] Inspect Firebase SDK version and InferenceSource declarations.
- [ ] Use the actual SDK enum/type members.
- [ ] Keep source display based on actual response metadata.
- [ ] Avoid blanket any casts.
- [ ] Commit fix and rerun CI.

Acceptance: typecheck passes and tests/build are no longer skipped.

### Task 2 — Make extension load
- [ ] Inspect vite.config.ts output and manifest paths.
- [ ] Verify dist/manifest.json, sidepanel HTML, background worker, and YouTube content script exist at exact paths.
- [ ] Fix build/manifest mismatch if present.
- [ ] Load unpacked in Chrome.
- [ ] Test side panel and YouTube context detection.

Acceptance: extension installs without errors and detects a real YouTube watch page.

### Task 3 — Configure Firebase and validate runtime AI
- [ ] Create/configure Firebase project.
- [ ] Enable Firebase AI Logic.
- [ ] Configure App Check for development/judge testing.
- [ ] Add Firebase Web App values to .env.local only; never commit it.
- [ ] Verify supported model identifier.
- [ ] Test cloud inference.
- [ ] Test local inference on supported Chrome desktop.
- [ ] Test local-only failure and hybrid fallback.
- [ ] Record actual inference-source evidence.

Acceptance: a real transcript question receives a grounded response and actual inference source is shown.

### Task 4 — Improve transcript ingestion
- [ ] Malformed/oversized input handling.
- [ ] Transcript preview and provenance.
- [ ] Parser edge-case tests.
- [ ] Research compliant YouTube caption acquisition.

### Task 5 — Build learning artifacts
- [ ] Notes.
- [ ] Bookmarks.
- [ ] Quiz generation and attempts.
- [ ] Local persistence.
- [ ] Optional sync after security design.

### Task 6 — Submission
- [ ] Clean install and full test/build.
- [ ] Privacy/security review.
- [ ] Devpost description and contest-period build summary.
- [ ] Public YouTube demo under three minutes.
- [ ] Public repo and judging instructions.
- [ ] Submit before official deadline.

## 6. Known caveats

1. Firebase inference-source comparison currently fails TypeScript. Resolve against SDK declarations.
2. Automatic transcript retrieval is not implemented; manual VTT/SRT/TXT is the current path.
3. YouTube detection is basic; TikTok and Facebook are not implemented.
4. Firebase project/App Check are not configured or runtime-verified.
5. Current UI state is in memory; persistent lesson history is not implemented.
6. CI currently fails at typecheck; tests/build not verified on latest run.
7. Vite build alone does not prove Chrome extension runtime correctness.
8. Review background worker's tab activation listener against declared permissions; remove or justify and keep permissions minimal.
9. Do not claim offline support until model setup and local inference are tested.

## 7. Session update template

At the end of every session update:
- Date:
- Commit(s):
- Tasks completed:
- Tests run and exact results:
- Browser/runtime verification:
- Known failures/blockers:
- Next exact task:

Do not remove blockers until verified fixed.

## 8. Document map

- PRD.md — complete product requirements.
- HACKATHON_BRIEF.md — contest requirements and AI-agent handoff.
- IMPLEMENTATION_PLAN.md — phased engineering roadmap.
- PROJECT_STATUS.md — current checkpoint and checklist.
