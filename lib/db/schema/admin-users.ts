import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";

export const adminUserRole = ["super_admin", "editor", "viewer"] as const;
export type AdminUserRole = (typeof adminUserRole)[number];

export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(), // lowercased on insert
    displayName: text("display_name"),
    role: text("role", { enum: adminUserRole }).notNull().default("editor"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index("admin_users_email_idx").on(t.email),
  }),
);

export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;
