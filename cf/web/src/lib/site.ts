// Navigation and homepage copy, ported VERBATIM from the root lib/data.ts
// (copy is fixed: docs/context/tone-of-voice.md). Images are not here: the
// components import them so the build can resize and hash them.

/**
 * Where every "Daftar Sekarang" goes (SAKEM-103, Phase A of the cutover): `/daftar`, an admin shortlink (D1) that answers a 307
 * to the registration form of the current cohort. The form's address is NOT in this repository: an admin edits the shortlink's
 * target when a new cohort opens, and nothing is deployed. Without a shortlink the visitor gets a polite page
 * (src/components/RegistrationUnavailablePage.astro, src/pages/[...path].astro). `/daftar` is not a reserved shortlink name.
 */
export const REGISTRATION_PATH = '/daftar';
/** The slug of that shortlink: `REGISTRATION_PATH` without its slash. */
export const REGISTRATION_SLUG = 'daftar';

/**
 * Where the reports are (SAKEM-105, variant A): the "Laporan" section of /donasi, `id="laporan"`
 * (src/components/ReportsSection.astro). The page /laporan is gone: it is a 308 to this address
 * (redirects.config.mjs), and the footer's "Laporan" link points here.
 */
export const REPORTS_SECTION_PATH = '/donasi#laporan';

/** The header menu: five items since SAKEM-105 (Laporan left it; the reports are a section of Donasi). */
export const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/tim', label: 'Team' },
  { href: '/gabung-siswa', label: 'Siswa' },
  { href: '/donasi', label: 'Donasi' },
  { href: '/blog', label: 'Blog' },
];

// The footer is NOT derived from the menu any more: it repeats the menu's destinations (its logo already links home),
// keeps "Laporan" between Donasi and Blog, where it has always been, now pointing at the section of /donasi that took
// the page's place (SAKEM-105), and carries Kontak, which lives only in the footer. Written out so that a change of
// the menu cannot move a footer link by accident (tests/copy.test.ts pins the list).
export const footerLinks = [
  { href: '/tim', label: 'Team' },
  { href: '/gabung-siswa', label: 'Siswa' },
  { href: '/donasi', label: 'Donasi' },
  { href: REPORTS_SECTION_PATH, label: 'Laporan' },
  { href: '/blog', label: 'Blog' },
  { href: '/kontak', label: 'Kontak' },
];

export const heroStats = [
  { number: '600+', label: 'Siswa Terbantu' },
  { number: '84%', label: 'Berkuliah' },
  { number: '8', label: 'Wilayah Jangkauan' },
];

export interface ProgramCard {
  id: string;
  title: string;
  points: string[];
  tag: string;
}

/** The three program cards of the homepage "Program Kami" section. */
export const programCards: ProgramCard[] = [
  {
    id: 'prapembinaan',
    title: 'Roadshow & Seleksi',
    points: [
      'Menjangkau siswa berpotensi dari berbagai daerah',
      'Roadshow ke sekolah di wilayah terpencil',
      'Seleksi berbasis motivasi dan potensi belajar',
    ],
    tag: 'Pra Pembinaan',
  },
  {
    id: 'pembinaan',
    title: 'Pembelajaran Intensif',
    points: [
      'Kurikulum khusus selama 1 tahun (Agu–Apr)',
      'Mentoring personal dan persiapan UTBK',
      'Asrama intensif menjelang seleksi PTN',
    ],
    tag: 'Pembinaan',
  },
  {
    id: 'pasca-pembinaan',
    title: 'Alumni & Beasiswa',
    points: [
      'Pendampingan pencarian beasiswa berkelanjutan',
      'Peningkatan kapasitas dan pengembangan diri',
      '50% alumni kembali membantu sebagai volunteer',
    ],
    tag: 'Pasca Pembinaan',
  },
];
