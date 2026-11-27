# LearnLens AI — Project Status and Continuity Checklist

**Last updated:** 2026-11-27  
**Repository:** https://github.com/Wizzyfrosh/LearnLens-AI  
**Branch:** main  
**Extension version:** 0.1.0  
**Current checkpoint:** Phases 4 and 5 are complete and user-confirmed in desktop Chrome. Phase 6.1 protocol, Phase 6.2 Firebase Functions backend, and Phase 6.3 local pull/remote recovery foundation are implemented and CI-verified. Phase 6.4 adds the Account consent-review UI, a separately gated client for the `updateSyncSettings` callable, and stricter server/Firestore validation. Latest source CI passed on commit `1002b6b5e8ff6353c0753d471a386df00180b148`. The Functions backend is not deployed. Cloud pull, artifact writes, and server-consent submission remain hard-disabled; no live Firebase pull, consent write, or artifact upload has occurred. Live Firebase Auth QA and production Chrome App Check remain release gates.

> Phase 4/5 behavior was manually tested by the user. Phase 6 source and emulator behavior is CI-verified only. The new Account inbox/recovery UI has not yet been manually tested in desktop Chrome, and no live Firebase or two-device sync test has been completed.

## 1. Latest verified build

- **CI run:** https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/46052131112
- **Commit:** `1002b6b5e8ff6353c0753d471a386df00180b148`
- **Result:** SUCCESS.
- **Passed:** TypeScript typecheck, 15 Vitest files / 167 unit tests, 11 Firestore Rules emulator tests, 26 Firebase Functions/Admin emulator tests, production build, Chrome extension package verification, and artifact upload.
- **Artifact:** `learnlens-chrome-extension` (artifact ID `15224413038`).
- **Artifact SHA-256:** `a70f59e4cc89a6722fd5f9143c5b5a70f8bef49c47e47518cea625e13aff7e8e`.
- **Artifact size:** 169,784 bytes.
- **Package/manifest version:** 0.1.0.
- **Important:** CI uses demo Firebase projects and the development App Check debug configuration. Passing CI does not prove a live deployment or production App Check compatibility.

## 2. Phase 4 — Study notes and local persistence

**Implemented**
- IndexedDB schema version 5 stores lessons, timestamp-free notes, quizzes, and quiz attempts.
- Existing version-4 notes, quizzes, and quiz attempts are retained during migration.
- Legacy note timestamp metadata is stripped and the separate timestamp-bookmark object store is deleted.
- Latest saved lesson can be restored even when the extension opens on a non-YouTube tab.
- Notes can be created, edited, deleted, and searched.
- Manual edits autosave locally; AI-generated study notes are automatically saved as note records.
- AI note generation asks for natural, structured educator-style notes and removes timestamp/cue labels.
- Saved notes export to PDF (browser print dialog), Word-compatible DOC, TXT, Markdown, and CSV.

**Bookmark decision**
- The separate bookmark feature was removed at the user's request. It was a jump-back marker to a timestamp, not a note-taking feature. New UI has no bookmark tab or caption bookmark buttons. The v5 migration removes old bookmark data; lesson notes and quiz history are preserved.

**Automated coverage**
- IndexedDB tests cover note persistence/CRUD, latest-session restore, schema upgrades, and cascade deletion.
- Version-3 and version-4 migration tests cover retention of lesson data; the version-4 case also checks preservation of quizzes and attempts while removing the bookmark store.

**Desktop Chrome verification — passed**
- Confirmed migration works against the installed v4 database.
- Confirmed generated notes persist across reload and lesson restore.
- Confirmed note editing/autosave, creation, navigation, and deletion.
- Confirmed the five export formats work and export only the selected note.

## 3. Phase 5 — Quiz system and learning loop

**Implemented**
- Quiz generation supports multiple choice, true/false, and short answers.
- Generation supports whole lesson, topic, and timestamp-range coverage.
- AI output is validated against the lesson transcript; timestamp labels are normalized during evidence comparison.
- Objective questions are scored locally; short-answer AI feedback is advisory and excluded from the objective score.
- Correct options display a green check; incorrect selected options display red after submission.
- Each graded question displays a clear result, correct answer where needed, and explanation.
- Quiz definitions and attempts persist locally.
- Quiz history includes a review action that reopens the saved quiz with the submitted answers and feedback.
- Weak topics are tracked for revision.

