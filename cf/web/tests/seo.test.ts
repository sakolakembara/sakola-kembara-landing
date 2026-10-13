import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OG_IMAGE,
  LEGAL_NAME,
  ORG_LOGO,
  SITE_NAME,
  SITE_TAGLINE,
  DEFAULT_TITLE,
  LEGAL_NAME as LEGAL,
  ORG_ID,
  SITE_LANGUAGE,
  SITE_URL,
  SOCIAL_URLS,
  TITLE_TEMPLATE,
  WEBSITE_ID,
  absoluteUrl,
  buildGraph,
  buildSeo,
  jsonLdScript,
  organizationJsonLd,
  pageTitle,
  programJsonLd,
} from '~/lib/seo';
import { importRoot, readRoot } from './helpers';

// What the root lib/seo.ts exports (the legacy app is the reference until it is retired).
interface RootSeo {
  SITE_URL: string;
  SITE_NAME: string;
  TITLE_TEMPLATE: string;
  LEGAL_NAME: string;
  SITE_TAGLINE: string;
  ORG_LOGO: string;
  DEFAULT_OG_IMAGE: string;
  SOCIAL_URLS: string[];
  pageTitle: (t: string) => { absolute: string };
  jsonLdScript: (d: unknown) => string;
  organizationJsonLd: () => unknown;
  articleJsonLd: (a: Record<string, unknown>) => unknown;
  programJsonLd: (p: { id: string; title: string; description: string }) => unknown;
  buildPageMetadata: (a: { title: string; description: string; path: string; ogImage?: string }) => {
    title: { absolute: string };
    description: string;
    alternates: { canonical: string };
    openGraph: { title: string; description: string; url: string; siteName: string; locale: string; type: string; images: { url: string }[] };
    twitter: { card: string; title: string; description: string; images: { url: string }[] };
  };
}

