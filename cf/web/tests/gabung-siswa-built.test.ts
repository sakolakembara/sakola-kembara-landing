import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLegacyPath, isPortalOwnedPath } from '~/lib/legacy-paths';
import { absoluteUrl } from '~/lib/seo';
import { STATIC_ROUTES } from '~/lib/sitemap';
import { importRoot, readRoot, webRoot } from './helpers';

// Checks on the page `pnpm build` generates for /gabung-siswa (dist/client/gabung-siswa.html) and on
// the files it must NOT generate (the SSR pages). Skipped, not failed, when dist/ is missing, like
// tests/built.test.ts. The SSR pages are checked in scripts/e2e.mjs.
const client = path.join(webRoot, 'dist/client');
const built = existsSync(path.join(client, 'gabung-siswa.html'));

const read = (rel: string) => readFileSync(path.join(client, rel), 'utf8');
const decode = (s: string) =>
  s.replace(/&amp;|&#38;/g, '&').replace(/&lt;|&#60;/g, '<').replace(/&gt;|&#62;/g, '>').replace(/&quot;|&#34;/g, '"').replace(/&#39;|&apos;/g, "'");
const textOf = (html: string) => {
  const main = html.slice(html.indexOf('id="konten-utama"'), html.indexOf('<footer'));
  return decode(main.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
};
const meta = (html: string, key: string, value: string) => decode(html.match(new RegExp(`<meta ${key}="${value}" content="([^"]*)"`))?.[1] ?? '');
const attr = (tag: string, name: string) => decode(tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? '');
const links = (html: string) => [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);

describe.skipIf(!built)('/gabung-siswa build output', async () => {
  const html = built ? read('gabung-siswa.html') : '';
  const text = built ? textOf(html) : '';
  const rootSeo = await importRoot<{
    buildPageMetadata: (a: { title: string; description: string; path: string }) => {
      title: { absolute: string };
      description: string;
      alternates: { canonical: string };
      openGraph: { title: string; description: string; url: string; siteName: string; locale: string; type: string };
      twitter: { card: string; title: string; description: string };
    };
  }>('lib/seo.ts');
  const legacyLayout = readRoot('app/(public)/gabung-siswa/layout.tsx');
  const legacyMeta = rootSeo.buildPageMetadata({
    title: legacyLayout.match(/title: "([^"]+)"/)![1],
    description: legacyLayout.match(/description:\s*"([^"]+)"/)![1],
    path: legacyLayout.match(/path: "([^"]+)"/)![1],
  });

  it('is a static file, and the two SSR pages are not (they read the content API per request)', () => {
    expect(existsSync(path.join(client, 'gabung-siswa.html'))).toBe(true);
    for (const rel of ['laporan.html', 'laporan/index.html', 'gabung-siswa/docs.html', 'gabung-siswa/docs/index.html', 'gabung-siswa/index.html']) {
      expect(existsSync(path.join(client, rel)), rel).toBe(false);
    }
  });

  it('head: lang id, the legacy title, description, canonical, robots, Open Graph and Twitter data', () => {
    expect(html).toContain('<html lang="id"');
    expect(decode(html.match(/<title>([^<]*)<\/title>/)![1])).toBe(legacyMeta.title.absolute);
    expect(meta(html, 'name', 'description')).toBe(legacyMeta.description);
    expect(html.match(/<link rel="canonical" href="([^"]*)"/)?.[1]).toBe(absoluteUrl(legacyMeta.alternates.canonical));
    expect(meta(html, 'name', 'robots')).toBe('index, follow');
    expect(meta(html, 'property', 'og:title')).toBe(legacyMeta.openGraph.title);
    expect(meta(html, 'property', 'og:description')).toBe(legacyMeta.openGraph.description);
    expect(meta(html, 'property', 'og:url')).toBe(absoluteUrl(legacyMeta.openGraph.url));
    expect(meta(html, 'property', 'og:site_name')).toBe(legacyMeta.openGraph.siteName);
    expect(meta(html, 'property', 'og:locale')).toBe(legacyMeta.openGraph.locale);
    expect(meta(html, 'property', 'og:type')).toBe(legacyMeta.openGraph.type);
    expect(meta(html, 'name', 'twitter:card')).toBe(legacyMeta.twitter.card);
    expect(meta(html, 'name', 'twitter:title')).toBe(legacyMeta.twitter.title);
    expect(meta(html, 'name', 'twitter:description')).toBe(legacyMeta.twitter.description);
  });

  it('no JSON-LD (the legacy page has none), exactly one h1, the hero text', () => {
    expect(html).not.toContain('application/ld+json');
    const h1 = [...html.matchAll(/<h1[\s>][\s\S]*?<\/h1>/g)];
    expect(h1).toHaveLength(1);
    expect(decode(h1[0][0].replace(/<[^>]+>/g, ''))).toBe('Wujudkan Mimpimu Bersama Sakola Kembara');
    expect(text).toContain('Open Recruitment Gen 6 Wujudkan Mimpimu Bersama Sakola Kembara');
  });

  it('sections in the legacy order: hero, benefits (#manfaat), steps, closing call to action', () => {
    const marks = ['Open Recruitment Gen 6', 'Manfaat Bergabung dengan Sakola Kembara', 'Alur Pendaftaran', 'Siap Bergabung dengan Sakola Kembara?'].map((m) => text.indexOf(m));
    expect(marks.every((i) => i >= 0)).toBe(true);
    expect([...marks].sort((a, b) => a - b)).toEqual(marks);
    expect([...html.matchAll(/<h2[\s>]/g)]).toHaveLength(3);
  });

  it('the four benefits and the four steps, with the legacy text', () => {
    const legacy = readRoot('app/(public)/gabung-siswa/page.tsx').replace(/\s+/g, ' ');
    const benefits = [...legacy.matchAll(/title: "([^"]+)", description: "([^"]+)"/g)];
    expect(benefits).toHaveLength(4);
    for (const [, title, description] of benefits) {
      expect(text).toContain(title);
      expect(text).toContain(description);
    }
    const steps = [...legacy.matchAll(/step: "(\d\d)", title: "([^"]+)", body: "([^"]+)"/g)];
    expect(steps.map((s) => s[1])).toEqual(['01', '02', '03', '04']);
    for (const [, step, title, body] of steps) expect(text).toContain(`${step} ${title} ${body}`);
  });

  it('"Daftar Sekarang" (hero and closing section) goes to /portal/daftar, "Pelajari Program" to #manfaat, "Pusat Dokumen" to /gabung-siswa/docs', () => {
    const a = links(html);
    const hrefOf = (re: RegExp) => a.filter((tag) => re.test(tag)).map((tag) => attr(tag, 'href'));
    expect(a.filter((tag) => attr(tag, 'href') === '/portal/daftar')).toHaveLength(2);
    expect(html.match(/Daftar Sekarang/g)).toHaveLength(2);
    expect(hrefOf(/bg-white text-primary-blue/)).toEqual(['/portal/daftar', '/portal/daftar']);
    expect(hrefOf(/border-\[1\.5px\] border-white\/60/)).toEqual(['#manfaat']);
    expect(html).toContain('<section id="manfaat"');
    expect(a.filter((tag) => attr(tag, 'href') === '/gabung-siswa/docs')).toHaveLength(1);
    // plain links: none of them opens a new tab or carries script
    for (const tag of a.filter((t) => /href="(\/portal\/daftar|\/gabung-siswa\/docs|#manfaat)"/.test(t))) {
      expect(tag).not.toContain('target=');
      expect(tag).not.toContain('onclick');
    }
  });

  it('every internal link of the page leads somewhere the Worker, the student portal or the legacy app answers', () => {
    const internal = links(html)
      .map((tag) => attr(tag, 'href'))
      .filter((href) => href.startsWith('/') && !href.startsWith('//'));
    expect(internal.length).toBeGreaterThan(5);
    const known = new Set(['/', '/tim', '/gabung-siswa', '/gabung-siswa/docs', '/donasi', '/laporan', '/blog', '/kontak']);
    for (const href of internal) {
      const p = href.split(/[?#]/)[0];
      expect(known.has(p) || isLegacyPath(p) || isPortalOwnedPath(p), href).toBe(true);
    }
  });

  it('ships no script of its own: the navbar script is the only one, and no JS file', () => {
    const scripts = [...html.matchAll(/<script([^>]*)>/g)].filter((m) => !m[1].includes('ld+json'));
    expect(scripts).toHaveLength(1);
    expect([...html.matchAll(/<script[^>]*\ssrc=/g)]).toHaveLength(0);
  });

  it('has no <img> besides the navbar and footer logos (so nothing to optimise, no image request)', () => {
    const imgs = [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
    for (const img of imgs) expect(img).toMatch(/alt="Sakola Kembara"/);
  });

  it('the sitemap still lists /laporan and /gabung-siswa (and, like the Next sitemap, not the documents page); it is rendered by the Worker now, so its output is checked in scripts/e2e.mjs', () => {
    const paths = STATIC_ROUTES.map((r) => r.path);
    expect(paths).toContain('/laporan');
    expect(paths).toContain('/gabung-siswa');
    expect(paths).not.toContain('/gabung-siswa/docs');
    expect(existsSync(path.join(client, 'sitemap.xml'))).toBe(false);
  });
});
