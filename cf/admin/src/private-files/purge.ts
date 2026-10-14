// The manual purge: an admin deletes every file of one submitted application. Dzul decided on 2026-10-13 that nothing
// is deleted automatically, so this is how an applicant's documents are removed (a family asks, an acceptance is
// withdrawn, the committee is done): `POST /api/admin/applications/:id/files/purge`, for an editor with the
// Pendaftaran grant or a super_admin (docs/cloudflare/portal-api.md, 12.3).
//
// In order, so that a failure in the middle never loses the record of what happened:
//   1. ONE batch: the audit row `application_file.purge` (resource: the application; metadata: the COUNT and the file
//      ids, computed by the same transaction that marks the rows, so they are exactly what was purged; no name, no
//      slot, no size), the bytes of the live files back to the storage counter, and the marking of every live file row.
//      The audit row exists only if there was something to purge.
//   2. the objects are deleted from R2, then the marked rows (src/private-files/remove.ts).
// If step 2 fails the rows stay marked (invisible to every reader, and already out of the counter) and the daily cleanup
// finishes the job.

import type { AuthUser } from "../context";
import type { Bindings } from "../env";
import { applicationFileKey, isUuid } from "./key";
import { REFUSALS, type Refusal } from "./refusal";
import { removeObjects, type RemovableFile } from "./remove";
import { releaseLiveStatement } from "./storage";

type Storage = Pick<Bindings, "DB" | "PRIVATE_FILES">;

export const APPLICATION_SQL = "SELECT b.year AS year FROM student_applications a JOIN admission_batches b ON b.id = a.batch_id WHERE a.id = ?1";

// `json(...)` marks the aggregate's text as JSON so it nests as an array, not as a string. HAVING keeps the row from
// being written when no live file is left (an aggregate with no rows still yields one row).
export const AUDIT_PURGE_SQL = `INSERT INTO audit_log (id, actor_id, actor_email, action, resource_type, resource_id, metadata)
SELECT ?1, ?2, ?3, 'application_file.purge', 'application', ?4, json_object('count', COUNT(*), 'fileIds', json(json_group_array(id)))
FROM application_files WHERE application_id = ?4 AND deleted_at IS NULL
HAVING COUNT(*) > 0`;

export const MARK_ALL_SQL = "UPDATE application_files SET deleted_at = ?1 WHERE application_id = ?2 AND deleted_at IS NULL";

export const MARKED_SQL = "SELECT id, content_type FROM application_files WHERE application_id = ?1 AND deleted_at IS NOT NULL";

export type PurgeOutcome = { ok: true; purged: number; pending: number } | { ok: false; refusal: Refusal };

export async function purgeApplicationFiles(env: Storage, actor: Pick<AuthUser, "id" | "email">, applicationId: string): Promise<PurgeOutcome> {
  if (!isUuid(applicationId)) return { ok: false, refusal: REFUSALS.notFound };
  const application = await env.DB.prepare(APPLICATION_SQL).bind(applicationId).first<{ year: number }>();
  if (!application) return { ok: false, refusal: REFUSALS.notFound };

  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare(AUDIT_PURGE_SQL).bind(crypto.randomUUID(), actor.id, actor.email.toLowerCase(), applicationId),
    releaseLiveStatement(env.DB, "application_id = ?1", [applicationId], now),
    env.DB.prepare(MARK_ALL_SQL).bind(now, applicationId),
  ]);
  const purged = results[2]!.meta.changes ?? 0;

  // Every marked row, the ones this call just marked and any an earlier failure left behind.
  const { results: rows } = await env.DB.prepare(MARKED_SQL).bind(applicationId).all<{ id: string; content_type: string }>();
  const files: RemovableFile[] = rows.flatMap((row) => {
    const key = applicationFileKey({ year: application.year, applicationId, fileId: row.id, contentType: row.content_type });
    return key ? [{ id: row.id, keys: [key] }] : [];
  });
  const removed = await removeObjects(env, files);
  return { ok: true, purged, pending: files.length - removed };
}
