import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";

// Transactional email surface. All outbound mail from landing goes
// through here so we have one place to swap vendors, add sourcemap
// tagging, throttle, or wire deliverability metrics later.
//
// Vendor: Resend. Free tier is 3k emails / month, more than the org
// needs at MVP scale. When RESEND_API_KEY is unset (dev / staging that
// hasn't been wired), the helpers log outbound messages to stdout
// instead of hitting the vendor — lets local sign-up flows exercise the
// email path without spam.

const resendClient = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

/** Base URL for links inside email templates. Falls back to NEXTAUTH_URL. */
function appOrigin(): string {
  return env.APP_URL ?? env.NEXTAUTH_URL;
}

export interface SendResult {
  ok: boolean;
  /** Vendor message id when the mail was actually sent. */
  id?: string;
  /** Debug-only reason a send was skipped or failed. Never surface to users. */
  reason?: string;
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Short tag for logs / audit — never sent to the vendor. */
  purpose: "verify-email" | "reset-password" | "generic";
}

async function send({ to, subject, html, text, purpose }: SendArgs): Promise<SendResult> {
  if (!resendClient) {
    // Dev fallback — print the mail to stdout so a developer can copy
    // any verification link out of the logs without setting up Resend.
    console.log("═══ [email:dev-fallback] ═══");
    console.log("To:      ", to);
    console.log("From:    ", env.EMAIL_FROM);
    console.log("Subject: ", subject);
    console.log("Purpose: ", purpose);
    console.log("Text:\n", text);
    console.log("════════════════════════════");
    return { ok: true, reason: "logged_to_console" };
  }
  const res = await resendClient.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
    tags: [{ name: "purpose", value: purpose }],
  });
  if (res.error) {
    console.error("[email] Resend rejected:", res.error);
    return { ok: false, reason: res.error.message };
  }
  return { ok: true, id: res.data?.id };
}

// ─── Public helpers ────────────────────────────────────────────────────

export async function sendVerificationEmail(
  to: string,
  verifyUrl: string,
): Promise<SendResult> {
  const subject = "Verifikasi email Sakola Kembara";
  const html = renderShell({
    heading: "Verifikasi email kamu",
    paragraphs: [
      `Terima kasih sudah mendaftar akun Sakola Kembara. Untuk mengaktifkan seluruh fitur (termasuk mengirim formulir pendaftaran), silakan verifikasi email kamu dengan mengklik tombol berikut.`,
    ],
    ctaLabel: "Verifikasi Email",
    ctaUrl: verifyUrl,
    footer: `Tautan ini berlaku selama 24 jam. Jika kamu tidak merasa membuat akun ini, silakan abaikan email ini.`,
  });
  const text = plaintextShell({
    heading: "Verifikasi email kamu",
    paragraphs: [
      "Terima kasih sudah mendaftar akun Sakola Kembara. Untuk mengaktifkan seluruh fitur, silakan verifikasi email kamu dengan membuka tautan berikut:",
      verifyUrl,
    ],
    footer:
      "Tautan ini berlaku selama 24 jam. Jika kamu tidak merasa membuat akun ini, silakan abaikan email ini.",
  });
  return send({ to, subject, html, text, purpose: "verify-email" });
}

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
): Promise<SendResult> {
  const subject = "Reset password akun Sakola Kembara";
  const html = renderShell({
    heading: "Reset password kamu",
    paragraphs: [
      `Kami menerima permintaan untuk mengatur ulang password akun Sakola Kembara kamu. Klik tombol berikut untuk memilih password baru.`,
    ],
    ctaLabel: "Reset Password",
    ctaUrl: resetUrl,
    footer: `Tautan ini berlaku selama 30 menit. Jika kamu tidak meminta reset password, silakan abaikan email ini — password kamu tidak akan berubah.`,
  });
  const text = plaintextShell({
    heading: "Reset password kamu",
    paragraphs: [
      "Kami menerima permintaan untuk mengatur ulang password akun Sakola Kembara. Buka tautan berikut untuk memilih password baru:",
      resetUrl,
    ],
    footer:
      "Tautan ini berlaku selama 30 menit. Jika kamu tidak meminta reset password, silakan abaikan email ini — password kamu tidak akan berubah.",
  });
  return send({ to, subject, html, text, purpose: "reset-password" });
}

// ─── Templates ─────────────────────────────────────────────────────────

interface ShellArgs {
  heading: string;
  paragraphs: string[];
  ctaLabel?: string;
  ctaUrl?: string;
  footer: string;
}

/**
 * Minimal HTML shell. Inline styles because email clients don't render
 * external stylesheets and inline styles are the compatibility floor.
 * No fancy layout — headline, paragraphs, one CTA button, footer note.
 */
function renderShell(args: ShellArgs): string {
  const origin = appOrigin();
  const parasHtml = args.paragraphs
    .map(
      (p) =>
        `<p style="margin: 0 0 16px 0; color: #374151; font-size: 15px; line-height: 1.6;">${escapeHtml(p)}</p>`,
    )
    .join("");
  const buttonHtml =
    args.ctaLabel && args.ctaUrl
      ? `<p style="margin: 24px 0;">
           <a href="${escapeAttr(args.ctaUrl)}" style="display: inline-block; padding: 12px 24px; background: #122E76; color: #ffffff; text-decoration: none; font-weight: 600; border-radius: 8px; font-size: 15px;">${escapeHtml(args.ctaLabel)}</a>
         </p>
         <p style="margin: 0 0 24px 0; color: #6B7280; font-size: 13px; line-height: 1.6;">Tombol tidak berfungsi? Salin tautan berikut ke browser kamu:<br/><a href="${escapeAttr(args.ctaUrl)}" style="color: #122E76; word-break: break-all;">${escapeHtml(args.ctaUrl)}</a></p>`
      : "";
  return `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(args.heading)}</title>
  </head>
  <body style="margin: 0; padding: 0; background: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb;">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width: 560px; background: #ffffff; border-radius: 16px; overflow: hidden;">
            <tr>
              <td style="padding: 32px 40px 8px 40px;">
                <a href="${escapeAttr(origin)}" style="color: #122E76; text-decoration: none; font-weight: 600; font-size: 18px;">Sakola Kembara</a>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 40px 32px 40px;">
                <h1 style="margin: 16px 0 20px 0; color: #111827; font-size: 24px; font-weight: 600; line-height: 1.3;">${escapeHtml(args.heading)}</h1>
                ${parasHtml}
                ${buttonHtml}
                <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e7eb;" />
                <p style="margin: 0; color: #9CA3AF; font-size: 12px; line-height: 1.5;">${escapeHtml(args.footer)}</p>
              </td>
            </tr>
          </table>
          <p style="margin: 16px 0 0 0; color: #9CA3AF; font-size: 12px;">© Yayasan Sakola Kembara Indonesia</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function plaintextShell(args: {
  heading: string;
  paragraphs: string[];
  footer: string;
}): string {
  return [
    args.heading,
    "",
    ...args.paragraphs,
    "",
    "---",
    args.footer,
    "",
    "— Yayasan Sakola Kembara Indonesia",
  ].join("\n");
}

// Small escaper — email clients render HTML strictly; unescaped user
// content (name in a greeting, etc.) could break the layout or worse.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
