# Blog content (Markdown)

Setiap artikel punya file `.md` sendiri. **Markdown = sumber utama** untuk edit; HTML di `lib/blog-posts.json` di-generate otomatis.

## Edit artikel

1. Buka `content/blog/<slug>.md`
2. Ubah frontmatter (judul, tanggal, gambar, dll.) atau isi markdown
3. Jalankan:

```bash
pnpm blog:sync
```

Frontmatter `description` (opsional): teks `<meta name="description">` untuk situs Cloudflare (`cf/web`), dipakai sebelum `excerpt`. Isinya deskripsi meta halaman WordPress-nya dulu; kosongkan jika tidak ada. Satu baris, 50 sampai 600 karakter.

## Scrape ulang dari website

```bash
pnpm scrape:blog
```

Mengambil post dari WordPress, unduh gambar ke `public/blog/images/`, tulis ulang `.md` + JSON.

## Gambar

Path lokal di markdown/HTML:

```markdown
![alt](/blog/images/2026/05/nama-file.jpg)
```

Frontmatter `image` juga pakai path yang sama untuk thumbnail.
