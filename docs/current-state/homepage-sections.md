# Homepage Sections

The homepage (`app/page.tsx`) composes **seven sections** in this order, sandwiched between `<Navbar />` and `<Footer />`. Each section is a self-contained client component under `components/sections/`.

| # | Section | File | Background | Anchor |
| --- | --- | --- | --- | --- |
| 1 | Hero | `HeroSection.tsx` | `bg-gradient-to-b from-gray-50 to-white` + soft blue radial | `#about` |
| 2 | Problem framing | `ProblemSection.tsx` | `bg-gray-900` + subtle SVG pattern | `#about` (duplicate) |
| 3 | Activities / Programs | `ActivitiesSection.tsx` | `bg-gradient-to-br from-primary-blue to-accent-navy` | `#activities` |
| 4 | Impact + Map + Testimonials | `ImpactSection.tsx` | `bg-white` | `#impact` |
| 5 | Partners | `PartnersSection.tsx` | `bg-gray-900` | `#partners` |
| 6 | CTA — Bergabung Bersama Kami | `CTASection.tsx` | `bg-gradient-to-br from-primary-blue to-accent-navy` | — |
| 7 | News (latest 3 blog posts) | `NewsSection.tsx` | `bg-white` | `#blog` |

Sections **not** mounted on the homepage but defined in `components/sections/` (kept for sub-page composition or future reintroduction): `StakeholderSection` (used on `/donasi`), `TeamSection`, `ContactSection`.

## Visual rhythm

The page alternates **light** (Hero, Impact, News) and **dark/blue** (Problem, Activities, Partners, CTA) surfaces. New sections should respect this banding — don't run two dark sections back-to-back without a visual break.

## 1. Hero (`HeroSection.tsx`)

- Two-column on `lg+`: text left, hero photo + floating badges right.
- **Eyebrow**: yellow dot + `Pendidikan Untuk Semua` (text-primary-blue, uppercase, tracked).
- **H1**: `text-4xl md:text-5xl lg:text-[56px] font-[var(--font-display)]` (Lora serif) — "Membuka Pintu **Pendidikan Tinggi** untuk Setiap Anak Indonesia". The middle phrase is `text-primary-blue`.
- **Subhead**: warm body paragraph about removing barriers.
- **CTAs (two)**: `Lihat Program Kami` (primary blue, `rounded-lg`) → `#activities` · `Dukung Misi Kami` (subtle gray) → `/donasi`.
- **Stats strip**: 3 hero stats (500+ Siswa Terbantu / 75.88% Berkuliah / 5 Wilayah Jangkauan) with the `+`/`%` suffix colored yellow.
- **Visual**: `/images/hero-team.png` in a `rounded-3xl shadow-2xl` panel, with two floating badge images (Unsplash placeholders) at top-right and bottom-left, each with a colored gradient overlay (yellow / green) + caption.

> The badge images and image-based decorations use `unoptimized` (no Next/Image optimization) because they're external CDN URLs.

## 2. Problem (`ProblemSection.tsx`)

- Dark `bg-gray-900` with a low-opacity SVG diamond pattern overlay.
- **Heading**: serif `text-3xl md:text-4xl` — **"Mengapa Kami Ada?"**.
- **3 stat cards** in a grid: yellow extruded number (`text-secondary-yellow`), gray-300 body. The middle card (the 50%+ one with `detail`) is **clickable** — it opens a framer-motion modal with the longer explanation. A small yellow "Klik untuk info lebih lanjut" hint appears under it.
- **Closing line**: `text-2xl font-semibold` — "Kami hadir untuk **mengubah realitas ini.**" with the last clause in `text-secondary-yellow`.
- The modal uses `AnimatePresence`; clicking the overlay or the "Tutup" button dismisses it.

## 3. Activities / Programs (`ActivitiesSection.tsx`)

- Gradient navy background with two large blurred orbs (white + yellow) for visual depth.
- **Eyebrow**: yellow dot + `Program Kami` (yellow text on dark).
- **H2**: white serif **"Tiga Tahap Pembinaan"**.
- **3-column grid** of `programs` from `lib/data.ts` (Pra Pembinaan, Pembinaan, Pasca Pembinaan). Each card:
  - White surface, `rounded-2xl`.
  - Image with `program.tag` pill (primary-blue) overlaid top-left.
  - Title, 3 bullet points (green dot bullets), "Lihat Detail →" footer that links to `/program/[id]`.
  - Hover: `-translate-y-2 shadow-xl`.

## 4. Impact (`ImpactSection.tsx`)

Three stacked groups inside the section:

### 4a. Impact metrics
- 4-card grid (`grid-cols-2 lg:grid-cols-4`). Each card has a per-metric gradient (`from-primary-blue`, `from-secondary-yellow`, `from-secondary-green`, `from-gray-700`), big white number, label.
- Source: `impactMetrics` in `lib/data.ts`.

### 4b. GIS Map — "Peta Penyebaran Sakola Kembara"
- `components/Map/GISMap.tsx`, dynamically imported with `ssr: false`.
- Leaflet + OpenStreetMap tiles, custom pulsing `divIcon` markers in three colors:
  - **Blue** (`#1E88E5`) — bimbel aktif
  - **Yellow** (`#F9A825`) — roadshow sekolah
  - **Gray** (`#9E9E9E`) — rencana bimbel baru
- `MapBoundsFitter` fits the view to all `mapLocations` on mount.
- Bottom-left legend overlay; bottom stats bar shows `mapStats` (6 / 2 / 3 / 15+).

### 4c. Testimonials carousel — "Cerita Sukses Alumni"
- Custom manual carousel (no Swiper). Tracks `currentSlide` via `useState`; left/right buttons + dot indicators.
- Shows **two testimonials per slide** on `md+`, wrapping around.
- Each testimonial card: portrait image left, italic quote + name + major (blue) + university chip right.
- Source: `testimonials` in `lib/data.ts`. Currently only **2 entries**, which makes the wrap-around redundant — add more entries to make the carousel meaningful.

## 5. Partners (`PartnersSection.tsx`)

- Dark `bg-gray-900`. Header + flex-wrapped partner tiles (`w-40 h-20`, white/10 background, gray text).
- Source: `partners` in `lib/data.ts`. Currently only ITB has a real logo URL; the rest render the partner name as a text label inside the tile.
- Logos themselves are not actually displayed — only `partner.name`. The `partner.logo` field is unused at present.

## 6. CTA — Bergabung Bersama Kami (`CTASection.tsx`)

- Gradient navy background, same orb decorations as Activities.
- **Eyebrow**: yellow dot + `Bergabung Bersama Kami`.
- **H2**: "Jadilah Bagian dari Perubahan".
- **4 CTA cards** (2-col grid) — each is a horizontal card with a colored icon tile + title + short blurb + a colored pill button:
  1. **Menjadi Siswa** (orange) → `/kontak` — "Daftar Sekarang"
  2. **Menjadi Donatur** (primary blue) → `/donasi` — "Donasi Sekarang"
  3. **Menjadi Relawan** (green) → `/kontak` — "Gabung Tim"
  4. **Menjadi Partner** (yellow) → `/kontak` — "Hubungi Kami"
- Bottom tagline: "Bersama-sama, kita bisa membuka lebih banyak pintu pendidikan untuk generasi masa depan Indonesia."

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
