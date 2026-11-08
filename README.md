# Sakola Kembara — Website & Admin

The public website and the admin for **Yayasan Sakola Kembara Indonesia**, a non-profit running free university-entrance-exam preparation for students from financially disadvantaged backgrounds across Indonesia.

- Site: <https://sakolakembara.org>
- Admin: <https://admin.sakolakembara.org>

> **`main` is what is live.** Branch from `main`, open the PR into `main`, and deploy only from a clean checkout of `origin/main`: the deploy command refuses anything else (SAKEM-126).

## What runs where

Everything runs on **Cloudflare, on the Workers Free plan ($0)**. Design for 10 ms of CPU per request and 100k requests per day.

| Part | Folder | Built with | Address |
| --- | --- | --- | --- |
| Public site | [`cf/web/`](cf/web/) | Astro 6 on a Worker (`sakola-kembara-web`), most pages prerendered | `sakolakembara.org` |
| API and admin | [`cf/admin/`](cf/admin/) | Hono API + React SPA (shadcn/ui) on a Worker (`sakem-admin`), D1, R2, Better Auth | `admin.sakolakembara.org` |
| Uploaded files | R2 public bucket | Images and documents uploaded in the admin | `files.sakolakembara.org` |
| Student portal | `cf/admin/portal-spa/`, `wrangler.portal.jsonc` | Built and tested, **switched off** in production (Phase B) | — |

- The site reads its content (blog, team, reports, documents) from the admin Worker through a service binding.
- Paths the new site does not own are passed through to the old WordPress site on the same host.
- Email (invites, password reset) goes through **Resend**. Analytics: Cloudflare Web Analytics (cookie-free) and Google Tag Manager.
- Each app under `cf/` has **its own `package.json` and lockfile**. It is not a pnpm workspace: install and run inside the app folder.

The **Next.js app in the repository root** (`app/`, `components/`, `lib/`, `drizzle/`, `Dockerfile`, …) is the old version. It is **not deployed** and is kept for reference. Two parts of it are still used: the root `public/` folder (images, PDFs) and the icons in `app/` are the sources of the site's asset pipeline (`cf/web/scripts/sync-assets.mjs`, `build-assets.mjs`).

## How we work

