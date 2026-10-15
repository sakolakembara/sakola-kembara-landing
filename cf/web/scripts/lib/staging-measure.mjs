// The pure half of scripts/measure-staging.mjs (SAKEM-084, the portal's routes and the pretty-printed capture SAKEM-098):
// which routes are asked, how a `wrangler tail` event becomes a record, how records become per-route numbers, and the
// verdict. No network and no file system here, so tests/measure-staging.test.ts runs all of it on text.
//
// What is measured, and what is not. The 10 ms limit of the Workers Free plan is on CPU time, which only
// Cloudflare can read: a timer inside a Worker only moves on I/O, and the time a client measures includes the
// network and the other side. So the numbers come from Cloudflare's own record of each invocation, read from
// the output of `wrangler tail <worker> --format json` (or from a file with the same fields), and the client
// side of this tool only makes the requests and notes the status and the wall time as a rough companion.
//
// Fields read from an event, first match wins (the first of each list is the documented name):
//   cpu      cpuTime | cpuTimeMs | CPUTimeMs | $workers.cpuTimeMs         ms, as published for each invocation
//   wall     wallTime | wallTimeMs | WallTimeMs | $workers.wallTimeMs
//   outcome  outcome | Outcome | $workers.outcome                        ok, exception, exceededCpu, exceededMemory, canceled, ...
//   script   scriptName | ScriptName | $workers.scriptName
//   time     eventTimestamp | EventTimestampMs                            epoch ms
//   request  event.request.{url,method} | Event.Request.{URL,Method} | $workers.event.request.{url,method}
//   status   event.response.status | Event.Response.Status | $workers.event.response.status
// `cpuTime` and `wallTime` are the names of the trace item that Tail Workers receive (the TraceItem of
// @cloudflare/workers-types), `CPUTimeMs` and `WallTimeMs` those of the Workers Trace Events dataset (Logpush).
// Whether the stream of `wrangler tail` carries them is NOT confirmed by the documentation (its example shows
// neither): an event without a CPU field still counts for outcomes and statuses, and the report says so. The other
// spellings are tolerated so that a file exported from Workers Logs or Logpush can be read too; the first real
// capture settles which one is in use.

export const USER_AGENT = 'sakem-staging-measure/1.0 (SAKEM-084 CPU measurement of a staging Worker; GET only unless --writes)';

/**
 * Thresholds, in ms of CPU per invocation, against the 10 ms limit of Workers Free.
 *  - OK:   p99 below 5 ms (a 2x margin: one isolate in a hundred twice as slow as the 99th percentile still fits).
 *  - RISK: p99 from 5 to 8 ms, or a maximum from 8 to 10 ms: it passes, with less than 2x of room, and is listed.
 *  - FAIL: any `exceededCpu` outcome (error 1102), p99 above 8 ms, or a maximum of 10 ms or more: the margin is
 *          under 20% or the limit was reached. 8 ms is the gate; 10 ms is the wall.
 * Cloudflare says an isolate gets some flexibility for work that only occasionally goes over the limit, so a
 * maximum at or above 10 ms is not always an error, and also that it ends the invocation once it keeps doing it:
 * a route that touches 10 ms is already a route to fix, not a pass.
 */
export const THRESHOLDS = { okBelowMs: 5, gateMs: 8, limitMs: 10, minSamples: 10, idleGapMs: 60_000 };

/** The CPU outcomes: the invocation was stopped for resources. */
export const RESOURCE_OUTCOMES = new Set(['exceededCpu', 'exceededMemory']);

// ----------------------------------------------------------------------------------------------- the hosts

/**
 * The origin to measure. Staging only: an `https://*.workers.dev` host, or a loopback address (to rehearse against
 * `wrangler dev` with no account). Never a host of the production domain, whatever the flags say.
 * Returns { origin, host, loopback } or throws an Error with the reason.
 */
