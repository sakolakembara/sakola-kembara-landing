import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const reportCategory = ["yearly", "financial", "impact", "donation"] as const;
export type ReportCategory = (typeof reportCategory)[number];

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category", { enum: reportCategory }).notNull(),
    // Free-form string so we can express Indonesian academic years like
    // "2025/2026" as well as single-year civic reports ("2025"). Sorted
    // lexicographically desc — works because we always pad to 4 digits.
    year: text("year").notNull(),

    // Path under public/. Example: /reports/2025-2026/impact/laporan-dampak.pdf
    filePath: text("file_path").notNull(),
    fileSize: integer("file_size").notNull(), // bytes

    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    categoryYearIdx: index("reports_category_year_idx").on(t.category, t.year),
  }),
);

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