1. **Ticket first.** Every change has a `SAKEM-NNN` ticket in Saung (project "Sakola Kembara"), created before the code. Tickets are not stored in this repo. Ask a maintainer for access.
2. **Branch from `main`:** `feat/<topic>`, `fix/<topic>`, `docs/<topic>`. Put the ticket in every commit, `type(scope): summary (SAKEM-NNN)`, and in the PR's "Ticket" field.
3. **One PR = one ticket, into `main`.** Say in the PR what you tested and what you did not.
4. **After the merge, deploy from `main`** (see [Deploy](#deploy)), so what is on `main` and what is live stay the same.
5. Close the ticket in Saung with the PR link.

The full rules, for people and for Claude Code, are in [`CLAUDE.md`](CLAUDE.md).

## Run it locally

You need **Node.js 22.12+**, **pnpm** and **git**. Wrangler comes with each app's dependencies; no global install and no Cloudflare login are needed for local work.

### Public site (`cf/web`)

```bash
cd cf/web
pnpm install                    # its own lockfile
cp dev.vars.example .dev.vars   # fake local values, untracked
pnpm stub-origin                # terminal 1: stand-in for the pass-through origin, :4390
pnpm fixture-api                # terminal 2: content API with sample data, :4391
pnpm dev                        # terminal 3: astro dev on :4321 (the Worker runs in workerd)
```

### API and admin (`cf/admin`)

```bash
cd cf/admin
pnpm install
cp dev.vars.example .dev.vars   # fake local values, untracked
pnpm db:migrate:local           # D1 in .wrangler/state
pnpm db:seed:local              # sample rows and one sign-in per role
pnpm dev                        # builds the SPA, then wrangler dev
```

`pnpm dev:spa` runs the admin SPA on Vite with hot reload and `/api` proxied to the Worker; `pnpm dev:spa:mock` runs it with no Worker at all. Locally, without `RESEND_API_KEY`, emails are printed to the wrangler console.

More detail: [`docs/cloudflare/web-skeleton.md`](docs/cloudflare/web-skeleton.md) and [`docs/cloudflare/admin-skeleton.md`](docs/cloudflare/admin-skeleton.md).

## Commands

Always take commands from the app's `package.json`. The ones you need most:

| `cf/web` | What it does |
| --- | --- |
| `pnpm dev` | Local site on :4321 |
| `pnpm build` | Assets, Astro build, then the asset guard (`check-dist`) |
| `pnpm check` | `astro check` (types) |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:e2e` | End-to-end checks against a local build |
| `pnpm test:negative:<area>` | Breaks one safeguard at a time and expects the tests to fail |

| `cf/admin` | What it does |
| --- | --- |
| `pnpm dev` | Local API and admin |
| `pnpm typecheck` | Worker, admin SPA and portal SPA types |
| `pnpm test` | Worker, admin SPA and portal SPA tests (Vitest) |
| `pnpm db:generate` | A new migration after a schema change (`cf/admin/migrations/`) |
| `pnpm db:migrate:local` | Apply migrations to the local D1 |
| `pnpm test:negative`, `pnpm test:negative:spa` | Negative checks for the Worker and the SPA |

## Deploy

Production is deployed **by hand**, from a clean checkout of `origin/main`, with the command the printer writes. Nothing deploys on push.

```bash
git fetch origin && git switch --detach origin/main
cd cf/web                           # or cf/admin
pnpm deploy:prod:dry                # production build and wrangler dry run
pnpm deploy:prod:command            # prints the build line and the deploy command; read it, then run it
```

The printed command first runs `cf/scripts/on-main.mjs` (it stops unless the checkout is exactly `origin/main` and clean), then picks the organisation Cloudflare account by name (SAKEM-123), then deploys with the public values from `.production.vars`. Never answer wrangler's "Select an account" prompt.

- **Database changes:** apply the D1 migration to production **before** deploying the admin Worker, and write the risk and the order in the ticket.
- **Staging** runs on `workers.dev`: `pnpm deploy:staging:dry` and `pnpm deploy:staging:command`.
- Every deploy and every remote Cloudflare command needs the project owner's OK.

Runbooks: [`docs/cloudflare/cutover-runbook.md`](docs/cloudflare/cutover-runbook.md) (production, section 14) and [`docs/cloudflare/staging-runbook.md`](docs/cloudflare/staging-runbook.md).

## Repo tour

```
cf/
  web/                  Public site (Astro on Workers): src/pages, src/components, tests/, scripts/
  admin/                API Worker (src/), admin SPA (spa/), portal SPA (portal-spa/), D1 migrations (migrations/)
    DESIGN.md           Admin design rules (reuses the public DESIGN.md)
  scripts/              Deploy printers and dry runs, the on-main check, the account pin, production and zone checkers
docs/
  cloudflare/           How the live system is built, run and deployed: start with its README
  context/              Who Sakola Kembara is, audiences, tone of voice
  current-state/, roadmap/, architecture/, runbook/   Mostly the old Next app and VPS plan (history)
DESIGN.md               Public design system: colour, type, layout, components, imagery, motion, UI copy
CLAUDE.md               Working rules for people and Claude Code
public/                 Images and PDFs: the source of the site's asset pipeline
app/, components/, lib/, drizzle/, …   The old Next.js app (not deployed)
```

## Where to read next

- **How the live system works:** [`docs/cloudflare/README.md`](docs/cloudflare/README.md).
- **Editing public copy:** [`docs/context/tone-of-voice.md`](docs/context/tone-of-voice.md). The Indonesian voice is fixed.
- **Touching visuals:** [`DESIGN.md`](DESIGN.md) (public) and [`cf/admin/DESIGN.md`](cf/admin/DESIGN.md) (admin). Visual changes go through a ticket that also updates the design file.
- **Database:** [`docs/cloudflare/d1-schema.md`](docs/cloudflare/d1-schema.md). **Uploads:** [`docs/cloudflare/uploads.md`](docs/cloudflare/uploads.md). **Sign-in:** [`docs/cloudflare/auth.md`](docs/cloudflare/auth.md).
- **Free-plan limits:** [`docs/cloudflare/free-plan-audit.md`](docs/cloudflare/free-plan-audit.md).

## Ground rules

- **Preserve tone; change visuals only through a ticket.** Don't rewrite Indonesian copy, and don't shift colours, fonts or spacing outside a SAKEM ticket that also updates the design file.
- **No secrets or personal data** in tickets, commits, PRs or docs: no passwords, tokens, `.dev.vars` or `.production.vars` contents, account ids, or student and applicant data. Name the variable, never its value.
- **If your change is structural** (new route, dependency, deploy step, data model), update the matching file under `docs/cloudflare/` in the same PR.

## Ownership

Private project for **Yayasan Sakola Kembara Indonesia**. Code and content are not licensed for outside use without permission.
