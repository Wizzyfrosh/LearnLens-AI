export type SyncBackendErrorCode =
  | "invalid-argument"
  | "unauthenticated"
  | "permission-denied"
  | "failed-precondition"
  | "already-exists"
  | "not-found"
  | "resource-exhausted"
  | "internal";

export class SyncBackendError extends Error {
  readonly code: SyncBackendErrorCode;

  constructor(code: SyncBackendErrorCode, message: string) {
    super(message);
    this.name = "SyncBackendError";
    this.code = code;
  }
}
