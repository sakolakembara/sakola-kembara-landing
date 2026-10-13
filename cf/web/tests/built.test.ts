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

  it('prerenders the home page, the program pages, /donasi and robots.txt; the articles and the sitemap are rendered by the Worker (API data)', () => {
    expect(existsSync(path.join(dist, 'client/index.html'))).toBe(true);
    expect(existsSync(path.join(dist, 'client/robots.txt'))).toBe(true);
    // The blog is managed in the new admin and changes without a rebuild, so no article is a file any more.
    const files = readdirSync(path.join(dist, 'client/blog')).filter((f) => f.endsWith('.html'));
    expect(files).toEqual([]);
    expect(existsSync(path.join(dist, 'client/sitemap.xml'))).toBe(false);
  });

  it('does NOT prerender the pages that must be dynamic: /blog, /blog/<slug>, /kontak, /tim, /sitemap.xml, the 404', () => {
    for (const f of ['blog.html', 'blog/index.html', 'kontak.html', 'tim.html', 'sitemap.xml', '404.html']) {
      expect(existsSync(path.join(dist, 'client', f)), f).toBe(false); // a static 404 would be served with status 200
    }
    expect(articles.length).toBe(ARTICLE_COUNT);
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
    const hero = imgs.find((i) => i.includes('Siswa Sakola Kembara belajar bersama'));
    expect(hero).toContain('fetchpriority="high"');
    expect(hero).toContain('loading="eager"');
    expect(hero).toContain('srcset=');
    for (const img of imgs.filter((i) => i !== hero && !i.includes('logo-sakola-kembara.'))) {
      expect(img, img).toContain('loading="lazy"');
    }
  });

  it('the only JS files are the home page map chunks (the scripts of the other pages are inline)', () => {
    // The home page's scripts and budget are checked in home-built.test.ts; the Worker-rendered pages are checked in e2e.
    const jsFiles = walk(path.join(dist, 'client')).filter((f) => f.endsWith('.js'));
    for (const f of jsFiles) {
      expect(path.basename(f), f).toMatch(/^(ImpactMap\.astro_astro_type_script_index_0_lang|leaflet-src|leaflet|map)\.[\w-]+\.js$/);
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/framer-motion|gsap/);
    }
  });

  it('fonts are self-hosted: no request to a font CDN, woff2 emitted, two preloaded', () => {
    const html = read('client/index.html');
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect([...html.matchAll(/<link rel="preload"[^>]*as="font"[^>]*>/g)]).toHaveLength(2);
    const css = walk(path.join(dist, 'client/_astro')).filter((f) => f.endsWith('.css'));
    expect(css.length).toBeGreaterThan(0);
    const all = css.map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(all).toMatch(/font-family:\s*"?Lora"?/);
    expect(all).toMatch(/font-family:\s*"?Plus Jakarta Sans"?/);
    expect(all).not.toMatch(/googleapis|gstatic/);
  });

  it('_redirects is the generated table: placeholders, splat, queries, statuses, no ".html" junk', () => {
    const file = read('client/_redirects');
    expect(file).toContain('/cerita/:slug  /blog/:slug  308');
    expect(file).toContain('/blog/page/:page  /blog?page=:page  308');
    expect(file).toContain('/wp-content/uploads/*  /blog/images/:splat  308');
    expect(file).toContain('/program  /program/prapembinaan  307');
    expect(file).not.toMatch(/\.html/);
    expect(file).not.toMatch(/\s301\s*$/m);
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
