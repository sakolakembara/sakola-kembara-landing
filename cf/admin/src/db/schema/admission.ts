import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import type { FormDataV3 } from "../../../shared/application-form/form-data";
import { createdAt, enumCheck, jsonCheck, timestampMs, updatedAt, uuidPk } from "./_common";
import { users } from "./auth";

// Admission: yearly batches and the applications students submit to them.
// Ports of lib/db/schema/admission-batches.ts and student-applications.ts.
// Area: `pendaftaran` (Batch, Pendaftar).

/**
 * A yearly admission batch (e.g. "Gen 6 - 2026/2027"). Registrations open at
 * `opensAt`, close at `closesAt`, and results become visible to students only
 * after `resultsPublishedAt` is set (batch-level publish).
 */
export const admissionBatches = sqliteTable(
  "admission_batches",
  {
    id: uuidPk(),
    /** The academic year the batch belongs to (2026 for "2026/2027"). One batch per year. */
    year: integer("year").notNull().unique(),
    /** Human label shown in UIs, e.g. "Gen 6 - 2026/2027". */
    name: text("name").notNull(),
    /** Optional long description; admin-only. */
    description: text("description"),
    /** Registration window: students can submit only while now is in [opensAt, closesAt]. */
    opensAt: timestampMs("opens_at").notNull(),
    closesAt: timestampMs("closes_at").notNull(),
    /** When set, the batch's results are visible to students. Set once every application is decided. */
    resultsPublishedAt: timestampMs("results_published_at"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("admission_batches_opens_at_idx").on(t.opensAt),
    // Business rules the legacy app enforced only in its server action (zod).
    check("admission_batches_year_check", sql`${t.year} between 2024 and 2100`),
    check("admission_batches_window_check", sql`${t.closesAt} > ${t.opensAt}`),
  ],
);

export const applicationStatus = ["pending", "under_review", "accepted", "rejected"] as const;
export type ApplicationStatus = (typeof applicationStatus)[number];

/**
 * Current schema version stamped on every new submission. Bump whenever the
 * shape below changes in a way that is not back-compat readable.
 *
 * Version 3 (SAKEM-083, the student portal): the documents and the marketing proofs are FILES (`application_files`),
 * not links, so `documents` keeps only `dtksRegistered` and `marketing` only `instagramUsername`; every other bucket
 * is the same as version 2. The shape is `FormDataV3` of `shared/application-form/form-data.ts`, which is what the
 * submit writes (docs/cloudflare/portal-api.md, 9.3). Version 2 is what the legacy app wrote; no row of it is in
 * production (dummy data only), and the admin screen still reads it.
 */
export const CURRENT_FORM_DATA_VERSION = 3 as const;

/** What a stored `form_data` is: the version the portal writes now, or the legacy one, which stays readable. */
export type StudentApplicationFormData = StudentApplicationFormDataV3 | StudentApplicationFormDataV2;

/**
 * Version 3, written by the portal's submit: `FormDataV3` of the shared module, except that the agreement to the signed
 * statement is a BOOLEAN in the stored row, as it was in version 2 and as docs/cloudflare/portal-api.md 9.3 says (the
 * admin's screen reads `=== true`). The shared module's builder hands the answer over as the text it was asked with
 * ("ya"); `src/portal/rules.ts` (`formDataToStore`) turns it into the boolean before the row is written.
 */
export type StudentApplicationFormDataV3 = Omit<FormDataV3, "interview"> & {
  interview: Omit<FormDataV3["interview"], "agreedToSignedStatement"> & { agreedToSignedStatement: boolean };
};

/**
 * Version 2: everything the multi-step recruitment wizard of the legacy app collected that is not already a
 * top-level column. Copied from lib/db/schema/student-applications.ts; keep the
 * two in step until the legacy app is retired. Optional groups are `null` when
 * not applicable.
 */
export type StudentApplicationFormDataV2 = {
  formVersion: 2;
  identity: {
    nickname: string;
    gender: "laki-laki" | "perempuan";
    religion: string;
    homeAddress: string;
  };
  household: {
    livingWith: string[];
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

export const studentApplications = sqliteTable(
  "student_applications",
  {
    id: uuidPk(),
    /**
     * The student who owns this application. Nullable only because deleting
     * the account keeps the application (ON DELETE SET NULL, as in legacy).
     */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    /**
     * The batch this application belongs to. NOT NULL here (legacy allowed
     * NULL for rows from before batches existed; there are none to carry).
     * RESTRICT: a batch with applications cannot be deleted.
     */
    batchId: text("batch_id")
      .notNull()
      .references(() => admissionBatches.id, { onDelete: "restrict" }),
    fullName: text("full_name").notNull(),
    /** Snapshot of the account email at submission time. */
    email: text("email").notNull(),
    whatsapp: text("whatsapp").notNull(),
    schoolName: text("school_name").notNull(),
    /** Text so the radio values stay verbatim, e.g. "2025/2026 (Gap Year)" or "2027 (Kelas 12)". */
    graduationYear: text("graduation_year").notNull(),
    branchPreference: text("branch_preference"),
    /** Legacy field. The wizard stores interview answers in `formData.interview`. */
    motivation: text("motivation"),
    economicBackground: text("economic_background"),
    /** Everything the wizard collects. JSON text, typed above. */
    formData: text("form_data", { mode: "json" }).$type<StudentApplicationFormData | null>(),
    status: text("status", { enum: applicationStatus }).notNull().default("pending"),
    reviewNotes: text("review_notes"),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestampMs("reviewed_at"),
    submittedAt: createdAt("submitted_at"),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("student_applications_status_idx").on(t.status),
    index("student_applications_submitted_at_idx").on(t.submittedAt),
    index("student_applications_email_idx").on(t.email),
    index("student_applications_batch_id_idx").on(t.batchId),
    // Name search of Pendaftar (a prefix match, `full_name like 'abc%'`): SQLite can walk this index for a LIKE
    // prefix only when it is declared COLLATE NOCASE, which is also what makes the match case-insensitive.
    index("student_applications_full_name_idx").on(sql`${t.fullName} collate nocase`),
    // A given user can only have one application per batch. (Its leftmost
    // column also serves "applications of this user", which is why legacy's
    // separate user_id index is not carried over.)
    unique("student_applications_user_batch_unique").on(t.userId, t.batchId),
    enumCheck("student_applications_status_check", t.status, applicationStatus),
    jsonCheck("student_applications_form_data_json_check", t.formData),
  ],
);
