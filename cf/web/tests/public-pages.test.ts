import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REDIRECTS } from '../redirects.config.mjs';
import { absoluteUrl, buildSeo } from '~/lib/seo';
import { REPORTS_SECTION_PATH, footerLinks, navLinks } from '~/lib/site';
import { importRoot, liveTitle, readRoot, readWeb, webRoot } from './helpers';

// Source-level checks for the pages of SAKEM-080 part D: /gabung-siswa and /gabung-siswa/docs, and
// the Laporan section of /donasi, which took the place of the page /laporan (SAKEM-105). What they render is
// checked in tests/gabung-siswa-built.test.ts (the prerendered page) and in scripts/e2e.mjs (the SSR
// ones, as the Worker serves them); the copy is compared with the legacy source in tests/copy.test.ts.

const pages = [
  {
    route: '/gabung-siswa',
    web: 'src/pages/gabung-siswa.astro',
    legacy: ['app/(public)/gabung-siswa/layout.tsx'],
    prerender: true,
  },
  {
    route: '/gabung-siswa/docs',
    web: 'src/pages/gabung-siswa/docs.astro',
    legacy: ['app/(public)/gabung-siswa/docs/page.tsx'],
    prerender: false,
  },
] as const;

const quoted = (src: string, key: string, quote: '"' | "'") =>
  src.match(new RegExp(`${key}:\\s*${quote}([^${quote}]+)${quote}`))?.[1]?.replace(/\s+/g, ' ');

describe.each(pages)('$route', (page) => {
  const web = readWeb(page.web);
  const legacy = page.legacy.map(readRoot).join('\n');

  it(`is ${page.prerender ? 'prerendered (a static file of the assets layer)' : 'rendered by the Worker per request (it reads the content API)'}`, () => {
    expect(web).toContain(`export const prerender = ${page.prerender};`);
    expect(web.includes("from 'cloudflare:workers'")).toBe(!page.prerender);
  });

  it('head data: the same title, description and path as the legacy buildPageMetadata, through the same builders', async () => {
    const root = await importRoot<{ buildPageMetadata: (a: { title: string; description: string; path: string }) => { title: { absolute: string }; description: string; alternates: { canonical: string }; openGraph: { title: string; description: string; url: string }; twitter: { title: string; description: string } } }>('lib/seo.ts');
    const seoProps = web.slice(web.indexOf('seo={{'), web.indexOf('}}', web.indexOf('seo={{')));
    const ours = { title: quoted(seoProps, 'title', "'")!, description: quoted(seoProps, 'description', "'")!, path: quoted(seoProps, 'path', "'")! };
    const metadataCall = legacy.slice(legacy.indexOf('buildPageMetadata({'));
    const theirs = { title: quoted(metadataCall, 'title', '"')!, description: quoted(metadataCall, 'description', '"')!, path: quoted(metadataCall, 'path', '"')! };
    expect(ours.path).toBe(page.route);
    expect(ours).toEqual(theirs);

    const seo = buildSeo({ kind: 'page', ...ours });
    const meta = root.buildPageMetadata(theirs);
    expect(seo.title).toBe(liveTitle(meta.title.absolute)); // the suffix is the live pattern since SAKEM-090
    expect(seo.description).toBe(meta.description);
    expect(seo.canonical).toBe(absoluteUrl(meta.alternates.canonical));
    expect(seo.og).toMatchObject({ title: meta.openGraph.title, description: meta.openGraph.description, url: absoluteUrl(meta.openGraph.url), type: 'website' });
    expect(seo.twitter).toMatchObject({ title: meta.twitter.title, description: meta.twitter.description });
    expect(seo.robots).toBe('index, follow');
  });

  it('no images and no astro:assets (nothing to put through the asset pipeline); no JSON-LD, like the legacy page', () => {
    expect(web).not.toMatch(/<img\b/);
    expect(web).not.toContain('astro:assets');
    expect(web).not.toContain('jsonLd');
    expect(legacy).not.toContain('jsonLd');
  });
});

