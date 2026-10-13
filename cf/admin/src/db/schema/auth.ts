import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { userRoles } from "../../auth/roles";
import { createdAt, enumCheck, timestampMs, updatedAt } from "./_common";

// Better Auth owns these four tables (user, session, account, verification),
// so their shape follows what Better Auth reads and writes. The `user` model
// is mapped onto a table called `users`, the same name as the legacy Postgres
// table (lib/db/schema/users.ts). Legacy `accounts` (NextAuth OAuth links) is
// replaced by Better Auth's `account`, which also holds the password hash.

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(), // Better Auth lowercases on insert
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    /** Additional field. Clients can never set it (`input: false` in the auth factory). */
    role: text("role", { enum: userRoles }).notNull().default("student"),
    /**
     * Set when a super_admin deactivates the account (SAKEM-081, auth). A
     * deactivated user cannot sign in by any method and every session was
     * revoked at that moment; the row, its audit trail and its role stay.
     * Additional field for Better Auth (`input: false`), so no client can set it.
     * The migrations also add a trigger that refuses to remove the last super_admin
     * who can sign in (not deactivated, has an account; an admin never has to verify
     * an address, SAKEM-089): see migrations/0006_keep_one_super_admin.sql, the trigger
     * in migrations/0010_last_super_admin_signin.sql and the view it reads, as
     * migrations/0011_admin_signin_without_verification.sql defines it.
     */
    deactivatedAt: timestampMs("deactivated_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("users_role_idx").on(t.role), enumCheck("users_role_check", t.role, userRoles)],
);

export const sessions = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestampMs("expires_at").notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const accounts = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestampMs("access_token_expires_at"),
    refreshTokenExpiresAt: timestampMs("refresh_token_expires_at"),
    scope: text("scope"),
    /** Password hash for the "credential" provider. See src/auth/password.ts for the format. */
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verifications = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    /** Stored hashed (`verification.storeIdentifier` in the auth factory). */
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestampMs("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);
