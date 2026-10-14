// The two ways seo-parity gets an answer for a URL:
//
//   createNetworkSource   asks a real host, politely: GET only, no cookies, no credentials, one request per
//                         second per host, a timeout, no retries, redirects followed by hand and only inside the
//                         site's own hosts. `fetchImpl`, `sleep` and `now` are injectable so the tests need no network.
//   createRecordedSource  reads a directory written by --record (or by hand, for the fixtures of the tests):
//                         a manifest.json that maps a request path to one HTTP answer, and the bodies next to it.
//
// Both return the same Answer, so the comparison cannot tell them apart:
//   { url, hops: [{ url, status, location }], final: { url, status, contentType, headers, body } | null,
//     error?: string, ms?: number }
//
// A recorded directory holds ONE answer per request, exactly like a server would: a redirect is an entry with a
// status and a location, and the next hop is another entry. So a loop, a chain and a missing page are recorded
// by writing what the server said, not by describing the outcome.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathKey, siteHosts, USER_AGENT } from './seo-parity-core.mjs';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const TEXT_TYPE = /^(text\/|application\/(xhtml\+xml|xml|json|ld\+json|rss\+xml|atom\+xml)|[a-z]+\/[a-z.+-]*\+xml)/i;
export const MAX_HOPS = 10;
export const MAX_BODY_BYTES = 2_000_000;

const sleepReal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Follow redirects by hand over a one-answer function. Shared by the network and the recorded source. */
async function followChain({ requestOne, url, hosts, maxHops = MAX_HOPS }) {
  const hops = [];
  const seen = new Set();
  let current = url;
  const started = Date.now();
  for (;;) {
    if (seen.has(current)) return { url, hops, final: null, error: 'redirect-loop', ms: Date.now() - started };
    seen.add(current);
    if (hops.length > maxHops) return { url, hops, final: null, error: 'too-many-redirects', ms: Date.now() - started };
    let parsed;
    try {
      parsed = new URL(current);
    } catch {
      return { url, hops, final: null, error: 'bad-url', ms: Date.now() - started };
    }
    if (!hosts.has(parsed.host.toLowerCase())) return { url, hops, final: null, error: 'redirect-left-allowed-hosts', ms: Date.now() - started };
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { url, hops, final: null, error: 'redirect-left-allowed-hosts', ms: Date.now() - started };
    const answer = await requestOne(current);
    if (answer.error) return { url, hops, final: null, error: answer.error, ms: Date.now() - started };
    if (REDIRECT_STATUSES.has(answer.status) && answer.headers?.location) {
      hops.push({ url: current, status: answer.status, location: answer.headers.location });
      try {
        current = new URL(answer.headers.location, current).toString();
      } catch {
        return { url, hops, final: null, error: 'bad-url', ms: Date.now() - started };
      }
      continue;
    }
    return {
      url,
      hops,
      final: { url: current, status: answer.status, contentType: answer.contentType ?? '', headers: answer.headers ?? {}, body: answer.body ?? '' },
      ms: Date.now() - started,
    };
  }
}

async function readCapped(res, maxBytes) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('body-too-large');
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

/**
 * @param {{ base: string, userAgent?: string, delayMs?: number, timeoutMs?: number, extraHosts?: string[],
 *           fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, now?: () => number,
 *           maxBodyBytes?: number, recorder?: ReturnType<typeof createRecorder> | null }} opts
 */
