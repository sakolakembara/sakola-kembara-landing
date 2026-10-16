import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_REPORTS, SAMPLE_RESOURCES, SAMPLE_MEMBERS } from '../scripts/fixture-api.mjs';
import { SERVICE_BINDING_BASE, contactApiTarget, contentApiTarget } from '~/lib/api-client';
import { contentRuntime, loadContent, listOf } from '~/lib/content-api';
import { loadReports } from '~/lib/reports';
import { loadResources } from '~/lib/resources';
import { loadTeam } from '~/lib/team';
import { createApiBlogSource } from '~/lib/blog-source';
import { fakeCache } from './fake-cache';
import { readRoot, readWeb, webRoot } from './helpers';

// The Astro Worker reaches the API Worker through the service binding `API` (its `PublicApi` entrypoint),
// for the reads (/tim, /laporan, /gabung-siswa/docs, the blog) as for the contact form, so the read
// endpoints are not reachable from the internet and a cache-busting query string cannot reach D1
// (docs/cloudflare/public-api.md). CONTENT_API_URL and CONTACT_API_URL (a fixture or a local API) win over the
// binding when set: they are for local runs and CI. The wrangler config and the e2e stack with a real
// binding between two local Workers (scripts/e2e.mjs, group "binding") cover the rest.

/** A service binding: records what it is asked and answers with the fixture's data. */
function fakeBinding(answers: Record<string, unknown> = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const binding = {
    async fetch(input: string | Request, init?: RequestInit) {
      const url = typeof input === 'string' ? input : input.url;
      calls.push({ url, init });
      const hit = answers[new URL(url).pathname];
      return hit === undefined ? new Response('{"error":"not_found"}', { status: 404 }) : Response.json(hit);
    },
  };
  return { binding, calls };
}
const ctx = { waitUntil: () => undefined };

/** A request context that keeps what was handed to waitUntil, so a test can let the cache writes finish like the runtime does after the response. */
function settling() {
  const pending: Promise<unknown>[] = [];
  return { ctx: { waitUntil: (p: Promise<unknown>) => void pending.push(p) }, settle: () => Promise.all(pending.splice(0)) };
}

afterEach(() => vi.unstubAllGlobals());

