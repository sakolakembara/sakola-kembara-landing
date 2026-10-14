// Taking applicants' files out of the bucket, in the one order that keeps the books right:
//
//   1. the caller MARKS the file rows (`deleted_at`) and, in the SAME batch, gives their bytes back to the storage counter
//      (`releaseStatement` in src/private-files/storage.ts, which runs just before the mark and counts only rows that are
//      still live). The mark makes the file invisible to every reader at once (a student's list, the admin's list, a
//      read) and is the commitment. The counter is "the bytes of the LIVE files": the application API's removal of the
//      `dtks` files does the same (src/portal/queries.ts), so no path counts a file twice or not at all;
//   2. `removeObjects` deletes the objects from R2 (deleting a key that is already gone is not an error);
//   3. only then are the marked rows deleted.
//
// If step 2 fails nothing else happens: the rows stay marked (invisible, and already out of the counter), and the daily
// cleanup retries (src/private-files/housekeeping.ts). A file the person asked to remove never comes back. There is NO
// automatic deletion beyond this retry of something a person already asked for (Dzul, 2026-10-13): nothing here ages a
// file out.

import type { Bindings } from "../env";

type Storage = Pick<Bindings, "DB" | "PRIVATE_FILES">;

/** A row marked for deletion whose object is to go: its id, and what could name the object (one key, or a few when the year of its batch is not known). */
export interface RemovableFile {
  id: string;
  keys: string[];
}

/** Most ids in one statement: D1 allows 100 bound parameters. */
const IDS_PER_STATEMENT = 90;

const marks = (ids: readonly string[]) => ids.map((_, index) => `?${index + 1}`).join(", ");

/**
 * Deletes the objects of `files` and, when that worked, their MARKED rows. Returns how many rows were asked to go (0 when
 * the bucket refused: they stay marked). Never throws; a failure is one fixed log line with no key, id or count of
 * anything personal. The statement deletes only rows that are marked: a live file's row is never deleted here, whatever
 * ids arrive.
 */
export async function removeObjects(env: Storage, files: readonly RemovableFile[]): Promise<number> {
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
    statements.push(env.DB.prepare(`DELETE FROM application_files WHERE id IN (${marks(ids)}) AND deleted_at IS NOT NULL`).bind(...ids));
  }
  try {
    await env.DB.batch(statements);
  } catch {
    console.error("[private-files] the rows of removed files could not be deleted; they stay marked for the daily cleanup");
    return 0;
  }
  return live.length;
}
