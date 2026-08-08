import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    // Denormalized — survives user deletion so we always know "who did this".
    actorEmail: text("actor_email").notNull(),

    // e.g. "report.create", "application.accept", "announcement.publish"
    action: text("action").notNull(),

    // e.g. "report" / "application" / "announcement". Null for global actions.
    resourceType: text("resource_type"),
    resourceId: text("resource_id"), // UUID or slug

    // Arbitrary context: before/after snapshots, request IP, etc.
    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actorIdx: index("audit_log_actor_idx").on(t.actorId),
    createdAtIdx: index("audit_log_created_at_idx").on(t.createdAt),
    resourceIdx: index("audit_log_resource_idx").on(t.resourceType, t.resourceId),
  }),
);

export type AuditEntry = typeof auditLog.$inferSelect;
export type NewAuditEntry = typeof auditLog.$inferInsert;
