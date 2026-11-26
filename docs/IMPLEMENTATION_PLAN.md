# LearnLens AI — Implementation Plan

The current checkpoint is in PROJECT_STATUS.md. Update both documents whenever work progresses.

## 1. Delivery strategy

Build and verify one working vertical slice first:

**YouTube SPA detection → user-started caption capture → local transcript → Firebase AI Logic tutor → grounded answer + actual inference source.**

Do not add learning artifacts until transcript ingestion and AI grounding are reliable.

## 2. Module boundaries

| Module | Responsibility | Current state |
|---|---|---|
| Extension shell | MV3 manifest, action, side panel, background worker | Scaffold; Chrome runtime QA pending |
| Video context | YouTube page metadata and SPA navigation | Context parser and route-wide content script implemented; Chrome QA pending |
| Lesson capture | User-started visible caption capture | First implementation in code; Chrome QA pending |
| Audio transcription | Permissioned tab-audio capture, PCM chunking, Firebase transcription | Capture pipeline and consent UI implemented in code; Firebase/App Check setup and runtime QA pending |
| Platform adapters | YouTube/TikTok/Facebook capability adapters | Not formalized |
| Transcript engine | Parsing, visible-caption capture, validation, provenance, context | Parser and live caption ingestion implemented; current CI/Chrome QA pending |
| AI engine | Firebase AI Logic, mode policy, prompt, source metadata | Adapter and SDK source mapping implemented; CI green on earlier commit |
| UI | Side panel and tutor interaction | Initial import/preview/tutor UI |
| Storage | IndexedDB local sessions, timestamp-free notes, quizzes, and attempts; optional Firestore sync | Version 5 schema; migration and persistence tests pass; Chrome QA pending |
| Learning engine | Study notes, quiz generation, grading, attempt review, and topic revision | Implemented in code; automated tests pass; Chrome QA pending |
| Firebase setup | App Check, Remote Config, Auth, Firestore rules | Not configured/verified |

## 3. Phased roadmap

### Phase 0 — Repository baseline and governance
- [x] Confirm repository and main branch.
- [x] Add Apache-2.0 license.
- [x] Add README setup/capability notes.
- [x] Add GitHub Actions workflow.
- [ ] Confirm repo visibility and license metadata.
- [ ] Generate and commit a package lockfile from the actual dependency graph, then move CI to npm ci.
- [x] Get CI green for Firebase inference-source fix (commit b2884c2).
- [x] Add persistent project docs.

Exit: reproducible install; typecheck, tests, build pass on current main.

### Phase 1 — Stabilize extension foundation
- [x] Fix Firebase inference-source TypeScript error using SDK constants.
- [x] Pass typecheck, unit tests, production build on commit b2884c2.
- [x] Verify transcript ingestion, IndexedDB implementation, and extension package smoke check pass CI (run 45563356591).
- [x] Verify manifest asset paths match Vite output in CI.
- [ ] Load dist in Chrome without extension errors.
- [ ] Verify action opens side panel.
- [x] Synchronize active tab context changes to the open side panel; verify active tab identity in background before accepting content-script context.
- [ ] Verify active YouTube tab and SPA navigation in Chrome.
- [ ] Verify same-tab route changes from YouTube home/search/watch and delayed title rendering.
- [ ] Verify message lifecycle and worker suspension/restart in Chrome.
- [ ] Remove or justify tab activation listener and permissions.
- [ ] Add stale-request handling and robust UI states.

Exit: current main passes CI and extension installs/detects YouTube context reliably.

### Phase 2 — Automatic visible-caption-to-tutor vertical slice
- [x] Add VTT/SRT/plain-text format detection.
- [x] Reject empty and oversized transcript input.
- [x] Validate timed cues and report skipped malformed cues.
- [x] Add source label and transcript preview to UI.
- [x] Expand parser unit tests.
- [ ] Verify parser against real caption files in Chrome.
- [ ] Verify Firebase SDK/model identifier against current docs.
- [ ] Configure Firebase AI Logic and App Check.
- [ ] Test local inference on supported Chrome desktop.
- [ ] Test cloud, fallback, unavailable local model, quota/network failures.
- [ ] Test transcript grounding and no invented timestamps.
- [ ] Display actual inference source.

Exit: real learner question gets grounded answer; local/cloud paths tested and honestly labeled.

### Phase 3 — Audio-based transcription (after visible-caption QA)

