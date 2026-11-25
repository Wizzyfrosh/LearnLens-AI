# LearnLens AI — Implementation Plan

The current checkpoint is in PROJECT_STATUS.md. Update both documents whenever work progresses.

## 1. Delivery strategy

Build and verify one working vertical slice first:

**YouTube detection → transcript ingestion → Firebase AI Logic → grounded answer + actual inference source.**

Do not add learning artifacts until transcript ingestion and AI grounding are reliable.

## 2. Module boundaries

| Module | Responsibility | Current state |
|---|---|---|
| Extension shell | MV3 manifest, action, side panel, background worker | Scaffold; Chrome runtime QA pending |
| Video context | YouTube page metadata and navigation | Basic implementation |
| Platform adapters | YouTube/TikTok/Facebook capability adapters | Not formalized |
| Transcript engine | VTT/SRT/TXT parsing, validation, provenance, context | Validation and preview implemented; awaiting CI/runtime verification |
| AI engine | Firebase AI Logic, mode policy, prompt, source metadata | Adapter and SDK source mapping implemented; CI green on earlier commit |
| UI | Side panel and tutor interaction | Initial import/preview/tutor UI |
| Storage | IndexedDB and optional Firestore sync | Not implemented |
| Learning engine | Notes, bookmarks, quizzes, revision | Not implemented |
| Firebase setup | App Check, Remote Config, Auth, Firestore rules | Not configured/verified |

## 3. Phased roadmap

### Phase 0 — Repository baseline and governance
- [x] Confirm repository and main branch.
- [x] Add Apache-2.0 license.
- [x] Add README setup/capability notes.
- [x] Add GitHub Actions workflow.
- [ ] Confirm repo visibility and license metadata.
- [ ] Commit package lockfile and move CI to npm ci.
- [x] Get CI green for Firebase inference-source fix (commit b2884c2).
- [x] Add persistent project docs.

Exit: reproducible install; typecheck, tests, build pass on current main.

### Phase 1 — Stabilize extension foundation
- [x] Fix Firebase inference-source TypeScript error using SDK constants.
- [x] Pass typecheck, unit tests, production build on commit b2884c2.
- [ ] Verify current transcript work still passes CI.
- [ ] Verify manifest asset paths match Vite output.
- [ ] Load dist in Chrome without extension errors.
- [ ] Verify action opens side panel.
- [ ] Verify active YouTube tab and SPA navigation.
- [ ] Verify message lifecycle and worker suspension/restart.
- [ ] Remove or justify tab activation listener and permissions.
- [ ] Add stale-request handling and robust UI states.

Exit: current main passes CI and extension installs/detects YouTube context reliably.

### Phase 2 — Transcript-to-tutor vertical slice
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

### Phase 3 — YouTube caption acquisition
- [ ] Validate permitted caption acquisition path.
- [ ] Keep manual import fallback.
- [ ] Add capability detection and no-caption messaging.
- [ ] Preserve language/source/timestamp provenance.
- [ ] Test auto-generated captions, unavailable captions, login/region restrictions, and navigation.
- [ ] No hidden/private endpoint scraping.

Exit: automatic transcript works on a documented tested subset.

### Phase 4 — Local learning sessions, notes, and bookmarks
- [ ] Define IndexedDB schema and migrations for lesson sessions.
- [ ] Persist session metadata and learner-approved artifacts locally.
- [ ] Keep full transcripts local by default; define retention and clear controls.
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

The Firebase inference-source TypeScript error was fixed by comparing against the SDK's `InferenceSource` constants. CI passed on commit b2884c2.

Subsequent transcript parser, tests, and UI preview changes were committed to main:
- d025f82 — transcript format detection and validation
- 656bd3c — parser edge-case tests
- b93fe69 — transcript import validation and preview UI

The latest CI run for b93fe69 is pending at the time of this update. Check PROJECT_STATUS.md before assuming it passed.

## 6. Definition of done

A task is complete only when behavior is implemented, types compile, relevant tests pass, production build passes, runtime behavior is manually verified where applicable, and PROJECT_STATUS.md accurately records the evidence and remaining limitations.