**Automated/user verification**
- Quiz evidence timestamp regression fix passed CI run 45874261486.
- The user confirmed quiz generation worked after that fix.
- Automated grading, history, and migration tests are included in the latest passing CI run.

**Desktop Chrome verification — passed**
- Confirmed quiz grading and answer feedback behavior.
- Confirmed correct/incorrect answer visual states.
- Confirmed answer explanations display correctly.
- Confirmed saved quiz attempts can be reopened with their original answers and feedback.

## 4. Phase 4–5 final acceptance — complete

- [x] Update/load the latest 0.1.0 extension package in desktop Chrome while retaining the existing extension identity where possible.
- [x] Confirm old saved lesson notes survive the v4 → v5 migration and no timestamp fields appear in notes.
- [x] Confirm generated and manually edited notes survive reload and can be reopened.
- [x] Confirm all five note export choices work.
- [x] Confirm there is no separate bookmark tab or bookmark control.
- [x] Confirm objective quiz grading colors, correct-answer indicators, and explanations.
- [x] Confirm Quiz history reopens a prior attempt with its stored answers and feedback.
- [x] Confirm existing lesson capture and tutor behavior still work after the update.

**Sign-off:** The user confirmed all applicable Phase 4 and Phase 5 checks passed in desktop Chrome. Both phases are complete.

## 5. Other roadmap boundaries

- Audio transcription/App Check runtime behavior must not be described as verified unless tested separately.
- TikTok/Facebook adapters, the cloud sync engine, and Android companion remain future work. Firebase Auth and the initial deny-by-default Firestore Rules are implemented, but live Auth QA and the production App Check gate remain open.
- Keep the extension version at 0.1.0 unless the user explicitly requests a version change.
- Never commit `.env.local`, API keys, App Check secrets, or private learner data.

## 6. Phase 6 — Optional cloud sync (Phase 6B in progress)

**Current state:** Phase 6A design and the initial Phase 6B Auth/Rules implementation are complete. The cloud sync engine and learning-artifact Firestore writes have not been implemented.

**Repository findings**
- Firebase AI Logic and development App Check wiring exist; a shared Firebase app module and Firebase email/password Auth service are now implemented.
- The existing App Check provider still explicitly uses a debug token. That is suitable only for controlled development/testing, not production sync protection.
- `firestore.rules` and `firebase.json` now configure deny-by-default rules and the Firestore Emulator. No `.firebaserc` has been bound to a live project and no live rules deployment has occurred.
- Email/Password must still be enabled in Firebase Console for the exact project referenced by the extension build secrets.
- The current IndexedDB workflow remains the source of truth for local learning data.

**Non-negotiable design constraints**
- Sign-in and cloud sync remain optional; signed-out learners retain full local functionality.
- Sync is explicit opt-in, with a clear explanation of what data leaves the device.
- Initial sync scope: notes, quiz definitions, quiz attempts, and minimal lesson metadata.
- Transcript segments and raw audio stay local by default; raw audio is never synced.
- Firestore rules must deny by default and enforce authenticated per-user ownership.
- Production-compatible App Check for a Chrome extension must be resolved before sync is enabled. Do not ship the debug-token provider as production attestation.
- Account switching, offline writes, conflict handling, deletion propagation, and local/cloud data export must be designed and tested.

**Next exact task:** Configure the Email/Password provider in the confirmed Firebase project, then run the Account-tab desktop Chrome tests in `docs/PHASE6B_AUTH_SETUP.md`. Do not deploy rules to a live project without confirming its project ID and reviewing the deny-by-default effect. Do not enable production sync until the extension App Check strategy is verified.


## 2026-11-26 follow-up — notes navigation and 10-question quiz reliability
- Note workspace: saved note titles are now a navigation list; the main editor shows one selected note at a time. Export writes only the selected note (not all notes) and includes the note title in the export filename.
- Quiz generation: answer keys for multiple-choice and short-answer items must be contiguous transcript quotes, not inferred or paraphrased. Cloud output allowance increased to 8192 tokens. The UI now makes up to two regeneration attempts when strict validation rejects the first result.
- Regression coverage: added a valid 10-question quiz response test.
- Latest CI: https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/45886269511 — SUCCESS for TypeScript, unit tests, production build, Chrome package verification, and artifact upload.
- Extension version remains 0.1.0.
- User confirmed the updated note navigation/selected-note export and live 10-question quiz tests passed in desktop Chrome. Phase 4 and Phase 5 are signed off.


