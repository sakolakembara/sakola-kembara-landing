import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REDIRECTS, WP_BLOG_CATEGORIES, matchRedirect, mirroredUploadRules, slashFoldPaths, toUnderscoreRedirects } from '../redirects.config.mjs';
import { LEGACY_PATHS, PORTAL_OWNED_PATHS } from '~/lib/legacy-paths';
import { ARTICLE_COUNT, IMPORTED_2026_10_13, blogPosts, readRoot, repoRoot, webRoot } from './helpers';

/** The article files of the repo root (README.md is not one). */
const articleFiles = () => readdirSync(`${repoRoot}content/blog`).filter((f) => f.endsWith('.md') && f !== 'README.md');

/**
 * A small evaluator for Cloudflare `_redirects` syntax (placeholders `:name`
 * match one segment, `*` matches the rest and fills `:splat`, first match wins,
 * the query string is kept unless the destination has its own, and goes before a
 * fragment of the destination, as the assets layer writes it: `/donasi?utm=x#laporan`,
 * checked against the local one by scripts/e2e.mjs). It lets the
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
    if (search && !location.includes('?')) {
      const fragment = location.indexOf('#');
      location = fragment < 0 ? location + search : `${location.slice(0, fragment)}${search}${location.slice(fragment)}`;
    }
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
    ['/apply', '', 308, '/gabung-siswa'],
    // SAKEM-103: the old registration form goes to the registration shortlink, which is not a rule of this table (D1).
    ['/gabung-siswa/form', '', 308, '/daftar'],
    ['/gabung-siswa/form', '?utm_source=ig', 308, '/daftar?utm_source=ig'],
    ['/tentang-kami', '', 308, '/tim'],
    ['/about', '', 308, '/tim'],
    // SAKEM-105: the reports are a section of /donasi; the old page and the older name both go straight to it (one hop), and a
    // query is kept BEFORE the fragment
    ['/impact-reports', '', 308, '/donasi#laporan'],
    ['/impact-reports/2025/q1', '', 308, '/donasi#laporan'],
    ['/impact-reports/', '?utm_source=a', 308, '/donasi?utm_source=a#laporan'],
    ['/laporan', '', 308, '/donasi#laporan'],
    ['/laporan/', '', 308, '/donasi#laporan'],
    ['/laporan', '?utm_source=a', 308, '/donasi?utm_source=a#laporan'],
    ['/laporan/', '?a=1&b=2', 308, '/donasi?a=1&b=2#laporan'],
    ['/blog/page/3', '', 308, '/blog?page=3'],
    ['/blog/page/3/', '', 308, '/blog?page=3'],
    ['/feed', '', 308, '/blog'],
    ['/feed/atom/', '', 308, '/blog'],
    ['/index.php', '', 308, '/'],
    ['/program', '', 307, '/program/prapembinaan'],
    ['/cerita/x', '?utm_source=a', 308, '/blog/x?utm_source=a'],
    ['/blog/page/2', '?utm_source=a', 308, '/blog?page=2'],
  ];
  it.each(cases)('%s%s -> %i %s', (path, search, status, location) => {
    expect(matchRedirect(path, search)).toEqual({ status, location });
    expect(evalUnderscoreRedirects(file, path, search)).toEqual({ status, location });
  });

  it.each([
    '/', '/blog', '/blog/some-slug', '/tim', '/portal/daftar', '/portal/login', '/cerita/a/b', '/blog/page', '/wp-content', '/programs', '/login-help', '/registered', '/admin', '/api',
    // SAKEM-103: the registration link is a shortlink, the auth names are WordPress's (/login) or the site's 404, and an upload is WordPress's unless this build copied it
    '/daftar', '/daftar/', '/login', '/login/', '/register', '/forgot-password', '/reset-password', '/verify-email',
    '/wp-content/uploads/2026/05/foto.jpg', '/wp-content/uploads/2099/01/not-copied.jpg',
  ])(
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
/** SAKEM-105: `/laporan` (the page that became a section of /donasi). */
const SAKEM_105_RULES = 1;

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
      const hit = matchRedirect(seen[seen.length - 1].split(/[?#]/)[0]);
      if (!hit) return seen;
      const next = hit.location.split(/[?#]/)[0]; // the query and the fragment are not part of the path the next hop reads
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

  it('every explicit rule of next.config.ts is in the table, with the same status (the four that differ on purpose are checked below)', () => {
    const rules = [...next.matchAll(/source:\s*"([^"]+)",\s*destination:\s*"([^"]+)",\s*permanent:\s*(true|false)/g)];
    expect(rules.length).toBeGreaterThanOrEqual(11);
    const toAstro = (s: string) => s.replace(/:path\*/g, '[...path]').replace(/:(\w+)/g, '[$1]');
    for (const [, source, destination, permanent] of rules) {
      if (source === '/daftar' || source === '/gabung-siswa/form') continue; // SAKEM-103: see the test below
      if (source === '/impact-reports' || source === '/impact-reports/:path*') continue; // SAKEM-105: now straight to /donasi#laporan, see the test below
      const entry = REDIRECTS[toAstro(source)];
      expect(entry, `missing rule for ${source}`).toBeDefined();
      expect(entry.destination).toBe(toAstro(destination));
      expect(entry.status).toBe(permanent === 'true' ? 308 : 307);
    }
  });

  it('table = next.config.ts rules, minus /daftar (a shortlink since SAKEM-103), + /program + 2 x 7 category rules + the SAKEM-090 additions + /laporan (SAKEM-105)', () => {
    const explicit = [...next.matchAll(/source:\s*"([^"]+)",\s*destination:/g)].length;
    // next.config.ts: 11 literal rules; the 14 category rules are generated from the list. Gone since SAKEM-075 and M4: the splat over
    // /wp-content/uploads (a rule per mirrored file is written at build time now) and the five auth pages (Phase A, SAKEM-103).
    expect(Object.keys(REDIRECTS)).toHaveLength(explicit - 1 + WP_BLOG_CATEGORIES.length * 2 + 1 + SAKEM_090_RULES + SAKEM_105_RULES);
  });

  it('Phase A (SAKEM-103): no auth name is a redirect (/login is WordPress\'s, the others are the site\'s own 404), and nothing is redirected into /portal', () => {
    for (const name of ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email', '/daftar']) expect(REDIRECTS[name], name).toBeUndefined();
    for (const [source, { destination }] of Object.entries(REDIRECTS)) expect(destination.startsWith('/portal'), `${source} -> ${destination}`).toBe(false);
    expect(file).not.toContain('/portal');
  });

  it('the two rules of next.config.ts that differ on purpose: /daftar is the shortlink (not in the table), /gabung-siswa/form goes to /daftar and not to /portal/daftar', () => {
    expect(REDIRECTS['/daftar']).toBeUndefined();
    expect(REDIRECTS['/gabung-siswa/form']).toEqual({ status: 308, destination: '/daftar' });
    expect(next).toContain('source: "/daftar", destination: "/gabung-siswa"');
    expect(next).toContain('destination: "/portal/daftar"');
  });

  it('SAKEM-105: the two /impact-reports rules of next.config.ts went to /laporan, a page of the Next app; here /laporan is no page, so they end on its section of /donasi, and /laporan is a rule of its own', () => {
    expect(next).toContain('source: "/impact-reports", destination: "/laporan"');
    expect(REDIRECTS['/impact-reports']).toEqual({ status: 308, destination: '/donasi#laporan' });
    expect(REDIRECTS['/impact-reports/[...path]']).toEqual({ status: 308, destination: '/donasi#laporan' });
    expect(REDIRECTS['/laporan']).toEqual({ status: 308, destination: '/donasi#laporan' });
    expect(next).not.toContain('source: "/laporan"');
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

describe('SAKEM-103: the WordPress uploads this site copied are redirected one by one, every other upload is WordPress\'s', () => {
  const listing = [
    'index.html',
    'blog',
    'blog/images',
    'blog/images/2025',
    'blog/images/2025/10',
    'blog/images/2025/10/1.png',
    'blog/images/2026/04/IMG_9167@-1353469099-Azkiya-Najwah-3-scaled.jpg',
    'blog/images/2026/05/b.jpeg',
    'blog/images/2026/05/.hidden',
    'images/hero.png',
    '_img/0123456789ab-480.webp',
    'blog/imagesx/2026/c.jpg',
  ];

  it('one rule per FILE below blog/images (not folders, not other paths), with the path below it kept, sorted', () => {
    expect(mirroredUploadRules(listing)).toEqual([
      { from: '/wp-content/uploads/2025/10/1.png', to: '/blog/images/2025/10/1.png' },
      { from: '/wp-content/uploads/2026/04/IMG_9167@-1353469099-Azkiya-Najwah-3-scaled.jpg', to: '/blog/images/2026/04/IMG_9167%40-1353469099-Azkiya-Najwah-3-scaled.jpg' },
      { from: '/wp-content/uploads/2026/05/b.jpeg', to: '/blog/images/2026/05/b.jpeg' },
    ]);
    expect(mirroredUploadRules([])).toEqual([]);
    expect(mirroredUploadRules([...listing].reverse())).toEqual(mirroredUploadRules(listing));
  });

  const rules = mirroredUploadRules(listing);
  const withUploads = toUnderscoreRedirects(REDIRECTS, { slashFolds: ['/donasi'], uploadMirrors: rules });

  it('they are written as static rules, 308, between the static rules of the table and the first dynamic one; no trailing-slash twin of a file', () => {
    const lines = withUploads.trim().split('\n');
    const at = (source: string) => lines.findIndex((l) => l.split(/\s+/)[0] === source);
    const firstDynamic = lines.findIndex((l) => /[:*]/.test(l.split(/\s+/)[0]));
    for (const { from, to } of rules) {
      expect(lines, from).toContain(`${from}  ${to}  308`);
      expect(at(from)).toBeGreaterThan(0);
      expect(at(from)).toBeLessThan(firstDynamic);
      expect(at(`${from}/`), `${from}/`).toBe(-1);
    }
    expect(at('/program')).toBeLessThan(at(rules[0].from)); // after the table's own static rules
    expect(lines.slice(0, 1)).toEqual(['/donasi/  /donasi  308']);
  });

  it('an upload this build copied is one hop to its copy; any other upload, and anything else under /wp-content, is not redirected at all', () => {
    const query = '?ver=1';
    expect(evalUnderscoreRedirects(withUploads, '/wp-content/uploads/2025/10/1.png', query)).toEqual({ status: 308, location: `/blog/images/2025/10/1.png${query}` });
    expect(evalUnderscoreRedirects(withUploads, '/wp-content/uploads/2026/04/IMG_9167@-1353469099-Azkiya-Najwah-3-scaled.jpg')).toEqual({
      status: 308,
      location: '/blog/images/2026/04/IMG_9167%40-1353469099-Azkiya-Najwah-3-scaled.jpg',
    });
    for (const path of ['/wp-content/uploads/2025/10/2.png', '/wp-content/uploads/2025/10/1.png.bak', '/wp-content/uploads/2025/10', '/wp-content/themes/astra/style.css', '/wp-content/plugins/x/y.js', '/wp-content/uploads/2099/01/not-copied.jpg']) {
      expect(evalUnderscoreRedirects(withUploads, path), path).toBeNull();
    }
  });

  it('the file stays inside the Cloudflare limits even with a thousand files (about 250 today): static rules of the 2,000', () => {
    const many = mirroredUploadRules(Array.from({ length: 1000 }, (_, i) => `blog/images/2026/${String(i).padStart(4, '0')}.jpg`));
    const lines = toUnderscoreRedirects(REDIRECTS, { uploadMirrors: many }).trim().split('\n');
    const dynamic = lines.filter((l) => /[:*]/.test(l.split(/\s+/)[0])).length;
    expect(dynamic).toBeLessThanOrEqual(100);
    expect(lines.length - dynamic).toBeLessThanOrEqual(2000);
  });

  it('with no uploads the output is the table alone (the default of the helper)', () => {
    expect(toUnderscoreRedirects(REDIRECTS, { uploadMirrors: [] })).toBe(toUnderscoreRedirects(REDIRECTS));
  });
});

describe('SAKEM-103: no redirect rule shadows a path that is forwarded to the origin', () => {
  // The redirect table is answered before the Worker (the assets layer) and again at its start, so a rule over a WordPress path would
  // quietly stop it from ever reaching WordPress.
  const samples = [
    '/wp-admin', '/wp-admin/', '/wp-admin/post.php', '/wp-login.php', '/wp-content', '/wp-content/themes/astra/style.css', '/wp-content/plugins/a/b.js',
    '/wp-content/uploads/2099/01/x.jpg', '/wp-includes/js/a.js', '/wp-json', '/wp-json/wp/v2/posts', '/xmlrpc.php', '/login', '/login/',
  ];

  it.each(samples)('%s: no rule in the table, none in the shipped file', (path) => {
    expect(matchRedirect(path), path).toBeNull();
    expect(evalUnderscoreRedirects(file, path), path).toBeNull();
  });

  it('every entry of the forwarded list is covered by a sample above, and no rule of the table has a source under one of them (the one overlap is a mirrored upload, written per file)', () => {
    for (const entry of LEGACY_PATHS) expect(samples.some((s) => s === entry.path || s.startsWith(`${entry.path}/`)), entry.path).toBe(true);
    for (const source of Object.keys(REDIRECTS)) {
      for (const entry of LEGACY_PATHS) {
        expect(source === entry.path || source.startsWith(`${entry.path}/`), `${source} sits under ${entry.path}`).toBe(false);
      }
    }
  });

  it('nor does a rule of the table take a name of the portal-owned list (they are the site\'s 404 in Phase A, or the admin and API answers of the middleware)', () => {
    for (const source of Object.keys(REDIRECTS)) {
      for (const entry of PORTAL_OWNED_PATHS) expect(source === entry.path || source.startsWith(`${entry.path}/`), `${source} sits under ${entry.path}`).toBe(false);
    }
  });
});
