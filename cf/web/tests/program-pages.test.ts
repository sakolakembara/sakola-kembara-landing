import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { galleryAlt, getProgramGallery } from '~/lib/gallery';
import { programs } from '~/lib/programs';
import { PROGRAM_IDS } from '~/lib/sitemap';
import { importRoot, readRoot, webRoot } from './helpers';

// Checks on the pages `pnpm build` generates for /program/<id> and /donasi (dist/client/*.html).
// Skipped, not failed, when dist/ is missing, like tests/built.test.ts.
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

  it('the sitemap still lists the three program URLs', () => {
    const xml = read('sitemap.xml');
    for (const id of PROGRAM_IDS) expect(xml).toContain(`<loc>https://sakolakembara.org/program/${id}</loc>`);
    expect(xml).toContain('<loc>https://sakolakembara.org/donasi</loc>');
  });

  describe.each(programs)('$id', (program) => {
    const html = read(`program/${program.id}.html`);
    const text = textOf(html);
    const index = programs.indexOf(program);

    it('lang id, exactly one h1, and it is the stage title', () => {
      expect(html).toContain('<html lang="id"');
      expect([...html.matchAll(/<h1[\s>]/g)]).toHaveLength(1);
      expect(decode(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)![1].replace(/<[^>]+>/g, '').trim())).toBe(program.title);
    });

    it('hero, stage tabs (three links, the current one marked), intro with tag, description and bullets', () => {
      expect(text).toContain('Program Kami Apa saja yang dilalui penerima manfaat Sakola Kembara?');
      const tabs = links(html).filter((a) => /href="\/program\/[a-z-]+"/.test(a) && a.includes('group flex'));
      expect(tabs.map((a) => attr(a, 'href'))).toEqual(programs.map((p) => `/program/${p.id}`));
      expect(tabs.filter((a) => a.includes('aria-current="page"'))).toHaveLength(1);
      expect(tabs[index]).toContain('aria-current="page"');
      expect(html).toContain('aria-label="Tahapan program"');
      expect(text).toContain(`Tahap ${index + 1} · ${program.tag}`);
      expect(text).toContain(program.description);
      for (const point of program.points) expect(text).toContain(point);
    });

    it('every activity: title, description, hours, thumbnail, and PDF links that open in a new tab', () => {
      expect(text).toContain('Kegiatan');
      for (const sub of program.subPrograms) {
        expect(text, sub.title).toContain(sub.title);
        expect(text, sub.title).toContain(sub.description);
        if (sub.hours) expect(text).toContain(sub.hours);
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

    it('keeps the "Timeline Kegiatan" placeholder exactly as the legacy page has it (SAKEM-057)', () => {
      expect(text).toContain('Timeline Kegiatan Jadwal dan timeline kegiatan akan segera diperbarui. Konten timeline akan ditambahkan');
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
        expect(text).toContain(`Tahap berikutnya ${next.tag} · ${next.title}`);
        const link = links(html).find((a) => attr(a, 'href') === `/program/${next.id}` && a.includes('border-[1.5px]'))!;
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
        expect(img, img).toMatch(/\salt="/);
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
      expect(decode(html.match(/<title>([^<]*)<\/title>/)![1])).toBe(`Program ${program.title} | Sakola Kembara`);
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

    it('Program JSON-LD: the only structured data, parses, and equals the root programJsonLd()', () => {
      const data = jsonLd(html);
      expect(data).toHaveLength(1);
      expect(data[0]).toEqual(rootSeo.programJsonLd(program));
      expect(data[0]['@type']).toBe('EducationalOccupationalProgram');
      expect(data[0].url).toBe(`https://sakolakembara.org/program/${program.id}`);
    });

    it('no external script and no framework: one inline module script (the navbar)', () => {
      expect([...html.matchAll(/<script[^>]*\ssrc=/g)]).toHaveLength(0);
      const scripts = [...html.matchAll(/<script([^>]*)>/g)].filter((m) => !m[1].includes('ld+json'));
      expect(scripts).toHaveLength(1);
    });
  });
});

describe.skipIf(!built)('/donasi build output', async () => {
  const html = read('donasi.html');
  const text = textOf(html);
  const legacyPage = readRoot('app/(public)/donasi/page.tsx');
  const legacyLayout = readRoot('app/(public)/donasi/layout.tsx');

  it('is a static file', () => {
    expect(existsSync(path.join(client, 'donasi.html'))).toBe(true);
    expect(existsSync(path.join(client, 'donasi/index.html'))).toBe(false);
  });

  it('SEO: "Donasi | Sakola Kembara", the legacy description, canonical, Open Graph, default share image, no JSON-LD', () => {
    const description = legacyLayout.match(/description:\s*"([^"]+)"/)![1];
    expect(html).toContain('<title>Donasi | Sakola Kembara</title>');
    expect(meta(html, 'name', 'description')).toBe(description);
    expect(canonical(html)).toBe('https://sakolakembara.org/donasi');
    expect(meta(html, 'property', 'og:title')).toBe('Donasi');
    expect(meta(html, 'property', 'og:description')).toBe(description);
    expect(meta(html, 'property', 'og:url')).toBe('https://sakolakembara.org/donasi');
    expect(meta(html, 'property', 'og:image')).toBe('https://sakolakembara.org/og-default.jpg');
    expect(meta(html, 'name', 'twitter:image')).toBe('https://sakolakembara.org/og-default.jpg');
    expect(meta(html, 'name', 'robots')).toBe('index, follow');
    expect(jsonLd(html)).toEqual([]);
  });

  it('exactly one h1, the hero title, with the lead', () => {
    expect([...html.matchAll(/<h1[\s>]/g)]).toHaveLength(1);
    expect(text).toContain('Dukung Perjalanan Mereka Setiap donasi Anda membantu siswa dari keluarga kurang mampu untuk mewujudkan impian mereka masuk perguruan tinggi.');
  });

  it('payment cards: QRIS card and bank transfer card with the bank details exactly as the legacy page', () => {
    expect(text).toContain('Cara Berdonasi Pilih salah satu metode di bawah ini. Donasi dengan nominal berapa pun sangat berarti bagi mereka.');
    expect(text).toContain('Scan QRIS');
    // Raw HTML: the comma after the bold part must follow it directly (JSX gave no space there either).
    expect(html).toContain('Scan via <span class="font-semibold text-gray-700">GoPay, OVO, DANA, ShopeePay</span>, atau m-banking.');
    expect(text).toContain('Transfer Bank Bank Bank Muamalat Kode Bank 147 Nomor Rekening 1010 141 940 Atas Nama Sakola Kembara Indonesia');
    for (const value of ['Bank Muamalat', '147', '1010 141 940', 'Sakola Kembara Indonesia']) expect(legacyPage).toContain(`"${value}"`);
  });

  it('QRIS: a plain <img> with width, height, alt and lazy loading, pointing at a file in the build; the download link uses the same file', () => {
    const qr = imgsOf(html).find((i) => attr(i, 'alt') === 'QRIS Sakola Kembara')!;
    expect(qr).toBeDefined();
    expect(attr(qr, 'width')).toBe('280');
    expect(attr(qr, 'height')).toBe('373');
    expect(attr(qr, 'loading')).toBe('lazy');
    expect(attr(qr, 'decoding')).toBe('async');
    expect(qr).not.toContain('srcset');
    const src = attr(qr, 'src');
    expect(src).toMatch(/^\/_astro\/qris-sakola-kembara\.[\w-]+\.png$/);
    expect(statSync(path.join(client, src)).size).toBe(statSync(path.join(webRoot, '../../public/images/qris-sakola-kembara.png')).size); // the original, not re-encoded
    const download = links(html).find((a) => a.includes('download="qris-sakola-kembara.png"'))!;
    expect(attr(download, 'href')).toBe(src);
    expect(text).toContain('Download QR');
    for (const img of imgsOf(html)) {
      expect(img, img).toMatch(/\swidth="\d+"/);
      expect(img, img).toMatch(/\sheight="\d+"/);
      expect(img, img).toMatch(/\salt="/);
    }
  });

  it('copy button: carries the account number of the legacy page; both labels are in the markup, the second hidden', () => {
    const number = legacyPage.match(/const ACCOUNT_NUMBER = "(\d+)"/)![1];
    expect(html).toContain(`data-copy-account="${number}"`);
    expect(html).toMatch(/<span data-copy-idle[^>]*>[\s\S]*?Salin No Rekening/);
    expect(html).toMatch(/<span data-copy-done hidden[^>]*>[\s\S]*?Tersalin!/);
  });

  it('confirmation card (Google Form, opens in a new tab) and contact card (/kontak)', () => {
    const form = legacyPage.match(/CONFIRMATION_FORM_URL =\s*"([^"]+)"/)![1];
    const link = links(html).find((a) => attr(a, 'href') === form)!;
    expect(link).toBeDefined();
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
    expect(text).toContain('Terima Kasih atas Donasi Anda Setelah berdonasi, mohon konfirmasikan melalui formulir berikut agar donasi Anda dapat kami catat dengan baik. Konfirmasi Donasi');
    expect(text).toContain('Kontak Kami Ada pertanyaan seputar donasi, penyaluran dana, atau laporan penggunaannya? Tim kami siap membantu. Hubungi Kami');
    expect(links(html).some((a) => attr(a, 'href') === '/kontak' && a.includes('bg-white'))).toBe(true);
  });

  it('the transparency block is not part of this page (separate ticket)', () => {
    expect(text).not.toMatch(/transparansi|laporan keuangan|Stakeholder/i);
  });

  it('no external script; no framework: the navbar script and the copy-button script, both inline', () => {
    expect([...html.matchAll(/<script[^>]*\ssrc=/g)]).toHaveLength(0);
    const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !m[1].includes('ld+json'));
    expect(scripts).toHaveLength(2);
    expect(scripts.filter((s) => s[2].includes('clipboard'))).toHaveLength(1);
    for (const s of scripts) expect(s[2].length).toBeLessThan(6000);
  });
});