## 2026-11-26 — Phase 4–5 runtime sign-off
- User reported that all testing is complete and all tested behaviors worked.
- Phase 4: local lesson persistence, notes CRUD/autosave/navigation, selected-note export, and the tested migration/restore workflow are signed off.
- Phase 5: quiz generation (including 10 questions), transcript-grounded answer validation, grading visuals/feedback, and saved-attempt review are signed off.
- Latest code remains at extension version 0.1.0. No version bump was requested.
- Next phase is Phase 6 — Optional Cloud Sync. Cloud sync must remain opt-in; local-only lesson storage remains the default and transcripts must not sync by default.


## 2026-11-26 — Phase 6 kickoff
- Phase 4 and Phase 5 are formally complete following the user's confirmation that all runtime tests passed.
- Phase 6 roadmap is now decomposed into security/data design, identity and Firebase security, and opt-in sync engine/user controls.
- No Phase 6 code has been implemented yet. The immediate work is schema/security design, not blindly adding Firestore writes.
- Important blocker: current App Check uses a development debug token. A production-compatible Chrome-extension attestation approach is required before cloud sync can be enabled.


## 2026-11-26 — Phase 6A data-model audit complete

**Audited IndexedDB v5**
- Confirmed four active stores: `learningSessions`, `learningNotes`, `learningQuizzes`, and `quizAttempts`. The v5 migration removed `learningBookmarks`.
- Session records contain `transcriptText`; therefore raw local session records must never be serialized directly to Firestore.
- Note, quiz, and attempt IDs are UUIDs. YouTube session IDs are the YouTube video ID; manually imported session IDs are UUIDs.
- Notes and session metadata are mutable; quizzes and attempts are currently append-only in the UI. Local deletes are physical and cascade to child records, so sync needs outbox/tombstone writes in the same local transaction.
- Existing records have no account owner, device ID, remote revision, outbox, or tombstone metadata.

**Data model decisions**
- Added [Cloud Sync Data Model](./CLOUD_SYNC_DATA_MODEL.md) defining cloud DTO allow-lists, Firestore paths under `users/{uid}`, v6 local sync metadata/outbox stores, revision compare-and-set, conflict copies, child tombstones, account-switch safeguards, and the threat model.
- Full transcript text, transcript segments, raw audio, tutor prompts/conversations, tokens, and browser state are excluded from v1 sync. Quiz evidence quotes and learner answers are included only when their respective sync categories are explicitly enabled.
- Selected email/password as the first Auth method, with verification and password-reset flows. OAuth popup/redirect is deferred.
- Phase 6A was completed before Auth or sync implementation began; the subsequent Phase 6B implementation is recorded below. No learning-artifact Firestore writes or sync engine have been implemented.

**Open production gate**
- Current App Check code uses the debug provider. Firebase's web App Check docs describe reCAPTCHA Enterprise Web keys with configured domains but do not establish compatibility with the Chrome extension origin. Verify this with the actual installed extension ID or a secure hosted attestation design before enabling sync. Never replace this with a public token-minting endpoint or a bundled secret.


## 2026-11-26 — Phase 6B Auth and Firestore Rules implementation

**Implemented**
- `src/services/firebase-app.ts` centralizes the Firebase default app so AI Logic and Auth do not create competing app instances.
- `src/services/firebase-auth.ts` uses `firebase/auth/web-extension` for Manifest V3 email/password Auth, account creation, verification email, resend/reload, password reset, sign-out, and session state subscription.
- Added the Account workspace in the side panel. Sign-in remains optional and does not turn on sync or upload local content. Local notes, lessons, and quizzes remain available when signed out.
- Added Identity Toolkit and Secure Token host permissions to the extension manifest.
- Added `firestore.rules` with default-deny behavior. A verified user can access their own strictly shaped `users/{uid}/settings/sync` document; every learning artifact path remains denied until sync is implemented.
- Added Firestore Emulator config and eight security rules tests under `tests/firestore.rules.test.mjs`.
- Added Auth error-message tests under `src/services/firebase-auth.test.ts`.

**CI evidence**
- Run: https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/45897242224
- Commit: `70029037ca678209c70014c09f5066d87942a05a`
- Result: SUCCESS.
- TypeScript: passed.
- Unit tests: 7 files, 50 tests passed.
- Firestore Emulator Rules: 8 tests passed.
- Production build, extension package verification, and artifact upload: passed.
- Extension version remains 0.1.0.

