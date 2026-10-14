// The two chores of the private bucket that the daily Cron Trigger of `sakem-admin` does (src/cron/cleanup.ts). Neither
// is a retention rule: Dzul decided on 2026-10-13 that NOTHING is deleted automatically (the retention job of the first
// design was never built; a manual purge replaced it, src/private-files/purge.ts). Nothing here ages a file out.
//
//   1. Finish what a person already asked for. A student's delete, a replaced file and an admin's purge mark the row
//      first and delete the object second; when the second step failed the row stays marked and is retried here (at
//      most 200 a run, and not in the first hour, so a delete in flight is left to finish by itself).
//   2. Recount the storage counter (`private_storage`) from the LIVE file rows, so a reservation that was never given back
//      (a Worker that died mid-upload) does not eat the budget for good. A marked row is already out of the counter.
//
// An object that was stored and whose row never was (the Worker died between the two, and the clean-up delete failed
// too) is invisible to both: finding it would mean listing the whole bucket. It costs a few megabytes of the budget at
// worst, and is for a person to find with the dashboard.

import type { Bindings } from "../env";
import { applicationFileKey } from "./key";
import { removeObjects, type RemovableFile } from "./remove";
import { reconcileStorageStatement } from "./storage";

type Storage = Pick<Bindings, "DB" | "PRIVATE_FILES">;

const MAX_PER_RUN = 200;
/** A row marked less than an hour ago may still have its own request finishing it. */
const GRACE_MS = 60 * 60 * 1000;

// The year comes from the batch of the file's draft or application. When neither exists any more (the account was
// deleted and its draft with it) it is null, and every year there is a batch for is tried.
const MARKED_SQL = `SELECT f.id, f.application_id, f.content_type, COALESCE(db.year, ab.year) AS year
FROM application_files f
LEFT JOIN application_drafts d ON d.id = f.application_id
LEFT JOIN admission_batches db ON db.id = d.batch_id
LEFT JOIN student_applications a ON a.id = f.application_id
LEFT JOIN admission_batches ab ON ab.id = a.batch_id
WHERE f.deleted_at IS NOT NULL AND f.deleted_at <= ?1
ORDER BY f.deleted_at
LIMIT ${MAX_PER_RUN}`;

export interface HousekeepingResult {
  /** Marked rows whose object and row were removed this run. */
  removed: number;
  /** Marked rows still there (the bucket refused, or the run's bound was reached). */
  pending: number;
}

/** `now` is the scheduled time in epoch milliseconds. Never reads a retention variable: there is none. */
export async function runFilesHousekeeping(env: Storage, now: number): Promise<HousekeepingResult> {
  if (!env.PRIVATE_FILES) return { removed: 0, pending: 0 };

  const { results } = await env.DB.prepare(MARKED_SQL).bind(now - GRACE_MS).all<{ id: string; application_id: string; content_type: string; year: number | null }>();
  let batchYears: number[] | null = null;
  const files: RemovableFile[] = [];
  for (const row of results) {
    let years: number[];
    if (row.year !== null) years = [row.year];
    else {
      // Deleting a key that is not there is not an error, so trying every year costs nothing but a few keys in the call.
      batchYears ??= (await env.DB.prepare("SELECT DISTINCT year FROM admission_batches").all<{ year: number }>()).results.map((entry) => entry.year);
      years = batchYears;
    }
    files.push({ id: row.id, keys: years.flatMap((year) => applicationFileKey({ year, applicationId: row.application_id, fileId: row.id, contentType: row.content_type }) ?? []) });
  }
  const removed = await removeObjects(env, files);

  await reconcileStorageStatement(env.DB, now).run();
  return { removed, pending: files.length - removed };
}
