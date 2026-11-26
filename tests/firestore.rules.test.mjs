import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from "firebase/firestore";

const projectId = "demo-learnlens-rules";
const settingsPath = (uid) => `users/${uid}/settings/sync`;

let testEnv;

before(async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules }
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv?.cleanup();
});

function validSettings() {
  return {
    schemaVersion: 1,
    enabled: false,
    categories: {
      lessonMetadata: false,
      notes: false,
      quizzes: false,
      attempts: false
    },
    updatedAt: serverTimestamp()
  };
}

test("unauthenticated clients cannot read or create sync settings", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, settingsPath("user-a"))));
  await assertFails(setDoc(doc(db, settingsPath("user-a")), validSettings()));
});

test("a verified user can create and read only their own sync settings", async () => {
  const db = testEnv.authenticatedContext("user-a", { email_verified: true }).firestore();
  await assertSucceeds(setDoc(doc(db, settingsPath("user-a")), validSettings()));
  await assertSucceeds(getDoc(doc(db, settingsPath("user-a"))));
});

test("a signed-in but unverified user cannot create or update sync settings", async () => {
  const db = testEnv.authenticatedContext("user-a", { email_verified: false }).firestore();
  await assertFails(setDoc(doc(db, settingsPath("user-a")), validSettings()));
});

test("an authenticated user cannot read or write another user's settings", async () => {
  const db = testEnv.authenticatedContext("user-a", { email_verified: true }).firestore();
  await assertFails(getDoc(doc(db, settingsPath("user-b"))));
  await assertFails(setDoc(doc(db, settingsPath("user-b")), validSettings()));
});

test("sync settings reject extra fields and incomplete category maps", async () => {
  const db = testEnv.authenticatedContext("user-a", { email_verified: true }).firestore();
  await assertFails(setDoc(doc(db, settingsPath("user-a")), {
    ...validSettings(),
    transcriptText: "must never be stored here"
  }));
  await assertFails(setDoc(doc(db, settingsPath("user-a")), {
    schemaVersion: 1,
    enabled: true,
    categories: { notes: true },
    updatedAt: serverTimestamp()
  }));
});

test("sync settings reject client-controlled timestamps and invalid types", async () => {
  const db = testEnv.authenticatedContext("user-a", { email_verified: true }).firestore();
  await assertFails(setDoc(doc(db, settingsPath("user-a")), {
    ...validSettings(),
    updatedAt: Date.now()
  }));
  await assertFails(setDoc(doc(db, settingsPath("user-a")), {
    ...validSettings(),
    enabled: "yes"
  }));
});

test("a verified user can update valid settings but cannot change the schema version", async () => {
  const db = testEnv.authenticatedContext("user-a", { email_verified: true }).firestore();
  const ref = doc(db, settingsPath("user-a"));
  await assertSucceeds(setDoc(ref, validSettings()));
  await assertSucceeds(setDoc(ref, {
    schemaVersion: 1,
    enabled: true,
    categories: {
      lessonMetadata: false,
      notes: true,
      quizzes: true,
      attempts: false
    },
    updatedAt: serverTimestamp()
  }));
  await assertFails(setDoc(ref, {
    schemaVersion: 2,
    enabled: true,
    categories: {
      lessonMetadata: false,
      notes: true,
      quizzes: true,
      attempts: false
    },
    updatedAt: serverTimestamp()
  }));
});

test("clients cannot delete sync settings or access artifact paths before sync rules exist", async () => {
  const db = testEnv.authenticatedContext("user-a", { email_verified: true }).firestore();
  await assertSucceeds(setDoc(doc(db, settingsPath("user-a")), validSettings()));
  await assertFails(deleteDoc(doc(db, settingsPath("user-a"))));
  await assertFails(setDoc(doc(db, "users/user-a/lessons/lesson-a"), { title: "Lesson" }));
  await assertFails(getDoc(doc(db, "users/user-a/lessons/lesson-a")));
});
