# Deployment

> **Status: planned, in transition.** The repo previously deployed to shared cPanel; those scripts (`scripts/cpanel-*`, `scripts/deploy-cpanel.*`, `scripts/generate-ssh-key.sh`) have all been removed and we are migrating to a **VPS running Docker Compose**. This doc describes the target setup. Until it ships, there is no working production deploy in the repo — `npm run build` + `node .next/standalone/server.js` is enough to verify production behavior locally.

The target deploy is defined in detail in [`../roadmap/infrastructure.md`](../roadmap/infrastructure.md). This doc is the operator-facing reference — what runs where, how a deploy happens day-to-day.

## Target host

- **Single VPS** (Hetzner CX22 or DigitalOcean Basic class — ~€5/mo, 2 vCPU, 4 GB RAM, 40 GB SSD).
- Ubuntu 24.04 LTS.
- Docker Engine + Docker Compose plugin.
- One non-root `deploy` user in the `docker` group.
- `ufw` firewall: 22 / 80 / 443 only.

## Stack on the VPS

Defined by a single `docker-compose.yml` at `/opt/sakem/` on the host. Four services:

| Service | Image | Role |
| --- | --- | --- |
| **`app`** | `ghcr.io/sakolakembara/sakola-kembara-landing:latest` | Next.js standalone server, port 3000 (internal) |
| **`postgres`** | `postgres:16-alpine` | App database |
| **`caddy`** | `caddy:2-alpine` | Reverse proxy + auto Let's Encrypt TLS, binds 80/443 |
| **`backup`** | `postgres:16-alpine` | Sidecar that runs `pg_dump` daily, prunes >14-day dumps |

Persistent named volumes:

- `app_public` — mounted into `app:/app/public`. Holds dashboard-uploaded files (PDFs, blog hero images, etc.). Survives container rebuilds and deploys.
- `postgres_data` — Postgres data dir.
- `caddy_data` / `caddy_config` — TLS certs + Caddy state.
- `backups` — daily `pg_dump` output.

DNS: A record for `sakolakembara.org` → VPS public IP. Caddy issues the cert on first request.

## How a deploy happens

Pushed to `main` → **GitHub Actions** does the work. `.github/workflows/deploy.yml`:

1. `docker buildx build` the image (with cache).
2. Push to **GHCR** (`ghcr.io/sakolakembara/sakola-kembara-landing:latest` + an immutable SHA tag).
3. SSH to the VPS as `deploy@vps`:
   ```bash
   cd /opt/sakem
   docker compose pull app
   docker compose up -d app
   ```
4. If a Drizzle migration is pending:
   ```bash
   docker compose exec app node ./node_modules/.bin/drizzle-kit migrate
   ```

Total downtime: ~5 seconds during the container swap (Caddy holds the connection briefly while `app` restarts).

## Manual ops cheat sheet

SSH'd into the VPS as `deploy@vps`, all commands from `/opt/sakem`:

```bash
# Pull latest image and restart only the app
docker compose pull app && docker compose up -d app

# Tail app logs
docker compose logs -f app

# Tail everything
docker compose logs -f

# Open a psql shell
docker compose exec postgres psql -U sakem sakola_kembara

# Manual backup right now
docker compose exec backup sh -c '
  PGPASSWORD=$POSTGRES_PASSWORD pg_dump -h postgres -U $POSTGRES_USER $POSTGRES_DB
    | gzip > /backups/sakem-manual-$(date +%Y%m%d-%H%M).sql.gz
'

# Restore from a backup
docker compose exec -T postgres sh -c 'gunzip | psql -U sakem sakola_kembara' < /var/lib/sakem/backups/sakem-20260115-0300.sql.gz

# Restart everything (clean)
docker compose down && docker compose up -d

# Check disk usage of volumes
docker system df -v
```

## Environment variables

> This section describes what the current deploy (`.github/workflows/deploy.yml` + `compose.yml`) does. The `/opt/sakem/.env.production` file of the Caddy stack described earlier on this page is the superseded plan.

