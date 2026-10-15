import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_SLUGS,
  THRESHOLDS,
  USER_AGENT,
  aggregate,
  buildPlan,
  checkBase,
  createCaptureParser,
  eventFromTrace,
  isSlug,
  parseLine,
  percentile,
  renderReport,
  routeOf,
  verdictFor,
} from '../scripts/lib/staging-measure.mjs';
import { repoRoot, webRoot } from './helpers';

// scripts/measure-staging.mjs and scripts/lib/staging-measure.mjs (SAKEM-084; the portal's routes, `--portal` and the
// pretty-printed capture SAKEM-098). Every event below is MADE UP for
// this test from the documented fields of a trace item; none was recorded from Cloudflare. The CLI runs as a real
// child process against a stub server on loopback, which is how "it contacts nothing by default" is proven.

const T0 = 1_760_000_000_000;
const WEB = 'sakem-web-staging';
const ADMIN = 'sakem-admin-staging';
const PORTAL = 'sakem-portal-staging';

interface Fake {
  script?: string;
  url?: string;
  method?: string;
  status?: number;
  outcome?: string;
  cpu?: number | null;
  wall?: number | null;
  at?: number;
  ua?: string;
}

/** A `wrangler tail --format json` line: the documented keys (outcome, scriptName, eventTimestamp, event.request/response) and the trace item's cpuTime and wallTime. */
function tail(f: Fake): Record<string, unknown> {
  const event: Record<string, unknown> = {
    outcome: f.outcome ?? 'ok',
    scriptName: f.script ?? WEB,
    exceptions: [],
    logs: [],
    eventTimestamp: f.at ?? T0,
    event: {
      request: { url: f.url ?? `https://${WEB}.acme.workers.dev/blog`, method: f.method ?? 'GET', headers: f.ua ? { 'user-agent': f.ua } : {}, cf: {} },
      response: { status: f.status ?? 200 },
    },
  };
  if (f.cpu !== null && f.cpu !== undefined) event.cpuTime = f.cpu;
  if (f.wall !== null && f.wall !== undefined) event.wallTime = f.wall;
  return event;
}
const lines = (events: Record<string, unknown>[]) => events.map((e) => JSON.stringify(e));
const parse = (raw: string[], options = {}) => raw.map((line) => parseLine(line, options)).filter((r) => r !== null && r !== 'skip') as ReturnType<typeof eventFromTrace>[];

describe('checkBase: staging hosts only', () => {
  it('accepts a workers.dev origin over https, and a loopback address for a local rehearsal', () => {
    expect(checkBase('https://sakem-web-staging.acme.workers.dev')).toEqual({ origin: 'https://sakem-web-staging.acme.workers.dev', host: 'sakem-web-staging.acme.workers.dev', loopback: false });
    expect(checkBase('https://sakem-web-staging.acme.workers.dev/')).toMatchObject({ origin: 'https://sakem-web-staging.acme.workers.dev' });
    expect(checkBase('http://127.0.0.1:4321')).toMatchObject({ host: '127.0.0.1:4321', loopback: true });
    expect(checkBase('http://localhost:8787')).toMatchObject({ loopback: true });
  });

  it('refuses the production domain and every host of it, with no way around it', () => {
    for (const bad of ['https://sakolakembara.org', 'https://www.sakolakembara.org', 'https://admin.sakolakembara.org', 'https://files.sakolakembara.org', 'https://SAKOLAKEMBARA.ORG']) {
      expect(() => checkBase(bad), bad).toThrow(/production domain/);
    }
  });

  it('refuses any other host, plain http off loopback, paths, queries and credentials', () => {
    for (const bad of ['https://example.com', 'https://workers.dev.evil.example', 'http://sakem-web-staging.acme.workers.dev', 'https://x.acme.workers.dev/blog', 'https://x.acme.workers.dev/?a=1', 'https://u:p@x.acme.workers.dev', 'ftp://127.0.0.1', 'nonsense', '']) {
      expect(() => checkBase(bad), bad).toThrow();
    }
  });
});

