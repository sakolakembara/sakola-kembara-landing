# Sakola Kembara — Website Knowledge Center

This folder is the single source of truth for non-code knowledge about the Sakola Kembara website. It exists so anyone (engineering, design, product, leadership) can quickly understand **what the site is**, **why it exists in its current shape**, and **what must not drift** as we evolve it.

> **Hard rule.** The current Indonesian language tone is not up for redesign. The visual style is being refreshed in deliberate steps (starting with SAKEM-024): change it only through a ticket, and update [`DESIGN.md`](../DESIGN.md) in the same PR so it always describes what ships. Outside such a ticket, new work extends the documented style rather than replacing it.

> :compass: **Just landed here? Start with [`mvp-status.md`](mvp-status.md).** It's a one-page snapshot of what the repo can do today — public site, admin dashboard, tech stack, what's deferred, what's blocking launch.

## Contents

### 1. `context/` — Why the site exists
Orientation material. Read this first before opening the code.

- [`context/organization.md`](context/organization.md) — Who Sakola Kembara is, mission, what the program actually does.
- [`context/audience-and-direction.md`](context/audience-and-direction.md) — Primary audiences (donors, partners, volunteers) and the strategic direction the website serves.
- [`context/tone-of-voice.md`](context/tone-of-voice.md) — The formal, credible Indonesian tone — what it sounds like and what it must avoid.

### 2. `current-state/` — What exists today
A factual snapshot of the codebase. Update these as the system changes.

- [`current-state/tech-stack.md`](current-state/tech-stack.md) — Framework, libraries, scripts, build pipeline.
- [`current-state/information-architecture.md`](current-state/information-architecture.md) — Current routes, header, footer.
- [`current-state/homepage-sections.md`](current-state/homepage-sections.md) — Section-by-section breakdown of the homepage.
- [`current-state/content-and-data.md`](current-state/content-and-data.md) — Where copy and data live, and what is hard-coded vs. generated.
- [`current-state/blog-pipeline.md`](current-state/blog-pipeline.md) — How the markdown blog is scraped, synced, and rendered.
- [`current-state/deployment.md`](current-state/deployment.md) — Steady-state ops cheat sheet: deploy commands, manual ops, rollback. Pair with the launch runbook for first-time provisioning.
- [`runbook/launch.md`](runbook/launch.md) — **Sequential first-launch recipe.** Fresh VPS → Google OAuth client → CI secrets → super-admin seed → first deploy on a staging subdomain → content swap → DNS cutover → post-launch checklist → rollback paths.
- [`runbook/sso-email-launch.md`](runbook/sso-email-launch.md) — Focused rollout for the LMS SSO handshake + transactional email (Resend). Do after the main launch. ~90 min attended work + DNS propagation waits.
- [`current-state/known-gaps.md`](current-state/known-gaps.md) — Placeholder content, missing dashboard features, work the MVP still owes.

### 3. Design — [`/DESIGN.md`](../DESIGN.md)
The design system lives in one file at the repo root: brand, color and type tokens, layout, components, imagery, motion, UI copy, accessibility. (It replaced the four `design/*.md` files in SAKEM-030.)

### 4. `roadmap/` — Where we're going
- [`roadmap/mvp-roadmap.md`](roadmap/mvp-roadmap.md) — **Start here.** Master sequenced execution plan (Phases 0–9) covering production deploy + auth, SEO baseline, admin dashboard from scratch, student-application flow, announcements, reports, blog dashboard, content replacement, and launch.
- [`roadmap/mvp-priorities.md`](roadmap/mvp-priorities.md) — Flat list of in/out MVP scope with ✅ / ◐ / ❌ status. Companion to the sequenced roadmap.
- [`roadmap/admin-dashboard.md`](roadmap/admin-dashboard.md) — Route-group layout for the `/admin` dashboard. Locked decisions: same repo, unified auth (Google + admin credentials), role-based gating.
- [`roadmap/infrastructure.md`](roadmap/infrastructure.md) — Infra picks for dynamic features. Locked: VPS + Docker Compose, Postgres 16 + Drizzle, Caddy auto-TLS, GitHub Actions → GHCR → SSH, persistent `public/` volume, Sentry, Zod env validation. Markdown blog stays as-is.
- [`roadmap/data-model.md`](roadmap/data-model.md) — Drizzle schemas mirroring `lib/db/schema/*`.

### 5. `architecture/` — Deep dives
Focused explainers for the load-bearing subsystems. Read the matching file before touching auth, the portal, or the batches flow.

- [`architecture/authentication.md`](architecture/authentication.md) — Google + Credentials providers, `users` / `accounts` tables, JWT sessions with role stamped in the callback, `requireAdmin` / `requireStudent` helpers, middleware routing, super-admin seed bootstrap.
- [`architecture/student-portal.md`](architecture/student-portal.md) — `/portal` route map, the privacy contract around `admission_batches.results_published_at`, copy conventions, future LMS SSO handoff.
- [`architecture/admission-batches.md`](architecture/admission-batches.md) — Yearly batch lifecycle, the publish guard, admin UI paths, how registration and results tie back to `admission_batches`.
- [`architecture/lms-integration.md`](architecture/lms-integration.md) — The SSO contract between landing and the (upcoming) LMS at `lms.sakolakembara.org`. JWT + shared cookie handshake, Django auth backend + Nuxt integration guide, event-registration flow, four locked design decisions (LMS role independence, revocation policy, alumni access, email verification), and a three-milestone landing-side checklist. Hand this to the LMS team when they start.
- [`architecture/shortlinks.md`](architecture/shortlinks.md) — Admin-managed vanity redirects at `sakolakembara.org/<slug>`. Covers the root-level dynamic-route precedence that makes the feature safe, the reserved-slug list you must extend when adding a top-level route, and the redirect/validation rules.

## How to use this folder

- **Before writing code that affects public pages**, scan `context/` and [`DESIGN.md`](../DESIGN.md). If your change would shift tone, or visuals beyond what `DESIGN.md` describes, it needs a ticket and product sign-off first.
- **After shipping something structural**, update the relevant `current-state/` file in the same PR. Stale docs are worse than missing docs.
- **Discussion notes & decisions** that don't fit any file: drop them in a new file under the closest folder and link it from this README.