describe('the SSR pages that read a list degrade, each in its own way', () => {
  it('the documents page IS the list: loader, runtime, status and cache headers come from lib/content-api.ts, a 503 when it cannot answer', () => {
    const src = readWeb('src/pages/gabung-siswa/docs.astro');
    expect(src).toContain('loadResources(contentRuntime(env, Astro.locals.cfContext))');
    expect(src).toContain('contentPageHeaders(source)');
    expect(src).toContain('Astro.response.status = page.status;');
    expect(src).toContain("Astro.response.headers.set('x-resources-source', source);");
    expect(src).not.toMatch(/https?:\/\/(?!sakolakembara\.org)[a-z0-9.-]+\.[a-z]{2,}/i); // no host baked in
  });

  it('/donasi only CARRIES the reports (SAKEM-105): the loader is lib/reports.ts loadReportsSection, the runtime is contentRuntime, and the status and cache headers come from contentSectionHeaders, a 200 whatever the source', () => {
    const src = readWeb('src/pages/donasi.astro');
    expect(src).toContain('export const prerender = false;');
    expect(src).toContain('loadReportsSection(() => ({');
    expect(src).toContain('...contentRuntime(env, Astro.locals.cfContext),');
    expect(src).toContain('contentSectionHeaders(reports.source)');
    expect(src).toContain('Astro.response.status = page.status;');
    expect(src).toContain("Astro.response.headers.set('x-reports-source', reports.source);");
    // the page-level 503 of contentPageHeaders must never come back for this page: a degraded reports list is not a degraded Donasi page
    expect(src).not.toContain('contentPageHeaders');
    expect(src).not.toMatch(/Astro\.response\.status = (?!page\.status;)/);
    expect(src).not.toMatch(/https?:\/\/(?!sakolakembara\.org|docs\.google\.com)[a-z0-9.-]+\.[a-z]{2,}/i); // no host baked in (the confirmation form is the legacy constant)
    // the section itself is one component, mounted once, after "Cara Berdonasi"
    expect(src.match(/<ReportsSection\b/g)).toHaveLength(1);
    expect(src.indexOf('<ReportsSection')).toBeGreaterThan(src.indexOf('Cara Berdonasi'));
  });

  it('the notice of the degraded state is new copy (the legacy page had no such state: a database error was a 500) and sits in a status region', () => {
    for (const [file, notice] of [
      ['src/components/ReportsSection.astro', 'Laporan belum dapat ditampilkan'],
      ['src/pages/gabung-siswa/docs.astro', 'Dokumen belum dapat ditampilkan'],
    ]) {
      const web = readWeb(file);
      expect(web).toContain(notice);
      expect(web).toContain('role="status"');
      expect(web).toContain('Silakan muat ulang halaman ini beberapa');
    }
    expect(readRoot('app/(public)/laporan/_laporan-content.tsx')).not.toContain('belum dapat ditampilkan');
    expect(readRoot('app/(public)/gabung-siswa/docs/page.tsx')).not.toContain('belum dapat ditampilkan');
  });

  it('the legacy empty states are kept, and shown only for an empty list (null is the degraded state)', () => {
    const laporan = readWeb('src/components/ReportsSection.astro');
    expect(laporan).toContain('reports === null ? (');
    expect(laporan).toContain('total === 0 ? (');
    const docs = readWeb('src/pages/gabung-siswa/docs.astro');
    expect(docs).toContain('resources === null && (');
    expect(docs).toContain('resources !== null && !hasAnything && (');
  });
});

