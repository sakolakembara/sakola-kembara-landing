// Stand-ins for the Worker runtime pieces the content loaders take, so they run in plain Node.

/** A Map-backed caches.default, keyed by URL, honouring `max-age`. `now` is the test's clock in ms. */
export function fakeCache(now: () => number) {
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

/** A fetch that answers 200 with `body` as JSON. `calls` counts the requests. */
export function okFetch(body: unknown) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

export const statusFetch = (status: number) => (async () => new Response('x', { status })) as unknown as typeof fetch;

/** A fetch that never answers and rejects when the Worker's timeout signal fires, like the real one. */
export const hangingFetch = ((_url: unknown, init?: RequestInit) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')));
  })) as unknown as typeof fetch;
