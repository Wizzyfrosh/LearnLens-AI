import { describe, expect, it } from "vitest";
import { getReadableAuthError } from "./firebase-auth";

describe("Firebase authentication error messages", () => {
  it("explains when the Email/Password provider is disabled", () => {
    expect(getReadableAuthError({ code: "auth/operation-not-allowed" }))
      .toContain("Enable the Email/Password provider");
  });

  it("does not reveal whether an email account exists after an invalid credential", () => {
    expect(getReadableAuthError({ code: "auth/invalid-credential" }))
      .toBe("The email or password is incorrect.");
  });

  it("provides a recoverable network error", () => {
    expect(getReadableAuthError({ code: "auth/network-request-failed" }))
      .toContain("Check your internet connection");
  });

  it("uses a safe generic message for unknown SDK errors", () => {
    expect(getReadableAuthError(new Error("internal endpoint details")))
      .toBe("Authentication could not be completed. Please try again.");
  });
});
