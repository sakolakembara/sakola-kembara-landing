import { describe, expect, it } from 'vitest';
import { absoluteUrl, buildSeo } from '~/lib/seo';
import { importRoot, liveTitle, readRoot, readWeb } from './helpers';

// Source-level checks for the pages of SAKEM-080 part D: /laporan, /gabung-siswa and
// /gabung-siswa/docs. What they render is checked in tests/gabung-siswa-built.test.ts (the
// prerendered page) and in scripts/e2e.mjs (the SSR ones, as the Worker serves them); the copy is
// compared with the legacy source in tests/copy.test.ts.

const pages = [
  {
    route: '/laporan',
    web: 'src/pages/laporan.astro',
    legacy: ['app/(public)/laporan/layout.tsx'],
    prerender: false,
  },
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

describe('the two SSR pages degrade the same way', () => {
  it.each([
    ['src/pages/laporan.astro', 'loadReports', 'x-reports-source'],
    ['src/pages/gabung-siswa/docs.astro', 'loadResources', 'x-resources-source'],
  ])('%s: loader, runtime, status and cache headers come from lib/content-api.ts', (file, loader, header) => {
    const src = readWeb(file);
    expect(src).toContain(`${loader}(contentRuntime(env, Astro.locals.cfContext))`);
    expect(src).toContain('contentPageHeaders(source)');
    expect(src).toContain('Astro.response.status = page.status;');
    expect(src).toContain(`Astro.response.headers.set('${header}', source);`);
    expect(src).not.toMatch(/https?:\/\/(?!sakolakembara\.org)[a-z0-9.-]+\.[a-z]{2,}/i); // no host baked in
  });

  it('the notice of the degraded state is new copy (the legacy page had no such state: a database error was a 500) and sits in a status region', () => {
    for (const [file, notice] of [
      ['src/pages/laporan.astro', 'Laporan belum dapat ditampilkan'],
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
    const laporan = readWeb('src/pages/laporan.astro');
    expect(laporan).toContain('reports === null ? (');
    expect(laporan).toContain('totalReports === 0 ? (');
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

  it('"Daftar Sekarang" goes to /portal/daftar and "Pusat Dokumen" to /gabung-siswa/docs, as plain links, exactly where the legacy page has them', () => {
    const hrefs = (src: string) => [...src.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs(web)).toEqual(hrefs(legacy));
    expect(hrefs(web)).toEqual(['/portal/daftar', '#manfaat', '/gabung-siswa/docs', '/portal/daftar']);
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
