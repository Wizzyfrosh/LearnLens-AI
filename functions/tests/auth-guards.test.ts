import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requireVerifiedAppCaller } from "../src/auth-guards";
import { SyncBackendError } from "../src/errors";

describe("sync callable authentication and App Check gate", () => {
  const verifiedAuth = { uid: "verified-user", token: { email_verified: true } };
  const verifiedApp = { appId: "1:123456:web:learnlens" };

  it("uses the verified Firebase UID from callable context", () => {
    assert.equal(requireVerifiedAppCaller(verifiedAuth, verifiedApp), "verified-user");
  });

  it("rejects missing authentication", () => {
    assert.throws(() => requireVerifiedAppCaller(null, verifiedApp), SyncBackendError);
  });

  it("rejects authenticated but unverified email accounts", () => {
    assert.throws(() => requireVerifiedAppCaller({
      uid: "verified-user", token: { email_verified: false }
    }, verifiedApp), /Verify your email/i);
  });

  it("rejects requests without validated App Check context", () => {
    assert.throws(() => requireVerifiedAppCaller(verifiedAuth, null), /App Check/i);
  });

  it("rejects unsafe authenticated UIDs before constructing Firestore paths", () => {
    assert.throws(() => requireVerifiedAppCaller({
      uid: "user/other", token: { email_verified: true }
    }, verifiedApp), /account ID/i);
  });
});
