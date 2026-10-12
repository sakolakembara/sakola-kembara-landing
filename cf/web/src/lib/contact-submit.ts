// What happens when /kontak receives a POST: a plain HTML form post (no JavaScript
// needed) turned into one call to the API Worker, and the answer turned back into
// what the page shows. The API contract is docs/cloudflare/content-api.md, `POST /api/public/contact`.
//
//   1. Origin check (a courtesy, not security: Astro's own check is off for the pass-through).
//   2. The body is read with a 32 KiB cap and parsed as a form (the typed text can then go back
//      into the page whatever the outcome).
//   3. Rate limit by visitor address (CF-Connecting-IP): the binding, else the in-memory fallback.
//   4. Validate with the legacy rules (contact.ts). A filled honeypot is answered as a success
//      and the API is never called.
//   5. POST JSON to the API Worker through the SERVICE BINDING (api-client.ts), with the visitor
//      address in `X-Sakem-Client-Ip` and the form's Turnstile token (field `cf-turnstile-response`,
//      added by the widget) in `X-Sakem-Turnstile-Token`. The binding is the authentication: nothing
//      public can reach that endpoint this way, so there is no signature and no shared secret. (The
//      API trusts the address header only for a call that came through the binding.) The token is
//      forwarded when there is one and the API decides: it refuses a missing, failed or reused token
//      when a Turnstile secret is configured (always in production) and skips the check otherwise, so
//      this Worker never refuses a post for lack of a token itself (the no-JavaScript form keeps
//      working in local runs and CI).
//   6. The status codes map to the legacy wording: 201 sent, 400 validation_failed, 400
//      turnstile_failed ("Verifikasi gagal. Silakan coba lagi."), 429 rate_limited and
//      duplicate_recent, anything else "unavailable".
//
// Nothing here logs a name, an address, a message or a token, ever: failures log a status code and the
// API's error code, which are fixed words. Both are checked by tests.

import { contactApiTarget, type ApiEnv } from './api-client';
import {
  CONTACT_MESSAGES,
  contactValues,
  parseContactForm,
  type ContactFieldErrors,
  type ContactInput,
  type ContactValues,
} from './contact';
import { createMemoryLimiter, type Limiter } from './contact-limit';
import { TURNSTILE_MESSAGES, TURNSTILE_TOKEN_HEADER, turnstileToken } from './turnstile';

/** The API's own cap (content-api.md): a body above it is refused there, so refuse it here first. */
export const MAX_BODY_BYTES = 32 * 1024;
/** Header that carries the visitor's address to the API (transport A of the contract). */
export const CLIENT_IP_HEADER = 'x-sakem-client-ip';
/**
 * Sent when `CF-Connecting-IP` is missing or malformed (it never is behind Cloudflare; it can be in
 * a local run). The API wants a single IP literal; a fixed one puts every such visitor in one shared
 * bucket there, which over-throttles, the contract's safe failure.
 */
export const UNKNOWN_CLIENT_IP = '0.0.0.0';

export type ContactOutcome =
  | { kind: 'sent'; message: string }
  | { kind: 'invalid'; fieldErrors: ContactFieldErrors; values: ContactValues; message: string }
  | { kind: 'rate_limited'; message: string; retryAfter: number; values: ContactValues }
  | { kind: 'duplicate'; message: string; retryAfter: number; values: ContactValues }
  /** The API refused the Turnstile token (missing, failed or reused). The form comes back with a fresh widget. */
  | { kind: 'turnstile_failed'; message: string; values: ContactValues }
  | { kind: 'unavailable'; message: string; values: ContactValues }
  | { kind: 'forbidden' }
  | { kind: 'too_large' }
  | { kind: 'bad_request' };

export interface ContactDeps {
  env: ApiEnv & { CONTACT_LIMITER?: Limiter };
  /** In-memory limiter used when the binding is absent. One per isolate by default. */
  fallbackLimiter?: Limiter;
  timeoutMs?: number;
}

const memory = createMemoryLimiter();

// ---- small helpers ----------------------------------------------------------

/** Same origin as the request itself. A missing Origin (some privacy settings) is let through: the other defences still apply. */
export function isSameOrigin(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false; // "null" and anything else that is not a URL
  }
}

/** One IPv4 or IPv6 literal: what `CF-Connecting-IP` carries and what the API accepts. */
export function isIpLiteral(value: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return value.split('.').every((n) => Number(n) <= 255);
  if (!value.includes(':') || value.length > 45 || !/^[0-9a-f:.]+$/i.test(value)) return false;
  try {
    new URL(`http://[${value}]/`);
    return true;
  } catch {
    return false;
  }
}

/** The visitor's address as Cloudflare reports it, or UNKNOWN_CLIENT_IP. */
export function visitorIp(request: Request): string {
  const ip = request.headers.get('cf-connecting-ip')?.trim() ?? '';
  return isIpLiteral(ip) ? ip : UNKNOWN_CLIENT_IP;
}

/**
 * Reads and throws away what the client is still sending (at most MAX_BODY_BYTES), so an early answer
 * (a refused origin) leaves the connection clean: a response that goes out while the request body is
 * unread can make the next request on a reused connection fail with "Network connection lost".
 */
export async function drainBody(request: Request): Promise<void> {
  const reader = request.body?.getReader();
  if (!reader) return;
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) return void (await reader.cancel());
    }
  } catch {
    // the client went away: nothing left to keep clean
  }
}