describe('the plan', () => {
  it('is GET only by default: controls first, then the Worker routes, with the longest article among them', () => {
    const plan = buildPlan({ web: true });
    expect(new Set(plan.map((r) => r.method))).toEqual(new Set(['GET']));
    const paths = plan.map((r) => r.path);
    for (const expected of ['/', '/blog', '/blog?page=2', `/blog/${DEFAULT_SLUGS[0]}`, '/tim', '/laporan', '/gabung-siswa/docs', '/kontak', '/sitemap.xml', '/no/such/page', '/portal/api/auth/get-session']) expect(paths).toContain(expected);
    expect(plan.filter((r) => r.worker === 'none').map((r) => r.path)).toEqual(['/', '/gabung-siswa', '/robots.txt', '/feed']);
    expect(plan.some((r) => 'body' in r)).toBe(false);
  });

  it('a real short link replaces the unknown one; the admin routes need --admin and are GET only too', () => {
    expect(buildPlan({ web: true, shortlink: 'daftar-uji' }).map((r) => r.path)).toContain('/daftar-uji');
    expect(buildPlan({ web: true }).map((r) => r.path)).toContain('/measure-unknown-slug');
    expect(buildPlan({ web: true }).some((r) => r.target === 'admin')).toBe(false);
    const admin = buildPlan({ web: false, admin: true });
    expect(admin.map((r) => r.path)).toEqual(['/', '/login', '/api/config', '/api/me', '/api/dashboard', '/api/admin/blog', '/uploads/probe', '/api/public/team']);
    expect(new Set(admin.map((r) => r.method))).toEqual(new Set(['GET']));
  });

  it('the portal: two controls (the SPA) and the GET routes that need no cookie, all on the portal host and none behind a limiter', () => {
    const portal = buildPlan({ web: false, portal: true });
    expect(portal.map((r) => r.path)).toEqual([
      '/portal/',
      '/portal/status',
      '/portal/api/config',
      '/portal/api/me',
      '/portal/api/auth/get-session',
      '/portal/api/overview',
      '/portal/api/applications/current',
      '/portal/api/applications',
      '/portal/api/files/00000000-0000-4000-8000-000000000000',
      '/portal/api/auth/list-sessions',
      '/portal/api/no-such-route',
      '/portal/api/dev/mailbox',
      '/portal/no-such-file.png',
    ]);
    expect(new Set(portal.map((r) => r.target))).toEqual(new Set(['portal']));
    expect(new Set(portal.map((r) => r.method))).toEqual(new Set(['GET']));
    expect(portal.filter((r) => r.worker === 'none').map((r) => r.path)).toEqual(['/portal/', '/portal/status']);
    expect(portal.filter((r) => r.worker === 'portal')).toHaveLength(11);
    // No body, no pause longer than the others (nothing here is behind a rate limit), no cookie or credential of any kind.
    // (No Sec-Fetch-* header either: Node's fetch sets `Sec-Fetch-Mode: cors` itself and ignores what is given.)
    for (const route of portal) {
      expect('body' in route).toBe(false);
      expect(route.minDelayMs).toBeUndefined();
      expect(Object.keys(route.headers ?? {}).join(' ')).not.toMatch(/authorization|cookie|token|x-api|cf-access/i);
    }
    // Nothing that signs in, registers, saves, uploads or submits: a student's routes are asked without a session and answer 401.
    expect(portal.map((r) => r.path).join(' ')).not.toMatch(/sign-in|register|reset|verify|steps|submit|upload/);
  });

  it('every route the portal plan asks is a route of the portal Worker or of its SPA (read from the Worker, so a renamed route breaks this)', () => {
    const worker = readFileSync(path.join(repoRoot, 'cf/admin/src/portal/worker.ts'), 'utf8');
    const applications = readFileSync(path.join(repoRoot, 'cf/admin/src/portal/applications.ts'), 'utf8');
    const files = readFileSync(path.join(repoRoot, 'cf/admin/src/portal/files.ts'), 'utf8');
    const gate = readFileSync(path.join(repoRoot, 'cf/admin/src/auth/gate.ts'), 'utf8');
    expect(worker).toContain('const API = "/portal/api";');
    expect(worker).toContain('app.get(`${API}/config`');
    expect(worker).toContain('app.get(`${API}/me`');
    expect(worker).toContain('app.get(`${AUTH}/get-session`');
    expect(worker).toContain('app.get(`${API}/dev/mailbox`');
    expect(applications).toContain('app.get("/overview", requireStudent("portalRead")');
    expect(applications).toContain('app.get("/applications/current", requireStudent("portalRead")');
    expect(applications).toContain('app.get("/applications", requireStudent("portalRead")');
    expect(files).toContain('fileRoutes.get("/files/:fileId", requireStudent("portalRead")');
    // `list-sessions` is deliberately NOT in the auth route table (the gate answers 404), `get-session` is.
    expect(gate).toContain('path: "/get-session"');
    expect(gate).not.toContain('path: "/list-sessions"');
    // The Worker runs first for /portal/api/* only (wrangler.portal.jsonc), so the two controls are the assets layer's.
    expect(readFileSync(path.join(repoRoot, 'cf/admin/wrangler.portal.jsonc'), 'utf8')).toContain('"run_worker_first": ["/portal/api/*"]');
  });

  it('--writes adds exactly two POSTs, both refused before anything is stored, with a pause that respects their rate limit', () => {
    const plan = buildPlan({ web: true, admin: true, writes: true });
    const posts = plan.filter((r) => r.method !== 'GET');
    expect(posts.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /kontak', 'POST /api/auth/sign-in/email']);
    // The portal adds none: its part of the probe is GET only, with writes asked for or not.
    expect(buildPlan({ web: true, admin: true, portal: true, writes: true }).filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`)).toEqual(['POST /kontak', 'POST /api/auth/sign-in/email']);
    for (const post of posts) {
      expect(post.minDelayMs).toBeGreaterThanOrEqual(12_000);
      expect(post.body).not.toMatch(/cf-turnstile-response|"password":"(?!not-a-real)/i);
      expect(post.body).toContain('example.invalid');
    }
  });

  it('slugs are checked against the site grammar, and the defaults satisfy it', () => {
    for (const slug of DEFAULT_SLUGS) expect(isSlug(slug)).toBe(true);
    for (const bad of ['', 'A', '../etc', 'a b', 'a/b', '-x', 'x'.repeat(201)]) expect(isSlug(bad), bad).toBe(false);
  });

  it('identifies itself in the user agent', () => {
    expect(USER_AGENT).toMatch(/^sakem-staging-measure\/1\.0 \(SAKEM-084/);
  });
});

describe('routeOf', () => {
  it('drops the query, folds ids and keeps the article slug (or groups it)', () => {
    expect(routeOf('/blog')).toBe('/blog');
    expect(routeOf('/blog/macam-macam-gaya-belajar')).toBe('/blog/macam-macam-gaya-belajar');
    expect(routeOf('/blog/macam-macam-gaya-belajar', { groupSlugs: true })).toBe('/blog/:slug');
    expect(routeOf('/blog/page/2', { groupSlugs: true })).toBe('/blog/page/:n');
    expect(routeOf('/api/admin/blog/e33ea14b-d0c9-4594-b713-8fedbe660f08')).toBe('/api/admin/blog/:id');
    expect(routeOf('/api/admin/uploads/e33ea14b-d0c9-4594-b713-8fedbe660f08/')).toBe('/api/admin/uploads/:id');
    expect(routeOf('/api/admin/users/aB3dE5gH7jK9mN1pQ3sT5vX7zA2cE4gI')).toBe('/api/admin/users/:id');
    expect(routeOf('/api/admin/messages/42')).toBe('/api/admin/messages/:n');
    expect(routeOf('/')).toBe('/');
    expect(routeOf('/api/auth/sign-in/email')).toBe('/api/auth/sign-in/email');
  });

  it('the portal: the file route folds its id, the others keep their names', () => {
    expect(routeOf('/portal/api/files/c0ffee00-0000-4000-8000-000000000003')).toBe('/portal/api/files/:id');
    expect(routeOf('/portal/api/files/00000000-0000-4000-8000-000000000000')).toBe('/portal/api/files/:id');
    expect(routeOf('/portal/api/applications/current/files/family-card')).toBe('/portal/api/applications/current/files/family-card');
    expect(routeOf('/portal/api/applications/current/steps/identity')).toBe('/portal/api/applications/current/steps/identity');
    expect(routeOf('/portal/api/auth/verify-email')).toBe('/portal/api/auth/verify-email');
    expect(routeOf('/portal/')).toBe('/portal');
  });
});

describe('reading a tail event', () => {
  it('reads the documented fields: outcome, script, time, request, status, and the trace item\'s cpuTime and wallTime', () => {
    const record = eventFromTrace(tail({ cpu: 3, wall: 41, url: 'https://x.acme.workers.dev/blog/abc?utm=1', status: 200, at: T0 + 5, ua: 'curl/8' }));
    expect(record).toEqual({
      kind: 'fetch', script: WEB, outcome: 'ok', cpuMs: 3, wallMs: 41, at: T0 + 5, exceptions: 0, userAgent: 'curl/8', method: 'GET', route: '/blog/abc', status: 200,
    });
  });

  it('an event with no CPU field is still an event (outcome and status count), with cpuMs null', () => {
    expect(eventFromTrace(tail({}))).toMatchObject({ kind: 'fetch', cpuMs: null, wallMs: null, outcome: 'ok', status: 200 });
  });

  it('tolerates the Logpush names and the Workers Logs nesting', () => {
    const logpush = { Outcome: 'ok', ScriptName: ADMIN, CPUTimeMs: 7, WallTimeMs: 90, EventTimestampMs: T0, Event: { Request: { URL: `https://${ADMIN}.acme.workers.dev/api/me`, Method: 'get' }, Response: { Status: 401 } } };
    expect(eventFromTrace(logpush)).toMatchObject({ script: ADMIN, cpuMs: 7, wallMs: 90, method: 'GET', route: '/api/me', status: 401, outcome: 'ok' });
    const logs = { $workers: { scriptName: WEB, outcome: 'exceededCpu', cpuTimeMs: 11, wallTimeMs: 12, event: { request: { url: 'https://x.acme.workers.dev/tim', method: 'GET' }, response: { status: 503 } } } };
    expect(eventFromTrace(logs)).toMatchObject({ script: WEB, cpuMs: 11, outcome: 'exceededCpu', route: '/tim', status: 503 });
  });

  it('a negative, non-finite or text CPU time is no CPU time', () => {
    const cpuOf = (cpuTime: unknown) => (eventFromTrace({ ...tail({}), cpuTime }) as { cpuMs: number | null } | null)?.cpuMs ?? null;
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, '4', null, {}]) expect(cpuOf(bad), String(bad)).toBeNull();
    expect(cpuOf(0)).toBe(0);
  });

  it('a cron and an RPC invocation get their own rows', () => {
    expect(eventFromTrace({ outcome: 'ok', scriptName: ADMIN, eventTimestamp: T0, cpuTime: 2, wallTime: 30, event: { cron: '17 3 * * *', scheduledTime: T0 } })).toMatchObject({ kind: 'scheduled', method: 'CRON', route: '17 3 * * *', cpuMs: 2 });
    expect(eventFromTrace({ outcome: 'ok', scriptName: ADMIN, entrypoint: 'PublicApi', eventTimestamp: T0, cpuTime: 1, event: { rpcMethod: 'listBlog' } })).toMatchObject({ kind: 'rpc', route: 'PublicApi.listBlog' });
  });

  it('wrangler\'s overload notice is a notice, not an invocation', () => {
    expect(eventFromTrace({ outcome: 'ok', event: { type: 'overload', message: 'dropped' } })).toEqual({ kind: 'info', info: 'overload' });
  });

  it('things that are not invocations are null', () => {
    for (const bad of [null, 3, 'x', [], {}, { event: {} }, { event: { request: {} } }, { event: { request: { url: 'not a url' } } }]) expect(eventFromTrace(bad as never), JSON.stringify(bad)).toBeNull();
  });
});

