// What a student's file write needs to know before it touches R2: is a batch open, does the student have a draft in
// it (or can they start one), how many files and bytes the draft holds. Read in ONE D1 round trip. The rules are the
// gate of docs/cloudflare/portal-api.md, 6.2, and the limits of 11.1 and 11.2.
//
// This is the file routes' own copy of the open-batch gate: the application API (src/portal/applications.ts, a
// parallel task of the milestone) has its own rules.ts for the same sentences. Both read the same rows the same way
// (`opens_at <= now < closes_at`, the latest `opens_at`, the legacy `getCurrentOpenBatch`); a test of the gate here
// pins every row of the table of 6.2 for the file routes.

import { MAX_BYTES_PER_APPLICATION, MAX_FILES_PER_APPLICATION } from "../../shared/application-form/limits";
import { SLOTS, type SlotId } from "../../shared/application-form/slots";
import { gateRefusal, REFUSALS, slotFull, type Refusal } from "./refusal";

/** The draft of this student in the batch that is open at `?2` (a subselect: nothing else is known yet). */
const OPEN_BATCH_ID = "(SELECT id FROM admission_batches WHERE opens_at <= ?2 AND closes_at > ?2 ORDER BY opens_at DESC LIMIT 1)";
const DRAFT_OF_OPEN_BATCH = `(SELECT d.id FROM application_drafts d WHERE d.user_id = ?1 AND d.batch_id = ${OPEN_BATCH_ID})`;

export const GATE_SQL = `SELECT b.id AS batch_id, b.year AS year,
  (SELECT a.id FROM student_applications a WHERE a.user_id = ?1 AND a.batch_id = b.id) AS application_id,
  (SELECT d.id FROM application_drafts d WHERE d.user_id = ?1 AND d.batch_id = b.id) AS draft_id
FROM admission_batches b
WHERE b.opens_at <= ?2 AND b.closes_at > ?2
ORDER BY b.opens_at DESC LIMIT 1`;

export const COUNTS_SQL = `SELECT slot, COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM application_files WHERE application_id = ${DRAFT_OF_OPEN_BATCH} AND deleted_at IS NULL GROUP BY slot`;

export const REPLACED_SQL = `SELECT id, slot, size, content_type FROM application_files WHERE id = ?3 AND deleted_at IS NULL AND application_id = ${DRAFT_OF_OPEN_BATCH}`;

/** Any draft at all, for telling "the batch closed on a draft" from "there is nothing to save to". */
export const ANY_DRAFT_SQL = "SELECT 1 AS found FROM application_drafts WHERE user_id = ?1 LIMIT 1";

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

interface GateRow {
  batch_id: string;
  year: number;
  application_id: string | null;
  draft_id: string | null;
}

async function resolveGate(db: D1Database, userId: string, row: GateRow | null): Promise<GateResult> {
  if (!row) {
    // No batch is open. A draft of a closed batch still being there is the "closed on you" case.
    const draft = await db.prepare(ANY_DRAFT_SQL).bind(userId).first();
    return { ok: false, refusal: gateRefusal(draft ? "batch_closed" : "no_open_batch") };
  }
  if (row.application_id) return { ok: false, refusal: gateRefusal("already_submitted") };
  return { ok: true, batch: { id: row.batch_id, year: row.year }, draftId: row.draft_id };
}

/** The gate alone: a delete needs no counts. */
export async function readGate(db: D1Database, userId: string, now: number): Promise<GateResult> {
  const row = await db.prepare(GATE_SQL).bind(userId, now).first<GateRow>();
  return resolveGate(db, userId, row);
}

/** The gate, the live counts of the draft, and the file `replaceId` names (when it is one of this draft's), in one round trip. */
export async function readWriteState(db: D1Database, userId: string, now: number, replaceId: string | null): Promise<WriteState> {
  const statements = [db.prepare(GATE_SQL).bind(userId, now), db.prepare(COUNTS_SQL).bind(userId, now)];
  if (replaceId) statements.push(db.prepare(REPLACED_SQL).bind(userId, now, replaceId));
  const [gateResult, countsResult, replacedResult] = await db.batch<Record<string, unknown>>(statements);

  const gate = await resolveGate(db, userId, (gateResult!.results[0] as unknown as GateRow | undefined) ?? null);
  if (!gate.ok) return gate;

  const bySlot: Record<string, number> = {};
  let files = 0;
  let bytes = 0;
  for (const row of countsResult!.results as { slot: string; n: number; bytes: number }[]) {
    bySlot[row.slot] = row.n;
    files += row.n;
    bytes += row.bytes;
  }
  const replacedRow = replacedResult?.results[0] as { id: string; slot: string; size: number; content_type: string } | undefined;
  const replaced = replacedRow ? { id: replacedRow.id, slot: replacedRow.slot, size: replacedRow.size, contentType: replacedRow.content_type } : null;
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
