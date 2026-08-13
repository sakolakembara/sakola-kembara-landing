import "server-only";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  readAccountToken,
  signAccountToken,
} from "@/lib/account-tokens";
import { sendPasswordResetEmail } from "@/lib/email";
import { env } from "@/lib/env";

// Domain layer for account-hygiene actions (verify email, request password
// reset, redeem password reset). Server actions in app/(auth)/* are thin
// wrappers that parse form data, call these functions, then translate the
// discriminated result into UI messages.

const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;
export { MIN_PASSWORD_LENGTH as ACCOUNT_MIN_PASSWORD_LENGTH };

// ─── Email verification ───────────────────────────────────────────────

export type VerifyEmailResult =
  | { ok: true }
  | {
      ok: false;
      reason: "invalid_token" | "user_not_found" | "email_changed";
    };

/**
 * Verify a click-through token from an email. Rejects tokens whose
 * embedded email no longer matches the DB row's current email — that
 * protects against a stolen link surviving an email change.
 *
 * Idempotent: verifying an already-verified account returns ok:true so
 * a user who clicks the link twice sees the same success screen both
 * times.
 */
export async function verifyEmailByToken(
  rawToken: string | undefined,
): Promise<VerifyEmailResult> {
  const claims = await readAccountToken(rawToken, "verify-email");
  if (!claims) return { ok: false, reason: "invalid_token" };

  const row = await db.query.users.findFirst({
    where: eq(users.id, claims.sub),
    columns: { id: true, email: true, emailVerifiedAt: true },
  });
  if (!row) return { ok: false, reason: "user_not_found" };
  if (row.email !== claims.email.toLowerCase()) {
    return { ok: false, reason: "email_changed" };
  }
  if (row.emailVerifiedAt) return { ok: true };

  await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, row.id));
  return { ok: true };
}

// ─── Password reset — request phase ───────────────────────────────────

/**
 * Look up a user by email and (if they exist AND have a password-based
 * account) send them a reset email. Callers should ALWAYS return 200 /
 * generic success regardless of the outcome — leaking "email exists" vs
 * "email doesn't" is an enumeration oracle.
 *
 * Users with `passwordHash === null` (Google-only) get no email — we
 * won't create a password for them via this flow. Same silent-200 UX
 * from the caller.
 *
 * Users with `emailVerifiedAt === null` (never verified) also get no
 * email — sending a password reset before email ownership is confirmed
 * would let a squatter take over an unclaimed account by resetting its
 * password.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const row = await db.query.users.findFirst({
    where: eq(users.email, normalized),
    columns: { id: true, email: true, passwordHash: true, emailVerifiedAt: true },
  });
  if (!row || !row.passwordHash || !row.emailVerifiedAt) return;

  const token = await signAccountToken({
    sub: row.id,
    email: row.email,
    purpose: "reset-password",
  });
  const url = buildResetUrl(token);
  const result = await sendPasswordResetEmail(row.email, url);
  if (!result.ok) {
    console.error("[reset] send failed:", result.reason);
  }
}

function buildResetUrl(token: string): string {
  const base = env.APP_URL ?? env.NEXTAUTH_URL;
  const url = new URL("/reset-password", base);
  url.searchParams.set("token", token);
  return url.toString();
}

// ─── Password reset — redeem phase ────────────────────────────────────

export type ResetPasswordResult =
  | { ok: true; email: string }
  | {
      ok: false;
      reason:
        | "invalid_token"
        | "user_not_found"
        | "email_changed"
        | "weak_password";
    };

export async function resetPasswordByToken(
  rawToken: string | undefined,
  newPassword: string,
): Promise<ResetPasswordResult> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: "weak_password" };
  }
  const claims = await readAccountToken(rawToken, "reset-password");
  if (!claims) return { ok: false, reason: "invalid_token" };

  const row = await db.query.users.findFirst({
    where: eq(users.id, claims.sub),
    columns: { id: true, email: true },
  });
  if (!row) return { ok: false, reason: "user_not_found" };
  if (row.email !== claims.email.toLowerCase()) {
    return { ok: false, reason: "email_changed" };
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, row.id));

  return { ok: true, email: row.email };
}
