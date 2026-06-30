# Known Gaps

A running list of things that are missing, broken, or placeholder — as identified in product discussion and confirmed against the code.

## Pages and features not yet built

| Item | Status | Notes |
| --- | --- | --- |
| **`/kontak` form submit handler** | Not wired | The form UI exists but `<form>` has no `onSubmit`. Hook it up to email or a backend. |
| **LMS provisioning for accepted students** | Out of MVP | Auto-generated temp credentials, onboarding email with WhatsApp / Zoom links. Planned post-MVP. |

> Items previously in this table — `/impact-reports`, the announcement strip, the on-site student registration form, and the admin dashboard — have all shipped. See `docs/roadmap/mvp-roadmap.md` for status.

## Content placeholders

These are not bugs — they're known gaps waiting on real data from the org team.

### `lib/data.ts`

- **`teamMembers`** — 8 entries with Unsplash avatars and university placeholders ("Ahmad Fadillah", "Siti Nurhaliza", etc.). Replace with real C-level + core leadership for the MVP `/tim`.
- **`testimonials`** — only **2 entries** ("Daffa Najwan", "Natia Nur Faza"); the testimonial carousel on `ImpactSection` wraps trivially with so few. Add more.
- **`partners`** — only ITB has a real logo URL; the other 4 are text fallbacks. The Partners section also only renders `partner.name`, never `partner.logo` — wire up the logo render once real assets are supplied.

### Pages

- **`/gabung-siswa`** — replaced the legacy WP redirect with a real on-site form that writes to `student_applications`. Mailto fallback is gone.
- **`/program/[id]`** — has explicit "Timeline" and "Galeri Foto" placeholder sections that show "Konten timeline akan ditambahkan" / "Galeri foto akan ditambahkan". Replace with real content or remove the placeholders if not coming soon.
- **`/program/[id]`** — links to `/files/pitchdeck-sakola-kembara.pdf` for a download. Confirm the file exists at that path in `public/files/` before linking from comms.
- **Hero badge images** (`badge1`, `badge2` in `heroImages`) — Unsplash placeholders. Replace with real photos.
- **Activities section program images** — Unsplash placeholders. Replace with real program photography.
- **Donasi QRIS** — `public/images/qris-sakola-kembara.png` is present and live. The page already handles the "missing QR" case gracefully via `qrUnavailable` state.

## Quality / engineering

- **No tests** configured.
- **No CI** configuration.
- **No staging environment** (dev → directly to prod once VPS is provisioned).
- **No error monitoring** (Sentry, etc.).
- **Unsplash placeholder photography is still everywhere** in `lib/data.ts` (hero badges, team avatars, testimonials, programs). Image optimization is wired up (Next proxies + resizes via `/_next/image`), but the real fix is replacing the placeholders with real photography — Phase 8 work in [`../roadmap/mvp-roadmap.md`](../roadmap/mvp-roadmap.md).
- **4 accepted `npm audit` advisories** — all moderate, all the same `esbuild` CVE (GHSA-67mh-4wv8-2f99) surfacing through `drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild`. The CVE applies to `esbuild --serve` (dev server); drizzle-kit only uses esbuild as a TS-config bundler at migration generation, so the issue is not exploitable in our usage. The only available "fix" downgrades drizzle-kit to 0.18.1 (~3 years old). Re-check after each drizzle-kit upgrade. The transitive `postcss` advisory is already pinned via `overrides` in `package.json`.

## Skipped for now (per discussion)

- **Analytics** — none installed; revisit once dashboard ships.
- **English translations** — site is Indonesian-first; do not add an i18n layer.
- **VPS not yet provisioned.** Target host + Docker Compose stack are documented in [`../roadmap/infrastructure.md`](../roadmap/infrastructure.md); actual provisioning + first deploy is pending.
