import { describe, expect, test } from "vitest";
import { decideGoogleLink } from "@/lib/google-account-linking";

const VERIFIED_AT = new Date("2026-01-01T00:00:00Z");

describe("decideGoogleLink", () => {
  describe("Google email must be verified by Google", () => {
    test.each([false, null, undefined, "true", 1])(
      "rejects email_verified=%s for a new user",
      (flag) => {
        expect(
          decideGoogleLink({ googleEmailVerified: flag, existing: null }),
        ).toEqual({ action: "reject", reason: "google_email_unverified" });
      },
    );

    test("rejects email_verified=false when a matching row exists", () => {
      expect(
        decideGoogleLink({
          googleEmailVerified: false,
          existing: { role: "student", emailVerifiedAt: VERIFIED_AT },
        }),
      ).toEqual({ action: "reject", reason: "google_email_unverified" });
    });

    test("accepts email_verified=true and creates a row when none exists", () => {
      expect(
        decideGoogleLink({ googleEmailVerified: true, existing: null }),
      ).toEqual({ action: "create" });
    });
  });

  describe("linking to an existing row", () => {
    test("drops the password when the local account was never verified", () => {
      expect(
        decideGoogleLink({
          googleEmailVerified: true,
          existing: { role: "student", emailVerifiedAt: null },
        }),
      ).toEqual({ action: "link", clearPasswordHash: true });
    });

    test("keeps the password when the local account is already verified", () => {
      expect(
        decideGoogleLink({
          googleEmailVerified: true,
          existing: { role: "student", emailVerifiedAt: VERIFIED_AT },
        }),
      ).toEqual({ action: "link", clearPasswordHash: false });
    });

    test.each(["viewer", "editor", "super_admin"] as const)(
      "keeps the operator-set password on an unverified %s row",
      (role) => {
        expect(
          decideGoogleLink({
            googleEmailVerified: true,
            existing: { role, emailVerifiedAt: null },
          }),
        ).toEqual({ action: "link", clearPasswordHash: false });
      },
    );
  });
});
