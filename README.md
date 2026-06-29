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
- **PostgreSQL 16 + Drizzle ORM** for the upcoming admin dashboard
- Auth (forthcoming): **Microsoft Entra ID**, gated to `@sakolakembara.org`
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
#    The Microsoft Entra ID vars become required only when /admin wires up;
#    you can leave them blank until then if no code path imports lib/db.ts.

# 4. Start the local Postgres container
npm run db:up

# 5. Generate + apply the initial Drizzle migration (first time only)
npm run db:generate
npm run db:migrate

# 6. Start the dev server
npm run dev
```

Open <http://localhost:3000>.

Routes worth visiting once it's running: `/`, `/blog`, `/donasi`, `/gabung-siswa`, `/kontak`, `/tim`, `/program/pembinaan`.

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

### Blog content

The blog is markdown under `content/blog/`. After editing any post or adding a new one, regenerate the JSON cache:

| Command | What it does |
| --- | --- |
| `npm run blog:sync` | Regenerate `lib/blog-posts.json` from `content/blog/*.md` |
| `npm run scrape:blog` | Re-scrape posts + images from the legacy WordPress site (rare) |

Commit both the markdown and the regenerated `lib/blog-posts.json` together. Full pipeline details in [`docs/current-state/blog-pipeline.md`](docs/current-state/blog-pipeline.md).

## Repo tour

```
app/                       Next App Router pages
  layout.tsx               Root metadata, fonts, <html lang="id">
  page.tsx                 Homepage: Hero → Problem → Activities → Impact → Partners → CTA → News
  blog/, donasi/, kontak/, tim/, gabung-siswa/, program/[id]/
components/                React components
  Navbar.tsx, Footer.tsx, SocialLinks.tsx
  Map/GISMap.tsx           Leaflet, dynamically imported (ssr: false)
  blog/BlogPostContent.tsx Markdown renderer
  sections/                Homepage + reusable sections
lib/
  data.ts                  All hard-coded site copy & data (programs, partners, stats, …)
  blog.ts                  Blog reader API
  blog-posts.json          Generated from content/blog/
  env.ts                   Zod-validated env (throws on boot if anything's missing)
  db.ts                    Drizzle + pg.Pool client
  db/schema/               Table definitions
content/blog/              Markdown source for all blog posts (one file per post)
public/                    Logo, hero photo, QRIS, blog images
scripts/                   Blog pipeline (markdown sync, WP scrape)
docs/                      Project knowledge center — read this folder
.github/workflows/         GitHub Actions (build + deploy on push to main)
Dockerfile                 Multi-stage production image
docker-compose.yml         Production stack (app + postgres + caddy + backup sidecar)
docker-compose.dev.yml     Postgres-only for local dev
Caddyfile                  Production reverse proxy + auto-TLS
drizzle.config.ts          Migrations output to ./drizzle/
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
- Use conventional-commit prefixes when it helps (`feat:`, `fix:`, `docs:`, `build:`, `ci:`). Mixed style is fine; check `git log` for examples.
- **If your change is structural** (new route, new dep, new deploy step, new data model), update the relevant file under `docs/current-state/` in the same PR. Stale docs are worse than missing docs.
- **Preserve tone and visuals.** Don't rewrite Indonesian copy or shift colors/fonts/spacing without product sign-off — see [`docs/context/tone-of-voice.md`](docs/context/tone-of-voice.md) and [`docs/design/visual-identity.md`](docs/design/visual-identity.md).
- No automated tests yet; verify changes manually in the browser before pushing.

## Ownership

Private project for **Yayasan Sakola Kembara Indonesia**. Code and content are not licensed for outside use without permission.
