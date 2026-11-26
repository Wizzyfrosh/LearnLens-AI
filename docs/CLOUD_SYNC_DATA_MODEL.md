# LearnLens AI — Cloud Sync Data Model and Security Design

**Status:** Phase 6A design complete; Phase 6C local sync foundation implemented. No learning-artifact Firestore writes or cloud sync runner exist.  
**Date:** 2026-11-26  
**Scope:** Optional sync of selected learning artifacts while preserving local-first behavior.

## 1. Decisions at a glance

1. IndexedDB remains the authoritative local store. Sign-in is optional and must not gate lesson capture, notes, quizzes, or quiz review.
2. Sync is opt-in and category-aware. The first release may sync lesson metadata, notes, quiz definitions, and quiz attempts.
3. Full transcript text, transcript segments, tutor conversation content, raw audio, audio chunks, Firebase configuration secrets, and App Check tokens are never part of the sync DTOs.
4. Quiz definitions include short transcript-derived evidence excerpts and answer keys. This content is included only when the learner opts into quiz sync; the UI must disclose that.
5. Firestore paths are rooted under the authenticated UID. Security Rules must deny by default and verify that the path UID equals `request.auth.uid`.
6. Updates use server revisions and optimistic concurrency, not client-clock last-write-wins.
7. Deletes use tombstones. Firestore parent deletion does not cascade into subcollections, so every child artifact must be tombstoned independently.
8. Conflicting edits are preserved for user resolution. No sync operation may silently overwrite a newer remote edit or resurrect a deleted artifact.
9. The existing App Check debug provider is development-only. It is not a production App Check strategy.
10. The first authentication method is email/password with email verification and password reset. OAuth popup/redirect providers are deferred until their Manifest V3 offscreen flow is deliberately implemented.

## 2. Audit of the current local database

The inspected source is `src/services/session-store.ts`; schema version is **5**, database name is `learnlens-local`.

| IndexedDB store | Key path | Current fields / indexes | Sync implication |
|---|---|---|---|
| `learningSessions` | `id` | `id`, `videoId`, `title`, `url`, `platform`, `transcriptText`, `transcriptFormat`, `transcriptSource`, `updatedAt`; indexes `videoId`, `updatedAt`, `platform` | Contains the full transcript. Only an explicit metadata projection may leave the device. |
| `learningNotes` | `id` | `id`, `sessionId`, `videoId`, `title`, `content`, `createdAt`, `updatedAt`; indexes `sessionId`, `videoId`, `updatedAt` | Mutable user-authored content; needs revisions, owner binding, an outbox, and tombstones. |
| `learningQuizzes` | `id` | `id`, `sessionId`, `title`, `scope`, `scopeLabel`, optional range seconds, `createdAt`, `questions[]`; indexes `sessionId`, `createdAt` | Currently immutable after generation in the UI. Questions contain answer keys, explanations, and evidence quotes from the transcript. |
| `quizAttempts` | `id` | `id`, `quizId`, `sessionId`, `createdAt`, `results[]`, objective score/total, topics to review; indexes `sessionId`, `quizId`, `createdAt` | Append-only in the current UI; stores learner answers and feedback. |
| `learningBookmarks` | — | Retired during the v5 migration | Not part of the sync model. |

### Observed data behavior

- YouTube lesson IDs are currently keyed by the YouTube `videoId`; manually imported lesson IDs are generated as UUIDs when a new session is saved.
- Note, quiz, and attempt IDs are generated with `crypto.randomUUID()`.
- Session records have `updatedAt`, but no `createdAt`. The current value is refreshed during live transcript autosave, so it must not be treated as a cloud revision or as a reliable creation timestamp.
- Notes have client-generated millisecond `createdAt` and `updatedAt`.
- Quiz definitions and attempts have client-generated millisecond `createdAt`; there is no edit timestamp because the current UI treats them as immutable.
- The current delete functions physically remove local records. Deleting a lesson cascades to its notes, quizzes, and attempts; deleting a quiz cascades to its attempts.
- There is currently no sync owner, device identity, server revision, outbox, tombstone, or account-partitioning metadata in the database.
- The local save operations use IndexedDB transactions, which gives Phase 6 a place to add atomic local-record plus outbox updates.

### Gaps that must be closed before sync implementation

