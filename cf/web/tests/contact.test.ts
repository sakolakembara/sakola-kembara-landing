import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  CONTACT_MESSAGES,
  CONTACT_SUBJECT_OPTIONS,
  FIELD_MESSAGES,
  contactInfo,
  parseContactForm,
  type ContactFieldErrors,
} from '~/lib/contact';
import { createMemoryLimiter } from '~/lib/contact-limit';
import {
  CLIENT_IP_HEADER,
  MAX_BODY_BYTES,
  UNKNOWN_CLIENT_IP,
  isIpLiteral,
  isSameOrigin,
  submitContact,
  visitorIp,
  type ContactDeps,
  type ContactOutcome,
} from '~/lib/contact-submit';
import { importRoot, readRoot } from './helpers';

// ---------------------------------------------------------------------------------------------------
// The rules and the words of the form are the legacy action's (app/(public)/kontak/actions.ts). Its
// zod schema is rebuilt here, from the same source text, and the port is checked against it.

const legacy = readRoot('app/(public)/kontak/actions.ts');

const legacySchema = z.object({
  fullName: z.string().trim().min(2, 'Nama lengkap minimal 2 karakter').max(120, 'Maksimal 120 karakter'),
  email: z.string().trim().toLowerCase().email('Format email belum benar').max(254),
  subject: z.enum(['partnership', 'donation', 'other'], { errorMap: () => ({ message: 'Pilih salah satu subjek' }) }),
  message: z.string().trim().min(10, 'Tulis minimal 10 karakter').max(5000, 'Maksimal 5000 karakter'),
  website: z.string().max(0, { message: 'spam' }),
});

describe('the words are the legacy ones, verbatim', () => {
  it('every message of the port appears in the legacy action (except the two new ones, named here)', () => {
    const verbatim: string[] = [
      CONTACT_MESSAGES.rateLimited,
      CONTACT_MESSAGES.invalid,
      CONTACT_MESSAGES.duplicate,
      CONTACT_MESSAGES.success,
      FIELD_MESSAGES.fullNameMin,
      FIELD_MESSAGES.fullNameMax,
      FIELD_MESSAGES.emailFormat,
      FIELD_MESSAGES.subject,
      FIELD_MESSAGES.messageMin,
      FIELD_MESSAGES.messageMax,
    ];
    const flat = legacy.replace(/"\s*\n\s*"/g, '').replace(/\s+/g, ' ');
    for (const text of verbatim) expect(flat, text).toContain(text.replace(/\s+/g, ' '));
    // New copy, with no legacy counterpart: the answer when the message cannot be handed over, and the 254-character email.
    expect(CONTACT_MESSAGES.unavailable).toBe('Pesan belum dapat dikirim saat ini. Silakan coba lagi beberapa saat lagi.');
    expect(FIELD_MESSAGES.emailMax).toBe('Maksimal 254 karakter');
    expect(flat).not.toContain(CONTACT_MESSAGES.unavailable);
  });

  it('the subject options are the legacy form\'s, in order', () => {
    const form = readRoot('app/(public)/kontak/_contact-form.tsx');
    for (const { value, label } of CONTACT_SUBJECT_OPTIONS) expect(form).toContain(`<option value="${value}">${label}</option>`);
    expect(CONTACT_SUBJECT_OPTIONS.map((o) => o.value)).toEqual(['partnership', 'donation', 'other']);
  });

  it('the contact details are the legacy data, unchanged (SAKEM-055 decides the real ones)', async () => {
    const root = await importRoot<{ contactInfo: { title: string; value: string }[] }>('lib/data.ts');
    expect(contactInfo).toEqual(root.contactInfo);
    expect(readRoot('cf/web/src/lib/contact.ts')).toContain('SAKEM-055');
  });
});