export function checkBase(value, label = '--base') {
  let url;
  try {
    url = new URL(String(value ?? ''));
  } catch {
    throw new Error(`${label}: not a URL: ${JSON.stringify(value)}`);
  }
  const hostname = url.hostname.toLowerCase();
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  if (/(^|\.)sakolakembara\.org$/.test(hostname)) throw new Error(`${label}: ${hostname} is the production domain; this tool measures staging only`);
  if (!loopback && !hostname.endsWith('.workers.dev')) throw new Error(`${label}: ${hostname} is not a *.workers.dev host (or a loopback address for a local rehearsal)`);
  if (!loopback && url.protocol !== 'https:') throw new Error(`${label}: must be https`);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${label}: must be http(s)`);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error(`${label}: an origin only (https://host), no path, query or credentials`);
  }
  return { origin: url.origin, host: url.host, loopback };
}

// ----------------------------------------------------------------------------------------------- the routes

/** Articles of the 80 migrated ones, by size of their stored text (the longest first); public WordPress slugs. Override with --slugs. */
export const DEFAULT_SLUGS = [
  'macam-macam-gaya-belajar-dan-cara-mengoptimalkannya',
  'mau-masuk-ptn-ini-tips-persiapan-kuliah-negeri-anti-gagal',
  'daffa-najwan',
];

/** A slug is a path segment of the site's own grammar; anything else is refused before it is put in a URL. */
export const isSlug = (value) => /^[a-z0-9][a-z0-9_-]{0,199}$/.test(value);

const CONTACT_FORM = new URLSearchParams({
  fullName: 'Pengukuran Staging',
  email: 'staging-measure@example.invalid',
  subject: 'other',
  message: 'Pengukuran CPU Worker staging (SAKEM-084). Abaikan pesan ini; tidak ada token Turnstile, jadi tidak disimpan.',
}).toString();

const SIGN_IN_BODY = JSON.stringify({ email: 'staging-measure@example.invalid', password: 'not-a-real-password' });

/**
 * The routes of the plan. `worker` says which Worker is expected to run: 'none' is a control (the assets layer
 * answers, no Worker invocation, so no event should appear in the tail), 'web' or 'admin' a Worker request.
 * `minDelayMs` stretches the pause for a route behind a rate limit.
 * `portal`: the student portal's Worker (`sakem-portal-staging`), only the GET routes that need no session and no cookie:
 * it never signs in, never registers, never asks a route behind a limiter (no 429 is provoked), and `--writes` adds
 * nothing for it. The routes that need a session are clicked by hand while the tail runs (runbook, step 13c).
 * @param {{ slugs?: string[], shortlink?: string, web?: boolean, admin?: boolean, portal?: boolean, writes?: boolean }} [options]
 * @returns {{ worker: string, method: string, path: string, target?: string, note?: string, body?: string, headers?: Record<string, string>, withOrigin?: boolean, minDelayMs?: number }[]}
 */
