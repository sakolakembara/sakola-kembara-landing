# Tone of Voice

> **Hard rule.** Public-facing copy is **Indonesian, formal, warm, and credible**. This is the established voice of the site and must be preserved across all future work. Do not shift to English, do not shift to casual/Gen-Z, do not shift to corporate-cold.

## The voice in one line

**Hangat tapi serius** — warm enough to be approachable to a parent in a village, serious enough to be trusted by an institutional donor.

## Pillars

| Pillar | Manifestation in copy |
| --- | --- |
| **Trust** | Concrete numbers (84%, 600+, 19 alumni di top-3 PTN), named universities |
| **Transparency** | Stats with sources; planned PDF reports linked from the Donasi page's Transparansi & Akuntabilitas block |
| **Credibility** | Full legal name (*Yayasan Sakola Kembara Indonesia*) in the footer; partner logos shown plainly |
| **Social impact** | Outcomes framed around the student's life, not the org's effort |
| **Professionalism** | Proper Indonesian (EYD), full sentences, no slang, careful punctuation |
| **Clear pathways** | Every CTA names the next step (*Donasi Sekarang*, *Lihat Program Kami*, *Daftar Gratis Sekarang*) |

## Canonical voice samples (the calibration reference)

Keep new copy consistent with these. They live in the codebase today and are the locked reference.

**Hero headline** (`HeroSection.tsx`)
> Membuka Pintu **Pendidikan Tinggi** untuk Setiap Anak Indonesia

**Hero subhead**
> Kami hadir untuk mendobrak hambatan ekonomi dan geografis yang menghalangi siswa dari daerah terpencil dan keluarga kurang mampu dalam meraih impian mereka ke perguruan tinggi.

**Problem section** (`ProblemSection.tsx` + `problemStats`)
> Hanya **3 dari 10** anak Indonesia yang memiliki akses ke pendidikan tinggi.
>
> Lebih dari setengah mahasiswa berasal dari keluarga 20% terkaya.
>
> Anak kota punya kesempatan **2x lebih besar** untuk kuliah.
>
> Kami hadir untuk **mengubah realitas ini.**

**Activities heading**
> Tiga Tahap Pembinaan
>
> Program pembinaan komprehensif dari penjangkauan siswa hingga pendampingan alumni untuk memastikan keberhasilan jangka panjang.

**Impact heading**
> Pencapaian Sakola Kembara
>
> Setiap angka di sini mewakili mimpi yang terwujud dan kehidupan yang berubah melalui pendidikan.

**Partners heading**
> Bersama Mewujudkan Perubahan

**CTA section** (revised 2026-08-21 — the previous "Ada banyak cara untuk berkontribusi…" opener was replaced because it named no mechanism and no number)
> Jadilah Bagian dari Perubahan
>
> Pintu menuju pendidikan tinggi tidak terbuka dengan sendirinya. Empat peran berikut membuat program kami terus berjalan, dan semuanya terbuka lebar untuk Anda.
>
> *Closing line:* Belum yakin peran mana yang paling sesuai? Hubungi kami, dan kami bantu mencarikannya.

The intro opens by echoing the hero's own metaphor (*Membuka Pintu Pendidikan
Tinggi*) as a plain statement of fact. The repetition of *terbuka* across the
two sentences is deliberate: the door does not open by itself, but these roles
are open.

The closing clause reads *terbuka lebar untuk Anda*, not *untuk umum*. Two
reasons, both worth preserving. *Anda* keeps the donor-facing pronoun this doc
sets as the default, and it puts the reader inside the sentence rather than
addressing a crowd. More importantly, *untuk umum* would have been inaccurate:
two of the four roles are not open to the general public — Menjadi Siswa runs a
real selection (verifikasi berkas + wawancara) aimed at students from low-income
and remote backgrounds, and Menjadi Partner is institutional. *untuk Anda* keeps
the sense of openness without promising open eligibility.

The intro deliberately carries **no cohort figure**. The Impact section already
states 600+, 84%, 172, and 19 higher up the same page, so repeating one here
only created a number that would go stale every intake year.

The four CTA card blurbs still follow the concrete-mechanism rule — each names
the program's actual span (*satu tahun, Agustus hingga April, tanpa biaya*),
what a donation funds (*kegiatan belajar pekanan, asrama, pendampingan
beasiswa*), what a volunteer actually does (*mengajar di kelas pekanan,
mendampingi asrama*), and the current footprint (*delapan cabang di tiga
provinsi*). When these change, update `CTASection.tsx` and this doc together.