describe('SEO parity with the root lib/seo.ts', async () => {
  const root = await importRoot<RootSeo>('lib/seo.ts');

  // The title template is NOT in this list any more: SAKEM-090 moved it to the live WordPress pattern (see below).
  it('site identity constants are identical', () => {
    expect({ SITE_URL, SITE_NAME, LEGAL_NAME, SITE_TAGLINE, ORG_LOGO, DEFAULT_OG_IMAGE, SOCIAL_URLS }).toEqual({
      SITE_URL: root.SITE_URL,
      SITE_NAME: root.SITE_NAME,
      LEGAL_NAME: root.LEGAL_NAME,
      SITE_TAGLINE: root.SITE_TAGLINE,
      ORG_LOGO: root.ORG_LOGO,
      DEFAULT_OG_IMAGE: root.DEFAULT_OG_IMAGE,
      SOCIAL_URLS: root.SOCIAL_URLS,
    });
  });

  it('title template (SAKEM-090, the live WordPress pattern, not the root app\'s): "<page> - Yayasan Sakola Kembara Indonesia"', () => {
    expect(TITLE_TEMPLATE).toBe('%s - Yayasan Sakola Kembara Indonesia');
    expect(pageTitle('Tim Kami')).toBe('Tim Kami - Yayasan Sakola Kembara Indonesia');
    // the root app says "Tim Kami | Sakola Kembara": the one deliberate difference
    expect(root.pageTitle('Tim Kami').absolute).toBe('Tim Kami | Sakola Kembara');
  });

  it('a title is text, never a replacement pattern ($& and $1 stay as typed)', () => {
    expect(pageTitle('Rp $& $1 $$')).toBe('Rp $& $1 $$ - Yayasan Sakola Kembara Indonesia');
  });

  it('jsonLdScript escapes < and the line separators exactly like the root', () => {
    const data = { a: '</script><script>alert(1)</script>', b: 'x' + String.fromCharCode(0x2028) + 'y' + String.fromCharCode(0x2029) };
    const ours = jsonLdScript(data);
    expect(ours).toBe(root.jsonLdScript(data));
    expect(ours).not.toContain('<');
    expect(ours).toContain('\\u003c');
    expect(ours).not.toContain(String.fromCharCode(0x2028));
    expect(JSON.parse(ours)).toEqual(data);
  });

  it('Organization JSON-LD is identical', () => {
    expect(organizationJsonLd()).toEqual(root.organizationJsonLd());
  });

  it('Program JSON-LD is identical', () => {
    const p = { id: 'pembinaan', title: 'Pembelajaran Intensif', description: 'Deskripsi.' };
    expect(programJsonLd(p)).toEqual(root.programJsonLd(p));
  });

  it('page head data equals buildPageMetadata() of the root', () => {
    const input = { title: 'Blog & Cerita', description: 'Deskripsi halaman.', path: '/blog' };
    const seo = buildSeo({ kind: 'page', ...input });
    const meta = root.buildPageMetadata(input);
    expect(seo.title).toBe(pageTitle('Blog & Cerita')); // the root's differs in the suffix only (SAKEM-090)
    expect(seo.title.replace(` - ${LEGAL}`, '')).toBe(meta.title.absolute.replace(' | Sakola Kembara', ''));
    expect(seo.description).toBe(meta.description);
    expect(seo.canonical).toBe(absoluteUrl(meta.alternates.canonical));
    expect(seo.og.title).toBe(meta.openGraph.title);
    expect(seo.og.description).toBe(meta.openGraph.description);
    expect(seo.og.url).toBe(absoluteUrl(meta.openGraph.url));
    expect({ siteName: seo.og.siteName, locale: seo.og.locale, type: seo.og.type }).toEqual({
      siteName: meta.openGraph.siteName,
      locale: meta.openGraph.locale,
      type: meta.openGraph.type,
    });
    expect(seo.og.image.url).toBe(absoluteUrl(meta.openGraph.images[0].url));
    expect(seo.twitter).toEqual({
      card: meta.twitter.card,
      title: meta.twitter.title,
      description: meta.twitter.description,
      image: absoluteUrl(meta.twitter.images[0].url),
    });
  });

  it('a page with its own cover uses it for og:image and twitter:image', () => {
    const seo = buildSeo({ kind: 'page', title: 'T', description: 'D', path: '/blog/x', ogImage: '/blog/images/2026/05/c.jpg' });
    expect(seo.og.image.url).toBe(`${SITE_URL}/blog/images/2026/05/c.jpg`);
    expect(seo.twitter.image).toBe(`${SITE_URL}/blog/images/2026/05/c.jpg`);
    expect(root.buildPageMetadata({ title: 'T', description: 'D', path: '/blog/x', ogImage: '/blog/images/2026/05/c.jpg' }).openGraph.images[0].url).toBe(
      '/blog/images/2026/05/c.jpg',
    );
  });

  it('home uses the root layout defaults: no suffix, 1200x630 image with alt, canonical "/"; the title has the live site\'s comma', () => {
    const layout = readRoot('app/layout.tsx');
    const defaultTitle = layout.match(/const DEFAULT_TITLE = "([^"]+)"/)?.[1];
    const defaultDescription = layout.match(/const DEFAULT_DESCRIPTION =\s*"([^"]+)"/)?.[1];
    const seo = buildSeo({ kind: 'home' });
    // SAKEM-090: the live home page says "Sakola Kembara, Pendidikan Untuk Semua"; the root app says "... - ..."
    expect(defaultTitle).toBe('Sakola Kembara - Pendidikan Untuk Semua');
    expect(seo.title).toBe('Sakola Kembara, Pendidikan Untuk Semua');
    expect(seo.title).toBe(DEFAULT_TITLE);
    expect(seo.description).toBe(defaultDescription);
    expect(seo.canonical).toBe(`${SITE_URL}/`);
    expect(seo.og.image).toEqual({ url: `${SITE_URL}${DEFAULT_OG_IMAGE}`, width: 1200, height: 630, alt: SITE_NAME });
    expect(seo.googlebot).toBe('index, follow, max-video-preview:-1, max-image-preview:large, max-snippet:-1');
    // theme color and keywords come from the same file
    expect(layout).toContain('themeColor: "#122E76"');
  });

  it('the 404 head is noindex, has no canonical, and the suffixed title', () => {
    const seo = buildSeo({ kind: 'notfound' });
    expect(seo.robots).toBe('noindex');
    expect(seo.canonical).toBeNull();
    expect(seo.title).toBe('Halaman tidak ditemukan - Yayasan Sakola Kembara Indonesia');
  });
});

describe('absoluteUrl', () => {
  it('prefixes paths and leaves absolute URLs alone', () => {
    expect(absoluteUrl('/x')).toBe(`${SITE_URL}/x`);
    expect(absoluteUrl('x')).toBe(`${SITE_URL}/x`);
    expect(absoluteUrl('https://a.b/c')).toBe('https://a.b/c');
  });
});
