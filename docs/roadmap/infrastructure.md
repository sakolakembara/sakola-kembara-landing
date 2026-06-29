# Infrastructure & Data — Decision Sketch

> This doc locks in the **infra picks** for the upcoming admin dashboard and dynamic features. Data models live in a separate (forthcoming) doc; concrete configs (`.env.example`, `docker-compose.yml`, Dockerfile, Drizzle schema) come after the picks here are agreed.

## Locked decisions

| Concern | Pick | Status |
| --- | --- | --- |
| **Hosting** | **Small VPS running Docker Compose** (Hetzner / DigitalOcean / Contabo) | ✅ locked |
| **Reverse proxy + TLS** | **Caddy** in the same Compose stack (auto Let's Encrypt) | ✅ locked |
| **CI/CD** | **GitHub Actions** → build image → push to GHCR → SSH `docker compose pull && up -d` | ✅ locked |
| **Relational DB** | **PostgreSQL 16** as a service in the Compose stack | ✅ locked |
| **ORM / migrations** | **Drizzle ORM + drizzle-kit** | ✅ locked |
| **Local dev DB** | **`docker-compose.dev.yml`** with the Postgres service only; Next runs on the host | ✅ locked |
| **File storage (MVP)** | **`public/` mounted as a persistent volume** on the VPS. PDFs and blog hero images live there; all assets are public-by-design. | ✅ locked |
| **Error monitoring** | **Sentry** (free tier) | ✅ locked |
| **Env validation** | **Zod** behind a `lib/env.ts` helper, validated at boot | ✅ locked |
| **Backups** | Daily `pg_dump` cron in a sidecar container → offsite copy (B2 / R2 free-tier bucket) | ✅ locked |
| **Transactional email** | **Deferred** — LMS team owns email | ⏸ deferred |
| **Cache / Redis** | Not needed at MVP scale | ❌ skip |
| **Background jobs** | Not needed at MVP scale | ❌ skip |
| **Feature flags / analytics** | Not needed | ❌ skip |

> **cPanel is gone.** All `scripts/cpanel-*`, `scripts/deploy-cpanel.*`, `scripts/generate-ssh-key.sh`, and `scripts/credentials/` were deleted from the repo, and the matching npm scripts were removed from `package.json`. There is **one production deploy target** going forward: a VPS running Docker Compose.

## What goes in Postgres, what stays in markdown

**Stays in markdown / git (`content/blog/*.md`)**: the blog. Markdown-in-git is a good fit — version history, PR review, no DB hit per page view, the scrape/sync pipeline already works. The dashboard's blog editor writes back to `content/blog/<slug>.md` (and triggers the equivalent of `npm run blog:sync` in-process) rather than moving content into a `posts` table.

**Moves to Postgres** (dashboard-managed, churn-heavy):

- **`student_applications`** — submissions from the on-site `/gabung-siswa` form; status (pending / accepted / rejected); review notes.
- **`announcements`** — admin-published strip on the homepage; title, body, severity, start/end time, active flag.
- **`reports`** — PDF metadata only (year, category, title, file path under `/reports/...`, uploaded-by, uploaded-at). The PDF itself is a file under `public/reports/`.
- **`admin_users`** — email + role; populated on first sign-in via Microsoft Entra ID. See [`admin-dashboard.md`](admin-dashboard.md).
- **`audit_log`** — every admin mutation (who did what, when, to which row). Cheap insurance.

Schemas for these will live in `docs/roadmap/data-model.md` (not yet written).

> Auth.js sessions stay JWT-only — **no `sessions` table needed**.

## File storage — the simple plan

For MVP, **every uploaded file lives under `public/`** and is publicly accessible by URL:

| File | Path | Source |
| --- | --- | --- |
| Blog hero images | `public/blog/images/<year>/<month>/...` | Scrape pipeline (existing); future dashboard uploads write here |
| Report PDFs | `public/reports/<year>/<category>/<slug>.pdf` | Dashboard upload |
| Org assets (logo, hero, QRIS) | `public/images/...` | Committed to git |

On the VPS, **`public/` is mounted as a Docker volume**. Uploads from the dashboard land in the container's `/app/public/...`, persist on the host across container restarts, and survive deploys (the volume is *not* part of the image). New images don't need a redeploy to show up.

```
host: /var/lib/sakem/public/    ←→   container: /app/public/
```

The container is rebuilt and replaced on deploy; the **volume mount overlays** the image's baked-in `public/` so dashboard uploads remain. Files baked into the image at build time (`public/images/logo-sakola-kembara.png`, etc.) populate the volume on first start and don't get clobbered by later deploys.

This avoids S3/R2 SDKs, IAM, signed URLs, and CORS — none of which we need while every file is public anyway. **Migrate to object storage if and when** we ever need user-uploaded *private* files.

## Local development

`docker-compose.dev.yml` at project root with **only** a `postgres` service:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: sakola_kembara
      POSTGRES_USER: sakem
      POSTGRES_PASSWORD: sakem_dev
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

Devs run:

```bash
docker compose -f docker-compose.dev.yml up -d    # start Postgres
npm run db:migrate                                # drizzle-kit migrate
npm run dev                                       # next dev on the host
```

**Why Next.js stays on the host for dev:** hot reload is meaningfully faster outside Docker on macOS/Windows (file watching across the VM boundary is slow), and there's no isolation benefit.

## Production stack (Compose on the VPS)

`docker-compose.yml` at project root:

```yaml
services:
  app:
    image: ghcr.io/sakolakembara/sakola-kembara-landing:latest
    restart: unless-stopped
    env_file: .env.production
    depends_on: [postgres]
    volumes:
      - app_public:/app/public

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [app]

  backup:
    image: postgres:16-alpine
    restart: unless-stopped
    depends_on: [postgres]
    volumes:
      - backups:/backups
    entrypoint: >
      sh -c "while true; do
        PGPASSWORD=$$POSTGRES_PASSWORD pg_dump -h postgres -U $$POSTGRES_USER $$POSTGRES_DB
          | gzip > /backups/sakem-$$(date +%Y%m%d-%H%M).sql.gz;
        find /backups -name 'sakem-*.sql.gz' -mtime +14 -delete;
        sleep 86400;
      done"
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}

volumes:
  app_public:
  postgres_data:
  caddy_data:
  caddy_config:
  backups:
```

`Caddyfile`:

```
sakolakembara.org {
  reverse_proxy app:3000
  encode gzip zstd
}
```

That's the whole production setup. Caddy handles TLS automatically against Let's Encrypt. The `backup` sidecar dumps Postgres daily and prunes >14-day-old dumps. A cron on the host (or a tiny systemd timer) rsyncs `/var/lib/sakem/backups/` to an offsite B2/R2 bucket once a day.

## Dockerfile (sketch)

Multi-stage build off `output: "standalone"` in `next.config.ts`:

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

Final image ≈ 150 MB.

## CI/CD (GitHub Actions, sketch)

`.github/workflows/deploy.yml`:

1. On push to `main`: checkout → `docker buildx build` with cache → push to **GHCR** (private repo, free).
2. SSH into the VPS as a non-root deploy user → `cd /opt/sakem && docker compose pull app && docker compose up -d app`.
3. Run `docker compose exec app node ./node_modules/.bin/drizzle-kit migrate` for schema changes.

VPS secrets in GitHub: `SSH_HOST`, `SSH_USER`, `SSH_KEY`. Image registry creds use the built-in `GITHUB_TOKEN`.

## VPS provisioning (one-time)

Recommended target: **Hetzner CX22** (€4.59/mo, 2 vCPU, 4 GB RAM, 40 GB SSD) or **DigitalOcean Basic** ($6/mo). Hetzner is the value pick.

Steps (run once, ideally codified later as an Ansible playbook):

1. Ubuntu 24.04 LTS, SSH keys only, root login disabled.
2. `ufw` allow 22/80/443, deny everything else.
3. `unattended-upgrades` + `fail2ban`.
4. Non-root `deploy` user in the `docker` group.
5. Install Docker Engine + Docker Compose plugin.
6. `mkdir -p /opt/sakem` for the Compose project, `/var/lib/sakem/backups` for the backup volume's host path.
7. Copy `docker-compose.yml`, `Caddyfile`, `.env.production` to `/opt/sakem`.
8. `docker compose up -d`.
9. Point DNS A record → VPS IP. Caddy auto-issues the cert on first request.

## ORM: Drizzle, not Prisma

Both work. Drizzle wins for us because:

- **Schema in TS, queries in TS** — no separate Prisma schema language. Migrations are SQL we can read and `psql` against directly.
- **Edge-compatible** — Next 16 server actions on the edge runtime work; Prisma needs a separate edge build.
- **Lighter** — no Prisma Client generation step; `drizzle-kit push` / `generate` is the whole CLI.
- **SQL-flavored API** — easier to onboard anyone with SQL background; less "ORM magic" to learn.

Tradeoff acknowledged: Prisma's migration story is more polished and its ecosystem (Studio, Accelerate) is broader. We don't need those at MVP scale.

## Error monitoring: Sentry

`@sentry/nextjs` with the Next 16 integration. Hook it into:

- All admin server actions and API routes (`/api/admin/*`).
- The public site too (client-side render errors, hydration mismatches, image-load failures).

Use environment-tagged releases. PII scrubbing on by default — student-application data must never leak into Sentry events.

## Env validation: Zod

A single `lib/env.ts` reads `process.env` through a Zod schema and exports a typed `env` object. Boot fails loudly if any required var is missing or malformed.

```ts
// lib/env.ts (sketch)
import { z } from "zod";
const schema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(32),
  AUTH_MICROSOFT_ENTRA_ID_ID: z.string().min(1),
  AUTH_MICROSOFT_ENTRA_ID_SECRET: z.string().min(1),
  AUTH_MICROSOFT_ENTRA_ID_TENANT_ID: z.string().uuid(),
  AUTH_TRUST_HOST: z.coerce.boolean().optional(),
  NEXTAUTH_URL: z.string().url(),
  SENTRY_DSN: z.string().url().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});
export const env = schema.parse(process.env);
```

Import `env` (not `process.env`) throughout the codebase.

## What's in scope for the next round of writing

Once these decisions are agreed, the follow-up artifacts are:

1. **`.env.example`** at the project root — all keys above.
2. **`docker-compose.dev.yml`** — Postgres-only for local dev.
3. **`docker-compose.yml`** + **`Caddyfile`** + **`Dockerfile`** — the production stack.
4. **`.github/workflows/deploy.yml`** — CI/CD.
5. **`docs/roadmap/data-model.md`** — Drizzle schemas.
6. **`lib/env.ts`** + **`lib/db.ts`** — first code change toward the new stack.
7. Update `docs/current-state/tech-stack.md` and `docs/current-state/deployment.md` as each lands.

## What this doc does NOT cover

- **Schemas** for the new tables (next doc).
- **CDN / image optimization** — sticking with `next/image` (with `unoptimized` for external URLs) and Caddy's gzip/zstd for now.
- **Monitoring beyond Sentry** — basic VPS health (CPU/RAM/disk) can ride on free tiers of UptimeRobot / Healthchecks.io until it hurts.
- **Rate limiting** on `/api/admin/*` — Auth-gated, low-traffic; skip until needed.
- **GDPR / data retention** policy for student applications — needs a product-level decision before implementation.
