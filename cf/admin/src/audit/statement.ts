import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { AuthUser } from "../context";
import type { AuditEntry, Db } from "../db/audit";
import { auditLog } from "../db/schema";

// An audit row for a mutation that may turn out to have changed nothing (a save that lost a race), as an
// unexecuted statement for the same `db.batch` as the mutation. It is `insert ... select ... where changes() > 0`:
// SQLite's `changes()` is the number of rows the statement just before it changed, so the mutation must be the
// LAST statement before this one, and a mutation that matched no row leaves no audit row.
//
// The CRUD kit's `withAudit` (src/api/crud/audit.ts) does the same for the rows it writes, but its note carries
// only column names and a label. The Pengaturan rows keep the metadata the first admin-user endpoints already
// wrote (the role before and after, the areas, the address), so this takes the entry as `auditStatement` does.
// Same columns, same rule, one more statement shape; src/audit/present.ts is what decides which of those keys
// the Aktivitas page may show.

type Actor = Pick<AuthUser, "id" | "email">;

/** The audit_log columns in the order Drizzle lists them in an `insert ... select`. */
const COLUMNS = Object.keys(getTableColumns(auditLog));

export function auditStatementIfChanged(db: Db, actor: Actor, entry: AuditEntry) {
  const values: Record<string, SQL> = {
    id: sql`${crypto.randomUUID()}`,
    actorId: sql`${actor.id}`,
    actorEmail: sql`${actor.email.toLowerCase()}`,
    action: sql`${entry.action}`,
    resourceType: sql`${entry.resourceType}`,
    resourceId: sql`${entry.resourceId}`,
    metadata: sql`${entry.metadata ? JSON.stringify(entry.metadata) : null}`,
    createdAt: sql`cast(unixepoch('subsecond') * 1000 as integer)`,
  };
  for (const column of COLUMNS) if (!(column in values)) throw new Error(`audit: audit_log has a column "${column}" that auditStatementIfChanged does not fill`);
  return db.insert(auditLog).select(sql`select ${sql.join(COLUMNS.map((column) => values[column]!), sql`, `)} where changes() > 0`);
}
