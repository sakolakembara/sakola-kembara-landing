import type { AddressInfo } from 'node:net';
import { bodies } from 'virtual:blog-bodies';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BLOG_SLUG,
  DEFAULT_PAGE_SIZE,
  MAX_LIST_PAGE,
  MAX_PAGE_SIZE,
  buildListPayload,
  clampPageSize,
  normalizePage,
  pickFeatured,
  pickRelated,
  toWireSummary,
} from '../blog-contract.mjs';
import { startFixtureApi } from '../scripts/fixture-api.mjs';
import { createApiBlogSource, type BlogSource } from '~/lib/blog-source';
import { markdownBlogSource } from '~/lib/blog-markdown';
import { parseBlogArticle, parseBlogList, parseSummary, safeImagePath, type BlogSummary } from '~/lib/blog-api';
import { coverAttrs, getAllArticles, getBlogSource, getRelated, getBlogPage, headerSource } from '~/lib/blog';
import { contentApiTarget } from '~/lib/api-client';
import { contentPageHeaders } from '~/lib/content-api';
import { blogPosts, readRoot } from './helpers';

const articles = getAllArticles();

// ---------------------------------------------------------------------------------------------------
// The contract's rules, in the one module the site, the fixture and the real API share.

const summary = (slug: string, dateISO: string, extra: Partial<BlogSummary> = {}): BlogSummary => ({
  slug,
  title: slug,
  category: 'News',
  date: '',
  dateISO,
  excerpt: '',
  image: null,
  imageWidth: null,
  imageHeight: null,
  author: 'A',
  featured: false,
  ...extra,
});

describe('blog-contract: the rules of GET /api/public/blog', () => {
  // 40 articles, one per day, newest first: a00 is the newest.
  const day = (i: number) => new Date(Date.UTC(2026, 5, 1) - i * 86_400_000).toISOString().slice(0, 10);
  const list = Array.from({ length: 40 }, (_, i) => summary(`a${String(i).padStart(2, '0')}`, day(i)));

  it('the featured article is returned on every page and is not repeated in `articles`; total excludes it', () => {
    const p1 = buildListPayload(list, '1', '15');
    const p2 = buildListPayload(list, '2', '15');
    expect(p1.featured?.slug).toBe('a00'); // nothing flagged: the newest
    expect(p2.featured?.slug).toBe('a00');
    expect(p1.articles).toHaveLength(15);
    expect(p1.articles.find((a) => a.slug === 'a00')).toBeUndefined();
    expect(p1.total).toBe(39);
    expect(p1.totalPages).toBe(3);
    expect(p2.articles[0].slug).not.toBe(p1.articles[0].slug);
    const seen = new Set<string>([p1.featured!.slug]);
    for (let page = 1; page <= p1.totalPages; page++) buildListPayload(list, String(page), '15').articles.forEach((a) => seen.add(a.slug));
    expect(seen.size).toBe(40);
  });

  it('a flagged article is the featured one even when it is old', () => {
    const flagged = [summary('new', '2026-05-01'), summary('old', '2020-01-01', { featured: true }), summary('mid', '2024-01-01')];
    expect(pickFeatured(flagged)?.slug).toBe('old');
    const p = buildListPayload(flagged, 1, 10);
    expect(p.featured?.slug).toBe('old');
    expect(p.articles.map((a) => a.slug)).toEqual(['new', 'mid']);
  });

  it.each([
    [undefined, 1], ['', 1], ['abc', 1], ['0', 1], ['-3', 1], ['2.9', 2], ['999', 3], [null, 1], [2, 2],
  ])('page %j is clamped to %i, never an error', (raw, expected) => {
    expect(buildListPayload(list, raw as string, '15').page).toBe(expected);
  });

  it.each([
    [undefined, DEFAULT_PAGE_SIZE], ['abc', DEFAULT_PAGE_SIZE], ['0', 1], ['-5', 1], ['7', 7], ['50', 50], ['51', MAX_PAGE_SIZE], ['1000', MAX_PAGE_SIZE],
  ])('pageSize %j is %i (default 15, bounded to 1..50)', (raw, expected) => {
    expect(clampPageSize(raw as string)).toBe(expected);
    expect(buildListPayload(list, '1', raw as string).pageSize).toBe(expected);
  });

  it('an empty blog is the contract\'s empty payload', () => {
    expect(buildListPayload([], undefined, undefined)).toEqual({ featured: null, articles: [], page: 1, pageSize: 15, total: 0, totalPages: 1 });
  });

  it('a single article is the featured one and leaves an empty list', () => {
    expect(buildListPayload([summary('only', '2026-01-01')], '1', '15')).toMatchObject({ articles: [], total: 0, totalPages: 1 });
  });

  it('the site never asks for a page above MAX_LIST_PAGE, so probing cannot create unbounded cache entries', () => {
    expect(normalizePage('999999999')).toBe(MAX_LIST_PAGE);
    expect(normalizePage('abc')).toBe(1);
    expect(normalizePage('0')).toBe(1);
    expect(normalizePage('3')).toBe(3);
  });

  it('related: same category OR within 180 days, newest first, three; never the article itself', () => {
    const base = [
      summary('a', '2026-05-01', { category: 'Cerita' }),
      summary('b', '2026-04-01', { category: 'News' }), // within 180 days
      summary('c', '2025-01-01', { category: 'Cerita' }), // same category
      summary('d', '2025-01-02', { category: 'Other' }), // neither
      summary('e', '2026-03-01', { category: 'X' }), // within 180 days
      summary('f', '2026-02-01', { category: 'Y' }), // within 180 days, but the fourth
    ];
    expect(pickRelated(base[0], base).map((r) => r.slug)).toEqual(['b', 'c', 'e']);
    // none qualify: the three newest others
    const far = [summary('x', '2026-05-01', { category: 'P' }), summary('y', '2024-01-01', { category: 'Q' }), summary('z', '2023-01-01', { category: 'R' }), summary('w', '2022-01-01', { category: 'S' })];
    expect(pickRelated(far[0], far).map((r) => r.slug)).toEqual(['y', 'z', 'w']);
    expect(pickRelated(far[0], [far[0]])).toEqual([]);
  });

  it('the slug grammar admits the 80 migrated slugs and rejects what cannot be a slug', () => {
    for (const a of articles) expect(BLOG_SLUG.test(a.id), a.id).toBe(true);
    for (const bad of ['', 'A', 'a b', '../x', 'a/b', '-a', 'a.b', 'é', 'x'.repeat(201), 'a%20b']) expect(BLOG_SLUG.test(bad), bad).toBe(false);
  });
});

