import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { blogPosts, webRoot } from './helpers';

// Checks on the build output (dist/). They need `pnpm build` first and are
// skipped, not failed, when dist/ is missing, so `pnpm test` works on a fresh clone.
const dist = path.join(webRoot, 'dist');
const built = existsSync(path.join(dist, 'client/index.html'));

const read = (rel: string) => readFileSync(path.join(dist, rel), 'utf8');
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

describe.skipIf(!built)('build output', () => {
  const articles = blogPosts().articles;

  it('prerenders the home page, 80 article pages, robots.txt and sitemap.xml as static files', () => {
    expect(existsSync(path.join(dist, 'client/index.html'))).toBe(true);
    const files = readdirSync(path.join(dist, 'client/blog')).filter((f) => f.endsWith('.html'));
    expect(files).toHaveLength(80);
    expect(files.map((f) => f.replace(/\.html$/, '')).sort()).toEqual(articles.map((a) => a.id).sort());
    expect(existsSync(path.join(dist, 'client/robots.txt'))).toBe(true);
    expect(existsSync(path.join(dist, 'client/sitemap.xml'))).toBe(true);
  });

  it('does NOT prerender the pages that must be dynamic: /blog, /tim, the 404', () => {
    expect(existsSync(path.join(dist, 'client/blog.html'))).toBe(false);
    expect(existsSync(path.join(dist, 'client/blog/index.html'))).toBe(false);
    expect(existsSync(path.join(dist, 'client/tim.html'))).toBe(false);
    expect(existsSync(path.join(dist, 'client/404.html'))).toBe(false); // a static 404 would be served with status 200
  });

  it('every article page: lang id, one h1, canonical, og, twitter, Article JSON-LD that parses', () => {
    for (const a of articles) {
      const html = read(`client/blog/${a.id}.html`);
      expect(html, a.id).toContain('<html lang="id"');
      expect((html.match(/<h1[\s>]/g) ?? []).length, a.id).toBe(1);
      expect(html, a.id).toContain(`<link rel="canonical" href="https://sakolakembara.org/blog/${a.id}">`);
      expect(html, a.id).toMatch(/<title>[^<]+ \| Sakola Kembara<\/title>/);
      expect(html, a.id).toContain('<meta property="og:image" content="https://sakolakembara.org/');
      expect(html, a.id).toContain('<meta name="twitter:card" content="summary_large_image">');
      const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
      expect(ld, a.id).toBeDefined();
      const data = JSON.parse(ld as string);
      expect(data['@type']).toBe('Article');
      expect(data.datePublished).toBe(a.dateISO);
      expect(data.description, a.id).not.toContain('&hellip;');
    }
  });

  it('home page: Organization JSON-LD, one h1, the hero image is eager with fetchpriority high and every <img> has width and height', () => {
    const html = read('client/index.html');
    expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1);
    expect(html).toContain('"@type":["NGO","EducationalOrganization"]');
    const imgs = [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
    expect(imgs.length).toBeGreaterThanOrEqual(5);
    for (const img of imgs) {
      expect(img, img).toMatch(/width="\d+"/);
      expect(img, img).toMatch(/height="\d+"/);
      expect(img, img).toMatch(/alt="/);
    }
    const hero = imgs.find((i) => i.includes('Siswa Sakola Kembara belajar bersama'));
    expect(hero).toContain('fetchpriority="high"');
    expect(hero).toContain('loading="eager"');
    expect(hero).toContain('srcset=');
    for (const img of imgs.filter((i) => i !== hero && !i.includes('logo-sakola-kembara.'))) {
      expect(img, img).toContain('loading="lazy"');
    }
  });

  it('the pages ship no external JS file and no framework runtime: one inline module script', () => {
    for (const file of ['client/index.html', 'client/blog/sejarah-sakola-kembara.html']) {
      const html = read(file);
      expect([...html.matchAll(/<script[^>]*\ssrc=/g)]).toHaveLength(0);
      const scripts = [...html.matchAll(/<script([^>]*)>/g)].filter((m) => !m[1].includes('ld+json'));
      expect(scripts).toHaveLength(1);
    }
    const jsFiles = walk(path.join(dist, 'client')).filter((f) => f.endsWith('.js'));
    expect(jsFiles).toHaveLength(0);
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
    // Gallery derivatives carry a content hash in their name (scripts/build-gallery.mjs).
    expect(file).toContain('/images/program/galeri/*\n  Cache-Control: public, max-age=31536000, immutable');
    expect(file).toContain('X-Frame-Options: DENY');
  });

  it('generated wrangler config: assets binding, nodejs_compat, and NO KV, R2, D1, images, routes or account ids', () => {
    const cfg = JSON.parse(read('server/wrangler.json'));
    expect(cfg.main).toBe('entry.mjs');
    expect(cfg.assets).toMatchObject({ binding: 'ASSETS', directory: '../client' });
    expect(cfg.compatibility_flags).toContain('nodejs_compat');
    for (const key of ['kv_namespaces', 'r2_buckets', 'd1_databases', 'durable_objects', 'queues', 'services']) {
      const v = cfg[key];
      expect(v === undefined || (Array.isArray(v) ? v.length === 0 : Object.values(v).every((x) => !x || (Array.isArray(x) && x.length === 0)))).toBe(true);
    }
    expect(cfg.images).toBeUndefined();
    expect(cfg.routes).toBeUndefined();
    expect(cfg.account_id).toBeUndefined();
  });

  it('the Worker bundle holds no article body: bodies are only in the prerendered pages', () => {
    const chunks = walk(path.join(dist, 'server')).filter((f) => f.endsWith('.mjs'));
    const bundle = chunks.map((f) => readFileSync(f, 'utf8')).join('\n');
    // a sentence from the body of an article (not its excerpt)
    let sentence: string | undefined;
    for (const a of articles) {
      const html = read(`client/blog/${a.id}.html`);
      const body = html.slice(html.indexOf('class="blog-content"'));
      sentence = [...body.matchAll(/<p>([^<&]{80,200})<\/p>/g)][0]?.[1];
      if (sentence) break;
    }
    expect(sentence).toBeDefined();
    expect(bundle).not.toContain(sentence as string);
    // while the metadata index IS there (the /blog list needs it)
    expect(bundle).toContain(articles[0].id);
  });

  it('server bundle stays far below the 3 MB (compressed) Workers Free limit', () => {
    const total = walk(path.join(dist, 'server'))
      .filter((f) => f.endsWith('.mjs'))
      .reduce((n, f) => n + statSync(f).size, 0);
    expect(total).toBeLessThan(2_000_000); // raw, before compression
  });
});
