// Static data for Sakola Kembara website

export const navLinks = [
  { href: "/", label: "Home" },
  { href: "/tim", label: "Team" },
  { href: "/gabung-siswa", label: "Siswa" },
  { href: "/donasi", label: "Donasi" },
  { href: "/laporan", label: "Laporan" },
  { href: "/blog", label: "Blog" },
  { href: "/kontak", label: "Kontak" },
];

export const heroStats = [
  { number: "500+", label: "Siswa Terbantu" },
  { number: "75.88%", label: "Berkuliah" },
  { number: "7", label: "Wilayah Jangkauan" },
];

export const problemStats = [
  {
    number: "3/10",
    text: "Hanya 3 dari 10 anak Indonesia yang memiliki akses ke pendidikan tinggi",
    detail: null,
  },
  {
    number: "50%+",
    text: "Lebih dari setengah mahasiswa berasal dari keluarga 20% terkaya",
    detail: "Penelitian menunjukkan bahwa anak-anak dari keluarga dengan kondisi ekonomi lebih baik cenderung memiliki kemampuan kognitif yang lebih tinggi. Hal ini disebabkan oleh akses yang lebih baik terhadap nutrisi, stimulasi pendidikan sejak dini, bimbingan belajar, dan lingkungan yang mendukung perkembangan otak. Akibatnya, anak-anak dari keluarga mampu memiliki peluang lebih besar untuk lolos berbagai seleksi masuk Perguruan Tinggi Negeri seperti SNBP dan UTBK. Kondisi ini menciptakan ketimpangan di mana mayoritas mahasiswa PTN di Indonesia saat ini berasal dari 20% keluarga terkaya.",
  },
  {
    number: "2x",
    text: "Anak kota punya kesempatan 2x lebih besar untuk kuliah",
    detail: null,
  },
];

export interface SubProgramAttachment {
  /** Link label shown on the button. */
  label: string;
  /** File under public/ — replace the file, keep the name, no code change. */
  href: string;
}

export interface SubProgram {
  title: string;
  description: string;
  /** Contact hours, rendered as a badge on the activity card. */
  hours?: string;
  /** Activity thumbnail under public/images/program/. */
  image?: string;
  /** Downloadable sample document. */
  attachment?: SubProgramAttachment;
}

export interface Program {
  id: string;
  title: string;
  description: string;
  points: string[];
  tag: string;
  image: string;
  subPrograms: SubProgram[];
}

