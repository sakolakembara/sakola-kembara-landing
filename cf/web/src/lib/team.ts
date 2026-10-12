// Loader for /tim: team members from the content API, with a hard timeout,
// the Workers Cache API (`caches.default`) as a cache, and stale-if-error.
//
//   1. fresh copy in the cache (TTL 5 min)                  -> source "cache"
//   2. else fetch the API, 2 s timeout                      -> source "network", stored fresh + stale
//   3. API down / slow / invalid: last good copy (7 days)   -> source "stale"; it is also re-stored
//      as "fresh" for 30 s, so an outage costs one 2 s wait per 30 s, not one per request
//   4. nothing at all                                       -> source "empty" (the page shows its empty state)
//
// Cache and fetch are injected so the logic is unit tested in Node with fakes
// (tests/team.test.ts). On a real zone the Cache API only works on custom
// domains/routes, not on *.workers.dev.

import { parseTeamPayload, type TeamMember } from './team-types';

export type TeamSource = 'network' | 'cache' | 'stale' | 'empty';
export interface TeamResult {
  members: TeamMember[];
  source: TeamSource;
}

export interface TeamLoaderOptions {
  /** CONTENT_API_URL, no trailing slash needed. Unset -> "empty". */
  baseUrl: string | undefined;
  /** caches.default when the runtime has it. */
  cache?: Pick<Cache, 'match' | 'put'>;
  /** ctx.waitUntil, so cache writes do not delay the response. */
  waitUntil?: (promise: Promise<unknown>) => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  freshTtlSeconds?: number;
  /** How long the last good copy is kept for stale-if-error. */
  staleTtlSeconds?: number;
  /** How long a stale copy is re-served as "fresh" after a failed fetch. */
  outageTtlSeconds?: number;
}

export const TEAM_PATH = '/api/public/team';

export async function loadTeam(opts: TeamLoaderOptions): Promise<TeamResult> {
  const {
    baseUrl,
    cache,
    waitUntil,
    fetchImpl = fetch,
    timeoutMs = 2000,
    freshTtlSeconds = 300,
    staleTtlSeconds = 60 * 60 * 24 * 7,
    outageTtlSeconds = 30,
  } = opts;

  if (!baseUrl) return { members: [], source: 'empty' };
  const url = `${baseUrl.replace(/\/+$/, '')}${TEAM_PATH}`;
  // Cache keys are synthetic URLs; nothing is ever fetched from the "stale" one.
  const freshKey = new Request(url);
  const staleKey = new Request(`${url}?copy=stale`);

  const read = async (key: Request): Promise<{ members: TeamMember[]; text: string } | null> => {
    try {
      const hit = await cache?.match(key);
      if (!hit) return null;
      const text = await hit.text();
      const members = parseTeamPayload(JSON.parse(text));
      return members ? { members, text } : null;
    } catch {
      return null;
    }
  };

  const write = (key: Request, text: string, ttl: number) => {
    if (!cache) return;
    const job = cache
      .put(
        key,
        new Response(text, {
          headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` },
        }),
      )
      .catch(() => undefined);
    return job;
  };

  const background = async (jobs: (Promise<unknown> | undefined)[]) => {
    const all = Promise.all(jobs.filter(Boolean)).catch(() => undefined);
    if (waitUntil) waitUntil(all);
    else await all;
  };

  const fresh = await read(freshKey);
  if (fresh) return { members: fresh.members, source: 'cache' };

  try {
    const res = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`team API answered ${res.status}`);
    const text = await res.text();
    const members = parseTeamPayload(JSON.parse(text));
    if (!members) throw new Error('team API payload is not a list');
    await background([write(freshKey, text, freshTtlSeconds), write(staleKey, text, staleTtlSeconds)]);
    return { members, source: 'network' };
  } catch {
    const stale = await read(staleKey);
    if (!stale) return { members: [], source: 'empty' };
    await background([write(freshKey, stale.text, outageTtlSeconds)]);
    return { members: stale.members, source: 'stale' };
  }
}
