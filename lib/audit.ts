import { db } from "@/lib/db";
import type { AuditAction, AuditResourceType } from "@/lib/audit-labels";
import { auditLog, type NewAuditEntry } from "@/lib/db/schema";

interface WriteAuditOptions {
  /** Email of whoever performed the action. Denormalized so the row survives
   *  the actor being deleted later. Always required. */
  actorEmail: string;
  /** admin_users.id when an admin performed the action; null for public
   *  events like a student submitting the registration form. */
  actorId?: string | null;
  /** Dotted event name, e.g. "application.submit" or "report.delete". Only
   *  actions with a label in lib/audit-labels.ts are accepted. */
  action: AuditAction;
  resourceType?: AuditResourceType;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append a single audit_log row. **Best-effort** — never throws; failures are
 * logged via console.error so a misbehaving audit write can't block the user
 * response. Callers should always call this AFTER the underlying mutation
 * succeeds.
 *
 * Server components, server actions, and API routes can call this freely.
 */
export async function writeAudit(opts: WriteAuditOptions): Promise<void> {
  const row: NewAuditEntry = {
    actorEmail: opts.actorEmail.toLowerCase(),
    actorId: opts.actorId ?? null,
    action: opts.action,
    resourceType: opts.resourceType ?? null,
    resourceId: opts.resourceId ?? null,
    metadata: opts.metadata ?? null,
  };

  try {
    await db.insert(auditLog).values(row);
  } catch (err) {
    console.error("[audit] failed to write entry:", err, row);
  }
}
