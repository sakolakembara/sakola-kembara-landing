import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { bodies } from 'virtual:blog-bodies';
import { describe, expect, it } from 'vitest';
import { ARTICLE_COUNT, blogPosts, graphTypes, webRoot } from './helpers';

// Checks on the build output (dist/). They need `pnpm build` first and are
// skipped, not failed, when dist/ is missing, so `pnpm test` works on a fresh clone.
const dist = path.join(webRoot, 'dist');
const built = existsSync(path.join(dist, 'client/index.html'));

const read = (rel: string) => readFileSync(path.join(dist, rel), 'utf8');
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

describe.skipIf(!built)('build output', () => {
  const articles = blogPosts().articles;

  it('prerenders the home page, /gabung-siswa, the program pages and robots.txt; the articles, /donasi (with the reports) and the sitemap are rendered by the Worker (API data)', () => {
    expect(existsSync(path.join(dist, 'client/index.html'))).toBe(true);
    expect(existsSync(path.join(dist, 'client/robots.txt'))).toBe(true);
    // The blog is managed in the new admin and changes without a rebuild, so no article is a file any more.
    const files = readdirSync(path.join(dist, 'client/blog')).filter((f) => f.endsWith('.html'));
    expect(files).toEqual([]);
    expect(existsSync(path.join(dist, 'client/sitemap.xml'))).toBe(false);
  });

  it('_redirects folds the trailing slash of every prerendered page with a 308 (the assets layer answers 307 otherwise, F-03 of the runbook), and of nothing else', () => {
    const client = path.join(dist, 'client');
    const pages = walk(client)
      .map((f) => path.relative(client, f).split(path.sep).join('/'))
      .filter((f) => f.endsWith('.html') && f !== 'index.html' && f !== '404.html')
      .map((f) => `/${f.slice(0, -'.html'.length)}`)
      .sort();
    expect(pages, 'the build prerenders exactly the pages the guide says it does').toEqual(['/gabung-siswa', '/program/pasca-pembinaan', '/program/pembinaan', '/program/prapembinaan']);
    const lines = read('client/_redirects').trim().split('\n');
    // a fold is a rule whose destination is its own source without the slash
    const folds = lines.filter((l) => {
      const [source, destination, status] = l.split(/\s+/);
      return source.endsWith('/') && destination === source.slice(0, -1) && status === '308';
    });
    expect(folds.map((l) => l.split(/\s+/)[0]).sort()).toEqual(pages.map((p) => `${p}/`));
    // static rules come first, so wrangler does not warn about the order: the folds open the file
    expect(lines.slice(0, pages.length).sort()).toEqual([...folds].sort());
  });

  it('does NOT prerender the pages that must be dynamic: /blog, /blog/<slug>, /kontak, /tim, /donasi (it carries the reports, SAKEM-105), /sitemap.xml, the 404; and /laporan is no page at all', () => {
    for (const f of ['blog.html', 'blog/index.html', 'kontak.html', 'tim.html', 'donasi.html', 'donasi/index.html', 'laporan.html', 'laporan/index.html', 'sitemap.xml', '404.html']) {
      expect(existsSync(path.join(dist, 'client', f)), f).toBe(false); // a static 404 would be served with status 200
    }
    expect(articles.length).toBe(ARTICLE_COUNT);
  });

  it('_redirects sends /laporan (with and without the slash) and the older /impact-reports to /donasi#laporan, one hop, with a 308; the fragment is in the destination (SAKEM-105)', () => {
    const lines = read('client/_redirects').split('\n').map((l) => l.trim().split(/\s+/).join(' '));
    for (const source of ['/laporan', '/laporan/', '/impact-reports', '/impact-reports/', '/impact-reports/*']) {
      expect(lines, source).toContain(`${source} /donasi#laporan 308`);
    }
    // not a rule that points at /laporan (two hops), and nothing folds /donasi/ (the Worker's own fold answers a rendered page)
    expect(lines.filter((l) => l.split(' ')[1] === '/laporan')).toEqual([]);
    expect(lines.filter((l) => l.split(' ')[0] === '/donasi/')).toEqual([]);
  });

  it('home page: the site graph with the Organization, one h1, the hero image is eager with fetchpriority high and every <img> has width and height', () => {
    const html = read('client/index.html');
    expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1);
    expect(html).toContain('"@type":["NGO","EducationalOrganization"]');
    expect(graphTypes(html)).toEqual(['NGO+EducationalOrganization', 'WebSite', 'WebPage']); // no breadcrumb on the home page: a trail of one step is not a trail
    const imgs = [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
    expect(imgs.length).toBeGreaterThanOrEqual(5);
    for (const img of imgs) {
      expect(img, img).toMatch(/width="\d+"/);
      expect(img, img).toMatch(/height="\d+"/);
      expect(img, img).toMatch(/\salt(=|\s|>)/); // decorative logos have an empty alt, which Astro prints as a bare `alt`
    }
    const hero = imgs.find((i) => i.includes('src="/images/home/hero-poster.jpg"')); // the poster of the hero video (SAKEM-111)
    expect(hero).toContain('fetchpriority="high"');
    expect(hero).toContain('loading="eager"');
    expect(hero).toContain('srcset=');
    for (const img of imgs.filter((i) => i !== hero && !/logo-sakola-kembara[.-]/.test(i))) {
      expect(img, img).toContain('loading="lazy"');
    }
  });

  it('the only JS files are the GSAP motion and its loader (MotionLoader.astro; SAKEM-111, on every page since SAKEM-112); every other script is inline', () => {
    // The home page's scripts and budget are checked in home-built.test.ts; the Worker-rendered pages are checked in e2e.
    const files = walk(path.join(dist, 'client')).filter((f) => f.endsWith('.js')).map((f) => path.basename(f).replace(/\.[\w-]+\.js$/, ''));
    expect(files.sort()).toEqual(['MotionLoader.astro_astro_type_script_index_0_lang', 'motion']);
  });

  it('fonts are self-hosted: no request to a font CDN, woff2 emitted, two preloaded', () => {
    const html = read('client/index.html');
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect([...html.matchAll(/<link rel="preload"[^>]*as="font"[^>]*>/g)]).toHaveLength(2);
    const css = walk(path.join(dist, 'client/_astro')).filter((f) => f.endsWith('.css'));
    expect(css.length).toBeGreaterThan(0);
    const all = css.map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(all).not.toMatch(/Lora/); // headings are Plus Jakarta Sans since SAKEM-112 (the homepage standard)
    expect(all).toMatch(/font-family:\s*"?Plus Jakarta Sans"?/);
    expect(all).not.toMatch(/googleapis|gstatic/);
  });

  it('_redirects is the generated table: placeholders, splat, queries, statuses, no ".html" junk', () => {
    const file = read('client/_redirects');
    expect(file).toContain('/cerita/:slug  /blog/:slug  308');
    expect(file).toContain('/blog/page/:page  /blog?page=:page  308');
    expect(file).toContain('/program  /program/prapembinaan  307');
    expect(file).not.toMatch(/\.html/);
    expect(file).not.toMatch(/\s301\s*$/m);
  });

  it('_redirects (SAKEM-103): one rule per WordPress upload this build ships, no splat over /wp-content/uploads, and none of the names that left the table', () => {
    const client = path.join(dist, 'client');
    const file = read('client/_redirects');
    const lines = file.trim().split('\n');
    // the splat that answered EVERY upload is gone: an upload this site did not copy is WordPress's, forwarded to the origin
    expect(lines.filter((l) => l.startsWith('/wp-content'))).not.toContainEqual(expect.stringMatching(/\*/));
    const shipped = walk(path.join(client, 'blog/images')).map((f) => path.relative(path.join(client, 'blog/images'), f).split(path.sep).join('/'));
    expect(shipped.length).toBeGreaterThan(200);
    const uploads = lines.filter((l) => l.startsWith('/wp-content/uploads/'));
    expect(uploads).toHaveLength(shipped.length);
    for (const rel of shipped) {
      const target = `/blog/images/${rel}`.replace(/@/g, '%40');
      expect(uploads, rel).toContain(`/wp-content/uploads/${rel}  ${target}  308`);
    }
    // an upload with an @ in its name is one hop to the %40 form (the assets layer would add a 307 of its own to a literal @)
    expect(uploads.filter((l) => l.split(/\s+/)[0].includes('@')).every((l) => !l.split(/\s+/)[1].includes('@'))).toBe(true);
    // static rules, so they come before the first rule with a placeholder or a splat
    const firstDynamic = lines.findIndex((l) => /[:*]/.test(l.split(/\s+/)[0]));
    expect(lines.lastIndexOf(uploads[uploads.length - 1])).toBeLessThan(firstDynamic);
    // the registration link is a shortlink (D1), the auth names are not redirects any more, the old registration form goes to the link
    const sources = lines.map((l) => l.split(/\s+/)[0]);
    for (const name of ['/daftar', '/daftar/', '/login', '/login/', '/register', '/forgot-password', '/reset-password', '/verify-email']) expect(sources, name).not.toContain(name);
    expect(file).toContain('/gabung-siswa/form  /daftar  308');
    expect(file).not.toContain('/portal');
    // the Cloudflare limits: 2,000 static and 100 dynamic rules
    const dynamic = lines.filter((l) => /[:*]/.test(l.split(/\s+/)[0])).length;
    expect(dynamic).toBeLessThanOrEqual(100);
    expect(lines.length - dynamic).toBeLessThanOrEqual(2000);
  });

  it('_headers carries the security headers and immutable caching for hashed assets', () => {
    const file = read('client/_headers');
    expect(file).toContain('/_astro/*\n  Cache-Control: public, max-age=31536000, immutable');
    // Image derivatives carry a content hash in their name (scripts/build-assets.mjs), gallery photos included.
    expect(file).toContain('/_img/*\n  Cache-Control: public, max-age=31536000, immutable');
    expect(file).toContain('X-Frame-Options: DENY');
  });

  it('generated wrangler config: assets binding, nodejs_compat, and NO KV, R2, D1, images, routes or account ids', () => {
    const cfg = JSON.parse(read('server/wrangler.json'));
    expect(cfg.main).toBe('entry.mjs');
    expect(cfg.assets).toMatchObject({ binding: 'ASSETS', directory: '../client' });
    expect(cfg.compatibility_flags).toContain('nodejs_compat');
    for (const key of ['kv_namespaces', 'r2_buckets', 'd1_databases', 'durable_objects', 'queues']) {
      const v = cfg[key];
      expect(v === undefined || (Array.isArray(v) ? v.length === 0 : Object.values(v).every((x) => !x || (Array.isArray(x) && x.length === 0)))).toBe(true);
    }
    // The one binding: the internal service binding to the API Worker's PublicApi entrypoint, by a placeholder name (no ids, no account).
    expect(cfg.services).toEqual([{ binding: 'API', service: 'sakem-admin', entrypoint: 'PublicApi' }]);
    // No var: no API URL (production reads through the binding) and no site key (set per deploy).
    expect(cfg.vars ?? {}).toEqual({});
    expect(cfg.images).toBeUndefined();
    expect(cfg.routes).toBeUndefined();
    expect(cfg.account_id).toBeUndefined();
  });

  it('the Worker bundle holds no markdown article: no body, and not even the metadata index (BLOG_SOURCE=api, the default)', () => {
    const chunks = walk(path.join(dist, 'server')).filter((f) => f.endsWith('.mjs'));
    const bundle = chunks.map((f) => readFileSync(f, 'utf8')).join('\n');
    // a sentence from the body of an article (not its excerpt), from the build-time markdown fixture
    let sentence: string | undefined;
    for (const a of articles) {
      sentence = [...bodies[a.id].matchAll(/<p>([^<&]{80,200})<\/p>/g)][0]?.[1];
      if (sentence) break;
    }
    expect(sentence).toBeDefined();
    expect(bundle).not.toContain(sentence as string);
    // the markdown index would name every article: check the long slugs (a short one such as `daffa-najwan` is also an image name of the home page)
    for (const a of articles.filter((x) => x.id.length > 30)) expect(bundle, a.id).not.toContain(a.id);
    // the blog is read from the API: its client is in there
    expect(bundle).toContain('/api/public/blog');
  });

  it('server bundle stays far below the 3 MB (compressed) Workers Free limit', () => {
    const total = walk(path.join(dist, 'server'))
      .filter((f) => f.endsWith('.mjs'))
      .reduce((n, f) => n + statSync(f).size, 0);
    expect(total).toBeLessThan(2_000_000); // raw, before compression
  });
});
