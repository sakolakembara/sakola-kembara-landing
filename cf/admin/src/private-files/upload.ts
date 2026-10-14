// A student's upload of one file, from the checks to the file row: `PUT /portal/api/applications/current/files/:slot`
// (docs/cloudflare/portal-api.md, 11.2; the design and the reasons are docs/cloudflare/portal-architecture.md, 8.4).
//
// The order, cheapest first, the first failure answers (nothing but the session was read before this runs; the route
// put the limiter in front of it):
//
//   1. `Content-Length` present, positive, at most 10 MB           411 / 400 / 413
//   2. ONE D1 round trip: the gate, the live counts, the replaced file     409 gate / 404 file_not_found
//   3. the slot and the application have room                       409 slot_full, application_full / 413 application_too_large
//   4. the bucket exists                                            503 storage_unavailable
//   5. the storage counter takes the bytes (one atomic UPDATE)      503 storage_full
//   6. the first 1 MiB is read and sniffed; the slot takes the type 400 body_mismatch / 415 / 422
//   7. the draft is created when this is the first write
//   8. the body is streamed to R2 (FixedLengthStream of the declared length): nothing is stored unless it is exact
//   9. ONE guarded batch: the file row (only if the draft is still editable and the slot and application still have
//      room), the replaced row marked, the draft's version moved
//
// Anything that fails after step 5 gives the reservation back and removes the object. The client's content type and
// file name are never read, stored or logged; the key has no part of a person in it (src/private-files/key.ts).

import { MAX_BYTES_PER_APPLICATION, MAX_FILE_BYTES, MAX_FILES_PER_APPLICATION } from "../../shared/application-form/limits";
import { missingSlots, SLOTS, slotAccepts, type SlotId } from "../../shared/application-form/slots";
import type { Bindings } from "../env";
import { sniff } from "../uploads/sniff";
import { buildKey, isUuid, STORED_TYPES } from "./key";
import { REFUSALS, slotFull, unsupportedType, type Refusal } from "./refusal";
import { keyOfFile, removeObjects } from "./remove";
import { checkRoom, readGate, readWriteState, type ReplacedFile, type WriteState } from "./state";
import { releaseStorage, reserveStorage } from "./storage";
import { md5Of, putStream, readHead } from "./stream";

type Storage = Pick<Bindings, "DB" | "PRIVATE_FILES" | "PRIVATE_FILES_BUDGET_BYTES">;

/** A file as the API shows it (docs/cloudflare/portal-api.md, 5.1 and 11.2): never a key, a checksum or a client file name. */
export interface FileView {
  id: string;
  slot: SlotId;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
  uploadedAt: string;
}

export interface Usage {
  slotCount: number;
  slotMax: number;
  applicationFiles: number;
  applicationBytes: number;
}

export type UploadOutcome =
  | { ok: true; file: FileView; usage: Usage; draft: { id: string; missingFiles: SlotId[] } }
  | { ok: false; refusal: Refusal };

export interface UploadInput {
  userId: string;
  slot: SlotId;
  /** The raw `?replace=` value: absent, or what the client sent (anything that is not a live file of this draft's slot is `file_not_found`). */
  replace: string | undefined;
  /** The `Content-Length` header as received. */
  contentLength: string | null | undefined;
  body: ReadableStream<Uint8Array> | null;
}

const refuse = (refusal: Refusal): UploadOutcome => ({ ok: false, refusal });

/** The declared length of the body, or the refusal (411 no usable header, 400 empty, 413 over 10 MB). */
export function declaredLength(header: string | null | undefined): number | Refusal {
  const text = header?.trim() ?? "";
  if (!/^\d{1,12}$/.test(text)) return REFUSALS.lengthRequired;
  const length = Number(text);
  if (length === 0) return REFUSALS.emptyFile;
  if (length > MAX_FILE_BYTES) return REFUSALS.tooLarge;
  return length;
}

export const INSERT_FILE_SQL = `INSERT INTO application_files (id, application_id, slot, content_type, size, width, height, checksum, created_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
WHERE EXISTS (SELECT 1 FROM application_drafts WHERE id = ?2 AND user_id = ?10 AND batch_id = ?11)
  AND NOT EXISTS (SELECT 1 FROM student_applications WHERE user_id = ?10 AND batch_id = ?11)
  AND EXISTS (SELECT 1 FROM admission_batches WHERE id = ?11 AND opens_at <= ?9 AND closes_at > ?9)
  AND (SELECT COUNT(*) FROM application_files WHERE application_id = ?2 AND slot = ?3 AND deleted_at IS NULL AND id IS NOT ?12) < ?13
  AND (SELECT COUNT(*) FROM application_files WHERE application_id = ?2 AND deleted_at IS NULL AND id IS NOT ?12) < ?14
  AND (SELECT COALESCE(SUM(size), 0) FROM application_files WHERE application_id = ?2 AND deleted_at IS NULL AND id IS NOT ?12) + ?5 <= ?15
  AND (?12 IS NULL OR EXISTS (SELECT 1 FROM application_files WHERE id = ?12 AND application_id = ?2 AND slot = ?3 AND deleted_at IS NULL))`;