**Still required before Phase 6B sign-off**
- Enable Email/Password in Firebase Console for the exact project referenced by the GitHub Actions Firebase secrets.
- Update the existing unpacked extension without changing its ID, then test account creation, verification email, sign-in, session restore, password reset, and sign-out in desktop Chrome.
- Confirm local learning remains available and unchanged when signed out. No live Firestore rules were deployed and no sync writes are present.
- Resolve the production App Check strategy before any production sync release.

See [Phase 6B Auth Setup](./PHASE6B_AUTH_SETUP.md) for the console setup and manual QA checklist.


## 2026-11-26 — Phase 6C local sync foundation

**Implemented**
- IndexedDB schema v7 adds `syncMetadata`, `syncOutbox`, `syncDevice`, and local-only `syncPreferences`; existing v5 learning data is preserved and not automatically claimed or queued.
- Added account-bound entity claiming and guards that prevent one account from reassigning another account's local entity.
- Added coalesced outbox operations, stable retry operation IDs, base revisions, retry metadata, acknowledgement checks, and cancellation of never-uploaded upserts on local deletion.
- Added an installation-scoped device ID.
- Integrated account-claimed outbox updates atomically with lesson metadata changes, note/quiz/attempt saves, note deletion, quiz deletion with attempt children, and lesson deletion with all child artifacts. Transcript-only lesson autosaves never enqueue lesson metadata; unclaimed records remain local-only.
- Added allow-listed DTO mappers for lesson metadata, notes, quizzes, and quiz attempts. Full transcript/audio and unrecognized local fields are excluded.
- Added size and timestamp validation plus YouTube URL canonicalization/sanitization.
- Added Account-tab category preferences and a local record-count/ownership preview for verified users. Choices are saved only in IndexedDB; saving them does not claim records or upload data.
- Added IndexedDB migration/outbox and DTO privacy regression tests.

**Not yet implemented / no live cloud writes**
- There is no explicit first-claim confirmation, account-switch orchestration, background sync runner, Firestore artifact write, pull cursor, conflict resolver, or tombstone propagation.
- Live Firebase Email/Password configuration and desktop Chrome Auth flow remain unverified by the user.
- Production-compatible App Check remains a hard release gate. Do not enable or deploy learning-artifact sync.

**CI**
- Latest successful run: https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/45899842079
- Result: SUCCESS — TypeScript, 8 Vitest files / 67 tests, 8 Firestore Emulator Rules tests, production build, extension package verification, and artifact upload.
- Package version remains 0.1.0.

**Next engineering task:** Add explicit first-claim confirmation and account-switch isolation around the category preview. Keep the sync runner and Firestore artifact writes disabled until live Auth QA and production App Check are approved.


## 2026-11-27 — Phase 6.1 protocol finalization and Phase 6.2 backend foundation
- Phase 6.1 completed: the client enforces quiz-attempt dependency on quiz definitions; the server policy requires an active same-lesson quiz and known question IDs; quiz deletion is blocked while synced attempts remain active.
- Pull contract finalized with category-scoped bounded pages, opaque checkpoints (including completed-page checkpoint), strict payload validation, safe merge classification, remote-only artifact behavior, and transcript-preserving lesson tombstones.
- Phase 6.2 source foundation added in a separate Firebase Functions v2 workspace. The two callables enforce verified Firebase Auth and App Check. One handles explicit server-side sync consent; the other applies a mutation transactionally and writes the immutable feed event, receipt, and entity together.
- The current branch still has no .firebaserc binding and no live Functions deployment. Firebase project ID/Firestore region, live email-verification QA, and production Chrome App Check remain release gates.
- The extension transport remains hard-disabled; no learning artifact is uploaded by this build.


## 2026-11-27 — Phase 6.2 backend implementation
- Added a separate Node.js 22 Firebase Functions v2 workspace with callables for account sync settings and single-request artifact mutation.
- Callables require verified Firebase Auth and enforce App Check. UID derives only from the callable Auth context, never the request body.
- Admin mutation transactions validate settings, payload allow-lists and revisions; atomically write entity state, receipt, device metadata, feed counter and immutable change event.
- Conflicts preserve local and remote snapshots in separate documents to stay below Firestore's per-document size limit.
- Quiz attempt writes require the referenced quiz and all referenced question IDs to exist. Quiz deletion is blocked while active attempts reference it.
- Emulator tests cover settings consent, mutation apply/replay/key collision, conflicts, quiz dependencies and concurrent feed sequence allocation.
- No Firebase project is bound; no Functions deployment or client cloud write is enabled. Live Auth QA, production extension App Check, Firestore region confirmation and the client pull implementation remain required.