export function createNetworkSource({ base, userAgent = USER_AGENT, delayMs = 1000, timeoutMs = 15_000, extraHosts = [], fetchImpl = globalThis.fetch, sleep = sleepReal, now = Date.now, maxBodyBytes = MAX_BODY_BYTES, recorder = null }) {
  const hosts = siteHosts(base, extraHosts);
  const lastAt = new Map();
  const stats = { requests: 0, bytes: 0 };

  async function pace(host) {
    const last = lastAt.get(host);
    if (last !== undefined) {
      const wait = last + delayMs - now();
      if (wait > 0) await sleep(wait);
    }
    lastAt.set(host, now());
  }

  async function requestOne(url) {
    const host = new URL(url).host.toLowerCase();
    await pace(host);
    stats.requests += 1;
    let res;
    try {
      // GET only. The only headers are these three: no cookie, no authorization, nothing that identifies a person.
      res = await fetchImpl(url, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5', 'accept-language': 'id,en;q=0.5' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return { error: describeError(error) };
    }
    const headers = {};
    for (const [k, v] of res.headers) if (k.toLowerCase() !== 'set-cookie') headers[k.toLowerCase()] = v;
    const contentType = headers['content-type'] ?? '';
    let body = '';
    if (!REDIRECT_STATUSES.has(res.status) || !headers.location) {
      if (TEXT_TYPE.test(contentType) || contentType === '') {
        try {
          body = await readCapped(res, maxBodyBytes);
        } catch (error) {
          return { error: describeError(error) };
        }
      } else {
        await res.body?.cancel().catch(() => {});
      }
    } else {
      await res.body?.cancel().catch(() => {});
    }
    stats.bytes += body.length;
    const answer = { status: res.status, headers, contentType, body };
    recorder?.save(url, answer);
    return answer;
  }

  return {
    base,
    mode: 'network',
    stats,
    get: (url) => followChain({ requestOne, url, hosts }),
  };
}

function describeError(error) {
  if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'timeout';
  if (error && error.message === 'body-too-large') return 'body-too-large';
  const code = error?.cause?.code ?? error?.code;
  return code ? `network: ${code}` : `network: ${error?.name ?? 'error'}`;
}

// ---------------------------------------------------------------- recorded directories

const MANIFEST = 'manifest.json';
const entryKey = (url, hosts) => {
  try {
    const u = new URL(url);
    return hosts.has(u.host.toLowerCase()) ? `${u.pathname}${u.search}` : url;
  } catch {
    return url;
  }
};

/**
 * Records every answer a network source gets, into `dir`: manifest.json plus one file per body. Reads of a
 * live site written here are what makes a later offline rerun possible (`--live-dir`). Writes happen on
 * `flush()`; nothing is written outside `dir`.
 * @param {{ dir: string, base: string, extraHosts?: string[] }} opts
 */
export function createRecorder({ dir, base, extraHosts = [] }) {
  const hosts = siteHosts(base, extraHosts);
  const entries = {};
  return {
    dir,
    save(url, answer) {
      const key = entryKey(url, hosts);
      const entry = { status: answer.status };
      if (answer.contentType) entry.contentType = answer.contentType;
      const headers = { ...answer.headers };
      delete headers['content-type'];
      delete headers['content-length'];
      delete headers['content-encoding'];
      delete headers.date;
      if (Object.keys(headers).length) entry.headers = headers;
      if (answer.body) {
        const ext = /html/i.test(answer.contentType) ? 'html' : /xml/i.test(answer.contentType) ? 'xml' : 'txt';
        entry.file = `bodies/${createHash('sha1').update(url).digest('hex').slice(0, 16)}.${ext}`;
        mkdirSync(path.join(dir, 'bodies'), { recursive: true });
        writeFileSync(path.join(dir, entry.file), answer.body);
      }
      entries[key] = entry;
    },
    flush() {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify({ version: 1, base, entries }, null, 2)}\n`);
      return Object.keys(entries).length;
    },
  };
}

/**
 * Reads a directory written by createRecorder (or by hand).
 * @param {{ dir: string, base?: string, extraHosts?: string[] }} opts
 */
export function createRecordedSource({ dir, base, extraHosts = [] }) {
  const manifestPath = path.join(dir, MANIFEST);
  if (!existsSync(manifestPath)) throw new Error(`no ${MANIFEST} in ${dir}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const effectiveBase = base ?? manifest.base;
  if (!effectiveBase) throw new Error(`${manifestPath} has no "base" and none was given`);
  const hosts = siteHosts(effectiveBase, extraHosts);
  const byKey = new Map();
  for (const [key, entry] of Object.entries(manifest.entries ?? {})) if (!byKey.has(pathKey(key))) byKey.set(pathKey(key), entry);
  const stats = { requests: 0, bytes: 0 };

  async function requestOne(url) {
    stats.requests += 1;
    const key = entryKey(url, hosts);
    const entry = manifest.entries?.[key] ?? byKey.get(pathKey(key));
    if (!entry) return { error: 'not-recorded' };
    if (entry.error) return { error: entry.error };
    const headers = Object.fromEntries(Object.entries(entry.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    if (entry.contentType) headers['content-type'] = entry.contentType;
    const body = entry.file ? readFileSync(path.join(dir, entry.file), 'utf8') : (entry.body ?? '');
    stats.bytes += body.length;
    return { status: entry.status, headers, contentType: entry.contentType ?? headers['content-type'] ?? '', body };
  }

  return { base: effectiveBase, mode: 'recorded', stats, get: (url) => followChain({ requestOne, url, hosts }) };
}
