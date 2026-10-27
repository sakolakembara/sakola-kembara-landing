import { describe, expect, it } from 'vitest';
import { activePartners, impactMetrics, pastPartners, problemStats, testimonials } from '~/lib/home-data';
import { readRoot, readWeb, importRoot } from './helpers';

// The homepage sections after "Program Kami" (SAKEM-080, part A; redesigned as "Opsi C" in SAKEM-111,
// which dropped the branch map, the testimonial carousel and the role blurbs). Indonesian copy and the
// figures are fixed (docs/context/tone-of-voice.md): ported, never reworded. These tests need no build.

// Whitespace-normalised, like copy.test.ts.
const norm = (s: string) =>
  s
    .replace(/\{" "\}/g, ' ')
    .replace(/\{' '\}/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const cases: { name: string; web: string[]; root: string[]; phrases: string[] }[] = [
  {
    name: 'Problem ("Mengapa Kami Ada?")',
    web: ['src/components/sections/ProblemSection.astro'],
    root: ['components/sections/ProblemSection.tsx'],
    // "Mengapa ini terjadi?" and its dialog were removed by Dzul, 2026-10-27 (SAKEM-111).
    phrases: ['Mengapa Kami Ada?', 'Kami hadir untuk', 'mengubah realitas ini.'],
  },
  {
    name: 'Impact and stories',
    web: ['src/components/sections/ImpactSection.astro', 'src/components/sections/StoriesSection.astro'],
    root: ['components/sections/ImpactSection.tsx'],
    phrases: [
      'Setiap angka di sini mewakili mimpi yang terwujud dan kehidupan yang berubah melalui pendidikan.',
      'Cerita Sukses Alumni',
    ],
  },
  {
    name: 'Partners',
    web: ['src/components/sections/PartnersSection.astro'],
    root: ['components/sections/PartnersSection.tsx'],
    phrases: [
      'Bersama Mewujudkan Perubahan',
      'Terima kasih kepada semua partner yang telah mendukung misi kami untuk pendidikan yang setara.',
      // "Pernah Didukung & Bermitra Dengan" was removed by Dzul, 2026-10-27 (SAKEM-111).
    ],
  },
  {
    name: 'CTA',
    web: ['src/components/sections/CTASection.astro'],
    root: ['components/sections/CTASection.tsx'],
    phrases: [
      'Menjadi Siswa',
      'Daftar Sekarang',
      'Menjadi Donatur',
      'Donasi Sekarang',
      '/donasi',
      'Menjadi Relawan',
      'Gabung Tim',
      'Menjadi Partner',
      'Hubungi Kami',
      '/kontak',
    ],
  },
  {
    name: 'News ("Cerita & Inspirasi")',
    web: ['src/components/sections/NewsSection.astro'],
    root: ['components/sections/NewsSection.tsx'],
    phrases: ['Cerita & Inspirasi', 'Lihat Semua', '/blog'],
  },
];

describe('copy parity: every phrase of the home sections exists verbatim in the legacy source', () => {
  for (const c of cases) {
    describe(c.name, () => {
      const web = norm(c.web.map(readWeb).join('\n'));
      const root = norm(c.root.map(readRoot).join('\n'));
      it.each(c.phrases)('%s', (phrase) => {
        expect(root, 'legacy source').toContain(phrase);
        expect(web, 'port').toContain(phrase);
      });
    });
  }
});

describe('data is the legacy lib/data.ts, value for value', async () => {
  const legacy = await importRoot<{
    problemStats: unknown;
    impactMetrics: unknown;
    testimonials: { image: unknown }[];
    activePartners: { logo: unknown }[];
    pastPartners: { logo: unknown }[];
  }>('lib/data.ts');

  it('"Mengapa Kami Ada?" figures, charts and the detail text', () => {
    expect(problemStats).toEqual(legacy.problemStats);
  });
  it('impact metrics (the top-3 label shortened by Dzul, 2026-10-27)', () => {
    const shortened = (legacy.impactMetrics as { number: string; label: string; color: string }[]).map((m) =>
      m.label === 'Siswa Diterima di Top 3 Universitas di Indonesia' ? { ...m, label: 'Diterima di Kampus Top 3' } : m,
    );
    expect(impactMetrics).toEqual(shortened);
  });
  it('testimonials (the photo is imported by the component, keyed by id)', () => {
    expect(testimonials).toEqual(legacy.testimonials.map(({ image: _image, ...rest }) => rest));
  });
  it('partners, active and past (the logo is imported by the component, keyed by id)', () => {
    expect(activePartners).toEqual(legacy.activePartners.map(({ logo: _logo, ...rest }) => rest));
    expect(pastPartners).toEqual(legacy.pastPartners.map(({ logo: _logo, ...rest }) => rest));
  });
});

// Dzul, 2026-10-27: the join section's title is reworded from the legacy "Jadilah Bagian dari Perubahan".
describe('the join section title (SAKEM-111)', () => {
  it('is "Mari Menjadi Bagian Perubahan"', () => {
    const cta = norm(readWeb('src/components/sections/CTASection.astro'));
    expect(cta).toContain('Mari Menjadi <br />Bagian Perubahan');
    expect(cta).not.toContain('Jadilah Bagian <br />');
  });
});

describe('every photo and logo the page shows is wired', () => {
  const stories = readWeb('src/components/sections/StoriesSection.astro');
  const partners = readWeb('src/components/sections/PartnersSection.astro');
  it.each(testimonials.map((t) => [t.id, t.name] as const))('testimonial %s (%s) has a photo', (id, name) => {
    expect(stories).toContain(`${id}: '/images/testimoni/${name.toLowerCase().replace(/ /g, '-')}.jpg',`);
  });
  it.each([...activePartners, ...pastPartners].map((p) => p.id))('partner %s has a logo', (id) => {
    expect(partners).toMatch(new RegExp(`^\\s+'?${id}'?: \\w+Logo,$`, 'm'));
  });
});

describe('the home page composes the sections of design "Opsi C" (SAKEM-111)', () => {
  const order = (src: string) => [...src.matchAll(/<(\w+Section)[\s/>]/g)].map((m) => m[1]);
  it('Hero, Problem, Impact, Activities, Stories, Partners, News, CTA (Problem and Impact swapped by Dzul, 2026-10-27)', () => {
    expect(order(readWeb('src/pages/index.astro').split('<Base')[1])).toEqual([
      'HeroSection',
      'ProblemSection',
      'ImpactSection',
      'ActivitiesSection',
      'StoriesSection',
      'PartnersSection',
      'NewsSection',
      'CTASection',
    ]);
  });
});