describe('blog.ts keeps one implementation: the sync helpers are the contract\'s functions', () => {
  it('getRelated and getBlogPage (the build-time index) agree with the contract on all 80 articles', () => {
    const wire = articles.map((a) => toWireSummary(a));
    for (const a of articles) {
      expect(getRelated(a).map((r) => r.id)).toEqual(pickRelated(toWireSummary(a), wire).map((r) => r.slug));
    }
    const first = getBlogPage(undefined);
    const payload = buildListPayload(wire, 1, 15);
    expect(first.items.map((i) => i.id)).toEqual(payload.articles.map((a) => a.slug));
    expect(first.featured?.id).toBe(payload.featured?.slug);
  });
});

// ---------------------------------------------------------------------------------------------------
// The tolerant parsers: this input crosses a network.

describe('parsers', () => {
  const good = { slug: 'a-b', title: 'T', category: 'C', date: '1 Mei 2026', dateISO: '2026-05-01', excerpt: 'E', image: '/blog/images/x.jpg', imageWidth: 100, imageHeight: 50, author: 'Au', featured: true };

  it('a summary with what a card needs is kept; one without is dropped', () => {
    expect(parseSummary(good)).toEqual(good);
    for (const broken of [null, 'x', [], {}, { ...good, slug: '' }, { ...good, title: ' ' }, { ...good, dateISO: 'yesterday' }]) expect(parseSummary(broken)).toBeNull();
  });

  it('unusable images are no images: only a root-relative path or an http(s) URL is accepted, and dimensions need an image', () => {
    expect(safeImagePath('/a.jpg')).toBe('/a.jpg');
    expect(safeImagePath('https://cdn.example/a.jpg')).toBe('https://cdn.example/a.jpg');
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', '//evil.example/a.jpg', 'a.jpg', '', null, 7]) expect(safeImagePath(bad), String(bad)).toBeNull();
    expect(parseSummary({ ...good, image: 'javascript:alert(1)' })).toMatchObject({ image: null, imageWidth: null, imageHeight: null });
    expect(parseSummary({ ...good, imageWidth: -1, imageHeight: 1.5 })).toMatchObject({ imageWidth: null, imageHeight: null });
  });

  it('a list payload: the featured card, the entries that parse, the paging; a malformed entry never fails the page', () => {
    const parsed = parseBlogList({ featured: good, articles: [good, { nope: 1 }, { ...good, slug: 'c' }], page: 2, pageSize: 15, total: 31, totalPages: 3 });
    expect(parsed?.articles.map((a) => a.slug)).toEqual(['a-b', 'c']);
    expect(parsed).toMatchObject({ page: 2, pageSize: 15, total: 31, totalPages: 3 });
    expect(parseBlogList({ featured: null, articles: [] })).toMatchObject({ featured: null, articles: [], page: 1, totalPages: 1 });
    for (const bad of [null, [], 'x', { articles: 'no' }, {}]) expect(parseBlogList(bad)).toBeNull();
  });

  it('an article payload needs its HTML; contentMarkdown is dropped; modifiedISO falls back to the date', () => {
    const payload = { article: { ...good, contentHtml: '<p>x</p>', contentMarkdown: 'x', modifiedISO: '2026-06-01' }, related: [good, { bad: 1 }] };
    const parsed = parseBlogArticle(payload);
    expect(parsed?.article.contentHtml).toBe('<p>x</p>');
    expect(parsed?.article.modifiedISO).toBe('2026-06-01');
    expect(parsed?.article).not.toHaveProperty('contentMarkdown');
    expect(parsed?.related).toHaveLength(1);
    expect(parseBlogArticle({ article: { ...good, contentHtml: '<p>x</p>' }, related: [] })?.article.modifiedISO).toBe('2026-05-01');
    for (const bad of [null, {}, { article: good }, { article: { ...good, contentHtml: '  ' } }, { article: { contentHtml: '<p>x</p>' } }]) expect(parseBlogArticle(bad)).toBeNull();
  });
});

