import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, enumCheck, timestampMs, updatedAt, uuidPk } from "./_common";

// Donation confirmations from the site's /donasi form (SAKEM-128): the Google Form "Form Donasi Sakola Kembara" moved
// into the site. Personal data of a donor (name, WhatsApp, amount, a transfer receipt): only the super admin's Donasi
// menu (area `sistem`) reads it; the audit trail records ids and statuses, never a name or a number.
//
// The life of a row:
//   awaiting_transfer  step 1 of a one-off donation was sent ("Lanjut ke Pembayaran"); no receipt yet
//   new                a one-off donation with its receipt, or a monthly pledge (which has no receipt)
//   checked            an admin matched it with the bank statement

export const donationKind = ["once", "monthly"] as const;
export type DonationKind = (typeof donationKind)[number];

export const donationStatus = ["awaiting_transfer", "new", "checked"] as const;
export type DonationStatus = (typeof donationStatus)[number];

export const donationSource = ["instagram", "twitter", "whatsapp", "friend", "website", "other"] as const;
export type DonationSource = (typeof donationSource)[number];

export const donationProofType = ["image/png", "image/jpeg", "image/webp", "application/pdf"] as const;

/** The largest receipt, the same cap as an applicant's file. */
export const DONATION_PROOF_MAX_BYTES = 10_000_000;

export const donations = sqliteTable(
  "donations",
  {
    id: uuidPk(),
    kind: text("kind", { enum: donationKind }).notNull(),
    /** "Nama atau inisial" (one-off) or "Nama lengkap" (monthly), as typed, trimmed. */
    name: text("name").notNull(),
    /** Digits only, starting with 62 (normalised from 08..., +62..., 62...). */
    whatsapp: text("whatsapp").notNull(),
    /** Rupiah: the one-off amount, or the monthly amount. */
    amount: integer("amount").notNull(),
    /** Monthly only: "YYYY-MM", the month of the first donation (may be in the past for an existing donor). */
    startMonth: text("start_month"),
    /** Monthly only: the day of the month to send the reminder on, 1 to 31. */
    remindDay: integer("remind_day"),
    /** The optional answer on the thank-you page. */
    source: text("source", { enum: donationSource }),
    status: text("status", { enum: donationStatus }).notNull(),
    /** Internal note, written in the admin. */
    note: text("note"),
    /** SHA-256 (hex) of the random token the donor's browser holds in a cookie: what lets it add the receipt and the source. */
    tokenHash: text("token_hash").notNull(),
    /** The receipt in the private bucket (key `donations/<id>/<file id>.<ext>`), its type found in the bytes, its size. */
    proofKey: text("proof_key"),
    proofType: text("proof_type", { enum: donationProofType }),
    proofSize: integer("proof_size"),
    proofAt: timestampMs("proof_at"),
    checkedAt: timestampMs("checked_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("donations_created_at_idx").on(t.createdAt),
    index("donations_status_idx").on(t.status),
    enumCheck("donations_kind_check", t.kind, donationKind),
    enumCheck("donations_status_check", t.status, donationStatus),
    check("donations_source_check", sql`${t.source} is null or ${t.source} in ('instagram', 'twitter', 'whatsapp', 'friend', 'website', 'other')`),
    check("donations_name_check", sql`length(${t.name}) between 1 and 120`),
    check("donations_whatsapp_check", sql`${t.whatsapp} glob '62[0-9]*' and length(${t.whatsapp}) between 10 and 15`),
    check("donations_amount_check", sql`${t.amount} > 0 and ${t.amount} <= 1000000000`),
    check("donations_note_check", sql`${t.note} is null or length(${t.note}) <= 2000`),
    check("donations_token_hash_check", sql`length(${t.tokenHash}) = 64 and ${t.tokenHash} not glob '*[^0-9a-f]*'`),
    check(
      "donations_kind_fields_check",
      sql`(${t.kind} = 'once' and ${t.startMonth} is null and ${t.remindDay} is null)
        or (${t.kind} = 'monthly' and ${t.startMonth} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]' and ${t.remindDay} between 1 and 31
            and ${t.proofKey} is null and ${t.status} != 'awaiting_transfer')`,
    ),
    check(
      "donations_proof_check",
      sql`(${t.proofKey} is null and ${t.proofType} is null and ${t.proofSize} is null and ${t.proofAt} is null)
        or (${t.proofKey} is not null and ${t.proofType} in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')
            and ${t.proofSize} > 0 and ${t.proofSize} <= 10000000 and ${t.proofAt} is not null)`,
    ),
  ],
);
