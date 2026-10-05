# Homepage Sections

The homepage (`app/page.tsx`) composes **seven sections** in this order, sandwiched between `<Navbar />` and `<Footer />`. Each section is a self-contained client component under `components/sections/`.

| # | Section | File | Background | Anchor |
| --- | --- | --- | --- | --- |
| 1 | Hero | `HeroSection.tsx` | `bg-gradient-to-b from-gray-50 to-white` + soft blue radial | `#about` |
| 2 | Problem framing | `ProblemSection.tsx` | `bg-gradient-to-b from-primary-blue to-accent-navy` + subtle SVG pattern | `#about` (duplicate) |
| 3 | Activities / Programs | `ActivitiesSection.tsx` | `bg-gradient-to-br from-primary-blue to-accent-navy` | `#activities` |
| 4 | Impact + Map + Testimonials | `ImpactSection.tsx` | `bg-white` | `#impact` |
| 5 | Partners | `PartnersSection.tsx` | `bg-[#F5F7FA]` | `#partners` |
| 6 | CTA — Bergabung Bersama Kami | `CTASection.tsx` | `bg-gradient-to-br from-primary-blue to-accent-navy` | — |
| 7 | News (latest 3 blog posts) | `NewsSection.tsx` | `bg-white` | `#blog` |

Sections **not** mounted on the homepage but defined in `components/sections/` (kept for sub-page composition or future reintroduction): `StakeholderSection` (used on `/donasi`), `TeamSection`, `ContactSection`.

## Visual rhythm

The page alternates **light** (Hero, Impact, Partners, News) and **navy** (Problem, Activities, CTA) surfaces. New sections should respect this banding — don't run two dark sections back-to-back without a visual break.

Dark surfaces use the brand navy family (`accent-navy` → `primary-blue`), never neutral charcoal. Cold `gray-900` was the original treatment on Problem, Partners, and the footer; it read as gloomy against a brand built on warm navy and sunglow, and it was replaced everywhere on the public site. Partners in particular moved to a light surface so the page doesn't end in one long dark stretch before the footer.

## 1. Hero (`HeroSection.tsx`)

- Two-column on `lg+`: text left, hero photo right.
- **Eyebrow**: yellow dot + `Pendidikan Untuk Semua` (text-primary-blue, uppercase, tracked).
- **H1**: `text-[28px] sm:text-4xl md:text-5xl lg:text-[56px] font-bold font-[var(--font-display)]` (Lora serif, 700) — "Membuka Pintu **Pendidikan Tinggi** untuk Setiap Anak Indonesia". The middle phrase is `text-primary-blue`.
- **Subhead**: warm body paragraph about removing barriers.
- **CTAs (two)**: `Lihat Program Kami` (primary blue, `rounded-lg`) → `#activities` · `Dukung Misi Kami` (subtle gray) → `/donasi`.
- **Stats strip**: 3 hero stats (500+ Siswa Terbantu / 75.88% Berkuliah / 7 Wilayah Jangkauan) with the `+`/`%` suffix colored yellow. It is a `grid grid-cols-3`, **not** a flex row — as a flex row the three items could not shrink below their min-content width and pushed the whole document wider than a phone screen, clipping every line of hero copy.
- **Visual**: `/images/hero-team.png` alone, `aspect-[4/3]` on phones and a fixed `md:h-[450px]` panel above that. The two floating badge images that used to overhang the panel were removed — on a phone they sat on top of the photo and were clipped by the section, and they were Unsplash placeholders rather than real program photography.

## 2. Problem (`ProblemSection.tsx`)

- Navy `bg-gradient-to-b from-primary-blue to-accent-navy` with a low-opacity SVG diamond pattern overlay.
- **Heading**: serif `text-3xl md:text-4xl` — **"Mengapa Kami Ada?"**.
- **3 stat cards** in a grid: yellow extruded number (`text-secondary-yellow`), `text-white/85` body on `bg-white/10` cards. The middle card (the 50%+ one with `detail`) is **clickable** — it opens a framer-motion modal with the longer explanation. A small yellow "Klik untuk info lebih lanjut" hint appears under it.
- **Closing line**: `text-2xl font-semibold` — "Kami hadir untuk **mengubah realitas ini.**" with the last clause in `text-secondary-yellow`.
- The modal uses `AnimatePresence`; clicking the overlay or the "Tutup" button dismisses it.