export function buildPlan({ slugs = DEFAULT_SLUGS, shortlink, web = true, admin = false, portal = false, writes = false } = {}) {
  const routes = [];
  const add = (worker, method, pathName, extra = {}) => routes.push({ worker, method, path: pathName, ...extra });
  if (web) {
    add('none', 'GET', '/', { note: 'control: prerendered, answered by the assets layer' });
    add('none', 'GET', '/gabung-siswa', { note: 'control: prerendered' });
    add('none', 'GET', '/robots.txt', { note: 'control: static' });
    add('none', 'GET', '/feed', { note: 'control: a _redirects rule (308), answered by the assets layer' });
    add('web', 'GET', '/blog', { note: 'SSR: list from the API through the binding' });
    add('web', 'GET', '/blog?page=2', { note: 'SSR: second page of the list' });
    for (const slug of slugs) add('web', 'GET', `/blog/${slug}`, { note: 'SSR: one article (404 until the blog import ran on staging)' });
    add('web', 'GET', '/tim', { note: 'SSR: team from the API' });
    add('web', 'GET', '/laporan', { note: 'SSR: reports from the API' });
    add('web', 'GET', '/gabung-siswa/docs', { note: 'SSR: documents from the API' });
    add('web', 'GET', '/kontak', { note: 'SSR: the contact page (GET only)' });
    add('web', 'GET', '/sitemap.xml', { note: 'SSR: every page of the blog index through the API' });
    add('web', 'GET', shortlink ? `/${shortlink}` : '/measure-unknown-slug', { note: shortlink ? 'SSR: a real short link (307)' : 'SSR: the short-link lookup of an unknown name (404 after one API call)' });
    add('web', 'GET', '/no/such/page', { note: 'SSR: the 404 page render' });
    add('web', 'GET', '/portal/api/auth/get-session', { note: 'what the navbar asks on every first visit; the portal is on a host of its own on staging, not behind this one, so a 404 page render' });
    add('web', 'GET', '/api/announcements/current', { note: 'what the navbar asks; a JSON 404 of the middleware' });
    add('web', 'GET', '/admin', { note: 'middleware: 308 to ADMIN_URL (404 without it)' });
  }
  if (admin) {
    add('none', 'GET', '/', { target: 'admin', note: 'control: the SPA index, answered by the assets layer' });
    add('none', 'GET', '/login', { target: 'admin', note: 'control: SPA fallback, answered by the assets layer' });
    add('admin', 'GET', '/api/config', { target: 'admin', note: 'public settings of the SPA' });
    add('admin', 'GET', '/api/me', { target: 'admin', note: 'without a session: 401 (the session lookup finds no cookie)' });
    add('admin', 'GET', '/api/dashboard', { target: 'admin', note: 'without a session: 401' });
    add('admin', 'GET', '/api/admin/blog', { target: 'admin', note: 'without a session: 401' });
    add('admin', 'GET', '/uploads/probe', { target: 'admin', note: 'run_worker_first: a JSON 404' });
    add('admin', 'GET', '/api/public/team', { target: 'admin', note: 'must be a 404 from the internet: the reads exist on the service-binding entrypoint only' });
  }
  if (portal) {
    // The assets layer: the SPA's index for the page and for a deep link. (Node's fetch always sends `Sec-Fetch-Mode: cors`,
    // so these are not browser navigations; the local emulation answers them from the assets layer all the same, and a
    // tail with an event for them on a real account says otherwise.)
    add('none', 'GET', '/portal/', { target: 'portal', note: 'control: the SPA index, answered by the assets layer' });
    add('none', 'GET', '/portal/status', { target: 'portal', note: 'control: a deep link, the SPA fallback of the assets layer' });
    // The Worker, `run_worker_first: /portal/api/*`. Nothing here carries a cookie, so nothing builds Better Auth or reads D1.
    add('portal', 'GET', '/portal/api/config', { target: 'portal', note: 'public settings of the SPA (the site key, the two origins, the optional WhatsApp values)' });
    add('portal', 'GET', '/portal/api/me', { target: 'portal', note: 'without the portal cookie: 401, no session lookup' });
    add('portal', 'GET', '/portal/api/auth/get-session', { target: 'portal', note: 'without the portal cookie: null (200), Better Auth is not built; what the public site\'s navbar asks at the apex' });
    add('portal', 'GET', '/portal/api/overview', { target: 'portal', note: 'a student route, no cookie: 401 before any limiter or query' });
    add('portal', 'GET', '/portal/api/applications/current', { target: 'portal', note: 'a student route, no cookie: 401' });
    add('portal', 'GET', '/portal/api/applications', { target: 'portal', note: 'a student route, no cookie: 401' });
    add('portal', 'GET', '/portal/api/files/00000000-0000-4000-8000-000000000000', { target: 'portal', note: 'the file route, no cookie: 401 (an id that is nobody\'s; no bucket read)' });
    add('portal', 'GET', '/portal/api/auth/list-sessions', { target: 'portal', note: 'an auth route that is not in the route table: a JSON 404 from the gate (what a scanner meets)' });
    add('portal', 'GET', '/portal/api/no-such-route', { target: 'portal', note: 'an unknown API route: the JSON 404' });
    add('portal', 'GET', '/portal/api/dev/mailbox', { target: 'portal', note: 'the development mailbox: a JSON 404 outside ENVIRONMENT=development' });
    add('portal', 'GET', '/portal/no-such-file.png', { target: 'portal', note: 'a file that is not there, not asked as a navigation (a stale client, a scanner): the design expects the Worker\'s JSON 404, the local emulation answers the SPA index from the assets layer; the tail settles which (an event or none)' });
  }
  if (writes) {
    if (web) {
      add('web', 'POST', '/kontak', {
        body: CONTACT_FORM,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        withOrigin: true,
        minDelayMs: 13_000,
        note: 'a valid form WITHOUT a Turnstile token: the API refuses it (turnstile_failed) and stores nothing; exercises the form, the binding and Siteverify (limit: 5 a minute)',
      });
    }
    if (admin) {
      add('admin', 'POST', '/api/auth/sign-in/email', {
        target: 'admin',
        body: SIGN_IN_BODY,
        headers: { 'content-type': 'application/json' },
        withOrigin: true,
        minDelayMs: 13_000,
        note: 'unknown address, no Turnstile token: refused before any password is hashed; it is NOT the cost of a real sign-in (limit: 5 a minute)',
      });
    }
  }
  return routes;
}

