// The rules of a donation confirmation (SAKEM-128, docs/cloudflare/donations.md): what step 1 of the /donasi form may
// send, normalised, and the Indonesian words for every refusal. Pure: no D1, no R2, no clock beyond what is passed in.
// The site's Worker validates nothing of its own; it sends what the visitor typed and shows the field messages this
// returns, so there is exactly one place where the rules live.

import { donationKind, donationSource, type DonationKind, type DonationSource } from "../db/schema/donations";

export const DONATION_MESSAGES = {
  invalid: "Silakan periksa kembali isian formulir.",
  rateLimited: "Terlalu banyak percobaan. Silakan tunggu satu menit lalu coba lagi.",
  botCheckFailed: "Verifikasi gagal. Silakan coba lagi.",
  notFound: "Data donasi tidak ditemukan. Silakan isi formulir dari awal.",
  locked: "Donasi ini sudah kami cek, jadi tidak dapat diubah lagi. Hubungi kami bila ada yang perlu diperbaiki.",
  proofLocked: "Bukti transfer sudah terunggah untuk donasi sekali ini. Untuk donasi bulanan, isi formulir baru.",
  monthlyNoProof: "Donasi bulanan tidak memerlukan bukti transfer.",
} as const;

export const FIELD_MESSAGES = {
  kind: "Pilih donasi sekali atau bulanan.",
  name: "Nama wajib diisi.",
  nameMax: "Maksimal 120 karakter.",
  whatsapp: "Nomor WhatsApp belum lengkap. Contoh: 0812 3456 7890.",
  amount: "Pilih atau isi nominal donasi.",
  amountMin: "Nominal minimal Rp1.000.",
  amountMax: "Nominal terlalu besar. Hubungi kami untuk donasi di atas Rp1.000.000.000.",
  startMonth: "Pilih bulan mulai berdonasi.",
  remindDay: "Pilih tanggal pengingat (1 sampai 31).",
  source: "Pilih salah satu.",
} as const;

export const MIN_AMOUNT = 1_000;
export const MAX_AMOUNT = 1_000_000_000;
export const MAX_NAME_LENGTH = 120;

export interface DonationInput {
  kind: DonationKind;
  name: string;
  /** Digits, starting with 62. */
  whatsapp: string;
  amount: number;
  startMonth: string | null;
  remindDay: number | null;
}

export type DonationField = "kind" | "name" | "whatsapp" | "amount" | "startMonth" | "remindDay";
export type DonationFieldErrors = Partial<Record<DonationField, string>>;

export type DonationParse = { ok: true; data: DonationInput } | { ok: false; fieldErrors: DonationFieldErrors };

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * A WhatsApp number as typed ("0812-3456 7890", "+62 812...", "62812...", "812...") as digits starting with 62, or
 * null. Indonesian mobile numbers only: 62 then 8, then 8 to 12 more digits (10 to 15 in all).
 */
export function normaliseWhatsapp(raw: unknown): string | null {
  const digits = text(raw).replace(/[\s().-]/g, "").replace(/^\+/, "");
  if (!/^[0-9]+$/.test(digits)) return null;
  const national = digits.startsWith("62") ? digits.slice(2) : digits.startsWith("0") ? digits.slice(1) : digits;
  const full = `62${national}`;
  return /^628[0-9]{7,12}$/.test(full) ? full : null;
}

/**
 * Rupiah as a whole number from 150000, "150000", "Rp150.000", "150.000" or "150 000"; null for anything else. A dot is
 * the thousands separator, so it must sit before groups of exactly three digits ("12.5" is not 125).
 */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isSafeInteger(raw) ? raw : null;
  const trimmed = text(raw).trim().replace(/^rp\.?\s*/i, "");
  if (!/^[0-9]{1,13}$|^[0-9]{1,3}([. ][0-9]{3})+$/.test(trimmed)) return null;
  const cleaned = trimmed.replace(/[. ]/g, "");
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}

/** "YYYY-MM" for a real month between 2015 and 2100 (an existing donor may have started years ago). */
export function parseMonth(raw: unknown): string | null {
  const value = text(raw).trim();
  const match = /^([0-9]{4})-([0-9]{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 2015 && year <= 2100 && month >= 1 && month <= 12 ? value : null;
}

export function parseDay(raw: unknown): number | null {
  const value = typeof raw === "number" ? raw : /^[0-9]{1,2}$/.test(text(raw).trim()) ? Number(text(raw).trim()) : NaN;
  return Number.isInteger(value) && value >= 1 && value <= 31 ? value : null;
}

/** Step 1 of the form, as the site's Worker sends it (JSON). Every field is checked; all messages come back at once. */
export function parseDonationInput(raw: unknown): DonationParse {
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const fieldErrors: DonationFieldErrors = {};

  const kind = (donationKind as readonly string[]).includes(text(body.kind)) ? (text(body.kind) as DonationKind) : null;
  if (!kind) fieldErrors.kind = FIELD_MESSAGES.kind;

  const name = text(body.name).trim().replace(/\s+/g, " ");
  if (name.length === 0) fieldErrors.name = FIELD_MESSAGES.name;
  else if (name.length > MAX_NAME_LENGTH) fieldErrors.name = FIELD_MESSAGES.nameMax;

  const whatsapp = normaliseWhatsapp(body.whatsapp);
  if (!whatsapp) fieldErrors.whatsapp = FIELD_MESSAGES.whatsapp;

  const amount = parseAmount(body.amount);
  if (amount === null || amount === 0) fieldErrors.amount = FIELD_MESSAGES.amount;
  else if (amount < MIN_AMOUNT) fieldErrors.amount = FIELD_MESSAGES.amountMin;
  else if (amount > MAX_AMOUNT) fieldErrors.amount = FIELD_MESSAGES.amountMax;

  let startMonth: string | null = null;
  let remindDay: number | null = null;
  if (kind === "monthly") {
    startMonth = parseMonth(body.startMonth);
    if (!startMonth) fieldErrors.startMonth = FIELD_MESSAGES.startMonth;
    remindDay = parseDay(body.remindDay);
    if (remindDay === null) fieldErrors.remindDay = FIELD_MESSAGES.remindDay;
  }

  if (Object.keys(fieldErrors).length > 0 || !kind || !whatsapp || amount === null) return { ok: false, fieldErrors };
  return { ok: true, data: { kind, name, whatsapp, amount, startMonth, remindDay } };
}

export function parseSource(raw: unknown): DonationSource | null {
  const value = text(raw);
  return (donationSource as readonly string[]).includes(value) ? (value as DonationSource) : null;
}
