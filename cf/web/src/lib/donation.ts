// The site's side of the /donasi form (SAKEM-128, docs/cloudflare/donations.md). The rules of a confirmation live in the
// API Worker (cf/admin/src/donations/rules.ts): this file sends what the visitor typed, through the SERVICE BINDING, and
// turns the answers into what the pages show. It keeps the donation's id and token in an HttpOnly cookie, so step 2 is
// still there after a reload or a trip to the banking app.
//
//   POST /donasi                 step 1 -> POST /api/public/donations (create, or "Ubah data" with the cookie) -> 303 /donasi/bayar
//   GET  /donasi/bayar           the cookie -> GET /api/public/donations/:id -> the transfer details (and the receipt upload)
//   PUT  /donasi/bukti           the receipt, streamed -> PUT /api/public/donations/:id/proof (JavaScript only)
//   POST /donasi/terima-kasih    the optional source -> POST /api/public/donations/:id/source
//
// Nothing here logs a name, a number, an amount or a token: failures log a status code and the API's error code.

import { contactApiTarget, type ApiEnv } from './api-client';
import { TURNSTILE_TOKEN_HEADER, turnstileToken } from './turnstile';

export const CLIENT_IP_HEADER = 'x-sakem-client-ip';
export const DONATION_TOKEN_HEADER = 'x-sakem-donation-token';
export const UNKNOWN_CLIENT_IP = '0.0.0.0';
export const DONATION_COOKIE = 'sakem_donasi';
/** A week: long enough to come back from the bank, short enough not to outlive the visit by much. */
export const DONATION_COOKIE_MAX_AGE = 7 * 24 * 60 * 60;
export const MAX_FORM_BYTES = 16 * 1024;
/** The API's own cap on a receipt; a larger one is refused here first. */
export const MAX_PROOF_BYTES = 10_000_000;
const TIMEOUT_MS = 8000;

export const DONATION_TURNSTILE_ACTION = 'donation';

export const BANK = { name: 'Bank Muamalat', code: '147', account: '1010141940', accountShown: '1010 141 940', holder: 'Sakola Kembara Indonesia' } as const;

/** The amount buttons of step 1 (the Google Form's packages, as plain amounts). */
export const AMOUNT_CHOICES = [50_000, 100_000, 200_000, 300_000, 500_000] as const;

export const SOURCES = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'twitter', label: 'Twitter/X' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'friend', label: 'Teman' },
  { value: 'website', label: 'Situs web' },
  { value: 'other', label: 'Lainnya' },
] as const;

export const DONATION_MESSAGES = {
  unavailable: 'Data belum dapat dikirim saat ini. Silakan coba lagi beberapa saat lagi.',
  invalid: 'Silakan periksa kembali isian formulir.',
} as const;

export type DonationKind = 'once' | 'monthly';
export type DonationField = 'kind' | 'name' | 'whatsapp' | 'amount' | 'startMonth' | 'remindDay';
export type DonationFieldErrors = Partial<Record<DonationField, string>>;

export interface DonationSummary {
  id: string;
  kind: DonationKind;
  name: string;
  whatsapp: string;
  amount: number;
  startMonth: string | null;
  remindDay: number | null;
  status: 'awaiting_transfer' | 'new' | 'checked';
  hasProof: boolean;
  source: string | null;
}

/** What the visitor typed, to put back in the form. */
export interface DonationValues {
  kind: DonationKind;
  name: string;
  whatsapp: string;
  /** One of AMOUNT_CHOICES as text, or "other". */
  amountChoice: string;
  amountOther: string;
  startMonth: string;
  remindDay: string;
}

export const EMPTY_VALUES: DonationValues = { kind: 'once', name: '', whatsapp: '', amountChoice: '200000', amountOther: '', startMonth: '', remindDay: '' };

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export function rupiah(amount: number): string {
  return `Rp${amount.toLocaleString('id-ID')}`;
}

/** "2026-12" as "Desember 2026". */
export function monthLabel(month: string | null): string {
  if (!month) return '';
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year!, m! - 1, 1)).toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** The form's fields as typed (never validated here: the API answers with its messages). */
export function valuesOf(form: Record<string, unknown>): DonationValues {
  return {
    kind: form.kind === 'monthly' ? 'monthly' : 'once',
    name: text(form.name),
    whatsapp: text(form.whatsapp),
    amountChoice: text(form.amount),
    amountOther: text(form.amountOther),
    startMonth: text(form.startMonth),
    remindDay: text(form.remindDay),
  };
}