/** The posted form, or why it cannot be read. The body is cut off at MAX_BODY_BYTES while it streams. */
async function readForm(request: Request): Promise<Record<string, unknown> | 'too_large' | 'bad_request'> {
  const type = request.headers.get('content-type') ?? '';
  if (!/^(application\/x-www-form-urlencoded|multipart\/form-data)\b/i.test(type)) return 'bad_request';
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return 'too_large';

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (!reader) return 'bad_request';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return 'too_large';
    }
    chunks.push(value);
  }
  try {
    const form = await new Response(new Blob(chunks as BlobPart[]), { headers: { 'content-type': type } }).formData();
    return Object.fromEntries(form.entries());
  } catch {
    return 'bad_request';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `fieldErrors` of a 400, reduced to the fields and strings the form can show. */
function fieldErrorsFrom(v: unknown): ContactFieldErrors {
  const out: ContactFieldErrors = {};
  if (!isRecord(v)) return out;
  for (const field of ['fullName', 'email', 'subject', 'message'] as const) {
    const list = v[field];
    if (Array.isArray(list)) {
      const messages = list.filter((m): m is string => typeof m === 'string' && m.length > 0 && m.length <= 200);
      if (messages.length > 0) out[field] = messages;
    }
  }
  return out;
}

const retryAfterFrom = (res: Response, body: unknown, fallback: number): number => {
  const header = Number(res.headers.get('retry-after'));
  const fromBody = isRecord(body) ? Number(body.retryAfterSeconds) : NaN;
  const n = Number.isInteger(header) && header > 0 ? header : Number.isInteger(fromBody) && fromBody > 0 ? fromBody : fallback;
  return Math.min(n, 3600);
};

// ---- the call to the API Worker ---------------------------------------------

async function sendToApi(data: ContactInput, ip: string, token: string | null, deps: ContactDeps): Promise<ContactOutcome> {
  const values: ContactValues = { ...data };
  const target = contactApiTarget(deps.env);
  if (!target) {
    console.warn('contact: no API configured (binding API or CONTACT_API_URL)');
    return { kind: 'unavailable', message: CONTACT_MESSAGES.unavailable, values };
  }

  let res: Response;
  try {
    res = await target.fetchImpl(`${target.base}/api/public/contact`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        [CLIENT_IP_HEADER]: ip,
        // Only when the form carried one (never in the body, never logged); the API decides what a missing one means.
        ...(token ? { [TURNSTILE_TOKEN_HEADER]: token } : {}),
      },
      // The honeypot is empty by now: a filled one never gets here.
      body: JSON.stringify({ ...data, website: '' }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 8000),
    });
  } catch (error) {
    console.warn(`contact: API unreachable (${error instanceof Error ? error.name : 'error'})`);
    return { kind: 'unavailable', message: CONTACT_MESSAGES.unavailable, values };
  }

  const body: unknown = await res.json().catch(() => null);
  const code = isRecord(body) && typeof body.error === 'string' && /^[a-z_]{1,40}$/.test(body.error) ? body.error : undefined;

  if (res.status === 201) return { kind: 'sent', message: CONTACT_MESSAGES.success };
  if (res.status === 400 && code === 'validation_failed') {
    return {
      kind: 'invalid',
      fieldErrors: fieldErrorsFrom(isRecord(body) ? body.fieldErrors : undefined),
      values,
      message: CONTACT_MESSAGES.invalid,
    };
  }
  // Not logged: a refused token is the visitor's outcome (or a bot's), not a fault of ours.
  if (res.status === 400 && code === 'turnstile_failed') {
    return { kind: 'turnstile_failed', message: TURNSTILE_MESSAGES.failed, values };
  }
  if (res.status === 429) {
    return code === 'duplicate_recent'
      ? { kind: 'duplicate', message: CONTACT_MESSAGES.duplicate, retryAfter: retryAfterFrom(res, body, 300), values }
      : { kind: 'rate_limited', message: CONTACT_MESSAGES.rateLimited, retryAfter: retryAfterFrom(res, body, 60), values };
  }
  // 400 for another reason, 401, 503, 5xx, anything unexpected: not the visitor's doing.
  console.warn(`contact: API answered ${res.status}${code ? ` ${code}` : ''}`);
  return { kind: 'unavailable', message: CONTACT_MESSAGES.unavailable, values };
}

// ---- entry point ------------------------------------------------------------

export async function submitContact(request: Request, deps: ContactDeps): Promise<ContactOutcome> {
  if (!isSameOrigin(request)) {
    await drainBody(request);
    return { kind: 'forbidden' };
  }

  // A form post is small (capped at 32 KiB while it streams), so it is read first: whatever happens
  // next, the visitor's text can go back into the form.
  const form = await readForm(request);
  if (form === 'too_large') return { kind: 'too_large' };
  if (form === 'bad_request') return { kind: 'bad_request' };
  const values = contactValues(form);

  // The limit comes before anything is validated or sent, as in the legacy action: a flood costs a counter.
  const ip = visitorIp(request);
  const limiter = deps.env.CONTACT_LIMITER ?? deps.fallbackLimiter ?? memory;
  const allowed = await limiter.limit({ key: `contact:${ip}` }).then(
    (r) => r.success,
    () => true, // a failing limiter must not take the form down
  );
  if (!allowed) return { kind: 'rate_limited', message: CONTACT_MESSAGES.rateLimited, retryAfter: 60, values };

  const parsed = parseContactForm(form);
  // A bot filled the hidden field: answer exactly like a success, send and store nothing.
  if (parsed.kind === 'honeypot') return { kind: 'sent', message: CONTACT_MESSAGES.success };
  if (parsed.kind === 'invalid') {
    return { kind: 'invalid', fieldErrors: parsed.fieldErrors, values: parsed.values, message: CONTACT_MESSAGES.invalid };
  }
  return sendToApi(parsed.data, ip, turnstileToken(form), deps);
}
