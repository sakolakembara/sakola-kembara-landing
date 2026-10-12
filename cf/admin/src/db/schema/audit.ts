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
    index("audit_log_created_at_idx").on(t.createdAt),
    index("audit_log_resource_idx").on(t.resourceType, t.resourceId),
    jsonCheck("audit_log_metadata_json_check", t.metadata),
  ],
);
