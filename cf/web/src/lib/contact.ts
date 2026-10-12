// The /kontak form: its fields, its rules and its words. Pure; the I/O (rate limit,
// the call to the API) is in contact-submit.ts.
//
// The rules and the Indonesian messages are the legacy form's, word for word
// (app/(public)/kontak/actions.ts, which holds a zod schema). They are written out
// here instead of importing zod so the Worker carries no validation library;
// tests/contact.test.ts runs the same inputs through the real zod schema and checks the
// answers are identical, which is what keeps the two from drifting.

export const CONTACT_SUBJECTS = ['partnership', 'donation', 'other'] as const;
export type ContactSubject = (typeof CONTACT_SUBJECTS)[number];

/** The subject select: values and labels as the legacy form has them. */
export const CONTACT_SUBJECT_OPTIONS: { value: ContactSubject; label: string }[] = [
  { value: 'partnership', label: 'Kerjasama/Partnership' },
  { value: 'donation', label: 'Seputar Donasi' },
  { value: 'other', label: 'Lainnya' },
];

/** What a visitor sees after a submission. The first four are the legacy messages, verbatim. */
export const CONTACT_MESSAGES = {
  rateLimited: 'Terlalu banyak percobaan pengiriman. Silakan tunggu satu menit lalu coba lagi.',
  invalid: 'Silakan periksa kembali isian formulir.',
  duplicate: 'Pesan dari email ini baru saja dikirim. Mohon tunggu beberapa menit sebelum mengirim ulang.',
  success: 'Pesan kamu sudah kami terima. Tim kami akan menghubungi via email.',
  // New copy, no legacy counterpart (the old form threw an error page when the database was down).
  unavailable: 'Pesan belum dapat dikirim saat ini. Silakan coba lagi beberapa saat lagi.',
} as const;

/** Messages of the field rules, verbatim from the legacy schema. */
export const FIELD_MESSAGES = {
  fullNameMin: 'Nama lengkap minimal 2 karakter',
  fullNameMax: 'Maksimal 120 karakter',
  emailFormat: 'Format email belum benar',
  // The legacy schema has `.max(254)` with no message, so zod would show its English default
  // ("String must contain at most 254 character(s)"). The one deliberate difference: same
  // wording as the other length messages. Only a 255-character address can reach it.
  emailMax: 'Maksimal 254 karakter',
  subject: 'Pilih salah satu subjek',
  messageMin: 'Tulis minimal 10 karakter',
  messageMax: 'Maksimal 5000 karakter',
} as const;

// SAKEM-055 decides the real contact details. The legacy page shows these three, and the
// WhatsApp number in particular looks like a placeholder; they are ported as they are, and
// they differ from the footer's (contact@sakolakembara.org). Do not "fix" them here.
export const contactInfo = [
  { title: 'Email', value: 'hello@sakolakembara.org' },
  { title: 'WhatsApp', value: '+62 812 3456 7890' },
  { title: 'Lokasi', value: 'Bandung, Jawa Barat, Indonesia' },
];

export type ContactField = 'fullName' | 'email' | 'subject' | 'message';
export type ContactFieldErrors = Partial<Record<ContactField, string[]>>;

/** What the form posts. The honeypot is `website`: humans never see it. */
export interface ContactInput {
  fullName: string;
  email: string;
  subject: ContactSubject;
  message: string;
}

/** The text a visitor typed, to put back in the form after an error (the subject may be empty). */
export interface ContactValues {
  fullName: string;
  email: string;
  subject: string;
  message: string;
}

export type ContactParse =
  | { kind: 'ok'; data: ContactInput }
  | { kind: 'honeypot' }
  | { kind: 'invalid'; fieldErrors: ContactFieldErrors; values: ContactValues };

// zod 3's `.email()` pattern (3.25.x), so the two accept the same addresses.
const EMAIL = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i;

/** A form value as text: anything that is not a string (an absent field, a file) counts as empty. */
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** What the visitor typed, untrimmed, to put back in the form: their own typing is not rewritten. */
export function contactValues(raw: Record<string, unknown>): ContactValues {
  return { fullName: text(raw.fullName), email: text(raw.email), subject: text(raw.subject), message: text(raw.message) };
}

/**
 * Validate what the form posted, with the legacy rules: values are trimmed, the email is
 * lower-cased, a non-empty honeypot is dropped silently (the caller answers as if it was sent),
 * and the first message of a field is the one shown.
 */
export function parseContactForm(raw: Record<string, unknown>): ContactParse {
  const website = raw.website;
  if (typeof website === 'string' ? website.length > 0 : website !== undefined && website !== null) {
    return { kind: 'honeypot' };
  }

  const fullName = text(raw.fullName).trim();
  const email = text(raw.email).trim().toLowerCase();
  const subject = text(raw.subject);
  const message = text(raw.message).trim();

  const fieldErrors: ContactFieldErrors = {};
  const fail = (field: ContactField, ...messages: string[]) => {
    fieldErrors[field] = [...(fieldErrors[field] ?? []), ...messages];
  };

  if (fullName.length < 2) fail('fullName', FIELD_MESSAGES.fullNameMin);
  if (fullName.length > 120) fail('fullName', FIELD_MESSAGES.fullNameMax);
  if (!EMAIL.test(email)) fail('email', FIELD_MESSAGES.emailFormat);
  if (email.length > 254) fail('email', FIELD_MESSAGES.emailMax);
  if (!(CONTACT_SUBJECTS as readonly string[]).includes(subject)) fail('subject', FIELD_MESSAGES.subject);
  if (message.length < 10) fail('message', FIELD_MESSAGES.messageMin);
  if (message.length > 5000) fail('message', FIELD_MESSAGES.messageMax);

  if (Object.keys(fieldErrors).length > 0) {
    return { kind: 'invalid', fieldErrors, values: contactValues(raw) };
  }
  return { kind: 'ok', data: { fullName, email, subject: subject as ContactSubject, message } };
}
