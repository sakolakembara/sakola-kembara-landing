# D1 schema and permission model (SAKEM-081, part A)

The full database schema of the new admin/portal backend ([`cf/admin`](../../cf/admin)) and the rules for who may read or change what. Epic SAKEM-074, milestone M2. **No production database change: everything here is local D1 only** (no Cloudflare account was used, no remote command was run, no resource exists yet). The legacy Postgres schema is untouched, and no data is migrated: the production Postgres holds only dummy data, so this is a schema rewrite, not a data migration.

Decisions here are made (by Dzul, in the epic and in the SAKEM-081 comment of 2026-10-12); this page records them so they are not re-litigated in the next PRs.

## What is in the box

| Part | Where |
| --- | --- |
| Drizzle schema, one file per concern, re-exported from `src/db/schema.ts` | `cf/admin/src/db/schema/` |
| Four SQL migrations, one per concern, `0004_public_blog_index` (one index, added by the public API: [`public-api.md`](public-api.md)), `0005_user_deactivation` and `0006_keep_one_super_admin` (a hand-written trigger; [`auth.md`](auth.md)), and `0007_reports_updated_at` (a hand-written table rebuild: SQLite refuses `ADD COLUMN` with a non-constant default; [`admin-konten.md`](admin-konten.md#8-migration-0007)) | `cf/admin/migrations/` |
| Permission model (pure) and the `requireArea` guard | `src/auth/permissions.ts`, `src/auth/guard.ts` |
| Super-admin routes to grant and revoke an editor's areas | `src/api/admin-users.ts` |
| Dev seed for every table | `scripts/seed-data.ts`, `scripts/seed.ts` |
| Tests (workerd, real local D1) and 25 negative checks | `test/`, `scripts/negative-checks.mjs` |
| Schema-against-migrations drift check | `scripts/check-migrations.mjs` |

## Conventions

| | Rule | Why |
| --- | --- | --- |
| Ids | `text`, a UUID made in the app (`crypto.randomUUID()` through Drizzle `$defaultFn`). Better Auth's four tables use the ids Better Auth generates. | SQLite has no `gen_random_uuid()`. Legacy UUIDs fit as they are. |
| Timestamps | `integer`, epoch **milliseconds**, Drizzle `timestamp_ms` (a JS `Date` in code). `created_at` and `updated_at` default to now in the database; Drizzle refreshes `updated_at` on `update()`. | Better Auth expects ms. Postgres `timestamptz` has no SQLite equivalent. |
| Booleans | `integer` 0/1, Drizzle `boolean`. | SQLite has no boolean type. |
| JSON | `text`, Drizzle `mode: "json"` with `$type<...>()`, plus a `json_valid()` CHECK (team histories must also be arrays). | SQLite has no `jsonb`. The CHECK stops a raw write from storing garbage. |
| Enums | `text` plus a `CHECK (col IN (...))` named `<table>_<col>_check`. Drizzle's `text({ enum })` only types the column; it emits no constraint, so each enum has an explicit `enumCheck()` (`src/db/schema/_common.ts`). Tests prove the database refuses an unlisted value and a wrong-case value for every enum. | Same guarantee as a Postgres enum, and an unknown value cannot be written by a script either. |
| Foreign keys | Same rules as legacy (table below). D1 enforces foreign keys; a test proves it. | |
| Files | A column holds a **root-relative public path** (`/reports/2025-2026/x.pdf`), as in the legacy data and the public API contract. For a file uploaded through the admin, the **R2 object key is that path without the leading slash** (`media.key`). | One string serves the API and R2. |
| Public dates | Stored as instants. The API derives display dates in **Asia/Jakarta** (UTC+7, no DST). An imported date-only article is stored as 00:00 WIB (17:00 UTC the day before). | Avoids an off-by-one day for `dateISO`. |
| Money and sizes | Plain integers (rupiah, bytes). | |

## Tables at a glance

16 tables. Area = which area of the permission model owns the menu (see [Permission model](#permission-model)).

| Table | From | Area | Migration |
| --- | --- | --- | --- |
| `users`, `session`, `account`, `verification` | legacy `users`, `accounts`; Better Auth | (auth) | `0000_auth_audit_permissions` |
| `admin_area_grants` | **new** | `sistem` (managed by super_admin) | `0000` |
| `audit_log` | legacy | `sistem` (Aktivitas) | `0000` |
| `admission_batches`, `student_applications` | legacy | `pendaftaran` | `0001_admission` |
| `announcements`, `contact_messages` | legacy | `komunikasi` | `0002_communication` |
| `reports`, `team_members`, `shortlinks` | legacy | `konten` | `0003_content` |
| `site_resources` (menu "Pusat Dokumen") | legacy | `pendaftaran` | `0003` |
| `blog_posts` | **new** (legacy: 80 markdown files) | `konten` | `0003` |
| `media` | **new** | by `purpose` | `0003` |

**Not ported:** legacy `accounts` (NextAuth OAuth links; Better Auth's `account` replaces it, and also holds the password hash) and `rate_limit_hits` (Cloudflare rate limit bindings replace it, so there is no counter table and no write per request).

## Legacy to D1, table by table

Every legacy column is listed. "same" means the same name and meaning with the type mapping of the conventions above. Postgres `defaultNow()` becomes a database default of now in ms.

### `users` (Better Auth `user` model, mapped onto the table name `users`)

| Legacy | D1 | Change and why |
| --- | --- | --- |
| `id` uuid | `id` text | Better Auth generates it. Legacy UUIDs can be inserted as they are. |
| `email` text unique, lowercased | `email` text unique | same. Better Auth lowercases on insert. |
| `name` text, nullable | `name` text **NOT NULL** | Better Auth requires a name. |
| `image` text | `image` text | same |
| `role` enum | `role` text, default `student`, CHECK `users_role_check` | same values: `student`, `viewer`, `editor`, `super_admin`. |
| `passwordHash` text (bcrypt) | **moved** to `account.password` of the `credential` account | New format `pbkdf2-sha256$100000$...` (`src/auth/password.ts`). bcrypt hashes cannot be verified on Workers, so legacy students need a password reset at cutover (admin-skeleton risk 2). |
| `emailVerifiedAt` timestamp | `email_verified` integer boolean | Better Auth's shape. The instant of verification is not kept. |
| *(new)* | `deactivated_at` integer (ms), nullable | Set when a super_admin deactivates the account (migration `0005_user_deactivation`): no sign-in by any method, sessions deleted. A trigger (`0006_keep_one_super_admin`) refuses to leave the system without an active super_admin. See [`auth.md`](auth.md#admin-users). |
| `lastLoginAt` timestamp | **dropped** | Nothing writes it in Better Auth. Derive "last login" as the newest `session.created_at` of the user (sessions are swept after they expire, so it is only recent history; see open decisions). |
| `createdAt`, `updatedAt` | same | ms |

Indexes: `users_email_idx` dropped (the unique index on `email` already serves it); `users_email_verified_at_idx` dropped (the column is a boolean now); `users_role_idx` kept.

### `session`, `account`, `verification` (Better Auth)

Shape follows what Better Auth reads and writes (`src/db/schema/auth.ts`); unchanged from the SAKEM-078 skeleton except that timestamps use the shared helpers. `session.token` is unique; `session.user_id` and `account.user_id` cascade on user delete. `verification.identifier` is stored hashed. The credential `account` row carries the password hash; a Google link is a second `account` row (`provider_id = 'google'`).

### `admission_batches`

| Legacy | D1 | Change and why |
| --- | --- | --- |
| `id`, `year`, `name`, `description`, `opensAt`, `closesAt`, `resultsPublishedAt`, `createdAt`, `updatedAt` | same | `year` stays unique. |
| `createdBy` uuid FK `ON DELETE SET NULL` | `created_by` text, same rule | |
| | CHECK `year BETWEEN 2024 AND 2100` | The legacy server action's bound, now also in the database. |
| | CHECK `closes_at > opens_at` | Same. |

Indexes: unique on `year` kept; legacy `admission_batches_year_idx` dropped (a second index on the same column as the unique one, pure write cost); `admission_batches_opens_at_idx` kept.

### `student_applications`

| Legacy | D1 | Change and why |
| --- | --- | --- |
| `userId` FK `SET NULL`, nullable | `user_id` same | Nullable because deleting the account keeps the application. |
| `batchId` FK `RESTRICT`, nullable | `batch_id` **NOT NULL**, `RESTRICT` | The legacy column was nullable only for rows that predate batches; there are none to carry. |
| `email` text, nullable | `email` **NOT NULL** | Same reason: a snapshot of the account email, always known. |
| `fullName`, `whatsapp`, `schoolName`, `graduationYear`, `branchPreference`, `motivation`, `economicBackground`, `reviewNotes`, `reviewedAt`, `submittedAt`, `updatedAt` | same | `graduationYear` stays text (radio values verbatim). |
| `formData` jsonb | `form_data` text JSON + `json_valid` CHECK | The v2 type is copied into `src/db/schema/admission.ts`; keep the two in step until the legacy app is retired. |
| `status` enum, default `pending` | same + CHECK | |
| `reviewedBy` FK `SET NULL` | same | |

Indexes: `status`, `submitted_at`, `email`, `batch_id` kept; unique `(user_id, batch_id)` kept (several rows with a NULL user are allowed, as in Postgres); legacy `student_applications_user_id_idx` dropped (the unique index starts with `user_id`).

### `announcements`

Same columns (`id`, `title`, `body` markdown, `severity` default `info`, `ctaLabel`, `ctaUrl`, `active` default false, `startsAt`, `endsAt`, `createdBy` `SET NULL`, timestamps). Added CHECKs: `severity` enum; CTA label and URL **both or neither**; `ends_at >= starts_at` (rules the legacy server action enforced and the public API relies on). Index `announcements_active_idx (active, starts_at, ends_at)` kept.

### `contact_messages`

Same columns (`fullName`, `email`, `subject`, `message`, `readAt` null until opened, `createdAt`). Added CHECK on `subject` (`partnership`, `donation`, `other`). Indexes `created_at`, `read_at`, `email` kept. Visitor personal data: only the Pesan menu touches it, and the audit trail never carries the message text.

### `reports`

Same columns (`title`, `description`, `category`, `year`, `filePath`, `fileSize`, `uploadedBy` `SET NULL`, `uploadedAt`), plus **`updated_at`** (migration `0007`, added with the Laporan screen: the legacy admin could edit a report's metadata and the edit needs a version for `If-Match`; existing rows take their upload time). Added CHECKs: `category` enum; `year` is `2025` or `2025/2026` (the text sort order depends on 4-digit padding); `file_size >= 0`. Index `(category, year)` kept.

### `team_members`

Same columns. `educationHistory` and `workHistory` jsonb become text JSON, `NOT NULL DEFAULT '[]'`, with `json_valid` **and** array-type CHECKs. Added CHECKs: `category` enum; `display_order BETWEEN 0 AND 9999` (the legacy form's bound). Indexes `display_order` and `category` kept.

### `site_resources` (menu "Pusat Dokumen")

Same columns. Added CHECKs: `category` and `content_type` enums; `file_size >= 0`; and **`site_resources_shape_check`**: each row is exactly one of `file` (`file_path` and `file_size` set), `url` (`external_url` set) or `text` (`body_text` set), the others NULL, matching `content_type`. The legacy app enforced this only in the server action; the public API contract depends on it. Index `(category, display_order)` kept. `file_size` is now required for a file (legacy allowed NULL).

### `shortlinks`

Same columns. Unique index `shortlinks_slug_idx` kept. Added CHECKs: the legacy `validateSlug` grammar (lowercase letters, digits, single inner hyphens, 1 to 64 characters), so the database is the final arbiter even when two admins submit the same slug at once; the target is `/path` (not `//host`) or `http(s)://`; `click_count >= 0`. The reserved-slug list (paths of real routes) stays application code because it follows the routing of the public site (`cf/admin/src/shortlinks/reserved.ts`). The CHECK does **not** refuse a `/\evil.example` or a tab inside a path (the application's target rule does: [`admin-konten.md`](admin-konten.md#5-shortlink)). `click_count` and `last_clicked_at` are written only by the redirect, one `UPDATE` of one row after the answer, which leaves `updated_at` alone.

### `audit_log`

Same columns. `metadata` jsonb becomes text JSON with a `json_valid` CHECK. `action` stays free text on purpose: legacy rows keep old action names, and the TypeScript union in `src/db/audit.ts` grows as each area is ported. Indexes: `actor_id` and `(resource_type, resource_id)` kept; `created_at` is replaced by `(created_at, id)` and three are added, `(action, created_at, id)`, `(resource_type, created_at, id)` and `(actor_email, created_at, id)`, by migration `0007_audit_viewer_indexes`: the Aktivitas page walks the log newest first with a cursor and filters by one of the three, and without them every filter was a scan of the table (plans and rows read in [`admin-sistem.md`](admin-sistem.md#35-query-plans-and-rows-read)). An audit row therefore writes 8 D1 rows (the table, the `id` autoindex, six indexes). Append-only by convention.

## New tables

### `admin_area_grants`

One row per `(user, area)` an editor may change. Primary key `(user_id, area)` (unique per pair, and lighter than a surrogate id plus a unique index); `area` CHECK limited to `pendaftaran`, `komunikasi`, `konten` (**`sistem` is not grantable**); `granted_by` (`SET NULL`), `granted_at`; deleting the user cascades.

### `blog_posts`

Follows the "Illustrative D1 mapping" of [`content-api.md`](content-api.md).

| Column | Notes |
| --- | --- |
| `id`, `slug` (unique, `blog_posts_slug_idx`) | `slug` is the URL: lowercase letters, digits, single hyphens, up to 160 characters (CHECK). Immutable once published: enforced by the blog API, not by the database. All 80 current slugs satisfy the CHECK. |
| `title`, `excerpt`, `author` | |
| `content_markdown`, `content_html` | The markdown is the source of truth. HTML is rendered **at save time** and stored beside it, so both are written together; never rendered on read. |
| `image`, `image_width`, `image_height` | Hero image path and its pixel size, recorded at upload; both or neither, positive (CHECK). |
| `category` | Enum CHECK, the fixed list of the legacy admin (`Career`, `Cerita`, `Education`, `Kiat kiat`, `News`, `Testimonials`, `Tips`, `Uncategorized`). The 80 existing articles use only these. |
| `featured` | Boolean. The public API picks the newest featured one. |
| `status`, `published_at` | `draft` or `published`. CHECK: a published article has `published_at`. Public `date` and `dateISO` derive from it (Asia/Jakarta); `modifiedISO` from `updated_at`. A draft is never served. |
| `wp_id` (unique, many NULLs allowed), `source_url` | For the 80 imported WordPress articles; NULL for articles written in the admin. Never exposed. |
| `created_by`, `updated_by`, `created_at`, `updated_at` | Audit columns, never exposed. |

Index `(status, published_at)` serves the public list (published, newest first). Index `(status, featured, published_at)` (migration `0004`) makes the featured article of the blog index an index seek instead of a sort of every article, and serves the published count.

### `media`

A registry of what the admin uploaded to R2: `key` (unique, no leading slash), `purpose` (`blog`, `team`, `report`, `resource`), `content_type`, `size`, `width` and `height` (images only, both or neither), `uploaded_by`, `created_at`. It exists so that (1) the blog renderer can put `width` and `height` on inline images at save time, and the hero image can copy the size, (2) the bucket can be listed and orphans cleaned, (3) size and type checks need no R2 call per request. It is a registry, not a foreign-key target: reports, team members, resources and posts keep a plain path like the legacy columns, so the 80 imported articles and their images need no `media` rows. `purpose` decides the area that may upload it: `blog`, `team`, `report` need `konten`; `resource` needs `pendaftaran`. The upload API (SAKEM-082) fills it: the upload `kind` (`team-photo`, `blog-image`, `report`, `resource`, `registration-document`) maps to a purpose (the last two share `resource`), `key` is `uploads/<kind>/<yyyy>/<media id>-<slug>.<ext>`, and the path stored in content rows is `"/" + key`; a file is only deleted while no content row references the path. Kinds, limits, the key scheme and the reference registry: [`uploads.md`](uploads.md).

## Constraint catalog

Foreign keys (all `ON UPDATE NO ACTION`):

| Column | On parent delete |
| --- | --- |
| `session.user_id`, `account.user_id`, `admin_area_grants.user_id` | CASCADE |
| `student_applications.batch_id` | **RESTRICT** (a batch with applications cannot be deleted) |
| every other user pointer (`created_by`, `updated_by`, `uploaded_by`, `reviewed_by`, `granted_by`, `actor_id`, `student_applications.user_id`) | SET NULL (the row survives its person) |

Deleting a user scans each table that points at them without an index (rare, small tables); `audit_log` and `student_applications` are the ones with an index to use.

CHECK constraints (names are `<table>_..._check`):

| Table | Rule |
| --- | --- |
| `users` | `role` in the four roles |
| `admin_area_grants` | `area` in `pendaftaran`, `komunikasi`, `konten` |
| `audit_log` | `metadata` is valid JSON |
| `admission_batches` | `year` 2024 to 2100; `closes_at > opens_at` |
| `student_applications` | `status` enum; `form_data` valid JSON |
| `announcements` | `severity` enum; CTA label and URL both or neither; `ends_at >= starts_at` |
| `contact_messages` | `subject` enum |
| `reports` | `category` enum; `year` is `YYYY` or `YYYY/YYYY`; `file_size >= 0` |
| `team_members` | `category` enum; `display_order` 0 to 9999; histories are valid JSON arrays |
| `site_resources` | `category` and `content_type` enums; `file_size >= 0`; exactly one shape per row |
| `shortlinks` | slug grammar; target form; `click_count >= 0` |
| `blog_posts` | `category` and `status` enums; slug grammar; published needs `published_at`; image size both or neither and positive |
| `media` | `purpose` enum; key has no leading slash; `size >= 0`; dimensions both or neither and positive |

**What could not be ported:** nothing. The legacy schema has no partial or functional index and no Postgres-only type beyond `uuid`, `timestamptz` and `jsonb`, which map as in the conventions. Two points to know: SQLite cannot `ADD CONSTRAINT`, so changing a CHECK later means a table rebuild (drizzle-kit generates it; on D1 call `PRAGMA defer_foreign_keys = true` first, see the D1 migrations docs), and a Postgres `UNIQUE` constraint is a unique index here.

## Permission model

Decided by Dzul (IA admin, [`admin-ia.md`](admin-ia.md), the SAKEM-081 comment of 2026-10-12, and the SAKEM-082 comment of the same day that changed the editor row). Roles stay `student`, `viewer`, `editor`, `super_admin`; areas are `pendaftaran`, `komunikasi`, `konten`, `sistem`.

| Role | `pendaftaran` | `komunikasi` | `konten` | `sistem` |
| --- | --- | --- | --- | --- |
| `student` | none | none | none | none |
| `viewer` | read | read | read | none |
| `editor` | read and write **only if granted, otherwise none** | read and write **only if granted, otherwise none** | read and write **only if granted, otherwise none** | none |
| `super_admin` | read, write | read, write | read, write | read, write |

- **`viewer` is strictly read-only**, whatever rows exist in `admin_area_grants` (a stray grant on a viewer is inert, and not shown as a right). This fixes the legacy defect that only Pengaturan checked the role.
- **`editor`** reads and changes only inside the areas granted to them and has **no access at all** to the others: there is no read-only level for an editor (`levelIn("editor", ...)` is `write` or `none`). The menus of the other areas are hidden in the SPA, their routes show the 403 page, and their API reads answer 403 (an editor with no `komunikasi` gets 403 on `GET /api/admin/announcements`). For an editor `/api/me` reports `areas.visible` equal to `areas.granted` (and to `areas.writable`). An editor with no grants at all can open the dashboard and nothing else; the dashboard has no area, so it is open to every admin role (viewer, editor, super_admin), and what it shows is limited to the areas the caller may see (see "Dashboard" in [`admin-ia.md`](admin-ia.md#33-dashboard-hanya-perlu-perhatian-dan-tindakan-cepat)). Until 2026-10-12 an editor could read every area but Sistem; the one line in `levelIn`, `test/permissions.test.ts`, `test/areas.test.ts`, `test/announcements.test.ts`, `test/seed.test.ts` and `test/spa-contract.test.ts` changed with it, and `pnpm test:negative` has a check that puts the old read rule back and expects those tests to fail.
- **`sistem`** (Pengaturan: admin users and area grants; Aktivitas: the audit log) is for `super_admin` only and cannot be granted. This **supersedes** `admin-ia.md` sections 3.2 and 3.5, which proposed Aktivitas for every role.
- `student` uses the portal only. Unknown roles, areas and actions get nothing.

### Menu to area (the IA sidebar)

`menuItems` in `src/auth/permissions.ts` is this table, in sidebar order; the SPA can build its menu from `/api/me` without repeating it.

| Area | Menus (key = API resource name) |
| --- | --- |
| `pendaftaran` | Batch (`batches`), Pendaftar (`applications`), Pusat Dokumen (`resources`) |
| `komunikasi` | Pesan (`messages`), Pengumuman (`announcements`) |
| `konten` | Blog (`blog`), Laporan (`reports`), Tim (`team`), Shortlink (`shortlinks`) |
| `sistem` | Aktivitas (`audit`), Pengaturan (`settings`; admin users and area grants) |

Dashboard has no area: every admin role may open it. Public endpoints (`/api/public/*`, the contact form) have no guard: they are served only to the Astro Worker through the `PublicApi` service binding (the Worker's public face serves none of them, [`public-api.md`](public-api.md)); the contact form is throttled by a rate limit binding and checked with Turnstile, and writes `contact_messages`.

### How a request is checked

`requireArea(area, action)` (`src/auth/guard.ts`) is the guard to put on every admin route:

1. Better Auth reads the session and the user row from D1 (no cookie cache), so the **role** is never older than the request.
2. For an `editor`, the **grants** are read from `admin_area_grants` in the same request (skipped for other roles, which saves a read). Nothing is cached between requests, so a demotion or a revoked grant applies to the very next request (tested, and a negative check caches the grants and proves the tests notice).
3. `can(role, grantedAreas, area, action)` decides: 401 when nobody is signed in, 403 when not allowed.

`src/auth/permissions.ts` is pure (no I/O): `can`, `levelIn`, `visibleAreas`, `writableAreas`, `visibleMenu`. Never compare role strings or area names elsewhere.

Usage: reads `requireArea("komunikasi", "read")`; changes `requireArea("komunikasi", "write")`; Sistem `requireArea("sistem", ...)`; what has no area and is open to every admin role (the dashboard) `requireAdmin()` (401 without a session, 403 for a student; an editor with no grants passes, and what the route then shows them is limited by `visibleAreas`). A mutation also writes its audit row in the same `db.batch([...])` (one transaction), with the area-appropriate action name.

### API added

| Route | Guard | Notes |
| --- | --- | --- |
| `GET /api/me` | signed in | `{ user, areas: { granted, visible, writable } }`, computed by the same functions as the guards. 401 without a session. |
| `GET /api/admin/announcements`, `POST`, `GET /:id`, `PUT /:id`, `DELETE /:id` | `komunikasi` read / write | The SAKEM-078 sample, now under the area guard and the reference implementation of the admin CRUD convention ([`admin-crud.md`](admin-crud.md)). An editor needs the `komunikasi` grant for the read too. |
| `GET /api/admin/messages`, `GET /counts`, `GET /:id`, `POST /:id/read`, `POST /:id/unread`, `DELETE /:id` | `komunikasi` read / write (the verbs and the delete write) | Pesan, the contact form's inbox (SAKEM-082): no create or edit, a GET never marks a message read, audit rows carry the action and the id only ([`admin-komunikasi.md`](admin-komunikasi.md)). |
| `GET /api/dashboard` | any admin role | Added in SAKEM-082, guarded by `requireAdmin()` (401 / 403 for a student). The items of the areas the caller may see (`pendaftaran`: waiting applicants per status and the batch; `komunikasi`: unread messages), counts and links only. At most three statements in one round trip, none for an area the caller cannot see; plans and rows read are tested (`test/dashboard.test.ts`). |
| `GET /api/admin/users` | `sistem` read | Admin accounts (viewer, editor, super_admin) with their areas. |
| `PUT /api/admin/users/:id/areas` | `sistem` write | Body `{ "areas": ["konten", ...] }` sets the editor's complete list: adds what is missing, removes what is not listed, keeps `granted_by` of the rest, writes one audit row (`admin.update`, resource `admin_user`, metadata `{ field, before, after }`) only if something changed. 404 for an unknown user, **409 `not_editor`** for any other role, 400 for `sistem` or an unknown area, 415 for a body that is not JSON. |

Full user management (create, change role, delete, invite) is a later ticket. Changing a user's role is still done in the database or by that ticket; demoting an editor leaves their grants in place but inert, and promoting them back restores them.

## Migrate and seed

```bash
cd cf/admin
pnpm install --frozen-lockfile
pnpm db:migrate:local      # wrangler d1 migrations apply sakem-admin --local
pnpm db:seed:local         # wipes the local tables, then inserts the sample data
pnpm dev
```

- **If you applied the earlier `0000_init` of SAKEM-078 locally**, delete the local state first (`rm -rf .wrangler/state`) and migrate again. The baseline was regenerated as four per-concern migrations because the spike's migration was never applied to a remote database, which avoids rebuilding `users` (with its dependants) just to add CHECKs.
- The seed fills all 16 tables with fake rows ("Contoh ...", `example.test` addresses): one account per role and editors with different areas (`pendaftaran`, `komunikasi`, `konten`, two areas, none). All accounts share one fake password, the `DEV_PASSWORD` constant in `scripts/seed-data.ts` (`SEED_PASSWORD` overrides it). It opens the local database through wrangler's platform proxy with remote bindings off, so it cannot reach an account; it needs no login. A test runs it in workerd, signs in as each account and checks that no email outside `example.test` is present.
- **Changing the schema:** edit `src/db/schema/*`, run `pnpm db:generate --name <concern>`, commit the SQL and the `meta/` snapshot, run `pnpm db:migrate:local`. `pnpm db:drift` fails when schema and migrations disagree. Applying to a remote database is the deploy ticket's job (`wrangler d1 migrations apply <db> --remote`); it was not run here.
- D1 allows a limited number of bound parameters per statement (documented as 100; not re-checked here), so bulk inserts go one statement per row or in small chunks inside one `db.batch([...])`, as the seed does.

## Free-tier headroom (estimate)

Limits used: D1 Free 5 GB storage in total, 5,000,000 rows read and 100,000 rows written per day; since 2026-09-01 a query fails once the daily limit is exceeded (Cloudflare changelog), so the budget is a hard ceiling, not a bill. D1 counts an index entry as a written row, which is why redundant indexes were dropped. The per-database size cap on Free should be checked on the D1 limits page (I recall 500 MB; not verified here). These are paper estimates for a school-sized site, **not measurements**; real numbers need the deployed Worker (SAKEM-084).

| Table | Rows after about 3 years | Size per row | Total |
| --- | --- | --- | --- |
| `users` + `account` | 3,000 + 3,500 | 0.2 to 0.3 KB | about 1.5 MB |
| `session` (swept by cron) | at most a few thousand live | 0.25 KB | under 1 MB |
| `student_applications` | 900 | 5 to 10 KB (JSON answers) | 5 to 9 MB |
| `blog_posts` | 80 + 150 | 12 to 15 KB (markdown and HTML) | about 3.5 MB |
| `audit_log` | 15,000 | 0.3 KB | about 5 MB |
| `contact_messages` | 600 | 1 KB | under 1 MB |
| everything else (batches, announcements, reports, team, resources, shortlinks, media, grants) | under 1,000 together | under 1 KB | under 1 MB |

About 20 MB after three years including indexes: under 1% of 5 GB. Storage is not the constraint.

Rows **written** per day (the tighter budget; a row = the table row plus one per index, and a text primary key is also an index):

| Event | Rows written | Note |
| --- | --- | --- |
| Sign-up and email verification | about 8 | `users` 4, `account` 3, the verified flag 1 (verification links are signed tokens, not stored) |
| Sign-in | about 4 | a `session` row with its 3 index entries |
| Application submitted | about 15 | the row 7 (table, primary key, 5 indexes) plus its audit row 8 |
| Admin save (any area) | about 9 to 13 | the change plus its audit row (8) |
| Shortlink click | 1 | `click_count` update, one row |
| Contact form | about 13 | the message 5 (table, primary key, 3 indexes) plus its audit row 8 |

A typical day (a few dozen sign-ins, 20 admin actions) is under 1,000 writes; an admission-season peak (500 sign-ups in a day) is about 10,000, a tenth of the budget. **The one unbounded writer is the shortlink counter**: one write per click, so a viral link (100,000 clicks a day) would use the whole budget. **Decided (Dzul, 2026-10-12): every click is counted, without a limit, one write per click**, in `waitUntil` after the redirect is answered, so a failing or exhausted write never fails or delays the redirect. The risk he accepted: one viral link can spend the day's 100,000 writes, after which every write (admin sign-in, a contact message) fails until 00:00 UTC while the redirects keep working. The arithmetic (1 row written and at most 3 read per click; the Worker's own 100,000 requests a day is the same wall) and the fallbacks he named (a per-link cap of 2,000 clicks a day, or no counting) are in [`admin-konten.md`](admin-konten.md#7-d1-and-request-budget); SAKEM-084 watches rows written per day.

Rows **read** per day: an authenticated admin request reads about 4 to 10 rows (session, user, an editor's grants); the dashboard adds, in one round trip, about two rows per application still waiting for a decision (an index entry and the row, to read its batch), one per unread message and up to nine for the three newest batches (an index entry, the row and the first application's entry for each), so about 140 at the peak of a review season (60 waiting, 12 unread) and a handful the rest of the year, whatever the history (measured with the local D1's `meta.rows_read`; the real D1 is only confirmed on the deployed Worker, SAKEM-084). Public list endpoints are the cost: `team`, `reports`, `resources` up to about 50 rows each, a blog page about 100 to 200 (index range plus the page and the count), a blog article similar for the related ones. Uncached, one page view is on the order of 300 rows; at 5,000,000 a day that is about 16,000 uncached page views. The 60 s edge cache in the content contract is what keeps real traffic far below that (a few thousand page views a day cost about 1,000,000 rows uncached, and much less cached). Reading the list columns without `content_html` and `content_markdown` keeps each row small; the article endpoint is the only reader of the two body columns.

## Open decisions for Dzul

1. ~~Do editors see the menus of areas they cannot change?~~ **Decided 2026-10-12: no.** An editor sees and changes only the areas granted to them (see Permission model).
2. **Aktivitas for super_admin only.** Applied as decided; the older IA proposal had it for every role. Say so if viewers and editors should see their own activity.
3. **`lastLoginAt` was dropped.** Derive it from the latest session, or add a column written by a Better Auth session hook in the auth ticket.
4. **`student_applications.batch_id` and `email` are NOT NULL** and a `file` resource requires `file_size`, because the legacy exceptions existed only for historic rows. Revert one of them if you plan to import such rows.
5. ~~**Shortlink click counting** needs a plan before the shortlink API ships.~~ **Decided 2026-10-12: unlimited, one write per click, after the answer** (see headroom and [`admin-konten.md`](admin-konten.md#6-the-redirect)).