describe('reading a capture: parseLine', () => {
  it('blank lines are nothing, wrangler banner lines and broken JSON are skipped, a good line is a record', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('   \t')).toBeNull();
    expect(parseLine('Successfully created tail, expires at 2026-10-13T12:00:00Z')).toBe('skip');
    expect(parseLine('Connected to sakem-web-staging, waiting for logs...')).toBe('skip');
    expect(parseLine('{"outcome":"ok","scriptName":"x"')).toBe('skip');
    expect(parseLine('{"truncated": ')).toBe('skip');
    expect(parseLine('{}')).toBe('skip');
    expect(parseLine('[1,2]')).toBe('skip');
    expect(parseLine(JSON.stringify(tail({ cpu: 2 })))).toMatchObject({ kind: 'fetch', cpuMs: 2 });
  });
});

/** The object as `wrangler tail --format json` prints it: `JSON.stringify(event, null, 2)`, many lines, `}` alone at the start of the last one. */
const pretty = (f: Fake) => JSON.stringify(tail(f), null, 2);

/** What wrangler prints before the first event. */
const BANNER = ['Successfully created tail, expires at 2026-10-15T14:10:21Z', 'Connected to sakem-portal-staging, waiting for logs...'];

const readCapture = (text: string, options = {}) => {
  const parser = createCaptureParser(options);
  for (const line of text.split('\n')) parser.push(line);
  return parser.end();
};

describe('reading a capture: createCaptureParser (pretty-printed objects, compact lines, and the mixture)', () => {
  const portalEvent = (over: Fake = {}): Fake => ({ script: PORTAL, url: `https://${PORTAL}.acme.workers.dev/portal/api/config`, cpu: 2, wall: 14, ua: USER_AGENT, ...over });

  it('a pretty-printed capture (what wrangler writes: banner, then objects of many lines) is read, event by event', () => {
    const text = [...BANNER, pretty(portalEvent({ at: T0 })), pretty(portalEvent({ at: T0 + 700, url: `https://${PORTAL}.acme.workers.dev/portal/api/me`, status: 401 })), ''].join('\n');
    expect(text.split('\n').length).toBeGreaterThan(40); // many lines per object: this is not a one-line-per-event file
    const result = readCapture(text);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({ kind: 'fetch', script: PORTAL, cpuMs: 2, wallMs: 14, method: 'GET', route: '/portal/api/config', status: 200, userAgent: USER_AGENT });
    expect(result.records[1]).toMatchObject({ route: '/portal/api/me', status: 401, at: T0 + 700 });
    expect(result.read).toBe(4); // two banner lines and two objects
    expect(result.skipped).toBe(2); // the banner lines
  });

  it('is the same data as the compact form: the same events give the same report, however they were printed', () => {
    const events = Array.from({ length: 24 }, (_, i) => portalEvent({ at: T0 + i * 800, cpu: 1 + (i % 4), url: `https://${PORTAL}.acme.workers.dev/portal/api/${i % 2 ? 'me' : 'config'}`, status: i % 2 ? 401 : 200 }));
    const compact = readCapture(events.map((e) => JSON.stringify(tail(e))).join('\n'));
    const spread = readCapture([...BANNER, ...events.map((e) => pretty(e))].join('\n'));
    const blank = readCapture([...BANNER, ...events.map((e) => `${pretty(e)}\n`)].join('\n')); // a blank line between two objects
    const crlf = readCapture([...BANNER, ...events.map((e) => pretty(e))].join('\n').replaceAll('\n', '\r\n')); // every line ends in \r\n
    expect(spread.records).toEqual(compact.records);
    expect(blank.records).toEqual(compact.records);
    expect(crlf.records).toEqual(compact.records);
    expect(aggregate(spread.records as never)).toEqual(aggregate(compact.records as never));
    expect(compact.skipped).toBe(0);
    expect(spread.skipped).toBe(2);
  });

  it('compact and pretty-printed objects in one capture, with text between them, are all read', () => {
    const text = [pretty(portalEvent({ at: T0 })), 'a line of text', JSON.stringify(tail(portalEvent({ at: T0 + 1 }))), pretty(portalEvent({ at: T0 + 2 })), '[1,2]', ''].join('\n');
    const result = readCapture(text);
    expect(result.records.map((r) => (r as { at: number }).at)).toEqual([T0, T0 + 1, T0 + 2]);
    expect(result.skipped).toBe(2); // the text and the array
  });

  it('braces, brackets and quotes inside a string do not confuse it: only indentation and a closing brace at the start of a line do', () => {
    const odd = tail(portalEvent({ at: T0, url: `https://${PORTAL}.acme.workers.dev/portal/api/config?x=%7B%7D&y={z}` }));
    (odd.event as { request: { headers: Record<string, string> } }).request.headers['x-note'] = '}\n{ "a": [1, 2 ], } "';
    const result = readCapture(JSON.stringify(odd, null, 2));
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ route: '/portal/api/config', status: 200 });
  });

  it('an object that was cut never swallows the ones after it: it is one skipped item, and the next object is read', () => {
    const whole = pretty(portalEvent({ at: T0 + 10 }));
    const cutAt = whole.split('\n').slice(0, 9).join('\n'); // stops in the middle of "event"
    // a tail killed mid-object and restarted: the banner comes back, then whole objects
    const result = readCapture([pretty(portalEvent({ at: T0 })), cutAt, ...BANNER, whole, pretty(portalEvent({ at: T0 + 20 })), ''].join('\n'));
    expect(result.records.map((r) => (r as { at: number }).at)).toEqual([T0, T0 + 10, T0 + 20]);
    expect(result.skipped).toBe(3); // the cut object and the two banner lines
    // a cut one right before a compact line, and a cut one at the end of the input
    const compactAfterCut = readCapture([cutAt, JSON.stringify(tail(portalEvent({ at: T0 + 30 })))].join('\n'));
    expect(compactAfterCut.records).toHaveLength(1);
    expect(compactAfterCut.skipped).toBe(1);
    const atTheEnd = readCapture([pretty(portalEvent({ at: T0 })), cutAt].join('\n'));
    expect(atTheEnd.records).toHaveLength(1);
    expect(atTheEnd.skipped).toBe(1);
    expect(atTheEnd.read).toBe(2);
  });

  it('JSON that is complete but is not an invocation is one skipped item (a pretty-printed one too)', () => {
    const result = readCapture(['{}', '{', '  "hello": "world"', '}', '{"event":{}}', ''].join('\n'));
    expect(result.records).toHaveLength(0);
    expect(result.read).toBe(3);
    expect(result.skipped).toBe(3);
  });

  it('an overload notice, a cron and an RPC call are read from a pretty-printed capture as they are from a compact one', () => {
    const notice = JSON.stringify({ outcome: 'ok', event: { type: 'overload', message: 'Tail is currently in sampling mode' } }, null, 2);
    const cron = JSON.stringify({ outcome: 'ok', scriptName: ADMIN, eventTimestamp: T0, cpuTime: 2, wallTime: 30, event: { cron: '17 3 * * *', scheduledTime: T0 } }, null, 2);
    const result = readCapture([notice, cron].join('\n'));
    expect(result.records).toMatchObject([{ kind: 'info', info: 'overload' }, { kind: 'scheduled', route: '17 3 * * *', cpuMs: 2 }]);
  });

  it('groups the articles on request, as the compact reader does', () => {
    const text = pretty({ url: `https://${WEB}.acme.workers.dev/blog/macam-macam-gaya-belajar`, cpu: 3 });
    expect(readCapture(text).records[0]).toMatchObject({ route: '/blog/macam-macam-gaya-belajar' });
    expect(readCapture(text, { groupSlugs: true }).records[0]).toMatchObject({ route: '/blog/:slug' });
  });

  it('empty input reads nothing', () => {
    expect(readCapture('')).toEqual({ records: [], read: 0, skipped: 0 });
    expect(createCaptureParser().end()).toEqual({ records: [], read: 0, skipped: 0 });
  });
});

