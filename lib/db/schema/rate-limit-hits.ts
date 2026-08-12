import {
  pgTable,
  text,
  integer,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

// Fixed-window counter for spam / abuse throttling on public POST endpoints.
// One row per (key, window_start) pair — the row is created on the first
// hit inside a window and incremented on each subsequent hit. Windows are
// coarse (60s) so the table stays tiny; a nightly job (or ad-hoc DELETE)
// can prune anything older than a day.
//
// Not built for auth-grade brute-force protection — for that we'd want
// per-account lockout state in a separate table.

export const rateLimitHits = pgTable(
  "rate_limit_hits",
  {
    /** Bucket identifier: `<action>:<ip>` (or another stable dimension). */
    key: text("key").notNull(),
    /** Window start timestamp, floored to the window size. */
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    /** Number of hits observed in this window. */
    hits: integer("hits").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.key, t.windowStart] }),
    updatedAtIdx: index("rate_limit_hits_updated_at_idx").on(t.updatedAt),
  }),
);

export type RateLimitHit = typeof rateLimitHits.$inferSelect;
