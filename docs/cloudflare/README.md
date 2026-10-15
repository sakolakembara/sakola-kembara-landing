# Cloudflare migration

Why the site is moving to Cloudflare Workers, what the target looks like, and in which order it ships. Decisions here are made; this page records them so they are not re-litigated in every PR. Ticket: SAKEM-075 (first slice).

## Constraints

- **$0.** The hosting bill must stay at zero, so everything runs on the **Workers Free** plan and the Free tiers of D1, R2 and KV.
- Workers Free limits that shape the design: **10 ms CPU per request**, **100,000 requests per day** (the Worker counts every request it handles, pass-through included), a Worker size of 64 MiB uncompressed with no compressed limit (the older "3 MB compressed" rule is gone: [`free-plan-audit.md`](free-plan-audit.md#21-worker-size)), 50 subrequests per request. Static assets served by the assets layer do not invoke the Worker and do not count as requests.
- Next.js SSR does not fit those limits, so the public site cannot move as it is.
- **SEO parity is a requirement.** URLs, titles, canonical, Open Graph, JSON-LD, sitemap, robots, status codes and the WordPress redirects must match what the Next app serves today.
- **Visual style and Indonesian copy are fixed** (`DESIGN.md`, `docs/context/tone-of-voice.md`). The port moves markup to Astro; it does not redesign or reword.

## Target

| Part | Stack | Where it runs |
| --- | --- | --- |
| Public site (`/`, `/blog`, `/tim`, programs, ...) | **Astro 6 SSR** (`@astrojs/cloudflare`), Tailwind v4, almost no client JS | Cloudflare Worker + static assets |
| Admin and student portal (later) | **Hono API + React SPA + D1** | Cloudflare Worker + D1 |
| Legacy app (until replaced) | Next.js 16 + Postgres | existing VPS |

## Phases (public first)

1. **Public site on Astro** (`cf/web/`; this slice proves it). The new Worker sits in front of the legacy origin. It serves the ported public pages and **passes every other path through** to the old Next app, so `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/portal/*`, `/admin/*`, `/api/*` and the static files those pages need keep working on the same hostname. URLs, cookies and SSO do not change.
2. Port the remaining public pages (program, laporan, donasi, kontak, gabung-siswa) and shrink the not-yet-ported list in the Worker.
3. Admin and portal on Hono + React SPA + D1; migrate data from Postgres; retire the VPS. First slice (local only, SAKEM-078): [`admin-skeleton.md`](admin-skeleton.md). Full D1 schema and the permission model (SAKEM-081, local D1 only): [`d1-schema.md`](d1-schema.md). Authentication, email, Turnstile, rate limits and admin users (SAKEM-081 part B): [`auth.md`](auth.md). The public content API and the contact form (SAKEM-081, part C): [`public-api.md`](public-api.md). Uploads to R2 (the admin API, content checks, the public domain and `UPLOADS_BASE_URL`; SAKEM-082): [`uploads.md`](uploads.md). The CRUD conventions every admin list and form follows, and the shared Worker and SPA kit that implements them (SAKEM-082): [`admin-crud.md`](admin-crud.md). The Sistem group, Aktivitas (the audit log over a cursor) and Pengaturan (admins and area grants), super_admin only (SAKEM-082): [`admin-sistem.md`](admin-sistem.md). The Komunikasi screens, Pesan (the contact form's inbox) and Pengumuman (the public strip), API and SPA: [`admin-komunikasi.md`](admin-komunikasi.md). Laporan, Tim and Shortlink of the area Konten Situs, and the short-link redirect of the public site (SAKEM-082, SAKEM-080): [`admin-konten.md`](admin-konten.md). The admission area (Batch, Pendaftar, Pusat Dokumen: what is ported from the legacy admin, the review and publish rules, the prefix search, the plans and what differs; SAKEM-082): [`admin-pendaftaran.md`](admin-pendaftaran.md). The blog in the new admin (the markdown render and its sanitiser on the Worker, `/api/admin/blog`, the editor with its preview, the draft and publish states, GIF for blog images, and the import of the 80 migrated articles; SAKEM-082): [`admin-blog.md`](admin-blog.md). The first super_admin of an empty database (the owner's command, `pnpm first-admin`, and its runbook: no public sign-up, no password in chat, the repo or the shell history; and the rule that "the last super_admin" means the last one who can sign in; SAKEM-087): [`first-super-admin.md`](first-super-admin.md). The student portal (M4, SAKEM-083; **design, not yet built**): how `sakolakembara.org/portal/*` reaches a third Worker, its SPA and the module it shares with the admin SPA, the cookies and limits, the draft model, the **private bucket for applicants' documents**, emails, Free-tier costs and the split of the build into four tasks: [`portal-architecture.md`](portal-architecture.md); the endpoint-by-endpoint contract the build workers implement and test against (steps, states, status privacy, file routes, error codes): [`portal-api.md`](portal-api.md).

## Pass-through idea

In production the Worker is attached to the zone with a **route** (not a custom domain), so `fetch(request)` inside the Worker reaches the origin behind the same hostname. Paths the Worker does not own are forwarded untouched (method, headers, body, cookies; redirects are not followed). Locally, `LEGACY_ORIGIN_URL` points at a stand-in origin. Details, the legacy path list and known conflicts: [`web-skeleton.md`](web-skeleton.md). Which of those paths M4 takes out of the list (`/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/portal`, `/admin`, `/api`) and what replaces them: [`portal-architecture.md`](portal-architecture.md#66-what-happens-to-the-pass-through-of-cfweb).

## Account setup

Which account is used, what the owner does in the terminal and dashboard, and when each step is needed: [`account-setup.md`](account-setup.md).

## Cutover, rollback and SEO audit (SAKEM-084, M5)

The runbook for the day the live WordPress site is replaced (preconditions, the DNS inventory, TTLs, the order of operations, smoke and cache checks, monitoring, rollback, what to keep of WordPress, the findings of the audit and the risk register; **go-live is blocked on M4**): [`cutover-runbook.md`](cutover-runbook.md). The read-only SEO parity tool (`cf/web/scripts/seo-parity.mjs`, `pnpm seo:parity`), its finding table, the Core Web Vitals plan and the Search Console plan: [`seo-audit.md`](seo-audit.md). Staging and the Free-plan audit (M5-A) are in the next section.

## Staging and the Free plan (M5, SAKEM-084)

- [`free-plan-audit.md`](free-plan-audit.md): every Cloudflare feature, binding and limit the two Workers rely on, checked against the current documentation, with a verdict (OK, RISK, BLOCKER) and a fallback for each risk. Read its first section before the first staging deploy: the Rate Limiting binding on Free and the sign-in CPU are the two things documentation cannot settle.
- [`staging-runbook.md`](staging-runbook.md): the owner's ordered steps for staging on `*.workers.dev` (`sakem-admin-staging`, `sakem-web-staging` and, since SAKEM-098, `sakem-portal-staging`): pin the account, D1, migrations, R2, deploys, secrets, the first super_admin, smoke tests, the blog import, the CPU measurement, the limits to watch, **the student portal (steps 15 to 22: the private bucket and the proof that it is private, the three secrets, the real Turnstile widget, Resend and the choice of the applicant's mailbox, smoke tests, an end-to-end test with one invented applicant, and what `workers.dev` cannot show)**, what must not be done, teardown. Every real step needs Dzul's OK.
- Configuration: an `env.staging` block in `cf/admin/wrangler.jsonc`, `cf/admin/wrangler.portal.jsonc` and `cf/web/wrangler.jsonc` (no ids, no secrets; the portal's has its own private bucket `sakem-private-staging`, rate limit namespaces `81xx`, and its public per-deploy variables declared empty); `pnpm deploy:staging:dry` in each package runs `wrangler deploy --dry-run` and checks the bundle is the staging one (in `cf/admin`, the admin's and the portal's); `pnpm deploy:staging:command` (and `pnpm deploy:staging:portal:command` for the portal) prints (never runs) the real deploy command from an untracked `.staging.vars` (`.staging.vars.portal`; example files `staging.vars.example`, `staging.portal.vars.example`) (`cf/scripts/`).
- Measurement: `cf/web/scripts/measure-staging.mjs` (`pnpm measure:staging`): a polite, bounded probe of an explicit staging host (the site's, and with `--admin` and `--portal` the admin's and the portal's, GET only, no cookie) and a collector of `wrangler tail --format json` output (the pretty-printed form wrangler writes, or one object per line) with per-route p50, p95, p99, max CPU and a verdict against the 10 ms limit.
- CPU on the hot routes (SAKEM-091, first fixes after the staging probe of 2026-10-14): where the CPU of the admin and site Workers goes, what was changed (one Better Auth per isolate, no session lookup without a cookie, public reads built once, a start-up warm-up, an opt-in page copy for the site), a local before/after harness for both Workers (`pnpm measure:cpu` in `cf/admin` and `cf/web`), and what is still above the target: [`free-plan-audit.md`](free-plan-audit.md#10-cpu-on-the-hot-routes-sakem-091).

## Rules for this folder tree

- No Cloudflare account use from this repo's tooling during the spike: no login, no deploy, no remote resource commands. `wrangler deploy --dry-run` only.
- No secrets, tokens, account ids, resource ids or infrastructure hostnames in tracked files.
