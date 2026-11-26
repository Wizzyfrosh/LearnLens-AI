import {
  createUserWithEmailAndPassword,
  getAuth,
  getIdToken,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type Unsubscribe,
  type User
} from "firebase/auth/web-extension";
import { getFirebaseApp } from "./firebase-app";

export type AuthUser = User;
export type AuthStateListener = (user: AuthUser | null) => void;

let authInstance: Auth | null = null;

export function getFirebaseAuth(): Auth {
  if (!authInstance) {
    authInstance = getAuth(getFirebaseApp());
  }
  return authInstance;
}

export function observeAuthState(listener: AuthStateListener): Unsubscribe {
  return onAuthStateChanged(getFirebaseAuth(), listener);
}

export async function createEmailPasswordAccount(
  email: string,
  password: string
): Promise<{ user: AuthUser; verificationEmailSent: boolean }> {
  const credential = await createUserWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
  try {
    await sendEmailVerification(credential.user);
    return { user: credential.user, verificationEmailSent: true };
  } catch {
    // The account was created successfully. Let the learner retry verification
    // from the signed-in account screen rather than implying account creation failed.
    return { user: credential.user, verificationEmailSent: false };
  }
}

export async function signInWithEmailPassword(email: string, password: string): Promise<AuthUser> {
  const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
  return credential.user;
}

export async function resendVerificationEmail(user: AuthUser): Promise<void> {
  await sendEmailVerification(user);
}

export async function refreshAuthUser(user: AuthUser): Promise<AuthUser> {
  await reload(user);
  // Firestore Rules inspect the ID token's email_verified claim, not the
  // mutable user object. Force a refresh after the verification link is used.
  await getIdToken(user, true);
  return getFirebaseAuth().currentUser ?? user;
}

export async function requestPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
}

export async function signOutCurrentUser(): Promise<void> {
  await signOut(getFirebaseAuth());
}

export function getReadableAuthError(cause: unknown): string {
  const code = cause && typeof cause === "object" && "code" in cause
    ? String((cause as { code: unknown }).code)
    : "";

  switch (code) {
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/email-already-in-use":
      return "An account already exists for this email. Sign in instead.";
    case "auth/weak-password":
    case "auth/password-does-not-meet-requirements":
      return "Choose a stronger password that meets Firebase's password policy.";
    case "auth/operation-not-allowed":
      return "Email/password sign-in is disabled in Firebase. Enable the Email/Password provider in Firebase Console → Authentication → Sign-in method.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "The email or password is incorrect.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact the project administrator.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a while and try again.";
    case "auth/network-request-failed":
      return "Could not reach Firebase. Check your internet connection and try again.";
    case "auth/requires-recent-login":
      return "For security, sign in again before repeating that account action.";
    case "auth/unauthorized-domain":
      return "Firebase rejected this extension origin. Check the Authentication authorized domains configuration.";
    default:
      return "Authentication could not be completed. Please try again.";
  }
}
