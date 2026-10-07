# Tech Stack

A snapshot of what powers the site today. Keep this in sync with `package.json` and the root configs.

## Runtime & framework

- **Next.js 16.1.4** with the **App Router** (`app/` directory).
- **React 19.2.3** + **React DOM 19.2.3**.
- **TypeScript 5** in `strict` mode, `target: ES2017`, `jsx: react-jsx`, `moduleResolution: bundler`.
- Path alias **`@/*` → `./*`** (project root), declared in `tsconfig.json`.
- Build output: **`output: "standalone"`** in `next.config.ts` (small, self-contained server bundle — used by the production Docker image).

## Build & dev

- `npm run dev` → Next dev server on `http://localhost:3000`.
- `npm run build` → production build.
- `npm run start` → serve the production build.
- `npm run lint` → ESLint v9 with `eslint-config-next`.
- `pnpm storybook` / `pnpm build-storybook` → Storybook 10 (`@storybook/nextjs-vite`, addons docs and a11y; config in `.storybook/`) for the design-system components. CI (`.github/workflows/storybook.yml`) builds it on every pull request; it is not hosted yet.
- `npm run scrape:blog` → re-scrape WordPress posts into `content/blog/*.md` and `lib/blog-posts.json` (see [`blog-pipeline.md`](blog-pipeline.md)).
- `npm run blog:sync` → regenerate `lib/blog-posts.json` from edited markdown.

## Styling

- **Tailwind CSS v4** via `@tailwindcss/postcss` (see `postcss.config.mjs`).
- **No `tailwind.config.ts`** — design tokens are declared in `app/globals.css` via `@theme inline { ... }`. Add new tokens there, not in a JS config.
- Tokens published as Tailwind utilities (SAKEM-031/032):
  - **Brand**: `primary-blue`, `primary-blue-dark`, `accent-navy`, `secondary-yellow`, `secondary-green`, `blue-yonder`. Their values come from brand-named primitives in `:root` (`--catalina-blue`, `--sunglow`, …), which are not utilities.
  - **Status**: `success-*`, `warning-*`, `danger-*`, `info-*`, each with `-fg` / `-bg` / `-border`.
  - **Neutrals**: Tailwind's grey scale; `white`, and `black` remapped to `#1F2937`.
  - **Type**: `var(--font-display)` (Lora) and `var(--font-body)` (Plus Jakarta Sans).
- Global CSS classes in `app/globals.css`: `.blog-content` (scraped/markdown posts), `.animate-pulse-marker` (map), `.nav-clearance` (hero top padding). The old `.btn*`, `.card`, `.input`, `.label`, `.text-body*` and `.image-placeholder` classes were unused and were removed in SAKEM-032; style with utilities (and, as they land, the components in `components/ui/`).
- Reduced motion: `components/MotionProvider.tsx` wraps the app in framer-motion's `MotionConfig reducedMotion="user"`; CSS transitions are covered by the `prefers-reduced-motion` rule in `globals.css`.

See [`DESIGN.md`](../../DESIGN.md) for how to use the tokens.

## Fonts

Loaded via `next/font/google` in `lib/fonts.ts`; `fontVariables` is set on `<body>` by `app/layout.tsx` and on the Storybook canvas by `.storybook/preview.tsx`:

- **Lora** (`--font-display`) — serif headline font, weights 400/500/600/700. Used everywhere headlines say `font-[family-name:var(--font-display)]`.
- **Plus Jakarta Sans** (`--font-body`) — sans-serif body, weights 400/500/600/700. Default `body` font.

Both fonts are subsetted to `latin` and load with `display: "swap"`.

## SEO & metadata

- Per-page `Metadata` exports (Next 16 convention). The root metadata lives in `app/layout.tsx`.
- Dynamic blog metadata in `app/blog/[id]/page.tsx` via `generateMetadata`.
- Open Graph + Twitter card configured at root.
- `<html lang="id">` is set in the root layout.
- **No JSON-LD** today. **No analytics** today (per discussion, deprioritized).

## Animation

- **framer-motion** is the de-facto motion system. Almost every section uses `useInView` + `motion.div` with fade + translate on scroll (`opacity: 0, y: 20 → 1, 0`, 0.5–0.6s, slight per-child stagger).
- An `AnimatePresence`-driven modal lives in `ProblemSection.tsx` for stat detail.
- Use this pattern for new sections — don't introduce scroll-jacking, parallax, or large reveal sequences.

## Map

- **Leaflet 1.9** + **react-leaflet 5** render the GIS map in `components/Map/GISMap.tsx`.
- Mounted via `next/dynamic` with `ssr: false` from `ImpactSection.tsx` to avoid SSR window errors.
- Tile source: OpenStreetMap.
- Custom pulse markers via `L.divIcon`; legend overlaid bottom-left.

