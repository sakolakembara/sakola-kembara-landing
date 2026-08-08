# Data Model — Drizzle Schemas

> **Status: live.** All tables below are migrated (`drizzle/0000_*` through `drizzle/0008_unified_auth_and_batches.sql`) and driving both the public site and `/admin`. This doc mirrors `lib/db/schema/*.ts`; if a field diverges, the schema file wins.

Core tables for the MVP. **Auth.js sessions stay JWT-only** — no `sessions` table, but there IS an `accounts` table for OAuth provider linkages (NextAuth-adapter-compatible shape).

| Table | Purpose | Owns |
| --- | --- | --- |
| `users` | Unified account row for students AND admins | Email, name, image, role (`student` / `viewer` / `editor` / `super_admin`), optional bcrypt `password_hash`, `last_login_at` |
| `accounts` | OAuth linkage | `(provider, providerAccountId)` → `users.id`, plus token fields |
| `admission_batches` | Yearly admissions batch | `year` (unique), name, `opens_at`, `closes_at`, `results_published_at` |
| `student_applications` | On-site student registration submissions | Applicant profile, `user_id`, `batch_id`, status, reviewer notes |
| `announcements` | Homepage announcement strip | Title, body, severity, active window, FK → users |
| `reports` | PDF report metadata (the PDF lives at `public/reports/...`) | Title, description, category, year (text — supports `2025` or academic `2025/2026`), file path, uploader |
| `audit_log` | Append-only record of admin actions | Actor, action, resource, JSONB metadata |

Foreign-key ordering on migrate: `users` first; `admission_batches` before `student_applications`; everything else after.

## Conventions

- **IDs**: UUID (`uuid_generate_v4()` via `gen_random_uuid()`); never auto-increment integers in public-facing surfaces.
- **Timestamps**: `timestamptz` (UTC). `created_at` / `updated_at` on every row; `submitted_at`, `reviewed_at`, `uploaded_at` for domain-specific moments.
- **Enums**: stored as Postgres `text` with a CHECK via Drizzle's `{ enum: [...] }` — keeps migrations cheaper than native enums when values change.
- **Soft delete**: not used at MVP. If a row needs to disappear, hard-delete it and rely on `audit_log` for history.
- **Indexes**: covered in each table section; create them explicitly via `index()` in Drizzle.

## `users`

Unified account row — one table for admins AND students. Replaces the earlier `admin_users` (renamed + extended by migration `drizzle/0008_unified_auth_and_batches.sql`).

```ts
// lib/db/schema/users.ts
import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";

export const userRole = ["student", "viewer", "editor", "super_admin"] as const;
export type UserRole = (typeof userRole)[number];

export const adminRoles = ["viewer", "editor", "super_admin"] as const;
export type AdminRole = (typeof adminRoles)[number];

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(), // lowercased on insert
    name: text("name"),
    /** Avatar / profile picture URL — populated from Google on OAuth sign-in. */
    image: text("image"),
    role: text("role", { enum: userRole }).notNull().default("student"),
    /** bcrypt digest. Null when the account is Google-only. */
    passwordHash: text("password_hash"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index("users_email_idx").on(t.email),
    roleIdx: index("users_role_idx").on(t.role),
  }),
);
```

**Population**
- **Students**: created on first Google sign-in by the `signIn` callback in `auth.ts`, defaulting to `role='student'` with `password_hash = NULL`.
- **Admins**: either promoted from an existing student row via `/admin/settings`, or seeded via `npm run seed:super-admin` (Credentials-based super_admin). The seed script upserts by email and refreshes the bcrypt hash each time.
- The `signIn` callback keeps `name` / `image` fresh from Google on each login but **never demotes** an existing role.

**Role gates**
- `student` — `/portal/*`, the auth-gated `/gabung-siswa/form`.
- `viewer` — read-only across `/admin/*`.
- `editor` — content mutations + application review.
- `super_admin` — everything, plus role management in `/admin/settings`.

