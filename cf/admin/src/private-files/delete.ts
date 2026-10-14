// A student removes one of their own files: `DELETE /portal/api/applications/current/files/:fileId`
// (docs/cloudflare/portal-api.md, 11.3). Only while the application is a draft in an open batch (the gate's errors
// apply) and only the student's own live file. The row is marked in ONE guarded statement (the file must be a live
// file of THIS student's draft: there is no other way to name one) and, in the same batch, its bytes go back to the
// storage counter; then the object goes and the row with it (src/private-files/remove.ts). A file that is not theirs, not
// live or not an id is `404 not_found`, never 403.

import type { Bindings } from "../env";
import { applicationFileKey, isUuid } from "./key";
import { REFUSALS, type Refusal } from "./refusal";
import { removeObjects } from "./remove";
import { readGate } from "./state";
import { releaseLiveStatement } from "./storage";

type Storage = Pick<Bindings, "DB" | "PRIVATE_FILES">;

export const MARK_SQL = "UPDATE application_files SET deleted_at = ?1 WHERE id = ?2 AND application_id = ?3 AND deleted_at IS NULL RETURNING id, content_type";

/** The draft's version moves with the file list, so a submit that read the draft a moment ago finds it changed. */
export const TOUCH_SQL = "UPDATE application_drafts SET updated_at = MAX(?1, updated_at + 1) WHERE id = ?2 AND EXISTS (SELECT 1 FROM application_files WHERE id = ?3 AND deleted_at = ?1)";

export async function deleteOwnFile(env: Storage, userId: string, fileId: string): Promise<{ ok: true } | { ok: false; refusal: Refusal }> {
  const now = Date.now();
  const gate = await readGate(env.DB, userId, now);
  if (!gate.ok) return gate;
  // No draft: there is nothing of theirs to remove. A malformed id is the same answer.
  if (!gate.draftId || !isUuid(fileId)) return { ok: false, refusal: REFUSALS.notFound };

  // The release goes just BEFORE the mark, over the same guard (the file is still live then); a file that is not theirs
  // matches nothing, releases nothing and is marked by nothing.
  const results = await env.DB.batch<{ id: string; content_type: string }>([
    releaseLiveStatement(env.DB, "id = ?1 AND application_id = ?2", [fileId, gate.draftId], now),
    env.DB.prepare(MARK_SQL).bind(now, fileId, gate.draftId),
    env.DB.prepare(TOUCH_SQL).bind(now, gate.draftId, fileId),
  ]);
  const row = results[1]!.results[0];
  if (!row) return { ok: false, refusal: REFUSALS.notFound };

  // The row is gone for every reader from here on. The object and the row's end are best effort: a failure leaves the
  // row marked and the daily cleanup finishes it.
  const key = applicationFileKey({ year: gate.batch.year, applicationId: gate.draftId, fileId: row.id, contentType: row.content_type });
  if (key) await removeObjects(env, [{ id: row.id, keys: [key] }]);
  return { ok: true };
}