| Gap | Required change |
|---|---|
| Full transcript is embedded in a lesson row | Build explicit allow-listed DTO mappers. Never serialize a `LearningSession` object directly. |
| No account ownership metadata | Add per-entity local sync metadata. A record claimed by account A must never be uploaded to account B automatically. |
| No remote revision | Track the last acknowledged server revision for each account/entity pair. |
| Physical deletion loses sync intent | Capture tombstones/outbox entries in the same IndexedDB transaction as local cascade deletion. |
| No durable retry queue | Add a bounded, coalescing outbox in a later IndexedDB schema migration. |
| Client timestamps are used for local sorting | Keep them for display only; use Firestore revision and server timestamps for sync ordering. |
| Lesson metadata autosaves frequently with transcript changes | Compare the projected metadata DTO and enqueue only when syncable metadata actually changes. A transcript-only update must not create a cloud write. |

## 3. Firestore document layout

All user data is isolated below one authenticated UID:

```text
users/{uid}
  settings/sync
  devices/{deviceId}
  lessons/{lessonId}
    notes/{noteId}
    quizzes/{quizId}
    attempts/{attemptId}
  syncConflicts/{conflictId}
  syncReceipts/{operationId}
```

- `uid` comes from the verified Firebase Auth session, never from a user-editable form field or an untrusted payload.
- `lessonId` and artifact IDs must pass a strict path-segment validator such as `^[A-Za-z0-9_-]{1,128}$`. Reject an invalid ID; do not concatenate arbitrary input into a Firestore path.
- Current YouTube video IDs and UUID-generated artifact IDs fit this constraint. Keep the original local ID as the cloud document ID so notes/quizzes/attempts can preserve their parent relationships.
- Canonicalize YouTube URLs to `https://www.youtube.com/watch?v={videoId}` and strip unrelated query parameters/fragments. Do not sync arbitrary pasted URL query strings; validate allowed HTTPS hosts or store an empty URL for manual lessons without a safe source URL.
- Do not include `ownerUid` as an authorization substitute in each document. The UID path is the ownership boundary; Rules enforce it.
- A device document tracks a random installation-scoped device ID and its last successful sync cursor. A device ID is an identifier, not an authentication factor.
- Receipts make a retried operation idempotent. Conflict records preserve rejected local changes for user review.
- Firestore subcollections are not recursively deleted when a parent document is deleted. Every note, quiz, and attempt therefore needs its own tombstone.

## 4. Cloud DTO allow-list

Use versioned, separately declared DTO types. Do not spread local IndexedDB objects into Firestore writes.

### Common envelope

```ts
type SyncEntityType = "lesson" | "note" | "quiz" | "attempt";

interface CloudEnvelope {
  entityType: SyncEntityType;
  schemaVersion: 1;
  entityId: string;
  lessonId: string;
  revision: number;                 // server-controlled optimistic revision
  createdAt: Timestamp;             // server timestamp; immutable
  updatedAt: Timestamp;             // server timestamp on every accepted mutation
  clientUpdatedAtMs: number;        // informational only; never conflict ordering
  modifiedByDeviceId: string;       // telemetry/debug aid, not trusted identity
  deletedAt: Timestamp | null;      // tombstone; do not hard-delete in v1
  lastOperationId: string;          // idempotency/retry marker
}
```

The envelope is stored alongside an entity-specific `payload`. The server Rules must enforce valid types, bounded values, immutable `createdAt`, and exactly-one-step revision increments. The client cannot set `updatedAt` to an arbitrary clock value; writes use the Firestore server timestamp sentinel and Rules validate it against `request.time`.

### Lesson metadata payload

```ts
interface LessonMetadataPayload {
  platform: "youtube" | "manual";
  videoId: string;                  // may be empty for manual imports
  title: string;
  url: string;                      // validated/sanitized source URL
}
```

No `transcriptText`, `transcriptFormat`, caption segments, or audio fields are allowed. Keep the metadata minimal and show the learner that a synced lesson entry does not mean its transcript is available on another device.

### Note payload

```ts
interface NotePayload {
  title: string;
  content: string;
  createdAtMs: number;
  updatedAtMs: number;
}
```

The parent lesson relationship is in the document path and envelope; omit redundant `videoId`/local `sessionId` fields from the cloud payload.

### Quiz payload

```ts
interface QuizPayload {
  title: string;
  scope: "whole_lesson" | "topic" | "time_range";
  scopeLabel: string;
  rangeStartSeconds?: number;
  rangeEndSeconds?: number;
  createdAtMs: number;
  questions: Array<{
    id: string;
    type: "multiple_choice" | "true_false" | "short_answer";
    prompt: string;
    options: string[];
    correctAnswer: string;
    explanation: string;
    topic: string;
    evidence: string;
  }>;
}
```