// ----------------------------------------------------------------------------------------------- an event

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_ID = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9]{24,}$/;

/**
 * The path as a route: query dropped, ids folded (`/api/admin/blog/<uuid>` -> `/api/admin/blog/:id`). The articles
 * of the public blog keep their slug, so the longest one has its own row, unless `groupSlugs` folds them.
 */
export function routeOf(pathname, { groupSlugs = false } = {}) {
  const parts = pathname.split('/').filter(Boolean);
  const folded = parts.map((part, index) => {
    if (UUID.test(part) || LONG_ID.test(part)) return ':id';
    if (/^\d+$/.test(part)) return ':n';
    if (groupSlugs && index === 1 && parts[0] === 'blog' && part !== 'page') return ':slug';
    return part;
  });
  return `/${folded.join('/')}`;
}

const number = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
const text = (value) => (typeof value === 'string' && value !== '' ? value : null);
const first = (...values) => values.find((value) => value !== undefined && value !== null);

/** One invocation as a record, or null for a line that says nothing about an invocation. `kind` is fetch, scheduled, rpc or info. */
export function eventFromTrace(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const workers = raw.$workers && typeof raw.$workers === 'object' ? raw.$workers : {};
  const event = first(raw.event, raw.Event, workers.event) ?? null;

  // wrangler tail's notices about dropped events ("overload": sampling mode)
  if (event && typeof event === 'object' && (event.type === 'overload' || event.type === 'overload-stop') && !('request' in event)) {
    return { kind: 'info', info: event.type };
  }

  const request = event && typeof event === 'object' ? first(event.request, event.Request) : undefined;
  const response = event && typeof event === 'object' ? first(event.response, event.Response) : undefined;
  const script = text(first(raw.scriptName, raw.ScriptName, workers.scriptName)) ?? 'unknown';
  const base = {
    script,
    outcome: text(first(raw.outcome, raw.Outcome, workers.outcome)) ?? 'unknown',
    cpuMs: number(first(raw.cpuTime, raw.cpuTimeMs, raw.CPUTimeMs, workers.cpuTimeMs, workers.cpuTime)),
    wallMs: number(first(raw.wallTime, raw.wallTimeMs, raw.WallTimeMs, workers.wallTimeMs, workers.wallTime)),
    at: number(first(raw.eventTimestamp, raw.EventTimestampMs)),
    exceptions: Array.isArray(raw.exceptions) ? raw.exceptions.length : Array.isArray(raw.Exceptions) ? raw.Exceptions.length : 0,
    userAgent: null,
  };

  if (request && typeof request === 'object') {
    const rawUrl = text(first(request.url, request.URL));
    const method = (text(first(request.method, request.Method)) ?? 'GET').toUpperCase();
    if (!rawUrl) return null;
    let pathname;
    try {
      pathname = new URL(rawUrl).pathname;
    } catch {
      return null;
    }
    const headers = first(request.headers, request.Headers);
    const ua = headers && typeof headers === 'object' ? first(headers['user-agent'], headers['User-Agent']) : undefined;
    return {
      ...base,
      kind: 'fetch',
      method,
      route: routeOf(pathname, options),
      status: number(first(response?.status, response?.Status)),
      userAgent: typeof ua === 'string' ? ua : null,
    };
  }
  if (event && typeof event === 'object' && typeof event.cron === 'string') return { ...base, kind: 'scheduled', method: 'CRON', route: event.cron, status: null };
  if (event && typeof event === 'object' && typeof event.rpcMethod === 'string') {
    const entrypoint = text(raw.entrypoint) ?? 'default';
    return { ...base, kind: 'rpc', method: 'RPC', route: `${entrypoint}.${event.rpcMethod}`, status: null };
  }
  return null;
}