## 3. Activities / Programs (`ActivitiesSection.tsx`)

- Gradient navy background with two large blurred orbs (white + yellow) for visual depth.
- **Eyebrow**: yellow dot + `Program Kami` (yellow text on dark).
- **H2**: white serif **"Apa saja yang dilalui penerima manfaat Sakola Kembara?"** — sized a step below sibling section headings (`md:text-[40px]`) with `max-w-[760px]` and `text-balance`, because the question runs seven words.
- **3-column grid** of `programs` from `lib/data.ts` (Pra Pembinaan, Pembinaan, Pasca Pembinaan). Each card:
  - White surface, `rounded-2xl`.
  - Image with `program.tag` pill (primary-blue) overlaid top-left.
  - Title, 3 bullet points (green dot bullets), filled "Lihat Detail" button at the bottom (the whole card links to `/program/[id]`).
  - Hover: `-translate-y-2 shadow-xl`.

## 4. Impact (`ImpactSection.tsx`)

Three stacked groups inside the section:

### 4a. Impact metrics
- 4-card grid (`grid-cols-2 lg:grid-cols-4`). Each card has a per-metric gradient (`from-primary-blue`, `from-secondary-yellow`, `from-secondary-green`, `from-blue-yonder`), big white number, label.
- Source: `impactMetrics` in `lib/data.ts`.

### 4b. GIS Map — "Peta Penyebaran Sakola Kembara"
- `components/Map/GISMap.tsx`, dynamically imported with `ssr: false`.
- Leaflet + OpenStreetMap tiles, custom pulsing `divIcon` markers in two colors:
  - **Blue** (`#1E88E5`) — bimbel aktif
  - **Yellow** (`#F9A825`) — roadshow sekolah
- `MapBoundsFitter` fits the view to all `mapLocations` on mount.
- Bottom-left legend overlay; bottom stats bar shows `mapStats` (7 Bimbel Aktif / 3 Provinsi) as a `grid-cols-2 sm:grid-cols-4`. It was a centered flex row, which overflowed on **both** sides inside the card's `overflow-hidden` and made the outer labels unreachable on a phone.
- The former third category, gray "rencana bimbel baru" markers, was dropped along with its legend row; Cisarua moved to `bimbel` so the pin count matches the stat.

### 4c. Testimonials carousel — "Cerita Sukses Alumni"
- Custom manual carousel (no Swiper). Tracks `currentSlide` via `useState`; left/right buttons + dot indicators.
- Shows **two testimonials per slide** on `md+` and **one** below that, wrapping around. Cards stack image-over-quote on phones — side by side, the quote column was ~110px wide.
- Each testimonial card: portrait image left, italic quote on the right with name + major (blue) + university chip bottom-anchored via `mt-auto`, so a short quote and a long one still line up across a pair.
- Source: `testimonials` in `lib/data.ts` — **7 entries** as of 2026-08-21 (2 original + 5 alumni quotes supplied by the team).
- Quote lengths range ~270–490 characters. The slide track is a flex row, so the carousel's height is set by the tallest slide and stays constant while sliding (no layout jump), at the cost of whitespace on the shorter ones. If that whitespace becomes a problem, trim the longest quote rather than adding a line-clamp — clamping would truncate a real person's words with no way to expand them.
- Alumni photos in `public/images/testimoni/` are **real** as of 2026-08-28 (dropped in at their existing filenames, so no code change was needed). They keep their natural aspect ratios rather than the 600×800 the placeholders used; the card crops with `object-cover`. See `public/images/README.md`.

## 5. Partners (`PartnersSection.tsx`)

