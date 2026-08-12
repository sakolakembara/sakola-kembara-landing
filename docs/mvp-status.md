# MVP Status — 2026-06-30

> **Snapshot, not roadmap.** This is what the repo can do *today*. For the forward-looking plan see [`roadmap/mvp-roadmap.md`](roadmap/mvp-roadmap.md); for what's still placeholder see [`current-state/known-gaps.md`](current-state/known-gaps.md).

## TL;DR

The Next.js 16 rebuild is **feature-complete on `dev.angga`**. Public site has dynamic content (announcements, team, reports, paginated blog, on-site forms for applications and contact). Auth is Google OAuth (for students and admins) with an email + password fallback for admins; `/admin` is a role-gated dashboard and `/portal` is the signed-in student area. WordPress cutover redirects are wired. What's left for launch is operational: real content from the team, VPS provisioning, DNS flip.

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
- `/login` — unified Auth.js sign-in (Google button + collapsible admin email/password form)
- `/portal`, `/portal/status` — signed-in student area: current-batch CTA + registration history + per-application result view (see [`architecture/student-portal.md`](architecture/student-portal.md))
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
- `/admin/batches`, `/admin/batches/new`, `/admin/batches/[id]` — admission-batch CRUD + `Publikasikan Hasil` action (guarded: no `pending` / `under_review` rows allowed). See [`architecture/admission-batches.md`](architecture/admission-batches.md).
- Responsive sidebar: hamburger drawer on mobile, fixed sidebar on desktop, active-link highlight

### Cross-cutting
- **Auth.js v5** — Google OAuth alongside a unified Credentials provider (email + bcrypt) that works for any account with a `password_hash`. Students self-register at `/register`; admins are seeded via `npm run seed:super-admin`. Sessions are JWT-only with role stamped into the token in the `jwt` callback; middleware (`proxy.ts`) reads it without a DB hit. `/admin/*` requires an admin role, `/portal/*` requires any signed-in user, students hitting `/admin` are bounced to `/portal?error=admin-only`. Details in [`architecture/authentication.md`](architecture/authentication.md).
- **Unified login + student portal + yearly batches** — sign-in lives at `/login` regardless of role. Students land on `/portal`, where they can only register while an `admission_batches` row is currently open (`opens_at ≤ now < closes_at`) and can only see verdicts after that batch's `results_published_at` is set. See [`architecture/student-portal.md`](architecture/student-portal.md) and [`architecture/admission-batches.md`](architecture/admission-batches.md).
- **WordPress cutover** — `next.config.ts → redirects()` 308s for `/cerita/*`, `/education/*`, `/news/*`, `/tips/*`, `/testimonials/*`, `/career/*`, `/kiat-kiat/*` → `/blog/*`; `/daftar`, `/apply` → `/gabung-siswa`; `/tentang-kami`, `/about` → `/tim`; `/impact-reports*` → `/laporan`; `/feed`, `/index.php`, `/blog/page/N` to sensible targets. Smoke-tested against dev.
- **SEO baseline** — `lib/seo.ts` (OG, Twitter, canonical URL, JSON-LD for articles), per-page metadata, `robots.txt`, dynamic `sitemap.xml`, viewport export with brand `themeColor`, skip-to-content link, `html lang="id"`.
- **Audit log** — every admin mutation appends a row via `writeAudit()`; viewable in `/admin/audit` and on the dashboard recent activity widget.
- **Observability** — Sentry wired via `instrumentation.ts` + per-runtime configs (`sentry.server.config.ts`, `sentry.edge.config.ts`, `instrumentation-client.ts`) and reported from every area-level error boundary. Dormant when `SENTRY_DSN` is unset.
- **Error UX** — `app/global-error.tsx` (root fallback) plus per-area `error.tsx` under `(public)`, `(admin)`, `(portal)`. Show a warm Indonesian message and a "Coba lagi" button; forward the error digest to Sentry so on-call can correlate.
- **Rate limiting** — postgres-backed fixed-window bucket (`rate_limit_hits` table + `lib/rate-limit.ts`). Applied to `/kontak` submit (5 req/min/IP), `/gabung-siswa/form` submit (3/5min/user), `/register` signup (3/5min/IP), and credential sign-in (5/5min/IP+email).
- **Unit tests** — Vitest (`__tests__/`) covers the Zod schemas that gate DB writes (identity, household, housing, documents, marketing, interview), the rate limiter, the admin-user domain service, and the `requireAdmin`/`requireStudent` guards. `npm test`.
- **Form data schema tag** — `student_applications.formData` now carries `formVersion: 2`; bump when the wizard shape changes so the admin detail view can branch cleanly.

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
| `users` | `/admin/settings` (admins) + Google sign-in (students) | Email + role enum (`student` / `viewer` / `editor` / `super_admin`) + optional bcrypt `password_hash` + `image` + `last_login_at`. Renamed from `admin_users`. |
| `accounts` | Auth.js Google sign-in | OAuth linkage: `(provider, providerAccountId)` → `users.id`. NextAuth-adapter-compatible shape. |
| `admission_batches` | `/admin/batches` | Yearly batch (year unique) with `opens_at`, `closes_at`, and `results_published_at` (the batch-level publish trigger). |
| `student_applications` | `/gabung-siswa` (auth-gated form) → `/admin/applications` (review) | Form submissions with `user_id` + `batch_id` (unique together) + status + reviewer notes |
| `announcements` | `/admin/announcements` | Homepage strip content + schedule |
| `reports` | `/admin/reports` | PDF metadata (file lives in `public/reports/`) |
| `team_members` | `/admin/team` | Team grid for `/tim` |
| `contact_messages` | `/kontak` (public) → `/admin/messages` (read) | Contact form submissions |
| `site_resources` | `/admin/resources` | Dynamic docs catalog rendered at `/gabung-siswa/docs` (files, external links, and copy-able text snippets) |
| `audit_log` | every action | Append-only log of admin mutations |