/**
 * One line of a tail capture holding a whole COMPACT JSON object: the record, 'skip' for a line that is not JSON or not an
 * event, or null for blank. Banner lines of wrangler land in 'skip'. A pretty-printed object is several lines: that is
 * `createCaptureParser`'s (below), which uses the same reading for each object.
 */
export function parseLine(line, options = {}) {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  if (!trimmed.startsWith('{')) return 'skip';
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return 'skip';
  }
  return eventFromTrace(parsed, options) ?? 'skip';
}

/**
 * Reads a whole tail capture line by line (push each line, then `end()`), whatever shape `wrangler tail --format json`
 * printed it in:
 *   - one compact JSON object per line (what the first versions of this tool expected), or
 *   - PRETTY-PRINTED objects of many lines: `{` at the start of a line, every inner line indented, `}` alone at the start
 *     of a line (what `JSON.stringify(event, null, 2)` writes, which is what wrangler prints), with or without a blank
 *     line between two of them,
 * mixed with the banner lines wrangler prints first ("Successfully created tail...", "Connected to ...") and with
 * objects that were cut (a tail killed in the middle of one, a line lost). A cut object never swallows the objects that
 * follow it: a line that is not indented and is not the closing `}` ends it, and ends it as skipped.
 *
 * `read` counts items (a line, or one whole object), `skipped` the items that are not an invocation (text, broken
 * or cut JSON, JSON that is not an event). Pure: no file system, no network.
 * @param {{ groupSlugs?: boolean }} [options]
 */
export function createCaptureParser(options = {}) {
  const records = [];
  let read = 0;
  let skipped = 0;
  /** The lines of an object that began with `{` and is not complete yet, or null. */
  let pending = null;

  const accept = (parsed) => {
    read += 1;
    const record = eventFromTrace(parsed, options);
    if (record) records.push(record);
    else skipped += 1;
  };
  const dropPending = () => {
    if (pending === null) return;
    pending = null;
    read += 1;
    skipped += 1;
  };
  const fresh = (text) => {
    if (text.trim() === '') return;
    if (text[0] === '{') {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Not a whole object on this line: the first line of a pretty-printed one, or a line that was cut.
        pending = [text];
        return;
      }
      accept(parsed);
      return;
    }
    read += 1;
    skipped += 1; // a banner line, text, an array
  };

  return {
    push(line) {
      const text = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (pending !== null) {
        if (/^\s/.test(text)) {
          pending.push(text);
          return;
        }
        if (text === '}') {
          const body = [...pending, text].join('\n');
          pending = null;
          try {
            accept(JSON.parse(body));
          } catch {
            read += 1;
            skipped += 1;
          }
          return;
        }
        // Neither indented nor the closing brace: the object was cut. This line is read afresh.
        dropPending();
      }
      fresh(text);
    },
    /** The end of the input: an object still open was cut. */
    end() {
      dropPending();
      return { records, read, skipped };
    },
  };
}

// ----------------------------------------------------------------------------------------------- the numbers

/** Nearest-rank percentile of an ascending array (q in 0..1). With few samples p99 is the maximum, which is the honest answer. */
export function percentile(sorted, q) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

const summary = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), p99: percentile(sorted, 0.99), max: sorted[sorted.length - 1] };
};

const count = (list) => {
  const out = {};
  for (const item of list) out[item] = (out[item] ?? 0) + 1;
  return out;
};

