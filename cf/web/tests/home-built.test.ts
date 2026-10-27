import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { getAllArticles } from '~/lib/blog';
import { activePartners, impactMetrics, pastPartners, problemStats, testimonials } from '~/lib/home-data';
import { branches, programCards } from '~/lib/site';
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
  css: { raw: 85_000, gzip: 15_500 },
};

describe.skipIf(!built)('home page build output', () => {
  const html = read('index.html');
  const hero = html.match(/<header[\s>][\s\S]*?<\/header>/)![0];
  // <section> never nests on the home page, so splitting on its tags yields one block per section.
  const [problem, impact, branchMap, activities, stories, partners, news, cta] = all(html, /<section[\s>][\s\S]*?<\/section>/g);

  it('has the video hero, then the eight sections in order, and one h1', () => {
    expect(all(html, /<section[\s>]/g)).toHaveLength(8);
    expect(branchMap).toContain('id="cabang"');
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

  it('headings: section h2s in order, the sub-headings of Program and News', () => {
    const h2 = all(html, /<h2[^>]*>[\s\S]*?<\/h2>/g).map(text);
    expect(h2).toEqual([
      'Mengapa Kami Ada?',
      'Dari Desa ke Kampus Impian',
      'Hadir dari Bandung sampai Samarinda',
      'Apa saja yang dilalui penerima manfaat Sakola Kembara?',
      'Cerita Sukses Alumni',
      'Bersama Mewujudkan Perubahan',
      'Cerita & Inspirasi',
      'Mari Menjadi Bagian Perubahan',
    ]);
    expect(all(activities, /<h3[^>]*>[\s\S]*?<\/h3>/g).map(text)).toEqual(programCards.map((p) => p.title));
    expect(all(partners, /<h3[\s>]/g)).toHaveLength(0);
  });

  it('one typeface: no Lora on the page (BYQ "Sustainability Hub", Dzul 2026-10-27), and the preloads are the two Jakarta weights it paints first', () => {
    expect(html).not.toContain('font-display');
    const preloads = all(html, /<link rel="preload"[^>]*as="font"[^>]*>/g).join(' ');
    expect(preloads).toMatch(/plus-jakarta-sans-latin-400-normal/);
    expect(preloads).toMatch(/plus-jakarta-sans-latin-500-normal/);
    expect(preloads).not.toMatch(/lora/i);
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
      expect(cards.map((c, i) => c.startsWith(`${impactMetrics[i].number} ${impactMetrics[i].label}`))).toEqual([true, true, true, true]);
      for (const u of ['Universitas Indonesia', 'Institut Teknologi Bandung', 'Universitas Gadjah Mada']) expect(impact).toContain(`alt="${u}"`);
      expect(text(impact)).toContain('Setiap angka di sini mewakili mimpi yang terwujud dan kehidupan yang berubah melalui pendidikan.');
      expect(impact).toContain('<a href="#cerita"');
    });
  });

  describe('Problem', () => {
    it('one centred paragraph per fact, as written, with its decorative infographic, then the closing line; no stat dialog any more', () => {
      const facts = all(problem, /<p data-fact[\s\S]*?<\/p>/g);
      expect(facts).toHaveLength(problemStats.length);
      // the sentence as written once the charts' popovers (hidden until hover, focus or click) are left out
      const withoutPops = (html: string) => html.replace(/<span id="problem-chart-\d"[\s\S]*?<\/span><\/span>(?=\.?(?:<\/p>| ))/g, '');
      problemStats.forEach((stat, i) => expect(text(withoutPops(facts[i]))).toContain(`${stat.text}.`));
      const charts = all(problem, /<button type="button" aria-expanded="false" aria-controls="problem-chart-\d" aria-label="[^"]+"/g);
      expect(charts.map((c) => c.match(/aria-label="([^"]+)"/)![1])).toEqual(problemStats.map((s) => s.chart.label));
      expect(text(problem)).toContain(problemStats.find((s) => s.detail)!.detail as string); // in the second chart's popover
      expect(text(problem)).toContain('Kami hadir untuk mengubah realitas ini.');
      expect(problem).toMatch(/<h2 class="sr-only"[^>]*>Mengapa Kami Ada\?<\/h2>/);
      expect(problem).not.toContain('<dialog');
      // every word has its own slice of the one fill timeline, in reading order
      const starts = all(problem, /--a:([\d.]+)%/g).map((m) => Number(m.match(/[\d.]+/)![0]));
      expect(starts.length).toBeGreaterThan(30);
      expect([...starts].sort((p, q) => p - q)).toEqual(starts);
    });
  });

  describe('Branch map', () => {
    it('a point and a chip per branch on the dotted map, the names for screen readers, three arcs from Bandung', () => {
      expect(branchMap).toContain('src="/images/peta/indonesia-dots.svg"');
      expect(all(branchMap, /<circle [^>]*fill="#0D1F52"/g)).toHaveLength(branches.length);
      const items = all(branchMap, /<li[\s>][\s\S]*?<\/li>/g); // the screen-reader list (not the leader <line>s)
      expect(items.map(text)).toEqual(branches.map((b) => `${b.name}, ${b.region}`));
      expect(all(branchMap, /<span aria-hidden="true" class="pointer-events-none absolute whitespace-nowrap rounded-full[^>]*>[^<]*<\/span>/g).map(text)).toEqual(
        ['Bojong', 'Cibodas', 'Cisarua', 'Bandung', 'Cililin', 'Cirebon', 'Purbalingga', 'Samarinda'],
      ); // a chip per branch
      expect(branchMap).not.toContain('instagram.com');
      expect(branchMap).toMatch(new RegExp(`aria-label="Peta cabang Sakola Kembara: ${branches.map((b) => b.name).join(', ')}"`));
      expect(all(branchMap, /class="branch-arc/g)).toHaveLength(3);
    });
  });

  describe('Program', () => {
    it('one step per program (a header button and a panel), its photo and a link to its page; only the first is open', () => {
      expect(all(activities, /<button[^>]*aria-expanded="(?:true|false)"/g).map((b) => b.includes('"true"'))).toEqual(programCards.map((_, i) => i === 0));
      expect(all(activities, /<div[^>]*role="region"[^>]*>/g).map((d) => /\shidden[\s>]/.test(d))).toEqual(programCards.map((_, i) => i !== 0));
      expect(all(activities, /<img [^>]*>/g)).toHaveLength(programCards.length);
      for (const p of programCards) {
        expect(text(activities)).toContain(p.title);
        expect(text(activities)).toContain(`${p.points.join('. ')}.`);
        expect(activities).toContain(`href="/program/${p.id}"`);
      }
    });
  });

  describe('Stories', () => {
    it('one letter per testimonial (only the first active, the others inert) with the whole quote, and a small photo per alumnus, the first one current', () => {
      expect(all(stories, /<figure[\s>]/g)).toHaveLength(testimonials.length);
      const panels = all(stories, /<div id="cerita-\d+"[^>]*>/g);
      expect(panels.map((p) => /\sinert[\s>]/.test(p))).toEqual(testimonials.map((_, i) => i !== 0));
      expect(panels.map((p) => /\sdata-active[\s>]/.test(p))).toEqual(testimonials.map((_, i) => i === 0));
      for (const t of testimonials) {
        expect(text(stories)).toContain(t.quote);
        expect(text(stories)).toContain(t.university);
        expect(stories).toContain(`alt="${t.name}"`);
        expect(stories).toContain(`aria-label="Tampilkan cerita ${t.name}"`);
      }
      expect(stories).not.toContain('<dialog');
      const thumbs = all(stories, /<button[^>]*data-story="\d+"[^>]*>/g);
      expect(thumbs).toHaveLength(testimonials.length);
      expect(thumbs.map((t) => t.includes('aria-current="true"'))).toEqual(testimonials.map((_, i) => i === 0));
      expect(text(stories)).not.toContain('Perjalanan inspiratif');
    });
  });

  describe('Partners', () => {
    it('one logo per partner, its alt the partner\'s name; no caption any more', () => {
      const logos = all(partners, /<img [^>]*>/g);
      expect(logos).toHaveLength(activePartners.length + pastPartners.length);
      [...activePartners, ...pastPartners].forEach((p, i) => expect(logos[i]).toContain(`alt="${p.name.replace(/&/g, '&amp;')}"`));
      expect(partners).not.toContain('Pernah Didukung');
    });
  });

  describe('CTA', () => {
    it('has the four role rows, each one link with the role and its action, and a decorative photo chip (the poster, SAKEM-111)', () => {
      const links = all(cta, /<a href="[^"]+" class="group[^>]*>[\s\S]*?<\/a>/g).map((a) => [a.match(/href="([^"]+)"/)![1], text(a)]);
      expect(links).toEqual([
        ['/daftar', 'Menjadi Siswa Daftar Sekarang'], // SAKEM-103: straight to the registration shortlink
        ['/donasi', 'Menjadi Donatur Donasi Sekarang'],
        ['/kontak', 'Menjadi Relawan Gabung Tim'],
        ['/kontak', 'Menjadi Partner Hubungi Kami'],
      ]);
      const chips = all(cta, /<img [^>]*>/g);
      expect(chips).toHaveLength(4 + 3); // a photo chip per role, and the three mascots
      expect(all(cta, /<img [^>]*class="maskot/g)).toHaveLength(3);
      for (const img of chips) expect(img, img).toMatch(/\salt[\s>]/); // decorative: the link text says it all
    });
  });

  describe('News', () => {
    const latest = getAllArticles().slice(0, 4);
    it('shows the four newest articles of the build-time index, each linking to its article page (rendered by the Worker from the API)', () => {
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
      // Every raster photo has the ladder; the branch map's dots are one vector file (SVG), served as is.
      for (const img of imgs.filter((i) => i.includes('/images/') && !/src="[^"]+\.svg"/.test(i))) expect(img, img).toContain('srcset="/_img/');
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
      // navbar, problem charts, program steps, alumni stories, hero video
      expect(scripts).toHaveLength(5);
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
