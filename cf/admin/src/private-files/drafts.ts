// The files of a DRAFT that was never submitted (SAKEM-093; docs/cloudflare/portal-api.md, 12.4). Nothing is deleted
// automatically (Dzul, 2026-10-13), and a draft is not in the Pendaftar list (that list is submitted applications), so a
// student who uploads scans of identity documents and never submits leaves them in the private bucket for ever. Dzul decided
// on 2026-10-15 that an admin may delete them by hand. This file is the two things that needs:
//
//   1. the LIST of drafts that hold live files: `GET /api/admin/applications/drafts/files`. Opaque and PII-light on purpose:
//      the draft's id (the screen shows its first eight characters), its batch, how many files and how many bytes, when
//      it was last changed, and whether it may be purged. NO name, no email, no answer, no file name, no slot.
//   2. the PURGE: `POST /api/admin/applications/drafts/:id/files/purge`, built from the same pieces as the purge of a submitted
//      application (src/private-files/purge.ts): ONE batch that writes the audit row, gives the bytes back to the storage
//      counter and marks the rows; then the objects go and then the marked rows (`removeMarkedFiles`); the daily cleanup
//      retries what the bucket refused. Only the guard, the audit row's resource type and the touch below are new.
//
// THE SAFETY RULE. With no name on the list an admin cannot tell whose draft it is, so the rule protects an ACTIVE draft
// instead: a draft may be purged only if it was last changed at least `DRAFT_PURGE_MIN_INACTIVE_DAYS` (30) days ago. "Changed"
// is `application_drafts.updated_at`, which every step save and every file upload, replace and delete of the student moves
// (and a purge moves by one millisecond, below). The boundary is inclusive: exactly 30 days is allowed, 30 days less one
// millisecond is not. The rule is in the `WHERE` of every statement of the purge batch, not only in a check before it, so a
// student who saves a step between the check and the write finds their files still there. It is also why a draft is purged as
// a whole: a rule per file would let a half-purged draft look like the student's fault.
//
// Refused: a draft that does not exist or is not a draft (a missing id, a malformed one, the id of a submitted application:
// `404 not_found`, the same answer for all so nobody learns which), a draft changed less than 30 days ago (`409 draft_active`,
// with `purgeableAt`). Who may call: `pendaftaran` WRITE (src/api/application-files.ts), never a viewer.
//
// A purge leaves the student's answers alone (`form_data` is not touched): only the files go, and the student sees their
// missing files at the submit, as after deleting one themselves.

import type { AuthUser } from "../context";
import type { Bindings } from "../env";
import { isUuid } from "./key";
import { removeMarkedFiles, type PurgeOutcome } from "./purge";
import { draftActive, REFUSALS } from "./refusal";
import { releaseLiveStatement } from "./storage";

type Storage = Pick<Bindings, "DB" | "PRIVATE_FILES">;

/** A draft must have gone this many days without a change before an admin may purge its files. One number, here. */
export const DRAFT_PURGE_MIN_INACTIVE_DAYS = 30;
export const DRAFT_PURGE_MIN_INACTIVE_MS = DRAFT_PURGE_MIN_INACTIVE_DAYS * 24 * 60 * 60 * 1000;

/** The newest `updated_at` a draft can have and still be purged at `now`: exactly 30 days earlier. */
export const draftPurgeCutoff = (now: number): number => now - DRAFT_PURGE_MIN_INACTIVE_MS;

/** Whether a draft last changed at `updatedAt` (epoch milliseconds) may be purged at `now`. Inclusive at the boundary. */
export const isDraftPurgeable = (updatedAt: number, now: number): boolean => updatedAt <= draftPurgeCutoff(now);

/** The instant from which a draft last changed at `updatedAt` may be purged. */
export const purgeableFrom = (updatedAt: number): Date => new Date(updatedAt + DRAFT_PURGE_MIN_INACTIVE_MS);

/**
 * "This id is a draft that was never submitted and has been quiet long enough", as SQL for a WHERE: `id` and `cutoff` are
 * placeholders (`?4`). The second half is defence in depth (the submit deletes the draft in the same batch that inserts the
 * application, so both never exist): a submitted application's files are never reachable through a draft's id.
 */
const purgeable = (id: string, cutoff: string) =>
  `EXISTS (SELECT 1 FROM application_drafts d WHERE d.id = ${id} AND d.updated_at <= ${cutoff}) AND NOT EXISTS (SELECT 1 FROM student_applications a WHERE a.id = ${id})`;

