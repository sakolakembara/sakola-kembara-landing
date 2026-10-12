# Aktivitas and Pengaturan: the Sistem group of the new admin

How the two screens of the **Sistem** menu group work in the new admin (`cf/admin`): **Aktivitas** (the audit log, read-only) and **Pengaturan** (the admins: who they are, their role, the areas of an editor, who may sign in). Ticket: SAKEM-082 (M3, the Sistem worker). Read [`admin-crud.md`](admin-crud.md) first: both screens are built from its kit, and this page only says where they differ from it and why. **Nothing here was looked at in a browser** (see [What is not verified](#what-is-not-verified)).

Related: [`admin-ia.md`](admin-ia.md) (the menu), [`d1-schema.md`](d1-schema.md) (the permission model, `audit_log`), [`auth.md`](auth.md) (the admin-user endpoints this page builds on, the 365-day retention), [`admin-crud.md`](admin-crud.md).

## Contents

1. [Who may use it](#1-who-may-use-it)
2. [What is ported from the legacy admin, and what is not](#2-what-is-ported-from-the-legacy-admin-and-what-is-not)
3. [Aktivitas](#3-aktivitas)
4. [Pengaturan](#4-pengaturan)
5. [The mock](#5-the-mock)
6. [Tests and negative checks](#6-tests-and-negative-checks)
7. [What is not verified](#what-is-not-verified)
8. [Open decisions](#open-decisions)

## 1. Who may use it

**A super_admin, and nobody else** (decided by Dzul, SAKEM-081 and SAKEM-082, 2026-10-12). Both screens are the area `sistem`, which cannot be granted: `levelIn` gives it to a super_admin only (`src/auth/permissions.ts`).

| Caller | The menu | The page | The API |
| --- | --- | --- | --- |
| not signed in | n/a | redirected to the sign-in | 401 |
| student | n/a | no admin access | 403 |
| viewer | no Sistem group | the 403 page (`RequireSection`) | 403 |
| editor, with any areas or none | no Sistem group | the 403 page | 403 |
| super_admin | Aktivitas, Pengaturan | the screen | 200 |

Every endpoint below sits behind `requireArea("sistem", ...)`; `test/audit-viewer.test.ts` and `test/sistem-users.test.ts` call every route as each of the four callers and as nobody. The SPA hides what the server would refuse (`accessTo`, `lib/nav.ts`), never the reverse. A refused caller costs no read of the audit table or of the admin list (a test counts the statements).

## 2. What is ported from the legacy admin, and what is not

Source: `app/(admin)/admin/audit/page.tsx`, `app/(admin)/admin/settings/**`, `lib/audit-labels.ts`, `lib/admin-users-service.ts`. The Indonesian wording is the legacy one wherever the behaviour is.

| Legacy | New | Why it differs |
| --- | --- | --- |
| Aktivitas: filters Aksi, Tipe resource, Aktor (email), Dari, Sampai; 50 per page; columns Waktu, Aksi, Aktor, Resource, Detail; "Buka" link per row; Metadata disclosure; "Total N entri"; page numbers | Same filters, columns, page size and links. **No total and no page numbers**: "Berikutnya" and the browser's Back button, over a cursor | The table grows for 365 days. A total is `count(*)` over every row that matches; page 40 is an offset that reads 2,000 rows to skip them. The cursor reads the page and nothing else ([3.2](#32-the-cursor)) |
| Aktor: a substring of the email (`ilike '%x%'`) | The **whole** email address, exactly (any case) | A substring cannot use an index and reads the table. The address is shown in every row and in Pengaturan, so it can be copied |
| Dari and Sampai: the server's own clock | Whole days in **WIB** (UTC+7) | The Worker runs in UTC; every admin of this school reads the page in WIB. The legacy rule was never written down |
| Aksi: every key of the label table, including the "(lama)" names | The actions the Worker can write today (45); rows with any other name are still shown, with their legacy label | A filter nobody can produce a row for is noise. Old rows keep their words ([3.4](#34-labels)) |
| Metadata: the whole JSON | Only the keys an **allow-list** names ([3.3](#33-what-a-row-shows)) | The audit table holds applicants' addresses and, in the legacy admin, review notes; this screen must not become a way to read them by accident |
| Pengaturan: Email, Nama, Peran, Login Terakhir; Edit and Hapus | Email (with "Anda"), Nama, Peran (with the areas of an editor), Status, **Sesi Aktif**; Edit, Kirim ulang undangan, Nonaktifkan or Aktifkan lagi | Admins are invited and **deactivated, never deleted** (the audit trail keeps pointing at a real row); editors have areas ([`auth.md`](auth.md#admin-users)) |
| Pengaturan: create with an optional password | Same field. Empty means an **invitation by email** (a link, 7 days, the admin chooses their password); filled means the admin must open the verification email first | Nothing is verified on the super_admin's word: a typo in an address must not hand out an admin account |
| Pengaturan: edit name, role **and a new password** | Edit name, role and, for an editor, the areas. **No password field** | A super_admin does not set another person's password. An admin who forgot theirs uses "Lupa password", which works for every account ([`auth.md`](auth.md#flows)); a pending invitation is sent again from the list. If Dzul wants the legacy behaviour, it is one endpoint and a field: see [Open decisions](#open-decisions) |
| Pengaturan: the last super_admin cannot be deleted or demoted; nobody deletes themselves | Same, for **deactivation** and demotion, "the last" meaning the last one **who can sign in** (an unopened invitation is not one; SAKEM-087), and the screen shows the refusal in the legacy words | [4.5](#45-the-last-super_admin-who-can-sign-in) |
| Pengaturan: a read-only list for other roles | Not shown to them at all | The decision above |
| Role hints under each role card | Rewritten for the permission model: an editor has areas, a viewer reads everything except Sistem | The legacy hints ("Hanya dapat membaca dashboard") describe a model that no longer exists |
| An admin email allow-list, or anything like it, on the settings page | **There was none to port.** The legacy admin only had `SEED_SUPER_ADMIN_EMAIL` (`lib/env.ts`), which seeds the first super_admin of an empty database, outside the page | Pengaturan needs a super_admin to exist. On a fresh D1 the owner creates the first one with `pnpm first-admin` (SAKEM-087): [`first-super-admin.md`](first-super-admin.md). `pnpm db:seed:local` does it for local runs |

## 3. Aktivitas

### 3.1 The endpoint

`GET /api/admin/audit`, the one route, read-only (`POST`, `PUT`, `PATCH` and `DELETE` are the JSON 404; a test sends each and counts the rows). Code: `src/api/audit.ts`, the query in `src/audit/query.ts`.

| Parameter | Rule |
| --- | --- |
| `pageSize` | 1 to 100, **default 50** (the legacy page size); anything else is 50, a larger number is 100 |
| `cursor` | what `nextCursor` of the previous answer said; malformed is `400 invalid_query` with `param: "cursor"` |
| `action` | one of the declared actions, exactly; anything else is `400 invalid_query` |
| `resource` | one of the declared resource types, exactly; anything else is `400 invalid_query` |
| `actor` | an email address, exactly; trimmed and lower-cased (the column holds lower case); over 254 characters is `400 invalid_query` |
| `from`, `to` | a day, `YYYY-MM-DD`, from 2000 to 2100 and a real date (`2026-02-30` is refused); the whole day in WIB: `from` starts at 00:00:00.000, `to` ends at 23:59:59.999. A range that ends before it starts is simply empty (`200`) |

An empty value means no filter. A wrong value is refused rather than ignored, as everywhere in [the kit](admin-crud.md#3-lists-page-pagesize-q-filters-sort): an ignored filter shows the wrong list. Other parameters are ignored (`page` and `sort` do not exist here).

The answer: `{ items, pageSize, nextCursor }`. No `page`, no `total` (the one deviation from the list envelope of the kit). An item:

```json
{ "id": "…", "createdAt": "2026-10-12T03:15:00.000Z", "action": "announcement.update",
  "actorEmail": "dewi@…", "actorName": "Dewi Pengurus",
  "resourceType": "announcement", "resourceId": "…",
  "details": { "fields": ["title"], "label": "Pendaftaran dibuka" } }
```

`actorName` is the name of an **admin** only (the join has the admin roles in its condition, so a student's or a visitor's name is never read); it is null for anyone else and for an actor that no longer exists. `details` is null when there is nothing the allow-list lets through.

### 3.2 The cursor

The list is ordered `created_at desc, id desc`. A page ends at the last row it showed, and the cursor is that row's position, `(created_at, id)`:

```sql
select … from audit_log
where (created_at, id) < (:createdAt, :id)      -- strictly after the last row shown
order by created_at desc, id desc
limit :pageSize + 1                             -- one more: is there a next page, without counting
```

- **Nothing is counted and no row is skipped**, so a page costs the same on any table size ([3.5](#35-query-plans-and-rows-read)).
- **Equal timestamps:** `id` is part of the order and of the cursor, so two rows written in the same millisecond are told apart and none is lost or repeated at a page boundary. Tests walk a log of ten rows in one millisecond with pages of three, a log with groups of one to five equal timestamps with seven page sizes, and 237 pseudo-random rows with many ties, and compare the walk with SQL's own order.
- **Rows written while someone reads** are newer, so they shift nothing; **rows the retention job deletes** do not break a walk, and the cursor of a row that has been deleted still continues from where it was.
- **The row-value comparison is deliberate.** `(created_at, id) < (?, ?)` lets SQLite seek in the `(created_at, id)` index; the same condition written with `OR` is correct and reads the whole table (measured: 19,835 rows read for one page of a 20,000-row log).
- **The cursor is opaque and not a secret**: base64url of `[createdAt, id]`, which the caller could already read. It is checked strictly (length, characters, shape, integer time in range, id of 1 to 64 characters), so a made-up one is a `400` and reaches SQL only as two bound values.
- **In the SPA** the filters and the cursor are in the address bar (`/audit?action=blog.create&cursor=…`). "Berikutnya" is a link, the browser's Back button is "Sebelumnya", "Kembali ke yang terbaru" drops the cursor, and applying a filter drops it too (a filter changes what the list is). There is no "page 7" and no "of 1,204 entries".

### 3.3 What a row shows

`details` is the stored `metadata` through an **allow-list** (`src/audit/present.ts`): a key leaves the Worker only if it is in the table for that action, with a value of the expected kind; everything else is dropped, whoever wrote it. A new area that stores a new key shows nothing of it until someone adds it here on purpose, and one that stores personal data under a key of its own (a review note, a message text) cannot leak it through this page by accident.

| Actions | Keys shown |
| --- | --- |
| every action | `fields` (column names: letters, digits, underscore; a list with one element that is not a name is dropped whole), `label` (text of 1 to 120 characters; the kit says it is never personal) |
| `admin.*` | also `email` (the admin the change was about), `role`, `mode`, `roleFrom`, `roleTo`, `nameChanged`, `areasRemoved`, `areasBefore`, `areasAfter`, `field`, `before`, `after` (area names only) |
| `upload.*` | also `kind`, `contentType`, `size`, `width`, `height`; **never `path`** (the file's name can be a person's) |
| `student.register` | also `via` (`email` or `google`) |

`email` is shown for `admin.*` rows only; on any other action an `email` key is dropped. The **actor's** email (the column, not the metadata) is shown for every row: this page is for super_admins, and the row says who did it. Nothing about an applicant is shown beyond what the audit row itself holds.

### 3.4 Labels

`activityLabel` and `resourceLabel` (`spa/src/lib/audit.ts`) use the legacy table as it is (`lib/audit-labels.ts` at the repo root) and add what the new Worker introduced:

| Action or type | Label |
| --- | --- |
| `upload.create`, `upload.delete` | Berkas diunggah, Berkas unggahan dihapus |
| `admin.deactivate`, `admin.reactivate`, `admin.invite_resend` | Admin dinonaktifkan, Admin diaktifkan kembali, Undangan admin dikirim ulang |
| `batch.delete`, `contact_message.create`, `contact_message.update` | Batch dihapus, Pesan dibuat, Pesan diubah (declared by the kit's three verbs; the first two never happen today) |
| resource type `media` | Berkas unggahan |

**No action can reach the page without words.** The Worker declares every action and resource type it can write as a TypeScript union (`src/db/audit.ts`); `src/audit/lists.ts` writes them out as data and `src/audit/declared.ts` has the compiler check the lists against the unions in both directions. An area that adds an action (`blog.publish`, say) cannot get past `pnpm typecheck` until it is in the list, and `spa/test/audit-labels.test.ts` then fails until the action has a label (and until no two actions share one: the select would show two identical lines). The SPA keeps its own copies of the two lists for the selects (`FILTER_ACTIONS`, `FILTER_RESOURCE_TYPES`); the same test fails when they differ from the Worker's.

**Rows with a name that is not declared** (the legacy `admin.delete`, `blog.upload_image`, the "(lama)" names) are shown with their legacy label, or as they are; they cannot be filtered for. The audit table is free text on purpose.

**Pusat Dokumen:** the legacy label for `resource.*` and the type `site_resource` is still "Berkas pendaftaran" / "Berkas Pendaftaran"; the menu is now called "Pusat Dokumen" (admin-ia.md). Rename them? See [Open decisions](#open-decisions).

### 3.5 Query plans and rows read

Measured on a local D1 (`meta.rows_read`) with a log of 20,000 rows (60% by five admins, the rest by 3,000 one-off actors, a rare action of 20 rows, a rare resource type, many equal timestamps). Real D1 numbers are SAKEM-084.

**Before the migration** (the indexes of the first schema: `actor_id`, `created_at`, `(resource_type, resource_id)`):

| Page of 51 | Plan | Rows read |
| --- | --- | --- |
| newest first | ordered walk of `created_at` + a sort for the `id` tie-break | 103 |
| after a cursor (row value) | `created_at<?` + the same sort | 103 |
| a day range | `created_at` range | 103 |
| one action | **`SCAN`** + sort | 20,020 (rare) to 22,855 |
| one actor's email | **`SCAN`** + sort | 20,001 to 22,000 |
| one resource type | `(resource_type=?)` + sort of every row of that type | 41 (rare) to 17,125 |
| an actor and a resource type | resource index + sort | 8,564 |

**After** `0007_audit_viewer_indexes`:

| Page of 51 | Plan | Rows read |
| --- | --- | --- |
| newest first | `SCAN audit_log USING INDEX audit_log_created_at_id_idx` (an ordered walk under a `LIMIT`) | 51 |
| after a cursor | `SEARCH … USING INDEX audit_log_created_at_id_idx ((created_at,id)<(?,?))` | 52 |
| a day range | `SEARCH … (created_at>? AND created_at<?)` | 51 |
| one action | `SEARCH … USING INDEX audit_log_action_created_idx (action=?)` | 51 (21 for the 20 rows of a rare one) |
| one resource type | `SEARCH … audit_log_resource_type_created_idx (resource_type=?)` | 51 (21 rare) |
| one actor's email | `SEARCH … audit_log_actor_email_created_idx (actor_email=?)` | 51 (8 for an actor with 7 rows) |
| an action in a day range | `SEARCH … (action=? AND created_at>? AND created_at<?)` | 21 |
| **two filters of two indexes** (an actor and a resource type; all five) | the index of one of them, the other tested row by row | 355; 852 (an actor with 2,000 rows and a rare resource type: 2,001) |

No page sorts (`USE TEMP B-TREE` appears in none of the plans, a test fails on it) and none scans the table (a test fails on a bare `SCAN audit_log`). One filter costs the page; **two filters cost at most the rows of the more selective key**, never the table. Every page adds one primary-key lookup in `users` per row for the admin's name: measured 102 rows read for 51 rows with an admin actor. The whole request is one statement on the log in one round trip (counted by a spy on the binding).

**Migration `0007_audit_viewer_indexes`** (the first migration of this work; numbering collides with parallel workers, the PM renumbers on rebase): drops `audit_log_created_at_idx`, adds `(created_at, id)`, `(action, created_at, id)`, `(resource_type, created_at, id)` and `(actor_email, created_at, id)`. `audit_log_actor_idx` stays (the foreign key's lookup when a user is deleted) and so does `(resource_type, resource_id)`. The cost is on the write side: **an audit row now writes 8 D1 rows instead of 5** (the table, the `id` autoindex and six indexes), so the admin-save, application and contact-form rows of the [`d1-schema.md` budget](d1-schema.md#free-tier-headroom-estimate) go up by 3. At school scale that is nothing against 100,000 a day (20 saves a day is 60 more rows). The retention job's range delete (`created_at < ?`) seeks the new index the same way (same leading column).

## 4. Pengaturan

### 4.1 Endpoints

All under `/api/admin/users`, all `requireArea("sistem", ...)`. The first six existed (SAKEM-081, [`auth.md`](auth.md#admin-users)); this work **added** the rest and made the list and the errors follow [the convention](admin-crud.md), without changing what the first ones answered (their tests, `test/admin-users.test.ts` and `test/areas.test.ts`, are untouched and green).

| Method and path | Does | Status |
| --- | --- | --- |
| `GET /` | the list: `{ items, page, pageSize, total }` (and `users`, the same array, for callers written before) | **changed**: query, envelope |
| `GET /:id` | one admin, `{ item }` and an `ETag` | new |
| `POST /` | create or invite; `areas` for a new editor | **extended** |
| `PUT /:id` | the whole edit form, `If-Match` required | new |
| `PATCH /:id` | role and name | unchanged (kept for scripts and tests) |
| `PUT /:id/areas` | the areas of an editor | unchanged |
| `POST /:id/deactivate`, `/reactivate`, `/resend-invite` | state changes | unchanged |

### 4.2 The list

`GET /api/admin/users?page=&pageSize=&sort=&role=&status=&q=`: `sort` is `email` (default), `name`, `role` or `createdAt`, with `-` for descending and `id` as the last tie-breaker; `role` is `super_admin`, `editor` or `viewer`; `status` is `active`, `invited` or `deactivated`; a value the filter does not know is `400 invalid_query`. **`q` is the beginning of an email address** ("rom" finds `rommy@…`): a range on the unique email index, `email >= 'rom' and email < 'ron'`, so it needs no `LIKE` and reads only matching rows. It is not a substring (`ommy` finds nothing) and `%` and `_` mean themselves. Page size is 50 by default (a school has a handful of admins: one page), at most 100.

An item: `id`, `name`, `email`, `role`, `areas` (an editor's, in menu order; always `[]` for other roles even if stray rows exist), `status`, `emailVerified`, `deactivatedAt`, `lastSessionAt`, `createdAt`, `updatedAt` (the version for `If-Match`).

- **`status`**: `invited` = created by invitation and never accepted (no way to sign in yet), `active` = has a way to sign in (a password or a linked Google account), `deactivated` over both.
- **`lastSessionAt`** answers "last session if the data allows without a new column": the start of the **newest session that has not expired**, null when there is none. It is **not a login history**: Better Auth deletes a session at sign-out and the cron job at expiry (7 days), so an admin who signed in yesterday and signed out shows nothing. The screen labels the column "Sesi Aktif" ("Sejak 12 Okt 2026, 09.15" or "Tidak ada") so it does not claim more. The legacy "Login Terakhir" needs a column written by a session hook (still open, [`d1-schema.md`](d1-schema.md#open-decisions-for-dzul) item 3).
- **Cost**: one round trip of two statements (the page and the count); the areas, the account and the session are correlated subselects on indexes. Measured **9 rows read for 5 admins, the same with 20 or with 3,000 students** (the plan seeks `users_role_idx` for the three admin roles, with or without an email prefix; a test counts both and fails on a scan of `users`).

### 4.3 The edit form: one `PUT`

`PUT /api/admin/users/:id` with `{ name, role, areas }` and `If-Match: "<updatedAt>"`. What the form shows is what it saves, in **one transaction**: the grants that go, the grants that come, the account's name and role, and **one** `admin.update` audit row (with `roleFrom` and `roleTo`, `nameChanged`, and `areasBefore` and `areasAfter` for what changed).

- Order of the checks, as in the kit: the guard, `If-Match` (428), the body (415, 413, 400 with `fields`), the read (404), the version (409 `stale`), nothing changed (200 and no write), the last super_admin (409), the transaction.
- **Lost updates are caught twice.** The version is compared on the row that was read, and again **inside** the transaction: the account's `UPDATE ... WHERE id = ? AND updated_at = ?` and, because the grants run before it, each grant statement is made conditional on the same version. A save that lost the race changes nothing at all (not the role, not the grants, no audit row) and answers `409 stale`. A test fires three saves of one version at once: one `200`, two `409`, and the grants are exactly the winner's.
- `areas` is the complete list for an editor and must be empty for any other role (`400`, field `areas`: "Area hanya untuk peran Editor."; `sistem` is "Area tidak dikenal"). Changing role away from editor removes the grants in the same transaction; making a viewer an editor replaces the viewer's old stray grant rows (the permission model ignores them, a change of role must not revive them).
- The body is limited to 8 KiB (nothing else is in it).
- The SPA sends exactly this; after a save the form is mounted again with the answer's `updatedAt`, so the next save carries the new version.

**Create** (`POST`) takes `areas` for a new editor, saved with the account in the same transaction (an editor is never seen without the areas they were given); the audit row gets `areasAfter`. `areas` for any other role is `400`.

### 4.4 Deviations of the first endpoints from the convention, and what was done

| Deviation | Done |
| --- | --- |
| the list was `{ users: [...] }`, all admins, no query | the envelope and the query were **added**; `users` stays as an alias of `items` |
| single admin was `{ user }` | the new `GET /:id` and `PUT /:id` answer `{ item }`; `POST` answers both `item` and `user`; `PATCH`, `PUT /:id/areas` and the verbs still answer what they did (their tests compare the exact bodies) |
| a 400 was `{ error, fieldErrors: { name: string[] } }` | **added** `message` and `fields` (`{ name: string }`); `fieldErrors` stays. The 409 `email_taken` got `fields` too |
| `PATCH` for a change of role (the convention has no `PATCH`) | kept; the form uses `PUT /:id`. Both write the same audit action |
| the 409s of the verbs and of `PATCH` (`last_super_admin`, `cannot_deactivate_self`, `not_pending_invite`) are `{ error, message }` | unchanged: they already have a `message` the SPA shows; the new `PUT` answers `last_super_admin` with `fields.role` as well |
| ids are not checked for length | `GET /:id` and `PUT /:id` answer `404` for an id over 128 characters without reading D1, like the kit |

### 4.5 The last super_admin who can sign in

The rule and why it counts who it counts: [`auth.md`](auth.md#the-last-super_admin). In short, a super_admin counts when their account is not deactivated, their address is verified and they have an account (a password or a linked Google account); an **invitation nobody has opened does not count** (SAKEM-087, migration `0010`).

Layers, from the screen down:

1. **The screen.** Your own row has no "Nonaktifkan" (a greyed word with "Tidak dapat menonaktifkan akun sendiri"). For the rest, the Worker's answer is shown as it is: in the deactivate dialog the sentence "Tidak dapat menonaktifkan super admin terakhir. Tambah super admin lain terlebih dahulu." appears inside the dialog and only "Tutup" is left (asking again would get the same answer); in the edit form the legacy message "Tidak dapat menurunkan peran super admin terakhir. Tambah super admin lain terlebih dahulu." heads the error summary and "Minimal satu super admin harus tersedia" is on the role (in the summary and under the role cards), with the form keeping what was typed.
2. **The API**, from one read of the view `signable_super_admins`: `409 last_super_admin` before anything is written (and `409 cannot_deactivate_self` for yourself).
3. **The database**: the trigger of migration `0010` (it replaced the one of `0006`) aborts any `UPDATE` of `role` or `deactivated_at` that would leave no super_admin who can sign in, inside the same transaction. Through HTTP the only way to reach it is a race: two super_admins stepping down (or deactivating each other) at the same moment, one `200`, one `409`, one stays (tested for the edit form, for `PATCH` and for deactivate, with an unopened invitation waiting as the tempting third).

What changed in practice: with one super_admin who can sign in and an invitation waiting, the one who can sign in is refused, so Pengaturan stays reachable. The invitation counts from the moment it is accepted (the link opened, a password chosen), and a super_admin who is created with a password counts once the verification email is confirmed. Demoting or deactivating someone who cannot sign in anyway is allowed: it takes nobody away.

### 4.6 The screens

- **List** (`/settings`): the legacy table with the changes of [section 2](#2-what-is-ported-from-the-legacy-admin-and-what-is-not). The filter bar is the kit's: "Cari" (the beginning of an address), Peran, Status, in the address bar. Row actions: "Edit"; "Kirim ulang undangan" for an invitation (one press, no question, locked against a double click; a `502 email_failed` or the quota is shown as an error, never as "sent"); "Nonaktifkan" (a question that names the admin and says what happens, with the safe button focused) or "Aktifkan lagi" (names the role they come back with and says the old sessions are not restored).
- **Form** (`/settings/new` and `/settings/:id/edit`, the address the Aktivitas rows link to): sections Identitas, Peran (three cards with their hints), Area (three checkboxes with the menus each opens, only while the role is Editor; "Sistem tidak bisa diberikan"). The email cannot be changed after creation (legacy hint kept). After a create the page opens the edit form with "Admin berhasil dibuat." and where the email went; if the account was made but the email did not go out (`502`), the person goes to the list with the Worker's sentence, where "Kirim ulang undangan" is. An editor with no area at all is allowed (they see the Dashboard and, there, "Akunmu belum punya akses ke area mana pun"); the form says "editor hanya akan melihat Dashboard".
- The confirm button of "Nonaktifkan" is the kit's **red** (danger) one, since SAKEM-087: it ends a person's sessions and their way in at once, even though it can be undone. "Aktifkan kembali" keeps the primary (blue) button: it gives something back. (They were both blue before; the kit's red-for-final reading was too narrow for this one.)

## 5. The mock

`pnpm dev:spa:mock` (in `cf/admin`), persona `super_admin` (the default; `?mock=editor` or `viewer` show no Sistem and the 403 page). The generic resource store of the kit cannot do verb routes or a list with a cursor, so the mock gets a second extension point: **`spa/src/mock/handlers/<name>.ts`**, a `default` export of a `MockHandler` (`mock/handlers.ts`, picked up with `import.meta.glob` like `mock/resources/`, one two-line hook in `mock/transport.ts`). `mock/handlers/sistem.ts` is the worked one: Aktivitas over 130 invented rows (two to a millisecond, so the cursor has ties; three pages of 50; a row with a legacy name), and Pengaturan with six admins in every state. It uses the Worker's own `cursor.ts` and `present.ts`, so the pages, the day filters and the projection of a row are the real ones, and the rules of the form (versions, last super_admin, areas) are written as the Worker answers them. An admin made, changed or deactivated in the mock shows up in Aktivitas at once. The only super_admin in the seed is you: try editing your own role to see the last-super_admin refusal. An invitation does not change that (it cannot sign in); an address that starts with `sudah-masuk@` is created as an admin who has already accepted, so make a second super_admin with one and try again. A new admin's email can end in a name that plays up: `email-gagal@…` (created, but the invitation fails: 502) and `email-tidak-tersedia@…` (503, nothing made). Nothing leaves memory. `scripts/check-spa-bundle.mjs` still fails the build check if the mock is in it.

## 6. Tests and negative checks

Worker (`cf/admin/test/`, workerd and a real local D1):

- `audit-viewer.test.ts` (57): the role matrix and the refusal costing no read; order, cursor and equal timestamps (the walks above, a row written or deleted between pages); every malformed cursor; every filter alone and combined, the actor exactly, WIB days at the last millisecond, every refusal; every declared action and type accepted; the row's fields; the admin's name and nobody else's; the allow-list key by key and through the API with planted secrets; the audit rows the API itself writes; plans in words and rows read at 2,000 and at 20,000 rows; the cost of the whole request.
- `last-super-admin.test.ts` (SAKEM-087): who counts as a super_admin who can sign in (each way of not being one, the view, the database and the API agreeing on each), the sole one with an invitation waiting refused through `PATCH` and the edit form (and the API not even trying a write), an invitation counting from the moment it is accepted, a password-created one counting once verified, Google-only counting, deactivated not counting, the race through all three routes with an invitation as the tempting third, and someone who cannot sign in anyway being free to demote.
- `sistem-users.test.ts` (44): every route as every caller; the list (envelope, filters, sort, pages, the email prefix, status, last session); one admin and its `ETag`; the edit form (viewer to editor, editor to viewer, stray grants, areas kept with who granted them, name only, no change, 428, 409 stale in four shapes, three saves at once, every field error, 415 and 413); the last super_admin through HTTP (sole, with a second, two at once, never yourself); create with areas; grants taking effect on the next request (revoke, grant, demote, promote to super_admin, deactivate and reactivate); every Pengaturan change in Aktivitas as the super_admin who made it, with no password and no link; the life of an invited editor from the email to deactivation; rows read independent of the number of students.
- The earlier suites for these endpoints (`admin-users`, `areas`, `spa-contract`) pass unchanged.

SPA (`cf/admin/spa/test/`, jsdom):

- `audit-labels.test.ts`: **every declared action and resource type has a label**, no two share one, the filter lists equal the Worker's, the legacy words are kept.
- `audit-page.test.tsx`: the 403 page and the missing menu for every other role, the table, the filters and the address bar, the cursor (the link, the way back, the rows of the page before staying while the next loads), the empty, loading and failed states, a hand-edited address.
- `settings.test.tsx`: the list, every row action, the deactivate dialog with every answer (the last super_admin included), reactivate, resend, the create form (invitation, password, errors, 409, 502, 503), the edit form (the whole body, `If-Match`, the next version, stale, the last super_admin, not found).
- `sistem-mock.test.ts`: the mock answers as the Worker does.
- `routes.test.tsx` (existing) had two placeholder expectations for `/audit` and `/settings`: they now describe the real pages. Nothing was weakened.

Negative checks (each breaks one safeguard, the tests must fail, the file is restored): `scripts/negative-checks-sistem.mjs` (25 Worker checks before SAKEM-087, which added thirteen named `last-super-admin:` (the view without each of its three conditions, the trigger asking the old question or guarding a row that cannot sign in, the API's read in three ways, the first-admin SQL in five); the super_admin guard on Aktivitas and on Pengaturan, the cursor's tie-break and its order, the `OR` form, the page-size ceiling, the declared-action filter, WIB days, the migration's index, the allow-list in two ways, the admin-only name, the admin list's role filter, the email prefix, expired sessions, `If-Match` required, the version compared in the read and in the transaction, the grants' version guard, the audit row written for a lost save, stray grants, the last super_admin in two shapes) and `scripts/negative-checks-spa-sistem.mjs` (22 SPA checks before SAKEM-087, which added three: the deactivate confirm blue again, the reactivate confirm red, the mock counting an invitation; a missing label for an action and for a type, the filter list, the menu entries of Sistem, the 403 page, the cursor link, a filter keeping the cursor, a hand-edited address, the last-super_admin messages in the dialog and in the form, `If-Match`, the unsaved-changes guard after a 502, deactivating yourself, a double click on resend, areas for a non-editor, an empty password sent, and three rules of the mock). Both are spread into the existing runners (`pnpm test:negative`, `pnpm test:negative:spa`), one import and one line each.

## What is not verified

- **Anything visual or in a browser** (no browser was opened, as instructed): the look of both screens, the table at phone width, the filter row at 1,024 px (six columns), the native `<dialog>` for the deactivate and reactivate questions, focus after "Berikutnya", the date inputs, the role and area cards, `pnpm dev:spa:mock` itself.
- **Real D1**: every number of rows read is the local D1's `meta.rows_read`. The plans are SQLite's, the same engine, but D1's row counting and the real table size (365 days of a real school) are SAKEM-084. CPU per request is not measurable locally; nothing here is heavy (one query, a small projection per row), but the PBKDF2 hash of a new admin's first password costs what sign-in costs (8 ms of wall time here) on the Free plan's 10 ms.
- **Email**: an invitation, a resend and a verification email were checked against the in-memory mailbox, never against Resend. The 502 and 503 paths use the fake provider of the tests.
- The migration was applied to an empty local D1 and to a seeded one in the tests; it was not applied to a remote database (no account was used).
- A **time zone other than WIB**: the SPA shows times in the browser's zone (as the legacy page did) and the day filters mean WIB; a browser elsewhere sees `from=2026-10-01` start at 00:00 WIB.

## Open decisions

For Dzul, in order of weight.

1. ~~**The last super_admin guard counts an unaccepted invitation as active.**~~ **Done (SAKEM-087):** only a super_admin who can sign in counts, in the API, the trigger and the mock; [4.5](#45-the-last-super_admin-who-can-sign-in). One leftover for Dzul: the **Status** tag says "Aktif" for anyone with an account, including an admin created with a password whose verification email is still unopened, who cannot sign in yet and so does not count as "another" super_admin. Should that state read "Diundang" (and offer "Kirim ulang undangan") until the address is verified? It is a label and a filter, not the rule; left alone so no existing contract moved.
2. **No password reset by a super_admin.** The legacy edit form could set another admin's password. Not ported on purpose (the admin uses "Lupa password"; a pending invitation is sent again). If you want it, say so: it is a new endpoint, a field and an audit row, and a super_admin knowing another person's password is the thing the invitation flow avoided.
3. **Aktivitas filters by the whole email, not a substring**, and shows no total. A prefix match (`actor=rom`) would cost a sort of the matching rows; say if the whole-address rule is too strict in daily use.
4. **"Sesi Aktif" is not "Login Terakhir"** ([4.2](#42-the-list)). Showing the real last sign-in needs a column and a Better Auth hook (open since SAKEM-081).
5. **Migration `0007` makes an audit row cost 8 D1 rows instead of 5.** The alternative (no indexes) turns every filter into a scan of the log, and the log grows for a year. Agree?
6. **The label of the Pusat Dokumen rows** is still the legacy "Berkas pendaftaran" ([3.4](#34-labels)); rename to "Pusat Dokumen"?
7. **Role card wording** was rewritten for the new permission model (the legacy hints were wrong now), and "Diundang", "Nonaktif", "Sesi Aktif", "Kirim ulang undangan", "Aktifkan lagi" are new words: check them against the tone.
8. ~~**The confirm button for deactivate and reactivate is blue**, not red.~~ **Done (SAKEM-087):** "Nonaktifkan" is red, "Aktifkan kembali" stays primary ([4.6](#46-the-screens)).
9. **Days in WIB** for the Aktivitas filters ([2](#2-what-is-ported-from-the-legacy-admin-and-what-is-not)).
10. ~~**The first super_admin of a fresh production database** has no documented path.~~ **Done (SAKEM-087):** [`first-super-admin.md`](first-super-admin.md) and `pnpm first-admin`. Not run against a real database (no account was used); the owner runs it in the deploy ticket (SAKEM-084).