/** The values of a saved donation, for "Ubah data". */
export function valuesFromSummary(summary: DonationSummary): DonationValues {
  const preset = (AMOUNT_CHOICES as readonly number[]).includes(summary.amount);
  return {
    kind: summary.kind,
    name: summary.name,
    whatsapp: summary.whatsapp.startsWith('62') ? `0${summary.whatsapp.slice(2)}` : summary.whatsapp,
    amountChoice: preset ? String(summary.amount) : 'other',
    amountOther: preset ? '' : String(summary.amount),
    startMonth: summary.startMonth ?? '',
    remindDay: summary.remindDay ? String(summary.remindDay) : '',
  };
}

/** The JSON of step 1 for the API. */
export function bodyOf(values: DonationValues): Record<string, unknown> {
  const amount = values.amountChoice === 'other' ? values.amountOther : values.amountChoice;
  return {
    kind: values.kind,
    name: values.name,
    whatsapp: values.whatsapp,
    amount,
    ...(values.kind === 'monthly' ? { startMonth: values.startMonth, remindDay: values.remindDay } : {}),
  };
}

// ---------------------------------------------------------------- the cookie

export interface DonationRef {
  id: string;
  token: string;
}

const REF_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

export function readDonationRef(cookieHeader: string | null): DonationRef | null {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== DONATION_COOKIE) continue;
    const match = REF_PATTERN.exec(rest.join('='));
    return match ? { id: match[1]!, token: match[2]! } : null;
  }
  return null;
}

/** HttpOnly, Secure, SameSite=Lax, only under /donasi. */
export function donationCookie(ref: DonationRef | null): string {
  const base = `${DONATION_COOKIE}=${ref ? `${ref.id}.${ref.token}` : ''}; Path=/donasi; HttpOnly; Secure; SameSite=Lax`;
  return ref ? `${base}; Max-Age=${DONATION_COOKIE_MAX_AGE}` : `${base}; Max-Age=0`;
}

// ---------------------------------------------------------------- the API

export type DonationEnv = ApiEnv;

function clientIp(request: Request): string {
  const ip = request.headers.get('cf-connecting-ip')?.trim() ?? '';
  return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : UNKNOWN_CLIENT_IP;
}

