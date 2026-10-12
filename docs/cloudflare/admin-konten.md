# Konten Situs: Laporan, Tim and Shortlink (admin screens and the redirect)

The three menus of the area `konten` that are not the blog, ported from the legacy admin onto the CRUD kit ([`admin-crud.md`](admin-crud.md)), and the public redirect for short links. Tickets: SAKEM-082 (the admin: API and screens), SAKEM-081 (the lookup on the internal face of the API Worker), SAKEM-080 (the redirect route of the public site). The Blog menu is another worker's and is not described here.

Read [`admin-crud.md`](admin-crud.md) first: envelopes, errors, `If-Match`, audit rows, purge and upload cleanup are all as it says, and this page only records what is specific to these three menus. The look and the Indonesian copy are the legacy admin's (`app/(admin)/admin/{reports,team,shortlinks}`), unchanged; no new component and no new library.

## Contents

1. [What is where](#1-what-is-where)
2. [Who may do what](#2-who-may-do-what)
3. [Laporan](#3-laporan)
4. [Tim](#4-tim)
5. [Shortlink](#5-shortlink)
6. [The redirect](#6-the-redirect)
7. [D1 and request budget](#7-d1-and-request-budget)
8. [Migration 0007](#8-migration-0007)
9. [Differences from the legacy admin](#9-differences-from-the-legacy-admin)
10. [Tests and negative checks](#10-tests-and-negative-checks)
11. [What was not verified](#11-what-was-not-verified)
12. [Open decisions](#12-open-decisions)

## 1. What is where

| Part | Worker (`cf/admin/src`) | Screens (`cf/admin/spa/src`) |
| --- | --- | --- |
| Laporan | `api/reports.ts`, `reports/rules.ts` | `pages/reports/{model.ts,ReportsPage.tsx,ReportFormPage.tsx}`, `mock/resources/reports.ts` |
| Tim | `api/team.ts` | `pages/team/{model.ts,TeamPage.tsx,TeamFormPage.tsx}`, `mock/resources/team.ts` |
| Shortlink | `api/shortlinks.ts`, `shortlinks/{rules.ts,reserved.ts}` | `pages/shortlinks/{model.ts,ShortlinksPage.tsx,ShortlinkFormPage.tsx,CopyButton.tsx}`, `mock/resources/shortlinks.ts` |
| Shared by the three | `api/sort-expression.ts` | `pages/konten/itemGate.tsx`, `lib/site.ts`, the registry `pages/screens/konten.ts` |
| The redirect, API half | `api/public/shortlink.ts`, `public/shortlink.ts` (mounted on the internal face in `api/public/index.ts`) | |
| The redirect, site half | | `cf/web/src/lib/shortlink.ts`, `cf/web/src/pages/[...path].astro` |

Mounted in `src/worker.ts`: `/api/admin/reports`, `/api/admin/team`, `/api/admin/shortlinks`.

| Method and path | Meaning |
| --- | --- |
| `GET /api/admin/<resource>` | list (page, `pageSize`, `q`, filters, `sort`) |
| `POST /api/admin/<resource>` | create |
| `GET /api/admin/<resource>/:id` | one, with its `ETag` |
| `PUT /api/admin/<resource>/:id` | change, needs `If-Match`; **for reports the body is the metadata only** |
| `DELETE /api/admin/<resource>/:id` | delete (and the file, for reports and team) |
| `GET /api/public/shortlinks/{slug}` | the redirect's lookup, **internal face only** (`PublicApi` service binding), see [section 6](#6-the-redirect) |

## 2. Who may do what

Area `konten` ([`d1-schema.md`](d1-schema.md#permission-model)): `super_admin` and an editor **granted `konten`** read and change; `viewer` reads (a "Lihat" link, a form with every field disabled, no "Simpan", no create button); an editor without `konten` gets `403` on the read too and the SPA shows the 403 page; a student is refused. A role that cannot create is not offered the empty create form either (the 403 page at `/reports/new`, `/team/new`, `/shortlinks/new`). The server decides; the SPA hides what cannot work.

## 3. Laporan

Port of `app/(admin)/admin/reports/actions.ts`.

| Rule | Value |
| --- | --- |
| Title | 3 to 200 characters ("Judul minimal 3 karakter", "Judul maksimal 200 karakter") |
| Description | optional, up to 1000 ("Deskripsi maksimal 1000 karakter"); blank is none |
| Category | `yearly`, `financial`, `impact`, `donation` (labels Laporan Tahunan, Keuangan, Dampak, Donasi) |
| Year | `2025` or `2025/2026`: from 2018 to the current year plus 2; the second year of a range is exactly the first plus one. "Format tahun tidak valid. Contoh: 2025 atau 2025/2026". The table has the shape as a CHECK too, because the public list sorts by it as text |
| File | **required when a report is created**: a PDF uploaded first through `UploadField` (kind `report`, at most 20 MB, checked by content: [`uploads.md`](uploads.md)); the form then sends its `filePath` and `fileSize` from the upload's answer. "File PDF wajib diupload." |
| Editing | **the metadata only**: the file cannot be replaced ("File PDF tidak bisa diganti dari sini. Hapus laporan dan buat baru jika perlu mengganti file."). The update's schema does not mention the file at all, so a body that names another one changes nothing |
| Delete | the row, then its file through `deleteUploadByPath` in `waitUntil`: it never removes a file another row still uses, and never undoes the delete |
| Order | newest year first, then newest upload: the public page's order. The kit sorts by one column, so the list's `year` sort is one SQL expression (`year`, a space, the upload time padded to 15 digits; `api/sort-expression.ts`); a test compares the admin list's order with what `/api/public/reports` returns |
| After a save | create returns to the list ("Laporan berhasil diupload."); an edit stays ("Metadata laporan berhasil disimpan."); delete ("Laporan berhasil dihapus.") |

`fileSize` is what the form sends from the upload's own answer (0 to 20,000,000), as the kit's convention says; the Worker does not read the `media` row again. It is shown on the public page and nothing depends on it. Audit: `report.create|update|delete`, resource `report`, `metadata.fields` (names) and `label` = the title; the create row lists `uploadedBy` among the names (a column name, no value). Purge: `{ area: "reports" }` on every change.

## 4. Tim

Port of `app/(admin)/admin/team/actions.ts`.

| Rule | Value |
| --- | --- |
| Name, role | 2 to 120 characters each ("Nama minimal 2 karakter", "Peran minimal 2 karakter") |
| Category | `dewan_pembina`, `dewan_pengawas`, `pengurus` (the sections of `/tim`, in that order) |
| Display order | **a number**, 0 to 9999, lower first within a category. The legacy form has no "move up" and "move down", so neither does this one ("Tidak boleh negatif", "Maksimal 9999", "Wajib diisi"). A new member starts at 100 |
| Photo | optional; uploaded first (kind `team-photo`: PNG, JPEG or WebP, at most 5 MB, by content), then its path is saved. A member that predates the admin keeps its legacy path (`/images/team/...`) when saved again. The table has no image width or height, so none is recorded: the public page fixes the photo at 112 by 112 |
| Bio | up to 4000 characters |
| Histories | education and work, at most 20 entries each ("Maksimal 20 entri"); an entry needs its institution (education) or its organization and role (work); degree, year and period are optional. **A row with nothing in its required box is dropped on save** ("Kosongkan institusi untuk menghapus baris saat disimpan."): the screen leaves it out of the body, as the legacy form decoded its `FormData`, and the Worker still refuses an entry without one |
| Order of the list | the public page's: category, display order, creation (one SQL expression again). The list has no bio and no histories (a lighter row) |
| Delete | the row, then its photo, in `waitUntil`. Unlike the legacy admin, **replacing or removing the photo of a saved member also deletes the old file** (the kit does it for every resource; the legacy form only deleted on delete, and only under `/images/team/`) |

Audit: `team.create|update|delete`, resource `team_member`, field names and `label` = the member's **name**. This is the one label in this area that is a person's name; it is on the public `/tim` page already, the legacy row kept it (`metadata.name`), and it is what makes a deleted row readable in Aktivitas. Purge: `{ area: "team" }`.

## 5. Shortlink

Port of `app/(admin)/admin/shortlinks/actions.ts` and `lib/shortlinks.ts` (`validateSlug`, `validateTarget`, `RESERVED_SLUGS`); the messages are the legacy ones, word for word.

| Rule | Value |
| --- | --- |
| Slug | trimmed, lower-cased, surrounding slashes removed (`/Daftar-2026/` is `daftar-2026`); 1 to 64 characters of lowercase letters, digits and single inner hyphens; not reserved; unique (the unique index is the last word: two admins at once get the same `409` on the slug, "Slug ini sudah dipakai shortlink lain."). The table repeats the grammar as a CHECK |
| Target | a path of this site (one leading slash) or an `http(s)` URL; `javascript:`, `data:` and a bare domain are refused; `//host` is refused ("Gunakan URL lengkap (https://...) untuk tujuan di luar situs ini."); a link may not point at itself. An absolute URL is stored as the URL parser writes it (`https://example.org` is `https://example.org/`) |
| Note | optional, up to 300, only the admin sees it |
| Active | a switch, on for a new link. An inactive link answers 404 but keeps its slug, so it cannot be reused for something unrelated |
| Not in the form | `click_count` and `last_clicked_at` belong to the redirect: a save never resets them, and a click never touches `updated_at`, so counting clicks can never make an admin's open form "stale" |

**The target rule is stricter than the legacy one in three places** (found while writing the tests; each has tests):

1. **Control characters and backslashes anywhere in the target are refused** ("Format URL tidak valid..."). The legacy test is `startsWith("//")`, which misses `/\evil.example` and `/<tab>/evil.example`: a URL parser reads `\` as `/` and deletes tabs and newlines, so a browser follows both of them to `//evil.example`. The table's CHECK (`like '/%' and not like '//%'`) lets them through too, so this rule is code only.
2. **A link may not point at itself through a query, another case or a trailing slash** (`/Slug/`, `/slug?utm=x`, `/slug#top`, and the same through `https://sakolakembara.org/...`): the same redirect loop as the legacy `/slug`, which was the only form it caught.
3. **The public side checks the target again before it follows it** (the lookup answers 404 for a stored target that fails the rule, and `cf/web` refuses it once more): the admin never stores one, so this only matters if something else wrote the row.

A slug and a target that are both wrong are both reported (the legacy action stopped at the first).

**Reserved slugs** (`shortlinks/reserved.ts`): the legacy 27, plus the names the Cloudflare site claims: `404` and `index`, the one-segment sources of the redirect table (`cerita`, `education`, `news`, `tips`, `testimonials`, `career`, `kiat-kiat`, `daftar`, `apply`, `tentang-kami`, `about`, `impact-reports`, `feed`) and `wp-content`. The trap is the legacy one: the site answers a real page, a legacy prefix, a redirect rule or a static file **before** it looks for a shortlink, so a link called `daftar` would sit in the list looking fine and never fire (and `daftar` is the very name the redirect table sends to `/gabung-siswa`). Refusing the slug when it is created is the only place anybody can be told. **Keeping it true:** `cf/web/tests/shortlink-reserved.test.ts` derives the names the site claims from the site itself (`src/pages`, `legacy-paths.ts`, `redirects.config.mjs`) and fails when one is missing from the list, so adding a page or a redirect without reserving its name fails a test.

Audit: `shortlink.create|update|delete`, resource `shortlink`, field names and `label` = the slug. The legacy row also kept the target, `active` and the old slug on a rename (`previousSlug`); here `fields` says `slug` changed and the target is not in the row (the kit keeps values out of the audit). Purge: none, nothing caches a redirect ([section 6](#6-the-redirect)).

## 6. The redirect

```
visitor ── GET /<slug> ─▶ cf/web Worker, the catch-all route (after every real page, legacy path, redirect rule and static file)
                            · not a slug (grammar, 64 characters): the site's 404, no call
                            · one call:  env.API.fetch(".../api/public/shortlinks/<slug>")      (service binding, PublicApi)
                                              │
                                              ▼
                          cf/admin PublicApi:  one indexed read of the ACTIVE link by slug (unique index)
                                              · found:   200 { "shortlink": { "targetUrl": "..." } }
                                              · unknown or inactive:  404 { "error": "not_found" }   (the same answer for both)
                                              · then, AFTER the answer is decided, in waitUntil:
                                                UPDATE shortlinks SET click_count = click_count + 1, last_clicked_at = ? WHERE id = ?
                                              │
                            ◀─────────────────┘
                            · 307  Location: <target>   Cache-Control: no-store      (a path of the site, or an http(s) URL, checked again)
                            · 404  the site's own 404 page (unknown, inactive, or a 404 that is not the contract's)
                            · 503  one plain sentence, no-store, Retry-After 30      (the API could not answer: down, slow, a wrong answer)
```

- **Status.** `307`, as the legacy resolver: the slug can be repointed at any time and a permanent redirect would be kept by browsers past that edit. The query string of the visit is not forwarded (the legacy resolver did not either). Only `GET` and `HEAD` are visits (a link checker or a preview bot sends `HEAD`); a `POST` to a slug is the plain 404.
- **Unknown, inactive, or not a slug is the site's 404**, not a hint that the slug exists. A failure is a `503`, **never a 404**: only the contract's own `404 { "error": "not_found" }` means "not found", so a wrong base URL or a proxy page cannot make every link look deleted (the same rule the blog uses).
- **The click is counted after the answer, through `waitUntil`** (decision, 2026-10-12). The redirect never waits for the write and never fails because of it: a write that fails is one fixed line in the log (`[shortlinks] could not count a click`, no slug, no id) and the visitor is redirected as usual; a write that never returns does not hold the answer either. This is tested with a write held back on a gate while the answer is already in hand, with a write that fails, and with one that never ends.
- **Counted without a limit** (Dzul, 2026-10-12): one write per visit, no sampling, no daily cap. Twelve simultaneous visits count twelve (the addition is SQL's, there is no read before the write). It counts every `GET` and `HEAD`, bots and link previews included: a popularity signal, not analytics, as in the legacy resolver.
- **Nothing about the visitor is kept**: no address, no user agent, no referrer, no per-click row. The columns are a counter and the time of the last click; a test sends a request with all of those headers and checks that no statement carries them.
- **One call, not two, and an `UPDATE` with a side effect on a `GET`.** Resolving and counting happen in one lookup, so a visit is one subrequest. The cost is a read endpoint that writes. It lives only on the internal face (a service binding, no URL, no caching in front: `Cache-Control: no-store`, no `Cache-Tag`), so nothing replays or prefetches it. The alternative (a pure `GET` plus a second call to count) costs a second subrequest per visit and buys nothing the binding needs.

### Why nothing is cached

The task allowed "cached for a short TTL if that is safe". It is not, for three reasons.

1. **A cache hit never reaches the API, so its click would not be counted.** Counting every click is the decision; a TTL cache turns it into a count of cache misses.
2. **A link that was switched off or repointed must work that way at the next visit.** With a TTL the old target lives on for the TTL (the reason the legacy resolver chose 307 over 308).
3. **It would save almost nothing.** What a cache would spare is the lookup's read, about one row. What the visit costs that nothing can spare is its write, and the write budget, not the read budget, is the one that can run out ([section 7](#7-d1-and-request-budget)). Every visit is also one Worker request whether it is cached or not.

The same reasoning is why the redirect, the API's answer and the `307` all carry `no-store`, and why there is no purge hook for shortlinks.

## 7. D1 and request budget

**Per visit** (measured on the local D1; the real one is confirmed on a Free account in SAKEM-084):

| | Statements | Rows |
| --- | --- | --- |
| The lookup | 1 `SELECT id, target_url ... WHERE slug = ? AND active = 1 LIMIT 1`: `SEARCH shortlinks USING INDEX shortlinks_slug_idx (slug=?)`, no scan | 1 read locally (budget 2: the index entry and the row it points to) |
| The click | 1 `UPDATE ... SET click_count = click_count + 1, last_clicked_at = ? WHERE id = ?` by primary key | 1 read, **1 written** (`meta.rows_written` is 1: neither column is in an index, so the table row is the only row written) |
| An unknown slug or an inactive link | the lookup only | 1 read, nothing written. Bots that probe slug-shaped paths (`/phpmyadmin`, `/xmlrpc`) cost one Worker request and this one read each, as they did in the legacy resolver; a path with a dot, an upper-case letter or a second segment never gets this far |
| Something that is not a slug | none | 0 (the Worker answers before D1) |

So a click is **at most 3 rows read and exactly 1 row written**, in two round trips, and the second is off the visitor's path.

**The arithmetic** (Workers Free and D1 Free: 100,000 Worker requests a day per account, 5,000,000 rows read and 100,000 rows written a day; the limits reset at 00:00 UTC; a D1 query fails once the day's limit is spent):

- Reads: 3 per click is 1.6 million clicks a day before the read budget notices. It is never the wall.
- Writes: 1 per click. The rest of the system writes little (a typical day is under 1,000; an admission-season peak is about 10,000: [`d1-schema.md`](d1-schema.md#free-tier-headroom-estimate)), so clicks can spend roughly **90,000 to 99,000 writes a day** before the first admin save or sign-in fails.
- Requests: **each visit is one request of the site's Worker**, and a call through a service binding is not billed as another one (Cloudflare's pricing page: one request for the first Worker, the CPU of both). The 100,000 requests a day cover every page view that reaches the Worker, so clicks alone cannot get near the write limit before the **request** limit is spent: both walls are 100,000, and the request wall also carries the rest of the site.
- **The risk Dzul accepted, in his words and the numbers above:** one link that goes viral can spend the day's write budget. Then every write fails until 00:00 UTC (admin sign-in, a contact message, a save) while the redirects keep working (they only read) and each click logs one fixed line. If the staging metric (rows written per day, SAKEM-084) gets near the limit, the two fallbacks he named are a per-link daily cap (at most 2,000 clicks a day) or no counting at all.

**Lists** (the three screens, 100 rows a page like the legacy lists that showed everything; `EXPLAIN QUERY PLAN` on the exact statements of one list, 100 reports, 50 members, 100 links): the page is `SCAN <table> | USE TEMP B-TREE FOR ORDER BY` (the public order is an expression, so no index serves it: these tables stay at a few dozen to a hundred rows) and the total is a scan of the smallest covering index. A filter on a report's category is a `SEARCH` on `reports_category_year_idx`. Rows read per list load, measured locally (`meta.rows_read` of the statements, the session's reads included; about three per row listed): reports 302 (100 rows), shortlinks 302 (100 rows), team 152 (50 rows), so about 16,000 full list loads fit in the day's 5,000,000 reads. A list is one round trip of two statements, an edit is a read and then one round trip of two, as the kit says.

**Wall time of a visit, as a proxy** (CPU cannot be measured locally: workerd freezes its timers during synchronous code; SAKEM-084 measures it on the Free plan against the 10 ms limit):

| What | n | Median | p95 | Max |
| --- | --- | --- | --- | --- |
| Real chain in one local `wrangler dev`: cf/web Worker, service binding, cf/admin `PublicApi`, local D1, the click written in `waitUntil` (a Node client on the same machine, `redirect: manual`) | 60 | 10.6 ms | 17.5 ms | 51.6 ms |
| The same chain for an unknown slug (one read, no write) | 20 | 10.3 ms | | 24.4 ms |
| cf/web with the fixture API behind the binding (the e2e check, no D1) | 35 | 3.5 ms | 5.3 ms | 5.9 ms |

The first row also proved the chain end to end: 65 visits left `click_count` at 68 (the three earlier `curl` probes included), `updated_at` equal to `created_at`, an inactive link at 0. The JavaScript a visit runs is a regular expression over at most 64 characters, one query built by Drizzle, and a small JSON answer on the API side; on the site side a route match, one `fetch` and one `Response`. None of it is a measured CPU figure.

## 8. Migration 0007

`reports` had no `updated_at`, so an edit of a report's metadata (which the legacy admin allowed) could not carry `If-Match`, and the kit says a table without one has no `PUT`. The column is added by `migrations/0007_reports_updated_at.sql`. **`drizzle-kit generate` wrote `ALTER TABLE reports ADD updated_at integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL`, which SQLite refuses** ("Cannot add a column with non-constant default"), so the SQL file is a hand-written rebuild: a new table, every row copied with its upload time as its first version, drop, rename, the index again. The snapshot (`meta/0007_snapshot.json`) is the generated one, so `pnpm db:drift` still compares the schema with what the file leaves behind; `wrangler d1 migrations apply --local` ran all seven migrations; tests prove the checks, the index and the carry-over survive (the migration is replayed on a row whose two dates differ). Nothing refers to `reports`, so the rebuild is safe, and it contains `PRAGMA defer_foreign_keys = true` as D1's documentation advises. **Migration numbering collides with the parallel workers: the PM renumbers on rebase** (the file name, the journal entry and the snapshot).

## 9. Differences from the legacy admin

| | Legacy | Here | Why |
| --- | --- | --- | --- |
| The three lists | all rows on one page | the kit's list: search, a filter, sort, pagination (100 a page) | the convention; 100 holds what the legacy page showed |
| A report's edit | no concurrency check | `If-Match` on `updated_at`: a second admin gets "Muat ulang" | the convention; needed migration 0007 |
| Messages of rules that had none | zod's English defaults ("String must contain at most 200 character(s)") | one Indonesian line each ("Judul maksimal 200 karakter", "Nama maksimal 120 karakter", ...) | the kit: no English in a form |
| Uploads | written to `public/` on the VPS disk | R2 through the upload API; the form holds only a path | [`uploads.md`](uploads.md) |
| Team photo types | jpg, jpeg, png, webp, avif by file name | PNG, JPEG, WebP by content (no AVIF) | `uploads.md`, decided with the upload API |
| Team photo cleanup | only on delete, only under `/images/team/` | also when a save replaces or removes it | the kit's `uploads(row)` option; an old file nothing uses is dead weight |
| Audit rows | the values (title, category, year, size and path of a report; name, role, category; slug, target, `active`, `previousSlug`) | field names and a non-personal label (title, member name, slug) | the kit, in the same transaction as the change |
| Counting a click | `await recordShortlinkClick` before `redirect()` (the page waited for it) | after the answer, in `waitUntil`, in the API Worker | decision 2026-10-12: the redirect must not depend on the write |
| A shortlink's target | `//` refused | also backslash and control characters, loops through a query or a case, and the same check on the way out | [section 5](#5-shortlink) |
| Reserved slugs | 27 | 27 plus 16, and a test that derives them from the site | [section 5](#5-shortlink) |
| "N aktif" above the shortlinks | counted among all rows | only when the page holds every link (otherwise just the total) | a page can hold 100 of more |
| Where a shortlink is resolved | the legacy Next app (Postgres), forwarded by the Worker | the API Worker (D1); **the legacy origin is no longer asked for shortlinks** | M3 moves the data; see "Open decisions" |
| Address of the public pages in the descriptions | `/laporan` on the admin's own host | a link to `https://sakolakembara.org/laporan` (the admin has its own host now) | `lib/site.ts` |

## 10. Tests and negative checks

| Where | What |
| --- | --- |
| `cf/admin/test/reports.test.ts`, `team.test.ts`, `shortlinks.test.ts` | per resource, on the real local D1 and R2: the role matrix of the area (student, viewer, a viewer with a stray grant, an editor with no grants, an editor of `pendaftaran` and `komunikasi` only, an editor of `konten`, an editor of every area, super_admin; a refused write leaves no row and no audit row), the validation matrix with every message, a stale update (428, 409) without a trace, audit rows (names and a label, never values), the purge hook, the list's order equal to the public feed's, filters, sorts, search, upload cleanup against the real bucket (replace, remove, delete, a file another row uses is kept, a legacy path is not ours), the migration |
| `cf/admin/test/shortlinks-rules.test.ts` | the slug and target rules in isolation: every legacy message, thirteen schemes, the `//` and backslash and tab forms, the loop forms, the reserved list |
| `cf/admin/test/shortlinks-redirect.test.ts` | found, unknown, inactive; the answer sent while the write is held on a gate; a failing write; a write that never returns; 40 visits counted; simultaneous visits; `updated_at` untouched; one indexed read and one written row; nothing of the visitor in any statement; the public face answers 404 with no D1 round trip; a stored target that is not safe is not followed |
| `cf/admin/spa/test/{reports,team,shortlinks}.test.tsx`, `mock-konten.test.ts` | the lists and forms against stubbed answers in the Worker's shape: who sees what, the legacy columns and words, URL state, delete questions, upload flow, history rows (including an error landing under the right row when a blank row comes first), the guard, stale, read-only forms, the copy button, the mock |
| `cf/web/tests/shortlink.test.ts`, `shortlink-reserved.test.ts` | the resolver against a fake `fetch` (found, 404 only for the contract's 404, every failure is a 503, the timeout, an unsafe target, no cache), the answers, the reserved list derived from the site |
| `cf/web/scripts/e2e.mjs` (group `shortlinks`, and one in `binding`) | the built Worker under `wrangler dev`: 307, `no-store`, one call and one click per visit, 12 visits are 12 calls, `HEAD`, `POST`, 404, the names that cannot be slugs, the pages that win, a 503 for each failure mode, the 2 s cut-off, the log line without the slug, through the real service binding |

Negative checks (each breaks one safeguard, runs the tests, expects them to FAIL, restores the file): `cf/admin/scripts/negative-checks-konten-misc.mjs` (Worker, 35: the area guards, the stale comparison, a report's file, the year, the display order, the histories limit, the photo kind, the public order of the two lists, purge, upload cleanup, the target scheme, `//`, backslash and tab, the self-loop forms, the target check on the way out, reserved slugs, the click awaiting before the answer, its failure isolation, a click that is never counted, a count that is set to one, a click that bumps `updated_at`, an inactive link, a path that is not a slug, the lookup on the public face, its cache header) and `negative-checks-spa-konten-misc.mjs` (SPA, 26: the read-only affordances of the three lists and forms, the create guard, a report's file, the history rows, the unsaved guard, the copy button, `rel` on external links, the red state of the slug), registered in `negative-checks.mjs` and `negative-checks-spa.mjs`; and `cf/web/scripts/negative-checks-shortlink.mjs` (9: the unsafe target, a 404 that is not the contract's, 308, a cacheable redirect, a backslash, an outage read as "not found", no timeout, two reserved names), `pnpm test:negative:shortlink`.

## 11. What was not verified

- **Anything visual or in a browser.** Nothing was opened (the instruction): the lists, the forms, the history rows, the upload field in these forms, the copy button's feedback, the slug box with its prefix and its red state, the page widths, the native `<dialog>` of the delete question. Dzul looks, with `pnpm dev:spa:mock` (`?mock=viewer|editor:konten|editor:komunikasi|super_admin`) in `cf/admin` and `pnpm dev` for a real upload.
- **Worker CPU** of a redirect, a list or a save (workerd cannot report it locally): SAKEM-084.
- **Real D1**: `rows_read` and `rows_written` are the local emulation's; the claim that the click is one written row (neither column indexed) follows D1's own documentation and is confirmed only on the deployed Worker.
- **Real R2, the public files domain, the real service binding at the edge, and a Cloudflare zone.** The binding was exercised locally (one `wrangler dev` session of the site and the API Worker, and the e2e's probe Worker); that the public hostname cannot address the named entrypoint is the check [`public-api.md`](public-api.md) already asks for on the real zone, now also with `curl https://<host>/api/public/shortlinks/<slug>` (404).
- **The legacy shortlinks in Postgres** are not read or migrated (see below).
- **Root gates** (`tsc` and the legacy app's tests at the repository root): not run, root dependencies are not installed here; the PR changes nothing outside `cf/` and `docs/`.

## 12. Open decisions

For Dzul, in order of weight.

1. **Shortlinks that exist in the legacy database are not carried over, and the site stops asking the legacy app for them.** `docs/cloudflare/d1-schema.md` says the legacy Postgres holds dummy data only, so no import was written; but every short link that is printed or posted today has to be created again in the new admin **before the cutover**, or it becomes a 404. If there are real ones, an import of `shortlinks` (id, slug, target, note, active, click count, last click) is one script.
2. **Unlimited click counting** stays as decided. This PR makes it safe for the redirect (the write is after the answer and its failure is invisible to the visitor) and documents the arithmetic ([section 7](#7-d1-and-request-budget)). SAKEM-084 should watch rows written per day.
3. **A `GET` that writes.** One lookup resolves and counts, on the internal face only (no URL, `no-store`). If a cleaner `GET` plus a `POST .../click` is preferred, it costs a second subrequest per visit.
4. **One new sentence of copy**: the `503` page for a lookup that could not be made is plain text, "Tautan ini belum dapat dibuka saat ini. Silakan coba lagi beberapa saat lagi." (the blog's unavailable page has a shell and a button; a short link followed from a poster does not need the shell).
5. **`SITE_URL` is a constant in the SPA** (`lib/site.ts`, `https://sakolakembara.org`): the copy button copies the production address even from a staging admin. If staging needs its own, it belongs in `GET /api/config` next to `uploadsBaseUrl`.
6. **The team member's name is the label of its audit rows** (a public name, as the legacy row kept it). Say so if Aktivitas should show the id only.
7. **`fileSize` of a report comes from the form** (the upload's answer), not from the `media` row. Fine for an admin-only field that only the public list prints; the alternative is one more D1 read on create.
8. **Migration 0007 is a rebuild of `reports`** and will need renumbering when it meets the other workers' migrations.
