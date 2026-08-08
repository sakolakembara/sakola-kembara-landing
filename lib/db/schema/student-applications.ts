import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { admissionBatches } from "./admission-batches";

export const applicationStatus = ["pending", "under_review", "accepted", "rejected"] as const;
export type ApplicationStatus = (typeof applicationStatus)[number];

/**
 * Shape of everything the multi-step recruitment form collects that isn't
 * already a top-level column. Rendered by the admin detail view via
 * `lib/student-form-types.ts`. Optional groups are `null` when not applicable.
 */
export type StudentApplicationFormData = {
  identity: {
    nickname: string;
    gender: "laki-laki" | "perempuan";
    religion: string;
    homeAddress: string;
  };
  household: {
    livingWith: string[]; // ["Ayah", "Ibu", "Kakek"]
    father: { name: string; occupation: string; income: number };
    mother: { name: string; occupation: string; income: number };
    otherEarners: { relation: string; income: number }[];
    familySize: number;
  };
  housing: {
    residenceStatus: string;
    buildingArea: number;
    motorcycles: number;
    cars: number;
    debt: {
      type: string;
      amount: number;
      installmentMonths: number;
      description: string;
    } | null;
  };
  organizations: { name: string; position: string }[];
  documents: {
    fatherIncomeUrl: string | null;
    motherIncomeUrl: string | null;
    otherEarner1IncomeUrl: string | null;
    otherEarner2IncomeUrl: string | null;
    debtProofUrl: string | null;
    electricityBillUrl: string;
    familyCardUrl: string;
    parentPermissionUrl: string;
    selfPhotoUrl: string;
    dtksRegistered: boolean;
    /** Only set when dtksRegistered is true. */
    dtksUrl: string | null;
    houseImagesUrl: string;
    vehicleImagesUrl: string;
  };
  marketing: {
    instagramUsername: string;
    instagramFollowProofUrl: string;
    broadcastProofUrl: string;
    twibbonUploadUrl: string;
    storyUploadUrl: string;
  };
  interview: {
    motivationHigherEducation: string;
    motivationSakem: string;
    consistencyPlan: string;
    attendanceCommitment: string;
    parentResponse: string;
    ifParentChangesMind: string;
    agreedToSignedStatement: boolean;
  };
};

export const studentApplications = pgTable(
  "student_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * The student user who owns this application. Nullable only to preserve
     * historic rows that predate the auth-gated form; every new submission
     * requires a signed-in student and writes this column.
     */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /**
     * The admission batch this application belongs to. Nullable for the same
     * historic-row reason as userId above. Enforced not-null in server action.
     */
    batchId: uuid("batch_id").references(() => admissionBatches.id, {
      onDelete: "restrict",
    }),

    fullName: text("full_name").notNull(),
    /** Snapshot of the account email at submission time. */
    email: text("email"),
    whatsapp: text("whatsapp").notNull(),

    schoolName: text("school_name").notNull(),
    /**
     * Text so we can carry the radio values verbatim
     * (e.g. `"2025/2026 (Gap Year)"` or `"2027 (Kelas 12)"`).
     */
    graduationYear: text("graduation_year").notNull(),
    branchPreference: text("branch_preference"),

    /**
     * Legacy field. New form leaves this null and stores the rich interview
     * answers in `formData.interview`. Kept nullable for backward compat.
     */
    motivation: text("motivation"),
    economicBackground: text("economic_background"),

    /** Everything the multi-step recruitment wizard collects. See type above. */
    formData: jsonb("form_data").$type<StudentApplicationFormData | null>(),

    status: text("status", { enum: applicationStatus }).notNull().default("pending"),
    reviewNotes: text("review_notes"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("student_applications_status_idx").on(t.status),
    submittedAtIdx: index("student_applications_submitted_at_idx").on(t.submittedAt),
    emailIdx: index("student_applications_email_idx").on(t.email),
    userIdx: index("student_applications_user_id_idx").on(t.userId),
    batchIdx: index("student_applications_batch_id_idx").on(t.batchId),
    // A given user can only have one application per batch.
    userBatchUnique: unique("student_applications_user_batch_unique").on(
      t.userId,
      t.batchId,
    ),
  }),
);

export type StudentApplication = typeof studentApplications.$inferSelect;
export type NewStudentApplication = typeof studentApplications.$inferInsert;
