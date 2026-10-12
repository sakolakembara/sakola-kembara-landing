import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTACT_MESSAGES } from '~/lib/contact';
import { createMemoryLimiter } from '~/lib/contact-limit';
import { submitContact, type ContactDeps, type ContactOutcome } from '~/lib/contact-submit';
import {
  TURNSTILE_ACTION,
  TURNSTILE_MAX_TOKEN_LENGTH,
  TURNSTILE_MESSAGES,
  TURNSTILE_ORIGIN,
  TURNSTILE_RESPONSE_FIELD,
  TURNSTILE_SCRIPT_URL,
  TURNSTILE_TOKEN_HEADER,
  turnstileSiteKey,
  turnstileToken,
} from '~/lib/turnstile';
import { readRoot, readWeb, webRoot } from './helpers';

// The Turnstile bot check of /kontak: what the Astro Worker forwards to the API Worker and how it shows
// the answer (these tests), the widget's markup and its no-JavaScript notice (source level), the widget
// script (tests/turnstile-widget.test.ts, in a DOM), the whole thing against the built Worker with a DOM
// and a stand-in widget (scripts/e2e.mjs, groups "contact" and "turnstile"). The verification itself is
// the API Worker's (cf/admin, docs/cloudflare/auth.md): this Worker only carries the token.

const SITE = 'https://sakolakembara.org';
const VALID = { fullName: 'Budi Santoso', email: 'budi@example.com', subject: 'other', message: 'Halo, saya ingin bertanya soal program.', website: '' };
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

function form(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request(`${SITE}/kontak`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: SITE, 'cf-connecting-ip': '203.0.113.9', ...headers },
    body: new URLSearchParams(fields),
  });
}

interface Call {
  url: string;
  headers: Headers;
  body: string;
}
function fakeApi(respond: (call: Call) => Response = () => Response.json({ ok: true, message: 'x' }, { status: 201 })) {
  const calls: Call[] = [];
  return {
    calls,
    api: {
      async fetch(url: string | Request, init?: RequestInit) {
        const call = { url: String(url), headers: new Headers(init?.headers), body: String(init?.body ?? '') };
        calls.push(call);
        return respond(call);
      },
    },
  };
}
const deps = (api: ReturnType<typeof fakeApi>['api']): ContactDeps => ({ env: { API: api }, fallbackLimiter: createMemoryLimiter() });
const turnstileFailed = () => Response.json({ error: 'turnstile_failed', message: 'Verifikasi keamanan gagal. Muat ulang halaman lalu coba lagi.' }, { status: 400 });

afterEach(() => vi.restoreAllMocks());