**Technical decision (2026-11-25):** use Chrome `tabCapture` initiated only by a learner action, with a Manifest V3 offscreen document to own the media stream. Process bounded audio chunks through Firebase AI Logic's documented audio-input `generateContent` capability. This is a cloud transcription path; it is separate from the tutor's hybrid/on-device preference and requires a dedicated, explicit cloud-audio consent. Do not label it on-device or hybrid.

Evidence:
- Chrome documents `chrome.tabCapture.getMediaStreamId()` in the extension service worker after a user gesture, then consuming that stream in an offscreen document. See https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture
- Firebase AI Logic documents audio transcription using inline audio data with `generateContent`; supported current models include `gemini-4-hydrogen`, `gemini-3.8-flash`, and `gemini-3.5-flash-lite`. Inline request size limit is 20 MB. See https://firebase.google.com/docs/ai-logic/analyze-audio
- Audio-only timestamp generation requires the `audio_timestamp` generation parameter; timestamps must not be fabricated if the selected SDK/model configuration cannot provide them. See https://firebase.google.com/docs/ai-logic/input-file-requirements

Implementation tasks:
- [ ] Configure Firebase project values through GitHub Actions secrets and verify Firebase App Check debug token registration before audio upload. Current Firebase configuration/App Check is not runtime verified.
- [x] Add the `tabCapture` and `offscreen` permissions; explain the Chrome permission warning in the audio consent UI.
- [ ] Add a separate, unchecked-by-default consent control: lesson audio will be sent to Firebase AI Logic for transcription. Tutor inference preference does not imply audio-upload consent.
- [x] Implement service-worker capture orchestration: verify active YouTube tab, enforce one capture at a time, request stream ID from the side-panel click gesture, and stop on explicit stop, tab close, tab switch, or lesson change.
- [ ] Add an offscreen document with `USER_MEDIA` reason to consume the stream; preserve audible playback by routing the captured audio back to an AudioContext destination, as required by Chrome's tabCapture behavior.
- [x] Capture audio-only PCM using AudioWorklet and encode each independent four-second chunk as WAV; enforce a 1.5 MB raw chunk limit and monotonic sequence IDs. Never capture video.
- [ ] Set a strict maximum chunk size comfortably below Firebase's 20 MB total request limit (including base64 expansion); serialize transcription requests to preserve order and bound memory.
- [x] Add Firebase AI Logic cloud transcription using an audio-capable model and transcription-only prompt; timestamp claims remain disabled for audio-only chunks until verified timestamp output is configured.
- [x] Emit transcript segments with source `audio-transcription`; no lesson timestamps are claimed for audio-only output.
- [x] Persist transcript text locally; process raw audio chunks in memory and do not store or sync audio files.
- [ ] Runtime-test pause/resume, seek, buffering, muted tab, no-speech chunks, duplicate/out-of-order chunks, request timeout, network failure, quota errors, App Check rejection, and user cancellation.
- [x] Add unit tests for WAV encoding, PCM format, sample-rate validation, and chunk-size bounds.
- [ ] Add integration tests for chunk ordering, duplicate suppression, stop cleanup, consent gating, and transcript normalization.

Exit: on a Chrome version/configuration with verified App Check and Firebase audio model access, a learner can explicitly consent, start audio transcription, see incremental transcript text, continue hearing the lesson, stop capture, and ask the tutor grounded questions. If cloud transcription is not configured or consent is absent, visible-caption capture remains the default and audio is never uploaded.
### Phase 4 — Local learning sessions and study notes
- [x] Define the versioned IndexedDB schema for lesson sessions, notes, quizzes, and quiz attempts.
- [x] Persist live lesson transcripts locally and restore the latest saved lesson when no matching active video is open.
- [x] Provide saved-lesson history and manual restore.
- [x] Cascade-delete a removed lesson's notes, quizzes, and quiz attempts.
- [x] Create, edit, delete, and search timestamp-free study notes.
- [x] Autosave note edits locally; AI-generated study notes are saved as note records automatically.
- [x] Generate natural, structured study notes without transcript timestamp/cue labels.
- [x] Export saved notes as PDF (print dialog / Save as PDF), Word-compatible DOC, TXT, Markdown, and CSV.
- [x] Upgrade IndexedDB from schema v4 to v5, retaining notes and quiz history while removing note timestamp fields and the retired bookmark object store.
- [x] Add migration tests for v3 and v4 databases, including preservation of v4 notes, quizzes, and attempts.
- [x] Verify the new notes experience in desktop Chrome: schema migration, extension reload, lesson restore, generated-note persistence, editing/autosave, deletion, and all export formats.