// ─── The list ───────────────────────────────────────────────────────────────────

// Drives from the drafts: submitting a draft deletes it, so this table holds only students who have not submitted (a few
// hundred rows at most, one per student per batch) and walking it is the cheap side; the files of each draft are a seek on
// `application_files_application_slot_idx`. The scan of `application_drafts` is the one deliberate walk (no index on
// `updated_at`: a migration for a screen an admin opens now and then is not worth a row written per file upload). The batch's
// year and name are scalar subqueries, evaluated once per group and not once per file. `COUNT(f.id)` and `SUM(f.size)` read
// each live file once. Oldest change first, so the drafts that may be purged come first; `id` breaks ties so pages never overlap.
export const DRAFTS_PAGE_SQL = `SELECT d.id AS id, d.batch_id AS batch_id,
  (SELECT b.year FROM admission_batches b WHERE b.id = d.batch_id) AS batch_year,
  (SELECT b.name FROM admission_batches b WHERE b.id = d.batch_id) AS batch_name,
  d.updated_at AS updated_at, COUNT(f.id) AS files, COALESCE(SUM(f.size), 0) AS bytes
FROM application_drafts d
JOIN application_files f ON f.application_id = d.id AND f.deleted_at IS NULL
WHERE NOT EXISTS (SELECT 1 FROM student_applications a WHERE a.id = d.id)
GROUP BY d.id
ORDER BY d.updated_at, d.id
LIMIT ?1 OFFSET ?2`;

/** How many drafts hold a live file: the list's `total`. Stops at the first live file of each draft. */
export const DRAFTS_TOTAL_SQL = `SELECT COUNT(*) AS total FROM application_drafts d
WHERE EXISTS (SELECT 1 FROM application_files f WHERE f.application_id = d.id AND f.deleted_at IS NULL)
AND NOT EXISTS (SELECT 1 FROM student_applications a WHERE a.id = d.id)`;

interface DraftRow {
  id: string;
  batch_id: string;
  batch_year: number;
  batch_name: string;
  updated_at: number;
  files: number;
  bytes: number;
}

/**
 * A draft as the list shows it, field by field (never the row): the id, the batch, the count and the bytes of the live
 * files, when it was last changed, whether it may be purged now, and from when. No name, address, answer, slot or file name.
 */
export function presentDraftFiles(row: DraftRow, now: number) {
  return {
    id: row.id,
    batch: { id: row.batch_id, year: row.batch_year, name: row.batch_name },
    files: row.files,
    bytes: row.bytes,
    updatedAt: new Date(row.updated_at).toISOString(),
    purgeable: isDraftPurgeable(row.updated_at, now),
    purgeableAt: purgeableFrom(row.updated_at).toISOString(),
  };
}

/** One page of the list and the total, in ONE round trip. `now` is the server's clock: it decides `purgeable`. */
export async function listDraftFiles(env: Pick<Bindings, "DB">, request: { pageSize: number; offset: number }, now: number) {
  const [page, total] = await env.DB.batch<unknown>([env.DB.prepare(DRAFTS_PAGE_SQL).bind(request.pageSize, request.offset), env.DB.prepare(DRAFTS_TOTAL_SQL)]);
  return {
    items: (page!.results as DraftRow[]).map((row) => presentDraftFiles(row, now)),
    total: (total!.results[0] as { total: number } | undefined)?.total ?? 0,
  };
}

// ─── The purge ──────────────────────────────────────────────────────────────────

/** The draft's batch year (for the keys) and its last change; null for anything that is not a draft that was never submitted. */
export const DRAFT_SQL = `SELECT b.year AS year, d.updated_at AS updated_at
FROM application_drafts d JOIN admission_batches b ON b.id = d.batch_id
WHERE d.id = ?1 AND NOT EXISTS (SELECT 1 FROM student_applications a WHERE a.id = d.id)`;

