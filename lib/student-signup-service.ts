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
}
