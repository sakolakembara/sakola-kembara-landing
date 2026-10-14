import type { Bindings } from "../env";
import { runFilesHousekeeping } from "../private-files/housekeeping";

// The daily cleanup, run by the Cron Trigger in wrangler.jsonc (it replaces
// the legacy "prune rate limit hits by hand" and the never-written session
// cleanup, SAKEM-073). Three tables only grow:
//
//   session       rows whose `expires_at` has passed. Nothing reads them: Better
//                 Auth already refuses an expired session, so deleting is only
//                 housekeeping (and keeps the 5 GB / 100k-writes budget calm).
//   verification  password reset and invite tokens, and OAuth state rows, once
//                 expired. Same reason.
//   audit_log     rows older than AUDIT_RETENTION_DAYS (a variable in
//                 wrangler.jsonc, 365 by default). Unset, "0" or not a number
//                 means keep everything: an unreadable setting must never
//                 delete evidence.
//
// The private bucket of applicants' files gets two chores of its own after these (src/private-files/housekeeping.ts):
// finishing the delete of a file a person already removed (the object that could not be deleted at the time) and
// recounting the storage counter. Neither ages a file out: nothing is deleted automatically (Dzul, 2026-10-13).
//
// Each table is cleared in chunks (a subselect with LIMIT: D1 does not
// guarantee DELETE ... LIMIT), at most MAX_ROUNDS chunks per run, so one run
// has a bounded cost; what is left goes tomorrow. Deleted rows count as rows
// written on D1 Free, indexes included, which is trivial at this scale. The log
// line carries counts only.

const CHUNK = 500;
const MAX_ROUNDS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CleanupResult {
  sessions: number;
  verifications: number;
  /** Rows deleted from audit_log; 0 when retention is off. */
  audit: number;
  /** The retention that was applied, or null when audit rows are kept. */
  auditRetentionDays: number | null;
}

/** The setting as a number of days, or null for "keep everything". */
export function auditRetentionDays(value: string | undefined): number | null {
  const text = value?.trim() ?? "";
  if (!/^[0-9]{1,5}$/.test(text)) return null; // plain digits only: "1e3", "-5", "1.5", "30 days" are not a retention
  const days = Number(text);
  return days > 0 ? days : null;
}

async function deleteInChunks(db: D1Database, table: "session" | "verification" | "audit_log", column: string, before: number): Promise<number> {
  let total = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    // Table and column names are constants of this file, never input.
    const result = await db
      .prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${column} < ? LIMIT ${CHUNK})`)
      .bind(before)
      .run();
    const changed = result.meta.changes ?? 0;
    total += changed;
    if (changed < CHUNK) break;
  }
  return total;
}

/** `now` is the scheduled time in epoch milliseconds. */
export async function runCleanup(env: Pick<Bindings, "DB" | "AUDIT_RETENTION_DAYS">, now = Date.now()): Promise<CleanupResult> {
  const retention = auditRetentionDays(env.AUDIT_RETENTION_DAYS);
  const sessions = await deleteInChunks(env.DB, "session", "expires_at", now);
  const verifications = await deleteInChunks(env.DB, "verification", "expires_at", now);
  const audit = retention === null ? 0 : await deleteInChunks(env.DB, "audit_log", "created_at", now - retention * DAY_MS);
  return { sessions, verifications, audit, auditRetentionDays: retention };
}

export async function scheduledCleanup(controller: Pick<ScheduledController, "scheduledTime">, env: Bindings): Promise<void> {
  try {
    const result = await runCleanup(env, controller.scheduledTime);
    console.info(
      `[cron] cleanup: sessions=${result.sessions} verifications=${result.verifications} audit=${result.audit} retention=${result.auditRetentionDays ?? "off"}`,
    );
    // Counts only, and only when there was something to finish (a quiet day logs nothing more).
    const files = await runFilesHousekeeping(env, controller.scheduledTime);
    if (files.removed > 0 || files.pending > 0) console.info(`[cron] private files: removed=${files.removed} pending=${files.pending}`);
  } catch (error) {
    // Message only: it names a table or a SQL error, never a row.
    console.error(`[cron] cleanup failed: ${error instanceof Error ? error.message : "unknown error"}`);
    throw error; // lets the platform show the run as failed
  }
}
