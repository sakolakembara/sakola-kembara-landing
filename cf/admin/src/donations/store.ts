// The donor's side of the `donations` table (SAKEM-128): create, change, read and annotate ONE row, always by its id
// AND the hash of its token, so a guessed or leaked id alone opens nothing. Raw D1 statements, one round trip each.
// The admin's side (list, detail, check, note, delete, CSV) is src/api/donations.ts.

import type { DonationKind, DonationSource, DonationStatus } from "../db/schema/donations";
import type { DonationInput } from "./rules";

/** What the donor's browser may see of its own row: what it typed, the status, whether a receipt is in. Never the receipt or the note. */
export interface DonationSummary {
  id: string;
  kind: DonationKind;
  name: string;
  whatsapp: string;
  amount: number;
  startMonth: string | null;
  remindDay: number | null;
  status: DonationStatus;
  hasProof: boolean;
  source: DonationSource | null;
}

interface Row {
  id: string;
  kind: DonationKind;
  name: string;
  whatsapp: string;
  amount: number;
  start_month: string | null;
  remind_day: number | null;
  status: DonationStatus;
  proof_key: string | null;
  proof_size: number | null;
  source: DonationSource | null;
}

const COLUMNS = "id, kind, name, whatsapp, amount, start_month, remind_day, status, proof_key, proof_size, source";

export function summaryOf(row: Row): DonationSummary {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    whatsapp: row.whatsapp,
    amount: row.amount,
    startMonth: row.start_month,
    remindDay: row.remind_day,
    status: row.status,
    hasProof: row.proof_key !== null,
    source: row.source,
  };
}

/** A new row: a one-off donation waits for its receipt, a monthly pledge is complete at once. */
export async function createDonation(db: D1Database, input: DonationInput, tokenHash: string, now: number): Promise<DonationSummary> {
  const id = crypto.randomUUID();
  const status: DonationStatus = input.kind === "once" ? "awaiting_transfer" : "new";
  const row = await db
    .prepare(
      `INSERT INTO donations (id, kind, name, whatsapp, amount, start_month, remind_day, status, token_hash, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10) RETURNING ${COLUMNS}`,
    )
    .bind(id, input.kind, input.name, input.whatsapp, input.amount, input.startMonth, input.remindDay, status, tokenHash, now)
    .first<Row>();
  if (!row) throw new Error("donation insert returned no row");
  return summaryOf(row);
}

export async function readDonation(db: D1Database, id: string, tokenHash: string): Promise<Row | null> {
  return db.prepare(`SELECT ${COLUMNS} FROM donations WHERE id = ?1 AND token_hash = ?2`).bind(id, tokenHash).first<Row>();
}

export type UpdateOutcome = { ok: true; summary: DonationSummary } | { ok: false; reason: "not_found" | "locked" | "proof_locked" };

/**
 * "Ubah data": step 1 again, on the same row. Refused once an admin checked it, and a one-off donation whose receipt is in
 * cannot become a monthly one (a monthly row has no receipt). The status follows the kind: a one-off without a receipt
 * waits for it, anything else is `new`. The guard is in the UPDATE itself, so a check that lands in between wins.
 */
export async function updateDonation(db: D1Database, id: string, tokenHash: string, input: DonationInput, now: number): Promise<UpdateOutcome> {
  const current = await readDonation(db, id, tokenHash);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.status === "checked") return { ok: false, reason: "locked" };
  if (input.kind === "monthly" && current.proof_key !== null) return { ok: false, reason: "proof_locked" };
  const status: DonationStatus = input.kind === "once" && current.proof_key === null ? "awaiting_transfer" : "new";
  const row = await db
    .prepare(
      `UPDATE donations SET kind = ?3, name = ?4, whatsapp = ?5, amount = ?6, start_month = ?7, remind_day = ?8, status = ?9, updated_at = ?10
       WHERE id = ?1 AND token_hash = ?2 AND status != 'checked' AND (?3 = 'once' OR proof_key IS NULL) RETURNING ${COLUMNS}`,
    )
    .bind(id, tokenHash, input.kind, input.name, input.whatsapp, input.amount, input.startMonth, input.remindDay, status, now)
    .first<Row>();
  if (!row) return { ok: false, reason: "locked" };
  return { ok: true, summary: summaryOf(row) };
}

/** The optional question of the thank-you page. Allowed in any status: it says nothing about the money. */
export async function setDonationSource(db: D1Database, id: string, tokenHash: string, source: DonationSource, now: number): Promise<DonationSummary | null> {
  const row = await db
    .prepare(`UPDATE donations SET source = ?3, updated_at = ?4 WHERE id = ?1 AND token_hash = ?2 RETURNING ${COLUMNS}`)
    .bind(id, tokenHash, source, now)
    .first<Row>();
  return row ? summaryOf(row) : null;
}
