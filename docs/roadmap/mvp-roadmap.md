# MVP Roadmap

> Master sequenced plan for getting from where we are today — public site with placeholder content, scaffolded data layer, **no admin dashboard yet**, no production deploy yet — to a launched MVP: credible donor-facing site + working admin dashboard + on-site student form + public report center, with SEO good enough to start ranking.

This doc is the **execution sequence**. Companion docs cover the *what* and the *why*:

- [`mvp-priorities.md`](mvp-priorities.md) — flat list of in/out scope.
- [`admin-dashboard.md`](admin-dashboard.md) — Auth.js + route-group architecture.
- [`infrastructure.md`](infrastructure.md) — VPS + Docker + Caddy + Postgres.
- [`data-model.md`](data-model.md) — Drizzle schemas (already implemented).
- [`../current-state/known-gaps.md`](../current-state/known-gaps.md) — placeholders and tech-debt items that travel with the phases.

## What "MVP done" means

- ✅ Production site live at `https://sakolakembara.org` on the VPS, on the new Next.js stack (no more WordPress redirect).
- ✅ Donors can find the donation page, the impact reports, and trust signals (real team, real testimonials, real partner logos) within two clicks of the homepage.
- ✅ Prospective students can fill out the registration form on the site (no more external WordPress redirect).
- ✅ Admins can log in with their `@sakolakembara.org` Microsoft account and manage: announcements, student applications (accept/reject), report PDF uploads, and blog posts.
- ✅ Search Console verified; sitemap + robots + JSON-LD shipped; Lighthouse SEO score ≥ 95 on every public page.
- ✅ Daily Postgres backups running, offsite copy verified at least once.

Anything not in this list is **post-MVP** — see "What's NOT in MVP" at the bottom.

## Phase 0 — Foundation (✅ done)

What already shipped that everything else depends on:

- Next.js 16 + React 19 + TypeScript 5 + Tailwind v4, in repo and building cleanly.
- Public site: homepage (7 sections), `/blog` + `/blog/[id]`, `/donasi`, `/gabung-siswa`, `/kontak`, `/program/[id]`, `/tim` — all with placeholder content but visually complete.
- Blog markdown pipeline (`content/blog/*.md` → `lib/blog-posts.json`).
- `lib/env.ts` Zod-validated env, `lib/db.ts` Drizzle + pg.Pool client, `lib/db/schema/*.ts` for the 5 MVP tables, first migration committed at `drizzle/0000_soft_leopardon.sql`.
- Docker + `docker-compose.yml` + `Caddyfile` + GitHub Actions deploy workflow.
- `docs/` knowledge center, including this folder's roadmap docs.

The dev loop works end-to-end: `npm run db:up && npm run db:migrate && npm run dev`.

## Phase 1 — Production deploy + auth foundation

**Goal**: the public site is live on the new VPS at `sakolakembara.org`, and the `/admin` route group is gated behind Microsoft Entra ID (even though no admin pages exist yet).

**Deliverables**

1. **VPS provisioning** (one-time)
   - Order Hetzner CX22 (or equivalent), Ubuntu 24.04.
   - Server hardening: SSH keys only, `ufw`, `unattended-upgrades`, `fail2ban`, non-root `deploy` user in `docker` group.
   - Install Docker Engine + Compose plugin.
   - Set up `/opt/sakem/` with `docker-compose.yml`, `Caddyfile`, `.env.production`, `.env` (for Compose variable substitution).
   - DNS A records for `sakolakembara.org` and `www.sakolakembara.org` → VPS IP.

2. **GHCR + GitHub Actions secrets**
   - Enable GHCR for the repo (private package).
   - Add repo secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, optional `VPS_SSH_PORT`.

3. **First production deploy**
   - Push to `main` triggers the workflow.
   - Verify Caddy issues TLS, app responds on `https://sakolakembara.org`.
   - Apply the initial Drizzle migration on the prod DB.
   - Confirm offsite backup cron + first rclone push to B2/R2.

4. **Microsoft Entra ID app registration** (depends on IT admin)
   - Follow steps in [`admin-dashboard.md`](admin-dashboard.md) §"Azure / Entra setup".
   - Single-tenant, redirect URIs for prod + `localhost:3000`.
   - Copy client ID / tenant ID / client secret into `.env.production` and dev `.env.local`.