/** The replaced file is marked only when the new one is in (the two succeed or fail together: the guard above is not an error, so a batch alone would not roll back). */
export const MARK_REPLACED_SQL =
  "UPDATE application_files SET deleted_at = ?1 WHERE id = ?2 AND application_id = ?3 AND slot = ?4 AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM application_files WHERE id = ?5)";

/** A file write moves the draft's version, so a submit that read the draft a moment ago finds it changed. At least one millisecond later, even in the same millisecond. */
export const TOUCH_DRAFT_SQL = "UPDATE application_drafts SET updated_at = MAX(?1, updated_at + 1) WHERE id = ?2 AND EXISTS (SELECT 1 FROM application_files WHERE id = ?3)";

export const CREATE_DRAFT_SQL = `INSERT INTO application_drafts (id, user_id, batch_id, form_data, created_at, updated_at)
SELECT ?1, ?2, ?3, '{}', ?4, ?4
WHERE NOT EXISTS (SELECT 1 FROM application_drafts WHERE user_id = ?2 AND batch_id = ?3)
  AND NOT EXISTS (SELECT 1 FROM student_applications WHERE user_id = ?2 AND batch_id = ?3)
  AND EXISTS (SELECT 1 FROM admission_batches WHERE id = ?3 AND opens_at <= ?4 AND closes_at > ?4)`;

/** The draft of this student in this batch, whoever created it. */
const READ_DRAFT_SQL = "SELECT id FROM application_drafts WHERE user_id = ?1 AND batch_id = ?2";

export const USAGE_SQL = "SELECT slot, COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM application_files WHERE application_id = ?1 AND deleted_at IS NULL GROUP BY slot";
const DTKS_SQL = "SELECT json_extract(form_data, '$.documents.dtksRegistered') AS dtks FROM application_drafts WHERE id = ?1";

async function removeOrphan(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key).catch(() => console.error("[private-files] could not remove the object of a refused upload"));
}

/** The counts of a draft and whether it says it is a DTKS student, read after a write for the answer. */
export async function usageOf(db: D1Database, draftId: string): Promise<{ present: Record<string, number>; files: number; bytes: number; dtksRegistered: boolean }> {
  const [counts, dtks] = await db.batch<Record<string, unknown>>([db.prepare(USAGE_SQL).bind(draftId), db.prepare(DTKS_SQL).bind(draftId)]);
  const present: Record<string, number> = {};
  let files = 0;
  let bytes = 0;
  for (const row of counts!.results as { slot: string; n: number; bytes: number }[]) {
    present[row.slot] = row.n;
    files += row.n;
    bytes += row.bytes;
  }
  const flag = (dtks!.results[0] as { dtks: unknown } | undefined)?.dtks;
  return { present, files, bytes, dtksRegistered: flag === "ya" };
}

export async function storeFile(env: Storage, input: UploadInput): Promise<UploadOutcome> {
  const now = Date.now();
  const { userId, slot } = input;

  // 1
  const length = declaredLength(input.contentLength);
  if (typeof length !== "number") return refuse(length);

  // 2 and 3
  const replaceId = input.replace !== undefined && isUuid(input.replace) ? input.replace : null;
  const state = await readWriteState(env.DB, userId, now, replaceId);
  if (!state.ok) return refuse(state.refusal);
  // `?replace` must name a live file of THIS draft in THIS slot: a file of another slot is not a replacement of this one.
  const replaced = state.replaced && state.replaced.slot === slot ? state.replaced : null;
  if (input.replace !== undefined && !replaced) return refuse(REFUSALS.fileNotFound);
  const room = checkRoom(slot, state.counts, replaced, length);
  if (room) return refuse(room);

  // 4 and 5
  const bucket: R2Bucket | undefined = env.PRIVATE_FILES;
  if (!bucket) return refuse(REFUSALS.storageUnavailable);
  if (!(await reserveStorage(env, length, now))) return refuse(REFUSALS.storageFull);

  let outcome: UploadOutcome;
  try {
    outcome = await receive(env, bucket, input, state, replaced, length, now);
  } catch (error) {
    // Nothing after the file row is written can throw (see `receive`), so a throw here is an upload that stored nothing.
    await releaseStorage(env, length, now).catch(() => console.error("[private-files] could not give a storage reservation back"));
    throw error;
  }
  if (!outcome.ok) await releaseStorage(env, length, now).catch(() => console.error("[private-files] could not give a storage reservation back"));
  return outcome;
}

