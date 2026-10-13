# Staging runbook (owner's guide)

The exact, ordered steps to put the site on **staging**: two Workers on `*.workers.dev` in the organisation account, run from Dzul's Mac. Written for Dzul; **nothing here is run by an agent**. Ticket: SAKEM-084 (M5). What the plan allows and where it can fail: [`free-plan-audit.md`](free-plan-audit.md). The account and token background: [`account-setup.md`](account-setup.md).

## Decisions this runbook rests on (Dzul, 2026-10-12)

- Staging is on **`workers.dev`**, in the organisation account (plan Free). The nameservers of `sakolakembara.org` are not touched before the cutover.
- The **Cache API is not expected to work on `workers.dev`**, so staging cannot prove cache behaviour (hit, stale, the 60 s window, purge); the code works without it, and staging is the uncached worst case for CPU and D1. The cache is tested on the cutover day.
- **Every deploy is manual**, from this Mac, with `wrangler login`. CI deploy is postponed.
- **Every real Cloudflare action needs your explicit OK, step by step**: creating a database or bucket, setting a secret, deploying, applying a remote migration, the first admin, the import, `wrangler tail` on a real Worker. This page says so in each step.
- The login sees **four accounts**: pin the organisation account every time and never touch the others.
- No ids, hostnames or secrets in the public repo; nothing secret through chat. Say "done" or "failed", never the value.

## What staging is made of

| Thing | Name (placeholder in git, created by you) |
| --- | --- |
| API Worker | `sakem-admin-staging` (`cf/admin`, `--env staging`) |
| Public site Worker | `sakem-web-staging` (`cf/web`, `pnpm build:staging`) |
| D1 database | `sakem-staging` |
| R2 bucket | `sakem-files-staging`, public through its `r2.dev` address |
| Rate limit namespaces | `7901` to `7908`, `7921`, `7922` (the production ones are `78xx`; a shared id would share counters) |
| Addresses | `https://sakem-admin-staging.<account-subdomain>.workers.dev`, `https://sakem-web-staging.<account-subdomain>.workers.dev` |
| Turnstile widget | one for the `workers.dev` hostnames, named "Sakola Kembara staging" |
| Resend key | one named `sakem-staging` |

