import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { getAllArticles } from '~/lib/blog';
import { activePartners, impactMetrics, mapLocations, mapStats, pastPartners, problemStats, testimonials } from '~/lib/home-data';
import { programCards } from '~/lib/site';
import { webRoot } from './helpers';

// The built home page (dist/client/index.html): structure of the seven sections, images, and the
// JS/CSS budget. Needs `pnpm build` first and is skipped, not failed, without dist/.
const client = path.join(webRoot, 'dist/client');
const built = existsSync(path.join(client, 'index.html'));

const read = (rel: string) => readFileSync(path.join(client, rel), 'utf8');
const gz = (s: string | Buffer) => gzipSync(s, { level: 9 }).length;
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const all = (html: string, re: RegExp) => [...html.matchAll(re)].map((m) => m[0]);

/**
 * The JS and CSS budget of the home page. The numbers are what `pnpm build` measured when the
 * sections were ported (SAKEM-080), plus a margin of about 15% for JS: the test fails when the page ships
 * more JS than that, so growth is a decision, not an accident. The CSS limit is looser: the one
 * stylesheet is shared by all pages and grows with every ported page. Update the numbers in this
 * file and in docs/cloudflare/web-skeleton.md ("JS and CSS budget") together.
 *
 * Measured: eager JS 7,803 B raw / 3,870 B gzip (navbar 3,444 + stat dialog 266 + carousel 1,028 inline,
 * plus the 3,065 B map loader); lazy map chunks 166,150 B raw / 49,994 B gzip; CSS 62,103 B raw / 11,041 B gzip
 * (after the program and donation pages joined the shared stylesheet).
 */
const BUDGET = {
  eagerJs: { raw: 9_000, gzip: 4_600 },
  lazyMap: { raw: 190_000, gzip: 58_000 },
  css: { raw: 75_000, gzip: 13_500 },
};

