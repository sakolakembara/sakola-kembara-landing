import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OG_IMAGE,
  DEFAULT_TITLE,
  ORG_ID,
  SITE_LANGUAGE,
  SITE_URL,
  WEBSITE_ID,
  buildGraph,
  buildSeo,
  jsonLdScript,
  organizationJsonLd,
  programJsonLd,
} from '~/lib/seo';

// SAKEM-090: what the SEO parity run against the live WordPress site (2026-10-13) asked for. The live site's graph is
// the target (docs/cloudflare/seo-audit.md): the language, the article's og:type and times, and one JSON-LD @graph.
// tests/seo.test.ts keeps the parity with the root lib/seo.ts for what did not change.

describe('language', () => {
  it('the documents are Indonesian: id-ID for <html lang> and JSON-LD, id_ID for Open Graph', () => {
    expect(SITE_LANGUAGE).toBe('id-ID');
    for (const input of [{ kind: 'home' }, { kind: 'notfound' }, { kind: 'page', title: 'T', description: 'D', path: '/x' }] as const) {
      expect(buildSeo(input).og.locale).toBe('id_ID');
    }
    expect(programJsonLd({ id: 'a', title: 'T', description: 'D' }).inLanguage).toBe('id-ID');
  });

  it('every node of the graph that has a language says id-ID', () => {
    const graph = buildGraph({ kind: 'page', title: 'T', description: 'D', path: '/blog/x', article: { dateISO: '2026-05-21', author: 'A' } })!;
    const languages = graph['@graph'].map((node) => (node as { inLanguage?: string }).inLanguage).filter(Boolean);
    expect(languages.length).toBeGreaterThanOrEqual(3); // WebSite, WebPage, BlogPosting
    expect(new Set(languages)).toEqual(new Set(['id-ID']));
  });
});

describe('an article is og:type "article" with its times, like the live pages', () => {
  const input = {
    kind: 'page',
    title: 'Judul Artikel',
    description: 'Ringkasan.',
    path: '/blog/judul-artikel',
    ogImage: '/blog/images/2026/05/c.jpg',
    article: { dateISO: '2026-05-21', modifiedISO: '2026-06-01', author: 'Deanita', category: 'Cerita', imageWidth: 1600, imageHeight: 1067 },
  } as const;

  it('og:type, published and modified time, section, and the size of the cover', () => {
    const seo = buildSeo(input);
    expect(seo.og.type).toBe('article');
    expect(seo.og.article).toEqual({ published: '2026-05-21', modified: '2026-06-01', section: 'Cerita' });
    expect(seo.og.image).toEqual({ url: `${SITE_URL}/blog/images/2026/05/c.jpg`, width: 1600, height: 1067 });
  });

  it('the modified time defaults to the publication day, and nothing is written for a missing section', () => {
    const seo = buildSeo({ ...input, article: { dateISO: '2026-05-21' } });
    expect(seo.og.article).toEqual({ published: '2026-05-21', modified: '2026-05-21' });
  });

  it('a page that is not an article stays og:type website with no article tags', () => {
    const seo = buildSeo({ kind: 'page', title: 'T', description: 'D', path: '/tim' });
    expect(seo.og.type).toBe('website');
    expect(seo.og.article).toBeUndefined();
  });

  it("the default share image never gets the cover's size (the size belongs to the cover)", () => {
    const seo = buildSeo({ ...input, ogImage: undefined });
    expect(seo.og.image).toEqual({ url: `${SITE_URL}${DEFAULT_OG_IMAGE}` });
  });
});