/** The verdict of one route, with the reasons. */
export function verdictFor({ cpu, outcomes, n }) {
  const reasons = [];
  const exceeded = Object.entries(outcomes).filter(([name]) => RESOURCE_OUTCOMES.has(name));
  if (exceeded.length > 0) {
    return { verdict: 'FAIL', reasons: [`${exceeded.map(([name, c]) => `${c} x ${name}`).join(', ')}: the Worker was stopped for resources (error 1102 for exceededCpu)`] };
  }
  if (!cpu) return { verdict: 'NO-CPU', reasons: ['no CPU time in the events of this route: read it in the dashboard or Workers Logs'] };
  if (cpu.p99 > THRESHOLDS.gateMs) reasons.push(`p99 ${cpu.p99} ms is above the ${THRESHOLDS.gateMs} ms gate`);
  if (cpu.max >= THRESHOLDS.limitMs) reasons.push(`max ${cpu.max} ms reached the ${THRESHOLDS.limitMs} ms limit`);
  if (reasons.length > 0) return { verdict: 'FAIL', reasons };
  if (cpu.p99 >= THRESHOLDS.okBelowMs) reasons.push(`p99 ${cpu.p99} ms is between ${THRESHOLDS.okBelowMs} and ${THRESHOLDS.gateMs} ms: less than 2x of room`);
  if (cpu.max >= THRESHOLDS.gateMs) reasons.push(`max ${cpu.max} ms is within 2 ms of the limit`);
  const verdict = reasons.length > 0 ? 'RISK' : 'OK';
  if (n < THRESHOLDS.minSamples) reasons.push(`only ${n} sample${n === 1 ? '' : 's'}: p99 is the maximum, take more`);
  return { verdict, reasons };
}

const SEVERITY = { FAIL: 0, 'NO-CPU': 1, RISK: 2, OK: 3 };

/**
 * Records -> per-route numbers. `options.idleGapMs`: an invocation that comes after at least this long without
 * another one of the same Worker is reported apart as "after idle", the nearest a tail capture gets to "cold"
 * (an isolate is not identified in the event, so this is a heuristic and is labelled as one).
 * `options.onlyMeasure`: keep only the events whose user agent is this tool's (the probe's own requests).
 */
export function aggregate(records, options = {}) {
  const idleGapMs = options.idleGapMs ?? THRESHOLDS.idleGapMs;
  const info = records.filter((r) => r.kind === 'info');
  let events = records.filter((r) => r.kind !== 'info');
  if (options.onlyMeasure) events = events.filter((r) => r.userAgent?.startsWith('sakem-staging-measure/'));
  if (options.worker) events = events.filter((r) => r.script === options.worker);

  // the idle heuristic, per Worker, over events in time order
  const byScript = new Map();
  for (const event of events) {
    if (!byScript.has(event.script)) byScript.set(event.script, []);
    byScript.get(event.script).push(event);
  }
  for (const list of byScript.values()) {
    const timed = list.filter((e) => e.at !== null).sort((a, b) => a.at - b.at);
    let previous = null;
    for (const event of timed) {
      event.afterIdle = previous === null || event.at - previous >= idleGapMs;
      previous = event.at;
    }
  }

  const groups = new Map();
  for (const event of events) {
    const key = `${event.script}\t${event.method}\t${event.route}`;
    if (!groups.has(key)) groups.set(key, { script: event.script, method: event.method, route: event.route, items: [] });
    groups.get(key).items.push(event);
  }

  const routes = [...groups.values()].map(({ script, method, route, items }) => {
    const cpuValues = items.map((e) => e.cpuMs).filter((v) => v !== null);
    const wallValues = items.map((e) => e.wallMs).filter((v) => v !== null);
    const outcomes = count(items.map((e) => e.outcome));
    const cpu = summary(cpuValues);
    const idle = items.filter((e) => e.afterIdle && e.cpuMs !== null);
    const { verdict, reasons } = verdictFor({ cpu, outcomes, n: items.length });
    return {
      script,
      method,
      route,
      n: items.length,
      statuses: count(items.map((e) => (e.status === null ? 'none' : String(e.status)))),
      outcomes,
      cpu,
      wall: summary(wallValues),
      afterIdle: idle.length > 0 ? { n: idle.length, maxCpuMs: Math.max(...idle.map((e) => e.cpuMs)) } : null,
      exceptions: items.reduce((sum, e) => sum + e.exceptions, 0),
      verdict,
      reasons,
    };
  });
  routes.sort((a, b) => SEVERITY[a.verdict] - SEVERITY[b.verdict] || (b.cpu?.p99 ?? -1) - (a.cpu?.p99 ?? -1) || a.route.localeCompare(b.route));

  const overloads = info.filter((r) => r.info === 'overload').length;
  const overall = { verdict: 'OK', reasons: [] };
  if (routes.some((r) => r.verdict === 'FAIL')) {
    overall.verdict = 'FAIL';
    overall.reasons.push(`${routes.filter((r) => r.verdict === 'FAIL').length} route(s) failed the gate`);
  } else if (routes.length === 0) {
    overall.verdict = 'NO-DATA';
    overall.reasons.push('no invocation in the input');
  } else if (routes.every((r) => r.verdict === 'NO-CPU')) {
    overall.verdict = 'NO-CPU';
    overall.reasons.push('no event carried a CPU time: use the dashboard or Workers Logs for the numbers');
  } else if (routes.some((r) => r.verdict === 'RISK' || r.verdict === 'NO-CPU')) {
    overall.verdict = 'RISK';
    overall.reasons.push('passes the gate, with routes listed as RISK or without CPU data');
  }
  if (overloads > 0) overall.reasons.push(`${overloads} "overload" notice(s) from wrangler tail: events were dropped, so the sample is incomplete`);
  return { routes, overall, events: events.length, overloads };
}

