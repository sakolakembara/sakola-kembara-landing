import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { AuthUser } from "../context";
import * as schema from "./schema";

export type Db = DrizzleD1Database<typeof schema>;

/**
 * Actions written so far. The names are the legacy ones (lib/audit-labels.ts,
 * which holds their Indonesian labels); the union grows as each area is
 * ported. Rows keep their action as free text, so old names stay readable.
 */
export type AuditAction =
  | "announcement.create"
  | "announcement.update"
  | "announcement.delete"
  // An admin's area grants changed (Pengaturan). Legacy label: "Admin diubah".
  | "admin.update";

/** Resource types written so far (legacy names, see RESOURCE_TYPES in lib/audit-labels.ts). */
export type AuditResourceType = "announcement" | "admin_user";

export interface AuditEntry {
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  metadata?: Record<string, unknown>;
}

/**
 * The audit row for one mutation, as an unexecuted statement. Callers put it
 * in the same `db.batch([...])` as the mutation, which D1 runs as one
 * transaction: there is never a change without its audit row, nor the reverse.
 * (The legacy app writes the row after the fact and swallows failures; that
 * trade is not needed here because the batch costs no extra round trip.)
 */
export function auditStatement(db: Db, actor: Pick<AuthUser, "id" | "email">, entry: AuditEntry) {
  return db.insert(schema.auditLog).values({
    actorId: actor.id,
    actorEmail: actor.email.toLowerCase(),
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    metadata: entry.metadata ?? null,
  });
}
