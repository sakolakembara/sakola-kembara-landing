import { isProduction, type Bindings } from "../env";

// Transactional email through Resend's REST API (free tier: 3,000 a month and
// 100 a day). Plain fetch, no SDK, so nothing here adds to the bundle.
//
// Fails closed, because verification and reset links carry live tokens:
//   - production without RESEND_API_KEY or EMAIL_FROM: nothing is sent, one log
//     line names only the purpose, and the result is `provider_not_configured`.
//     (SAKEM-010: the legacy app printed the link to its logs and told the
//     user it had worked.) The routes that send email check this BEFORE they
//     create anything and answer 503; see `emailAvailable`.
//   - Resend answers anything but 2xx: `provider_error`; 429 is told apart as
//     `provider_rate_limited` (the free quota is small, 100 a day).
//   - outside production without a key: the message is recorded in memory
//     (`mailbox`), never printed. A developer reads it from the dev-only
//     GET /api/dev/mailbox, a test from `mailbox.messages`.
// No log line ever contains a recipient, a subject, a body or a URL.

export type EmailPurpose = "verify-email" | "reset-password" | "admin-invite" | "account-exists";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  purpose: EmailPurpose;
}

export type SendFailure = "provider_not_configured" | "provider_rate_limited" | "provider_error";

export type SendResult = { ok: true } | { ok: false; reason: SendFailure; retryAfterSeconds?: number };

type EmailEnv = Pick<Bindings, "ENVIRONMENT" | "RESEND_API_KEY" | "EMAIL_FROM">;

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 8000;

// ─── Local and test mailbox ───────────────────────────────────────────────

export interface RecordedEmail extends EmailMessage {
  at: number;
}

const MAX_RECORDED = 50;

/**
 * Messages "sent" outside production when no Resend key is set. In memory, per
 * isolate, newest last, capped. This is the test-only hook: tests import it and
 * read the links from `text`. Nothing is ever recorded in production, so the
 * bundle carries an empty array there.
 */
export const mailbox = {
  messages: [] as RecordedEmail[],
  record(message: EmailMessage) {
    this.messages.push({ ...message, at: Date.now() });
    if (this.messages.length > MAX_RECORDED) this.messages.splice(0, this.messages.length - MAX_RECORDED);
  },
  clear() {
    this.messages.length = 0;
  },
};

// ─── Sending ──────────────────────────────────────────────────────────────

/** True when an email sent now would really go out, or this is a local run that records it. */
export function emailAvailable(env: EmailEnv): boolean {
  return !isProduction(env) || Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

/** Resend names its errors ("daily_quota_exceeded"); keep that short token for the log and nothing else from the body. */
async function errorName(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { name?: unknown };
    return typeof body.name === "string" && /^[a-z_]{3,48}$/.test(body.name) ? body.name : "unknown";
  } catch {
    return "unknown";
  }
}

export async function sendEmail(env: EmailEnv, message: EmailMessage): Promise<SendResult> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    if (isProduction(env)) {
      console.error(`[email] provider not configured; ${message.purpose} email was not sent`);
      return { ok: false, reason: "provider_not_configured" };
    }
    mailbox.record(message);
    return { ok: true };
  }

  try {
    const res = await fetch(RESEND_URL, {
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };

    // Status and Resend's short error name only: the request and the answer both hold the recipient and the link.
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      console.error(`[email] Resend limit reached for ${message.purpose} email: HTTP 429 ${await errorName(res)}`);
      return { ok: false, reason: "provider_rate_limited", ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}) };
    }
    console.error(`[email] provider rejected ${message.purpose} email: HTTP ${res.status} ${await errorName(res)}`);
    return { ok: false, reason: "provider_error" };
  } catch {
    console.error(`[email] provider unreachable for ${message.purpose} email`);
    return { ok: false, reason: "provider_error" };
  }
}