**Decision:** Timestamp bookmarks were removed because the learner wants one saved-notes workflow. The v5 migration deletes the legacy bookmark store; existing notes and quiz history are retained.

Exit: Phase 4 implementation, automated checks, and desktop Chrome runtime verification passed. Phase 4 is complete.

### Phase 5 — Quiz and learning loop
- [x] Define validated quiz/question and attempt schemas.
- [x] Generate multiple-choice, true/false, and short-answer questions.
- [x] Support whole-lesson, topic-focused, and timestamp-range quizzes.
- [x] Validate AI JSON, answer options, unique IDs, transcript evidence, and correct answers.
- [x] Normalize timestamp labels in transcript evidence validation; timestamped evidence regression test passes.
- [x] Score objective questions and store answer-level feedback and short-answer advisory feedback.
- [x] Show the correct option with a green check and a wrong selected option in red after submission.
- [x] Show whether each answer is correct, the correct answer when needed, and an explanation.
- [x] Persist quiz definitions and attempts locally.
- [x] Add quiz-history review so previous attempts reopen with their original answers and feedback.
- [x] Track topics to revisit and keep open-ended AI feedback separate from objective scoring.
- [x] Add unit tests for invalid AI output, unsupported evidence/options, objective scoring, feedback validation, and IndexedDB quiz/attempt persistence.
- [x] Verify updated answer-state visuals and saved-attempt review in desktop Chrome.

Exit: Phase 5 implementation, automated checks, and desktop Chrome runtime verification passed. Phase 5 is complete.


### Phase 6 — Optional cloud sync

**Phase boundary:** Keep LearnLens local-first. A learner must be able to use lessons, notes, quizzes, and attempts without signing in. Cloud sync is an explicit opt-in and must never silently upload lesson transcripts or raw audio.

**Phase 6A — Security and data design (do first)**
- [x] Audit the current IndexedDB stores and define a versioned cloud DTO for each syncable artifact; do not upload internal IndexedDB records blindly.
- [x] Decide the initial sync scope: notes, quiz definitions, quiz attempts, and minimal lesson metadata only. Transcript segments and raw audio remain device-local by default.
- [x] Define stable per-user document paths, ownership fields, schema versions, server timestamps, and size limits.
- [x] Define deletion/tombstone behavior so deletes propagate across devices without resurrecting stale records.
- [x] Define revision-based conflict handling that does not rely on client clocks, and document user-visible behavior for concurrent edits.
- [x] Threat-model account switching, stale credentials, replayed writes, cross-user reads, offline queues, and partial sync failures.

**Phase 6A exit:** Completed in `docs/CLOUD_SYNC_DATA_MODEL.md`. Phase 6B can begin with email/password Auth and emulator-only Rules work. Production sync remains blocked until the extension App Check strategy is proven.

**Phase 6B — Identity and Firebase security**
- [x] Add Firebase Auth behind a dedicated auth service; share Firebase app initialization with the AI adapter.
- [x] Implement email/password sign-in, account creation, sign-out, session restoration, verification-email resend/check, password reset, and Account workspace UI. Signed-out local use remains available.
- [x] Choose and document email/password as the first sign-in method, including email verification and password reset; defer OAuth popup/redirect providers.
- [x] Add deny-by-default Firestore rules; only a verified user can access their own strictly validated sync-settings document. Lesson/artifact paths remain denied until sync is implemented.
- [x] Add Firestore Emulator tests for unauthenticated access, verified/unverified users, cross-user access, malformed settings, timestamp validation, and denied artifact paths.
- [ ] Enable Email/Password in the live Firebase Console project and verify create/sign-in/verification/reset/session restoration in desktop Chrome.
- [ ] Resolve production-compatible App Check for a Chrome extension before enabling sync. The existing debug-token provider is development-only and is not an acceptable production control.
- [x] Keep Firestore rules and Firebase configuration files under version control; never commit service-account credentials or debug tokens.

**Phase 6B implementation checkpoint:** Code and emulator coverage are in place. Live Firebase project configuration and desktop Chrome account-flow verification remain open. See `docs/PHASE6B_AUTH_SETUP.md`. Production sync remains blocked by the App Check decision.

