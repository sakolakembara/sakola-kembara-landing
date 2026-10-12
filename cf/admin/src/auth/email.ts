import { isProduction, type Bindings } from "../env";

// Transactional email through Resend's REST API (free tier: 3,000/month, 100/day).
// Plain fetch, no SDK, so nothing here adds to the bundle.
//
// Fails closed. Verification and reset links carry live tokens, so:
//   - production without a key: nothing is sent, one log line names only the
//     purpose, and the result says `provider_not_configured`;
//   - non-production without a key: the message is printed to the console so a
//     developer can copy the link;
//   - no log line ever contains a recipient or a URL outside that dev branch.

export type EmailPurpose = "verify-email" | "reset-password";

export type SendResult =
  | { ok: true }
  | { ok: false; reason: "provider_not_configured" | "provider_error" };

interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  purpose: EmailPurpose;
}

type EmailEnv = Pick<Bindings, "ENVIRONMENT" | "RESEND_API_KEY" | "EMAIL_FROM">;

export async function sendEmail(env: EmailEnv, message: EmailMessage): Promise<SendResult> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    if (isProduction(env)) {
      console.error(`[email] provider not configured; ${message.purpose} email was not sent`);
      return { ok: false, reason: "provider_not_configured" };
    }
    console.info(`[email:dev] ${message.purpose} to ${message.to}\n${message.subject}\n${message.text}`);
    return { ok: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        tags: [{ name: "purpose", value: message.purpose }],
      }),
    });
    if (!res.ok) {
      // Status only: the response and the request both hold the recipient and the link.
      console.error(`[email] provider rejected ${message.purpose} email: HTTP ${res.status}`);
      return { ok: false, reason: "provider_error" };
    }
    return { ok: true };
  } catch {
    console.error(`[email] provider unreachable for ${message.purpose} email`);
    return { ok: false, reason: "provider_error" };
  }
}

// ─── Templates (copy carried over from lib/email.ts in the legacy app) ───

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function render(args: { heading: string; paragraph: string; ctaLabel: string; url: string; footer: string }) {
  const html = `<!doctype html>
<html lang="id"><body style="margin:0;padding:32px 16px;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px 40px;">
<p style="margin:0;color:#122E76;font-weight:600;font-size:18px;">Sakola Kembara</p>
<h1 style="margin:16px 0 20px;color:#111827;font-size:24px;font-weight:600;line-height:1.3;">${escapeHtml(args.heading)}</h1>
<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">${escapeHtml(args.paragraph)}</p>
<p style="margin:24px 0;"><a href="${escapeHtml(args.url)}" style="display:inline-block;padding:12px 24px;background:#122E76;color:#ffffff;text-decoration:none;font-weight:600;border-radius:8px;font-size:15px;">${escapeHtml(args.ctaLabel)}</a></p>
<p style="margin:0 0 24px;color:#6B7280;font-size:13px;line-height:1.6;">Tombol tidak berfungsi? Salin tautan berikut ke browser kamu:<br/><a href="${escapeHtml(args.url)}" style="color:#122E76;word-break:break-all;">${escapeHtml(args.url)}</a></p>
<p style="margin:0;color:#9CA3AF;font-size:12px;line-height:1.5;border-top:1px solid #e5e7eb;padding-top:16px;">${escapeHtml(args.footer)}</p>
</div></body></html>`;
  const text = `${args.heading}\n\n${args.paragraph}\n${args.url}\n\n${args.footer}`;
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
