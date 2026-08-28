// Static data for Sakola Kembara website

// Photos are imported rather than referenced by path string on purpose.
// A static import makes Next emit a content-hashed URL, so replacing the
// file on disk changes the URL and busts every cache automatically — a
// plain "/images/..." string keeps the same URL and can be served stale
// from .next/**/cache/images for up to images.minimumCacheTTL (4h).
// Replacement workflow is unchanged: overwrite the file, same filename.
// See public/images/README.md.
import type { StaticImageData } from "next/image";
import prapembinaanPhoto from "@/public/images/program/prapembinaan.jpg";
import pembinaanPhoto from "@/public/images/program/pembinaan.jpg";
import pascaPembinaanPhoto from "@/public/images/program/pasca-pembinaan.jpg";
import daffaNajwanPhoto from "@/public/images/testimoni/daffa-najwan.jpg";
import natiaNurFazaPhoto from "@/public/images/testimoni/natia-nur-faza.jpg";
import chintyaDwiAzizahPhoto from "@/public/images/testimoni/chintya-dwi-azizah.jpg";
import syahidFattahulIhsanPhoto from "@/public/images/testimoni/syahid-fattahul-ihsan.jpg";
import muhammadAnwarTaufikPhoto from "@/public/images/testimoni/muhammad-anwar-taufik.jpg";
import jesikaMarshaYoanikaPhoto from "@/public/images/testimoni/jesika-marsha-yoanika.jpg";
import fathyaSahlaHumairaPhoto from "@/public/images/testimoni/fathya-sahla-humaira.jpg";
import kbmPekananPhoto from "@/public/images/program/kbm-pekanan.jpg";
import asramaAkhirTahunPhoto from "@/public/images/program/asrama-akhir-tahun.jpg";
import asramaIntensifPhoto from "@/public/images/program/asrama-intensif.jpg";
import mentoringPhoto from "@/public/images/program/mentoring.jpg";
import heroTeamPhoto from "@/public/images/hero-team.png";
import itbLogo from "@/public/images/partners/itb.png";
import talentsMappingLogo from "@/public/images/partners/talents-mapping.png";
import zurichSyariahLogo from "@/public/images/partners/zurich-syariah.png";
import rumahAmalSalmanLogo from "@/public/images/partners/rumah-amal-salman.png";
import itcLogo from "@/public/images/partners/itc.png";
import salamSetaraLogo from "@/public/images/partners/salam-setara.png";

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
  { number: "600+", label: "Siswa Terbantu" },
  { number: "80%", label: "Berkuliah" },
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
  /** Activity thumbnail, statically imported from public/images/program/. */
  image?: StaticImageData;
  /** Downloadable sample document. */
  attachment?: SubProgramAttachment;
}