describe('covers: the API sends a path; the srcset comes from the asset manifest', () => {
  const cover = articles.find((a) => a.image && a.imageWidth)!;

  it('a migrated image gets its WebP srcset, the markup form of its path and the size the API recorded', () => {
    const wire = toWireSummary(cover);
    const attrs = coverAttrs(wire.image, wire.imageWidth, wire.imageHeight)!;
    expect(attrs.src).toBe(cover.image); // markup form: the same string the markdown adapter always produced
    expect(attrs.srcset).toBe(cover.imageSrcset);
    expect(attrs.width).toBe(cover.imageWidth);
    expect(attrs.height).toBe(cover.imageHeight);
    // an API that recorded the original size (2560x1707) wins for the attributes; the ladder is the manifest's
    expect(coverAttrs(wire.image, 2560, 1707)).toMatchObject({ width: 2560, height: 1707, srcset: cover.imageSrcset });
  });

  it('the @ of the five migrated files is written %40, as the asset layer wants (and the API stores the raw path)', () => {
    const withAt = articles.filter((a) => a.image?.includes('%40'));
    expect(withAt.length).toBeGreaterThan(0);
    for (const a of withAt) {
      const wire = toWireSummary(a);
      expect(wire.image).toContain('@');
      expect(coverAttrs(wire.image, null, null)?.src).toBe(a.image);
    }
  });

  it('an image the pipeline does not know (an upload in R2, an external URL) is used as given, with the API\'s size or none', () => {
    expect(coverAttrs('/uploads/2026/10/new.jpg', 1200, 800)).toEqual({ src: '/uploads/2026/10/new.jpg', width: 1200, height: 800 });
    expect(coverAttrs('https://cdn.example/a.jpg', null, null)).toEqual({ src: 'https://cdn.example/a.jpg' });
    expect(coverAttrs(null, 1, 1)).toBeNull();
  });
});

