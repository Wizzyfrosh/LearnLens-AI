import { SyncBackendError } from "./errors";

export interface SyncCallableAuth {
  uid?: unknown;
  token?: Record<string, unknown>;
}

export interface SyncCallableApp {
  appId?: unknown;
}

/**
 * Firebase callable triggers verify the ID token before handler execution.
 * Keep explicit email verification and App Check guards here as defense in
 * depth. The UID is taken only from the verified callable auth context.
 */
export function requireVerifiedAppCaller(
  auth: SyncCallableAuth | null | undefined,
  app: SyncCallableApp | null | undefined
): string {
  if (!auth || typeof auth.uid !== "string" || !auth.uid) {
    throw new SyncBackendError("unauthenticated", "Sign in before using cloud sync.");
  }
  if (auth.token?.email_verified !== true) {
    throw new SyncBackendError("failed-precondition", "Verify your email address before using cloud sync.");
  }
  if (!app || typeof app.appId !== "string" || !app.appId) {
    throw new SyncBackendError("unauthenticated", "A valid Firebase App Check token is required.");
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(auth.uid)) {
    throw new SyncBackendError("permission-denied", "The authenticated account ID is not supported by the sync protocol.");
  }
  return auth.uid;
}
