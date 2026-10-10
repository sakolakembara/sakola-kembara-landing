# Launch Runbook — sakolakembara.org

> **Scope.** This is the chronological recipe to take a freshly-provisioned VPS to a live, indexed `sakolakembara.org` on the new Next.js stack. Steady-state operations (deploys, restarts, backups) are in [`../current-state/deployment.md`](../current-state/deployment.md) — don't duplicate that here.
>
> **Audience.** Whoever is doing the cutover. Expects shell comfort, but no Docker / Next.js / Azure expertise — every step is spelled out.
>
> **Expected time.** ~4 hours of attended work spread over two sessions: ~2.5 hours for Phases 1–6 (provisioning + first deploy to staging subdomain), then ~1.5 hours on cutover day for Phases 8–10. Add buffer for waiting on DNS TTLs.

---

## Phase 0 — Things you must have before starting

Gather all of these before touching the VPS. Stopping halfway to chase a credential is how outages happen.

- [ ] **Domain registrar access** for `sakolakembara.org` (Niagahoster / Cloudflare / wherever). You will edit A and CNAME records.
- [ ] **VPS provider account** with billing set up (Hetzner / DigitalOcean / Contabo). Target spec: ~€5/mo, 2 vCPU, 4 GB RAM, 40 GB SSD, Ubuntu 24.04 LTS. See [`../roadmap/infrastructure.md`](../roadmap/infrastructure.md#target-host).
- [ ] **Google Cloud project** where you can create an OAuth 2.0 client (Phase 2). Any Google account with owner/editor on a project works — no organizational Workspace required.
- [ ] **Super-admin bootstrap credentials** — pick an email + a strong password (min 8 chars) for the very first admin. These go into `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` and are used exactly once in Phase 6 to create the first sign-in-able account.
- [ ] **GitHub admin access** to the `sakola-kembara-landing` repo. You need to add Actions secrets (Phase 3).
- [ ] **SSH keypair** for the VPS deploy user. Generate with `ssh-keygen -t ed25519 -C deploy@sakem` and keep the private half safe.
- [ ] **Backblaze B2 or Cloudflare R2 account** for offsite backups (optional but recommended). Create a bucket + an access key with write-only scope to that bucket.
- [ ] **Final assets ready to swap in**: team photos under `public/images/team/`, program photos under `public/images/programs/`, real testimonials, real `impactMetrics` numbers. See [Phase 7](#phase-7--content-swap-do-before-cutover).
- [ ] **A maintenance window communicated** to whoever maintains the current WordPress site, IT, and the marketing/admin team. ~1 hour, scheduled for off-peak.
- [ ] **Decision: are you cutting over from the current WordPress site, or starting fresh on a subdomain?** This runbook assumes a full cutover. If you want to soft-launch first, do every phase but Phase 9 against `staging.sakolakembara.org`, then re-do Phase 9 only when ready.

---

## Phase 1 — VPS provisioning

### 1.1 Spin up the box

Create an Ubuntu 24.04 LTS VPS at the chosen provider. Pick a region close to your audience (Singapore for Indonesia is fine). Note the public IPv4 — you'll use it in Phase 5.

Add your SSH key to root login during provisioning so you can shell in without password.

### 1.2 First-touch hardening

SSH in as `root` once, then never again.

```bash
# Update the box
apt update && apt upgrade -y

# Create a non-root deploy user
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy

# Install the deploy user's SSH key (paste the public half generated in Phase 0)
mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
echo "ssh-ed25519 AAAA... deploy@sakem" > /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh

# Lock down SSH: disable root login + password auth
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# Firewall: SSH + HTTP + HTTPS only
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Optional but recommended: install unattended-upgrades for security patches
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

Open a **second terminal** and confirm `ssh deploy@<vps-ip>` works before closing the root session. If you can't get back in, you've locked yourself out.

### 1.3 Install Docker

As `deploy@vps`:

```bash
# Docker repo
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Allow deploy user to run docker without sudo
sudo usermod -aG docker deploy
```

**Log out and back in** so the group change takes effect. Verify:

```bash
docker run --rm hello-world
docker compose version    # should print v2.x.x
```

### 1.4 Create the deploy directory

```bash
sudo mkdir -p /opt/sakem
sudo chown deploy:deploy /opt/sakem
cd /opt/sakem
```

You'll populate this directory in Phase 4.

---

## Phase 2 — Google OAuth client

This is the one piece that *cannot* be automated by code. Do it once in the Google Cloud Console. The detailed walkthrough is in [`../roadmap/admin-dashboard.md`](../roadmap/admin-dashboard.md) — re-summarised here so you don't context-switch.

1. **Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID**. Pick or create a Cloud project first (a bare project with no APIs enabled is fine).
2. If prompted, configure the **OAuth consent screen**:
   - User type: **External** (unless you have a Workspace org, then Internal).
   - App name: `Sakola Kembara`.
   - Support + developer contact: an address someone actually reads.
   - Scopes: leave at the defaults (`openid`, `email`, `profile`) — Auth.js adds these automatically.
   - **Publishing status**: while in `Testing`, only users added under "Test users" can sign in. Click **Publish app** before real students start signing up. Google may ask for verification; for a small non-profit with only the default scopes, verification is usually not required.
3. Back on **Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Name: `Sakola Kembara Production`.
   - **Authorized redirect URIs** (add both):
     - `https://sakolakembara.org/api/auth/callback/google`
     - `http://localhost:3000/api/auth/callback/google` (dev)
4. Copy the **Client ID** and **Client secret** into a password manager. You will paste them into `.env.production` in Phase 4 as `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

> **If you're deploying to a staging subdomain first (Phase 5)**, also add `https://staging.sakolakembara.org/api/auth/callback/google` as a redirect URI now, or you'll bounce back to Phase 2 mid-way through the staging test.

---

## Phase 3 — GitHub Actions secrets

The deploy workflow (`.github/workflows/deploy.yml`) builds the image, pushes to GHCR, then SSHes to the VPS. It needs three secrets.

**Repo → Settings → Secrets and variables → Actions → New repository secret:**

| Secret | Value |
| --- | --- |
| `VPS_HOST` | VPS public IPv4, e.g. `203.0.113.42` |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | The **private** half of the keypair you put in `/home/deploy/.ssh/authorized_keys` |
| `VPS_SSH_PORT` | Only if you moved SSH off 22; otherwise skip |

GHCR auth uses the workflow's built-in `GITHUB_TOKEN` — no extra secret needed. Verify package writes are allowed in **Settings → Actions → General → Workflow permissions → "Read and write permissions"**.

> Don't paste the private key into the secret with a trailing newline. The `appleboy/ssh-action` is sensitive to it. Use `cat ~/.ssh/sakem_deploy_ed25519 | pbcopy` (or `xclip`), paste, then strip trailing whitespace in the GitHub UI.

---

## Phase 4 — `.env.production` on the VPS

The compose stack reads `/opt/sakem/.env.production`. The repo carries only `.env.example`; the production file is hand-edited on the server and **never** committed.

As `deploy@vps`:

```bash
cd /opt/sakem

# Copy the compose + Caddyfile from the repo. Use either:
#   (a) scp them from your laptop, or
#   (b) curl them from a tagged release on GitHub:
curl -fsSL https://raw.githubusercontent.com/sakolakembara/sakola-kembara-landing/main/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/sakolakembara/sakola-kembara-landing/main/Caddyfile -o Caddyfile
curl -fsSL https://raw.githubusercontent.com/sakolakembara/sakola-kembara-landing/main/.env.example -o .env.production

chmod 600 .env.production
```

Edit `.env.production` and fill every value:

```bash
nano .env.production
```

Required values, with sources:

```dotenv
NODE_ENV=production
NEXTAUTH_URL=https://sakolakembara.org
AUTH_TRUST_HOST=true

# Database — make POSTGRES_PASSWORD strong; the app reads it via DATABASE_URL
DATABASE_URL=postgres://sakem:CHANGE_ME_LONG_PASSWORD@postgres:5432/sakola_kembara
POSTGRES_DB=sakola_kembara
POSTGRES_USER=sakem
POSTGRES_PASSWORD=CHANGE_ME_LONG_PASSWORD   # must match the password in DATABASE_URL

# Auth.js — rotate AUTH_SECRET to invalidate every session
AUTH_SECRET=               # generate with: openssl rand -base64 32
AUTH_GOOGLE_ID=            # from Phase 2 step 4 — OAuth client ID
AUTH_GOOGLE_SECRET=        # from Phase 2 step 4 — OAuth client secret

# Super-admin seed — used ONCE in Phase 6 to bootstrap the first admin row.
# You can wipe these values from the file after Phase 6 succeeds.
SEED_SUPER_ADMIN_EMAIL=     # e.g. admin@sakolakembara.org
SEED_SUPER_ADMIN_PASSWORD=  # min 8 chars; will be bcrypt-hashed at seed time
SEED_SUPER_ADMIN_NAME=      # display name; optional (defaults to email local-part)

# Observability — leave SENTRY_DSN blank if not wiring Sentry yet
SENTRY_DSN=

# SSO + transactional email (LMS integration) — leave blank for a
# main-site-only launch. When you're ready to wire the LMS integration
# and self-service email flows, follow the focused runbook at
# ./sso-email-launch.md. Those vars are SSO_JWT_SECRET,
# SSO_COOKIE_DOMAIN, SSO_ALLOWED_ORIGINS, RESEND_API_KEY, EMAIL_FROM,
# APP_URL. The SSO code paths are dormant when these are unset. Email is not:
# in production without RESEND_API_KEY, verification and reset emails are
# not sent and the flows report failure.
```

Generate `AUTH_SECRET` on the VPS so it never lands on your laptop:

```bash
openssl rand -base64 32
```

Paste that into the file. Save and exit.

> The `POSTGRES_PASSWORD` in this file is also the one Postgres bootstraps the DB user with on first start. **Setting it later doesn't change the existing DB user's password.** Pick a strong value here before Phase 5.

---

## Phase 5 — First deploy (against a staging subdomain)

You'll deploy onto the VPS now, but DNS still points at the old WordPress site, so real users are unaffected. We'll use a `staging.sakolakembara.org` subdomain to test before the apex cutover.

### 5.1 Staging DNS

In the domain registrar:

- **A `staging.sakolakembara.org` → \<VPS public IP\>** — TTL 300s
- Leave `sakolakembara.org` (apex) and `www` pointing at WordPress for now.

Wait until `dig staging.sakolakembara.org +short` returns the VPS IP (usually <5 min on Cloudflare, can be 15+ min on traditional registrars).

### 5.2 Temporarily point Caddy at staging

For the test we want a cert for `staging.sakolakembara.org`, not the apex (which isn't pointed at us yet — Let's Encrypt would fail the HTTP-01 challenge).

Edit `/opt/sakem/Caddyfile` and replace the host block:

```caddyfile
staging.sakolakembara.org {
    reverse_proxy app:3000
    encode gzip zstd
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options    "nosniff"
        X-Frame-Options           "DENY"
        Referrer-Policy           "strict-origin-when-cross-origin"
        Permissions-Policy        "camera=(), microphone=(), geolocation=()"
        -Server
    }
    log {
        output stdout
        format console
        level  INFO
    }
}
```

> Keep a copy of the original (apex) block — you'll restore it in Phase 9.

If you didn't already add the staging redirect URI in Phase 2, add it to the Google OAuth client now:

- `https://staging.sakolakembara.org/api/auth/callback/google`

And update `.env.production`:

```dotenv
NEXTAUTH_URL=https://staging.sakolakembara.org
```

### 5.3 Push to main and watch CI

From your laptop, on the repo:

```bash
git checkout main
git merge dev.angga --ff-only   # or whatever branch holds the MVP
git push origin main
```

Watch the deploy in GitHub → Actions. Two jobs run:

1. **Build & push image** (~3 min) — builds the multi-stage Dockerfile, tags `:latest` and `:sha-<short>`, pushes to GHCR.
2. **Deploy to VPS** (~30s) — SSHes in, runs `docker compose pull app && up -d app`, then `drizzle-kit migrate`.

The very first deploy will pull `postgres:16-alpine`, `caddy:2-alpine`, and the app image. Expect 3–5 minutes for cold-cache image pulls.

### 5.4 Bring up the whole stack (first time only)

The workflow only restarts the `app` service. On first deploy the other services don't exist yet. SSH to the VPS:

```bash
cd /opt/sakem
docker compose up -d postgres caddy backup
docker compose ps   # all four should be Up + healthy
```

Then re-run the migration (Drizzle needs Postgres up, which the workflow can't guarantee on first deploy):

```bash
docker compose exec -T app node ./node_modules/drizzle-kit/bin.cjs migrate
```

### 5.5 First sanity check

From your laptop:

```bash
curl -I https://staging.sakolakembara.org/         # 200, HSTS header present
curl -I https://staging.sakolakembara.org/admin    # 302 → /login
curl -I https://staging.sakolakembara.org/cerita/foo   # 308 → /blog/foo
```

Open `https://staging.sakolakembara.org` in a browser. You should see the public site with the dev placeholder content.

If Caddy fails to get a cert, check `docker compose logs caddy` — the most common cause is DNS not yet propagated.

---

## Phase 6 — Seed the first super admin + smoke test admin

`/admin` requires a `users` row with an admin role. The seed script upserts one from the `SEED_SUPER_ADMIN_*` values you put in `.env.production`.

```bash
cd /opt/sakem
# The app container has `pg` + `bcryptjs` and reads env from the compose file.
docker compose exec app npm run seed:super-admin
```

Expected output:

```
Super-admin ready:
{ id: '...', email: '...', name: '...', role: 'super_admin', password_hash: '(bcrypt, redacted)' }

Sign in at /login → 'Masuk sebagai admin' with this email + your password.
```

Now sign in. On `https://staging.sakolakembara.org/login`:

1. Expand **"Masuk sebagai admin (email + password)"**.
2. Enter the `SEED_SUPER_ADMIN_EMAIL` + `SEED_SUPER_ADMIN_PASSWORD` you just seeded.
3. You land on `/admin`.

You can also verify the Google flow: sign out, click the Google button, sign in with any Google account, and you should land on `/portal` (new sign-ins default to `role='student'`). Promote that account to `super_admin` from `/admin/settings` if you'd rather use Google going forward — then the password can be rotated or the seed values removed from `.env.production`.

Walk every admin route. Do at least one of each:

- [ ] `/admin` — dashboard renders, all six stat cards show numbers (likely all zeros), Quick Actions visible
- [ ] `/admin/applications` — empty table, "Belum ada pendaftar" copy
- [ ] `/admin/messages` — empty
- [ ] `/admin/announcements/new` — create one, set Active=on, save. Refresh public homepage on a new tab → announcement strip appears at top.
- [ ] `/admin/reports/new` — upload a small PDF (any PDF will do for the test). Verify it appears on `/laporan` after save.
- [ ] `/admin/blog/new` — create a draft, upload a hero image. Save. Verify the file lands under `public/blog/images/...` (the volume — check from the host with `docker compose exec app ls /app/public/blog/images`).
- [ ] `/admin/team/new` — add a member, upload a photo. Verify on `/tim`.
- [ ] `/admin/settings/new` — invite a second admin (real email of a teammate). They can now sign in.
- [ ] `/admin/audit` — every action above shows up here.
- [ ] On a phone (or DevTools mobile viewport): admin sidebar collapses to hamburger; drawer opens; nav links work; drawer closes after navigation.

If any of these fail, stop and fix before moving on. Filing bugs from a staging URL is much cheaper than from production.

---

## Phase 7 — Content swap (do BEFORE cutover)

The repo still ships placeholder content. Real users will see this on day one of the cutover if you skip this phase.

Walk through `lib/data.ts` and rewrite each hardcoded array using the final assets your team handed over:

- [ ] **`programs`** — three program stages, with real photos saved under `public/images/programs/<id>.jpg`. Update `image` paths to point at the local files (drop the Unsplash URLs).
- [ ] **`impactMetrics`** — real "Total siswa terbantu", "Berkuliah", "Top 3", "Program 2025/2026" numbers from the LMS team.
- [ ] **`testimonials`** — real student names + photos + quotes. Photos under `public/images/testimonials/`.
- [ ] **`mapLocations`** — real branch coordinates if any have changed.

Tim members and blog posts you can manage from `/admin/team` and `/admin/blog` — no code change needed, just sit with the marketing person and seed the real entries.

For each batch of changes:

```bash
git checkout -b content/launch-prep
# edit files
npm run build   # sanity: build passes
git commit -am "content: real photos + bios + program copy for launch"
git push -u origin content/launch-prep
# open PR → review → merge to main → CI auto-deploys to staging
```

Then re-walk the affected public pages on staging:

- [ ] `/` — programs section, impact metrics, testimonials all show real content
- [ ] `/tim` — every face is a real person
- [ ] `/donasi` — QRIS image works (drop the real QRIS at `public/images/qris-sakem.png`; check `/donasi` shows the QR, not the dotted-placeholder fallback)

---

## Phase 8 — Pre-cutover checks

Done against `staging.sakolakembara.org`. Do this the morning OF cutover day.

### 8.1 Lighthouse on every public route

```bash
# from your laptop
for path in / /blog /tim /donasi /kontak /gabung-siswa /laporan; do
  npx lighthouse "https://staging.sakolakembara.org$path" \
    --output html --output-path "./lh-$(echo $path | tr / _).html" \
    --quiet
done

# And one blog detail page
npx lighthouse "https://staging.sakolakembara.org/blog/akses-pendidikan-untuk-masa-depan-bangsa-yang-lebih-baik" \
  --output html --output-path "./lh-blog-detail.html" --quiet
```

Target: every route ≥ 90 on **Performance, Accessibility, Best Practices, SEO**. Fix any reds before cutover. The static pre-flight is already done (commit `ed03a88`); anything the real run flags is usually one of:

- **LCP** — biggest image not optimized. Convert to AVIF or WebP, add `priority` if it's above the fold.
- **CLS** — image without `width`/`height`. Add them.
- **TBT** — too much JS shipped. Check the route's `loading.tsx` / `error.tsx`; look for accidental client components.
- **Color contrast** — text on gradient hero, footer links. Bump font weight or text colour.

### 8.2 Redirect spot-check

```bash
for p in /cerita/foo /education/x /tips/y /daftar /apply /tentang-kami /about /impact-reports /blog/page/2 /feed /index.php; do
  printf "%-30s -> %s\n" "$p" \
    "$(curl -sI "https://staging.sakolakembara.org$p" | grep -i '^location' | tr -d '\r')"
done
```

Every line should show a 308 to the expected new path. (See [next.config.ts](../../next.config.ts) for the source of truth.)

### 8.3 Real-device QA

Open `https://staging.sakolakembara.org` on:

- [ ] An iPhone (Safari) — hero copy fits, donation CTA tappable, navbar hamburger works
- [ ] An Android (Chrome) — same
- [ ] A laptop (Chrome) at 1366×768 — most common Indonesian desktop resolution

Submit a `/kontak` message, a `/gabung-siswa` application. Check both arrive in `/admin/messages` and `/admin/applications`.

### 8.4 Lower DNS TTL

In the domain registrar, drop the existing apex `sakolakembara.org` (still pointing at WordPress) **A-record TTL to 300s** (5 minutes). **Wait 24 hours** before doing the cutover — resolvers cache the old TTL, so the change only takes effect after the old TTL expires. Without this step the cutover takes 24+ hours to fully propagate.

> If you're doing all of Phases 8.1–8.3 the day before cutover, do the TTL drop as the very first thing in the morning — it bakes while you do the other checks.

---

## Phase 9 — Cutover day

Pick a low-traffic window. Tell the team you're starting.

### 9.1 Switch Caddy back to the apex

On the VPS:

```bash
cd /opt/sakem
nano Caddyfile
```

Replace the `staging.sakolakembara.org` block with the apex block (the original from the repo — `sakolakembara.org, www.sakolakembara.org { ... }`). Save.

Also restore `.env.production`:

```dotenv
NEXTAUTH_URL=https://sakolakembara.org
```

Double-check the **production** redirect URI is in the Google OAuth client (you added it in Phase 2 step 3): `https://sakolakembara.org/api/auth/callback/google`.

Restart Caddy + app:

```bash
docker compose restart caddy app
```

Caddy will **fail to get a cert yet** because the apex still points at WordPress. That's fine — it'll keep retrying. Move on.

### 9.2 Flip DNS

In the registrar:

- **A `sakolakembara.org` (apex) → \<VPS public IP\>**, TTL 300s
- **A or CNAME `www.sakolakembara.org` → \<VPS public IP\>** (or CNAME to apex if your registrar supports it), TTL 300s

Watch propagation:

```bash
watch -n 5 'dig sakolakembara.org +short; dig www.sakolakembara.org +short'
```

Within 5–10 minutes you should see the VPS IP returned. (Some ISPs cache longer; don't panic at 15 min.)

### 9.3 Verify TLS + the site

Once DNS is showing the VPS IP from your machine:

```bash
curl -I https://sakolakembara.org/                # 200, valid cert
curl -I https://www.sakolakembara.org/            # 308 → https://sakolakembara.org
curl -sI https://sakolakembara.org/cerita/foo | grep -i location  # 308 to /blog/foo
```

Open `https://sakolakembara.org/` in a private window. Check:

- [ ] Padlock is green, cert is from Let's Encrypt, valid for `sakolakembara.org` + `www.sakolakembara.org`
- [ ] Real content (Phase 7) — no Unsplash, no placeholder names
- [ ] `/admin` is reachable, you can log in with the super-admin credentials (or via Google if the account was promoted)
- [ ] Submit a `/kontak` from your phone on cellular (not on the VPS network) → arrives in the admin

If TLS doesn't issue, check `docker compose logs caddy`. Common: DNS hasn't propagated to the Let's Encrypt validator yet. Restart Caddy after another 5 min: `docker compose restart caddy`.

### 9.4 Decommission WordPress (or freeze it)

You have two safe paths:

- **Freeze (recommended)**: leave the old WP install running on the legacy host for 30 days as a read-only fallback in case you need a content reference. Just don't update DNS to it.
- **Tear down**: only after you've confirmed every redirect works and at least one full week has passed.

Either way, **export a final database + uploads dump from WordPress and stash it** somewhere durable before touching it. The blog scraper (`scripts/scrape-blog.mjs`) does *not* archive WordPress; markdown is the source of truth from cutover forward, but the original WP dump is your only insurance policy.

---

## Phase 10 — Post-launch (same day)

- [ ] **Google Search Console** → add property → verify via DNS TXT (skip the HTML-file method, it's annoying with Next.js routing). Submit `https://sakolakembara.org/sitemap.xml`.
- [ ] **Bing Webmaster Tools** — same. Indonesians on enterprise / school networks still use Bing more than you'd think.
- [ ] **Ping the sitemap** so search engines re-crawl quickly:
   ```bash
   curl "https://www.google.com/ping?sitemap=https://sakolakembara.org/sitemap.xml"
   ```
- [ ] **Submit the URL change** in Google Search Console (Settings → Change of address) — points the old WP property at the new domain to preserve indexing equity. Only do this if the old WP site lived at the same `sakolakembara.org`; if so, this step is a no-op (same domain), and the 308 redirects from Phase 8.2 do the work.
- [ ] **Post in the team channel** with the live URL and a "report any bugs to me" call.
- [ ] **Check Sentry** (if wired) — no errors so far.
- [ ] **Check uptime monitoring** (if wired) — green. If you have nothing yet, sign up for a free UptimeRobot or BetterStack and add `https://sakolakembara.org` + `https://sakolakembara.org/api/auth/[...nextauth]` (admin-only routes redirect to /login when unauthed — uptime tools see 302, which is "up").

---

## Phase 11 — 14-day watch list

Re-check these once a week for the first two weeks.

- [ ] **Backups landing offsite** — if you wired B2/R2 in Phase 0, list the bucket from your laptop and confirm new `.sql.gz` files appear daily.
   ```bash
   rclone ls b2:sakem-backups/postgres/ | head
   ```
- [ ] **No log error spike** — `docker compose logs app --since 24h | grep -iE 'error|unhandled'` returns nothing alarming.
- [ ] **DB disk usage** — `docker compose exec postgres psql -U sakem sakola_kembara -c "SELECT pg_size_pretty(pg_database_size('sakola_kembara'));"`. Should be <100 MB for the first few weeks.
- [ ] **Image disk usage** — `du -sh /var/lib/docker/volumes/sakem_app_public/`. Grows as admins upload reports and blog images. Plan when to migrate to object storage at >5 GB.
- [ ] **Search Console coverage** — submitted URLs are getting indexed; no soft-404s or redirect loops.
- [ ] **Admin login still works** for all seeded admins. (`lastLoginAt` in `/admin/settings` confirms.)
- [ ] **TLS cert auto-renewal** — Caddy renews 30 days before expiry. `docker compose exec caddy caddy list-certificates` shows expiry date; should be ~60 days out.

---

## Rollback plan

If the cutover goes wrong **after** DNS has flipped:

### Fastest: flip DNS back

In the registrar, point `sakolakembara.org` back at the WordPress IP. With the 300s TTL, traffic returns to WP in ≤5 minutes. **The new VPS keeps running** — you can debug there without time pressure.

### Bad image deploy (app is broken, infra is fine)

```bash
cd /opt/sakem
# Find the previous good SHA tag in GHCR (UI: Packages → sakola-kembara-landing)
docker compose down app
sed -i 's|sakola-kembara-landing:latest|sakola-kembara-landing:sha-abc1234|' docker-compose.yml
docker compose pull app
docker compose up -d app
```

Then revert the bad commit on `main` and let CI deploy the fix.

### Bad migration (DB schema is broken)

```bash
cd /opt/sakem
# Stop the app so nothing writes
docker compose stop app

# Restore the most recent backup BEFORE the bad migration
ls /var/lib/docker/volumes/sakem_backups/_data/
docker compose exec -T postgres sh -c 'dropdb -U sakem sakola_kembara && createdb -U sakem sakola_kembara'
gunzip < /var/lib/docker/volumes/sakem_backups/_data/sakem-YYYYMMDD-HHMM.sql.gz \
  | docker compose exec -T postgres psql -U sakem sakola_kembara

# Pull a previous image and start
sed -i 's|:latest|:sha-abc1234|' docker-compose.yml
docker compose up -d app
```

### Lost SSH access

Most VPS providers give you a web console (Hetzner: "Console", DO: "Recovery console"). Log in there, fix `/etc/ssh/sshd_config`, restart `ssh`. If the firewall locked you out, `ufw disable` from the console, fix the rules, re-enable.

---

## Appendix: files this runbook expects

These already exist in the repo (don't recreate them):

| File | Role |
| --- | --- |
| `Dockerfile` | Multi-stage Next.js standalone build. Used by GHA build job. |
| `docker-compose.yml` | Production stack: app + postgres + caddy + backup + 4 volumes. |
| `Caddyfile` | Reverse proxy + TLS for the apex. **Edit on cutover day.** |
| `.env.example` | Template for `.env.production`. Hand-edit on the VPS, never commit. |
| `.github/workflows/deploy.yml` | Build image → push to GHCR → SSH deploy. |
| `scripts/seed-super-admin.mjs` | One-shot seed for the first super admin. Reads `SEED_SUPER_ADMIN_*` env. |
| `drizzle/*.sql` | Schema migrations. Run via `drizzle-kit migrate`. |
| `next.config.ts → redirects()` | WP cutover 308s. |

Cross-references for deeper context:

- **Steady-state ops** (commands, rollback, backups): [`../current-state/deployment.md`](../current-state/deployment.md)
- **Infrastructure decisions** (why VPS, why Caddy, what's in the volumes): [`../roadmap/infrastructure.md`](../roadmap/infrastructure.md)
- **Auth + Google OAuth setup**: [`../architecture/authentication.md`](../architecture/authentication.md) and [`../roadmap/admin-dashboard.md`](../roadmap/admin-dashboard.md)
- **WP redirect mapping**: [`../../next.config.ts`](../../next.config.ts) and [`../../scripts/lib/blog-pipeline.mjs`](../../scripts/lib/blog-pipeline.mjs)