## Icons

- **lucide-react** for all icons (Menu, Heart, Users, GraduationCap, Mail, MapPin, Calendar, ArrowRight, etc.).
- A few inline SVGs in `components/SocialLinks.tsx` for brand icons (Instagram, TikTok, X, YouTube).

## Blog rendering

- **react-markdown 10** + **remark-gfm 4** render markdown in `components/blog/BlogPostContent.tsx`.
- Backend conversion uses **gray-matter** (frontmatter), **marked** (markdown → HTML for the JSON cache), **turndown** + **turndown-plugin-gfm** (WP HTML → markdown on scrape).
- The pipeline lives in `scripts/lib/blog-pipeline.mjs`. See [`blog-pipeline.md`](blog-pipeline.md).

## Deployment

- Target: **single VPS running Docker Compose** (Hetzner CX22 / DigitalOcean Basic class).
- Stack: `app` (Next standalone), `postgres:16-alpine`, `caddy:2-alpine` (auto-TLS), `backup` sidecar (daily `pg_dump`).
- CI/CD: **GitHub Actions** builds a Docker image → pushes to **GHCR** → SSHes into the VPS to `docker compose pull && up -d`.
- The previous cPanel scripts have been removed from the repo. See [`deployment.md`](deployment.md) and [`../roadmap/infrastructure.md`](../roadmap/infrastructure.md).

## Linting & formatting

- **ESLint v9** + `eslint-config-next` (`eslint.config.mjs`).
- No Prettier / Biome config in repo — formatting follows editor defaults.

## Folder layout

```
app/                                # Next App Router pages
├── layout.tsx                      # root metadata + fonts
├── page.tsx                        # homepage (composes Navbar + 7 sections + Footer)
├── globals.css                     # tokens via @theme inline + utility classes
├── blog/page.tsx
├── blog/[id]/page.tsx              # generateStaticParams + generateMetadata
├── donasi/page.tsx                 # QRIS, bank transfer, confirmation, StakeholderSection
├── gabung-siswa/page.tsx           # student program info
├── kontak/page.tsx                 # contact form + info + socials
├── program/[id]/page.tsx           # dynamic per-phase program page
└── tim/page.tsx                    # team grid

components/
├── Navbar.tsx                      # fixed top, mobile menu
├── Footer.tsx                      # 3-col, dark
├── SocialLinks.tsx                 # IG/TikTok/X/YouTube
├── Map/GISMap.tsx                  # Leaflet, dynamic SSR-off
├── blog/BlogPostContent.tsx        # markdown renderer
└── sections/                       # homepage + reusable sections
    ├── HeroSection.tsx
    ├── ProblemSection.tsx
    ├── ActivitiesSection.tsx
    ├── ImpactSection.tsx           # metrics + map + testimonials carousel
    ├── PartnersSection.tsx
    ├── CTASection.tsx
    ├── NewsSection.tsx             # latest blog posts
    ├── StakeholderSection.tsx      # used on /donasi
    ├── TeamSection.tsx             # used inline elsewhere if needed
    └── ContactSection.tsx          # used inline elsewhere if needed

lib/
├── data.ts                         # all hard-coded site copy & data
├── blog.ts                         # blog reader API
└── blog-posts.json                 # generated from content/blog/*.md

content/
└── blog/                           # markdown source of truth for all posts
    ├── README.md
    └── <slug>.md                   # one file per post w/ frontmatter

public/
├── images/                         # logo, hero-team, qris
├── blog/images/                    # blog images mirrored from WordPress
└── *.svg                           # generic Next-template assets

scripts/
├── blog-sync-from-markdown.mjs     # md → JSON sync
├── scrape-blog.mjs                 # WP API → md + images + JSON
└── lib/blog-pipeline.mjs           # shared blog utilities

docs/                               # this folder
```

## What is **not** in the stack (and why it matters)

- **No CMS or backend.** All non-blog content lives in `lib/data.ts` and is hand-edited. The future admin dashboard fills this gap (see `current-state/known-gaps.md` and `roadmap/mvp-priorities.md`).
- **No i18n library.** `<html lang="id">` is hard-set; all UI strings are inline. **Do not introduce i18next**. If we ever want English, copy the relevant Next App Router locale convention.
- **No state management library.** Local component state via `useState` is enough; data is static.
- **No form backend.** `/kontak` has a form UI but no submit handler. `/gabung-siswa` and `/tim` link out to external forms (Linktree, WordPress). The student registration form is planned but not yet wired (MVP item #3).
- **No tests.** No Jest / Vitest / Playwright config in repo.
- **No CI configuration** in repo.
- **No JSON-LD or sitemap** — to be added later if SEO needs it.

Any of these may need to be added — but each is a deliberate addition, not an oversight. Decide before introducing.