## 2026-11-27 — Phase 6.2 signed pull endpoint added
- Added the server syncPull callable. It requires verified Firebase Auth and App Check, validates server-side category consent, and reads a bounded category-scoped feed.
- Opaque HMAC-SHA-256 cursors bind authenticated UID, device ID, category, fixed snapshot and scan position. The cursor signing key is accessed through Firebase Secret Manager only.
- Pull pages return up to 100 matching changes while scanning at most 500 metadata-only feed records. Each matching payload is stored separately and fetched only when selected; page payloads are capped at 4 MiB using canonical JSON byte accounting. Final checkpoints are reusable for the next bounded snapshot. Gaps, malformed changes and cursor tampering are rejected.
- The endpoint is not deployed. Before deployment, the Firebase project and region must be confirmed, SYNC_CURSOR_HMAC_KEY must be created in Secret Manager, live Auth QA must pass, and production Chrome App Check must be approved.
- Client-side pull orchestration, IndexedDB cursor persistence and merge application remain outstanding. The extension sync transport is still hard-disabled.

- The change feed now separates small immutable event metadata from immutable payload snapshots. Pull scans a metadata projection, then fetches only the requested category's selected payloads in parallel, avoiding oversized Firestore reads and callable responses.


## 2026-11-27 — Phase 6.2 server backend CI sign-off
- Verified commit: `add73cb4efa55c8b68c684b51e11fd350bdcaeb0`.
- CI: https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/46038659615 — SUCCESS.
- Extension unit tests: 13 files / 141 tests passed.
- Firestore Rules emulator: 10 tests passed.
- Firebase Functions/Admin emulator: 25 tests passed.
- TypeScript, production build, extension package verification and artifact upload passed.
- The syncMutation endpoint applies immutable request snapshots transactionally, with SHA-256 idempotency, revision conflict preservation, device metadata and an ordered feed.
- The syncPull endpoint provides signed UID/device/category-bound cursors, fixed snapshot pagination, metadata-only feed scans and separate immutable payload snapshots. Payload pages are capped at 4 MiB and scan at most 500 metadata records.
- The extension version remains 0.1.0 and `SYNC_CLOUD_WRITES_ENABLED` remains false. No Firebase project is configured or deployed.
- Remaining release blockers: verify the Firebase project ID and Firestore region; complete live email/password Auth QA in desktop Chrome; approve/test production App Check for the published extension ID; set `SYNC_CURSOR_HMAC_KEY` in Secret Manager; then implement the client pull applier/cursor persistence and two-device end-to-end tests.


## 2026-11-27 — Phase 6.3 local pull application CI sign-off

- Verified commit: `350b5d235bab0349913d36ec127f1e2c2c429058`.
- CI: https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/46049475428 — SUCCESS.
- IndexedDB schema v11 adds `syncPullCursors` and `syncRemoteArtifacts`; the v10 migration preserves existing learning records and transcript text.
- `applyLocalSyncPullPage` validates a page and applies its local merge decisions in one IndexedDB readwrite transaction, committing the opaque per-account/device/category checkpoint in that same transaction.
- The applier preserves unclaimed records, records owned by another local account, pending local edits, open conflicts, and local transcripts. Missing parents and other unsafe-to-merge artifacts are retained separately in the remote-only store.
- A page is fully validated, then repeated events for one entity are collapsed to the highest-sequence event before local application. The checkpoint still advances through the complete validated page.
- Regression coverage includes v10-to-v11 migration, ownership isolation, pending local changes, tombstones, remote-only records, duplicate pages, and repeated revisions. All 150 unit tests pass.
- `functions/src/sync-pull.ts` provides the server callable, but the extension has no client pull orchestrator or callable transport yet. `src/services/sync-engine.ts` prepares local mutation batches only; `src/services/sync-transport.ts` remains a fail-closed stub and `SYNC_CLOUD_WRITES_ENABLED` remains false.
- The Account UI currently saves category preferences and first-claim selections locally only. It does not persist server-side sync consent, invoke pull/mutation callables, or expose the new remote-only artifact inbox.
- No `.firebaserc` binding or live Functions deployment is present. `SYNC_CURSOR_HMAC_KEY` has not been configured in Secret Manager. Live email/password Auth QA, a production-compatible App Check strategy for the published extension ID, and two-device tests remain outstanding.
- Keep the extension version at 0.1.0. Do not enable cloud reads/writes or deploy until the Firebase project/region, Auth, production App Check, secret, consent flow, and end-to-end safety gates are explicitly verified.


