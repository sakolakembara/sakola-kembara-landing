# Public content API: contract for the Worker API

> **Status: contract, not implemented (SAKEM-076, epic SAKEM-074).** This page defines what the public content API of the new Worker (`cf/api`, Hono + D1) must serve and accept, so that the Astro site (`cf/web`) can be written against it now and the Worker can be built to match. Decisions are recorded here so they are not re-litigated in the implementing PR.

## Provenance: legacy or new

Every section and table row below carries one of two marks.

- **[L] from the legacy app.** The shape or rule exists in the Next app today (`lib/team.ts`, `lib/reports.ts`, `lib/site-resources.ts`, `lib/announcements.ts`, `lib/blog.ts` and `lib/blog-types.ts`, `app/(public)/kontak/`). It was read from that code, then built and tested once as a read-only seam in the legacy app (local branch `feat/public-content-api`, commits `f53121a` to `44b131f`; pushed for reference only, its PR was closed without merging). Where this page says "verified", that seam's tests and a run of its built server are the evidence.
- **[N] new.** A design decision for the Worker API with no legacy counterpart, or a deliberate change from the legacy behaviour. These are the parts most open to revision; the open ones are collected in [Open decisions](#open-decisions).

The legacy plan was an interim JSON seam in the old app during a "public first" phase. The migration is now a single cutover on branch `cloudflare`, so that seam is not shipped. The contract is what survives it.

## How the two Workers meet

```
browser ──GET /tim, /blog ...──▶ Astro Worker (cf/web) ──GET /api/public/*──▶ API Worker (cf/api) ──▶ D1
browser ──POST contact form────▶ Astro Worker  ──signed POST /api/public/contact──▶ API Worker ──▶ D1
```

- **[L]** The Astro skeleton already calls `GET ${CONTENT_API_URL}/api/public/team` (`cf/web/src/lib/team.ts`): 2 s timeout, `caches.default`, 5 minutes fresh, 7 days stale-if-error, `TEAM_CACHE_FRESH_SECONDS` tunes the fresh window. Keeping the `/api/public` prefix means that consumer needs no change when the data source moves.
- **[N]** The API Worker is called either over HTTP (its own route or hostname) or through a service binding. The contract is the same; only the contact endpoint's authentication has a transport-specific note (see [Contact](#post-apipubliccontact)).
- **[N]** Public pages do not call the API from the browser. There is no CORS in this contract; if a browser ever has to call it, add CORS for that origin then.

## Conventions

| | Rule | |
| --- | --- | --- |
| Base path | `/api/public`, JSON (`application/json`), UTF-8 | [L] |
| Reads | `GET`, no credentials, no cookies set | [L] |
| Exposed fields | **Only what the public site already shows.** Build each response from an explicit field list, never "row minus private columns", so a column added later stays private until someone adds it on purpose. No emails, no audit data, no user ids of authors or uploaders, no admin notes, no row timestamps the site does not display. | [L] |
| Identifiers | `id` is an opaque string (the legacy UUID, or whatever D1 uses). The site only uses it as a stable key and DOM id. Blog articles are keyed by `slug`. | [N] |
| Asset paths | Files are returned as **root-relative paths** (`/images/team/x.jpg`, `/reports/…`, `/resources/…`, `/blog/images/…`), as in the legacy data, or as absolute `https://` URLs. The consumer must accept both. Where the files live after the migration (the Worker's assets, R2, or the legacy volume behind a pass-through) is open. | [L] paths, [N] absolute allowed |
| Dates | Strings the site shows (`"21 Mei 2026"`) beside ISO sort keys (`"2026-05-21"`). No raw timestamps. | [L] |
| Errors | JSON `{ "error": "<code>", ... }`, see [Errors](#errors) | [L] |

## Caching

| Endpoint | `Cache-Control` | |
| --- | --- | --- |
| `team`, `reports`, `resources`, `blog`, `blog/{slug}` | `public, s-maxage=60, stale-while-revalidate=300` | [L] values, verified on the built legacy server |
| `announcements/current` | `public, s-maxage=30, stale-while-revalidate=60` | [L] |
| `blog/{slug}`, unknown slug (404) | `public, s-maxage=30` | [L] |
| `POST contact`, every error | `no-store` | [L] |

**[L] Why those numbers.** A change is visible to a cache in front of the API after at most `s-maxage` (60 s), plus one stale answer while it refetches, so an edit shows within about a minute and never takes more than about six. Announcements get the shorter window because an urgent notice should appear and disappear quickly. A 404 is cached for 30 s so probing cannot hammer the origin while a newly published article still appears within 30 s. Responses carry no cookies and depend on no request header, so they are safe to share. (Under Next, `Vary` also lists the RSC headers; a server-to-server caller never sends them. A Worker does not add them.)

**[N] On Workers.** The legacy origin was fresh immediately after an admin save because saves called `revalidateTag`. There is no tag cache in a Worker, so after a save the API either deletes the affected URLs from `caches.default` (works on a custom domain or route, not on `*.workers.dev`) or accepts the TTLs above. Two things add up end to end: the API's cache window and the Astro side's own cache. For `/tim` the latter is 5 minutes fresh by default, so an edit can take up to about 6 minutes to show there. If that is too slow, lower `TEAM_CACHE_FRESH_SECONDS` or purge from the admin save.

## Errors

**[L]** Every failure is `{ "error": "<code>" }` plus code-specific fields, with the status below. Unhandled failures (a D1 error) are a plain `500` and must not carry `s-maxage`, so nothing is told to cache a failure.

| Status | `error` | Used by |
| --- | --- | --- |
| `404` | `not_found` | unknown or unpublished blog slug |
| `400` | `body_too_large`, `invalid_client_ip`, `invalid_json`, `validation_failed` | contact |
| `401` | `unauthorized` (+ `reason`) | contact |
| `429` | `rate_limited`, `duplicate_recent` (+ `Retry-After`, `retryAfterSeconds`) | contact |
| `503` | `service_unavailable` | contact, when the shared secret is not configured |

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

**Compatibility with the Astro skeleton.** `cf/web/src/lib/team-types.ts` also declares `displayOrder`, `createdAt` and `updatedAt`, but its parser (`parseTeamPayload`) defaults them (`0`, `''`) and `groupTeam` sorts stably, so a response without them keeps the API's order. They are **not** part of this contract. The API may include them (they are not private data), but the site must not depend on them. A bare array is also accepted by that parser; the API must still return `{ "members": [...] }`.

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

`severity`: `info | warning | urgent`. `ctaLabel`/`ctaUrl` may be `null`; `ctaUrl` is relative or absolute. Nothing active: `{ "announcement": null }`. The window dates are not exposed.

- **[N] Do not reproduce a legacy defect.** The legacy reader caches "the current announcement" behind a tag with no expiry, so an announcement whose `endsAt` passed stays visible, and one whose `startsAt` is still ahead stays hidden, until something revalidates the tag. The new API must evaluate the window against the current time on every uncached request (the 30 s edge cache is then the only staleness).
- **[N]** The legacy reader answered `null` when the database was unreachable (so the strip just disappeared). The new API should answer a `5xx` instead, so a cache never stores a false "no announcement".

### `GET /api/public/blog?page=&pageSize=`

**[L semantics]** The `/blog` index: one **featured** article (the newest one flagged `featured`, otherwise the newest) plus the rest, newest first, in pages. The featured article is **not repeated** in `articles`. The legacy page shows it on page 1 only; the API always returns it and the consumer decides. `total` counts the articles across all pages **excluding** the featured one.

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

- **[L]** `slug` is the legacy `BlogArticle.id`. `excerpt` has the WordPress `[…]` trailer already stripped (`cleanExcerpt`, identical in the Astro skeleton). `image` is `null` when there is none. An empty blog is `{ "featured": null, "articles": [], "page": 1, "pageSize": 15, "total": 0, "totalPages": 1 }`. The WordPress post id and source URL are not exposed.
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
- **[L] `related`**: up to 3 summaries, never the article itself. A candidate is related when it has the same category **or** is dated within 180 days of the article; take the first three in newest-first order; if none qualify, the three newest others. This is also `getRelated` in `cf/web/src/lib/blog.ts`; keep one implementation.
- **[L] `contentHtml` is the markdown rendered the way the legacy site renders it** (react-markdown with remark-gfm; verified identical on all 80 current articles after normalizing serialization details):
  - raw HTML in the markdown is shown as escaped text, never passed through;
  - URLs go through react-markdown's `defaultUrlTransform` (`javascript:` and similar become empty; relative, `http(s)`, `mailto` and a few other safe protocols stay);
  - links to `http(s)` get `target="_blank"`; every link gets `rel="noopener noreferrer"`; a markdown link title is not rendered;
  - an image is a plain `<img class="rounded-xl max-w-full h-auto my-6" loading="lazy">`;
  - the outer `<div class="blog-content">` is **not** included; the consumer wraps it so the existing `.blog-content` styles apply;
  - it is safe to inject as is, which is why whoever writes it must keep these properties (see the next point).
- **[N] Rendering is part of publishing.** The article is rendered **when it is saved** in the new admin, and the HTML is stored next to the markdown; the read path never renders. Reason: 10 ms CPU per request on Workers Free. Two follow-ups:
  - Inline images should carry `width` and `height` in the stored HTML when the dimensions are known (see `imageWidth` above).
  - If the HTML is produced anywhere other than the API (for example in the admin SPA), the API must re-render or sanitize it rather than trust it, because the consumer injects it unescaped.
- **[N] Indicative render cost.** Measured in Node on a development machine (not Worker CPU, so only a hint): the 80 current articles (median 4.5k characters, largest 8.3k) render in a median of 1.2 ms, p95 2.2 ms, max 3.4 ms once warm; the first pass with a cold JIT had p95 3.0 ms and max 12.8 ms. Rendering at save time probably fits 10 ms, but a cold isolate could not. Measure on a real Worker before relying on it (see [Open decisions](#open-decisions)).

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

The contact form. Called by the Astro Worker, **never by a browser**. Every request is authenticated with an HMAC signature.

**Flow.** The browser posts the form to the Astro Worker. **[L]** The skeleton turns Astro's `security.checkOrigin` off and says the contact form, when ported, validates `Origin` itself (`web-skeleton.md`). **[N]** That Astro endpoint then applies the honeypot, validates, signs the body and forwards it here with the visitor's address.

**Request**

```
POST /api/public/contact
Content-Type: application/json
X-Sakem-Timestamp: 1760000000
X-Sakem-Signature: 100be0a7675a05a0ce1be2619094b68d1bd9a269f233f58248cd01a6afa030e4
X-Sakem-Client-Ip: 203.0.113.7

{"fullName":"Budi Santoso","email":"budi@example.com","subject":"other","message":"Halo, saya ingin bertanya soal program.","website":""}
```

| Body field | Rule | |
| --- | --- | --- |
| `fullName` | string, trimmed, 2 to 120 characters | [L] |
| `email` | string, trimmed, lower-cased, valid email, at most 254 characters | [L] |
| `subject` | `partnership`, `donation` or `other` | [L] |
| `message` | string, trimmed, 10 to 5000 characters | [L] |
| `website` | honeypot: omit it or send `""`. A non-empty value is answered with the normal `201` and nothing is saved. | [L] |

The field rules and the Indonesian wording of the messages are the on-site form's (`contactSchema` and `CONTACT_MESSAGES` in the legacy `lib/contact.ts`); reproduce them word for word, since the Astro form shows them. The body is limited to 32 KiB. **[L]**

**Authentication: the exact algorithm [L]** (implemented and tested in the legacy seam, with the vector below)

```
signature = lowercase-hex( HMAC-SHA256( key  = the secret, as its UTF-8 bytes,
                                        data = timestamp + "." + rawBody ) )
```

- `timestamp`: Unix time in **seconds**, decimal digits only (`"1760000000"`), sent as `X-Sakem-Timestamp`. The receiver accepts a clock difference of up to **5 minutes** in either direction, otherwise `401`.
- `rawBody`: the **exact string you send as the request body**. Serialize once, sign that string, send that same string. Never sign an object and let the HTTP client serialize it again.
- The secret is used as the plain string (not base64-decoded): the value of `PUBLIC_API_SHARED_SECRET`, at least 32 characters.
- `X-Sakem-Signature`: the 64-character hex digest (upper case is accepted). `X-Sakem-Client-Ip`: the visitor's address (the Astro Worker's `CF-Connecting-IP`), one IPv4 or IPv6 literal.
- **The visitor address is believed only after the signature verified**, and is then the rate-limit key. The request itself reaches the API from the Astro Worker, so without this header every visitor would share one bucket. Note what the signature covers: exactly `timestamp + "." + rawBody`, **not** the address header; the address is trusted because only the secret holder can call the endpoint at all. Binding it into the MAC is an open decision below.

Test vector (check an implementation against it before talking to a server):

```
secret    = 0123456789abcdef0123456789abcdef
timestamp = 1760000000
body      = {"fullName":"Budi Santoso","email":"budi@example.com","subject":"other","message":"Halo, saya ingin bertanya soal program.","website":""}
signature = 100be0a7675a05a0ce1be2619094b68d1bd9a269f233f58248cd01a6afa030e4
```

Reproduce it with `printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex`. The secret above is a published dummy; never use it anywhere real.

**[N] Signing in the Astro Worker (Web Crypto):**

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
const res = await fetch(`${CONTENT_API_URL}/api/public/contact`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-sakem-timestamp": timestamp,
    "x-sakem-signature": await sign(env.PUBLIC_API_SHARED_SECRET, timestamp, rawBody),
    "x-sakem-client-ip": request.headers.get("cf-connecting-ip") ?? "",
  },
  body: rawBody,
});
```

**[N] Verifying in the API Worker (Hono).** Read the raw body once (`await c.req.text()`), check the timestamp window, then verify with `crypto.subtle.verify("HMAC", key, hexToBytes(signature), data)`, which compares in constant time; reject a signature that is not exactly 64 hex characters before decoding. Parse the JSON from the same string you verified.

**Responses.** Checks run in this order and the first failure answers. Authentication comes before anything that costs a D1 query, so an unsigned caller can neither fill the rate-limit store nor probe validation. **[L]**

| Status | `error` | When |
| --- | --- | --- |
| `503` | `service_unavailable` | `PUBLIC_API_SHARED_SECRET` is not set. Fail closed. |
| `400` | `body_too_large` | Body over 32 KiB (checked before the signature). |
| `401` | `unauthorized` | Missing headers, bad or tampered signature, or timestamp outside the window. A `reason` field says which: `missing_headers`, `timestamp_out_of_window` or `signature_mismatch`. |
| `400` | `invalid_client_ip` | `X-Sakem-Client-Ip` missing or not a single IP literal. |
| `429` | `rate_limited` | More than 5 submissions per minute for that visitor IP. Carries `Retry-After` and `retryAfterSeconds`. |
| `400` | `invalid_json` | The signed body is not JSON. |
| `400` | `validation_failed` | Field rules not met. Body: `{ error, message, fieldErrors }`, `fieldErrors` as `{ "email": ["Format email belum benar"] }`. |
| `429` | `duplicate_recent` | The same email already wrote within 5 minutes; nothing is saved. Carries `Retry-After` (300) and `retryAfterSeconds`. |
| `201` | none | Saved. Body `{ "ok": true, "message": "Pesan kamu sudah kami terima. Tim kami akan menghubungi via email." }`. The id of the new row is not returned. The same body answers a honeypot hit. |

Every response is `Cache-Control: no-store`. `429` and `validation_failed` bodies carry a ready-to-show Indonesian `message`.

A successful call **[L]** stores the message (name, email, subject, message) and writes an audit entry (`contact_message.submit`, actor = the sender's email, no message text). **[N]** The legacy app also invalidated cached admin views; the new admin reads D1 directly, so nothing needs invalidating.

**[N] Rate limiter storage** is open on the Free tier. Legacy was a fixed-window counter row per `(action, ip, window)` in Postgres, 5 per 60 s, shared with the on-site form's `contact.submit` bucket. A D1 counter table works but costs a write per request; KV or a platform rate-limit binding (if the plan offers one) may be cheaper. The behaviour above is what counts.

**Limits.** Within the 5-minute window an identical signed request can be replayed by someone who captured it (TLS protects the wire). The same-email guard and the rate limit bound the effect; there is no nonce store. **[L]**

## Configuration

| Name | Where | Notes |
| --- | --- | --- |
| `PUBLIC_API_SHARED_SECRET` | secret on **both** Workers (`wrangler secret put`, or untracked `.dev.vars` locally) | At least 32 characters (`openssl rand -base64 32`). Unset or blank is safe: the endpoint answers `503` and nothing else is affected. A set value shorter than 32 characters should stop the Worker at startup rather than weaken the HMAC. Rotating it means changing both sides. Never commit a value. |

**[N]** Over a service binding the call is internal and the HMAC adds little, **but only if the API Worker has no public route for the contact endpoint**. If it does, keep verifying the signature on every request. The GET endpoints need no configuration.

## What the Worker API must reproduce

The Astro site is written against this contract. The Worker API is conforming when it:

1. Serves the same paths and methods with the shapes above (the TypeScript wire types of the legacy seam, `lib/public-api/types.ts` on `feat/public-content-api`, are a ready starting point; the examples here are illustrative).
2. Exposes only those fields, built from explicit lists.
3. Keeps the orders: team by category rank, manual order, creation; reports newest year then newest upload; resources by category order then manual order; blog newest first.
4. Keeps the blog index semantics: featured picked as described and excluded from `articles`; `page` clamped; `pageSize` default 15 bounded to `1..50`; `total` excludes the featured article; unknown or unpublished slug is a JSON `404`; `related` follows the same-category-or-180-days rule with the newest-others fallback.
5. Returns `contentHtml` with the semantics above, rendered at save time, never on the read path, with `imageWidth`/`imageHeight` available.
6. Evaluates announcement windows at request time (no legacy tag-cache defect).
7. Sends the cache headers of the table above, and decides how an admin save refreshes them.
8. Keeps the contact contract: field rules and Indonesian messages verbatim, honeypot answered with `201`, one message per email per 5 minutes (`429 duplicate_recent`), 5 submissions per minute per visitor IP (`429 rate_limited` with `Retry-After`), the same error codes and check order, no id in the `201` body, the HMAC scheme and its test vector, `503` when the secret is unset.
9. Fits Workers Free: a handful of D1 queries per read endpoint, no per-request markdown rendering, no Node-only APIs on the request path (use Web Crypto, not `node:crypto`).
10. Keeps asset paths as strings the consumer can resolve (root-relative or absolute), and says where the files live.

## Reusing the legacy work

Everything below is on the local/reference branch `feat/public-content-api` (`f53121a` to `44b131f`). Nothing there is meant to be merged; it is a tested reference.

| Legacy artifact | Reuse in the Worker API |
| --- | --- |
| `lib/public-api/types.ts` | Wire types, type-only. Copy into a shared types file. |
| `lib/public-api/serializers.ts` | The explicit-field-list pattern; port the lists to the D1 row types. |
| `lib/public-api/signing.ts` and `__tests__/public-api-signing.test.ts` | The algorithm, the window, the 64-hex pre-check, the test cases. Port from `node:crypto` to Web Crypto (examples above); keep the test vector. |
| `lib/contact.ts` | The zod schema (zod runs on Workers), `CONTACT_MESSAGES`, `CONTACT_RATE_LIMIT`, honeypot handling. Rewrite the database part for D1. |
| `lib/blog-types.ts`: `buildBlogIndex`, `pickRelatedArticles` | Pure functions, copy verbatim. The Astro skeleton has the same logic as `getBlogPage` and `getRelated`; if the API returns the page, delete the Astro copy so there is one implementation. |
| `lib/public-api/blog-html.ts` and `__tests__/blog-html-parity.test.tsx` | The render pipeline (unified: remark-parse, remark-gfm, remark-rehype, rehype-stringify) and a parity test against react-markdown. Run it in the admin save path. The skeleton's `plugins/blog-content.mjs` already renders with the same engine at build time. |
| `__tests__/public-content-api.test.ts`, `public-contact-route.test.ts` | An executable spec: per-endpoint shapes, absence of private fields, pagination bounds and clamping, 404, every 4xx/5xx of the contact endpoint, the rate-limit key. Port the assertions. |
| `lib/rate-limit.ts`: explicit `ip` override | The idea: the limiter takes the visitor address from the authenticated caller, not from the request's own headers. |

## Open decisions

1. **Bind the visitor address into the MAC?** The algorithm above signs `timestamp + "." + rawBody` as specified. Signing `timestamp + "." + clientIp + "." + rawBody` would also stop a captured request being replayed with another address. Nothing is built against this yet, so changing it now is free; changing it later breaks both Workers. Recommendation: do it, but it is Dzul's call.
2. **Where blog, team, report and resource files live** (Worker assets, R2, or the legacy volume behind the pass-through), and therefore whether the API returns root-relative paths or absolute URLs.
3. **Where `contentHtml` is rendered**: in the API at save time (cost to be measured on a real Worker; the 10 ms limit also applies to the save request) or in the admin SPA with the API re-rendering or sanitizing.
4. **Rate-limiter storage** on the Free tier (D1 counter, KV, or a platform binding).
5. **Cache refresh after an admin save**: purge `caches.default` for the affected URLs, or accept the TTLs; and whether `TEAM_CACHE_FRESH_SECONDS` should drop below 5 minutes.
6. **Keeping the `/api/public` prefix** on the Worker API. Recommended: the Astro skeleton already depends on `/api/public/team`.
