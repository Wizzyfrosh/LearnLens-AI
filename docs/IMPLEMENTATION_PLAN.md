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
| Audio transcription | Permissioned tab-audio capture and speech transcription | Not implemented; separate cloud-consent and hybrid-policy design required |
| Platform adapters | YouTube/TikTok/Facebook capability adapters | Not formalized |
| Transcript engine | Parsing, visible-caption capture, validation, provenance, context | Parser and live caption ingestion implemented; current CI/Chrome QA pending |
| AI engine | Firebase AI Logic, mode policy, prompt, source metadata | Adapter and SDK source mapping implemented; CI green on earlier commit |
| UI | Side panel and tutor interaction | Initial import/preview/tutor UI |
| Storage | IndexedDB local learning sessions; optional Firestore sync | Initial local save/restore/delete implemented; Chrome QA and integration tests pending |
| Learning engine | Notes, bookmarks, quizzes, revision | Not implemented |
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
- [ ] Configure and verify Firebase App Check for the Chrome extension origin before making any audio upload. Current Firebase configuration/App Check is not runtime verified.
- [ ] Add the `tabCapture` permission and explain the Chrome permission warning in product onboarding.
- [ ] Add a separate, unchecked-by-default consent control: lesson audio will be sent to Firebase AI Logic for transcription. Tutor inference preference does not imply audio-upload consent.
- [ ] Implement service-worker capture orchestration: verify active YouTube tab, enforce one capture at a time, request stream ID only from a user-initiated action, and stop on explicit stop, tab close, tab switch, or lesson change.
- [ ] Add an offscreen document with `USER_MEDIA` reason to consume the stream; preserve audible playback by routing the captured audio back to an AudioContext destination, as required by Chrome's tabCapture behavior.
- [ ] Record audio-only WebM chunks with MediaRecorder; validate browser-supported MIME type, chunk duration, byte size, and monotonic sequence IDs. Never capture video.
- [ ] Set a strict maximum chunk size comfortably below Firebase's 20 MB total request limit (including base64 expansion); serialize transcription requests to preserve order and bound memory.
- [ ] Use Firebase AI Logic audio-capable cloud model and a transcription-only prompt. Validate model output; do not accept arbitrary model timestamps unless audio timestamp generation is configured and verified.
- [ ] Emit transcript segments with source `audio-transcription`, accurate chunk start offsets, and explicit estimated/verified timestamp provenance.
- [ ] Persist transcript text locally; discard each raw audio chunk after its transcription succeeds. Do not store or sync raw audio by default.
- [ ] Handle pause/resume, seek, buffering, muted tab, no-speech chunks, duplicate/out-of-order chunks, request timeout, network failure, quota errors, App Check rejection, and user cancellation.
- [ ] Add tests for chunk ordering, size caps, duplicate suppression, stop cleanup, consent gating, and transcript normalization.

Exit: on a Chrome version/configuration with verified App Check and Firebase audio model access, a learner can explicitly consent, start audio transcription, see incremental transcript text, continue hearing the lesson, stop capture, and ask the tutor grounded questions. If cloud transcription is not configured or consent is absent, visible-caption capture remains the default and audio is never uploaded.
### Phase 4 — Local learning sessions, notes, and bookmarks
- [x] Define versioned IndexedDB schema and indexes for lesson sessions.
- [x] Persist sessions only after explicit learner save action.
- [x] Keep transcript data local; no cloud persistence.
- [x] Add remove-saved-copy action and restore latest matching session.
- [ ] Add IndexedDB integration tests and verify upgrade behavior in Chrome.
- [ ] Create/edit/delete/search notes.
- [ ] AI note drafts require user review.
- [ ] Link timestamps only when evidence exists.
- [ ] Add Markdown export and PDF if quality/time permits.
- [ ] Add tests.

Exit: learner can save, edit, revisit, clear, and export notes/bookmarks; sessions survive extension reloads.

### Phase 5 — Quiz and learning loop
- [ ] Define validated quiz/question schema.
- [ ] Generate MCQ, true/false, short-answer questions.
- [ ] Support whole lesson and selected range.
- [ ] Score objective questions and explain answers.
- [ ] Label open-ended AI feedback.
- [ ] Track attempts and weak topics.
- [ ] Test malformed model output and unsupported claims.

Exit: learner can complete quiz and review weak topics.

### Phase 6 — Optional cloud sync
- [ ] Add Firebase Auth when sync is ready.
- [ ] Define Firestore schema and per-user rules.
- [ ] Configure App Check and production-compatible attestation.
- [ ] Sync opted-in learning artifacts only; transcripts local by default.
- [ ] Add export/delete data workflows.
- [ ] Use Remote Config for safe rollout if needed.
- [ ] Test offline, conflict handling, sync, deletion.

Exit: secure optional sync without cross-user data exposure.

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