describe.skipIf(!built)('home page build output', () => {
  const html = read('index.html');
  // <section> never nests on the home page, so splitting on its tags yields one block per section.
  const [hero, problem, activities, impact, partners, cta, news] = all(html, /<section[\s>][\s\S]*?<\/section>/g);

  it('has the seven sections in the legacy order and one h1', () => {
    expect(all(html, /<section[\s>]/g)).toHaveLength(7);
    expect(problem).toContain('Mengapa Kami Ada?');
    expect(activities).toContain('id="activities"');
    expect(impact).toContain('id="impact"');
    expect(partners).toContain('id="partners"');
    expect(cta).toContain('Jadilah Bagian dari Perubahan');
    expect(news).toContain('id="blog"');
    expect(all(html, /<h1[\s>]/g)).toHaveLength(1);
    expect(hero).toContain('<h1');
  });

  it('headings: section h2s in order, the sub-headings of Impact and Partners', () => {
    const h2 = all(html, /<h2[^>]*>[\s\S]*?<\/h2>/g).map(text);
    expect(h2).toEqual([
      'Mengapa Kami Ada?',
      'Mengapa ini terjadi?', // the heading of the stat dialog, in the HTML for crawlers
      'Apa saja yang dilalui penerima manfaat Sakola Kembara?',
      'Pencapaian Sakola Kembara',
      'Bersama Mewujudkan Perubahan',
      'Jadilah Bagian dari Perubahan',
      'Cerita & Inspirasi',
    ]);
    expect(all(impact, /<h3[^>]*>[\s\S]*?<\/h3>/g).map(text)).toEqual(['Peta Penyebaran Sakola Kembara', 'Cerita Sukses Alumni']);
    expect(all(partners, /<h3[^>]*>[\s\S]*?<\/h3>/g).map(text)).toEqual(['Partner & Pendukung Aktif', 'Pernah Didukung & Bermitra Dengan']);
  });

  describe('Problem', () => {
    it('shows the three figures with a chart each, and one stat detail dialog wired to its button', () => {
      expect(all(problem, /<article[\s>]/g)).toHaveLength(problemStats.length);
      for (const stat of problemStats) {
        expect(text(problem)).toContain(stat.number);
        expect(text(problem)).toContain(stat.text);
      }
      const charts = all(problem, /<div role="img" aria-label="[^"]+"/g);
      expect(charts).toHaveLength(3);
      for (const stat of problemStats) expect(charts.join('\n')).toContain(`aria-label="${stat.chart.label}"`);

      const detailCount = problemStats.filter((s) => s.detail).length;
      expect(all(problem, /<dialog[\s>]/g)).toHaveLength(detailCount);
      const dialogId = problem.match(/<dialog id="([^"]+)" aria-labelledby="([^"]+)"/);
      expect(dialogId).not.toBeNull();
      const [, id, labelledby] = dialogId as RegExpMatchArray;
      expect(problem).toContain(`id="${labelledby}"`); // the dialog's label exists
      expect(problem).toMatch(new RegExp(`<button[^>]*aria-haspopup="dialog"[^>]*data-dialog-open="${id}"`));
      expect(problem).toContain('<form method="dialog">'); // "Tutup" closes natively
      expect(text(problem)).toContain(problemStats.find((s) => s.detail)!.detail as string);
    });
  });

  describe('Impact', () => {
    it('has the four metrics', () => {
      for (const m of impactMetrics) {
        expect(text(impact)).toContain(m.number);
        expect(text(impact)).toContain(m.label);
      }
      expect(all(impact, /<div class="bg-gradient-to-br /g)).toHaveLength(impactMetrics.length);
    });

    it('has the map: every branch is in the HTML (the no-JS and crawler view), with coordinates for the script', () => {
      const items = all(impact, /<li class="bg-white rounded-xl shadow-sm"[^>]*>/g);
      expect(items).toHaveLength(mapLocations.length);
      for (const loc of mapLocations) {
        expect(impact).toContain(`data-lat="${loc.lat}" data-lng="${loc.lng}" data-title="${loc.name}" data-color="#1E88E5"`);
        expect(text(impact)).toContain(loc.name);
        expect(text(impact)).toContain(loc.region);
      }
      expect(impact).toContain('aria-label="Lokasi Sakola Kembara"');
      for (const s of mapStats) expect(text(impact)).toContain(s.label);
      // the legend belongs to the map, so it stays hidden until the script shows the map
      expect(impact).toMatch(/data-map-legend hidden/);
    });

    it('has the carousel: a labelled, focusable region; one card per testimonial; controls hidden until the script runs', () => {
      expect(impact).toMatch(/<div role="region" aria-roledescription="carousel" aria-label="Cerita Sukses Alumni" tabindex="0" data-carousel-track/);
      const cards = all(impact, /<li class="snap-start[^"]*">/g);
      expect(cards).toHaveLength(testimonials.length);
      for (const t of testimonials) {
        expect(text(impact)).toContain(t.name);
        expect(text(impact)).toContain(t.quote);
        expect(text(impact)).toContain(t.major);
        expect(text(impact)).toContain(t.university);
      }
      // previous/next: real <button>s with Indonesian labels (the overlay pair and the phone pair)
      expect(all(impact, /<button[^>]*aria-label="Testimoni sebelumnya"[^>]*>/g)).toHaveLength(2);
      expect(all(impact, /<button[^>]*aria-label="Testimoni berikutnya"[^>]*>/g)).toHaveLength(2);
      for (let i = 1; i <= testimonials.length; i++) expect(impact).toContain(`aria-label="Tampilkan testimoni ${i}"`);
      // nothing interactive that needs the script is visible without it
      const ui = all(impact, /<(?:button|div)[^>]*data-carousel-ui[^>]*>/g);
      expect(ui).toHaveLength(3);
      for (const el of ui) expect(el, el).toMatch(/\shidden[\s>]/);
      // every button is a native <button type="button">, so Enter and Space work
      for (const b of all(impact, /<button[^>]*>/g).filter((b) => b.includes('data-carousel'))) expect(b, b).toContain('type="button"');
    });
  });

  describe('Partners', () => {
    it('lists the active and the past partners, logos decorative (the name is the text next to them)', () => {
      const [active, past] = partners.split('Pernah Didukung &amp; Bermitra Dengan');
      expect(all(active, /<li[\s>]/g)).toHaveLength(activePartners.length);
      expect(all(past, /<li[\s>]/g)).toHaveLength(pastPartners.length);
      for (const p of [...activePartners, ...pastPartners]) expect(text(partners)).toContain(p.name);
      const logos = all(partners, /<img [^>]*>/g);
      expect(logos).toHaveLength(activePartners.length + pastPartners.length);
      for (const logo of logos) expect(logo, logo).toMatch(/\salt[\s>]/); // empty alt
    });
  });

  describe('CTA', () => {
    it('has the four role cards with their links', () => {
      const links = all(cta, /<a href="[^"]+" class="mt-auto[^>]*>[\s\S]*?<\/a>/g).map((a) => [a.match(/href="([^"]+)"/)![1], text(a)]);
      expect(links).toEqual([
        ['/gabung-siswa', 'Daftar Sekarang'],
        ['/donasi', 'Donasi Sekarang'],
        ['/kontak', 'Gabung Tim'],
        ['/kontak', 'Hubungi Kami'],
      ]);
      expect(all(cta, /<h3[\s>]/g)).toHaveLength(4);
      expect(text(cta)).toContain('Belum yakin peran mana yang paling sesuai? Hubungi kami, dan kami bantu mencarikannya.');
    });
  });

  describe('News', () => {
    const latest = getAllArticles().slice(0, 3);
    it('shows the three newest articles of the build-time index, each linking to its article page (rendered by the Worker from the API)', () => {
      const links = all(news, /<a href="\/blog\/[^"]+"/g).map((a) => a.match(/href="([^"]+)"/)![1]);
      expect(links).toEqual(latest.map((a) => `/blog/${a.id}`));
      for (const a of latest) {
        expect(text(news)).toContain(a.title);
        expect(text(news)).toContain(a.date);
        expect(text(news)).toContain(a.category);
      }
      expect(news).toContain('<a href="/blog" ');
      expect(text(news)).toContain('Lihat Semua');
    });
    it('a cover is only rendered when there is one, and never with an empty src', () => {
      expect(html).not.toMatch(/<img[^>]*\ssrc=""/);
      const covers = all(news, /<img [^>]*>/g);
      expect(covers).toHaveLength(latest.filter((a) => a.image).length);
      for (const img of covers) expect(img).toMatch(/src="\/blog\/images\/[^"]+"/);
    });
  });

  describe('images', () => {
    const imgs = all(html, /<img [^>]*>/g);
    const attr = (img: string, name: string) => img.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

    it('every <img> has a src, numeric width and height, and an alt; below the fold they are lazy', () => {
      expect(imgs.length).toBeGreaterThanOrEqual(22);
      for (const img of imgs) {
        expect(attr(img, 'src'), img).toBeTruthy();
        expect(attr(img, 'width'), img).toMatch(/^\d+$/);
        expect(attr(img, 'height'), img).toMatch(/^\d+$/);
        expect(img, img).toMatch(/\salt(=|\s|>)/);
        if (!img.includes('Siswa Sakola Kembara belajar bersama') && !img.includes('logo-sakola-kembara.')) {
          expect(img, img).toContain('loading="lazy"');
        }
      }
    });

    it('only the hero photo is the LCP image: eager, fetchpriority high, and the only one that is', () => {
      expect(all(html, /fetchpriority="high"/g)).toHaveLength(1);
      expect(all(html, /loading="eager"/g)).toHaveLength(1);
      const heroImg = imgs.find((i) => i.includes('fetchpriority="high"'))!;
      expect(heroImg).toContain('Siswa Sakola Kembara belajar bersama');
      expect(heroImg).toContain('loading="eager"');
    });

    it('the photos and logos are build-time derivatives: webp under 200 KB each, no multi-MB originals', () => {
      const files = new Set(all(html, /\/_astro\/[\w.-]+\.(?:webp|png|jpe?g)/g));
      // 3 program photos, 7 testimonial photos, 6 logos, hero, 2 footer/navbar logos (+ srcset variants)
      expect(files.size).toBeGreaterThanOrEqual(19);
      for (const f of files) {
        const size = statSync(path.join(client, f)).size;
        expect(size, f).toBeLessThan(200_000);
      }
      const names = [...files].join(' ');
      for (const t of testimonials) expect(names).toContain(t.name.toLowerCase().replace(/ /g, '-'));
    });

    it('the program cards of the section before are still there', () => {
      for (const p of programCards) expect(text(activities)).toContain(p.title);
    });
  });

  describe('JS and CSS budget', () => {
    const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !m[1].includes('ld+json'));
    const eager = scripts.map((m) => {
      const src = m[1].match(/\ssrc="([^"]+)"/)?.[1];
      return src ? readFileSync(path.join(client, src)) : Buffer.from(m[2]);
    });
    const eagerRaw = eager.reduce((n, b) => n + b.length, 0);
    const eagerGzip = eager.reduce((n, b) => n + gz(b), 0);

    it(`eager JS (the page's own scripts, inline and file) stays within ${BUDGET.eagerJs.raw} B raw / ${BUDGET.eagerJs.gzip} B gzip`, () => {
      // navbar, stat dialog, carousel (inline) and the map loader (a file, because it holds dynamic imports)
      expect(scripts).toHaveLength(4);
      expect(eagerRaw).toBeLessThanOrEqual(BUDGET.eagerJs.raw);
      expect(eagerGzip).toBeLessThanOrEqual(BUDGET.eagerJs.gzip);
    });

    it('Leaflet and its CSS are lazy: nothing of them is referenced by the HTML, only imported dynamically by the map loader', () => {
      expect(html).not.toMatch(/leaflet/i); // no script, link, preload or modulepreload
      expect(html).not.toContain('rel="modulepreload"');
      const loader = scripts.map((m) => m[1].match(/\ssrc="([^"]+)"/)?.[1]).find((s) => s?.includes('ImpactMap'))!;
      const loaderCode = read(loader.slice(1));
      const chunks = [...loaderCode.matchAll(/import\("\.\/([\w.-]+\.js)"\)/g)].map((m) => m[1]);
      expect(chunks.length).toBe(3); // leaflet, leaflet css (as a string), map css (as a string)
      expect(loaderCode).not.toMatch(/^import /m); // no static import: nothing is fetched before the dynamic ones
      const files = chunks.map((c) => readFileSync(path.join(client, '_astro', c)));
      expect(files.reduce((n, b) => n + b.length, 0)).toBeLessThanOrEqual(BUDGET.lazyMap.raw);
      expect(files.reduce((n, b) => n + gz(b), 0)).toBeLessThanOrEqual(BUDGET.lazyMap.gzip);
    });

    it(`CSS (one stylesheet plus inline <style>) stays within ${BUDGET.css.raw} B raw / ${BUDGET.css.gzip} B gzip`, () => {
      const links = all(html, /<link rel="stylesheet" href="([^"]+)"/g).map((l) => l.match(/href="([^"]+)"/)![1]);
      expect(links).toHaveLength(1);
      const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
      const css = [readFileSync(path.join(client, links[0].slice(1)), 'utf8'), ...inline].join('\n');
      expect(css.length).toBeLessThanOrEqual(BUDGET.css.raw);
      expect(gz(css)).toBeLessThanOrEqual(BUDGET.css.gzip);
    });

    it('no animation or UI library ships: entrance motion is CSS (scroll-driven, behind @supports)', () => {
      const css = html.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? '';
      expect(css).toContain('animation-timeline');
      expect(css).toMatch(/@supports\s*\(animation-timeline:\s*view\(\)\)/);
      expect(css).toMatch(/prefers-reduced-motion:\s*reduce\)\s*{\s*\.anim-reveal\s*{\s*animation:\s*none/);
      for (const m of scripts) expect(m[2]).not.toMatch(/framer|gsap|IntersectionObserver\(.*reveal/);
    });
  });
});