describe('/gabung-siswa', () => {
  const web = readWeb('src/pages/gabung-siswa.astro');
  const legacy = readRoot('app/(public)/gabung-siswa/page.tsx');

  it('"Open Recruitment Gen 6" is hard-coded as in the legacy page, with a comment that points at SAKEM-059', () => {
    expect(legacy).toContain('Open Recruitment Gen 6');
    const at = web.indexOf('Open Recruitment Gen 6');
    expect(at).toBeGreaterThan(0);
    expect(web.slice(Math.max(0, at - 400), at)).toContain('SAKEM-059');
  });

  it('"Daftar Sekarang" goes to the registration shortlink and "Pusat Dokumen" to /gabung-siswa/docs, as plain links, exactly where the legacy page has them (the one deliberate difference, SAKEM-103: /portal/daftar is REGISTRATION_PATH, /daftar)', () => {
    const hrefs = (src: string) => [...src.matchAll(/href=(?:"([^"]+)"|\{(\w+)\})/g)].map((m) => m[1] ?? (m[2] === 'REGISTRATION_PATH' ? '/daftar' : `{${m[2]}}`));
    expect(hrefs(web)).toEqual(hrefs(legacy).map((h) => (h === '/portal/daftar' ? '/daftar' : h)));
    expect(hrefs(web)).toEqual(['/daftar', '#manfaat', '/gabung-siswa/docs', '/daftar']);
    expect(web).not.toMatch(/fetch\(|window\.location/);
  });

  it('has no script of its own: nothing here needs client JS', () => {
    expect(web).not.toMatch(/<script\b/);
  });

  it('four benefits and four steps, like the legacy arrays', () => {
    expect([...legacy.matchAll(/^\s+icon: \w+,$/gm)]).toHaveLength(4);
    expect([...web.matchAll(/^\s+icon: '[\w-]+',$/gm)]).toHaveLength(4);
    expect([...legacy.matchAll(/step: "0\d"/g)].map((m) => m[0])).toEqual([...web.matchAll(/step: '0\d'/g)].map((m) => m[0].replace(/'/g, '"')));
  });
});

describe('/gabung-siswa/docs', () => {
  const web = readWeb('src/pages/gabung-siswa/docs.astro');

  it('loads the copy script from src/scripts and nothing else', () => {
    expect([...web.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1].trim())).toEqual(["import '~/scripts/copy-button';"]);
  });

  it('the anchors are ids of the category (#panduan, #berkas-pendaftaran, ...), labelled by their heading, with room under the fixed navbar', () => {
    expect(web).toContain('<section id={category} class="scroll-mt-24" aria-labelledby={`heading-${category}`}>');
    expect(web).toContain('href={`#${category}`}');
    expect(web).toContain('<nav aria-label="Kategori dokumen"');
  });

  it('file and link buttons open a new tab safely; files download', () => {
    const card = readWeb('src/components/ResourceCard.astro');
    expect(card.match(/target="_blank"/g)).toHaveLength(2);
    expect(card.match(/rel="noopener noreferrer"/g)).toHaveLength(2);
    expect(card.match(/\sdownload\n/g)).toHaveLength(1);
  });
});

describe('SAKEM-105: the reports have one address, /donasi#laporan, and every place that names it agrees', () => {
  const [address, fragment] = REPORTS_SECTION_PATH.split('#');
  const section = readWeb('src/components/ReportsSection.astro');

  it('the address is the page /donasi and the fragment `laporan`', () => {
    expect(address).toBe('/donasi');
    expect(fragment).toBe('laporan');
  });

  it('the section carries that id, once, clears the fixed navbar when it is jumped to (scroll-mt-24, the documents page\'s own value) and is named by its heading', () => {
    expect(section.match(new RegExp(`<section id="${fragment}" class="scroll-mt-24 `, 'g'))).toHaveLength(1);
    expect(section.match(/\sid="laporan"/g)).toHaveLength(1);
    expect(section).toContain('aria-labelledby="laporan-heading"');
    expect(section).toContain('id="laporan-heading"');
    expect(readWeb('src/pages/gabung-siswa/docs.astro')).toContain('class="scroll-mt-24"');
  });

  it('/donasi mounts the section once, and the page is rendered by the Worker (a static file could not carry the reports)', () => {
    const donasi = readWeb('src/pages/donasi.astro');
    expect(donasi.match(/<ReportsSection\b/g)).toHaveLength(1);
    expect(donasi).toContain('export const prerender = false;');
    expect(donasi).not.toContain('export const prerender = true;');
  });

  it('the redirect table sends /laporan and the older /impact-reports to it with a 308, one hop (never to /laporan, never without the fragment)', () => {
    for (const source of ['/laporan', '/impact-reports', '/impact-reports/[...path]']) {
      expect(REDIRECTS[source], source).toEqual({ status: 308, destination: REPORTS_SECTION_PATH });
    }
  });

  it('the footer\'s "Laporan" goes to it, the menu has no Laporan, and the page /laporan is gone', () => {
    expect(footerLinks.filter((l) => l.label === 'Laporan').map((l) => l.href)).toEqual([REPORTS_SECTION_PATH]);
    expect(navLinks.map((l) => l.label)).not.toContain('Laporan');
    for (const rel of ['src/pages/laporan.astro', 'src/pages/laporan/index.astro']) expect(existsSync(`${webRoot}${rel}`), rel).toBe(false);
  });
});
