// The sixteen file slots of an application: the documents and marketing proofs that the legacy wizard asked as pasted
// links (`*Url` fields) and the new portal takes as uploads. The authoritative table is
// docs/cloudflare/portal-api.md, section 11.1; this file is written from it. No dependency, no framework: the Worker,
// the portal SPA's file field and the admin's Pendaftar detail all import it (the admin SPA imports only this file and
// `limits.ts`, so no zod reaches the admin bundle).
//
// A slot id appears in a URL (`PUT /portal/api/applications/current/files/:slot`), in the `application_files.slot`
// CHECK (migration 0012) and on the admin screen. Adding or renaming one is a migration (SQLite cannot alter a CHECK),
// so the list is fixed here and changed on purpose.

/** What a slot can hold. The type is sniffed from the bytes (src/uploads/sniff.ts), never read from the client. */
export type SlotFileType = "png" | "jpeg" | "webp" | "pdf";

export const IMAGE_FILE_TYPES = ["png", "jpeg", "webp"] as const satisfies readonly SlotFileType[];
export const ALL_FILE_TYPES = ["png", "jpeg", "webp", "pdf"] as const satisfies readonly SlotFileType[];

export type SlotStep = "documents" | "marketing";

export interface SlotDefinition {
  id: SlotId;
  /** The label of the legacy wizard (docs/cloudflare/portal-api.md, 11.1). Shown to the student and to the admin. */
  label: string;
  /** The bucket the slot belongs to: its files are required by that step's part of the submit check. */
  step: SlotStep;
  /** `true` = required, `false` = optional, `"dtks"` = required only when `documents.dtksRegistered` is "ya". */
  required: boolean | "dtks";
  /** Live files the slot holds at most. */
  maxFiles: number;
  /** Accepted types, by the bytes. */
  types: readonly SlotFileType[];
}

/** In the order of the table: the twelve of the documents step, then the four of the marketing step. */
export const SLOT_IDS = [
  "father-income",
  "mother-income",
  "other-earner-1-income",
  "other-earner-2-income",
  "debt-proof",
  "electricity-bill",
  "family-card",
  "parent-permission",
  "self-photo",
  "dtks",
  "house-photos",
  "vehicle-photos",
  "marketing-follow-proof",
  "marketing-broadcast-proof",
  "marketing-twibbon-proof",
  "marketing-story-proof",
] as const;

export type SlotId = (typeof SLOT_IDS)[number];

const slot = (
  id: SlotId,
  label: string,
  step: SlotStep,
  required: boolean | "dtks",
  maxFiles: number,
  types: readonly SlotFileType[] = ALL_FILE_TYPES,
): SlotDefinition => ({ id, label, step, required, maxFiles, types });

export const SLOTS: Record<SlotId, SlotDefinition> = {
  "father-income": slot("father-income", "Surat Keterangan Penghasilan Ayah", "documents", false, 1),
  "mother-income": slot("mother-income", "Surat Keterangan Penghasilan Ibu", "documents", false, 1),
  "other-earner-1-income": slot("other-earner-1-income", "Surat Penghasilan Anggota Keluarga Lain (1)", "documents", false, 1),
  "other-earner-2-income": slot("other-earner-2-income", "Surat Penghasilan Anggota Keluarga Lain (2)", "documents", false, 1),
  "debt-proof": slot("debt-proof", "Bukti Hutang", "documents", false, 3),
  "electricity-bill": slot("electricity-bill", "Tagihan/Token Listrik 3 Bulan Terakhir", "documents", true, 3),
  "family-card": slot("family-card", "Scan Kartu Keluarga", "documents", true, 2),
  "parent-permission": slot("parent-permission", "Surat Izin Orang Tua (bermaterai)", "documents", true, 2),
  "self-photo": slot("self-photo", "Foto Diri", "documents", true, 1, IMAGE_FILE_TYPES),
  dtks: slot("dtks", "Surat Keterangan Tidak Mampu (SKTM) terdaftar DTKS", "documents", "dtks", 1),
  "house-photos": slot("house-photos", "Foto Rumah: depan, ruang tamu, kamar mandi", "documents", true, 6),
  "vehicle-photos": slot("vehicle-photos", "Foto Kendaraan yang ada di rumah", "documents", true, 6),
  "marketing-follow-proof": slot("marketing-follow-proof", "Bukti Follow Instagram @sakolakembara", "marketing", true, 1),
  "marketing-broadcast-proof": slot("marketing-broadcast-proof", "Bukti Share Poster + Broadcast ke 3 Grup WhatsApp", "marketing", true, 4),
  "marketing-twibbon-proof": slot("marketing-twibbon-proof", "Bukti Upload Twibbon di Feed Instagram", "marketing", true, 1),
  "marketing-story-proof": slot("marketing-story-proof", "Bukti Share Poster di Story Instagram", "marketing", true, 1),
};

export function isSlotId(value: unknown): value is SlotId {
  return typeof value === "string" && (SLOT_IDS as readonly string[]).includes(value);
}

export function slotLabel(id: SlotId): string {
  return SLOTS[id].label;
}

/** The slots of one step, in table order. */
export function slotsOfStep(step: SlotStep): SlotId[] {
  return SLOT_IDS.filter((id) => SLOTS[id].step === step);
}

/** Does the slot take this (sniffed) type? */
export function slotAccepts(id: SlotId, type: SlotFileType): boolean {
  return SLOTS[id].types.includes(type);
}

/** The slots that must hold at least one file: ten, and `dtks` as the eleventh when the student is registered in DTKS. */
export function requiredSlots(dtksRegistered: boolean): SlotId[] {
  return SLOT_IDS.filter((id) => {
    const required = SLOTS[id].required;
    return required === "dtks" ? dtksRegistered : required;
  });
}

/**
 * The required slots with no file yet, in table order. `present` is how many live files each slot holds (a slot that
 * is absent or counts 0 has none). A key that is not a slot is ignored.
 */
export function missingSlots(present: Readonly<Record<string, number>>, dtksRegistered: boolean): SlotId[] {
  return requiredSlots(dtksRegistered).filter((id) => !((present[id] ?? 0) >= 1));
}

/** Same as `missingSlots`, for one step only (the submit checks `documents` and `marketing` at different points). */
export function missingSlotsOfStep(step: SlotStep, present: Readonly<Record<string, number>>, dtksRegistered: boolean): SlotId[] {
  return missingSlots(present, dtksRegistered).filter((id) => SLOTS[id].step === step);
}

/** The 422 message of a submit with files missing (docs/cloudflare/portal-api.md, 9.1, check 5b). */
export function missingFilesMessage(ids: readonly SlotId[]): string {
  return `Berkas wajib belum lengkap: ${ids.map(slotLabel).join(", ")}.`;
}

/** The legacy message for a DTKS student without the SKTM (docs/cloudflare/portal-api.md, 7.6). */
export const DTKS_FILE_REQUIRED_MESSAGE = "Wajib diisi karena kamu terdaftar DTKS. Unggah SKTM DTKS-mu.";
