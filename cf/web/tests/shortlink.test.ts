import { describe, expect, it, vi } from 'vitest';
import { isSafeTarget, parseShortlinkPayload, redirectResponse, resolveShortlink, SHORTLINK_API_PATH, unavailableResponse } from '~/lib/shortlink';

// The shortlink redirect, unit tested with a fake fetch (docs/cloudflare/admin-konten.md, "The redirect"):
//   - one call to the API per visit, never cached, answered as a 307 / the site's 404 / a 503;
//   - only the contract's own 404 is "not found"; any other failure is an outage, never a dead link;
//   - a target that is not safe is never followed, whatever the API says.

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const found = (targetUrl: string) => json({ shortlink: { targetUrl } });

function runtimeWith(answer: (url: string) => Response | Promise<Response>, extra: Record<string, unknown> = {}) {
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    void init;
    return answer(String(input));
  });
  const onFailure = vi.fn();
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls: fetchImpl, onFailure, runtime: { baseUrl: 'https://api.internal', fetchImpl: fetchImpl as unknown as typeof fetch, onFailure, ...extra } };
}

describe('a link that exists', () => {
  it('asks the API once for the slug and redirects to its target', async () => {
    const { runtime, calls } = runtimeWith(() => found('https://forms.gle/abc123'));
    expect(await resolveShortlink('daftar-2026', runtime)).toEqual({ kind: 'redirect', target: 'https://forms.gle/abc123' });
    expect(calls).toHaveBeenCalledTimes(1);
    const [url, init] = calls.mock.calls[0]!;
    expect(url).toBe('https://api.internal/api/public/shortlinks/daftar-2026');
    expect(url).toContain(SHORTLINK_API_PATH);
    expect((init?.headers as Record<string, string>).accept).toBe('application/json');
    expect(init?.signal).toBeInstanceOf(AbortSignal); // a limit on how long the visitor waits
  });

  it('a path of this site is a target too', async () => {
    const { runtime } = runtimeWith(() => found('/gabung-siswa?utm_source=ig'));
    expect(await resolveShortlink('bio', runtime)).toEqual({ kind: 'redirect', target: '/gabung-siswa?utm_source=ig' });
  });

  it('a trailing slash on the base does not make a double slash', async () => {
    const { runtime, calls } = runtimeWith(() => found('/x'), { baseUrl: 'http://127.0.0.1:4391///' });
    await resolveShortlink('a', runtime);
    expect(calls.mock.calls[0]![0]).toBe('http://127.0.0.1:4391/api/public/shortlinks/a');
  });

  it('is asked every time: there is no cache in this path, so every visit reaches the API (where it is counted)', async () => {
    const { runtime, calls } = runtimeWith(() => found('/x'));
    for (let n = 0; n < 5; n++) await resolveShortlink('rapat', runtime);
    expect(calls).toHaveBeenCalledTimes(5);
  });
});

describe('a link that does not exist (or is switched off: the API does not say which)', () => {
  it("the contract's 404 is not_found", async () => {
    const { runtime, onFailure } = runtimeWith(() => json({ error: 'not_found' }, 404));
    expect(await resolveShortlink('tidak-ada', runtime)).toEqual({ kind: 'not_found' });
    expect(onFailure).not.toHaveBeenCalled(); // an answer, not a failure
  });
});

