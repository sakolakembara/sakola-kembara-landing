# Admin CRUD conventions and the shared kit

How every admin list, form and delete in the new admin (`cf/admin`) is built, on the Worker and in the SPA. Ticket: SAKEM-082 (M3). **Read this before writing a screen**: the four area workers (Pendaftaran, Komunikasi, Konten, Sistem) build on it, and what it fixes is not re-decided per screen. Code: `cf/admin/src/api/crud/` (Worker), `cf/admin/spa/src/{lib,components}/crud/` and `cf/admin/spa/src/mock/` (SPA). The reference implementation is the Announcements screen (`src/api/announcements.ts`, `spa/src/pages/announcements/`): copy its shape.

Related: the permission model and areas ([`d1-schema.md`](d1-schema.md#permission-model), [`admin-ia.md`](admin-ia.md)), uploads ([`uploads.md`](uploads.md)), the public cache and purge ([`public-api.md`](public-api.md)), the SPA shell ([`admin-skeleton.md`](admin-skeleton.md)). The look and the Indonesian copy are fixed (`DESIGN.md`, [`../context/tone-of-voice.md`](../context/tone-of-voice.md)); this page adds no new visual language, it wires the existing kit (`components/ui/*`) and ports the legacy admin's markup and wording.

## Contents

1. [What the kit gives you, and who owns what](#1-what-the-kit-gives-you-and-who-owns-what)
2. [The URL scheme](#2-the-url-scheme)
3. [Lists: `page`, `pageSize`, `q`, filters, `sort`](#3-lists-page-pagesize-q-filters-sort)
4. [Response envelopes](#4-response-envelopes)
5. [Errors](#5-errors)
6. [Optimistic concurrency: `updatedAt`, `ETag`, `If-Match`](#6-optimistic-concurrency-updatedat-etag-if-match)
7. [Soft or hard delete](#7-soft-or-hard-delete)
8. [Audit rows](#8-audit-rows)
9. [Public cache purge](#9-public-cache-purge)
10. [Files: upload references](#10-files-upload-references)
11. [Validation: zod, with numbers](#11-validation-zod-with-numbers)
12. [D1 budget rules](#12-d1-budget-rules)
13. [CPU rules](#13-cpu-rules)
14. [The Worker kit](#14-the-worker-kit)
15. [The SPA kit](#15-the-spa-kit)
16. [The mock: build a screen without a backend](#16-the-mock-build-a-screen-without-a-backend)
17. [Tests and negative checks](#17-tests-and-negative-checks)
18. [Worked example: a resource end to end](#18-worked-example-a-resource-end-to-end)
19. [Who owns the announcements reference](#19-who-owns-the-announcements-reference)
20. [Measured](#20-measured)
21. [Open decisions](#21-open-decisions)

## 1. What the kit gives you, and who owns what

A resource screen is five routes on the Worker and three pages in the SPA. The kit exists so that the parts that must be identical everywhere are written once and tested once:

| Safeguard | Where it lives | A worker must not |
| --- | --- | --- |
| Area check on every route (`requireArea`) | `crudRoutes` (or you add it by hand on a custom route) | register an admin route without it |
| Body validation and the one 400 shape | `parseBody` | return a hand-made error body |
| Lost-update protection (`If-Match`) | `updateRow` | skip the check "because nobody else edits this" |
| Audit row in the **same transaction** as the change, field names only | `withAudit` | write the audit row after the fact, or put a body in it |
| Public cache purge after a public resource changes | `crudRoutes` option `purge` | forget it: the site would show the old text for up to 6 minutes |
| Upload cleanup after a path is replaced or removed | `crudRoutes` option `uploads` | delete an R2 object by hand |
| Page size clamp, sort whitelist, search escaping | `parseListQuery` | read `page` or `sort` from the query yourself |
| Hide write controls from read-only roles, double-submit lock, field errors on `Field`, unsaved-changes guard, delete confirmation naming the item | SPA kit | build a bespoke version |

Use `crudRoutes` when the resource is a plain table. When the flow differs (the blog renders HTML on save, a batch publishes, an application is reviewed, a message is marked read) write the routes by hand **from the same functions `crudRoutes` is built from** (`parseListQuery`, `parseBody`, `withAudit`, `updateRow`, `deleteRow`, the error helpers). Never re-implement a safeguard.

## 2. The URL scheme

Everything is under `/api/admin/`. The resource name is the plural menu key of `menuItems` (`src/auth/permissions.ts`): `batches`, `applications`, `resources`, `messages`, `announcements`, `blog`, `reports`, `team`, `shortlinks`, `audit`, and the existing `users` and `uploads`.

| Method and path | Meaning | Guard | Success |
| --- | --- | --- | --- |
| `GET /api/admin/<resource>` | list | `requireArea(area, "read")` | `200` [list envelope](#4-response-envelopes) |
| `POST /api/admin/<resource>` | create | `requireArea(area, "write")` | `201` `{ item }`, `ETag` |
| `GET /api/admin/<resource>/:id` | one | read | `200` `{ item }`, `ETag` |
| `PUT /api/admin/<resource>/:id` | replace the whole form | write, `If-Match` required | `200` `{ item }`, new `ETag` |
| `DELETE /api/admin/<resource>/:id` | delete | write, `If-Match` optional | `204`, no body |
| `POST /api/admin/<resource>/:id/<verb>` | a state change that is not an edit (`publish`, `read`, `accept`) | write | `200` `{ item }` |

- **No `PATCH`.** A form saves everything it shows (`PUT`); a one-field change that is not an edit is a verb route. This keeps "what did this request change" answerable from the audit row.
- The old sample path `/api/announcements` was moved to `/api/admin/announcements` by this PR; nothing else used it.
- **SPA routes** mirror the menu: `/<menu>` (list), `/<menu>/new`, `/<menu>/:id/edit` (`activityHref` in `spa/src/lib/audit.ts` already links to these).
- Ids are opaque strings (UUIDs, or a slug where the legacy used one). An id longer than 128 characters is a `404` without touching D1.
- The same-origin guard, `Cache-Control: no-store` and the session are applied to all of `/api/*` in `src/worker.ts`; a resource does not repeat them. Mounting is one line in `worker.ts`: `app.route("/api/admin/<resource>", routes)`.

## 3. Lists: `page`, `pageSize`, `q`, filters, `sort`

`GET /api/admin/<resource>?page=2&pageSize=20&q=pendaftaran&severity=info&sort=-createdAt`

| Parameter | Rule |
| --- | --- |
| `page` | Integer from 1. Anything else (missing, `0`, `abc`, `-3`) is `1`. At most `10000`. |
| `pageSize` | Integer from 1. Default **20**, at most **100**; a larger number is clamped to 100, anything else is 20. |
| `q` | Free text, trimmed, cut to 100 characters. A case-insensitive *contains* over the columns the resource lists as searchable (`LIKE '%q%' ESCAPE '\'`; `%`, `_` and `\` in `q` match only themselves). Empty means no search. |
| resource filters | One parameter per filter the resource declares, named after the field (`severity`, `status`, `batch`, `active`). A **value the filter does not know is `400 invalid_query`** (it would silently return something else). An empty value means "no filter". |
| `sort` | `<field>` ascending or `-<field>` descending, from the resource's whitelist (a map from the public name to a column). Missing is the resource's default. **A name not in the whitelist is `400 invalid_query`**, never put in SQL. `id` is always added as the last tie-breaker so pages never overlap. |

Numbers are clamped and enums are strict on purpose: a clamped page is harmless, a wrong filter silently ignored shows the wrong list. Other query parameters are ignored. A `page` past the end is `200` with `items: []` and the true `total` (the SPA then moves to the last page).

**Search cost.** `LIKE '%q%'` cannot use an index: it reads every row of the table (and D1 bills rows read). Fine for a table of a few hundred to a few thousand rows (blog 80, team ~20, shortlinks ~100, messages growing slowly); for anything expected to pass about 5,000 rows (applications over the years, audit) search must be a prefix match on an indexed column, or a filter, not free text. The SPA debounces nothing: the filter bar searches when "Terapkan" is pressed.

## 4. Response envelopes

**List:** `{ items: Item[], page, pageSize, total }`. `page` and `pageSize` are the values actually used (after clamping); `total` is the number of rows that match the filters, so the client computes `totalPages = max(1, ceil(total / pageSize))`. `items` holds only the fields a list needs (a list never carries a long body: the blog list has no `contentHtml`).

**One item: `{ item }`, not the bare object.** Chosen because (1) it is symmetric with the list envelope, so a client has one rule ("the payload is under `items` or `item`"); (2) a verb route or a later change can add a sibling (`{ item, warnings }`, `{ item, purged }`) without a breaking change; (3) an item can never collide with the error shape (`error`) or with a future envelope key; (4) the existing sample already wrapped its rows (`{ announcement }`). The cost is one property access.

An item always has `id` (string) and `updatedAt` (ISO 8601 string, millisecond precision, UTC) when the table has `updated_at`, plus `createdAt`. Dates are ISO strings in JSON, never epoch numbers; booleans are booleans; a nullable column is `null`, never absent. Fields the client has no business with (`createdBy`, internal flags, other people's email addresses) are left out by `present`: an explicit field list, never `select *` straight into JSON (`uploads.md` does the same).

## 5. Errors

Every non-2xx answer from this API has one shape:

```json
{ "error": "invalid", "message": "Periksa kembali isian formulir.", "fields": { "title": "Judul minimal 3 karakter" } }
```

- `error`: a stable machine code (below). The SPA branches on it.
- `message`: optional, Indonesian, ready to show. When it is missing the SPA uses its own line for the code (`spa/src/lib/crud/errors.ts`), so the guards (`unauthenticated`, `forbidden`) need not repeat texts.
- `fields`: optional, only for `invalid` and a `conflict` that belongs to one field: `{ "<field name>": "<one Indonesian message>" }`. Names are the JSON property names of the body; a nested one is a dotted path (`educationHistory.0.institution`). Only the first message per field is kept.
- Extra keys only where listed (`usedBy` on `in_use`, `maxBytes` on `too_large`).
- Never in an error: a stack, SQL, an id of another row, the value that was rejected, the contents of the body.

| Status | `error` | When |
| --- | --- | --- |
| 400 | `invalid` | the body does not pass the schema; `fields` says where |
| 400 | `invalid_json` | the body is not JSON |
| 400 | `invalid_query` | an unknown `sort` or filter value |
| 401 | `unauthenticated` | no session (from the guard) |
| 403 | `forbidden` | the role or grants do not allow it (from the guard); also a cross-origin write (`reason` is added by the same-origin guard) |
| 404 | `not_found` | no such row, or an id that cannot exist |
| 409 | `stale` | `If-Match` does not match: someone saved first ([section 6](#6-optimistic-concurrency-updatedat-etag-if-match)) |
| 409 | `in_use` | something still refers to it (a batch with applications, a file used by a page); `usedBy: ["Blog", ...]` names the menus |
| 409 | `conflict` | a uniqueness rule (a slug already taken); `fields` names the field |
| 413 | `too_large` | the JSON body is above the limit (512 KiB by default, `maxBytes` in the answer) |
| 415 | `json_required` | the content type is not `application/json` (this is what stops a cross-site form post) |
| 428 | `precondition_required` | `PUT` without `If-Match` |
| 429 | `rate_limited` | a limiter (uploads, auth); `Retry-After` is set |
| 500 | `internal` | anything unexpected; the Worker logs the message only |

`validationError(c, fields)`, `notFound(c)`, `stale(c)`, `inUse(c, usedBy)`, `conflict(c, fields)` and the rest are in `src/api/crud/errors.ts`: handlers return them, they never build a body by hand. The legacy `fieldErrors: { name: string[] }` of the first sample is gone (the SPA's `ApiFailure` reads `fields`).

## 6. Optimistic concurrency: `updatedAt`, `ETag`, `If-Match`

Two admins can open the same form. Without a check the second save silently erases the first. The rule:

- Every item with an `updated_at` column carries it as `updatedAt`. Its **ETag** is that value in double quotes: `"2026-10-12T08:30:00.123Z"`. `GET /:id`, `POST` and `PUT` send it as the `ETag` header too (so `curl -i` shows it), but the SPA does not read headers: it builds `If-Match` from the `updatedAt` of the item it loaded (`ifMatch(updatedAt)` in `spa/src/lib/crud/etag.ts`).
- `PUT` **requires** `If-Match`. Missing: `428 precondition_required` (so a client cannot skip the check by leaving the header out). Not equal to the row's current ETag: `409 stale`. Equal: the update runs.
- The comparison is made twice: first on the row that was just read (a cheap early answer), and again **inside the `UPDATE`** (`... WHERE id = ? AND updated_at = ?`), so two saves that read the same version cannot both win. The save that matches zero rows answers `409 stale`, and its audit row is not written (`withAudit` writes it only if the statement before it changed a row).
- `updatedAt` is set by the server on every successful update (`max(now, previous + 1 ms)`, so two saves in the same millisecond still get different ETags).
- `DELETE` accepts `If-Match` but does not require it. The SPA sends the `updatedAt` of the row it shows, so deleting something that was edited a moment ago is refused as `stale` instead of throwing away an edit nobody saw.
- A table with no `updated_at` (`reports`, `audit_log`, `media`) has no `PUT`: it is created and deleted, or has verb routes. If you add `updated_at` to a table, that needs a migration like any other column.

**What the SPA does on `409 stale`.** `useMutation` sets `stale`, and `FormShell` shows a persistent alert that cannot be missed: *"Data ini sudah diubah orang lain sejak kamu membukanya. Muat ulang untuk melihat versi terbaru. Perubahan yang belum disimpan akan hilang."* with a **"Muat ulang"** button that refetches the item and resets the form. Nothing is merged automatically and nothing is saved until the person presses "Simpan" again on the fresh version. In a list, a stale delete shows the same sentence with "Muat ulang" inside the confirmation dialog.

## 7. Soft or hard delete

**Hard delete is the default**: `DELETE` removes the row and writes one `<name>.delete` audit row, which keeps the id and the non-personal `label`, so the history survives. That is what the legacy admin did for announcements, reports, team, resources, shortlinks, blog posts and messages.

Use **soft delete** (a status or `deactivated_at` column, a verb route) only when:

1. **Other rows hold the id and the history must keep resolving it.** Admin users are deactivated, not deleted (audit rows and `created_by` point at them; `auth.md#admin-users`).
2. **The row is a record with a lifecycle**, not content. Student applications are never deleted from the admin; they move through statuses.
3. **A foreign key says so.** `student_applications.batch_id` is `ON DELETE RESTRICT`: deleting a batch that has applications is `409 in_use` (map the constraint error with `isForeignKeyViolation`), not a 500 and not a cascade.

A resource that appears on the public site purges the cache after a delete ([section 9](#9-public-cache-purge)). A delete that removes a file the row held calls the upload cleanup ([section 10](#10-files-upload-references)).

## 8. Audit rows

Every create, update and delete writes **one** `audit_log` row **in the same D1 batch (one transaction) as the change** (`withAudit`, built on `db/audit.ts`). There is never a change without its row, nor the reverse; a save that loses a race writes neither.

| Column | Value |
| --- | --- |
| `action` | `<name>.create`, `<name>.update`, `<name>.delete`; a verb route writes `<name>.<verb>`. `<name>` is the legacy name (`announcement`, `report`, `blog`, `team`, `resource`, `shortlink`, `batch`, `contact_message`), so the Aktivitas labels of `lib/audit-labels.ts` keep working |
| `actor_id`, `actor_email` | the signed-in admin |
| `resource_type`, `resource_id` | the legacy type (`announcement`, `team_member`, `site_resource`, ...) and the row id |
| `metadata` | `{ "fields": ["title", "severity"] }` for a create or update (the **names** of the columns written; for an update only those whose value changed) and an optional `"label"` |

`label` is a short non-personal name shown next to the row in Aktivitas (an announcement's title, a report's title). **Opt in per resource, and never personal data**: no applicant name, no email, no phone number, no message text, no markdown or HTML body, no file name that contains a person's name. A resource about people (`applications`, `messages`) records no label at all. `withAudit` truncates the label to 120 characters and writes nothing else into `metadata`; the only way to put more in is to bypass the helper, and a test reads every audit row written by the contract resource to make sure it holds names and nothing else.

The vocabulary (`AuditAction`, `AuditResourceType` in `src/db/audit.ts`) already lists every legacy name, so no worker edits that file to add an action.

## 9. Public cache purge

A resource whose rows appear on the public site declares `purge` (a `ContentChange` or a function of the row: `{ area: "announcement" }`, `{ area: "blog", slug }`). `crudRoutes` calls `notifyContentChanged` through `waitUntil` after the batch commits, for a create, an update and a delete (an update also purges the **old** slug when a slug changed). A failing purge never fails the save (`src/public/purge.ts`: the data is in D1, the TTL bounds the staleness). Hand-written routes call `notifyContentChanged` themselves, after the commit, with `c.executionCtx.waitUntil.bind(c.executionCtx)`.

Resources with no public surface (`applications`, `messages`, `audit`, `users`) declare nothing.

## 10. Files: upload references

A form never receives a file. The flow ([`uploads.md`](uploads.md#how-later-screens-use-it)):

1. `UploadField` posts the file to `POST /api/admin/uploads?kind=<kind>` and gets `{ path, size, width, height }`.
2. The form saves `path` (and `fileSize`, `imageWidth`, `imageHeight` where the table has them). The body schema accepts `/uploads/...` paths of the right kind through `uploadPath(kinds)` and keeps accepting the legacy static paths (`/blog/images/...`, `/files/...`).
3. The resource's `uploads(row)` option returns the paths a row holds. After an **update** commits, every path that was in the old row and is not in the new one is passed to `deleteUploadByPath`; after a **delete**, every path of the old row is. The helper never removes a file another row still uses and never throws, so the save is never undone by a cleanup problem (it runs in `waitUntil`).
4. A table that gets a column able to hold a path is added to `uploadReferences` (`src/uploads/references.ts`), as `uploads.md` says.

A file uploaded and never saved (the person closed the form) stays in R2 with its `media` row: `UploadField` deletes the superseded file when the person replaces or removes one *in the same form session*, but an abandoned form leaves one orphan. A sweep of unreferenced `media` rows older than a week is a follow-up (not built; it would be a cron like `src/cron/cleanup.ts`).

## 11. Validation: zod, with numbers

**Decision: zod 4, the library the Worker already ships**, written in the schema next to the handler; the Indonesian messages are in the schema (the legacy ones, copied). The shape of the error answer is ours (`fieldsOf` turns issues into `{ name: message }`), not zod's.

The numbers (esbuild bundle of one small object schema, the Worker's resolution conditions; and `wrangler deploy --dry-run` of the whole Worker):

| | Size |
| --- | --- |
| zod 4 alone (one schema, unminified, as `wrangler deploy --dry-run` bundles) | ~741 KiB, ~115 KiB gzip |
| the Worker before this PR | 2,913.66 KiB, 503.16 KiB gzip |
| the Worker after this PR | see [Measured](#20-measured) |
| Workers Free limit | 3 MiB compressed |

zod is imported by `src/api/announcements.ts` and `src/api/admin-users.ts` already, so using it for every new resource adds **its schemas, not the library**: the kit adds about `src/api/crud` plus a few kilobytes. The alternative (hand-written validators) would save nothing the Worker does not already carry, and would repeat what zod gives for free: type inference from the schema (the `Input` type of a resource is `z.infer`), `refine` for cross-field rules (`endsAt >= startsAt`), `pipe`/`transform` for trimming and dates. It would also give four workers four dialects of the 400 body. If a later budget review wants the library out, `zod/mini` has the same schemas as functions and tree-shakes, and only the schema files change.

Rules for a schema: trim strings with `.trim()` before length checks; give **every** rule an Indonesian message (an unwritten one prints zod's English default into the form); `.max()` on every string (the body limit protects the Worker, the `.max()` protects the column); use `z.enum(columnValues)` with the same const array the Drizzle column and its CHECK use; reject unknown keys by omission (zod strips them: a client can never set `createdBy`).

## 12. D1 budget rules

Free tier: 5,000,000 rows read and 100,000 rows written per day; a query that goes over fails. D1 counts an index entry as a written row, and a read costs the rows *scanned*, not the rows returned.

| Request | Statements | Round trips |
| --- | --- | --- |
| list | 2 (the page and `count(*)` over the same `WHERE`) in one `db.batch` | 1 |
| one item | 1 | 1 |
| create | 2 (insert `RETURNING`, audit) in one `db.batch` | 1 |
| update | 1 read of the row, then 2 in one `db.batch` (update `RETURNING`, audit) | 2 |
| delete | 1 read of the row, then 2 in one `db.batch` (delete, audit) | 2 |

- **Batch, never loop.** One `await` per round trip; no `await` inside a `for` over rows. A list that needs related data joins or does one `IN (...)` query, never one query per row.
- **`EXPLAIN QUERY PLAN` every new list and filter** and keep the plan in the PR: the filter and the sort must show `SEARCH ... USING INDEX` or `USING COVERING INDEX`, not `SCAN`. A `SCAN` of a table that can only stay small (team, resources) is acceptable; say so in the PR. `crud-budget` in `test/` shows how the contract test asserts a plan.
- **Indexes only through migrations** (`pnpm db:generate`, `db:drift` must stay clean), and only when a plan shows a scan on a table that can grow. An index costs one written row per insert and update of every row it covers.
- **Writes:** a save writes the row, one row per index, and the audit row with its three indexes: budget about 8 to 10 written rows. At 100,000 a day that is 10,000 saves a day, far above what a school does.
- Never `select *` into a response, and never select a long column (`content_html`, `body_text`) for a list.
- `total` costs the rows matching the filter (one scan of an index). Do not add per-resource aggregates to lists.

## 13. CPU rules

The Worker has 10 ms of CPU per request on Free; waiting for D1 or R2 is not CPU, JavaScript is.

- A list returns at most 100 rows and maps them once. No sorting, filtering or grouping in JavaScript that SQL can do.
- `JSON.parse` of the body is the one big cost: the limit is 512 KiB (`parseBody`), about 1 to 2 ms. A resource that needs more (a blog post with a long article) raises the limit **for itself** with a number it justifies, not globally.
- No markdown or HTML rendering, no image work, no hashing or compression on a request that can avoid it. The blog renders markdown **once, on save**, and stores the HTML (decided: SAKEM-082); a list never renders.
- No regular expression over user text longer than a title; `q` is cut to 100 characters before it is used.
- Side effects that are not needed for the answer (`notifyContentChanged`, upload cleanup) go in `waitUntil`.
- Local tests cannot measure CPU (workerd freezes its timers during synchronous code): the budget is verified on a Free account in SAKEM-084. The rules above are what keeps the answer short until then.

## 14. The Worker kit

`cf/admin/src/api/crud/`, one concern per file, re-exported from `index.ts`. Plain functions, no framework; each is usable alone in a hand-written route.

| File | What it gives |
| --- | --- |
| `pagination.ts` | `parsePage`, `pageOf` (the list envelope), `parseSort`, `parseSearch`, `likeContains`, `parseEnumFilter`, `parseListQuery` (all of the above for a resource spec, or the `400`) |
| `errors.ts` | `validationError`, `invalidQuery`, `notFound`, `stale`, `inUse`, `conflict`, `tooLarge`, `preconditionRequired`, `invalidJson`, `jsonRequired`, `isUniqueViolation`, `isForeignKeyViolation` |
| `validation.ts` | `parseBody(c, schema, { maxBytes })` (415, 400, 413 or the parsed value), `fieldsOf(zodError)`, `uploadPath(kinds)` |
| `concurrency.ts` | `etagOf(date)`, `readIfMatch(c)`, `nextVersion(previous)` |
| `audit.ts` | `withAudit(db, actor, entry, statements)`, `changedFields(before, after)` |
| `resource.ts` | `crudRoutes(config, deps?)`, plus `listRows`, `findRow`, `createRow`, `updateRow`, `deleteRow` (what it is built from) |

A resource config (`crudRoutes`):

```ts
export const announcementRoutes = crudRoutes({
  area: "komunikasi",                    // read on GET, write on the rest
  table: schema.announcements,           // needs `id`; `version` below is the updated_at column
  version: schema.announcements.updatedAt,
  audit: { name: "announcement", type: "announcement", label: (row) => row.title },
  schema: announcementInput,             // zod schema of the form (create and update)
  toRow: (input, { user, mode }) => ({ ...input, ...(mode === "create" ? { createdBy: user.id } : {}) }),
  present: presentAnnouncement,          // row -> what the API returns
  list: {
    search: [schema.announcements.title, schema.announcements.body],
    filters: { severity: enumFilter(schema.announcements.severity, announcementSeverity) },
    sorts: { createdAt: schema.announcements.createdAt, title: schema.announcements.title },
    defaultSort: "-createdAt",
  },
  purge: { area: "announcement" },       // optional
  uploads: (row) => [],                  // optional: the paths a row holds
  routes: { create: true, update: true, delete: true },   // optional switches
});
```

`deps` (`{ notify, deleteUpload }`) exists so a test can pass spies; production code never passes it.

## 15. The SPA kit

`cf/admin/spa/src/lib/crud/` (logic) and `spa/src/components/crud/` (pieces). All user-facing text is Indonesian and comes from the legacy admin where it existed (`app/(admin)/admin/*`).

**Hooks and logic**

| Piece | What it does |
| --- | --- |
| `useList(path, spec)` | page, search, filters and sort live in the URL query (so reload, back and a shared link keep them); loads with `api()`, aborts on unmount and when the query changes, keeps the previous rows while refreshing, says `loading`, `ready` or `error`, moves to the last page when a page past the end is asked for, `refetch()` |
| `useItem(path)` | `GET /:id` with the same states; `path` `null` means "new" and loads nothing |
| `useMutation(run)` | submit lock (a second submit while one is in flight is ignored, by ref, not by state), maps the 400 `fields` onto `Field` errors, a `formError`, `stale` for 409, and a plain sentence for 403, 429, network and 5xx |
| `useFormValues(initial)` | values, `set`, `dirty`, `reset(next)`, `bind(name)` for controlled inputs |
| `useUnsavedGuard(dirty)` | `beforeunload` and an in-app blocker (a data router: `useBlocker`) that asks before leaving |
| `useFlash()` / `flashState()` | a success or error notice that survives a route change (it travels in the navigation's history state) |
| `describeFailure(failure)` | one line per error code, `fields` from the 400 |
| `parseListQuery` / `toSearchParams` (`query.ts`) | the pure URL query logic |
| `ifMatch(updatedAt)` | the `If-Match` value |
| `uploadFile`, `checkUploadFile`, `UPLOAD_KINDS`, `uploadUrl` (`uploads.ts`) | the client side of [uploads](#10-files-upload-references): checks that mirror the server's limits, XHR with progress, the table of kinds (a Worker test fails when it differs from `KIND_RULES`), `uploadUrl(path, base)` like the public site's |

**Components**

| Piece | What it is |
| --- | --- |
| `PageHeader` (existing) | has the `actions` slot (the "Pengumuman Baru" button); show it only to someone who can write |
| `ListPage` | header, flash, filter bar, table, pagination and the delete dialog composed from the pieces below, for the common list; or use the pieces yourself |
| `FilterBar` | the legacy filter row: labelled controls, "Terapkan", a "Hapus filter" link; it writes the URL query |
| `DataTable` | the kit `Table` with columns, a row-actions slot, and empty, loading and error rows (a `role="status"` / `role="alert"` row, `aria-busy` on the table, "Coba lagi") |
| `Pagination` | "Sebelumnya", numbered pages with `aria-current="page"`, "Berikutnya", and "Menampilkan 21 sampai 40 dari 87"; real links (keyboard, middle click) |
| `ConfirmDialog` | the native `<dialog>` with `showModal()` the design system prescribes: destructive style, names the item, Escape and the backdrop cancel (not while a request is in flight), focus starts on "Batal" and returns to the button that opened it |
| `FormShell` | the legacy editor frame: sticky bar with back link and "Simpan" / "Batal", titled `FormSection`s, error summary linking to the fields, the stale alert, the unsaved-changes dialog |
| `Flash` | the notice (`Alert`, `role="status"` for success and `role="alert"` for errors), dismissible |
| `StatusTag` | `makeStatusMap({ value: { label, tone } })` and `<StatusTag map value />`: an unknown value is a gray tag with the raw text, never a crash |
| `UploadField` | file picker with client checks, progress bar (`role="progressbar"`), preview, replace and remove; keyboard and screen reader friendly |

**Who can see what.** A write affordance (the create button, "Edit"/"Hapus" in rows, the form's Simpan) appears only when `accessTo(me, area) === "write"`. A read-only role gets the list and the form **read-only** (`FormShell` with `readOnly`: fields disabled, no Simpan, no unsaved guard). The server refuses the write anyway; hiding is only so nobody is offered a button that cannot work. `accessTo` is never edited by a screen.

**Router.** The app runs under a data router (`createBrowserRouter` in `main.tsx`, one splat route that renders `<App />`), because `FormShell`'s unsaved-changes guard needs `useBlocker`. Tests render with `renderApp` (`spa/test/helpers.tsx`), which does the same with `createMemoryRouter`.

**`GET /api/config`** now answers `uploadsBaseUrl` (the public Worker variable `UPLOADS_BASE_URL`, `""` when unset, so in development `/uploads/...` stays same-origin through the Vite proxy). `useUploadsBase()` reads it once per page load; `uploadUrl(path, base)` puts it in front of a `/uploads/` path and leaves every other path alone.

## 16. The mock: build a screen without a backend

`pnpm dev:spa:mock` (in `cf/admin`) serves the SPA against an in-memory API (`?mock=viewer|editor|editor:konten,komunikasi|super_admin|student`). The kit adds a **generic in-memory resource store** (`spa/src/mock/resources.ts`) with the same contract as the Worker: list (`page`, `pageSize`, `q`, filters, `sort`), `GET /:id`, create (`201`), update (checks `If-Match` and answers `409 stale`), delete (`204`, `409 in_use` when the spec says so), validation as the 400 shape, `403` when the persona cannot read or write the resource's area (the Worker's own `can()` is what `accessTo` reads), and a fake `POST` for uploads that returns a path.

To mock a resource, **add one file** `spa/src/mock/resources/<name>.ts` (they are picked up with `import.meta.glob`, so there is no central list to edit and parallel workers do not conflict):

```ts
import type { MockResource } from "../resources";

const resource: MockResource = {
  path: "/api/admin/reports",
  area: "konten",
  seed: () => [{ id: "r1", title: "Laporan Tahunan 2025", category: "yearly", year: "2025", createdAt: "...", updatedAt: "..." }],
  search: ["title"],
  filters: { category: ["yearly", "financial", "impact", "donation"] },
  sorts: ["title", "year"],
  defaultSort: "-year",
  parse: (body) => (String(body.title ?? "").trim().length < 3 ? { ok: false, fields: { title: "Judul minimal 3 karakter" } } : { ok: true, values: { title: String(body.title).trim(), ... } }),
};
export default resource;
```

`mock/resources/announcements.ts` is the worked one. A mock never touches the network and never stores anything outside memory.

## 17. Tests and negative checks

Worker (`cf/admin/test/`, workerd, real D1):

- `crud-helpers.test.ts`: unit tests of every helper (clamping, the sort whitelist, `LIKE` escaping, error shapes, `fieldsOf`, ETags, the body limit).
- `crud-audit.test.ts`: `withAudit` against D1: one transaction, no row when the statement before it changed nothing, names only.
- `crud-contract.test.ts`: a throwaway resource mounted in the test under `/api/admin/__example` (not shipped; it has its own table) that proves the conventions end to end: list, filters, sort, pagination, create, update, a stale update, a missing `If-Match`, delete, validation, 403 per role and area, the audit rows, the purge hook, upload cleanup, the 409s, and that the SPA's own query builder, error mapper and upload table agree with the Worker.
- `announcements.test.ts` (updated) and the other suites that used `/api/announcements`.

SPA (`cf/admin/spa/test/crud/`, vitest and jsdom): one file per block (keyboard, focus, `aria-*`, error mapping, `stale`, the unsaved guard, upload checks and progress with a stubbed `XMLHttpRequest`), the reference screen, and the mock store. `spa/test/setup.ts` fails any test that logs to `console.error` or `console.warn`.

Negative checks: `scripts/negative-checks-crud.mjs` (Worker) and `scripts/negative-checks-spa-crud.mjs` (SPA) break one safeguard at a time (the area check on writes, the stale check, the validation, the audit transaction, the sort whitelist, hidden write buttons for read-only roles, the upload client limits) and require the tests to fail; `pnpm test:negative` and `pnpm test:negative:spa` run them with the existing ones.

**Not verified here:** anything visual or in a browser (nothing was opened; Dzul checks the look, the focus behaviour of the native dialog and the real upload with `pnpm dev:spa:mock` and `pnpm dev`), Worker CPU, real D1 row counts, and the native `<dialog>` focus trap (jsdom has no `showModal`; the tests stub it and assert what our code does around it).

## 18. Worked example: a resource end to end

A new resource "Shortlink" (`konten`), from the table to the screen. Every step names the file a worker creates or edits.

1. **Table and migration** exist already (`shortlinks`, with a unique `slug`). New columns or indexes: a migration, `pnpm db:generate`, `pnpm db:drift`.
2. **Schema** (the form, Indonesian messages) in `src/api/shortlinks.ts`:
   ```ts
   const shortlinkInput = z.object({
     slug: z.string().trim().toLowerCase().min(1, "Slug wajib diisi").max(64, "Slug maksimal 64 karakter").regex(SLUG, "Slug hanya boleh huruf kecil, angka, dan tanda hubung"),
     targetUrl: z.string().trim().min(1, "URL tujuan wajib diisi").max(2000, "URL tujuan terlalu panjang"),
     note: z.string().trim().max(500).nullish().transform((v) => v || null),
     active: z.boolean().default(true),
   });
   ```
3. **Routes**: `crudRoutes({ area: "konten", table: schema.shortlinks, version: schema.shortlinks.updatedAt, audit: { name: "shortlink", type: "shortlink", label: (row) => row.slug }, schema: shortlinkInput, toRow, present, list: {...}, purge: ... })`. A duplicate slug: the unique index raises, `crudRoutes` maps `isUniqueViolation(error, "shortlinks.slug")` through the config's `unique: { "shortlinks.slug": { field: "slug", message: "Slug sudah dipakai" } }` to `409 conflict` with `fields.slug`.
4. **Mount** in `src/worker.ts`: `app.route("/api/admin/shortlinks", shortlinkRoutes);` (one line).
5. **Mock**: `spa/src/mock/resources/shortlinks.ts` (above), so the screens work with `pnpm dev:spa:mock`.
6. **SPA pages** in `spa/src/pages/shortlinks/`: `ShortlinksPage` (a `ListPage` with columns, a `FilterBar` for status, row actions Edit and Hapus), `ShortlinkFormPage` (`useItem`, `useFormValues`, `useMutation`, a `FormShell` with `FormSection`s and `Field`s); route them in `App.tsx` (`/shortlinks`, `/shortlinks/new`, `/shortlinks/:id/edit`).
7. **Tests**: a Worker test for what is specific (the slug rules, a reserved slug), the SPA tests of the two pages (read-only role sees no buttons; the form maps a 409 onto the slug field). The contract suite already proves the generic behaviour; do not copy it.
8. **Docs**: if the change is structural, update `docs/current-state/`; the PR template asks.

Look at `src/api/announcements.ts`, `spa/src/pages/announcements/` and `spa/src/mock/resources/announcements.ts`: they are this, for announcements.

## 19. Who owns the announcements reference

This PR **converts** what existed (list, create, edit, delete of announcements) to the convention and to the new blocks; it adds no rule. **`src/api/announcements.ts`, `spa/src/pages/announcements/` and their tests belong to the Komunikasi worker** from the day this merges. Still to do there, not here: the "one current announcement" rule (what happens when two are active), publish windows in the editor (`startsAt`/`endsAt` validation against `now`), the Tampil / Aktif di luar jadwal tag computed on the server, the CTA URL rules (internal path or `https://`), the Komunikasi label in Aktivitas, and the preview of the strip. Their tests keep proving the convention; they must not weaken the contract suite.

## 20. Measured

Filled in at the end of the work (see the PR description for the commands): Worker bundle before and after (`wrangler deploy --dry-run`), SPA bundle before and after (`pnpm build:spa`).

## 21. Open decisions

For Dzul, in order of weight: see the PR description (kept there so this page records only decisions that were made).
