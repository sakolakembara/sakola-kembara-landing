# Uploads: R2, the admin API and the public domain

How the files the admin uploads (team photos, report PDFs, documents, blog images) are checked, stored and shown to visitors on Workers Free. Tickets: SAKEM-082 (admin) and SAKEM-081 (backend), the R2 foundation every later admin screen with a file or an image uses; SAKEM-080 for the public-site side. Code: `cf/admin/src/uploads/`, `cf/admin/src/api/uploads.ts`, `cf/admin/src/api/dev-uploads.ts`, `cf/web/src/lib/uploads.ts`.

Nothing here touches a Cloudflare account: the bucket binding in `wrangler.jsonc` is a placeholder name without an id, local runs and tests use Wrangler's emulated R2, and the owner's steps to make it real are at the [end](#owner-steps-bucket-domain-variable).

## Decisions (Dzul, 2026-10-12, and the PM's rules for this PR)

- **Files live in R2 and are served from a separate public domain.** No Worker request per download (that would spend the 100,000 a day of Workers Free on PDFs and photos) and no redeploy after an upload.
- **API payloads keep upload paths root-relative** (`/uploads/<kind>/<year>/<id>-<name>.<ext>`), as the legacy columns did. The public site puts `UPLOADS_BASE_URL` in front when it renders ([the rule](#the-public-site-uploads_base_url)).
- **Everything in the bucket is public.** The public domain serves any key. Never upload anything private through this API; applicant documents (a portal milestone) need a private bucket and signed access, not this one.

## What can be uploaded

One table, `cf/admin/src/uploads/kinds.ts`; the numbers are the legacy app's (`app/(admin)/admin/{team,blog,reports,resources}/actions.ts`), decimal megabytes as there.

| `kind` | Area that may upload (needs **write**) | `media.purpose` | Accepted (by content) | Largest | Key folder |
| --- | --- | --- | --- | --- | --- |
| `team-photo` | `konten` | `team` | PNG, JPEG, WebP | 5 MB | `uploads/team-photo/` |
| `blog-image` | `konten` | `blog` | PNG, JPEG, WebP | 5 MB | `uploads/blog-image/` |
| `report` | `konten` | `report` | PDF | 20 MB | `uploads/report/` |
| `resource` | `pendaftaran` | `resource` | PDF, PNG, JPEG, WebP | 25 MB | `uploads/resource/` |
| `registration-document` | `pendaftaran` | `resource` | PDF, PNG, JPEG, WebP | 25 MB | `uploads/registration-document/` |

`resource` and `registration-document` follow the same rules and share one `media.purpose` value (the column has four values and widening its CHECK is a table rebuild); they differ only in the key folder, which is what the list endpoint filters on. The legacy "Berkas Pendaftaran" is the Pusat Dokumen (`site_resources`), so they may be one thing; see [open decisions](#open-decisions).

**Request limits.** Cloudflare's request body limit is 100 MB on Free, so the largest kind (25 MB plus the multipart envelope, allowed up to 64 KiB) is far below it. The tighter bound is the Worker's 128 MB of memory: the multipart body is parsed in memory, once, natively, and the file stays a `Blob` that goes to R2 without a copy through JavaScript. That is why nothing above 25 MB is accepted.

### Checked by content, never by name or type

The client's `Content-Type` and the file name are chosen by whoever uploads (an `.exe` renamed `.png` says `image/png`), so neither is read. `cf/admin/src/uploads/sniff.ts`, no libraries, reads at most the first 1 MiB of the file:

| Type | Magic bytes | Size read from |
| --- | --- | --- |
| PNG | `89 50 4E 47 0D 0A 1A 0A`, then an `IHDR` chunk of length 13 | the IHDR, unsigned 32-bit |
| JPEG | `FF D8 FF`, then the marker segments are walked (each says its own length, at most 512 of them) | the start-of-frame segment, behind EXIF and ICC metadata (a header past 1 MiB is refused as unreadable) |
| WebP | `RIFF`, `WEBP`; the RIFF size must fit the file | `VP8 ` (lossy), `VP8L` (lossless) or `VP8X` (extended and animated) |
| PDF | `%PDF-1.` or `%PDF-2.` at byte 0 | none |

A file whose bytes are none of these is refused (`415`), a file with the right signature and a broken or cut-short header is refused (`422`). The size must be at least 1 pixel, at most **10,000 pixels on a side and 50 megapixels in all** (a browser needs about 4 bytes per pixel to show an image, so 50 MP is 200 MB): width and height are read as unsigned numbers, and `4294967295 x 4294967295` is refused like any other absurd size. Nothing decodes pixels or inflates data, so inspecting a "decompression bomb" costs the same as a small file; the dimension limits are what keep one from reaching a visitor.

### What is not accepted, and why

- **SVG.** The legacy app never accepted it. An SVG is a document that can carry scripts, and the public domain would serve it as an image anyone can open directly. Making it safe needs a sanitiser, which is a library and CPU the Free plan does not leave. Refused (`415`); logos and illustrations go through the asset pipeline (`cf/web`).
- **GIF and AVIF.** The legacy blog accepted GIF and AVIF and the team form AVIF. Not included here (the brief names PNG, JPEG and WebP). GIF is about ten lines to add (the size is in the header); AVIF needs an ISO-BMFF box walk. See [open decisions](#open-decisions).
- **Word, Excel, PowerPoint, zip.** The legacy resource action accepted any file. A zip-based format cannot be told from any other zip by its first bytes, so none is accepted. The fixture of `cf/web` even lists a `.docx` template, so this is a real gap for the Pusat Dokumen; see [open decisions](#open-decisions).
- **Not done:** EXIF is **not stripped** (a phone photo can carry a GPS position, and it is public once uploaded; stripping needs a re-encode), and a PDF is not inspected for scripts or links beyond its header.

## Where a file goes

```
uploads/<kind>/<yyyy>/<media id>-<slug>.<ext>      the R2 key
/uploads/<kind>/<yyyy>/<media id>-<slug>.<ext>     the path: what the API returns and content rows store
```

- `<kind>` is from the table above, never from the client's text. `<yyyy>` is the server's UTC year. `<media id>` is a new UUID per upload, so a key never collides and an object is never overwritten (the put is also conditional, `onlyIf: etagDoesNotMatch: "*"`).
- `<slug>` is rebuilt from the file name with a whitelist: accents folded, lowercased, anything other than `a-z0-9` becomes `-`, at most 60 characters, `file` when nothing is left. `../../etc/passwd`, `a\b`, a null byte, a right-to-left override, an emoji or 500 characters cannot put anything else in the key. The file name still ends up in the key, so a name with a person's name in it is public (the audit row and the key hold it, the logs do not).
- `<ext>` is `png`, `jpg`, `webp` or `pdf`, from the type found in the bytes.
- The object gets `Content-Type` from the same sniffed type and `Cache-Control: public, max-age=31536000, immutable` (the name is unique per upload, so a file never changes).
- `media.key` is the key. The path is `"/" + key`. A path that is not exactly this shape (the legacy static paths `/blog/images/...`, `/files/...`, `/images/...`) is not ours and is never looked up, rewritten or deleted.

## The API

All admin only, behind the area guard of [`d1-schema.md`](d1-schema.md#permission-model). A same-origin check applies to the writes like to every `/api` POST.

### `POST /api/admin/uploads`

`multipart/form-data` with `file` and `kind`. Optionally `?kind=<kind>` as well: then the area check and the size limit run **before the body is read**, and a different `kind` in the form is refused (`kind_mismatch`). The SPA's upload helper should always send both.

Order of the checks (the first failure answers):

| Status | `error` | When |
| --- | --- | --- |
| 401 | `unauthenticated` | no session |
| 403 | `forbidden` | cannot write any upload area (student, viewer, an editor with neither `konten` nor `pendaftaran`): refused before anything is read |
| 429 | `rate_limited` | 20 uploads and deletes a minute per user, `Retry-After: 60` |
| 415 | `multipart_required` | not `multipart/form-data` |
| 411 | `length_required` | no `Content-Length` (a chunked body would be buffered unbounded; browsers always send it for a form) |
| 400 | `invalid_kind` | `?kind=` unknown |
| 403 | `forbidden` | cannot write the area of `?kind=` |
| 413 | `too_large` | declared length above the kind's limit (or the largest kind's, without `?kind=`) plus 64 KiB of envelope |
| 400 | `invalid_form` | the body does not parse as a form |
| 400 | `invalid_kind`, `kind_mismatch` | `kind` of the form missing, unknown, or different from `?kind=` |
| 403 | `forbidden` | cannot write the area of the form's `kind` |
| 400 | `file_required`, `empty_file` | no file, a text field called `file`, a file of 0 bytes |
| 413 | `too_large` | the file is above the kind's limit (`maxBytes` in the body) |
| 415 | `unsupported_type` | not one of the four types, or not one of this kind's types (`allowed` lists the content types) |
| 422 | `invalid_file` | right signature, broken or cut-short header |
| 422 | `unreadable_size` | a JPEG whose frame header is past 1 MiB |
| 422 | `dimensions_too_large` | above 10,000 px a side or 50 MP (`maxSide`, `maxPixels`) |

Every refusal is `{ "error": "<code>", "message": "<Indonesian, ready to show>", ... }`. Success is `201`:

```json
{ "id": "d455e880-7da0-4d62-85cb-293a69fb913a", "path": "/uploads/blog-image/2026/d455e880-7da0-4d62-85cb-293a69fb913a-foto-lokal.png",
  "contentType": "image/png", "size": 45, "width": 16, "height": 8 }
```

`width` and `height` are `null` for a PDF. They are what a content row copies: `blog_posts.image_width` and `image_height`, the `<img width height>` of an inline image, the report's and the resource's `file_size` is `size`.

The object is stored first, then the `media` row and the `upload.create` audit row go in one D1 batch; if the batch fails the object is removed again.

### `GET /api/admin/uploads?kind=&page=&pageSize=`

What a picker lists: one kind, newest first, `pageSize` 1 to 50 (default 20), `page` from 1. Needs **read** access to the kind's area: a viewer or a super_admin lists every kind, an editor only the kinds of the areas granted to them (an editor has no read-only level, see the permission model in [`d1-schema.md`](d1-schema.md#permission-model)), so an editor of `konten` listing `resource` or `registration-document` gets `403 forbidden` with no items and no count. `{ items: [{ id, path, contentType, size, width, height, createdAt }], page, pageSize, total, totalPages }`; the uploader and the key are not part of it. One D1 round trip (the page and the total).

### `DELETE /api/admin/uploads/:id`

Removes the object and the `media` row only while **no content row references the path**, and needs write access to the area the file was uploaded for (from the row, not from the caller). `204` on success, `404` for an unknown id, `403` for the wrong area, and **`409 in_use`** with `usedBy: ["Blog", ...]` (the menus) while something still points at it. The reference check and the delete are one statement, so a reference saved a moment earlier cannot be missed; the `upload.delete` audit row is written in the same batch only if the delete took effect; the object is deleted last (a failure there leaves an unreferenced object and one fixed log line).

## How later screens use it

A content screen (team, reports, documents, blog) does **not** receive files. The flow is:

1. The SPA posts the file to `POST /api/admin/uploads` (with `kind`, and `?kind=`) and gets `{ path, size, width, height }`.
2. The screen saves the content row with that path (and `fileSize: size`, `imageWidth`/`imageHeight`), like it saved the legacy path. The row's own validation should accept `/uploads/...` paths (and keep accepting the legacy static ones).
3. When a save **replaces or removes** a path (a new photo, a deleted report), call the helper **after** the row was committed without the old path:

   ```ts
   import { deleteUploadByPath } from "../uploads/store";

   // c.env has DB and UPLOADS; `user` is the signed-in admin.
   await deleteUploadByPath(c.env, user, previousPath);
   // -> { status: "deleted" } | { status: "in_use", usedBy } | { status: "not_found" }
   ```

   It never throws for "not ours" (a legacy static path answers `not_found` and nothing happens) and it never removes a file a row still uses, so a handler can ignore the result: an object left behind is harmless, a file removed under a live page is not.
4. **When a table gets a column that can hold an upload or a link to one**, add it to `uploadReferences` in `cf/admin/src/uploads/references.ts`. `test/uploads-references.test.ts` fails when a table has a column named like a file, an image or a URL that is neither registered nor excluded with a reason. A column references a file when the path appears anywhere in it (plain text match, not a LIKE pattern, so `%` and `_` match only themselves), which also catches an absolute URL on the files domain, a shortlink to a PDF and an `<img>` inside a blog article.

Registered today: `reports.file_path`, `team_members.image`, `site_resources.file_path` and `external_url`, `blog_posts.image`, `content_markdown` and `content_html`, `announcements.cta_url`, `shortlinks.target_url`.

## Records, rate limit, logs

- **`media`** (already in the schema): `key`, `purpose`, `content_type`, `size`, `width`, `height`, `uploaded_by`. About 12 D1 rows are written per upload (the media row with its indexes, plus the audit row of 8), the same for a delete; nowhere near the 100,000 a day.
- **Audit:** `upload.create` (metadata: `kind`, `path`, `contentType`, `size`, `width`, `height`) and `upload.delete` (metadata: `path`), resource type `media`, actor = the admin. The legacy names were `blog.upload_image` and `team.upload_photo`; the Aktivitas labels for the new names are in `spa/src/lib/audit.ts` ("Berkas diunggah", "Berkas unggahan dihapus"; resource type `media`, "Berkas unggahan"), and the Aktivitas page does not show `path` (a file name can be a person's): see [`admin-sistem.md`](admin-sistem.md#33-what-a-row-shows).
- **Rate limit:** binding `RL_UPLOAD` (`wrangler.jsonc`, namespace id 7821 is a placeholder), 20 per 60 seconds, key `upload:<user id>` (not the address: an office shares one). It is checked before the body is read, so a refused request costs no parse. In a local run without the binding the in-memory fallback uses the same numbers; in production a missing binding answers 503.
- **R2 budget on Free:** 1 Class A operation (the put) per upload, none for a delete, 10 GB stored. At 20 uploads a minute per user the Class A budget (1 million a month) cannot be reached by one admin.
- **Logs:** none on success or on a refusal. The only lines are `[uploads] could not remove the object of a failed upload`, `[uploads] the media row was removed but its object could not be deleted` and the Worker's `[worker] unhandled error: <message>`. No file name, address, cookie or byte of a file is logged (a test checks it).

## Local development

- **Storage.** `wrangler dev` and the tests use an emulated R2 bucket (`.wrangler/state`, gitignored). No account, no `wrangler login`.
- **`GET /uploads/<key>`** serves an object from that emulation **only when `ENVIRONMENT=development`** (the same switch as `/api/dev/mailbox`) and only for a key of exactly the shape above. In production, in tests and with the variable unset it answers `404`, for a file that is in the bucket too (a test proves it). `wrangler.jsonc` lists `/uploads/*` in `assets.run_worker_first` so the Worker, not the SPA's `index.html`, answers that path; a stray request to the production admin host for an upload therefore costs one Worker request and gets a JSON 404.
- The Vite dev server (`pnpm dev:spa`) proxies `/uploads` like `/api`. For `cf/web`, set `UPLOADS_BASE_URL=http://localhost:8787` in `.dev.vars` to see uploaded photos and files on the public pages without a public domain.
- **Measuring:** `pnpm measure:upload -- --base http://127.0.0.1:8831` against a `wrangler dev` with the dev seed (the header of `scripts/measure-upload.ts` has the commands).

## The public site: `UPLOADS_BASE_URL`

A public Worker variable of `cf/web`, **empty or unset by default**, an origin without a trailing slash (`https://files.<your-domain>`; a trailing slash is dropped, and a value that is not a plain `http(s)` origin is treated as unset, so a typo breaks images but can never put a quote or `javascript:` into an attribute). `cf/web/src/lib/uploads.ts`:

- **Fields:** `uploadUrl(path, base)` for the API's `image` (team photo, blog cover, also in the list and the related cards) and `filePath` (report, document). Applied in `tim.astro`, `laporan.astro`, `gabung-siswa/docs.astro`, `blog/index.astro`, `blog/[slug].astro` (through `coverAttrs`, so the article's `og:image` and JSON-LD follow).
- **`contentHtml` of an article:** `rewriteUploadsInHtml(html, base)` prefixes the `src`, `href` and `poster` of any tag and every `/uploads/` candidate of a `srcset`. It is one linear scan over the tags (no HTML parser, no regex over the whole text), so its cost grows only with the length of the article.
- **Only paths that start with `/uploads/`** are touched. Not touched, and tested: the legacy static paths (`/blog/images/...`, `/files/...`, `/images/...`, `/reports/...`, `/resources/...`), absolute URLs (also one that already carries the files domain), `//host/uploads/...`, `/blog/uploads/...`, `data-src` and every other attribute, text that mentions a path (a `<code>` block shows `src="/uploads/x.png"` as written, because its `<` is escaped), comments, and a path with `..`, a space, `?` or `#`.
- **Empty or unset changes nothing**: the same string comes back, byte-identical HTML, same-origin paths (`pnpm test:e2e` runs on this and passes unchanged).
- The cache of the content API (`caches.default`) stores the root-relative payload, so changing the variable needs no purge.
- `pnpm test:e2e:uploads` (needs `pnpm build`) renders the five pages with and without the variable against the fixture API made to return upload paths.
- **Known behaviour:** the `download` attribute of the document buttons is ignored by browsers for a file on another origin, so a PDF opens in a tab instead of downloading. Setting `Content-Disposition` on the object at upload would change that; not done.

## Owner steps: bucket, domain, variable

None of this exists yet and none is done by the code. Account and token: [`account-setup.md`](account-setup.md).

1. **Create the bucket** in the organisation account (R2 is enabled; a billing or usage alert is recommended: the card is not a spending cap). Proposed names: `sakem-files` (production), `sakem-files-staging`.
2. **Public domain.** Bucket settings, **Custom Domains**, connect `files.<your-domain>`; the domain must be a zone on the same account, so this is a cutover step ([`account-setup.md`](account-setup.md), Part 4). Use a custom domain, not the `r2.dev` address, in production: `r2.dev` is meant for development and is rate limited. For staging before the zone exists, `r2.dev` with `UPLOADS_BASE_URL=https://pub-....r2.dev` works for looking, not for launch. Images and PDFs are loaded without CORS, so no CORS rule is needed until something fetches them with JavaScript.
3. **Bind it to the admin Worker** in the deploy config: binding `UPLOADS`, real `bucket_name`. The file in git keeps the placeholder `sakem-files` and no id.
4. **Set `UPLOADS_BASE_URL`** on the public Worker **and on the admin Worker** at deploy time (`wrangler deploy --var UPLOADS_BASE_URL:https://files.<your-domain>` or the deploy config), never in git. The admin Worker serves it to the SPA in `GET /api/config` (`uploadsBaseUrl`, normalised, `""` when unset) so the form can show an uploaded image from the files domain.
5. **Create the real rate limit namespace** for `RL_UPLOAD` with the others (the deploy ticket chooses the ids).
6. **Check once on the real zone:** upload through the admin, open the path with `UPLOADS_BASE_URL` in front, confirm the response carries the immutable `Cache-Control` and the right `Content-Type`, and that `https://<admin host>/uploads/anything` answers 404 JSON.

## What was not verified

- **Worker CPU.** Workerd freezes its timers during synchronous code, so CPU cannot be measured locally; SAKEM-084 does it on a Free account against the 10 ms limit. The JavaScript the upload runs on the file (`sniff` over the first 1 MiB and the slug) takes microseconds in Node (median 1 µs, max 0.5 ms cold); everything else (multipart parse, the R2 put, D1) is native or I/O. Local **wall** time for a whole upload against `wrangler dev` (`pnpm measure:upload`, n=10 after 2 warm-ups, an upper bound of the Worker's own work, including the transfer over localhost and the emulated storage): 60 kB PNG median 11 ms; **5 MB image median 62 to 68 ms** (p95 92 to 111); 20 MB PDF median 225 ms; 25 MB PDF median 263 ms (p95 327). The risk to watch is the multipart parse of the 20 and 25 MB kinds. If SAKEM-084 shows it above the limit, the fallbacks are a lower limit for those kinds or a raw-body variant (`PUT` with the kind in the query, the request body streamed to R2 with `FixedLengthStream`, no parse at all).
- Real R2 (the conditional put, the `Cache-Control` metadata as served by a custom domain), the custom domain itself, the real rate limit binding at the edge, and any browser or visual behaviour: nothing was opened in a browser.
- The SPA's upload field (`UploadField`, with client checks, progress, preview, replace and remove) is built in the CRUD kit ([`admin-crud.md`](admin-crud.md#10-files-upload-references)); it was tested with a stubbed `XMLHttpRequest` and a stubbed uploader, never against a real browser or a real bucket.

## Tests

`cf/admin`: `test/uploads-sniff.test.ts` (every type and flavour, truncated at every length, huge and zero sizes, file names, the key shape), `test/uploads.test.ts` (the area matrix for every kind and role, for writing and for listing, accepted types with their stored metadata, disguised files, limits to the byte, `?kind=`, 411, the rate limit, list and delete with every reference, failures, logs, the local-only route and its production 404), `test/uploads-references.test.ts` (the registry against the schema, the SQL). `scripts/negative-checks-uploads.mjs` breaks one safeguard at a time (20 of them: the magic-byte check, the area check, the read check of the list, the size limit, the traversal-safe key, the production route guard, the reference check, and more) and expects the tests to fail. `cf/web`: `tests/uploads.test.ts` and `pnpm test:e2e:uploads`.

## Open decisions

For Dzul, in order of weight:

1. **Word, Excel and zip files for the Pusat Dokumen.** The legacy action took any file and the fixture lists a `.docx` template. Allowing OOXML means checking for the zip header and the `[Content_Types].xml` entry and trusting the extension for which of docx, xlsx and pptx; it is doable, and refuses macro formats by construction (only those three extensions). Until decided, a template has to be a PDF.
2. **GIF (blog) and AVIF (blog and team)** were accepted by the legacy app. Add GIF? AVIF?
3. **`registration-document` and `resource`** share rules and a purpose. If they are the same thing (the document hub), drop one kind.
4. **EXIF is not stripped.** Team photos from a phone may carry a GPS position and are public. Options: tell editors, or re-encode in the browser before upload (the SPA, not the Worker).
5. **PDFs open in a tab, not as a download**, on the files domain (see above), unless `Content-Disposition: attachment` is set at upload.
