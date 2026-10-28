import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBlogArticle, parseBlogList } from '~/lib/blog-api';
import { GOOGLEBOT_INDEX, ROBOTS_INDEX, buildSeo, pageTitle } from '~/lib/seo';
import { blogSitemapEntries } from '~/lib/sitemap';
import { readWeb } from './helpers';

// SAKEM-109: the blog form's "Judul SEO" and "Sembunyikan dari Google", as the site reads them from the content API
// (docs/cloudflare/content-api.md: `seoTitle` on the article, `noindex: true` on any entry only when set) and uses them:
// the head of the article page and the sitemap. An API from before the fields sends neither: nothing changes.

const summary = (over: Record<string, unknown> = {}) => ({ slug: 'cara-belajar', title: 'Cara Belajar Efektif', category: 'Tips', date: '21 Mei 2026', dateISO: '2026-05-21', excerpt: 'Ringkasan.', image: null, imageWidth: null, imageHeight: null, author: 'Dzul', featured: false, ...over });
const articlePayload = (over: Record<string, unknown> = {}) => ({ article: { ...summary(), modifiedISO: '2026-05-22', description: null, contentMarkdown: 'x', contentHtml: '<p>x</p>', ...over }, related: [] });
const page = (over: Record<string, unknown> = {}) =>
  buildSeo({ kind: 'page', title: 'Cara Belajar Efektif', description: 'Ringkasan.', path: '/blog/cara-belajar', article: { dateISO: '2026-05-21' }, ...over });

describe('the parser', () => {
  it('reads seoTitle as text or null, and noindex only from the boolean true', () => {
    expect(parseBlogArticle(articlePayload({ seoTitle: 'Judul untuk Google' }))!.article.seoTitle).toBe('Judul untuk Google');
    for (const value of [undefined, null, '', '   ', 42]) expect(parseBlogArticle(articlePayload({ seoTitle: value }))!.article.seoTitle, String(value)).toBeNull();
    expect(parseBlogArticle(articlePayload({ noindex: true }))!.article.noindex).toBe(true);
    for (const value of [undefined, false, 'true', 1, null]) expect(parseBlogArticle(articlePayload({ noindex: value }))!.article, String(value)).not.toHaveProperty('noindex');
    const list = parseBlogList({ featured: null, articles: [summary({ slug: 'a', noindex: true }), summary({ slug: 'b' })], page: 1, pageSize: 2, total: 2, totalPages: 1 })!;
    expect(list.articles.map((a) => a.noindex)).toEqual([true, undefined]);
  });
});

describe('the head of an article page', () => {
  it('with no SEO title and indexed, it is exactly what it was', () => {
    const before = page();
    expect(page({ seoTitle: null, noindex: false })).toEqual(before);
    expect(before.title).toBe(pageTitle('Cara Belajar Efektif'));
    expect([before.og.title, before.twitter.title]).toEqual(['Cara Belajar Efektif', 'Cara Belajar Efektif']);
    expect([before.robots, before.googlebot]).toEqual([ROBOTS_INDEX, GOOGLEBOT_INDEX]);
  });

  it('an SEO title is the whole <title>, og:title and twitter:title, used as written (no suffix); nothing else moves', () => {
    const seo = page({ seoTitle: 'Tips Belajar Efektif untuk UTBK 2027' });
    expect([seo.title, seo.og.title, seo.twitter.title]).toEqual(Array(3).fill('Tips Belajar Efektif untuk UTBK 2027'));
    const { title: _a, og: { title: _b, ...og }, twitter: { title: _c, ...twitter }, ...rest } = seo;
    const { title: _d, og: { title: _e, ...ogBefore }, twitter: { title: _f, ...twitterBefore }, ...restBefore } = page();
    expect([rest, og, twitter]).toEqual([restBefore, ogBefore, twitterBefore]);
  });

  it('noindex: robots "noindex, follow" and no googlebot line; the canonical and everything else stay', () => {
    const seo = page({ noindex: true });
    expect(seo.robots).toBe('noindex, follow');
    expect(seo.googlebot).toBeNull();
    expect(seo.canonical).toBe(page().canonical);
  });

  it('the article page passes both from the API answer', () => {
    const source = readWeb('src/pages/blog/[slug].astro');
    expect(source).toContain('seoTitle: article.seoTitle,');
    expect(source).toContain('noindex: article.noindex === true,');
  });
});

describe('the sitemap', () => {
  it('leaves out an article hidden from search, keeps the others with their dates', () => {
    const entries = blogSitemapEntries([
      { slug: 'terindeks', dateISO: '2026-05-21', modifiedISO: '2026-05-25' },
      { slug: 'tersembunyi', dateISO: '2026-05-20', noindex: true },
      { slug: 'lama', dateISO: '2026-01-02' },
    ]);
    expect(entries.map((e) => [e.url.replace(/^https:\/\/[^/]+/, ''), e.lastModified])).toEqual([
      ['/blog/terindeks', '2026-05-25'],
      ['/blog/lama', '2026-01-02'],
    ]);
    expect(readFileSync(new URL('../src/pages/sitemap.xml.ts', import.meta.url), 'utf8')).toContain('const blogRoutes = blogSitemapEntries(articles.data);');
  });
});
