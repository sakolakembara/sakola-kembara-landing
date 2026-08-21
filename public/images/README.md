# Foto situs — panduan penggantian

Semua file di folder ini dirujuk dari kode. **Untuk mengganti sebuah foto:
timpa file-nya dengan nama yang persis sama.** Tidak ada kode yang perlu
diubah — cukup `git add` file barunya.

**Hampir semua foto milik repo diimpor secara statis** (di `lib/data.ts`,
`components/Navbar.tsx`, `components/Footer.tsx`,
`app/(portal)/portal/_nav.tsx`, dan `app/(public)/donasi/page.tsx`).
Artinya Next menyajikannya lewat URL ber-hash isi, misalnya
`/_next/static/media/pembinaan.0awviabgyc7ek.jpg`. Begitu isi file berubah,
hash-nya ikut berubah, jadi cache browser maupun cache image optimizer
otomatis terlewati. **Tidak perlu hapus cache apa pun.**

Pengecualiannya ada tiga, semuanya karena daftarnya tidak diketahui saat build:

| Folder | Kenapa bukan impor statis | Perlindungan cache |
| --- | --- | --- |
| `program/galeri/` | Dibaca dinamis dari disk saat request (`lib/gallery.ts`) | Ada — URL diberi `?v=<ukuran+mtime>`, berubah tiap file diedit |
| `team/` | Diunggah lewat `/admin/team` saat runtime | Tidak ada |
| `../blog/images/` | Ikut konten markdown hasil migrasi WordPress | Tidak ada |

Untuk dua baris terakhir: kalau file diganti dengan nama sama dan tampilan
lama masih muncul, hapus cache image optimizer.

```bash
rm -rf .next/dev/cache/images   # dev
rm -rf .next/cache/images       # produksi
```

Penyebabnya: URL-nya tidak berubah, sedangkan `images.minimumCacheTTL`
bawaan Next 16 adalah 14400 detik (4 jam). Gejala khasnya aneh — foto baru
muncul di layar kecil tapi tidak di layar besar, karena tiap lebar layar
mengambil varian `w=` yang berbeda dan hanya sebagian yang basi.

## Beranda (`/`)

| File | Dipakai di | Ukuran anjuran | Status |
| --- | --- | --- | --- |
| `hero-team.png` | Hero — foto besar di kanan | 1304×965 (4:3) | asli |
| `program/prapembinaan.jpg` | Kartu "Roadshow & Seleksi" di seksi *Apa saja yang dilalui penerima manfaat* | 1200×800 (3:2) | asli |
| `program/pembinaan.jpg` | Kartu "Pembelajaran Intensif" di seksi yang sama | 1200×800 (3:2) | asli |
| `program/pasca-pembinaan.jpg` | Kartu "Alumni & Beasiswa" di seksi yang sama | 1200×800 (3:2) | asli |
| `testimoni/daffa-najwan.jpg` | Kartu testimoni di seksi *Dampak* | 600×800 (3:4, potret) | **PLACEHOLDER** |
| `testimoni/natia-nur-faza.jpg` | Kartu testimoni di seksi *Dampak* | 600×800 (3:4, potret) | **PLACEHOLDER** |
| `testimoni/chintya-dwi-azizah.jpg` | Kartu testimoni di seksi *Dampak* | 600×800 (3:4, potret) | **PLACEHOLDER** |
| `testimoni/syahid-fattahul-ihsan.jpg` | Kartu testimoni di seksi *Dampak* | 600×800 (3:4, potret) | **PLACEHOLDER** |
| `testimoni/muhammad-anwar-taufik.jpg` | Kartu testimoni di seksi *Dampak* | 600×800 (3:4, potret) | **PLACEHOLDER** |
| `testimoni/jesika-marsha-yoanika.jpg` | Kartu testimoni di seksi *Dampak* | 600×800 (3:4, potret) | **PLACEHOLDER** |
| `testimoni/fathya-sahla-humaira.jpg` | Kartu testimoni di seksi *Dampak* | 600×800 (3:4, potret) | **PLACEHOLDER** |

Ketiga foto program juga muncul sebagai gambar header di halaman detail
`/program/prapembinaan`, `/program/pembinaan`, `/program/pasca-pembinaan`.

## Galeri program (`/program/<id>`, seksi *Galeri Foto*)

**Ini satu-satunya folder yang dibaca otomatis.** Taruh file bernomor di
folder program yang sesuai, lalu muat ulang halaman — tidak ada kode yang
perlu disentuh, tidak ada daftar yang perlu diperbarui.

```
public/images/program/galeri/prapembinaan/     <- 1.jpg ... 3.jpg (PLACEHOLDER)
public/images/program/galeri/pembinaan/        <- 1.jpg ... 6.jpg (PLACEHOLDER)
public/images/program/galeri/pasca-pembinaan/  <- 1.jpg ... 3.jpg (PLACEHOLDER)
```