5. **Auth.js wiring**
   - `npm install next-auth@beta`.
   - Move existing pages into `app/(public)/` route group (no URL change).
   - Create `app/(admin)/` group with `app/(admin)/login/page.tsx` and `app/(admin)/admin/layout.tsx` (admin shell — sidebar, sign-out, server-side `auth()` guard).
   - `auth.ts` at repo root with Microsoft Entra provider + `signIn` callback rejecting non-`@sakolakembara.org` emails.
   - `middleware.ts` matcher on `/admin/:path*` and `/api/admin/:path*`.
   - `app/api/auth/[...nextauth]/route.ts` handler.
   - Seed the first super admin manually via `psql`.

**Dependencies**
- VPS step blocks the first deploy.
- Entra registration blocks Auth.js wiring (which blocks every later admin phase).

**Exit criteria**
- `https://sakolakembara.org/` serves the current public site.
- `https://sakolakembara.org/admin` redirects to `/login`, which renders the "Masuk dengan Microsoft" button.
- Signing in with an `@sakolakembara.org` account renders the empty admin shell.
- Signing in with anything else gets rejected at the IdP.

## Phase 2 — SEO baseline (can run in parallel with Phase 1)

**Goal**: every public page is fully indexable, structured-data-rich, and ranks well for "bimbel gratis", "sakola kembara", "beasiswa pendidikan tinggi indonesia", and donor-relevant queries. **Don't ship MVP without this** — half the value of the new site is being findable.

**Deliverables**

1. **Fix the `metadataBase` warning** (already showing in `npm run build`)
   - Set `metadataBase: new URL("https://sakolakembara.org")` in `app/layout.tsx`'s root `Metadata`.

2. **Per-page `Metadata` exports** (currently most pages inherit root)
   - `/` — already in `app/layout.tsx` root, override title and add explicit canonical.
   - `/donasi` — title "Donasi - Sakola Kembara", description focused on impact + bank/QRIS.
   - `/gabung-siswa` — title "Siswa - Sakola Kembara", program benefits in description.
   - `/kontak` — title "Kontak - Sakola Kembara".
   - `/tim` — title "Tim - Sakola Kembara".
   - `/program/[id]` — per-program metadata via `generateMetadata`.
   - `/blog` and `/blog/[id]` — already have dynamic metadata; verify canonical + image.

3. **Open Graph + Twitter cards**
   - Single brand-wide default OG image at `public/og-default.png` (1200×630, logo + tagline).
   - Per-blog-post OG uses `article.image`.
   - Per-program OG uses the program's hero image.

4. **`app/sitemap.ts`** — dynamic sitemap including:
   - All static routes (`/`, `/blog`, `/donasi`, `/gabung-siswa`, `/kontak`, `/tim`).
   - Every program: `/program/prapembinaan`, `/program/pembinaan`, `/program/pasca-pembinaan`.
   - Every blog post (loop `blogArticles`), with `lastModified` from `modifiedISO`.
   - The future `/impact-reports` page once Phase 6 ships.

5. **`app/robots.ts`** — allow all crawlers, point to sitemap, disallow `/admin/*` and `/api/*`.

6. **JSON-LD structured data**
   - **Homepage `/`**: `NGO` (a `NonProfit`-flavored Organization) with `name`, `legalName` ("Yayasan Sakola Kembara Indonesia"), `url`, `logo`, `sameAs` (IG, TikTok, X, YouTube), `contactPoint`, `address` (Bandung).
   - **Blog post `/blog/[id]`**: `Article` with `headline`, `author`, `datePublished`, `image`, `publisher`.
   - **Program page `/program/[id]`**: `EducationalOccupationalProgram` or simple `Service`.
   - **Optional**: `BreadcrumbList` on deeper pages.

7. **Indonesian-language signals**
   - `<html lang="id">` is already set.
   - `Metadata.openGraph.locale = "id_ID"` is already set at root — verify it carries through.
   - Add `alternate` hreflang in metadata if/when an English version ever exists. Skip for MVP.

8. **Search Console + Bing Webmaster**
   - Verify both via TXT record (preferred) or HTML meta tag.
   - Submit `https://sakolakembara.org/sitemap.xml`.
   - Set up email alerts for indexing errors.

9. **Performance baseline (feeds SEO)**
   - Allowlist legitimate CDN domains in `next.config.ts.images.remotePatterns` so `<Image>` actually optimizes (currently most external images use `unoptimized`).
   - Replace Unsplash placeholder photos with real (compressed) ones — Phase 8 work, but performance debt until then.
   - Verify Lighthouse SEO score ≥ 95, Performance ≥ 90 on every public route.

