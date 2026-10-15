# Staging runbook (owner's guide)

The exact, ordered steps to put the site on **staging**: three Workers on `*.workers.dev` in the organisation account (the admin API, the public site and, since SAKEM-098, the student portal), run from Dzul's Mac. Written for Dzul; **nothing here is run by an agent**. Ticket: SAKEM-084 (M5); the student portal's steps (15 to 22) are SAKEM-098. What the plan allows and where it can fail: [`free-plan-audit.md`](free-plan-audit.md). The account and token background: [`account-setup.md`](account-setup.md).

## Decisions this runbook rests on (Dzul, 2026-10-12)

- Staging is on **`workers.dev`**, in the organisation account (plan Free). The nameservers of `sakolakembara.org` are not touched before the cutover.
- The **Cache API is not expected to work on `workers.dev`**, so staging cannot prove cache behaviour (hit, stale, the 60 s window, purge); the code works without it, and staging is the uncached worst case for CPU and D1. The cache is tested on the cutover day.
- **Every deploy is manual**, from this Mac, with `wrangler login`. CI deploy is postponed.
- **Every real Cloudflare action needs your explicit OK, step by step**: creating a database or bucket, setting a secret, deploying, applying a remote migration, the first admin, the import, `wrangler tail` on a real Worker. This page says so in each step.
- The login sees **four accounts**: pin the organisation account every time and never touch the others.
- No ids, hostnames or secrets in the public repo; nothing secret through chat. Say "done" or "failed", never the value.

**Decisions taken on the open points of the audit (PM, 2026-10-13):**

