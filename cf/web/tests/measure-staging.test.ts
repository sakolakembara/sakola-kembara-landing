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
  eventFromTrace,
  isSlug,
  parseLine,
  percentile,
  renderReport,
  routeOf,
  verdictFor,
} from '../scripts/lib/staging-measure.mjs';
import { webRoot } from './helpers';

// scripts/measure-staging.mjs and scripts/lib/staging-measure.mjs (SAKEM-084). Every event below is MADE UP for
// this test from the documented fields of a trace item; none was recorded from Cloudflare. The CLI runs as a real
// child process against a stub server on loopback, which is how "it contacts nothing by default" is proven.

const T0 = 1_760_000_000_000;
const WEB = 'sakem-web-staging';
const ADMIN = 'sakem-admin-staging';

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

  it('--writes adds exactly two POSTs, both refused before anything is stored, with a pause that respects their rate limit', () => {
    const plan = buildPlan({ web: true, admin: true, writes: true });
    const posts = plan.filter((r) => r.method !== 'GET');
    expect(posts.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /kontak', 'POST /api/auth/sign-in/email']);
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
    const text = renderReport(report, { lines: 60, skipped: 4 });
    expect(text).toContain('OVERALL: FAIL');
    expect(text).toContain('exceededCpu:1');
    expect(text).toContain('POST /api/auth/sign-in/email');
    expect(text).toContain('after-idle: 1 (max 9 ms)');
    expect(text).toContain('lines skipped');
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