Quiz evidence is a transcript excerpt. Although it is not the whole transcript, it is still lesson-derived text and must be covered by the quiz-sync consent.

### Attempt payload

```ts
interface AttemptPayload {
  quizId: string;
  createdAtMs: number;
  results: Array<{
    questionId: string;
    answer: string;
    correct: boolean | null;
    feedback: string;
  }>;
  objectiveScore: number;
  objectiveTotal: number;
  topicsToReview: string[];
}
```

Attempts can contain learner-entered answers. The sync settings screen must disclose that learner answers and feedback are included when attempt sync is enabled.

### Explicitly excluded from every v1 DTO

- Full transcript text and transcript segments, regardless of source (visible captions, manual import, or audio transcription).
- Raw audio, WAV/base64 chunks, and audio capture state.
- Tutor questions/answers or model prompts.
- API keys, Firebase config secrets, App Check tokens, auth tokens, browser tab IDs, capture status, and inference preference.
- Unrecognized fields. DTO mappers must construct allow-listed payloads; they must not use object spread on local records.

Reject any document that exceeds the sync boundary's conservative size budget (initial design target: 256 KiB per note and 512 KiB per quiz/attempt payload, subject to tests). Keep Firestore's hard document-size limit as an absolute upper bound, not an application target. Oversized content remains local and produces a clear sync error.

## 5. Local sync metadata and outbox design

IndexedDB schema version **6** now adds:

### `syncMetadata` store

Keyed by `entityKey` (entity type + lesson ID + entity ID), with:
- `ownerUid`: account that explicitly claimed this record for sync; absent/null means local-only.
- `remoteRevision`: last server revision acknowledged for this account/entity; zero means no cloud record exists.
- `lastSyncedAtMs`: local diagnostic timestamp.
- `syncCategory`: lesson metadata, notes, quizzes, or attempts.
- `lastKnownDeletedAt`: optional tombstone state.

A separate `syncDevice` store persists one random device ID for this extension installation. Never use the device ID as proof of identity.

### `syncOutbox` store

One coalesced pending operation per entity:
- `operationId`: UUID, stable across retries of this operation.
- `ownerUid`, `entityType`, `lessonId`, `entityId`.
- `operation`: `upsert` or `delete`.
- `baseRevision`: remote revision the local change was based on.
- `payloadSchemaVersion` and `queuedAtMs`.
- Retry count and a bounded last-error code; do not store Firebase tokens or secrets.

Implemented outbox records do not duplicate note/quiz payload contents. The future worker must read the latest local entity when processing an upsert. Delete operations need only identity and revision metadata. Outbox entries are coalesced per entity so rapid note autosaves do not create an unbounded write queue. **Remaining integration requirement:** local entity mutation and outbox mutation must be wired into the same IndexedDB transaction before any sync runner is enabled. The current v6 foundation exposes explicit claim/queue/ack/retry primitives; ordinary note/quiz/session saves do not enqueue operations yet.

### Account claiming and switching

- Records created while signed out are local-only.
- On first opt-in, show a preview of local data categories/counts and ask the learner to explicitly claim selected records for the currently signed-in UID.
- A record already bound to UID A must not be pushed to UID B after account switching. Never silently reassign ownership.
- On switching accounts, pause sync, drain or retain the old UID's outbox under that UID, clear account-specific in-memory UI state, and load only cloud/local records associated with the newly selected account.
- If a learner wants to move local-only data to another account, make that a deliberate export/import or copy-and-claim action, not an automatic reassignment.
- Local data remains on the device after sign-out. The UI must not imply that sign-out is equivalent to local data deletion.

## 6. Conflict and revision policy

Client clocks are not authoritative. Do not implement last-write-wins using `updatedAt` milliseconds: clocks can drift, and the current lesson `updatedAt` changes during capture autosaves.

For each accepted cloud mutation:
1. Read the target document in a Firestore transaction.
2. Compare the remote `revision` with the outbox `baseRevision`.
3. If equal, apply the write/tombstone with `revision = remoteRevision + 1`, `updatedAt = serverTimestamp()`, and `lastOperationId = operationId`.
4. If the operation receipt already exists, treat the retry as successful and acknowledge it locally.
5. If the revision differs, do not overwrite. Create a conflict record under the same UID and preserve the local data.