## `accounts`

Modelled after the NextAuth Drizzle-adapter table so we can plug in the official adapter later if we ever want DB-backed sessions. Today, sessions stay JWT-only and this table only maps a Google `(provider, providerAccountId)` → `users.id` on repeat sign-ins.

```ts
// lib/db/schema/accounts.ts
import { pgTable, uuid, text, integer, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),               // e.g. "google"
    providerAccountId: text("provider_account_id").notNull(),
    type: text("type").notNull(),                       // "oauth" | "oidc"
    refreshToken: text("refresh_token"),
    accessToken: text("access_token"),
    expiresAt: integer("expires_at"),
    tokenType: text("token_type"),
    scope: text("scope"),
    idToken: text("id_token"),
    sessionState: text("session_state"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
    userIdx: index("accounts_user_id_idx").on(t.userId),
  }),
);
```

Cascading delete on `userId` — removing a `users` row wipes their linked OAuth accounts. `provider` is free-form so a future provider (e.g. Apple) slots in without a migration.

## `admission_batches`

A yearly admissions batch. Because admissions run once a year, the batch is the primary time boundary: registrations open when a batch is opened, close on its `closesAt`, and results become visible to students only after `resultsPublishedAt` is set (batch-level publish).

```ts
// lib/db/schema/admission-batches.ts
import { pgTable, uuid, text, integer, timestamp, index, unique } from "drizzle-orm/pg-core";
import { users } from "./users";

export const admissionBatches = pgTable(
  "admission_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Academic year, e.g. 2026 for "2026/2027". */
    year: integer("year").notNull(),
    /** Human label, e.g. "Gen 6 — 2026/2027". */
    name: text("name").notNull(),
    description: text("description"),

    /** Registration window: students can submit only while now ∈ [opensAt, closesAt). */
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
    closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),

    /**
     * Set once every application in the batch has been decided. Students only
     * see accepted/rejected verdicts on /portal/status after this is non-null.
     */
    resultsPublishedAt: timestamp("results_published_at", { withTimezone: true }),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    yearIdx: index("admission_batches_year_idx").on(t.year),
    opensAtIdx: index("admission_batches_opens_at_idx").on(t.opensAt),
    yearUnique: unique("admission_batches_year_unique").on(t.year),  // one batch per year
  }),
);
```

Owned by `/admin/batches`. Publish/unpublish is a separate server action in `app/(admin)/admin/batches/actions.ts` — it refuses to publish while any application in the batch is still `pending` or `under_review`. See [`../architecture/admission-batches.md`](../architecture/admission-batches.md).

## `student_applications`

Extended by migration 0008 with `user_id` + `batch_id` FKs and a unique `(user_id, batch_id)` constraint so a student can only submit once per batch. The columns are nullable in the DB to preserve historic rows that predate the auth-gated form, but the server action for new submissions enforces that both are set.

