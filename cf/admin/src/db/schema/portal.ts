import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { MAX_FILE_BYTES, DRAFT_FORM_DATA_MAX_LENGTH } from "../../../shared/application-form/limits";
import { SLOT_IDS } from "../../../shared/application-form/slots";
import { STEP_IDS } from "../../../shared/application-form/steps";
import { admissionBatches } from "./admission";
import { users } from "./auth";
import { createdAt, enumCheck, timestampMs, updatedAt, uuidPk } from "./_common";

// The student portal's tables (SAKEM-083, migration 0012_portal_applications): drafts of applications, the metadata of
// the files an applicant uploads, the hard storage counter, and the daily email counter. Design and reasons:
// docs/cloudflare/portal-architecture.md, sections 7 to 9; the contract that uses them: docs/cloudflare/portal-api.md.
// Area: `pendaftaran` reads the files' metadata; the student's own routes write the rest.
//
// `student_applications` is unchanged: it holds SUBMITTED applications only, with the legacy four statuses. A draft is
// not a status, it is a row here, and its `id` becomes the application's `id` at submit, so the files (which refer to
// that id) never have to be touched when the application is submitted.

/** The seven buckets of a draft's `form_data` (`shared/application-form/steps.ts`): `identity`, `household`, `housing`, `organizations`, `documents`, `marketing`, `interview`. */
export type DraftFormData = Partial<Record<(typeof STEP_IDS)[number], Record<string, unknown>>>;

/**
 * An application in progress: one per student per batch. Only a complete, valid step is saved here (what is half typed
 * stays in the browser), so `form_data` holds validated buckets and never unvalidated text about a minor. A step save
 * replaces its own key (a JSON patch of one key), so two tabs saving different steps do not overwrite each other.
 */
