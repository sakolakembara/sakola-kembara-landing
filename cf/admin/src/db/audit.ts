import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { AuthUser } from "../context";
import * as schema from "./schema";

export type Db = DrizzleD1Database<typeof schema>;

export interface AuditEntry {
  action: "announcement.create" | "announcement.update" | "announcement.delete";
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
    resourceType: "announcement",
    resourceId: entry.resourceId,
    metadata: entry.metadata ?? null,
  });
}
