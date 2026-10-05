# Sakola Kembara — Website & Admin Dashboard

Public website and (in development) admin dashboard for **Yayasan Sakola Kembara Indonesia** — a non-profit running free university-entrance-exam preparation for students from financially disadvantaged backgrounds across Indonesia.

Live: <https://sakolakembara.org>

> **Looking for the why and the how?** This README is the quick-start. The full project knowledge — strategy, brand guardrails, architecture decisions, roadmap — lives in [`docs/`](docs/). Read [`docs/README.md`](docs/README.md) first.

## Stack at a glance

- **Next.js 16** (App Router) + **React 19** + **TypeScript 5** (strict)
- **Tailwind CSS v4** with tokens declared in `app/globals.css` (no `tailwind.config.ts`)
- **Lora** serif headings + **Plus Jakarta Sans** body via `next/font`
- **framer-motion** for animation, **react-leaflet** for the branches map
- File-based blog: `content/blog/*.md` → `lib/blog-posts.json`
- **PostgreSQL 16 + Drizzle ORM** for the admin dashboard
- **Auth.js v5** — Microsoft Entra ID for production, a dev credentials provider for local. Both gated to `@sakolakembara.org`.
- Public site under `app/(public)/`, dashboard under `app/(admin)/admin/`
- Deploys to a small VPS via **Docker Compose + Caddy + GitHub Actions**

## Prerequisites

- **Node.js 22+** (`nvm install 22`)
- **Docker** + Docker Compose plugin (for local Postgres)
- **git**

## First-time setup

```bash
# 1. Clone
git clone <repo-url> sakola-kembara-landing
cd sakola-kembara-landing

# 2. Install dependencies
npm install

# 3. Copy the env template and fill in at least DATABASE_URL + AUTH_SECRET
cp .env.example .env.local
#    Generate AUTH_SECRET with:  openssl rand -base64 32
#    Microsoft Entra ID vars stay blank in dev — see "Admin sign-in" below
#    for the dev credentials provider.

# 4. Start the local Postgres container
npm run db:up

# 5. Apply the initial Drizzle migration (first time only)
npm run db:migrate

# 6. Start the dev server
npm run dev
```

Open <http://localhost:3000>.

Public routes: `/`, `/blog`, `/donasi`, `/gabung-siswa`, `/kontak`, `/tim`, `/program/pembinaan`.

The admin dashboard at `/admin` redirects unauthenticated visitors to `/login`. See **Admin sign-in (local dev)** below for the seed + dev-login flow.

## Commands

### Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Next dev server on `:3000` with HMR |
| `npm run build` | Production build (`output: "standalone"` for the Docker image) |
| `npm run start` | Serve the production build locally |
| `npm run lint` | ESLint |

### Database

The local DB is a Postgres 16 container defined in `docker-compose.dev.yml`. Drizzle handles schema + migrations from `lib/db/schema/`.

| Command | What it does |
| --- | --- |
| `npm run db:up` | Start the local Postgres container |
| `npm run db:down` | Stop it |
| `npm run db:generate` | Generate a new migration after editing `lib/db/schema/*.ts` |
| `npm run db:migrate` | Apply pending migrations against the running DB |
| `npm run db:push` | Push schema directly without writing a migration (dev shortcut) |
| `npm run db:studio` | Open Drizzle Studio at <https://local.drizzle.studio> |

### Admin

| Command | What it does |
| --- | --- |
| `npm run seed:admin -- <email>` | Upsert a row in `admin_users` so you can sign in. Email must end with `@sakolakembara.org`. Optional 2nd arg = display name, 3rd arg = role (`super_admin` / `editor` / `viewer`, default `super_admin`). |

### Blog content

The blog is markdown under `content/blog/`. After editing any post or adding a new one, regenerate the JSON cache:

| Command | What it does |
| --- | --- |
| `npm run blog:sync` | Regenerate `lib/blog-posts.json` from `content/blog/*.md` |
| `npm run scrape:blog` | Re-scrape posts + images from the legacy WordPress site (rare) |

Commit both the markdown and the regenerated `lib/blog-posts.json` together. Full pipeline details in [`docs/current-state/blog-pipeline.md`](docs/current-state/blog-pipeline.md).

## Admin sign-in (local dev)

`/admin` is gated by Auth.js v5. In production, the Microsoft Entra ID provider handles sign-in. In local dev — where we don't want to block on IT registering the Entra app — there's a **dev-only credentials provider** that authenticates an email against existing rows in `admin_users`. It's silently disabled outside `NODE_ENV=development`.

Once-per-machine setup:

```bash
# 1. Seed yourself as an admin (run this once; safe to re-run)
npm run seed:admin -- you@sakolakembara.org "Your Name" super_admin

# 2. Turn the dev provider on
echo "AUTH_DEV_PROVIDER_ENABLED=true" >> .env.local
```

Day-to-day sign-in:

1. `npm run db:up && npm run dev`
2. Visit <http://localhost:3000/admin> → you're redirected to `/login?from=/admin`.
3. On `/login`, the dev form appears under the (currently empty) Microsoft button. Enter your `@sakolakembara.org` email.
4. The Auth.js Credentials provider looks you up in `admin_users` and signs you in with a JWT session. You land back on `/admin`.
5. Sign out via "Keluar" in the sidebar at any time.

