import { describe, expect, it } from 'vitest';
import { REDIRECTS, WP_BLOG_CATEGORIES, matchRedirect, toUnderscoreRedirects } from '../redirects.config.mjs';
import { blogPosts, readRoot } from './helpers';

/**
 * A small evaluator for Cloudflare `_redirects` syntax (placeholders `:name`
 * match one segment, `*` matches the rest and fills `:splat`, first match wins,
 * the query string is kept unless the destination has its own). It lets the
 * unit tests check the FILE that ships to the assets layer, not only the table.
 */
function evalUnderscoreRedirects(file: string, pathname: string, search = ''): { status: number; location: string } | null {
  for (const line of file.split('\n').filter(Boolean)) {
    const [source, destination, status] = line.trim().split(/\s+/);
    const keys: string[] = [];
    const pattern = source
      .split('/')
      .map((seg) => {
        if (seg === '*') {
          keys.push('splat');
          return '(.*)';
        }
        if (seg.startsWith(':')) {
          keys.push(seg.slice(1));
          return '([^/]+)';
        }
        return seg.replace(/[.*+?^${}()|\\]/g, '\\$&');
      })
      .join('/');
    const m = pathname.match(new RegExp(`^${pattern}$`));
    if (!m) continue;
    let location = destination;
    keys.forEach((k, i) => (location = location.replace(`:${k}`, m[i + 1])));
    if (search && !location.includes('?')) location += search;
    return { status: Number(status), location };
  }
  return null;
}

const file = toUnderscoreRedirects();

describe('every WordPress sourceUrl of the 80 articles redirects to /blog/<slug> with 308', () => {
  const { articles } = blogPosts();

  it('the dataset is the 80 articles', () => {
    expect(articles).toHaveLength(80);
  });

  it.each(articles.map((a) => [a.id, a.sourceUrl] as const))('%s', (id, sourceUrl) => {
    const { pathname } = new URL(sourceUrl);
    expect(pathname).toMatch(/^\/[a-z-]+\/[^/]+\/$/); // /<category>/<slug>/ with the WordPress trailing slash

    // the table (middleware, astro dev)
    expect(matchRedirect(pathname)).toEqual({ status: 308, location: `/blog/${id}` });
    // the same URL without the trailing slash
    expect(matchRedirect(pathname.replace(/\/$/, ''))).toEqual({ status: 308, location: `/blog/${id}` });
    // the generated _redirects file (production, answered by the assets layer)
    expect(evalUnderscoreRedirects(file, pathname)).toEqual({ status: 308, location: `/blog/${id}` });
    expect(evalUnderscoreRedirects(file, pathname.replace(/\/$/, ''))).toEqual({ status: 308, location: `/blog/${id}` });
  });

  it('every category used by the articles is a redirected category', () => {
    const used = new Set(articles.map((a) => new URL(a.sourceUrl).pathname.split('/')[1]));
    for (const cat of used) expect(WP_BLOG_CATEGORIES).toContain(cat);
  });
});