describe('what a page answers, by what the source returned (contentPageHeaders of the shared loader)', () => {
  it('fresh 60 s with 5 minutes stale-while-revalidate; stale 30 s; a 404 30 s; an outage 503 and never cacheable', () => {
    expect(contentPageHeaders(headerSource('network'))).toEqual({ status: 200, headers: { 'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' } });
    expect(contentPageHeaders(headerSource('cache')).status).toBe(200);
    expect(contentPageHeaders(headerSource('build'))).toEqual(contentPageHeaders('cache')); // the fixture is a fresh answer
    expect(contentPageHeaders(headerSource('stale'))).toEqual({ status: 200, headers: { 'cache-control': 'public, max-age=0, s-maxage=30' } });
    expect(contentPageHeaders(headerSource('not_found'))).toEqual({ status: 404, headers: { 'cache-control': 'public, max-age=0, s-maxage=30' } });
    expect(contentPageHeaders(headerSource('empty'))).toEqual({ status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '30' } });
  });
});

describe('getBlogSource', () => {
  it('this test build is BLOG_SOURCE=markdown: the build-time adapter, which a production build never contains', async () => {
    const source = await getBlogSource({ env: {} });
    expect(source.kind).toBe('markdown');
    expect(source).toBe(markdownBlogSource);
  });
  it('the API source without any configured API is "unavailable", not a crash', async () => {
    const source = createApiBlogSource({ target: contentApiTarget({}) });
    expect(await source.list(1)).toEqual({ data: null, source: 'empty' });
    expect(await source.article('some-slug')).toEqual({ data: null, source: 'empty' });
    expect(await source.all()).toEqual({ data: null, source: 'empty' });
    // a slug that cannot exist is a 404 without asking anyone
    expect(await source.article('NOT A SLUG')).toEqual({ data: null, source: 'not_found' });
  });
});

// ---------------------------------------------------------------------------------------------------
// Parity: the site reading the API (here the fixture server, the real HTTP and the real parsers) gives
// exactly what the build-time markdown adapter gave, for all 80 articles.

