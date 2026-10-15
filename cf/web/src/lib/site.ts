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

export const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/tim', label: 'Team' },
  { href: '/gabung-siswa', label: 'Siswa' },
  { href: '/donasi', label: 'Donasi' },
  { href: '/laporan', label: 'Laporan' },
  { href: '/blog', label: 'Blog' },
];

// The footer repeats the header destinations (its logo already links home)
// and carries Kontak, which lives only in the footer.
export const footerLinks = [
  ...navLinks.filter((link) => link.href !== '/'),
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
