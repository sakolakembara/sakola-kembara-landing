// What the file routes refuse with: one code, one status, one Indonesian line ready to show (the legacy voice,
// "kamu"; docs/cloudflare/portal-api.md, 11.2, 11.3 and 13). The routes turn a `Refusal` into the CRUD kit's error
// shape `{ error, message?, ...extra }`. Nothing here carries a file name, an id of someone else's row or a value the
// client sent.

import { MAX_FILE_BYTES } from "../../shared/application-form/limits";
import { FILE_TYPES, MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE, type FileType } from "../uploads/sniff";

export type RefusalStatus = 400 | 404 | 405 | 409 | 411 | 413 | 415 | 422 | 503;

export interface Refusal {
  status: RefusalStatus;
  error: string;
  message?: string;
  /** Extra fields of the body (`maxBytes`, `max`, `allowed`). */
  extra?: Record<string, unknown>;
}

const refusal = (status: RefusalStatus, error: string, message?: string, extra?: Record<string, unknown>): Refusal => ({
  status,
  error,
  ...(message ? { message } : {}),
  ...(extra ? { extra } : {}),
});

const dotted = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const typeName = (type: FileType) => (type === "jpeg" ? "JPEG" : type === "webp" ? "WebP" : type.toUpperCase());

export const REFUSALS = {
  notFound: refusal(404, "not_found"),
  unknownSlot: refusal(404, "unknown_slot"),
  fileNotFound: refusal(404, "file_not_found"),
  methodNotAllowed: refusal(405, "method_not_allowed"),
  lengthRequired: refusal(411, "length_required", "Ukuran file tidak diketahui. Coba unggah lagi."),
  emptyFile: refusal(400, "empty_file", "File kosong."),
  tooLarge: refusal(413, "too_large", "Ukuran file maksimal 10 MB.", { maxBytes: MAX_FILE_BYTES }),
  applicationFull: refusal(409, "application_full", "Jumlah berkas sudah mencapai batas."),
  applicationTooLarge: refusal(413, "application_too_large", "Total ukuran berkas sudah mencapai batas."),
  storageFull: refusal(503, "storage_full", "Penyimpanan berkas sedang penuh. Hubungi panitia lewat WhatsApp."),
  /** The bucket binding is missing: the only thing this code means now that no key is involved. */
  storageUnavailable: refusal(503, "storage_unavailable", "Penyimpanan berkas sedang tidak tersedia. Coba lagi nanti."),
  invalidFile: refusal(422, "invalid_file", "File rusak atau tidak bisa dibaca. Coba simpan ulang lalu unggah lagi."),
  unreadableSize: refusal(422, "unreadable_size", "Ukuran gambar tidak terbaca. Simpan ulang gambar tanpa metadata yang besar."),
  dimensionsTooLarge: refusal(
    422,
    "dimensions_too_large",
    `Dimensi gambar terlalu besar (maksimal ${dotted(MAX_IMAGE_SIDE)} piksel per sisi dan ${MAX_IMAGE_PIXELS / 1_000_000} megapiksel).`,
    { maxSide: MAX_IMAGE_SIDE, maxPixels: MAX_IMAGE_PIXELS },
  ),
  bodyMismatch: refusal(400, "body_mismatch", "Unggahan terputus. Coba lagi."),
  /** The admin's open: the audit row could not be written, so nothing is served (accountability before convenience). */
  auditUnavailable: refusal(503, "audit_unavailable", "Berkas belum bisa dibuka. Coba lagi."),
} as const satisfies Record<string, Refusal>;

export const slotFull = (max: number): Refusal => refusal(409, "slot_full", "Slot ini sudah penuh. Hapus satu berkas dulu atau ganti berkas yang ada.", { max });

/** 415: not one of the types of this slot. `allowed` lists the slot's content types, as the admin upload does. */
export function unsupportedType(types: readonly Exclude<FileType, "gif">[]): Refusal {
  return refusal(415, "unsupported_type", `Tipe file tidak didukung. Gunakan: ${types.map(typeName).join(", ")}.`, {
    allowed: types.map((type) => FILE_TYPES[type].contentType),
  });
}
