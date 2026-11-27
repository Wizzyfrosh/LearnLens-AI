# LearnLens AI — Project Status and Continuity Checklist

**Last updated:** 2026-11-27  
**Repository:** https://github.com/Wizzyfrosh/LearnLens-AI  
**Branch:** main  
**Extension version:** 0.1.0  
**Current checkpoint:** Phases 4 and 5 are complete. Phase 6.1 protocol decisions are implemented; Phase 6.2 Firebase Admin callable source and Firestore-emulator tests are being added. The backend is not deployed and the extension cloud transport remains disabled. Live Firebase Auth QA and production Chrome App Check remain release gates.

> CI and desktop Chrome runtime verification have both passed for the Phase 4 and Phase 5 scope described below.

## 1. Latest verified build

- **CI run:** https://github.com/Wizzyfrosh/LearnLens-AI/actions/runs/45899842079
- **Commit:** `e08c195a6e2837d266b32b93f515094c9c7ae99c`
- **Result:** SUCCESS.
- **Passed:** TypeScript typecheck, 8 Vitest files / 67 unit tests, 8 Firestore Emulator Rules tests, production build, Chrome extension package verification, and artifact upload.
- **Artifact:** `learnlens-chrome-extension` (artifact ID `15156045269`).
- **Artifact SHA-256:** `e098a93b5ab42cfdbc66d5c3d72c1e5b9c1d6e614eb6f941d869f60f341c332a`.
- **Artifact size:** 156,169 bytes.
- **Package/manifest version:** 0.1.0.
- **Note:** this successful run includes the Phase 6C local sync foundation and category-preference preview.

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