describe('the token travels in a header, through the binding, and only the API decides', () => {
  it('forwards the form\'s cf-turnstile-response as X-Sakem-Turnstile-Token, and never puts it in the JSON body', async () => {
    const { api, calls } = fakeApi();
    const out = await submitContact(form({ ...VALID, [TURNSTILE_RESPONSE_FIELD]: TOKEN }), deps(api));
    expect(out).toEqual({ kind: 'sent', message: CONTACT_MESSAGES.success });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.get(TURNSTILE_TOKEN_HEADER)).toBe(TOKEN);
    expect(calls[0]!.headers.get('x-sakem-client-ip')).toBe('203.0.113.9');
    expect(JSON.parse(calls[0]!.body)).toEqual(VALID);
    expect(calls[0]!.body).not.toContain(TOKEN);
    expect(new URL(calls[0]!.url).pathname).toBe('/api/public/contact');
  });

  it('the header name is the API\'s (cf/admin/src/api/public/contact.ts) and the field name is Turnstile\'s', () => {
    expect(readRoot('cf/admin/src/api/public/contact.ts')).toContain(`TURNSTILE_TOKEN_HEADER = "${TURNSTILE_TOKEN_HEADER}"`);
    expect(TURNSTILE_RESPONSE_FIELD).toBe('cf-turnstile-response');
    expect(TURNSTILE_TOKEN_HEADER).toBe('x-sakem-turnstile-token');
  });

  it('a post without the field still goes to the API, with no header: this Worker never refuses for lack of a token (the API does, where a secret is set)', async () => {
    const { api, calls } = fakeApi();
    const out = await submitContact(form(VALID), deps(api));
    expect(out.kind).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.has(TURNSTILE_TOKEN_HEADER)).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['a space', ' '],
    ['a space inside', 'abc def'],
    ['a line break (header injection)', 'abc\r\nx-sakem-client-ip: 9.9.9.9'],
    ['a tab', 'abc\tdef'],
    ['non-ASCII', 'tökén'],
    ['over 2048 characters', 'a'.repeat(TURNSTILE_MAX_TOKEN_LENGTH + 1)],
  ])('a token that cannot travel in a header (%s) is treated as no token', async (_name, value) => {
    expect(turnstileToken({ [TURNSTILE_RESPONSE_FIELD]: value })).toBeNull();
    const { api, calls } = fakeApi();
    await submitContact(form({ ...VALID, [TURNSTILE_RESPONSE_FIELD]: value }), deps(api));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.has(TURNSTILE_TOKEN_HEADER)).toBe(false);
    expect(calls[0]!.headers.get('x-sakem-client-ip')).toBe('203.0.113.9');
  });

  it.each([
    ['a dummy token', TOKEN],
    ['a base64url-like token with dots, dashes and underscores', '0.AbC-_xyz.123_456-789'],
    ['the longest allowed', 'a'.repeat(TURNSTILE_MAX_TOKEN_LENGTH)],
  ])('%s is forwarded as it is', (_name, value) => {
    expect(turnstileToken({ [TURNSTILE_RESPONSE_FIELD]: value })).toBe(value);
  });

  it('anything that is not text is no token (a form field can be a file; the field can be absent)', () => {
    expect(turnstileToken({})).toBeNull();
    expect(turnstileToken({ [TURNSTILE_RESPONSE_FIELD]: new Blob(['x']) })).toBeNull();
    expect(turnstileToken({ [TURNSTILE_RESPONSE_FIELD]: 7 })).toBeNull();
    expect(turnstileToken({ [TURNSTILE_RESPONSE_FIELD]: undefined })).toBeNull();
  });

  it('a filled honeypot or an invalid form never reaches the API, so a token is never spent on them', async () => {
    const { api, calls } = fakeApi();
    expect((await submitContact(form({ ...VALID, website: 'spam', [TURNSTILE_RESPONSE_FIELD]: TOKEN }), deps(api))).kind).toBe('sent');
    expect((await submitContact(form({ ...VALID, email: 'nope', [TURNSTILE_RESPONSE_FIELD]: TOKEN }), deps(api))).kind).toBe('invalid');
    expect(calls).toHaveLength(0);
  });

  it('the token is not echoed back into the form values, and is not logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { api } = fakeApi(turnstileFailed);
    const out = await submitContact(form({ ...VALID, [TURNSTILE_RESPONSE_FIELD]: TOKEN }), deps(api));
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    const unavailable = await submitContact(form({ ...VALID, [TURNSTILE_RESPONSE_FIELD]: TOKEN }), deps(fakeApi(() => new Response('boom', { status: 500 })).api));
    expect(unavailable.kind).toBe('unavailable');
    for (const spy of [warn, error, log]) expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
  });
});

