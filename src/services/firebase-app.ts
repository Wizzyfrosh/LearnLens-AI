import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export function hasFirebaseConfig(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
}

export function getFirebaseApp(): FirebaseApp {
  if (!hasFirebaseConfig()) {
    throw new Error("Firebase is not configured in this extension build. Add the Firebase web app values to GitHub Actions secrets and rebuild.");
  }

  const existingDefaultApp = getApps().find((app) => app.name === "[DEFAULT]");
  return existingDefaultApp ?? (getApps().length ? getApp() : initializeApp(firebaseConfig));
}