describe('the JSON-LD graph', () => {
  type Graph = NonNullable<ReturnType<typeof buildGraph>>;
  type Node = Record<string, unknown> & { '@type': string | string[]; '@id'?: string };
  const nodesOf = (graph: Graph) => graph['@graph'] as Node[];
  const typeOf = (node: Node) => (Array.isArray(node['@type']) ? node['@type'].join('+') : node['@type']);
  const types = (graph: Graph) => nodesOf(graph).map(typeOf);
  const byType = (graph: Graph, type: string) => nodesOf(graph).find((n) => typeOf(n) === type)!;

  const article = {
    kind: 'page',
    title: 'Tanpa Jasa Ahdan Mewujudkan Murid Masuk Perguruan Tinggi',
    description: 'Ahdan sebagai pengajar matematika membantu murid.',
    path: '/blog/tanpa-jasa-ahdan',
    ogImage: '/blog/images/2026/05/ahdan.jpg',
    article: { dateISO: '2026-05-21', modifiedISO: '2026-06-01', author: 'Deanita', category: 'Cerita', imageWidth: 1600, imageHeight: 1200 },
    crumbs: [
      { name: 'Beranda', path: '/' },
      { name: 'Blog', path: '/blog' },
      { name: 'Tanpa Jasa Ahdan Mewujudkan Murid Masuk Perguruan Tinggi', path: '/blog/tanpa-jasa-ahdan' },
    ],
  } as const;

  it('the 404 page has none', () => {
    expect(buildGraph({ kind: 'notfound' })).toBeNull();
  });

  it('home: Organization, WebSite and WebPage, and no breadcrumb (a trail of one step is not a trail)', () => {
    const graph = buildGraph({ kind: 'home' })!;
    expect(graph['@context']).toBe('https://schema.org');
    expect(types(graph)).toEqual(['NGO+EducationalOrganization', 'WebSite', 'WebPage']);
    expect(byType(graph, 'WebPage')).toMatchObject({
      '@id': `${SITE_URL}/#webpage`,
      url: `${SITE_URL}/`,
      name: DEFAULT_TITLE,
      about: { '@id': ORG_ID },
      isPartOf: { '@id': WEBSITE_ID },
    });
  });

  it("the Organization of the graph is the home page's Organization, with an @id (nothing added, nothing dropped)", () => {
    const org = byType(buildGraph({ kind: 'home' })!, 'NGO+EducationalOrganization');
    const { '@context': _context, ...standalone } = organizationJsonLd();
    expect(org).toEqual({ '@id': ORG_ID, ...standalone });
  });

  it('WebSite: the live name (the legal name) and the brand as alternate name, publisher is the organization', () => {
    const site = byType(buildGraph({ kind: 'home' })!, 'WebSite');
    expect(site).toEqual({
      '@type': 'WebSite',
      '@id': WEBSITE_ID,
      url: `${SITE_URL}/`,
      name: 'Yayasan Sakola Kembara Indonesia',
      alternateName: 'Sakola Kembara',
      inLanguage: 'id-ID',
      publisher: { '@id': ORG_ID },
    });
  });

  it('an ordinary page: WebPage and a BreadcrumbList of two steps (Beranda, the page), absolute URLs, positions from 1', () => {
    const graph = buildGraph({ kind: 'page', title: 'Tim Kami', description: 'Pahlawan.', path: '/tim' })!;
    expect(types(graph)).toEqual(['NGO+EducationalOrganization', 'WebSite', 'WebPage', 'BreadcrumbList']);
    expect(byType(graph, 'WebPage')).toMatchObject({
      '@id': `${SITE_URL}/tim#webpage`,
      url: `${SITE_URL}/tim`,
      name: 'Tim Kami',
      description: 'Pahlawan.',
      breadcrumb: { '@id': `${SITE_URL}/tim#breadcrumb` },
    });
    expect(byType(graph, 'BreadcrumbList')).toEqual({
      '@type': 'BreadcrumbList',
      '@id': `${SITE_URL}/tim#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Beranda', item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: 'Tim Kami', item: `${SITE_URL}/tim` },
      ],
    });
  });

  it('the blog index is a CollectionPage (the type the live archives have)', () => {
    const graph = buildGraph({ kind: 'page', title: 'Blog & Cerita', description: 'D', path: '/blog', pageType: 'CollectionPage' })!;
    expect(types(graph)).toEqual(['NGO+EducationalOrganization', 'WebSite', 'CollectionPage', 'BreadcrumbList']);
  });

  it('an article: BlogPosting (the live type) with headline, description, cover, both dates, author, publisher, section, language', () => {
    const graph = buildGraph(article)!;
    expect(types(graph)).toEqual(['NGO+EducationalOrganization', 'WebSite', 'WebPage', 'BreadcrumbList', 'BlogPosting', 'Person']);
    const url = `${SITE_URL}/blog/tanpa-jasa-ahdan`;
    expect(byType(graph, 'BlogPosting')).toEqual({
      '@type': 'BlogPosting',
      '@id': `${url}#blogposting`,
      headline: article.title,
      description: article.description,
      image: { '@type': 'ImageObject', '@id': `${url}#primaryimage`, url: `${SITE_URL}/blog/images/2026/05/ahdan.jpg`, width: 1600, height: 1200 },
      datePublished: '2026-05-21',
      dateModified: '2026-06-01',
      author: { '@id': `${SITE_URL}/#/person/deanita` },
      publisher: { '@id': ORG_ID },
      inLanguage: 'id-ID',
      mainEntityOfPage: { '@id': `${url}#webpage` },
      isPartOf: { '@id': `${url}#webpage` },
      articleSection: 'Cerita',
    });
    expect(byType(graph, 'WebPage')).toMatchObject({
      datePublished: '2026-05-21',
      dateModified: '2026-06-01',
      primaryImageOfPage: { '@id': `${url}#primaryimage` },
    });
  });

  it("the article's trail is Beranda, Blog, the article", () => {
    const list = byType(buildGraph(article)!, 'BreadcrumbList') as unknown as { itemListElement: { position: number; name: string; item: string }[] };
    expect(list.itemListElement.map((i) => [i.position, i.name, i.item])).toEqual([
      [1, 'Beranda', `${SITE_URL}/`],
      [2, 'Blog', `${SITE_URL}/blog`],
      [3, article.title, `${SITE_URL}/blog/tanpa-jasa-ahdan`],
    ]);
  });

  it('only what we know is written: a day (never a time of day), a person by name only, no invented author page, image or URL', () => {
    const graph = buildGraph(article)!;
    const post = byType(graph, 'BlogPosting') as unknown as { datePublished: string; dateModified: string };
    expect(post.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(post.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(byType(graph, 'Person')).toEqual({ '@type': 'Person', '@id': `${SITE_URL}/#/person/deanita`, name: 'Deanita' });
  });

  it('an article with no author is by the organization (no Person node); with no cover it has the share image and no size', () => {
    const graph = buildGraph({ ...article, ogImage: undefined, article: { dateISO: '2026-05-21' } })!;
    expect(types(graph)).not.toContain('Person');
    const post = byType(graph, 'BlogPosting') as unknown as { author: unknown; image: unknown; dateModified: string };
    expect(post.author).toEqual({ '@id': ORG_ID });
    expect(post.image).toMatchObject({ url: `${SITE_URL}${DEFAULT_OG_IMAGE}` });
    expect(post.image).not.toHaveProperty('width');
    expect(post.dateModified).toBe('2026-05-21');
    expect(post).not.toHaveProperty('articleSection');
  });

  it("a person's id is made of the name: accents, case and punctuation do not make two people", () => {
    const idOf = (author: string) => (byType(buildGraph({ ...article, article: { dateISO: '2026-05-21', author } })!, 'Person') as { '@id': string })['@id'];
    expect(idOf('Muttaqin Hidayahtullah')).toBe(`${SITE_URL}/#/person/muttaqin-hidayahtullah`);
    expect(idOf("  Zéro  O'Neil ")).toBe(`${SITE_URL}/#/person/zero-o-neil`);
    expect(idOf('!!!')).toBe(`${SITE_URL}/#/person/penulis`);
  });

  it('every reference ({"@id": ...}) points at a node defined in the same graph (at the top or nested), and no @id is defined twice', () => {
    for (const input of [{ kind: 'home' }, { kind: 'page', title: 'T', description: 'D', path: '/tim' }, article] as const) {
      const graph = buildGraph(input)!;
      const defined: string[] = [];
      const refs: string[] = [];
      const walk = (value: unknown) => {
        if (Array.isArray(value)) return value.forEach(walk);
        if (value && typeof value === 'object') {
          const o = value as Record<string, unknown>;
          if (typeof o['@id'] === 'string') (Object.keys(o).length === 1 ? refs : defined).push(o['@id']);
          for (const v of Object.values(o)) walk(v);
        }
      };
      walk(graph['@graph']);
      expect(new Set(defined).size, defined.join(' ')).toBe(defined.length);
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) expect(defined, `${ref} is not defined`).toContain(ref);
    }
  });

  it('it serializes safely for a <script> tag, whatever the title says', () => {
    const graph = buildGraph({ ...article, title: '</script><script>alert(1)</script>' })!;
    const script = jsonLdScript(graph);
    expect(script).not.toContain('<');
    expect(JSON.parse(script)['@graph']).toHaveLength(6);
  });
});
