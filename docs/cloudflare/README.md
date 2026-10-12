# Cloudflare migration

Why the site is moving to Cloudflare Workers, what the target looks like, and in which order it ships. Decisions here are made; this page records them so they are not re-litigated in every PR. Ticket: SAKEM-075 (first slice).

## Constraints

- **$0.** The hosting bill must stay at zero, so everything runs on the **Workers Free** plan and the Free tiers of D1, R2 and KV.
- Workers Free limits that shape the design: **10 ms CPU per request**, **100,000 requests per day** (the Worker counts every request it handles, pass-through included), 3 MB compressed Worker size, 50 subrequests per request. Static assets served by the assets layer do not invoke the Worker and do not count as requests.
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
3. Admin and portal on Hono + React SPA + D1; migrate data from Postgres; retire the VPS. First slice (local only, SAKEM-078): [`admin-skeleton.md`](admin-skeleton.md). Full D1 schema and the permission model (SAKEM-081, local D1 only): [`d1-schema.md`](d1-schema.md). Authentication, email, Turnstile, rate limits and admin users (SAKEM-081 part B): [`auth.md`](auth.md). The public content API and the contact form (SAKEM-081, part C): [`public-api.md`](public-api.md). Uploads to R2 (the admin API, content checks, the public domain and `UPLOADS_BASE_URL`; SAKEM-082): [`uploads.md`](uploads.md). The CRUD conventions every admin list and form follows, and the shared Worker and SPA kit that implements them (SAKEM-082): [`admin-crud.md`](admin-crud.md).

## Pass-through idea

In production the Worker is attached to the zone with a **route** (not a custom domain), so `fetch(request)` inside the Worker reaches the origin behind the same hostname. Paths the Worker does not own are forwarded untouched (method, headers, body, cookies; redirects are not followed). Locally, `LEGACY_ORIGIN_URL` points at a stand-in origin. Details, the legacy path list and known conflicts: [`web-skeleton.md`](web-skeleton.md).

## Account setup

Which account is used, what the owner does in the terminal and dashboard, and when each step is needed: [`account-setup.md`](account-setup.md).

## Rules for this folder tree

- No Cloudflare account use from this repo's tooling during the spike: no login, no deploy, no remote resource commands. `wrangler deploy --dry-run` only.
- No secrets, tokens, account ids, resource ids or infrastructure hostnames in tracked files.
