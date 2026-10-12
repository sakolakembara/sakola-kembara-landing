import { z } from "zod";
import { contactSubject } from "../db/schema";

// The contact form's rules and write, ported from the legacy
// app/(public)/kontak/actions.ts (and lib/contact.ts of the reference branch).
// Field limits and the Indonesian messages are the on-site form's, word for
// word: the form shows them. See docs/cloudflare/content-api.md, "POST contact".

/** 5 submissions per minute per visitor address: enough for a legitimate user fixing typos, tight enough to blunt scripted spam. */
export const CONTACT_RATE_LIMIT = { limit: 5, windowSeconds: 60 } as const;

/** One message per email per 5 minutes. */
export const CONTACT_DUPLICATE_WINDOW_SECONDS = 5 * 60;

/** The request body is limited to 32 KiB: generous for 5000 characters of 4-byte characters plus the other fields. */
export const CONTACT_MAX_BODY_BYTES = 32 * 1024;

export const CONTACT_MESSAGES = {
  rateLimited: "Terlalu banyak percobaan pengiriman. Silakan tunggu satu menit lalu coba lagi.",
  invalid: "Silakan periksa kembali isian formulir.",
  duplicate: "Pesan dari email ini baru saja dikirim. Mohon tunggu beberapa menit sebelum mengirim ulang.",
  success: "Pesan kamu sudah kami terima. Tim kami akan menghubungi via email.",
  // Not part of the legacy form or the contract: only used when a Turnstile verifier is wired in (docs/cloudflare/public-api.md).
  botCheckFailed: "Verifikasi keamanan gagal. Muat ulang halaman lalu coba lagi.",
} as const;

// A JSON body can omit a field or send another type, which a browser form
// never does. Treat anything that is not a string as an empty one, so the
// visitor sees the rule's own Indonesian message instead of a library default.
const asText = (value: unknown): unknown => (typeof value === "string" ? value : "");

export const contactSchema = z.object({
  fullName: z.preprocess(asText, z.string().trim().min(2, "Nama lengkap minimal 2 karakter").max(120, "Maksimal 120 karakter")),
  email: z.preprocess(asText, z.string().trim().toLowerCase().email("Format email belum benar").max(254, "Maksimal 254 karakter")),
  subject: z.preprocess(asText, z.enum(contactSubject, { error: "Pilih salah satu subjek" })),
  message: z.preprocess(asText, z.string().trim().min(10, "Tulis minimal 10 karakter").max(5000, "Maksimal 5000 karakter")),
  /** Honeypot: bots fill it, humans never see it. Omitted, null or "" is fine; anything else is a hit. */
  website: z.preprocess((value) => value ?? "", z.string().max(0, "spam")),
});

export type ContactInput = z.infer<typeof contactSchema>;
export type ContactFieldErrors = Partial<Record<"fullName" | "email" | "subject" | "message", string[]>>;

export type ContactParseResult =
  | { kind: "ok"; data: Omit<ContactInput, "website"> }
  | { kind: "honeypot" }
  | { kind: "invalid"; fieldErrors: ContactFieldErrors };

export function parseContactInput(raw: unknown): ContactParseResult {
  // A body that is JSON but not an object (an array, a number) is reported field by field, like an empty form.
  const input = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};
  const parsed = contactSchema.safeParse(input);
  if (parsed.success) {
    const { website: _honeypot, ...data } = parsed.data;
    return { kind: "ok", data };
  }
  const { website, ...fieldErrors } = z.flattenError(parsed.error).fieldErrors as Record<string, string[] | undefined>;
  // A honeypot hit is dropped silently, whatever else is wrong: never tell the bot why.
  if (website) return { kind: "honeypot" };
  return { kind: "invalid", fieldErrors: fieldErrors as ContactFieldErrors };
}

export type SaveResult = "saved" | "duplicate";

/** The message insert, with the duplicate check inside it. Exported so the query plan test runs exactly this text. */
export const INSERT_MESSAGE_SQL = `INSERT INTO contact_messages (id, full_name, email, subject, message)
SELECT ?, ?, ?, ?, ?
WHERE NOT EXISTS (SELECT 1 FROM contact_messages WHERE email = ? AND created_at >= ?)`;

/** The audit row, written only when the message above was inserted. */
export const INSERT_AUDIT_SQL = `INSERT INTO audit_log (id, actor_id, actor_email, action, resource_type, resource_id, metadata)
SELECT ?, NULL, ?, 'contact_message.submit', 'contact_message', ?, ?
WHERE EXISTS (SELECT 1 FROM contact_messages WHERE id = ?)`;

/**
 * Stores a validated message and its audit row, or reports that the same email
 * already wrote within the last 5 minutes (nothing is written then).
 *
 * One D1 batch of two statements, which D1 runs as one transaction and one
 * round trip. The duplicate check is part of the insert itself
 * (`INSERT ... SELECT ... WHERE NOT EXISTS`), so two simultaneous submissions
 * with the same email cannot both pass it, unlike the legacy read-then-write.
 * The audit row follows the message only if the message was inserted, and
 * carries the sender's email as actor and the subject, never the text
 * (audit_log.metadata, d1-schema.md).
 */
export async function saveContactMessage(
  d1: D1Database,
  data: Omit<ContactInput, "website">,
  now: number = Date.now(),
): Promise<SaveResult> {
  const id = crypto.randomUUID();
  const since = now - CONTACT_DUPLICATE_WINDOW_SECONDS * 1000;
  const [inserted] = await d1.batch([
    d1.prepare(INSERT_MESSAGE_SQL).bind(id, data.fullName, data.email, data.subject, data.message, data.email, since),
    d1.prepare(INSERT_AUDIT_SQL).bind(crypto.randomUUID(), data.email, id, JSON.stringify({ subject: data.subject }), id),
  ]);
  return inserted && inserted.meta.changes > 0 ? "saved" : "duplicate";
}

/**
 * An IPv4 or IPv6 literal, nothing else: no list ("a, b"), no port, no zone,
 * no host name. The visitor address is only believed from an authenticated
 * caller (the service binding), but a malformed one still must not become a
 * rate-limit bucket name.
 */
export function isIpLiteral(value: string): boolean {
  if (value.length === 0 || value.length > 45) return false;
  if (value.includes(":")) {
    if (!/^[0-9a-fA-F:.]+$/.test(value)) return false;
    try {
      // The URL parser validates a bracketed IPv6 literal, including "::" and an embedded IPv4 tail.
      new URL(`http://[${value}]/`);
      return true;
    } catch {
      return false;
    }
  }
  return /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(value);
}