// ----------------------------------------------------------------------------------------------- the report

const pad = (value, width, right = false) => (right ? String(value).padStart(width) : String(value).padEnd(width));
const num = (value) => (value === null || value === undefined ? '-' : String(value));

/** The report as text. `totals` is { items, skipped } from the reader (`createCaptureParser`). */
export function renderReport(report, totals = { items: 0, skipped: 0 }) {
  const out = [];
  const withCpu = report.routes.reduce((sum, r) => sum + (r.cpu?.n ?? 0), 0);
  out.push(`Invocations: ${report.events} (${withCpu} with a CPU time), items read (a line, or one pretty-printed object): ${totals.items}, items skipped (not JSON or not an invocation): ${totals.skipped}`);
  out.push(`Thresholds (ms of CPU, limit ${THRESHOLDS.limitMs} on Workers Free): OK p99 < ${THRESHOLDS.okBelowMs}; RISK p99 ${THRESHOLDS.okBelowMs}-${THRESHOLDS.gateMs} or max ${THRESHOLDS.gateMs}-${THRESHOLDS.limitMs}; FAIL any exceededCpu (1102), p99 > ${THRESHOLDS.gateMs} or max >= ${THRESHOLDS.limitMs}`);
  out.push('CPU time is whole milliseconds as Cloudflare records it; "after idle" is a heuristic (first invocation of a Worker after a gap), not an isolate id.');
  out.push('');
  const header = `${pad('verdict', 7)} ${pad('worker', 20)} ${pad('method route', 46)} ${pad('n', 4, true)} ${pad('p50', 4, true)} ${pad('p95', 4, true)} ${pad('p99', 4, true)} ${pad('max', 4, true)} ${pad('wall p95', 8, true)}  outcomes / statuses`;
  out.push(header);
  out.push('-'.repeat(header.length));
  for (const r of report.routes) {
    const outcomes = Object.entries(r.outcomes).map(([k, v]) => `${k}:${v}`).join(' ');
    const statuses = Object.entries(r.statuses).map(([k, v]) => `${k}:${v}`).join(' ');
    out.push(
      `${pad(r.verdict, 7)} ${pad(r.script, 20)} ${pad(`${r.method} ${r.route}`, 46)} ${pad(r.n, 4, true)} ${pad(num(r.cpu?.p50), 4, true)} ${pad(num(r.cpu?.p95), 4, true)} ${pad(num(r.cpu?.p99), 4, true)} ${pad(num(r.cpu?.max), 4, true)} ${pad(num(r.wall?.p95), 8, true)}  ${outcomes} / ${statuses}${r.afterIdle ? `  after-idle: ${r.afterIdle.n} (max ${r.afterIdle.maxCpuMs} ms)` : ''}`,
    );
    for (const reason of r.reasons) out.push(`          -> ${reason}`);
  }
  out.push('');
  out.push(`OVERALL: ${report.overall.verdict}${report.overall.reasons.length > 0 ? ` (${report.overall.reasons.join('; ')})` : ''}`);
  return out.join('\n');
}