A few notes:

- Emails not ending `@sakolakembara.org` are rejected by both the `signIn` callback and the middleware — even with the dev provider on.
- Sessions are JWT-only, so there's no `sessions` table to manage.
- For production, set `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET`, `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID` in `.env.production`. The dev provider stays off automatically.

Architecture is documented in [`docs/roadmap/admin-dashboard.md`](docs/roadmap/admin-dashboard.md).

## Repo tour

```
app/                       Next App Router
  layout.tsx               Root metadata, fonts, <html lang="id">
  sitemap.ts, robots.ts    SEO surfaces
  (public)/                Public site
    layout.tsx             Navbar + Footer wrapper
    page.tsx               Homepage
    blog/, donasi/, kontak/, tim/, gabung-siswa/, program/[id]/
  (admin)/                 Auth-gated dashboard
    login/page.tsx         Sign-in page (MS button + dev form)
    admin/                 Dashboard pages
      layout.tsx           Sidebar shell + server-side auth() guard
      page.tsx             Stat cards + recent audit_log
      applications/        Student-applicant list + detail
  api/auth/[...nextauth]/  Auth.js handler
auth.config.ts             Edge-safe Auth.js config (used by middleware)
auth.ts                    Node Auth.js (adds dev Credentials provider)
middleware.ts              Gates /admin/* and /api/admin/*
components/                React components
  Navbar.tsx, Footer.tsx, SocialLinks.tsx
  Map/GISMap.tsx           Leaflet, dynamically imported (ssr: false)
  blog/BlogPostContent.tsx Markdown renderer
  sections/                Homepage + reusable sections
lib/
  data.ts                  All hard-coded site copy & data
  blog.ts, blog-posts.json Blog reader + generated cache
  env.ts                   Zod-validated env (throws on boot)
  db.ts, db/schema/        Drizzle + pg.Pool client + tables
  audit.ts                 writeAudit() helper; every admin mutation calls it
  seo.ts                   SITE constants, page-metadata + JSON-LD builders
content/blog/              Markdown source for all blog posts
public/                    Logo, hero photo, QRIS, blog images
scripts/
  blog-sync-from-markdown.mjs, scrape-blog.mjs, lib/blog-pipeline.mjs
  seed-admin.mjs           Seed/upsert an admin_users row
docs/                      Project knowledge center — read this folder
.github/workflows/         GitHub Actions (build + deploy on push to main)
Dockerfile                 Multi-stage production image
docker-compose.yml         Production stack (app + postgres + caddy + backup)
docker-compose.dev.yml     Postgres-only for local dev
Caddyfile                  Production reverse proxy + auto-TLS
drizzle.config.ts          Migrations output to ./drizzle/
drizzle/                   Generated SQL migrations (committed)
```

## Where to read next

The `docs/` folder is organized so each role gets what they need first:

- **Editing public copy?** [`docs/context/tone-of-voice.md`](docs/context/tone-of-voice.md) — the Indonesian-formal voice is locked.
- **Touching visuals?** [`docs/design/`](docs/design/) — color, typography, components, copy style. Brand is locked too.
- **Adding a feature?** [`docs/current-state/tech-stack.md`](docs/current-state/tech-stack.md) for the lay of the land, then the matching `docs/current-state/*` file.
- **Curious what's coming?** [`docs/roadmap/mvp-priorities.md`](docs/roadmap/mvp-priorities.md), [`admin-dashboard.md`](docs/roadmap/admin-dashboard.md), [`infrastructure.md`](docs/roadmap/infrastructure.md), [`data-model.md`](docs/roadmap/data-model.md).
- **Provisioning prod?** [`docs/current-state/deployment.md`](docs/current-state/deployment.md).

Index: [`docs/README.md`](docs/README.md).

## Contributing

- Branch from `main`, push to your branch, open a PR.
- **Start from a ticket.** Every change has a `SAKEM-NNN` ticket in Saung (ask a maintainer for access). Put the ID in commit messages (`fix(map): align legend (SAKEM-NNN)`) and in the PR description. Tickets are not stored in this repo — see [`CLAUDE.md`](CLAUDE.md).
- Use conventional-commit prefixes when it helps (`feat:`, `fix:`, `docs:`, `build:`, `ci:`). Mixed style is fine; check `git log` for examples.
- **If your change is structural** (new route, new dep, new deploy step, new data model), update the relevant file under `docs/current-state/` in the same PR. Stale docs are worse than missing docs.
- **Preserve tone and visuals.** Don't rewrite Indonesian copy or shift colors/fonts/spacing without product sign-off — see [`docs/context/tone-of-voice.md`](docs/context/tone-of-voice.md) and [`docs/design/visual-identity.md`](docs/design/visual-identity.md).
- No automated tests yet; verify changes manually in the browser before pushing.

## Ownership

Private project for **Yayasan Sakola Kembara Indonesia**. Code and content are not licensed for outside use without permission.