describe('everything else is an outage, never a dead link', () => {
  const unavailable = async (answer: (url: string) => Response | Promise<Response>, extra: Record<string, unknown> = {}) => {
    const { runtime, onFailure } = runtimeWith(answer, extra);
    const result = await resolveShortlink('rapat', runtime);
    return { result, reasons: onFailure.mock.calls.map(([reason]) => reason as string) };
  };

  it('a 404 that is not the contract\'s (an HTML page, other JSON): a wrong base URL or a proxy in the way', async () => {
    for (const bad of [new Response('<h1>Not Found</h1>', { status: 404, headers: { 'content-type': 'text/html' } }), json({ error: 'nope' }, 404), json('null', 404), new Response('', { status: 404 })]) {
      const { result, reasons } = await unavailable(() => bad.clone());
      expect(result).toEqual({ kind: 'unavailable', reason: 'status 404 without the not_found body' });
      expect(reasons).toEqual(['status 404 without the not_found body']);
    }
  });

  it('a server error, a rate limit, a gateway error', async () => {
    for (const status of [500, 502, 503, 429, 401, 403]) {
      const { result, reasons } = await unavailable(() => json({ error: 'x' }, status));
      expect(result).toEqual({ kind: 'unavailable', reason: `status ${status}` });
      expect(reasons).toEqual([`status ${status}`]);
    }
  });

  it('no answer in time, or no connection', async () => {
    const timeout = await unavailable(() => Promise.reject(new DOMException('timed out', 'TimeoutError')));
    expect(timeout.result).toEqual({ kind: 'unavailable', reason: 'timeout' });
    const abort = await unavailable(() => Promise.reject(new DOMException('aborted', 'AbortError')));
    expect(abort.result).toEqual({ kind: 'unavailable', reason: 'timeout' });
    const offline = await unavailable(() => Promise.reject(new TypeError('fetch failed: connect ECONNREFUSED 10.0.0.1')));
    expect(offline.result).toEqual({ kind: 'unavailable', reason: 'failed' });
    // The log line is a fixed word: nothing of the error, no address.
    expect(offline.reasons.join(' ')).not.toMatch(/ECONNREFUSED|10\.0\.0\.1/);
  });

  it('a real timeout: a call that never answers is cut off', async () => {
    // A fetch that honours its AbortSignal, like the real one, and otherwise never answers.
    const honouring = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))));
    const started = Date.now();
    const result = await resolveShortlink('rapat', { baseUrl: 'https://api.internal', fetchImpl: honouring as unknown as typeof fetch, timeoutMs: 30 });
    expect(result).toEqual({ kind: 'unavailable', reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('a 200 that is not a shortlink, or that is not JSON', async () => {
    for (const body of [json({ other: 1 }), json({ shortlink: null }), json({ shortlink: {} }), json({ shortlink: { targetUrl: 42 } }), json({ shortlink: { targetUrl: '' } }), new Response('<html>', { status: 200 }), json([])]) {
      const { result, reasons } = await unavailable(() => body.clone());
      expect(result, await body.clone().text()).toEqual({ kind: 'unavailable', reason: 'invalid payload' });
      expect(reasons).toEqual(['invalid payload']);
    }
  });

  it('a target that is not safe is never followed, whatever the API says', async () => {
    for (const target of ['javascript:alert(1)', 'data:text/html,x', '//evil.example', '/\\evil.example', '/\t/evil.example', 'evil.example', 'https://', 'ftp://example.org/x', 'file:///etc/passwd']) {
      const { result } = await unavailable(() => found(target));
      expect(result, target).toEqual({ kind: 'unavailable', reason: 'invalid payload' });
    }
  });

  it('no API configured: unavailable, with a call to nothing', async () => {
    const calls = vi.fn();
    const onFailure = vi.fn();
    const result = await resolveShortlink('rapat', { baseUrl: undefined, fetchImpl: calls as unknown as typeof fetch, onFailure });
    expect(result).toEqual({ kind: 'unavailable', reason: 'no API configured' });
    expect(calls).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith('no API configured');
  });

  it('what is logged never holds the slug', async () => {
    const { runtime, onFailure } = runtimeWith(() => json({ error: 'x' }, 500));
    await resolveShortlink('rahasia-kampanye', runtime);
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain('rahasia-kampanye');
  });
});

describe('isSafeTarget (the same rule as the admin Worker)', () => {
  it.each(['/gabung-siswa', '/', '/a?b=c#d', '/%09/x', 'https://example.org/x', 'http://example.org', 'https://sakolakembara.org/daftar'])('%j may be followed', (target) => {
    expect(isSafeTarget(target)).toBe(true);
  });
  it.each(['', 'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.example', '///evil.example', '/\\evil.example', '\\\\evil.example', '/\t/evil.example', '/\n/evil.example', '/\u0000/x', 'evil.example', 'https://', 'ftp://example.org', 'https://example.org/a\nb', 'https://example.org\\@evil.example'])(
    '%j may not',
    (target) => {
      expect(isSafeTarget(target)).toBe(false);
    },
  );
});

describe('parseShortlinkPayload', () => {
  it('takes only { shortlink: { targetUrl } } with a safe target', () => {
    expect(parseShortlinkPayload({ shortlink: { targetUrl: '/x' } })).toBe('/x');
    expect(parseShortlinkPayload({ shortlink: { targetUrl: '/x', slug: 'a', clickCount: 5 } })).toBe('/x'); // extra fields are ignored
    for (const bad of [null, undefined, 'x', 5, [], {}, { shortlink: 'x' }, { shortlink: { targetUrl: null } }, { targetUrl: '/x' }]) expect(parseShortlinkPayload(bad)).toBeNull();
  });
});

describe('the answers the visitor gets', () => {
  it('a 307, with the target in Location, never cacheable, and no body', async () => {
    const res = redirectResponse('https://forms.gle/abc123');
    expect(res.status).toBe(307); // not 308: the slug can be repointed, and a permanent redirect would be kept by browsers
    expect(res.headers.get('location')).toBe('https://forms.gle/abc123');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('');
  });

  it('a 503 for a lookup that could not be made: a sentence, never cached, told to retry, not indexed', async () => {
    const res = unavailableResponse();
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('retry-after')).toBe('30');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await res.text()).toBe('Tautan ini belum dapat dibuka saat ini. Silakan coba lagi beberapa saat lagi.');
  });
});