**Phase 6C — Opt-in sync engine and user controls**
- [ ] Add an explicit sync opt-in and clear explanation of which artifact types leave the device.
- [ ] Keep transcript sync disabled by default; do not upload raw audio.
- [ ] Implement bounded, batched, retryable sync with idempotent writes and backoff.
- [ ] Handle offline edits, conflict resolution, tombstones, account sign-out, and switching accounts without leaking one account's cached data into another.
- [ ] Add per-user export and account-data deletion workflows, including cloud and local data.
- [ ] Use Remote Config only if it materially improves staged rollout; it is not a substitute for security rules.
- [ ] Test multi-device sync, offline/online transitions, duplicate retries, conflict resolution, deletion propagation, and account switching.

Exit: optional sync works across devices with explicit consent, production-appropriate App Check, deny-by-default tested Firestore rules, no cross-user data exposure, and local-only use remains fully functional.

### Phase 7 — Platform expansion
- [ ] Define formal PlatformAdapter interface.
- [ ] Evaluate TikTok access under official terms.
- [ ] Evaluate Facebook access under official terms.
- [ ] Add adapters only after real transcript access is tested.
- [ ] Provide manual import fallback on unsupported pages.
- [ ] Publish capability matrix.

Exit: each supported platform has tested, truthful capabilities.

### Phase 8 — Hackathon hardening and submission
- [ ] Clean install, typecheck, tests, production build, Chrome QA.
- [ ] Verify Firebase AI Logic runtime and App Check.
- [ ] Verify local/cloud inference and actual source metadata.
- [ ] Test clean supported Chrome environment.
- [ ] Security/privacy/permission/secrets review.
- [ ] Verify public repo and license metadata.
- [ ] Write Devpost description and contest-period build summary.
- [ ] Public YouTube demo <= 3 minutes, English or subtitles.
- [ ] Provide test instructions and working build.
- [ ] Submit before deadline; re-check rules/time zone.
- [ ] Freeze features before deadline.

Exit: mandatory contest requirements satisfied and demo matches working product.

## 4. Engineering standards

- Use small commits: feat, fix, test, docs, chore, security.
- Do not force-push main.
- Never commit .env.local, tokens, private keys, or user data.
- Commit package-lock.json and use npm ci in CI.
- Avoid --legacy-peer-deps unless a documented conflict requires it.
- Every meaningful change runs npm run typecheck, npm test, npm run build.
- Extension changes also require manual Load unpacked testing in Chrome.
- CI success is necessary but not sufficient for browser runtime correctness.
- Use least-privilege permissions and validate AI output.

## 5. Current checkpoint

The Firebase inference-source TypeScript error was fixed by comparing against the SDK's `InferenceSource` constants. CI passed on commit b2884c2. The current active implementation checkpoint is recorded below.

Subsequent transcript parser, tests, and UI preview changes were committed to main:
- d025f82 — transcript format detection and validation
- 656bd3c — parser edge-case tests
- b93fe69 — transcript import validation and preview UI

The transcript ingestion UI/parser work passed CI on commit 1b077baa33d7f097e87771f8a2dc45fda44c78cd (typecheck, unit tests, production build). The IndexedDB session store and UI changes are included in green CI run https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/45561154300 (typecheck, unit tests, production build all passed). Chrome runtime QA and IndexedDB behavior still require manual verification.

## 6. Definition of done

A task is complete only when behavior is implemented, types compile, relevant tests pass, production build passes, runtime behavior is manually verified where applicable, and PROJECT_STATUS.md accurately records the evidence and remaining limitations.


## 7. Session update — 2026-11-25 (continued)
- Latest green CI: run 45563356591, commit 5398e512007a7447f7648eb9d2a24f13b73352ec. Typecheck, unit tests, production build, and extension package smoke validation passed.
- Follow-up commit ed4f642 ignores inactive-tab URL changes when synchronizing active lesson context; CI pending at time of update.
- Runtime QA in Chrome remains a manual blocker. CI package validation is not equivalent to loading the extension.
- Reproducibility blocker: no package-lock.json exists. Generate it with npm against the actual dependency graph; never fabricate one.


## 8. Session update — 2026-11-25 (active context sync)
A runtime review found that the side panel read active-tab context only once at mount, so background tab changes could leave the panel showing stale video state. The content script also needed sender-tab validation to prevent inactive tabs from publishing context.

Commits a708e78, f107d34, and 308307d add a typed context-change message, validate content-script sender tab against the active tab, broadcast active context changes, resync on window focus, and subscribe from the side panel. On video changes the panel clears the previous video transcript before attempting to restore the matching saved session. Latest CI and manual Chrome QA are required before considering this fixed.


