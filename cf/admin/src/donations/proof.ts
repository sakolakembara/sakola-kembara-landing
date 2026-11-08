// The receipt of a one-off donation (SAKEM-128): `PUT /api/public/donations/:id/proof`, the body streamed to the PRIVATE
// bucket the applicants' files use, under the same storage budget (src/private-files/storage.ts). The order, cheapest
// first, the first failure answers:
//
//   1. `Content-Length` present, positive, at most 10 MB                 411 / 400 / 413
//   2. the row, by id AND token hash: a one-off donation not yet checked  404 / 409
//   3. the bucket exists                                                  503 storage_unavailable
//   4. the storage counter takes the bytes (one atomic UPDATE)            503 storage_full
//   5. the first 1 MiB is read and sniffed: PNG, JPEG, WebP or PDF        415 / 422
//   6. the body is streamed to R2 as exactly the declared length          400 body_mismatch / 503
//   7. ONE guarded UPDATE moves the row to `new` with the receipt         409 (the row was checked meanwhile)
//   8. the receipt it replaced, if any, is removed and its bytes released
//
// Anything that fails after step 4 gives the reservation back and removes the object. The client's content type and file
// name are never read, stored or logged; the key is `donations/<donation id>/<file id>.<ext>` (no part of a person in it).

import type { Bindings } from "../env";
import { releaseStorage, reserveStorage } from "../private-files/storage";
import { putStream, readHead } from "../private-files/stream";
import { FILE_TYPES, sniff, type FileType } from "../uploads/sniff";
import { DONATION_PROOF_MAX_BYTES } from "../db/schema/donations";
import { readDonation } from "./store";

type Storage = Pick<Bindings, "DB" | "PRIVATE_FILES" | "PRIVATE_FILES_BUDGET_BYTES">;

const PROOF_TYPES: readonly FileType[] = ["png", "jpeg", "webp", "pdf"];

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** The only shape a receipt key has. Anything else is not ours: never served, never deleted. */
export const PROOF_KEY_PATTERN = new RegExp(`^donations/${UUID}/${UUID}\\.(png|jpg|webp|pdf)$`);

export function proofKey(donationId: string, fileId: string, type: FileType): string {
  const key = `donations/${donationId}/${fileId}.${FILE_TYPES[type].ext}`;
  if (!PROOF_KEY_PATTERN.test(key)) throw new Error("proofKey: not a donation key");
  return key;
}

export interface ProofRefusal {
  status: 400 | 404 | 409 | 411 | 413 | 415 | 422 | 503;
  error: string;
  message: string;
}

const refusal = (status: ProofRefusal["status"], error: string, message: string): ProofRefusal => ({ status, error, message });

export const PROOF_REFUSALS = {
  lengthRequired: refusal(411, "length_required", "Unggahan tidak dapat dibaca. Silakan coba lagi."),
  empty: refusal(400, "empty_file", "Berkas kosong. Pilih foto atau PDF bukti transfer."),
  tooLarge: refusal(413, "too_large", "Berkas lebih dari 10 MB. Pilih foto atau PDF yang lebih kecil."),
  notFound: refusal(404, "not_found", "Data donasi tidak ditemukan. Silakan isi formulir dari awal."),
  monthly: refusal(409, "monthly_no_proof", "Donasi bulanan tidak memerlukan bukti transfer."),
  locked: refusal(409, "locked", "Donasi ini sudah kami cek, jadi bukti transfer tidak dapat diganti."),
  unavailable: refusal(503, "storage_unavailable", "Bukti transfer belum dapat diunggah saat ini. Silakan coba lagi nanti."),
  full: refusal(503, "storage_full", "Bukti transfer belum dapat diunggah saat ini. Silakan kirim lewat WhatsApp kami."),
  unsupported: refusal(415, "unsupported_type", "Bukti transfer harus berupa foto (JPG, PNG, WebP) atau PDF."),
  unreadable: refusal(422, "unreadable_file", "Berkas tidak dapat dibaca. Silakan pilih foto atau PDF lain."),
  mismatch: refusal(400, "body_mismatch", "Unggahan terputus. Silakan coba lagi."),
} as const;

