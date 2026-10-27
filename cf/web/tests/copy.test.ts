import { describe, expect, it } from 'vitest';
import { branches, footerLinks, navLinks, programCards } from '~/lib/site';
import { CATEGORY_DESCRIPTION } from '~/lib/team-types';
import { readRoot, readWeb } from './helpers';

// Indonesian copy is fixed (docs/context/tone-of-voice.md): ported, never reworded.
// Each phrase must appear, whitespace-normalised, in BOTH the legacy source and the port.
const norm = (s: string) =>
  s
    .replace(/\{" "\}/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const cases: { name: string; web: string; root: string[]; phrases: string[] }[] = [
  {
    name: 'homepage hero',
    web: 'src/components/sections/HeroSection.astro',
    root: ['components/sections/HeroSection.tsx'],
    phrases: [
      // SAKEM-111 ("Opsi C") drops the eyebrow and the photo's alt, and sets the headline in two lines.
      'Membuka Pintu',
      'Pendidikan Tinggi',
      'untuk Setiap Anak Indonesia',
      'Kami hadir untuk mendobrak hambatan ekonomi dan geografis yang menghalangi siswa dari daerah terpencil dan keluarga kurang mampu dalam meraih impian mereka ke perguruan tinggi.',
      'Lihat Program Kami',
      'Dukung Misi Kami',
    ],
  },
  {
    name: 'homepage Program Kami',
    web: 'src/components/sections/ActivitiesSection.astro',
    root: ['components/sections/ActivitiesSection.tsx'],
    phrases: [
      'Apa saja yang dilalui penerima manfaat Sakola Kembara?',
      'Program pembinaan komprehensif dari penjangkauan siswa hingga pendampingan alumni untuk memastikan keberhasilan jangka panjang.',
      'Lihat Detail',
    ],
  },
  {
    name: 'footer',
    web: 'src/components/Footer.astro',
    root: ['components/layout/footer.tsx'],
    phrases: [
      'Yayasan Sakola Kembara berkomitmen untuk memberikan kesempatan pendidikan yang setara kepada seluruh anak Indonesia.',
      'Bandung, Jawa Barat, Indonesia',
      'Jelajahi',
      'contact@sakolakembara.org',
      'Social Media',
      'Yayasan Sakola Kembara Indonesia. All rights reserved.',
    ],
  },
  {
    name: 'navbar',
    web: 'src/components/Navbar.astro',
    root: ['components/layout/navbar.tsx', 'components/layout/auth-nav-button.tsx'],
    phrases: ['Buka menu', 'Tutup menu', 'Masuk', '/api/announcements/current'],
  },
  {
    // SAKEM-103: the auth-aware button is a script of its own, rendered only while the portal is switched on.
    name: 'navbar session button',
    web: 'src/components/NavbarSession.astro',
    root: ['components/layout/auth-nav-button.tsx'],
    phrases: ['Portal', 'Dashboard'],
  },
  {
    name: 'skip link',
    web: 'src/layouts/Base.astro',
    root: ['app/(public)/layout.tsx'],
    phrases: ['Lewat ke konten utama', '#konten-utama'],
  },
  {
    name: '/tim',
    web: 'src/pages/tim.astro',
    root: ['app/(public)/tim/_tim-content.tsx', 'app/(public)/tim/layout.tsx'],
    phrases: [
      'Pahlawan di Balik Sakola Kembara',
      'Didukung oleh pengurus dan relawan dari berbagai universitas terbaik di Indonesia yang berkomitmen untuk pendidikan yang setara.',
      'Profil tim akan segera tampil di sini.',
      'Ingin Bergabung dengan Tim?',
      'Kami selalu mencari relawan yang bersemangat untuk berkontribusi dalam membuka akses pendidikan bagi siswa Indonesia. Terbuka juga untuk kerja sama lembaga dan bentuk dukungan lainnya.',
      'Bergabung Menjadi Relawan',
      'Hubungi Kami',
      'Riwayat Pendidikan',
      'Riwayat Pekerjaan',
      'Detail profil akan segera tersedia.',
      'Pahlawan di balik Sakola Kembara — pengurus dan relawan dari berbagai universitas terbaik Indonesia yang berkomitmen membuka akses pendidikan tinggi bagi siswa kurang mampu.',
    ],
  },
  {
    name: '/blog',
    web: 'src/pages/blog/index.astro',
    root: ['app/(public)/blog/_blog-index.tsx', 'app/(public)/blog/layout.tsx'],
    phrases: [
      'Blog & Cerita',
      'Ikuti perjalanan kami dalam membuka akses pendidikan. Cerita inspiratif, kegiatan terbaru, dan update dari Sakola Kembara.',
      'Artikel Terbaru',
      'Semua Artikel',
      'Baca Selengkapnya',
      'Sebelumnya',
      'Berikutnya',
      'Cerita dan inspirasi dari Sakola Kembara — kisah alumni, kegiatan, dan update tentang gerakan pemerataan akses pendidikan tinggi di Indonesia.',
    ],
  },
  {
    name: '/blog/[slug]',
    web: 'src/pages/blog/[slug].astro',
    root: ['app/(public)/blog/[id]/page.tsx'],
    phrases: ['Kembali ke Blog', 'Artikel Lainnya'],
  },
  {
    name: '/program/[id]',
    web: 'src/pages/program/[id].astro',
    root: ['app/(public)/program/[id]/_program-content.tsx'],
    phrases: [
      'Program Kami',
      'Apa saja yang dilalui penerima manfaat Sakola Kembara?',
      'Tahapan program',
      'Tahap',
      'Kegiatan',
      'Timeline Kegiatan',
      'Jadwal dan timeline kegiatan akan segera diperbarui.',
      'Konten timeline akan ditambahkan',
      'Galeri Foto',
      'Dokumentasi kegiatan program',
      'Tahap berikutnya',
      'Lanjut ke Tahap',
      'Ingin Tahu Lebih Lanjut?',
      'Download PitchDeck kami untuk informasi lengkap tentang program, dampak, dan cara berkontribusi.',
      'Download PitchDeck',
      '/files/pitchdeck-sakola-kembara.pdf',
      '(PDF)',
    ],
  },
  {
    name: '/donasi',
    web: 'src/pages/donasi.astro',
    root: ['app/(public)/donasi/page.tsx', 'app/(public)/donasi/layout.tsx'],
    phrases: [
      'Dukung Perjalanan Mereka',
      'Setiap donasi Anda membantu siswa dari keluarga kurang mampu untuk mewujudkan impian mereka masuk perguruan tinggi.',
      'Cara Berdonasi',
      'Pilih salah satu metode di bawah ini. Donasi dengan nominal berapa pun sangat berarti bagi mereka.',
      'Scan QRIS',
      'QRIS Sakola Kembara',
      'GoPay, OVO, DANA, ShopeePay',
      ', atau m-banking.',
      'Download QR',
      'qris-sakola-kembara.png',
      'Transfer Bank',
      'Bank Muamalat',
      'Kode Bank',
      '147',
      'Nomor Rekening',
      '1010 141 940',
      '1010141940',
      'Atas Nama',
      'Sakola Kembara Indonesia',
      'Salin No Rekening',
      'Tersalin!',
      'Terima Kasih atas Donasi Anda',
      'Setelah berdonasi, mohon konfirmasikan melalui formulir berikut agar donasi Anda dapat kami catat dengan baik.',
      'Konfirmasi Donasi',
      'https://docs.google.com/forms/d/e/1FAIpQLSe0wQUmreIspbu75JpHYpuHHYbgVi4FaROcfNTiTvgchCywdQ/viewform',
      'Kontak Kami',
      'Ada pertanyaan seputar donasi, penyaluran dana, atau laporan penggunaannya? Tim kami siap membantu.',
      'Hubungi Kami',
      '/kontak',
      'Dukung pendidikan setara untuk anak Indonesia. Donasi via QRIS atau transfer bank ke Sakola Kembara. Setiap kontribusi membuka pintu perguruan tinggi bagi siswa dari keluarga kurang mampu.',
    ],
  },
  {
    // SAKEM-105: the page /laporan is the Laporan section of /donasi. Every string it had is in the section, the old hero's title and
    // lead as the section's own; the page's <title> and meta description left with the page (the section is not a page), and the
    // text of the failure panel was never in the legacy app (it is a Worker-side state), so it is pinned in tests/public-pages.test.ts.
    name: 'the Laporan section of /donasi (was /laporan)',
    web: 'src/components/ReportsSection.astro',
    root: ['app/(public)/laporan/_laporan-content.tsx'],
    phrases: [
      'Komitmen kami untuk transparansi. Laporan tahunan, keuangan, dampak, dan donasi tersedia untuk diunduh dan dipelajari oleh donor, mitra, dan publik.',
      'Laporan akan segera tersedia',
      'Tim kami sedang menyiapkan laporan publik. Periksa kembali halaman ini dalam waktu dekat.',
      'PDF ·',
      'Unduh Laporan',
      'Punya pertanyaan tentang laporan kami?',
      'Tim kami senang membantu menjelaskan angka-angka di balik laporan ini. Hubungi kami untuk diskusi lebih lanjut.',
      'Hubungi Tim Kami',
      '/kontak',
    ],
  },
  {
    name: '/laporan labels',
    web: 'src/lib/reports.ts',
    root: ['lib/report-types.ts'],
    phrases: ['Laporan Tahunan', 'Laporan Keuangan', 'Laporan Dampak', 'Laporan Donasi', 'Tahun Ajaran ${year}', 'Tahun ${year}'],
  },
  {
    name: '/gabung-siswa',
    web: 'src/pages/gabung-siswa.astro',
    root: ['app/(public)/gabung-siswa/page.tsx', 'app/(public)/gabung-siswa/layout.tsx'],
    phrases: [
      'Open Recruitment Gen 6',
      'Wujudkan Mimpimu Bersama Sakola Kembara',
      'Bergabunglah dengan ratusan siswa lain yang berhasil menembus perguruan tinggi terbaik di Indonesia melalui program pembinaan intensif gratis dari Sakola Kembara.',
      'Daftar Sekarang',
      'Pelajari Program',
      'Pusat Dokumen',
      '/gabung-siswa/docs',
      '#manfaat',
      'Manfaat Bergabung dengan Sakola Kembara',
      'Bukan hanya bimbingan belajar. Kami menyiapkan kamu untuk sukses di perguruan tinggi dan kehidupan setelahnya.',
      'Kurikulum Khusus',
      'Belajar dengan kurikulum yang dirancang khusus, menggabungkan materi SD–SMA agar bisa dikuasai dalam satu tahun pembelajaran intensif.',
      'Mentoring Intensif',
      'Dapatkan pendampingan langsung dari mentor berpengalaman yang berasal dari berbagai universitas terbaik di Indonesia.',
      'Talents Mapping',
      'Bekerja sama dengan talentsmapping.id untuk membantu kamu memetakan bakat dan memilih jurusan yang paling sesuai.',
      'Pendampingan Beasiswa',
      'Setelah diterima di perguruan tinggi, kami dampingi proses pencarian beasiswa hingga kamu bisa memulai kuliah dengan tenang.',
      'Alur Pendaftaran',
      'Empat langkah singkat dari pendaftaran sampai kamu resmi menjadi bagian dari Sakola Kembara Gen 6.',
      'Isi Formulir Pendaftaran',
      'Lengkapi seluruh bagian formulir dengan jujur dan sesuai kenyataan.',
      'Verifikasi Berkas',
      'Tim kesiswaan akan memverifikasi data dan berkas yang kamu kirim.',
      'Wawancara Lanjutan',
      'Kandidat terpilih akan diundang untuk sesi wawancara singkat via daring.',
      'Pengumuman & Onboarding',
      'Hasil seleksi diumumkan dan siswa terpilih memulai program bersama Gen 6.',
      'Siap Bergabung dengan Sakola Kembara?',
      'Isi formulir pendaftaran sekarang.',
      'Daftar Siswa',
      'Daftarkan diri sebagai siswa Sakola Kembara. Program bimbingan belajar gratis untuk persiapan UTBK dan masuk perguruan tinggi negeri bagi siswa dari keluarga kurang mampu di daerah terpencil.',
    ],
  },
  {
    name: '/gabung-siswa/docs',
    web: 'src/pages/gabung-siswa/docs.astro',
    root: ['app/(public)/gabung-siswa/docs/page.tsx'],
    phrases: [
      'Pusat Dokumen & Berkas',
      'Kembali ke halaman informasi',
      'Semua panduan, template berkas, poster, twibbon, dan bahan lain yang perlu kamu siapkan selama proses pendaftaran ada di sini. Kalau kamu baru mulai mendaftar, buka',
      'formulir pendaftaran',
      'di tab lain agar bisa lihat berkas + isi formulir bersamaan.',
      '/gabung-siswa',
      'Kategori dokumen',
      'Dokumen akan segera tersedia',
      'Tim kami sedang menyiapkan bahan-bahan pendaftaran. Silakan cek kembali halaman ini dalam beberapa waktu ke depan.',
      'Panduan pendaftaran, template berkas, dan bahan marketing yang perlu disiapkan calon siswa Sakola Kembara.',
    ],
  },
  {
    name: '/gabung-siswa/docs card',
    web: 'src/components/ResourceCard.astro',
    root: ['app/(public)/gabung-siswa/docs/page.tsx', 'app/(public)/gabung-siswa/docs/_copy-button.tsx'],
    phrases: ['Link eksternal', 'Teks · siap disalin', 'Unduh', 'Buka', 'Salin', 'Tersalin'],
  },
  {
    name: '404',
    web: 'src/components/NotFoundPage.astro',
    root: ['app/not-found.tsx'],
    phrases: [
      '404',
      'Halaman tidak ditemukan',
      'Halaman yang Anda cari tidak ada atau sudah dipindahkan.',
      'Kembali ke Beranda',
      'Hubungi Kami',
    ],
  },
];

describe('copy parity: every phrase of the port exists verbatim in the legacy source', () => {
  for (const c of cases) {
    describe(c.name, () => {
      const web = norm(readWeb(c.web));
      const root = norm(c.root.map(readRoot).join('\n'));
      it.each(c.phrases)('%s', (phrase) => {
        expect(root, 'legacy source').toContain(phrase);
        expect(web, 'port').toContain(phrase);
      });
    });
  }
});

describe('the deliberate differences of Phase A (SAKEM-103): the registration links, and one sentence of /gabung-siswa', () => {
  // Dzul, 2026-10-15: while registration is an external form (`/daftar`), the closing section of /gabung-siswa drops its second sentence, which describes the
  // portal wizard ("progres kamu akan tersimpan otomatis di browser ini"). Nothing takes its place. It belongs back when the wizard is switched on (Phase B).
  it('the closing section of /gabung-siswa keeps its first sentence and no longer says the progress is saved in the browser; the legacy page still does', () => {
    const sentence = 'Formulir dibagi menjadi beberapa bagian dan progres kamu akan tersimpan otomatis di browser ini.';
    expect(norm(readRoot('app/(public)/gabung-siswa/page.tsx'))).toContain(`Isi formulir pendaftaran sekarang. ${sentence}`);
    const web = norm(readWeb('src/pages/gabung-siswa.astro'));
    expect(web).toContain('lead="Isi formulir pendaftaran sekarang."');
    expect(web).not.toContain(sentence);
    expect(web).not.toMatch(/tersimpan otomatis|progres kamu/);
  });


  it('the legacy pages link /portal/daftar; the port links REGISTRATION_PATH (/daftar, an admin shortlink) and names /portal/daftar nowhere', () => {
    for (const rel of ['app/(public)/gabung-siswa/page.tsx', 'app/(public)/gabung-siswa/docs/page.tsx']) expect(readRoot(rel), rel).toContain('/portal/daftar');
    for (const rel of ['src/pages/gabung-siswa.astro', 'src/pages/gabung-siswa/docs.astro']) {
      expect(readWeb(rel), rel).toContain('href={REGISTRATION_PATH}');
      expect(readWeb(rel), rel).not.toContain('/portal/daftar');
    }
  });
});

describe('the deliberate difference of SAKEM-107: the volunteer button of /tim', () => {
  // Dzul, 2026-10-18: "Bergabung Menjadi Relawan" goes to the volunteer form through `/apply`, an admin shortlink, instead of the Linktree.
  it('the legacy /tim page links the Linktree; the port links VOLUNTEER_PATH (/apply, an admin shortlink) and names the Linktree nowhere', () => {
    expect(readRoot('app/(public)/tim/_tim-content.tsx')).toContain('https://linktr.ee/JoinSakolaKembara');
    const web = readWeb('src/pages/tim.astro');
    expect(web).toContain('<Button href={VOLUNTEER_PATH} size="lg">Bergabung Menjadi Relawan</Button>');
    expect(web).not.toContain('linktr.ee');
  });
});

describe('data copied from lib/data.ts and lib/team-types.ts', () => {
  const data = norm(readRoot('lib/data.ts'));

  it('navigation labels and hrefs', () => {
    for (const l of navLinks) expect(data).toContain(`{ href: "${l.href}", label: "${l.label}" }`);
    expect(footerLinks.map((l) => l.label)).toEqual(['Team', 'Siswa', 'Donasi', 'Laporan', 'Blog', 'Kontak']);
  });

  it('SAKEM-105: the menu has five items (Laporan left it) and the footer is written out, with "Laporan" where it was but pointing at the section of /donasi', () => {
    expect(navLinks.map((l) => [l.href, l.label])).toEqual([
      ['/', 'Home'],
      ['/tim', 'Team'],
      ['/gabung-siswa', 'Siswa'],
      ['/donasi', 'Donasi'],
      ['/blog', 'Blog'],
    ]);
    expect(footerLinks.map((l) => [l.href, l.label])).toEqual([
      ['/tim', 'Team'],
      ['/gabung-siswa', 'Siswa'],
      ['/donasi', 'Donasi'],
      ['/donasi#laporan', 'Laporan'],
      ['/blog', 'Blog'],
      ['/kontak', 'Kontak'],
    ]);
    // the footer repeats the menu's destinations (but the home page, whose logo links there) and adds Laporan and Kontak: nothing else
    const menu = navLinks.filter((l) => l.href !== '/').map((l) => l.href);
    expect(footerLinks.filter((l) => !['/donasi#laporan', '/kontak'].includes(l.href)).map((l) => l.href)).toEqual(menu);
    // no link of the site points at the page that is gone
    for (const l of [...navLinks, ...footerLinks]) expect(l.href, l.label).not.toMatch(/^\/laporan/);
  });

  it('the three program cards: title, tag and every bullet', () => {
    expect(programCards.map((p) => p.id)).toEqual(['prapembinaan', 'pembinaan', 'pasca-pembinaan']);
    for (const p of programCards) {
      expect(data, p.id).toContain(`title: "${p.title}"`);
      expect(data, p.id).toContain(`tag: "${p.tag}"`);
      for (const point of p.points) expect(data, point).toContain(`"${point}"`);
    }
  });

  it('team category descriptions', () => {
    const root = norm(readRoot('app/(public)/tim/_tim-content.tsx'));
    for (const text of Object.values(CATEGORY_DESCRIPTION)) expect(root).toContain(text);
  });
});

describe('footer branches (SAKEM-111)', () => {
  const legacy = readRoot('lib/data.ts');
  const footer = readWeb('src/components/Footer.astro');
  it.each(branches.map((b) => [b.name, b.region] as const))('%s (%s) is a branch of the legacy map data', (name, region) => {
    expect(legacy).toContain(`name: "Sakola Kembara ${name}"`);
    expect(legacy).toContain(`region: "${region}"`);
  });
  it('the four branches with an account (Dzul, 2026-10-27) link to it in a new tab; the others are plain text', () => {
    expect(branches).toHaveLength(8);
    expect(Object.fromEntries(branches.filter((b) => b.instagram).map((b) => [b.name, b.instagram]))).toEqual({
      Bandung: 'sakembandung_',
      Cibodas: 'sakemcibodas',
      Bojong: 'sakembojong',
      Cirebon: 'sakolakembaracirebon',
    });
    expect(footer).toContain('href={`https://instagram.com/${branch.instagram}`}');
    expect(footer).toContain('rel="noopener noreferrer"');
    expect(footer).toMatch(/<span class="[^"]*">\{branch\.name\}<\/span>/);
  });
});