export const applicationDrafts = sqliteTable(
  "application_drafts",
  {
    /** Allocated at the first save by the app; the same value becomes `student_applications.id` at submit. */
    id: uuidPk(),
    /** The student. Deleting the account deletes the draft (its files are then orphans for the cleanup to sweep). */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** RESTRICT: a batch with drafts cannot be deleted (the admin's existing foreign-key-to-409 mapping answers `in_use`). */
    batchId: text("batch_id")
      .notNull()
      .references(() => admissionBatches.id, { onDelete: "restrict" }),
    /** One key per saved bucket. A JSON object, at most 98,304 characters. */
    formData: text("form_data", { mode: "json" }).$type<DraftFormData>().notNull().default(sql`'{}'`),
    /** The bucket the student last saved, for the resume point. */
    lastStep: text("last_step", { enum: STEP_IDS }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One draft per student per batch. The draft insert is `INSERT ... WHERE NOT EXISTS (an application of this
    // student for this batch)`, so a student who submitted cannot open a second one.
    unique("application_drafts_user_batch_unique").on(t.userId, t.batchId),
    // json_type() raises on malformed JSON, so the CASE keeps the refusal a CHECK failure, not a SQL error.
    check(
      "application_drafts_form_data_check",
      sql`case when json_valid(${t.formData}) then json_type(${t.formData}) = 'object' and length(${t.formData}) <= ${sql.raw(String(DRAFT_FORM_DATA_MAX_LENGTH))} else 0 end`,
    ),
    // A NULL passes a CHECK (an unknown is not a failure), which is what a draft that has saved nothing needs.
    enumCheck("application_drafts_last_step_check", t.lastStep, STEP_IDS),
  ],
);

/** The types an applicant's file can have, from its bytes (`src/uploads/sniff.ts`): never the client's claim. */
export const applicationFileContentTypes = ["image/png", "image/jpeg", "image/webp", "application/pdf"] as const;
export type ApplicationFileContentType = (typeof applicationFileContentTypes)[number];

/**
 * The metadata of an applicant's uploaded file; the bytes are in the private bucket under the key
 * `applications/<batch year>/<application id>/<id>.<ext>` (`id` is also the object's name). No client file name is
 * stored anywhere (a name can hold a person's name; the slot says what the file is).
 */
export const applicationFiles = sqliteTable(
  "application_files",
  {
    id: uuidPk(),
    /**
     * The draft's id, and after the submit the application's id (the same value). NO foreign key: it refers to one
     * table or the other depending on the state, which SQLite cannot express. Integrity is kept by the insert (it is
     * `INSERT ... SELECT ... WHERE EXISTS (the draft of this student, still editable)`) and by the cleanup's orphan sweep.
     */
    applicationId: text("application_id").notNull(),
    /** One of the sixteen slots of `shared/application-form/slots.ts`. A new slot is a new migration (SQLite cannot alter a CHECK). */
    slot: text("slot", { enum: SLOT_IDS }).notNull(),
    contentType: text("content_type", { enum: applicationFileContentTypes }).notNull(),
    /** Bytes, 1 to MAX_FILE_BYTES (10,000,000). */
    size: integer("size").notNull(),
    /** Pixels, images only; both or neither. */
    width: integer("width"),
    height: integer("height"),
    /** The MD5 R2 returns for the object, 32 hex characters: an integrity check, not a security one. */
    checksum: text("checksum").notNull(),
    createdAt: createdAt(),
    /** Set when the student removes or replaces the file, or the cleanup purges it; the row is deleted once the object is gone. */
    deletedAt: timestampMs("deleted_at"),
  },
  (t) => [
    // The file list of an application and the per-slot count.
    index("application_files_application_slot_idx").on(t.applicationId, t.slot),
    enumCheck("application_files_slot_check", t.slot, SLOT_IDS),
    enumCheck("application_files_content_type_check", t.contentType, applicationFileContentTypes),
    check("application_files_size_check", sql`${t.size} > 0 and ${t.size} <= ${sql.raw(String(MAX_FILE_BYTES))}`),
    // Both or neither, positive. Written with `is not null` on both sides: a NULL in `width > 0 and height > 0` would be
    // "unknown", which a CHECK lets through, so a row with only one of the two would pass the shorter form.
    check(
      "application_files_dimensions_check",
      sql`(${t.width} is null and ${t.height} is null) or (${t.width} is not null and ${t.height} is not null and ${t.width} > 0 and ${t.height} > 0)`,
    ),
    check("application_files_checksum_check", sql`length(${t.checksum}) = 32 and ${t.checksum} not glob '*[^0-9a-f]*'`),
  ],
);

/**
 * The hard budget guard of the private bucket: ONE row, updated in the same batch as the file row it accounts for
 * (`UPDATE ... SET bytes = bytes + :size WHERE bytes + :size <= :budget` before the bytes are written), and reconciled
 * daily. The migration inserts the row with zeros.
 */
export const privateStorage = sqliteTable(
  "private_storage",
  {
    id: text("id").primaryKey(),
    bytes: integer("bytes").notNull(),
    files: integer("files").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("private_storage_singleton_check", sql`${t.id} = 'private-files'`),
    check("private_storage_bytes_check", sql`${t.bytes} >= 0`),
    check("private_storage_files_check", sql`${t.files} >= 0`),
  ],
);

/**
 * How many emails the day has sent, so that Resend's 100 a day cannot be spent silently (the 101st registrant is told
 * instead of waiting for a link that never comes). `day` is the UTC date as `YYYY-MM-DD`. Incremented before each send
 * with `INSERT ... ON CONFLICT DO UPDATE ... WHERE sent < :limit RETURNING`: one row written per email.
 */
export const emailDaily = sqliteTable(
  "email_daily",
  {
    day: text("day").primaryKey(),
    sent: integer("sent").notNull().default(0),
  },
  (t) => [
    check("email_daily_day_check", sql`${t.day} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
    check("email_daily_sent_check", sql`${t.sent} >= 0`),
  ],
);
