import "server-only";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { adminUsers, type AdminUser } from "@/lib/db/schema";

// Low-traffic admin reader: skip unstable_cache — consistency after a role
// change matters more than the few extra ms per request.

export async function getAllAdminUsers(): Promise<AdminUser[]> {
  return db
    .select()
    .from(adminUsers)
    .orderBy(asc(adminUsers.email));
}

export async function getAdminUserById(
  id: string,
): Promise<AdminUser | null> {
  const row = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.id, id),
  });
  return row ?? null;
}

export async function countSuperAdmins(excludeId?: string): Promise<number> {
  const where = excludeId
    ? and(eq(adminUsers.role, "super_admin"), ne(adminUsers.id, excludeId))
    : eq(adminUsers.role, "super_admin");
  const [row] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(adminUsers)
    .where(where);
  return row?.count ?? 0;
}