describe('the API\'s 400 turnstile_failed is shown as "Verifikasi gagal. Silakan coba lagi."', () => {
  const run = async (respond: () => Response, request = form({ ...VALID, [TURNSTILE_RESPONSE_FIELD]: TOKEN })): Promise<ContactOutcome> => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    return submitContact(request, deps(fakeApi(respond).api));
  };

  it('is its own outcome, with the new Indonesian sentence (not the legacy "unavailable"), and the typed text kept', async () => {
    const out = await run(turnstileFailed);
    expect(out).toEqual({
      kind: 'turnstile_failed',
      message: 'Verifikasi gagal. Silakan coba lagi.',
      values: { fullName: VALID.fullName, email: VALID.email, subject: VALID.subject, message: VALID.message },
    });
    expect(TURNSTILE_MESSAGES.failed).toBe('Verifikasi gagal. Silakan coba lagi.');
    expect(out.kind === 'turnstile_failed' && out.message).not.toBe(CONTACT_MESSAGES.unavailable);
  });

  it('the API\'s own wording is not shown (the site speaks for itself)', async () => {
    const out = await run(() => Response.json({ error: 'turnstile_failed', message: 'Sesuatu yang lain' }, { status: 400 }));
    expect(out).toMatchObject({ kind: 'turnstile_failed', message: TURNSTILE_MESSAGES.failed });
  });

  it('is not logged: it is the visitor\'s (or a bot\'s) outcome, not a fault', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await submitContact(form({ ...VALID, [TURNSTILE_RESPONSE_FIELD]: TOKEN }), deps(fakeApi(turnstileFailed).api));
    expect(warn).not.toHaveBeenCalled();
  });

  it('only a 400 with exactly that code: the same code with another status, and other 400s, stay "unavailable" or their own message', async () => {
    expect((await run(() => Response.json({ error: 'turnstile_failed' }, { status: 403 }))).kind).toBe('unavailable');
    expect((await run(() => Response.json({ error: 'turnstile_failed' }, { status: 500 }))).kind).toBe('unavailable');
    expect((await run(() => Response.json({ error: 'captcha_failed' }, { status: 400 }))).kind).toBe('unavailable');
    expect((await run(() => Response.json({ error: 'validation_failed', fieldErrors: {} }, { status: 400 }))).kind).toBe('invalid');
    // a production API Worker without its secret answers a plain 500: not the visitor's doing either
    expect((await run(() => Response.json({ error: 'internal' }, { status: 500 }))).kind).toBe('unavailable');
  });
});

describe('the site key: public, from the Worker var, never in the repo', () => {
  it('is the trimmed var, or null (and the Worker log says so, in fixed words)', () => {
    const warn = vi.fn();
    expect(turnstileSiteKey({ TURNSTILE_SITE_KEY: '  1x00000000000000000000AA  ' }, warn)).toBe('1x00000000000000000000AA');
    expect(warn).not.toHaveBeenCalled();
    for (const env of [{}, { TURNSTILE_SITE_KEY: '' }, { TURNSTILE_SITE_KEY: '   ' }]) expect(turnstileSiteKey(env, warn)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith('contact: TURNSTILE_SITE_KEY is not set; the form is rendered without the bot-check widget');
  });

  it('the repo holds only Cloudflare\'s published test key (dev.vars.example), and the config sets none', () => {
    const example = readWeb('dev.vars.example');
    expect(example).toContain('TURNSTILE_SITE_KEY=1x00000000000000000000AA');
    expect(readRoot('cf/admin/src/security/turnstile.ts')).toContain('alwaysPass: "1x00000000000000000000AA"');
    // no other Turnstile key shaped value in the web package's sources or config (site keys start with 0x, 1x, 2x or 3x)
    for (const file of sourceFiles()) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\b[0-3]x[0-9A-Za-z_-]{20,}\b/g)) {
        expect(m[0], `${path.relative(webRoot, file)}`).toBe('1x00000000000000000000AA');
      }
    }
  });
});

