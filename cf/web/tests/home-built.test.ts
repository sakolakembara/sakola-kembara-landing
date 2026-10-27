import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { getAllArticles } from '~/lib/blog';
import { activePartners, impactMetrics, pastPartners, problemStats, testimonials } from '~/lib/home-data';
import { programCards } from '~/lib/site';
import { webRoot } from './helpers';

// The built home page (dist/client/index.html), design "Opsi C" (SAKEM-111): the video hero, seven
// sections, images, and the JS/CSS budget. Needs `pnpm build` first and is skipped, not failed, without dist/.
const client = path.join(webRoot, 'dist/client');
const built = existsSync(path.join(client, 'index.html'));

const read = (rel: string) => readFileSync(path.join(client, rel), 'utf8');
const gz = (s: string | Buffer) => gzipSync(s, { level: 9 }).length;
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const all = (html: string, re: RegExp) => [...html.matchAll(re)].map((m) => m[0]);

/**
 * The JS and CSS budget of the home page. The numbers are what `pnpm build` measured, plus a margin of
 * about 15% for JS: the test fails when the page ships more JS than that, so growth is a decision, not an
 * accident. The CSS limit is looser: the one stylesheet is shared by all pages and grows with every
 * ported page. Update the numbers in this file and in docs/cloudflare/web-skeleton.md ("JS and CSS
 * budget") together.
 *
 * Measured (SAKEM-111, when the map and the carousel left the page): eager JS 4,267 B raw / 2,088 B gzip, all inline
 * (navbar 3,394 + stat dialog 266 + hero video 607); CSS 63,488 B raw / 11,580 B gzip. The limits were kept.
 */
const BUDGET = {
  eagerJs: { raw: 9_000, gzip: 4_600 },
  css: { raw: 75_000, gzip: 13_500 },
};