async function call(env: DonationEnv, path: string, init: RequestInit & { request: Request; ref?: DonationRef | null }): Promise<Response | null> {
  const target = contactApiTarget(env);
  if (!target) {
    console.warn('donation: no API configured');
    return null;
  }
  const headers = new Headers(init.headers);
  headers.set(CLIENT_IP_HEADER, clientIp(init.request));
  if (init.ref) headers.set(DONATION_TOKEN_HEADER, init.ref.token);
  try {
    return await target.fetchImpl(`${target.base}${path}`, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    console.warn(`donation: API unreachable (${(error as Error).name})`);
    return null;
  }
}

async function jsonOf<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export type SubmitOutcome =
  | { kind: 'saved'; ref: DonationRef }
  | { kind: 'invalid'; message: string; fieldErrors: DonationFieldErrors; values: DonationValues; status: number }
  | { kind: 'refused'; message: string; values: DonationValues; status: number; retryAfter?: number }
  | { kind: 'gone' };

/** Step 1, from the posted form: create, or change the donation of the cookie ("Ubah data"). */
export async function submitDonation(request: Request, form: Record<string, unknown>, env: DonationEnv): Promise<SubmitOutcome> {
  const values = valuesOf(form);
  const ref = form.update === '1' ? readDonationRef(request.headers.get('cookie')) : null;
  const headers = new Headers({ 'content-type': 'application/json' });
  if (!ref) {
    const token = turnstileToken(form);
    if (token) headers.set(TURNSTILE_TOKEN_HEADER, token);
  }
  const body = JSON.stringify(ref ? { ...bodyOf(values), id: ref.id } : bodyOf(values));
  const response = await call(env, '/api/public/donations', { method: 'POST', headers, body, request, ref });
  if (!response) return { kind: 'refused', message: DONATION_MESSAGES.unavailable, values, status: 503 };
  const answer = await jsonOf<{ donation?: DonationSummary; token?: string; error?: string; message?: string; fieldErrors?: DonationFieldErrors; retryAfterSeconds?: number }>(response);
  if ((response.status === 201 || response.status === 200) && answer?.donation) {
    return { kind: 'saved', ref: ref ?? { id: answer.donation.id, token: answer.token ?? '' } };
  }
  if (response.status === 404 && ref) return { kind: 'gone' };
  if (response.status === 400 && answer?.error === 'validation_failed') {
    return { kind: 'invalid', message: answer.message ?? DONATION_MESSAGES.invalid, fieldErrors: answer.fieldErrors ?? {}, values, status: 400 };
  }
  if (answer?.message && [400, 409, 429].includes(response.status)) {
    return { kind: 'refused', message: answer.message, values, status: response.status, retryAfter: answer.retryAfterSeconds };
  }
  console.warn(`donation: step 1 failed (${response.status} ${answer?.error ?? '-'})`);
  return { kind: 'refused', message: DONATION_MESSAGES.unavailable, values, status: 503 };
}

/** The donation of the cookie, or null (no cookie, a stale one, or the API down: `unavailable` tells the last apart). */
export async function loadDonation(request: Request, env: DonationEnv): Promise<{ summary: DonationSummary | null; unavailable: boolean; ref: DonationRef | null }> {
  const ref = readDonationRef(request.headers.get('cookie'));
  if (!ref) return { summary: null, unavailable: false, ref };
  const response = await call(env, `/api/public/donations/${ref.id}`, { method: 'GET', request, ref });
  if (!response) return { summary: null, unavailable: true, ref };
  if (response.status === 404) return { summary: null, unavailable: false, ref };
  const answer = await jsonOf<{ donation?: DonationSummary }>(response);
  return answer?.donation ? { summary: answer.donation, unavailable: false, ref } : { summary: null, unavailable: true, ref };
}

/** The receipt, streamed as it came (the browser sends the raw file with its length). Answers the API's JSON. */
export async function forwardProof(request: Request, env: DonationEnv): Promise<Response> {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  const ref = readDonationRef(request.headers.get('cookie'));
  if (!ref) return json(404, { error: 'not_found', message: 'Data donasi tidak ditemukan. Silakan isi formulir dari awal.' });
  const length = request.headers.get('content-length');
  if (!length || !/^[0-9]{1,9}$/.test(length)) return json(411, { error: 'length_required', message: 'Unggahan tidak dapat dibaca. Silakan coba lagi.' });
  if (Number(length) > MAX_PROOF_BYTES) return json(413, { error: 'too_large', message: 'Berkas lebih dari 10 MB. Pilih foto atau PDF yang lebih kecil.' });
  const response = await call(env, `/api/public/donations/${ref.id}/proof`, {
    method: 'PUT',
    headers: { 'content-length': length, 'content-type': 'application/octet-stream' },
    body: request.body,
    request,
    ref,
    // @ts-expect-error: a streamed request body needs `duplex` (undici/workerd), which the DOM typings do not declare
    duplex: 'half',
  });
  if (!response) return json(503, { error: 'unavailable', message: 'Bukti transfer belum dapat diunggah saat ini. Silakan coba lagi.' });
  const answer = await jsonOf<{ error?: string; message?: string }>(response);
  if (response.ok) return json(200, { ok: true });
  if (!answer?.message) console.warn(`donation: proof failed (${response.status} ${answer?.error ?? '-'})`);
  return json(response.status, { error: answer?.error ?? 'unavailable', message: answer?.message ?? 'Bukti transfer belum dapat diunggah saat ini. Silakan coba lagi.' });
}

/** The optional question of the thank-you page. True when it was saved. */
export async function saveSource(request: Request, source: string, env: DonationEnv): Promise<boolean> {
  const ref = readDonationRef(request.headers.get('cookie'));
  if (!ref || !SOURCES.some((s) => s.value === source)) return false;
  const response = await call(env, `/api/public/donations/${ref.id}/source`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source }),
    request,
    ref,
  });
  return response?.ok ?? false;
}

/** Same origin as the request (a courtesy against cross-site posts; the token in the cookie is the real key). */
export function isSameOrigin(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/** The form body as an object, capped. Null when too large or not a form. */
export async function readForm(request: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_FORM_BYTES) return null;
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MAX_FORM_BYTES) return null;
  const type = request.headers.get('content-type') ?? '';
  if (!type.startsWith('application/x-www-form-urlencoded')) return null;
  return Object.fromEntries(new URLSearchParams(new TextDecoder().decode(buffer)));
}
