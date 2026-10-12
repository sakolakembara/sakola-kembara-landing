// What the Pendaftaran screens read from D1, in one place, as unexecuted Drizzle queries so that the plan
// tests (test/pendaftaran-plans.test.ts) explain exactly what the routes run. The budget (Workers Free: 10 ms
// CPU a request; D1 Free: 5M rows read a day) sets the rules of docs/cloudflare/admin-crud.md#12:
//
//   - a list is the page and the total in ONE round trip (`db.batch`), a detail is one round trip as well;
//   - every filter and sort is an index search; the applications table is the one that grows (about 300 a
//     year), so its search is a PREFIX match on an indexed column, never `LIKE '%q%'`;
//   - an applicant's name and email are selected for the list and the detail only, never for a count.

import { and, asc, count, desc, eq, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/audit";
import { admissionBatches, studentApplications } from "../db/schema";
import { escapeLike, MAX_LIKE_PATTERN_BYTES } from "../api/crud";
import type { ListQuery } from "../api/crud";

const encoder = new TextEncoder();

// ------------------------------------------------------------ prefix search

/**
 * `abc%` with the wildcards of `text` escaped (`!` is the escape character), cut from the end until it fits D1's
 * limit of 50 bytes for a LIKE pattern. A longer search therefore becomes a search for its first characters:
 * broader, never an error. Null when nothing is left.
 */
export function prefixPattern(text: string): string | null {
  for (let candidate = text; candidate.length > 0; candidate = candidate.slice(0, -1)) {
    const pattern = `${escapeLike(candidate)}%`;
    if (encoder.encode(pattern).length <= MAX_LIKE_PATTERN_BYTES) return pattern;
  }
  return null;
}

/**
 * Applicants whose NAME or EMAIL starts with `q`. Both halves can use an index:
 *
 *   name   `full_name like 'abc%' escape '!'` walks `student_applications_full_name_idx`, which is declared
 *          COLLATE NOCASE (SQLite uses an index for a LIKE prefix only then), and is case-insensitive for ASCII;
 *   email  a range on `student_applications_email_idx`, the BINARY index that was already there, over the
 *          lower-cased text (accounts are lower-cased when they are created, so stored emails are lower case):
 *          `email >= 'abc' and email < 'abc￿'`.
 *
 * Never `%abc%`: that reads every row of the table.
 */
export function applicantPrefix(q: string): SQL | undefined {
  const text = q.trim();
  if (text === "") return undefined;
  const pattern = prefixPattern(text);
  const lower = text.toLowerCase();
  const byEmail = and(sql`${studentApplications.email} >= ${lower}`, sql`${studentApplications.email} < ${`${lower}￿`}`);
  return pattern === null ? byEmail : or(sql`${studentApplications.fullName} like ${pattern} escape '!'`, byEmail);
}

// ------------------------------------------------------- applications: list

/** The columns of a row of the Pendaftar list: no answers, no notes, no phone number. */
const listColumns = {
  id: studentApplications.id,
  fullName: studentApplications.fullName,
  email: studentApplications.email,
  schoolName: studentApplications.schoolName,
  graduationYear: studentApplications.graduationYear,
  branchPreference: studentApplications.branchPreference,
  status: studentApplications.status,
  submittedAt: studentApplications.submittedAt,
  updatedAt: studentApplications.updatedAt,
  batchId: studentApplications.batchId,
  batchYear: admissionBatches.year,
  batchName: admissionBatches.name,
};

/** One page of applications with the batch each belongs to (an inner join: `batch_id` is NOT NULL and a foreign key). */
export const applicationsPageQuery = (db: Db, query: ListQuery) =>
  db
    .select(listColumns)
    .from(studentApplications)
    .innerJoin(admissionBatches, eq(studentApplications.batchId, admissionBatches.id))
    .where(query.where)
    .orderBy(...query.order)
    .limit(query.pageSize)
    .offset(query.offset);

/** How many applications match: the same WHERE, no join, so the status and batch indexes can answer alone. */
export const applicationsTotalQuery = (db: Db, query: ListQuery) => db.select({ total: count() }).from(studentApplications).where(query.where);

// ----------------------------------------------------- applications: detail

/** Everything of one application, with its batch. The answers (`form_data`) and the notes are what the detail page shows. */
export const applicationDetailQuery = (db: Db, id: string) =>
  db
    .select({
      id: studentApplications.id,
      batchId: studentApplications.batchId,
      batchYear: admissionBatches.year,
      batchName: admissionBatches.name,
      fullName: studentApplications.fullName,
      email: studentApplications.email,
      whatsapp: studentApplications.whatsapp,
      schoolName: studentApplications.schoolName,
      graduationYear: studentApplications.graduationYear,
      branchPreference: studentApplications.branchPreference,
      motivation: studentApplications.motivation,
      economicBackground: studentApplications.economicBackground,
      formData: studentApplications.formData,
      status: studentApplications.status,
      reviewNotes: studentApplications.reviewNotes,
      reviewedAt: studentApplications.reviewedAt,
      submittedAt: studentApplications.submittedAt,
      updatedAt: studentApplications.updatedAt,
    })
    .from(studentApplications)
    .innerJoin(admissionBatches, eq(studentApplications.batchId, admissionBatches.id))
    .where(eq(studentApplications.id, id))
    .limit(1);

// -------------------------------------------------------------- batches

/** Whether anybody applied to the batch: an `EXISTS` that stops at the first application (an index seek on `batch_id`). Written with its table names: see src/dashboard/queries.ts. */
const hasApplications = sql<boolean>`exists (select 1 from student_applications where student_applications.batch_id = admission_batches.id)`.mapWith(Boolean);

const batchColumns = {
  id: admissionBatches.id,
  year: admissionBatches.year,
  name: admissionBatches.name,
  description: admissionBatches.description,
  opensAt: admissionBatches.opensAt,
  closesAt: admissionBatches.closesAt,
  resultsPublishedAt: admissionBatches.resultsPublishedAt,
  createdAt: admissionBatches.createdAt,
  updatedAt: admissionBatches.updatedAt,
};

/** One page of batches, each with whether anybody applied (for the phase). */
export const batchesPageQuery = (db: Db, query: ListQuery) =>
  db
    .select({ ...batchColumns, hasApplications })
    .from(admissionBatches)
    .where(query.where)
    .orderBy(...query.order)
    .limit(query.pageSize)
    .offset(query.offset);

export const batchesTotalQuery = (db: Db, query: ListQuery) => db.select({ total: count() }).from(admissionBatches).where(query.where);

/** One batch (its columns and `hasApplications`). */
export const batchQuery = (db: Db, id: string) =>
  db
    .select({ ...batchColumns, hasApplications })
    .from(admissionBatches)
    .where(eq(admissionBatches.id, id))
    .limit(1);

/** The applications of one batch counted per status: a seek on `batch_id`, reading the batch's own rows. */
export const batchStatusCountsQuery = (db: Db, id: string) =>
  db
    .select({ status: studentApplications.status, n: count() })
    .from(studentApplications)
    .where(eq(studentApplications.batchId, id))
    .groupBy(studentApplications.status);

/** The newest applicants of one batch (the batch detail shows five). */
export const batchRecentApplicantsQuery = (db: Db, id: string, limit: number) =>
  db
    .select({
      id: studentApplications.id,
      fullName: studentApplications.fullName,
      email: studentApplications.email,
      schoolName: studentApplications.schoolName,
      status: studentApplications.status,
      submittedAt: studentApplications.submittedAt,
    })
    .from(studentApplications)
    .where(eq(studentApplications.batchId, id))
    .orderBy(desc(studentApplications.submittedAt), asc(studentApplications.id))
    .limit(limit);