```ts
// lib/db/schema/student-applications.ts (excerpt — see the file for the full formData type)
import { pgTable, uuid, text, jsonb, timestamp, index, unique } from "drizzle-orm/pg-core";
import { users } from "./users";
import { admissionBatches } from "./admission-batches";

export const applicationStatus = ["pending", "under_review", "accepted", "rejected"] as const;
export type ApplicationStatus = (typeof applicationStatus)[number];

export const studentApplications = pgTable(
  "student_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** The signed-in student who owns this application. Enforced non-null in server action. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** The batch this application belongs to. Enforced non-null in server action. */
    batchId: uuid("batch_id").references(() => admissionBatches.id, { onDelete: "restrict" }),

    fullName: text("full_name").notNull(),
    /** Snapshot of the account email at submission time. */
    email: text("email"),
    whatsapp: text("whatsapp").notNull(),

    schoolName: text("school_name").notNull(),
    /** Text so we carry radio values verbatim, e.g. "2027 (Kelas 12)". */
    graduationYear: text("graduation_year").notNull(),
    branchPreference: text("branch_preference"),

    /** Legacy free-text field; new form leaves it null and puts rich answers in formData.interview. */
    motivation: text("motivation"),
    economicBackground: text("economic_background"),

    /** Everything the multi-step recruitment wizard collects. See the StudentApplicationFormData type in the schema file. */
    formData: jsonb("form_data").$type<StudentApplicationFormData | null>(),

    status: text("status", { enum: applicationStatus }).notNull().default("pending"),
    reviewNotes: text("review_notes"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("student_applications_status_idx").on(t.status),
    submittedAtIdx: index("student_applications_submitted_at_idx").on(t.submittedAt),
    emailIdx: index("student_applications_email_idx").on(t.email),
    userIdx: index("student_applications_user_id_idx").on(t.userId),
    batchIdx: index("student_applications_batch_id_idx").on(t.batchId),
    /** A given user can only have one application per batch. */
    userBatchUnique: unique("student_applications_user_batch_unique").on(t.userId, t.batchId),
  }),
);
```

**Notes**
- `formData` (JSONB) holds the multi-step wizard payload — identity, household, housing, organizations, uploaded document URLs, marketing proofs, interview answers. File uploads land under `public/uploads/` and the JSON stores the path.
- The `batchId → admissionBatches.id` FK uses `onDelete: "restrict"` — you cannot delete a batch that still has applications attached.
- `reviewedBy` and `userId` use `onDelete: "set null"` so deleting an admin (or a student user) doesn't cascade-delete applications; the `audit_log` retains who did what.
- `email` is not unique — historic rows may repeat it; the `(user_id, batch_id)` unique constraint is what actually prevents duplicate submissions on the current auth-gated flow.

## `announcements`

```ts
// lib/db/schema/announcements.ts
import { pgTable, uuid, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const announcementSeverity = ["info", "warning", "urgent"] as const;
export type AnnouncementSeverity = (typeof announcementSeverity)[number];

export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body").notNull(), // markdown allowed
    severity: text("severity", { enum: announcementSeverity }).notNull().default("info"),

    ctaLabel: text("cta_label"),
    ctaUrl: text("cta_url"),

    active: boolean("active").notNull().default(false),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),

    createdBy: uuid("created_by")
      .references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeIdx: index("announcements_active_idx").on(t.active, t.startsAt, t.endsAt),
  }),
);

export type Announcement = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;
```

**Homepage query** (what `app/(public)/page.tsx` will run):

```ts
const now = new Date();
const current = await db.query.announcements.findFirst({
  where: and(
    eq(announcements.active, true),
    or(isNull(announcements.startsAt), lte(announcements.startsAt, now)),
    or(isNull(announcements.endsAt), gte(announcements.endsAt, now)),
  ),
  orderBy: desc(announcements.createdAt),
});
```

Only one strip rendered at a time; admins can prepare future announcements and flip `active = true` when ready.

## `reports`

```ts
// lib/db/schema/reports.ts
import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const reportCategory = ["yearly", "financial", "impact", "donation"] as const;
export type ReportCategory = (typeof reportCategory)[number];

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category", { enum: reportCategory }).notNull(),
    // Text, so we can carry either single years ("2025") or Indonesian
    // academic-year strings ("2025/2026"). Sorted lexicographically desc.
    year: text("year").notNull(),

    // Path under public/. Slash in the year is normalized to a dash:
    //   "2025/2026" → /reports/2025-2026/impact/laporan-dampak.pdf
    filePath: text("file_path").notNull(),
    fileSize: integer("file_size").notNull(), // bytes

    uploadedBy: uuid("uploaded_by")
      .references(() => users.id, { onDelete: "set null" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    categoryYearIdx: index("reports_category_year_idx").on(t.category, t.year),
  }),
);

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
```

