// Email copy, Indonesian, from the legacy app (lib/email.ts) and its voice
// (docs/context/tone-of-voice.md: "kamu", formal and warm). Every message has an
// HTML and a plain-text body. The subjects and paragraphs of the verification
// and reset emails are the legacy ones; the admin invite, the "account already
// exists" notice and the confirmation of a submitted application are new (the
// legacy app sent none of them).
//
// A `url` here is a live link with a token in it. Templates only place it in
// the body; nothing in this file logs.

import type { EmailMessage } from "./send";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface Shell {
  heading: string;
  paragraph: string;
  ctaLabel: string;
  url: string;
  footer: string;
}

function render({ heading, paragraph, ctaLabel, url, footer }: Shell) {
  const html = `<!doctype html>
<html lang="id"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:32px 16px;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px 40px;">
<p style="margin:0;color:#122E76;font-weight:600;font-size:18px;">Sakola Kembara</p>
<h1 style="margin:16px 0 20px;color:#111827;font-size:24px;font-weight:600;line-height:1.3;">${escapeHtml(heading)}</h1>
<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">${escapeHtml(paragraph)}</p>
<p style="margin:24px 0;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 24px;background:#122E76;color:#ffffff;text-decoration:none;font-weight:600;border-radius:8px;font-size:15px;">${escapeHtml(ctaLabel)}</a></p>
<p style="margin:0 0 24px;color:#6B7280;font-size:13px;line-height:1.6;">Tombol tidak berfungsi? Salin tautan berikut ke browser kamu:<br/><a href="${escapeHtml(url)}" style="color:#122E76;word-break:break-all;">${escapeHtml(url)}</a></p>
<p style="margin:0;color:#9CA3AF;font-size:12px;line-height:1.5;border-top:1px solid #e5e7eb;padding-top:16px;">${escapeHtml(footer)}</p>
</div>
<p style="margin:16px 0 0;text-align:center;color:#9CA3AF;font-size:12px;">© Yayasan Sakola Kembara Indonesia</p>
</body></html>`;
  const text = `${heading}\n\n${paragraph}\n${url}\n\n---\n${footer}\n\n— Yayasan Sakola Kembara Indonesia`;
  return { html, text };
}

export function verificationEmail(to: string, url: string): EmailMessage {
  return {
    to,
    purpose: "verify-email",
    subject: "Verifikasi email Sakola Kembara",
    ...render({
      heading: "Verifikasi email kamu",
      paragraph:
        "Terima kasih sudah mendaftar akun Sakola Kembara. Untuk mengaktifkan akun kamu, silakan verifikasi email dengan mengklik tombol berikut.",
      ctaLabel: "Verifikasi Email",
      url,
      footer: "Tautan ini berlaku selama 24 jam. Jika kamu tidak merasa membuat akun ini, silakan abaikan email ini.",
    }),
  };
}

export function passwordResetEmail(to: string, url: string): EmailMessage {
  return {
    to,
    purpose: "reset-password",
    subject: "Reset password akun Sakola Kembara",
    ...render({
      heading: "Reset password kamu",
      paragraph:
        "Kami menerima permintaan untuk mengatur ulang password akun Sakola Kembara kamu. Klik tombol berikut untuk memilih password baru.",
      ctaLabel: "Reset Password",
      url,
      footer:
        "Tautan ini berlaku selama 30 menit. Jika kamu tidak meminta reset password, silakan abaikan email ini — password kamu tidak akan berubah.",
    }),
  };
}

const ROLE_LABELS: Record<string, string> = {
  viewer: "Viewer (hanya bisa membaca)",
  editor: "Editor",
  super_admin: "Super Admin",
};

/** Lifetime of an admin invite link, in seconds. The email says "7 hari". */
export const ADMIN_INVITE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Sent by a super_admin's "undang admin". `inviterName` is typed by a person
 * (their profile name): it is only ever placed in the body, escaped, never in
 * the subject.
 */
export function adminInviteEmail(to: string, url: string, details: { role: string; inviterName?: string | null }): EmailMessage {
  const inviter = details.inviterName?.trim() ? details.inviterName.trim().slice(0, 120) : "Seorang super admin";
  const role = ROLE_LABELS[details.role] ?? details.role;
  return {
    to,
    purpose: "admin-invite",
    subject: "Undangan admin Sakola Kembara",
    ...render({
      heading: "Kamu diundang menjadi admin",
      paragraph: `${inviter} mengundang kamu menjadi ${role} di dasbor admin Sakola Kembara. Klik tombol berikut untuk membuat password dan mulai masuk.`,
      ctaLabel: "Buat Password",
      url,
      footer:
        "Tautan ini berlaku selama 7 hari dan hanya bisa dipakai sekali. Jika kamu tidak merasa diundang, silakan abaikan email ini.",
    }),
  };
}

/**
 * Sent instead of a second account when someone registers with an address that
 * already has one. The registration form answers the same thing for every
 * address (no account enumeration), so this email is how the owner learns
 * about it. `url` is the sign-in page.
 */
export function accountExistsEmail(to: string, url: string): EmailMessage {
  return {
    to,
    purpose: "account-exists",
    subject: "Kamu sudah punya akun Sakola Kembara",
    ...render({
      heading: "Akun kamu sudah ada",
      paragraph:
        "Seseorang, mungkin kamu, mencoba mendaftar memakai email ini, tetapi akun Sakola Kembara dengan email ini sudah ada. Silakan masuk. Kalau kamu lupa password, pilih Lupa password di halaman masuk.",
      ctaLabel: "Masuk",
      url,
      footer: "Jika bukan kamu yang mencoba mendaftar, abaikan saja email ini. Akun kamu tetap aman.",
    }),
  };
}

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
/** Indonesia's western time zone has no daylight saving: a fixed offset, so no `Intl` is needed (it costs CPU in a Worker). */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** "13 Oktober 2026 pukul 10.40 WIB" for an instant in epoch milliseconds. */
export function formatWib(epochMs: number): string {
  const d = new Date(epochMs + WIB_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} pukul ${pad(d.getUTCHours())}.${pad(d.getUTCMinutes())} WIB`;
}

/**
 * Sent after a student's application is saved (best effort: nothing depends on it, so a failure changes nothing).
 * It says that the application arrived, when, and where the result will appear. It carries NO answer, no file and no
 * document name, and no token: its one link is the status page. `batchName` is the admin's label of the batch, never
 * something the student typed; it is escaped anyway and kept out of the subject.
 */
export function applicationReceivedEmail(to: string, details: { batchName: string; receivedAt: number; url: string }): EmailMessage {
  return {
    to,
    purpose: "application-received",
    subject: "Pendaftaran Sakola Kembara kamu sudah kami terima",
    ...render({
      heading: "Pendaftaran kamu sudah kami terima",
      paragraph: `Pendaftaran kamu untuk ${details.batchName} sudah kami terima pada ${formatWib(details.receivedAt)}. Kami akan mengabari hasilnya di halaman Status Pendaftaran setelah panitia selesai memutuskan seluruh pendaftar batch ini. Kamu tidak perlu mengirim ulang berkas.`,
      ctaLabel: "Buka Status Pendaftaran",
      url: details.url,
      footer: "Kamu menerima email ini karena baru saja mengirim pendaftaran di Portal Siswa Sakola Kembara. Hasil seleksi tidak dikirim lewat email: kamu bisa melihatnya di halaman Status Pendaftaran setelah diumumkan.",
    }),
  };
}