/** Steps 6 to 9. Throws on a failure that is not the student's (R2 or D1 down): the caller gives the reservation back. */
async function receive(
  env: Storage,
  bucket: R2Bucket,
  input: UploadInput,
  state: Extract<WriteState, { ok: true }>,
  replaced: ReplacedFile | null,
  length: number,
  now: number,
): Promise<UploadOutcome> {
  const { userId, slot } = input;
  const spec = SLOTS[slot];
  if (!input.body) return refuse(REFUSALS.bodyMismatch);

  // 6
  const head = await readHead(input.body, length);
  if (head.ended && head.bytes < length) return refuse(REFUSALS.bodyMismatch);
  const found = sniff(head.head, length);
  if (!found.ok) {
    await head.reader.cancel().catch(() => undefined);
    switch (found.reason) {
      case "unknown_type":
        return refuse(unsupportedType(spec.types));
      case "dimensions_too_large":
        return refuse(REFUSALS.dimensionsTooLarge);
      case "unreadable_size":
        return refuse(REFUSALS.unreadableSize);
      default:
        return refuse(REFUSALS.invalidFile);
    }
  }
  // GIF is a type of the public uploads; no slot takes one.
  if (found.type === "gif" || !slotAccepts(slot, found.type)) {
    await head.reader.cancel().catch(() => undefined);
    return refuse(unsupportedType(spec.types));
  }
  const type = found.type;

  // 7
  let draftId = state.draftId;
  if (!draftId) {
    const [, read] = await env.DB.batch<{ id: string }>([
      env.DB.prepare(CREATE_DRAFT_SQL).bind(crypto.randomUUID(), userId, state.batch.id, now),
      env.DB.prepare(READ_DRAFT_SQL).bind(userId, state.batch.id),
    ]);
    draftId = read!.results[0]?.id ?? null;
    if (!draftId) {
      // The batch closed, or an application appeared, between the first read and now: say which.
      await head.reader.cancel().catch(() => undefined);
      const gate = await readGate(env.DB, userId, now);
      if (!gate.ok) return refuse(gate.refusal);
      throw new Error("a draft could not be created");
    }
  }

  // 8
  const fileId = crypto.randomUUID();
  const key = buildKey({ year: state.batch.year, applicationId: draftId, fileId, type });
  const contentType = STORED_TYPES[type].contentType;
  const put = await putStream(bucket, key, { httpMetadata: { contentType, cacheControl: "private, no-store" }, onlyIf: { etagDoesNotMatch: "*" } }, head, input.body, length);
  if (!put.ok) {
    if (put.reason === "mismatch") return refuse(REFUSALS.bodyMismatch);
    throw new Error("the private bucket refused an object");
  }
  const checksum = md5Of(put.object);
  if (!checksum) {
    await removeOrphan(bucket, key);
    throw new Error("the private bucket gave no checksum");
  }

  // 9
  const statements = [
    env.DB.prepare(INSERT_FILE_SQL).bind(
      fileId,
      draftId,
      slot,
      contentType,
      length,
      found.width,
      found.height,
      checksum,
      now,
      userId,
      state.batch.id,
      replaced?.id ?? null,
      spec.maxFiles,
      MAX_FILES_PER_APPLICATION,
      MAX_BYTES_PER_APPLICATION,
    ),
  ];
  if (replaced) statements.push(env.DB.prepare(MARK_REPLACED_SQL).bind(now, replaced.id, draftId, slot, fileId));
  statements.push(env.DB.prepare(TOUCH_DRAFT_SQL).bind(now, draftId, fileId));
  let inserted: boolean;
  try {
    const results = await env.DB.batch(statements);
    inserted = (results[0]!.meta.changes ?? 0) === 1;
  } catch (error) {
    await removeOrphan(bucket, key);
    throw error;
  }
  if (!inserted) {
    // The draft vanished (the submit, the batch closing), or the slot or the application filled up meanwhile.
    await removeOrphan(bucket, key);
    const again = await readWriteState(env.DB, userId, Date.now(), replaced?.id ?? null);
    if (!again.ok) return refuse(again.refusal);
    if (replaced && !again.replaced) return refuse(REFUSALS.fileNotFound);
    return refuse(checkRoom(slot, again.counts, again.replaced, length) ?? slotFull(spec.maxFiles));
  }

  // The replaced file's object goes after the row that replaces it is in; a failure leaves its row marked for the daily cleanup.
  if (replaced) {
    const oldKey = keyOfFile(state.batch.year, draftId, replaced);
    if (oldKey) await removeObjects(env, [{ id: replaced.id, size: replaced.size, keys: [oldKey] }], now);
  }

  // From here on nothing may throw: the file is stored and its row is in, so the reservation IS its share of the counter.
  // The answer's usage is read again, for the exact numbers. If that read fails the file is stored all the same: the
  // numbers then come from what was read before (this file added, the replaced one taken out), never a failed upload.
  const usage = await usageOf(env.DB, draftId).catch(() => {
    const present = { ...state.counts.bySlot, [slot]: (state.counts.bySlot[slot] ?? 0) + (replaced ? 0 : 1) };
    return {
      present,
      files: state.counts.files + (replaced ? 0 : 1),
      bytes: state.counts.bytes + length - (replaced ? replaced.size : 0),
      dtksRegistered: false,
    };
  });
  return {
    ok: true,
    file: { id: fileId, slot, contentType, size: length, width: found.width, height: found.height, uploadedAt: new Date(now).toISOString() },
    usage: { slotCount: usage.present[slot] ?? 0, slotMax: spec.maxFiles, applicationFiles: usage.files, applicationBytes: usage.bytes },
    draft: { id: draftId, missingFiles: missingSlots(usage.present, usage.dtksRegistered) },
  };
}
