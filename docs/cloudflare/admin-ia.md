# Struktur menu admin (IA) — usulan

> **Tiket:** SAKEM-079 · **Epik:** SAKEM-074 · **Status:** usulan, menunggu persetujuan · 2026-10-12
>
> Hanya analisis dan usulan. Tidak mengubah kode, nada bahasa (`docs/context/tone-of-voice.md`), atau gaya visual (`DESIGN.md`). Dasarnya pembacaan kode `app/(admin)/admin/*`, `lib/` dan `docs/` di branch `development`; **tidak ada yang dijalankan atau diuji**. Tanda **(A)** = asumsi, bukan data pemakaian.

> **Keputusan Dzul, 2026-10-12 (SAKEM-081 dan SAKEM-082), menggantikan bagian usulan di bawah yang bertentangan:**
>
> 1. **Peran dan area.** `viewer` hanya baca dan membaca semua area kecuali Sistem. `editor` mengubah **dan melihat hanya** area yang diberikan kepadanya (`pendaftaran`, `komunikasi`, `konten`): menu area lain disembunyikan, rutenya menampilkan halaman 403, dan pembacaan API-nya ditolak (403). `super_admin` semuanya. **Sistem** (Aktivitas dan Pengaturan) hanya `super_admin`. Dashboard terbuka untuk semua peran admin; isinya dibatasi ke area yang boleh dilihat peran itu. Aturan lengkapnya ada di [`d1-schema.md`](d1-schema.md#permission-model).
> 2. **Dashboard hanya dua blok:** "Perlu perhatian" dan "Tindakan Cepat" (bagian 3.3). Pendaftar terbaru, Pesan terbaru, ringkasan konten, dan Aktivitas terakhir **dibuang** (aktivitas hanya ada di menu Sistem › Aktivitas).

## Ringkasan usulan

1. Dua belas menu tetap ada. Sidebar berubah dari daftar datar menjadi **Dashboard + 4 grup**: Pendaftaran, Komunikasi, Konten Situs, Sistem.
2. **Berkas Pendaftaran** diganti nama menjadi **Pusat Dokumen** (nama yang sudah dipakai halaman publik dan wizard) dan pindah ke grup Pendaftaran, karena memang bagian dari alur pendaftaran.
3. **Batch** dan **Pendaftar** tetap dua menu, tetapi diikat dengan tautan silang yang sudah dijanjikan dokumen tapi belum ada di kode.
4. **Dashboard** membuka dengan blok "Perlu perhatian" (pendaftar belum diputuskan, pesan belum dibaca, keadaan batch berjalan), disusul "Tindakan Cepat". Hanya dua blok itu (keputusan 2026-10-12).
5. **Sistem** (Aktivitas dan Pengaturan) hanya tampil untuk `super_admin` (keputusan 2026-10-12; usulan awal: Aktivitas untuk semua peran).
6. Temuan di luar menu: peran `viewer` di kode **tidak read-only** (bagian 1). Diputuskan: `viewer` baca saja, ditegakkan di API.

## 1. Inventaris

**Peran.** Dokumen (`docs/architecture/authentication.md`): `viewer` baca saja, `editor` boleh mengubah, `super_admin` juga mengelola Pengaturan. Kode: hanya aksi Pengaturan yang memanggil `requireSuperAdmin()`. Semua aksi lain (simpan, hapus, ubah status pendaftar, publikasi batch) memanggil `requireAdmin()`, yang menerima ketiga peran, dan sidebar serta halaman tidak menyembunyikan tombol apa pun untuk `viewer`. Jadi hari ini `viewer` bisa mengubah konten. Kolom peran per menu karena itu tidak diisi: semua menu sama, kecuali Pengaturan.

| Menu sekarang | Mengelola | Tampil di | Tugas utama | Frek. (A) | Di admin baru |
| --- | --- | --- | --- | --- | --- |
| Dashboard `/admin` | Ringkasan: 6 kartu, 4 tindakan cepat, 5 pendaftar, 5 pesan, 8 aktivitas terbaru | n/a | Cek apa yang perlu ditangani | Harian | Halaman ringkasan |
| Batch Pendaftaran | `admission_batches`: tahun (unik), jendela buka/tutup, `resultsPublishedAt` | `/portal`, `/portal/status`, CTA `/gabung-siswa`, wizard `/portal/daftar` | Buat batch, ubah jadwal, publikasikan atau batalkan hasil | Tahunan, ramai saat musim | Daftar + detail (status, panel publikasi) + editor |
| Pendaftar | `student_applications` + catatan tinjau | `/portal/status` (vonis baru terlihat setelah publikasi) | Saring batch/status, baca profil, ubah status, cabut penerimaan | Musiman | Daftar berfilter + detail (baca + panel tinjau) |
| Pesan | `contact_messages` dari `/kontak` (Kerjasama, Donasi, Lainnya) | Masuk dari `/kontak` | Baca, tandai belum dibaca, balas via email (mailto), hapus | Mingguan | Daftar (kotak masuk) + detail |
| Pengumuman | `announcements`: tingkat (info/peringatan/mendesak), jadwal, CTA, aktif | Strip di semua halaman publik | Buat, jadwalkan, aktif/nonaktif, hapus | Musiman | Daftar + editor |
| Laporan | `reports`: PDF ≤ 20 MB, 4 kategori, tahun | `/laporan` | Unggah, ubah metadata, hapus | Tahunan | Daftar + editor |
| Blog | Berkas markdown `content/blog/*.md` + gambar | `/blog` | Tulis, sunting, unggah gambar, hapus | Mingguan | Daftar + editor (terbesar: 2 tab, pratinjau) |
| Tim | `team_members`: bio, riwayat, foto, urutan | `/tim` | Tambah, ubah, atur urutan, hapus | Jarang | Daftar + editor |
| Berkas Pendaftaran | `site_resources`: 5 kategori; file ≤ 25 MB, link, atau teks | `/gabung-siswa/docs` ("Pusat Dokumen & Berkas"), ditautkan wizard `/portal/daftar` | Tambah, ubah, urutkan, hapus | Musiman (sebelum batch dibuka) | Daftar + editor |
| Shortlink | `shortlinks`: slug, tujuan, aktif, jumlah klik | `sakolakembara.org/<slug>` | Buat, ubah tujuan, nonaktifkan, salin | Kadang | Daftar + editor |
| Aktivitas `/admin/audit` | `audit_log`, hanya baca | n/a | Cari siapa mengubah apa; filter aksi, pelaku, tipe, tanggal | Jarang | Daftar berfilter (50 per halaman) |
| Pengaturan | Akun admin di `users`: peran, kata sandi | n/a | Tambah admin, ubah peran, hapus. Hanya `super_admin`; peran lain melihat daftar read-only | Jarang | Daftar + editor, `super_admin` |

Frekuensi adalah dugaan dari sifat tugasnya (batch tahunan, tinjauan musiman, dst.); belum ada data pemakaian.

## 2. Masalah struktur sekarang

Semua poin berasal dari kode atau dokumen yang dirujuk.

1. **Daftar datar 12 item** (`_sidebar.tsx`). Urutannya kebetulan mirip kelompok, tapi tanpa judul: dua menu operasi pendaftaran, satu kotak masuk, enam menu isi situs publik, dan dua menu sistem sejajar.
2. **Batch dan Pendaftar adalah satu alur yang terbelah.** Detail batch sudah memuat hitungan status dan tabel pendaftar (100 teratas), sementara daftar Pendaftar punya filter batch: dua tampilan hampir sama. `docs/architecture/admission-batches.md` menjanjikan tautan "pendaftar menunggu keputusan" (`?batch=&status=pending`) dari detail batch dan tautan kembali ke batch dari detail pendaftar. Di kode keduanya tidak ada: detail batch hanya punya "Lihat semua" tanpa status, dan detail pendaftar tidak menyebut batch sama sekali; tautan kembalinya ke daftar tanpa filter.
3. **Hitungan "Pendaftar pending" di dashboard tidak sama dengan syarat publikasi.** Dashboard menghitung status `pending` di semua batch. Publikasi (`batches/actions.ts`) butuh `pending` dan `under_review` sama-sama nol di satu batch.
4. **"Berkas Pendaftaran" bertabrakan nama dan salah tempat.** Menu ini mengelola Pusat Dokumen publik; "Berkas Pendaftaran" hanya satu dari lima kategorinya. Detail pendaftar punya bagian bernama "Berkas Pendaftaran" dan "Berkas Marketing" (unggahan siswa), sama dengan dua kategori itu. Isinya bagian alur pendaftaran: wizard menautkannya (`_steps/intro.tsx`, `documents.tsx`, `marketing.tsx`) dan aksi simpan me-revalidate `/portal/daftar`.
5. **Laporan dan Berkas Pendaftaran: mekanisme sama (perpustakaan unduhan publik), audiens beda** (donatur dan publik vs calon siswa), dan nama tidak menunjukkannya. Fungsinya bukan duplikat, jadi tidak digabung; yang perlu dibedakan adalah pengelompokan dan nama.
6. **"Aktivitas" punya tiga nama dan deskripsi yang kurang tepat:** menu "Aktivitas", URL `/admin/audit`, dan teks panel tinjau menyebut `audit_log`. Halamannya mengaku mencatat "semua aksi yang dilakukan admin", padahal log juga memuat kejadian siswa dan publik (`application.submit`, `student.register`, `contact_message.submit`, `user.email_verified`, `user.password_reset`; `lib/audit-labels.ts`). Widget "Aktivitas terakhir" di dashboard satu-satunya yang tanpa tautan "Semua".
7. **Pengaturan tampak untuk semua peran, tapi hanya `super_admin` yang bisa memakainya;** peran lain melihat daftar admin read-only. Namanya juga menjanjikan lebih dari isinya (hanya akun admin).
8. **Dashboard dan menu kurang saling menjangkau.** Empat menu tidak muncul di dashboard: Batch (yang paling sensitif waktu), Berkas Pendaftaran, Shortlink, Pengaturan. Tindakan Cepat hanya pembuatan konten. Empat dari enam kartu (Pengumuman aktif, Artikel, Laporan, Anggota tim) hanya total, bukan hal yang perlu ditindak; "Pengumuman aktif" menghitung `active` tanpa jendela jadwal, padahal daftar pengumuman membedakan "Tampil" dan "Aktif, di luar jadwal".
9. **Peran yang didokumentasikan tidak ditegakkan** (bagian 1). Bukan soal menu, tetapi menentukan apa yang boleh dilihat dan ditekan tiap peran di struktur baru.

## 3. Usulan

### 3.1 Usulan utama (A): sidebar

```
Dashboard

PENDAFTARAN
  Batch
  Pendaftar
  Pusat Dokumen        (dulu: Berkas Pendaftaran)

KOMUNIKASI
  Pesan
  Pengumuman

KONTEN SITUS
  Blog
  Laporan
  Tim
  Shortlink

SISTEM                 (hanya super_admin)
  Aktivitas
  Pengaturan
```

- **Urutan grup mengikuti urutan kerja:** pendaftaran (paling sensitif waktu), komunikasi (masuk harian), konten, sistem. Dalam grup: menyiapkan dulu baru mengerjakan antrean (Batch, Pendaftar), dokumen pendukung terakhir; sisanya menurut frekuensi dugaan (A).
- **Pusat Dokumen di Pendaftaran** (masalah 4). Nama ini sudah dipakai halaman publik dan wizard, dan menghilangkan tabrakan dengan bagian "Berkas Pendaftaran" di detail pendaftar.
- **Pengumuman di Komunikasi** (searah contoh di tiket): satu-satunya konten yang punya jadwal dan kedaluwarsa; sifatnya mengabari orang, bukan arsip.
- **Label dalam grup tidak mengulang nama grup:** "Batch" (judul halamannya tetap "Batch Pendaftaran"). Label lain tidak berubah, termasuk "Blog", "Shortlink", "Dashboard".
- Judul grup selalu terlihat, tidak bisa dilipat: 11 item cukup muat. Di laci mobile strukturnya sama.
- *Opsional:* lencana jumlah di **Pendaftar** (pending + dalam review) dan **Pesan** (belum dibaca), dari hitungan yang sudah ada di dashboard.

### 3.2 Peran: grup yang tampak dan halaman awal

*Diputuskan 2026-10-12 (menggantikan usulan awal, yang memberi `viewer` dan `editor` grup yang sama):*

| Peran | Grup yang tampak | Halaman awal | Beda isi |
| --- | --- | --- | --- |
| `viewer` | Dashboard, Pendaftaran, Komunikasi, Konten Situs (tanpa Sistem) | Dashboard | Hanya baca: tanpa tombol buat/ubah/hapus dan tanpa Tindakan Cepat |
| `editor` | Dashboard, ditambah **hanya** grup yang areanya diberikan kepadanya (`pendaftaran` = Pendaftaran, `komunikasi` = Komunikasi, `konten` = Konten Situs) | Dashboard | Semua tombol ubah di grup miliknya; grup lain tidak tampak, rutenya 403, API-nya menolak membaca. Editor tanpa area hanya punya Dashboard |
| `super_admin` | Semua, termasuk Sistem (Aktivitas, Pengaturan) | Dashboard | Sama dengan `editor` di semua area, plus kelola admin dan log aktivitas |

Halaman awal sama untuk ketiganya (Dashboard) karena Dashboard tidak punya area: isinya yang dibatasi ke area yang boleh dilihat peran itu (bagian 3.3). Area adalah satuan izin editor; peran tidak bertambah (jawaban atas pertanyaan 2: grup menjadi satuan izin lewat `admin_area_grants`, tanpa peran baru).

### 3.3 Dashboard: hanya Perlu perhatian dan Tindakan Cepat

*Diputuskan 2026-10-12; usulan awal punya lima blok, yang tiga di antaranya dibuang (lihat akhir bagian ini).* Dashboard terbuka untuk semua peran admin, tetapi **setiap item hanya muncul bila peran itu boleh melihat areanya**: item pendaftar dan batch milik area Pendaftaran, item pesan milik area Komunikasi, dan Konten Situs tidak punya item. Dua blok, urutan dari atas:

1. **Perlu perhatian.** Tiap item punya hitungan (atau keadaan) dan tautan ke daftar yang sudah terfilter (`GET /api/dashboard`, kontraknya di `cf/admin/spa/src/lib/dashboard.ts`):

   | Item | Area | Isi | Menaut ke |
   | --- | --- | --- | --- |
   | Pendaftar pending | `pendaftaran` | jumlah `pending` di semua batch | `/applications?status=pending` |
   | Pendaftar dalam review | `pendaftaran` | jumlah `under_review` di semua batch | `/applications?status=under_review` |
   | Pesan belum dibaca | `komunikasi` | pesan tanpa `read_at` | `/messages?filter=unread` |
   | Batch | `pendaftaran` | satu batch dan keadaannya: "Dibuka …", "Buka sampai …", "Menunggu keputusan: N belum diputuskan", "Siap dipublikasikan", atau "Hasil dipublikasikan" | `/batches/<id>` |

   Keadaan batch dihitung server (jam peramban tidak dipakai): jendela buka-tutup sama dengan daftar batch (kedua ujung termasuk), lalu setelah tutup: sudah dipublikasikan, masih ada pendaftar yang belum diputuskan (`pending` + `under_review` di batch itu), atau semuanya sudah diputuskan dan siap dipublikasikan. Bila ada lebih dari satu batch yang relevan, yang ditampilkan satu saja, dipilih dari tiga batch terbaru menurut tanggal buka: batch yang menunggu keputusan atau publikasi dulu (itu yang butuh orang), lalu yang sedang buka, lalu yang belum buka (yang paling dekat), lalu yang sudah dipublikasikan (yang terbaru). Batch tua di luar tiga terbaru tidak dilihat.

   Isi jawabannya hanya hitungan, tanggal batch, dan tautan: tidak ada nama, email, nomor telepon, isi pesan, atau nama batch. Editor Konten saja (atau editor tanpa area) mendapat `attention` kosong; dashboard lalu menampilkan "Tidak ada yang perlu ditindaklanjuti saat ini.", kalimat yang sama bila semua hitungan nol dan tidak ada batch.

   Biaya (Workers Free dan D1 Free): paling banyak tiga pernyataan, satu per item (pendaftar menurut batch dan status, pesan belum dibaca, tiga batch terbaru), dalam satu perjalanan ke D1; pernyataan untuk area yang tidak boleh dilihat peran itu tidak dijalankan sama sekali. Semuanya memakai indeks yang sudah ada, tanpa migrasi; jumlah baris yang dibaca mengikuti yang menunggu (sekitar dua baris per pendaftar yang belum diputuskan, satu per pesan belum dibaca, tiga batch), bukan riwayat sekolah. Jawabannya `Cache-Control: no-store`.
2. **Tindakan Cepat** (empat tombol yang ada: Tulis artikel, Buat pengumuman, Unggah laporan, Tambah anggota tim). Tidak berasal dari API: SPA menyaringnya dari `areas.writable` di `GET /api/me`, jadi `viewer` tidak mendapat satu pun, editor hanya yang areanya diberikan kepadanya (Konten: tiga tombol, Komunikasi: satu, Pendaftaran saja: tidak ada), dan `super_admin` keempatnya. Tombol tampil juga saat data blok pertama masih dimuat atau gagal.

**Dibuang dari usulan awal (keputusan 2026-10-12):** Pendaftar terbaru, Pesan terbaru, ringkasan konten (Pengumuman aktif, Artikel, Laporan, Anggota tim) dan **Aktivitas terakhir**. Aktivitas hanya ada di menu Sistem › Aktivitas (hanya `super_admin`).

### 3.4 Pintasan dan tautan silang

| Dari | Ke | Catatan |
| --- | --- | --- |
| Dashboard › Perlu perhatian | Pendaftar / Pesan / Batch, sudah terfilter | Parameter filter yang ada dipertahankan sebagai tautan dalam |
| Daftar Batch, tiap baris | `Pendaftar?batch=<id>&status=pending` | Tampilkan hitungan belum diputuskan per batch |
| Detail Batch, ubin hitungan status | Pendaftar terfilter | Ubin jadi tautan. Tabel 100 pendaftar diganti 5 terbaru + "Lihat semua" (pertanyaan 7) |
| Detail Pendaftar | Batch induknya; "kembali" membawa filter sebelumnya | Yang sudah dijanjikan `admission-batches.md` |
| Detail Pendaftar | Judul bagian "Berkas Pendaftaran" dan "Berkas Marketing" diganti (mis. "Berkas yang diunggah") | Hanya teks, agar tidak sama dengan menu Pusat Dokumen (pertanyaan 3) |
| Daftar Blog, Pengumuman, Shortlink | "Lihat di situs" | Laporan, Tim, dan Berkas sudah punya |
| Aktivitas, baris `site_resource` | Halaman ubah berkas | Sekarang hanya ke daftar (`auditHref`); aksi lain sudah ke halaman ubah |
| *Opsional:* editor Pengumuman, kolom URL CTA | Pilih dari Shortlink yang ada | Fitur kecil baru; boleh ditunda |

### 3.5 Pengaturan dan jejak audit

Keduanya di **Sistem**, di bawah semua pekerjaan harian, karena menjawab "siapa dan apa yang terjadi" tentang admin itu sendiri.

- **Aktivitas:** hanya baca. **Diputuskan 2026-10-12: hanya `super_admin`** (usulan awal: semua peran, pertanyaan 5; log memuat catatan tinjau dan nama serta email pengirim pesan). Satu nama dipakai di mana-mana, deskripsinya dikoreksi menjadi catatan aksi admin **dan** kejadian sistem (pendaftaran siswa, pesan masuk, verifikasi email, reset kata sandi). Rujukan `audit_log` di teks panel tinjau diganti kata biasa. Ringkasan aktivitas tidak tampil di Dashboard.
- **Pengaturan:** hanya `super_admin`; disembunyikan dari peran lain (hari ini mereka melihat daftar read-only; pertanyaan 4). Nama menu tetap, subjudul tetap "Kelola admin yang dapat mengakses dashboard".

### 3.6 Alternatif (B): contoh di tiket, apa adanya

```
Dashboard
PENDAFTARAN   Batch, Pendaftar
KOMUNIKASI    Pesan, Pengumuman
KONTEN        Blog, Laporan, Tim, Berkas Pendaftaran, Shortlink
SISTEM        Aktivitas, Pengaturan
```

| | A (utama) | B (contoh tiket) |
| --- | --- | --- |
| Pusat Dokumen / Berkas | Di Pendaftaran, sejalan dengan wizard; nama baru menghapus tabrakan | Di Konten bersama 4 menu lain; nama lama dan tabrakan tetap |
| Ukuran grup | 3 / 2 / 4 / 2 | 2 / 2 / 5 / 2 |
| Perubahan nama | 1 (Pusat Dokumen) + label pendek "Batch" | 0 |
| Risiko | Satu menu pindah dari tempat yang dihafal admin sekarang | Grup "Konten" campuran: untuk calon siswa, donatur, dan pengunjung umum sekaligus |
| Pilih bila | Pemilik produk setuju berkas dianggap bagian alur pendaftaran | Ingin perubahan sekecil mungkin dan mudah dijelaskan |

Tidak diambil: menggabung Batch dan Pendaftar jadi satu menu (menyalahi "semua menu tetap" dan mengubur tombol publikasi); tiga grup menurut audiens (grup tengah berisi 6 item, jadi daftar datar versi kecil).

### 3.7 Peta situs (A)

Path hanya acuan dari rute lama; path final diputuskan di tiket SPA.

```
Dashboard  /admin                                     semua peran
│
├─ PENDAFTARAN
│  ├─ Batch            /batches
│  │  ├─ Batch baru    /batches/new
│  │  └─ Detail batch  /batches/:id     status · publikasi hasil · ubah data
│  ├─ Pendaftar        /applications?batch=&status=
│  │  └─ Detail        /applications/:id   profil · ubah status · tautan ke batch
│  └─ Pusat Dokumen    /resources
│     └─ Baru / Ubah   /resources/new, /resources/:id/edit
│
├─ KOMUNIKASI
│  ├─ Pesan            /messages?filter=
│  │  └─ Detail        /messages/:id
│  └─ Pengumuman       /announcements
│     └─ Baru / Ubah   /announcements/new, /announcements/:id/edit
│
├─ KONTEN SITUS
│  ├─ Blog             /blog        (+ /new, /:id/edit)
│  ├─ Laporan          /reports     (+ /new, /:id/edit)
│  ├─ Tim              /team        (+ /new, /:id/edit)
│  └─ Shortlink        /shortlinks  (+ /new, /:id/edit)
│
└─ SISTEM
   ├─ Aktivitas        /audit?action=&actor=&resource=&from=&to=&page=
   └─ Pengaturan       /settings    (+ /new, /:id/edit)        super_admin
```

## 4. Peta lama → baru

Tidak ada yang hilang. Dua hal berpindah tempat, bukan hilang: data tabel pendaftar di detail batch (tersedia lewat Pendaftar terfilter) dan kartu total di dashboard (jadi baris Ringkasan konten).

| Sekarang | Di admin baru |
| --- | --- |
| `/admin` Dashboard | Dashboard; 6 kartu → "Perlu perhatian" (hitungan dan batch, per area yang boleh dilihat peran); Tindakan Cepat tetap. Pendaftar terbaru, Pesan terbaru, ringkasan konten dan Aktivitas terakhir **dibuang** (keputusan 2026-10-12) |
| `/admin/batches`, `/new`, `/[id]` | Pendaftaran › Batch (daftar, baru, detail + panel publikasi) |
| `/admin/applications`, `/[id]` | Pendaftaran › Pendaftar (daftar berfilter, detail + panel tinjau) |
| `/admin/resources`, `/new`, `/[id]/edit` | Pendaftaran › Pusat Dokumen |
| `/admin/messages`, `/[id]` | Komunikasi › Pesan |
| `/admin/announcements`, `/new`, `/[id]/edit` | Komunikasi › Pengumuman |
| `/admin/blog`, `/new`, `/[id]/edit` | Konten Situs › Blog (unggah gambar tetap di editor) |
| `/admin/reports`, `/new`, `/[id]/edit` | Konten Situs › Laporan |
| `/admin/team`, `/new`, `/[id]/edit` | Konten Situs › Tim (unggah foto tetap di editor) |
| `/admin/shortlinks`, `/new`, `/[id]/edit` | Konten Situs › Shortlink |
| `/admin/audit` | Sistem › Aktivitas |
| `/admin/settings`, `/new`, `/[id]/edit` | Sistem › Pengaturan (`super_admin`) |
| Sidebar bawah: email + Keluar | Tetap |

## 5. Pertanyaan terbuka

Keputusan yang tidak bisa diambil dari kode. Rekomendasi ada di tiap butir.

1. **Peran.** Apakah `viewer` memang harus baca saja, seperti dokumen? Rekomendasi: ya, ditegakkan di API baru. Efeknya ke struktur: tombol ubah dan Tindakan Cepat disembunyikan untuk `viewer`. *Diputuskan: ya.*
2. **Pembagian pekerjaan.** Apakah ada orang yang hanya mengurus pendaftaran atau hanya konten? Kalau ya, grup bisa jadi satuan izin (butuh peran baru, di luar tiket ini). Rekomendasi: belum. *Diputuskan (SAKEM-081/082): editor diberi area (`pendaftaran`, `komunikasi`, `konten`) dan hanya melihat serta mengubah area itu; tidak ada peran baru.*
3. **Nama dan tempat Pusat Dokumen.** Setuju "Berkas Pendaftaran" diganti "Pusat Dokumen" dan pindah ke Pendaftaran? Kalau tidak, pakai alternatif B.
4. **Pengaturan.** Nama tetap, atau diganti (mis. "Admin")? Dan boleh disembunyikan dari `editor` dan `viewer`, yang hari ini bisa melihat daftar admin beserta waktu login terakhir? Rekomendasi: nama tetap, disembunyikan. *Diputuskan: disembunyikan dari selain `super_admin`.*
5. **Aktivitas untuk `viewer` dan `editor`.** Log memuat catatan tinjau dan, pada penghapusan pesan, nama dan email pengirim. Tetap terlihat semua peran seperti sekarang, atau dibatasi? *Diputuskan: dibatasi, hanya `super_admin` (Sistem).*
6. **Pengumuman.** Di Komunikasi atau Konten Situs? Rekomendasi: Komunikasi. Kalau ternyata hampir selalu dipakai untuk kabar pendaftaran, bisa pindah ke Pendaftaran.
7. **Detail batch.** Tabel 100 pendaftar diganti 5 terbaru + tautan terfilter? Rekomendasi: ya, agar daftar pendaftar hanya punya satu tempat.
8. **Pendaftar.** Daftar default ke batch terbaru (bukan "Semua batch"), dan hitungan perhatian = `pending` + `under_review`? Rekomendasi: ya untuk keduanya.
9. **Pola pemakaian nyata.** Kolom frekuensi di bagian 1 hanya dugaan. Minta satu atau dua admin menandai menu yang dipakai tiap minggu sebelum urutan dalam grup dikunci.

## 6. Catatan portabilitas

Yang **bertahan** adalah aturan bisnis; yang **dibangun ulang** adalah UI dan perekat Next.js (server action, `revalidatePath`/`revalidateTag`, `redirect` dengan `?error=`, `requireAdmin`).

| Menu | Bertahan (logika bisnis) | Dibangun ulang |
| --- | --- | --- |
| Dashboard | Definisi hitungan (pending, dalam review, belum dibaca) dan keadaan batch | Kartu, `GET /api/dashboard` (tiga query berindeks, lihat 3.3) |
| Batch | Tahun unik dan 2024–2100; `closesAt` setelah `opensAt`; syarat publikasi (ada pendaftar, `pending` = 0, `under_review` = 0); publikasi/pembatalan = isi/kosongkan `resultsPublishedAt`; turunan status batch; janji privasi (siswa melihat vonis hanya setelah publikasi) | Form, tabel, pembersihan cache portal setelah publikasi |
| Pendaftar | Alur `pending → under_review → accepted / rejected`; catatan wajib saat terima/tolak; pencabutan (`accepted → rejected`) butuh alasan ≥ 20 karakter dan aksi audit `application.revoke`; bentuk `form_data` v2 | Tampilan profil, panel tinjau; daftar 50 teratas tanpa paginasi perlu paginasi di API |
| Pesan | Tandai dibaca saat dibuka (idempoten), tandai belum dibaca, hapus + audit | Daftar, filter, tautan balas via email |
| Pengumuman | Tampil bila `active` **dan** dalam jendela jadwal; judul 3–200, isi 5–500; label CTA dan URL berpasangan; akhir tidak sebelum awal | Strip publik harus membaca dari API atau cache baru, dengan invalidasi saat disimpan |
| Laporan | PDF saja, ≤ 20 MB; 4 kategori; tahun `2025` atau `2025/2026` | Unggah file: sekarang ke `public/` di disk |
| Blog | Batas isian (excerpt 20–500, isi 50–80.000), kategori tetap, gambar ≤ 5 MB (jpg, png, webp, gif, avif) | **Penyimpanan:** artikel sekarang berkas markdown di disk, tidak ada di Workers. Keputusan penyimpanan perlu diambil di tiket data/API; editor 2 tab + pratinjau |
| Tim | 3 kategori; bio ≤ 4000; riwayat ≤ 20 entri per jenis; urutan 0–9999; foto ≤ 5 MB | Unggah foto (kini ke `public/`), editor riwayat |
| Pusat Dokumen | 5 kategori dan urutannya; tipe file ≤ 25 MB / link / teks ≤ 10.000; hapus file fisik saat diganti atau dihapus; jangkar `#kategori` yang dipakai wizard adalah kontrak ke halaman publik | Unggah file, editor |
| Shortlink | `validateSlug`, `validateTarget`, `RESERVED_SLUGS`; redirect 307; nonaktif = 404; hitung klik best-effort; slug unik di DB | Resolver publik di akar situs. `RESERVED_SLUGS` harus disinkronkan dengan rute situs publik yang baru |
| Aktivitas | Daftar aksi dan label (`lib/audit-labels.ts` dipakai apa adanya); append-only; penulisan best-effort tidak boleh menggagalkan aksi; filter | Halaman, tabel Postgres → D1, `auditHref` ke rute baru |
| Pengaturan | Hanya `super_admin`; tidak boleh menghapus diri sendiri; tidak boleh menurunkan atau menghapus `super_admin` terakhir; email unik huruf kecil; kata sandi ≥ 8 (`lib/admin-users-service.ts`) | Hash bcrypt → Better Auth; form |

Lintas menu:

- **Peran dan penegakannya** (pertanyaan 1) harus ditetapkan sebelum API ditulis; sekarang ia hanya hidup di `requireAdmin()`.
- **Audit:** setiap mutasi mencatat aksi, jenis sumber, dan id; kebiasaan ini pindah sebagai middleware atau helper di Hono.
- **Filter di URL** (`batch`, `status`, `filter`, `category`, `q`, `action`, `actor`, `resource`, `from`, `to`, `page`) dipertahankan sebagai parameter di SPA, supaya tautan dari dashboard dan baris aktivitas tetap berfungsi.
- **Pesan flash** lewat `?created=1` / `?error=…` diganti notifikasi di SPA.
- **Semua unggahan file** (laporan, blog, tim, dokumen) bergantung pada keputusan penyimpanan di atas.