describe('the widget markup and the no-JavaScript notice (source level; the served page is checked in scripts/e2e.mjs)', () => {
  const component = readWeb('src/components/contact/ContactForm.astro');
  const page = readWeb('src/pages/kontak.astro');

  it('the slot sits inside the form, between the message and the button, with the site key and the action as data attributes', () => {
    const slot = component.indexOf('data-turnstile data-sitekey={turnstileSiteKey} data-action={TURNSTILE_ACTION}');
    expect(slot).toBeGreaterThan(component.indexOf('name="message"'));
    expect(slot).toBeLessThan(component.indexOf('<Button type="submit"'));
    expect(slot).toBeLessThan(component.indexOf('</form>'));
    expect(TURNSTILE_ACTION).toBe('contact'); // the action the API checks (cf/admin: `verifyTurnstile(..., "contact")`)
    expect(readRoot('cf/admin/src/public/contact-deps.ts')).toContain('"contact"');
    // the widget's height is reserved, so the page does not jump when it appears
    expect(component).toContain('min-h-[65px]');
  });

  it('the slot, the failure line and the notice exist only with a site key', () => {
    const block = component.slice(component.indexOf('turnstileSiteKey && ('), component.indexOf('<div class="pt-1">'));
    expect(block).toContain('data-turnstile ');
    expect(block).toContain('data-turnstile-failed');
    expect(block).toContain('<noscript>');
  });

  it('without JavaScript the form says "Aktifkan JavaScript untuk mengirim pesan." (inside <noscript>, in the warning colours)', () => {
    expect(TURNSTILE_MESSAGES.noScript).toBe('Aktifkan JavaScript untuk mengirim pesan.');
    const notice = component.slice(component.indexOf('<noscript>'), component.indexOf('</noscript>'));
    expect(notice).toContain('{TURNSTILE_MESSAGES.noScript}');
    expect(notice).toContain('border-warning-border bg-warning-bg text-warning-fg');
    // the same two tokens exist in the design system's alert
    expect(readRoot('components/ui/alert.tsx')).toContain('warning: "border-warning-border bg-warning-bg text-warning-fg"');
  });

  it('Cloudflare\'s script is a tag of the form component: explicit rendering, async, defer, only when there is a form and a key', () => {
    expect(TURNSTILE_SCRIPT_URL).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    expect(component).toContain('!sent && turnstileSiteKey && <script is:inline src={TURNSTILE_SCRIPT_URL} async defer data-turnstile-api />');
    expect(component).toContain("import '~/scripts/turnstile-widget';");
  });

  it('the script is on /kontak and nowhere else: no layout, other page or component names the URL or the widget', () => {
    const others = sourceFiles().filter((f) => !/(lib\/turnstile\.ts|scripts\/turnstile-widget\.ts|components\/contact\/ContactForm\.astro)$/.test(f));
    for (const file of others) {
      const text = readFileSync(file, 'utf8');
      expect(text, path.relative(webRoot, file)).not.toContain('challenges.cloudflare.com');
      expect(text, path.relative(webRoot, file)).not.toContain('turnstile-widget');
      expect(text, path.relative(webRoot, file)).not.toContain('TURNSTILE_SCRIPT_URL');
    }
    expect(readWeb('src/layouts/Base.astro')).not.toMatch(/turnstile/i);
    // ContactForm is rendered by /kontak only
    const users = sourceFiles().filter((f) => /import ContactForm from/.test(readFileSync(f, 'utf8')));
    expect(users.map((f) => path.relative(webRoot, f))).toEqual(['src/pages/kontak.astro']);
  });

  it('the page passes the key from the Worker var, hides the widget on the confirmation, and shows turnstile_failed as a 400 form', () => {
    expect(page).toContain('const turnstileKey = sent ? null : turnstileSiteKey(env);');
    expect(page).toContain('turnstileSiteKey={turnstileKey ?? undefined}');
    expect(page).toMatch(/case 'turnstile_failed':[\s\S]*?Astro\.response\.status = 400;[\s\S]*?\(\{ message, values \} = outcome\);[\s\S]*?break;/);
    expect(page).not.toMatch(/console\./);
  });

  it('the notice and the failure sentence are new copy (the legacy form had no bot check)', () => {
    const legacy = readRoot('app/(public)/kontak/_contact-form.tsx') + readRoot('app/(public)/kontak/actions.ts');
    expect(legacy).not.toContain(TURNSTILE_MESSAGES.failed);
    expect(legacy).not.toContain(TURNSTILE_MESSAGES.noScript);
  });
});

describe('no Content-Security-Policy to extend today, and the origin is named for the day there is one', () => {
  it('none of the Worker, its headers file, the pages or the legacy Caddyfile sets a CSP', () => {
    // (lib/turnstile.ts is left out: its comment is the one that says there is none)
    const places = [...sourceFiles().filter((f) => !f.endsWith(`lib${path.sep}turnstile.ts`)), path.join(webRoot, 'public/_headers'), path.join(webRoot, '../../Caddyfile')];
    for (const file of places) {
      if (!existsSync(file)) continue;
      expect(readFileSync(file, 'utf8'), path.relative(webRoot, file)).not.toMatch(/content-security-policy/i);
    }
  });

  it('TURNSTILE_ORIGIN is the origin of the script URL, the only origin the widget needs from the page', () => {
    expect(new URL(TURNSTILE_SCRIPT_URL).origin).toBe(TURNSTILE_ORIGIN);
  });
});