export const programs: Program[] = [
  {
    id: "prapembinaan",
    title: "Roadshow & Seleksi",
    description:
      "Menjangkau dan menyeleksi siswa-siswa berpotensi dari berbagai daerah melalui roadshow ke sekolah dan proses seleksi berbasis motivasi.",
    points: [
      "Menjangkau siswa berpotensi dari berbagai daerah",
      "Roadshow ke sekolah di wilayah terpencil",
      "Seleksi berbasis motivasi dan potensi belajar",
    ],
    tag: "Pra Pembinaan",
    image: "https://images.unsplash.com/photo-1577896851231-70ef18881754?w=600&h=400&fit=crop",
    subPrograms: [
      {
        title: "Roadshow ke Sekolah",
        description: "Kunjungan langsung ke sekolah-sekolah di daerah-daerah sekitar cabang Sakola Kembara tentang pentingnya Perguruan Tinggi dan memberikan harapan bahwa kuliah dapat diakses karena ketersediaan berbagai beasiswa.",
      },
      {
        title: "Seleksi Siswa",
        description: "Seleksi berbasis surat motivasi dan wawancara untuk mencari siswa yang paling semangat dan berkomitmen tinggi, bukan yang paling pintar. Hal ini didasari karena kecerdasan dipengaruhi kemampuan ekonomi.",
      },
    ],
  },
  {
    id: "pembinaan",
    title: "Pembelajaran Intensif",
    description:
      "Program pembelajaran intensif selama satu tahun dengan kurikulum khusus, mentoring, dan berbagai kegiatan pendukung untuk mempersiapkan siswa menghadapi UTBK.",
    points: [
      "Kurikulum khusus selama 1 tahun (Agu–Apr)",
      "Mentoring personal dan persiapan UTBK",
      "Asrama intensif menjelang seleksi PTN",
    ],
    tag: "Pembinaan",
    image: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=600&h=400&fit=crop",
    subPrograms: [
      {
        title: "KBM Pekanan",
        description: "Belajar setiap hari Sabtu dan Minggu dari Agustus hingga April.",
        hours: "290+ jam belajar setahun",
        image: "/images/program/kbm-pekanan.jpg",
      },
      {
        title: "Asrama Akhir Tahun",
        description: "Asrama selama 2 minggu saat libur semester sekolah di Desember-Januari. Proses belajar dilakukan setiap hari dari jam 8 pagi sampai 10 malam, di masing-masing cabang.",
        hours: "100 jam belajar",
        image: "/images/program/asrama-akhir-tahun.jpg",
      },
      {
        title: "Asrama Intensif",
        description: "Asrama 1-2 bulan setelah selesai berbagai Ujian di Sekolah. Proses belajar dilakukan setiap hari dari jam 8 pagi sampai 10 malam, dipusatkan di Kota Bandung.",
        hours: "Hingga 400 jam belajar",
        image: "/images/program/asrama-intensif.jpg",
      },
      {
        title: "Mentoring",
        description: "Program pendampingan personal untuk mendukung perkembangan akademik dan non-akademik siswa.",
        image: "/images/program/mentoring.jpg",
      },
      {
        title: "Talents Mapping",
        description: "Bekerjasama dengan talentsmapping.id, membantu seluruh siswa Sakola Kembara untuk memetakan bakat sehingga dapat memilih jurusan sesuai dengan bakatnya.",
        attachment: {
          label: "Contoh hasil Talents Mapping",
          href: "/files/contoh-hasil-talents-mapping.pdf",
        },
      },
      {
        title: "Kurikulum Khusus",
        description: "Kurikulum yang dirancang khusus menggabungkan materi dari SD-SMA untuk dapat dipahami dalam 1 tahun pembelajaran, menyesuaikan dengan kemampuan awal siswa.",
        attachment: {
          label: "Contoh Kurikulum Khusus",
          href: "/files/kurikulum-khusus-sakola-kembara.pdf",
        },
      },
    ],
  },
  {
    id: "pasca-pembinaan",
    title: "Alumni & Beasiswa",
    description:
      "Pendampingan berkelanjutan bagi alumni dalam pencarian beasiswa, peningkatan kapasitas, dan peluang untuk berkontribusi kembali.",
    points: [
      "Pendampingan pencarian beasiswa berkelanjutan",
      "Peningkatan kapasitas dan pengembangan diri",
      "50% alumni kembali membantu sebagai volunteer",
    ],
    tag: "Pasca Pembinaan",
    image: "https://images.unsplash.com/photo-1529070538774-1843cb3265df?w=600&h=400&fit=crop",
    subPrograms: [
      {
        title: "Pendampingan Beasiswa",
        description: "Untuk seluruh lulusan Sakola Kembara yang diterima di berbagai perguruan tinggi, kami dampingi proses pencarian beasiswanya hingga siswa tersebut bisa memulai proses perkuliahan.",
      },
      {
        title: "Peningkatan Kapasitas",
        description: "Berbagai program peningkatan kapasitas alumni Sakola Kembara guna mempersiapkan mereka untuk sukses di kampus dan di dunia pascakampus.",
      },
      {
        title: "Peluang Menjadi Relawan",
        description: "Setidaknya 50% dari siswa Sakola Kembara memutuskan untuk kembali mendukung Sakola Kembara dengan menjadi relawan atau dukungan lainnya.",
      },
    ],
  },
];

// Keep for backward compatibility
export const activities = programs;

export const impactMetrics = [
  { number: "500+", label: "Total Siswa Terbantu", color: "blue" },
  { number: "75.88%", label: "Berkuliah (71.49% di PTN)", color: "yellow" },
  { number: "13", label: "Siswa Diterima di Top 3 Universitas di Indonesia", color: "green" },
  { number: "172", label: "Siswa Program 2025/2026", color: "dark" },
];