**The server's `.env.local` is generated, and overwritten on every deploy.** The `ENV_FILE_CONTENT` block in `.github/workflows/deploy.yml` is written to `.env.local` next to `compose.yml` (mode 600) at the end of each run, and the app container reads it through `env_file`. Anything edited by hand on the VPS is lost on the next deploy. To change a value, change it in the **`production` environment** of the GitHub repo (Settings → Environments → `production`, "Variables" or "Secrets") and deploy again; the container reads the file only when it starts, so a change takes effect once the deploy has recreated it. To add a variable the app reads, add a line to the block as well, otherwise the value never reaches the server.

A variable or secret that is **not set** in the environment becomes an empty `KEY=` line. `lib/env.ts` treats an empty value as unset, so a missing optional value switches its feature off instead of stopping the app. A value that **is** set but malformed (see "Shape" below) fails validation and the container exits at boot with `Invalid environment variables` in `docker compose logs app`.

Written by the workflow (names only; values live in GitHub):

| Variable | Kind | Needed? | Shape | If blank |
| --- | --- | --- | --- | --- |
| `NODE_ENV`, `AUTH_TRUST_HOST`, `PORT` | fixed in the workflow | yes | — | — |
| `NEXTAUTH_URL` | variable | **required** | full URL | app does not boot |
| `AUTH_URL` | variable | optional | full URL | Auth.js uses the request's own host (`AUTH_TRUST_HOST=true`); when set it overrides the request origin. It does not fall back to `NEXTAUTH_URL`. |
| `DATABASE_URL` | secret | **required** | Postgres URL, host `postgres_16` on the `ipat-bridge` network | app does not boot |
| `AUTH_SECRET` | secret | **required** | at least 32 characters | app does not boot |
| `AUTH_GOOGLE_ID` | variable | for Google sign-in | non-empty | no Google button |
| `AUTH_GOOGLE_SECRET` | secret | for Google sign-in | non-empty | no Google button (both Google values are needed) |
| `SSO_JWT_SECRET` | secret | for the LMS handshake | at least 32 characters, same value as the LMS | SSO cookie is never created |
| `SSO_COOKIE_DOMAIN` | variable | for the LMS handshake | must start with a dot | host-only cookie, the LMS does not see it |
| `SSO_ALLOWED_ORIGINS` | variable | for the LMS handshake | comma-separated origins, no wildcard | `POST /api/sso/register` and `/signout` reject every request (fails closed in production) |
| `RESEND_API_KEY` | secret | for email | non-empty | verification and reset emails are not sent; the flows report failure |
| `EMAIL_FROM` | variable | optional | `Name <address>`, no surrounding quotes | falls back to the Resend sandbox sender |
| `APP_URL` | variable | optional | full URL | links in emails use `NEXTAUTH_URL` |
| `PUBLIC_API_SHARED_SECRET` | secret | for the Astro site's contact form (Cloudflare migration, phase 1) | at least 32 characters, same value as the secret on the Worker | `POST /api/public/contact` answers 503; the rest of the app is unaffected. See [`../cloudflare/content-api.md`](../cloudflare/content-api.md). |
| `SENTRY_DSN` | secret | optional | URL | server-side error reporting is off |

Secret values must not contain `$` or start and end with quotes: Compose parses `env_file` and would alter them.

Read by other steps of the workflow, not written to `.env.local`: `DOCKERHUB_TOKEN` and `DATABASE_URL_CI` (secrets, used to push the image and to run migrations from the runner) and the `DEPLOY_SSH_*` connection settings.

