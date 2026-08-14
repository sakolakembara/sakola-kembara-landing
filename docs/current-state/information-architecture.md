# Information Architecture

## Current routes

Defined under `app/` (Next.js App Router):

| Route | File | Purpose |
| --- | --- | --- |
| `/` | `app/page.tsx` | Homepage — composes Navbar + 7 sections + Footer |
| `/blog` | `app/blog/page.tsx` | Blog index — featured article + grid of all posts |
| `/blog/[id]` | `app/blog/[id]/page.tsx` | Blog post detail (server component, SSG via `generateStaticParams`) |
| `/donasi` | `app/donasi/page.tsx` | QRIS + bank transfer + confirmation form + StakeholderSection |
| `/gabung-siswa` | `app/gabung-siswa/page.tsx` | Student program info + external "Daftar Gratis Sekarang" link |
| `/kontak` | `app/kontak/page.tsx` | Contact form + info + socials |
| `/program/[id]` | `app/program/[id]/page.tsx` | Per-phase program detail (Pra/Pembinaan/Pasca) — client component |
| `/tim` | `app/tim/page.tsx` | Team grid + volunteer CTA |

There is **no** `/tentang-kami`, `/siswa`, `/laporan`, or `/team`.

## Header

Source: `components/Navbar.tsx` + `navLinks` in `lib/data.ts`.

- **Position**: `fixed top-0 left-0 right-0 z-50`, `bg-white/95 backdrop-blur-md`, `border-b border-gray-100`. The navbar overlaps content; each page applies its own top padding (`pt-32` / `pt-40`) to compensate.
- **Container**: `max-w-[1200px] mx-auto px-6 py-4`.
- **Logo**: `/images/logo-sakola-kembara.png`, 40px tall, links to `/`.
- **Desktop nav** (visible from `md:`): plain links, `text-gray-600 text-[15px] font-medium hover:text-primary-blue`.
- **Right-side CTA**: **Donasi Sekarang** → `/donasi`. Pill-rounded? **No** — `rounded-lg` (8px). The button uses `bg-primary-blue text-white`, lifts `-translate-y-0.5` and adds a blue glow on hover.
- **Mobile (`< md`)**: hamburger toggle → full-width drop panel with the same items stacked + the same CTA at the bottom.

### Nav order (left → right)

1. **Home** → `/`
2. **Team** → `/tim`
3. **Siswa** → `/gabung-siswa`
4. **Donasi** → `/donasi`
5. **Blog** → `/blog`
6. **Kontak** → `/kontak`
7. **Donasi Sekarang** (right-aligned button) → `/donasi`

> Labels `Home`, `Team`, and `Blog` are intentionally English. See `context/tone-of-voice.md` "English content policy". Do not Indonesianize without product sign-off.

## Footer

Source: `components/Footer.tsx`.

- **Background**: `bg-gradient-to-b from-accent-navy to-primary-blue text-white`, under a 4px `bg-secondary-yellow` hairline. Container `max-w-[1200px] mx-auto px-6 pt-12 md:pt-16 pb-8 md:pb-10`.
- **3-column grid** on `lg:` (stacks to 2 / 1 on smaller widths):
  1. **Logo + location**: inverted logo (CSS `filter: invert(1) hue-rotate(180deg)` so the dark-blue mark reads light on dark), MapPin icon + "Bandung, Jawa Barat, Indonesia".
  2. **Kontak**: Mail icon link to `contact@sakolakembara.org`.
  3. **Social Media**: `<SocialLinks theme="dark" />` — Instagram, TikTok, X (Twitter), YouTube.
- **Bottom strip**: `border-t border-white/15`, two lines:
  - `© {new Date().getFullYear()} Sakola Kembara. All rights reserved.`
  - `Yayasan Sakola Kembara Indonesia`

The copyright year is computed live, not hard-coded.

## Homepage composition

See [`homepage-sections.md`](homepage-sections.md). Order: Hero → Problem → Activities → Impact → Partners → CTA → News.

## Page-level structure

### `/donasi`
1. Hero (gradient `from-primary-blue to-accent-navy`, white text) — "Dukung Perjalanan Mereka".
2. "Cara Berdonasi" — two cards side-by-side: **Scan QRIS** (image, download QR button) and **Transfer Bank** (Bank Muamalat details, copy-to-clipboard).
3. Two next-step CTA cards: **Konfirmasi Donasi** (Google Form) and **Ingin Bergabung?** (→ `/kontak`).
4. `<StakeholderSection />` — Transparansi & Akuntabilitas, 3 stakeholder cards + 3 report placeholders. The report cards are not real yet (placeholder PDF sizes hard-coded in `lib/data.ts`).

### `/gabung-siswa`
1. Hero — "Wujudkan Mimpimu Bersama Sakola Kembara".
2. **Manfaat Bergabung** — 4 cards (Kurikulum Khusus, Mentoring Intensif, Talents Mapping, Pendampingan Beasiswa).
3. CTA — "Tertarik Menjadi Siswa?" → external `https://sakolakembara.org/daftar`.

### `/tim`
1. Hero — "Pahlawan di Balik Sakola Kembara".
2. Team grid (8 placeholder members from `teamMembers` in `lib/data.ts`).
3. CTA — "Ingin Bergabung dengan Tim?" → `https://linktr.ee/JoinSakolaKembara`.

### `/kontak`
1. Hero — "Mari Bergerak Bersama".
2. Two-column: contact form (Nama, Email, Subjek dropdown [Kerjasama/Partnership · Seputar Donasi · Lainnya], Pesan) + contact info & socials.
3. **The form has no submit handler.** Wiring it up is on the MVP backlog.

### `/blog` and `/blog/[id]`
- Index: hero + featured article card + grid of all other posts.
- Detail: hero (post image with dark gradient + title overlay), markdown body in a card, related-posts grid.
- See [`blog-pipeline.md`](blog-pipeline.md) for how content gets there.

### `/program/[id]`
- Per-phase program page driven by `programs` in `lib/data.ts`. Dynamic route covers `prapembinaan`, `pembinaan`, `pasca-pembinaan`.
- Layout: hero image with tag pill + title, sub-programs grid, PitchDeck download CTA, timeline placeholder, gallery placeholder, prev/next navigation.

## Anchors & in-page scrolling

Sections expose `id`s that act as hash anchors. The known set:

- `#about` (on both Hero and Problem — duplicate, intentional or not)
- `#activities` (Activities section, target of Hero's "Lihat Program Kami" CTA)
- `#impact`
- `#partners`
- `#stakeholders` (StakeholderSection on `/donasi`)
- `#blog` (NewsSection)
- `#contact`, `#team`, `#join`, `#donate` (used in components that are not currently mounted on the homepage, kept for future use)

Smooth scrolling is enabled globally via `html { scroll-behavior: smooth; }` (`app/globals.css`) and `<html className="scroll-smooth">` (`app/layout.tsx`).

## Future IA changes (per MVP)

When these ship, update this doc:

- ~~Future~~ **`/laporan`** — shipped in Phase 6. Public report listing (PDFs by year). Labeled **"Laporan"** in the nav. The transparency content previously embedded inside `/donasi` (`StakeholderSection`) has been removed; its purpose is served by this page.
- **Public announcement strip** — admin-published, between Navbar and Hero, conditional render.
- **On-site student registration form** — replaces the external `https://sakolakembara.org/daftar` link from `/gabung-siswa`.
- **Working contact form submit** — wire `/kontak` to a backend (email or DB).

The decision is to **keep slugs Indonesian** (`/tim`, `/donasi`, `/kontak`, `/gabung-siswa`) for consistency; new pages should follow this convention.