describe('the stand-in widget of the tests is not a switch in the site', () => {
  // The site has no flag that swaps Cloudflare's script for a stub, so there is nothing to turn on in
  // production. The DOM runs of scripts/e2e.mjs strip the script tag and evaluate scripts/lib/turnstile-stub.mjs
  // themselves. These checks pin that: the stub is outside src/, nothing in src/ can load another script URL, and
  // the build holds no trace of it.
  it('src/ has one script URL (Cloudflare\'s), no TURNSTILE_* var but the site key, and does not mention the stub', () => {
    const envReads = new Set<string>();
    for (const file of sourceFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text, path.relative(webRoot, file)).not.toMatch(/turnstile-stub|__turnstileStub|STUB_TOKEN|DUMMY\.TOKEN|probe-api/i);
      for (const m of text.matchAll(/\benv\.(TURNSTILE_[A-Z_]+)/g)) envReads.add(m[1]!);
    }
    // the one Worker var about Turnstile is the public site key, read and declared once
    expect([...envReads]).toEqual(['TURNSTILE_SITE_KEY']);
    expect([...readWeb('src/env.d.ts').matchAll(/\b(TURNSTILE_[A-Z_]+)\?:/g)].map((m) => m[1])).toEqual(['TURNSTILE_SITE_KEY']);
    // no way to point the page at another script: the script tag takes the constant, the module takes nothing from the page but data-*
    expect(readWeb('src/components/contact/ContactForm.astro')).toContain('src={TURNSTILE_SCRIPT_URL}');
    expect(readWeb('src/scripts/turnstile-widget.ts')).not.toMatch(/createElement\('script'\)|\.src\s*=|import\(/);
    const urls = sourceFiles().flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/https:\/\/challenges\.cloudflare\.com[^'"`\s)]*/g)].map((m) => m[0]));
    expect(new Set(urls.map((u) => u.replace(/[?].*$/, '')))).toEqual(new Set([TURNSTILE_ORIGIN, `${TURNSTILE_ORIGIN}/turnstile/v0/api.js`]));
  });

  it('the stub and the probe Worker live under scripts/, which the build does not read', () => {
    for (const file of ['scripts/lib/turnstile-stub.mjs', 'scripts/lib/probe-api-worker.mjs']) expect(existsSync(path.join(webRoot, file)), file).toBe(true);
    expect(readWeb('astro.config.mjs')).not.toMatch(/turnstile|stub|probe/i);
    expect(readWeb('vitest.config.ts')).not.toMatch(/turnstile|stub|probe/i);
  });

  it('a build of this tree (when dist/ exists) holds no trace of the stand-in or the probe, and names Cloudflare\'s script only in the /kontak form', () => {
    const dist = path.join(webRoot, 'dist');
    if (!existsSync(path.join(dist, 'server'))) return; // `pnpm build` has not run: the e2e run checks the served page as well
    const files = walkAll(dist).filter((f) => /\.(m?js|html|json|css)$/.test(f) && !/(e2e-wrangler|\.log)/.test(f) && !f.includes(`${path.sep}wrangler.`) && !f.endsWith('counting-entry.mjs'));
    expect(files.length).toBeGreaterThan(10);
    const withScriptUrl: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, path.relative(webRoot, file)).not.toMatch(/turnstile-stub|__turnstileStub|DUMMY\.TOKEN|probe-api-worker/);
      if (text.includes('challenges.cloudflare.com/turnstile/v0/api.js')) withScriptUrl.push(path.relative(dist, file));
    }
    // server code of the /kontak page only (it is rendered at request time); no prerendered page and no client asset has it
    expect(withScriptUrl.every((f) => f.startsWith(`server${path.sep}`))).toBe(true);
    expect(withScriptUrl.length).toBeGreaterThan(0);
    for (const f of walkAll(path.join(dist, 'client')).filter((x) => x.endsWith('.html'))) {
      expect(readFileSync(f, 'utf8'), path.relative(dist, f)).not.toContain('challenges.cloudflare.com');
    }
  });
});

function walkAll(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? walkAll(file) : [file];
  });
}

/** Every .ts and .astro file of src/ (the web package's own sources). */
function sourceFiles(): string[] {
  return walkAll(path.join(webRoot, 'src')).filter((f) => /\.(ts|astro)$/.test(f) && !f.includes(`${path.sep}generated${path.sep}`));
}
