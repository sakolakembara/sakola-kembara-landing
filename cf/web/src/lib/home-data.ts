// Copy and data of the homepage sections after "Program Kami" (Problem, Impact,
// Partners), ported VERBATIM from the root lib/data.ts (copy is fixed:
// docs/context/tone-of-voice.md; tests/home.test.ts compares every string with
// the legacy file). Images are not here: the components import them (keyed by
// `id`) so the build can resize and hash them. The hero and program cards live
// in site.ts.

/**
 * Infographic drawn above each "Mengapa Kami Ada?" figure. `label` is the
 * chart's text alternative; the figure and sentence stay as plain text too.
 */
export type ProblemChart =
  | { kind: 'pictogram'; highlighted: number; total: number; label: string }
  | {
      kind: 'share';
      /** Fraction of the bar that is highlighted, 0-1. */
      share: number;
      caption: string;
      highlightLabel: string;
      restLabel: string;
      label: string;
    }
  | { kind: 'ratio'; bars: { name: string; value: number }[]; label: string };

export interface ProblemStat {
  number: string;
  text: string;
  detail: string | null;
  chart: ProblemChart;
}

export const problemStats: ProblemStat[] = [
  {
    number: '3/10',
    text: 'Hanya 3 dari 10 anak Indonesia yang memiliki akses ke pendidikan tinggi',
    detail: null,
    chart: {
      kind: 'pictogram',
      highlighted: 3,
      total: 10,
      label: 'Ilustrasi: 3 dari 10 ikon anak disorot',
    },
  },
  {
    number: '50%+',
    text: 'Lebih dari setengah mahasiswa berasal dari keluarga 20% terkaya',
    chart: {
      kind: 'share',
      // "Lebih dari setengah": drawn just past the halfway mark.
      share: 0.55,
      caption: 'Asal keluarga mahasiswa',
      highlightLabel: '20% keluarga terkaya',
      restLabel: '80% keluarga lainnya',
      label: 'Grafik batang: lebih dari separuh mahasiswa berasal dari 20% keluarga terkaya',
    },
    detail:
      'Penelitian menunjukkan bahwa anak-anak dari keluarga dengan kondisi ekonomi lebih baik cenderung memiliki kemampuan kognitif yang lebih tinggi. Hal ini disebabkan oleh akses yang lebih baik terhadap nutrisi, stimulasi pendidikan sejak dini, bimbingan belajar, dan lingkungan yang mendukung perkembangan otak. Akibatnya, anak-anak dari keluarga mampu memiliki peluang lebih besar untuk lolos berbagai seleksi masuk Perguruan Tinggi Negeri seperti SNBP dan UTBK. Kondisi ini menciptakan ketimpangan di mana mayoritas mahasiswa PTN di Indonesia saat ini berasal dari 20% keluarga terkaya.',
  },
  {
    number: '2x',
    text: 'Anak kota punya kesempatan 2x lebih besar untuk kuliah',
    detail: null,
    chart: {
      kind: 'ratio',
      bars: [
        { name: 'Kota', value: 2 },
        { name: 'Desa', value: 1 },
      ],
      label: 'Grafik: peluang kuliah anak kota dua kali anak desa',
    },
  },
];

export const impactMetrics = [
  { number: '600+', label: 'Total Siswa Terbantu', color: 'blue' },
  { number: '84%', label: 'Berkuliah (60% di PTN)', color: 'yellow' },
  { number: '19', label: 'Siswa Diterima di Top 3 Universitas di Indonesia', color: 'green' },
  { number: '172', label: 'Siswa Program 2026/2027', color: 'dark' },
] as const;

export type ImpactMetricColor = (typeof impactMetrics)[number]['color'];

export interface MapLocation {
  id: number;
  name: string;
  region: string;
  lat: number;
  lng: number;
  type: 'bimbel' | 'roadshow';
}

// Map pins. Bimbel branches only (see the note above mapLocations in the root
// lib/data.ts): a roadshow pin can be added back as a { type: 'roadshow' } entry.
export const mapLocations: MapLocation[] = [
  { id: 1, name: 'Sakola Kembara Cililin', region: 'Bandung Barat', lat: -6.9167, lng: 107.4667, type: 'bimbel' },
  { id: 2, name: 'Sakola Kembara Bojong', region: 'Purwakarta', lat: -6.5844, lng: 107.4367, type: 'bimbel' },
  { id: 3, name: 'Sakola Kembara Bandung', region: 'Kota Bandung', lat: -6.9175, lng: 107.6191, type: 'bimbel' },
  { id: 4, name: 'Sakola Kembara Cibodas', region: 'Bandung Barat', lat: -6.7833, lng: 107.5167, type: 'bimbel' },
  { id: 5, name: 'Sakola Kembara Cirebon', region: 'Cirebon', lat: -6.7063, lng: 108.557, type: 'bimbel' },
  { id: 6, name: 'Sakola Kembara Purbalingga', region: 'Purbalingga', lat: -7.3903, lng: 109.3639, type: 'bimbel' },
  { id: 8, name: 'Sakola Kembara Cisarua', region: 'Bandung Barat', lat: -6.7833, lng: 107.55, type: 'bimbel' },
  { id: 9, name: 'Sakola Kembara Samarinda', region: 'Kalimantan Timur', lat: -0.5017, lng: 117.1536, type: 'bimbel' },
];