describe('the API client and the markdown adapter agree on all 80 articles', () => {
  let fixture: Awaited<ReturnType<typeof startFixtureApi>>;
  let api: BlogSource;
  let base: string;

  beforeAll(async () => {
    fixture = await startFixtureApi({ port: 0 });
    base = `http://127.0.0.1:${(fixture.server.address() as AddressInfo).port}`;
    api = createApiBlogSource({ target: contentApiTarget({ CONTENT_API_URL: base }) });
  });
  afterAll(async () => {
    await fixture.close();
  });

  it('the list: every page of every page size, featured included', async () => {
    for (const pageSize of [15, 50, 7]) {
      const first = await markdownBlogSource.list(1, pageSize);
      if (!first.data) throw new Error('markdown list failed');
      for (let page = 1; page <= first.data.totalPages + 1; page++) {
        const [a, m] = await Promise.all([api.list(page, pageSize), markdownBlogSource.list(page, pageSize)]);
        expect(a.data, `page ${page} of ${pageSize}`).toEqual(m.data);
        expect(a.data).not.toBeNull();
      }
    }
  });

  it('all 80 articles: slug, title, dates, category, excerpt, cover, author, HTML, and the related summaries', async () => {
    const legacyIds = blogPosts().articles;
    expect(articles).toHaveLength(80);
    for (const meta of articles) {
      const [a, m] = await Promise.all([api.article(meta.id), markdownBlogSource.article(meta.id)]);
      if (!a.data || !m.data) throw new Error(`${meta.id}: ${a.source} / ${m.source}`);
      expect(a.data, meta.id).toEqual(m.data);

      const { article, related } = a.data;
      expect(article.slug).toBe(meta.id);
      expect(article.title).toBe(meta.title);
      expect(article.date).toBe(meta.date);
      expect(article.dateISO).toBe(meta.dateISO);
      expect(article.modifiedISO).toBe(meta.modifiedISO);
      expect(article.category).toBe(meta.category);
      expect(article.author).toBe(meta.author);
      expect(article.contentHtml).toBe(bodies[meta.id]);
      expect(article.excerpt).not.toContain('&hellip;');
      expect(related.map((r) => r.slug)).toEqual(getRelated(meta).map((r) => r.id)); // the previous (sync) implementation
      expect(related).toHaveLength(3);
      expect(related.find((r) => r.slug === meta.id)).toBeUndefined();

      // the WordPress scrape that the 80 articles came from: same slug, title and date
      const wp = legacyIds.find((x) => x.id === meta.id);
      expect(wp, meta.id).toBeDefined();
      expect(article.title).toBe(wp!.title);
      expect(article.dateISO).toBe(wp!.dateISO);
    }
  });

  it('all(): the contract\'s enumeration (pageSize=50 plus the featured article) finds exactly the 80, newest first', async () => {
    await fetch(`${base}/__reset`, { method: 'POST' });
    const all = await api.all();
    if (!all.data) throw new Error('all failed');
    expect(all.data.map((a) => a.slug)).toEqual(articles.map((a) => a.id));
    expect(new Set(all.data.map((a) => a.slug)).size).toBe(80);
    const requests: string[] = await (await fetch(`${base}/__requests?for=blog`)).json();
    expect(requests).toEqual(['/api/public/blog?page=1&pageSize=50', '/api/public/blog?page=2&pageSize=50']);
    const m = await markdownBlogSource.all();
    expect(all).toEqual({ ...m, source: 'network' });
  });

  it('an unknown or unpublished slug is "not found"; the API answers {"error":"not_found"} with a 30 s s-maxage', async () => {
    expect(await api.article('this-article-does-not-exist')).toEqual({ data: null, source: 'not_found' });
    const res = await fetch(`${base}/api/public/blog/this-article-does-not-exist`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=30');
  });

  it('the fixture sends the contract\'s cache headers and the full payload (contentMarkdown too), and nothing private', async () => {
    const res = await fetch(`${base}/api/public/blog/${articles[0].id}`);
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=60, stale-while-revalidate=300');
    const json = (await res.json()) as { article: Record<string, unknown> };
    expect(Object.keys(json.article).sort()).toEqual(
      ['author', 'category', 'contentHtml', 'contentMarkdown', 'date', 'dateISO', 'excerpt', 'featured', 'image', 'imageHeight', 'imageWidth', 'modifiedISO', 'slug', 'title'].sort(),
    );
    const list = (await (await fetch(`${base}/api/public/blog?page=1&pageSize=3`)).json()) as { featured: Record<string, unknown>; articles: Record<string, unknown>[] };
    for (const entry of [list.featured, ...list.articles]) {
      expect(Object.keys(entry).sort()).toEqual(['author', 'category', 'date', 'dateISO', 'excerpt', 'featured', 'image', 'imageHeight', 'imageWidth', 'slug', 'title']);
    }
  });

  it('an API outage is "unavailable"; with the markdown fixture untouched', async () => {
    await fetch(`${base}/__mode?for=blog&m=500`, { method: 'POST' });
    expect(await api.list(1)).toEqual({ data: null, source: 'empty' });
    expect(await api.all()).toEqual({ data: null, source: 'empty' });
    await fetch(`${base}/__mode?for=blog&m=ok`, { method: 'POST' });
    expect((await api.list(1)).data).not.toBeNull();
  });

  it('the articles are in the order of the build-time index, and a related list never holds the article itself, even from a careless API', async () => {
    const careless = createApiBlogSource({
      target: { base: 'http://api.test', via: 'url', fetchImpl: (async () => Response.json({ article: { slug: 'a', title: 'A', dateISO: '2026-01-01', contentHtml: '<p>x</p>' }, related: [{ slug: 'a', title: 'A', dateISO: '2026-01-01' }, { slug: 'b', title: 'B', dateISO: '2026-01-02' }] })) as unknown as typeof fetch },
    });
    const out = await careless.article('a');
    expect(out.data?.related.map((r) => r.slug)).toEqual(['b']);
  });
});

describe('the sitemap and the pages read from BlogSource, not from the build-time index', () => {
  it('no page or endpoint imports the markdown index or bodies directly', () => {
    for (const file of ['cf/web/src/pages/blog/index.astro', 'cf/web/src/pages/blog/[slug].astro', 'cf/web/src/pages/sitemap.xml.ts']) {
      const src = readRoot(file);
      expect(src, file).not.toMatch(/virtual:blog-/);
      expect(src, file).toContain('getBlogSource');
      expect(src, file).toMatch(/export const prerender = false/);
    }
  });
});
