# LearnLens AI — Server-Side Sync Mutation Contract

**Status:** Phase 6G contract and deterministic decision logic implemented; no server endpoint is deployed and no learning-artifact cloud writes are enabled.  
**Protocol:** request envelope v1, DTO schema v1  
**Authority:** this document supersedes the earlier server-transaction placeholders in CLOUD_SYNC_DATA_MODEL.md.

## 1. Non-negotiable release boundary

- IndexedDB remains the working source of truth. Lesson capture, notes, quizzes, and quiz review must continue to work without sign-in or network access.
- The extension has no cloud sync transport. The client transport remains hard-disabled in src/services/sync-transport.ts.
- Firestore Security Rules continue to deny every learning-artifact, device, receipt, and conflict read/write from clients. Only the verified user's sync settings are currently client-accessible.
- Do not deploy or enable the server endpoint until live email verification has been tested in the installed extension and a production App Check provider has been approved and verified.
- The endpoint must require authenticated, email-verified Firebase identity and valid App Check. The UID must come from verified server-side Auth claims, never from the request body.
- App Check is not a replacement for authentication, consent, validation, ownership checks, or revision checks. An Admin SDK endpoint bypasses Firestore Security Rules, so all authorization and validation described here must run in the endpoint itself.

The implementation in src/services/sync-server-contract.ts is pure domain logic. It validates request DTOs, creates canonical request text, derives safe document paths, and returns transaction decisions. It does not authenticate callers, calculate SHA-256, contact Firestore, or persist anything. A Firebase Admin adapter is still required.

## 2. Client request envelope

The transport adapter projects one immutable SyncRequestRecord into this exact JSON body:

| Field | Type | Rule |
|---|---|---|
| protocolVersion | number | Must equal 1 |
| requestId | UUID v4 string | Must equal the local journal's operationId and remain unchanged across retries |
| deviceId | UUID v4 string | Installation identifier; not an authentication factor |
| entityType | lesson, note, quiz, attempt | Determines the only permitted document collection |
| lessonId | path-safe string | 1–128 letters, digits, underscore, or hyphen |
| entityId | path-safe string | Same path-safe pattern; for lessons it must equal lessonId |
| operation | upsert or delete | Delete must have a null payload |
| baseRevision | non-negative safe integer | Revision last acknowledged by this device |
| payloadSchemaVersion | number | Must equal 1 |
| payload | DTO object or null | Required for upsert; null for delete |

The body must contain exactly these fields. Unknown fields are rejected. In particular, ownerUid, uid, email, transcriptText, transcriptFormat, transcript segments, raw audio, tutor messages, Firebase credentials, and App Check tokens are not request fields.

The server obtains the owner UID from the verified Firebase ID token. It derives all Firestore paths from that UID plus validated entity identifiers. The local device ID does not grant access to another account.

## 3. Payload allow-list and size limits

The server repeats validation even though the extension already maps allow-listed DTOs. A modified or compromised extension is an untrusted client.

| Entity | Payload fields | Maximum encoded payload |
|---|---|---:|
| Lesson metadata | platform, videoId, title, url | 16 KiB |
| Note | title, content, createdAtMs, updatedAtMs | 256 KiB |
| Quiz | title, scope, scopeLabel, optional time range, createdAtMs, questions | 512 KiB |
| Attempt | quizId, createdAtMs, results, objectiveScore, objectiveTotal, topicsToReview | 512 KiB |
| Delete | null | No payload |

Every nested question/result is allow-listed too. Oversized or unknown fields are rejected; the server must never truncate learning content.

Quiz payloads include answer keys and short transcript-derived evidence. Attempt payloads include learner answers and feedback. Their respective category consent must be enabled before accepting those requests. Full lesson transcripts and audio never enter this protocol.

## 4. Firestore document layout

All paths are scoped beneath the UID obtained from the verified token:

