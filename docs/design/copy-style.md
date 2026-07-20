# Copy Style (UI Microcopy)

For overall voice and full canonical examples, see [`docs/context/tone-of-voice.md`](../context/tone-of-voice.md). This doc covers the smaller UI-microcopy patterns that should stay consistent across components.

## Headline structure

- **Hero H1** (homepage + every sub-page): a single sentence, **Lora serif**, sentence case. May contain one phrase emphasized in `text-primary-blue` (homepage) or no emphasis (sub-pages). No terminal punctuation on serif H1s except when an exclamation is dramatically warranted (the current set doesn't use any).
  - Examples: *"Membuka Pintu Pendidikan Tinggi untuk Setiap Anak Indonesia"*, *"Dukung Perjalanan Mereka"*, *"Mari Bergerak Bersama"*, *"Pahlawan di Balik Sakola Kembara"*.

- **Section H2**: Lora serif, 2–6 words, formal Indonesian noun phrase or short statement. No terminal punctuation.
  - Examples: *"Mengapa Kami Ada?"* (one exception that ends `?`), *"Tiga Tahap Pembinaan"*, *"Pencapaian Sakola Kembara"*, *"Bersama Mewujudkan Perubahan"*, *"Jadilah Bagian dari Perubahan"*, *"Cerita & Inspirasi"*, *"Transparansi & Akuntabilitas"*.

- **Card H3**: Plus Jakarta Sans, bold, 2–5 words.
  - Examples: *"Roadshow & Seleksi"*, *"Pembelajaran Intensif"*, *"Alumni & Beasiswa"*, *"Menjadi Donatur"*, *"Kurikulum Khusus"*, *"Mentoring Intensif"*.

- **Compact H3 inside grouped sections** (e.g. "Cara Berdonasi", "Peta Penyebaran Sakola Kembara"): Plus Jakarta Sans, bold, sentence case.

## Eyebrow phrasing

Short uppercase phrases that frame the section. 2–4 words, formal Indonesian (or accepted short English label).

Existing set:

> *Pendidikan Untuk Semua · Program Kami · Dampak Kami · Partner Kami · Bergabung Bersama Kami · Tim Kami · Hubungi Kami · Blog · Artikel Terbaru · Semua Artikel · Sebelumnya · Selanjutnya · Legenda*

Render via the eyebrow JSX pattern (yellow dot + uppercase tracked text). See `components-and-layout.md`.

## Body paragraphs

- Indonesian, EYD-correct.
- Full sentences. No bullet-list fragments inside paragraph blocks.
- 1–3 short paragraphs per section.
- Inline emphasis: `<strong>` is fine for natural emphasis. For stat numbers, wrap in a colored span — `<span className="text-secondary-yellow">2 kali lebih besar</span>` — matching `ProblemSection`'s pattern.
- Avoid em-dashes; use commas or sentence breaks (the current copy doesn't use em-dashes — keep it that way).
- "Anda" is the default donor-facing pronoun; "kamu" is acceptable on student-facing surfaces (`/gabung-siswa`).

## CTAs / button labels

- 2–3 word formal imperatives. Indonesian.
- Verb + object pattern: *Donasi Sekarang*, *Dukung Misi Kami*, *Lihat Program Kami*, *Daftar Sekarang*, *Hubungi Kami*, *Konfirmasi Donasi*, *Salin No Rekening*, *Download QR*.
- Volunteer CTAs use *Menjadi X* / *Gabung X*: *Menjadi Relawan*, *Gabung Tim*, *Bergabung Menjadi Relawan*.
- "Sekarang" suffix is allowed for primary action emphasis (*Donasi Sekarang*, *Daftar Sekarang*, *Daftar Gratis Sekarang*).
- The header CTA stays at 2 words: **Donasi Sekarang**.

**Don't**
- *Klik di sini*
- *Yuk*, *Ayo*
- *Sign Up*, *Learn More* (mixed-language)
- *Daftar yuk*, *Cek sekarang*
- Emoji in button labels

## Form labels & helper text

- **Labels**: 1–2 words, Title Case Indonesian. *Nama Lengkap*, *Email*, *Subjek*, *Pesan*.
- **Placeholders**: example-style hints, not instructions. *Masukkan nama Anda*, *email@example.com*.
- **Helper text**: short, gentle.
- **Errors** (when implemented): factual, not chiding. *"Format email belum benar."*

## Status copy (forward-looking, when admin/student flows ship)

- **Success**: *"Pendaftaran kamu sudah kami terima. Tim akademik akan menghubungi via email."*
- **Submitted, awaiting review**: *"Pendaftaran sedang ditinjau tim akademik."*
- **Accepted (future LMS email)**: *"Selamat! Kamu diterima sebagai siswa Sakola Kembara."*
- **Rejected**: *"Terima kasih sudah mendaftar. Untuk saat ini, kami belum bisa menerima pendaftaranmu."* (Warm refusal, no jargon.)
- **Donation confirmation** (current): *"Tersalin!"* (after copying account number), *"Terima Kasih atas Donasi Anda"* (intro to confirmation form).

## Date & number formatting

- **Currency**: `Rp 50.000` — *Rp*, space, dot thousands separator (matches `donationTiers` in `lib/data.ts`).
- **Indonesian display dates**: long form (*"7 Desember 2025"*) — used in blog post cards (`article.date`).
- **ISO dates** (`2025-12-07`): used in frontmatter and `dateISO` for sorting; never shown to users directly.
- **Percentages**: `75.88%` with the `%` styled in `text-secondary-yellow` when used as a hero stat.
- **Plus/multiplier suffix**: `500+`, `2x` — the suffix character is styled yellow (`text-secondary-yellow`) when used as a hero stat or impact number.

## Inline tags

- **Category tags** (blog, program): white text on `bg-primary-blue` (or `/90`), `text-xs font-semibold`, `px-3 py-1.5 rounded-md` or `rounded-full`. Source values come from WordPress migration so they may be English (*News*, *Cerita*, *Tips*). Don't translate.
- **Phase tags** in program cards: same pattern — `bg-primary-blue text-white` pill with the phase label (*Pra Pembinaan*, *Pembinaan*, *Pasca Pembinaan*).

## Footer copy

- Tagline line under the logo: location only (*"Bandung, Jawa Barat, Indonesia"*) — short and concrete.
- Section headings: `text-sm font-bold uppercase tracking-wider text-gray-300` — *Kontak*, *Social Media*.
- Copyright uses live year via `new Date().getFullYear()` — do not hard-code.

## What never to do

- Don't translate or rewrite the canonical Hero / Problem / CTA copy for stylistic reasons. Get product sign-off and update both code + tone-of-voice doc in the same PR.
- Don't add emoji to public copy. (The current `contactInfo` emoji entries are a known placeholder, not a green light.)
- Don't introduce new English microcopy beyond the small accepted set (`Home`, `Team`, `Blog`, `Social Media`, blog category labels).
- Don't switch between sentence case and Title Case mid-section.