## 9. Automatic lesson capture implementation checkpoint — 2026-11-25

Implemented directly on `main`:
- Content script now matches the full YouTube host instead of only URLs matching `/watch*`, allowing it to remain present when YouTube navigates from the home page to a watch page through its SPA.
- Added a pure, tested YouTube context reader. It rejects unsupported routes and resolves title from the rendered watch heading, then document title, then a safe fallback.
- Added refresh triggers for YouTube navigation lifecycle events, history navigation, and document-title changes, with short delayed retries to account for asynchronous title rendering.
- Added learner-started visible-caption capture using a MutationObserver on YouTube's rendered caption container.
- Added capture start/stop routing through the extension service worker; capture messages are accepted only from the active capture tab.
- Live caption segments feed the existing tutor context and are automatically saved as WebVTT in IndexedDB.
- Manual transcript import has been moved into an optional fallback disclosure.

Important limitation: this implementation reads captions rendered by the YouTube player. It does not yet transcribe audio when captions are unavailable or disabled. The next separate phase is explicit tab-audio capture plus a consented cloud transcription path, not a silent or assumed on-device capability. See the PRD's automatic-capture change section.

Next exit criteria:
1. Current main passes typecheck, unit tests, production build, and extension package smoke check.
2. Chrome runtime confirms same-tab SPA video changes refresh title and video ID without tab switching.
3. Chrome runtime confirms visible captions are captured, displayed, persisted, restored, and usable by tutor.
4. Capture stops cleanly on user request, tab switch, and lesson change.


## 10. Session update — 2026-11-26 (notes and quiz review)
- Commits: b14c7ab (IndexedDB v5 and bookmark-store retirement), 3141566 (notes-only storage tests), edc1696 (notes autosave, restore, exports, quiz review UI), f76a6ab (notes/quiz visual states), cedaf44 (test fixture correction), baca2a0 (v4 migration test), d971b2e (PDF export user-gesture handling).
- Phase 4 changes: remove separate timestamp bookmarks, migrate legacy notes to remove timestamp fields, preserve v4 notes/quizzes/attempts, auto-save AI-generated and edited notes, restore latest saved lesson on a non-YouTube tab, and export notes in PDF/Word-compatible DOC/TXT/Markdown/CSV.
- Phase 5 changes: clear red/green objective grading states, explanatory feedback, and review controls for saved attempts.
- CI: run 45881850569 passed TypeScript typecheck, unit tests, production build, Chrome package verification, and artifact upload on commit d971b2e8e73b80a2a2b38caf1c9609e741e68fa5.
- Artifact: learnlens-chrome-extension, artifact ID 15148465175. Manifest/package version remains 0.1.0.
- Runtime: the user previously confirmed lesson capture/notes and quiz generation worked, but the newly changed persistence, export, grading visuals, and attempt-review UI still require one desktop Chrome smoke test. Do not mark Phase 4/5 signed off until that test passes.


## 11. Follow-up implementation — 2026-11-26 (note navigation and 10-question quizzes)
- Notes now use a title navigation list and a single selected-note editor rather than rendering every saved note's full body at once.
- Selecting a note opens it in the editor; the export control exports only that selected note and uses its title in the filename.
- Note list search, autosave, editing, delete, AI note generation, and all five export formats are retained.
- Quiz generation now requires each multiple-choice and short-answer answer key to be a verbatim contiguous phrase from transcript text, increases cloud output budget, and makes up to two validation repair attempts after the initial generation.
- Added a 10-question transcript-grounded quiz validation regression test.
- CI: run 45886269511 passed typecheck, unit tests, production build, Chrome package verification, and artifact upload.
- User completed desktop Chrome runtime testing of the updated notes navigation, selected-note exports, and 10-question quiz generation; all tested behaviors passed. Phase 4 and Phase 5 are signed off.


## 12. Phase 4–5 runtime sign-off — 2026-11-26
- User confirmed all Phase 4 and Phase 5 runtime tests passed in desktop Chrome.
- Confirmed areas include note navigation and selected-note-only exports, plus successful 10-question quiz generation with transcript-grounded answer validation.
- Phase 4 and Phase 5 are complete. Do not reopen their smoke tests unless a regression is reported.
- Next roadmap phase: Phase 6 — Optional cloud sync. Keep cloud sync opt-in; do not change the local-first default or upload lesson transcripts by default.


