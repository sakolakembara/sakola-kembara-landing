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

### Root-level shortlinks

`app/(public)/[slug]/page.tsx` also serves the whole root namespace as
admin-managed vanity redirects — `sakolakembara.org/daftar-2026` → any target.
It only ever runs for a single-segment path that no route in the table above
and no `public/` file already claims, because Next resolves static routes
first. **Adding a top-level route means adding it to `RESERVED_SLUGS` in
`lib/shortlinks.ts`**, otherwise an admin can mint a shortlink there that
silently never fires. See [`../architecture/shortlinks.md`](../architecture/shortlinks.md).

## Header

Source: `components/Navbar.tsx` + `navLinks` in `lib/data.ts`.

- **Position**: `fixed top-0 left-0 right-0 z-50`, `bg-white/95 backdrop-blur-md`, `border-b border-gray-100`. The navbar overlaps content; each page applies its own top padding (`pt-32` / `pt-40`) to compensate.
- **Container**: `max-w-[1200px] mx-auto px-6 py-4`.
- **Logo**: `/images/logo-sakola-kembara.png`, 40px tall, links to `/`.
- **Layout** (from `md:`): a `grid-cols-[1fr_auto_1fr]` grid — logo left, menu in the middle, auth button right. The equal side columns keep the menu centred on the page, not in the leftover space between logo and button.
- **Desktop nav**: plain links, `text-gray-600 text-[15px] font-medium hover:text-primary-blue`.
- **Right side**: one outlined auth button (`components/AuthNavButton.tsx`), text only, 40px tall on desktop — **Masuk** → `/login` when signed out, **Portal** or **Dashboard** once the session resolves on the client. There is no donation button in the header; `/donasi` is reached from the menu.
- **Mobile (`< md`)**: hamburger toggle → full-width drop panel with the same items stacked + the auth button at the bottom.

### Nav order (left → right)

1. **Home** → `/`
2. **Team** → `/tim`
3. **Siswa** → `/gabung-siswa`
4. **Donasi** → `/donasi`
5. **Laporan** → `/laporan`
6. **Blog** → `/blog`

Kontak is not in the header; it lives in the footer.

> Labels `Home`, `Team`, and `Blog` are intentionally English. See `context/tone-of-voice.md` "English content policy". Do not Indonesianize without product sign-off.

## Footer

Source: `components/Footer.tsx`.

- **Background**: `bg-gradient-to-b from-accent-navy to-primary-blue text-white`, under a 4px `bg-secondary-yellow` hairline. Container `max-w-[1200px] mx-auto px-6 pt-12 md:pt-16 pb-8 md:pb-10`.
- **4-column grid** on `lg:` (first column wider; stacks to 2 / 1 on smaller widths):
  1. **Logo, description, location**: `/images/logo-sakola-kembara-light.png` — the navbar logo with its wordmark recoloured white, so the mark keeps its real colours on navy. Below it the line *"Yayasan Sakola Kembara berkomitmen untuk memberikan kesempatan pendidikan yang setara kepada seluruh anak Indonesia."*, then MapPin icon + "Bandung, Jawa Barat, Indonesia".
  2. **Jelajahi**: `footerLinks` from `lib/data.ts` — the header destinations minus Home, plus **Kontak** → `/kontak`.
  3. **Kontak**: Mail icon link to `contact@sakolakembara.org`.
  4. **Social Media**: `<SocialLinks theme="dark" />` — Instagram, TikTok, X (Twitter), YouTube.
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
- The three stages read as **one page with tabs** (SAKEM-028, layout "Opsi B"): a shared navy hero ("Program Kami" + *Apa saja yang dilalui penerima manfaat Sakola Kembara?*), then a numbered 1-2-3 stepper card that overlaps it. Each step is a **link to that stage's own URL** with `aria-current="page"` on the active one, so every stage stays server-rendered, shareable, and works with Back; homepage cards, sitemap and shortlinks keep pointing at the same URLs.
- Below the stepper: stage intro (photo + "Tahap N · tag" pill + **h1 = stage title** + description + points), *Kegiatan* grid, timeline placeholder, gallery, a "Tahap berikutnya" card with an outlined *Lanjut ke Tahap N* button (absent on the last stage), PitchDeck CTA. The old "Program Lainnya" prev/next block is gone.
- `/program` itself has no page (404).

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
