import "server-only";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

// Local student signup. Not a full user-management surface — that's
// lib/admin-users-service.ts for admins. This module only creates
// student-role accounts from the public /register form.

export const STUDENT_PASSWORD_MIN_LENGTH = 8;
const BCRYPT_ROUNDS = 10;

export type CreateStudentInput = {
  email: string;
  name: string;
  password: string;
};

export type CreateStudentResult =
  | { ok: true; id: string }
  | { ok: false; reason: "email_taken" | "email_taken_no_password" };

/**
 * Create a new student account with a bcrypt-hashed password.
 *
 * If the email already belongs to a Google-only account (has a users row but
 * no `password_hash`), we return `email_taken_no_password` so the UI can
 * suggest signing in with Google instead of registering a fresh account. If
 * the email already has a password, `email_taken` is returned and the user
 * is nudged to sign in.
 */
export async function createStudentAccount(
  input: CreateStudentInput,
): Promise<CreateStudentResult> {
  const email = input.email.trim().toLowerCase();

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true, passwordHash: true },
  });
  if (existing) {
    return {
      ok: false,
      reason: existing.passwordHash ? "email_taken" : "email_taken_no_password",
    };
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  try {
    const [inserted] = await db
      .insert(users)
      .values({
        email,
        name: input.name.trim() || null,
        role: "student",
        passwordHash,
      })
      .returning({ id: users.id });

    return { ok: true, id: inserted.id };
  } catch (err) {
    // The existence check above is advisory, not a lock. A double-submitted
    // signup form — the ordinary case, not an exotic one — races two inserts
    // past it and only `users_email_unique` stops the second. Report that as
    // the same "already taken" the sequential path returns, rather than
    // letting a 23505 surface as a 500 on a form the user submitted twice.
    if (isUniqueViolation(err)) return { ok: false, reason: "email_taken" };
    throw err;
  }
}

/** Postgres unique-violation SQLSTATE. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}
