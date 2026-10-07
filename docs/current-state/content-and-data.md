# Content & Data

> This replaces the older `content-and-i18n.md`. The site does **not** use i18n. All UI copy is inline Indonesian; all structured content lives either in `lib/data.ts` (hard-coded) or in `content/blog/*.md` (generated into `lib/blog-posts.json`).

## Where copy lives

| Content | Source | Notes |
| --- | --- | --- |
| Page metadata (title, OG, Twitter) | `app/layout.tsx` (root) + per-page `Metadata` exports | Per Next.js convention |
| Headings, body copy, eyebrows, CTAs | Inline JSX inside each component | No i18n — Indonesian only |
| Navigation links | `navLinks` in `lib/data.ts` | Labels include English (`Home`, `Team`, `Blog`) by design |
| Hero stats | `heroStats` in `lib/data.ts` | 3 entries; rendered in `HeroSection.tsx` |
| Problem stats (with modal detail) | `problemStats` in `lib/data.ts` | Middle stat carries the long `detail` string for the modal |
| Programs + sub-programs | `programs` in `lib/data.ts` | Drives Activities section + `/program/[id]` |
| Program photo gallery | `public/images/program/galeri/<program-id>/` (filesystem) | Read at request time by `lib/gallery.ts`; numbered files `1.jpg`, `2.jpg`, … No code change to add photos |
| Team members | `teamMembers` in `lib/data.ts` | 8 placeholder entries with Unsplash avatars |
| Impact metrics | `impactMetrics` in `lib/data.ts` | 4 entries with `color` key matching `metricColors` in `ImpactSection.tsx` |
| Map locations + stats | `mapLocations`, `mapStats` in `lib/data.ts` | Drives the Leaflet map |
| Testimonials | `testimonials` in `lib/data.ts` | Only **2 entries** today; needs more |
| Stakeholders + reports | `stakeholders`, `reports` in `lib/data.ts` | Placeholder PDF sizes; surfaced on `/donasi` via `StakeholderSection` |
| Partners | `partners` in `lib/data.ts` | Only ITB has a real `logo`; others are text tiles |
| News articles (legacy) | `newsArticles` in `lib/data.ts` | **Legacy** — superseded by the markdown blog. Keep for reference only or remove if unused |
| Hero images | `heroImages` in `lib/data.ts` | `main` local, `badge1`/`badge2` external Unsplash |
| Donation tiers | `donationTiers` in `lib/data.ts` | Bronze / Silver / Gold / Custom |
| Contact info | `contactInfo` in `lib/data.ts` | Currently uses emoji icons — should migrate to lucide-react |
| Footer links | `footerLinks` in `lib/data.ts` | The footer's *Jelajahi* column (`components/layout/footer.tsx`) |
| CTA cards (4-up) | Inline in `components/sections/CTASection.tsx` | Move to `lib/data.ts` if it ever needs CMS control |
| Blog posts | `content/blog/<slug>.md` → `lib/blog-posts.json` via `scripts/blog-sync-from-markdown.mjs` | See [`blog-pipeline.md`](blog-pipeline.md) |
| Donasi page bank/QRIS/CTAs | Inline in `app/donasi/page.tsx` | `ACCOUNT_NUMBER`, `QRIS_IMAGE`, `CONFIRMATION_FORM_URL` constants |
| `/gabung-siswa` benefits | Inline `benefits` array in `app/gabung-siswa/page.tsx` | Move to `lib/data.ts` if reused |
| `/kontak` form fields | Inline in `app/kontak/page.tsx` | Subject options: Kerjasama/Partnership, Seputar Donasi, Lainnya |

## Editing canonical copy

The following strings are calibrated and donor-facing — get product sign-off before changing:

- Hero headline / subhead (`HeroSection.tsx`)
- Problem section stats and closing line (`ProblemSection.tsx` + `problemStats`)
- Impact metrics (`impactMetrics`)
- Donation tier amounts (`donationTiers`, `app/donasi/page.tsx` bank details)
- Footer copyright / legal name (`components/layout/footer.tsx`)
- Any text in `lib/data.ts` describing programs, partners, or impact

The following are editorially safe to refine without sign-off (still mind the tone-of-voice doc):

- Section eyebrows
- CTA button labels (within the verb conventions in `tone-of-voice.md`)
- `/gabung-siswa` benefit blurbs
- `/kontak` form helper text

## SEO copy

- Root metadata in `app/layout.tsx` provides title, description, keywords, Open Graph, and Twitter card.
- Each top-level page can override via its own `Metadata` export — currently most use the root.
- `app/blog/[id]/page.tsx` provides dynamic `generateMetadata` per post (title, description, OG image).
- **No JSON-LD** today. If we need it later, add structured data per page (Organization on `/`, Article on blog detail).
- **No sitemap or robots.txt** — add `app/sitemap.ts` and `app/robots.ts` when public crawling matters.

## Images

- **Local images**: `public/images/logo-sakola-kembara.png`, `public/images/hero-team.png`, `public/images/qris-sakola-kembara.png`.
- **Blog images**: `public/blog/images/<wp-year>/<wp-month>/...` — mirrored from WordPress by the scrape pipeline.
- **External images** (Unsplash placeholders): used for team avatars, badge photos, testimonial portraits, program images, blog fallbacks. They're rendered via `<Image unoptimized />` to avoid Next/Image domain config.
- The only allowlisted remote pattern in `next.config.ts` is `sakolakembara.org/wp-content/uploads/**` — any other domain must either use `unoptimized` or be added to `remotePatterns`.

## External links worth knowing

These live in code, not in any config file:

- **`CONFIRMATION_FORM_URL`** in `app/donasi/page.tsx` — donation confirmation Google Form.
- **`https://sakolakembara.org/daftar`** in `app/gabung-siswa/page.tsx` — legacy student registration link (will be replaced by an on-site form).
- **`https://linktr.ee/JoinSakolaKembara`** in `app/tim/page.tsx` — volunteer signup Linktree.
- **Social URLs** in `components/ui/social-links.tsx` — IG, TikTok, X, YouTube (all `@sakolakembara`).
- **Contact email** in `components/layout/footer.tsx` — `contact@sakolakembara.org`.

Consider consolidating these into `lib/data.ts` when more pages need to reference them.

## What needs to move to a dashboard (eventually)

In priority order (mirrors the MVP backlog):

1. **Blog posts** — already file-based, will move to dashboard-managed CMS.
2. **Public announcement strip** — admin-published, conditional render.
3. **PDF reports** — admin uploads, public page auto-lists.
4. **Student applications** — submitted via on-site form, viewed/accepted/rejected from dashboard.
5. **Impact metrics + map locations** — currently hand-edited in `lib/data.ts`; reasonable to migrate.
6. **Team members + testimonials + partners** — lower-churn; OK to keep in code for MVP.