- users/{uid}/settings/sync
- users/{uid}/devices/{deviceId}
- users/{uid}/lessons/{lessonId}
- users/{uid}/lessons/{lessonId}/notes/{noteId}
- users/{uid}/lessons/{lessonId}/quizzes/{quizId}
- users/{uid}/lessons/{lessonId}/attempts/{attemptId}
- users/{uid}/syncReceipts/{requestId}
- users/{uid}/syncConflicts/{requestId}

A lesson entity uses entityId equal to lessonId. Child artifact IDs remain stable local IDs. Path segments are never constructed from unvalidated strings.

Before mutation, the endpoint also reads users/{uid}/settings/sync and requires enabled=true plus the matching category flag. A user's local preferences alone are not cloud consent. The server settings document is the authoritative opt-in record.

## 5. Idempotency contract

1. The endpoint validates the envelope and DTO before any write.
2. It canonicalizes the complete validated request by sorting object keys recursively while preserving array order.
3. It computes SHA-256 on the server. Never trust a client-provided digest.
4. The receipt key is users/{uid}/syncReceipts/{requestId}. The receipt and target entity must be read in the same Firestore transaction.
5. If a receipt exists and its stored fingerprint equals the newly computed fingerprint, return the exact recorded outcome and result revision. Do not write the entity again.
6. If the same requestId exists with a different fingerprint, reject it as idempotency_key_reused. Do not alter the original receipt or entity.
7. When the first attempt is committed, write its receipt in the same transaction as the entity mutation or conflict. A timeout after commit is therefore safe to retry.
8. Keep receipts for the first release without TTL. Pruning receipts before all possible offline retries expire would weaken the idempotency guarantee.

The fingerprint includes protocol version, request ID, device ID, entity identity, operation, base revision, payload schema version, and the complete payload snapshot. Retrying a request never rebuilds its payload from the latest local record.

## 6. Revision, deletion, and immutability policy

The transaction compares the current remote revision with baseRevision. A missing entity has revision zero.

| Condition | Server result |
|---|---|
| No entity, baseRevision 0, valid upsert | Create at revision 1 |
| Existing active entity, matching baseRevision, mutable entity upsert | Apply at current revision + 1 |
| Any revision mismatch | Preserve request as a conflict; do not overwrite |
| Existing tombstone followed by upsert | Conflict with entity_deleted; ordinary upsert cannot resurrect |
| Existing quiz or attempt followed by another upsert | Conflict with immutable_entity_exists |
| Existing entity, matching baseRevision, delete | Apply tombstone at current revision + 1 |
| Delete for an entity that has never existed remotely | Reject as entity_not_found |

Only lesson metadata and notes are mutable through upsert in v1. Quiz and attempt documents are immutable after creation; correcting one requires a new ID or a future explicit replacement protocol.

An accepted mutation writes:
- revision = current revision + 1;
- createdAt = server timestamp on creation and preserved on update;
- updatedAt = server timestamp for every accepted mutation;
- modifiedByDeviceId = request device ID, diagnostic only;
- lastOperationId = requestId;
- deletedAt = null for active content or server timestamp for a tombstone.

A delete must remove the payload from the document and retain only its envelope/tombstone metadata. Tombstones are not hard-deleted in v1. There is no restore operation; a new upsert cannot resurrect a tombstoned entity.

## 7. Conflict and receipt writes

A revision conflict, entity-deleted conflict, or immutable-entity conflict writes both:
- a syncConflicts/{requestId} record containing entity identity, base and remote revisions, reason, device ID, operation, and the exact local payload snapshot (null for a delete);
- a syncReceipts/{requestId} record with outcome=conflict, the request fingerprint, and the remote revision.

Both writes occur atomically in the same transaction. A retry then replays the original conflict result rather than creating duplicate conflict records. Conflict content remains subject to the same category consent and retention/privacy policy as the original artifact.

