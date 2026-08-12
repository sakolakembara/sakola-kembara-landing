import "server-only";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users, type AdminRole } from "@/lib/db/schema";
import { countSuperAdmins } from "@/lib/users";

// Domain layer for admin-user management. Pure DB + hashing logic — no
// session/audit/redirect concerns. Server actions in
// /admin/settings/actions.ts are thin wrappers that parse FormData, call
// into here, then translate the result into UI/audit outcomes.

export const PASSWORD_MIN_LENGTH = 8;
const BCRYPT_ROUNDS = 10;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

export type CreateAdminInput = {
  email: string;
  name: string | null;
  role: AdminRole;
  password?: string | null;
};

export type CreateAdminResult =
  | { ok: true; id: string }
  | { ok: false; reason: "duplicate_email" };

export async function createAdmin(
  input: CreateAdminInput,
): Promise<CreateAdminResult> {
  const email = input.email.trim().toLowerCase();
  const duplicate = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true },
  });
  if (duplicate) return { ok: false, reason: "duplicate_email" };

  const passwordHash =
    input.password && input.password.length > 0
      ? await hashPassword(input.password)
      : null;

  const [inserted] = await db
    .insert(users)
    .values({
      email,
      name: input.name && input.name.length > 0 ? input.name : null,
      role: input.role,
      passwordHash,
    })
    .returning({ id: users.id });

  return { ok: true, id: inserted.id };
}

export type UpdateAdminInput = {
  id: string;
  name: string | null;
  role: AdminRole;
  password?: string | null;
};

export type UpdateAdminResult =
  | {
      ok: true;
      previousRole: AdminRole;
      passwordChanged: boolean;
      email: string;
    }
  | { ok: false; reason: "not_found" | "last_super_admin" };

export async function updateAdmin(
  input: UpdateAdminInput,
): Promise<UpdateAdminResult> {
  const target = await db.query.users.findFirst({
    where: eq(users.id, input.id),
    columns: { id: true, email: true, role: true },
  });
  if (!target) return { ok: false, reason: "not_found" };

  // Block demoting the last super_admin — would lock everyone out of
  // /admin/settings and there'd be no way to promote a replacement.
  if (target.role === "super_admin" && input.role !== "super_admin") {
    const remaining = await countSuperAdmins(target.id);
    if (remaining === 0) return { ok: false, reason: "last_super_admin" };
  }

  const passwordChanged = Boolean(
    input.password && input.password.length > 0,
  );

  const updates: {
    name: string | null;
    role: AdminRole;
    updatedAt: Date;
    passwordHash?: string;
  } = {
    name: input.name && input.name.length > 0 ? input.name : null,
    role: input.role,
    updatedAt: new Date(),
  };
  if (passwordChanged) {
    updates.passwordHash = await hashPassword(input.password!);
  }

  await db.update(users).set(updates).where(eq(users.id, input.id));

  return {
    ok: true,
    previousRole: target.role as AdminRole,
    passwordChanged,
    email: target.email,
  };
}

export type DeleteAdminResult =
  | { ok: true; email: string; role: AdminRole }
  | { ok: false; reason: "not_found" | "self" | "last_super_admin" };

export async function deleteAdmin(
  id: string,
  actorId: string,
): Promise<DeleteAdminResult> {
  const target = await db.query.users.findFirst({
    where: eq(users.id, id),
    columns: { id: true, email: true, role: true },
  });
  if (!target) return { ok: false, reason: "not_found" };
  if (target.id === actorId) return { ok: false, reason: "self" };

  if (target.role === "super_admin") {
    const remaining = await countSuperAdmins(target.id);
    if (remaining === 0) return { ok: false, reason: "last_super_admin" };
  }

  await db.delete(users).where(eq(users.id, id));
  return { ok: true, email: target.email, role: target.role as AdminRole };
}