**Exit criteria**
- `https://sakolakembara.org/sitemap.xml` and `/robots.txt` resolve and look correct.
- View-source on any page shows a `script[type=application/ld+json]` block.
- Search Console says "Coverage: indexed" within a week of submission.
- No `metadataBase` warning at build.

## Phase 3 — Admin dashboard shell

**Goal**: signed-in admins can navigate the dashboard, see basic counts, and every action they take leaves an audit trail.

**Deliverables**

1. **Admin home `/admin`**
   - Stat cards: pending applications, active announcements, total reports, latest sign-ins.
   - "Recent activity" pulled from `audit_log` (latest 20 rows).
   - Visual style mirrors the public design system (`docs/design/*`) — same Lora headings, primary-blue accents.

2. **Audit log helper**
   - `lib/audit.ts` exporting `writeAudit({ actorEmail, action, resourceType, resourceId, metadata })`.
   - Every admin server action / API route calls it after a successful mutation. Never block the response on log success.

3. **Admin users management** (`/admin/settings/users`)
   - List all rows in `admin_users` with role + last login.
   - Super admin can change roles via a server action.
   - First super admin still seeded manually; this UI lets them promote the second.

4. **Layout polish**
   - Sidebar nav: Dashboard / Pengumuman / Laporan / Pendaftar / Blog / Tim / Pengaturan.
   - Top bar: signed-in email + "Keluar" action.
   - Responsive (collapsible sidebar on `< lg`).

**Exit criteria**
- Empty-state versions of all admin pages render without runtime errors.
- An admin who manually inserts a row sees it counted on `/admin`.
- A role change creates an `audit_log` entry with `action = "admin_users.role.change"`.

## Phase 4 — Student application flow (MVP priority #3-5)

**Goal**: prospective students fill out the form on `/gabung-siswa`; admins review and accept/reject from the dashboard.

**Deliverables**

1. **On-site form on `/gabung-siswa`**
   - Replace the "Daftar Gratis Sekarang" external link with an inline form.
   - Fields match `student_applications` schema: full name, email, WhatsApp, school name, graduation year, branch preference (dropdown of `mapLocations`), motivation (textarea), economic background (textarea).
   - Server action validates with Zod, inserts into `student_applications`, returns a success state.
   - Anti-spam: rate-limit by IP at the action level (5/minute), simple honeypot field, optional Turnstile later.
   - Success screen: "Pendaftaran kamu sudah kami terima. Tim akademik akan menghubungi via email."

2. **Admin list `/admin/applications`**
   - Server component with filters: status, branch, graduation year.
   - Sort by submitted date (default desc).
   - Pagination at ~20/page.
   - CSV export (server action streams rows).

3. **Admin detail `/admin/applications/[id]`**
   - Full applicant profile.
   - Status change form (`pending` → `under_review` → `accepted` | `rejected`), with required review notes on accept/reject.
   - On status change: write to `audit_log`, update `reviewed_by` + `reviewed_at`.

4. **Email notification — deferred**
   - The LMS team owns the email path (per earlier discussion). For MVP, status updates are dashboard-only; no email goes out.

**Exit criteria**
- Submitting `/gabung-siswa` from an incognito window creates a row visible at `/admin/applications` within one refresh.
- Marking accepted/rejected writes both the status and an audit entry.
- Form rejects malformed input (missing required fields, bad email format) with field-level Indonesian error messages matching `docs/design/copy-style.md`.

## Phase 5 — Public announcement strip (MVP priority #7)

**Goal**: admins publish a one-line homepage announcement; it shows up between Navbar and Hero when active, disappears otherwise.

**Deliverables**

1. **Public render**
   - `components/AnnouncementStrip.tsx` (server component) queries `announcements` for the current active row (active=true, within startsAt/endsAt window).
   - Mounted at the top of `app/(public)/page.tsx` only — not on every page.
   - Styled per severity: `info` (blue), `warning` (yellow), `urgent` (red).
   - Optional CTA link if `ctaLabel` + `ctaUrl` set.
   - Renders nothing when no active announcement.

2. **Admin CRUD `/admin/announcements`**
   - List: title, severity badge, active window, "Publish/Unpublish" action.
   - Create / edit form: title, body (markdown), severity, CTA fields, optional start/end dates, active toggle.
   - Only one active announcement at a time (enforced by query, not constraint — keeps admin flexibility to schedule the next while the current still runs).

**Exit criteria**
- Publishing an announcement makes it appear on `/` within 5 seconds (or after revalidation).
- Unpublishing or expiring an announcement makes it disappear.
- Audit entries on every publish/unpublish.