Not in the block on purpose: `SEED_SUPER_ADMIN_*` (read only by the one-off `seed:super-admin` script, not by the running app), `POSTGRES_*` (used only by the Caddy stack's `docker-compose.yml`), and `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (build-time only; the Docker build does not receive them). Variables of the old Microsoft Entra ID sign-in and the SharePoint integration are gone from the code and from the block.

How these variables are used: [`../architecture/authentication.md`](../architecture/authentication.md) (Google), [`../architecture/lms-integration.md`](../architecture/lms-integration.md) and [`../runbook/sso-email-launch.md`](../runbook/sso-email-launch.md) (SSO and email). `.env.example` at the repo root is the template for local development only.

## Client IP and rate limiting

`lib/rate-limit.ts` buckets requests by client IP. The app cannot read the socket address, so it depends on headers set by the proxy chain in front of it.

Production as deployed (`compose.yml`, `.github/workflows/deploy.yml`): Cloudflare → `nginx-app-1` on the `ipat-bridge` network → `sakola-kembara-landing:3000`. The nginx config lives on the server, not in this repo. The Caddy stack in `docker-compose.yml` is the earlier target described above.

The client IP is taken from, in order:

1. `CF-Connecting-IP`, which Cloudflare sets on every request it forwards.
2. The **rightmost** `X-Forwarded-For` entry: the address the nearest proxy saw as its peer. Fallback for setups without Cloudflare (the Caddy stack, a local proxy).
3. Neither: one shared `unknown` bucket for all such requests, and a one-time warning in the app log (`[rate-limit] no cf-connecting-ip / x-forwarded-for ...`). Seeing that line in production means the proxy chain is not passing the headers through.

The left side of `X-Forwarded-For` and `X-Real-IP` are never used: proxies append to what the client sent, so those values are not set by infrastructure.

What must be true on the server for this to hold:

- The origin accepts web traffic from Cloudflare only (firewall or nginx allow-list of Cloudflare ranges). A request that reaches the origin another way can carry any `CF-Connecting-IP`.
- nginx passes `CF-Connecting-IP` through to the app unchanged, and sets or appends `X-Forwarded-For` (`$proxy_add_x_forwarded_for`).
- Cloudflare's "Remove visitor IP headers" managed transform stays off.
- The app container is reachable only through nginx (`compose.yml` publishes no host port).

## Offsite backup

A cron on the VPS host (not inside any container):

```cron
30 3 * * * rclone copy /var/lib/sakem/backups/ b2:sakem-backups/postgres/ --min-age 5m
```

Daily at 03:30, rsync new dumps into a Backblaze B2 (or Cloudflare R2) bucket. The bucket has lifecycle rules to expire dumps after 90 days. The B2/R2 credentials live in the deploy user's `~/.config/rclone/rclone.conf`.

## Rollback

GHCR keeps every tagged image. To roll back:

```bash
cd /opt/sakem
sed -i 's/:latest/:sha-abc1234/' docker-compose.yml   # or edit by hand
docker compose pull app
docker compose up -d app
```

If a migration broke prod, restore the latest `pg_dump` (see ops cheat sheet) before rolling the image back.

## Local production smoke test (no VPS needed)

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres only
npm run build
node .next/standalone/server.js                  # serves on :3000
```

This is what every dev should do before pushing a release.

## What is NOT in this flow

- **No staging environment yet.** When the dashboard goes live, add a `staging.sakolakembara.org` either on the same VPS (separate Compose project) or a tiny second VPS.
- **No blue/green or zero-downtime deploys.** The ~5-second swap is fine for a non-profit's traffic; revisit if it becomes user-visible.
- **No automated host provisioning.** Initial VPS setup is documented in [`../roadmap/infrastructure.md`](../roadmap/infrastructure.md); codify as Ansible / cloud-init if we ever need to recreate the host quickly.
- **No CDN.** Caddy serves everything directly. Add Cloudflare in front of `sakolakembara.org` if international traffic matters.
- **No hosted Storybook.** `.github/workflows/storybook.yml` only builds it; people run it locally (`pnpm storybook`). Publishing to GitHub Pages needs a repo admin to enable Pages (Source: GitHub Actions) and allow `development` in the `github-pages` environment, plus an upload-and-deploy job in that workflow.
- **No secrets manager.** `.env.production` on disk is enough at MVP scale. Move to Doppler / 1Password CLI / Bitwarden Secrets when the team grows.
