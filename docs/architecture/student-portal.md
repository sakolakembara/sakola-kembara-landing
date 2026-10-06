# Student Portal

The signed-in student area at `/portal/*`. Home for Sakemers-to-be: register when a batch is open, watch the result appear when the batch is announced.

## Purpose

Give prospective students a stable, personal URL that survives across batches and always shows the same two things:

1. **Can I register right now?** — the current open `admission_batches` row, with a CTA to the multi-step wizard.
2. **What happened to my previous submissions?** — a chronological list, plus a detail page that reveals the verdict only after the batch is officially published.

The portal replaces the earlier public "check status by email" pattern. Every student now signs in with Google (see [`authentication.md`](authentication.md)) and their history is attached to their `users` row.

## Route map

| Path | File | Purpose |
| --- | --- | --- |
| `/portal` | `app/(portal)/portal/page.tsx` | Home. Hero band greeting + current-batch feature card + application history. |
| `/portal/status` | `app/(portal)/portal/status/page.tsx` | Per-application detail view — one card per past submission. |
| `/portal/daftar` | `app/(portal)/portal/daftar/page.tsx` | The multi-step recruitment wizard. Moved out of `/gabung-siswa/form` so it lives inside the auth-gated portal; a 308 redirect preserves the old URL for bookmarks / QR codes. |

Every route under `/portal/*` is gated by both the middleware (`proxy.ts` matcher) and `requireStudent(fromPath)` from `lib/auth-helpers.ts`. Unauthenticated visitors are redirected to `/login?from=<path>`. Any signed-in role (`student`, `viewer`, `editor`, `super_admin`) can reach `/portal` — the middleware also permits admins so they can inspect what students see.

### Visual language

Portal pages use the sub-page hero pattern from [`DESIGN.md`](../../DESIGN.md): a `bg-gradient-to-br from-primary-blue to-accent-navy` band at the top with the yellow-dot eyebrow, Lora serif H1, and short subhead. Content cards below overlap the hero by `-mt-10 md:-mt-14` for a subtle transition. The current-batch feature card on `/portal` uses the same navy gradient (instead of white) when a batch is open with no submission yet — the primary CTA of the whole portal, treated as such.

## `/portal` — home

Three sections, top to bottom:

- **Hero band** — navy gradient with "Portal Siswa" eyebrow + Lora H1 "Selamat datang, {first name}" pulled from `student.name`, falling back to "Sakemers".
- **Current batch feature card** — reads `getCurrentOpenBatch()` (`lib/admission-batches.ts`). Three states:
  - No open batch → white card with warm placeholder copy ("Pendaftaran Sakola Kembara dibuka sekali dalam setahun. Panitia akan memberi tahu di halaman ini…").
  - Open batch, no submission yet → **navy gradient hero card** with batch year + name + `closesAt` chip + "sisa waktu" chip + yellow "Mulai daftar" CTA to `/portal/daftar`.
  - Open batch, already submitted → white card with green check, "Pendaftaran kamu untuk {name} sudah masuk." and a link to `/portal/status`.
- **Riwayat pendaftaran** — reads `getApplicationsForUser(student.userId)`. One line per application: `{year} · {batch name}` on the left, a colored status pill on the right (green "Diterima" / gray "Belum lolos" / amber "Menunggu hasil"). The verdict only shows when `batch.resultsPublishedAt !== null` **and** status is `accepted` or `rejected`.

The `error=admin-only` query param renders a friendly banner ("Halaman admin hanya untuk pengurus yayasan.") when the middleware bounced a student off `/admin`.

## `/portal/status` — per-application detail

One card per row from `getApplicationsForUser`. `statusView(status, batchPublishedAt, reviewNotes)` derives what to show:

- **Batch not published yet** — always render "Pendaftaran kamu sedang diproses" regardless of internal status. Amber clock icon. Copy: *"Terima kasih sudah mendaftar. Panitia akan mengabari hasilnya di halaman ini setelah semua pendaftar batch ini selesai dinilai."*
- **Batch published + `accepted`** — emerald check. Headline: "Selamat! Kamu diterima 🎉". Body: reviewer notes if present, otherwise a default acceptance message.
- **Batch published + `rejected`** — gray heart-handshake icon. Headline: "Belum lolos tahun ini". Body: reviewer notes if present, otherwise warm decline copy. Adds a "Lihat batch pendaftaran berikutnya →" link back to `/portal`.
- **Batch published but decision still `pending` / `under_review`** — should not happen (the publish guard prevents it) but rendered as a fallback: "Sedang diproses" + "hubungi panitia via WhatsApp jika kondisi ini tidak berubah dalam 1×24 jam."

## The privacy contract

> Students only see a verdict after `admission_batches.results_published_at` is set — even if the admin already flipped the internal `student_applications.status`.

This is deliberate and load-bearing. Admins review applications continuously through the review window; publishing them one by one would create anxiety (why did she hear back before me? did I fail already?) and leak the pace of the review to the outside world. The `resultsPublishedAt` timestamp is the single moment when every verdict becomes visible at once.

The two guarantees on top of that:

- **Admin publish guard** — `publishBatchResults()` in `app/(admin)/admin/batches/actions.ts` refuses to publish while any row is still `pending` or `under_review`. See [`admission-batches.md`](admission-batches.md).
- **Portal-side guard** — `statusView()` in `app/(portal)/portal/status/page.tsx` treats missing `resultsPublishedAt` as pending regardless of what the DB says. Even if the publish guard is bypassed (manual DB write, migration bug), the student surface stays honest.

Any new UI that surfaces application state to students **must** honor this contract.

## Copy conventions

Match the formal-warm Indonesian tone. See [`../context/tone-of-voice.md`](../context/tone-of-voice.md) for the full vocabulary. Portal-specific consistency notes:

- **"Menunggu hasil"** — the state label while the batch isn't published. Not "Pending", not "Diproses".
- **"Diterima"** — verdict for `accepted`.
- **"Belum lolos"** — verdict for `rejected`. Chosen over "Ditolak" — warmer, encourages reapplication.
- **"Sakemers"** — students of Sakola Kembara. Used sparingly; "calon Sakemers" for prospective applicants.
- **"kamu"** — always the second-person address, never "Anda". The portal is a personal space.
- **Emoji** — one confetti 🎉 on acceptance, one hand-wave 👋 on the greeting, one 👋 on the empty-history state. Nowhere else.

## LMS SSO handoff

Once a student is accepted, they graduate into the LMS (`lms.sakolakembara.org`, Django + Nuxt). Landing stays the sole identity provider — the LMS reads a signed session cookie set on `.sakolakembara.org` and auto-provisions a local Django user with an FK to `landing.users.id` on first sign-in. No shared DB, no dual accounts.

Full contract (JWT claim shape, endpoints landing must expose, Django + Nuxt implementation guide, local-dev recipe, landing-side checklist) lives in [`lms-integration.md`](lms-integration.md). Design invariants worth naming here:

- **Do not fork the `users` table into two systems.** LMS-specific fields (enrollment status, grade history, event registrations) live in the LMS DB, joined by `landing.users.id`.
- **Preserve `users.id` when a student is promoted** from `student` to any admin role — the LMS keeps working for a student who later volunteers.
- **Sign-out from landing signs out from LMS** because they share the same session cookie on `.sakolakembara.org`. Single-source-of-truth wins the logout race automatically.
- **Course access is scoped to `acceptedInBatches`** (a JWT claim) — a student accepted in Gen 7 doesn't get Gen 6 course materials.
