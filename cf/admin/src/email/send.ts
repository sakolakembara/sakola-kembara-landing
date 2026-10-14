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
//
// The day's budget (SAKEM-083, docs/cloudflare/portal-architecture.md, 9.2): Resend's free plan sends 100 a day, and
// a registration day of the portal can need more. Every email that is really sent (or recorded in the local mailbox)
// is counted in `email_daily`, one row for the UTC day, BEFORE it goes out. The confirmation of a submitted
// application is optional (nothing depends on it) and stops at 80, which keeps the last 20 for the emails a person
// is waiting for (verification, reset). At 100 the portal's registration, resend and forgot-password routes answer
// `503 email_quota` before they create anything (`emailQuotaSpent`, used by src/auth/gate.ts): the 101st person is
// told, instead of waiting for a link that never comes. The counter never stops an email a person waits for from being
// tried: beyond 100 it is sent anyway and Resend's own refusal is logged, as before.

export type EmailPurpose = "verify-email" | "reset-password" | "admin-invite" | "account-exists" | "application-received";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  purpose: EmailPurpose;
}

export type SendFailure = "provider_not_configured" | "provider_rate_limited" | "provider_error" | "daily_budget";

export type SendResult = { ok: true } | { ok: false; reason: SendFailure; retryAfterSeconds?: number };

/** `DB` is optional: with it the send is counted against the day's budget, without it (a unit test, a script) nothing is. */
type EmailEnv = Pick<Bindings, "ENVIRONMENT" | "RESEND_API_KEY" | "EMAIL_FROM"> & { DB?: D1Database };

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

// ─── The day's budget ──────────────────────────────────────────────────────

/** What Resend's free plan sends in a day. */
export const EMAIL_DAILY_ALLOWANCE = 100;

/** An optional email (the confirmation of an application) is sent only while the day's count is below this. */
export const EMAIL_CONFIRMATION_CEILING = 80;

/** The answer of `503 email_quota`: a function of the day, not of the address, so it does not break the no-enumeration rule. */
export const EMAIL_QUOTA_MESSAGE = "Pendaftaran akun hari ini sudah penuh. Coba lagi besok, atau masuk dengan Google.";

/** The ceilings of the emails nobody waits for. Any purpose that is not here is counted up to the allowance and still sent beyond it. */
const OPTIONAL_CEILING: Partial<Record<EmailPurpose, number>> = { "application-received": EMAIL_CONFIRMATION_CEILING };

/** The UTC day as `YYYY-MM-DD`: Resend's day, and the key of `email_daily`. */
export function emailDay(at: number = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * Takes one of the day's emails: one statement, atomic, one row written. Returns the count after it, or null when the
 * day already holds `limit` (the row is left as it is). Two requests at once cannot both take the last one.
 */
export async function takeEmailSlot(db: D1Database, limit: number, at: number = Date.now()): Promise<number | null> {
  const row = await db
    .prepare("INSERT INTO email_daily (day, sent) VALUES (?1, 1) ON CONFLICT (day) DO UPDATE SET sent = sent + 1 WHERE sent < ?2 RETURNING sent")
    .bind(emailDay(at), limit)
    .first<{ sent: number }>();
  return row ? row.sent : null;
}

/** How many emails today holds so far (0 when none). */
export async function emailsSentToday(db: D1Database, at: number = Date.now()): Promise<number> {
  const row = await db.prepare("SELECT sent FROM email_daily WHERE day = ?1").bind(emailDay(at)).first<{ sent: number }>();
  return row?.sent ?? 0;
}

/**
 * Is the day's allowance spent? One row read. A counter that cannot be read answers "no": an unreadable counter must not
 * turn every registration away (the log names no address, only that it failed).
 */
export async function emailQuotaSpent(env: { DB?: D1Database }): Promise<boolean> {
  if (!env.DB) return false;
  try {
    return (await emailsSentToday(env.DB)) >= EMAIL_DAILY_ALLOWANCE;
  } catch {
    console.error("[email] the daily counter could not be read");
    return false;
  }
}

/** Counts one email before it goes out. False = do not send it (an optional email over its ceiling). */
async function reserveSlot(db: D1Database, purpose: EmailPurpose): Promise<boolean> {
  const ceiling = OPTIONAL_CEILING[purpose];
  try {
    const count = await takeEmailSlot(db, ceiling ?? EMAIL_DAILY_ALLOWANCE);
    if (count === null) {
      // Numbers and the purpose only: how close the day was.
      console.warn(`[email] ${ceiling ?? EMAIL_DAILY_ALLOWANCE} of ${EMAIL_DAILY_ALLOWANCE} emails are used today; ${purpose} email ${ceiling === undefined ? "is sent anyway" : "was not sent"}`);
      return ceiling === undefined;
    }
    if (count === EMAIL_CONFIRMATION_CEILING || count === EMAIL_DAILY_ALLOWANCE) console.warn(`[email] ${count} of ${EMAIL_DAILY_ALLOWANCE} emails are used today`);
    return true;
  } catch {
    // An unreadable counter must not stop an email.
    console.error("[email] the daily counter could not be updated");
    return true;
  }
}

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
    // The mailbox is the local stand-in for Resend, so it counts like Resend would.
    if (env.DB && !(await reserveSlot(env.DB, message.purpose))) return { ok: false, reason: "daily_budget" };
    mailbox.record(message);
    return { ok: true };
  }

  if (env.DB && !(await reserveSlot(env.DB, message.purpose))) return { ok: false, reason: "daily_budget" };

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
