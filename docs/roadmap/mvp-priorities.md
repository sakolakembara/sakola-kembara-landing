# MVP Priorities

Captured from product discussion. Order is intentional — items higher in the list block items below them when scoping a sprint. Status indicates whether the item has already shipped in this repo.

> **For the sequenced execution plan, see [`mvp-roadmap.md`](mvp-roadmap.md).** This doc is the flat priority list; the roadmap turns it into Phases 0–9 with dependencies, deliverables, and exit criteria.

## Priority order

1. **Formal homepage for donors, partners, and volunteers** — ✅ shipped.
   The homepage is already donor/partner-led: hero → problem → programs → impact (with GIS map) → partners → 4-way CTA → blog. Copy and visual treatment match the donor-credibility direction. Future tweaks are content updates, not restructures.

2. **Dedicated donation page** (`/donasi`) — ✅ shipped.
   `app/donasi/page.tsx` covers QRIS, bank transfer (Bank Muamalat 1010 141 940), copy-to-clipboard, downloadable QR, and Google-Form confirmation. The `StakeholderSection` (Transparansi & Akuntabilitas) is currently embedded here; once `/laporan` exists, move that block off `/donasi`.

3. **Student information and registration form** (`/gabung-siswa`) — ◐ partial.
   The info page exists with benefits + CTA. The on-site form is **not** built — the CTA still links to external `https://sakolakembara.org/daftar`. Build the on-site form next.

4. **Dashboard view for student registration data** — ❌ not built.
   Requires the dashboard workstream — same repo, `app/(admin)/admin/applications/`. Gated by Microsoft Entra ID + `@sakolakembara.org` email check. See [`admin-dashboard.md`](admin-dashboard.md). Captures form submissions; admins can review applicant profiles.

5. **Ability to mark applicants as accepted or rejected** — ❌ not built.
   Status field on each applicant, editable by the academic team.

6. **Blog with automatic slug generation** — ✅ shipped at the file level.
   `content/blog/<slug>.md` filenames already act as slugs; `lib/blog.ts` reads them; static params are generated at build time. The dashboard MVP must replicate this when admins create posts via UI.

7. **Public announcement feature** — ❌ not built.
   Admin-published strip on the homepage. Conditional render — nothing shows when there's nothing published.

8. **Report upload dashboard** — ❌ not built.
   Admins upload PDFs for yearly / financial / impact / donation reports.

9. **Public report page for PDFs** (`/laporan`) — ✅ shipped (Phase 6).
   Auto-lists uploaded PDFs grouped by year. Header label is **"Laporan"** (originally proposed as "Impact & Reports" but relaxed to Indonesian for consistency with the rest of the nav). StakeholderSection has been removed from `/donasi`.

10. **Basic team page** (`/tim`) — ✅ shipped (with placeholders).
    The page exists; replace 8 placeholder team members in `lib/data.ts → teamMembers` with real C-level & core leadership.

11. **Contact page** (`/kontak`) — ◐ partial.
    The page exists with form UI and contact info. The form has **no submit handler** — wire it to email or a backend.

12. **Replacement of placeholder content with real data** — ◐ ongoing.
    Coordinated by the Head of Product. Engineering provides the editing surfaces in the dashboard; the org team supplies the real numbers, photos, and bios. See `current-state/known-gaps.md` for the running list.

## Status legend
- ✅ shipped
- ◐ partially shipped
- ❌ not built

## Deferred (explicitly out of MVP)

- **LMS account auto-provisioning** for accepted students (temporary username/password by email, onboarding links to WhatsApp / Zoom). Planned for a later phase after MVP stabilizes.
- **Analytics work** — none installed. Revisit once dashboard ships.
- **Hosting / infrastructure** is locked to **VPS + Docker Compose** (Hetzner-class host). See [`infrastructure.md`](infrastructure.md). Provisioning + first deploy is its own sprint, not a deferral.
- **English translations** — site stays Indonesian-first. No i18n layer.
- **Map of branches with deeper interactivity** (per-branch detail pages, photo galleries) — current Leaflet implementation is sufficient for MVP.

## Working principles for the MVP

- **Don't redesign.** The current visual style (catalina blue / sunglow yellow / may green / Lora serif heads) and Indonesian tone are the established brand. New surfaces must compose with the existing system. See `docs/design/*`.
- **Static-first where churn is low** (team page, principles content) — manual edits to `lib/data.ts` are fine for MVP.
- **Dashboard-managed where churn is high** (blog, announcements, reports, student applications). Build the editor surfaces in the dashboard, not in code.
- **External forms are tolerable as a stop-gap** — donation confirmation (Google Form) and volunteer signup (Linktree) can stay externally hosted, but the student registration form should move on-site as part of MVP item #3.
- **Markdown blog is good enough for now.** Don't migrate it to a database until the dashboard is ready to handle authoring.

## How to use this list

When picking up work, confirm the priority hasn't shifted and check `docs/current-state/known-gaps.md` for related issues that should travel with the change. After shipping, update the relevant `current-state/` file in the same PR — stale docs are worse than missing docs.
