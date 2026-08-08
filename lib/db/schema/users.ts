import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";

// Unified users table. Replaces the old `admin_users` table. A single row here
// represents either an admin (viewer / editor / super_admin) or a prospective
// student who signed in through the landing page to submit an application.
//
// - Google-only students land with a `passwordHash` of null and a linked row
//   in `accounts`.
// - Admins may sign in with Google *or* with email + password (Credentials
//   provider). Their `passwordHash` is a bcrypt digest.
// - The super-admin bootstrap script seeds a Credentials-based super_admin so
//   fresh deployments can log in before anyone has a Google account linked.

export const userRole = ["student", "viewer", "editor", "super_admin"] as const;
export type UserRole = (typeof userRole)[number];

export const adminRoles = ["viewer", "editor", "super_admin"] as const;
export type AdminRole = (typeof adminRoles)[number];

export function isAdminRole(role: UserRole | null | undefined): role is AdminRole {
  return role === "viewer" || role === "editor" || role === "super_admin";
}

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(), // lowercased on insert
    name: text("name"),
    /** Avatar / profile picture URL — populated from Google on OAuth sign-in. */
    image: text("image"),
    role: text("role", { enum: userRole }).notNull().default("student"),
    /** bcrypt digest. Null when the account is Google-only. */
    passwordHash: text("password_hash"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index("users_email_idx").on(t.email),
    roleIdx: index("users_role_idx").on(t.role),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