- Light `bg-[#F5F7FA]`. Header + two subheaded groups of flex-wrapped partner tiles.
- **Split into two groups** so active relationships read apart from past ones:
  - *Partner & Pendukung Aktif* — `activePartners` in `lib/data.ts` (ITB, Talents Mapping, Zurich Syariah, Rumah Amal Salman, ITC)
  - *Pernah Didukung & Bermitra Dengan* — `pastPartners` (Salam Setara)
  - `partners` remains exported as the flat concatenation for any consumer that wants the whole list.
- Each tile is a column: logo on top (`h-11 sm:h-12`, `object-contain`), partner name below in `text-[11px] sm:text-xs`. The container uses `items-stretch` so tiles stay level when a long name wraps.
- Every `partner.logo` is a **placeholder** in `public/images/partners/` (400×200 PNG), statically imported. Drop a real logo in at the same filename to replace it — see `public/images/README.md`.
- Logo `alt` is intentionally empty: the name is adjacent visible text, so alt text would double-announce it.

## 6. CTA — Bergabung Bersama Kami (`CTASection.tsx`)

- Gradient navy background, same orb decorations as Activities.
- **Eyebrow**: yellow dot + `Bergabung Bersama Kami`.
- **H2**: "Jadilah Bagian dari Perubahan".
- **4 CTA cards** (2-col grid) — each is a **text-only** block: title + short blurb + a colored pill button, no icon and no image. The tinted Lucide icon tiles were swapped for photos and then dropped again on 2026-08-28 (no real photography available); the per-card colour now lives only in the button. The button is pinned with `mt-auto` so two cards in a row keep a common button baseline.
  1. **Menjadi Siswa** (orange) → `/gabung-siswa` — "Daftar Sekarang" (was `/kontak`; the student landing page is the correct destination)
  2. **Menjadi Donatur** (primary blue) → `/donasi` — "Donasi Sekarang"
  3. **Menjadi Relawan** (green) → `/kontak` — "Gabung Tim"
  4. **Menjadi Partner** (yellow) → `/kontak` — "Hubungi Kami"
- Bottom line: "Belum yakin peran mana yang paling sesuai? Hubungi kami, dan kami bantu mencarikannya."
- Card blurbs and the intro paragraph were rewritten 2026-08-21 to name concrete mechanisms instead of generic sentiment. The intro carries no cohort figure on purpose (Impact section already states them). See `docs/context/tone-of-voice.md`.

> The 4-card content is hard-coded inside `CTASection.tsx` (not in `lib/data.ts`). Move to `lib/data.ts` if it ever needs CMS-managed control.

## 7. News / Blog (`NewsSection.tsx`)

- White section. Header has "Blog" eyebrow + "Cerita & Inspirasi" H2 + right-aligned "Lihat Semua" link.
- Pulls **3 latest posts** via `getBlogArticlesSorted().slice(0, 3)` from `lib/blog.ts`.
- Compact card: image + category pill + date + title (line-clamp-2). Links to `/blog/[id]`.

## Motion conventions

Every section uses the same scroll-reveal recipe:

```tsx
const ref = useRef(null);
const isInView = useInView(ref, { once: true, margin: "-100px" });

<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={isInView ? { opacity: 1, y: 0 } : {}}
  transition={{ duration: 0.6, delay: 0.2 + index * 0.1 }}
>
```

Stick with this pattern. Don't introduce new motion libraries or scroll-jacking.

## Where things will change

Per `roadmap/mvp-priorities.md` and `current-state/known-gaps.md`:

- A **public announcement strip** is planned between Navbar and Hero (conditional).
- **Real impact numbers** should replace any remaining estimates once the program team supplies fresh data.
- **More testimonials** should be added to `testimonials` in `lib/data.ts` so the carousel rotates through 4+ slides.
- **Partner logos** should replace text fallbacks once supplied.
- **NewsSection** is already wired to real markdown content — no change planned, but new posts auto-appear via the blog pipeline.
