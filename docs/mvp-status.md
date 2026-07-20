# MVP Status — 2026-06-30

> **Snapshot, not roadmap.** This is what the repo can do *today*. For the forward-looking plan see [`roadmap/mvp-roadmap.md`](roadmap/mvp-roadmap.md); for what's still placeholder see [`current-state/known-gaps.md`](current-state/known-gaps.md).

## TL;DR

The Next.js 16 rebuild is **feature-complete on `dev.angga`**. Public site has dynamic content (announcements, team, reports, paginated blog, on-site forms for applications and contact), and `/admin` is a full dashboard gated by Microsoft Entra ID + `@sakolakembara.org` domain check. WordPress cutover redirects are wired. What's left for launch is operational: real content from the team, VPS provisioning, DNS flip.

## What ships in the MVP

### Public site (`/`)
- `/` — homepage with announcement strip (when active), hero, programs, impact metrics, testimonials, latest blog
- `/blog` — paginated index (15/page), featured card on page 1
- `/blog/[slug]` — markdown-backed article render with author, related articles, OG metadata
- `/tim` — three sections (Dewan Pembina / Dewan Pengawas / Pengurus) sourced from `team_members`; click a card to open a profile drawer with bio, education, and work history
- `/laporan` — annual / financial / impact / donation report library, PDF downloads
- `/donasi` — donation page with QRIS, bank details
- `/gabung-siswa` — landing info page with "Daftar Sekarang" CTA + Pusat Dokumen link
- `/gabung-siswa/form` — multi-step recruitment wizard (identitas → keluarga & ekonomi → tempat tinggal → organisasi → berkas → berkas marketing → interview → review), sidebar nav, localStorage persistence; writes rich `form_data` blob to `student_applications`
- `/gabung-siswa/docs` — public docs catalog rendered from `site_resources`, grouped into 5 categories with anchor links (`#panduan`, `#berkas-pendaftaran`, `#berkas-marketing`, `#tutorial`, `#lainnya`); text-type entries render with a Salin button
- `/kontak` — contact form, writes to `contact_messages`
- `/program/[id]` — program detail (static; admin CRUD deferred)
- `/login` — Auth.js sign-in (Microsoft Entra + dev provider)
- `/robots.txt`, `/sitemap.xml`, every page has metadata + OG

### Admin dashboard (`/admin`)
- `/admin` — dashboard home: 6 stat cards (attention-aware), 4 quick-action buttons, latest 5 applications + 5 messages preview, recent audit log
- `/admin/applications` — list + filterable, detail page with review notes + status workflow
- `/admin/messages` — inbox with unread indicator, detail page (marks read on open)
- `/admin/announcements` — CRUD, severity (info/warning/urgent), schedule window, active toggle
- `/admin/reports` — CRUD, PDF upload with size cap, category + description + year (single `2025` or academic `2025/2026`)
- `/admin/blog` — two-tab editor (Content + Meta), sticky save header, in-form hero + body image upload, writes to `content/blog/<slug>.md`
- `/admin/team` — CRUD, photo upload, display order
- `/admin/settings` — admin user management (super_admin only mutates; guards on self-delete + last-super demotion)
- `/admin/resources` — CRUD for the dynamic docs catalog. Each entry has title, description, category (panduan / berkas-pendaftaran / berkas-marketing / tutorial / lainnya), display order, and a content type of `file` (uploaded to `public/resources/`), `url` (external), or `text` (copy-able snippet). Renders publicly at `/gabung-siswa/docs`.
- `/admin/audit` — paginated viewer with filters (action / resource / actor email substring / date range)
- Responsive sidebar: hamburger drawer on mobile, fixed sidebar on desktop, active-link highlight

### Cross-cutting
- **Auth.js v5** — Microsoft Entra ID (single-tenant) in production, email-only dev provider gated by `NODE_ENV=development + AUTH_DEV_PROVIDER_ENABLED=true`. Domain check on `@sakolakembara.org` at the IdP, in the proxy middleware, AND in every server action.
- **WordPress cutover** — `next.config.ts → redirects()` 308s for `/cerita/*`, `/education/*`, `/news/*`, `/tips/*`, `/testimonials/*`, `/career/*`, `/kiat-kiat/*` → `/blog/*`; `/daftar`, `/apply` → `/gabung-siswa`; `/tentang-kami`, `/about` → `/tim`; `/impact-reports*` → `/laporan`; `/feed`, `/index.php`, `/blog/page/N` to sensible targets. Smoke-tested against dev.
- **SEO baseline** — `lib/seo.ts` (OG, Twitter, canonical URL, JSON-LD for articles), per-page metadata, `robots.txt`, dynamic `sitemap.xml`, viewport export with brand `themeColor`, skip-to-content link, `html lang="id"`.
- **Audit log** — every admin mutation appends a row via `writeAudit()`; viewable in `/admin/audit` and on the dashboard recent activity widget.

