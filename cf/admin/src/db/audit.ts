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
  // Pengaturan. Legacy labels: "Admin ditambahkan", "Admin diubah". `admin.update` is
  // used for area grants and for a role change; metadata.field says which.
  | "admin.create"
  | "admin.update"
  // New in D1 (the legacy app deleted admins; here they are deactivated, so the audit trail keeps pointing at a row).
  | "admin.deactivate"
  | "admin.reactivate"
  | "admin.invite_resend"
  // Written by the auth flows, with the person themselves as the actor (legacy names).
  | "student.register"
  | "user.email_verified"
  | "user.password_reset";

/** Resource types written so far (legacy names, see RESOURCE_TYPES in lib/audit-labels.ts). */
export type AuditResourceType = "announcement" | "admin_user" | "user";

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

/**
 * For events that happen inside Better Auth's own flows (registration, email
 * verified, password reset), where there is no mutation of ours to put in a
 * batch. Best-effort like the legacy `writeAudit`: a failed audit write must
 * not undo a verification or a password reset, so it is logged (no row content)
 * and swallowed.
 */
export async function writeAuditSafely(db: Db, actor: Pick<AuthUser, "id" | "email">, entry: AuditEntry): Promise<void> {
  try {
    await auditStatement(db, actor, entry);
  } catch {
    console.error(`[audit] failed to write ${entry.action}`);
  }
}
