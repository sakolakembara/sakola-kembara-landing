import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { grantableAreas } from "../../auth/permissions";
import { createdAt, enumCheck } from "./_common";
import { users } from "./auth";

/**
 * Which areas an `editor` may change (new in D1; the legacy app had no such
 * thing). One row per (user, area). The area names and what they mean are in
 * src/auth/permissions.ts. Only editors are affected by these rows: a viewer,
 * a student or a super_admin is decided by role alone, so a stray row for
 * another role is ignored, never obeyed.
 *
 * - The primary key is (user_id, area): the pair is unique, and a second grant
 *   of the same area is an error, not a duplicate row.
 * - `sistem` is not grantable (super_admin only), so the CHECK leaves it out.
 * - Deleting the user deletes their grants; deleting the granting admin keeps
 *   the grant and clears `granted_by`.
 */
export const adminAreaGrants = sqliteTable(
  "admin_area_grants",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    area: text("area", { enum: grantableAreas }).notNull(),
    grantedBy: text("granted_by").references(() => users.id, { onDelete: "set null" }),
    grantedAt: createdAt("granted_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.area] }), enumCheck("admin_area_grants_area_check", t.area, grantableAreas)],
);