Aturannya:

- **Penamaan**: `1.jpg`, `2.jpg`, `3.jpg`, dan seterusnya. Menambah foto ke-7
  cukup dengan menyimpan `7.jpg` di folder yang sama.
- **Urutan**: menurut angka, jadi `2.jpg` tetap sebelum `10.jpg`. Nama
  non-angka tetap tampil, diurutkan alfabetis setelah yang bernomor.
- **Format**: `.jpg`, `.jpeg`, `.png`, `.webp`, atau `.avif`.
- **Ukuran anjuran**: 1200×900 (4:3). Ditampilkan `object-cover` dalam grid
  `aspect-[4/3]`, jadi rasio lain akan terpotong di sisi-sisinya.
- **Folder kosong atau belum ada**: seksi ini menampilkan teks
  "Galeri foto akan ditambahkan". Tidak error.
- **Jumlah foto bebas**, tidak harus sama antar program. Grid-nya 2 kolom di
  ponsel dan 3 kolom mulai `md`.

Logikanya ada di `lib/gallery.ts`.

## Halaman program (`/program/pembinaan`)

| File | Dipakai di | Ukuran anjuran | Status |
| --- | --- | --- | --- |
| `program/kbm-pekanan.jpg` | Thumbnail kegiatan "KBM Pekanan" | 1200×800 (3:2) | asli |
| `program/asrama-akhir-tahun.jpg` | Thumbnail "Asrama Akhir Tahun" | 1200×800 (3:2) | asli |
| `program/asrama-intensif.jpg` | Thumbnail "Asrama Intensif" | 1200×800 (3:2) | asli |
| `program/mentoring.jpg` | Thumbnail "Mentoring" | 1200×800 (3:2) | asli |

## Logo partner (beranda, seksi *Partner Kami*)

Semuanya masih **PLACEHOLDER** — kotak putih bergaris putus-putus bertuliskan
nama partner. Ukuran anjuran **400×200 (2:1)**, PNG dengan latar transparan.
Logo dirender `object-contain` di dalam kartu 160×80, jadi rasio bebas asal
tidak terlalu tinggi.

| File | Partner | Kelompok |
| --- | --- | --- |
| `partners/itb.png` | Institut Teknologi Bandung (ITB) | Aktif |
| `partners/talents-mapping.png` | Talents Mapping | Aktif |
| `partners/zurich-syariah.png` | Zurich Syariah | Aktif |
| `partners/rumah-amal-salman.png` | Rumah Amal Salman | Aktif |
| `partners/itc.png` | ITC | Aktif |
| `partners/salam-setara.png` | Salam Setara | Pernah bermitra |

Daftar dan pengelompokannya diatur di `lib/data.ts` — `activePartners` dan
`pastPartners`. Menambah partner baru: taruh logo di `partners/`, tambahkan
satu baris impor + satu entri di salah satu array.

## Lain-lain

| File | Dipakai di | Catatan |
| --- | --- | --- |
| `logo-sakola-kembara.png` | Navbar, footer, nav portal | — |
| `qris-sakola-kembara.png` | Halaman donasi (tampil + tombol unduh) | Ganti bila QRIS diperbarui. Wajib ada — impor statis, build gagal kalau file dihapus |
| `team/` | Foto pengurus di `/tim` | Diunggah lewat `/admin/team`, bukan manual. Bukan impor statis |

## Tips saat mengganti

- Pertahankan **nama file dan ekstensinya**. Kalau foto asli `.png` sedangkan
  placeholder `.jpg`, konversi dulu ke `.jpg` (atau ubah impor di `lib/data.ts`).
  Khusus galeri, ekstensi bebas karena dibaca dinamis.
- Potong ke rasio yang tertera. Gambar dirender dengan `object-cover`, jadi
  rasio yang meleset akan terpotong di sisi-sisinya.
- Jaga ukuran file di bawah ±300 KB supaya halaman tetap ringan. Next.js
  otomatis mengecilkan dan mengonversi ke WebP saat penyajian.
- Foto potret (testimoni) sebaiknya wajah berada di sepertiga bagian atas —
  di layar kecil bingkainya menjadi lanskap dan bagian bawah terpotong.

## Membuat ulang placeholder

```bash
node scripts/generate-image-placeholders.mjs            # aman: file yang sudah ada dilewati
node scripts/generate-image-placeholders.mjs --force     # menimpa SEMUA, termasuk foto asli
```

Tanpa `--force`, script melewati file yang sudah ada, jadi foto asli tidak
akan tertimpa. Daftar file dan labelnya ada di dalam script tersebut.