export const mapStats = [
  { number: '8', label: 'Bimbel Aktif' },
  { number: '3', label: 'Provinsi' },
];

export interface Testimonial {
  id: number;
  quote: string;
  name: string;
  major: string;
  university: string;
}

export const testimonials: Testimonial[] = [
  {
    id: 1,
    quote:
      'Berkat Sakola Kembara, sebagai pemuda dari daerah pedesaan dengan akses terbatas ke pendidikan, saya akhirnya mewujudkan impian saya untuk belajar di salah satu universitas terbaik di Indonesia.',
    name: 'Daffa Najwan',
    major: 'Manajemen, UGM',
    university: 'Universitas Gadjah Mada',
  },
  {
    id: 2,
    quote:
      'Di Sakola Kembara, saya belajar untuk menghargai dan mencintai diri sendiri. Para mentor tidak hanya mengajarkan pendidikan formal tetapi juga menanamkan nilai-nilai pertumbuhan pribadi.',
    name: 'Natia Nur Faza',
    major: 'Ekonomi Islam, UNPAD',
    university: 'Universitas Padjadjaran',
  },
  {
    id: 3,
    quote:
      'Di Sakola Kembara saya diberikan lebih dari sekadar ilmu, tapi juga semangat dan kepercayaan diri untuk meraih mimpi. Bertemu dengan para mentor yang luar biasa yang sangat memotivasi, bertemu dengan teman-teman yang luar biasa, yang memiliki mimpi sama membuat saya juga lebih termotivasi untuk mewujudkan mimpi bersama-sama. Sakola Kembara juga memiliki lingkungan yang sangat menyenangkan dan mendukung untuk belajar, membuat saya lebih bersemangat hingga saya bisa lulus ke PTN impian saya.',
    name: 'Chintya Dwi Azizah',
    major: 'Akuntansi, IPB',
    university: 'Institut Pertanian Bogor',
  },
  {
    id: 4,
    quote:
      'Saya sangat bersyukur bisa belajar di Bimbingan Belajar Sakola Kembara. Metode pembelajaran yang inovatif dan dukungan dari para pengajar, terutama Kak Rommi, sangat membantu saya memahami materi, meningkatkan kepercayaan diri, dan mempersiapkan diri untuk dunia perkuliahan dan kerja. Saya merasa beruntung menjadi bagian dari keluarga besar Sakola Kembara yang penuh dengan orang-orang hebat!',
    name: 'Syahid Fattahul Ihsan',
    major: 'Statistika, UNPAD',
    university: 'Universitas Padjadjaran',
  },
  {
    id: 5,
    quote:
      'Di Sakola Kembara saya belajar banyak hal yang tidak saya dapatkan di tempat lainnya. Bertemu dengan mentor-mentor hebat dan teman-teman yang selalu memiliki semangat belajar yang tinggi, membuat saya terus termotivasi untuk mengejar perguruan impian saya. Karena Sakola Kembara, saya menjadi sadar akan ketimpangan pendidikan di Indonesia, oleh karena itu saya turut senang bisa menjadi salah satu komponen yang dapat membuktikan bahwa pendidikan milik semuanya.',
    name: 'Muhammad Anwar Taufik',
    major: 'Kedokteran Hewan, IPB',
    university: 'Institut Pertanian Bogor',
  },
  {
    id: 6,
    quote:
      'Selama di Sakola Kembara, aku merasa terinspirasi oleh orang-orang yang aku temui di sana. Cerita yang mereka bagikan mendorong aku untuk bermimpi lebih besar. Sakola Kembara bukan hanya tempat belajar, tapi tempat di mana aku menemukan keberanian untuk percaya pada diri sendiri.',
    name: 'Jesika Marsha Yoanika',
    major: 'FMIPA, ITB',
    university: 'Institut Teknologi Bandung',
  },
  {
    id: 7,
    quote:
      'Kalau aku nggak diterima di Sakola Kembara, mungkin aku nggak akan ketemu mentor-mentor hebat yang dengan tulus ngasih waktunya buat ngebimbing kita yang pengen masuk kuliah, juga teman-teman yang super semangat haus ilmu, selalu pengen belajar, dan taat dengan keimanan mereka.',
    name: 'Fathya Sahla Humaira',
    major: 'Manajemen, UI',
    university: 'Universitas Indonesia',
  },
];

export interface Partner {
  id: string;
  name: string;
}

/** Partners and supporters currently working with us. */
export const activePartners: Partner[] = [
  { id: 'itb', name: 'Institut Teknologi Bandung (ITB)' },
  { id: 'talents-mapping', name: 'Talents Mapping' },
  { id: 'zurich-syariah', name: 'Zurich Syariah' },
  { id: 'rumah-amal-salman', name: 'Rumah Amal Salman' },
  { id: 'itc', name: 'ITC' },
];

/** Partners and supporters we have worked with in the past. */
export const pastPartners: Partner[] = [{ id: 'salam-setara', name: 'Salam Setara' }];