export type ProofOutcome = { ok: true } | { ok: false; refusal: ProofRefusal };

/** The declared length, or the refusal (411 no usable header, 400 empty, 413 over 10 MB). */
export function proofLength(header: string | null | undefined): number | ProofRefusal {
  const value = header?.trim() ?? "";
  if (!/^[0-9]{1,12}$/.test(value)) return PROOF_REFUSALS.lengthRequired;
  const length = Number(value);
  if (length === 0) return PROOF_REFUSALS.empty;
  if (length > DONATION_PROOF_MAX_BYTES) return PROOF_REFUSALS.tooLarge;
  return length;
}

export interface ProofInput {
  id: string;
  tokenHash: string;
  contentLength: string | null | undefined;
  body: ReadableStream<Uint8Array> | null;
  now: number;
}

export async function storeProof(env: Storage, input: ProofInput): Promise<ProofOutcome> {
  const refuse = (r: ProofRefusal): ProofOutcome => ({ ok: false, refusal: r });

  const declared = proofLength(input.contentLength);
  if (typeof declared !== "number") return refuse(declared);
  if (!input.body) return refuse(PROOF_REFUSALS.lengthRequired);

  const row = await readDonation(env.DB, input.id, input.tokenHash);
  if (!row) return refuse(PROOF_REFUSALS.notFound);
  if (row.kind !== "once") return refuse(PROOF_REFUSALS.monthly);
  if (row.status === "checked") return refuse(PROOF_REFUSALS.locked);

  const bucket = env.PRIVATE_FILES;
  if (!bucket) return refuse(PROOF_REFUSALS.unavailable);
  if (!(await reserveStorage(env, declared, input.now))) return refuse(PROOF_REFUSALS.full);

  let stored: string | null = null;
  let done = false;
  try {
    const head = await readHead(input.body, declared);
    if (head.ended && head.bytes < declared) return refuse(PROOF_REFUSALS.mismatch);
    const found = sniff(head.head, declared);
    if (!found.ok) return refuse(found.reason === "unknown_type" ? PROOF_REFUSALS.unsupported : PROOF_REFUSALS.unreadable);
    if (!PROOF_TYPES.includes(found.type)) return refuse(PROOF_REFUSALS.unsupported);
    const type = FILE_TYPES[found.type];

    const key = proofKey(input.id, crypto.randomUUID(), found.type);
    const put = await putStream(bucket, key, { httpMetadata: { contentType: type.contentType } }, head, input.body, declared);
    if (!put.ok) return refuse(put.reason === "mismatch" ? PROOF_REFUSALS.mismatch : PROOF_REFUSALS.unavailable);
    stored = key;

    const updated = await env.DB.prepare(
      `UPDATE donations SET proof_key = ?3, proof_type = ?4, proof_size = ?5, proof_at = ?6, status = 'new', updated_at = ?6
       WHERE id = ?1 AND token_hash = ?2 AND kind = 'once' AND status != 'checked'`,
    )
      .bind(input.id, input.tokenHash, key, type.contentType, declared, input.now)
      .run();
    if ((updated.meta.changes ?? 0) !== 1) return refuse(PROOF_REFUSALS.locked);
    done = true;

    // The receipt this one replaced: its bytes go back to the budget and its object goes. A failure here leaves an
    // orphan object no row points at; the daily recount (src/private-files/storage.ts) corrects the counter.
    if (row.proof_key && PROOF_KEY_PATTERN.test(row.proof_key)) {
      await releaseStorage(env, row.proof_size ?? 0, input.now);
      await bucket.delete(row.proof_key).catch(() => undefined);
    }
    return { ok: true };
  } finally {
    // Every refusal after the reservation lands here: the object (if it was written) and the bytes go back.
    if (!done) {
      if (stored !== null) await bucket.delete(stored).catch(() => undefined);
      await releaseStorage(env, declared, input.now).catch(() => undefined);
    }
  }
}
