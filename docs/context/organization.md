# Organization

## Who we are

**Sakola Kembara** (legal entity: **Yayasan Sakola Kembara Indonesia**) is a non-profit organization in Indonesia focused on **equal access to higher education**.

Positioning line currently used on the site (`app/layout.tsx`):

> *"Pendidikan Untuk Semua"* — Education For All.

And the hero, from `components/sections/HeroSection.tsx`:

> *"Membuka Pintu Pendidikan Tinggi untuk Setiap Anak Indonesia."*

## What we do

We run **free university-entrance-exam preparation** for students from financially disadvantaged backgrounds, with an emphasis on remote regions of Indonesia.

The flagship program is **Bimbingan Belajar Kembara**, designed for 12th-grade students and gap-year applicants preparing for:

- **UTBK** (Ujian Tulis Berbasis Komputer, the national PTN entrance exam)
- **Ujian Mandiri** (university-specific independent entrance exams)

The program runs as a three-phase cycle, surfaced on the homepage as **"Tiga Tahap Pembinaan"** (Activities section) and as `programs` in `lib/data.ts`:

1. **Pra Pembinaan — Roadshow & Seleksi**
   - Roadshow to SMA/SMK in remote regions to motivate students and recruit applicants.
   - Selection based on motivation letter + interview (commitment is weighed more heavily than raw ability).

2. **Pembinaan — Pembelajaran Intensif** (year-long, August → April)
   - **KBM Pekanan** — every Saturday & Sunday.
   - **Asrama Akhir Tahun** — 2-week residential in December–January (school break), 8 AM – 10 PM daily, per branch.
   - **Asrama Intensif** — 1–2 month residential after school exams, centralized in Bandung.
   - **Mentoring** — 1-on-1 personal academic & non-academic accompaniment.
   - **Talents Mapping** — partnership with talentsmapping.id to map each student's aptitude before choosing a major.
   - **Kurikulum Khusus** — bespoke curriculum compressing SD–SMA material into one year.

3. **Pasca Pembinaan — Alumni & Beasiswa**
   - Scholarship-finding accompaniment until alumni actually start college.
   - Capacity-building programs for life on campus and after.
   - About **50% of alumni return as volunteers** to support the next cohort.

## Why this exists (the problem we name on the site)

Numbers used in the Problem section (`problemStats` in `lib/data.ts`, surfaced in `ProblemSection.tsx`):

- Only **3 out of 10** Indonesian children have access to higher education.
- More than **50%** of PTN students come from the wealthiest 20% economic group.
- Children in cities have **2× the chance** of attending university compared to children in villages.

The section title is **"Mengapa Kami Ada?"** and the closing emotional line is **"Kami hadir untuk mengubah realitas ini."**

## Impact line currently published

From `heroStats`, `impactMetrics`, and `mapStats` in `lib/data.ts`:

- **500+ siswa** terbantu cumulatively.
- **75.88%** of alumni continue to higher education (**71.49%** to PTN).
- **13 siswa** placed in Indonesia's top 3 universities.
- **172 siswa** in the current 2025/2026 program cohort.
- **6 bimbel aktif** across **3 provinces**, plus 2 planned branches (mapped on the homepage Leaflet map).

> **Note for editors.** These stats appear in production copy. They are not assumptions — they ship to donors. Any update must come from the program team with the source cited, then update `lib/data.ts` and this document together.

## Branches (`mapLocations` in `lib/data.ts`)

| Type | Locations |
| --- | --- |
| **Bimbel Aktif** | Cililin (Bandung Barat), Bojong (Purwakarta), Bandung, Cibodas (Bandung Barat), Cirebon, Purbalingga |
| **Roadshow** | Various sekolah across the regions above |
| **Rencana** | Cisarua (Bandung Barat), Bojonegara (Serang) |

## Programs / initiatives mentioned on the site

- **Bimbingan Belajar Kembara** (primary program — three-phase cycle above).
- **Donation tiers**: **Bronze Rp50.000**, **Silver Rp100.000**, **Gold Rp200.000**, **Custom**.
  - Correction (2026-08-21): these are **not currently rendered anywhere**. `donationTiers` in `lib/data.ts` is exported but has no consumer, and `ContactSection` no longer exists as a component. The values are kept as the agreed tier definition for whenever the Donasi page surfaces them.
- **Volunteer roles**: recruited via external Linktree (`https://linktr.ee/JoinSakolaKembara`) linked from the Tim page.

## Partners shown on the site (`partners` in `lib/data.ts`)

- Institut Teknologi Bandung (ITB)
- Salam Setara
- Talents Mapping
- Universitas Padjadjaran
- Universitas Gadjah Mada

Only ITB currently has a real logo URL; the others render as text tiles until logos are supplied.

## External links worth knowing

- **Donation confirmation form** (Google Form) — used by `app/donasi/page.tsx` after a QRIS / bank transfer:
  `https://docs.google.com/forms/d/e/1FAIpQLSe0wQUmreIspbu75JpHYpuHHYbgVi4FaROcfNTiTvgchCywdQ/viewform`
- **Volunteer signup**: `https://linktr.ee/JoinSakolaKembara` (linked from `/tim`).
- **Student registration (legacy)**: `https://sakolakembara.org/daftar` (linked from `/gabung-siswa` — to be replaced by an on-site form per MVP).
- **Bank account**: Bank Muamalat (147), **1010 141 940**, atas nama *Sakola Kembara Indonesia* — see `app/donasi/page.tsx`.
- **QRIS**: `public/images/qris-sakola-kembara.png`.
- **Email**: `contact@sakolakembara.org` (footer) / `hello@sakolakembara.org` (`contactInfo`).
- **Office**: Bandung, Jawa Barat, Indonesia.
- **Social**: Instagram, TikTok, X (Twitter), YouTube — all `@sakolakembara` (see `components/SocialLinks.tsx`).

> The legacy site lived on WordPress at `sakolakembara.org`. Blog content has been migrated into this repo as markdown under `content/blog/`; see [`current-state/blog-pipeline.md`](../current-state/blog-pipeline.md).
