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

Live in `/opt/sakem/.env.production` on the VPS (mode 600, owned by `deploy`). Same shape as `.env.example` at the repo root. Includes:

- `DATABASE_URL` → `postgres://sakem:<password>@postgres:5432/sakola_kembara` (note the hostname is the Compose service name).
- `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_TRUST_HOST=true`, `NEXTAUTH_URL=https://sakolakembara.org` — see [`../architecture/authentication.md`](../architecture/authentication.md).
- `SEED_SUPER_ADMIN_EMAIL`, `SEED_SUPER_ADMIN_PASSWORD`, `SEED_SUPER_ADMIN_NAME` — only needed while bootstrapping the first admin (`npm run seed:super-admin`). Safe to remove from the file after Phase 6 of the launch runbook.
- `SENTRY_DSN`.
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` for the `postgres` + `backup` services.

`.env.production` is **never** committed; it's hand-edited on the server. The repo carries only `.env.example`.

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
- **No secrets manager.** `.env.production` on disk is enough at MVP scale. Move to Doppler / 1Password CLI / Bitwarden Secrets when the team grows.
