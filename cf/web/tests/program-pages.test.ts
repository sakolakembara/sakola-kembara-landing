import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { galleryAlt, getProgramGallery } from '~/lib/gallery';
import { programs } from '~/lib/programs';
import { PROGRAM_IDS, STATIC_ROUTES } from '~/lib/sitemap';
import { graphTypes, importRoot, readRoot, webRoot } from './helpers';

// Checks on the pages `pnpm build` generates for /program/<id> (dist/client/*.html).
// Skipped, not failed, when dist/ is missing, like tests/built.test.ts.
// /donasi is not one of them since SAKEM-105: it carries the reports, so the Worker renders it, and what it renders (the head, the
// payment cards, the QRIS image, the copy button, the confirmation and contact cards, the Laporan section) is checked on the built
// Worker's answer in scripts/e2e.mjs, group `donasi`.
const client = path.join(webRoot, 'dist/client');
const built = existsSync(path.join(client, 'program/pembinaan.html'));

const read = (rel: string) => readFileSync(path.join(client, rel), 'utf8');
const decode = (s: string) =>
  s.replace(/&amp;|&#38;/g, '&').replace(/&lt;|&#60;/g, '<').replace(/&gt;|&#62;/g, '>').replace(/&quot;|&#34;/g, '"').replace(/&#39;|&apos;/g, "'");
/** The page's text between the skip link target and the footer, tags removed, whitespace collapsed. */
const textOf = (html: string) => {
  const main = html.slice(html.indexOf('id="konten-utama"'), html.indexOf('<footer'));
  return decode(main.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
};
const imgsOf = (html: string) => [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
const attr = (tag: string, name: string) => decode(tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? '');
const meta = (html: string, key: string, value: string) => decode(html.match(new RegExp(`<meta ${key}="${value}" content="([^"]*)"`))?.[1] ?? '');
const canonical = (html: string) => html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
const jsonLd = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const links = (html: string) => [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);

describe.skipIf(!built)('/program/<id> build output', async () => {
  const rootSeo = await importRoot<{ programJsonLd: (p: unknown) => unknown }>('lib/seo.ts');

  it('exactly the three program pages are generated, as static files', () => {
    expect(programs.map((p) => p.id)).toEqual(['prapembinaan', 'pembinaan', 'pasca-pembinaan']); // note: no hyphen in the first id
    for (const { id } of programs) expect(existsSync(path.join(client, `program/${id}.html`)), id).toBe(true);
    expect(existsSync(path.join(client, 'program/index.html'))).toBe(false);
    expect(existsSync(path.join(client, 'program.html'))).toBe(false);
    expect(existsSync(path.join(client, 'program/unknown.html'))).toBe(false);
    expect(readdirSync(path.join(client, 'program')).sort()).toEqual(programs.map((p) => `${p.id}.html`).sort());
  });

  it('the sitemap still lists the three program URLs and /donasi (the sitemap is rendered by the Worker now: its output is checked in scripts/e2e.mjs)', () => {
    expect(PROGRAM_IDS).toEqual(programs.map((p) => p.id));
    expect(STATIC_ROUTES.map((r) => r.path)).toContain('/donasi');
    expect(existsSync(path.join(client, 'sitemap.xml'))).toBe(false);
  });

  describe.each(programs)('$id', (program) => {
    const html = read(`program/${program.id}.html`);
    const text = textOf(html);
    const index = programs.indexOf(program);

    it('lang id-ID, exactly one h1, and it is the stage title', () => {
      expect(html).toContain('<html lang="id-ID"');
      expect([...html.matchAll(/<h1[\s>]/g)]).toHaveLength(1);
      expect(decode(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)![1].replace(/<[^>]+>/g, '').trim())).toBe(program.title);
    });

    it('hero, stage tabs (three links, the current one marked), intro with tag, description and bullets', () => {
      expect(text).toContain('Apa saja yang dilalui penerima manfaat Sakola Kembara?'); // no "Program Kami" eyebrow since SAKEM-112
      expect(text).not.toContain('Program Kami Apa saja');
      const tabs = links(html).filter((a) => /href="\/program\/[a-z-]+"/.test(a) && a.includes('rounded-full px-4'));
      expect(tabs.map((a) => attr(a, 'href'))).toEqual(programs.map((p) => `/program/${p.id}`));
      expect(tabs.filter((a) => a.includes('aria-current="page"'))).toHaveLength(1);
      expect(tabs[index]).toContain('aria-current="page"');
      expect(html).toContain('aria-label="Tahapan program"');
      // the pill tabs name every stage (SAKEM-113); the "Tahap n · tag" chip of the intro is gone with it
      programs.forEach((stage, i) => expect(text).toContain(`0${i + 1} · ${stage.title}`));
      expect(text).toContain(program.description);
      for (const point of program.points) expect(text).toContain(point);
    });

    it('every activity: title, description, hours, thumbnail, and PDF links that open in a new tab', () => {
      expect(text).toContain('Kegiatan');
      for (const sub of program.subPrograms) {
        expect(text, sub.title).toContain(sub.title);
        expect(text, sub.title).toContain(sub.description);
        // the hours are the large figures above the polaroids (SAKEM-113): "Hingga 400 jam belajar" reads "hingga 400 jam belajar · Asrama Intensif"
        if (sub.hours) expect(text.toLowerCase()).toContain(`${sub.hours.toLowerCase()} · ${sub.title.toLowerCase()}`);
        if (sub.attachment) {
          const link = links(html).find((a) => attr(a, 'href') === sub.attachment!.href)!;
          expect(link, sub.attachment.href).toBeDefined();
          expect(link).toContain('target="_blank"');
          expect(link).toContain('rel="noopener noreferrer"');
          expect(text).toContain(`${sub.attachment.label} (PDF)`);
        }
      }
      const thumbs = imgsOf(html).filter((i) => attr(i, 'alt').startsWith('Kegiatan '));
      expect(thumbs.map((i) => attr(i, 'alt'))).toEqual(program.subPrograms.filter((s) => s.photo).map((s) => `Kegiatan ${s.title}`));
    });

    it('the empty "Timeline Kegiatan" placeholder is not rendered while it has no content (Dzul, 2026-10-28, SAKEM-113; SAKEM-057 decides what it becomes)', () => {
      expect(text).not.toContain('Timeline Kegiatan');
      expect(text).not.toContain('Konten timeline akan ditambahkan');
      const legacy = readRoot('app/(public)/program/[id]/_program-content.tsx');
      expect(legacy).toContain('Konten timeline akan ditambahkan');
    });

    it('gallery: shown with one lazy <img> per photo of the manifest, in order; the section is absent when there is none', () => {
      const photos = getProgramGallery(program.id);
      const gallery = imgsOf(html).filter((i) => attr(i, 'alt').startsWith('Dokumentasi '));
      if (photos.length === 0) {
        expect(text).not.toContain('Galeri Foto');
        expect(gallery).toHaveLength(0);
        return;
      }
      expect(text).toContain(`Galeri Foto Dokumentasi kegiatan program ${program.title}.`);
      expect(gallery).toHaveLength(photos.length);
      gallery.forEach((img, i) => {
        const photo = photos[i];
        expect(attr(img, 'alt')).toBe(galleryAlt(program.title, i));
        expect(attr(img, 'src')).toBe(photo.variants.at(-1)!.src);
        expect(attr(img, 'srcset')).toBe(photo.variants.map((v) => `${v.src} ${v.width}w`).join(', '));
        expect(attr(img, 'sizes')).toBe('(min-width: 768px) 33vw, 50vw');
        expect(attr(img, 'width')).toBe(String(photo.width));
        expect(attr(img, 'height')).toBe(String(photo.height));
        expect(attr(img, 'loading')).toBe('lazy');
        expect(attr(img, 'decoding')).toBe('async');
        for (const v of photo.variants) expect(existsSync(path.join(client, v.src)), v.src).toBe(true);
      });
    });

    it('the empty-gallery message of the legacy page is not ported', () => {
      expect(text).not.toContain('Galeri foto akan ditambahkan');
    });

    it('next stage and the PitchDeck call to action', () => {
      const next = programs[index + 1];
      if (next) {
        expect(text).toContain(`Tahap berikutnya · ${next.tag} ${next.title}`);
        const link = links(html).find((a) => attr(a, 'href') === `/program/${next.id}` && a.includes('bg-secondary-yellow'))!;
        expect(link).toBeDefined();
        expect(text).toContain(`Lanjut ke Tahap ${index + 2}`);
      } else {
        expect(text).not.toContain('Tahap berikutnya');
        expect(text).not.toContain('Lanjut ke Tahap');
      }
      expect(text).toContain('Ingin Tahu Lebih Lanjut? Download PitchDeck kami untuk informasi lengkap tentang program, dampak, dan cara berkontribusi.');
      const deck = links(html).find((a) => attr(a, 'href') === '/files/pitchdeck-sakola-kembara.pdf')!;
      expect(deck).toBeDefined();
      expect(deck).toMatch(/\sdownload(\s|>|=)/);
    });

    it('<img>: every one has alt, width and height; only the stage photo is eager and high priority; the rest is lazy', () => {
      const imgs = imgsOf(html);
      expect(imgs.length).toBeGreaterThanOrEqual(1 + program.subPrograms.filter((s) => s.photo).length + getProgramGallery(program.id).length);
      for (const img of imgs) {
        expect(img, img).toMatch(/\salt(="|\s|>)/); // the next stage's photo is decorative: an empty alt renders as a bare `alt`
        expect(img, img).toMatch(/\swidth="\d+"/);
        expect(img, img).toMatch(/\sheight="\d+"/);
      }
      const hero = imgs.filter((i) => i.includes('fetchpriority="high"'));
      expect(hero).toHaveLength(1);
      expect(attr(hero[0], 'alt')).toBe(program.title);
      expect(hero[0]).toContain('loading="eager"');
      expect(attr(hero[0], 'srcset')).toMatch(/ 640w, .* 960w, .* 1200w$/);
      for (const img of imgs.filter((i) => i !== hero[0] && !attr(i, 'src').includes('logo-sakola-kembara.'))) {
        expect(img, img).toContain('loading="lazy"');
      }
    });

    it('SEO: title, description, canonical, robots, Open Graph and Twitter (same values as the Next layout)', () => {
      expect(decode(html.match(/<title>([^<]*)<\/title>/)![1])).toBe(`Program ${program.title} - Yayasan Sakola Kembara Indonesia`);
      expect(meta(html, 'name', 'description')).toBe(program.description);
      expect(canonical(html)).toBe(`https://sakolakembara.org/program/${program.id}`);
      expect(meta(html, 'name', 'robots')).toBe('index, follow');
      expect(meta(html, 'property', 'og:title')).toBe(`Program ${program.title}`);
      expect(meta(html, 'property', 'og:description')).toBe(program.description);
      expect(meta(html, 'property', 'og:url')).toBe(`https://sakolakembara.org/program/${program.id}`);
      expect(meta(html, 'property', 'og:site_name')).toBe('Sakola Kembara');
      expect(meta(html, 'property', 'og:locale')).toBe('id_ID');
      expect(meta(html, 'property', 'og:type')).toBe('website');
      expect(meta(html, 'name', 'twitter:card')).toBe('summary_large_image');
      expect(meta(html, 'name', 'twitter:title')).toBe(`Program ${program.title}`);
      expect(meta(html, 'name', 'twitter:description')).toBe(program.description);
    });

    it('share image: the stage photo as a 1200 px JPEG file that exists in the build and is small', () => {
      const og = meta(html, 'property', 'og:image');
      expect(og).toMatch(new RegExp(`^https://sakolakembara\\.org/_astro/${program.photo}\\.[\\w-]+\\.jpe?g$`));
      expect(meta(html, 'name', 'twitter:image')).toBe(og);
      const file = path.join(client, og.replace('https://sakolakembara.org', ''));
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).size).toBeLessThan(300 * 1024);
    });

    it('Program JSON-LD: the site graph, then the program block, which parses and equals the root programJsonLd()', () => {
      const data = jsonLd(html);
      expect(data).toHaveLength(2);
      expect(graphTypes(html)).toEqual(['NGO+EducationalOrganization', 'WebSite', 'WebPage', 'BreadcrumbList']);
      expect(data[1]).toEqual(rootSeo.programJsonLd(program));
      expect(data[1]['@type']).toBe('EducationalOccupationalProgram');
      expect(data[1].url).toBe(`https://sakolakembara.org/program/${program.id}`);
    });

    it('no framework: one inline module script (the navbar) and the shared motion loader (SAKEM-112)', () => {
      expect([...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1])).toEqual([expect.stringMatching(/^\/_astro\/MotionLoader\./)]);
      const scripts = [...html.matchAll(/<script([^>]*)>/g)].filter((m) => !m[1].includes('ld+json'));
      expect(scripts).toHaveLength(2);
    });
  });
});
