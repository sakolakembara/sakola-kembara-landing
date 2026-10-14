import { and, asc, count, desc, eq, gt, gte, isNull, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { STEP_IDS, type StepId } from "../../shared/application-form/steps";
import type { Db } from "../db/audit";
import * as schema from "../db/schema";
import { admissionBatches, applicationDrafts, applicationFiles, studentApplications, type ApplicationStatus, type DraftFormData } from "../db/schema";
import type { OpenState } from "./rules";

// Everything the student's application API reads from, and writes to, D1 (docs/cloudflare/portal-api.md; the budget:
// docs/cloudflare/portal-architecture.md, section 10). The rules of Workers Free that shape it: 10 ms of CPU a request
// and D1's 5M rows read and 100k rows written a day, so
//
//   * every read is a seek on an index (the open batch on `admission_batches_opens_at_idx`; the student's application
//     and draft on the unique `(user_id, batch_id)` indexes), never a scan, and selects only the columns it shows;
//   * the batch, the student's application and the student's draft are ONE statement (a left join), not three;
//   * a write is ONE `batch` (one transaction, one round trip) and every statement of it is guarded, so a request that
//     lost a race writes nothing instead of half a thing;
//   * no draft answers (up to 96 KB of JSON) are read unless the route shows or checks them.
//
// Every query takes the student's id from the session (`c.get("user")`), never from the request: there is no route
// that names an application, so a student cannot ask for another student's row by any id.

const B = admissionBatches;
const A = studentApplications;
const D = applicationDrafts;
const F = applicationFiles;

// ─── The Drizzle handle ───

const handles = new WeakMap<D1Database, Db>();

/**
 * Drizzle's handle with the whole schema, built once per isolate and binding (building it walks every table of the
 * schema: work a request should not repeat). It holds no state of a request, so sharing it is safe.
 */
export function dbOf(d1: D1Database): Db {
  let db = handles.get(d1);
  if (!db) {
    db = drizzle(d1, { schema });
    handles.set(d1, db);
  }
  return db;
}

// ─── The open batch and the student's side of it ───

// The three ids are ALIASED. Drizzle reads a statement it runs inside `db.batch` as objects keyed by the column's name,
// so three columns that are all called `id` would collapse into one (the overview asks for this statement and the
// history in one batch, and got a null batch id before the aliases). Any column added here must keep its name unique.
const stateColumns = {
  batchId: sql<string>`${B.id}`.as("batch_id"),
  year: B.year,
  name: B.name,
  description: B.description,
  opensAt: B.opensAt,
  closesAt: B.closesAt,
  applicationId: sql<string | null>`${A.id}`.as("application_id"),
  submittedAt: A.submittedAt,
  draftId: sql<string | null>`${D.id}`.as("draft_id"),
  draftUpdatedAt: D.updatedAt,
  lastStep: D.lastStep,
};

/** An open batch's window at `now`: `opens_at <= now < closes_at` (legacy `getCurrentOpenBatch`). Closing is exclusive: at `closes_at` the door is shut. */
const openAt = (now: Date) => and(lte(B.opensAt, now), gt(B.closesAt, now));

/**
 * The batch that is open at `now` (`opens_at <= now < closes_at`, the latest `opens_at` if several: legacy
 * `getCurrentOpenBatch`) with the student's application and draft for it, in one statement. The batch is a short walk
 * down `admission_batches_opens_at_idx` from `now` that stops at the first row that is still open (two or three rows
 * in the usual case), the other two joins are seeks on the unique `(user_id, batch_id)` indexes. No row = nothing is
 * open. The draft's answers are NOT selected: `openStateWithAnswersQuery` is the one that does.
 */
export const openStateQuery = (db: Db, userId: string, now: Date) =>
  db
    .select(stateColumns)
    .from(B)
    .leftJoin(A, and(eq(A.batchId, B.id), eq(A.userId, userId)))
    .leftJoin(D, and(eq(D.batchId, B.id), eq(D.userId, userId)))
    .where(openAt(now))
    .orderBy(desc(B.opensAt))
    .limit(1);

/** The same, with the draft's answers (`GET applications/current`, the submit). */
export const openStateWithAnswersQuery = (db: Db, userId: string, now: Date) =>
  db
    .select({ ...stateColumns, formData: D.formData })
    .from(B)
    .leftJoin(A, and(eq(A.batchId, B.id), eq(A.userId, userId)))
    .leftJoin(D, and(eq(D.batchId, B.id), eq(D.userId, userId)))
    .where(openAt(now))
    .orderBy(desc(B.opensAt))
    .limit(1);

type StateRow = Awaited<ReturnType<typeof openStateQuery>>[number] & { formData?: DraftFormData | null };

/** The row of either query as the rules use it; null when no batch is open. */
export function toOpenState(row: StateRow | undefined): OpenState | null {
  if (!row) return null;
  return {
    batch: { id: row.batchId, year: row.year, name: row.name, description: row.description, opensAt: row.opensAt, closesAt: row.closesAt },
    application: row.applicationId !== null && row.submittedAt !== null ? { id: row.applicationId, submittedAt: row.submittedAt } : null,
    draft: row.draftId !== null && row.draftUpdatedAt !== null ? { id: row.draftId, updatedAt: row.draftUpdatedAt, lastStep: row.lastStep, formData: row.formData ?? null } : null,
  };
}

/** Does the student have a draft at all? Asked only when no batch is open: a draft then belongs to a batch that closed (`batch_closed`). A seek on `application_drafts_user_batch_unique` by its first column. */
export const anyDraftQuery = (db: Db, userId: string) => db.select({ id: D.id }).from(D).where(eq(D.userId, userId)).limit(1);

// ─── The student's applications ───

/**
 * The home page's history: every application of the student, newest first, with the batch it belongs to and whether
 * the batch's results are published. NO status and NO note: the history card is verdict-free by design.
 */
export const historyQuery = (db: Db, userId: string) =>
  db
    .select({ id: A.id, year: B.year, name: B.name, submittedAt: A.submittedAt, publishedAt: B.resultsPublishedAt })
    .from(A)
    .innerJoin(B, eq(A.batchId, B.id))
    .where(eq(A.userId, userId))
    .orderBy(desc(A.submittedAt), asc(A.id));

/**
 * The status page: the same rows, with the two columns that may hold a verdict. The privacy contract
 * (docs/architecture/student-portal.md) is kept in TWO places, each enough on its own for what leaves this Worker:
 * here, the status and the note come out of D1 as NULL until the batch's `results_published_at` is set, and
 * `resultOf` (src/portal/rules.ts) answers `processing` for an unpublished batch whatever it is handed.
 */
export const statusQuery = (db: Db, userId: string) =>
  db
    .select({
      id: A.id,
      batchId: B.id,
      year: B.year,
      name: B.name,
      submittedAt: A.submittedAt,
      publishedAt: B.resultsPublishedAt,
      status: sql<ApplicationStatus | null>`case when ${B.resultsPublishedAt} is not null then ${A.status} end`,
      reviewNotes: sql<string | null>`case when ${B.resultsPublishedAt} is not null then ${A.reviewNotes} end`,
    })
    .from(A)
    .innerJoin(B, eq(A.batchId, B.id))
    .where(eq(A.userId, userId))
    .orderBy(desc(A.submittedAt), asc(A.id));

// ─── Files (the rows only: the bytes are in the private bucket) ───

/** The live files of a draft or an application: the `(application_id, slot)` index, at most 35 rows. */
export const filesQuery = (db: Db, applicationId: string) =>
  db
    .select({ id: F.id, slot: F.slot, contentType: F.contentType, size: F.size, width: F.width, height: F.height, createdAt: F.createdAt })
    .from(F)
    .where(and(eq(F.applicationId, applicationId), isNull(F.deletedAt)));

/** How many live files each slot holds (the submit and the step save only need the counts). */
export const slotCountsQuery = (db: Db, applicationId: string) =>
  db
    .select({ slot: F.slot, n: count() })
    .from(F)
    .where(and(eq(F.applicationId, applicationId), isNull(F.deletedAt)))
    .groupBy(F.slot);

/** The legacy soft anti-duplicate: an application with this WhatsApp number submitted since `since` (any student). A range on `student_applications_submitted_at_idx`: the last hour's rows. */
export const recentWhatsappQuery = (db: Db, whatsapp: string, since: Date) =>
  db
    .select({ id: A.id })
    .from(A)
    .where(and(eq(A.whatsapp, whatsapp), gte(A.submittedAt, since)))
    .limit(1);

// ─── Saving a step (PUT steps/:step) ───

/**
 * Creates the draft or replaces ONE bucket of it, in one statement. `json_set` on the one key is a patch, not a
 * read-modify-write of the whole object, so two tabs saving different steps cannot overwrite each other; the same step
 * saved twice is last write wins. The guards are IN the statement: the batch must be open at `now` and the student
 * must have no application for it, whatever the route read a moment ago. A draft that lost one of them returns no
 * row. `updated_at` only ever grows (`max(now, previous + 1)`), so it is a version the submit can hold on to even
 * when two saves land in the same millisecond.
 *   ?1 draft id (used only when the draft is new)  ?2 user id  ?3 batch id  ?4 step  ?5 the bucket as JSON text
 *   ?6 now (ms)  ?7 the JSON path of the bucket (`$.household`)
 */
const UPSERT_DRAFT = `INSERT INTO application_drafts (id, user_id, batch_id, form_data, last_step, created_at, updated_at)
SELECT ?1, ?2, ?3, json_object(?4, json(?5)), ?4, ?6, ?6
WHERE EXISTS (SELECT 1 FROM admission_batches WHERE id = ?3 AND opens_at <= ?6 AND closes_at > ?6)
  AND NOT EXISTS (SELECT 1 FROM student_applications WHERE user_id = ?2 AND batch_id = ?3)
ON CONFLICT (user_id, batch_id) DO UPDATE SET
  form_data = json_set(form_data, ?7, json(?5)),
  last_step = ?4,
  updated_at = max(?6, updated_at + 1)
RETURNING id, updated_at`;

/**
 * The live `dtks` files of the student's draft IF the draft's stored answer is "tidak": the invariant is "no `dtks`
 * file without a "ya"", so these statements are tied to what the draft says NOW, not to what the request sent (a save
 * that did not happen cannot remove anything). Used by the three statements below, `?1` user id, `?2` batch id.
 */
const REMOVABLE_DTKS = `slot = 'dtks' AND deleted_at IS NULL AND application_id IN (
  SELECT id FROM application_drafts WHERE user_id = ?1 AND batch_id = ?2 AND json_extract(form_data, '$.documents.dtksRegistered') = 'tidak')`;

const SELECT_REMOVABLE_DTKS = `SELECT id, content_type AS contentType, size FROM application_files WHERE ${REMOVABLE_DTKS}`;
/** The storage counter gives the bytes back in the same batch that marks the rows (`?3` now). Only when there is something to remove: no pointless write. */
const RELEASE_REMOVABLE_DTKS = `UPDATE private_storage
SET bytes = max(0, bytes - (SELECT coalesce(sum(size), 0) FROM application_files WHERE ${REMOVABLE_DTKS})),
    files = max(0, files - (SELECT count(*) FROM application_files WHERE ${REMOVABLE_DTKS})),
    updated_at = ?3
WHERE id = 'private-files' AND EXISTS (SELECT 1 FROM application_files WHERE ${REMOVABLE_DTKS})`;
const MARK_REMOVABLE_DTKS = `UPDATE application_files SET deleted_at = ?3 WHERE ${REMOVABLE_DTKS}`;

/** What the answer to a save needs, read in the same batch: the buckets the draft holds now, and the DTKS answer. `?1` user id, `?2` batch id. */
const SUMMARY = `SELECT (SELECT json_group_array(key) FROM json_each(d.form_data)) AS saved, json_extract(d.form_data, '$.documents.dtksRegistered') AS dtks
FROM application_drafts d WHERE d.user_id = ?1 AND d.batch_id = ?2`;
const SLOT_COUNTS = `SELECT slot, count(*) AS n FROM application_files
WHERE deleted_at IS NULL AND application_id IN (SELECT id FROM application_drafts WHERE user_id = ?1 AND batch_id = ?2) GROUP BY slot`;

export interface SaveStepInput {
  userId: string;
  batchId: string;
  step: StepId;
  /** The validated bucket, `JSON.stringify`ed. */
  bucketJson: string;
  /** Used only when the draft does not exist yet. */
  newDraftId: string;
  now: Date;
  /** The save is of `documents` and the DTKS answer is "tidak": the `dtks` files go. */
  removeDtks: boolean;
}

export interface SaveStepResult {
  /** The draft as it is after the save; null = a guard of the statement failed (the batch is not open, or the student has an application): nothing was written. */
  draft: { id: string; updatedAt: Date } | null;
  /** The buckets the draft holds, in the API's order. */
  saved: StepId[];
  dtksRegistered: boolean;
  /** Live files per slot. */
  counts: Record<string, number>;
  /** The `dtks` files whose rows were marked deleted by this save; their objects are the caller's to delete. */
  removed: { id: string; contentType: string; size: number }[];
}

/** One round trip: the upsert, the DTKS cleanup when it applies, and what the answer needs. */
export async function saveStep(d1: D1Database, input: SaveStepInput): Promise<SaveStepResult> {
  const nowMs = input.now.getTime();
  const own = [input.userId, input.batchId] as const;
  const statements = [d1.prepare(UPSERT_DRAFT).bind(input.newDraftId, input.userId, input.batchId, input.step, input.bucketJson, nowMs, `$.${input.step}`)];
  if (input.removeDtks) {
    statements.push(d1.prepare(SELECT_REMOVABLE_DTKS).bind(...own), d1.prepare(RELEASE_REMOVABLE_DTKS).bind(...own, nowMs), d1.prepare(MARK_REMOVABLE_DTKS).bind(...own, nowMs));
  }
  statements.push(d1.prepare(SUMMARY).bind(...own), d1.prepare(SLOT_COUNTS).bind(...own));

  const results = await d1.batch(statements);
  const upserted = (results[0]!.results as { id: string; updated_at: number }[])[0];
  const removed = input.removeDtks ? (results[1]!.results as { id: string; contentType: string; size: number }[]) : [];
  const summary = (results[results.length - 2]!.results as { saved: string | null; dtks: string | null }[])[0];
  const counts: Record<string, number> = {};
  for (const row of results[results.length - 1]!.results as { slot: string; n: number }[]) counts[row.slot] = row.n;

  let keys: unknown = [];
  try {
    keys = JSON.parse(summary?.saved ?? "[]");
  } catch {
    // Not reachable: json_group_array answers JSON. A draft of no readable keys has no saved steps.
  }
  const held = new Set(Array.isArray(keys) ? keys : []);
  return {
    draft: upserted ? { id: upserted.id, updatedAt: new Date(upserted.updated_at) } : null,
    saved: STEP_IDS.filter((step) => held.has(step)),
    dtksRegistered: summary?.dtks === "ya",
    counts,
    removed,
  };
}

/** After the objects are gone: the marked rows are removed (the counter was settled when they were marked). */
export async function deleteMarkedFileRows(d1: D1Database, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await d1.batch(ids.map((id) => d1.prepare("DELETE FROM application_files WHERE id = ?1 AND deleted_at IS NOT NULL").bind(id)));
}

// ─── Submitting ───

export interface SubmitInput {
  /** The draft's id: it becomes the application's id, so the files, which refer to it, are never touched. */
  applicationId: string;
  userId: string;
  userEmail: string;
  batchId: string;
  batchYear: number;
  /** The `updated_at` the answers were validated at: a step saved since (or a draft that vanished) makes the write insert nothing. */
  draftVersion: Date;
  columns: { fullName: string; whatsapp: string; schoolName: string; graduationYear: string; branchPreference: string };
  formDataJson: string;
  auditId: string;
  now: Date;
}

/**
 * The three writes of a submit, one batch, one transaction, each guarded on "the draft is still the one that was
 * validated" (its id, its owner and its `updated_at`) and on "the batch is still open": a draft that was changed,
 * submitted already or removed makes the first statement insert nothing and the other two do nothing, so there is never
 * an application without its audit row, an audit row without its application, or a draft that outlives its submit.
 *   ?1 application id  ?2 user id  ?3 full name  ?4 email  ?5 whatsapp  ?6 school  ?7 graduation year  ?8 branch
 *   ?9 form data JSON  ?10 now (ms)  ?11 the draft's version (ms)  ?12 audit id  ?13 audit metadata JSON  ?14 batch id
 * `student_applications_user_batch_unique` is the last line: two submits cannot both insert.
 */
const INSERT_APPLICATION = `INSERT INTO student_applications (id, user_id, batch_id, full_name, email, whatsapp, school_name, graduation_year, branch_preference, status, form_data, submitted_at, updated_at)
SELECT d.id, d.user_id, d.batch_id, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9, ?10, ?10
FROM application_drafts d
WHERE d.id = ?1 AND d.user_id = ?2 AND d.batch_id = ?14 AND d.updated_at = ?11
  AND EXISTS (SELECT 1 FROM admission_batches b WHERE b.id = d.batch_id AND b.opens_at <= ?10 AND b.closes_at > ?10)`;

/**
 * The audit row, written only when the application was just inserted from this draft (the draft is still there, with
 * the validated version, and so is the application). The columns are those of `auditStatement` (src/db/audit.ts); a test
 * writes the same entry through both and compares the rows. Ids and names only: never an answer.
 */
const INSERT_AUDIT = `INSERT INTO audit_log (id, actor_id, actor_email, action, resource_type, resource_id, metadata)
SELECT ?12, ?2, ?4, 'application.submit', 'application', ?1, ?13
WHERE EXISTS (SELECT 1 FROM application_drafts WHERE id = ?1 AND updated_at = ?11)
  AND EXISTS (SELECT 1 FROM student_applications WHERE id = ?1)`;

const DELETE_DRAFT = `DELETE FROM application_drafts WHERE id = ?1 AND updated_at = ?11 AND EXISTS (SELECT 1 FROM student_applications WHERE id = ?1)`;

/** True when this call inserted the application. */
export async function submitApplication(d1: D1Database, input: SubmitInput): Promise<boolean> {
  const metadata = JSON.stringify({ batchId: input.batchId, batchYear: input.batchYear });
  const values = [
    input.applicationId,
    input.userId,
    input.columns.fullName,
    input.userEmail.toLowerCase(),
    input.columns.whatsapp,
    input.columns.schoolName,
    input.columns.graduationYear,
    input.columns.branchPreference,
    input.formDataJson,
    input.now.getTime(),
    input.draftVersion.getTime(),
    input.auditId,
    metadata,
    input.batchId,
  ];
  // D1 wants exactly as many values as the statement's highest `?N`: the audit row's numbers stop at 13 and the
  // delete's at 11 (an unused number in between is fine).
  const bind = (sqlText: string, highest: number) => d1.prepare(sqlText).bind(...values.slice(0, highest));
  const results = await d1.batch([bind(INSERT_APPLICATION, 14), bind(INSERT_AUDIT, 13), bind(DELETE_DRAFT, 11)]);
  return (results[0]?.meta.changes ?? 0) === 1;
}

/** The raw statements, by name, so the plan tests (test/portal-applications-plans.test.ts) explain exactly what the routes run. */
export const RAW_STATEMENTS = {
  upsertDraft: UPSERT_DRAFT,
  selectRemovableDtks: SELECT_REMOVABLE_DTKS,
  releaseRemovableDtks: RELEASE_REMOVABLE_DTKS,
  markRemovableDtks: MARK_REMOVABLE_DTKS,
  summary: SUMMARY,
  slotCounts: SLOT_COUNTS,
  insertApplication: INSERT_APPLICATION,
  insertAudit: INSERT_AUDIT,
  deleteDraft: DELETE_DRAFT,
} as const;