Conflict handling by type:
- **Note edit:** preserve the newer cloud note and create a recoverable conflict copy containing the local version and its base/remote revisions. The learner can compare, copy/merge, or explicitly replace the canonical note.
- **Lesson metadata:** preserve the conflict as a small metadata conflict; do not let stale local metadata replace a newer cloud version.
- **Quiz and attempt:** treat creation as immutable/idempotent. Reuse of an ID with different content is a conflict/integrity error, never an overwrite.
- **Delete:** a tombstone is accepted only against the revision it was based on. If remote content changed after the local device last synced, record a delete conflict and require an explicit resolution. Do not silently delete the newer edit or resurrect the local stale copy.

Store a conflict's entity type, entity ID, lesson ID, base revision, remote revision, originating operation ID, and preserved local payload (subject to the same category consent). A conflict is private to the UID path and visible in a review UI. Do not auto-resolve conflicts using client timestamps.

## 7. Deletion and tombstone semantics

- A delete of an entity never hard-deletes its Firestore document in v1. It increments revision and sets `deletedAt` using the server timestamp.
- The local delete transaction writes tombstone outbox records before/while removing the visible local entity.
- Deleting a lesson queues tombstones for the lesson and every associated note, quiz, and attempt. Deleting a quiz queues tombstones for that quiz and all its attempts.
- If an entity has never been uploaded (`remoteRevision === 0`), its pending upsert can be cancelled and no cloud tombstone is needed.
- A client applies remote tombstones locally only after checking the entity's current local sync state; unsynced newer edits must become conflicts, not be discarded.
- Keep tombstones indefinitely in the first sync release. Do not add a TTL until device-cursor/acknowledgement semantics prove that an offline device cannot later resurrect old data.
- A user-requested account deletion is a separate explicit flow: export first if requested, enumerate and delete the user's cloud subtree in bounded batches (including nested collections), then delete the Auth account after recent reauthentication. It must be resumable after partial failure.

## 8. Sync flow and invariants

1. Verify Firebase Auth session and the explicit sync opt-in for the current UID.
2. Verify the local record is claimed by that UID and the DTO category is enabled.
3. Pull remote pages using server timestamps/revisions and persist the cursor per device. Include tombstones in the pull.
4. Merge remote records into the local profile without overwriting a local entity that has pending outbound changes.
5. Process the local outbox serially per entity; apply a Firestore transaction with revision check.
6. Acknowledge the outbox item and revision in IndexedDB only after a confirmed remote commit/receipt.
7. Retry transient failures with bounded exponential backoff; surface permanent auth, rules, validation, quota, and conflict failures.
8. Never block local note-taking or quiz use on a sync failure.

Invariants:
- No record owned by one UID can be written under another UID.
- No transcript or audio payload is sent by any v1 DTO mapper.
- No remote revision is overwritten without compare-and-set.
- No local delete can silently erase a newer remote edit.
- A repeated operation cannot produce duplicate artifacts.
- A sync outage cannot disable local learning.

## 9. Security and privacy threat model

| Threat | Mitigation / required test |
|---|---|
| User changes UID in a client request or Firestore path | Firestore Rules compare every matched UID with `request.auth.uid`; test cross-user reads/writes are denied. |
| Authenticated user writes arbitrary/malformed fields | Allow-list document keys, validate types, string/array bounds, path IDs, schema version, revision increments, and server timestamps in Rules and client validators. |
| Full transcript accidentally uploaded by object spread | Use explicit DTO mappers and tests that assert forbidden keys/content are absent. |
| Account A data is uploaded after switching to account B | Per-entity `ownerUid` in local sync metadata, account-scoped queues, explicit claim/reassignment flow, and account-switch tests. |
| Offline device replays stale edits/deletes | Revision compare-and-set; conflict preservation; tombstones retained; no client-clock last-write-wins. |
| Retry creates duplicate documents | Stable operation IDs and transactionally written sync receipts. |
| Malicious/compromised extension tampers with payload | Assume the client is untrusted; validate all writes in Rules, enforce size/rate limits, and do not rely on client validation alone. |
| Prompt-injection or malicious transcript content | Transcript is not synced in v1; notes/quiz text remain untrusted data and are never executed as HTML/code or treated as policy. |
| Shared Chrome profile exposes another account's local material | Account-specific local state must be separated/filtered; clear React state on account changes; do not treat Firebase sign-out as local-data deletion. |
| Stale devices resurrect deleted content | Persist tombstones and device cursors; retain tombstones until a safe cleanup protocol exists. |
| App Check debug token used in production | Build must fail closed for production sync unless a tested production provider is configured; never bundle a debug token. |
| Large payloads or abusive write loops | Per-document budget, bounded outbox, write batching, rate limits/quotas, and observable retry ceilings. |

