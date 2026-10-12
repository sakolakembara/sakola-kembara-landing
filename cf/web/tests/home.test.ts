import { describe, expect, it } from 'vitest';
import { activePartners, impactMetrics, mapLocations, mapStats, pastPartners, problemStats, testimonials } from '~/lib/home-data';
import { readRoot, readWeb, importRoot } from './helpers';

// The homepage sections after "Program Kami" (SAKEM-080, part A). Indonesian copy and the figures
// are fixed (docs/context/tone-of-voice.md): ported, never reworded. These tests need no build.

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
    web: ['src/components/sections/ProblemSection.astro', 'src/components/sections/problem/StatDetail.astro'],
    root: ['components/sections/ProblemSection.tsx'],
    phrases: ['Mengapa Kami Ada?', 'Kami hadir untuk', 'mengubah realitas ini.', 'Mengapa ini terjadi?', 'Tutup', 'aria-haspopup="dialog"'],
  },
  {
    name: 'Impact',
    web: [
      'src/components/sections/ImpactSection.astro',
      'src/components/sections/TestimonialCarousel.astro',
      'src/components/sections/ImpactMap.astro',
    ],
    root: ['components/sections/ImpactSection.tsx', 'components/Map/GISMap.tsx'],
    phrases: [
      'Dampak Kami',
      'Pencapaian Sakola Kembara',
      'Setiap angka di sini mewakili mimpi yang terwujud dan kehidupan yang berubah melalui pendidikan.',
      'Peta Penyebaran Sakola Kembara',
      'Jangkauan program kami di berbagai wilayah Pulau Jawa',
      'Cerita Sukses Alumni',
      'Perjalanan inspiratif dari siswa-siswa kami',
      'Testimoni sebelumnya',
      'Testimoni berikutnya',
      'Tampilkan testimoni',
      'Legenda',
      'Bimbel Aktif',
      'Roadshow',
      '#1E88E5',
      '#F9A825',
      'bg-blue-100 text-blue-700',
      'bg-yellow-100 text-yellow-700',
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      'from-primary-blue to-accent-navy',
      'from-secondary-yellow to-orange-500',
      'from-secondary-green to-green-700',
      'from-blue-yonder to-accent-navy',
    ],
  },
  {
    name: 'Partners',
    web: ['src/components/sections/PartnersSection.astro'],
    root: ['components/sections/PartnersSection.tsx'],
    phrases: [
      'Partner Kami',
      'Bersama Mewujudkan Perubahan',
      'Terima kasih kepada semua partner yang telah mendukung misi kami untuk pendidikan yang setara.',
      'Partner & Pendukung Aktif',
      'Pernah Didukung & Bermitra Dengan',
      'bg-[#F5F7FA]',
    ],
  },
  {
    name: 'CTA',
    web: ['src/components/sections/CTASection.astro'],
    root: ['components/sections/CTASection.tsx'],
    phrases: [
      'Bergabung Bersama Kami',
      'Jadilah Bagian dari Perubahan',
      'Pintu menuju pendidikan tinggi tidak terbuka dengan sendirinya. Empat peran berikut membuat program kami terus berjalan, dan semuanya terbuka lebar untuk Anda.',
      'Menjadi Siswa',
      'Pembinaan penuh selama satu tahun, Agustus hingga April, tanpa biaya. Terbuka bagi siswa kelas 12 dan lulusan yang menyiapkan UTBK maupun ujian mandiri.',
      'Daftar Sekarang',
      '/gabung-siswa',
      'Menjadi Donatur',
      'Donasi mulai Rp50.000 dapat membantu menopang kegiatan belajar pekanan, asrama, dan pendampingan beasiswa hingga siswa benar-benar duduk di bangku kuliah.',
      'Donasi Sekarang',
      '/donasi',
      'Menjadi Relawan',
      'Mengajar di kelas pekanan, mendampingi asrama, atau menopang operasional cabang. Sekitar separuh relawan kami adalah alumni yang kembali.',
      'Gabung Tim',
      'Menjadi Partner',
      'Dukungan institusi memperluas jangkauan kami dari delapan cabang di tiga provinsi ke daerah yang belum terjangkau.',
      'Hubungi Kami',
      '/kontak',
      'Belum yakin peran mana yang paling sesuai? Hubungi kami, dan kami bantu mencarikannya.',
      'bg-orange-500',
      'hover:bg-orange-600',
      'hover:bg-green-600',
    ],
  },
  {
    name: 'News ("Cerita & Inspirasi")',
    web: ['src/components/sections/NewsSection.astro'],
    root: ['components/sections/NewsSection.tsx'],
    phrases: ['Blog', 'Cerita & Inspirasi', 'Lihat Semua', '/blog'],
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
    mapLocations: unknown;
    mapStats: unknown;
    testimonials: { image: unknown }[];
    activePartners: { logo: unknown }[];
    pastPartners: { logo: unknown }[];
  }>('lib/data.ts');

  it('"Mengapa Kami Ada?" figures, charts and the detail text', () => {
    expect(problemStats).toEqual(legacy.problemStats);
  });
  it('impact metrics, map pins and map stats', () => {
    expect(impactMetrics).toEqual(legacy.impactMetrics);
    expect(mapLocations).toEqual(legacy.mapLocations);
    expect(mapStats).toEqual(legacy.mapStats);
  });
  it('testimonials (the photo is imported by the component, keyed by id)', () => {
    expect(testimonials).toEqual(legacy.testimonials.map(({ image: _image, ...rest }) => rest));
  });
  it('partners, active and past (the logo is imported by the component, keyed by id)', () => {
    expect(activePartners).toEqual(legacy.activePartners.map(({ logo: _logo, ...rest }) => rest));
    expect(pastPartners).toEqual(legacy.pastPartners.map(({ logo: _logo, ...rest }) => rest));
  });
});

describe('every photo and logo the data refers to is wired to an import', () => {
  const carousel = readWeb('src/components/sections/TestimonialCarousel.astro');
  const partners = readWeb('src/components/sections/PartnersSection.astro');
  it.each(testimonials.map((t) => [t.id, t.name] as const))('testimonial %s (%s) has a photo', (id) => {
    expect(carousel).toMatch(new RegExp(`^\\s+${id}: \\w+Photo,$`, 'm'));
  });
  it.each([...activePartners, ...pastPartners].map((p) => p.id))('partner %s has a logo', (id) => {
    expect(partners).toMatch(new RegExp(`^\\s+'?${id}'?: \\w+Logo,$`, 'm'));
  });
});

describe('the home page composes the sections in the legacy order', () => {
  const order = (src: string) => [...src.matchAll(/<(\w+Section)[\s/>]/g)].map((m) => m[1]);
  it('Hero, Problem, Activities, Impact, Partners, CTA, News', () => {
    const web = order(readWeb('src/pages/index.astro').split('<Base')[1]);
    const root = order(readRoot('app/(public)/page.tsx'));
    expect(web).toEqual(root);
    expect(web).toEqual([
      'HeroSection',
      'ProblemSection',
      'ActivitiesSection',
      'ImpactSection',
      'PartnersSection',
      'CTASection',
      'NewsSection',
    ]);
  });
});
