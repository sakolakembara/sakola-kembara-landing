// Taking applicants' files out of the bucket, in the one order that keeps the books right:
//
//   1. the caller MARKS the file rows (`deleted_at`), which makes them invisible to every reader at once (a student's
//      list, the admin's list, a read) and is the commitment;
//   2. `removeObjects` deletes the objects from R2 (deleting a key that is already gone is not an error);
//   3. only then are the rows deleted and the storage counter lowered, in one batch.
//
// If step 2 fails nothing else happens: the rows stay marked, the counter still counts the bytes that are still in the
// bucket, and the daily cleanup retries (src/cron/cleanup.ts). So the counter never claims room the bucket does not
// have, and a file the person asked to remove never comes back. There is NO automatic deletion beyond this retry of
// something a person already asked for (Dzul, 2026-10-13): nothing here ages a file out.

import type { Bindings } from "../env";
import { buildKey, isUuid, typeOfContentType } from "./key";

type Storage = Pick<Bindings, "DB" | "PRIVATE_FILES">;

/** A row marked for deletion whose object is to go: its id and size are the row's, its keys are what could name the object. */
export interface RemovableFile {
  id: string;
  size: number;
  keys: string[];
}

/** The key of one file, for a caller that knows the batch year and the application. Null for a content type the table does not allow. */
export function keyOfFile(year: number, applicationId: string, file: { id: string; contentType: string }): string | null {
  const type = typeOfContentType(file.contentType);
  if (!type || !isUuid(applicationId) || !isUuid(file.id) || !Number.isInteger(year) || year < 1000 || year > 9999) return null;
  return buildKey({ year, applicationId, fileId: file.id, type });
}

/** Most ids in one statement: D1 allows 100 bound parameters, and the counter statement binds the ids twice. */
const IDS_PER_STATEMENT = 40;

const marks = (ids: readonly string[]) => ids.map((_, index) => `?${index + 1}`).join(", ");

/**
 * Deletes the objects of `files` and, when that worked, their rows and their share of the counter. Returns how many
 * rows were removed (0 when the bucket refused: they stay marked). Never throws; a failure is one fixed log line with
 * no key, id or count of anything personal.
 */
export async function removeObjects(env: Storage, files: readonly RemovableFile[], now: number): Promise<number> {
  const live = files.filter((file) => file.keys.length > 0);
  if (live.length === 0) return 0;
  const bucket: R2Bucket | undefined = env.PRIVATE_FILES;
  if (!bucket) return 0;

  // R2 deletes up to 1,000 keys a call; a file has one key, or a few when the year of its batch is not known.
  const keys = live.flatMap((file) => file.keys);
  try {
    for (let from = 0; from < keys.length; from += 1000) await bucket.delete(keys.slice(from, from + 1000));
  } catch {
    console.error("[private-files] the objects of removed files could not be deleted; they stay marked for the daily cleanup");
    return 0;
  }

  const statements: D1PreparedStatement[] = [];
  for (let from = 0; from < live.length; from += IDS_PER_STATEMENT) {
    const ids = live.slice(from, from + IDS_PER_STATEMENT).map((file) => file.id);
    const list = marks(ids);
    // Only rows that are marked: a live file is never counted out or deleted here, whatever ids arrive.
    statements.push(
      env.DB.prepare(
        `UPDATE private_storage SET
           bytes = MAX(bytes - (SELECT COALESCE(SUM(size), 0) FROM application_files WHERE id IN (${list}) AND deleted_at IS NOT NULL), 0),
           files = MAX(files - (SELECT COUNT(*) FROM application_files WHERE id IN (${list}) AND deleted_at IS NOT NULL), 0),
           updated_at = ?${ids.length + 1}
         WHERE id = 'private-files'`,
      ).bind(...ids, now),
      env.DB.prepare(`DELETE FROM application_files WHERE id IN (${list}) AND deleted_at IS NOT NULL`).bind(...ids),
    );
  }
  try {
    await env.DB.batch(statements);
  } catch {
    console.error("[private-files] the rows of removed files could not be deleted; they stay marked for the daily cleanup");
    return 0;
  }
  return live.length;
}
