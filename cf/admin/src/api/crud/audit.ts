import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { AuthUser } from "../../context";
import type { AuditAction, AuditResourceType, Db } from "../../db/audit";
import { auditLog } from "../../db/schema";

/** What `db.batch` of a D1 database takes. */
type SqliteBatchItem = BatchItem<"sqlite">;

// The audit row of a CRUD change (docs/cloudflare/admin-crud.md#8-audit-rows).
// It is written in the SAME `db.batch` (one D1 transaction) as the change, and
// only if the change took effect, so there is never a change without its row,
// nor a row for a save that lost a race.
//
// What goes in `metadata`, and nothing else:
//   fields  the NAMES of the columns written (for an update: those that changed)
//   label   an optional short, NON-personal name (an announcement's title)
// Never a body, an email, a phone number, message text, markdown or HTML.

export const MAX_LABEL_LENGTH = 120;

export interface AuditNote {
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  /** Column names, not values. */
  fields?: readonly string[];
  /** A short non-personal name of the row. Cut to 120 characters. */
  label?: string | null;
}

/** The JSON stored in `audit_log.metadata`, or null when there is nothing to say. Exported for the tests. */
export function auditMetadata(note: Pick<AuditNote, "fields" | "label">): string | null {
  const metadata: { fields?: string[]; label?: string } = {};
  if (note.fields && note.fields.length > 0) metadata.fields = [...note.fields];
  const label = note.label?.trim();
  if (label) metadata.label = label.length > MAX_LABEL_LENGTH ? `${label.slice(0, MAX_LABEL_LENGTH - 1)}…` : label;
  return Object.keys(metadata).length === 0 ? null : JSON.stringify(metadata);
}

type Actor = Pick<AuthUser, "id" | "email">;

/** The audit_log columns in the order Drizzle lists them in an `insert ... select`. */
const AUDIT_COLUMNS = Object.keys(getTableColumns(auditLog));

/**
 * Runs `statements` and then writes the audit row, all in one `db.batch`.
 *
 * The row is inserted `WHERE changes() > 0`: SQLite's `changes()` is the number of rows the statement just
 * before it changed, so **the mutation must be the last of `statements`** (an update or delete that matched
 * nothing writes no audit row, and a stale save leaves no trace). Returns the results of `statements`, in
 * order (not the audit row's).
 *
 * (An `insert ... select` rather than `db.run(sql...)`: Drizzle's D1 batch can only carry its own query
 * builders, and a raw `run` has no prepared statement to bind.)
 */
export async function withAudit(db: Db, actor: Actor, note: AuditNote, statements: readonly [SqliteBatchItem, ...SqliteBatchItem[]]): Promise<unknown[]> {
  const values: Record<string, SQL> = {
    id: sql`${crypto.randomUUID()}`,
    actorId: sql`${actor.id}`,
    actorEmail: sql`${actor.email.toLowerCase()}`,
    action: sql`${note.action}`,
    resourceType: sql`${note.resourceType}`,
    resourceId: sql`${note.resourceId}`,
    metadata: sql`${auditMetadata(note)}`,
    createdAt: sql`cast(unixepoch('subsecond') * 1000 as integer)`,
  };
  for (const column of AUDIT_COLUMNS) if (!(column in values)) throw new Error(`crud audit: audit_log has a column "${column}" that withAudit does not fill`);
  const audit = db.insert(auditLog).select(sql`select ${sql.join(AUDIT_COLUMNS.map((column) => values[column]!), sql`, `)} where changes() > 0`);
  const results: readonly unknown[] = await db.batch([...statements, audit] as [SqliteBatchItem, ...SqliteBatchItem[]]);
  return results.slice(0, -1);
}

function normalise(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return value;
}

/** The names, in `values`' order, whose value differs from the same key in `before`. Dates compare by instant, arrays and objects by their JSON, `undefined` is `null`. */
export function changedFields(before: Record<string, unknown>, values: Record<string, unknown>): string[] {
  return Object.keys(values).filter((key) => normalise(before[key]) !== normalise(values[key]));
}
