import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REDIRECTS, WP_BLOG_CATEGORIES, matchRedirect, slashFoldPaths, toUnderscoreRedirects } from '../redirects.config.mjs';
import { ARTICLE_COUNT, IMPORTED_2026_10_13, blogPosts, readRoot, repoRoot, webRoot } from './helpers';

/** The article files of the repo root (README.md is not one). */
const articleFiles = () => readdirSync(`${repoRoot}content/blog`).filter((f) => f.endsWith('.md') && f !== 'README.md');

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

describe('every WordPress sourceUrl of the articles (80 migrated + 6 imported on 2026-10-13) redirects to /blog/<slug> with 308', () => {
  const { articles } = blogPosts();

  it('the dataset is every article', () => {
    expect(articles).toHaveLength(ARTICLE_COUNT);
  });

  it('the 6 imported on 2026-10-13 are in it, with the WordPress address the live sitemap lists for each', () => {
    const ids = new Set(articles.map((a) => a.id));
    for (const slug of IMPORTED_2026_10_13) {
      expect(ids.has(slug), slug).toBe(true);
      const { sourceUrl } = articles.find((a) => a.id === slug)!;
      expect(new URL(sourceUrl).pathname.split('/').filter(Boolean).at(-1)).toBe(slug);
    }
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

/**
 * SAKEM-090: the WordPress pages and archives that the live sitemap lists and the new site has no page for (the SEO parity
 * run of 2026-10-13: 103 blockers, 97 of them "url-missing"). Destinations approved by Dzul; all permanent.
 * 13 pages + 2 archive splats + 1 renamed article slug = 16 rules.
 */
const SAKEM_090_RULES = 16;

/** [WordPress path as the live sitemap lists it (trailing slash), destination]. */
const WORDPRESS_PAGES: [string, string][] = [
  ['/home/', '/'],
  ['/sample-page/', '/'],
  // The approved mapping says "/tentang-kami", which is itself a rule of the table (to /tim): the pages go straight to /tim
  // so that nobody pays two hops. /tentang-kami stays a redirect, as before (see the `cases` above).
  ['/who-we-are/', '/tim'],
  ['/our-partners/', '/tim'],
  ['/contact-us/', '/kontak'],
  ['/donate/', '/donasi'],
  ['/donation-confirmation/', '/donasi'],
  ['/donation-confirmation-2/', '/donasi'],
  ['/donation-failed/', '/donasi'],
  ['/donation-failed-2/', '/donasi'],
  ['/donor-dashboard/', '/donasi'],
  ['/donor-dashboard-2/', '/donasi'],
  ['/work-with-us/', '/gabung-siswa'],
];

const OLD_FOUNDER_SLUG = 'perjalanan-seorang-founder-rommy-mendirikan-sakola-kembara-untuk-pendidikan-inklusif';

describe('SAKEM-090: the WordPress pages of the live sitemap', () => {
  it.each(WORDPRESS_PAGES)('%s -> 308 %s, with and without the trailing slash, in the table and in the shipped file', (live, destination) => {
    for (const path of [live, live.replace(/\/$/, '')]) {
      expect(matchRedirect(path), path).toEqual({ status: 308, location: destination });
      expect(evalUnderscoreRedirects(file, path), path).toEqual({ status: 308, location: destination });
    }
  });

  it('the destination of every one is a real page of this site (a file of src/pages), so none of them ends in a 404', () => {
    for (const [, destination] of WORDPRESS_PAGES) {
      const rel = destination === '/' ? 'index' : destination.slice(1);
      const candidates = [`src/pages/${rel}.astro`, `src/pages/${rel}/index.astro`];
      expect(
        candidates.some((c) => existsSync(`${webRoot}${c}`)),
        `${destination}: none of ${candidates.join(', ')}`,
      ).toBe(true);
    }
  });

  it('the pages the approved mapping names are real pages, not redirects: /kontak, /donasi, /gabung-siswa (and /tim, where /tentang-kami ends)', () => {
    for (const path of ['/kontak', '/donasi', '/gabung-siswa', '/tim', '/blog', '/']) {
      expect(matchRedirect(path), path).toBeNull();
      expect(evalUnderscoreRedirects(file, path), path).toBeNull();
    }
    expect(matchRedirect('/tentang-kami')).toEqual({ status: 308, location: '/tim' });
  });

  it('the query string is carried (a campaign link such as /donate/?utm_source=ig keeps it)', () => {
    expect(matchRedirect('/donate/', '?utm_source=ig')).toEqual({ status: 308, location: '/donasi?utm_source=ig' });
    expect(evalUnderscoreRedirects(file, '/donate/', '?utm_source=ig')).toEqual({ status: 308, location: '/donasi?utm_source=ig' });
  });
});

describe('SAKEM-090: category and tag archives go to the blog index', () => {
  // A sample of the 7 categories and 77 tags of the live sitemap (the whole list is in the report of 2026-10-13).
  const archives = [
    '/category/cerita/', '/category/kiat-kiat/', '/category/news/', '/category/education/', '/category/tips/', '/category/testimonials/', '/category/career/',
    '/tag/ekonomi/', '/tag/sakola-kembara/', '/tag/snbt/', '/tag/pendidkan/', '/tag/talents-mapping/',
  ];

  it.each(archives)('%s -> 308 /blog (the table and the shipped file; with and without the trailing slash)', (live) => {
    for (const path of [live, live.replace(/\/$/, '')]) {
      expect(matchRedirect(path), path).toEqual({ status: 308, location: '/blog' });
      expect(evalUnderscoreRedirects(file, path), path).toEqual({ status: 308, location: '/blog' });
    }
  });

  it('a splat: anything below an archive goes too (a feed, a page of the archive, a tag added after the audit)', () => {
    for (const path of ['/category/news/feed/', '/category/news/page/2/', '/tag/baru-dibuat/', '/tag/a/b/c']) {
      expect(matchRedirect(path), path).toEqual({ status: 308, location: '/blog' });
      expect(evalUnderscoreRedirects(file, path), path).toEqual({ status: 308, location: '/blog' });
    }
  });

  it('the archive roots without a slash are not redirected (WordPress has no /category page), nor are look-alikes', () => {
    // (`/category/` with the slash: the shipped file's splat may take an empty rest, which would send it to /blog too; harmless.)
    for (const path of ['/category', '/tag', '/categories/news', '/tags/x', '/tagline', '/category-news']) {
      expect(matchRedirect(path), path).toBeNull();
      expect(evalUnderscoreRedirects(file, path), path).toBeNull();
    }
  });

  it('the query string is carried', () => {
    expect(matchRedirect('/tag/ekonomi/', '?utm_source=x')).toEqual({ status: 308, location: '/blog?utm_source=x' });
  });
});

describe('SAKEM-090: the renamed founder article', () => {
  it('/blog/<old slug> -> /blog/perjalanan-seorang-founder, the link that 8 article bodies still carry', () => {
    const expected = { status: 308, location: '/blog/perjalanan-seorang-founder' };
    for (const path of [`/blog/${OLD_FOUNDER_SLUG}`, `/blog/${OLD_FOUNDER_SLUG}/`]) {
      expect(matchRedirect(path), path).toEqual(expected);
      expect(evalUnderscoreRedirects(file, path), path).toEqual(expected);
    }
  });

  it('every internal /blog/<slug> link of every article body is an article, or is redirected to one (no broken internal link ships)', () => {
    const slugs = new Set(articleFiles().map((f) => f.replace(/\.md$/, '')));
    const broken: string[] = [];
    for (const f of articleFiles()) {
      for (const m of readFileSync(`${repoRoot}content/blog/${f}`, 'utf8').matchAll(/\]\(\/blog\/([^)\s#?/]+)/g)) {
        const slug = m[1];
        if (slug === 'images' || slugs.has(slug)) continue;
        const hit = matchRedirect(`/blog/${slug}`);
        if (!hit || !slugs.has(hit.location.replace('/blog/', ''))) broken.push(`${f} -> /blog/${slug}`);
      }
    }
    expect(broken).toEqual([]);
  });
});

describe('SAKEM-090: no redirect loops, no needless chains', () => {
  /** A request path that a pattern matches: [slug] and [...path] filled with plausible values. */
  const sample = (pattern: string) => pattern.replace(/\[\.\.\.(\w+)\]/g, 'a/b').replace(/\[(\w+)\]/g, 'x');

  /** Follow the table the way a client follows 308s; returns the visited paths, or throws on a loop. */
  function follow(start: string): string[] {
    const seen = [start];
    for (let hops = 0; hops < 10; hops++) {
      const hit = matchRedirect(seen[seen.length - 1].split('?')[0]);
      if (!hit) return seen;
      const next = hit.location.split('?')[0];
      if (seen.includes(next)) throw new Error(`redirect loop: ${[...seen, next].join(' -> ')}`);
      seen.push(next);
    }
    throw new Error(`more than 10 hops from ${start}: ${seen.join(' -> ')}`);
  }

  it('from the sample path of every rule the chain ends (no loop) and no destination is itself redirected again', () => {
    const chains: string[] = [];
    for (const pattern of Object.keys(REDIRECTS)) {
      const path = follow(sample(pattern));
      if (path.length > 2) chains.push(path.join(' -> '));
    }
    expect(chains).toEqual([]);
  });

  it('the one two-hop address is the old category address of the renamed founder article (/<category>/<old slug>), and it ends on the article', () => {
    expect(follow(`/cerita/${OLD_FOUNDER_SLUG}`)).toEqual([`/cerita/${OLD_FOUNDER_SLUG}`, `/blog/${OLD_FOUNDER_SLUG}`, '/blog/perjalanan-seorang-founder']);
  });

  it('every WordPress page and archive of SAKEM-090 is exactly one hop', () => {
    for (const [live] of WORDPRESS_PAGES) expect(follow(live.replace(/\/$/, '')), live).toHaveLength(2);
    for (const archive of ['/category/news/', '/tag/ekonomi/']) expect(follow(archive.replace(/\/$/, '')), archive).toHaveLength(2);
  });

  it('the shipped file and the table give the same answer for the sample path of every rule', () => {
    for (const pattern of Object.keys(REDIRECTS)) {
      const path = sample(pattern);
      expect(evalUnderscoreRedirects(file, path), pattern).toEqual(matchRedirect(path));
    }
  });
});

describe('the trailing-slash fold of the prerendered pages (F-03 of the cutover runbook)', () => {
  it('the paths come from the .html files of the client folder: the home page and the 404 are not pages to fold', () => {
    expect(slashFoldPaths(['index.html', '404.html', 'donasi.html', 'program/pembinaan.html', 'program/prapembinaan.html', 'robots.txt', '_astro/x.css', 'blog/images/a.png'])).toEqual([
      '/donasi',
      '/program/pembinaan',
      '/program/prapembinaan',
    ]);
    expect(slashFoldPaths([])).toEqual([]);
    expect(slashFoldPaths(['x/index.html'])).toEqual([]); // a folder index is served WITH a slash: nothing to fold
  });

  const folded = toUnderscoreRedirects(REDIRECTS, { slashFolds: ['/donasi', '/program/pembinaan'] });

  it('writes `/<page>/  /<page>  308` for each, before every other rule', () => {
    const lines = folded.trim().split('\n');
    expect(lines.slice(0, 2)).toEqual(['/donasi/  /donasi  308', '/program/pembinaan/  /program/pembinaan  308']);
    expect(evalUnderscoreRedirects(folded, '/donasi/')).toEqual({ status: 308, location: '/donasi' });
    expect(evalUnderscoreRedirects(folded, '/donasi/', '?utm_source=x')).toEqual({ status: 308, location: '/donasi?utm_source=x' });
    // the page itself is never redirected (that would be a loop)
    expect(evalUnderscoreRedirects(folded, '/donasi')).toBeNull();
    expect(evalUnderscoreRedirects(folded, '/program/pembinaan')).toBeNull();
  });

  it('adds nothing but those lines to the default table, and keeps the Cloudflare limits and the file shape', () => {
    expect(toUnderscoreRedirects().trim().split('\n')).toEqual(folded.trim().split('\n').slice(2));
    const lines = folded.trim().split('\n');
    const dynamic = lines.filter((l) => /[:*]/.test(l.split(/\s+/)[0])).length;
    expect(dynamic).toBeLessThanOrEqual(100);
    expect(lines.length - dynamic).toBeLessThanOrEqual(2000);
    for (const line of lines) expect(line).toMatch(/^\/\S*\s+\/\S*\s+30[78]$/);
  });
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

  it('table = next.config.ts rules + the two SAKEM-075 additions + the five auth pages of M4 + 2 x 7 category rules + the SAKEM-090 additions', () => {
    const explicit = [...next.matchAll(/source:\s*"([^"]+)",\s*destination:/g)].length;
    // next.config.ts: 11 literal rules; the 14 category rules are generated from the list.
    expect(Object.keys(REDIRECTS)).toHaveLength(explicit + WP_BLOG_CATEGORIES.length * 2 + 2 + 5 + SAKEM_090_RULES);
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