## 13. Phase 6 architecture guardrails — 2026-11-26
- Repository review found Firebase AI Logic/App Check development wiring, but no Firebase Auth, Firestore rules, or Firebase project config files in the repository root.
- The current App Check setup explicitly uses a debug token. This is development-only and must not be reused as production protection for cloud sync.
- Phase 6 must begin with a security/data-model design and a production-compatible App Check decision, before any sync writes are implemented.
- Preserve the existing local-first IndexedDB workflow. Initial cloud scope should be limited to opted-in notes, quizzes, attempts, and minimal lesson metadata; transcript segments and raw audio remain local by default.


## 14. Phase 6A data model completed — 2026-11-26
- Audited schema v5 in `src/services/session-store.ts`: learningSessions, learningNotes, learningQuizzes, and quizAttempts are the active stores; learningBookmarks was retired in v5.
- Added `docs/CLOUD_SYNC_DATA_MODEL.md` with allow-listed DTOs, per-user Firestore paths, revision-based conflict rules, tombstones, local outbox design, account-switch safeguards, and a threat model.
- Selected email/password as the first Auth method using the Firebase `firebase/auth/web-extension` entry point; verification and password reset are required. OAuth popup/redirect is deferred.
- Phase 6A is complete. No Auth, Firestore writes, sync UI, or cloud sync code has been implemented yet.
- App Check remains a production blocker: Firebase's web documentation does not establish that the Chrome extension origin is accepted by reCAPTCHA Enterprise. A real installed-extension attestation spike is required before sync enforcement.


## 15. Phase 6B implementation — 2026-11-26
- Added shared Firebase app initialization in `src/services/firebase-app.ts`; Firebase AI Logic and the new Auth service use the same default app instance.
- Added `src/services/firebase-auth.ts` using the Manifest V3 `firebase/auth/web-extension` entry point: email/password account creation/sign-in, email verification/resend/reload, password reset, sign-out, and friendly error mapping.
- Added an optional Account workspace in the side panel. Authentication does not enable sync or upload local learning data; local-only use remains available while signed out.
- Added Identity Toolkit/Secure Token host permissions required for email/password Auth.
- Added `firestore.rules` with deny-by-default behavior. A verified user can access only their own strictly validated `settings/sync` document; every artifact path remains denied until the sync engine is implemented.
- Added Firestore Emulator configuration and eight rules tests. The CI run executed all eight tests successfully.
- Live Firebase Console provider setup and desktop Chrome Auth flow verification are still pending. Production App Check remains a release blocker for cloud sync.


## 16. Phase 6C — local sync foundation — 2026-11-26

**Implemented**
- Upgraded IndexedDB from schema v5 to v6, adding `syncMetadata`, `syncOutbox`, and `syncDevice`. The migration leaves existing lesson transcripts, notes, quizzes, and attempts unchanged and creates no account claims or queued writes automatically.
- Added explicit account-bound metadata claiming. An entity already claimed by one UID cannot be reassigned to another UID.
- Added a coalescing outbox primitive with stable operation IDs across same-operation retries, bounded retry metadata, base revisions, stale-ack rejection, and cancellation of an upsert that has never reached the server when its local record is deleted.
- Added a stable installation-scoped device ID. It is a local identifier only, not an authentication factor.
- Added allow-listed DTO mappers for minimal lesson metadata, notes, quiz definitions, and quiz attempts. Full transcript text, transcript format/source, raw audio, and unknown local fields are not projected.
- Lesson URLs are canonicalized to YouTube watch URLs; unsafe/non-YouTube URLs are omitted. Oversized DTOs and invalid timestamps are rejected rather than truncated.
- Added regression tests for v5→v6 preservation, account ownership, outbox coalescing/acknowledgement, stale acknowledgements, unsynced deletion, device ID persistence, DTO allow-lists, URL sanitization, timestamps, and payload size limits.

**Explicitly not implemented yet**
- Existing local save/delete operations are not yet atomically coupled to the outbox. The current APIs are foundation primitives only; no automatic enqueue occurs.
- No account-claim preview, sync consent UI, background sync runner, Firestore artifact writes, pull cursor, conflict resolver, or tombstone propagation is enabled.
- Live Firebase Auth setup and production-compatible App Check remain release gates.

**Safety boundary**
- No Firestore learning-artifact writes were added. Do not enable sync until mutation/outbox atomicity, opt-in controls, account-switch isolation, live Auth QA, and production App Check are verified.
- Extension/package version remains 0.1.0.
