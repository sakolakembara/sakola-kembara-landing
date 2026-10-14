// The hard storage budget of the private bucket (docs/cloudflare/portal-architecture.md, 8.3): ONE row in
// `private_storage`, updated atomically BEFORE the bytes are written. R2 Free holds 10 GB-month; the budget variable
// (PRIVATE_FILES_BUDGET_BYTES, proposed 8,000,000,000) keeps an overshoot, which would cost cents, from happening at
// all. The counter is bookkeeping, not billing: a Worker that dies between the reservation and the file row leaves
// the counter too high (the daily cleanup recomputes it from the file rows, src/cron/cleanup.ts), and a recount
// during an upload makes it briefly too low by that one file. Neither can store a byte the budget refuses.

import type { Bindings } from "../env";

/** The code's default when the variable is missing or unreadable: the proposal, under the 10 GB-month of R2 Free. */
export const DEFAULT_BUDGET_BYTES = 8_000_000_000;

/** The budget in bytes: plain digits only ("8e9", "-1", "8 GB" and "0" are not a budget: an unreadable setting falls back to the default). */
export function storageBudget(value: string | undefined): number {
  const text = value?.trim() ?? "";
  if (!/^[0-9]{1,15}$/.test(text)) return DEFAULT_BUDGET_BYTES;
  const bytes = Number(text);
  return bytes > 0 ? bytes : DEFAULT_BUDGET_BYTES;
}

type Storage = Pick<Bindings, "DB" | "PRIVATE_FILES_BUDGET_BYTES">;

const ROW = "private-files";

/**
 * Takes `size` bytes and one file from the budget, only if they fit: ONE statement, so two uploads at once cannot
 * both take the last bytes. False means the budget is spent (or the counter row is missing: fail closed).
 */
export async function reserveStorage(env: Storage, size: number, now: number): Promise<boolean> {
  const result = await env.DB.prepare("UPDATE private_storage SET bytes = bytes + ?1, files = files + 1, updated_at = ?3 WHERE id = ?4 AND bytes + ?1 <= ?2")
    .bind(size, storageBudget(env.PRIVATE_FILES_BUDGET_BYTES), now, ROW)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

/** Gives a reservation back (the upload failed after it, or the file went away). Never below zero. */
export async function releaseStorage(env: Pick<Bindings, "DB">, size: number, now: number): Promise<void> {
  await env.DB.prepare("UPDATE private_storage SET bytes = MAX(bytes - ?1, 0), files = MAX(files - 1, 0), updated_at = ?2 WHERE id = ?3").bind(size, now, ROW).run();
}

/** The counter as the file rows say it is: every row, live or marked for deletion, still has its object in the bucket. */
export function reconcileStorageStatement(db: D1Database, now: number): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE private_storage SET bytes = (SELECT COALESCE(SUM(size), 0) FROM application_files), files = (SELECT COUNT(*) FROM application_files), updated_at = ?1 WHERE id = ?2",
    )
    .bind(now, ROW);
}
