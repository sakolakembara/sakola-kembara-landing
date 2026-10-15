# Pendaftaran: Batch, Pendaftar and Pusat Dokumen

The admission area of the new admin (`cf/admin`): the yearly batches, the applicants and the documents hub, API and screens. Ticket: SAKEM-082 (M3). Epic SAKEM-074. It is built on the CRUD kit ([`admin-crud.md`](admin-crud.md), read that first), the permission model ([`d1-schema.md`](d1-schema.md#permission-model)), the upload API ([`uploads.md`](uploads.md)) and the menu decided in [`admin-ia.md`](admin-ia.md). The legacy code it ports is `app/(admin)/admin/{batches,applications,resources}/**`, `lib/application-status.ts`, `lib/admission-batches.ts`, `lib/site-resources*.ts`.

The rules are the legacy ones; where something differs, [What differs from the legacy admin](#what-differs-from-the-legacy-admin) says what and why. The look and the Indonesian copy are the legacy admin's (`DESIGN.md`, [`../context/tone-of-voice.md`](../context/tone-of-voice.md)); texts that are new are listed in [Open decisions](#open-decisions-for-dzul).

## Contents

1. [What is in the box](#what-is-in-the-box)
2. [Who may do what](#who-may-do-what)
3. [Endpoints](#endpoints)
4. [Batch](#batch)
5. [Pendaftar](#pendaftar)
6. [Pusat Dokumen](#pusat-dokumen)
7. [D1: plans, round trips, rows read](#d1-plans-round-trips-rows-read)
8. [The screens](#the-screens)
9. [What differs from the legacy admin](#what-differs-from-the-legacy-admin)
10. [Measured](#measured)
11. [What is not verified](#what-is-not-verified)
12. [Open decisions for Dzul](#open-decisions-for-dzul)

## What is in the box

| Part | Where |
| --- | --- |
| Batch routes (the CRUD, the detail with counts, publish and cancel publication) | `cf/admin/src/api/batches.ts` |
| Pendaftar routes (list, detail, the review) | `src/api/applications.ts` |
| Pusat Dokumen routes | `src/api/resources.ts` |
| The files an applicant uploaded: open one, purge them (SAKEM-083; the code they share is `src/private-files/`) | `src/api/application-files.ts` |
| The files of a draft that was never submitted: the list of drafts that hold files and the purge of one's files, after 30 days without a change (SAKEM-093) | `src/private-files/drafts.ts`; the two routes at the end of `src/api/application-files.ts` |
| The review rules (pure) | `src/admission/review.ts` |
| Every query of the area as an unexecuted Drizzle query (so the plan tests explain exactly what runs), and the prefix search | `src/admission/queries.ts` |
| Migration `0009_applications_name_search` (one index, see [D1](#d1-plans-round-trips-rows-read)) | `migrations/`, `src/db/schema/admission.ts` |
| Mount (three lines; the files' routes are one more, SAKEM-083) | `src/worker.ts` |
| Screens and their models (the tab "Draf dengan berkas" is `applications/DraftFilesPage.tsx`) | `spa/src/pages/{batches,applications,resources}/`, registered in `spa/src/pages/screens/pendaftaran.ts` |
| The detail page's sections as data | `spa/src/pages/applications/answers.ts` |
| Mock for `pnpm dev:spa:mock` | `spa/src/mock/resources/pendaftaran.ts` (and one additive `custom` hook in `spa/src/mock/resources.ts`) |
| Tests | Worker: `test/{batches,applications,resources,admission-rules,pendaftaran-plans,pendaftaran-spa-contract}.test.ts`, and for the drafts' files `test/private-files-drafts{,-plans,-privacy,-spa-contract}.test.ts`; SPA: `spa/test/pendaftaran/*` |
| Negative checks | `scripts/negative-checks-pendaftaran.mjs`, `scripts/negative-checks-spa-pendaftaran.mjs`, and for the drafts' files `scripts/negative-checks-portal-drafts.mjs` (`--only "portal drafts:"`) |

## Who may do what

The area is `pendaftaran`. `viewer` reads, an `editor` granted `pendaftaran` reads and writes, `super_admin` both, every other editor and a student have **nothing** (403 on reads too), Sistem is untouched. Every route has `requireArea("pendaftaran", "read" | "write")`. The legacy admin let any signed-in role (viewer included) do all of it; that defect is closed here ([`admin-ia.md`](admin-ia.md), section 1). The tests run the whole role and grant matrix against every write route (create, edit, delete, publish, cancel, review) and every read, and prove that a refused request changes nothing and leaves no audit row.

The files of a draft that was never submitted (SAKEM-093) are `pendaftaran` **write** for the list too: a viewer never sees them, and the tab "Draf dengan berkas" is drawn only for a writer.

In the SPA a viewer sees every list and page, the form read-only, **no** create button, Edit, Hapus, publish, cancel or review form (`accessTo(me, "pendaftaran")`); an editor of other areas gets the 403 page and no request is made.

## Endpoints

All under `/api/admin/`, all behind the same-origin guard and `Cache-Control: no-store` of `src/worker.ts`. List query: `page`, `pageSize` (20, at most 100; resources default to 100), `q`, the filters and `sort` named below, with the kit's rules ([`admin-crud.md`](admin-crud.md#3-lists-page-pagesize-q-filters-sort)). Errors: the kit's one shape.

| Method and path | Guard | Success | Refusals (besides 401, 403, 400 `invalid_query`) |
| --- | --- | --- | --- |
| `GET batches` | read | `{ items, page, pageSize, total }`; each item is the batch plus `phase`, `pending`, `underReview`. Filter: none. Search `q` (contains, the table has a few rows). Sorts `year` (default `-year`), `opensAt`, `name` | |
| `POST batches` | write | `201 { item }`, `ETag` | 400 `invalid`, 409 `conflict` (year taken) |
| `GET batches/:id` | read | `{ item }` with `phase`, `counts { pending, under_review, accepted, rejected, total }`, `canPublish`, `recent` (the 5 newest applicants), `ETag` | 404 |
| `PUT batches/:id` | write, `If-Match` | `{ item }`, new `ETag` | 428, 400, 404, 409 `stale`, 409 `conflict` |
| `DELETE batches/:id` | write, `If-Match` optional | `204` | 404, 409 `stale`, **409 `in_use`** while applications exist |
| `POST batches/:id/publish` | write | `{ item }` (the detail) | 404 `not_found` "Batch tidak ditemukan"; 409 `already_published`, `no_applicants`, `undecided` (with `undecided: n`) |
| `POST batches/:id/unpublish` | write | `{ item }` (the detail; nothing to cancel is `200` and no write) | 404 |
| `GET applications` | read | `{ items, page, pageSize, total }`; item: `id, fullName, email, schoolName, graduationYear, branchPreference, status, submittedAt, updatedAt, batch { id, year, name }`. Filters `status` (the four), `batch` (an id, or `all`; an id nobody has is an empty list). Search `q`: the **start** of a name or email. Sorts `submittedAt` (default `-submittedAt`), `fullName` | |
| `GET applications/:id` | read | `{ item }` with every answer (`formData`), the contact details, the notes, the batch, `ETag`, and (SAKEM-083) `formVersion`, `files` (the list of the applicant's uploads: metadata only) and `canOpenFiles` | 404 |
| `GET applications/:id/files/:fileId` | **write** | the file's bytes through the Worker (`private, no-store`; an image inline, a PDF as an attachment), one audit row `application_file.view` per open, before the body | 401, 403 (a viewer too), 404, 429 (120 a minute), 503 |
| `POST applications/:id/files/purge` | **write** | `{ purged, pending }`: deletes every file of the application, body `{ "confirm": true }`, one audit row `application_file.purge` | 400 without the confirmation, 404, 429 (20 a minute) |
| `GET applications/drafts/files` | **write** | `{ items, page, pageSize, total }`: the drafts that were never submitted and hold live files, oldest change first (an id, the batch, the number and size of the files, when it changed, whether it may be purged). No name, no answer, no file name. `pageSize` at most 50 | 401, 403 (a viewer too) |
| `POST applications/drafts/:id/files/purge` | **write** | `{ purged, pending }`: deletes every file of the draft if it was last changed at least 30 days ago; body `{ "confirm": true }`; one audit row `application_file.purge` (resource type `application_draft`) | 400 without the confirmation, 404 (not a draft: a submitted application's id too), **409 `draft_active`** (changed less than 30 days ago), 429 (the same 20 a minute as the other purge) |
| `POST applications/:id/status` | write, `If-Match` **required** | `{ item }` (the detail), new `ETag` | 428, 400 `invalid` (`fields.reviewNotes`, `fields.status`), 404 "Pendaftar tidak ditemukan.", 409 `stale` |
| `GET resources` | read | `{ items, page, pageSize, total }` in the public page's order. Filters `category`, `contentType`. Search `q` (title, description). Sorts `category` (default: the page's order), `title`, `displayOrder`, `updatedAt` | |
| `POST resources` | write | `201 { item }`, `ETag` | 400 `invalid` |
| `GET resources/:id`, `PUT`, `DELETE` | read, write + `If-Match`, write | as the kit | as the kit |

There is no create, edit or delete of an application (a record with a lifecycle: [`admin-crud.md`](admin-crud.md#7-soft-or-hard-delete)). A request for one is the JSON 404.

## Batch

**The form** (zod, the legacy server action's messages; the ones the legacy left to zod's English are written in Indonesian): `year` a whole number from 2024 to 2100 ("Tahun terlalu jauh ke belakang" / "... ke depan"), unique ("Tahun sudah dipakai batch lain", a 409 on the field, decided by the unique index so two admins creating the same year at once give one batch); `name` 3 to 120 characters; `description` at most 1000, empty is none; `opensAt` and `closesAt` required instants, and **the close strictly after the open** ("Tanggal tutup harus setelah tanggal buka"). The SPA sends the dates the browser's `datetime-local` gives, converted to ISO instants. The audit row of a create or edit names the columns and carries the batch name as its label (a batch name is not personal data).

**Phase.** The list and the detail say where a batch stands with `batchPhase` of the dashboard (`src/dashboard/payload.ts`, imported, not copied): `upcoming`, `open`, `awaiting_decisions`, `ready_to_publish`, `closed_empty`, `published`, worked out with the server's clock. The legacy list had four states ("Akan datang", "Buka", "Menunggu keputusan", "Hasil dipublikasikan"); the two the dashboard added are "Siap dipublikasikan" and "Ditutup, tanpa pendaftar".

**Delete** (the legacy admin had none): a batch nobody applied to can be deleted (`batch.delete` in the audit log, with its name); with applications it is `409 in_use`, "Batch ini masih punya pendaftar, jadi tidak bisa dihapus.", from the `ON DELETE RESTRICT` foreign key, so the guard cannot be raced; nothing changes and no audit row is written.

**Publish the results.** Preconditions and words of the legacy action, in its order: not found ("Batch tidak ditemukan"), already published ("Hasil sudah dipublikasikan"), no applicant ("Belum ada pendaftar di batch ini"), undecided ones ("Masih ada N pendaftar yang belum diputuskan"). The same rules are in the `UPDATE`'s `WHERE`, so an applicant sent back to "pending" a moment after the check cannot be published over: the write matches no row, nothing is written (audit row included), and the answer is the refusal that is true now. Two publishes at once give one `200` and one `409 already_published` and one audit row. `updated_at` moves, so an edit form open elsewhere goes stale. **Cancel**: sets the date back to null; cancelling what is not published is a `200` that changes nothing and writes no audit row (the legacy action wrote one anyway). Both write one audit row (`batch.publish_results`, `batch.unpublish_results`) of the field name and the batch name; the legacy row also held the accepted and rejected counts, which the audit helper does not carry (names only, [`admin-crud.md`](admin-crud.md#8-audit-rows)).

**No purge.** Publishing changes nothing the public site reads: the public API serves no batch (the portal, a later milestone, reads `results_published_at`), so none of these routes asks for a purge (a test with a spy proves it).

## Pendaftar

**The list** opens on the **newest batch** (decided: `admin-ia.md`, question 8). The address says what is shown: `/applications` goes to `?batch=<newest>` (a replace, so Back works), `?batch=all` is every batch, and a link that names a status and no batch (the dashboard's tiles count every batch) is left as it is: every batch. The bar has Batch, Status and a search; the search says it looks at **the start of a name or an email** ("Awal nama atau email") and holds 48 characters. Columns are the legacy ones (Nama with the email under it, Batch, Asal Sekolah, Cabang, Status, Dikirim). Pages replace the legacy "50 newest".

**Search is a prefix match on an indexed column, never `LIKE '%q%'`** ([`admin-crud.md`](admin-crud.md#3-lists-page-pagesize-q-filters-sort): this is the table that grows). Name: `full_name LIKE 'abc%' ESCAPE '!'` over the new `COLLATE NOCASE` index (SQLite uses an index for a LIKE prefix only then; it also makes the match case-insensitive for ASCII). Email: a range, `email >= 'abc' AND email < 'abc￿'`, over the existing index, on the lower-cased text (accounts are lower-cased when they are created). The two are `OR`ed (`MULTI-INDEX OR` in the plan). `%`, `_` and `!` in the text match only themselves; the pattern is cut to fit D1's 50 bytes, never an error. `q=aminah` finds nobody named "Siti Aminah": that is the point.

**The detail** has everything the legacy page showed, as sections built by `answers.ts` (which row exists when, how a value is shown), with the legacy titles except two: "Berkas Pendaftaran" and "Berkas Marketing" (the names of two menu items and categories of Pusat Dokumen) became "Tautan berkas" and "Bukti Marketing" ([`admin-ia.md`](admin-ia.md), 3.4; the IA proposed "Berkas yang diunggah", but the files are links the applicant pasted, so the exact word wins). An old application has no `formData` and shows its legacy story; any part of `formData` that is missing or of another shape is read as empty, never as a crash.

**Applicant documents, from the new portal (version 3 answers, SAKEM-083).** The student uploads their documents to a private bucket; the detail shows the section **"Berkas"** (and **"Bukti Marketing"** with the Instagram name): one row per slot, in the order of the slot table (`shared/application-form/slots.ts`), with the number of files and their total size, each file's type and size, and a dash for a slot with nothing in it; the SKTM slot only for a family registered in DTKS. **Opening a file needs `pendaftaran` write** (an editor with the grant or a super_admin): they get a link per file ("Lihat" for an image, "Unduh" for a PDF, which is never rendered by our pages), in a new tab, through the Worker; a **viewer sees the same list and is told that only the Pendaftaran team can open the files** (decided 2026-10-13: these are scans of identity documents of minors, which a viewer's right to read the answers does not cover). Nothing is loaded by itself: no thumbnails, so each open is a person's click and one audit row (the application, the file and the slot: ids only; the Aktivitas page shows none of it). The page also has a card **"Berkas Pendaftar"** with the button **"Hapus Semua Berkas"** for the same people: the **manual purge** ([`portal-api.md`](portal-api.md#123-the-manual-purge-post-apiadminapplicationsidfilespurge)), with a question first. **Nothing is deleted automatically.** The answer of a review does not carry the files; the page keeps what it had. The code is `spa/src/pages/applications/{answers,model,FilesSection}.tsx`, the Worker's `src/api/application-files.ts`.

**Drafts that hold files (SAKEM-093).** A student who uploads scans of identity documents and never submits leaves them in the private bucket: a draft is not an application, so it is not in the Pendaftar list, and nothing is deleted automatically. Dzul decided on 2026-10-15 that an admin may delete such files by hand, and this is the way: a second tab of Pendaftar, **"Draf dengan berkas"** (`/applications/drafts`), for who may write in the area. One row per draft that holds live files: the first eight characters of its id, the batch, "n berkas · size" and when it last changed. **No name, email, answer, slot or file name**: the admin who purges is deliberately not told whose it is. What replaces that is the rule the Worker enforces: **the files of a draft may be purged only after 30 days without a change** (the draft's last step save, upload, replace or delete; inclusive to the millisecond). A row that meets it has the button "Hapus Berkas"; any other says "Bisa dihapus mulai <date>" and has no button. The purge asks first ("Hapus berkas draf ini?"), sends `{ "confirm": true }`, writes one audit row (a count and the file ids, resource type `application_draft`, shown in Aktivitas as "Berkas pendaftar dihapus" on a "Draf pendaftaran"), and removes **the files only**: what the student typed stays, and their next upload goes into the same draft. If the student saves a step between the admin's click and the write, the Worker refuses by the rule inside its statements, nothing is deleted, and the answer says so (409, the same sentence as for a draft that was never old enough; the screen keeps it in the dialog and loads the list again). The full contract is [`portal-api.md`](portal-api.md#124-the-files-of-a-draft-that-was-never-submitted); the code is `spa/src/pages/applications/DraftFilesPage.tsx` and the Worker's `src/private-files/drafts.ts`. **Not covered:** the files of a draft whose student deleted their account (no draft row is left to list), which stay a runbook item.

**Applicant documents, version 2 answers (the legacy wizard).** In the legacy wizard the applicant **pastes links** to files in their own Google Drive; the app stores no file of theirs. The detail page therefore links those addresses, as the legacy page did, and that is all it can do. They are shown as text and are clickable only when they are `http` or `https` (a `javascript:` address typed into a document field is shown as text; tested). **If the portal milestone replaces the links with uploads, they must go to a private bucket, not to the public one of [`uploads.md`](uploads.md); nothing of that exists yet, and nothing here pretends to.** (Decided 2026-10-13: applicants upload, to a private bucket read only through a Worker; what changes on this screen is [`portal-architecture.md`](portal-architecture.md#88-what-changes-in-the-admins-pendaftar-detail).)

**The review** (`POST applications/:id/status`, a verb route; the legacy form was "Ubah Status"). The rules are the legacy ones and only those:

- **Any status can be set from any other** (the legacy code has no state machine; the IA text "pending → under_review → accepted / rejected" described intent, not code).
- Accepting or rejecting needs a note: "Catatan review wajib diisi saat menerima atau menolak." (on `reviewNotes`). The note is trimmed, at most 2000 characters ("Catatan review maksimal 2000 karakter": the legacy left that message to zod's English).
- **Revoking an acceptance** (accepted → rejected) needs a note of **at least 20 characters**: "Alasan pencabutan wajib diisi minimal 20 karakter — jelaskan mengapa penerimaan ini dibatalkan.", and is logged as `application.revoke` instead of `application.rejected`. Checked against the status the write replaces (see below).
- A decision sets `status`, `review_notes` (null when empty), `reviewed_by`, `reviewed_at`.

What is new: the review needs `If-Match` (428 without; 409 `stale` for an old version), checked again inside the `UPDATE`, so two reviewers on the same version cannot both decide and the revocation rule always sees the status it replaces; a test makes another decision land between the read and the write and shows the second is refused.

**Audit: field names only.** The row of a review is `application.<status>` or `application.revoke`, resource `application`, and `metadata { fields: ["status", "reviewNotes", "reviewedBy", "reviewedAt"] }`: no label (it is about a person), **no note**. The legacy row held the review note and, for a revocation, the reason, so the legacy form promised "tercatat permanen di audit log". The reason now lives only in the application's `review_notes` (which a later decision replaces); see [Open decisions](#open-decisions-for-dzul). The form says what is true. Logs hold no name, address, number or note on success or failure (a test reads every line of every console method during a full run).

**No email.** The legacy app sends exactly two emails (account verification and password reset); a review or a publication sent none, and none is sent here. The student sees a decision in the portal once the batch is published. A test checks the mailbox before and after every decision.

**No CSV export:** the legacy admin had none, so none was built.

## Pusat Dokumen

The menu was "Berkas Pendaftaran"; it is the catalog behind `/gabung-siswa/docs`. A row is exactly one of three shapes, chosen by `contentType` (the table's CHECK enforces it; the form says it first, and what belongs to another shape is dropped):

- **file**: `filePath` and `fileSize`. The path is what `POST /api/admin/uploads` (kind `resource`) answered, or a legacy `/resources/...` path; a path of another kind of upload, a URL or anything else is refused ("Berkas tidak valid. Unggah ulang berkasnya."). Only **PDF and images** (PNG, JPEG, WebP), at most 25 MB, are accepted by the upload; Word, Excel and PowerPoint are not (Dzul's decision: save them as PDF, or use a link). `registration-document` paths are accepted in a row too (same rules and folder family), but the screens use `resource`, and that kind is left as it is.
- **url**: an `http` or `https` address (legacy: any URL zod accepted, `javascript:` included; the public page puts it in a link).
- **text**: a snippet, up to 10,000 characters; the public page shows it with the copy button.

Categories, in the public page's order: `panduan`, `berkas-pendaftaran`, `berkas-marketing`, `tutorial`, `lainnya` (the legacy admin sorted the list by the alphabet of the category names, which is not the page's order). The list is grouped by category on screen, each a section with its heading, rows in the manual order (`displayOrder`, then creation). The legacy form's messages are kept ("Judul minimal 2 karakter", "URL wajib diisi untuk tipe Link Eksternal.", "Isi teks yang bisa disalin.", "File wajib diupload.", ...).

**Every create, edit and delete** asks for a purge of the public `resources` payload (after the commit, in `waitUntil`; spy tests) and, after the commit, **removes the file the row no longer holds** through `deleteUploadByPath` (replaced, dropped by switching to a link or text, or deleted with the row; never a file another row still uses, never a legacy static path; real R2 in the tests). A contract test creates, edits and deletes through the admin API and reads `GET /api/public/resources` after each: the payload follows, is in the page's order, carries the text of a text entry, and **never `notes`** (the internal note).

## D1: plans, round trips, rows read

`EXPLAIN QUERY PLAN` of every list, filter and search is asserted in `test/pendaftaran-plans.test.ts`; the statements and round trips of each request are counted on the real local D1; the rows read are `meta.rows_read` of the local D1 (the real D1 is only confirmed on a deployed Worker, SAKEM-084).

**The migration.** `0009_applications_name_search`: `CREATE INDEX student_applications_full_name_idx ON student_applications (full_name COLLATE NOCASE)`. It is the only change to the schema. Without it a name prefix has no index to walk. Cost: one more written row per application submitted (about 300 a year). It follows `0007_audit_viewer_indexes` (Sistem) and `0008_reports_updated_at` (Konten); applying all ten migrations to a clean local D1 and `pnpm db:drift` were checked after the rebase.

| Request | Round trips | Statements | Plan |
| --- | --- | --- | --- |
| list of applicants | 1 | 2 (page with its batch by join, total) | by batch: seek on `student_applications_batch_id_idx` and a sort of that batch's rows; by status: seek on the status index; nothing: a walk of `submitted_at` that stops at the limit; search: `MULTI-INDEX OR` over the NOCASE name index and the email index; totals are covering index counts |
| applicant detail | 1 | 1 | primary key, and the batch by primary key |
| review | 2 | read (1), then update and audit row in one batch (2) | |
| batch list | 1 | 3 (page with `EXISTS` per batch, total, the undecided counts per batch from the dashboard's own query) | the unique year index in order |
| batch detail | 1 | 3 (the batch, counts per status, newest five) | the batch index |
| publish | 2 | the detail (3), then the guarded update and its audit row in one batch (2) | |
| documents list | 1 | 2 | the catalog is a few dozen rows (`SCAN` of a small table is acceptable, see the kit's rule) |

Rows read, measured with 300 applications in a batch: the list of the newest batch about 600 (an index entry and a row per applicant of that batch, plus the sort; it **does not change when other batches grow**); an email prefix with one match 6 (**the same with three times as many applicants**); a name prefix with 111 matches 452 (four per match: index entry, row, the batch for the join, the count); the page of a batch about 400 (the counts and the newest five each read that batch's rows); a review under 12. `GET applications?batch=all` counts the table (a scan of the smallest covering index): it grows with the school's history (about 900 rows after three years) and is the one honest exception. Adding an index on `(batch_id, submitted_at)` would let the newest-batch list read about a page of rows instead of the whole batch (an estimate, not measured); it was not added (it would replace an index the dashboard's plan tests name), and a school's admin does not come near 5 million reads a day.

CPU: no markdown, HTML or image work, no per-row query, bodies of at most 16 KiB (64 KiB for a document); nothing is computed in JavaScript that SQL can do. Local tests cannot measure CPU (workerd freezes its timers); SAKEM-084 does it on a Free account.

## The screens

| Path | Screen | Notes |
| --- | --- | --- |
| `/batches` | list (`ListPage`) | search; "Kelola" (write) or "Detail" (read); Edit, Hapus; each batch's pending and under-review counts link to the applicants list |
| `/batches/new`, `/batches/:id/edit` | form (`FormShell`) | legacy fields; new → the batch's page with "Batch berhasil dibuat."; edit stays with "Perubahan berhasil disimpan." |
| `/batches/:id` | the page of a batch | facts, four status tiles (links to the applicants list filtered to this batch and status), the newest five and "Lihat semua", "Ubah Data", the "Publikasi Hasil" panel with the legacy text, counts and hints |
| `/applications` | list | see [Pendaftar](#pendaftar); a row remembers the list it came from, so "Kembali ke daftar" restores it |
| `/applications/drafts` | the tab "Draf dengan berkas" (a writer only; a viewer gets the 403 page and no request is made) | a table (`DataTable`, pages of 20) of the drafts that hold files: short id, batch, files, last change, "Hapus Berkas" for a draft that was quiet for 30 days or "Bisa dihapus mulai ..." for the others; the two tabs ("Pendaftar", "Draf dengan berkas") are drawn on both pages for a writer only |
| `/applications/:id` | applicant page | sections, the batch link, the "Ubah Status" panel (a form for a writer, a sentence for a reader) |
| `/resources`, `/resources/new`, `/resources/:id/edit` | grouped list, form with the three shapes and `UploadField` | "Lihat" opens a file from the files domain (`uploadsBaseUrl`) or a link |

`pnpm dev:spa:mock` (in `cf/admin`) serves all of it from `spa/src/mock/resources/pendaftaran.ts` with four invented batches, fifteen applicants, five documents and four drafts that hold files (two old enough to purge, two not); `?mock=viewer` and `?mock=editor:pendaftaran` show the two sides, `?mock=editor:konten` the 403 page. The mock repeats the Worker's rules in miniature (publish preconditions, the review's rules, the prefix search, the document shapes) and tests pin them. To let it answer a verb (`POST /:id/publish`), `MockResource` got one optional `custom` hook (additive; the generic store is otherwise unchanged).

## What differs from the legacy admin

| Legacy | Here | Why |
| --- | --- | --- |
| Any signed-in role could do everything | `pendaftaran` write for an editor, read for a viewer, nothing for others | The permission model; the IA's decision |
| No batch delete | Delete, `409 in_use` while applications exist | Asked for in the brief; the foreign key is the guard |
| Publish: checks, then write | The same checks, **and** the same rules in the write | A decision changed between check and write must not be published over |
| Unpublish of an unpublished batch wrote an audit row | `200`, no write, no row | An audit row for nothing is noise |
| Audit rows of publish held the accepted and rejected counts; of a review held the note and the reason | Field names (and a batch or document title) only | No applicant data in audit payloads (the brief and `admin-crud.md`, 8). **The revocation reason is no longer permanent in the log**: open decision |
| Review without a version | `If-Match` required, checked in the write | Two reviewers; the revocation rule needs the status it replaces |
| Applicants: pills, the 50 newest, no search | Filter bar, pages, a prefix search | The table grows; the brief |
| Applicants list opened on every batch | Opens on the newest batch | `admin-ia.md`, question 8 |
| Batch page: a table of up to 100 applicants and the edit form inline | The newest five and a link to the filtered list; the form is its own page | `admin-ia.md`, 3.4 and question 7 |
| List of documents: one table in the alphabet of the category names | Grouped by the five categories in the public page's order | The brief |
| A document URL: any address zod accepted | `http` and `https` only | `javascript:` in a public link |
| A document file: any type, 25 MB | PDF and images, 25 MB | Dzul's decision; checked from the bytes |
| A document file written to the local disk | R2, removed after the save when no row holds it | `uploads.md` |
| `audit_log` named in the review panel's texts | "Aktivitas" | `admin-ia.md`, 3.5 |
| A taken year: a read, then an insert | The unique index decides (`409 conflict` on the field); the top sentence is the kit's, the field's is the legacy one | The race of two admins; the kit's `unique` option has one message |
| Redirect and `?created=1` messages | A notice that survives the navigation (`useFlash`) | The SPA |

## Measured

The same machine, `WRANGLER_SEND_METRICS=false CI=1`. CPU cannot be measured locally.

The size of the Pendaftaran screens, measured on top of #61 before the other areas were merged:

| | Before (PR #61) | With Pendaftaran | Change |
| --- | --- | --- | --- |
| SPA JS | 425.87 kB, 133.52 kB gzip | 479.09 kB, 147.77 kB gzip | +53.2 kB, +14.3 kB gzip (seven pages and the sections of the applicant page) |
| SPA CSS | 48.33 kB, 12.15 kB gzip | 50.39 kB, 12.46 kB gzip | +2.1 kB |

Rebased on `origin/cloudflare` with the Sistem, Komunikasi and Konten areas merged, the whole SPA is 539.03 kB of JS (162.70 kB gzip) and 52.23 kB of CSS (12.76 kB gzip), in one chunk.

Tests, after the rebase: Worker 1,761 (52 files) and SPA 1,105 (45 files), of which this area is 178 Worker tests (`batches`, `applications`, `resources`, `admission-rules`, `pendaftaran-plans`, `pendaftaran-spa-contract`) and 120 SPA tests (`spa/test/pendaftaran/*`). Negative checks: 54 for the Worker (`negative-checks-pendaftaran.mjs`: the area check of each write and read, the stale check and the version in the UPDATE, the revocation and note rules, the in-use guard, the publish preconditions in the check and in the write, the prefix-only search, no applicant data in the audit row, the plans and round trips, the purge and the file cleanup, the SPA and the Worker agreeing) and 24 for the SPA (`negative-checks-spa-pendaftaran.mjs`: the write affordances of each screen, the default batch, "Semua batch", the search box's promise, the revocation form, the version sent with a review, clickable links); each breaks one safeguard, the tests fail, the file is restored.

## What is not verified

- **Anything visual or in a browser**: nothing was opened (the brief and Dzul's rule). The layout, the sticky bar, the native `<dialog>` of the delete question, the file picker and its progress bar, the grouped list at phone width, the look of the revocation warning and of the red button need Dzul's eyes (`pnpm dev:spa:mock`).
- **The tab "Draf dengan berkas"** (SAKEM-093): nothing was opened in a browser (the layout of the tabs and of the table at phone width, the dialog, the date format on a real device): Dzul's check with `pnpm dev:spa:mock`. The Worker's side ran only against the local D1 and the emulated R2.
- **Worker CPU** and the **real D1 rows read** (SAKEM-084). The plan assertions and rows read are those of the local D1.
- **Real R2 and the public files domain**: tests use the emulated bucket; the owner steps of [`uploads.md`](uploads.md) are still to do.
- **The public site reading the new payload**: the contract test calls `GET /api/public/resources` of the Worker; the Astro site and its cache were not run against it.
- **The portal** (the student's side of results and of the applicant's documents).
- The root app's gates: not run (root dependencies are not installed here; this branch changes nothing outside `cf/admin` and `docs/cloudflare`).

## Open decisions for Dzul

Answered by the PM on 2026-10-12 (the rest stands as built):

1. **The revocation reason stays out of the audit row** (names only, the strict default; Dzul decides privacy rules). The reason is only in the application's `review_notes`, which a later decision replaces. If Dzul wants it permanent, the options are the note in the `application.revoke` row alone (the audit log then holds free text about a person, and it must stay out of what Aktivitas shows), or a history of review notes.
2. **New texts approved in principle**: the notice after a review ("Status pendaftar berhasil diubah."), "Detail" / "Lihat Data" for a read-only role, "Belum diputuskan" (the list's column), "Tidak ada deskripsi.", the delete refusal of a batch ("Batch ini masih punya pendaftar, jadi tidak bisa dihapus."), the sentence about where a revocation reason is kept, the hint "PDF, PNG, JPEG, atau WebP. Maksimal 25 MB.", and "Bukti Marketing". The section for the documents an applicant linked is **"Tautan berkas"** (exact: they are pasted links).
3. **Delete a batch**: kept. An editor of Pendaftaran may delete a batch with no applicants.
4. **The default of the applicants list** (the newest batch), and a status link without a batch meaning every batch: kept as built.
5. **`GET applications?batch=all` counts the table** (about 900 index entries after three years): kept; no composite index (it would replace an index the dashboard's plan tests name).
6. **Aktivitas labels**: `batch.delete` has its label in `spa/src/lib/audit.ts` (`NEW_ACTION_LABEL`) and `application.revoke` has the legacy one ("Penerimaan dicabut"); both are declared (`src/audit/lists.ts`, through the CRUD names and the verbs of `src/db/audit.ts`), which the Aktivitas suites check.

Still open:

7. **Applicant documents in the portal milestone** need a private bucket if applicants upload instead of pasting links. **Decided 2026-10-13** (uploads, a private bucket, reads only through a Worker, an audit row per admin view; a viewer cannot open a file; nothing is deleted automatically, only by the purge): design in [`portal-architecture.md`](portal-architecture.md#8-d6-private-file-storage), built by P4 (SAKEM-083) as the paragraph "Applicant documents, from the new portal" above says. New admin texts of that task, for Dzul's approval: "Berkas", "Berkas hanya bisa dibuka oleh tim Pendaftaran.", "Lihat" / "Unduh", "Berkas Pendaftar", "Hapus Semua Berkas", the question "Hapus semua berkas pendaftar ini?" with "... akan dihapus permanen dan tidak bisa dikembalikan. Penghapusan tercatat di Aktivitas, tanpa nama atau isi berkas.", the notices "Semua berkas pendaftar sudah dihapus." and "Berkas sudah dihapus dari daftar, tetapi sebagian belum terhapus dari penyimpanan. Sistem akan mencoba lagi otomatis.", and the Aktivitas labels "Berkas pendaftar dibuka", "Berkas pendaftar dihapus" and "Berkas pendaftar".
