import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { adminUsers } from "./admin-users";

export const applicationStatus = ["pending", "under_review", "accepted", "rejected"] as const;
export type ApplicationStatus = (typeof applicationStatus)[number];

export const studentApplications = pgTable(
  "student_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    whatsapp: text("whatsapp").notNull(),

    schoolName: text("school_name").notNull(),
    graduationYear: integer("graduation_year").notNull(),
    branchPreference: text("branch_preference"),

    motivation: text("motivation").notNull(),
    economicBackground: text("economic_background"),

    status: text("status", { enum: applicationStatus }).notNull().default("pending"),
    reviewNotes: text("review_notes"),
    reviewedBy: uuid("reviewed_by").references(() => adminUsers.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("student_applications_status_idx").on(t.status),
    submittedAtIdx: index("student_applications_submitted_at_idx").on(t.submittedAt),
    emailIdx: index("student_applications_email_idx").on(t.email),
  }),
);

export type StudentApplication = typeof studentApplications.$inferSelect;
export type NewStudentApplication = typeof studentApplications.$inferInsert;