describe('contentRuntime: the binding in production, a URL locally', () => {
  it('with only the binding: the base is the placeholder host and the fetch is the binding\'s', async () => {
    const { binding, calls } = fakeBinding({ '/api/public/reports': { reports: SAMPLE_REPORTS } });
    const runtime = contentRuntime({ API: binding }, ctx);
    expect(runtime.baseUrl).toBe(SERVICE_BINDING_BASE);
    const { reports, source } = await loadReports({ ...runtime, cache: fakeCache(() => 0) });
    expect(source).toBe('network');
    expect(reports?.length).toBe(SAMPLE_REPORTS.length);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${SERVICE_BINDING_BASE}/api/public/reports`);
    expect(new Headers(calls[0]!.init?.headers).get('accept')).toBe('application/json');
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('with the binding and CONTENT_API_URL: the URL wins, and the binding is not called', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => (urls.push(String(url)), Response.json({ reports: SAMPLE_REPORTS })));
    const { binding, calls } = fakeBinding({ '/api/public/reports': { reports: [] } });
    const runtime = contentRuntime({ API: binding, CONTENT_API_URL: 'http://127.0.0.1:4391/' }, ctx);
    expect(runtime.baseUrl).toBe('http://127.0.0.1:4391');
    const out = await loadReports({ ...runtime, cache: fakeCache(() => 0) });
    expect(out.reports?.length).toBe(SAMPLE_REPORTS.length);
    expect(urls).toEqual(['http://127.0.0.1:4391/api/public/reports']);
    expect(calls).toHaveLength(0);
  });

  it('an empty CONTENT_API_URL counts as unset (the binding is used)', () => {
    const { binding } = fakeBinding();
    expect(contentRuntime({ API: binding, CONTENT_API_URL: '' }, ctx).baseUrl).toBe(SERVICE_BINDING_BASE);
  });

  it('with neither: no base and nothing is fetched (the page shows its degraded state)', async () => {
    const runtime = contentRuntime({}, ctx);
    expect(runtime.baseUrl).toBeUndefined();
    expect(runtime.fetchImpl).toBeUndefined();
    vi.stubGlobal('fetch', () => {
      throw new Error('nothing may be fetched');
    });
    expect(await loadReports(runtime)).toEqual({ reports: null, source: 'empty' });
  });

  it('every list loader and the blog read through the binding when it is the only target', async () => {
    const { binding, calls } = fakeBinding({
      '/api/public/team': { members: SAMPLE_MEMBERS },
      '/api/public/reports': { reports: SAMPLE_REPORTS },
      '/api/public/resources': { resources: SAMPLE_RESOURCES },
    });
    const runtime = { ...contentRuntime({ API: binding }, ctx), cache: fakeCache(() => 0) };
    expect((await loadTeam(runtime)).members.length).toBe(SAMPLE_MEMBERS.length);
    expect((await loadReports(runtime)).reports?.length).toBe(SAMPLE_REPORTS.length);
    expect((await loadResources(runtime)).resources?.length).toBe(SAMPLE_RESOURCES.length);
    // the blog takes the same target, from the same function
    const blog = createApiBlogSource({ target: contentApiTarget({ API: binding }), cache: fakeCache(() => 0) });
    await blog.list(1);
    await blog.article('contoh-artikel');
    expect(calls.map((c) => c.url)).toEqual([
      `${SERVICE_BINDING_BASE}/api/public/team`,
      `${SERVICE_BINDING_BASE}/api/public/reports`,
      `${SERVICE_BINDING_BASE}/api/public/resources`,
      `${SERVICE_BINDING_BASE}/api/public/blog?page=1&pageSize=15`,
      `${SERVICE_BINDING_BASE}/api/public/blog/contoh-artikel`,
    ]);
  });

  it('the cache keeps working through the binding: a second call within the fresh window does not call the API', async () => {
    const { binding, calls } = fakeBinding({ '/api/public/things': { things: [1] } });
    const cache = fakeCache(() => 0);
    const { ctx: requestCtx, settle } = settling();
    const opts = { ...contentRuntime({ API: binding }, requestCtx), cache, path: '/api/public/things', parse: (p: unknown) => listOf(p, 'things') };
    expect((await loadContent(opts)).source).toBe('network');
    await settle();
    expect((await loadContent(opts)).source).toBe('cache');
    expect(calls).toHaveLength(1);
    // the cache key is the synthetic URL on the placeholder host, never a public one
    expect([...cache.store.keys()].sort()).toEqual([`${SERVICE_BINDING_BASE}/api/public/things`, `${SERVICE_BINDING_BASE}/api/public/things?copy=stale`]);
  });

  it('a failing binding is an outage like any other: stale copy, else the degraded state, never a throw', async () => {
    let healthy = true;
    const binding = {
      fetch: async () => {
        if (!healthy) throw new Error('Worker exceeded CPU time limit');
        return Response.json({ reports: SAMPLE_REPORTS });
      },
    };
    let t = 0;
    const cache = fakeCache(() => t);
    const { ctx: requestCtx, settle } = settling();
    const runtime = { ...contentRuntime({ API: binding }, requestCtx), cache };
    expect((await loadReports(runtime)).source).toBe('network');
    await settle();
    healthy = false;
    t += 61_000;
    expect((await loadReports(runtime)).source).toBe('stale');
    expect(await loadReports({ ...runtime, cache: fakeCache(() => 0) })).toEqual({ reports: null, source: 'empty' });
  });
});

describe('contactApiTarget: the contact form has its own override', () => {
  it('CONTENT_API_URL does not pull the contact form off the binding; CONTACT_API_URL does, and only that', () => {
    const { binding } = fakeBinding();
    expect(contactApiTarget({ API: binding, CONTENT_API_URL: 'http://127.0.0.1:4391' })?.via).toBe('binding');
    expect(contactApiTarget({ API: binding, CONTACT_API_URL: 'http://127.0.0.1:4391' })?.via).toBe('url');
    expect(contactApiTarget({})).toBeNull();
  });
});

describe('where the API is decided: one place', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const file = path.join(dir, name);
      return statSync(file).isDirectory() ? walk(file) : [file];
    });
  const sources = walk(path.join(webRoot, 'src')).filter((f) => /\.(ts|astro)$/.test(f));

  it('only lib/api-client.ts reads CONTENT_API_URL or CONTACT_API_URL from the env (pages and loaders take their target from it)', () => {
    const readers = sources.filter((f) => /\.(CONTENT_API_URL|CONTACT_API_URL)\b/.test(readFileSync(f, 'utf8')));
    expect(readers.map((f) => path.relative(webRoot, f))).toEqual(['src/lib/api-client.ts']);
  });

  it('every page that reads content hands the loader `contentRuntime(env, ...)`; the team page does the same and only adds its own fresh window', () => {
    for (const page of ['src/pages/donasi.astro', 'src/pages/gabung-siswa/docs.astro']) {
      expect(readWeb(page), page).toContain('contentRuntime(env, Astro.locals.cfContext)');
    }
    const tim = readWeb('src/pages/tim.astro');
    expect(tim).toContain('...contentRuntime(env, Astro.locals.cfContext)');
    expect(tim).toContain('freshTtlSeconds: Number(env.TEAM_CACHE_FRESH_SECONDS) || undefined');
    expect(tim).not.toContain('baseUrl:');
    // the blog goes through getBlogSource -> contentApiTarget(env)
    expect(readWeb('src/lib/blog.ts')).toContain('target: contentApiTarget(env)');
  });
});

describe('wrangler.jsonc: the service binding to the API Worker', () => {
  /** JSONC -> JSON: line comments and trailing commas out (no string of this file contains `//` followed by a space except in comments). */
  const parse = (text: string) =>
    JSON.parse(
      text
        .split('\n')
        .map((line) => line.replace(/^\s*\/\/.*$/, ''))
        .join('\n')
        .replace(/,(\s*[}\]])/g, '$1'),
    ) as { services: { binding: string; service: string; entrypoint?: string }[]; vars?: Record<string, unknown> };

  const web = parse(readWeb('wrangler.jsonc'));
  const admin = parse(readRoot('cf/admin/wrangler.jsonc')) as unknown as { name: string };

  it('`API` points at the PublicApi entrypoint of the API Worker, whose name is the one cf/admin gives itself', () => {
    expect(web.services).toEqual([{ binding: 'API', service: admin.name, entrypoint: 'PublicApi' }]);
    expect(admin.name).toBe('sakem-admin');
    // the entrypoint exists in the API Worker, under that name
    expect(readRoot('cf/admin/src/worker.ts')).toContain('export { PublicApi }');
    expect(readRoot('cf/admin/src/api/public/entrypoint.ts')).toContain('export class PublicApi extends WorkerEntrypoint');
  });

  it('the placeholder is a plain Worker name: no account id, no hostname, no URL, no secret', () => {
    const entry = web.services[0]!;
    expect(entry.service).toMatch(/^[a-z][a-z0-9-]{0,62}$/);
    expect(JSON.stringify(web.services)).not.toMatch(/[0-9a-f]{32}|https?:|\.[a-z]{2,}\b/i);
  });

  it('no var of the checked-in config sets an API URL or a key: production reads through the binding, and the site key is set per deploy', () => {
    expect(Object.keys(web.vars ?? {})).toEqual([]);
    const raw = readWeb('wrangler.jsonc');
    // the only mentions are inside comments that say NEVER to set them
    for (const name of ['CONTENT_API_URL', 'CONTACT_API_URL']) {
      for (const line of raw.split('\n').filter((l) => l.includes(name))) expect(line.trim().startsWith('//'), line).toBe(true);
    }
    expect(raw).toContain('NEVER set CONTENT_API_URL or CONTACT_API_URL in production');
  });
});