## 2026-11-27 — Phase 6.3 gated pull client and remote recovery CI sign-off

- Verified commit: `33ba8f5c2b02ccb3b9590bee2d79300c1c1c44c2`.
- CI: https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/46050902816 — SUCCESS.
- Extension unit tests: 14 Vitest files / 158 tests passed. Firestore Rules emulator: 10 tests passed. Firebase Functions/Admin emulator: 25 tests passed. TypeScript, production build, Chrome package verification and artifact upload passed.
- `src/services/sync-pull-client.ts` adds a Firebase `syncPull` callable wrapper and a transport-independent bounded page runner. It validates each response against the local scan watermark, resumes with the committed opaque cursor, and applies a page through the atomic IndexedDB applier. A run processes at most three pages by default (hard maximum 20).
- Pull requires the currently signed-in UID to match the requested account, a verified email, and the category to be selected locally. The server independently checks verified Auth, App Check and server-side category consent.
- `SYNC_CLOUD_PULL_ENABLED` is explicitly `false`. The callable has not been invoked against Firebase. `SYNC_CLOUD_WRITES_ENABLED` also remains `false`; mutation dispatch remains a fail-closed stub.
- The Account workspace now displays remote-only records belonging to the signed-in account and supports copying/downloading recovery JSON.
- `restoreRemoteSyncArtifactAsLocalCopy` restores eligible records with a new ID, without claiming ownership or queuing an upload. Notes/quizzes/attempts require the local parent lesson; attempts also require the matching local quiz. Lesson metadata restoration creates an empty-transcript local shell. The original remote-only snapshot remains in the inbox and is marked as recovered.
- No live server consent is being written. The local category preferences and first-claim flow are still local-only; the UI must not be treated as server consent.
- Remaining gates: wire explicit consent to `updateSyncSettings`; verify live Firebase project ID and Firestore region; complete live Auth QA; approve production App Check for the published extension ID; create `SYNC_CURSOR_HMAC_KEY` in Secret Manager; deploy only after review; then manually verify read-only pull and recovery in desktop Chrome and across two devices.
- The new Account inbox/recovery UI has not been manually tested in desktop Chrome. CI does not substitute for that runtime verification.
- Keep extension version 0.1.0. Do not enable either cloud gate or deploy until all production and end-to-end safety checks are explicitly approved.


## 2026-11-27 — Phase 6.4 explicit sync-consent client foundation CI sign-off

- Verified commit: `1002b6b5e8ff6353c0753d471a386df00180b148`.
- CI: https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/46052131112 — SUCCESS.
- Extension unit tests: 15 Vitest files / 167 tests passed. Firestore Rules emulator: 11 tests passed. Firebase Functions/Admin emulator: 26 tests passed. TypeScript, production build, Chrome package verification and artifact upload passed.
- Added `src/services/sync-settings-client.ts` for the `updateSyncSettings` callable. It verifies the requested UID matches the signed-in account, requires a verified email, obtains an Auth token, validates the exact category map and validates the server's confirmation response. The transport is injectable for tests.
- `SYNC_SERVER_CONSENT_WRITES_ENABLED` is hard-coded to `false`. The Firebase wrapper checks this before reading Auth, initializing Functions/App Check, or making a network request. No server-consent write has been attempted.
- Account UI now offers an explicit consent review step with selected categories and a required acknowledgement. It distinguishes sync scope from the separate audio-transcription permission.
- Full transcript text and the complete caption stream are excluded from sync. If Quizzes are selected, short evidence excerpts attached to quiz questions are included. Audio is excluded from sync; the separate audio-transcription feature may still send tab audio for transcription after its own explicit user action/consent.
- Backend validation and Firestore Rules reject enabled consent with zero selected categories. Attempts still require Quiz definitions.
- Reviewing consent does not claim records, queue uploads, or enable pull/writes. Local category choices and local first-claim behavior remain on-device only.
- Consent status retrieval and a user-facing withdrawal/status control are still outstanding; the client orchestration supports the disabled settings shape but this UI does not yet manage an existing saved server consent.
- No live Firebase project is deployed. Production App Check, live Auth QA, Firebase project/region confirmation, Secret Manager cursor key setup, live consent QA, and two-device pull testing remain release gates.
- Keep extension version 0.1.0. Do not enable server consent, cloud pull, or artifact writes until the production release gates are explicitly reviewed and approved.
