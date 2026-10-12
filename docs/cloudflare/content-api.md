# Public content API: contract for the Worker API

> **Status: contract (SAKEM-076, epic SAKEM-074), implemented in the Worker `cf/admin` (SAKEM-081, part C): how it is built, measured and run is in [`public-api.md`](public-api.md). Option C (HMAC) is not implemented; transport A (service binding) is.** This page defines what the public content API of the new Worker (`cf/api`, Hono + D1) must serve and accept, so that the Astro site (`cf/web`) can be written against it now and the Worker can be built to match. Decisions are recorded here so they are not re-litigated in the implementing PR. The contract is **neutral about transport**: how the Astro Worker (or a browser) reaches the API is a deployment choice, see [Contact](#post-apipubliccontact).

## Provenance: legacy or new

Every section and table row below carries one of two marks.

- **[L] from the legacy app.** The shape or rule exists in the Next app today (`lib/team.ts`, `lib/reports.ts`, `lib/site-resources.ts`, `lib/announcements.ts`, `lib/blog.ts` and `lib/blog-types.ts`, `app/(public)/kontak/`). It was read from that code, then built and tested once as a read-only seam in the legacy app (reference branch `feat/public-content-api`, commits `f53121a` to `44b131f`; its PR was closed without merging, the branch stays as a reference). Where this page says "verified", that seam's tests and a run of its built server are the evidence.
- **[N] new.** A design decision for the Worker API with no legacy counterpart, or a deliberate change from the legacy behaviour. These are the parts most open to revision; the open ones are collected in [Decisions](#decisions).

The legacy plan was an interim JSON seam in the old app during a "public first" phase. The migration is now a single cutover on branch `cloudflare`, so that seam is not shipped. The contract is what survives it.

## How the callers reach the API

```
browser ──GET /tim, /blog ...──▶ Astro Worker (cf/web) ──GET /api/public/*──▶ API Worker (cf/api) ──▶ D1

contact form, any of:
  (A) browser ─▶ Astro Worker ──service binding──▶ API Worker  POST /api/public/contact
  (B) browser ───────────────────────────────────▶ API Worker  POST /api/public/contact
  (C) a server on another host, signed over public HTTP ─────▶ API Worker  (optional, HMAC)
```

- **[L]** The Astro skeleton already calls `GET /api/public/team` (`cf/web/src/lib/team.ts`; through the service binding in production, `${CONTENT_API_URL}` locally): 2 s timeout, `caches.default`, 5 minutes fresh, 7 days stale-if-error, `TEAM_CACHE_FRESH_SECONDS` tunes the fresh window. Keeping the `/api/public` prefix means that consumer needs no change when the data source moves.
- **[N]** The read endpoints are identical whichever way they are reached. There is no CORS in this contract: Astro calls them server to server. If a browser ever has to call any of them, add CORS for that origin then.

## Conventions

| | Rule | |
| --- | --- | --- |
| Base path | `/api/public`, JSON (`application/json`), UTF-8 | [L] |
| Reads | `GET`, no credentials, no cookies set | [L] |
| Exposed fields | **Only what the public site already shows.** Build each response from an explicit field list, never "row minus private columns", so a column added later stays private until someone adds it on purpose. No emails, no audit data, no user ids of authors or uploaders, no admin notes, no row timestamps the site does not display. | [L] |
| Identifiers | `id` is an opaque string (the legacy UUID, or whatever D1 uses). The site only uses it as a stable key and DOM id. Blog articles are keyed by `slug`. | [N] |
| Asset paths | Files are returned as **root-relative paths** (`/images/team/x.jpg`, `/reports/…`, `/resources/…`, `/blog/images/…`), as in the legacy data, and the Astro site serves them as its own static assets. An absolute `https://` URL only appears for an external image that a markdown body links to. The consumer must still accept both forms. See the consequence below. | [L] paths; [N] served by the Astro site |
| Dates | Strings the site shows (`"21 Mei 2026"`) beside ISO sort keys (`"2026-05-21"`). No raw timestamps. | [L] |
| Errors | JSON `{ "error": "<code>", ... }`, see [Errors](#errors) | [L] |

**[N] Consequence to settle for asset paths.** Static assets are deployed together with the Worker, so a file uploaded in the new admin after a deploy has no static file until the site is rebuilt and redeployed, unless the Astro Worker serves those path prefixes from storage (R2 or similar) at request time. This contract only fixes the form of the path; where the bytes live is an [open decision](#decisions).

## Caching

| Endpoint | `Cache-Control` | |
| --- | --- | --- |
| `team`, `reports`, `resources`, `blog`, `blog/{slug}` | `public, s-maxage=60, stale-while-revalidate=300` | [L] values, verified on the built legacy server |
| `announcements/current` | `public, s-maxage=30, stale-while-revalidate=60` | [L] |
| `blog/{slug}`, unknown slug (404) | `public, s-maxage=30` | [L] |
| `POST contact`, every error | `no-store` | [L] |

**[L] Why those numbers.** A change is visible to a cache in front of the API after at most `s-maxage` (60 s), plus one stale answer while it refetches, so an edit shows within about a minute and never takes more than about six. Announcements get the shorter window because an urgent notice should appear and disappear quickly. A 404 is cached for 30 s so probing cannot hammer the origin while a newly published article still appears within 30 s. Responses carry no cookies and depend on no request header, so they are safe to share. (Under Next, `Vary` also lists the RSC headers; a server-to-server caller never sends them. A Worker does not add them.)

**[N] On Workers.** The legacy origin was fresh immediately after an admin save because saves called `revalidateTag`. There is no tag cache in a Worker, so after a save the API either deletes the affected URLs from `caches.default` (works on a custom domain or route, not on `*.workers.dev`) or accepts the TTLs above. Two things add up end to end: the API's cache window and the Astro side's own cache. For `/tim` the latter is 5 minutes fresh by default, so an edit can take about 6 minutes to show there. If that is too slow, lower `TEAM_CACHE_FRESH_SECONDS` or purge from the admin save.

## Errors

**[L]** Every failure is `{ "error": "<code>" }` plus code-specific fields, with the status below. Unhandled failures (a D1 error) are a plain `500` and must not carry `s-maxage`, so nothing is told to cache a failure.

| Status | `error` | Used by |
| --- | --- | --- |
| `404` | `not_found` | unknown or unpublished blog slug |
| `400` | `body_too_large`, `invalid_client_ip`, `invalid_json`, `validation_failed` | contact |
| `401` | `unauthorized` (+ `reason`) | contact, only when the HMAC option is enabled |
| `429` | `rate_limited`, `duplicate_recent` (+ `Retry-After`, `retryAfterSeconds`) | contact |
| `503` | `service_unavailable` | contact, only when the HMAC option is enabled and its secret is not configured |

## Endpoints

### `GET /api/public/team`

**[L]** Team members. **Order:** by category (`dewan_pembina`, `dewan_pengawas`, `pengurus`), then the admin's manual order, then creation time. **[N]** The legacy query got the category order from alphabetical text order, which happens to match; the new query should rank categories explicitly instead of relying on that.

```json
{
  "members": [
    {
      "id": "6f1c2f0e-0000-4000-8000-000000000001",
      "name": "Nama Anggota",
      "role": "Ketua Pembina",
      "image": "/images/team/nama-anggota-ab12cd.jpg",
      "category": "dewan_pembina",
      "bio": "Teks bio, boleh multi-baris.",
      "educationHistory": [{ "institution": "Institut Contoh", "degree": "S1", "year": "2012" }],
      "workHistory": [{ "organization": "Lembaga Contoh", "role": "Staf", "period": "2013 - 2018" }]
    }
  ]
}
```

`image` and `bio` may be `null`; `degree`, `year`, `period` may be `null` or absent. The array order **is** the display order.

**Compatibility with the Astro skeleton.** `cf/web/src/lib/team-types.ts` also declares `displayOrder`, `createdAt` and `updatedAt`, but its parser (`parseTeamPayload`) defaults them (`0`, `''`) and `groupTeam` sorts stably, so a response without them keeps the API's order. They are **not** part of this contract. The API may include them (they are not private data), but the site must not depend on them. That parser also accepts a bare array; the API must still return `{ "members": [...] }`.

### `GET /api/public/reports`

**[L]** Reports, newest `year` first (string order is chronological for `YYYY` and `YYYY/YYYY`), then newest upload first. The consumer groups by `year`.

```json
{
  "reports": [
    {
      "id": "6f1c2f0e-0000-4000-8000-000000000002",
      "title": "Laporan Dampak 2025/2026",
      "description": "Ringkasan dampak program.",
      "category": "impact",
      "year": "2025/2026",
      "filePath": "/reports/2025-2026/impact/laporan-dampak.pdf",
      "fileSize": 1843200
    }
  ]
}
```

`category`: `yearly | financial | impact | donation`. `fileSize` is bytes. `description` may be `null`. The upload time and the uploader are not exposed.

### `GET /api/public/resources`

**[L]** The documents of `/gabung-siswa/docs`, **flattened in the page's order**: categories `panduan`, `berkas-pendaftaran`, `berkas-marketing`, `tutorial`, `lainnya` (a category with no rows simply has no entries), then the admin's manual order inside each. The consumer groups by `category`.

```json
{
  "resources": [
    {
      "id": "6f1c2f0e-0000-4000-8000-000000000003",
      "title": "Panduan Pendaftaran",
      "description": null,
      "category": "panduan",
      "contentType": "file",
      "filePath": "/resources/panduan-pendaftaran.pdf",
      "fileSize": 902144,
      "externalUrl": null,
      "bodyText": null
    }
  ]
}
```

Exactly one of `filePath` (with `fileSize`), `externalUrl`, `bodyText` is set, matching `contentType` (`file | url | text`); the others are `null`. The admin-only `notes` field is never exposed.

### `GET /api/public/announcements/current`

**[L]** The one active announcement for the strip, or `null`. Active means the admin switched it on **and** now is inside its `startsAt`/`endsAt` window (either end may be open). If several match, the most recently created wins.

```json
{
  "announcement": {
    "title": "Pendaftaran dibuka",
    "body": "Daftar sekarang untuk angkatan berikutnya.",
    "severity": "info",
    "ctaLabel": "Daftar",
    "ctaUrl": "/gabung-siswa"
  }
}
```

`severity`: `info | warning | urgent`. `ctaLabel`/`ctaUrl` may be `null`; `ctaUrl` is relative or absolute. Nothing active: `{ "announcement": null }`. The window dates and `active` are not exposed.

- **[N] Do not reproduce a legacy defect.** The legacy reader caches "the current announcement" behind a tag with no expiry, so an announcement whose `endsAt` passed stays visible, and one whose `startsAt` is still ahead stays hidden, until something revalidates the tag. The new API must evaluate the window against the current time on every uncached request (the 30 s edge cache is then the only staleness).
- **[N]** The legacy reader answered `null` when the database was unreachable (so the strip just disappeared). The new API should answer a `5xx` instead, so a cache never stores a false "no announcement".
- **[L] Note, not part of this contract.** The legacy `GET /api/announcements/current` (used by the legacy Navbar) returns the whole row to anyone, including `createdBy`, an internal user id. That is tracked in a separate ticket. The contract above does not expose it, and the Worker API must not either.

### `GET /api/public/blog?page=&pageSize=`

**[L semantics]** The `/blog` index: one **featured** article (the newest one flagged `featured`, otherwise the newest) plus the rest, newest first, in pages. The featured article is **not repeated** in `articles`. The legacy page shows it on page 1 only; the API **always returns it** and the consumer decides. `total` counts the articles across all pages **excluding** the featured one.

| Query | Default | Rule | |
| --- | --- | --- | --- |
| `page` | `1` | integer; out of range is **clamped** to `1..totalPages`, never an error; non-numeric means `1` | [L] |
| `pageSize` | `15` | integer, bounded to `1..50`; non-numeric means `15` | [N] (the legacy page is fixed at 15; the parameter and bounds were added in the seam) |

```json
{
  "featured": {
    "slug": "tanpa-jasa-ahdan-mewujudkan-murid-masuk-perguruan-tinggi",
    "title": "Tanpa Jasa Ahdan Mewujudkan Murid Masuk Perguruan Tinggi",
    "category": "Cerita",
    "date": "21 Mei 2026",
    "dateISO": "2026-05-21",
    "excerpt": "Kenal Dengan Ahdan, Penyemangat Murid Sakola Kembara ...",
    "image": "/blog/images/2026/05/IMG-20260102-WA0069-scaled.jpg",
    "imageWidth": 2560,
    "imageHeight": 1707,
    "author": "Deanita",
    "featured": true
  },
  "articles": [
    { "slug": "...", "title": "...", "category": "News", "date": "...", "dateISO": "...", "excerpt": "...", "image": null, "imageWidth": null, "imageHeight": null, "author": "...", "featured": false }
  ],
  "page": 1,
  "pageSize": 15,
  "total": 79,
  "totalPages": 6
}
```

- **[L]** `excerpt` has the WordPress `[…]` trailer already stripped (`cleanExcerpt`, identical in the Astro skeleton). `image` is `null` when there is none. An empty blog is `{ "featured": null, "articles": [], "page": 1, "pageSize": 15, "total": 0, "totalPages": 1 }`. The WordPress post id and source URL are not exposed.
- **[N] `slug`** replaces the legacy field name `id` (which is the URL slug); see [Differences](#differences-from-the-legacy-types).
- **[N] `imageWidth`/`imageHeight`** (`null` when unknown). The skeleton puts `width` and `height` on every `<img>` (a parity requirement in `web-skeleton.md`) and today reads the real files at build time. Files uploaded through the new admin have no file on disk to read, so the dimensions must be recorded at upload and returned here.
- **[N] Source.** Only **published** articles from D1 appear; a draft never does.
- **[N] Enumerating every article** (for the sitemap): loop `page` with `pageSize=50` and add `featured`, since it is excluded from `articles`.

### `GET /api/public/blog/{slug}`

**[L]** One article plus related ones. An unknown slug is a JSON `404` (`{ "error": "not_found" }`, `s-maxage=30`). **[N]** An unpublished slug is the same `404`.

```json
{
  "article": {
    "slug": "tanpa-jasa-ahdan-mewujudkan-murid-masuk-perguruan-tinggi",
    "title": "...",
    "category": "Cerita",
    "date": "21 Mei 2026",
    "dateISO": "2026-05-21",
    "modifiedISO": "2026-05-21",
    "excerpt": "...",
    "image": "/blog/images/2026/05/IMG-20260102-WA0069-scaled.jpg",
    "imageWidth": 2560,
    "imageHeight": 1707,
    "author": "Deanita",
    "featured": true,
    "contentMarkdown": "### **Kenal Dengan Ahdan** ...",
    "contentHtml": "<h3><strong>Kenal Dengan Ahdan</strong></h3>\n<p>...</p>"
  },
  "related": [
    { "slug": "...", "title": "...", "category": "...", "date": "...", "dateISO": "...", "excerpt": "...", "image": "...", "imageWidth": null, "imageHeight": null, "author": "...", "featured": false }
  ]
}
```

- **[L]** `image` is the hero image; `modifiedISO` and `author` feed the page's Article JSON-LD (`dateModified`, `author`).
- **[N] `related` holds summaries, not bare slugs.** Up to 3, never the article itself, each with the same fields as a list entry (so it carries its `slug`), which saves the consumer a request per card. **[L]** The rule: a candidate is related when it has the same category **or** is dated within 180 days of the article; take the first three in newest-first order; if none qualify, the three newest others. This is also `getRelated` in `cf/web/src/lib/blog.ts`; keep one implementation.

**`contentHtml`: rendered at save time, stored, never rendered on read.** [N] The new admin renders the markdown to HTML **when an article is saved** and stores the result in D1 next to the markdown. The read path only returns it. Reason: Workers Free allows 10 ms CPU per request, and rendering on every read would spend it. Consequences:

- The save request has the same 10 ms limit. **Indicative cost, measured in Node on a development machine (not Worker CPU, so only a hint):** the 80 current articles (median 4.5k characters, largest 8.3k) render in a median of 1.2 ms, p95 2.2 ms, max 3.4 ms once warm; the first pass with a cold JIT had p95 3.0 ms and max 12.8 ms. Save-time rendering probably fits, but a cold isolate might not. Measure on a real Worker before relying on it.
- If the HTML is produced anywhere other than the API (for example in the admin SPA), the API must re-render or sanitize it instead of trusting it, because the consumer injects it unescaped.
- Inline images in the stored HTML should carry `width` and `height` when the dimensions are known (see `imageWidth` above).
- Changing the renderer later means re-rendering stored articles; keep the markdown as the source of truth.

#### Parity of `contentHtml` with react-markdown

**[L]** The legacy site renders the markdown with react-markdown + remark-gfm (`components/blog/BlogPostContent.tsx`). `contentHtml` must read the same way.

*Same, verified.* The parser and tree are the same pipeline (remark-parse, remark-gfm, remark-rehype), because react-markdown is that pipeline ending in React elements. Rendering to a string instead uses rehype-stringify (`lib/public-api/blog-html.ts` on the reference branch; Next forbids `react-dom/server` in a route handler, which is why the seam could not simply render the React tree). Behaviour that carries over:

- raw HTML in the markdown is shown as escaped text, never passed through;
- URLs go through react-markdown's own `defaultUrlTransform` (`javascript:` and similar become empty; relative, `http(s)`, `mailto` and a few other safe protocols stay); an image whose URL is filtered renders nothing;
- links to `http(s)` get `target="_blank"`; every link gets `rel="noopener noreferrer"`;
- an image is a plain `<img class="rounded-xl max-w-full h-auto my-6" loading="lazy">`.

*How it was verified.* Both renderers were run on all 80 articles in `content/blog` and on a fixture covering headings, bold and italic, strikethrough, nested and task lists, a blockquote, a link with a title, a GFM table, autolinks, local and remote images, a code fence, raw HTML and `javascript:` URLs (`__tests__/blog-html-parity.test.tsx` on the reference branch). The outputs matched after normalizing differences that carry no meaning: the void-element slash (`<img>` against `<img/>`), the escape style of `<` (`&#x3C;` against `&lt;`) and of `>` and `"` in text, attribute order, boolean attributes (`checked` against `checked=""`), and whitespace between table elements.

*Intentional differences from what the legacy page renders:*

| Difference | Legacy page | `contentHtml` |
| --- | --- | --- |
| Images under `/blog/images/` | `next/image` with fixed `width={1024} height={768}`, inside a wrapper `<span>` | a plain `<img>` like any other image; real `width`/`height` should be added at save time when known |
| Outer wrapper | `<div class="blog-content">` around the markdown | not included; the consumer wraps it so the `.blog-content` styles apply |
| Markdown link title | dropped (the legacy `a` component only passes `href` and children) | dropped, to match |
| Table column alignment (`:---`, `---:`) | `style="text-align:left"` | an `align="left"` attribute (the same layout in browsers). Not present in `content/blog` today. |
| Footnotes | links without their `id` and `aria-*` attributes | keeps `id`, `aria-describedby` and the back-reference attributes. Not present in `content/blog` today. |

**[N] Illustrative D1 mapping for the blog** (names are a suggestion, not the contract):

| Wire field | Column or derivation |
| --- | --- |
| `slug` | unique, URL-safe, immutable after publish (it is the URL) |
| `title`, `category`, `author`, `featured`, `excerpt` | columns |
| `dateISO`, `date` | `published_at`; `date` is the Indonesian long date computed when saving |
| `modifiedISO` | last save |
| `image`, `imageWidth`, `imageHeight` | cover, recorded at upload |
| `contentMarkdown`, `contentHtml` | stored, rendered together at save |
| (not exposed) | status, `wpId`, `sourceUrl`, audit columns |

### `POST /api/public/contact`

The contact form. The contract below is **neutral about how the request arrives**: the same body, rules, responses and rate limit apply whichever transport is used. Only authentication and the source of the visitor's address differ.

**Transports**

| | Who calls | Authentication | Visitor address for the rate limit |
| --- | --- | --- | --- |
| **A. Service binding** | the Astro Worker calls the API Worker internally | none beyond the binding: the API Worker has no public path to this endpoint, or ignores calls that did not come through the binding. **No HMAC.** | passed by the caller in `X-Sakem-Client-Ip` (trusted because the binding is internal). Whether `CF-Connecting-IP` also survives a service-binding call must be checked on a real zone. |
| **B. Direct** | the browser posts the form straight to the API Worker | none: a browser cannot keep a secret. An `Origin` check against the site's origin is a courtesy, not security (a non-browser client can send any `Origin`). The honeypot, validation, duplicate guard and rate limit are the protections. | **`CF-Connecting-IP`**. When the request reaches the API Worker from the edge, Cloudflare sets it to the real visitor address and the client cannot forge it. Nothing needs to be passed explicitly. |
| **C. Cross-host server caller (optional)** | a server on another host, over public HTTP | HMAC-SHA256 signature, described below | `X-Sakem-Client-Ip`, trusted **only after** the signature verified |

**[N] The rate-limit key, for every transport.** Use the visitor address the API can trust: the caller-supplied `X-Sakem-Client-Ip` **only** when the request was authenticated by transport A or C; otherwise `CF-Connecting-IP`. Never use `X-Sakem-Client-Ip` from an unauthenticated request (the caller would choose its own bucket) and never the left side of `X-Forwarded-For`. A missing or malformed address falls into one shared "unknown" bucket (over-throttling is the safe failure). **[L]** The legacy limiter prefers `CF-Connecting-IP`, falls back to the rightmost `X-Forwarded-For` entry, and otherwise uses the "unknown" bucket; the seam added an explicit `ip` override that only an authenticated caller may use.

**Request**

```
POST /api/public/contact
Content-Type: application/json

{"fullName":"Budi Santoso","email":"budi@example.com","subject":"other","message":"Halo, saya ingin bertanya soal program.","website":""}
```

| Body field | Rule | |
| --- | --- | --- |
| `fullName` | string, trimmed, 2 to 120 characters | [L] |
| `email` | string, trimmed, lower-cased, valid email, at most 254 characters | [L] |
| `subject` | `partnership`, `donation` or `other` | [L] |
| `message` | string, trimmed, 10 to 5000 characters | [L] |
| `website` | honeypot: omit it or send `""`. A non-empty value is answered with the normal `201` and nothing is saved. | [L] |

The field rules and the Indonesian wording of the messages are the on-site form's (`contactSchema` and `CONTACT_MESSAGES` in the legacy `lib/contact.ts`); reproduce them word for word, since the form shows them. The body is limited to 32 KiB. **[L]**

**Responses.** Checks run in this order and the first failure answers. Authentication (when the transport has one) comes before anything that costs a D1 query, so an unauthenticated caller can neither fill the rate-limit store nor probe validation. **[L]**

| Status | `error` | When | Applies to |
| --- | --- | --- | --- |
| `503` | `service_unavailable` | the HMAC option is enabled but `PUBLIC_API_SHARED_SECRET` is not set. Fail closed. | C |
| `400` | `body_too_large` | Body over 32 KiB (checked before the signature, when there is one). | all |
| `401` | `unauthorized` | Missing headers, bad or tampered signature, or timestamp outside the window. A `reason` field says which: `missing_headers`, `timestamp_out_of_window` or `signature_mismatch`. | C |
| `400` | `invalid_client_ip` | `X-Sakem-Client-Ip` missing or not a single IP literal. | A, C |
| `429` | `rate_limited` | More than 5 submissions per minute for that visitor address. Carries `Retry-After` and `retryAfterSeconds`. | all |
| `400` | `invalid_json` | The body is not JSON. | all |
| `400` | `validation_failed` | Field rules not met. Body: `{ error, message, fieldErrors }`, `fieldErrors` as `{ "email": ["Format email belum benar"] }`. | all |
| `429` | `duplicate_recent` | The same email already wrote within 5 minutes; nothing is saved. Carries `Retry-After` (300) and `retryAfterSeconds`. | all |
| `201` | none | Saved. Body `{ "ok": true, "message": "Pesan kamu sudah kami terima. Tim kami akan menghubungi via email." }`. The id of the new row is not returned. The same body answers a honeypot hit. | all |

Every response is `Cache-Control: no-store`. `429` and `validation_failed` bodies carry a ready-to-show Indonesian `message`.

A successful call **[L]** stores the message (name, email, subject, message) and writes an audit entry (`contact_message.submit`, actor = the sender's email, no message text). **[N]** The legacy app also invalidated cached admin views; the new admin reads D1 directly, so nothing needs invalidating.

**[N] Rate limiter storage** is open on the Free tier. Legacy was a fixed-window counter row per `(action, ip, window)` in Postgres, 5 per 60 s. A D1 counter table works but costs a write per request; KV or a platform rate-limit binding (if the plan offers one) may be cheaper. The behaviour above is what counts.

**Limits of transport B.** A direct endpoint is open to anyone who can reach it. The contract's protections (honeypot, 5 per minute per visitor address, one message per email per 5 minutes, strict validation, a 32 KiB cap) bound the abuse but are not authentication. If spam shows up, add bot protection in front of the form; that is outside this contract.

#### Option C: HMAC signature for a cross-host caller

**[L]** Implemented and tested in the legacy seam; kept here as an option for a caller that is not the Astro Worker through a binding. It is **not required** for transports A and B. Only enable it when something outside the Worker pair posts to this endpoint over public HTTP.

```
POST /api/public/contact
Content-Type: application/json
X-Sakem-Timestamp: 1760000000
X-Sakem-Signature: 100be0a7675a05a0ce1be2619094b68d1bd9a269f233f58248cd01a6afa030e4
X-Sakem-Client-Ip: 203.0.113.7

{"fullName":"Budi Santoso","email":"budi@example.com","subject":"other","message":"Halo, saya ingin bertanya soal program.","website":""}
```

```
signature = lowercase-hex( HMAC-SHA256( key  = the secret, as its UTF-8 bytes,
                                        data = timestamp + "." + rawBody ) )
```

- `timestamp`: Unix time in **seconds**, decimal digits only (`"1760000000"`), sent as `X-Sakem-Timestamp`. The receiver accepts a clock difference of up to **5 minutes** in either direction, otherwise `401`.
- `rawBody`: the **exact string you send as the request body**. Serialize once, sign that string, send that same string. Never sign an object and let the HTTP client serialize it again.
- The secret is used as the plain string (not base64-decoded): the value of `PUBLIC_API_SHARED_SECRET`, at least 32 characters.
- `X-Sakem-Signature`: the 64-character hex digest (upper case is accepted). `X-Sakem-Client-Ip`: the visitor's address, one IPv4 or IPv6 literal.
- **Decided: the address is not bound into the MAC.** The signature covers exactly `timestamp + "." + rawBody`. The address header is believed only after the signature verified, because only the secret holder can reach this branch at all. Do not change the signed string.

Test vector (check an implementation against it before talking to a server):

```
secret    = 0123456789abcdef0123456789abcdef
timestamp = 1760000000
body      = {"fullName":"Budi Santoso","email":"budi@example.com","subject":"other","message":"Halo, saya ingin bertanya soal program.","website":""}
signature = 100be0a7675a05a0ce1be2619094b68d1bd9a269f233f58248cd01a6afa030e4
```

Reproduce it with `printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex`. The secret above is a published dummy; never use it anywhere real.

**[N] Signing in a Worker (Web Crypto):**

```ts
async function sign(secret: string, timestamp: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const rawBody = JSON.stringify(payload);
const timestamp = String(Math.floor(Date.now() / 1000));
const res = await fetch(`${API_BASE_URL}/api/public/contact`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-sakem-timestamp": timestamp,
    "x-sakem-signature": await sign(env.PUBLIC_API_SHARED_SECRET, timestamp, rawBody),
    "x-sakem-client-ip": visitorIp,
  },
  body: rawBody,
});
```

**[N] Verifying in the API Worker (Hono).** Read the raw body once (`await c.req.text()`), check the timestamp window, then verify with `crypto.subtle.verify("HMAC", key, hexToBytes(signature), data)`, which compares in constant time; reject a signature that is not exactly 64 hex characters before decoding. Parse the JSON from the same string you verified.

**Limit.** Within the 5-minute window an identical signed request can be replayed by someone who captured it (TLS protects the wire). The same-email guard and the rate limit bound the effect; there is no nonce store. **[L]**

## Configuration

| Name | Where | Notes |
| --- | --- | --- |
| `PUBLIC_API_SHARED_SECRET` | **only if option C is enabled**: a secret on the API Worker and on the caller (`wrangler secret put`, or untracked `.dev.vars` locally) | At least 32 characters (`openssl rand -base64 32`). Unset or blank is safe: the signed branch answers `503` and nothing else is affected. A set value shorter than 32 characters should stop the Worker at startup rather than weaken the HMAC. Rotating it means changing both sides. Never commit a value. |

Transport A needs the service binding in the Worker configuration and no secret. Transport B needs nothing. The `GET` endpoints need no configuration.

## Differences from the legacy types

The legacy shapes are the row types (`TeamMember`, `Report`, `SiteResource`, `Announcement`) and `BlogArticle` in `lib/blog-types.ts`. The contract narrows and renames them on purpose. A reader who knows the old types can use this table.

| Area | Legacy | This contract | Why |
| --- | --- | --- | --- |
| Blog article key | `BlogArticle.id` (it is the URL slug) | `slug` | the name says what it is; the row id of a new D1 table is a different thing |
| Blog list fields | full `BlogArticle`, including `wpId`, `sourceUrl`, `contentMarkdown` | summary: `slug`, `title`, `category`, `date`, `dateISO`, `excerpt`, `image`, `imageWidth`, `imageHeight`, `author`, `featured` | no body in a list; no internal fields |
| Blog article fields | `BlogArticle` | summary + `modifiedISO`, `contentMarkdown`, `contentHtml`; no `wpId`, `sourceUrl` | HTML is part of the payload (rendered at save), internals stay private |
| Blog `image` when absent | `""` | `null` | one way to say "none", like the other tables |
| Blog `excerpt` | raw, cleaned at render by `cleanExcerpt` | cleaned already | the consumer should not need to know about WordPress trailers |
| Related articles | computed inside the article page | `related`: up to 3 **summaries** (each has its `slug`) | one request, same rule |
| Featured article | the index page shows it on page 1 only | `featured` is **always present** (`null` only for an empty blog) and absent from `articles` | the consumer decides where to show it |
| Pagination | page size fixed at 15, `?page=` | plus `?pageSize=` (1 to 50), and `page`, `pageSize`, `total`, `totalPages` in the response | enumerating articles for the sitemap |
| Image paths | root-relative (`/blog/images/…`) | root-relative, served as static assets by the Astro site | see the consequence under Conventions |
| Team | `TeamMember` row | no `displayOrder`, `createdAt`, `updatedAt` (array order is the order); the Astro type declares them but defaults them | nothing public depends on them |
| Reports | `Report` row, also grouped by year by `getReportsByYear` | flat array without `uploadedBy`, `uploadedAt` | the consumer groups; the uploader is internal |
| Resources | `SiteResource` row, also grouped by category by `getResourcesByCategory` | flat array in the page's order, without `notes`, `displayOrder`, `updatedBy` and timestamps | same |
| Announcement | `Announcement` row | `title`, `body`, `severity`, `ctaLabel`, `ctaUrl` only; no `id`, `active`, window dates, `createdBy` | the strip shows nothing else |
| Dates | `Date` objects (ISO strings once JSON-serialized) | display strings and ISO sort keys only | no raw timestamps on the public wire |

## How the Astro site consumes it

`cf/web` reads the blog and posts the contact form against this contract (SAKEM-080 part E; checked against `cf/web/scripts/fixture-api.mjs`, not yet against the Worker API). What the API implementer should know, because it is what the site does today:

- **Where it calls.** The read endpoints and the contact form through the `API` service binding, bound to the API Worker's `PublicApi` entrypoint (`{ "service": "sakem-admin", "entrypoint": "PublicApi" }`; the API Worker serves nothing under `/api/public` on its public face). `CONTENT_API_URL` and `CONTACT_API_URL` win over the binding when set and are for local runs and CI only; never in production. A service binding ignores the host of the URL it is given, so only the path counts.
- **Which blog URLs.** `GET /api/public/blog?page=N&pageSize=15` for the list (`page` is capped at 500 on the site before it is asked), `?page=N&pageSize=50` for the sitemap (pages through `totalPages`, adds `featured`), and `GET /api/public/blog/{slug}` only for a slug matching `^[a-z0-9][a-z0-9_-]{0,199}$`; any other URL is a 404 on the site without a request (widen `BLOG_SLUG` in `cf/web/blog-contract.mjs` if the admin ever allows more).
- **What counts as "not found".** Only a `404` whose body is `{ "error": "not_found" }`. Any other 404 (an HTML page, other JSON) is treated as an outage: the site shows its stale copy or a 503 notice, never a 404, so a wrong base URL cannot make 80 articles look deleted to a crawler.
- **Caching on the site.** It does not read the API's `Cache-Control`: it keeps the parsed payload in `caches.default` for **60 s** (`CONTENT_CACHE_FRESH_SECONDS`, the one knob of every content list), the last good copy for 7 days (served when the API is down or invalid), and a "not found" for 30 s. So an admin edit shows within about a minute plus whatever caching the API adds. There is no purge hook on the site side; the cache keys are the exact API URLs (`.../api/public/blog?page=1&pageSize=15`, `.../api/public/blog/<slug>`), so an API Worker on the same zone could delete them from `caches.default`.
- **Fields it uses.** List entries: everything in the contract; an optional `modifiedISO` on an entry is used for the sitemap `lastmod` (without it the sitemap shows `dateISO`, so adding it is a backwards compatible improvement). Article: `contentHtml` (required, injected unescaped, so the API must sanitize at save), `modifiedISO`, `imageWidth`/`imageHeight` (the `width` and `height` of the hero and cards). **`contentMarkdown` is never used** and is dropped when the payload is parsed; leaving it out of the public response would roughly halve the JSON the Worker parses on a cache miss. `featured` on an entry is ignored: the featured card is the `featured` object of the list payload.
- **Images.** `image` is used as given, except that a path the build's asset manifest knows (the migrated articles' images) gets its WebP `srcset`. Inline images of `contentHtml` are used as given too, so the HTML that renders the 80 migrated articles should come from the build pipeline (`plugins/blog-content.mjs`, `createBlogReader`) to keep their `srcset`, `width` and `height`. How a root-relative path of an R2 upload reaches the public R2 domain is not decided here (see Decisions).
- **Contact.** The Astro Worker validates first with the legacy rules (checked against the real zod schema), keeps the honeypot, applies its own rate limit by `CF-Connecting-IP`, then sends `{ fullName, email, subject, message, website: "" }` as JSON with `X-Sakem-Client-Ip` set to that address, or `0.0.0.0` when the header is missing or not a single IP literal (the contract's shared "unknown" bucket), and `X-Sakem-Turnstile-Token` set to the form's Turnstile token when it has one (an addition to this contract, [`public-api.md`](public-api.md): the API answers `400 turnstile_failed` for a missing, failed or reused token wherever a secret is configured; the site shows "Verifikasi gagal. Silakan coba lagi."). It shows its own constants for the messages (the legacy wording), never the `message` strings of a response, uses `fieldErrors` of a `400 validation_failed`, and reads `Retry-After` or `retryAfterSeconds` of a `429`. A `429` with `duplicate_recent` is the duplicate message, any other `429` the rate-limit message. **Every other answer** (`503`, `5xx`, `401`, `400` with another code, a network error, no answer in 8 s) is one plain "could not be sent" page with a 503 status. The API must still validate and rate-limit: the site's checks are a first line, not the trust boundary. The one deliberate wording difference from the legacy form: an email over 254 characters shows `Maksimal 254 karakter` (the legacy schema had no message there, so zod's English default would show).

## What the Worker API must reproduce

The Astro site is written against this contract. The Worker API is conforming when it:

1. Serves the same paths and methods with the shapes above (the TypeScript wire types of the reference branch, `lib/public-api/types.ts`, are a ready starting point; the examples here are illustrative).
2. Exposes only those fields, built from explicit lists.
3. Keeps the orders: team by category rank, manual order, creation; reports newest year then newest upload; resources by category order then manual order; blog newest first.
4. Keeps the blog index semantics: featured picked as described, always returned, and excluded from `articles`; `page` clamped; `pageSize` default 15 bounded to `1..50`; `total` excludes the featured article; unknown or unpublished slug is a JSON `404`; `related` follows the same-category-or-180-days rule with the newest-others fallback.
5. Returns `contentHtml` rendered **at save time**, stored in D1, with the parity above, never rendering on the read path, with `imageWidth`/`imageHeight` available.
6. Evaluates announcement windows at request time (no legacy tag-cache defect) and never exposes `createdBy` or other row internals.
7. Sends the cache headers of the table above, and decides how an admin save refreshes them.
8. Keeps the contact contract on whichever transports are enabled: field rules and Indonesian messages verbatim, honeypot answered with `201`, one message per email per 5 minutes (`429 duplicate_recent`), 5 submissions per minute per visitor address (`429 rate_limited` with `Retry-After`), the same error codes and check order, no id in the `201` body. The HMAC scheme and its test vector exactly as written **if option C is enabled**.
9. Fits Workers Free: a handful of D1 queries per read endpoint, no per-request markdown rendering, no Node-only APIs on the request path (use Web Crypto, not `node:crypto`).
10. Returns asset paths as root-relative strings (or an external absolute URL where markdown links one) that the Astro site can resolve.

## Reusing the legacy work

Everything below is on the reference branch `feat/public-content-api` (`f53121a` to `44b131f`). Nothing there is meant to be merged; it is a tested reference.

| Legacy artifact | Reuse in the Worker API |
| --- | --- |
| `lib/public-api/types.ts` | Wire types, type-only. Copy into a shared types file. |
| `lib/public-api/serializers.ts` | The explicit-field-list pattern; port the lists to the D1 row types. |
| `lib/contact.ts` | The zod schema (zod runs on Workers), `CONTACT_MESSAGES`, `CONTACT_RATE_LIMIT`, honeypot handling. Rewrite the database part for D1. |
| `lib/blog-types.ts`: `buildBlogIndex`, `pickRelatedArticles` | Pure functions, copy verbatim. The Astro skeleton has the same logic as `getBlogPage` and `getRelated`; if the API returns the page, delete the Astro copy so there is one implementation. |
| `lib/public-api/blog-html.ts` and `__tests__/blog-html-parity.test.tsx` | The render pipeline (unified: remark-parse, remark-gfm, remark-rehype, rehype-stringify) and the parity test against react-markdown. Run it in the admin save path. The skeleton's `plugins/blog-content.mjs` already renders with the same engine at build time. |
| `__tests__/public-content-api.test.ts`, `public-contact-route.test.ts` | An executable spec: per-endpoint shapes, absence of private fields, pagination bounds and clamping, 404, every 4xx/5xx of the contact endpoint, the rate-limit key. Port the assertions, dropping the HMAC cases if option C is not used. |
| `lib/public-api/signing.ts` and `__tests__/public-api-signing.test.ts` | **Only for option C.** The algorithm, the window, the 64-hex pre-check, the test cases. Port from `node:crypto` to Web Crypto (examples above); keep the test vector. |
| `lib/rate-limit.ts`: explicit `ip` override | The idea: the limiter takes the visitor address from an authenticated caller, not from the request's own headers. |

## Decisions

Decided (recorded so the implementing PR does not reopen them):

- The contract is neutral about transport; HMAC and `X-Sakem-Client-Ip` are an option for cross-host callers, not a requirement. The visitor address is **not** bound into the MAC.
- `slug`, `related` as summaries, `featured` always present, root-relative image paths served as static assets by the Astro site.
- `contentHtml` is rendered at save time in the new admin and stored in D1.
- Keep the `/api/public` prefix on the Worker API (the Astro skeleton already depends on `/api/public/team`).
- **The contact form uses transport A** (Dzul, 2026-10-12): the Astro Worker calls the API Worker through an internal service binding. No HMAC, no shared secret, so `PUBLIC_API_SHARED_SECRET` does not exist; the visitor address travels in `X-Sakem-Client-Ip` and is trusted because the binding authenticates the caller. B and C stay described as options.
- **Uploaded files live in R2 on a separate public domain**, with root-relative paths in the payloads; nothing is proxied through a Worker (Dzul, 2026-10-12).
- **The blog is managed in the new admin** (D1): HTML rendered at save time and stored; the site caches 60 s and the API purges its own cache on save.

Open:

1. ~~Which transports are enabled for the contact form.~~ Decided: A (see Decisions).
2. **How a root-relative path of an upload becomes a URL on the public R2 domain.** The files live in R2 (decided), but the site uses an `image` path as given, so a path that is not one of the build's static assets is requested on the site's own host. Options: the site rewrites paths under an uploads prefix to `UPLOADS_BASE_URL` (a variable, no ids in git), a redirect rule in `redirects.config.mjs`, or the API returns the absolute URL for uploads (the contract already allows an absolute `https://` URL for an external image).
3. **Save-time rendering cost.** Measure on a real Worker whether rendering fits the 10 ms CPU limit of the save request on a cold isolate; the fallback is rendering in the admin SPA with the API re-rendering or sanitizing.
4. **Rate-limiter storage of the API Worker** on the Free tier (D1 counter, KV, or a platform binding). The Astro Worker uses a Workers rate-limit binding with an in-memory fallback in front of it, whichever the API chooses.
5. **Cache refresh after an admin save**: purge `caches.default` for the affected URLs, or accept the TTLs; and whether `TEAM_CACHE_FRESH_SECONDS` should drop below 5 minutes.
