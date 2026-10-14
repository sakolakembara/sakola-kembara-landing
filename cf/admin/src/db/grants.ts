import { eq, sql } from "drizzle-orm";
import { isGrantableArea, type GrantableArea } from "../auth/permissions";
import * as schema from "./schema";
import { getDb } from "./client";
import { memoPerBinding } from "./memo";

/**
 * The areas granted to one user, straight from D1 (no cache of any kind, so a
 * revoked grant stops working on the very next request). Rows with an area
 * name the code does not know are dropped: the CHECK in the migration should
 * make that impossible, and an unknown name must never grant anything.
 */
export async function loadGrantedAreas(d1: D1Database, userId: string): Promise<GrantableArea[]> {
  // The statement is built once per binding (an editor's every request asks); only the user id is bound per request.
  // Nothing is remembered about the answer: the rows are read from D1 now.
  const query = memoPerBinding(d1, "granted-areas", () =>
    getDb(d1)
      .select({ area: schema.adminAreaGrants.area })
      .from(schema.adminAreaGrants)
      .where(eq(schema.adminAreaGrants.userId, sql.placeholder("userId")))
      .prepare(),
  );
  const rows = await query.all({ userId });
  return rows.map((row) => row.area).filter(isGrantableArea);
}