export const mapLocations = [
  // Bimbel Aktif
  {
    id: 1,
    name: "Sakola Kembara Cililin",
    region: "Bandung Barat",
    lat: -6.9167,
    lng: 107.4667,
    type: "bimbel",
  },
  {
    id: 2,
    name: "Sakola Kembara Bojong",
    region: "Purwakarta",
    lat: -6.5844,
    lng: 107.4367,
    type: "bimbel",
  },
  {
    id: 3,
    name: "Sakola Kembara Bandung",
    region: "Kota Bandung",
    lat: -6.9175,
    lng: 107.6191,
    type: "bimbel",
  },
  {
    id: 4,
    name: "Sakola Kembara Cibodas",
    region: "Bandung Barat",
    lat: -6.7833,
    lng: 107.5167,
    type: "bimbel",
  },
  {
    id: 5,
    name: "Sakola Kembara Cirebon",
    region: "Cirebon",
    lat: -6.7063,
    lng: 108.5570,
    type: "bimbel",
  },
  {
    id: 6,
    name: "Sakola Kembara Purbalingga",
    region: "Purbalingga",
    lat: -7.3903,
    lng: 109.3639,
    type: "bimbel",
  },
  // Roadshow Sekolah
  {
    id: 7,
    name: "Roadshow Sekolah",
    region: "Berbagai Daerah",
    lat: -6.8500,
    lng: 107.5500,
    type: "roadshow",
  },
  {
    id: 8,
    name: "Sakola Kembara Cisarua",
    region: "Bandung Barat",
    lat: -6.7833,
    lng: 107.5500,
    type: "bimbel",
  },
];

export const mapStats = [
  { number: "7", label: "Bimbel Aktif" },
  { number: "3", label: "Provinsi" },
];

export const testimonials = [
  {
    id: 1,
    quote:
      "Berkat Sakola Kembara, sebagai pemuda dari daerah pedesaan dengan akses terbatas ke pendidikan, saya akhirnya mewujudkan impian saya untuk belajar di salah satu universitas terbaik di Indonesia.",
    name: "Daffa Najwan",
    major: "Manajemen, UGM",
    university: "Universitas Gadjah Mada",
    image: "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=240&h=320&fit=crop&crop=face",
  },
  {
    id: 2,
    quote:
      "Di Sakola Kembara, saya belajar untuk menghargai dan mencintai diri sendiri. Para mentor tidak hanya mengajarkan pendidikan formal tetapi juga menanamkan nilai-nilai pertumbuhan pribadi.",
    name: "Natia Nur Faza",
    major: "Ekonomi Islam, UNPAD",
    university: "Universitas Padjadjaran",
    image: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=240&h=320&fit=crop&crop=face",
  },
];

export const partners = [
  { id: 1, name: "Institut Teknologi Bandung (ITB)", logo: "https://upload.wikimedia.org/wikipedia/id/thumb/4/44/Logo_ITB_1920.svg/200px-Logo_ITB_1920.svg.png" },
  { id: 2, name: "Salam Setara", logo: null },
  { id: 3, name: "Talents Mapping", logo: null },
  { id: 4, name: "Universitas Padjadjaran", logo: null },
  { id: 5, name: "Universitas Gadjah Mada", logo: null },
];

// Hero section images
export const heroImages = {
  main: "/images/hero-team.png",
};

export const donationTiers = [
  { id: 1, name: "Bronze", amount: "Rp 50.000" },
  { id: 2, name: "Silver", amount: "Rp 100.000" },
  { id: 3, name: "Gold", amount: "Rp 200.000" },
  { id: 4, name: "Custom", amount: "Nominal Lain" },
];

export const contactInfo = [
  { title: "Email", value: "hello@sakolakembara.org" },
  { title: "WhatsApp", value: "+62 812 3456 7890" },
  { title: "Lokasi", value: "Bandung, Jawa Barat, Indonesia" },
];