describe('validation equals the legacy zod schema', () => {
  const names = ['', ' ', 'A', 'Al', '  Budi Santoso  ', 'x'.repeat(120), 'x'.repeat(121), 'Ünïcode Nämé'];
  const emails = ['', 'a', 'a@b', 'budi@example.com', '  BUDI@Example.COM ', 'a..b@x.co', '.a@x.co', 'a@x.c', 'a b@x.co', 'a@-x.co', 'a+tag@sub.domain.id'];
  const subjects = ['', 'other', 'partnership', 'donation', 'Other', 'x'];
  const messages = ['', 'short', '1234567890', '  123456789  ', 'x'.repeat(5000), 'x'.repeat(5001), 'Halo,\nsaya ingin bertanya soal program.'];
  const websites = ['', ' ', 'http://spam.example'];

  it('gives the same verdict, the same data and the same first message for every field on 11,088 inputs', () => {
    let checked = 0;
    for (const fullName of names)
      for (const email of emails)
        for (const subject of subjects)
          for (const message of messages)
            for (const website of websites) {
              const raw = { fullName, email, subject, message, website };
              const expected = legacySchema.safeParse(raw);
              const actual = parseContactForm(raw);
              checked++;
              if (!expected.success && expected.error.flatten().fieldErrors.website) {
                // the legacy action drops a honeypot hit silently, whatever else is wrong
                expect(actual.kind, JSON.stringify(raw)).toBe('honeypot');
              } else if (expected.success) {
                expect(actual.kind, JSON.stringify(raw)).toBe('ok');
                if (actual.kind === 'ok') {
                  const { website: _ignored, ...data } = expected.data;
                  expect(actual.data).toEqual(data);
                }
              } else {
                expect(actual.kind, JSON.stringify(raw)).toBe('invalid');
                if (actual.kind === 'invalid') {
                  const fieldErrors = expected.error.flatten().fieldErrors as Record<string, string[]>;
                  expect(Object.keys(actual.fieldErrors).sort()).toEqual(Object.keys(fieldErrors).sort());
                  for (const [field, messages] of Object.entries(fieldErrors)) {
                    expect(actual.fieldErrors[field as keyof ContactFieldErrors]?.[0], `${field} of ${JSON.stringify(raw)}`).toBe(messages[0]);
                  }
                }
              }
            }
    expect(checked).toBe(8 * 11 * 6 * 7 * 3);
  });

  it('the one difference: an email over 254 characters gets the Indonesian length message, not zod\'s English default', () => {
    const email = `${'a'.repeat(250)}@x.co`;
    const raw = { fullName: 'Budi', email, subject: 'other', message: 'Halo, ini pesan saya.', website: '' };
    expect(legacySchema.safeParse(raw).success).toBe(false);
    const actual = parseContactForm(raw);
    expect(actual.kind).toBe('invalid');
    if (actual.kind === 'invalid') expect(actual.fieldErrors.email).toEqual([FIELD_MESSAGES.emailMax]);
  });

  it('absent or non-text fields count as empty (a FormData value can be a file), and the typed text is handed back untrimmed', () => {
    const r = parseContactForm({ fullName: '  A ', email: ' x ', subject: 7, message: undefined });
    expect(r.kind).toBe('invalid');
    if (r.kind === 'invalid') {
      expect(r.values).toEqual({ fullName: '  A ', email: ' x ', subject: '', message: '' });
      expect(r.fieldErrors.subject).toEqual([FIELD_MESSAGES.subject]);
    }
    expect(parseContactForm({ fullName: 'Budi', email: 'b@x.co', subject: 'other', message: '0123456789', website: new Blob(['x']) }).kind).toBe('honeypot');
  });
});

// ---------------------------------------------------------------------------------------------------
// submitContact: the POST, end to end, against a fake API Worker reached the way production reaches it
// (a service binding with a fetch method).

const SITE = 'https://sakolakembara.org';
const VALID = { fullName: 'Budi Santoso', email: 'budi@example.com', subject: 'other', message: 'Halo, saya ingin bertanya soal program.', website: '' };

function form(fields: Record<string, string>, headers: Record<string, string> = {}, init: RequestInit = {}): Request {
  return new Request(`${SITE}/kontak`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: SITE, 'cf-connecting-ip': '203.0.113.9', ...headers },
    body: new URLSearchParams(fields),
    ...init,
  });
}

interface Call {
  url: string;
  method?: string;
  headers: Headers;
  body: string;
}
function fakeApi(respond: (call: Call) => Response | Promise<Response> = () => Response.json({ ok: true, message: 'x' }, { status: 201 })) {
  const calls: Call[] = [];
  const api = {
    async fetch(url: string | Request, init?: RequestInit) {
      const call: Call = { url: String(url), method: init?.method, headers: new Headers(init?.headers), body: String(init?.body ?? '') };
      calls.push(call);
      if (init?.signal?.aborted) throw init.signal.reason;
      return respond(call);
    },
  };
  return { api, calls };
}
const deps = (api: ReturnType<typeof fakeApi>['api'], extra: Partial<ContactDeps> = {}): ContactDeps => ({
  env: { API: api },
  fallbackLimiter: createMemoryLimiter(),
  ...extra,
});

