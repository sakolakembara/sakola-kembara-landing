import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./users";

// A yearly admission batch (e.g. "Gen 6 — 2026/2027"). Admissions run once a
// year, so batch is the primary time boundary: registrations open when a
// batch is opened, close on its closesAt, and results become visible to
// students only after `resultsPublishedAt` is set (batch-level publish).

export const admissionBatches = pgTable(
  "admission_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** The academic year the batch belongs to (e.g. 2026 for "2026/2027"). */
    year: integer("year").notNull(),
    /** Human label shown in UIs, e.g. "Gen 6 — 2026/2027". */
    name: text("name").notNull(),
    /** Optional long description; admin-only. */
    description: text("description"),

    /** Registration window. Students can submit only while now ∈ [opensAt, closesAt]. */
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
    closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),

    /**
     * When non-null, the batch's results are visible to students on /portal.
     * Admin sets this once every application in the batch has been decided.
     */
    resultsPublishedAt: timestamp("results_published_at", { withTimezone: true }),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    yearIdx: index("admission_batches_year_idx").on(t.year),
    opensAtIdx: index("admission_batches_opens_at_idx").on(t.opensAt),
    // Only one batch per year — enforced at the DB level.
    yearUnique: unique("admission_batches_year_unique").on(t.year),
  }),
);

export type AdmissionBatch = typeof admissionBatches.$inferSelect;
export type NewAdmissionBatch = typeof admissionBatches.$inferInsert;
