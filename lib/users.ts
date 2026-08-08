import "server-only";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  adminRoles,
  users,
  type AdminRole,
  type User,
} from "@/lib/db/schema";

// Low-traffic admin reader: skip unstable_cache — consistency after a role
// change matters more than the few extra ms per request.

/** Every user with an admin role (viewer / editor / super_admin). */
export async function getAllAdmins(): Promise<User[]> {
  return db
    .select()
    .from(users)
    .where(inArray(users.role, adminRoles as unknown as AdminRole[]))
    .orderBy(asc(users.email));
}

export async function getUserById(id: string): Promise<User | null> {
  const row = await db.query.users.findFirst({ where: eq(users.id, id) });
  return row ?? null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const row = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });
  return row ?? null;
}

export async function countSuperAdmins(excludeId?: string): Promise<number> {
  const where = excludeId
    ? and(eq(users.role, "super_admin"), ne(users.id, excludeId))
    : eq(users.role, "super_admin");
  const [row] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(users)
    .where(where);
  return row?.count ?? 0;
}