## Tech stack

- **Framework**: Next.js 16 (App Router, React 19, Tailwind v4, TypeScript 5 strict)
- **Database**: PostgreSQL 16 via Docker Compose; **Drizzle ORM** + drizzle-kit for migrations
- **Auth**: Auth.js v5 (split edge/Node config)
- **Hosting (target)**: single VPS + Docker Compose + Caddy (auto Let's Encrypt) + daily `pg_dump` sidecar
- **CI/CD**: GitHub Actions → GHCR → SSH `docker compose pull && up -d`

See [`current-state/tech-stack.md`](current-state/tech-stack.md) for the full list.

## Data model

Five Postgres tables hold all dynamic state. Blog stays in markdown (`content/blog/*.md`) — version-controlled, no DB hit per page view.

| Table | Owner | Purpose |
|---|---|---|
| `admin_users` | `/admin/settings` | Email + role (super_admin / editor / viewer) + last_login |
| `student_applications` | `/gabung-siswa` (public) → `/admin/applications` (review) | Form submissions, review notes, status |
| `announcements` | `/admin/announcements` | Homepage strip content + schedule |
| `reports` | `/admin/reports` | PDF metadata (file lives in `public/reports/`) |
| `team_members` | `/admin/team` | Team grid for `/tim` |
| `contact_messages` | `/kontak` (public) → `/admin/messages` (read) | Contact form submissions |
| `site_resources` | `/admin/resources` | Dynamic docs catalog rendered at `/gabung-siswa/docs` (files, external links, and copy-able text snippets) |
| `audit_log` | every action | Append-only log of admin mutations |

Schemas live in `lib/db/schema/*` and are documented in [`roadmap/data-model.md`](roadmap/data-model.md).

## What is NOT in the MVP

Deferred features, all judged not worth the dev time at launch:

- **Sentry** — wire `npx @sentry/wizard` when prod has an actual issue VPS logs can't explain.
- **`/program/[id]` admin CRUD** — programs are a stable 3-stage taxonomy; manual swap is fine until marketing wants autonomy.
- **`/?p=NNN` WP query-string redirects** — only handle if Search Console reveals incoming traffic; would need a small dynamic handler since Next.js declarative redirects can't match query strings.
- **Transactional email (Resend etc.)** — admin team uses Outlook directly off the `/kontak` thread. Adding it back when there's a workflow that needs it.
- **Object storage (S3 / R2)** — `public/` volume on the VPS is the file store. Migrate when total uploads exceed ~5 GB or when private file uploads become a thing.
- **Background jobs / cache layer (Redis)** — no MVP workload that needs them.

## What's blocking launch

Operational, not code. Tracked in [`runbook/launch.md`](runbook/launch.md) Phase 0:

1. **Real content swap** — final team photos + bios, real `impactMetrics` numbers, program photos + copy, real testimonials, QRIS image file. See [`current-state/known-gaps.md`](current-state/known-gaps.md) for the placeholder inventory.
2. **VPS + infra** — provider account + budget approval (~€5/mo Hetzner / DO basic), Microsoft Entra app registration (~15 min by an IT admin), DNS access to flip apex + `www`, Backblaze B2 or Cloudflare R2 for offsite backups.
3. **Pre-launch QA** — Lighthouse on every public route (must hit ≥ 90 on perf / a11y / best-practices / SEO), real-device QA on iPhone + Android + 1366×768 desktop, redirect spot-check.

## Where to go for detail

- **Launch a fresh VPS**: [`runbook/launch.md`](runbook/launch.md)
- **Day-to-day ops** (deploy, restart, restore): [`current-state/deployment.md`](current-state/deployment.md)
- **Why we picked the stack we did**: [`roadmap/infrastructure.md`](roadmap/infrastructure.md)
- **How auth works**: [`roadmap/admin-dashboard.md`](roadmap/admin-dashboard.md)
- **What's still placeholder**: [`current-state/known-gaps.md`](current-state/known-gaps.md)
- **Visual guardrails**: [`design/visual-identity.md`](design/visual-identity.md), [`design/color-and-typography.md`](design/color-and-typography.md)
- **Indonesian tone-of-voice**: [`context/tone-of-voice.md`](context/tone-of-voice.md)