afterEach(() => vi.restoreAllMocks());

describe('submitContact: the call to the API Worker', () => {
  it('posts JSON to /api/public/contact through the service binding, with the visitor address in X-Sakem-Client-Ip and nothing else secret', async () => {
    const { api, calls } = fakeApi();
    const outcome = await submitContact(form(VALID), deps(api));
    expect(outcome).toEqual({ kind: 'sent', message: CONTACT_MESSAGES.success });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(new URL(call.url).pathname).toBe('/api/public/contact');
    expect(call.method).toBe('POST');
    expect(call.headers.get('content-type')).toBe('application/json');
    expect(call.headers.get(CLIENT_IP_HEADER)).toBe('203.0.113.9');
    expect(JSON.parse(call.body)).toEqual(VALID);
    // The binding is the authentication: no signature, no secret, no cookie or auth header of the visitor goes along.
    for (const name of ['x-sakem-signature', 'x-sakem-timestamp', 'authorization', 'cookie']) expect(call.headers.has(name), name).toBe(false);
  });

  it('sends the validated text: trimmed, the email lower-cased, an empty honeypot', async () => {
    const { api, calls } = fakeApi();
    await submitContact(form({ ...VALID, fullName: '  Budi  ', email: ' BUDI@Example.COM ', message: '  Halo, saya ingin bertanya.  ' }), deps(api));
    expect(JSON.parse(calls[0].body)).toEqual({ ...VALID, fullName: 'Budi', email: 'budi@example.com', message: 'Halo, saya ingin bertanya.' });
  });

  it('forwards the address of CF-Connecting-IP only: a client-supplied X-Sakem-Client-Ip or X-Forwarded-For is never trusted', async () => {
    const { api, calls } = fakeApi();
    await submitContact(form(VALID, { 'x-sakem-client-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2, 3.3.3.3' }), deps(api));
    expect(calls[0].headers.get(CLIENT_IP_HEADER)).toBe('203.0.113.9');
  });

  it.each([
    ['203.0.113.9', '203.0.113.9'],
    ['2001:db8::1', '2001:db8::1'],
    ['  198.51.100.4 ', '198.51.100.4'],
    ['', UNKNOWN_CLIENT_IP],
    ['not-an-ip', UNKNOWN_CLIENT_IP],
    ['999.1.1.1', UNKNOWN_CLIENT_IP],
    ['1.2.3', UNKNOWN_CLIENT_IP],
    ['1.2.3.4, 5.6.7.8', UNKNOWN_CLIENT_IP],
    ['::g', UNKNOWN_CLIENT_IP],
  ])('visitor address %j becomes %j', async (header, expected) => {
    const request = form(VALID, { 'cf-connecting-ip': header });
    expect(visitorIp(request)).toBe(expected);
    const { api, calls } = fakeApi();
    await submitContact(request, deps(api));
    expect(calls[0].headers.get(CLIENT_IP_HEADER)).toBe(expected);
  });

  it('a missing CF-Connecting-IP header puts the visitor in the shared "unknown" bucket (0.0.0.0, a valid literal for the API)', () => {
    const request = new Request(`${SITE}/kontak`, { method: 'POST' });
    expect(visitorIp(request)).toBe('0.0.0.0');
    expect(isIpLiteral(UNKNOWN_CLIENT_IP)).toBe(true);
  });

  it('prefers CONTACT_API_URL over the binding when it is set (local and CI), and only then', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      return Response.json({ ok: true }, { status: 201 });
    });
    const binding = fakeApi();
    const out = await submitContact(form(VALID), deps(binding.api, { env: { API: binding.api, CONTACT_API_URL: 'http://127.0.0.1:4391/' } }));
    expect(out.kind).toBe('sent');
    expect(calls).toEqual(['http://127.0.0.1:4391/api/public/contact']);
    expect(binding.calls).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('no API configured at all is "unavailable", not a crash', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const out = await submitContact(form(VALID), { env: {}, fallbackLimiter: createMemoryLimiter() });
    expect(out).toMatchObject({ kind: 'unavailable', message: CONTACT_MESSAGES.unavailable });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('submitContact: the status codes of the contract, mapped to the legacy messages', () => {
  const answer = (status: number, body: unknown, headers: Record<string, string> = {}) => () => Response.json(body, { status, headers });
  const run = async (respond: ReturnType<typeof answer>, request = form(VALID)): Promise<ContactOutcome> => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    return submitContact(request, deps(fakeApi(respond).api));
  };

  it('201 is sent, with the legacy success message whatever text the API sent', async () => {
    expect(await run(answer(201, { ok: true, message: 'anything' }))).toEqual({ kind: 'sent', message: CONTACT_MESSAGES.success });
  });

  it('400 validation_failed shows the API\'s field errors (only known fields, only short strings) and the legacy banner', async () => {
    const out = await run(
      answer(400, {
        error: 'validation_failed',
        message: 'ignored',
        fieldErrors: { email: ['Format email belum benar'], website: ['spam'], message: [3, '', 'x'.repeat(300), 'Tulis minimal 10 karakter'], fullName: 'nope' },
      }),
    );
    expect(out).toMatchObject({ kind: 'invalid', message: CONTACT_MESSAGES.invalid });
    if (out.kind === 'invalid') {
      expect(out.fieldErrors).toEqual({ email: ['Format email belum benar'], message: ['Tulis minimal 10 karakter'] });
      expect(out.values).toEqual({ fullName: 'Budi Santoso', email: 'budi@example.com', subject: 'other', message: VALID.message });
    }
  });

  it('429 rate_limited and duplicate_recent are two different messages, with Retry-After', async () => {
    const limited = await run(answer(429, { error: 'rate_limited', retryAfterSeconds: 42 }, { 'retry-after': '42' }));
    expect(limited).toMatchObject({ kind: 'rate_limited', message: CONTACT_MESSAGES.rateLimited, retryAfter: 42 });
    const dup = await run(answer(429, { error: 'duplicate_recent', retryAfterSeconds: 300 }, { 'retry-after': '300' }));
    expect(dup).toMatchObject({ kind: 'duplicate', message: CONTACT_MESSAGES.duplicate, retryAfter: 300 });
    // a 429 without a usable Retry-After falls back to a minute, or five for the duplicate; and is capped
    expect(await run(answer(429, { error: 'rate_limited' }))).toMatchObject({ kind: 'rate_limited', retryAfter: 60 });
    expect(await run(answer(429, { error: 'duplicate_recent' }))).toMatchObject({ kind: 'duplicate', retryAfter: 300 });
    expect(await run(answer(429, { error: 'rate_limited', retryAfterSeconds: 999_999 }))).toMatchObject({ retryAfter: 3600 });
  });

  it.each([
    [503, { error: 'service_unavailable' }],
    [500, { error: 'boom' }],
    [502, 'Bad gateway'],
    [401, { error: 'unauthorized', reason: 'missing_headers' }],
    [400, { error: 'invalid_client_ip' }],
    [400, { error: 'body_too_large' }],
    [400, { error: 'invalid_json' }],
    [404, { error: 'not_found' }],
    [418, {}],
  ])('%i %j is "unavailable": the visitor is not at fault and sees one plain sentence, with the typed text kept', async (status, body) => {
    const out = await run(() => (typeof body === 'string' ? new Response(body, { status }) : Response.json(body, { status })));
    expect(out).toMatchObject({ kind: 'unavailable', message: CONTACT_MESSAGES.unavailable });
    if (out.kind === 'unavailable') expect(out.values.message).toBe(VALID.message);
  });

  it('an API that cannot be reached, or that is too slow, is "unavailable" too', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const down = { fetch: async () => Promise.reject(new TypeError('connection refused')) };
    expect((await submitContact(form(VALID), deps(down))).kind).toBe('unavailable');
    const slow = { fetch: (_u: string | Request, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))) };
    const started = Date.now();
    expect((await submitContact(form(VALID), deps(slow, { timeoutMs: 30 }))).kind).toBe('unavailable');
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('submitContact: what never reaches the API', () => {
  it('a filled honeypot is answered like a success and nothing is sent', async () => {
    const { api, calls } = fakeApi();
    const out = await submitContact(form({ ...VALID, website: 'https://spam.example' }), deps(api));
    expect(out).toEqual({ kind: 'sent', message: CONTACT_MESSAGES.success });
    expect(calls).toHaveLength(0);
  });

  it('an invalid form shows the legacy messages, keeps the typed text and sends nothing', async () => {
    const { api, calls } = fakeApi();
    const out = await submitContact(form({ fullName: '', email: 'nope', subject: '', message: 'pendek', website: '' }), deps(api));
    expect(out).toMatchObject({
      kind: 'invalid',
      message: CONTACT_MESSAGES.invalid,
      fieldErrors: {
        fullName: [FIELD_MESSAGES.fullNameMin],
        email: [FIELD_MESSAGES.emailFormat],
        subject: [FIELD_MESSAGES.subject],
        message: [FIELD_MESSAGES.messageMin],
      },
      values: { email: 'nope', message: 'pendek' },
    });
    expect(calls).toHaveLength(0);
  });

  it('a cross-origin post is refused (a courtesy: the honeypot, validation and the limits are the protection)', async () => {
    const { api, calls } = fakeApi();
    const attempts: Record<string, string>[] = [{ origin: 'https://evil.example' }, { origin: 'null' }, { origin: SITE.replace('https', 'http') }, { 'sec-fetch-site': 'cross-site', origin: '' }];
    for (const headers of attempts) {
      const h: Record<string, string> = { ...headers };
      if (h.origin === '') delete h.origin;
      const request = new Request(`${SITE}/kontak`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...h }, body: new URLSearchParams(VALID) });
      expect(await submitContact(request, deps(api)), JSON.stringify(headers)).toEqual({ kind: 'forbidden' });
    }
    expect(calls).toHaveLength(0);
  });

  it('a refused post still has its body read (up to the cap), so the connection is left clean', async () => {
    const { api } = fakeApi();
    const request = form(VALID, { origin: 'https://evil.example' });
    expect(request.bodyUsed).toBe(false);
    expect(await submitContact(request, deps(api))).toEqual({ kind: 'forbidden' });
    expect(request.bodyUsed).toBe(true);
  });

  it('isSameOrigin: same host passes, a missing Origin passes, a www or LMS host does not', () => {
    const post = (headers: Record<string, string>) => new Request(`${SITE}/kontak`, { method: 'POST', headers });
    expect(isSameOrigin(post({ origin: SITE }))).toBe(true);
    expect(isSameOrigin(post({}))).toBe(true);
    expect(isSameOrigin(post({ origin: 'https://www.sakolakembara.org' }))).toBe(false);
    expect(isSameOrigin(post({ origin: 'https://lms.sakolakembara.org' }))).toBe(false);
    expect(isSameOrigin(post({ 'sec-fetch-site': 'same-origin', origin: SITE }))).toBe(true);
  });

  it('a body that is not a form, or is above 32 KiB, is refused before it is parsed', async () => {
    const { api, calls } = fakeApi();
    const json = new Request(`${SITE}/kontak`, { method: 'POST', headers: { 'content-type': 'application/json', origin: SITE }, body: JSON.stringify(VALID) });
    expect(await submitContact(json, deps(api))).toEqual({ kind: 'bad_request' });
    const big = form({ ...VALID, message: 'x'.repeat(MAX_BODY_BYTES) });
    expect(await submitContact(big, deps(api))).toEqual({ kind: 'too_large' });
    // no Content-Length (chunked): the cap is enforced while the body streams
    const chunk = new TextEncoder().encode(`message=${'x'.repeat(8 * 1024)}&`);
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(chunk);
      },
    });
    // `duplex: 'half'` is required for a streamed request body in Node and workerd.
    const init = { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: SITE }, body: stream, duplex: 'half' } as RequestInit;
    const chunked = new Request(`${SITE}/kontak`, init);
    expect(await submitContact(chunked, deps(api))).toEqual({ kind: 'too_large' });
    expect(calls).toHaveLength(0);
  });

  it('multipart/form-data posts work too', async () => {
    const { api } = fakeApi();
    const data = new FormData();
    for (const [k, v] of Object.entries(VALID)) data.set(k, v);
    const request = new Request(`${SITE}/kontak`, { method: 'POST', headers: { origin: SITE, 'cf-connecting-ip': '203.0.113.9' }, body: data });
    expect((await submitContact(request, deps(api))).kind).toBe('sent');
  });
});

