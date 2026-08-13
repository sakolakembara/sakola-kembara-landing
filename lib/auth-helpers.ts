import "server-only";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { adminRoles, users, type AdminRole, type UserRole } from "@/lib/db/schema";

export interface AdminContext {
  /** Lowercased email of the signed-in admin. */
  email: string;
  /** users.id of the actor, for audit rows / FKs. */
  userId: string;
  role: AdminRole;
}

function isAdminRole(role: unknown): role is AdminRole {
  return typeof role === "string" && (adminRoles as readonly string[]).includes(role);
}

/**
 * Enforce that the request has a signed-in user with an admin role.
 * Redirects to /login when not signed in; redirects to /portal with an
 * `error=admin-only` flag when signed in as a student.
 *
 * Loads the DB row so callers get `userId` for audit writes without another
 * query. Prefer this over hand-rolled `auth()` + role checks in each action.
 */
export async function requireAdmin(): Promise<AdminContext> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) redirect("/login");

  const sessionRole = (session!.user as { role?: string }).role;
  if (!isAdminRole(sessionRole)) redirect("/portal?error=admin-only");

  // Re-read the row so we always have the current DB role — the JWT can be
  // stale if the user was demoted mid-session.
  const row = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true, role: true },
  });
  if (!row || !isAdminRole(row.role)) redirect("/portal?error=admin-only");

  return { email, userId: row!.id, role: row!.role as AdminRole };
}

export async function requireSuperAdmin(): Promise<AdminContext> {
  const ctx = await requireAdmin();
  if (ctx.role !== "super_admin") {
    redirect("/admin/settings?error=Hanya+super+admin+yang+dapat+mengubah+pengaturan");
  }
  return ctx;
}

export interface StudentContext {
  email: string;
  userId: string;
  role: UserRole;
  name: string | null;
  image: string | null;
  emailVerifiedAt: Date | null;
}

/** Enforce student sign-in. Redirects to /login when unauthenticated. */
export async function requireStudent(fromPath?: string): Promise<StudentContext> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    const url = fromPath ? `/login?from=${encodeURIComponent(fromPath)}` : "/login";
    redirect(url);
  }

  const row = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: {
      id: true,
      email: true,
      role: true,
      name: true,
      image: true,
      emailVerifiedAt: true,
    },
  });
  if (!row) redirect("/login");

  return {
    email: row!.email,
    userId: row!.id,
    role: row!.role,
    name: row!.name,
    image: row!.image,
    emailVerifiedAt: row!.emailVerifiedAt,
  };
}