## Phase 6 — Impact & Reports page + uploader (MVP priority #8-9)

**Goal**: admins upload PDFs; the public `/impact-reports` page lists them by year and category.

**Deliverables**

1. **Admin upload `/admin/reports`**
   - List existing reports grouped by year, category.
   - Upload form: title, category (yearly / financial / impact / donation), year, file (PDF only, ≤ 20 MB).
   - Server action: streams the file to `public/reports/<year>/<category>/<slug>.pdf` inside the `app_public` Docker volume, inserts the row.
   - Delete action: removes file then row (best-effort transaction).

2. **Public listing `/impact-reports`**
   - New route under `app/(public)/`.
   - Hero matching the other sub-pages.
   - Two-axis layout: years descending, categories as tabs or grouped sections.
   - Each report card: title, category badge, file size, "Download PDF" link.

3. **Header item: "Impact & Reports"** (label locked in `docs/context/audience-and-direction.md`)
   - Add to `navLinks` in `lib/data.ts`.
   - Order: between Donasi and Blog.

4. **Move transparency content off `/donasi`**
   - Currently `app/donasi/page.tsx` embeds `<StakeholderSection />` (Transparansi & Akuntabilitas).
   - Move that conceptual block to `/impact-reports`, replace the report placeholders with real DB-backed report cards.
   - Keep `/donasi` focused on the single donate-now CTA.

**Exit criteria**
- Uploading a 5 MB PDF from `/admin/reports` makes it downloadable from `/impact-reports` within seconds.
- Persistent volume survives a `docker compose up -d app` redeploy (verify by uploading then redeploying).
- The Navbar shows the new item.

## Phase 7 — Blog dashboard (MVP priority #6)

**Goal**: admins create/edit blog posts in-browser; the markdown source still lives in `content/blog/`.

**Deliverables**

1. **Admin list `/admin/blog`**
   - Reads `blogArticles` from the in-memory cache.
   - Filter by category, sort by date, search by title.
   - New / Edit / Delete actions.

2. **Admin editor `/admin/blog/new` and `/admin/blog/[id]/edit`**
   - Form fields matching the markdown frontmatter: title, category, date, excerpt, featured toggle, hero image, author.
   - Markdown body editor: simple textarea + live preview (no rich-text WYSIWYG — keeps the markdown clean). Consider a small monaco/codemirror embed if appetite.
   - Slug auto-derived from title; editable on create only, locked on edit.
   - Hero image upload: writes to `public/blog/images/<year>/<month>/...` and inserts the relative path into the form.

3. **Persistence**
   - Server action writes `content/blog/<slug>.md` (frontmatter + body via `gray-matter.stringify`).
   - Re-runs the equivalent of `npm run blog:sync` in-process to refresh `lib/blog-posts.json`.
   - Triggers an `app.revalidatePath('/blog')` and `revalidatePath('/blog/[slug]')`.

4. **`content/blog/` mounted as a persistent volume in production** (decision)
   - Update `docker-compose.yml` to add `content_blog:/app/content/blog` mount.
   - Image-baked posts seed the volume on first start; admin edits persist there.
   - Document the trade-off: dashboard-authored posts won't be in git unless we also call out to the GitHub API on save. For MVP, persist on the volume only.

**Exit criteria**
- Creating a post in the dashboard makes it appear on `/blog` (after revalidation) and at `/blog/<slug>`.
- Slugs are unique (collision suffix added if needed).
- Image upload works and the resulting URL renders in the preview.

## Phase 8 — Real content replacement (MVP priority #12)

**Goal**: every Unsplash placeholder, fake person, and TBD partner is replaced with real data. Coordinated by Head of Product; engineering supports.

**Deliverables** (in code, driven by content drops)

1. Replace `teamMembers` in `lib/data.ts` with the real C-level + core leadership; commit real photos under `public/images/team/...`.
2. Add ≥ 6 more testimonials to `testimonials` so the carousel actually rotates.
3. Replace the placeholder `partners` text fallbacks with real logos; wire up the `partner.logo` render in `PartnersSection.tsx`.
4. Replace Unsplash hero badges (`heroImages.badge1`, `badge2`) with real photos.
5. Replace Unsplash program images in `programs[].image` with real ones.
6. Refresh the impact numbers in `heroStats`, `impactMetrics`, `mapStats` from the latest cohort data.
7. Replace placeholder `reports` in `lib/data.ts` (no longer needed after Phase 6 — delete).
8. Fix or remove the placeholder `newsArticles` array in `lib/data.ts`.
9. Migrate `contactInfo` emoji icons to lucide-react icons.