describe('submitContact: the rate limit (5 per minute per visitor address)', () => {
  it('uses the binding when there is one: a refusal is a 429-kind outcome, the API is not called, and the key is the address', async () => {
    const { api, calls } = fakeApi();
    const keys: string[] = [];
    const limiter = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: false }) };
    const out = await submitContact(form(VALID), { env: { API: api, CONTACT_LIMITER: limiter } });
    expect(out).toMatchObject({ kind: 'rate_limited', message: CONTACT_MESSAGES.rateLimited, retryAfter: 60 });
    expect(keys).toEqual(['contact:203.0.113.9']);
    expect(calls).toHaveLength(0);
  });

  it('a binding that throws never takes the form down', async () => {
    const { api } = fakeApi();
    const limiter = { limit: async () => Promise.reject(new Error('binding broke')) };
    expect((await submitContact(form(VALID), { env: { API: api, CONTACT_LIMITER: limiter } })).kind).toBe('sent');
  });

  it('without the binding, an in-memory fixed window answers: the 6th post of one address in a minute is refused, another address is not', async () => {
    const { api } = fakeApi();
    const d = deps(api);
    const kinds: string[] = [];
    for (let i = 0; i < 7; i++) kinds.push((await submitContact(form(VALID), d)).kind);
    expect(kinds).toEqual(['sent', 'sent', 'sent', 'sent', 'sent', 'rate_limited', 'rate_limited']);
    expect((await submitContact(form(VALID, { 'cf-connecting-ip': '203.0.113.77' }), d)).kind).toBe('sent');
  });

  it('createMemoryLimiter: the window resets after a minute and memory is bounded', async () => {
    let now = 1_000_000;
    const limiter = createMemoryLimiter({ now: () => now, maxKeys: 50 });
    const hit = async (key: string) => (await limiter.limit({ key })).success;
    expect([await hit('a'), await hit('a'), await hit('a'), await hit('a'), await hit('a'), await hit('a')]).toEqual([true, true, true, true, true, false]);
    now += 59_000;
    expect(await hit('a')).toBe(false);
    now += 1_001;
    expect(await hit('a')).toBe(true);
    for (let i = 0; i < 500; i++) await hit(`k${i}`);
    expect(limiter.size()).toBeLessThanOrEqual(50);
  });
});

