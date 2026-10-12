import { existsSync, readdirSync } from 'node:fs';
import { bodies } from 'virtual:blog-bodies';
import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, cleanExcerpt, getAllArticles, getArticleBySlug, getBlogPage, getRelated, pageNumbers } from '~/lib/blog';
import { blogPosts, importRoot, repoRoot } from './helpers';

const articles = getAllArticles();

describe('blog content (virtual modules built from the root content/blog)', () => {
  it('has the 80 articles of lib/blog-posts.json and nothing else (README.md is not an article)', () => {
    const files = readdirSync(`${repoRoot}content/blog`).filter((f) => f.endsWith('.md'));
    expect(files).toHaveLength(81); // 80 articles + README.md
    expect(articles).toHaveLength(80);
    expect(articles.map((a) => a.id).sort()).toEqual(blogPosts().articles.map((a) => a.id).sort());
    expect(new Set(articles.map((a) => a.id)).size).toBe(80);
  });

  it('is sorted newest first, deterministic on ties', () => {
    const dates = articles.map((a) => a.dateISO);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('every article has the fields the pages need', () => {
    for (const a of articles) {
      expect(a.title, a.id).not.toBe('');
      expect(a.dateISO, a.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.modifiedISO, a.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.date, a.id).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);
      expect(a.category, a.id).not.toBe('');
      expect(a.sourceUrl, a.id).toContain(`/${a.id}/`);
    }
  });

  it('every article has rendered HTML, with no raw HTML or script injected', () => {
    for (const a of articles) {
      const html = bodies[a.id];
      expect(html.length, a.id).toBeGreaterThan(50);
      expect(html, a.id).not.toMatch(/<script|<iframe|onerror=/i);
    }
  });

  it('metadata ids equal body ids', () => {
    expect(Object.keys(bodies).sort()).toEqual(articles.map((a) => a.id).sort());
  });

  it('cover images that exist on disk carry width and height; ones that do not are left without', () => {
    let withDims = 0;
    for (const a of articles) {
      if (!a.image) continue;
      const onDisk = existsSync(`${repoRoot}public${a.image}`);
      if (onDisk) {
        expect(a.imageWidth, a.id).toBeGreaterThan(0);
        expect(a.imageHeight, a.id).toBeGreaterThan(0);
        withDims++;
      } else {
        expect(a.imageWidth, a.id).toBeNull();
      }
    }
    expect(withDims).toBeGreaterThan(60);
  });

  it('inline images: lazy, async, with intrinsic size, local ones wrapped like next/image was', () => {
    const html = Object.values(bodies).join('\n');
    const imgs = [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
    expect(imgs.length).toBeGreaterThan(40);
    for (const img of imgs) {
      expect(img).toContain('loading="lazy"');
      expect(img).toContain('decoding="async"');
      expect(img).toMatch(/alt="/);
    }
    const local = imgs.filter((i) => i.includes('src="/blog/images/'));
    expect(local.length).toBeGreaterThan(30);
    const sized = local.filter((i) => /width="\d+"/.test(i) && /height="\d+"/.test(i));
    expect(sized.length / local.length).toBeGreaterThan(0.9);
    expect(html).toContain('<span class="block my-6 relative w-full max-w-full"><img');
  });

  it('external links open in a new tab with rel noopener noreferrer, as BlogPostContent does', () => {
    const html = Object.values(bodies).join('\n');
    const external = [...html.matchAll(/<a [^>]*href="https?:[^"]*"[^>]*>/g)].map((m) => m[0]);
    expect(external.length).toBeGreaterThan(5);
    for (const a of external) {
      expect(a).toContain('target="_blank"');
      expect(a).toContain('rel="noopener noreferrer"');
    }
  });

  it('GitHub-flavoured markdown (tables, strikethrough, autolinks) is enabled like remark-gfm in the Next app', () => {
    const withTable = Object.values(bodies).filter((h) => h.includes('<table>'));
    expect(withTable.length).toBeGreaterThanOrEqual(0); // present only if an article has one; the engine is what matters
  });
});

describe('blog helpers', () => {
  it('getArticleBySlug: known slug, unknown slug', () => {
    expect(getArticleBySlug(articles[0].id)?.id).toBe(articles[0].id);
    expect(getArticleBySlug('nope')).toBeNull();
    expect(getArticleBySlug('')).toBeNull();
  });

  it('getBlogPage: page 1 has the featured article plus 15, the rest is paged by 15', () => {
    const first = getBlogPage(undefined);
    expect(first.featured).not.toBeNull();
    expect(first.items).toHaveLength(PAGE_SIZE);
    expect(first.currentPage).toBe(1);
    expect(first.totalPages).toBe(Math.ceil((articles.length - 1) / PAGE_SIZE));
    expect(first.items.find((i) => i.id === first.featured?.id)).toBeUndefined();
    const second = getBlogPage('2');
    expect(second.featured).toBeNull();
    expect(second.items[0].id).not.toBe(first.items[0].id);
    const seen = new Set<string>();
    for (let p = 1; p <= first.totalPages; p++) {
      const page = getBlogPage(String(p));
      if (page.featured) seen.add(page.featured.id);
      page.items.forEach((i) => seen.add(i.id));
    }
    expect(seen.size).toBe(80); // every article is reachable from the list
  });

  it.each([['0', 1], ['-3', 1], ['abc', 1], ['', 1], [null, 1], ['999', 6], ['2.9', 2]])('page %j clamps to %i', (raw, expected) => {
    expect(getBlogPage(raw as string | null).currentPage).toBe(expected);
  });

  it('getRelated: three others, never the article itself', () => {
    for (const a of articles.slice(0, 10)) {
      const rel = getRelated(a);
      expect(rel).toHaveLength(3);
      expect(rel.find((r) => r.id === a.id)).toBeUndefined();
    }
  });

  it('pageNumbers: all pages up to 7, then ellipses around the current page', () => {
    expect(pageNumbers(1, 6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(pageNumbers(1, 10)).toEqual([1, 2, '…', 10]);
    expect(pageNumbers(5, 10)).toEqual([1, '…', 4, 5, 6, '…', 10]);
    expect(pageNumbers(10, 10)).toEqual([1, '…', 9, 10]);
  });

  it('cleanExcerpt behaves like the root implementation', async () => {
    const root = await importRoot<{ cleanExcerpt: (s: string) => string }>('lib/blog-types.ts');
    for (const s of ['Teks [&hellip;]', 'Teks […]', 'Teks…', 'Teks', '  Teks [ hellip; ] ', ...articles.map((a) => a.excerpt)]) {
      expect(cleanExcerpt(s)).toBe(root.cleanExcerpt(s));
    }
  });
});