**Exit criteria**
- No image in production points to `images.unsplash.com`.
- No team or testimonial card shows a fabricated name.

## Phase 9 — Polish & launch

**Goal**: the new site is the canonical `sakolakembara.org` and the old WordPress install is decommissioned (or kept only for legacy blog redirects).

**Deliverables**

1. **Cutover plan**
   - Inventory existing WordPress URLs vs new URLs; write Caddy redirects for any drift.
   - Especially: WordPress `/?p=NNN` permalinks → new `/blog/<slug>` (we have the WP IDs in `blog-posts.json.articles[].wpId`).
   - DNS final cutover with a 24h TTL drop the day before.

2. **Final SEO sweep**
   - Re-run Lighthouse on every public route; fix ≥ 95 SEO regressions.
   - Verify Search Console has indexed the new sitemap.
   - Check Indonesia-specific tools: Bing Webmaster (some Indonesian users still use Bing), search console for `sakolakembara.org` in `id` language settings.

3. **Accessibility pass**
   - Tab through every form, every modal (the ProblemSection stat modal).
   - Verify all images have meaningful Indonesian `alt` text (not "Image" / English placeholder).
   - Run axe-core or Lighthouse a11y audit; target ≥ 95.

4. **Performance pass**
   - Measure Web Vitals (LCP < 2.5s, INP < 200ms, CLS < 0.1) at 4G throttle.
   - Inline above-the-fold CSS if needed.
   - Verify `next/image` is doing its job (allowlist remaining external image hosts, drop `unoptimized` on the ones we control).

5. **Operations readiness**
   - Verify backup script works end-to-end: take a manual `pg_dump`, restore into a fresh container, confirm row counts match.
   - Set up uptime monitoring (UptimeRobot / Healthchecks.io free tier).
   - Sentry wired and receiving events from a deliberate test error.
   - Document the on-call runbook for the org's tech lead.

6. **Announce internal go-live**
   - Email org team with the new admin URL and a one-page how-to.
   - Demo the dashboard flow live in a team meeting.

**Exit criteria**
- `sakolakembara.org` resolves to the new VPS; old WordPress is either off or read-only.
- Search Console no longer shows "Coverage: error" for any page.
- Uptime monitor + Sentry + backup cron all running for ≥ 7 days without incident.

## Cross-cutting work that runs in every phase

These don't slot neatly into one phase — keep them in mind continuously:

- **Update `docs/current-state/*` in the same PR as the change.** Stale docs are worse than missing docs.
- **Write tests as we go** — none today; start with Vitest unit tests for `lib/` helpers (`audit.ts`, `env.ts`, slug generation) and Playwright smoke tests for the critical paths (sign-in, application submit, report upload). This is a low-noise way to grow the test suite without a one-time test sprint.
- **Watch `npm audit`** every time a dep is bumped. The 4 accepted advisories in `docs/current-state/known-gaps.md` should shrink to 0 as drizzle-kit drops `@esbuild-kit`.
- **Bundle size budget** — keep route JS payload under 200 KB gzipped for public pages; admin can be larger.

## What's NOT in MVP

Deferred explicitly:

- **LMS account auto-provisioning** for accepted students (LMS team owns).
- **Transactional email** (welcome, accept/reject notifications) — LMS team owns.
- **Donation tracking / payment integration** — stays on external rails (Bank Muamalat, QRIS, Google Form confirmation).
- **English translations.**
- **Comments on blog posts.**
- **Search on blog / reports** — table-of-contents-by-year is enough until volume justifies search.
- **User-facing analytics dashboard** for donors / partners.
- **A11y certification** beyond Lighthouse ≥ 95.
- **Object storage migration** (R2 / S3) — stick with `public/` until file volume hurts.
- **Staging environment** — single VPS for MVP; revisit when there are paying users to protect.

## How to use this doc

- **Picking up work?** Find the first phase with ❌ items, then the first ❌ deliverable inside it.
- **Shipping a phase?** Tick its exit-criteria boxes, then update `mvp-priorities.md` status badges (✅ / ◐ / ❌) and the relevant `docs/current-state/` files in the same PR.
- **Changing scope?** Update this doc in the same PR as the discussion — don't let drift accumulate.
- **Slipping a phase?** Note the reason at the top of that phase's section. Future-you will thank present-you.
