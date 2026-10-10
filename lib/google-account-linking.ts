import { isAdminRole, type UserRole } from "@/lib/db/schema";

// Policy for the Google branch of the `signIn` callback in auth.ts: may this
// Google identity be attached to the local `users` row (or become a new one),
// and what has to happen to that row when it is? Kept free of I/O so each
// case is unit-testable without the NextAuth stack.
//
// Invariants:
//   1. A Google identity is only accepted when Google itself reports the
//      email as verified (`email_verified === true`). Linking by email is only
//      sound if Google vouches that its user controls that address.
//   2. A password stored on a row whose email was never verified was not
//      necessarily set by the owner of the address (self-registration does
//      not require verification before sign-in). Linking Google to such a row
//      therefore drops the password; the owner continues with Google or the
//      password-reset flow.
//   3. Admin rows are provisioned by trusted tooling (`createAdmin` and
//      `scripts/seed-super-admin.mjs`), which does not stamp
//      `email_verified_at`, so the unverified-row rule does not apply to them:
//      their operator-set password is kept and they stay linkable.

export type ExistingUserForLinking = {
  role: UserRole;
  emailVerifiedAt: Date | null;
};

export type GoogleLinkDecision =
  | { action: "reject"; reason: "google_email_unverified" }
  | { action: "create" }
  | { action: "link"; clearPasswordHash: boolean };

export function decideGoogleLink(input: {
  /** `profile.email_verified` as reported by Google. */
  googleEmailVerified: unknown;
  /** The `users` row with the same email, or nullish when there is none. */
  existing: ExistingUserForLinking | null | undefined;
}): GoogleLinkDecision {
  if (input.googleEmailVerified !== true) {
    return { action: "reject", reason: "google_email_unverified" };
  }
  if (!input.existing) return { action: "create" };

  const { role, emailVerifiedAt } = input.existing;
  return {
    action: "link",
    clearPasswordHash: !emailVerifiedAt && !isAdminRole(role),
  };
}