An applied request writes the entity mutation and outcome=applied receipt atomically. The client acknowledges only after receiving a confirmed result and only when resultRevision equals baseRevision + 1. A conflict must not be acknowledged as a successful entity mutation.

## 8. Required endpoint transaction sequence

1. Verify Firebase ID token, email_verified=true, and App Check token.
2. Validate the exact request envelope, path IDs, payload schema, field allow-list, and byte limit.
3. Canonicalize and SHA-256 the validated request server-side, then derive entity, receipt, conflict, and device paths from authenticated UID.
4. Start a Firestore transaction. Read sync settings, the receipt, and the target entity before performing any writes.
5. Inside that same transaction, verify enabled/category consent for this UID. This prevents a concurrent opt-out from racing a request that checked settings before the transaction.
6. If a receipt exists, verify its fingerprint and replay or reject key reuse.
7. Otherwise call the deterministic decision function in sync-server-contract.ts.
8. For apply, atomically write the new entity/tombstone and receipt. For conflict, atomically write conflict and receipt. For reject, write nothing.
9. Return a minimal typed result. Never return credentials, tokens, or unrelated user data.

The Firestore Admin SDK bypasses Firestore Security Rules. The endpoint must not assume the current deny-by-default Rules validate its writes.

## 9. Remaining release blockers before an endpoint can be deployed

- Complete live Firebase Auth QA: signup, verification, forced ID-token refresh, sign-in, sign-out, account switching, and unverified-token denial in the installed Chrome extension.
- Prove a production App Check provider with the actual published extension identity. The current debug provider is not production attestation.
- Implement the Admin SDK endpoint and emulator/integration tests for concurrent transactions, receipt replay, idempotency-key collision, conflicts, and account isolation.
- Build the conflict-review UI and explicit resolution transactions on top of the local v10 conflict journal. The request is marked terminal "conflicted", its immutable local payload and remote revision/reason are persisted in IndexedDB, and its outbox intent is retained but blocked from automatic preparation. The response adapter must call markSyncRequestConflicted, never acknowledgeSyncRequest, for a conflict response. A conflict can coincidentally have remoteRevision = baseRevision + 1. Learner resolution must deliberately keep the remote version or rebase the current local version as a new operation; never auto-resolve using timestamps.
- Resolve category dependencies before enabling attempt sync. An attempt references quizId, but category controls currently let a learner enable attempts while quizzes are disabled. The endpoint/UI must either require quiz sync for attempt sync or deliberately support attempts without the referenced quiz.
- Decide how child artifacts should be presented on a second device when notes/quizzes/attempts are enabled but lessonMetadata is disabled. Their Firestore paths are nested under a lesson ID, but no lesson metadata would be pulled.
- Implement pull cursors and merge logic that cannot overwrite pending local edits or resurrect tombstones.
- Keep the client transport fail-closed until all of these gates are completed and explicitly reviewed.

## 10. Current implementation status

Implemented and unit-tested in this phase:
- local IndexedDB v10 conflict store with account-scoped lookup/list APIs;
- terminal conflicted request state and immutable local/remote DTO snapshots;
- duplicate conflict-response idempotency and blocked retries, including newer local edits behind an unresolved conflict;
- strict request-envelope validation and exact top-level field allow-list;
- per-entity nested DTO validation and server-side byte limits;
- canonical request serialization for server-side SHA-256;
- safe UID/entity/document path derivation;
- deterministic apply, conflict, replay, and reject decisions;
- idempotency collision rejection;
- revision compare-and-set decisions;
- tombstone payload removal and no ordinary resurrection;
- immutable quiz/attempt creation semantics.

Not implemented:
- conflict-review UI and explicit keep-local / keep-remote resolution transactions;
- Firebase callable/HTTPS function;
- Firebase Admin SDK transaction adapter;
- server-side Auth/App Check verification and deployment;
- cloud reads/writes from the extension.

No learning-artifact cloud write can occur in the current build.