The staging block of each `wrangler.jsonc` (and the service binding of the site, which points at the **staging** admin Worker) is checked by tests; `pnpm deploy:staging:dry` in each package proves both bundles are the staging ones. The shape of staging against production: [`free-plan-audit.md`](free-plan-audit.md#37-wrangler-environments-and-automatic-provisioning).

## Variables and secrets

Names only. A `--var` value is **public** (the browser gets most of them anyway); a secret is typed into wrangler's own prompt and never written anywhere else.

| Name | Worker | Kind | Value comes from | Set by |
| --- | --- | --- | --- | --- |
| `ENVIRONMENT` = `staging`, `AUDIT_RETENTION_DAYS` = `365` | admin | var | the staging block of `wrangler.jsonc` (git) | nobody |
| `TURNSTILE_SITE_KEY` | admin and site | public var | the widget of step 7 | `.staging.vars` of each, printed as `--var` |
| `UPLOADS_BASE_URL` | admin and site | public var | the `r2.dev` address of step 5, no trailing slash | same |
| `SITE_URL` | admin | public var | the site's `workers.dev` address | same |
| `EMAIL_FROM` | admin | public var | `Sakola Kembara Staging <onboarding@resend.dev>` | same |
| `ADMIN_URL` | site | public var | the admin's `workers.dev` address | same |
| `LEGACY_ORIGIN_URL` | site | public var | **`https://no-legacy-origin.invalid`**, exactly (see step 10) | same |
| `BETTER_AUTH_SECRET` | admin | secret | `openssl rand -base64 32` | you, `wrangler secret put` |
| `RESEND_API_KEY` | admin | secret | the Resend key of step 7 | you, `wrangler secret put` |
| `TURNSTILE_SECRET_KEY` | admin | secret | the widget's secret key | you, `wrangler secret put` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | admin | optional | not used on staging | nobody |
| `TRUSTED_ORIGINS`, `COOKIE_DOMAIN` | admin | | left unset | nobody |
| `CONTENT_API_URL`, `CONTACT_API_URL` | site | | **never** (they move the reads and the form off the binding) | refused by the script |

`vars` come from the configuration file on **every** deploy: a variable that is not in the file or in a `--var` is removed by the next deploy. That is why the deploy command is printed from one file (`.staging.vars`, untracked) instead of typed. Secrets are never removed by a deploy.

## At a glance

| # | Step | Creates or changes | Your OK |
| --- | --- | --- | --- |
| 1 | Pin the account, log in | a login on this Mac | yes |
| 2 | Check locally | nothing on Cloudflare | no |
| 3 | Create the D1 database | an empty database | yes |
| 4 | Apply the migrations | 12 migrations, `0000` to `0011` | yes |
| 5 | Create the R2 bucket and turn its `r2.dev` URL on | a bucket, public | yes |
| 6 | First deploy of the admin Worker | the Worker, its bindings, the cron | yes (**checkpoint: rate limits**) |
| 7 | Turnstile widget and Resend key | dashboard objects | yes |
| 8 | Secrets, then redeploy the admin with its public values | 3 secrets, a new version | yes |
| 9 | First super_admin | 3 rows in the remote D1 | yes |
| 10 | Deploy the site | the Worker | yes |
| 11 | Smoke tests | requests only | no |
| 12 | Seed data | the blog import, a short link, uploads | yes |
| 13 | Measure CPU per route | requests, a `wrangler tail` | yes |
| 14 | Limits to watch | reading dashboards | no |
| 15 | What must not be done on staging | | |
| 16 | Teardown | deletes everything above | yes |

## Before the first command

Open one terminal for the whole session and set both variables in it (this shell only, never written to a file):

```bash
export CLOUDFLARE_ACCOUNT_ID=<id of the ORGANISATION account, from `wrangler whoami`>
export CLOUDFLARE_ENV=staging
```

`CLOUDFLARE_ENV=staging` makes every wrangler command in this shell target the staging environment even when a flag is forgotten, and makes `pnpm build` in `cf/web` build the staging Worker; without it, wrangler only **warns** ("Multiple environments are defined ... no target environment was specified"), and a deploy would create the production-named Worker in the account. The commands below still carry `--env staging` where wrangler takes it, so they read the same without the variable. At the end: `unset CLOUDFLARE_ENV CLOUDFLARE_ACCOUNT_ID`.

The same variable also changes what the test runner and a production build use, so **do step 2 (the local checks) in a plain shell first**, or prefix those commands with `env -u CLOUDFLARE_ENV`.

**After every real command**, check that wrangler did not write ids into a tracked file:

```bash
git status --short          # must show no change in wrangler.jsonc
```

`wrangler d1 create`, `wrangler r2 bucket create` and an interactive provisioning deploy offer to "add it on your behalf" to the configuration file. Answer **no** (or run with `CI=1`, which turns the offer off, as the commands below do). If an id ever lands in a tracked file: `git checkout -- <file>`; it is not a secret, but the repo is public and the rule is no ids.

## 1. Pin the account and log in

```bash
cd cf/admin
pnpm exec wrangler login              # opens the browser; approve as the owner (add --use-keyring to keep it in the keychain)
pnpm exec wrangler whoami             # lists the accounts the login can reach: copy the id of the organisation account
export CLOUDFLARE_ACCOUNT_ID=<that id>
pnpm exec wrangler d1 list            # read-only: lists the databases of the PINNED account; check it is the organisation's
```

- **Creates or changes:** a login session on this Mac (plain text in your profile unless `--use-keyring`). It belongs to the Mac user: any wrangler run afterwards uses it, which is why every real command needs your OK.
- **Your OK:** yes.
- **Verify:** `d1 list` answers with the organisation's databases (none yet, or the ones it already has), not an error about the account.
- **Revert:** `pnpm exec wrangler logout`; `unset CLOUDFLARE_ACCOUNT_ID`.
- If the account has no `workers.dev` subdomain yet, the first deploy offers to register one (dashboard: Workers & Pages, "Your subdomain"). It becomes part of every staging URL; choose it once, it is public.

## 2. Check locally (no account)

```bash
cd cf/admin && pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm db:drift && pnpm deploy:staging:dry
cd ../web   && pnpm install --frozen-lockfile && pnpm check && pnpm build && pnpm test && pnpm deploy:staging:dry
```

Both `deploy:staging:dry` end with `staging dry-run ok: <name>, ... (nothing was deployed; no account was used)`. Copy the two example files and leave them for step 8: `cp cf/admin/staging.vars.example cf/admin/.staging.vars` and the same in `cf/web` (both `.staging.vars` are git-ignored).

## 3. Create the D1 database

```bash
cd cf/admin
CI=1 pnpm exec wrangler d1 create sakem-staging --location apac
```

- **Creates:** an empty D1 database named `sakem-staging` in the pinned account. `--location apac` is a hint for where it lives (Asia-Pacific, closest to the school); it cannot be changed later. It prints a snippet with a `database_id`: do not paste it anywhere; wrangler finds the database by name from now on.
- **Your OK:** yes.
- **Verify:** `pnpm exec wrangler d1 info sakem-staging` (shows `version: production`); `git status --short` is clean.
- **Revert:** `pnpm exec wrangler d1 delete sakem-staging` (the database is empty: nothing is lost).

## 4. Apply the migrations (`0000` to `0011`)

```bash
cd cf/admin
pnpm exec wrangler d1 migrations list  sakem-staging --env staging --remote     # twelve not yet applied
pnpm exec wrangler d1 migrations apply sakem-staging --env staging --remote     # shows them, asks you to confirm
pnpm exec wrangler d1 execute sakem-staging --env staging --remote --command \
  "SELECT type, name FROM sqlite_master WHERE name IN ('signable_super_admins', 'users_keep_one_super_admin')"
```

- **Changes:** creates every table, index, view and trigger of `cf/admin/migrations/` in order, one transaction per file; a failing file is rolled back and the earlier ones stay. Wrangler takes a backup after applying. D1 counts these as a few hundred rows written (of 100,000 a day, per account).
- **Your OK:** yes.
- **Verify:** the last query returns **two rows**, a view and a trigger. `migrations list` now says there is nothing to apply.
- **Deploy order.** On an empty database the order against the Worker does not matter, so migrations come first here. For a **later** migration, read its note: `0010` came before the Worker that reads it, `0011` goes the other way (**deploy the Worker first, then apply `0011`**: [`auth.md`](auth.md#the-last-super_admin)). The rule: a migration that only adds what the new Worker needs goes first; one that changes what the old Worker reads goes after the new Worker is live. Write the direction in the PR of every migration.
- **Revert:** a database with nothing in it: `d1 delete sakem-staging` and step 3 again. With data: `pnpm exec wrangler d1 time-travel info sakem-staging --env staging` first (it prints a bookmark: write it down), then `d1 time-travel restore sakem-staging --env staging --timestamp <time before>`. Time Travel keeps 7 days on the Free plan.

## 5. Create the R2 bucket and turn its public URL on

```bash
cd cf/admin
CI=1 pnpm exec wrangler r2 bucket create sakem-files-staging --location apac
pnpm exec wrangler r2 bucket dev-url enable sakem-files-staging           # asks you to confirm public access
pnpm exec wrangler r2 bucket dev-url get sakem-files-staging              # prints https://pub-<hash>.r2.dev
```

The dashboard does the same: R2, the bucket, **Settings**, **Public Development URL**, **Enable**, type `allow`.

- **Creates:** a bucket, and a **public** address on `r2.dev`. **What that exposes:** every object in the bucket to anyone who has the address, with no listing and a variable rate limit ("hundreds of requests a second", then 429), and no WAF, cache or access control. Fine for staging **with dummy data only**: nothing private is ever uploaded through the admin API (it has no private files), and the address is long and unlisted, not secret. Never the address of the production bucket.
- **Your OK:** yes (the public part is the one to think about).
- **Verify:** `pnpm exec wrangler r2 bucket list` shows `sakem-files-staging`; write the address into `cf/admin/.staging.vars` and `cf/web/.staging.vars` as `UPLOADS_BASE_URL` (no trailing slash). R2 is on the Free tier only with a card on file and "a card is not a spending cap": confirm the billing notification of [`account-setup.md`](account-setup.md#part-1-quick-checks-5-minutes-now) is set.
- **Revert:** `pnpm exec wrangler r2 bucket dev-url disable sakem-files-staging` (type `disallow`); empty the bucket (dashboard, Objects, select all, delete); `pnpm exec wrangler r2 bucket delete sakem-files-staging`.

## 6. First deploy of the admin Worker (the checkpoint)

```bash
cd cf/admin
pnpm build:spa
pnpm exec wrangler deploy --env staging
```

Run it in a normal terminal, not with `CI=1`: it may ask you to register the `workers.dev` subdomain. **No `--var` yet**: this deploy exists to learn one thing before anything else is built.

- **Creates:** the Worker `sakem-admin-staging` (its bindings: the D1 database and the R2 bucket, found by their names, the ten rate limit bindings, the assets), its cron trigger (`17 3 * * *`, daily cleanup), and the `workers.dev` address. No ids are written (the resources exist already).
- **Your OK:** yes.
- **CHECKPOINT, read the output.** The question of this step is **whether the Free plan accepts the `ratelimits` bindings** ([`free-plan-audit.md` 3.1](free-plan-audit.md#31-rate-limiting-binding-ratelimits)). The listing in the output must show `env.RL_LOGIN (5 requests/60s)` and the nine others, and the deploy must end with the address and a version id. **If the deploy is refused because of a rate limit binding, stop here**: tell the PM the exact message (no ids), and do not build anything on it; the fallback design is in the audit.
- **Verify** (replace the address):

  ```bash
  A=https://sakem-admin-staging.<account-subdomain>.workers.dev
  curl -si $A/api/config | head -20          # 200, JSON: "turnstileSiteKey": null, "uploadsBaseUrl": "", "siteUrl": ""
  curl -si $A/api/me | head -5               # 401 {"error":"unauthenticated"}
  git status --short                         # clean
  ```

- **Revert:** `pnpm exec wrangler delete --name sakem-admin-staging` (asks to confirm; removes the Worker, its secrets, its cron and its `workers.dev` route; the database and the bucket stay).

## 7. Turnstile widget and Resend key (dashboard, by you)

**Turnstile.** Dashboard, **Turnstile**, **Add widget**: name "Sakola Kembara staging"; hostname **`<account-subdomain>.workers.dev`** (one hostname covers every subdomain under it, so both staging Workers; wildcards are not accepted); mode Managed. Copy the **site key** into both `.staging.vars` files as `TURNSTILE_SITE_KEY`. The **secret key** goes only to `wrangler secret put` in step 8. Free plan: 20 widgets, 10 hostnames each. This must be a real widget: Cloudflare's always-pass test keys work anywhere but prove nothing about the real script, the iframe, `data-action` or Siteverify.

- **Revert:** delete the widget (Turnstile, the widget, Settings).

**Resend.** Create an API key named `sakem-staging` with **sending access only** (no domain needed). Without a verified domain `onboarding@resend.dev` delivers **only to the address of the Resend account itself**: for the invitation flow, invite yourself. Free plan: 100 mails a day, 3,000 a month. The sender goes into the **admin** `.staging.vars` as `EMAIL_FROM=Sakola Kembara Staging <onboarding@resend.dev>`.

- **Revert:** delete the key in Resend.

## 8. Secrets, then redeploy with the public values

```bash
cd cf/admin
openssl rand -base64 32 | pbcopy                                   # the value is in the clipboard, not on screen
pnpm exec wrangler secret put BETTER_AUTH_SECRET --env staging     # paste at the hidden prompt; then clear the clipboard
pnpm exec wrangler secret put RESEND_API_KEY --env staging         # paste the key of step 7
pnpm exec wrangler secret put TURNSTILE_SECRET_KEY --env staging   # paste the widget's secret key
pnpm exec wrangler secret list --env staging                       # NAMES only: the three
```

Then fill `cf/admin/.staging.vars` (`TURNSTILE_SITE_KEY`, `UPLOADS_BASE_URL`, `SITE_URL` = the site's address, `EMAIL_FROM`) and let the repo print the deploy command, read it, run it:

```bash
pnpm build:spa
pnpm deploy:staging:command      # prints:  pnpm exec wrangler deploy --env staging --var 'TURNSTILE_SITE_KEY:...' --var '...'
# copy that line, check it, run it
```

- **Changes:** three secrets on the Worker (encrypted, never shown again), then a new version with the four public variables. The printer refuses a secret name, an API URL, a placeholder (`<...>`), an `http://` origin, a path or a trailing slash, with the line number, and **prints, never runs**.
- **Your OK:** yes, for each secret and for the deploy.
- **Verify:** `curl -s $A/api/config` now shows `turnstileSiteKey`, `uploadsBaseUrl` and `siteUrl`. A wrong-password sign-in burst, to see the limiter (expected: five `403` answers because no Turnstile token was sent, then a `429` with `Retry-After`):

  ```bash
  for i in 1 2 3 4 5 6 7; do curl -s -o /dev/null -w "%{http_code} " -X POST $A/api/auth/sign-in/email \
    -H 'content-type: application/json' -H "origin: $A" -d '{"email":"staging-check@example.invalid","password":"x"}'; done; echo
  # 403 403 403 403 403 429 429   <- the limit works at the edge; all 403 means the binding does not count (tell the PM)
  ```

- **Revert:** `pnpm exec wrangler secret delete <NAME> --env staging`; redeploy without a `--var` to drop one.

## 9. First super_admin

```bash
cd cf/admin
pnpm first-admin --database sakem-staging --remote
```

An address you control (use the **same address as the Resend account**, so the invitation of a second admin can reach you), a name, and a long password typed at the hidden prompt, twice. It writes `CAPITALS` that it is the real database and asks you to type the database name (`sakem-staging`). Everything about it, the password rules and what to do when it goes wrong: [`first-super-admin.md`](first-super-admin.md). Do not pipe the password; never send it anywhere.

- **Changes:** three rows in the remote D1: the user (`super_admin`, verified), its credential and one audit row. Refuses when a super_admin who can sign in already exists.
- **First time on a real database.** The `--remote` path of this command has only ever run against a local D1 ([`first-super-admin.md`](first-super-admin.md#what-was-tested), "Not verified"). The command runs wrangler without a terminal, so wrangler's own "Ok to proceed?" for a remote file is not asked (it warns that the database is briefly unavailable and goes ahead). If it fails, it prints wrangler's message with the hash hidden and writes nothing it cannot explain; the alternative is `pnpm first-admin --database sakem-staging --no-run --out <file outside the repo>`, then `wrangler d1 execute sakem-staging --env staging --remote --file <that file>` by hand, then delete the file (it holds the password hash).
- **Your OK:** yes.
- **Verify:** sign in at `$A/` with the address and password (the Turnstile widget must appear and pass); **Aktivitas**: the first row is "Admin ditambahkan" with your address.
- **Revert** (staging only, nothing else in it yet): `pnpm exec wrangler d1 execute sakem-staging --env staging --remote --command "DELETE FROM users WHERE email = '<your address>'"` then run the command again, or recreate the database.

## 10. Deploy the site

```bash
cd cf/web
pnpm build:staging               # CLOUDFLARE_ENV=staging pnpm build: dist/server/wrangler.json now names sakem-web-staging
pnpm deploy:staging:command      # prints:  pnpm exec wrangler deploy -c dist/server/wrangler.json --var '...'
# copy that line, check it, run it
```

`cf/web/.staging.vars`: `TURNSTILE_SITE_KEY`, `ADMIN_URL` (the admin's address), `UPLOADS_BASE_URL`, and `LEGACY_ORIGIN_URL=https://no-legacy-origin.invalid`.

- **Why that last one.** The site forwards `/_next/*`, `/images/team/*`, `/reports/*` and similar paths to "the legacy origin" with a plain `fetch`, which in production reaches the old server behind the same hostname. On `workers.dev` nothing is behind the hostname, so the fetch would go back into the same Worker, up to Cloudflare's loop limit of 16 invocations for one request, on a 100,000-a-day budget ([`free-plan-audit.md` 7.1](free-plan-audit.md#7-staging-findings)). A `*.invalid` host never resolves, so the forward fails at once. The printer accepts no other value for it.
- **Creates:** the Worker `sakem-web-staging`, its `API` service binding to `sakem-admin-staging#PublicApi` (the admin Worker must exist: that is why it came first), the static assets (about 1,000 files, 137 MiB), its `workers.dev` address. No cron, no database.
- **Your OK:** yes.
- **Verify:** the output lists `env.API (sakem-admin-staging#PublicApi)`; the smoke tests of step 11.
- **Revert:** `pnpm exec wrangler delete --name sakem-web-staging` (first, before the admin: the site's binding points at it).
- A staging **build** replaces `dist/`. Rebuild before any production deploy (`pnpm build` without `CLOUDFLARE_ENV`); the name written into `dist/server/wrangler.json` is what gets deployed.

## 11. Smoke tests

```bash
W=https://sakem-web-staging.<account-subdomain>.workers.dev
A=https://sakem-admin-staging.<account-subdomain>.workers.dev
for p in / /blog /tim /laporan /gabung-siswa /gabung-siswa/docs /kontak /donasi /program/prapembinaan /robots.txt /sitemap.xml /feed /no/such/page /api/x /admin /_next/x; do
  printf '%-26s ' "$p"; curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' "$W$p"; done
```

| Request | Expected |
| --- | --- |
| `W/`, `/gabung-siswa`, `/donasi`, `/program/prapembinaan`, `/robots.txt` | 200 (static files: no Worker request) |
| `W/blog`, `/tim`, `/laporan`, `/gabung-siswa/docs` | 200, the empty list states, until step 12 (a 503 means the site cannot reach the admin Worker: check the binding) |
| `W/kontak` | 200; `curl -s $W/kontak \| grep -c challenges.cloudflare.com` is `1` (the widget script) |
| `W/sitemap.xml` | 200 (XML) |
| `W/feed` | 308 to `/blog` (a `_redirects` rule) |
| `W/no/such/page` | 404 (the site's 404 page) |
| `W/api/x` | 404 JSON `{"error":"not_found"}` |
| `W/admin` | 308 to the admin's address |
| `W/_next/x` | fails **fast** with a 5xx (the `.invalid` origin), never slowly, never a loop |
| `A/`, `A/login` | 200 (the SPA) |
| `A/api/config`, `A/api/me` | 200 JSON, 401 |
| `A/api/public/team` | **404** (the reads exist on the service-binding entrypoint only) |
| `curl -si -X POST $A/api/public/contact -H "origin: $A" -H 'content-type: application/json' -d '{}'` | **404** |
| `A/uploads/x`, `A/api/dev/mailbox` | 404 JSON |

Things only these two requests can show (note them for the PM, no values): `curl -sI $W/ | grep -i strict-transport` (the security headers are there); whether `cf-ray` answers from a nearby location. Things the real deploy settles that nothing else can: [`free-plan-audit.md` section 9](free-plan-audit.md#9-what-only-a-real-account-can-settle).

## 12. Seed data

**The 80 articles** (explicit approval; **this writes**). It writes 80 `blog_posts` rows (about 400 to 500 D1 rows written with their index entries, of 100,000 a day) in one idempotent upsert per article: rerunning it leaves an article that was edited in the admin alone. The longest statement is 20,965 bytes (D1's limit is 100,000).

```bash
cd cf/admin
pnpm exec wrangler d1 time-travel info sakem-staging --env staging          # write down the bookmark: the way back
pnpm blog:import:local -- --out /private/tmp/legacy-blog.sql                # only writes the SQL; nothing is applied
wc -l /private/tmp/legacy-blog.sql                                          # 80 lines; read a few
pnpm exec wrangler d1 execute sakem-staging --env staging --remote --file /private/tmp/legacy-blog.sql   # <- your OK
pnpm exec wrangler d1 execute sakem-staging --env staging --remote --command "SELECT count(*) AS n FROM blog_posts"   # 80
rm /private/tmp/legacy-blog.sql
```

- **Verify:** `W/blog` shows 15 cards and the featured article; `W/blog/macam-macam-gaya-belajar-dan-cara-mengoptimalkannya` renders with its images; `W/sitemap.xml` lists the 80; `curl -s $A/api/public/blog` is still 404.
- **Revert:** Time Travel (`d1 time-travel restore sakem-staging --env staging --bookmark <the one you wrote down>`), or `DELETE FROM blog_posts WHERE wp_id IS NOT NULL`.
- Do not use `--out` into the repo; the file is public text anyway, but the habit matters for the other scripts.

**A short link.** The real links of the old Postgres are not migrated: they are created again by hand in the new admin (Konten Situs, Shortlink), on staging one test link, e.g. `uji-staging` to `https://sakolakembara.org/blog`. Check `curl -sI $W/uji-staging` is a 307 and that the click count in the admin rose by one (**one D1 row written per click, unbounded, by decision**). The names already used by a page, a redirect or a forwarded path are refused by the admin.

**Uploads.** In the admin, upload a small team photo and look at it on `W/tim`: the file comes from `UPLOADS_BASE_URL`; open its address and confirm `cache-control: public, max-age=31536000, immutable` and the right `content-type`. The large ones (5 MB image, 20 MB and 25 MB PDF) belong to the measurement of step 13.

## 13. Measure CPU per route

The question: **no route reaches error 1102 on Free, with the margin written down per route** (SAKEM-084). CPU is Cloudflare's own number per invocation; a timer inside a Worker cannot measure it. Tools: `cf/web/scripts/measure-staging.mjs` (`pnpm measure:staging`), the dashboard, Workers Logs.

**a. Capture the tail** (two terminals; read-only, **your OK**: it connects to a real Worker). The capture holds request URLs, geo data and **your IP address** in the headers: it is written to `cf/web/.measure/` (git-ignored), never goes into the repo, a ticket or chat; delete it after.

```bash
cd cf/web && mkdir -p .measure
pnpm exec wrangler tail sakem-web-staging   --format json > .measure/web-tail.jsonl      # terminal 1
pnpm exec wrangler tail sakem-admin-staging --format json > .measure/admin-tail.jsonl    # terminal 2 (from cf/web too)
head -c 700 .measure/web-tail.jsonl; echo
```

The first request lines settle one open question: **does the stream carry `cpuTime` and `wallTime`?** (The trace item that Tail Workers receive has both; the documentation's example of the real-time stream shows neither.) If the lines have no `cpuTime`, use the dashboard and Workers Logs below for the numbers; the collector still counts outcomes and statuses, and says so. A tail expires after a while ("expires at" in its first line): restart it; under heavy traffic it samples and prints a notice.

**b. Probe** (GET only, polite, bounded). First look at what it would send, then send:

```bash
node scripts/measure-staging.mjs plan  --base $W --admin $A            # prints every request, sends nothing
node scripts/measure-staging.mjs probe --base $W --admin $A            # asks you to type the host of --base, then of --admin
```

12 rounds of 27 routes, 600 ms apart: 324 requests in about 4 minutes, of which 252 run a Worker (0.25% of the day's 100,000, shared with production). User agent `sakem-staging-measure/1.0`. It refuses any host that is not `*.workers.dev` (or loopback), refuses `sakolakembara.org` outright, sends no credential and no cookie, never follows a redirect, stops a route that answers 429 and the run after five failures in a row, and reports error 1102 when an answer carries it. `--writes` (needs a second typed confirmation) adds the two POSTs the Workers refuse before storing anything: a contact form without a Turnstile token (`turnstile_failed`) and a sign-in with an unknown address (a 403 before any password is hashed). They are paced at 13 s for the rate limit (about five more minutes) and **are not the cost of a real sign-in**.

**c. The routes that need a session, by hand in the browser, while the tails run.** Do each a few times; wait **ten minutes** between two rounds of the first four so some requests meet a cold isolate (the collector marks the first request after a gap of 60 s or more).

| Do this | The row it makes |
| --- | --- |
| Sign in (right password, then wrong once) | `POST /api/auth/sign-in/email`: **the one most likely to fail** (PBKDF2) |
| "Lupa password", open the link, set a new password; invite a second admin to your own address and accept | `POST /api/auth/request-password-reset`, `reset-password`, `GET /api/auth/verify-email`: PBKDF2 again |
| Open Dashboard, then each list: Pesan, Pengumuman, Batch, Pendaftar, Pusat Dokumen, Laporan, Tim, Shortlink, Blog, Aktivitas, Pengaturan | `GET /api/dashboard`, `GET /api/admin/*` |
| Blog: new article of about 12,000 characters, save it, edit and save again, type in the preview | `POST` and `PUT /api/admin/blog`, `POST /api/admin/blog/preview`: the render (a fresh isolate costs two to three times a warm one) |
| Upload a 5 MB image (team photo), a 20 MB PDF (report), a 25 MB PDF (document) | `POST /api/admin/uploads`: multipart parse; also watch memory in the dashboard |
| Send a message through the real `W/kontak` form | `POST /kontak` and the admin's `PublicApi` side |
| Wait for 03:17 UTC (10:17 Jakarta) once | the cron row (`17 3 * * *`) |

**d. Collect.** Stop the tails (Ctrl-C), then:

```bash
node scripts/measure-staging.mjs collect --file .measure/web-tail.jsonl --file .measure/admin-tail.jsonl --json .measure/report.json
node scripts/measure-staging.mjs collect --file .measure/web-tail.jsonl --only-measure          # only the probe's own requests
```

Per Worker, method and route: count, p50, p95, p99, max CPU, wall time, the outcomes (`exceededCpu` is error 1102; a 200 with `exceededCpu` is a `waitUntil` job that ran over), the statuses, and the first invocation after an idle gap with its own maximum. Thresholds, against the 10 ms of Free: **OK** p99 under 5 ms (2x margin); **RISK** p99 5 to 8 ms or a maximum 8 to 10; **FAIL** any `exceededCpu`, p99 over 8 ms, or a maximum of 10 ms or more. The gate of the ticket is "no FAIL"; every RISK is listed with its margin. Exit codes: 0 fine, 1 a route failed, 3 no data or no CPU field. Cloudflare records CPU in whole milliseconds, so p50 of 0 or 1 is normal; with few samples p99 is the maximum (the report says "only n samples"). On a FAIL, the fallbacks are in the audit, section 2.3. Write the table (route, n, p50, p99, max, verdict, margin) in SAKEM-084: **no ids, no addresses, no IPs**.

**e. The same numbers in the dashboard** (the account-level cross-check, and the route when the stream has no CPU field):

- **Workers & Pages**, the Worker, **Metrics**: **CPU Time per execution** (quantiles over the chosen range, per Worker, not per route; high quantiles can look above 10 ms without errors because of the isolate's rollover), **Wall Time per execution**, **Requests**, **Subrequests**, **Errors** then **Invocation statuses** (`Exceeded Resources` is 1102 or 1027; `Worker threw exception` is 1101). Set the range to the hour of the test.
- **Workers Logs**: Worker, **Logs** (or **Observability**, **Investigate**). Every invocation is one log (`GET <url>`) carrying its CPU and wall time (published since April 2025). Filter by the URL of one route, or build a query with a **median** or **p99** of CPU time grouped by path; the labels vary, so try it once. Retention on Free is **3 days** (7 from 2026-12-01), 200,000 events a day: read it the same day. Workers Logs shows the **full URL including query strings**: a `verify-email?token=` link you click on staging is in it for three days.
- The tail's JSON, if it has the field (wrangler may print a banner line first, hence the `grep`): `grep '^{' .measure/web-tail.jsonl | jq -r 'select(.cpuTime != null) | [.event.request.method, (.event.request.url|sub("\\?.*";"")), .cpuTime, .outcome] | @tsv' | sort | head`.

**f. After a few days**, look at the metrics again (rows written, requests, errors by status): a spike that only real traffic shows (a cold start, a long article, a first sign-in) is invisible to a bounded probe. Keep staging up for that.

## 14. Limits to watch

All per **account** (staging and production share them), all reset at 00:00 UTC. Look daily while staging is in use, then weekly. Nothing here bills you on the Free plan, it **stops** the feature; the card is only there for R2.

| What | Where | Free limit | Act at | If it is spent |
| --- | --- | --- | --- | --- |
| Worker requests | Workers & Pages, Metrics, Requests (account level) | 100,000 a day | 50,000 | error 1027 / 429 until midnight UTC |
| D1 rows written | D1, `sakem-staging`, Metrics, Row metrics | 100,000 a day | 30,000 | every write fails (sign-in, saves, contact) |
| D1 rows read | the same | 5,000,000 a day | 2,000,000 | every query fails |
| D1 size | `d1 info sakem-staging` | 500 MB per database | 100 MB | writes fail |
| R2 Class A operations (puts, lists) | R2, Overview, usage | 1,000,000 a month | 300,000 | writes fail |
| R2 Class B operations (reads) | the same | 10,000,000 a month | 3,000,000 | reads fail |
| R2 storage | the same | 10 GB | 5 GB | writes fail |
| Workers Logs events | Observability | 200,000 a day (0.5 GB a day from 2026-12-01) | 100,000 | logging stops |
| Resend mails | Resend, Emails | 100 a day, 3,000 a month | 50 a day | a 429; the admin's mail routes answer 503 |
| Cron runs | the Worker's Triggers, Workers Logs | 5 triggers per account | | |
| Turnstile | the widget's analytics | unlimited challenges | | |

Set a **billing or usage notification** in the account (Notifications) before R2 holds anything: it is the one place a card could bill. D1 rows written per day is the watch item the short-link decision left open ([`d1-schema.md`](d1-schema.md#free-tier-headroom-estimate)).

## 15. What must not be done on staging

- **A wrangler command without `--env staging` (admin), or a `cf/web` build without `CLOUDFLARE_ENV=staging`, for these Workers.** It creates the production-named Worker in the account. The shell variable of "Before the first command" is the safety net.
- **Real personal data**: no real student, applicant or contact data, no real admin passwords reused anywhere, no private files. The staging addresses are public. Only the 80 public articles and dummy rows.
- **Sharing the staging addresses** or linking them from a real page, mail or chat.
- **Anything on the zone**: no route, no custom domain, no DNS record, no nameserver change, no Cache Rule. Staging is on `workers.dev` by decision.
- **Production resources and keys**: the production D1 (`sakem-admin`), bucket (`sakem-files`), Turnstile widget, Resend domain, rate limit namespaces `78xx`.
- **A secret in `.staging.vars`**, in a ticket, in chat or in a commit. The printer refuses secret names; do not work around it.
- **`ENVIRONMENT=development`** or any value that switches the fail-closed rules off (email, Turnstile, rate limiting).
- **`CONTENT_API_URL`, `CONTACT_API_URL`**, or a real `LEGACY_ORIGIN_URL` (a real host would forward staging traffic to the live site).
- **`cache.enabled` (Workers Caching)**: it bills static assets as requests.
- **Load tests.** `measure-staging.mjs` caps itself (at most 60 rounds); another tool is not allowed: the 100,000 requests a day are the production site's too.
- **Answering yes** when wrangler offers to write ids into a configuration file.
- **The other three accounts.** If a command ever shows a database or Worker you do not recognise, stop.

## 16. Teardown

Order matters: the site's service binding points at the admin Worker, so the site goes first. **Each is a deletion: your explicit OK.**

```bash
cd cf/admin
pnpm exec wrangler delete --name sakem-web-staging                         # the site (and its workers.dev address)
pnpm exec wrangler delete --name sakem-admin-staging                       # the API Worker, its secrets, its cron
pnpm exec wrangler d1 delete sakem-staging                                 # the database and everything in it
pnpm exec wrangler r2 bucket dev-url disable sakem-files-staging           # type disallow
# empty the bucket in the dashboard (R2, the bucket, Objects, select all, delete), then:
pnpm exec wrangler r2 bucket delete sakem-files-staging
rm -f .staging.vars ../web/.staging.vars ../web/.measure/*.jsonl ../web/.measure/*.json
unset CLOUDFLARE_ENV CLOUDFLARE_ACCOUNT_ID
pnpm exec wrangler logout
```

In the dashboards: delete the Turnstile widget and the Resend key `sakem-staging`. The `workers.dev` subdomain of the account stays (it is the account's). Check afterwards: `wrangler d1 list`, `wrangler r2 bucket list` show nothing of staging; Workers & Pages shows no `*-staging` Worker. Staging used the production namespaces of nothing, so no production resource changes.

## Report back (no values)

Tell the PM only: the step number and "done" or "failed" with the message of a failure (no ids, no secrets, no addresses); the **checkpoint result of step 6** (rate limit bindings accepted or not); the three smoke-test results that were not the expected ones; the CPU table of step 13 with verdicts; whether `wrangler tail` carried `cpuTime`; the largest D1 rows-written day. Nothing else is required.
