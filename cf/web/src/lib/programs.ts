// The three program stages (/program/<id>), ported VERBATIM from `programs` in the
// root lib/data.ts (copy is fixed: docs/context/tone-of-voice.md; tests/programs.test.ts
// compares every string with the legacy file). Photos are not here: the page imports
// them so the build can hash and resize them, and picks one by `photo` key.

import { programJsonLd, type SeoInput } from './seo';

/** Files in public/images/program/ at the repo root (without extension). */
export type ProgramPhoto =
  | 'prapembinaan'
  | 'pembinaan'
  | 'pasca-pembinaan'
  | 'kbm-pekanan'
  | 'asrama-akhir-tahun'
  | 'asrama-intensif'
  | 'mentoring';

export interface SubProgramAttachment {
  /** Link label shown on the button. */
  label: string;
  /** File under the site's /files/ folder. */
  href: string;
}

export interface SubProgram {
  title: string;
  description: string;
  /** Contact hours, rendered as a badge on the activity card. */
  hours?: string;
  /** Activity thumbnail. */
  photo?: ProgramPhoto;
  /** Downloadable sample document. */
  attachment?: SubProgramAttachment;
}

export interface Program {
  id: string;
  title: string;
  description: string;
  points: string[];
  tag: string;
  /** Header photo; also the share image. */
  photo: ProgramPhoto;
  subPrograms: SubProgram[];
}

export const programs: Program[] = [
  {
    id: 'prapembinaan',
    title: 'Roadshow & Seleksi',
    description:
      'Menjangkau dan menyeleksi siswa-siswa berpotensi dari berbagai daerah melalui roadshow ke sekolah dan proses seleksi berbasis motivasi.',
    points: [
      'Menjangkau siswa berpotensi dari berbagai daerah',
      'Roadshow ke sekolah di wilayah terpencil',
      'Seleksi berbasis motivasi dan potensi belajar',
    ],
    tag: 'Pra Pembinaan',
    photo: 'prapembinaan',
    subPrograms: [
      {
        title: 'Roadshow ke Sekolah',
        description:
          'Kunjungan langsung ke sekolah-sekolah di daerah-daerah sekitar cabang Sakola Kembara tentang pentingnya Perguruan Tinggi dan memberikan harapan bahwa kuliah dapat diakses karena ketersediaan berbagai beasiswa.',
      },
      {
        title: 'Seleksi Siswa',
        description:
          'Seleksi berbasis surat motivasi dan wawancara untuk mencari siswa yang paling semangat dan berkomitmen tinggi, bukan yang paling pintar. Hal ini didasari karena kecerdasan dipengaruhi kemampuan ekonomi.',
      },
    ],
  },
  {
    id: 'pembinaan',
    title: 'Pembelajaran Intensif',
    description:
      'Program pembelajaran intensif selama satu tahun dengan kurikulum khusus, mentoring, dan berbagai kegiatan pendukung untuk mempersiapkan siswa menghadapi UTBK.',
    points: [
      'Kurikulum khusus selama 1 tahun (Agu–Apr)',
      'Mentoring personal dan persiapan UTBK',
      'Asrama intensif menjelang seleksi PTN',
    ],
    tag: 'Pembinaan',
    photo: 'pembinaan',
    subPrograms: [
      {
        title: 'KBM Pekanan',
        description: 'Belajar setiap hari Sabtu dan Minggu dari Agustus hingga April.',
        hours: '290+ jam belajar setahun',
        photo: 'kbm-pekanan',
      },
      {
        title: 'Asrama Akhir Tahun',
        description:
          'Asrama selama 2 minggu saat libur semester sekolah di Desember-Januari. Proses belajar dilakukan setiap hari dari jam 8 pagi sampai 10 malam, di masing-masing cabang.',
        hours: '100 jam belajar',
        photo: 'asrama-akhir-tahun',
      },
      {
        title: 'Asrama Intensif',
        description:
          'Asrama 1-2 bulan setelah selesai berbagai Ujian di Sekolah. Proses belajar dilakukan setiap hari dari jam 8 pagi sampai 10 malam, dipusatkan di Kota Bandung.',
        hours: 'Hingga 400 jam belajar',
        photo: 'asrama-intensif',
      },
      {
        title: 'Mentoring',
        description: 'Program pendampingan personal untuk mendukung perkembangan akademik dan non-akademik siswa.',
        photo: 'mentoring',
      },
      {
        title: 'Talents Mapping',
        description:
          'Bekerjasama dengan talentsmapping.id, membantu seluruh siswa Sakola Kembara untuk memetakan bakat sehingga dapat memilih jurusan sesuai dengan bakatnya.',
        attachment: {
          label: 'Contoh hasil Talents Mapping',
          href: '/files/contoh-hasil-talents-mapping.pdf',
        },
      },
      {
        title: 'Kurikulum Khusus',
        description:
          'Kurikulum yang dirancang khusus menggabungkan materi dari SD-SMA untuk dapat dipahami dalam 1 tahun pembelajaran, menyesuaikan dengan kemampuan awal siswa.',
        attachment: {
          label: 'Contoh Kurikulum Khusus',
          href: '/files/kurikulum-khusus-sakola-kembara.pdf',
        },
      },
    ],
  },
  {
    id: 'pasca-pembinaan',
    title: 'Alumni & Beasiswa',
    description:
      'Pendampingan berkelanjutan bagi alumni dalam pencarian beasiswa, peningkatan kapasitas, dan peluang untuk berkontribusi kembali.',
    points: [
      'Pendampingan pencarian beasiswa berkelanjutan',
      'Peningkatan kapasitas dan pengembangan diri',
      '50% alumni kembali membantu sebagai volunteer',
    ],
    tag: 'Pasca Pembinaan',
    photo: 'pasca-pembinaan',
    subPrograms: [
      {
        title: 'Pendampingan Beasiswa',
        description:
          'Untuk seluruh lulusan Sakola Kembara yang diterima di berbagai perguruan tinggi, kami dampingi proses pencarian beasiswanya hingga siswa tersebut bisa memulai proses perkuliahan.',
      },
      {
        title: 'Peningkatan Kapasitas',
        description:
          'Berbagai program peningkatan kapasitas alumni Sakola Kembara guna mempersiapkan mereka untuk sukses di kampus dan di dunia pascakampus.',
      },
      {
        title: 'Peluang Menjadi Relawan',
        description:
          'Setidaknya 50% dari siswa Sakola Kembara memutuskan untuk kembali mendukung Sakola Kembara dengan menjadi relawan atau dukungan lainnya.',
      },
    ],
  },
];

/**
 * Head data and JSON-LD of /program/<id>, as the root app/(public)/program/[id]/layout.tsx
 * builds them: title "Program <title>", the program's description, canonical
 * /program/<id>, the program photo as share image, and the Program JSON-LD.
 * `ogImage` is the public path of the photo (the page resolves it after the build hashes it).
 */
export function programSeo(program: Program, ogImage: string): { seo: Extract<SeoInput, { kind: 'page' }>; jsonLd: unknown[] } {
  return {
    seo: {
      kind: 'page',
      title: `Program ${program.title}`,
      description: program.description,
      path: `/program/${program.id}`,
      ogImage,
    },
    jsonLd: [programJsonLd(program)],
  };
}