Note the hedge in the donor blurb: *"dapat membantu menopang"*, not *"menopang"*.
A single Rp50.000 donation does not by itself fund a student's year, and the
Trust pillar is better served by a claim that survives scrutiny.

**Donasi hero**
> Dukung Perjalanan Mereka
>
> Setiap donasi Anda membantu siswa dari keluarga kurang mampu untuk mewujudkan impian mereka masuk perguruan tinggi.

**Kontak hero**
> Mari Bergerak Bersama
>
> Punya pertanyaan, ingin berkolaborasi, atau tertarik menjadi relawan? Kami senang mendengar dari Anda.

The pattern is clear: open with an **emotional truth or stat**, support with a **concrete mechanism**, close with a **collective verb** (*kita ciptakan*, *kami hadir*, *mari bergerak*).

One deliberate exception: the CTA section now closes with a practical offer of
help rather than a collective verb. A collective-verb close directly above four
action buttons restates what the buttons already say; pointing an undecided
reader at a human is more useful there.

## CTA verb conventions

The site uses short, action-led, formal Indonesian imperatives. Mirror these.

- **Donasi Sekarang** — donor primary CTA (header, hero, CTASection, ContactSection)
- **Dukung Misi Kami** — donor secondary CTA (Hero)
- **Lihat Program Kami** — program discovery (Hero)
- **Daftar Sekarang** / **Daftar Gratis Sekarang** — student CTA (CTASection, gabung-siswa)
- **Bergabung Menjadi Relawan** — volunteer (Tim, TeamSection)
- **Gabung Tim** — relawan short form (CTASection)
- **Hubungi Kami** — partner / general contact
- **Konfirmasi Donasi** — post-donation confirmation
- **Salin No Rekening** — bank-transfer action
- **Download QR** — QRIS action
- **Lihat Selengkapnya** / **Baca Selengkapnya** — content discovery

Avoid: *Klik di sini*, *Yuk*, *Ayo*, *Cek sekarang*, *Daftar yuk*. Mixed-language CTAs like *Sign Up*, *Learn More* are out.

## Eyebrow conventions

Eyebrows are short uppercase Indonesian (or short English where they label a header‑level meta concept) phrases that frame the section. They sit above the H2 and are rendered as **yellow dot + uppercase tracked text**:

```jsx
<div className="inline-flex items-center gap-2 text-sm font-semibold text-primary-blue uppercase tracking-wider mb-4">
  <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
  Program Kami
</div>
```

Existing set (from the live homepage and sub-pages):

> *Pendidikan Untuk Semua · Program Kami · Dampak Kami · Partner Kami · Bergabung Bersama Kami · Tim Kami · Blog · Hubungi Kami · Artikel Terbaru · Semua Artikel*

The eyebrow text color follows the surrounding section: **`text-primary-blue`** on light surfaces, **`text-secondary-yellow`** on dark/gradient surfaces (e.g. ActivitiesSection, PartnersSection, CTASection). The dot is always `bg-secondary-yellow`.

## English content policy

The site is Indonesian-first. The following English strings are accepted as-is and should **not** be Indonesianized without product sign-off:

- **Navbar labels** `Home`, `Team`, `Blog` — kept short for nav constraints.
- **Footer section labels** `Kontak`, `Social Media` — `Social Media` is the one English label tolerated.
- Tag pills sourced from blog categories: `Career`, `Education`, `News`, `Testimonials`, `Tips`, etc. — these come from the WordPress migration and are kept stable for SEO continuity.

Everything else — body copy, headings, eyebrows, CTAs, form labels — must be Indonesian.

## What never to do

- Don't translate or rewrite existing canonical copy for stylistic reasons alone. If a change is needed, get product sign-off and update both the relevant file (`lib/data.ts` or the component) and this document in the same PR.
- Don't add emoji to public copy (the existing `contactInfo` icons in `lib/data.ts` are a known placeholder that should be migrated to `lucide-react` icons; do not extend them).
- Don't switch sentence case mid-section (e.g. headlines in Title Case but eyebrows in lowercase). Eyebrows are uppercase; headlines are sentence case.
- Don't introduce English fallbacks or marketing-speak ("Empower!", "Together we rise!"). The site is plain-spoken.
- Don't replace formal *Anda* with casual *kamu* in donor-facing surfaces. *Kamu* is acceptable only in student-facing surfaces (e.g. `/gabung-siswa` benefits — "Dapatkan pendampingan", "kamu memetakan bakat") because that audience is younger.