export interface Program {
  id: string;
  title: string;
  description: string;
  points: string[];
  tag: string;
  /** Program card photo, statically imported from public/images/program/. */
  image: StaticImageData;
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
    image: prapembinaanPhoto,
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
    image: pembinaanPhoto,
    subPrograms: [
      {
        title: "KBM Pekanan",
        description: "Belajar setiap hari Sabtu dan Minggu dari Agustus hingga April.",
        hours: "290+ jam belajar setahun",
        image: kbmPekananPhoto,
      },
      {
        title: "Asrama Akhir Tahun",
        description: "Asrama selama 2 minggu saat libur semester sekolah di Desember-Januari. Proses belajar dilakukan setiap hari dari jam 8 pagi sampai 10 malam, di masing-masing cabang.",
        hours: "100 jam belajar",
        image: asramaAkhirTahunPhoto,
      },
      {
        title: "Asrama Intensif",
        description: "Asrama 1-2 bulan setelah selesai berbagai Ujian di Sekolah. Proses belajar dilakukan setiap hari dari jam 8 pagi sampai 10 malam, dipusatkan di Kota Bandung.",
        hours: "Hingga 400 jam belajar",
        image: asramaIntensifPhoto,
      },
      {
        title: "Mentoring",
        description: "Program pendampingan personal untuk mendukung perkembangan akademik dan non-akademik siswa.",
        image: mentoringPhoto,
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
    image: pascaPembinaanPhoto,
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
  { number: "600+", label: "Total Siswa Terbantu", color: "blue" },
  { number: "80%", label: "Berkuliah (71.49% di PTN)", color: "yellow" },
  { number: "13", label: "Siswa Diterima di Top 3 Universitas di Indonesia", color: "green" },
  { number: "172", label: "Siswa Program 2025/2026", color: "dark" },
];

// Map pins. Bimbel branches only — the single "Roadshow Sekolah" pin that
// used to sit here was a placeholder at an invented coordinate labelled
// "Berbagai Daerah", which a map cannot honestly represent as one point.
// The roadshow marker/legend styling is still wired up in GISMap, so a
// real roadshow location can be added back as a { type: "roadshow" } entry.
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
    image: daffaNajwanPhoto,
  },
  {
    id: 2,
    quote:
      "Di Sakola Kembara, saya belajar untuk menghargai dan mencintai diri sendiri. Para mentor tidak hanya mengajarkan pendidikan formal tetapi juga menanamkan nilai-nilai pertumbuhan pribadi.",
    name: "Natia Nur Faza",
    major: "Ekonomi Islam, UNPAD",
    university: "Universitas Padjadjaran",
    image: natiaNurFazaPhoto,
  },
  {
    id: 3,
    quote:
      "Di Sakola Kembara saya diberikan lebih dari sekadar ilmu, tapi juga semangat dan kepercayaan diri untuk meraih mimpi. Bertemu dengan para mentor yang luar biasa yang sangat memotivasi, bertemu dengan teman-teman yang luar biasa, yang memiliki mimpi sama membuat saya juga lebih termotivasi untuk mewujudkan mimpi bersama-sama. Sakola Kembara juga memiliki lingkungan yang sangat menyenangkan dan mendukung untuk belajar, membuat saya lebih bersemangat hingga saya bisa lulus ke PTN impian saya.",
    name: "Chintya Dwi Azizah",
    major: "Akuntansi, IPB",
    university: "Institut Pertanian Bogor",
    image: chintyaDwiAzizahPhoto,
  },
  {
    id: 4,
    quote:
      "Saya sangat bersyukur bisa belajar di Bimbingan Belajar Sakola Kembara. Metode pembelajaran yang inovatif dan dukungan dari para pengajar, terutama Kak Rommi, sangat membantu saya memahami materi, meningkatkan kepercayaan diri, dan mempersiapkan diri untuk dunia perkuliahan dan kerja. Saya merasa beruntung menjadi bagian dari keluarga besar Sakola Kembara yang penuh dengan orang-orang hebat!",
    name: "Syahid Fattahul Ihsan",
    major: "Statistika, UNPAD",
    university: "Universitas Padjadjaran",
    image: syahidFattahulIhsanPhoto,
  },
  {
    id: 5,
    quote:
      "Di Sakola Kembara saya belajar banyak hal yang tidak saya dapatkan di tempat lainnya. Bertemu dengan mentor-mentor hebat dan teman-teman yang selalu memiliki semangat belajar yang tinggi, membuat saya terus termotivasi untuk mengejar perguruan impian saya. Karena Sakola Kembara, saya menjadi sadar akan ketimpangan pendidikan di Indonesia, oleh karena itu saya turut senang bisa menjadi salah satu komponen yang dapat membuktikan bahwa pendidikan milik semuanya.",
    name: "Muhammad Anwar Taufik",
    major: "Kedokteran Hewan, IPB",
    university: "Institut Pertanian Bogor",
    image: muhammadAnwarTaufikPhoto,
  },
  {
    id: 6,
    quote:
      "Selama di Sakola Kembara, aku merasa terinspirasi oleh orang-orang yang aku temui di sana. Cerita yang mereka bagikan mendorong aku untuk bermimpi lebih besar. Sakola Kembara bukan hanya tempat belajar, tapi tempat di mana aku menemukan keberanian untuk percaya pada diri sendiri.",
    name: "Jesika Marsha Yoanika",
    major: "FMIPA, ITB",
    university: "Institut Teknologi Bandung",
    image: jesikaMarshaYoanikaPhoto,
  },
  {
    id: 7,
    quote:
      "Kalau aku nggak diterima di Sakola Kembara, mungkin aku nggak akan ketemu mentor-mentor hebat yang dengan tulus ngasih waktunya buat ngebimbing kita yang pengen masuk kuliah, juga teman-teman yang super semangat haus ilmu, selalu pengen belajar, dan taat dengan keimanan mereka.",
    name: "Fathya Sahla Humaira",
    major: "Manajemen, UI",
    university: "Universitas Indonesia",
    image: fathyaSahlaHumairaPhoto,
  },
];

export interface Partner {
  id: string;
  name: string;
  /** Logo, statically imported from public/images/partners/. */
  logo: StaticImageData;
}

/** Partners and supporters currently working with us. */
export const activePartners: Partner[] = [
  { id: "itb", name: "Institut Teknologi Bandung (ITB)", logo: itbLogo },
  { id: "talents-mapping", name: "Talents Mapping", logo: talentsMappingLogo },
  { id: "zurich-syariah", name: "Zurich Syariah", logo: zurichSyariahLogo },
  { id: "rumah-amal-salman", name: "Rumah Amal Salman", logo: rumahAmalSalmanLogo },
  { id: "itc", name: "ITC", logo: itcLogo },
];

/** Partners and supporters we have worked with in the past. */
export const pastPartners: Partner[] = [
  { id: "salam-setara", name: "Salam Setara", logo: salamSetaraLogo },
];

// Keep for backward compatibility with anything reading the flat list.
export const partners: Partner[] = [...activePartners, ...pastPartners];

// Hero section images
export const heroImages = {
  main: heroTeamPhoto,
};

export const donationTiers = [
  { id: 1, name: "Bronze", amount: "Rp50.000" },
  { id: 2, name: "Silver", amount: "Rp100.000" },
  { id: 3, name: "Gold", amount: "Rp200.000" },
  { id: 4, name: "Custom", amount: "Nominal Lain" },
];

export const contactInfo = [
  { title: "Email", value: "hello@sakolakembara.org" },
  { title: "WhatsApp", value: "+62 812 3456 7890" },
  { title: "Lokasi", value: "Bandung, Jawa Barat, Indonesia" },
];