describe('percentile and the verdict', () => {
  it('nearest rank: with few samples p99 is the maximum', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4], 0.99)).toBe(4);
    expect(percentile([5], 0.99)).toBe(5);
    expect(percentile([], 0.5)).toBeNull();
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect([percentile(hundred, 0.5), percentile(hundred, 0.95), percentile(hundred, 0.99)]).toEqual([50, 95, 99]);
  });

  const cpu = (p99: number, max = p99) => ({ n: 30, p50: 1, p95: 2, p99, max });
  it('OK below 5 ms, RISK from 5 to 8 (or a maximum from 8 to 10), FAIL above the gate, at the limit, or on any exceededCpu', () => {
    expect(verdictFor({ cpu: cpu(4), outcomes: { ok: 30 }, n: 30 }).verdict).toBe('OK');
    expect(verdictFor({ cpu: cpu(5), outcomes: { ok: 30 }, n: 30 }).verdict).toBe('RISK');
    expect(verdictFor({ cpu: cpu(8), outcomes: { ok: 30 }, n: 30 }).verdict).toBe('RISK');
    expect(verdictFor({ cpu: cpu(3, 9), outcomes: { ok: 30 }, n: 30 }).verdict).toBe('RISK');
    expect(verdictFor({ cpu: cpu(9), outcomes: { ok: 30 }, n: 30 }).verdict).toBe('FAIL');
    expect(verdictFor({ cpu: cpu(3, 10), outcomes: { ok: 30 }, n: 30 }).verdict).toBe('FAIL');
    const stopped = verdictFor({ cpu: cpu(2), outcomes: { ok: 29, exceededCpu: 1 }, n: 30 });
    expect(stopped.verdict).toBe('FAIL');
    expect(stopped.reasons.join(' ')).toContain('1102');
    expect(verdictFor({ cpu: cpu(2), outcomes: { exceededMemory: 1 }, n: 30 }).verdict).toBe('FAIL');
  });

  it('no CPU data is its own verdict, and a small sample is said out loud', () => {
    expect(verdictFor({ cpu: null, outcomes: { ok: 3 }, n: 3 }).verdict).toBe('NO-CPU');
    const small = verdictFor({ cpu: cpu(1), outcomes: { ok: 3 }, n: 3 });
    expect(small.verdict).toBe('OK');
    expect(small.reasons.join(' ')).toMatch(/only 3 samples/);
    expect(THRESHOLDS.minSamples).toBe(10);
  });

  it('the thresholds are the documented ones, with the gate inside the limit', () => {
    expect(THRESHOLDS).toMatchObject({ okBelowMs: 5, gateMs: 8, limitMs: 10 });
  });
});

/** A made-up capture: five routes, a cold start, a 1102, banner lines and broken JSON. */
function capture(): string[] {
  const events: Record<string, unknown>[] = [];
  let t = T0;
  const at = (gap: number) => (t += gap);
  // /blog: warm and cheap, 20 invocations 2 s apart (CPU 1-3 ms), the very first of the capture is "after idle"
  for (let i = 0; i < 20; i++) events.push(tail({ url: `https://${WEB}.acme.workers.dev/blog?page=1`, cpu: 1 + (i % 3), wall: 30 + i, at: at(i === 0 ? 0 : 2000), ua: USER_AGENT }));
  // a long article, after 3 minutes of silence: the cold start costs more (9 ms) than the warm ones (4-5 ms)
  events.push(tail({ url: `https://${WEB}.acme.workers.dev/blog/macam-macam-gaya-belajar`, cpu: 9, wall: 120, at: at(180_000), ua: USER_AGENT }));
  for (let i = 0; i < 11; i++) events.push(tail({ url: `https://${WEB}.acme.workers.dev/blog/macam-macam-gaya-belajar`, cpu: 4 + (i % 2), wall: 50, at: at(2000), ua: USER_AGENT }));
  // sign-in on the admin Worker, driven by hand in a browser (another user agent): 10 invocations, one stopped for CPU
  for (let i = 0; i < 9; i++) events.push(tail({ script: ADMIN, url: `https://${ADMIN}.acme.workers.dev/api/auth/sign-in/email`, method: 'POST', cpu: 6 + (i % 3), wall: 60, at: at(5000), ua: 'Mozilla/5.0' }));
  events.push(tail({ script: ADMIN, url: `https://${ADMIN}.acme.workers.dev/api/auth/sign-in/email`, method: 'POST', status: 503, outcome: 'exceededCpu', cpu: 10, wall: 70, at: at(5000), ua: 'Mozilla/5.0' }));
  // a route whose events carry no CPU time at all
  for (let i = 0; i < 3; i++) events.push(tail({ url: `https://${WEB}.acme.workers.dev/tim`, at: at(1000), ua: USER_AGENT }));
  // ids fold into one row
  events.push(tail({ script: ADMIN, url: `https://${ADMIN}.acme.workers.dev/api/admin/blog/e33ea14b-d0c9-4594-b713-8fedbe660f08`, cpu: 5, at: at(1000) }));
  events.push(tail({ script: ADMIN, url: `https://${ADMIN}.acme.workers.dev/api/admin/blog/59398c69-ae60-431a-bcb7-065dda1b0565`, cpu: 6, at: at(1000) }));
  return [
    'Successfully created tail, expires at 2026-10-13T12:00:00Z',
    'Connected to sakem-web-staging, waiting for logs...',
    ...lines(events.slice(0, 5)),
    '{"outcome":"ok","scriptName":"sakem-web-staging","eventTimestamp":17600',
    '',
    'not json at all',
    ...lines(events.slice(5)),
    JSON.stringify({ outcome: 'ok', event: { type: 'overload', message: 'Tail is currently in sampling mode' } }),
  ];
}