describe('submitContact: nothing personal is ever logged', () => {
  it('no console call, in any outcome, carries a name, an address or a message', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const secret = { fullName: 'Nama-Rahasia-Q7', email: 'rahasia-q7@example.com', subject: 'other', message: 'Isi pesan rahasia Q7 yang panjang.', website: '' };
    const answers: Array<() => Response> = [
      () => Response.json({ ok: true }, { status: 201 }),
      () => Response.json({ error: 'validation_failed', fieldErrors: { email: ['rahasia-q7@example.com'] } }, { status: 400 }),
      () => Response.json({ error: 'rate_limited' }, { status: 429 }),
      () => Response.json({ error: 'duplicate_recent' }, { status: 429 }),
      () => Response.json({ error: 'service_unavailable', echo: secret }, { status: 503 }),
      () => new Response(JSON.stringify(secret), { status: 500 }),
      () => Response.json({ error: 'Nama-Rahasia-Q7' }, { status: 400 }), // not a code word: must not be logged
    ];
    for (const respond of answers) await submitContact(form(secret), deps(fakeApi(respond).api));
    const down = { fetch: async () => Promise.reject(new TypeError(`could not reach ${secret.email}`)) };
    await submitContact(form(secret), deps(down));
    await submitContact(form({ ...secret, website: 'bot' }), deps(fakeApi().api));
    await submitContact(form({ ...secret, email: 'bad' }), deps(fakeApi().api));
    await submitContact(form(secret), { env: {}, fallbackLimiter: createMemoryLimiter() });

    const logged = spies.flatMap((s) => s.mock.calls).map((args) => JSON.stringify(args));
    expect(logged.length).toBeGreaterThan(0); // failures are logged, with fixed words only
    for (const line of logged) {
      for (const text of ['Nama-Rahasia-Q7', 'rahasia-q7@example.com', 'Isi pesan rahasia', '203.0.113.9']) expect(line, text).not.toContain(text);
    }
  });
});
