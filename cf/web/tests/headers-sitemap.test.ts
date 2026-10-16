import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS, withSecurityHeaders } from '~/lib/security-headers';
import { SITE_URL } from '~/lib/seo';
import { PROGRAM_IDS, ROBOTS_DISALLOW, STATIC_ROUTES, buildRobotsTxt, buildSitemap } from '~/lib/sitemap';
import { importRoot, readRoot, readWeb } from './helpers';

describe('security headers', () => {
  it('public/_headers (assets) and the middleware list (SSR) carry the same five headers', () => {
    const file = readWeb('public/_headers');
    const block = file.split('\n\n').find((b) => b.startsWith('/*')) ?? '';
    const parsed = Object.fromEntries(
      block
        .split('\n')
        .slice(1)
        .map((l) => l.trim().split(/:\s+(.+)/).slice(0, 2) as [string, string]),
    );
    expect(parsed).toEqual(SECURITY_HEADERS);
  });

  it('they are the headers the legacy Caddyfile sets on every response, except HSTS, which is staged on purpose (below)', () => {
    const caddy = readRoot('Caddyfile');
    const block = caddy.match(/header \{([\s\S]*?)\n\t\}/)?.[1] ?? '';
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      const line = block.split('\n').find((l) => l.trim().toLowerCase().startsWith(name.toLowerCase()));
      expect(line, name).toBeDefined();
      if (name === 'Strict-Transport-Security') continue;
      expect(line!.trim().slice(name.length).trim().replace(/^"|"$/g, '')).toBe(value);
    }
  });

  // F-01 / D-04 / P-19 of docs/cloudflare/cutover-runbook.md (SAKEM-103): the Caddyfile's `max-age=31536000; includeSubDomains; preload` commits
  // every subdomain to HTTPS for a year and blocks a rollback to anything without a valid certificate for the apex. Five minutes first, raised in
  // steps (X-07). The value is pinned in BOTH places a response can get it from.
  it('HSTS is staged: max-age=300, no includeSubDomains, no preload, in the middleware list and in public/_headers', () => {
    expect(SECURITY_HEADERS['Strict-Transport-Security']).toBe('max-age=300');
    const file = readWeb('public/_headers');
    const block = file.split('\n\n').find((b) => b.startsWith('/*')) ?? '';
    const line = block.split('\n').find((l) => l.trim().startsWith('Strict-Transport-Security')) ?? '';
    expect(line.trim()).toBe('Strict-Transport-Security: max-age=300');
    for (const text of [SECURITY_HEADERS['Strict-Transport-Security'], line]) {
      expect(text).not.toMatch(/includeSubDomains/i);
      expect(text).not.toMatch(/preload/i);
      expect(text).not.toMatch(/31536000/);
    }
    // the Caddyfile still has the year-long value: it is the legacy stack's, never served by the Worker, and the one deliberate difference
    expect(readRoot('Caddyfile')).toContain('max-age=31536000; includeSubDomains; preload');
  });

  it('a response of the Worker carries the staged value, and an origin answer that has its own HSTS keeps it (existing values win)', () => {
    expect(withSecurityHeaders(new Response('x')).headers.get('strict-transport-security')).toBe('max-age=300');
    expect(withSecurityHeaders(new Response('x', { headers: { 'strict-transport-security': 'max-age=63072000' } })).headers.get('strict-transport-security')).toBe('max-age=63072000');
  });

  it('withSecurityHeaders adds them, keeps status, body and existing values', async () => {
    const res = withSecurityHeaders(new Response('hello', { status: 404, headers: { 'x-frame-options': 'SAMEORIGIN', 'x-a': '1' } }));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('hello');
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-a')).toBe('1');
  });
});

describe('robots.txt', () => {
  it('has the rules of the root app/robots.ts, plus /portal (the student portal is not for search engines)', async () => {
    const src = readRoot('app/robots.ts');
    expect(src).toContain('disallow: ["/admin", "/api", "/login"]');
    expect(ROBOTS_DISALLOW).toEqual(['/admin', '/api', '/login', '/portal']);
    const root = await importRoot<{ default: () => { rules: { userAgent: string; allow: string; disallow: string[] }[]; sitemap: string; host: string } }>('app/robots.ts');
    const r = root.default();
    expect(r.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
    expect(r.host).toBe(SITE_URL);
    const body = buildRobotsTxt();
    expect(body).toContain(`User-Agent: ${r.rules[0].userAgent}`);
    expect(body).toContain(`Allow: ${r.rules[0].allow}`);
    for (const d of r.rules[0].disallow) expect(body).toContain(`Disallow: ${d}\n`);
    expect(body).toContain(`Host: ${r.host}`);
    expect(body).toContain(`Sitemap: ${r.sitemap}`);
  });
});

describe('sitemap', () => {
  it('static routes, priorities and frequencies equal the root app/sitemap.ts, except /laporan: it is a redirect to /donasi#laporan since SAKEM-105, and a redirect is not a sitemap URL (/donasi stays, with its own priority)', () => {
    const src = readRoot('app/sitemap.ts');
    const rootRoutes = [...src.matchAll(/\{ path: "([^"]+)", priority: ([\d.]+), changeFrequency: "(\w+)" as const \}/g)].map((m) => ({
      path: m[1],
      priority: Number(m[2]),
      changeFrequency: m[3],
    }));
    expect(rootRoutes).toHaveLength(7);
    expect(rootRoutes.map((r) => r.path)).toContain('/laporan');
    expect(STATIC_ROUTES).toEqual(rootRoutes.filter((r) => r.path !== '/laporan'));
    expect(STATIC_ROUTES.map((r) => r.path)).not.toContain('/laporan');
    expect(STATIC_ROUTES.map((r) => r.path)).toContain('/donasi');
  });

  it('program ids equal lib/data.ts of the root app', () => {
    const data = readRoot('lib/data.ts');
    const ids = [...data.matchAll(/^\s{4}id: "([a-z-]+)",$/gm)].map((m) => m[1]);
    expect(ids).toEqual(PROGRAM_IDS);
  });

  it('buildSitemap: urlset shape, lastmod only when given, XML-escaped, priority printed like Next', () => {
    const xml = buildSitemap([
      { url: 'https://x.test/a?b=1&c=2', changeFrequency: 'weekly', priority: 1.0 },
      { url: 'https://x.test/b', changeFrequency: 'monthly', priority: 0.85, lastModified: '2026-05-21' },
      { url: 'https://x.test/c', changeFrequency: 'monthly', priority: 0.6, lastModified: '2026-05-21T10:00:00+07:00' },
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
    expect(xml).toContain('<loc>https://x.test/a?b=1&amp;c=2</loc>');
    expect(xml).toContain('<url><loc>https://x.test/a?b=1&amp;c=2</loc><changefreq>weekly</changefreq><priority>1</priority></url>');
    expect(xml).toContain('<lastmod>2026-05-21</lastmod>');
    expect(xml).toContain('<lastmod>2026-05-21T03:00:00.000Z</lastmod>');
    expect(xml).toContain('<priority>0.85</priority>');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });
});