describe('aggregate over a made-up capture', () => {
  const records = parse(capture(), {});
  const report = aggregate(records as never);
  const row = (script: string, method: string, route: string) => report.routes.find((r) => r.script === script && r.method === method && r.route === route)!;

  it('reads every event and skips the rest (banner lines, a cut line, text, the blank)', () => {
    expect(records.length).toBe(20 + 12 + 10 + 3 + 2 + 1); // the 1 is the overload notice
    expect(report.events).toBe(20 + 12 + 10 + 3 + 2);
    expect(report.overloads).toBe(1);
  });

  it('one row per Worker, method and route: the blog list, the long article, the sign-in, the team page, the folded id', () => {
    expect(report.routes.map((r) => `${r.script} ${r.method} ${r.route}`).sort()).toEqual([
      `${ADMIN} GET /api/admin/blog/:id`,
      `${ADMIN} POST /api/auth/sign-in/email`,
      `${WEB} GET /blog`,
      `${WEB} GET /blog/macam-macam-gaya-belajar`,
      `${WEB} GET /tim`,
    ]);
    expect(row(ADMIN, 'GET', '/api/admin/blog/:id').n).toBe(2);
  });

  it('count, p50, p95, p99, max of the CPU time per route, from the sorted values', () => {
    const blog = row(WEB, 'GET', '/blog');
    expect(blog.n).toBe(20);
    expect(blog.cpu).toEqual({ n: 20, p50: 2, p95: 3, p99: 3, max: 3 });
    expect(blog.wall).toMatchObject({ n: 20, max: 49 });
    expect(blog.statuses).toEqual({ '200': 20 });
    const article = row(WEB, 'GET', '/blog/macam-macam-gaya-belajar');
    expect(article.cpu).toEqual({ n: 12, p50: 4, p95: 9, p99: 9, max: 9 });
    expect(article.verdict).toBe('FAIL'); // p99 of 12 samples is the 9 ms cold start: above the 8 ms gate
  });

  it('a cold start is told apart by the gap before it: it is reported as "after idle", with its own maximum', () => {
    const article = row(WEB, 'GET', '/blog/macam-macam-gaya-belajar');
    expect(article.afterIdle).toEqual({ n: 1, maxCpuMs: 9 });
    // the first invocation of each Worker is "after idle" too
    expect(row(WEB, 'GET', '/blog').afterIdle).toEqual({ n: 1, maxCpuMs: 1 });
    expect(row(ADMIN, 'POST', '/api/auth/sign-in/email').afterIdle).toEqual({ n: 1, maxCpuMs: 6 });
  });

  it('a 1102 is an exceededCpu outcome: the route fails, whatever its percentiles say', () => {
    const signIn = row(ADMIN, 'POST', '/api/auth/sign-in/email');
    expect(signIn.outcomes).toEqual({ ok: 9, exceededCpu: 1 });
    expect(signIn.statuses).toEqual({ '200': 9, '503': 1 });
    expect(signIn.verdict).toBe('FAIL');
    expect(signIn.reasons.join(' ')).toMatch(/1 x exceededCpu.*1102/);
  });

  it('a route without CPU data says so; the overall verdict fails because a route failed, and the dropped events are named', () => {
    expect(row(WEB, 'GET', '/tim')).toMatchObject({ n: 3, cpu: null, verdict: 'NO-CPU' });
    expect(report.overall.verdict).toBe('FAIL');
    expect(report.overall.reasons.join(' ')).toMatch(/overload/);
  });

  it('routes are listed worst first, and the text report carries the numbers and the overall line', () => {
    expect(report.routes.map((r) => r.verdict)).toEqual(['FAIL', 'FAIL', 'NO-CPU', 'RISK', 'OK']);
    const text = renderReport(report, { items: 60, skipped: 4 });
    expect(text).toContain('OVERALL: FAIL');
    expect(text).toContain('exceededCpu:1');
    expect(text).toContain('POST /api/auth/sign-in/email');
    expect(text).toContain('after-idle: 1 (max 9 ms)');
    expect(text).toContain('items read (a line, or one pretty-printed object): 60');
    expect(text).toContain('items skipped');
  });

  it('--only-measure keeps the requests of the tool (by user agent) and drops the hand-driven ones; --worker keeps one Worker', () => {
    const onlyTool = aggregate(records as never, { onlyMeasure: true });
    expect(onlyTool.routes.map((r) => r.script)).not.toContain(ADMIN);
    expect(onlyTool.events).toBe(20 + 12 + 3);
    const admin = aggregate(records as never, { worker: ADMIN });
    expect(admin.routes.every((r) => r.script === ADMIN)).toBe(true);
  });

  it('groups the articles into one row on request', () => {
    const grouped = aggregate(parse(capture(), { groupSlugs: true }) as never);
    expect(grouped.routes.map((r) => r.route)).toContain('/blog/:slug');
    expect(grouped.routes.map((r) => r.route)).not.toContain('/blog/macam-macam-gaya-belajar');
  });

  it('a whole capture under the thresholds passes; one without any CPU field is NO-CPU; an empty one is NO-DATA', () => {
    const good = parse(lines(Array.from({ length: 30 }, (_, i) => tail({ cpu: 1 + (i % 3), at: T0 + i * 1000 }))), {});
    expect(aggregate(good as never).overall).toEqual({ verdict: 'OK', reasons: [] });
    const risky = parse(lines(Array.from({ length: 30 }, (_, i) => tail({ cpu: i === 29 ? 6 : 2, at: T0 + i * 1000 }))), {});
    expect(aggregate(risky as never).overall.verdict).toBe('RISK');
    const none = parse(lines(Array.from({ length: 5 }, (_, i) => tail({ at: T0 + i * 1000 }))), {});
    expect(aggregate(none as never).overall.verdict).toBe('NO-CPU');
    expect(aggregate([] as never).overall.verdict).toBe('NO-DATA');
  });
});

// ------------------------------------------------------------------------------------------------ the command

const run = promisify(execFile);
const script = path.join(webRoot, 'scripts/measure-staging.mjs');
const node = (args: string[], input?: string) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: webRoot, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(input ?? '');
  });

interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

