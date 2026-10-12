import { describe, expect, it } from 'vitest';
import { TEAM_PATH, loadTeam } from '~/lib/team';
import { TEAM_CATEGORY_ORDER, groupTeam, parseTeamPayload, type TeamMember } from '~/lib/team-types';
import { importRoot, readRoot } from './helpers';

const T = '2026-01-01T00:00:00.000Z';
const raw = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `id-${n}`,
  name: `Nama ${n}`,
  role: `Peran ${n}`,
  image: null,
  category: 'pengurus',
  bio: null,
  educationHistory: [],
  workHistory: [],
  displayOrder: n,
  createdAt: T,
  updatedAt: T,
  ...extra,
});
const payload = { members: [raw(1), raw(2, { category: 'dewan_pembina' })] };

/** A Map-backed stand-in for caches.default, keyed by URL, honouring max-age. */
function fakeCache(now: () => number) {
  const store = new Map<string, { text: string; expires: number }>();
  return {
    store,
    async match(req: Request) {
      const hit = store.get(req.url);
      if (!hit || hit.expires <= now()) return undefined;
      return new Response(hit.text);
    },
    async put(req: Request, res: Response) {
      const ttl = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 0);
      store.set(req.url, { text: await res.text(), expires: now() + ttl * 1000 });
    },
  };
}

const okFetch = (body: unknown = payload) =>
  (async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
const statusFetch = (status: number) => (async () => new Response('x', { status })) as unknown as typeof fetch;
/** A fetch that never answers and rejects when the Worker's timeout signal fires, like the real one. */
const hangingFetch = ((_url: unknown, init?: RequestInit) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')));
  })) as unknown as typeof fetch;