// The audit row: the same action as the purge of an application, the resource type of a draft (`application_draft`, so the
// Aktivitas page does not link it to an application page that does not exist), and the same metadata, a count and the file
// ids, computed by the SAME statement's reading of the rows it is about to mark. Written only if there is something to purge
// AND the guard holds, so a refused or an empty purge leaves no row.
export const AUDIT_DRAFT_PURGE_SQL = `INSERT INTO audit_log (id, actor_id, actor_email, action, resource_type, resource_id, metadata)
SELECT ?1, ?2, ?3, 'application_file.purge', 'application_draft', ?4, json_object('count', COUNT(*), 'fileIds', json(json_group_array(id)))
FROM application_files WHERE application_id = ?4 AND deleted_at IS NULL AND ${purgeable("?4", "?5")}
HAVING COUNT(*) > 0`;

export const MARK_DRAFT_FILES_SQL = `UPDATE application_files SET deleted_at = ?1 WHERE application_id = ?2 AND deleted_at IS NULL AND ${purgeable("?2", "?3")}`;

/** The condition of the release of the storage counter: the same guard, over the same rows the mark takes (`?1` the draft, `?2` the cutoff). */
export const RELEASE_DRAFT_CONDITION = `application_id = ?1 AND ${purgeable("?1", "?2")}`;

// The draft's version moves by ONE millisecond, and only when this batch marked a file of it, so that a submit that read the
// draft a moment ago (its write is guarded by `updated_at = <what it read>`, src/portal/queries.ts) finds it changed and
// answers `draft_changed` instead of making an application whose files were just purged. One millisecond and not "now": a
// purge is the admin's act, not the student's, so the draft must not look recently used (that would refuse the repeat of
// a purge whose objects the bucket had refused, and hide a draft nobody touched). It goes LAST in the batch, after the
// statements that read `updated_at` in their guard.
export const TOUCH_DRAFT_VERSION_SQL = "UPDATE application_drafts SET updated_at = updated_at + 1 WHERE id = ?1 AND EXISTS (SELECT 1 FROM application_files WHERE application_id = ?1 AND deleted_at = ?2)";

/**
 * Deletes every file of one draft that was never submitted and has not been changed for 30 days. `now` is the server's
 * clock (a parameter so the tests can hold it still). The audit row, the counter and the marking are one batch (D1 runs it as
 * one transaction): when the row cannot be written, no file is touched and the call throws (the route answers 500).
 * A repeat finds nothing live, writes no row and answers `{ purged: 0, pending: 0 }`, finishing any row an earlier failure
 * left marked.
 */
export async function purgeDraftFiles(env: Storage, actor: Pick<AuthUser, "id" | "email">, draftId: string, now: number = Date.now()): Promise<PurgeOutcome> {
  if (!isUuid(draftId)) return { ok: false, refusal: REFUSALS.notFound };
  const draft = await env.DB.prepare(DRAFT_SQL).bind(draftId).first<{ year: number; updated_at: number }>();
  if (!draft) return { ok: false, refusal: REFUSALS.notFound };
  if (!isDraftPurgeable(draft.updated_at, now)) return { ok: false, refusal: draftActive(DRAFT_PURGE_MIN_INACTIVE_DAYS, purgeableFrom(draft.updated_at)) };

  const cutoff = draftPurgeCutoff(now);
  const results = await env.DB.batch([
    env.DB.prepare(AUDIT_DRAFT_PURGE_SQL).bind(crypto.randomUUID(), actor.id, actor.email.toLowerCase(), draftId, cutoff),
    releaseLiveStatement(env.DB, RELEASE_DRAFT_CONDITION, [draftId, cutoff], now),
    env.DB.prepare(MARK_DRAFT_FILES_SQL).bind(now, draftId, cutoff),
    env.DB.prepare(TOUCH_DRAFT_VERSION_SQL).bind(draftId, now),
  ]);
  const purged = results[2]!.meta.changes ?? 0;
  if (purged === 0) {
    // Nothing was marked: either there was nothing live (a repeat), or the guard of the writes stopped them because the draft
    // changed or was submitted after the check above. Say which, so the admin is never told that files were deleted when
    // they were not: look at the draft once more (a primary-key read, only on this path).
    const fresh = await env.DB.prepare(DRAFT_SQL).bind(draftId).first<{ year: number; updated_at: number }>();
    if (!fresh) return { ok: false, refusal: REFUSALS.notFound };
    if (!isDraftPurgeable(fresh.updated_at, now)) return { ok: false, refusal: draftActive(DRAFT_PURGE_MIN_INACTIVE_DAYS, purgeableFrom(fresh.updated_at)) };
  }
  return { ok: true, purged, pending: await removeMarkedFiles(env, draftId, draft.year) };
}