let server: Server;
let origin = '';
let host = '';
let seen: Seen[] = [];
let respond: (req: Seen) => { status: number; body: string } = () => ({ status: 200, body: 'ok' });
const tmp = mkdtempSync(path.join(tmpdir(), 'measure-staging-'));

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const entry = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
      seen.push(entry);
      const { status, body } = respond(entry);
      res.writeHead(status, { 'content-type': 'text/plain', 'cf-ray': '8a1b2c3d4e5f-SIN' });
      res.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;
  host = `127.0.0.1:${port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const reset = () => {
  seen = [];
  respond = () => ({ status: 200, body: 'ok' });
};

describe('the command contacts nothing unless it is told to, and tells you what it refused', () => {
  it('no arguments: usage, exit 2, nothing sent', async () => {
    reset();
    const result = await node([]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Nothing was contacted');
    expect(result.stderr).toContain('probe --base');
    expect(seen).toEqual([]);
  });

  it('probe without --base: refused, exit 2', async () => {
    const result = await node(['probe']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--base is required');
  });

  it('refuses the production domain and a foreign host before any request', async () => {
    for (const base of ['https://sakolakembara.org', 'https://admin.sakolakembara.org', 'https://example.com']) {
      const result = await node(['probe', '--base', base, '--confirm', new URL(base).host]);
      expect(result.code, base).toBe(2);
      expect(result.stderr, base).toContain('Nothing was contacted');
    }
  });

  it('refuses unknown flags and out-of-range numbers', async () => {
    expect((await node(['probe', '--base', origin, '--nope'])).code).toBe(2);
    expect((await node(['probe', '--base', origin, '--rounds', '500', '--confirm', host])).code).toBe(2);
    expect((await node(['probe', '--base', origin, '--slugs', '../x', '--confirm', host])).code).toBe(2);
    expect(seen).toEqual([]);
  });

  it('refuses a pause under 250 ms off loopback (the tool is polite by default), without any request', async () => {
    const result = await node(['plan', '--base', 'https://sakem-web-staging.acme.workers.dev', '--delay-ms', '10']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('at least 250');
  });

  it('without the host typed back (no terminal, no --confirm) it refuses: nothing is sent', async () => {
    reset();
    const result = await node(['probe', '--base', origin, '--rounds', '1', '--delay-ms', '0']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('host was not typed back');
    expect(seen).toEqual([]);
    const wrong = await node(['probe', '--base', origin, '--rounds', '1', '--delay-ms', '0', '--confirm', 'something-else']);
    expect(wrong.code).toBe(2);
    expect(seen).toEqual([]);
  });

  it('plan prints every request with the user agent and sends nothing', async () => {
    reset();
    const result = await node(['plan', '--base', origin, '--admin', origin, '--rounds', '3']);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain(USER_AGENT);
    expect(result.stderr).toContain(`${origin}/blog`);
    expect(result.stderr).toContain(`${origin}/api/me`);
    expect(result.stderr).toContain('plan only: nothing was sent');
    expect(result.stderr).toMatch(/of the 100,000 Worker requests a day/);
    expect(seen).toEqual([]);
  });
});

describe('probe, confirmed: GET only, one at a time, as itself, with no credential', () => {
  it('asks every route of the plan the requested number of times, and only with GET', async () => {
    reset();
    const out = path.join(tmp, 'probe-get.json');
    const result = await node(['probe', '--base', origin, '--rounds', '2', '--delay-ms', '0', '--confirm', host, '--out', out]);
    expect(result.code, result.stderr).toBe(0);
    const plan = buildPlan({ web: true });
    expect(seen.length).toBe(plan.length * 2);
    expect(new Set(seen.map((s) => s.method))).toEqual(new Set(['GET']));
    expect(seen.filter((s) => s.url === '/blog').length).toBe(2);
    expect(seen.filter((s) => s.url === `/blog/${DEFAULT_SLUGS[0]}`).length).toBe(2);
    expect(seen.every((s) => s.body === '')).toBe(true);
    const written = JSON.parse(readFileSync(out, 'utf8')) as { rows: { requests: number; statuses: Record<string, number> }[]; agent: string };
    expect(written.agent).toBe(USER_AGENT);
    expect(written.rows.every((r) => r.requests === 2)).toBe(true);
    expect(result.stdout).toContain('not CPU');
  });

  it('identifies itself and sends no Authorization, Cookie or token header', async () => {
    for (const s of seen) {
      expect(s.headers['user-agent']).toBe(USER_AGENT);
      for (const name of Object.keys(s.headers)) expect(name).not.toMatch(/authorization|cookie|token|x-api|cf-access/i);
    }
  });

  it('does not follow a redirect (it measures the redirect itself)', async () => {
    reset();
    respond = (req) => (req.url === '/admin' ? { status: 308, body: '' } : { status: 200, body: 'ok' });
    const result = await node(['probe', '--base', origin, '--rounds', '1', '--delay-ms', '0', '--confirm', host, '--out', path.join(tmp, 'probe-redirect.json')]);
    expect(result.code).toBe(0);
    expect(seen.filter((s) => s.url === '/admin')).toHaveLength(1);
    expect(result.stdout).toContain('308:1');
  });

  it('error 1102 in an answer is reported and makes the run fail', async () => {
    reset();
    respond = (req) => (req.url === '/tim' ? { status: 503, body: '<html><title>Error 1102 Worker exceeded resource limits</title></html>' } : { status: 200, body: 'ok' });
    const out = path.join(tmp, 'probe-1102.json');
    const result = await node(['probe', '--base', origin, '--rounds', '2', '--delay-ms', '0', '--confirm', host, '--out', out]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('ERROR 1102');
    const rows = (JSON.parse(readFileSync(out, 'utf8')) as { rows: { url: string; suspected1102: number }[] }).rows;
    expect(rows.find((r) => r.url === 'web/tim')!.suspected1102).toBe(2);
  });

  it('a 429 stops that route for the rest of the run', async () => {
    reset();
    respond = (req) => (req.url === '/tim' ? { status: 429, body: 'slow down' } : { status: 200, body: 'ok' });
    const result = await node(['probe', '--base', origin, '--rounds', '4', '--delay-ms', '0', '--confirm', host, '--out', path.join(tmp, 'probe-429.json')]);
    expect(result.code).toBe(0);
    expect(seen.filter((s) => s.url === '/tim')).toHaveLength(1);
  });
});

describe('--portal: the student portal Worker, its own host typed back, GET only, no cookie', () => {
  const portalPlan = buildPlan({ web: false, portal: true });
  const portalPaths = portalPlan.map((r) => r.path);

  it('plan prints the portal rows with their notes, counts them in the Worker budget, and sends nothing', async () => {
    reset();
    const result = await node(['plan', '--base', origin, '--portal', origin, '--rounds', '2']);
    expect(result.code).toBe(0);
    for (const route of portalPlan) expect(result.stderr).toContain(`${origin}${route.path}`);
    expect(result.stderr).toContain('control: the SPA index, answered by the assets layer');
    expect(result.stderr).toContain('plan only: nothing was sent');
    const total = (buildPlan({ web: true, portal: true }).length) * 2;
    expect(result.stderr).toContain(`${total} requests in total`);
    expect(seen).toEqual([]);
    // on the staging hosts the same rows come out against the portal's own origin
    const staging = await node(['plan', '--base', 'https://sakem-web-staging.acme.workers.dev', '--portal', 'https://sakem-portal-staging.acme.workers.dev']);
    expect(staging.code).toBe(0);
    expect(staging.stderr).toContain('https://sakem-portal-staging.acme.workers.dev/portal/api/config');
    expect(staging.stderr).not.toContain('https://sakem-web-staging.acme.workers.dev/portal/api/config');
  });

  it('refuses the production domain, a foreign host, plain http and a path for the portal, before any request, with no flag to allow it', async () => {
    reset();
    for (const bad of ['https://sakolakembara.org', 'https://www.sakolakembara.org', 'https://example.com', 'http://sakem-portal-staging.acme.workers.dev', 'https://x.acme.workers.dev/portal']) {
      const result = await node(['probe', '--base', origin, '--portal', bad, '--confirm', host, '--confirm-portal', new URL(bad).host]);
      expect(result.code, bad).toBe(2);
      expect(result.stderr, bad).toContain('Nothing was contacted');
      expect(result.stderr, bad).toContain('--portal');
    }
    expect(seen).toEqual([]);
  });

  it('needs --base too (the site is always probed): --portal alone is refused', async () => {
    const result = await node(['probe', '--portal', origin, '--confirm-portal', host]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--base is required');
  });

  it('the portal host must be typed back: without --confirm-portal, or with another host, nothing is sent, not even the routes of the site', async () => {
    reset();
    const missing = await node(['probe', '--base', origin, '--portal', origin, '--rounds', '1', '--delay-ms', '0', '--confirm', host]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('portal host was not typed back');
    const wrong = await node(['probe', '--base', origin, '--portal', origin, '--rounds', '1', '--delay-ms', '0', '--confirm', host, '--confirm-portal', 'sakem-portal-staging.acme.workers.dev']);
    expect(wrong.code).toBe(2);
    // the site's own confirmation is not the portal's, and the admin's is not either
    const admin = await node(['probe', '--base', origin, '--portal', origin, '--rounds', '1', '--delay-ms', '0', '--confirm', host, '--confirm-admin', host]);
    expect(admin.code).toBe(2);
    expect(seen).toEqual([]);
  });

  it('confirmed: every portal route the requested number of times, GET only, as itself, with no credential and no cookie', async () => {
    reset();
    const out = path.join(tmp, 'probe-portal.json');
    const result = await node(['probe', '--base', origin, '--portal', origin, '--rounds', '2', '--delay-ms', '0', '--confirm', host, '--confirm-portal', host, '--out', out]);
    expect(result.code, result.stderr).toBe(0);
    const web = buildPlan({ web: true });
    expect(seen.length).toBe((web.length + portalPlan.length) * 2);
    expect(new Set(seen.map((s) => s.method))).toEqual(new Set(['GET']));
    expect(seen.every((s) => s.body === '')).toBe(true);
    // (on one loopback origin the site's own `/portal/api/auth/get-session` and the portal's are the same URL: asked by both rows)
    for (const route of portalPaths) expect(seen.filter((s) => s.url === route), route).toHaveLength(2 * [...web, ...portalPlan].filter((r) => r.path === route).length);
    // nothing else of the portal is asked: no sign-in, no registration, no write route
    expect(seen.filter((s) => s.url.startsWith('/portal/api/') && !portalPaths.includes(s.url))).toEqual([]);
    for (const entry of seen) {
      expect(entry.headers['user-agent']).toBe(USER_AGENT);
      for (const name of Object.keys(entry.headers)) expect(name).not.toMatch(/authorization|cookie|token|x-api|cf-access/i);
    }
    const rows = (JSON.parse(readFileSync(out, 'utf8')) as { rows: { worker: string; url: string; requests: number }[] }).rows;
    const portalRows = rows.filter((r) => r.url.startsWith('portal/'));
    expect(portalRows.map((r) => r.url)).toEqual(portalPlan.map((r) => `portal${r.path}`));
    expect(portalRows.every((r) => r.requests === 2)).toBe(true);
    expect(portalRows.filter((r) => r.worker === 'none')).toHaveLength(2);
    expect(result.stdout).toContain('portal/portal/api/config');
  });

  it('a 401 is an answer, not a failure; a 429 stops that route for the rest of the run; an error 1102 makes the run fail', async () => {
    reset();
    respond = (req) => (req.url === '/portal/api/me' ? { status: 401, body: '{"error":"unauthenticated"}' } : req.url === '/portal/api/overview' ? { status: 429, body: 'slow down' } : { status: 200, body: 'ok' });
    const ok = await node(['probe', '--base', origin, '--portal', origin, '--rounds', '4', '--delay-ms', '0', '--confirm', host, '--confirm-portal', host, '--out', path.join(tmp, 'probe-portal-429.json')]);
    expect(ok.code, ok.stderr).toBe(0);
    expect(seen.filter((s) => s.url === '/portal/api/me')).toHaveLength(4);
    expect(seen.filter((s) => s.url === '/portal/api/overview')).toHaveLength(1);
    expect(ok.stdout).toContain('401:4');
    reset();
    respond = (req) => (req.url === '/portal/api/config' ? { status: 503, body: '<title>Error 1102 Worker exceeded resource limits</title>' } : { status: 200, body: 'ok' });
    const failed = await node(['probe', '--base', origin, '--portal', origin, '--rounds', '2', '--delay-ms', '0', '--confirm', host, '--confirm-portal', host, '--out', path.join(tmp, 'probe-portal-1102.json')]);
    expect(failed.code).toBe(1);
    expect(failed.stdout).toContain('ERROR 1102');
  });

  it('with --writes the portal adds no POST: the same two as without it', async () => {
    reset();
    const result = await node(['probe', '--base', origin, '--admin', origin, '--portal', origin, '--writes', '--rounds', '1', '--delay-ms', '0', '--confirm', host, '--confirm-admin', host, '--confirm-portal', host, '--confirm-writes', host, '--out', path.join(tmp, 'probe-portal-writes.json')]);
    expect(result.code, result.stderr).toBe(0);
    expect(seen.filter((s) => s.method === 'POST').map((p) => p.url)).toEqual(['/kontak', '/api/auth/sign-in/email']);
    expect(seen.filter((s) => s.url.startsWith('/portal/')).every((s) => s.method === 'GET')).toBe(true);
  });
});

describe('--writes needs its own confirmation, and then sends only the two refused POSTs', () => {
  it('without the second confirmation nothing is sent at all, not even the GETs', async () => {
    reset();
    const result = await node(['probe', '--base', origin, '--admin', origin, '--writes', '--rounds', '1', '--delay-ms', '0', '--confirm', host, '--confirm-admin', host]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('second confirmation was not given');
    expect(result.stderr).toContain('WRITES');
    expect(seen).toEqual([]);
  });

  it('a wrong second confirmation refuses too', async () => {
    reset();
    const result = await node(['probe', '--base', origin, '--writes', '--rounds', '1', '--delay-ms', '0', '--confirm', host, '--confirm-writes', 'other-host']);
    expect(result.code).toBe(2);
    expect(seen).toEqual([]);
  });

  it('confirmed: a contact post with no Turnstile token and a sign-in with an unknown address, from the same origin', async () => {
    reset();
    const result = await node(['probe', '--base', origin, '--admin', origin, '--writes', '--rounds', '1', '--delay-ms', '0', '--confirm', host, '--confirm-admin', host, '--confirm-writes', host, '--out', path.join(tmp, 'probe-writes.json')]);
    expect(result.code, result.stderr).toBe(0);
    const posts = seen.filter((s) => s.method === 'POST');
    expect(posts.map((p) => p.url)).toEqual(['/kontak', '/api/auth/sign-in/email']);
    for (const post of posts) {
      expect(post.headers.origin).toBe(origin);
      expect(post.body).toContain('example.invalid');
      expect(post.body).not.toMatch(/cf-turnstile-response/i);
    }
    expect(posts[0]!.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(posts[1]!.headers['content-type']).toBe('application/json');
    expect(seen.filter((s) => !['GET', 'POST'].includes(s.method))).toEqual([]);
  });
});

describe('collect: reads a capture, never the network', () => {
  const capturePath = path.join(tmp, 'capture.jsonl');
  writeFileSync(capturePath, `${capture().join('\n')}\n`);

  it('prints the table and exits 1 when a route failed (the 1102 and the cold start above the gate)', async () => {
    reset();
    const result = await node(['collect', '--file', capturePath]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('OVERALL: FAIL');
    expect(result.stdout).toContain('GET /blog/macam-macam-gaya-belajar');
    expect(result.stdout).toContain('POST /api/auth/sign-in/email');
    expect(result.stdout).toContain('overload');
    expect(seen).toEqual([]);
  });

  it('reads standard input, the same capture, the same answer; and writes the JSON report on request', async () => {
    const json = path.join(tmp, 'report.json');
    const result = await node(['collect', '--json', json], `${capture().join('\n')}\n`);
    expect(result.code).toBe(1);
    const report = JSON.parse(readFileSync(json, 'utf8')) as { routes: { route: string; verdict: string }[]; overall: { verdict: string }; totals: { skipped: number } };
    expect(report.overall.verdict).toBe('FAIL');
    expect(report.totals.skipped).toBe(4); // 2 banner lines, 1 cut JSON line, 1 text line (the blank line is nothing, the overload notice is read)
    expect(report.routes.map((r) => r.verdict)).toContain('FAIL');
  });

  it('exits 0 for a capture that passes, 3 for one without CPU times or without events', async () => {
    const good = path.join(tmp, 'good.jsonl');
    writeFileSync(good, `${lines(Array.from({ length: 30 }, (_, i) => tail({ cpu: 1 + (i % 3), at: T0 + i * 1000 }))).join('\n')}\n`);
    expect((await node(['collect', '--file', good])).code).toBe(0);
    const noCpu = path.join(tmp, 'nocpu.jsonl');
    writeFileSync(noCpu, `${lines(Array.from({ length: 4 }, (_, i) => tail({ at: T0 + i * 1000 }))).join('\n')}\n`);
    const result = await node(['collect', '--file', noCpu]);
    expect(result.code).toBe(3);
    expect(result.stdout).toContain('NO-CPU');
    const empty = path.join(tmp, 'empty.jsonl');
    writeFileSync(empty, 'only a banner line\n');
    expect((await node(['collect', '--file', empty])).code).toBe(3);
  });

  it('a missing file is an error, not a crash with a stack', async () => {
    const result = await node(['collect', '--file', path.join(tmp, 'nope.jsonl')]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('could not read the capture');
  });
});

describe('collect: a pretty-printed capture, as `wrangler tail --format json` writes it, with the portal Worker in it', () => {
  const portalUrl = (route: string) => `https://${PORTAL}.acme.workers.dev${route}`;
  /** The probe's own requests to the portal (user agent of the tool) and a hand-driven sign-in, all invented. */
  function portalEvents(): Fake[] {
    const events: Fake[] = [];
    let t = T0;
    const at = (gap: number) => (t += gap);
    const probe = (route: string, status: number, cpu: number[]) => cpu.forEach((c, i) => events.push({ script: PORTAL, url: portalUrl(route), status, cpu: c, wall: 10 + c, at: at(i === 0 ? 120_000 : 700), ua: USER_AGENT }));
    probe('/portal/api/config', 200, [1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1]);
    probe('/portal/api/me', 401, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    probe('/portal/api/auth/get-session', 200, [1, 1, 1, 2, 1, 1, 1, 1, 2, 1, 1, 1]);
    probe('/portal/api/files/00000000-0000-4000-8000-000000000000', 401, [1, 1, 2, 1, 1, 1, 1, 1, 2, 1, 1, 1]);
    // a sign-in by hand in a browser: another user agent, the heaviest route of the portal
    for (let i = 0; i < 10; i++) events.push({ script: PORTAL, url: portalUrl('/portal/api/auth/sign-in/email'), method: 'POST', status: 200, cpu: 4 + (i % 3), wall: 60, at: at(5000), ua: 'Mozilla/5.0' });
    return events;
  }
  const prettyCapture = () => [...BANNER, ...portalEvents().map((e) => pretty(e))].join('\n');
  const compactCapture = () => portalEvents().map((e) => JSON.stringify(tail(e))).join('\n');
  const file = (name: string, text: string) => {
    const full = path.join(tmp, name);
    writeFileSync(full, `${text}\n`);
    return full;
  };

  it('prints one row per route of the portal, with the numbers, and exits 0 when none failed (a RISK is not a failure)', async () => {
    reset();
    const result = await node(['collect', '--file', file('portal-pretty.json', prettyCapture())]);
    expect(result.code, result.stdout).toBe(0);
    for (const row of ['GET /portal/api/config', 'GET /portal/api/me', 'GET /portal/api/auth/get-session', 'GET /portal/api/files/:id', 'POST /portal/api/auth/sign-in/email']) expect(result.stdout, row).toContain(row);
    expect(result.stdout).toContain(PORTAL);
    expect(result.stdout).toContain('items skipped');
    expect(seen).toEqual([]);
  });

  it('gives the same table as the compact capture of the same events (the PM no longer has to compact it first)', async () => {
    const spread = await node(['collect', '--file', file('same-pretty.json', prettyCapture()), '--json', path.join(tmp, 'same-pretty-report.json')]);
    const compact = await node(['collect', '--file', file('same-compact.jsonl', compactCapture()), '--json', path.join(tmp, 'same-compact-report.json')]);
    expect(spread.code).toBe(compact.code);
    const a = JSON.parse(readFileSync(path.join(tmp, 'same-pretty-report.json'), 'utf8')) as { routes: unknown; overall: unknown; totals: { items: number; skipped: number } };
    const b = JSON.parse(readFileSync(path.join(tmp, 'same-compact-report.json'), 'utf8')) as { routes: unknown; overall: unknown; totals: { items: number; skipped: number } };
    expect(a.routes).toEqual(b.routes);
    expect(a.overall).toEqual(b.overall);
    // the pretty file has the two banner lines more, and counts them as items it skipped
    expect(a.totals).toEqual({ items: b.totals.items + 2, skipped: b.totals.skipped + 2 });
    expect(b.totals.items).toBe(portalEvents().length);
  });

  it('reads standard input too, and --only-measure keeps the tool\'s requests (by the user agent inside the pretty-printed event) and drops the hand-driven sign-in', async () => {
    const result = await node(['collect', '--only-measure'], `${prettyCapture()}\n`);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('GET /portal/api/config');
    expect(result.stdout).not.toContain('sign-in/email');
    expect(result.stdout).toContain('Invocations: 48 ');
  });

  it('reads several files, each with its own state: an object cut at the end of the first never swallows the first object of the second', async () => {
    const events = portalEvents();
    const first = pretty(events[0]!);
    const cut = first.split('\n').slice(0, 8).join('\n');
    const a = file('cut-a.json', [...BANNER, pretty(events[1]!), cut].join('\n'));
    const b = file('cut-b.json', [...BANNER, pretty(events[2]!), pretty(events[3]!)].join('\n'));
    const json = path.join(tmp, 'cut-report.json');
    const result = await node(['collect', '--file', a, '--file', b, '--json', json]);
    expect(result.code).toBe(0);
    const report = JSON.parse(readFileSync(json, 'utf8')) as { events: number; totals: { items: number; skipped: number } };
    expect(report.events).toBe(3); // one from the first file, two from the second; the cut one is not an event
    expect(report.totals.skipped).toBe(2 + 2 + 1); // two banners in each file, and the cut object
  });

  it('a pretty-printed capture with a route that has no CPU field is NO-CPU (exit 3), and one with a stopped invocation fails (exit 1)', async () => {
    const noCpu = await node(['collect', '--file', file('nocpu.json', [...BANNER, ...[0, 1, 2].map((i) => pretty({ script: PORTAL, url: portalUrl('/portal/api/config'), at: T0 + i * 1000 }))].join('\n'))]);
    expect(noCpu.code).toBe(3);
    expect(noCpu.stdout).toContain('NO-CPU');
    const stopped = [...BANNER, ...Array.from({ length: 12 }, (_, i) => pretty({ script: PORTAL, url: portalUrl('/portal/api/auth/sign-in/email'), method: 'POST', cpu: i === 11 ? 10 : 3, outcome: i === 11 ? 'exceededCpu' : 'ok', status: i === 11 ? 503 : 200, at: T0 + i * 1000 }))].join('\n');
    const failed = await node(['collect', '--file', file('stopped.json', stopped)]);
    expect(failed.code).toBe(1);
    expect(failed.stdout).toContain('exceededCpu:1');
  });
});

