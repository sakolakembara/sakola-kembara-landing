// Static data for Sakola Kembara website

export const navLinks = [
  { href: "/", label: "Home" },
  { href: "/tim", label: "Team" },
  { href: "/gabung-siswa", label: "Siswa" },
  { href: "/donasi", label: "Donasi" },
  { href: "/blog", label: "Blog" },
  { href: "/kontak", label: "Kontak" },
];

export const heroStats = [
  { number: "500+", label: "Siswa Terbantu" },
  { number: "75.88%", label: "Berkuliah" },
  { number: "5", label: "Wilayah Jangkauan" },
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

export const programs = [
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
      },
      {
        title: "Asrama Akhir Tahun",
        description: "Asrama selama 2 minggu saat libur semester sekolah di Desember-Januari. Proses belajar dilakukan setiap hari dari jam 8 pagi sampai 10 malam, di masing-masing cabang.",
      },
      {
        title: "Asrama Intensif",
        description: "Asrama 1-2 bulan setelah selesai berbagai Ujian di Sekolah. Proses belajar dilakukan setiap hari dari jam 8 pagi sampai 10 malam, dipusatkan di Kota Bandung.",
      },
      {
        title: "Mentoring",
        description: "Program pendampingan personal untuk mendukung perkembangan akademik dan non-akademik siswa.",
      },
      {
        title: "Talents Mapping",
        description: "Bekerjasama dengan talentsmapping.id, membantu seluruh siswa Sakola Kembara untuk memetakan bakat sehingga dapat memilih jurusan sesuai dengan bakatnya.",
      },
      {
        title: "Kurikulum Khusus",
        description: "Kurikulum yang dirancang khusus menggabungkan materi dari SD-SMA untuk dapat dipahami dalam 1 tahun pembelajaran, menyesuaikan dengan kemampuan awal siswa.",
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

export const teamMembers = [
  {
    name: "Ahmad Fadillah",
    role: "Ketua Umum",
    university: "Institut Teknologi Bandung",
    image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=face",
  },
  {
    name: "Siti Nurhaliza",
    role: "Koordinator Program",
    university: "Universitas Padjadjaran",
    image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop&crop=face",
  },
  {
    name: "Rizky Pratama",
    role: "Head of Marketing",
    university: "Universitas Gadjah Mada",
    image: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop&crop=face",
  },
  {
    name: "Dewi Anggraini",
    role: "Koordinator Relawan",
    university: "Universitas Indonesia",
    image: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop&crop=face",
  },
  {
    name: "Budi Santoso",
    role: "Pengajar Matematika",
    university: "Institut Teknologi Bandung",
    image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop&crop=face",
  },
  {
    name: "Anisa Putri",
    role: "Pengajar Bahasa Inggris",
    university: "Universitas Padjadjaran",
    image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop&crop=face",
  },
  {
    name: "Farel Hidayat",
    role: "Pengajar Sains",
    university: "Institut Teknologi Bandung",
    image: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=200&h=200&fit=crop&crop=face",
  },
  {
    name: "Maya Sari",
    role: "Pengajar Penalaran",
    university: "Universitas Gadjah Mada",
    image: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&h=200&fit=crop&crop=face",
  },
];

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
  // Rencana Bimbel Baru
  {
    id: 8,
    name: "Sakola Kembara Cisarua",
    region: "Bandung Barat",
    lat: -6.7833,
    lng: 107.5500,
    type: "rencana",
  },
  {
    id: 9,
    name: "Sakola Kembara Bojonegara",
    region: "Serang",
    lat: -6.0333,
    lng: 106.1333,
    type: "rencana",
  },
];

export const mapStats = [
  { number: "6", label: "Bimbel Aktif" },
  { number: "2", label: "Rencana Bimbel Baru" },
  { number: "3", label: "Provinsi" },
  { number: "15+", label: "Sekolah Terjangkau" },
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

export const stakeholders = [
  {
    id: 1,
    title: "Untuk Donatur",
    description:
      "Laporan penggunaan dana yang transparan dan terperinci. Setiap rupiah Anda berkontribusi langsung untuk pendidikan anak Indonesia.",
    link: "Lihat Laporan Donasi",
    href: "#",
  },
  {
    id: 2,
    title: "Untuk Orang Tua Siswa",
    description:
      "Informasi lengkap tentang program, jadwal kegiatan, dan progress pembelajaran anak. Komunikasi terbuka setiap saat.",
    link: "Portal Orang Tua",
    href: "#",
  },
  {
    id: 3,
    title: "Untuk Partner",
    description:
      "Peluang kolaborasi dan kemitraan strategis untuk memperluas dampak pendidikan di Indonesia. Mari bergerak bersama.",
    link: "Jadi Partner Kami",
    href: "#",
  },
];

export const reports = [
  { id: 1, title: "Laporan Tahunan", size: "PDF • 2.4 MB" },
  { id: 2, title: "Laporan Keuangan", size: "PDF • 1.8 MB" },
  { id: 3, title: "Impact Report", size: "PDF • 3.1 MB" },
];

export const partners = [
  { id: 1, name: "Institut Teknologi Bandung (ITB)", logo: "https://upload.wikimedia.org/wikipedia/id/thumb/4/44/Logo_ITB_1920.svg/200px-Logo_ITB_1920.svg.png" },
  { id: 2, name: "Salam Setara", logo: null },
  { id: 3, name: "Talents Mapping", logo: null },
  { id: 4, name: "Universitas Padjadjaran", logo: null },
  { id: 5, name: "Universitas Gadjah Mada", logo: null },
];

export const newsArticles = [
  {
    id: 1,
    category: "Pencapaian",
    date: "15 Januari 2024",
    title: "4 Alumni Sakola Kembara Diterima di 3 Universitas Terbaik Indonesia",
    excerpt:
      "Cerita inspiratif perjalanan empat siswa dari daerah terpencil yang berhasil menembus seleksi masuk universitas top Indonesia melalui program bimbingan intensif Sakola Kembara.",
    featured: true,
    image: "https://images.unsplash.com/photo-1541339907198-e08756dedf3f?w=800&h=600&fit=crop",
  },
  {
    id: 2,
    category: "Kegiatan",
    date: "10 Januari 2024",
    title: "Roadshow Sakola Kembara di Cirebon: Menjangkau 200 Siswa",
    excerpt:
      "Tim kami mengunjungi 5 sekolah di Arjawinangun untuk memberikan motivasi dan informasi UTBK.",
    featured: false,
    image: "https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=600&h=400&fit=crop",
  },
  {
    id: 3,
    category: "Partnership",
    date: "5 Januari 2024",
    title: "Kolaborasi Baru dengan Talents Mapping untuk Pengembangan Potensi Siswa",
    excerpt:
      "Kemitraan strategis untuk membantu siswa menemukan bakat dan jurusan yang tepat.",
    featured: false,
    image: "https://images.unsplash.com/photo-1552664730-d307ca884978?w=600&h=400&fit=crop",
  },
  {
    id: 4,
    category: "Pencapaian",
    date: "28 Desember 2023",
    title: "Wisuda Angkatan 2023: 45 Siswa Siap Menuju Perguruan Tinggi",
    excerpt:
      "Momen penuh haru saat 45 siswa Sakola Kembara menyelesaikan program pembinaan dan siap menghadapi UTBK 2024.",
    featured: false,
    image: "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=600&h=400&fit=crop",
  },
  {
    id: 5,
    category: "Kegiatan",
    date: "20 Desember 2023",
    title: "Asrama Akhir Tahun: 2 Minggu Belajar Intensif di Bandung",
    excerpt:
      "Siswa dari berbagai cabang berkumpul di Bandung untuk mengikuti program asrama intensif selama libur semester.",
    featured: false,
    image: "https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?w=600&h=400&fit=crop",
  },
  {
    id: 6,
    category: "Cerita Alumni",
    date: "15 Desember 2023",
    title: "Dari Desa ke ITB: Perjalanan Inspiratif Daffa Najwan",
    excerpt:
      "Kisah Daffa, alumni Sakola Kembara yang kini berkuliah di Manajemen UGM dan aktif menjadi relawan pengajar.",
    featured: false,
    image: "https://images.unsplash.com/photo-1517486808906-6ca8b3f04846?w=600&h=400&fit=crop",
  },
  {
    id: 7,
    category: "Kegiatan",
    date: "5 Desember 2023",
    title: "Pembukaan Cabang Baru Sakola Kembara Purbalingga",
    excerpt:
      "Memperluas jangkauan ke Jawa Tengah, cabang keenam Sakola Kembara resmi dibuka di Purbalingga.",
    featured: false,
    image: "https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=600&h=400&fit=crop",
  },
  {
    id: 8,
    category: "Partnership",
    date: "25 November 2023",
    title: "ITB Mendukung Program Beasiswa untuk Alumni Sakola Kembara",
    excerpt:
      "Kerjasama dengan Institut Teknologi Bandung untuk memberikan akses beasiswa bagi alumni yang diterima di ITB.",
    featured: false,
    image: "https://images.unsplash.com/photo-1562774053-701939374585?w=600&h=400&fit=crop",
  },
  {
    id: 9,
    category: "Cerita Alumni",
    date: "15 November 2023",
    title: "Natia: Belajar Mencintai Diri Sendiri di Sakola Kembara",
    excerpt:
      "Selain akademik, Sakola Kembara juga mengajarkan nilai-nilai kehidupan yang mengubah cara pandang Natia.",
    featured: false,
    image: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=600&h=400&fit=crop",
  },
];

// Hero section images
export const heroImages = {
  main: "/images/hero-team.png",
  badge1: "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=400&h=280&fit=crop",
  badge2: "https://images.unsplash.com/photo-1529390079861-591de354faf5?w=400&h=280&fit=crop",
};

export const donationTiers = [
  { id: 1, name: "Bronze", amount: "Rp 50.000" },
  { id: 2, name: "Silver", amount: "Rp 100.000" },
  { id: 3, name: "Gold", amount: "Rp 200.000" },
  { id: 4, name: "Custom", amount: "Nominal Lain" },
];

export const contactInfo = [
  { icon: "📧", title: "Email", value: "hello@sakolakembara.org" },
  { icon: "📱", title: "WhatsApp", value: "+62 812 3456 7890" },
  { icon: "📍", title: "Lokasi", value: "Bandung, Jawa Barat, Indonesia" },
];

export const footerLinks = {
  program: [
    { label: "Pra Pembinaan", href: "/program/prapembinaan" },
    { label: "Pembinaan", href: "/program/pembinaan" },
    { label: "Pasca Pembinaan", href: "/program/pasca-pembinaan" },
  ],
  tentang: [
    { label: "Misi Kami", href: "#" },
    { label: "Tim", href: "#team" },
    { label: "Partner", href: "#partners" },
    { label: "Laporan", href: "#stakeholders" },
  ],
  terlibat: [
    { label: "Donasi", href: "/donasi" },
    { label: "Jadi Relawan", href: "#" },
    { label: "Jadi Partner", href: "#" },
    { label: "Kontak", href: "/kontak" },
  ],
};
