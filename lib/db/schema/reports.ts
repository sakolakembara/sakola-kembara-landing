import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { adminUsers } from "./admin-users";

export const reportCategory = ["yearly", "financial", "impact", "donation"] as const;
export type ReportCategory = (typeof reportCategory)[number];

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    category: text("category", { enum: reportCategory }).notNull(),
    year: integer("year").notNull(),

    // Path under public/. Example: /reports/2025/impact/laporan-dampak-2025.pdf
    filePath: text("file_path").notNull(),
    fileSize: integer("file_size").notNull(), // bytes

    uploadedBy: uuid("uploaded_by").references(() => adminUsers.id, { onDelete: "set null" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    categoryYearIdx: index("reports_category_year_idx").on(t.category, t.year),
  }),
);

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
