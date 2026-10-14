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

  it('they are the headers the legacy Caddyfile sets on every response', () => {
    const caddy = readRoot('Caddyfile');
    const block = caddy.match(/header \{([\s\S]*?)\n\t\}/)?.[1] ?? '';
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      const line = block.split('\n').find((l) => l.trim().toLowerCase().startsWith(name.toLowerCase()));
      expect(line, name).toBeDefined();
      expect(line!.trim().slice(name.length).trim().replace(/^"|"$/g, '')).toBe(value);
    }
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
  it('static routes, priorities and frequencies equal the root app/sitemap.ts', () => {
    const src = readRoot('app/sitemap.ts');
    const rootRoutes = [...src.matchAll(/\{ path: "([^"]+)", priority: ([\d.]+), changeFrequency: "(\w+)" as const \}/g)].map((m) => ({
      path: m[1],
      priority: Number(m[2]),
      changeFrequency: m[3],
    }));
    expect(rootRoutes).toHaveLength(7);
    expect(STATIC_ROUTES).toEqual(rootRoutes);
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