describe('loadTeam', () => {
  it('without CONTENT_API_URL: empty, and nothing is fetched', async () => {
    let called = false;
    const r = await loadTeam({ baseUrl: undefined, fetchImpl: (async () => ((called = true), new Response('{}'))) as unknown as typeof fetch });
    expect(r).toEqual({ members: [], source: 'empty' });
    expect(called).toBe(false);
  });

  it('fetches ${base}/api/public/team (trailing slash tolerated) with an Accept header and a timeout signal', async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => ((seen = { url, init }), new Response(JSON.stringify(payload)))) as unknown as typeof fetch;
    const r = await loadTeam({ baseUrl: 'http://api.test/', fetchImpl });
    expect(seen?.url).toBe(`http://api.test${TEAM_PATH}`);
    expect(new Headers(seen?.init?.headers).get('accept')).toBe('application/json');
    expect(seen?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(r.source).toBe('network');
    expect(r.members.map((m) => m.id)).toEqual(['id-1', 'id-2']);
  });

  it('accepts a bare array as well as { members }', async () => {
    const r = await loadTeam({ baseUrl: 'http://api.test', fetchImpl: okFetch([raw(1)]) });
    expect(r.members).toHaveLength(1);
  });

  it('stores a fresh and a stale copy, then serves the fresh one from the cache without asking the API', async () => {
    let t = 0;
    const cache = fakeCache(() => t);
    let calls = 0;
    const fetchImpl = (async () => (calls++, new Response(JSON.stringify(payload)))) as unknown as typeof fetch;
    const base = { baseUrl: 'http://api.test', cache, fetchImpl, freshTtlSeconds: 300, staleTtlSeconds: 86400 };
    expect((await loadTeam(base)).source).toBe('network');
    expect(cache.store.size).toBe(2);
    expect((await loadTeam(base)).source).toBe('cache');
    expect(calls).toBe(1);
  });

  it('after the fresh TTL it asks the API again', async () => {
    let t = 0;
    const cache = fakeCache(() => t);
    let calls = 0;
    const fetchImpl = (async () => (calls++, new Response(JSON.stringify(payload)))) as unknown as typeof fetch;
    const base = { baseUrl: 'http://api.test', cache, fetchImpl, freshTtlSeconds: 300 };
    await loadTeam(base);
    t += 301_000;
    expect((await loadTeam(base)).source).toBe('network');
    expect(calls).toBe(2);
  });

  it.each([
    ['500', statusFetch(500)],
    ['404', statusFetch(404)],
    ['network error', (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch],
    ['invalid JSON', (async () => new Response('<html>')) as unknown as typeof fetch],
    ['wrong shape', okFetch({ members: 'nope' })],
  ])('API failure (%s): the last good copy is served as stale', async (_name, failing) => {
    let t = 0;
    const cache = fakeCache(() => t);
    await loadTeam({ baseUrl: 'http://api.test', cache, fetchImpl: okFetch(), freshTtlSeconds: 300 });
    t += 400_000; // fresh copy expired, stale copy (7 days) still there
    const r = await loadTeam({ baseUrl: 'http://api.test', cache, fetchImpl: failing, freshTtlSeconds: 300 });
    expect(r.source).toBe('stale');
    expect(r.members).toHaveLength(2);
  });

  it('API failure with nothing cached: empty, never throws', async () => {
    const r = await loadTeam({ baseUrl: 'http://api.test', cache: fakeCache(() => 0), fetchImpl: statusFetch(500) });
    expect(r).toEqual({ members: [], source: 'empty' });
  });

  it('a hanging API is cut off by the timeout and the stale copy is served', async () => {
    let t = 0;
    const cache = fakeCache(() => t);
    await loadTeam({ baseUrl: 'http://api.test', cache, fetchImpl: okFetch(), freshTtlSeconds: 1 });
    t += 5_000;
    const started = Date.now();
    const r = await loadTeam({ baseUrl: 'http://api.test', cache, fetchImpl: hangingFetch, timeoutMs: 50 });
    expect(r.source).toBe('stale');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('after an outage the stale copy is re-served as fresh for 30 s, so the API is not retried per request', async () => {
    let t = 0;
    const cache = fakeCache(() => t);
    await loadTeam({ baseUrl: 'http://api.test', cache, fetchImpl: okFetch(), freshTtlSeconds: 300 });
    t += 400_000;
    let calls = 0;
    const failing = (async () => (calls++, new Response('x', { status: 500 }))) as unknown as typeof fetch;
    expect((await loadTeam({ baseUrl: 'http://api.test', cache, fetchImpl: failing })).source).toBe('stale');
    expect(calls).toBe(1);
    t += 10_000;
    expect((await loadTeam({ baseUrl: 'http://api.test', cache, fetchImpl: failing })).source).toBe('cache');
    expect(calls).toBe(1);
    t += 25_000; // 30 s are over
    expect((await loadTeam({ baseUrl: 'http://api.test', cache, fetchImpl: failing })).source).toBe('stale');
    expect(calls).toBe(2);
  });

  it('cache writes go through waitUntil when given, so they do not delay the response', async () => {
    const cache = fakeCache(() => 0);
    const pending: Promise<unknown>[] = [];
    await loadTeam({ baseUrl: 'http://api.test', cache, fetchImpl: okFetch(), waitUntil: (p) => void pending.push(p) });
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(cache.store.size).toBe(2);
  });

  it('a cache that throws never breaks the page', async () => {
    const broken = { match: async () => { throw new Error('boom'); }, put: async () => { throw new Error('boom'); } };
    const r = await loadTeam({ baseUrl: 'http://api.test', cache: broken, fetchImpl: okFetch() });
    expect(r.source).toBe('network');
  });
});

describe('parseTeamPayload', () => {
  it('drops malformed entries, keeps the rest', () => {
    const members = parseTeamPayload({ members: [raw(1), { id: 'x' }, null, 'str', raw(2, { name: '  ' })] });
    expect(members?.map((m) => m.id)).toEqual(['id-1']);
  });
  it('unknown category falls back to pengurus; bad history entries are dropped', () => {
    const [m] = parseTeamPayload([
      raw(1, { category: 'alien', educationHistory: [{ institution: 'U' }, { degree: 'x' }], workHistory: [{ organization: 'O', role: 'R' }, { organization: 'O' }] }),
    ])!;
    expect(m.category).toBe('pengurus');
    expect(m.educationHistory).toEqual([{ institution: 'U', degree: null, year: null }]);
    expect(m.workHistory).toEqual([{ organization: 'O', role: 'R', period: null }]);
  });
  it('not a list: null', () => {
    expect(parseTeamPayload({ members: {} })).toBeNull();
    expect(parseTeamPayload('x')).toBeNull();
    expect(parseTeamPayload(null)).toBeNull();
  });
});

describe('groupTeam', () => {
  it('orders categories like the root, members by displayOrder then createdAt, and omits empty categories', () => {
    const members = parseTeamPayload([
      raw(3, { category: 'pengurus', displayOrder: 2 }),
      raw(1, { category: 'dewan_pengawas', displayOrder: 1 }),
      raw(2, { category: 'pengurus', displayOrder: 1 }),
    ]) as TeamMember[];
    const groups = groupTeam(members);
    expect(groups.map((g) => g.category)).toEqual(['dewan_pengawas', 'pengurus']);
    expect(groups[1].members.map((m) => m.id)).toEqual(['id-2', 'id-3']);
  });
});

describe('parity with the root team types', () => {
  it('same categories, in the same order, with the same labels', async () => {
    const root = await importRoot<{ TEAM_CATEGORY_ORDER: string[]; TEAM_CATEGORY_LABEL: Record<string, string> }>('lib/team-types.ts');
    expect([...TEAM_CATEGORY_ORDER]).toEqual(root.TEAM_CATEGORY_ORDER);
    const { TEAM_CATEGORY_LABEL } = await import('~/lib/team-types');
    expect(TEAM_CATEGORY_LABEL).toEqual(root.TEAM_CATEGORY_LABEL);
  });

  it('every column of the TeamMember row is in the API shape', () => {
    const schema = readRoot('lib/db/schema/team-members.ts');
    const columns = [...schema.matchAll(/^\s{4}(\w+): (?:uuid|text|integer|timestamp|jsonb)\(/gm)].map((m) => m[1]);
    expect(columns).toEqual(['id', 'name', 'role', 'image', 'category', 'bio', 'educationHistory', 'workHistory', 'displayOrder', 'createdAt', 'updatedAt']);
    const sample = parseTeamPayload([raw(1)])![0];
    for (const c of columns) expect(Object.keys(sample)).toContain(c);
  });
});
