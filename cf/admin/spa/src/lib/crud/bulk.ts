import type { ApiFailure, ApiResult } from "../api";
import { describeFailure } from "./errors";
import type { FlashMessage } from "./flash";

// Doing one thing to several rows of a list (docs/cloudflare/admin-crud.md#15-the-spa-kit). The Worker has no bulk
// endpoint: each row is its own request, with its own version (`If-Match`) and its own audit row, exactly as when
// it is done from the row. They go one after the other, so the Worker sees what it always sees and a stale row
// costs one row, not the lot.
//
// A row can fail for its own reason (edited by someone else since the list, in use, already gone). Those are
// reported by name and the rest goes on. A failure that would hit every row the same way (offline, signed out, no
// permission, rate limited, a server error) stops the run: the rest were not tried, which the notice says.

export interface BulkFailure<T> {
  row: T;
  reason: string;
}

export interface BulkResult<T> {
  done: T[];
  failed: BulkFailure<T>[];
  /** Not tried: the run stopped at a failure that would have hit them too. */
  skipped: T[];
}

/** A failure that says nothing about the row: the next one would fail the same way. */
function stopsTheRun(failure: ApiFailure): boolean {
  return failure.status === 0 || failure.status === 401 || failure.status === 403 || failure.status === 429 || failure.status >= 500;
}

/** One sentence for a row that failed: the Worker's words, or for a stale one a short one (the long one is about a form). */
function reasonOf(failure: ApiFailure): string {
  const described = describeFailure(failure);
  return described.stale ? "sudah diubah orang lain, muat ulang daftar" : described.message;
}

export async function runEach<T>(
  rows: readonly T[],
  run: (row: T) => Promise<ApiResult<unknown>>,
  options: { /** A row that is gone (404) is where a delete wanted it. */ goneIsDone?: boolean; onProgress?: (finished: number) => void } = {},
): Promise<BulkResult<T>> {
  const result: BulkResult<T> = { done: [], failed: [], skipped: [] };
  for (const [index, row] of rows.entries()) {
    const outcome = await run(row);
    if (outcome.ok || (options.goneIsDone && outcome.status === 404)) {
      result.done.push(row);
    } else {
      result.failed.push({ row, reason: reasonOf(outcome) });
      if (stopsTheRun(outcome)) {
        result.skipped.push(...rows.slice(index + 1));
        break;
      }
    }
    options.onProgress?.(index + 1);
  }
  return result;
}

/** How many failures a notice names before "dan N lainnya". */
const NAMED_FAILURES = 3;

/**
 * The notice of a run: green when every row went through ("3 artikel dihapus."), red otherwise, with what did go
 * through, then each failure by name and reason, then how many were not tried.
 */
export function describeBulk<T>(result: BulkResult<T>, words: { noun: string; verb: string; nameOf: (row: T) => string }): FlashMessage {
  const done = `${result.done.length} ${words.noun} ${words.verb}.`;
  if (result.failed.length === 0 && result.skipped.length === 0) return { tone: "success", text: done };
  const named = result.failed.slice(0, NAMED_FAILURES).map((failure) => `“${words.nameOf(failure.row)}” (${failure.reason})`);
  const more = result.failed.length - named.length;
  const parts = [
    result.done.length > 0 ? done : `Tidak ada ${words.noun} yang ${words.verb}.`,
    `${result.failed.length} gagal: ${named.join(", ")}${more > 0 ? `, dan ${more} lainnya` : ""}.`,
  ];
  if (result.skipped.length > 0) parts.push(`${result.skipped.length} lagi tidak diproses karena prosesnya berhenti.`);
  return { tone: "danger", text: parts.join(" ") };
}
