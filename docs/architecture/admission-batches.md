# Admission Batches

Sakola Kembara opens registrations once a year and announces every result on the same day. The `admission_batches` table encodes that rhythm and every registration + result surface derives from it.

## Why batches exist

Before batches, the registration form was always open and results were emailed ad-hoc. That created three problems:

- **No time boundary** — students could submit at any moment, so the admin team never had a natural "review window".
- **Rolling verdicts** — early submitters found out before late ones, which leaked pace and created anxiety in the applicant community.
- **No per-year rollup** — reporting "how did the 2026/2027 cohort go" required a manual date-range query.

A batch fixes all three: one row per academic year, one registration window, one publish moment.

## Schema recap

```ts
// lib/db/schema/admission-batches.ts
export const admissionBatches = pgTable("admission_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  year: integer("year").notNull(),                              // e.g. 2026 for "2026/2027"
  name: text("name").notNull(),                                 // "Gen 6 — 2026/2027"
  description: text("description"),

  opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
  closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
  resultsPublishedAt: timestamp("results_published_at", { withTimezone: true }),

  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt, updatedAt,
}, (t) => ({
  yearIdx: index("admission_batches_year_idx").on(t.year),
  opensAtIdx: index("admission_batches_opens_at_idx").on(t.opensAt),
  yearUnique: unique("admission_batches_year_unique").on(t.year),   // one batch per year
}));
```

Key invariants:

- **Year is unique.** DB-enforced. Attempts to create a second batch for the same year fail at the constraint; the admin `createBatch` action also runs a pre-check for a friendly error message.
- **`opensAt` before `closesAt`** — enforced in the Zod schema of `createBatch` / `updateBatch`.
- **`resultsPublishedAt` starts null.** It's set exactly once by `publishBatchResults`, or cleared by `unpublishBatchResults` if a mistake needs to be reversed.

`student_applications` has `batch_id` (FK → `admission_batches.id`, `onDelete: "restrict"`) and a unique constraint on `(user_id, batch_id)` — one student, one submission per batch.

## Lifecycle

```
create → opens_at reached → closes_at reached → per-app decisions → publishBatchResults → done
                (registration open)  (review window)                   (results visible to students)
```

1. **Create** — admin fills the form at `/admin/batches/new`. Server action `createBatch` (in `app/(admin)/admin/batches/actions.ts`) validates, inserts, writes an audit row (`batch.create`), redirects to `/admin/batches/[id]?created=1`.
2. **Open** — nothing happens automatically; `getCurrentOpenBatch()` (`lib/admission-batches.ts`) simply starts returning the row once `now >= opensAt`. `/portal` and `/gabung-siswa` immediately show the CTA.
3. **Registration window** — students submit through `/portal/daftar`. Each submission requires `requireStudent()` and sets `user_id` + `batch_id`. The `(user_id, batch_id)` unique constraint prevents duplicates.
4. **Close** — `closesAt` passes; `getCurrentOpenBatch()` stops returning the row and the portal / gabung-siswa CTA disappears. Admins review submissions in `/admin/applications` (filtered by batch).
5. **Decide** — each application moves `pending → under_review → accepted | rejected`. Every transition is audited.
6. **Publish** — admin clicks "Publikasikan Hasil" on `/admin/batches/[id]`. `publishBatchResults` sets `resultsPublishedAt = now()`, writes an audit row, and revalidates `/portal` + `/portal/status`. Students now see verdicts.

Optional: **unpublish** — `unpublishBatchResults` clears `resultsPublishedAt`. Only for accidental publishes; use sparingly and communicate manually.

## The publish guard

`publishBatchResults` in `app/(admin)/admin/batches/actions.ts` runs three checks before touching the DB:

```ts
if (batch.resultsPublishedAt) redirect(`/admin/batches/${id}?error=Hasil+sudah+dipublikasikan`);

const counts = await getBatchStatusCounts(id);
if (counts.total === 0)
  redirect(`/admin/batches/${id}?error=Belum+ada+pendaftar+di+batch+ini`);
if (counts.pending > 0 || counts.under_review > 0)
  redirect(`/admin/batches/${id}?error=Masih+ada+${...}+pendaftar+yang+belum+diputuskan`);
```

The middle guard is what backs the [`student-portal.md`](student-portal.md) privacy contract: **you cannot publish a batch that still has undecided rows**, so the moment `resultsPublishedAt` is set, every student in the batch has a real verdict waiting.

If you ever need to bypass this guard (e.g. abandon a batch), do it manually in psql and skip the publish action entirely — leave `resultsPublishedAt` null forever and communicate with the affected students directly.

## Admin UI paths

| Path | Purpose |
| --- | --- |
| `/admin/batches` | List all batches, newest year first. Shows year, name, window, status counts, published state. |
| `/admin/batches/new` | Create form. Validates year uniqueness, `closesAt > opensAt`. |
| `/admin/batches/[id]` | Detail + edit form + "Publikasikan Hasil" / "Batalkan Publikasi" actions + link into the batch-filtered `/admin/applications` view. |

The `_editor-form.tsx` component is shared between `new` and `[id]`.

## `/admin/applications` interaction

The applications list accepts an optional `?batch=<id>` filter (or defaults to "all batches"). Reviewers usually work batch-by-batch during a review window:

1. Open `/admin/batches/[id]` to see status counts.
2. Follow the "X pendaftar menunggu keputusan" link into `/admin/applications?batch=<id>&status=pending`.
3. Work through the list; each accept/reject decrements the pending count.
4. When counts hit `pending=0, under_review=0`, come back to `/admin/batches/[id]` and hit publish.

The `/admin/applications` detail page also links back to the parent batch so a reviewer can jump up if they need to compare across pending decisions.

## See also

- [`../roadmap/data-model.md`](../roadmap/data-model.md) — full schema for `admission_batches` and `student_applications`.
- [`student-portal.md`](student-portal.md) — the student side of the same lifecycle.
- [`authentication.md`](authentication.md) — how `requireStudent()` and `requireAdmin()` gate the write paths.
