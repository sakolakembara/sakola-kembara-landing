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
  // Uploads to R2 (src/uploads/store.ts). New names: the legacy app wrote one per kind (blog.upload_image, team.upload_photo).
  | "upload.create"
  | "upload.delete"
  // The CRUD kit's `<name>.create|update|delete` for every resource the legacy admin had (src/api/crud, docs/cloudflare/admin-crud.md).
  | CrudAction
  // The legacy verb actions (lib/audit-labels.ts), so the area that ports each one does not have to edit this union.
  | "application.submit"
  | "application.pending"
  | "application.under_review"
  | "application.accepted"
  | "application.rejected"
  | "application.revoke"
  // An applicant's uploaded file (SAKEM-083, docs/cloudflare/portal-architecture.md, 8.6 and 8.9): an admin opening one (resource `application_file`,
  // metadata: the application's id and the slot) and the manual purge of an application's files (resource `application`, metadata: a count and the file
  // ids). Ids and counts only, never a name or an address.
  | "application_file.view"
  | "application_file.purge"
  | "batch.publish_results"
  | "batch.unpublish_results"
  | "contact_message.submit"
  | "contact_message.read"
  | "contact_message.unread"
  // New in D1 (the legacy blog had no draft state: every saved article was public). Docs: docs/cloudflare/admin-blog.md.
  | "blog.publish"
  | "blog.unpublish"
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

/**
 * Resource types (legacy names, see RESOURCE_TYPES in lib/audit-labels.ts), all of them declared up
 * front so no area has to edit this file. `media` is the uploads table.
 */
export type AuditResourceType =
  | "media"
  | "announcement"
  | "admin_user"
  | "user"
  | "application"
  | "application_file"
  | "batch"
  | "report"
  | "blog"
  | "team_member"
  | "contact_message"
  | "site_resource"
  | "shortlink";

/** The legacy short names of the resources that have `<name>.create|update|delete` (the first part of the action). */
export type CrudName = "announcement" | "report" | "blog" | "team" | "resource" | "shortlink" | "batch" | "contact_message";
export type CrudAction = `${CrudName}.${"create" | "update" | "delete"}`;

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
