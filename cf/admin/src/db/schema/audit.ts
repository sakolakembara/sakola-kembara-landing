import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, jsonCheck, uuidPk } from "./_common";
import { users } from "./auth";

/**
 * Port of lib/db/schema/audit-log.ts. Append-only: nothing in the API updates
 * or deletes a row (the retention job of a later ticket may delete old ones).
 * `metadata` is JSON text (SQLite has no jsonb).
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: uuidPk(),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    /** Denormalized so the row says who did it even after the user is deleted. */
    actorEmail: text("actor_email").notNull(),
    /** e.g. "report.create", "application.accepted". Free text, like legacy: old rows keep old names. */
    action: text("action").notNull(),
    /** e.g. "report", "application". Null for global actions. */
    resourceType: text("resource_type"),
    resourceId: text("resource_id"), // UUID or slug
    /** Arbitrary context: before/after values. Never message text, passwords or tokens. */
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_actor_idx").on(t.actorId),
    // The Aktivitas page walks the log newest first, `(created_at, id)` descending, and filters by one of
    // action, resource type or actor email: each filter's index ends in the same two columns, so a page is a
    // seek and a short walk (rows read follow the page size, not the table) and no sort is needed
    // (docs/cloudflare/admin-sistem.md#query-plans-and-rows-read). Migration 0007; the old `created_at` index
    // is replaced by the first of these (same leading column, so the retention job's range delete still seeks).
    index("audit_log_created_at_id_idx").on(t.createdAt, t.id),
    index("audit_log_action_created_idx").on(t.action, t.createdAt, t.id),
    index("audit_log_resource_type_created_idx").on(t.resourceType, t.createdAt, t.id),
    index("audit_log_actor_email_created_idx").on(t.actorEmail, t.createdAt, t.id),
    index("audit_log_resource_idx").on(t.resourceType, t.resourceId),
    jsonCheck("audit_log_metadata_json_check", t.metadata),
  ],
);