describe('what the script is made of', () => {
  const code = readFileSync(script, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const lib = readFileSync(path.join(webRoot, 'scripts/lib/staging-measure.mjs'), 'utf8').replace(/^\s*\/\/.*$/gm, '');

  it('reads no environment variable and no credential file, and sends no credential header', () => {
    for (const source of [code, lib]) {
      expect(source).not.toMatch(/process\.env/);
      expect(source).not.toMatch(/\.dev\.vars|\.staging\.vars|wrangler\.toml|\.netrc|\.ssh|keychain/i);
      expect(source).not.toMatch(/CLOUDFLARE_|API_TOKEN|BETTER_AUTH|SECRET/);
    }
    expect(code).not.toMatch(/authorization|set-cookie|['"]cookie['"]/i);
  });

  it('opens a file only to read the capture, and writes only its own output', () => {
    expect(code.match(/createReadStream\(/g)).toHaveLength(1);
    expect(code).not.toMatch(/readFileSync|readdirSync|spawn|exec\(/);
  });

  it('has no network call outside the probe loop (one fetch, redirect handling manual)', () => {
    expect(code.match(/\bfetch\(/g)).toHaveLength(1);
    expect(code).toContain("redirect: 'manual'");
    expect(lib).not.toMatch(/\bfetch\(|node:http|node:net/);
  });

  it('never starts a process: wrangler tail is run by the owner and piped in', () => {
    expect(code).not.toMatch(/child_process|spawn|execFile|execSync/);
  });

  it('is a plain Node script', async () => {
    const { stdout } = await run(process.execPath, ['--check', script]);
    expect(stdout).toBe('');
  });
});