### Firestore Rules baseline (design, not deployable rules yet)

- Default deny at the database root.
- Reads/writes only under `/users/{uid}/...` where `request.auth != null && request.auth.uid == uid`.
- No client hard deletes for synced entities; use tombstone updates.
- Validate schema version, allowed fields, document size-related field bounds, revision increment, and server timestamp.
- Prevent UID, entity ID, lesson ID, `createdAt`, and other immutable ownership/identity fields from being changed on update.
- Keep sync settings, devices, lessons, nested artifacts, receipts, and conflicts within the same UID boundary.
- Do not use a broad `allow read, write: if request.auth != null` rule.
- Rules are authorization, not a substitute for client validation or App Check.

## 10. Authentication and App Check decisions

### Authentication

Use email/password as the first supported sign-in method, with email verification and password-reset flows. This avoids introducing OAuth popup/redirect complexity before it is needed. Current Firebase documentation provides the `firebase/auth/web-extension` entry point for Manifest V3 extension contexts. OAuth popup/redirect flows need an offscreen document and a hosted HTTPS iframe/proxy flow; defer them until explicitly required.

Authentication must not be needed for local-only use. Keep Firebase Auth state scoped to the extension origin and clear account-specific app state on sign-out/account change.

### App Check

The current `src/services/firebase-ai.ts` implementation sets `FIREBASE_APPCHECK_DEBUG_TOKEN = true` and initializes a debug-oriented reCAPTCHA v3 provider. This is a controlled testing setup, not production attestation.

Firebase's current web App Check guidance recommends reCAPTCHA Enterprise for new web integrations and requires a Web-type key with explicitly configured domains. The official documentation does not establish that a `chrome-extension://` origin is accepted as a reCAPTCHA Enterprise web domain. Therefore:

- Do not assume the existing debug provider can ship.
- Do not embed any private attestation key or shared secret in the extension bundle.
- Before sync enforcement, run a real installed-extension spike using the production extension ID and the intended published origin.
- Evaluate a hosted HTTPS attestation/bootstrap page or a custom provider only with a server-verified proof. A public endpoint that mints tokens for any caller is not attestation.
- If a safe provider cannot be verified, do not enable Firestore App Check enforcement yet. Keep data access protected by strict Auth + Firestore Rules and keep the release gate blocked for production sync until the abuse-protection plan is resolved.
- Consider a separate Firebase web-app registration for sync if it avoids coupling sync attestation to the existing AI Logic debug-provider initialization. Prove this in a test project before changing the current working AI path.

App Check is an app-attestation/abuse-control layer; it does not replace authenticated per-user Firestore Rules.

## 11. Implementation sequence after this design

**Completed in the Phase 6C foundation slice**
1. IndexedDB v6 migration creates `syncMetadata`, `syncOutbox`, and `syncDevice` without modifying existing v5 learning records.
2. Explicit lesson metadata, note, quiz, and attempt DTO mappers construct allow-listed payloads. Transcript/audio/token fields are never copied from local session objects.
3. Unit tests cover migration preservation, per-account ownership, outbox coalescing, stale acknowledgements, unsynced-delete cancellation, stable device identity, DTO privacy, URL sanitization, and payload size bounds.
4. Firestore Emulator configuration and deny-by-default Rules remain in place from Phase 6B.

**Still required**
5. Wire local note/quiz/session mutations and cascade deletes to metadata/outbox updates in the same IndexedDB transaction.
6. Add explicit sync opt-in, category consent, first-claim preview, and account-switch handling.
7. Complete live Firebase Auth verification and prove a production App Check strategy in an actual installed extension.
8. Only after the above gates, implement Firestore transactions, revision compare-and-set, pull cursors, receipts, conflict review, tombstone propagation, export/delete flows, and multi-device tests.

Do not add Firestore learning-artifact writes or enable a sync runner before account claiming, atomic outbox integration, live Auth verification, and an approved production App Check decision.

## 12. References

- Firebase Auth in Chrome extensions: https://firebase.google.com/docs/auth/web/chrome-extension
- Firebase App Check overview: https://firebase.google.com/docs/app-check
- App Check reCAPTCHA Enterprise for web: https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider
- App Check custom provider for web: https://firebase.google.com/docs/app-check/web/custom-provider
- Firestore security rules and ownership checks: https://firebase.google.com/docs/firestore/security/rules-conditions
- Firestore rules structure and limits: https://firebase.google.com/docs/firestore/security/rules-structure
