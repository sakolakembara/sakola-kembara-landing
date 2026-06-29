# Known Gaps

A running list of things that are missing, broken, or placeholder — as identified in product discussion and confirmed against the code.

## Pages and features not yet built

| Item | Status | Notes |
| --- | --- | --- |
| **`/impact-reports`** ("Impact & Reports") | Not built | Currently the transparency content is embedded inside `/donasi` via `StakeholderSection`. Should be split into its own public page that auto-lists uploaded PDFs by year/category. |
| **Public announcement strip** | Not built | Should sit between Navbar and Hero on `/`, render only when an admin has published an announcement. |
| **On-site student registration form** | Not built | `/gabung-siswa` currently links to external `https://sakolakembara.org/daftar`. The MVP plan is on-site form → DB → dashboard review → accept/reject. |
| **`/kontak` form submit handler** | Not wired | The form UI exists but `<form>` has no `onSubmit`. Hook it up to email or a backend. |
| **Admin dashboard** | Not built | Will live in **this repo** as an `app/(admin)/admin/*` route group, gated by Microsoft Entra ID (`@sakolakembara.org` only). See [`../roadmap/admin-dashboard.md`](../roadmap/admin-dashboard.md). Manages blog posts, announcements, reports, applications, team/testimonials/partners. |
| **LMS provisioning for accepted students** | Out of MVP | Auto-generated temp credentials, onboarding email with WhatsApp / Zoom links. Planned post-MVP. |

## Dashboard / admin issues (from product discussion)

1. **Public announcement feature not working yet** — no frontend implementation; the homepage has no announcement slot.
2. **Blog post slugs auto-generation** — already satisfied at the file level (filename = slug; see [`blog-pipeline.md`](blog-pipeline.md)). The dashboard MVP must replicate this when admins create posts.
3. **Dashboard page for report uploads** missing — admins should upload PDFs for yearly / financial / impact / donation reports. After upload, the (future) `/impact-reports` page should auto-list them.
4. **Donation page mixed with transparency/accountability content** — the `/donasi` page currently embeds `StakeholderSection`. Once `/impact-reports` exists, move that block off `/donasi` so donation stays focused on the CTA.
5. **Student registration form missing on the website** — see above.
6. **Accepted-student LMS provisioning** — out of MVP scope.
7. **Placeholder content throughout** — see next section.

## Content placeholders

These are not bugs — they're known gaps waiting on real data from the org team.

### `lib/data.ts`

- **`teamMembers`** — 8 entries with Unsplash avatars and university placeholders ("Ahmad Fadillah", "Siti Nurhaliza", etc.). Replace with real C-level + core leadership for the MVP `/tim`.
- **`testimonials`** — only **2 entries** ("Daffa Najwan", "Natia Nur Faza"); the testimonial carousel on `ImpactSection` wraps trivially with so few. Add more.
- **`partners`** — only ITB has a real logo URL; the other 4 are text fallbacks. The Partners section also only renders `partner.name`, never `partner.logo` — wire up the logo render once real assets are supplied.
- **`reports`** — 3 hard-coded entries with fake PDF sizes ("PDF • 2.4 MB"). Replace with real uploaded PDFs once the report dashboard ships.
- **`stakeholders`** — 3 cards with `href: "#"` (Donatur, Orang Tua, Partner). Point the links somewhere real when the relevant pages exist.
- **`contactInfo`** — uses emoji icons (`📧 📱 📍`). Migrate to lucide-react icons for visual consistency with the rest of the site.
- **`newsArticles`** — **legacy**; not used by the homepage anymore (NewsSection reads markdown blog instead). Either delete or repurpose.
- **`footerLinks`** — exported but **not referenced** by `Footer.tsx`. Either delete or wire up.

### Pages

- **`/gabung-siswa`** — "Daftar Gratis Sekarang" CTA points at the external WP page `https://sakolakembara.org/daftar`. Replace with on-site form.
- **`/program/[id]`** — has explicit "Timeline" and "Galeri Foto" placeholder sections that show "Konten timeline akan ditambahkan" / "Galeri foto akan ditambahkan". Replace with real content or remove the placeholders if not coming soon.
- **`/program/[id]`** — links to `/files/pitchdeck-sakola-kembara.pdf` for a download. Confirm the file exists at that path in `public/files/` before linking from comms.
- **Hero badge images** (`badge1`, `badge2` in `heroImages`) — Unsplash placeholders. Replace with real photos.
- **Activities section program images** — Unsplash placeholders. Replace with real program photography.
- **Donasi QRIS** — `public/images/qris-sakola-kembara.png` is present and live. The page already handles the "missing QR" case gracefully via `qrUnavailable` state.

### Anchors

- Both `HeroSection` and `ProblemSection` set `id="about"`. Duplicate IDs are invalid HTML; one should be renamed.

## Quality / engineering

- **No tests** configured.
- **No CI** configuration.
- **No staging environment** (dev → directly to prod once VPS is provisioned).
- **No sitemap / robots.txt / JSON-LD** — add when SEO matters.
- **No error monitoring** (Sentry, etc.).
- **Mixed image strategy** — most external images use `unoptimized`. Worth deciding which CDN domains to allowlist in `next.config.ts.images.remotePatterns` so Next/Image can resize/cache them properly.

## Skipped for now (per discussion)

- **Analytics** — none installed; revisit once dashboard ships.
- **English translations** — site is Indonesian-first; do not add an i18n layer.
- **VPS not yet provisioned.** Target host + Docker Compose stack are documented in [`../roadmap/infrastructure.md`](../roadmap/infrastructure.md); actual provisioning + first deploy is pending.
