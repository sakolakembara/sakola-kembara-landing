# Sakola Kembara — Website Knowledge Center

This folder is the single source of truth for non-code knowledge about the Sakola Kembara website. It exists so anyone (engineering, design, product, leadership) can quickly understand **what the site is**, **why it exists in its current shape**, and **what must not drift** as we evolve it.

> **Hard rule.** The current Indonesian language tone and the current visual style are not up for redesign. Documents here describe those guardrails. New work should extend, not replace.

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
- [`runbook/launch.md`](runbook/launch.md) — **Sequential first-launch recipe.** Fresh VPS → Entra app registration → CI secrets → first deploy on a staging subdomain → content swap → DNS cutover → post-launch checklist → rollback paths.
- [`current-state/known-gaps.md`](current-state/known-gaps.md) — Placeholder content, missing dashboard features, work the MVP still owes.

### 3. `design/` — The visual & UX brief
Guardrails for any future UI work. Treat these as the design system contract.

- [`design/visual-identity.md`](design/visual-identity.md) — Brand feel, photography, illustration, motion.
- [`design/color-and-typography.md`](design/color-and-typography.md) — Color tokens, font families, weights, sizes.
- [`design/components-and-layout.md`](design/components-and-layout.md) — Buttons, eyebrow, cards, containers, sections, spacing scale.
- [`design/copy-style.md`](design/copy-style.md) — Headline structure, button verbs, microcopy conventions.

### 4. `roadmap/` — Where we're going
- [`roadmap/mvp-roadmap.md`](roadmap/mvp-roadmap.md) — **Start here.** Master sequenced execution plan (Phases 0–9) covering production deploy + auth, SEO baseline, admin dashboard from scratch, student-application flow, announcements, reports, blog dashboard, content replacement, and launch.
- [`roadmap/mvp-priorities.md`](roadmap/mvp-priorities.md) — Flat list of in/out MVP scope with ✅ / ◐ / ❌ status. Companion to the sequenced roadmap.
- [`roadmap/admin-dashboard.md`](roadmap/admin-dashboard.md) — Route-group + Microsoft Entra ID auth structure for the upcoming `/admin` dashboard. Locked decisions: same repo, single-tenant Entra, `@sakolakembara.org` domain gate.
- [`roadmap/infrastructure.md`](roadmap/infrastructure.md) — Infra picks for dynamic features. Locked: VPS + Docker Compose, Postgres 16 + Drizzle, Caddy auto-TLS, GitHub Actions → GHCR → SSH, persistent `public/` volume, Sentry, Zod env validation. Markdown blog stays as-is.
- [`roadmap/data-model.md`](roadmap/data-model.md) — Drizzle schemas for the 5 MVP tables (`admin_users`, `student_applications`, `announcements`, `reports`, `audit_log`). Mirrors `lib/db/schema/*`.

## How to use this folder

- **Before writing code that affects public pages**, scan `context/` and `design/`. If your change would shift tone or visuals beyond what the design docs allow, raise it with product first.
- **After shipping something structural**, update the relevant `current-state/` file in the same PR. Stale docs are worse than missing docs.
- **Discussion notes & decisions** that don't fit any file: drop them in a new file under the closest folder and link it from this README.