describe.skipIf(!built)('home page build output', () => {
  const html = read('index.html');
  const hero = html.match(/<header[\s>][\s\S]*?<\/header>/)![0];
  // <section> never nests on the home page, so splitting on its tags yields one block per section.
  const [impact, problem, activities, stories, partners, news, cta] = all(html, /<section[\s>][\s\S]*?<\/section>/g);

  it('has the video hero, then the seven sections in order, and one h1', () => {
    expect(all(html, /<section[\s>]/g)).toHaveLength(7);
    expect(impact).toContain('id="impact"');
    expect(problem).toContain('Mengapa Kami Ada?');
    expect(activities).toContain('id="activities"');
    expect(stories).toContain('id="cerita"');
    expect(partners).toContain('id="partners"');
    expect(news).toContain('id="blog"');
    expect(cta).toContain('id="gabung"');
    expect(all(html, /<h1[\s>]/g)).toHaveLength(1);
    expect(hero).toContain('<h1');
    expect(text(hero)).toContain('Membuka Pintu Pendidikan Tinggi untuk Setiap Anak Indonesia');
  });

  it('headings: section h2s in order, the sub-headings of Program and Partners', () => {
    const h2 = all(html, /<h2[^>]*>[\s\S]*?<\/h2>/g).map(text);
    expect(h2).toEqual([
      'Pencapaian Sakola Kembara',
      'Mengapa Kami Ada?',
      'Mengapa ini terjadi?', // the heading of the stat dialog, in the HTML for crawlers
      'Apa saja yang dilalui penerima manfaat Sakola Kembara?',
      'Cerita Sukses Alumni',
      'Bersama Mewujudkan Perubahan',
      'Cerita & Inspirasi',
      'Jadilah Bagian dari Perubahan',
    ]);
    expect(all(activities, /<h3[^>]*>[\s\S]*?<\/h3>/g).map(text)).toEqual(programCards.map((p) => p.tag));
    expect(all(partners, /<h3[^>]*>[\s\S]*?<\/h3>/g).map(text)).toEqual(['Partner & Pendukung Aktif', 'Pernah Didukung & Bermitra Dengan']);
  });

  describe('Hero', () => {
    it('the video is silent, looped, inline, not preloaded, and has a phone size; no pause button (Dzul, 2026-10-27)', () => {
      const video = hero.match(/<video[^>]*>/)![0];
      for (const a of ['muted', 'loop', 'playsinline', 'preload="none"', 'aria-hidden="true"']) expect(video).toContain(a);
      expect(video).not.toContain('autoplay'); // the script starts it, unless the visitor asked for reduced motion or data saving
      expect(hero).toContain('<source src="/images/home/hero-loop-720.mp4" type="video/mp4" media="(max-width: 767px)">');
      expect(hero).toContain('<source src="/images/home/hero-loop.mp4" type="video/mp4">');
      expect(hero).not.toMatch(/<button[\s>]/);
    });
    it('the two actions: the program section and the donation page', () => {
      const links = all(hero, /<a href="[^"]+"[^>]*>[\s\S]*?<\/a>/g).map((a) => [a.match(/href="([^"]+)"/)![1], text(a)]);
      expect(links).toEqual([
        ['#activities', 'Lihat Program Kami'],
        ['/donasi', 'Dukung Misi Kami'],
      ]);
    });
  });

  describe('Impact', () => {
    it('the four metrics as rising cards, the total last, with their labels verbatim', () => {
      const cards = all(impact, /<li[\s>][\s\S]*?<\/li>/g).map(text);
      expect(cards).toEqual([impactMetrics[3], impactMetrics[2], impactMetrics[1], impactMetrics[0]].map((m) => `${m.number} ${m.label}`));
      expect(text(impact)).toContain('Setiap angka di sini mewakili mimpi yang terwujud dan kehidupan yang berubah melalui pendidikan.');
      expect(impact).toContain('<a href="#cerita"');
    });
  });

  describe('Problem', () => {
    it('one ruled row per figure, and the one stat detail dialog wired to its button', () => {
      const rows = all(problem, /<li[\s>][\s\S]*?<\/li>/g);
      expect(rows).toHaveLength(problemStats.length);
      problemStats.forEach((stat, i) => {
        expect(text(rows[i])).toContain(stat.number);
        expect(text(rows[i])).toContain(`${stat.text}.`);
      });
      expect(text(problem)).toContain('Kami hadir untuk mengubah realitas ini.');

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

  describe('Program', () => {
    it('one tile per program, its points and a link to its page', () => {
      expect(all(activities, /<li[\s>]/g)).toHaveLength(programCards.length);
      for (const p of programCards) {
        expect(text(activities)).toContain(p.title);
        expect(text(activities)).toContain(p.points.join(' · '));
        expect(activities).toContain(`href="/program/${p.id}"`);
      }
    });
  });

  describe('Stories', () => {
    it('a register row and a panel per testimonial, every quote in the HTML, only the first panel shown', () => {
      const tabs = all(stories, /<button[^>]*data-story-tab[^>]*>/g);
      const panels = all(stories, /<figure[^>]*data-story-panel[^>]*>/g);
      expect(tabs).toHaveLength(testimonials.length);
      expect(panels).toHaveLength(testimonials.length);
      tabs.forEach((t, i) => {
        expect(t).toContain('type="button"');
        expect(t).toContain(`aria-pressed="${i === 0}"`);
        expect(t).toContain(`aria-controls="story-${testimonials[i].id}"`);
      });
      panels.forEach((p, i) => expect(/\shidden[\s>]/.test(p), p).toBe(i !== 0));
      for (const t of testimonials) {
        expect(text(stories)).toContain(t.quote);
        expect(text(stories)).toContain(`${t.name} · ${t.major}`);
      }
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
    it('has the four role cards, each one link with the role and its action', () => {
      const links = all(cta, /<a href="[^"]+" class="group[^>]*>[\s\S]*?<\/a>/g).map((a) => [a.match(/href="([^"]+)"/)![1], text(a)]);
      expect(links).toEqual([
        ['/daftar', 'Menjadi Siswa Daftar Sekarang'], // SAKEM-103: straight to the registration shortlink
        ['/donasi', 'Menjadi Donatur Donasi Sekarang'],
        ['/kontak', 'Menjadi Relawan Gabung Tim'],
        ['/kontak', 'Menjadi Partner Hubungi Kami'],
      ]);
      for (const img of all(cta, /<img [^>]*>/g)) expect(img, img).toMatch(/\salt[\s>]/); // decorative: the link text says it all
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
    const isLogo = (img: string) => /logo-sakola-kembara[.-]/.test(img);

    it('every <img> has a src, numeric width and height, and an alt; below the fold they are lazy', () => {
      expect(imgs.length).toBeGreaterThanOrEqual(18);
      for (const img of imgs) {
        expect(attr(img, 'src'), img).toBeTruthy();
        expect(attr(img, 'width'), img).toMatch(/^\d+$/);
        expect(attr(img, 'height'), img).toMatch(/^\d+$/);
        expect(img, img).toMatch(/\salt(=|\s|>)/);
        if (!img.includes('fetchpriority="high"') && !isLogo(img)) expect(img, img).toContain('loading="lazy"');
      }
    });

    it('only the hero poster is the LCP image: eager, fetchpriority high, a WebP ladder, and the only one that is', () => {
      expect(all(html, /fetchpriority="high"/g)).toHaveLength(1);
      expect(all(html, /loading="eager"/g)).toHaveLength(1);
      const heroImg = imgs.find((i) => i.includes('fetchpriority="high"'))!;
      expect(hero).toContain(heroImg);
      expect(heroImg).toContain('src="/images/home/hero-poster.jpg"');
      expect(heroImg).toContain('loading="eager"');
      expect(heroImg).toContain('srcset=');
    });

    it('the photos and logos are build-time derivatives: webp under 200 KB each (the hero poster: 300 KB), no multi-MB originals', () => {
      // Imported logos (navbar, partners) are Astro's own derivatives; the photos are the WebP ladder of the asset pipeline.
      const logos = new Set(all(html, /\/_astro\/[\w.-]+\.(?:webp|png|jpe?g)/g));
      expect(logos.size).toBeGreaterThanOrEqual(8);
      for (const f of logos) expect(statSync(path.join(client, f)).size, f).toBeLessThan(200_000);
      // The poster fills the screen, so its widest rung (1600 px) may weigh more.
      const poster = all(imgs.find((i) => i.includes('fetchpriority="high"'))!, /\/_img\/[\w.-]+\.webp/g);
      expect(poster.length).toBeGreaterThanOrEqual(3);
      for (const f of poster) expect(statSync(path.join(client, f)).size, f).toBeLessThan(300_000);
      for (const img of imgs.filter((i) => i.includes('/images/'))) expect(img, img).toContain('srcset="/_img/');
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

    it(`eager JS (the page's own scripts, all inline) stays within ${BUDGET.eagerJs.raw} B raw / ${BUDGET.eagerJs.gzip} B gzip`, () => {
      // navbar, stat dialog, hero video, stories register
      expect(scripts).toHaveLength(4);
      expect(scripts.every((m) => !/\ssrc=/.test(m[1]))).toBe(true);
      expect(eagerRaw).toBeLessThanOrEqual(BUDGET.eagerJs.raw);
      expect(eagerGzip).toBeLessThanOrEqual(BUDGET.eagerJs.gzip);
    });

    it('no map library ships any more (the branch map left the page with SAKEM-111)', () => {
      expect(html).not.toMatch(/leaflet/i);
      expect(html).not.toContain('rel="modulepreload"');
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