Schemas live in `lib/db/schema/*` and are documented in [`roadmap/data-model.md`](roadmap/data-model.md).

## What is NOT in the MVP

Deferred features, all judged not worth the dev time at launch:

- **`/program/[id]` admin CRUD** — programs are a stable 3-stage taxonomy; manual swap is fine until marketing wants autonomy.
- **`/?p=NNN` WP query-string redirects** — only handle if Search Console reveals incoming traffic; would need a small dynamic handler since Next.js declarative redirects can't match query strings.
- **Transactional email (Resend etc.)** — admin team uses Outlook directly off the `/kontak` thread. Adding it back when there's a workflow that needs it.
- **Object storage (S3 / R2)** — `public/` volume on the VPS is the file store. Migrate when total uploads exceed ~5 GB or when private file uploads become a thing.
- **Background jobs / cache layer (Redis)** — no MVP workload that needs them.

## What's blocking launch

Operational, not code. Tracked in [`runbook/launch.md`](runbook/launch.md) Phase 0:

1. **Real content swap** — final team photos + bios, real `impactMetrics` numbers, program photos + copy, real testimonials, QRIS image file. See [`current-state/known-gaps.md`](current-state/known-gaps.md) for the placeholder inventory.
2. **VPS + infra** — provider account + budget approval (~€5/mo Hetzner / DO basic), a **Google Cloud OAuth client** (Web application; production callback `https://sakolakembara.org/api/auth/callback/google`), a **super-admin bootstrap** (`SEED_SUPER_ADMIN_*` values ready to seed once the container is up so someone can sign in), DNS access to flip apex + `www`, Backblaze B2 or Cloudflare R2 for offsite backups.
3. **Pre-launch QA** — Lighthouse on every public route (must hit ≥ 90 on perf / a11y / best-practices / SEO), real-device QA on iPhone + Android + 1366×768 desktop, redirect spot-check.

## Where to go for detail

- **Launch a fresh VPS**: [`runbook/launch.md`](runbook/launch.md)
- **Day-to-day ops** (deploy, restart, restore): [`current-state/deployment.md`](current-state/deployment.md)
- **Why we picked the stack we did**: [`roadmap/infrastructure.md`](roadmap/infrastructure.md)
- **How auth works**: [`architecture/authentication.md`](architecture/authentication.md)
- **How the student portal works**: [`architecture/student-portal.md`](architecture/student-portal.md)
- **How admission batches work**: [`architecture/admission-batches.md`](architecture/admission-batches.md)
- **What's still placeholder**: [`current-state/known-gaps.md`](current-state/known-gaps.md)
- **Visual guardrails**: [`design/visual-identity.md`](design/visual-identity.md), [`design/color-and-typography.md`](design/color-and-typography.md)
- **Indonesian tone-of-voice**: [`context/tone-of-voice.md`](context/tone-of-voice.md)
