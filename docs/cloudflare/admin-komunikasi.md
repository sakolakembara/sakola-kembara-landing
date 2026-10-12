# Komunikasi: Pesan and Pengumuman

The two screens of the **Komunikasi** menu group of the new admin (`cf/admin`), API and SPA: **Pesan** (the inbox of the public contact form) and **Pengumuman** (the strip on every public page). Ticket: SAKEM-082 (M3). Built on the CRUD kit ([`admin-crud.md`](admin-crud.md)); the permission model is [`d1-schema.md`](d1-schema.md#permission-model), the menu is [`admin-ia.md`](admin-ia.md), the public endpoint the strip reads is [`public-api.md`](public-api.md).

Everything below is a port of the legacy admin (`app/(admin)/admin/{messages,announcements}/**`, `lib/{messages,announcements}.ts`, `app/api/announcements/current/route.ts`) except where "Differences from legacy" says otherwise. The look and the Indonesian wording are the legacy ones; the few new sentences are listed in [Open decisions](#open-decisions).

## Contents

1. [Who may do what](#1-who-may-do-what)
2. [Pesan](#2-pesan)
3. [Pengumuman](#3-pengumuman)
4. [Screens, routes and the mock](#4-screens-routes-and-the-mock)
5. [Differences from legacy, and why](#5-differences-from-legacy-and-why)
6. [Tests and negative checks](#6-tests-and-negative-checks)
7. [Not verified](#7-not-verified)
8. [Open decisions](#open-decisions)

## 1. Who may do what

Both resources are the `komunikasi` area (`requireArea`, [`d1-schema.md`](d1-schema.md#permission-model)). An editor needs the `komunikasi` grant to read or change either; an editor of other areas gets `403` on every route and the SPA shows the 403 page; a viewer reads and cannot change anything (a stray grant row is inert); `super_admin` does everything; a student gets `403`. The roles and the area matrix are tested on every route of both resources (`test/messages.test.ts`, `test/announcements.test.ts`).

## 2. Pesan

Code: `src/api/messages.ts` (Worker), `spa/src/pages/messages/` (SPA), `spa/src/mock/komunikasi.ts` (mock). A message is made only by the public contact form (`POST /api/public/contact`, [`public-api.md`](public-api.md)); the admin cannot create or edit one.

### Endpoints

All under `/api/admin/messages`, behind the same chain as every admin route (same-origin guard, `no-store`, session).

| Method and path | Meaning | Guard | Answer |
| --- | --- | --- | --- |
| `GET /` | the inbox, newest first | `komunikasi` read | `200` `{ items, page, pageSize, total }`; each item `{ id, fullName, email, subject, preview, readAt, createdAt }` |
| `GET /counts` | `{ total, unread }` for the header and the pills | read | `200` |
| `GET /:id` | one message, the whole text | read | `200` `{ item }` with `message`; **changes nothing** |
| `POST /:id/read` | mark read | write | `200` `{ item }`; idempotent |
| `POST /:id/unread` | mark unread | write | `200` `{ item }`; idempotent |
| `DELETE /:id` | delete | write | `204`; `404` when gone |

There is no `POST /`, no `PUT` and no `PATCH` (they are `404`), and no `ETag`: the table has no `updated_at`, so marking read or unread cannot lose anyone's work and a delete needs no `If-Match`.

List query: `page`, `pageSize` (20, at most 100), `sort=createdAt|-createdAt` (default `-createdAt`) and `filter=unread|read` (the dashboard's tile links to `/messages?filter=unread`). Anything else in `filter` or `sort` is `400 invalid_query`. **No free-text search**: the legacy inbox had none, and `LIKE '%q%'` over message text would read every message.

### Opening a message does not mark it read

A `GET` never writes. The legacy page marked a message read when its detail page was opened, from the browser, through a server action. Here that is an explicit `POST /api/admin/messages/:id/read` that the SPA calls **once per visit** after the message has loaded, **only for someone who can write**. So a link preview, a prefetch or a probe of the URL cannot read a message on someone's behalf, and a viewer (read-only by role) reads a message and leaves it unread. `POST /read` marks only a message that is unread (`UPDATE ... WHERE read_at IS NULL`), and the audit row is written only if that matched, so asking twice is harmless and leaves one row. `POST /unread` is the mirror.

### The unread definition is the dashboard's

`isUnreadMessage` (`src/dashboard/queries.ts`: `read_at IS NULL`) is used by the dashboard's tile, by `GET /counts` and by `?filter=unread`. One definition, so the number on the dashboard, the number in the pill and the rows behind them cannot part ways; `test/messages.test.ts` checks the three after every kind of change, and a negative check changes the definition.

### "Balas via Email"

A `mailto:` link, as in the legacy page: `mailto:<encodeURIComponent(email)>?subject=<encodeURIComponent(line)>`, with the legacy line per subject (`Re: Kerjasama dengan Sakola Kembara`, `Re: Pertanyaan donasi Sakola Kembara`, `Re: Pesan dari sakolakembara.org`). Nothing is sent from the Worker, so there is no template and no provider to fail closed. It is shown to every role that can read (a mailto link changes nothing).

### Audit rows

`contact_message.read`, `.unread` and `.delete`, each with the actor, `resource_type = contact_message`, the message id and **`metadata = null`**: no name, no address, no text, not even a label. Written in the same `db.batch` as the change (`withAudit`). A test reads every audit row after a read, an unread and a delete of a message with a recognisable name, address and text, and requires none of it to be there. (The legacy delete row carried `fullName`, `email` and `subject`; see below.)

### D1 budget and plans

Free tier: a list is one round trip of two statements, `/counts` one of two, one message one statement, a mark that changes something one of two (update and audit), a mark that changes nothing a batch and one read, a delete a read and a batch of two. Plans (`EXPLAIN QUERY PLAN`, in `test/messages.test.ts`): the unfiltered list walks `contact_messages_created_at_idx` (`SCAN ... USING INDEX`, stops at the limit); `?filter=unread` seeks `contact_messages_read_at_idx`; the unread count is `SEARCH ... USING COVERING INDEX contact_messages_read_at_idx`; the total is a covering-index scan. No migration.

Rows read, measured on the local D1 with 120 messages (80 unread), auth lookups included (about 10 rows): list **163**, `?filter=unread` **244**, `?filter=read` **125**, `/counts` **203**. Two things to know: the totals walk index entries, so the cost of opening the inbox grows with the table (about 2 x N for the list and the counts together: fine for a school's few hundred messages a year, not for tens of thousands); and the unread filter reads every unread message to sort them, so it grows with the **unread backlog**, not with history. If either ever matters, a composite index `(read_at, created_at)` would make the filtered list read only its page (it needs a migration, so it is not done). Real D1 row counts are for SAKEM-084.

## 3. Pengumuman

Code: `src/api/announcements.ts`, `src/announcements/rules.ts` (Worker), `spa/src/pages/announcements/` (SPA). The announcement is the strip at the top of every public page; the public site reads it from `GET /api/public/announcements/current` ([`public-api.md`](public-api.md)).

### Endpoints

Under `/api/admin/announcements`, the kit's five routes (`admin-crud.md#2-the-url-scheme`): list, create, one, `PUT` (needs `If-Match`, `409 stale` for an old version), delete. Written from the kit's functions (`crudHandlers`) rather than `crudRoutes`, because the list is not the kit's: each row also carries a `status`. Create, update and delete write the audit row in the same transaction (`announcement.*`, `metadata = { fields, label: title }`; the title is not personal data) and **call `notifyContentChanged({ area: "announcement" })` after the commit** (through `waitUntil`), so the strip on the public site is purged. Nothing is purged for a save that did not happen: invalid, stale, refused, missing, or a save with no change.

Form (the legacy schema, with its messages): `title` 3 to 200 (`Judul minimal 3 karakter`, `Judul maksimal 200 karakter`), `body` 5 to 500, `severity` `info|warning|urgent` (`Tingkat tidak dikenal`), `ctaLabel` at most 60 and `ctaUrl` at most 500, **both or neither** (`Label dan URL CTA harus diisi keduanya`, on `ctaLabel`), `active`, `startsAt` and `endsAt` optional with `endsAt >= startsAt` (`Tanggal selesai harus setelah tanggal mulai`, `Format tanggal tidak valid`). The database enforces the pair and the window as CHECKs too.

### Which announcement is shown

The legacy reader, unchanged: **active and inside its window, the most recently created wins**; `startsAt` and `endsAt` are both optional and both **inclusive** (`starts_at <= now` and `ends_at >= now`); if several match, the newest `created_at` is shown (a tie is broken by insertion order). Nothing enforces one active announcement at a time: that lets the team schedule a follow-up while the current one runs, and the older one takes over again when the newer one ends or is switched off. The window is evaluated at request time on every request that reaches the Worker, never read from a cache (the legacy tag cache with no expiry could keep an ended announcement on screen).

The rule exists **once**: `announcementIsLive(now)` and `announcementNewestFirst` in `src/public/queries.ts`. `currentAnnouncementQuery` (what `GET /api/public/announcements/current` runs) and the admin list both use them.

### `status` of a list row: "Tampil sekarang"

`GET /api/admin/announcements` adds `status` to every row, computed on the server (not from the browser's clock) with the predicate above evaluated at the same `now` in the same statement as the page, plus one statement that finds the announcement the strip shows:

| `status` | Meaning | Label |
| --- | --- | --- |
| `current` | the one the strip shows now | **Tampil sekarang** (green dot) |
| `superseded` | active and inside its window, but a more recently created one is shown | Aktif, tertutup yang lebih baru (amber) |
| `outside_window` | active, window not started or already over | Aktif, di luar jadwal (amber) |
| `inactive` | switched off | Tidak aktif (gray) |

The current one is marked even when the filter or the page leaves it out. The list is one round trip of three statements (the page, the count, the strip's lookup, which seeks `announcements_active_idx`); the page statement scans the table in `created_at` order, which is acceptable for a table that stays at a few dozen rows. `status` is in the list only, not in `GET /:id` nor in the answer of a save.

### CTA URL

New (the legacy form accepted any text, and the strip puts the URL in an `href` as it is, so `javascript:` or `data:` would run on every public page). The rule is the one the legacy shortlink form already had for its target (`lib/shortlinks.ts` `validateTarget`), with its words: a path of this site (`/gabung-siswa`, not `//host`, no backslash or control character) or an `http(s)://` URL. The sentences: `Gunakan URL lengkap (https://...) untuk tujuan di luar situs ini.`, `Format URL tidak valid. Gunakan https://... atau /path-di-situs-ini.`, `Hanya URL http:// atau https:// yang diizinkan.`, on `ctaUrl`. The legacy hint under the field already said "/gabung-siswa atau URL lengkap (https://...)".

### The public payload

`GET /api/public/announcements/current` answers `{ announcement: { title, body, severity, ctaLabel, ctaUrl } | null }` and nothing else. `test/announcements-rules.test.ts` creates, edits, switches off, schedules, replaces and deletes announcements through the admin API as an editor (so `created_by` is set) and reads the strip through the `PublicApi` entrypoint after each step; it also requires the text to contain no author id, address, row id or internal field name (SAKEM-085 was the legacy endpoint sending the whole row). A negative check widens the query and the serializer and the test fails.

## 4. Screens, routes and the mock

Registered in `spa/src/pages/screens/komunikasi.ts`; the menu entries are in `lib/nav.ts` (Komunikasi: Pesan, Pengumuman, as `admin-ia.md`).

| SPA route | Screen | Notes |
| --- | --- | --- |
| `/messages` | `MessagesPage` | header "N total · M belum dibaca.", the pills Semua / Belum dibaca / Sudah dibaca with counts (links `/messages`, `?filter=unread`, `?filter=read`), a row per message (unread dot, sender, address, subject tag, a line of text, time), pages of 20 |
| `/messages/:id` | `MessageDetailPage` | back link, "Detail pesan", sender, subject tag, "Dikirim ...", Balas via Email, Tandai belum dibaca, Hapus, the text as typed (line breaks kept) |
| `/announcements`, `/new`, `/:id/edit` | `AnnouncementsPage`, `AnnouncementFormPage` | the reference list and form of the kit; the list's Status column is the server's `status` |

Read-only look: a viewer gets the inbox and the detail page with only "Balas via Email" (no toggle, no Hapus, no automatic mark), and the announcements list with "Lihat" and a read-only form; there is no write affordance for a role that cannot write, and the server refuses the write anyway. An area that was not granted is the 403 page; `lib/audit.ts` and the dashboard's tile already link to `/messages/<id>` and `/messages?filter=unread`.

The numbers of the header and the pills come from their own request (`GET /counts`), because a list answers the page it was asked for and its `total` follows the filter; when it fails the labels carry no number rather than a wrong one. After a delete the person goes back to the list with "Pesan berhasil dihapus." (the kit's dialog asks first and names the sender).

Mock (`pnpm dev:spa:mock` in `cf/admin`, `?mock=viewer`, `?mock=editor:komunikasi`, `?mock=editor:konten`, `?mock=super_admin`): `mock/komunikasi.ts` is the inbox with the Worker's semantics (six made-up messages from `example.test`, a GET marks nothing, the verbs are idempotent, `/counts`, the `filter` and `sort` the Worker accepts and refuses, 403 per persona) and the announcement `status` worked out from the generic store's rows with the strip's rule; `mock/resources/announcements.ts` has the CTA URL rule and its words. Nothing leaves memory.

## 5. Differences from legacy, and why

| Legacy | Here | Why |
| --- | --- | --- |
| The detail page marked the message read from the browser through a server action when it opened. | An explicit `POST /:id/read` after the load, once per visit, for someone who can write; the `GET` changes nothing. | The convention (a GET never writes); a viewer is read-only since SAKEM-081, so a viewer no longer marks messages. |
| "Tandai belum dibaca" toggled, and the page, drawn again, marked the message read again. | `POST /unread` and `/read` are explicit and idempotent; unread stays unread until the message is opened again. New label "Tandai sudah dibaca" for the opposite state. | A toggle depends on the state the page last saw; an explicit verb says what it means. |
| The inbox read the whole table. | Pages of 20, newest first. | The Worker's CPU and the D1 read budget. |
| The list sent each message's whole text and CSS cut one line. | `preview`, the first 200 characters. | A message can be 5,000 characters; the list needs a line. |
| "N total · M belum dibaca" and the pills computed from the whole table. | `GET /counts`. | Pages mean the list no longer holds them all. |
| The delete audit row held `fullName`, `email` and `subject`. | Action and id only, `metadata = null`. | Personal data of a visitor does not belong in a trail that more roles can read than the inbox (and SAKEM-082's rule for people-resources). The trail still says which id was deleted, by whom, when. |
| Delete asked with the browser's `confirm()`. | The kit's dialog (`Hapus pesan?`, `Pesan "<name>" akan dihapus. Tindakan ini tidak bisa dibatalkan.`). | `admin-crud.md` (the one shared dialog). |
| Every announcement inside its window was tagged "Tampil" by the browser's clock, though the strip shows one. | The server says which one is shown ("Tampil sekarang") and which live ones are covered. | The tag must say what the strip does; "the Tampil tag computed on the server" is in `admin-crud.md` section 19. |
| Any text as a CTA URL. | A path of this site or an `http(s)` URL. | A `javascript:` link on every public page (see above). |
| Announcement audit `metadata` was `{ title, severity, active }`. | `{ fields, label: title }`. | The kit's one shape. |

Kept as they were: every field, limit and message of both forms; the severity labels, tones and hints; the window text; the `Tampil` strip rule and its newest-wins tie-break; the three subjects and their tones; the legacy reply subjects.

## 6. Tests and negative checks

Worker (workerd, real D1): `test/messages.test.ts` (role and area matrix on every route, list/filter/sort/pages, a GET never marks, the verbs and their audit rows, delete, audit privacy, the three-way unread agreement with `/api/dashboard`, a message sent through the real public form arriving in the inbox, round trips, plans and rows read), `test/announcements-rules.test.ts` (the CTA URL matrix on create and update, the four statuses, the window edges to the millisecond checked against the strip's own query function at the same instant, ties, the current one marked off the page, a generated spread of rows around the edges compared with the rule written again in JavaScript, the round trips and plans, the public strip after every admin change and its allow-list, the purge calls and their absence for a save that did not happen), `test/komunikasi-spa-contract.test.ts` (the SPA's list queries and value tables against the Worker's, the new routes read through the SPA's own `api()`, the words of the CTA URL rule), and the existing `test/announcements.test.ts`.

SPA (jsdom): `spa/test/messages.test.tsx` (list, pills, counts, empty and error states, the detail page, the automatic mark and what it must not do, mark unread by hand, delete), `spa/test/komunikasi-mock.test.ts`, and the reference `spa/test/announcements.test.tsx` (the status words, the server's word over the browser's clock).

Negative checks: `scripts/negative-checks-komunikasi.mjs` (24, Worker) and `scripts/negative-checks-spa-komunikasi.mjs` (16, SPA), registered in `negative-checks.mjs` and `negative-checks-spa.mjs` with one import and one spread each; `node scripts/negative-checks.mjs --only komunikasi` runs the first. Each breaks one safeguard and requires tests to fail: the area check of each route, a verb or delete needing only read access, a GET that marks read, marking that is not idempotent, the unread definition, the unread filter, the preview, a name in the audit row, the announcements' area, the update's access, the stale check, the purge, either end of the window, the status without the window, the oldest shown as current, a covered announcement shown as current, the CTA URL rule and its `javascript:` and `//host` cases, the public allow-list; and in the SPA the Hapus button, the toggle and the automatic mark for a read-only role, the once-per-visit guard, the mock's GET, the reply subject line, the pills, the unread dot, a made-up count, the status worked out in the browser, its label, and the mock's rules.

## 7. Not verified

- Anything visual or in a browser (nothing was opened): the look of the inbox and the detail page, the focus behaviour of the native dialog, how the pills and the status text wrap on a phone, the mailto link opening a mail client. Dzul checks with `pnpm dev:spa:mock`.
- Worker CPU and real D1 row counts (SAKEM-084); the numbers above are the local D1's.
- The public site's own rendering of the strip (a different Worker); only the API it reads is tested here.
- No email is sent by this feature, so there is nothing to verify about a provider.

## Open decisions

For Dzul, in order of weight; the PR description repeats them.

1. **New sentences** (the legacy had no equivalent): "Aktif, tertutup yang lebih baru" (an active announcement covered by a newer one), "Tandai sudah dibaca" (the opposite of the legacy toggle), "Bila ada beberapa, yang terakhir dibuat yang tampil." (added to the description under the Pengumuman title), and "Tampil sekarang" replacing "Tampil". Approve, or give the words.
2. **Several active announcements.** Legacy (kept): nothing enforces one at a time and the newest created is shown. Enforce one (switching one on switches the others off) instead?
3. **The delete audit row of a message has no sender any more** (legacy: name, address, subject). Keep it that way, or record the non-personal `subject` only?
4. **A viewer no longer marks messages read** by opening them (read-only by role since SAKEM-081). The consequence: a viewer's reading never clears the dashboard's unread count. Acceptable?
5. **The CTA URL rule is new** (path or `http(s)`; `mailto:` and `tel:` are refused). Does any announcement need a `mailto:` button?
6. **A composite index `(read_at, created_at)`** would make the unread filter read its page only instead of every unread message (244 rows for 80 unread messages today). Not needed at this size; say if it is worth a migration.
