import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";

// OAuth provider linkages. Modelled after the NextAuth Drizzle adapter table
// so we can plug in the official adapter later if we want DB-backed sessions.
// For now we run JWT sessions and only use this table to map a Google
// (provider, providerAccountId) → users.id on repeat sign-ins.

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // e.g. "google". Free-form so future providers slot in without a migration.
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    type: text("type").notNull(), // "oauth" | "oidc"
    refreshToken: text("refresh_token"),
    accessToken: text("access_token"),
    expiresAt: integer("expires_at"),
    tokenType: text("token_type"),
    scope: text("scope"),
    idToken: text("id_token"),
    sessionState: text("session_state"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
    userIdx: index("accounts_user_id_idx").on(t.userId),
  }),
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
