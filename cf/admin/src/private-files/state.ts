// What a student's file write needs to know before it touches R2: is a batch open, does the student have a draft in
// it (or can they start one), how many files and bytes the draft holds. The rules are the gate of
// docs/cloudflare/portal-api.md, 6.2, and the limits of 11.1 and 11.2.
//
// The gate is the application API's, not a copy of it: `openStateQuery` and `toOpenState` (src/portal/queries.ts) read
// the open batch with the student's application and draft in one statement, and `writeRefusal` (src/portal/rules.ts)
// decides which of the three sentences a refused write gets (`no_open_batch`, `batch_closed`, `already_submitted`).
// The file routes add only what they need on top: the counts of the draft's live files and the file a replace names,
// read in ONE more round trip (none at all when the student has no draft yet).

import { MAX_BYTES_PER_APPLICATION, MAX_FILES_PER_APPLICATION } from "../../shared/application-form/limits";
import { SLOTS, type SlotId } from "../../shared/application-form/slots";
import { anyDraftQuery, dbOf, openStateQuery, toOpenState } from "../portal/queries";
import { writeRefusal } from "../portal/rules";
import { REFUSALS, slotFull, type Refusal } from "./refusal";

/** The live files of a draft by slot, with the bytes: `?1` is the draft's id. Also what an upload answers with. */
export const USAGE_SQL = "SELECT slot, COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM application_files WHERE application_id = ?1 AND deleted_at IS NULL GROUP BY slot";

/** The file a replace names, if it is a live file of this draft: `?1` the draft's id, `?2` the file's id. */
export const REPLACED_SQL = "SELECT id, slot, size, content_type FROM application_files WHERE id = ?2 AND application_id = ?1 AND deleted_at IS NULL";

export interface FileCounts {
  /** Live files per slot (a slot with none is absent). */
  bySlot: Readonly<Record<string, number>>;
  files: number;
  bytes: number;
}

export interface ReplacedFile {
  id: string;
  slot: string;
  size: number;
  contentType: string;
}

export interface OpenDraft {
  batch: { id: string; year: number };
  /** The student's draft in the open batch, or null when the first write has yet to create it. */
  draftId: string | null;
}

export type GateResult = ({ ok: true } & OpenDraft) | { ok: false; refusal: Refusal };

export type WriteState =
  | ({ ok: true; counts: FileCounts; replaced: ReplacedFile | null } & OpenDraft)
  | { ok: false; refusal: Refusal };

/** The gate alone: a delete needs no counts. */
export async function readGate(d1: D1Database, userId: string, now: number): Promise<GateResult> {
  const db = dbOf(d1);
  const state = toOpenState((await openStateQuery(db, userId, new Date(now)))[0]);
  // A draft that is still there with no batch open is a batch that closed on it: `batch_closed`, not `no_open_batch`.
  const refusal = writeRefusal(state, state === null && (await anyDraftQuery(db, userId)).length > 0);
  if (refusal || state === null) {
    const { error, message } = refusal ?? { error: "no_open_batch" as const, message: "" };
    return { ok: false, refusal: { status: 409, error, message } };
  }
  return { ok: true, batch: { id: state.batch.id, year: state.batch.year }, draftId: state.draft?.id ?? null };
}

/** The gate, the live counts of the draft, and the file `replaceId` names (when it is one of this draft's). */
export async function readWriteState(d1: D1Database, userId: string, now: number, replaceId: string | null): Promise<WriteState> {
  const gate = await readGate(d1, userId, now);
  if (!gate.ok) return gate;

  const bySlot: Record<string, number> = {};
  let files = 0;
  let bytes = 0;
  let replaced: ReplacedFile | null = null;
  if (gate.draftId) {
    const statements = [d1.prepare(USAGE_SQL).bind(gate.draftId)];
    if (replaceId) statements.push(d1.prepare(REPLACED_SQL).bind(gate.draftId, replaceId));
    const [usage, target] = await d1.batch<Record<string, unknown>>(statements);
    for (const row of usage!.results as { slot: string; n: number; bytes: number }[]) {
      bySlot[row.slot] = row.n;
      files += row.n;
      bytes += row.bytes;
    }
    const row = target?.results[0] as { id: string; slot: string; size: number; content_type: string } | undefined;
    if (row) replaced = { id: row.id, slot: row.slot, size: row.size, contentType: row.content_type };
  }
  return { ...gate, counts: { bySlot, files, bytes }, replaced };
}

/**
 * Does one more file of `size` bytes fit in `slot` (and in the application), once `replaced` is out of the way? The first
 * refusal, in the order of the contract: the slot, the number of files, the bytes. Pure.
 */
export function checkRoom(slot: SlotId, counts: FileCounts, replaced: Pick<ReplacedFile, "size"> | null, size: number): Refusal | null {
  const max = SLOTS[slot].maxFiles;
  if ((counts.bySlot[slot] ?? 0) - (replaced ? 1 : 0) >= max) return slotFull(max);
  if (counts.files - (replaced ? 1 : 0) >= MAX_FILES_PER_APPLICATION) return REFUSALS.applicationFull;
  if (counts.bytes - (replaced ? replaced.size : 0) + size > MAX_BYTES_PER_APPLICATION) return REFUSALS.applicationTooLarge;
  return null;
}