describe('the other rules, in the table and in the shipped _redirects file', () => {
  const cases: [string, string, number, string][] = [
    ['/cerita', '', 308, '/blog'],
    ['/education/', '', 308, '/blog'],
    ['/kiat-kiat', '', 308, '/blog'],
    ['/daftar', '', 308, '/gabung-siswa'],
    ['/apply', '', 308, '/gabung-siswa'],
    ['/gabung-siswa/form', '', 308, '/portal/daftar'],
    // M4: the legacy auth pages moved into the student portal.
    ['/login', '', 308, '/portal/login'],
    ['/login/', '', 308, '/portal/login'],
    ['/register', '', 308, '/portal/register'],
    ['/forgot-password', '', 308, '/portal/forgot-password'],
    ['/reset-password', '', 308, '/portal/reset-password'],
    ['/verify-email', '', 308, '/portal/verify-email'],
    ['/login', '?from=%2Fportal%2Fstatus', 308, '/portal/login?from=%2Fportal%2Fstatus'],
    ['/reset-password', '?token=abc', 308, '/portal/reset-password?token=abc'],
    ['/tentang-kami', '', 308, '/tim'],
    ['/about', '', 308, '/tim'],
    ['/impact-reports', '', 308, '/laporan'],
    ['/impact-reports/2025/q1', '', 308, '/laporan'],
    ['/blog/page/3', '', 308, '/blog?page=3'],
    ['/blog/page/3/', '', 308, '/blog?page=3'],
    ['/feed', '', 308, '/blog'],
    ['/feed/atom/', '', 308, '/blog'],
    ['/index.php', '', 308, '/'],
    ['/wp-content/uploads/2026/05/foto.jpg', '', 308, '/blog/images/2026/05/foto.jpg'],
    ['/program', '', 307, '/program/prapembinaan'],
    ['/cerita/x', '?utm_source=a', 308, '/blog/x?utm_source=a'],
    ['/blog/page/2', '?utm_source=a', 308, '/blog?page=2'],
  ];
  it.each(cases)('%s%s -> %i %s', (path, search, status, location) => {
    expect(matchRedirect(path, search)).toEqual({ status, location });
    expect(evalUnderscoreRedirects(file, path, search)).toEqual({ status, location });
  });

  it.each(['/', '/blog', '/blog/some-slug', '/tim', '/portal/daftar', '/portal/login', '/cerita/a/b', '/blog/page', '/wp-content', '/programs', '/login-help', '/registered', '/admin', '/api'])(
    '%s is not redirected',
    (path) => {
      expect(matchRedirect(path)).toBeNull();
      expect(evalUnderscoreRedirects(file, path)).toBeNull();
    },
  );
});

describe('parity with the root next.config.ts', () => {
  const next = readRoot('next.config.ts');

  it('same WordPress category list', () => {
    const block = next.match(/const WP_BLOG_CATEGORIES = \[([\s\S]*?)\] as const/)?.[1] ?? '';
    const cats = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(cats).toEqual(WP_BLOG_CATEGORIES);
  });

  it('every explicit rule of next.config.ts is in the table, with the same status', () => {
    const rules = [...next.matchAll(/source:\s*"([^"]+)",\s*destination:\s*"([^"]+)",\s*permanent:\s*(true|false)/g)];
    expect(rules.length).toBeGreaterThanOrEqual(11);
    const toAstro = (s: string) => s.replace(/:path\*/g, '[...path]').replace(/:(\w+)/g, '[$1]');
    for (const [, source, destination, permanent] of rules) {
      const entry = REDIRECTS[toAstro(source)];
      expect(entry, `missing rule for ${source}`).toBeDefined();
      expect(entry.destination).toBe(toAstro(destination));
      expect(entry.status).toBe(permanent === 'true' ? 308 : 307);
    }
  });

  it('table = next.config.ts rules + the two SAKEM-075 additions + the five auth pages of M4 + 2 x 7 category rules', () => {
    const explicit = [...next.matchAll(/source:\s*"([^"]+)",\s*destination:/g)].length;
    // next.config.ts: 11 literal rules; the 14 category rules are generated from the list.
    expect(Object.keys(REDIRECTS)).toHaveLength(explicit + WP_BLOG_CATEGORIES.length * 2 + 2 + 5);
  });

  it('the auth pages that moved into the portal are exactly the five names, each to the same name under /portal', () => {
    const auth = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email'];
    for (const name of auth) expect(REDIRECTS[name], name).toEqual({ status: 308, destination: `/portal${name}` });
  });
});

describe('_redirects file shape', () => {
  it('static rules come first, every line is "source destination status"', () => {
    const lines = file.trim().split('\n');
    const firstDynamic = lines.findIndex((l) => /[:*]/.test(l.split(/\s+/)[0]));
    expect(firstDynamic).toBeGreaterThan(0);
    expect(lines.slice(firstDynamic).every((l) => /[:*]/.test(l.split(/\s+/)[0]))).toBe(true);
    for (const line of lines) expect(line).toMatch(/^\/\S*\s+\/\S*\s+30[78]$/);
  });

  it('stays inside the Cloudflare limits (2000 static, 100 dynamic)', () => {
    const lines = file.trim().split('\n');
    const dynamic = lines.filter((l) => /[:*]/.test(l.split(/\s+/)[0])).length;
    expect(dynamic).toBeLessThanOrEqual(100);
    expect(lines.length - dynamic).toBeLessThanOrEqual(2000);
  });
});