**File handling**
- Upload writes the PDF to `public/reports/<year-segment>/<category>/<slug>.pdf` inside the `app_public` Docker volume, then inserts the row. `<year-segment>` normalizes the academic-year slash to a dash (`2025/2026` → `2025-2026`) since path segments can't contain `/`.
- Delete removes both the file and the row in a transaction-ish pattern (file first; if the DB delete fails, log it — the orphan is cheap to clean up).
- The public `/laporan` page (future) queries `reports` ordered by `year desc, category` and links directly to `filePath`.

## `audit_log`

```ts
// lib/db/schema/audit-log.ts
import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    actorId: uuid("actor_id")
      .references(() => users.id, { onDelete: "set null" }),
    // Denormalized — survives admin deletion so we always know "who did this".
    actorEmail: text("actor_email").notNull(),

    // e.g. "report.create", "application.accept", "announcement.publish"
    action: text("action").notNull(),

    // e.g. "report" / "application" / "announcement". Nullable for global actions.
    resourceType: text("resource_type"),
    resourceId: text("resource_id"), // UUID or slug

    // Arbitrary context: before/after snapshots, request IP, etc.
    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actorIdx: index("audit_log_actor_idx").on(t.actorId),
    createdAtIdx: index("audit_log_created_at_idx").on(t.createdAt),
    resourceIdx: index("audit_log_resource_idx").on(t.resourceType, t.resourceId),
  }),
);

export type AuditEntry = typeof auditLog.$inferSelect;
export type NewAuditEntry = typeof auditLog.$inferInsert;
```

**Write pattern**: every admin server action / API route writes to `audit_log` *after* its mutation succeeds. Never block the user response on log success — `void writeAudit(...)` and let Sentry catch failures.

**Retention**: keep forever at MVP scale (the table will stay tiny). Add a prune job once it hits ~10M rows.

## Migration order

`drizzle-kit generate` produces one SQL file per change. Within a single `generate` run drizzle handles ordering automatically. Across manually-written migrations (like `drizzle/0008_unified_auth_and_batches.sql`) the order must satisfy FKs:

1. `users` (was `admin_users` — renamed + extended in 0008)
2. `accounts` (FK → users)
3. `admission_batches` (FK → users)
4. `student_applications` (FKs → users, admission_batches)
5. `announcements`, `reports`, `audit_log`, `contact_messages`, `site_resources`, `team_members` (FK → users where applicable)

> **Snapshot note for 0008.** `drizzle/meta/` was **not** regenerated for the 0008 migration — drizzle-kit's rename detection requires an interactive TTY prompt (`admin_users → users`) that can't run in CI. After applying 0008 to a fresh dev DB, run `npm run db:generate -- --name resync_snapshot` in a terminal with a real TTY to refresh the snapshot before making further schema changes. Otherwise the next `db:generate` will produce a garbage diff.

## What's deliberately NOT modeled

- **Blog posts** — stays as `content/blog/*.md`. Dashboard editor writes to the markdown source, not to a `posts` table.
- **Team members / partners / testimonials / impact stats** — `team_members` lives in the DB; the rest stays in `lib/data.ts` for MVP.
- **Auth sessions** — JWT-only via Auth.js. `accounts` covers OAuth linkage but not session state.
- **Donation tracking** — donations go through external rails (Bank Muamalat + QRIS + Google Form). If we ever bring donation confirmation in-house, that's its own `donations` table.
- **LMS data** — owned by the LMS team, separate repo / database. `users` is the anchor point for a future SSO handoff (see [`../architecture/student-portal.md`](../architecture/student-portal.md)).

## See also

- [`../architecture/authentication.md`](../architecture/authentication.md) — how `users` and `accounts` are populated by the Auth.js callbacks.
- [`../architecture/admission-batches.md`](../architecture/admission-batches.md) — how `admission_batches` and `student_applications` interact through the batch lifecycle.
- `lib/db/schema/*.ts` — the authoritative source; this doc mirrors it.
