import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { isGrantableArea, type GrantableArea } from "../auth/permissions";
import * as schema from "./schema";

/**
 * The areas granted to one user, straight from D1 (no cache of any kind, so a
 * revoked grant stops working on the very next request). Rows with an area
 * name the code does not know are dropped: the CHECK in the migration should
 * make that impossible, and an unknown name must never grant anything.
 */
export async function loadGrantedAreas(d1: D1Database, userId: string): Promise<GrantableArea[]> {
  const db = drizzle(d1, { schema });
  const rows = await db
    .select({ area: schema.adminAreaGrants.area })
    .from(schema.adminAreaGrants)
    .where(eq(schema.adminAreaGrants.userId, userId));
  return rows.map((row) => row.area).filter(isGrantableArea);
}