- The location hint of the D1 database and the R2 bucket is **`apac`** (Dzul is in Indonesia). It cannot be changed later.
- Workers Logs: **`invocation_logs` stays ON during M5**, because the CPU record of step 13 lives in it. Log retention and the exposure of URL tokens (the invocation log holds the full URL, `?token=` included) are decided before cutover: go-live precondition P-23 of [`cutover-runbook.md`](cutover-runbook.md#3-preconditions).
- If the Rate Limiting binding is **refused on Free** (the checkpoint of step 6): the fallback to build is the **SQLite-backed Durable Object limiter**, as a separate task. Do not build it now; report the refusal and stop.
- If sign-in CPU fails (step 13): the fallback order is **fewer iterations first, then Google sign-in, then the Paid plan**.
- The public production route **fails OPEN** to the old origin (WordPress, behind the same hostname) when the 100,000-request day is spent, and the admin host **fails CLOSED**. This is a production-route setting (recorded in [`cutover-runbook.md`](cutover-runbook.md), D-06 and step S-33); staging on `workers.dev` has no route to set it on.

## What staging is made of

| Thing | Name (placeholder in git, created by you) |
| --- | --- |
| API Worker | `sakem-admin-staging` (`cf/admin`, `--env staging`) |
| Student portal Worker | `sakem-portal-staging` (`cf/admin`, `-c wrangler.portal.jsonc --env staging`; steps 15 to 22) |
| Public site Worker | `sakem-web-staging` (`cf/web`, `pnpm build:staging`) |
| D1 database | `sakem-staging`, **one for the admin and the portal**, as in production |
| R2 bucket, public | `sakem-files-staging`, public through its `r2.dev` address (the admin's uploads) |
| R2 bucket, private | `sakem-private-staging`, **never public**: no `r2.dev`, no custom domain (the applicants' documents; the admin and the portal bind it) |
| Rate limit namespaces | admin: `7901` to `7908`, `7921`, `7922`, `7931` to `7934`, `7941`; portal: `8101` to `8107`, `8131` to `8134` (the production ones are `78xx` and `80xx`; a shared id would share counters) |
| Addresses | `https://sakem-admin-staging.<account-subdomain>.workers.dev`, `https://sakem-web-staging.<account-subdomain>.workers.dev`, `https://sakem-portal-staging.<account-subdomain>.workers.dev` (the portal's pages are under `/portal/`) |
| Turnstile widget | one for the `workers.dev` hostnames, named "Sakola Kembara staging" |
| Resend key | one named `sakem-staging` (the portal's, step 19, may be a second) |

The staging block of each `wrangler.jsonc` and of `wrangler.portal.jsonc` (and the service binding of the site, which points at the **staging** admin Worker) is checked by tests; `pnpm deploy:staging:dry` in each package proves the bundles are the staging ones (in `cf/admin` it covers the admin's and the portal's). The shape of staging against production: [`free-plan-audit.md`](free-plan-audit.md#37-wrangler-environments-and-automatic-provisioning).

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
| `PORTAL_ENABLED` | site | optional public var | **leave it out** (Phase A: the portal is off, the navbar offers "Daftar Sekarang" and has no session call); `true` only to look at the Phase B navbar, and then also `PORTAL_ENABLED=true pnpm build:staging` (the prerendered pages take the build's value, never the `--var`) | same |
| `PAGE_CACHE_SECONDS` | site | optional public var | `30` to try the page copy in memory (step 13g); left out, every request renders | same |
| `BETTER_AUTH_SECRET` | admin | secret | `openssl rand -base64 32` | you, `wrangler secret put` |
| `RESEND_API_KEY` | admin | secret | the Resend key of step 7 | you, `wrangler secret put` |
| `TURNSTILE_SECRET_KEY` | admin | secret | the widget's secret key | you, `wrangler secret put` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | admin, portal | optional | not used on staging | nobody |
| `TRUSTED_ORIGINS`, `COOKIE_DOMAIN` | admin, portal | | left unset | nobody |
| `ENVIRONMENT` = `staging`, `PRIVATE_FILES_BUDGET_BYTES` = `8000000000` | portal | var | the staging block of `wrangler.portal.jsonc` (git) | nobody |
| `TURNSTILE_SITE_KEY` | portal | public var | the widget of step 19 (first: Cloudflare's always-pass test key) | `.staging.vars.portal`, printed as `--var` |
| `SITE_URL`, `ADMIN_URL` | portal | public var | the site's and the admin's `workers.dev` addresses | same |
| `EMAIL_FROM` | portal | public var | `Sakola Kembara Staging <onboarding@resend.dev>` (or a verified domain, step 19) | same |
| `PORTAL_CONTACT_WHATSAPP`, `PORTAL_WHATSAPP_GROUP_URL` | portal | optional public var | **invented** values, or the lines left out | same |
| `BETTER_AUTH_SECRET` | portal | secret | `openssl rand -base64 32`, **a different value from the admin's** | you, `wrangler secret put -c wrangler.portal.jsonc --env staging` |
| `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY` | portal | secret | the Resend key and the widget's secret key (step 19) | you, the same |
| `CONTENT_API_URL`, `CONTACT_API_URL` | site | | **never** (they move the reads and the form off the binding) | refused by the script |

`vars` come from the configuration file on **every** deploy: a variable that is not in the file or in a `--var` is removed by the next deploy (the portal's staging block declares its public values **empty**, so a forgotten one is blanked instead). That is why the deploy command is printed from one file (`.staging.vars`, or `.staging.vars.portal` for the portal; untracked) instead of typed. Secrets are never removed by a deploy.

## At a glance

| # | Step | Creates or changes | Your OK |
| --- | --- | --- | --- |
| 1 | Pin the account, log in | a login on this Mac | yes |
| 2 | Check locally | nothing on Cloudflare | no |
| 3 | Create the D1 database | an empty database | yes |
| 4 | Apply the migrations | 14 migrations, `0000` to `0013` (`0013` is the student portal's tables, SAKEM-083) | yes |
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
| 15 | Check the portal locally | nothing on Cloudflare | no |
| 16 | Create the private R2 bucket and prove it is private | a bucket, private | yes |
| 17 | Redeploy the admin Worker | a new version (the private bucket, the file routes) | yes |
| 18 | First deploy of the portal Worker | the Worker, its bindings | yes |
| 19 | The real Turnstile widget and the Resend key | dashboard objects | yes |
| 20 | Portal secrets, then redeploy with its public values | 3 secrets, a new version | yes |
| 21 | Portal smoke tests | requests only | no |
| 22 | End-to-end test with one invented applicant | rows in the remote D1, 10 objects, 2 or 3 mails | yes |
| 23 | What must not be done on staging | | |
| 24 | Teardown | deletes everything above | yes |

## Before the first command

Open one terminal for the whole session and set both variables in it (this shell only, never written to a file):

```bash
export CLOUDFLARE_ACCOUNT_ID=<id of the ORGANISATION account, from `wrangler whoami`>
export CLOUDFLARE_ENV=staging
```

`CLOUDFLARE_ENV=staging` makes every wrangler command in this shell target the staging environment even when a flag is forgotten (the portal's commands carry `-c wrangler.portal.jsonc --env staging` and read it the same way), and makes `pnpm build` in `cf/web` build the staging Worker; without it, wrangler only **warns** ("Multiple environments are defined ... no target environment was specified"), and a deploy would create the production-named Worker in the account. The commands below still carry `--env staging` where wrangler takes it, so they read the same without the variable. At the end: `unset CLOUDFLARE_ENV CLOUDFLARE_ACCOUNT_ID`.

The same variable also changes what the test runner and a production build use, so **do the local checks (steps 2 and 15) in a plain shell first**, or prefix those commands with `env -u CLOUDFLARE_ENV`.

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

## 4. Apply the migrations (`0000` to `0013`)

```bash
cd cf/admin
pnpm exec wrangler d1 migrations list  sakem-staging --env staging --remote     # fourteen not yet applied
pnpm exec wrangler d1 migrations apply sakem-staging --env staging --remote     # shows them, asks you to confirm
pnpm exec wrangler d1 execute sakem-staging --env staging --remote --command \
  "SELECT type, name FROM sqlite_master WHERE name IN ('signable_super_admins', 'users_keep_one_super_admin')"
```

- **Changes:** creates every table, index, view and trigger of `cf/admin/migrations/` in order, one transaction per file; a failing file is rolled back and the earlier ones stay. Wrangler takes a backup after applying. D1 counts these as a few hundred rows written (of 100,000 a day, per account).
- **Your OK:** yes.
- **Verify:** the last query returns **two rows**, a view and a trigger. `migrations list` now says there is nothing to apply.
- **Deploy order.** On an empty database the order against the Worker does not matter, so migrations come first here. For a **later** migration, read its note: `0010` came before the Worker that reads it, `0011` goes the other way (**deploy the Worker first, then apply `0011`**: [`auth.md`](auth.md#the-last-super_admin)); `0012` (`blog_posts.meta_description`, an additive nullable column, SAKEM-090) goes first, because the new API Worker selects it. The rule: a migration that only adds what the new Worker needs goes first; one that changes what the old Worker reads goes after the new Worker is live. Write the direction in the PR of every migration.
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

- **Creates:** the Worker `sakem-admin-staging` (its bindings: the D1 database and the two R2 buckets, the public one and the private `sakem-private-staging`, found by their names, the fifteen rate limit bindings, the assets), its cron trigger (`17 3 * * *`, daily cleanup), and the `workers.dev` address. No ids are written (the resources exist already). **The private bucket must exist before this deploy**, or the deploy may create it for you without the location hint: create it with the commands of [step 16](#16-create-the-private-r2-bucket-and-prove-it-is-private) first (its first command lists the buckets, and its checks prove the bucket is private).
- **Your OK:** yes.
- **CHECKPOINT, read the output.** The question of this step is **whether the Free plan accepts the `ratelimits` bindings** ([`free-plan-audit.md` 3.1](free-plan-audit.md#31-rate-limiting-binding-ratelimits)). The listing in the output must show `env.RL_LOGIN (5 requests/60s)` and the fourteen others, and the deploy must end with the address and a version id. **If the deploy is refused because of a rate limit binding, stop here**: tell the PM the exact message (no ids), and do not build anything on it. The decided fallback is the SQLite-backed Durable Object limiter, built as a separate task ([`free-plan-audit.md` 3.1](free-plan-audit.md#31-rate-limiting-binding-ratelimits)).
- **Verify** (replace the address):

  ```bash
  A=https://sakem-admin-staging.<account-subdomain>.workers.dev
  curl -si $A/api/config | head -20          # 200, JSON: "turnstileSiteKey": null, "uploadsBaseUrl": "", "siteUrl": ""
  curl -si $A/api/me | head -5               # 401 {"error":"unauthenticated"}
  git status --short                         # clean
  ```

- **Revert:** `pnpm exec wrangler delete --name sakem-admin-staging` (asks to confirm; removes the Worker, its secrets, its cron and its `workers.dev` route; the database and the bucket stay).

## 7. Turnstile widget and Resend key (dashboard, by you)

**Turnstile.** Dashboard, **Turnstile**, **Add widget**: name "Sakola Kembara staging"; hostname **`<account-subdomain>.workers.dev`** (one hostname covers every subdomain under it, so both staging Workers; wildcards are not accepted); mode Managed. Copy the **site key** into both `.staging.vars` files as `TURNSTILE_SITE_KEY`. The **secret key** goes only to `wrangler secret put` in step 8. Free plan: 20 widgets, 10 hostnames each. This must be a real widget: Cloudflare's always-pass test keys work anywhere but prove nothing about the real script, the iframe, `data-action` or Siteverify. (Staging may run on the test keys for now; the portal test of [step 19](#19-the-real-turnstile-widget-and-the-resend-key-dashboard-by-you) is where the real widget is made, and the same widget serves the admin and the site.)

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

An address you control (use the **same address as the Resend account**, so the invitation of a second admin can reach you; if you will test the portal with the sandbox sender, read the mailbox choice of [step 19](#19-the-real-turnstile-widget-and-the-resend-key-dashboard-by-you) first: the applicant may need that address, and one address cannot be both an admin and a student), a name, and a long password typed at the hidden prompt, twice. It writes `CAPITALS` that it is the real database and asks you to type the database name (`sakem-staging`). Everything about it, the password rules and what to do when it goes wrong: [`first-super-admin.md`](first-super-admin.md). Do not pipe the password; never send it anywhere.

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

- **Why that last one.** The site forwards WordPress's own paths (`/wp-login.php`, `/wp-admin/*`, `/wp-content/*`, `/wp-includes/*`, `/wp-json/*`, `/xmlrpc.php`, `/login`; SAKEM-103) to "the legacy origin" with a plain `fetch`, which in production reaches the WordPress site behind the same hostname. On `workers.dev` nothing is behind the hostname, so the fetch would go back into the same Worker, up to Cloudflare's loop limit of 16 invocations for one request, on a 100,000-a-day budget ([`free-plan-audit.md` 7.1](free-plan-audit.md#7-staging-findings)). A `*.invalid` host never resolves, so the forward fails at once. The printer accepts no other value for it.
- **Creates:** the Worker `sakem-web-staging`, its `API` service binding to `sakem-admin-staging#PublicApi` (the admin Worker must exist: that is why it came first), the static assets (about 1,000 files, 137 MiB), its `workers.dev` address. No cron, no database.
- **Your OK:** yes.
- **Verify:** the output lists `env.API (sakem-admin-staging#PublicApi)`; the smoke tests of step 11.
- **Revert:** `pnpm exec wrangler delete --name sakem-web-staging` (first, before the admin: the site's binding points at it).
- A staging **build** replaces `dist/`. Rebuild before any production deploy (`pnpm build` without `CLOUDFLARE_ENV`); the name written into `dist/server/wrangler.json` is what gets deployed.

## 11. Smoke tests

```bash
W=https://sakem-web-staging.<account-subdomain>.workers.dev
A=https://sakem-admin-staging.<account-subdomain>.workers.dev
for p in / /blog /tim /laporan /gabung-siswa /gabung-siswa/docs /kontak /donasi /program/prapembinaan /robots.txt /sitemap.xml /feed /no/such/page /api/x /admin /_next/x /daftar /register /wp-login.php; do
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
| `W/_next/x` | 404 (the site's page: the old Next prefixes are not forwarded any more) |
| `W/wp-login.php`, `W/login`, `W/wp-admin/`, `W/wp-content/x` | fail **fast** with a 5xx (the `.invalid` origin), never slowly, never a loop (they are WordPress's paths, and staging has no WordPress) |
| `W/daftar` | the polite 404 page "Formulir pendaftaran belum tersedia" until you create a `daftar` shortlink in the staging admin (Konten situs, Shortlink; use an invented target, never the real form), then a 307 to its target; `W/register` and `W/portal`: the site's 404 |
| `A/`, `A/login` | 200 (the SPA) |
| `A/api/config`, `A/api/me` | 200 JSON, 401 |
| `A/api/public/team` | **404** (the reads exist on the service-binding entrypoint only) |
| `curl -si -X POST $A/api/public/contact -H "origin: $A" -H 'content-type: application/json' -d '{}'` | **404** |
| `A/uploads/x`, `A/api/dev/mailbox` | 404 JSON |

Things only these two requests can show (note them for the PM, no values): `curl -sI $W/ | grep -i strict-transport` (the security headers are there); whether `cf-ray` answers from a nearby location. Things the real deploy settles that nothing else can: [`free-plan-audit.md` section 9](free-plan-audit.md#9-what-only-a-real-account-can-settle).

## 12. Seed data

**The 86 articles** (the 80 migrated and the 6 added on 2026-10-13; explicit approval; **this writes**). It writes 86 `blog_posts` rows (about 430 to 540 D1 rows written with their index entries, of 100,000 a day) in one idempotent upsert per article, each with its `meta_description` (migration `0012` must be applied first): rerunning it leaves an article that was edited in the admin alone. The longest statement is 21,161 bytes (D1's limit is 100,000).

```bash
cd cf/admin
pnpm exec wrangler d1 time-travel info sakem-staging --env staging          # write down the bookmark: the way back
pnpm blog:import:local -- --out /private/tmp/legacy-blog.sql                # only writes the SQL; nothing is applied
wc -l /private/tmp/legacy-blog.sql                                          # 86 lines; read a few
pnpm exec wrangler d1 execute sakem-staging --env staging --remote --file /private/tmp/legacy-blog.sql   # <- your OK
pnpm exec wrangler d1 execute sakem-staging --env staging --remote --command "SELECT count(*) AS n FROM blog_posts"   # 86
rm /private/tmp/legacy-blog.sql
```

- **Verify:** `W/blog` shows 15 cards and the featured article; `W/blog/macam-macam-gaya-belajar-dan-cara-mengoptimalkannya` renders with its images; `W/sitemap.xml` lists the 80; `curl -s $A/api/public/blog` is still 404.
- **Revert:** Time Travel (`d1 time-travel restore sakem-staging --env staging --bookmark <the one you wrote down>`), or `DELETE FROM blog_posts WHERE wp_id IS NOT NULL`.
- Do not use `--out` into the repo; the file is public text anyway, but the habit matters for the other scripts.

**A short link.** The real links of the old Postgres are not migrated: they are created again by hand in the new admin (Konten Situs, Shortlink), on staging one test link, e.g. `uji-staging` to `https://sakolakembara.org/blog`. Check `curl -sI $W/uji-staging` is a 307 and that the click count in the admin rose by one (**one D1 row written per click, unbounded, by decision**). The names already used by a page, a redirect or a forwarded path are refused by the admin.

**Uploads.** In the admin, upload a small team photo and look at it on `W/tim`: the file comes from `UPLOADS_BASE_URL`; open its address and confirm `cache-control: public, max-age=31536000, immutable` and the right `content-type`. The large ones (5 MB image, 20 MB and 25 MB PDF) belong to the measurement of step 13.

## 13. Measure CPU per route

The question: **no route reaches error 1102 on Free, with the margin written down per route** (SAKEM-084). CPU is Cloudflare's own number per invocation; a timer inside a Worker cannot measure it. Tools: `cf/web/scripts/measure-staging.mjs` (`pnpm measure:staging`), the dashboard, Workers Logs.

**a. Capture the tail** (three terminals, one per Worker; read-only, **your OK**: it connects to a real Worker). The capture holds request URLs, geo data and **your IP address** in the headers: it is written to `cf/web/.measure/` (git-ignored), never goes into the repo, a ticket or chat; delete it after.

```bash
cd cf/web && mkdir -p .measure
pnpm exec wrangler tail sakem-web-staging    --format json > .measure/web-tail.json      # terminal 1
pnpm exec wrangler tail sakem-admin-staging  --format json > .measure/admin-tail.json    # terminal 2 (from cf/web too)
pnpm exec wrangler tail sakem-portal-staging --format json > .measure/portal-tail.json   # terminal 3
head -c 700 .measure/web-tail.json; echo
```

`wrangler tail --format json` prints every event as **pretty-printed JSON of many lines**, after two banner lines. `collect` reads that form as it is (and the older one-object-per-line form), skips the banner and an object that was cut when the tail was stopped, and never needs the capture compacted first. The first request lines settle one open question: **does the stream carry `cpuTime` and `wallTime`?** (The trace item that Tail Workers receive has both; the documentation's example of the real-time stream shows neither.) If the lines have no `cpuTime`, use the dashboard and Workers Logs below for the numbers; the collector still counts outcomes and statuses, and says so. A tail expires after a while ("expires at" in its first line): restart it; under heavy traffic it samples and prints a notice.

**b. Probe** (GET only, polite, bounded). First look at what it would send, then send:

```bash
node scripts/measure-staging.mjs plan  --base $W --admin $A --portal $P    # prints every request, sends nothing
node scripts/measure-staging.mjs probe --base $W --admin $A --portal $P    # asks you to type the host of --base, then of --admin, then of --portal
```

12 rounds of 27 routes (40 with `--portal`), 600 ms apart: 324 requests in about 4 minutes (480 in about 6), of which 252 run a Worker (384 with the portal: 0.25% and 0.38% of the day's 100,000, shared with production). User agent `sakem-staging-measure/1.0`. `--base` is always probed (the site's 19 routes); leave `--admin` or `--portal` out to skip that Worker. `--confirm-portal <host>` is the typed confirmation when there is no terminal, as `--confirm-admin` is. It refuses any host that is not `*.workers.dev` (or loopback), refuses `sakolakembara.org` outright, sends no credential and no cookie, never follows a redirect, stops a route that answers 429 and the run after five failures in a row, and reports error 1102 when an answer carries it. **The portal's part of the probe** is the two pages of the assets layer (`/portal/`, `/portal/status`, controls: no Worker event expected) and nine GET routes that need no cookie: `config`, `me` (401), `auth/get-session` (`null`), the three student reads and the file route (401 each), an auth route that is not in the table (404), an unknown route and `dev/mailbox` (404), plus a missing static file (the 404 or the index: the tail settles which). It sends **no cookie, no credential, no POST** (`--writes` adds nothing for the portal), asks nothing behind a rate limit, and so cannot provoke a 429 of its own. `--writes` (needs a second typed confirmation) adds the two POSTs the Workers refuse before storing anything: a contact form without a Turnstile token (`turnstile_failed`) and a sign-in with an unknown address (a 403 before any password is hashed). They are paced at 13 s for the rate limit (about five more minutes) and **are not the cost of a real sign-in**.

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
| **Portal** (tail 3, an invented applicant, [step 22](#22-end-to-end-test-with-one-invented-applicant)): register, then open the emailed link | `POST /portal/api/auth/register` (PBKDF2 and a call to Resend), `GET /portal/api/auth/verify-email` |
| Portal: sign in (right password, then wrong once), a second time in the same minute; wait **ten minutes** and sign in again | `POST /portal/api/auth/sign-in/email`: **the portal's heaviest route** (PBKDF2), warm and cold |
| Portal: "lupa password", open the link, set a new one | `POST /portal/api/auth/request-password-reset`, `reset-password` |
| Portal: home, the status page, open the wizard (with and without files) | `GET /portal/api/overview`, `applications`, `applications/current` |
| Portal: "Selanjutnya" on each screen of the wizard | `PUT /portal/api/applications/current/steps/<step>` (seven buckets) |
| Portal: upload a photo, then `berkas-9mb.pdf` (step 22 makes it; 10,000,000 bytes is the limit) | `PUT /portal/api/applications/current/files/<slot>`: the streamed body, the sniff, the guarded insert; also watch memory |
| Portal: "Lihat" on a stored file | `GET /portal/api/files/:id` |
| Portal: "Kirim Pendaftaran" | `POST /portal/api/applications/current/submit` (seven schemas, the transformation; the mail goes with `waitUntil`) |
| Admin (tail 2): open one applicant's file; purge an application's files | `GET /api/admin/applications/:id/files/:fileId`, `POST /api/admin/applications/:id/files/purge` |

**d. Collect.** Stop the tails (Ctrl-C), then:

```bash
node scripts/measure-staging.mjs collect --file .measure/web-tail.json --file .measure/admin-tail.json --file .measure/portal-tail.json --json .measure/report.json
node scripts/measure-staging.mjs collect --file .measure/web-tail.json --only-measure          # only the probe's own requests
```

Per Worker, method and route: count, p50, p95, p99, max CPU, wall time, the outcomes (`exceededCpu` is error 1102; a 200 with `exceededCpu` is a `waitUntil` job that ran over), the statuses, and the first invocation after an idle gap with its own maximum. Thresholds, against the 10 ms of Free: **OK** p99 under 5 ms (2x margin); **RISK** p99 5 to 8 ms or a maximum 8 to 10; **FAIL** any `exceededCpu`, p99 over 8 ms, or a maximum of 10 ms or more. The gate of the ticket is "no FAIL"; every RISK is listed with its margin. Exit codes: 0 fine, 1 a route failed, 3 no data or no CPU field. Cloudflare records CPU in whole milliseconds, so p50 of 0 or 1 is normal; with few samples p99 is the maximum (the report says "only n samples"). On a FAIL, the fallbacks are in the audit, section 2.3; for sign-in the decided order is fewer iterations, then Google sign-in, then the Paid plan. Write the table (route, n, p50, p99, max, verdict, margin) in SAKEM-084: **no ids, no addresses, no IPs**.

**e. The same numbers in the dashboard** (the account-level cross-check, and the route when the stream has no CPU field):

- **Workers & Pages**, the Worker, **Metrics**: **CPU Time per execution** (quantiles over the chosen range, per Worker, not per route; high quantiles can look above 10 ms without errors because of the isolate's rollover), **Wall Time per execution**, **Requests**, **Subrequests**, **Errors** then **Invocation statuses** (`Exceeded Resources` is 1102 or 1027; `Worker threw exception` is 1101). Set the range to the hour of the test.
- **Workers Logs**: Worker, **Logs** (or **Observability**, **Investigate**). Every invocation is one log (`GET <url>`) carrying its CPU and wall time (published since April 2025). Filter by the URL of one route, or build a query with a **median** or **p99** of CPU time grouped by path; the labels vary, so try it once. Retention on Free is **3 days** (7 from 2026-12-01), 200,000 events a day: read it the same day. Workers Logs shows the **full URL including query strings**: a `verify-email?token=` link you click on staging is in it for three days.
- The tail's JSON, if it has the field (wrangler prints two banner lines first, hence the `grep`; the events are pretty-printed, which `jq` reads as a stream): `grep -v '^[A-Za-z]' .measure/web-tail.json | jq -r 'select(.cpuTime != null) | [.event.request.method, (.event.request.url|sub("\\?.*";"")), .cpuTime, .outcome] | @tsv' | sort | head`.

**f. After a few days**, look at the metrics again (rows written, requests, errors by status): a spike that only real traffic shows (a cold start, a long article, a first sign-in) is invisible to a bounded probe. Keep staging up for that.

**g. After SAKEM-091 (the first fixes of what this step found, 2026-10-14): what to re-run and what to compare.** What the first probe measured, what was found and what changed is in [`free-plan-audit.md`](free-plan-audit.md#10-cpu-on-the-hot-routes-sakem-091); that section has the per-route table to compare against. Redeploy both Workers (steps 6 and 10), then run the same probe (step b) and the same collection (step d). Three things to look at in particular, and one switch to try:

- **The 401 routes of the admin** (`/api/me`, `/api/dashboard`, `/api/admin/blog`) should now cost about what `/api/config` costs: a request without a session cookie no longer builds Better Auth. A cookie-less probe cannot show the rest (the shared Better Auth, the prepared queries), because those need a session: do a few signed-in reads by hand as in step c and compare with the figures of 2026-10-14.
- **The first invocation after an idle gap** (the collector prints it apart) is where a change of the cold cost shows. The admin Worker now runs a start-up warm-up of the library code (`src/warmup.ts`). Whether Cloudflare charges that to the first request is not documented, so this is the number that tells. It logs nothing when it works and one line, `[warm-up] skipped (<ErrorName>)`, once per isolate start when it does not (search Workers Logs for `warm-up`). To switch it off, set `WARM_UP_ENABLED` to `false` in that file and redeploy.
- **Sign-in twice.** The 89 ms of the first sign-in is a cold isolate plus the hash; sign in a second time in the same minute (same isolate) and compare: the second is the figure for a warm Worker. The hash parameters were not touched.
- **The page copy on the site, off by default.** Put `PAGE_CACHE_SECONDS=30` in `cf/web/.staging.vars` (the deploy command accepts it), deploy the site, run the probe again and compare `/blog`, `/blog/<slug>`, `/tim`, `/laporan`, `/gabung-siswa/docs` and `/sitemap.xml` with the run without it. A page answered from the copy says `x-page-cache: hit`; the render that made it says `miss` (the probe prints the headers it sees). Remove the line and redeploy to go back. At 600 ms between requests a route comes round every 16 s, inside the 30 s the copy lives, so most requests of the second round on should be hits **if the isolate is the same**: the share of `hit` among the answers is itself a measurement of how many isolates the site gets.

Locally, with no account, the same comparison can be made before a deploy: `pnpm measure:cpu` in `cf/admin` and in `cf/web` (after `pnpm build`) print the Worker's own JavaScript per request for the same routes; the method and its limits are in the audit section.

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
| R2 storage | the same (the private bucket counts too) | 10 GB; the portal refuses an upload past `PRIVATE_FILES_BUDGET_BYTES` (8 GB, `503 storage_full`) | 5 GB | writes fail |
| Workers Logs events | Observability | 200,000 a day (0.5 GB a day from 2026-12-01) | 100,000 | logging stops |
| Resend mails | Resend, Emails; the portal's own count: `SELECT day, sent FROM email_daily ORDER BY day DESC LIMIT 2` (a **UTC** day, 07:00 to 07:00 in Jakarta) | 100 a day, 3,000 a month | 50 a day | a 429; the admin's mail routes answer 503; at 100 the portal's register, resend and reset answer `503 email_quota`, and it sends the submission confirmation only below 80 |
| Cron runs | the Worker's Triggers, Workers Logs | 5 triggers per account | | |
| Turnstile | the widget's analytics | unlimited challenges | | |

Set a **billing or usage notification** in the account (Notifications) before R2 holds anything: it is the one place a card could bill. D1 rows written per day is the watch item the short-link decision left open ([`d1-schema.md`](d1-schema.md#free-tier-headroom-estimate)).

## The student portal on staging (steps 15 to 22, SAKEM-098)

The third Worker, `sakem-portal-staging` (`cf/admin`, its own configuration `wrangler.portal.jsonc`, `-c wrangler.portal.jsonc --env staging`), with the private bucket `sakem-private-staging` for the applicants' documents. Everything above holds here: **nothing is run by an agent, every real step needs your explicit OK, no ids or hostnames in git, no secret through chat.** Steps 1 to 9 (account, database, migrations, the admin Worker with its first super_admin) are done before these; the site (step 10) is not needed.

**Decisions this part rests on (PM and Dzul, 2026-10-15):**

- Turnstile on staging uses Cloudflare's published always-pass **test** keys until the portal test; a **real** widget for the `workers.dev` hostname is created together with the portal staging test (step 19), because the test keys prove nothing about the real script, `data-action` or Siteverify.
- Resend is set up with that test too, or the sender stays `onboarding@resend.dev`, which only mails the address of the Resend account (step 19, "Which address receives the mail").
- Resend's daily limit (100 a day) counts the **UTC day**, which starts at 07:00 in Jakarta; the portal's own counter (`email_daily`) uses the same day.
- You check the screens yourself (no agent opens a browser); this part gives the exact requests and the expected status of each, and says plainly what only a browser can show.

**How the portal is reached on `workers.dev`.** There is no apex route on staging, so the Worker answers the `/portal/...` paths **directly at its own host**: the entry is `https://sakem-portal-staging.<account-subdomain>.workers.dev/portal/` (the host's `/` answers the same index page, but the router only knows `/portal`, so always type the path). The API is `P/portal/api/...` on the same host. Three consequences:

- The session cookie is `__Host-sakem-student.session_token`, **host-only** on the portal host: signing in there does not sign in on the admin host (its cookie has another name and lives on another host), and the two Workers have different `BETTER_AUTH_SECRET`s.
- The emailed links (verify, reset) are built from the origin of the request that asked for them, so they point at the portal host.
- The public site's "Daftar Sekarang" and "Masuk" buttons and its navbar call `W/portal/...` on **the site's own host**, where nothing answers (a 404 page). On staging, open the portal address by hand. What this hides is listed in [What staging cannot show about the portal](#what-staging-cannot-show-about-the-portal).

## 15. Check the portal locally (no account)

```bash
cd cf/admin
env -u CLOUDFLARE_ENV pnpm install --frozen-lockfile && pnpm typecheck && pnpm test:worker && pnpm test:portal-spa && pnpm check:portal-worker
pnpm build:portal-spa && pnpm check:portal-spa     # the SPA that will be deployed; it fails if the development mock is in it
pnpm deploy:staging:dry                            # the admin's AND the portal's: two "staging dry-run ok" lines
cp staging.portal.vars.example .staging.vars.portal   # git-ignored; filled in at steps 18 to 20
```

- **What the SPA build needs:** nothing from the environment and no account. Do not set `VITE_PORTAL_MOCK` or `VITE_ADMIN_MOCK` in this shell (they switch the invented API on; `pnpm check:portal-spa` refuses a build that has it). The build writes `dist/portal-spa/` (the pages under `portal/`, the fallback `index.html` and `_headers` at its root), which the Worker serves from its own assets.
- **Creates or changes:** nothing on Cloudflare. `dist/` folders and `.staging.vars.portal` on this Mac, both git-ignored.
- **Your OK:** no.
- **Verify:** `deploy:staging:dry` ends with `staging dry-run ok: sakem-admin-staging, ...` and `staging dry-run ok: sakem-portal-staging, ...` (about 514 KiB gzipped; the guard is 540 for the portal). The portal's listing has `env.DB (sakem-staging)`, `env.PRIVATE_FILES (sakem-private-staging)`, the eleven `env.RL_*` and the six public variables as `("")`; it has **no** `env.UPLOADS`, no `RL_CONTACT`, `RL_UPLOAD`, `RL_BLOG_PREVIEW` or `RL_ADMIN_FILE`.
- **Revert:** `rm .staging.vars.portal`.

## 16. Create the private R2 bucket and prove it is private

```bash
cd cf/admin
pnpm exec wrangler r2 bucket list                     # read-only: is sakem-private-staging there already?
CI=1 pnpm exec wrangler r2 bucket create sakem-private-staging --location apac     # only if it was not
pnpm exec wrangler r2 bucket info sakem-private-staging                            # name, location, storage class
pnpm exec wrangler r2 bucket dev-url get sakem-private-staging                     # must NOT show a public address
pnpm exec wrangler r2 bucket domain list sakem-private-staging                     # must list no custom domain
```

- **Creates:** a bucket for the applicants' documents (documents of children: on staging only invented files go in). It is **private**: a bucket is private until someone enables a public address in the dashboard, and this runbook never does. No `bucket dev-url enable`, no `bucket domain add`, ever.
- **It may exist already.** The admin staging block binds this bucket, and a deploy of the admin Worker (step 6, or a later one) can create a bucket from its binding without the location hint (`--location apac` cannot be changed later). If `bucket list` shows it, do not create it: read the location in `bucket info`. If it is not `apac` and the bucket is empty, you may delete it (`wrangler r2 bucket delete sakem-private-staging`, your OK) and create it again as above; tell the PM either way.
- **What it exposes:** nothing outside the two Workers that are bound to it. R2 gives a binding the whole bucket, so the **code paths are the access control**: only the portal (a student reads their own file) and the admin (an admin with `pendaftaran` write opens a file, audited) read it. It is the only R2 binding the portal has: the admin's public bucket is never reachable from the portal.
- **Your OK:** yes. R2 is on the Free tier only with a card on file and "a card is not a spending cap": the billing notification of [`account-setup.md`](account-setup.md#part-1-quick-checks-5-minutes-now) must be set before anything is stored.
- **PROVE no public access** (three checks, repeated after **every** later change to R2 in the dashboard):
  1. The CLI: `dev-url get` says the public development URL is disabled and prints no `pub-<hash>.r2.dev` address; `domain list` lists nothing. **If a public address or a domain shows, stop:** `pnpm exec wrangler r2 bucket dev-url disable sakem-private-staging` (type `disallow`), remove the domain, tell the PM.
  2. The dashboard: R2, the bucket, **Settings**: *Public Development URL* is **Disabled** and *Custom Domains* has none.
  3. Requests, once step 22 has stored a file (its key is in the dashboard, R2, the bucket, **Objects**, shaped `applications/<year>/<application id>/<file id>.<ext>`): an object address must fail.

     ```bash
     K='applications/<year>/<application id>/<file id>.png'              # a key from the Objects list
     curl -s -o /dev/null -w '%{http_code}\n' "https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com/sakem-private-staging/$K"   # 403 (refused: no signature), never 200
     curl -s -o /dev/null -w '%{http_code}\n' "$UPLOADS_BASE_URL/$K"     # 404: the PUBLIC bucket's address has no such key (UPLOADS_BASE_URL is the r2.dev address of step 5)
     curl -s -o /dev/null -w '%{http_code}\n' "$P/portal/api/files/<file id>"   # 401: even this Worker route refuses without the student's cookie
     ```

     The first two codes are the expected ones from the documentation, **not verified on a real account**: what matters is that none of the three is a `200` with the file's bytes (`content-type: image/png`).
- **Revert:** empty the bucket (dashboard, Objects, select all, delete), then `pnpm exec wrangler r2 bucket delete sakem-private-staging`. Delete the Workers that bind it first (step 24).

## 17. Redeploy the admin Worker (private bucket and file routes)

```bash
cd cf/admin
pnpm build:spa
pnpm deploy:staging:command      # prints:  pnpm exec wrangler deploy --env staging --var '...'
# copy that line, check it, run it
```

- **Why:** the admin staging block binds `PRIVATE_FILES` and the code that **opens an applicant's file** and **purges an application's files** (SAKEM-083, P4) must be live for step 22. A Worker deployed before that has neither. `pnpm exec wrangler deployments list --env staging` shows when the live version was made; redeploy it whatever it says, it costs nothing.
- **Creates:** a new version of `sakem-admin-staging`, from the same `.staging.vars` as before (`TURNSTILE_SITE_KEY`, `UPLOADS_BASE_URL`, `SITE_URL`, `EMAIL_FROM`). No migration: `0013` is applied (step 4).
- **Your OK:** yes.
- **Verify:** the output lists `env.PRIVATE_FILES (sakem-private-staging)` and the fifteen `env.RL_*`; `curl -s $A/api/config` still answers its three values; `git status --short` is clean.
- **Revert:** `pnpm exec wrangler rollback --env staging` (asks to confirm; back to the previous version).

## 18. First deploy of the portal Worker

```bash
cd cf/admin
pnpm build:portal-spa && pnpm check:portal-spa
pnpm exec wrangler deploy -c wrangler.portal.jsonc --env staging
```

Run it in a normal terminal, **no `--var` and no secret yet**: this deploy shows that the Worker, its bindings and its assets are accepted before anything depends on them.

- **Creates:** the Worker `sakem-portal-staging` with the D1 database `sakem-staging` (found by its name: it is the admin's, as in production), `PRIVATE_FILES` on `sakem-private-staging`, the eleven rate limit bindings (namespaces `8101` to `8107` and `8131` to `8134`), about eleven asset files and its `workers.dev` address `https://sakem-portal-staging.<account-subdomain>.workers.dev`. No cron, no route, no secret. No ids are written.
- **What it exposes:** a public host with the portal's pages and API. Until step 20 it has no secrets, so sign-in, registration and every route that sends email **fail closed (503)**: nothing can be created. It holds no one's data (the staging database has the admin and the articles only). Do not share the address.
- **Your OK:** yes.
- **Verify** (replace the address):

  ```bash
  P=https://sakem-portal-staging.<account-subdomain>.workers.dev
  curl -si $P/portal/api/config | head -12   # 200 JSON: {"google":false,"turnstileSiteKey":null,"siteUrl":"","adminUrl":""}
  curl -si $P/portal/api/me | head -8        # 401 {"error":"unauthenticated"}, cache-control: no-store
  curl -sI $P/portal/ | head -10             # 200 text/html, cache-control: public, max-age=0, must-revalidate, content-security-policy: ...
  git status --short                         # clean
  ```

- **Revert:** `pnpm exec wrangler delete --name sakem-portal-staging` (asks to confirm; removes the Worker, its secrets and its `workers.dev` route; the database and the bucket stay).

## 19. The real Turnstile widget and the Resend key (dashboard, by you)

- **Creates:** a Turnstile widget (unless the one of step 7 exists) and a Resend API key, in their own dashboards: nothing on a Worker and nothing in git. Their values are not typed anywhere in this repo: the site key goes into `.staging.vars.portal` (step 20), the two secrets into `wrangler secret put`.
- **Your OK:** yes, for each of the two (and for the sending domain of choice A below, if you take it).

**Turnstile.** The widget of step 7 (hostname `<account-subdomain>.workers.dev`) covers **every** host under that name, so it covers the portal; if it exists, reuse its site key here and its secret key in step 20. If staging has run on the always-pass test keys so far (the pair is in `cf/admin/dev.vars.example`), create the widget now: Turnstile, **Add widget**, name "Sakola Kembara staging", hostname `<account-subdomain>.workers.dev`, mode Managed. The widget takes any `data-action`, and the portal's four are `register`, `login`, `forgot-password` and `resend-verification`: the real widget is what proves Siteverify accepts them. Each Worker has its own pair of site key (a public variable) and secret, so the portal can switch to the real widget while the admin and the site keep the test pair; switching all three is simpler.

- **Revert:** delete the widget (Turnstile, the widget, Settings).

**Resend.** Create an API key named `sakem-staging-portal` with **sending access only**; the portal's `EMAIL_FROM` is `Sakola Kembara Staging <onboarding@resend.dev>` until a domain is verified. Free plan: 100 mails a day, 3,000 a month, the day counted in UTC.

- **Revert:** delete the key in Resend.

**Which address receives the mail (decide before step 22).** Without a verified domain `onboarding@resend.dev` delivers **only to the address of the Resend account itself**, and a plus-address is not documented to count. The invented applicant must be able to open the verification link, and **one address cannot be both a student and an admin** (the `users` table has one row per address). Step 9 suggested using the Resend account's address for the first super_admin. So there are three ways, with what each one proves:

| | What you do | What it proves | What it costs |
| --- | --- | --- | --- |
| **A. Verify a sending domain in Resend** (recommended) | Add a domain you control (a mail-only sub-domain is enough) in Resend and publish the SPF and DKIM records it lists, then use any mailbox you own as the applicant and set `EMAIL_FROM` to an address of that domain | The whole mail path: sender, delivery, the link, **and the rehearsal the cutover needs anyway** (production sends from a verified domain) | DNS records at the domain's current DNS host (never a nameserver change, never on the Cloudflare zone). Your call; this runbook's rule "nothing on the zone" is about Cloudflare |
| **B. Sandbox sender, a student on the Resend address** | Give the first super_admin another address (step 9's revert, or an invited second admin), and register the invented applicant with the Resend account's own address | The whole mail path for that one address | A second admin address, and the Resend address is then a student, not an admin |
| **C. No mail for the applicant** | Register with an invented address, then mark it verified by hand: `UPDATE users SET email_verified = 1 WHERE email = '<applicant address>'` (`wrangler d1 execute sakem-staging --env staging --remote --command ...`, your OK). To see Resend deliver from the portal, register the **admin's** address once: the neutral answer sends "Kamu sudah punya akun Sakola Kembara" to it | Everything except the verification mail and its link | The verification email and its callback are **not tested**: they stay on the cutover rehearsal |

Tell the PM which one you chose. Everything below says "the applicant's address": it is that address.

## 20. Portal secrets, then redeploy with its public values

```bash
cd cf/admin
openssl rand -base64 32 | pbcopy                                                         # a NEW value, not the admin's: do not paste the clipboard of step 8
pnpm exec wrangler secret put BETTER_AUTH_SECRET -c wrangler.portal.jsonc --env staging  # paste at the hidden prompt; then clear the clipboard
pnpm exec wrangler secret put RESEND_API_KEY -c wrangler.portal.jsonc --env staging      # the key of step 19
pnpm exec wrangler secret put TURNSTILE_SECRET_KEY -c wrangler.portal.jsonc --env staging   # the widget's secret key (or the test one, for a first look)
pnpm exec wrangler secret list -c wrangler.portal.jsonc --env staging                    # NAMES only: the three
```

Then fill `cf/admin/.staging.vars.portal` (`TURNSTILE_SITE_KEY`, `SITE_URL` = the site's address, `ADMIN_URL` = the admin's address, `EMAIL_FROM`; the two WhatsApp lines only with **invented** values) and let the repo print the deploy command, read it, run it:

```bash
pnpm build:portal-spa
pnpm deploy:staging:portal:command      # prints:  pnpm exec wrangler deploy -c wrangler.portal.jsonc --env staging --var 'TURNSTILE_SITE_KEY:...' --var '...'
# copy that line, check it, run it
```

- **Changes:** three secrets on the portal Worker (encrypted, never shown again), then a new version with its public values. The printer refuses a secret name, an API URL, a placeholder (`<...>`), an `http://` origin, a path, a trailing slash, the production domain, a WhatsApp invitation of WhatsApp's own address and the admin's or the site's variables, with the line number, and **prints, never runs**. A value left out of the file is **blank** after the deploy (the staging block declares each one empty), not kept.
- **The two `BETTER_AUTH_SECRET`s must differ:** a token of one audience must not be valid for the other. A secret cannot be read back, so the control is that you typed a new one; nothing from outside can compare them.
- **Your OK:** yes, for each secret and for the deploy.
- **Verify:** `curl -s $P/portal/api/config` now shows `turnstileSiteKey`, `siteUrl` and `adminUrl` (and `contactWhatsapp` and `whatsappGroupUrl` only if you set valid invented ones; otherwise the keys are absent). Then the sign-in burst, to see the limiter at the edge (expected: five `403` because no Turnstile token was sent, then a `429` with `Retry-After`):

  ```bash
  for i in 1 2 3 4 5 6 7; do curl -s -o /dev/null -w "%{http_code} " -X POST $P/portal/api/auth/sign-in/email \
    -H 'content-type: application/json' -H "origin: $P" -d '{"email":"staging-check@example.invalid","password":"x"}'; done; echo
  # 403 403 403 403 403 429 429   <- the limit works; all 403 means the binding does not count (tell the PM)
  ```

- **Revert:** `pnpm exec wrangler secret delete <NAME> -c wrangler.portal.jsonc --env staging`; redeploy without a `--var` to blank one.

## 21. Portal smoke tests

```bash
P=https://sakem-portal-staging.<account-subdomain>.workers.dev
for p in /portal /portal/ /portal/status /portal/daftar /portal/login /portal/no-such-page /portal/api/config /portal/api/me /portal/api/auth/get-session \
  /portal/api/overview /portal/api/applications /portal/api/applications/current /portal/api/files/00000000-0000-4000-8000-000000000000 \
  /portal/api/auth/list-sessions /portal/api/no-such-route /portal/api/dev/mailbox / /portal/no-such-file.png; do
  printf '%-58s ' "$p"; curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "$P$p"; done
```

The expected answers come from the code and from running the portal Worker **locally** (`wrangler dev --local`, no account); a real account may still differ, and any difference is the finding to report.

| Request | Expected |
| --- | --- |
| `P/portal`, `/portal/`, `/portal/status`, `/portal/daftar`, `/portal/login`, `/portal/no-such-page` | 200 `text/html`, the portal's `index.html` (the single-page fallback; no 307 between `/portal` and `/portal/`), served by the assets layer: **no Worker request** (a `wrangler tail` shows no event). Headers: `cache-control: public, max-age=0, must-revalidate`, `x-frame-options: DENY`, `x-content-type-options: nosniff`, `referrer-policy: same-origin`, a `content-security-policy` that allows `challenges.cloudflare.com` for the widget |
| `P/portal/assets/<name>.js` (the name from `curl -s $P/portal/ \| grep -o '/portal/assets/index-[^"]*\.js'`) | 200, `cache-control: public, max-age=31536000, immutable`, the same security headers |
| `P/`, `P/portal/no-such-file.png` | 200, the same `index.html` in the local emulation. `portal-architecture.md` 3.4 expected a request that is not a navigation, for a file that is not there, to reach the Worker and get its JSON 404: **if the real answer is a `404` JSON, write it down** (it costs one Worker request; the tail shows it) |
| `P/portal/api/config` | 200 JSON, `{"google":false,"turnstileSiteKey":"<the key>","siteUrl":"<W>","adminUrl":"<A>"}`; `cache-control: no-store`, `x-content-type-options: nosniff`, `referrer-policy: no-referrer` |
| `P/portal/api/me` | 401 `{"error":"unauthenticated"}` |
| `P/portal/api/auth/get-session` | 200 `null` (no portal cookie: Better Auth is not built) |
| `P/portal/api/overview`, `/portal/api/applications`, `/portal/api/applications/current`, `/portal/api/files/<an id>` | 401 `{"error":"unauthenticated"}` |
| `P/portal/api/auth/list-sessions` (a Better Auth route the portal does not expose) | 404 `{"error":"not_found"}` |
| `P/portal/api/no-such-route` | 404 `{"error":"not_found"}` |
| `P/portal/api/dev/mailbox` | 404 `{"error":"not_found"}` (only `ENVIRONMENT=development` answers; staging is `staging`) |
| `curl -si -X POST $P/portal/api/auth/sign-in/email -H 'content-type: application/json' -H 'origin: https://other.example' -d '{}'` | 403 `{"error":"forbidden","reason":"origin_mismatch"}` (the same-origin guard) |
| `curl -si -X PUT $P/portal/api/applications/current/steps/identity -H "origin: $P" -H 'content-type: application/json' -d '{}'` | 401 (no session; the guard answers before the body is read) |
| the burst of step 20 | `403 403 403 403 403 429 429` |
| `W/portal/api/auth/get-session` (the **site's** host) | the site's 404 page: its navbar asks its own host, where there is no portal (known, step 13 lists it) |

Things only the real deploy shows (note them for the PM, no values): that `_headers` applies to the fallback page as well as to files (the CSP above on `/portal/status` is the answer); that no tail event appears for any of the first three rows; whether `cf-ray` answers from a nearby location.

## 22. End-to-end test with one invented applicant

One applicant, from registration to the status page, through both Workers. **Every value is invented**: a made-up name, the WhatsApp number `62` plus nine invented digits, invented answers, **only the sample files below** (no real document, no real photo of anyone). Open the portal and the admin in two separate browser windows (different profiles, or one private window): both cookies are host-only, so even one profile works.

**Before you start:** steps 9 (admin with a super_admin) and 17 to 20 are done; the real widget and the mail decision of step 19 are made; `date -u` is not within a few minutes of 00:00 UTC (the mail counter changes day then). The test writes about 100 rows to D1 (of 100,000 a day), about 11 R2 writes, and sends two or three mails (the verification link, the confirmation, and the "Kamu sudah punya akun" one only if you register an existing address).

**The invented files.** A 70-byte PNG and a one-page PDF, made here from text, so nothing real ever sits on this Mac or in R2:

```bash
mkdir -p /private/tmp/sakem-e2e && cd /private/tmp/sakem-e2e
echo 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > foto-uji.png
printf '%%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%%%EOF\n' > berkas-uji.pdf
{ cat berkas-uji.pdf; head -c 9500000 /dev/zero; } > berkas-9mb.pdf      # only for the CPU round of step 13: the largest file the portal accepts is 10,000,000 bytes
```

The Worker reads the bytes, not the name or the declared type: both are accepted as `png` and `pdf`. Use the PNG for every required slot (the self-photo takes images only) and the PDF for one or two, to see a PDF come back as a download.

1. **Admin: a batch that is open.** Pendaftaran, Batch, **Batch Baru**: the current year, a name such as "Uji Staging", opens now and closes in a week. *Expect:* it is listed as open. Without an open batch the portal says there is none and the wizard stays closed.
2. **Portal: register.** `P/portal/register`: the invented name, **the applicant's address** (step 19) and a long invented password that is not used anywhere else. The Turnstile widget appears and passes. *Expect:* the page says to check the mailbox (the same words whether or not the address already had an account). Admin, Sistem, **Aktivitas**: a row for the new student's registration.
3. **The verification mail.** *Expect* a mail "Verifikasi email Sakola Kembara" from `EMAIL_FROM`; opening its link lands on `P/portal/login?verified=1`. (Workers Logs keeps the **full URL with the token** for three days: expected on staging, the reason this part uses invented accounts only.) With choice C of step 19: mark the address verified by hand instead and say so in the report.
4. **Portal: sign in.** `P/portal/login`, with the widget. *Expect:* the home page shows the open batch and "Mulai daftar". In the browser's cookie list: `__Host-sakem-student.session_token`, Secure, HttpOnly, SameSite Lax, **no Domain**, Path `/`; there is no cookie of the admin's name on this host.
5. **Portal: the wizard.** `P/portal/daftar`: the eight screens with invented answers (the wizard says what shape each field needs; DTKS "tidak"). On the documents screen put one file in each of the ten required slots: `electricity-bill`, `family-card`, `parent-permission`, `self-photo`, `house-photos`, `vehicle-photos` and the four marketing proofs. Reload the page in the middle: the work comes back. *Expect* each upload to finish with its size shown, and the objects to appear in the bucket (dashboard, Objects, keys of the shape `applications/<year>/<id>/<id>.png`). **Now run check 3 of step 16** (the requests) against one of those keys.
6. **Portal: send.** "Kirim Pendaftaran". *Expect:* the confirmation screen with the application number (and the invented WhatsApp group button, only if you set one), the mail "Pendaftaran Sakola Kembara kamu sudah kami terima", and on `P/portal/status` "Menunggu keputusan": received, with **no verdict** yet.
7. **Admin: open one file.** Pendaftaran, Pendaftar, the invented applicant: the **Berkas** section lists each slot with its count and size. Press **Lihat** on **one** file (an image shows in a new tab, a PDF downloads). *Expect:* Sistem, **Aktivitas**: **exactly one** row "Berkas pendaftar dibuka" for it, with no name in it. Cross-check, read-only:

   ```bash
   cd cf/admin
   pnpm exec wrangler d1 execute sakem-staging --env staging --remote --command \
     "SELECT action, resource_type, metadata FROM audit_log WHERE action LIKE 'application_file.%' ORDER BY created_at"
   # one row, application_file.view; the metadata holds two ids and a slot name, no file name, no size, no applicant name
   ```

8. **Admin: decide, then publish.** On the applicant: **Status baru** "Diterima", a short invented review note, **Simpan Perubahan**. Pendaftaran, Batch, the batch: it reads "Siap dipublikasikan" once every applicant is decided; **Publikasikan Hasil**. *Expect* "Hasil dipublikasikan". The portal did not show a verdict before this.
9. **Portal: the status.** Reload `P/portal/status`. *Expect:* "Kamu diterima" and the review note: everyone at once, which is the privacy promise.
10. **The manual purge** (built: `POST /api/admin/applications/:id/files/purge`). On the applicant, the card **Berkas Pendaftar**, **Hapus Semua Berkas**, confirm. *Expect:* the screen reports the count; **exactly one** new Aktivitas row "Berkas pendaftar dihapus" (a count and the file ids, no name); the applicant's objects are gone from the bucket (dashboard, Objects); `P/portal/api/files/<id>` as the student is now `404`; the answers of the application are still there. Read-only check: `SELECT count(*) AS files FROM application_files` is `0`, and `SELECT bytes, files FROM private_storage` is `0` and `0`.
11. **The draft purge: PENDING.** SAKEM-093 (the files of a draft that nobody submitted or whose account is gone: [`portal-architecture.md`](portal-architecture.md#89-deleting-files-by-hand-the-manual-purge), open decision 15) had **not landed on `cloudflare`** when this was written, so there is nothing to test and **nothing to run**. When it lands, the PM adds its steps here: a second invented student who uploads one file and never submits, then the new action, then the same checks as item 10. Until then the files of an unsubmitted draft are removed by the student (the wizard's delete button) or by emptying the bucket (step 24).
12. **Resend and the day counter.** Read-only: `SELECT day, sent FROM email_daily ORDER BY day DESC LIMIT 2` is today's **UTC** date with the number of mails the portal sent (two or three), and Resend's own page agrees.
13. **Clean up the invented data** (this deletes: your OK), with the commands under "Cleaning up the invented data" below. Run them only when item 10 is done (and a draft's files, if there were any, are gone), because the SQL deletes **rows**, never objects.

**Cleaning up the invented data (item 13).** The files of the applicant must all be gone first (item 10; a draft's, by the student's delete button or in the bucket's dashboard). `E` is the address you registered, with no quote in it. The three files are written outside the repo and removed at the end:

```bash
E='<applicant address>'
cat > /private/tmp/sakem-e2e/precheck.sql <<SQL
-- runbook-test: precheck, must say 0
SELECT count(*) AS live_files FROM application_files WHERE deleted_at IS NULL AND application_id IN (
  SELECT id FROM student_applications WHERE email = '$E'
  UNION SELECT d.id FROM application_drafts d JOIN users u ON u.id = d.user_id WHERE u.email = '$E');
SQL
cat > /private/tmp/sakem-e2e/cleanup.sql <<SQL
-- runbook-test: cleanup of one invented applicant
DELETE FROM application_files WHERE application_id IN (
  SELECT id FROM student_applications WHERE email = '$E' OR user_id IN (SELECT id FROM users WHERE email = '$E')
  UNION SELECT d.id FROM application_drafts d JOIN users u ON u.id = d.user_id WHERE u.email = '$E');
DELETE FROM student_applications WHERE email = '$E' OR user_id IN (SELECT id FROM users WHERE email = '$E');
DELETE FROM users WHERE email = '$E' AND role = 'student';
UPDATE private_storage SET bytes = (SELECT COALESCE(SUM(size), 0) FROM application_files WHERE deleted_at IS NULL), files = (SELECT COUNT(*) FROM application_files WHERE deleted_at IS NULL), updated_at = cast(unixepoch('subsecond') * 1000 as integer) WHERE id = 'private-files';
SQL
cat > /private/tmp/sakem-e2e/verify.sql <<SQL
-- runbook-test: verify, all zero
SELECT (SELECT count(*) FROM users WHERE email = '$E') AS users, (SELECT count(*) FROM student_applications WHERE email = '$E') AS applications, (SELECT count(*) FROM application_files) AS files, (SELECT bytes FROM private_storage) AS bytes;
SQL
cd cf/admin
pnpm exec wrangler d1 execute sakem-staging --env staging --remote --file /private/tmp/sakem-e2e/precheck.sql    # live_files: 0, else stop
pnpm exec wrangler d1 execute sakem-staging --env staging --remote --file /private/tmp/sakem-e2e/cleanup.sql
pnpm exec wrangler d1 execute sakem-staging --env staging --remote --file /private/tmp/sakem-e2e/verify.sql     # 0, 0, 0, 0
rm -rf /private/tmp/sakem-e2e
```

It deletes the applicant's file rows, application and account (the account's sessions and any draft go with it, by the database's own cascade), then recounts the storage counter the way the daily cleanup does. The audit rows stay (ids only, no name). The batch stays too (a batch holds its year: the next test uses another year or reuses this one); to remove it: `... --command "DELETE FROM admission_batches WHERE name = '<batch name>'"`, which the database refuses while an application or a draft still points at it, and that refusal is the check.

- **Creates:** an admission batch, a student account with its session, a draft that becomes an application, ten objects in the private bucket (and the rows that describe them), two or three mails, audit rows (ids only): about 100 rows written to the remote D1 and 11 R2 writes. Nothing in git.
- **Your OK:** yes, step by step: each of 2, 5, 6, 8 and 10 and the cleanup writes to the remote database or the bucket.
- **Report back (no values):** for each numbered step "done" or "failed" with the message; the status of every row of step 21 that was not the expected one; the three checks of step 16; whether the verification mail arrived (and by which choice of step 19); how many `application_file.view` rows Aktivitas showed (the answer must be one); the CPU rounds of step 13 for the portal.
- **Revert:** the cleanup above, then empty the bucket of any object left (a draft's files), and `rm -rf /private/tmp/sakem-e2e`.

## What staging cannot show about the portal

The portal on `workers.dev` serves its own paths at its own host, with no zone, so these cannot be tested here. Each is a line of the cutover rehearsal ([`cutover-runbook.md`](cutover-runbook.md): the route steps, T-16 and T-17 of its smoke tests, R-26 of its risks) and of [`portal-architecture.md`](portal-architecture.md#36-what-only-a-real-zone-can-verify):

| Not testable here | Why | Goes to |
| --- | --- | --- |
| The routes `sakolakembara.org/portal` and `/portal/*` reaching `sakem-portal`: precedence against the site's route or Custom Domain, `/portal` against `/portal/`, `/portalx`, `/Portal/x`, the known trailing-`/*` bug, the failure mode (closed) at the day's limit | There is no zone and no route on `workers.dev` | cutover, S-33 and T-17, R-26 |
| The apex cookie: `__Host-` on the apex sent to **every** path, including the public pages the site's Worker serves (it must never read it), and the Google callback on the apex | Staging's cookie lives on the portal's own host, which no public page shares; Google is off on staging | cutover |
| The pass-through of the site to **WordPress** (sign-in through the route, cookies, `wp-admin`, the uploads hotlinked from outside), `/login` and the registration link `/daftar` on the real host, and the portal switch (`PORTAL_ENABLED`) on both kinds of page | There is no WordPress behind a `workers.dev` hostname, and the real form is not behind the staging `daftar` | cutover, T-31 to T-36, P-25 (Phase A, SAKEM-103) |
| Cache: whether anything at the apex caches `/portal/api/*` (it must stay `no-store`, `cf-cache-status` never `HIT`), and whether a Cache Rule on the zone catches the portal's files | The Cache API does not work on `workers.dev`, as for the site's own cache | cutover, the cache checklist |
| Turnstile for the apex hostname, and Resend with the production sender domain (SPF, DKIM, deliverability of the verification mail to other people's mailboxes) | The staging widget covers `workers.dev` only; the sandbox sender reaches one address | cutover, P-09 |
| Real R2 costs and limits under a season's load (many students, 10 MB files at once), and the CPU of an upload at that scale | One invented applicant is one data point | the first season |

## 23. What must not be done on staging

- **A wrangler command without `--env staging` (admin), without `-c wrangler.portal.jsonc --env staging` (portal), or a `cf/web` build without `CLOUDFLARE_ENV=staging`, for these Workers.** It creates the production-named Worker in the account (`sakem-admin`, `sakem-portal`). The shell variable of "Before the first command" is the safety net.
- **Real personal data**: no real student, applicant or contact data, no real admin passwords reused anywhere, **no real document, photo or scan of anyone** (the portal takes documents of children: step 22 uses sample files made from text, nothing else), no real WhatsApp number or group invitation (the config answer is public). The staging addresses are public. Only the 80 public articles and dummy rows.
- **Making `sakem-private-staging` public**: no `r2.dev` address, no custom domain, no change to its access in the dashboard, ever. Re-run the three checks of step 16 after any change to R2.
- **The admin's `BETTER_AUTH_SECRET` on the portal** (or any value reused between the two Workers), and the production names of the portal's resources: `sakem-portal`, the bucket `sakem-private`, the namespaces `80xx`.
- **Sharing the staging addresses** or linking them from a real page, mail or chat.
- **Anything on the zone**: no route, no custom domain, no DNS record, no nameserver change, no Cache Rule. Staging is on `workers.dev` by decision.
- **Production resources and keys**: the production D1 (`sakem-admin`), buckets (`sakem-files`, `sakem-private`), Turnstile widget, Resend domain, rate limit namespaces `78xx` and `80xx`.
- **A secret in `.staging.vars`**, in a ticket, in chat or in a commit. The printer refuses secret names; do not work around it.
- **`ENVIRONMENT=development`** or any value that switches the fail-closed rules off (email, Turnstile, rate limiting).
- **`CONTENT_API_URL`, `CONTACT_API_URL`**, or a real `LEGACY_ORIGIN_URL` (a real host would forward staging traffic to the live site).
- **`cache.enabled` (Workers Caching)**: it bills static assets as requests.
- **Load tests.** `measure-staging.mjs` caps itself (at most 60 rounds); another tool is not allowed: the 100,000 requests a day are the production site's too.
- **Answering yes** when wrangler offers to write ids into a configuration file.
- **The other three accounts.** If a command ever shows a database or Worker you do not recognise, stop.

## 24. Teardown

Order matters: the site's service binding points at the admin Worker, so the site goes first; the portal and the admin both use the database and the private bucket, so both Workers go before them. **Each is a deletion: your explicit OK.** If only the invented applicant is to go (staging stays up), do the cleanup of step 22 and stop there.

```bash
cd cf/admin
pnpm exec wrangler delete --name sakem-web-staging                         # the site (and its workers.dev address)
pnpm exec wrangler delete --name sakem-portal-staging                      # the portal Worker, its secrets, its workers.dev address
pnpm exec wrangler delete --name sakem-admin-staging                       # the API Worker, its secrets, its cron
pnpm exec wrangler d1 delete sakem-staging                                 # the database and everything in it
pnpm exec wrangler r2 bucket dev-url disable sakem-files-staging           # type disallow
# empty the PUBLIC bucket in the dashboard (R2, the bucket, Objects, select all, delete), then:
pnpm exec wrangler r2 bucket delete sakem-files-staging
# the PRIVATE bucket: it has no public address to turn off. Empty it in the dashboard the same way (a draft's files, and anything a test left,
# are only in the bucket: no screen reaches them), check that Objects is empty, then:
pnpm exec wrangler r2 bucket delete sakem-private-staging
rm -f .staging.vars .staging.vars.portal ../web/.staging.vars ../web/.measure/*.jsonl ../web/.measure/*.json
rm -rf /private/tmp/sakem-e2e
unset CLOUDFLARE_ENV CLOUDFLARE_ACCOUNT_ID
pnpm exec wrangler logout
```

In the dashboards: delete the Turnstile widget and the Resend key(s) `sakem-staging` (and `sakem-staging-portal`), and the sending domain if step 19 added one (its DNS records at the domain's host too). The `workers.dev` subdomain of the account stays (it is the account's). Check afterwards: `wrangler d1 list`, `wrangler r2 bucket list` show nothing of staging; Workers & Pages shows no `*-staging` Worker. Staging used the production namespaces of nothing, so no production resource changes.

## Report back (no values)

Tell the PM only: the step number and "done" or "failed" with the message of a failure (no ids, no secrets, no addresses); the **checkpoint result of step 6** (rate limit bindings accepted or not); the smoke-test results that were not the expected ones (steps 11 and 21); the CPU table of step 13 with verdicts, the portal's rows included; whether `wrangler tail` carried `cpuTime`; the largest D1 rows-written day. For the portal: the three checks of step 16 (the bucket is private), whether the bucket existed before step 16 and its location, the mailbox choice of step 19 and whether the verification mail arrived, the number of `application_file.view` rows after step 22 (it must be one), the answer of `curl $P/portal/no-such-file.png` (index or JSON 404), and that SAKEM-093's draft purge is still pending. Nothing else is required.
