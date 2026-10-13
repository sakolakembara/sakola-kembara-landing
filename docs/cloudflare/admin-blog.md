# Blog in the new admin: render, sanitiser, API, editor, import

How the blog is managed in the new admin (`cf/admin`) and how the 80 migrated articles got there. Ticket: SAKEM-082 (M3), the **Blog** menu of the **Konten Situs** area. The legacy admin wrote markdown files to the container disk (`app/(admin)/admin/blog`, `lib/blog-writer.ts`), which a redeploy erased; here an article is a row of `blog_posts` in D1, the markdown is rendered to sanitised HTML **when it is saved**, and the public site shows it without a build.

Read first: [`admin-crud.md`](admin-crud.md) (the conventions and the kit this follows), [`content-api.md`](content-api.md) (what the public site reads), [`uploads.md`](uploads.md) (the images). The look and the Indonesian copy are fixed ([`../../DESIGN.md`](../../DESIGN.md), [`../context/tone-of-voice.md`](../context/tone-of-voice.md)); the texts of the screens are the legacy ones, and the few new ones are listed [at the end](#new-texts-for-review).

## Contents

1. [Where things are](#1-where-things-are)
2. [Decisions](#2-decisions)
3. [The render pipeline](#3-the-render-pipeline)
4. [The sanitiser](#4-the-sanitiser)
5. [The API](#5-the-api)
6. [States and rules](#6-states-and-rules)
7. [Images](#7-images)
8. [The screens](#8-the-screens)
9. [Import of the 80 migrated articles](#9-import-of-the-80-migrated-articles)
10. [Differences from the legacy admin](#10-differences-from-the-legacy-admin)
11. [Measured](#11-measured)
12. [Tests and negative checks](#12-tests-and-negative-checks)
13. [Not verified, and the decisions taken](#13-not-verified-and-the-decisions-taken)

## 1. Where things are

| What | Where |
| --- | --- |
| Render, sanitiser, image table, slug and date rules | `cf/admin/src/blog/` (`render.ts`, `sanitize.ts`, `images.ts` with `legacy-images.json`, `rules.ts`) |
| The routes `/api/admin/blog` | `cf/admin/src/api/blog.ts` (mounted in `src/worker.ts`) |
| Screens, preview, image insertion | `cf/admin/spa/src/pages/blog/` (registered for `/blog` in `pages/screens/konten.ts`) |
| Mock for `pnpm dev:spa:mock` | `cf/admin/spa/src/mock/resources/blog.ts` |
| The import of the 80 articles | `cf/admin/scripts/import-legacy-blog.ts` (`pnpm blog:import:local`) |
| Table of legacy images | `pnpm blog:legacy-images` writes `src/blog/legacy-images.json` |
| Render timing | `pnpm measure:blog` |
| GIF for blog images | `src/uploads/{sniff,kinds,key}.ts`, [`uploads.md`](uploads.md) |

No migration: `blog_posts` (migration `0003`, with the index of `0004`) already holds everything. `db:drift` stays clean.

## 2. Decisions

Decided by Dzul or the PM (not re-opened): the blog is managed in the new admin, in D1; markdown is rendered to HTML at save time and stored in `blog_posts.content_html`; images are uploads (`blog-image`, paths `/uploads/...`, sizes recorded at upload) and the public site prefixes `UPLOADS_BASE_URL`; the 80 articles keep their URLs and their inline images keep `srcset`, `width` and `height`; GIF is accepted for blog images.

Made here, with the reason (each is one constant or one line, so it is cheap to change):

| Decision | Why |
| --- | --- |
| **The body is limited to 12,000 characters** (the legacy limit was 80,000). | Rendering is the one heavy thing a save does: about 0.45 ms of CPU per 1,000 characters once warm, two to three times that in a fresh isolate, against 10 ms per request on Free ([section 11](#11-measured)). The longest of the 80 articles is 8,340 characters, the median 4,444, so 12,000 is 1.4 times the longest there is. Re-measured when the PM asked whether 40,000 would do: 4.1 ms at 12,000, 12.2 ms at 40,000 (warm, wall), so it stays. It is `BODY_MAX` in `src/blog/rules.ts`; raise it only with a measurement from a real Free account (SAKEM-084). |
| **A draft is saved with the same rules as a published article** (no partial drafts). | One validation, so publishing never has to re-check anything. The legacy form had no drafts at all. |
| **A new article is always a draft.** Publishing is its own step: `POST /:id/publish`. | The legacy admin made every saved article public at once; a draft state needs this step, and the SPA's "Terbitkan" saves what was typed first and then publishes, so it is still one click. |
| **The date field means "the day shown on the article".** Empty on a draft = the day it is published. | Keeps the legacy "Tanggal Publikasi" field and still lets publishing set `published_at` (a draft has none until it is dated or published). Unpublishing keeps the date, so publishing again does not move the article in the list. |
| **A slug is made from the title** on create (the legacy `slugify`, numbered `-2`, `-3` when taken) **and can be typed.** It is editable while the article is a draft and **locked once it is published.** | The legacy slug was never editable (it was the file name). A draft has no public URL yet, so fixing a typo in its slug costs nothing; a published one is the URL, shared and indexed. See [redirects](#slug-and-redirects). |
| **Featured is the legacy flag**: any number of articles can carry it; the public site shows the newest flagged one. | That is what the legacy page and the contract do (`pickFeatured`). Nothing enforces "only one". |
| **The list searches the title and the excerpt, containing the text** (not by prefix). | That is the legacy search; the kit supports it, and with about 80 rows a scan costs 160 rows read per search. (The brief said "title prefix"; say if you want that instead.) |
| **A cover is an upload of kind `blog-image` or a file of the legacy blog (`/blog/images/...`).** Its size is read from `media` or from the table of the asset manifest, never from the client. | The kit's check accepts every legacy folder and no `@`; five of the blog's files have an `@`. A client that sends a size cannot make the page lie about it. |
| **Uploaded inline images render like the legacy local ones** (wrapper `span`, `w-full h-auto`), with their recorded size. | Same look as the 80 articles; no layout shift. |
| **The preview is a write route with its own limiter**, `RL_BLOG_PREVIEW`: 60 a minute per user. | `POST` is a write by the kit's convention. Every request is a render on the Worker, so a stuck client or a stolen session must not be able to spend its CPU; the SPA debounces and remembers answers, so a person never meets the limit. |
| **No scheduling.** A published article with a future date is shown at once, as in the legacy admin. | "If needed" in the ticket; the legacy had none, and the public query does not look at the clock. |

## 3. The render pipeline

`renderArticle(markdown, { images? })` in `src/blog/render.ts` is one pure function: markdown in, `{ html, removed }` out. It runs **when an article is saved and for the editor's preview**, never on a public read.

```
remark-parse -> remark-gfm -> remark-rehype (no raw HTML) -> the legacy a and img rules -> the sanitiser -> rehype-stringify
```

It is the pipeline of `cf/web/plugins/blog-content.mjs`, the build plugin that rendered the 80 articles into the pages: the same libraries, the same steps, the same `a` and `img` rules (links to `http` open in a new tab, every link gets `rel="noopener noreferrer"`; an image is `loading="lazy" decoding="async"` with the legacy classes; a local picture sits in a wrapper `span`). Raw HTML in the markdown is dropped, as react-markdown did. The one step added is the sanitiser ([section 4](#4-the-sanitiser)), which removes nothing from the 80.

**Proof of equality.** `test/blog-render-parity.test.ts` renders all 80 articles with `renderArticle` and compares them with what `createBlogReader` of the plugin produces, **byte for byte**: no whitespace normalising, no attribute reordering. The comparison data (the plugin's HTML, and the answers of cf/web's fixture API) is made in Node by a vitest `globalSetup` (`test/global/blog-oracle.ts`: workerd has no file system) and handed to the tests with `inject("blogOracle")`; it needs `pnpm install` in cf/web and fails loudly when that is missing.

**Images.** The renderer asks an `images` lookup for what it knows about an inline image by its path:

- **Legacy files** (`/blog/images/...`, 234): size, the WebP ladder for `srcset`/`sizes` and the `@`-safe `%40` URL, from `src/blog/legacy-images.json` (`[width, height, hash]` per file, 22 KB, generated from cf/web's image manifest by `pnpm blog:legacy-images`). Without it, saving an imported article again would lose the `srcset`, `width` and `height` of its pictures. A test compares the table with the manifest and fails with the command to run when they differ.
- **Uploads** (`/uploads/blog-image/...`): the size recorded in `media`, looked up in **one** `IN` statement per save or preview, and none when the text mentions no upload.

Where the cost is, and what a save does about it:

- A save whose text did not change (a new title, category, featured flag, cover) **keeps the stored HTML**: no render.
- The body limit above, so the worst case is bounded.
- The libraries are bundled once; `contentMarkdown` stays the source of truth, so a change of the renderer means re-rendering stored articles (not built: it would be a loop over `blog_posts` in a script).

## 4. The sanitiser

`src/blog/sanitize.ts` is an **allow-list over the tree** the markdown renderer produced (no HTML is parsed again, and no regular expression runs over the article). The public site injects `contentHtml` unescaped (`set:html`), so this is what makes that safe, and it also protects the admin, which shows the preview with `dangerouslySetInnerHTML`.

| | Rule |
| --- | --- |
| Elements | Only what markdown makes: `p br hr h1-h6 blockquote ul ol li strong em del code pre a img table thead tbody tr th td input section sup span`. `script style iframe frame object embed applet svg math template noscript head title base link meta form button select textarea option audio video source track canvas portal dialog slot` are removed **with their content**; any other element loses its tags and keeps its words. Comments, doctypes and `raw` nodes are removed. |
| Attributes | A list per element, each with its own check: `a`: `href title target rel` (+ the footnote ones); `img`: `src alt srcset sizes width height loading decoding class`; `ol start`; `th td align`; `input type=checkbox checked disabled`; `class` only with the classes the renderer writes. Everything else (`onerror`, `style`, `srcdoc`, `formaction`, ...) is simply not on the list. |
| Link addresses | `http:`, `https:`, `mailto:`, `tel:`, a path, a relative path or a fragment. `javascript:`, `data:`, `vbscript:`, `file:`, `ftp:`, `//host` and `\\host` are refused, however spelled: the address is also looked at after percent-decoding, with tabs and newlines inside dropped and leading control characters trimmed, and an address with whitespace or a control character is refused. A refused link **loses its tags and keeps its text**. |
| Image addresses | `/uploads/blog-image/...` of the exact key shape, `/blog/images/...` (no `..`), or `https://` without credentials. **Any other image is removed** (an `http:` image, `data:`, an upload of another kind, a protocol-relative URL). |
| `srcset`, `sizes`, `width`, `height` | `srcset` only as `/_img/<hash>-<width>.webp <width>w, ...`; `sizes` only the one the renderer writes; integers only; both dimensions or neither. |
| Links | Every link carries `rel="noopener noreferrer"`; `target="_blank"` only on a link that leaves the site. A hostile `target` or `rel` is replaced. |

The markdown parser already drops raw HTML, so a typed `<script>` never reaches the tree; but it does **not** filter addresses (`[x](javascript:...)` reaches the tree as written), and the sanitiser is the second wall if a pipeline change ever lets raw HTML through. `test/blog-sanitize.test.ts` proves both: through `renderArticle` (the URL rules, text and code escaped, the features intact) and behind a pipeline that **does** let raw HTML through (`rehype-raw`, a test-only dependency) with an attack list of 36 cases (scripts with attributes, `onerror`, `javascript:` links and obfuscated ones, iframes, SVG, `math`, `object`, `embed`, forms, `style` elements and attributes, a `base`, a meta refresh, nested and doubled tags, comments and CDATA, `details` with `ontoggle`, a `data:` image, a hostile `target`/`rel`, ids and classes). An `audit()` reads the output as a browser would and fails on any tag, attribute or address outside the allow-list.

## 5. The API

All under `/api/admin/blog`, area **`konten`**; the conventions (envelopes, errors, `If-Match`, audit, purge) are [`admin-crud.md`](admin-crud.md). Create, update and the verbs are written by hand from the kit's functions; the list is hand-written because the kit's would read the two long columns of every row; `GET /:id` and `DELETE /:id` are the kit's.

| Method and path | Guard | What it does |
| --- | --- | --- |
| `GET /` | read | `{ items, page, pageSize, total }`. Filters `status` (`draft`, `published`) and `category` (the fixed list); `q` searches the title and the excerpt; `sort` from `updatedAt`, `publishedAt`, `createdAt`, `title` (default `-updatedAt`). An item: `id slug title excerpt category author featured status date createdAt updatedAt`, with the WordPress `[...]` trailer cleaned from the excerpt; never the markdown or the HTML. |
| `POST /` | write | Creates a **draft**. `201 { item }`. A slug taken is `409 conflict` on `slug`. |
| `GET /:id` | read | `{ item }` with the form's values: the item above plus `contentMarkdown image imageWidth imageHeight`. Never `contentHtml`, `wpId`, `sourceUrl` or a user id. |
| `PUT /:id` | write, `If-Match` | Replaces the form. Renders when the text changed. `409 stale` for an old version. |
| `POST /:id/publish` | write, `If-Match` | `status = published`; `published_at` is the article's day if it has one, otherwise now. `200 { item }`. Already published: `200`, nothing written. |
| `POST /:id/unpublish` | write, `If-Match` | `status = draft`; the date stays. |
| `DELETE /:id` | write | `204`. Removes the article, then the uploads only it used. |
| `POST /preview` | write, limiter | `{ contentMarkdown }` -> `{ html }`: the render a save would store, with the same sizes, nothing saved. An empty text is `{ html: "" }`; above the limit is `400` on `contentMarkdown`. **Limited to 60 a minute per signed-in user** (binding `RL_BLOG_PREVIEW`, key `blog-preview:<user id>`): a refusal is `429` with `Retry-After: 60` and "Terlalu banyak permintaan pratinjau. Silakan tunggu satu menit lalu coba lagi.", decided after the role check and before the body is read; in production a missing binding is `503 service_unavailable` (the brake fails closed); in a local run without the binding the same numbers are counted in memory (`src/security/rate-limit.ts`). The editor asks at most once per 400 ms pause in typing, so a person does not meet it. Placeholder namespace id 7822, to be replaced with the others by the deploy ticket. |

The form (create and update):

| Field | Rule (legacy message) |
| --- | --- |
| `title` | 3 to 200 ("Judul minimal 3 karakter", "Judul maksimal 200 karakter") |
| `slug` | optional; lower-cased; `a-z 0-9` with single hyphens, up to 160 ("Slug hanya boleh huruf kecil, angka, dan tanda hubung"); empty = made from the title |
| `category` | `Career Cerita Education Kiat kiat News Testimonials Tips Uncategorized` ("Kategori tidak dikenal") |
| `excerpt` | 20 to 500 ("Excerpt minimal 20 karakter", "Maksimal 500 karakter"). **The minimum applies to a text the writer changes:** on an update, an excerpt equal to the stored one (trimmed) stays valid whatever its length, so the one article imported with 14 characters (`daffa-najwan`, "Manajemen, UGM") can be edited around; a new article, or an excerpt changed to something under 20, is refused. The maximum has no exception |
| `contentMarkdown` | 50 to 12,000 ("Isi minimal 50 karakter", "Isi maksimal 12.000 karakter") |
| `author` | 2 to 120 ("Wajib diisi", "Maksimal 120 karakter") |
| `featured` | boolean |
| `date` | `YYYY-MM-DD` of a real day, or empty ("Format harus YYYY-MM-DD") |
| `image` | an upload of kind `blog-image`, a file of `/blog/images/`, or empty ("Berkas tidak valid. Unggah ulang berkasnya.") |

Rules that need the stored row: the excerpt's minimum (above), the slug of a published article cannot change (400 on `slug`: "Slug tidak bisa diubah setelah artikel terbit"); a published article must keep a date (400 on `date`, "Format harus YYYY-MM-DD").

**Audit rows** (field names only, never a value): `blog.create`, `blog.update` (the names that changed), `blog.publish` (`["status", "publishedAt"]` the first time, `["status"]` after), `blog.unpublish`, `blog.delete`; label = the title (public content). `blog.publish` and `blog.unpublish` are new names: declared in `src/db/audit.ts` and in `src/audit/lists.ts` (the list Aktivitas filters by; the compiler fails until both agree), with the labels "Artikel diterbitkan" and "Artikel dikembalikan menjadi draf" in `spa/src/lib/audit.ts` ([`admin-sistem.md`](admin-sistem.md)).

**Public side.** A change that touches an article that is, or just stopped being, public calls `notifyContentChanged({ area: "blog", slug })` after the commit. A draft's own edits call nothing. With the default purger that is the TTL, as in [`public-api.md`](public-api.md).

**Uploads.** After a save or a delete, every upload the old row held (the cover and each `/uploads/` path in the markdown) that the new row does not is passed to `deleteUploadByPath`, which never removes a file another row still uses. A file uploaded in the editor and never saved stays (the CRUD doc's open item 5).

### D1 budget

| Request | Round trips |
| --- | --- |
| list | 1 (the page and the count, two statements; only short columns) |
| one | 1 |
| create | 2 (the slug range, then the insert and the audit row), plus 1 when the text or the cover mentions an upload |
| update | 2 (the read, then the update and the audit row), plus 1 for uploads |
| publish, unpublish | 2 |
| preview | 0, or 1 when the text mentions an upload |

Plans (`EXPLAIN QUERY PLAN`, kept in `test/blog.test.ts`): the slug range is `SEARCH ... USING COVERING INDEX blog_posts_slug_idx`; the lookup by id is a primary-key seek; the media lookup is `SEARCH media USING INDEX media_key_idx` per key. **The list is a `SCAN` with a temporary b-tree for the order**, on purpose: the table stays at about 80 rows (a few hundred in years), a list view reads about twice the table (2 x 80 rows), far inside 5 million a day, and an index per sort would cost a written row on every save. A save writes the row, its four indexes and the audit row with its three: about 9 rows of the 100,000 a day.

## 6. States and rules

```
              POST /                    POST /:id/publish
 (nothing) ---------------> draft  ---------------------------> published
                              ^   <---------------------------      |
                              |       POST /:id/unpublish           |
                              +----------- PUT (edits) -------------+
```

- **Publishing** sets `status`, and `published_at` if there is none (now). The public `date` and `dateISO` are the Jakarta day of `published_at`; `modifiedISO` is the day of `updated_at`.
- **The form's date** is stored as 00:00 in Jakarta of that day; saving an article with the day it already has keeps its exact instant (so the order among the day's articles does not change on every save), another day moves it.
- **A draft has no public existence**: the public API answers its slug with the contract's `404`, like an unknown one.
- **`If-Match`** guards the verbs as it guards a save: publishing a version someone else has since edited is `409 stale`, so the writer publishes what they saw.

### Slug and redirects

A slug is the URL (`/blog/<slug>`). Decided: **editable while a draft, locked once published** (also after an unpublish and a republish: the lock follows the status at the time of the save). Changing a slug that was public would break every link, bookmark and search result to it, and there is no redirect table in this admin, so the rule is "do not change a public URL" rather than "redirect it". A draft that was published once, then unpublished, can be re-slugged (its old URL is a `404` while it is a draft anyway); that is the one way to change a once-public URL, and it is a deliberate two-step. The WordPress redirects (the 80 `sourceUrl`s to `/blog/<slug>`) are handled in `cf/web` (`redirects.config.mjs`) and are not touched.

## 7. Images

- **Cover.** `UploadField` (kind `blog-image`) in the Detail tab. The form sends only the path; the Worker sets `imageWidth` and `imageHeight` from the `media` row (and refuses an upload path that has none), or from the legacy table for a `/blog/images/` file (both or neither: the table's CHECK). Replacing or removing the cover deletes the old file after the save.
- **Inline.** "Sisipkan Gambar" in the editor uploads the file (kind `blog-image`) and writes `![name](path)` at the cursor, on its own lines, with the alt text made from the file name (the legacy rule). At save and preview, an `/uploads/` image gets its recorded `width` and `height`.
- **Types.** PNG, JPEG, WebP and GIF, 5 MB, checked by content ([`uploads.md`](uploads.md)); AVIF is not accepted (the legacy blog took it).
- **On the public site** `UPLOADS_BASE_URL` is put in front of `/uploads/` paths, in the cover and inside `contentHtml` ([`uploads.md`](uploads.md#the-public-site-uploads_base_url)); the editor's preview does the same for the pictures it shows, from `GET /api/config`. A legacy file (`/blog/images/...`) is not served by the admin's host, so the preview shows its alt text and the cover's thumbnail is a placeholder: that is the admin, not the site.

## 8. The screens

`/blog` (list), `/blog/new` and `/blog/:id/edit` (one form), registered in `pages/screens/konten.ts`.

- **List** (`ListPage`): the legacy columns (title with its excerpt and a Featured tag, category, date) plus **Status** (a tag, "Terbit" or "Draf") and a status filter; search "Cari judul atau excerpt...", category filter, pagination; "Tulis Artikel Baru" for someone who can write; Edit and Hapus per row (a confirmation that names the article). A viewer sees the list and "Lihat".
- **Form** (`FormShell`): the legacy two tabs. **Detail**: Informasi Dasar (Judul, Slug, Excerpt), Klasifikasi & Publikasi (Kategori, Tanggal Publikasi, Penulis, Featured), Gambar Hero. **Konten**: Isi Artikel with "Tulis" and "Preview", "Sisipkan Gambar" and a character counter. The bar shows the status and, on an existing article, **"Terbitkan"** or **"Kembalikan ke Draf"**: they save what was typed first (when there are edits), then change the status with the version the save answered; a refused save publishes nothing. A refused form opens the tab with the first error, marks the tabs that have one, and a link of the error summary shows its tab first. Leaving with typed text asks "Tinggalkan halaman?" (the body counts); a `409` shows the stale warning with "Muat ulang".
- **"Lihat di publik"** next to the status and the address of a published article, when `SITE_URL` is configured ([below](#the-link-lihat-di-publik)).
- **Preview.** `POST /preview` with the body, shown in `.blog-content` like the public page. It asks **only while the preview is on screen**, the first time at once, later changes **debounced** (400 ms) with the request in flight aborted, remembers the last answer (switching back without typing asks nothing), and answers an empty text and one above the limit itself. Every request is a Worker request with a render in it, which is why it asks as little as it can, and why the Worker counts them (60 a minute per user): a refusal shows the Worker's sentence, with "Coba lagi".
- **A read-only role** (viewer) gets both parts on **one page** (no tabs: they sit inside the disabled fieldset), every field disabled, no Simpan, no "Terbitkan", no cover buttons, no "Sisipkan Gambar" and no Preview (the route is write-only). Another editor (without `konten`) gets the 403 page and the API answers 403.
- **Mock** (`pnpm dev:spa:mock`, `?mock=viewer|editor|editor:konten,komunikasi|super_admin|student`): eight articles, the legacy rules, the slug lock, drafts and publish with `If-Match`, and a **stand-in** preview (headings, paragraphs, lists, bold, italic, links, images; escaped) so the screen can be seen without the Worker. The blog uses the generic mock store's `custom` hook for the routes the five of the contract do not cover (see [`admin-crud.md`](admin-crud.md#16-the-mock-build-a-screen-without-a-backend)).

## 9. Import of the 80 migrated articles

`scripts/import-legacy-blog.ts` reads `content/blog/*.md` at the repo root and writes, per article, one **idempotent upsert by slug**:

- the markdown as it is (`content.trim()`), and the HTML rendered with **the same `renderArticle`** the admin uses, with each inline image's size, `srcset` and `@`-safe URL from the public site's image manifest;
- `status = published`, `published_at` = 00:00 Jakarta of `dateISO`, `updated_at` = 00:00 Jakarta of `modifiedISO`, `featured` as in the file (one article), the cover path as it was with its size from the manifest, the WordPress id and source URL (internal, never exposed);
- the files' `date` text must equal what `dateISO` gives (all 80 do; the script refuses a file that differs, since the site derives the text from the instant).

Rows are inserted **oldest first and, within one day, by slug descending**: the public list orders by publication time and then by row order (newest row first), so that reproduces the build's order for articles of one day (slug ascending).

**Idempotent and safe to repeat**: `ON CONFLICT(slug) DO UPDATE ... WHERE updated_by IS NULL AND wp_id IS excluded.wp_id`. A row is rewritten only while it still has the imported WordPress id and **has not been edited in the admin** (every admin save sets `updated_by`); an article an editor changed is never overwritten, and running it again changes nothing. Each statement is **one physical line** (a newline in a text is written with `replace(..., marker, char(10))`, not `||char(10)||`: D1 refuses an expression tree deeper than 100, and an article has hundreds of lines), under D1's 100 KB per statement (the largest is about 21 KB; the whole file is 969,042 characters, 80 lines).

### Running it locally

```sh
cd cf/admin
pnpm install --frozen-lockfile           # and in cf/web: the script reads its image manifest
pnpm db:migrate:local                    # the local D1 (the one wrangler dev uses)
pnpm blog:import:local                   # 80 articles; run it again: nothing changes
pnpm blog:import:local -- --out FILE     # write the SQL only, apply nothing
```

The script **refuses `--remote`** and only ever runs `wrangler d1 execute sakem-admin --local`. It never talks to Cloudflare.

### Running the import against staging or production (later, with the owner's explicit approval)

Not done and not scripted to run by itself. When the real database exists (SAKEM-084) and the owner agrees:

1. In `cf/admin`: `pnpm blog:import:local -- --out /tmp/legacy-blog.sql` (the SQL does not depend on the database).
2. Read the file (80 lines). Confirm the target is the right database and that the migrations are applied there.
3. The owner runs `wrangler d1 execute <database> --remote --file /tmp/legacy-blog.sql` (production: only after staging looked right).
4. Check: `SELECT count(*) FROM blog_posts` is 80; `GET /api/public/blog` shows 15 on page 1 and the featured article; open two articles with images.

The same file can be applied again after an editor changed some articles: those are left alone.

### How it is tested

`test/blog-import.test.ts` runs the script's SQL against the real local D1 of the test (through `exec`, which is why a statement must be one line), then compares the **public API through the `PublicApi` entrypoint** with cf/web's **fixture API** (`scripts/fixture-api.mjs`, which generates the 80 articles with the build's own reader and the contract's rules): the index at page sizes 15 and 50 page by page, and the payload of **every one of the 80 articles** with its `related`: titles, slugs, dates, excerpts, covers and sizes, `contentHtml`, `contentMarkdown`. Equal for all 80. It also runs the import again (same rows, same ids), proves an edited article survives it, and opens each of the 80 in the editor API and saves it unchanged.

**A finding from that last test:** one article cannot be saved again as it is: **`daffa-najwan`** (a WordPress testimonial) has an excerpt of 14 characters ("Manajemen, UGM"), and the rule since the legacy form is "Excerpt minimal 20 karakter". It was never editable in the legacy admin either. The rule is kept; whoever edits that article lengthens the excerpt first (open decision below). Every other article saves unchanged.

## 10. Differences from the legacy admin

| Legacy | Here | Why |
| --- | --- | --- |
| Markdown files on the container disk, lost on redeploy | Rows of `blog_posts` in D1 | Workers has no disk |
| Every saved article was public at once | Draft and published states; "Terbitkan" | A CMS needs to save without publishing; the screens keep working for one-click publish |
| Body at most 80,000 characters | 12,000 | Rendering on the Worker; see section 2 |
| Slug made from the title, never editable | Made from the title, editable while a draft, locked once published | Section 6 |
| Hero: a free text path or an upload, any text accepted | An upload (PNG, JPEG, WebP, GIF) or a legacy `/blog/images/` file; no pasted URLs | The size must be known and the file must exist |
| Images 5 MB: jpg, png, webp, gif, avif | PNG, JPEG, WebP, GIF, checked by content; no AVIF | [`uploads.md`](uploads.md) |
| Preview rendered in the browser by react-markdown | Rendered by the Worker with the pipeline that stores | What is shown is what is stored |
| List: all 80 on one page, sorted by date | Paged (20), sorted by last edit, with a status filter | Kit conventions |
| `date` text stored | Derived from the publication instant in Jakarta | One source of truth |
| A viewer could change everything (SAKEM-013) | A viewer reads; another editor sees nothing | The permission model |
| No audit of publishing | `blog.publish`, `blog.unpublish` | New states |
| "Lihat di publik" link in the editor | None: the admin does not know the site's address | Different host |

## 11. Measured

Machine of the author, Node 22, the pipeline bundled the way wrangler bundles it. **CPU on the Worker cannot be measured locally** (workerd freezes its timers during synchronous code); these are hints, and SAKEM-084 measures on a Free account. Reproduce with `pnpm measure:blog`.

| | Number |
| --- | --- |
| Worker bundle (`wrangler deploy --dry-run`), before | 2,940.93 KiB, 511.02 KiB gzip |
| Worker bundle, after | **3,463.96 KiB, 619.84 KiB gzip** (+523.0 KiB, +108.8 KiB gzip: unified, remark, micromark, the sanitiser, the 22 KB image table). The Free limit was 3 MiB *compressed* when this was written (a fifth of it); it is now 64 MiB uncompressed with no compressed limit ([`free-plan-audit.md`](free-plan-audit.md#21-worker-size)) |
| SPA build (`build:spa`), before and after | JS 425.87 kB (133.52 kB gzip) to 450.96 kB (140.99 kB gzip): +25.1 kB, +7.5 kB gzip for the screens, the editor and the preview hook (no markdown library in the browser); CSS 48.33 kB to 49.57 kB. The mock is not in the build (`check:spa`) |
| After the rebase on `cloudflare` 9f72cae (Sistem, Komunikasi, Konten-misc and Pendaftaran merged, so these are totals of the integrated tree, not of the blog alone), with the preview limiter and `SITE_URL` | Worker 3,537.10 KiB, 637.98 KiB gzip; SPA JS 556.64 kB (167.24 kB gzip in the build log), CSS 53.27 kB |
| The renderer alone, bundled | 480 KB unminified (micromark 65 KB, character entities 44 KB, the app 37 KB, property-information 30 KB, ...) |
| Evaluating the bundled renderer (what a fresh isolate pays once) | about 8 ms |
| 80 articles, warm, wall time per article | median 1.5 ms, p95 2.7 ms, max 4.3 ms (quiet machine) |
| The longest article (8,340 characters), warm | about 3.9 ms (CPU about 5.5 ms with the JIT threads) |
| **The same script on a loaded machine** (other workers running, load average 14, run twice) | the 80 articles: median 1.7 to 2.0 ms, p95 3.8 to 4.7 ms; the longest article 5.0 to 5.9 ms; 8,000 characters 4.5 to 5.2 ms; 80,000 characters 33 to 35 ms; the first render 22 to 25 ms. Treat every figure here as "within a factor of 1.5", which the cap leaves room for |
| Synthetic articles, warm, wall time (CPU in brackets), measured again for the PM's question about the limit | 8,000 characters 3.3 ms (3.6); **12,000 (the limit): 4.1 ms (4.9)**; 20,000: 6.2 ms (6.3); **40,000: 12.2 ms (14.3), over the 10 ms of Free even warm**; 80,000 (the legacy limit): 23.9 ms (35.1) |
| The **first** render in a fresh process (a typical 4,200-character article) | 12 to 14 ms; the longest article 20 ms. With a throw-away render at module load: 6 to 7 ms, and 9 to 12 ms for the longest |
| The sanitiser alone, on the longest article | 0.02 ms (the rest of the pipeline is parsing: the GFM extensions are about half) |

What this says, plainly:

- **Warm, a save fits** (the longest article renders in 4 ms, the cap keeps any article under about 6 ms).
- **A fresh isolate probably does not always fit.** The first render pays for compiling the parser; on Free, an admin who saves a few times a week mostly hits fresh isolates. If SAKEM-084 shows saves failing with "exceeded CPU", the options, in order of cost: **(a)** a lower `BODY_MAX`; **(b)** render once at module load (the throw-away render halves the first real one; it moves the cost to the isolate's start-up, whose accounting must be checked on a real account); **(c)** a lighter renderer written for the subset in use (the parity test would then have to be loosened, since its output differs from the build's); **(d)** **render in the browser and have the Worker only sanitise and stringify**: the SPA already ships the libraries' equivalents; it would send the tree (JSON) and the Worker would run `sanitizeTree` (0.02 ms) and `rehype-stringify` (under 1 ms), no markdown parsing on the Worker at all. (d) is the real fix and changes where the render runs, which is why it is not done without a decision.
- The preview is the same render, per request; it is debounced, remembered and only runs while the preview is on screen.

## 12. Tests and negative checks

After the rebase on `cloudflare` 9f72cae (all areas merged, so the totals are the integrated tree's, not the blog's alone): Worker **1,961 tests** (57 files), SPA **1,168** (48 files), all exit 0, with `typecheck`, `build:spa`, `check:spa` and `db:drift`. The blog's own negative checks are Worker **64** (the blog, GIF, the preview limiter, the excerpt rule, `SITE_URL`) and SPA **30**, run with `node scripts/negative-checks.mjs --only "blog:"` and `node scripts/negative-checks-spa.mjs --only "blog:"`; the full suites run on the integrated head.

Worker (`cf/admin/test/`, workerd, real D1 and R2): `blog.test.ts` (roles and areas for all eight routes and nine callers, create, the legacy validation and the excerpt that is already there, list and filters, update and the stale and race rules, publish and unpublish and their public effect, the slug and date rules, featured, the purge hook and upload cleanup, hero and inline images, preview and its limiter, the D1 budget, query plans), `blog-render-parity.test.ts` (80 articles equal to the plugin; the legacy image table equal to the manifest), `blog-sanitize.test.ts` (the allow-list, the URL rules, 36 attacks), `blog-import.test.ts` (the 80 equal to the fixture API; idempotence), `blog-spa-contract.test.ts` (the SPA's limits, categories, dates, body and field names against the real Worker), and GIF cases in `uploads-sniff.test.ts` and `uploads.test.ts`.

SPA (`cf/admin/spa/test/`, jsdom): `blog.test.tsx` (the list, the form, tabs and error reveal, publish and unpublish, read-only, preview, image insertion, the cover), `blog-preview.test.ts` (the hook: debounce, abort, memory, limits), `blog-mock.test.ts` (the mock behaves like the Worker).

**Negative checks**: `scripts/negative-checks-blog.mjs` (Worker side) and `scripts/negative-checks-spa-blog.mjs`, registered with one import and one spread in `negative-checks.mjs` and `negative-checks-spa.mjs` (`pnpm test:negative`, `pnpm test:negative:spa`; `--only blog:` runs just these). Each breaks one safeguard (the sanitiser out of the pipeline, a scheme check, the area check of each route, the stale check, the version in the `UPDATE`, `If-Match`, the publish date, the slug lock, the date rule, the render at save, the reuse of stored HTML, the hero size source, the purge, the upload cleanup, GIF, the import's protection of edited articles, the read-only affordances, the preview's debounce and abort, ...) and requires the tests to fail.

## 13. Not verified, and the decisions taken

**Not verified here.** Nothing was opened in a browser: the look of the list, the form, the tabs, the sticky bar, the preview and the dialog, focus behaviour and the keyboard are Dzul's to check (`pnpm dev:spa:mock`, then `pnpm dev` with the local import). Not measured: Worker CPU (above), D1 rows read on real D1, R2 and the public files domain, the cache purge on a real zone, the service binding from `cf/web` against this Worker with imported rows beyond the equality tests. The imported articles were compared with the fixture API, not yet rendered by the real Astro site against this API (the earlier `public-api.md` run did that for the same rows).

**The questions this document first left open were answered by the PM on 2026-10-12** (Dzul only reviews the copy):

| # | Question | Answer, and where it is in the code |
| --- | --- | --- |
| 1 | Render on the Worker or in the browser | **On the Worker, for now.** Real CPU is measured at staging (SAKEM-084); the browser-render fallback (option (d) in [section 11](#11-measured)) stays documented. |
| 2 | The body limit | **12,000 characters stays.** Raised to the largest value that renders safely, measured: a 40,000-character article takes 12.2 ms wall (14.3 ms CPU) *warm*, about three times a 12,000 one (4.1 ms) and already above the 10 ms of Free before a fresh isolate's penalty; so it is not offered. The legacy 80,000 (24 ms wall, 35 ms CPU) would be two to three times the limit. `BODY_MAX` in `src/blog/rules.ts`. |
| 3 | `daffa-najwan` (14-character excerpt) | **The import keeps it** (it writes the row as it is) **and the edit form accepts an unchanged short excerpt**: the minimum applies when the excerpt changes (`src/api/blog.ts`, tests in `blog.test.ts`, `blog-import.test.ts`, `blog-spa-contract.test.ts` and the mock's). |
| 4 | Drafts | **Same validation as a published article.** |
| 5 | A limiter for the preview | **Added: `RL_BLOG_PREVIEW`**, 60 a minute per user, in `wrangler.jsonc`, `src/env.ts` and `src/security/rate-limit.ts`, with the in-memory fallback in development and fail-closed in production like the others. |
| 6 | Search | **"Contains"** in the title and the excerpt (a tiny table). |
| 7 | Slug | **Locked once published, no redirects.** |
| 8 | Cover as a pasted URL | **No.** |
| 9 | "Lihat di publik" | **Added**, built from the public variable `SITE_URL` ([below](#the-link-lihat-di-publik)). |
| 10 | List order | **Last edited first.** |
| 11 | New copy | Covered by Dzul's general approval for new fallback copy; the PM shows him the rest after the merge. |

### The link "Lihat di publik"

On the edit page of a **published** article, the bar shows a link "Lihat di publik" to `<SITE_URL>/blog/<slug>`, in a new tab (`rel="noopener noreferrer"`). A draft has no public page, so no link. `SITE_URL` is a public variable of the Worker, like `UPLOADS_BASE_URL`: the origin of the public site (`https://sakolakembara.org`), served to the SPA by `GET /api/config` as `siteUrl`. It is checked by the same rule as the files' address (`src/config/public-origin.ts`: an `http(s)` origin without a path, a trailing slash, userinfo, a quote or a space; anything else is "none"), and again in the SPA. **Empty, unset or not an origin means no link**: the admin never guesses the site's address. It is documented in `wrangler.jsonc` (a per-deploy variable, not committed with a value) and `dev.vars.example` (locally the Astro dev server, `http://localhost:4321`; the mock says the same). Laporan, Tim and Shortlink still read the constant of `spa/src/lib/site.ts`; they could take `siteUrl` from the same place later (`useConfig()` in `spa/src/lib/config.ts` gives both origins from one request).

### New texts for review

New copy with no legacy counterpart (the rest is the legacy admin's): the tag labels "Terbit" and "Draf"; the buttons "Terbitkan" and "Kembalikan ke Draf"; the notices "Artikel berhasil diterbitkan." and "Artikel dikembalikan menjadi draf."; the slug hints ("Kosongkan agar dibuat otomatis dari judul.", "Alamat artikel: /blog/slug. Bisa diubah selama artikel masih draf.", "Slug tidak bisa diubah setelah artikel terbit."), the field label "Slug" and its messages ("Slug hanya boleh huruf kecil, angka, dan tanda hubung", "Slug maksimal 160 karakter", "Slug sudah dipakai"); the date hint "Kosongkan agar terisi otomatis saat diterbitkan."; "Isi maksimal 12.000 karakter" and the counter "(maksimal 12.000)"; the cover hint "Pilih file (≤ 5 MB): PNG, JPEG, WebP, atau GIF."; "Memuat artikel...", "Memuat pratinjau...", "Belum ada isi." (the legacy preview said it in markdown), "Belum ada artikel. Klik “Tulis Artikel Baru” untuk membuat."; and the status filter's "Semua status".
