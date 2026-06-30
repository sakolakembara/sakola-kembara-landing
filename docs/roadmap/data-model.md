# Data Model — Drizzle Schemas

> **Status: locked schemas, not yet migrated.** The Drizzle table definitions in `lib/db/schema/` mirror this doc. When the dashboard implementation lands, `npm run db:generate` writes the first migration into `drizzle/`. After that, this doc and the schema files stay in sync.

Five tables for the MVP admin dashboard. **Auth.js sessions stay JWT-only** — no `sessions` table.

| Table | Purpose | Owns |
| --- | --- | --- |
| `admin_users` | Who can use the dashboard | Email, role, last login |
| `student_applications` | On-site student registration submissions | Applicant profile, status, reviewer notes |
| `announcements` | Homepage announcement strip | Title, body, severity, active window, FK → admin_users |
| `reports` | PDF report metadata (the PDF lives at `public/reports/...`) | Title, category, year, file path, uploader |
| `audit_log` | Append-only record of admin actions | Actor, action, resource, JSONB metadata |

Foreign-key ordering on migrate: `admin_users` first; everything else after.

## Conventions

- **IDs**: UUID (`uuid_generate_v4()` via `gen_random_uuid()`); never auto-increment integers in public-facing surfaces.
- **Timestamps**: `timestamptz` (UTC). `created_at` / `updated_at` on every row; `submitted_at`, `reviewed_at`, `uploaded_at` for domain-specific moments.
- **Enums**: stored as Postgres `text` with a CHECK via Drizzle's `{ enum: [...] }` — keeps migrations cheaper than native enums when values change.
- **Soft delete**: not used at MVP. If a row needs to disappear, hard-delete it and rely on `audit_log` for history.
- **Indexes**: covered in each table section; create them explicitly via `index()` in Drizzle.

## `admin_users`

```ts
// lib/db/schema/admin-users.ts
import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";

export const adminUserRole = ["super_admin", "editor", "viewer"] as const;
export type AdminUserRole = (typeof adminUserRole)[number];

export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(), // always lowercase
    displayName: text("display_name"),
    role: text("role", { enum: adminUserRole }).notNull().default("editor"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index("admin_users_email_idx").on(t.email),
  }),
);

export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;
```

**Population**: first sign-in via Microsoft Entra ID creates the row in the `signIn` callback. The first super admin must be seeded manually (SQL) — there's no UI to elevate the first user.

**Role gates** (forward-looking):
- `super_admin` — everything, plus role management.
- `editor` — content (blog, announcements, reports), application review.
- `viewer` — read-only.

## `student_applications`

```ts
// lib/db/schema/student-applications.ts
import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { adminUsers } from "./admin-users";

export const applicationStatus = ["pending", "under_review", "accepted", "rejected"] as const;
export type ApplicationStatus = (typeof applicationStatus)[number];

export const studentApplications = pgTable(
  "student_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Identity
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    whatsapp: text("whatsapp").notNull(),

    // School info
    schoolName: text("school_name").notNull(),
    graduationYear: integer("graduation_year").notNull(),
    branchPreference: text("branch_preference"), // Cililin / Bandung / Cirebon / ...

    // Motivation (free text)
    motivation: text("motivation").notNull(),
    economicBackground: text("economic_background"),

    // Review
    status: text("status", { enum: applicationStatus }).notNull().default("pending"),
    reviewNotes: text("review_notes"),
    reviewedBy: uuid("reviewed_by").references(() => adminUsers.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    // Timestamps
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("student_applications_status_idx").on(t.status),
    submittedAtIdx: index("student_applications_submitted_at_idx").on(t.submittedAt),
    emailIdx: index("student_applications_email_idx").on(t.email),
  }),
);

export type StudentApplication = typeof studentApplications.$inferSelect;
export type NewStudentApplication = typeof studentApplications.$inferInsert;
```

**Notes**
- No file attachments at MVP. If applicants later need to upload transcripts / family-income letters (privacy-sensitive), those go to object storage with signed URLs, **not** to `public/`.
- `email` is not unique on purpose — the same student may legitimately reapply.
- `reviewedBy` uses `onDelete: "set null"` so deleting an admin doesn't cascade-delete applications they reviewed; the `audit_log` retains who did what.

## `announcements`

```ts
// lib/db/schema/announcements.ts
import { pgTable, uuid, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { adminUsers } from "./admin-users";

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
      .references(() => adminUsers.id, { onDelete: "set null" }),
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
import { adminUsers } from "./admin-users";

export const reportCategory = ["yearly", "financial", "impact", "donation"] as const;
export type ReportCategory = (typeof reportCategory)[number];

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    category: text("category", { enum: reportCategory }).notNull(),
    year: integer("year").notNull(),

    // Path under public/. Example: /reports/2025/impact/laporan-dampak-2025.pdf
    filePath: text("file_path").notNull(),
    fileSize: integer("file_size").notNull(), // bytes

    uploadedBy: uuid("uploaded_by")
      .references(() => adminUsers.id, { onDelete: "set null" }),
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
- Upload writes the PDF to `public/reports/<year>/<category>/<slug>.pdf` inside the `app_public` Docker volume, then inserts the row.
- Delete removes both the file and the row in a transaction-ish pattern (file first; if the DB delete fails, log it — the orphan is cheap to clean up).
- The public `/laporan` page (future) queries `reports` ordered by `year desc, category` and links directly to `filePath`.

## `audit_log`

```ts
// lib/db/schema/audit-log.ts
import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { adminUsers } from "./admin-users";

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    actorId: uuid("actor_id")
      .references(() => adminUsers.id, { onDelete: "set null" }),
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

`drizzle-kit generate` produces one SQL file per change. The first migration must create tables in this order to satisfy FKs:

1. `admin_users`
2. `student_applications` (FK → admin_users)
3. `announcements` (FK → admin_users)
4. `reports` (FK → admin_users)
5. `audit_log` (FK → admin_users)

Drizzle handles ordering automatically inside a single `generate` run; the order matters only if you split into multiple migrations.

## What's deliberately NOT modeled

- **Blog posts** — stays as `content/blog/*.md`. Dashboard editor writes to the markdown source, not to a `posts` table.
- **Team members / partners / testimonials / impact stats** — stays in `lib/data.ts` for MVP. Migrate to DB when churn justifies it.
- **Auth sessions** — JWT-only via Auth.js.
- **OAuth tokens** — Auth.js stores them in the encrypted JWT cookie; no `accounts` table.
- **Donation tracking** — donations go through external rails (Bank Muamalat + QRIS + Google Form). If we ever bring donation confirmation in-house, that's its own `donations` table.
- **LMS data** — owned by the LMS team, separate repo / database.

## What's in scope for the next round

After implementation:

1. `npm install drizzle-orm pg zod && npm install -D drizzle-kit @types/pg`
2. `drizzle.config.ts` at repo root (already sketched in the infra doc; landing in this PR).
3. `lib/env.ts` + `lib/db.ts` (landing in this PR).
4. `lib/db/schema/*.ts` files matching the snippets above (landing in this PR).
5. `npm run db:up && npm run db:generate && npm run db:migrate` to apply.
6. Seed script (`scripts/seed-admin.mjs`) for the first super admin.

The dashboard route group + Auth.js wiring (see [`admin-dashboard.md`](admin-dashboard.md)) is the next step *after* the data layer is live.
