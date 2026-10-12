# Public content API (`/api/public/*`)

> **Status: temporary seam (SAKEM-076, epic SAKEM-074).** During phase 1 of the Cloudflare migration the public pages move to an Astro Worker, while this Next app and its Postgres stay the data source and keep serving login, portal, admin and `/api/*`. The Worker cannot read Postgres, so this app exposes the public content as read-only JSON, plus one server-to-server endpoint for the contact form. When phase 2 moves the data to a Worker API, **that API must return the same shapes** (see [What the new Worker API must reproduce](#what-the-new-worker-api-must-reproduce)); the Astro site then changes its base URL and nothing else.

Code: `app/api/public/**/route.ts` (handlers), `lib/public-api/` (wire types, serializers, HTTP helpers, HMAC, blog HTML renderer), `lib/contact.ts` (contact logic shared with the on-site form). Tests: `__tests__/public-*.test.ts`, `__tests__/blog-html-parity.test.tsx`.

## Conventions

- Base path `/api/public`, JSON (`application/json`), UTF-8. `GET` endpoints need no credentials and set no cookies. There is no CORS: only the Worker (server to server) calls them, never a browser.
- **Only what the public site already shows.** Each serializer in `lib/public-api/serializers.ts` lists the exposed fields one by one, so a column added to a table later stays private until someone adds it on purpose. No emails, no audit data, no uploader or author user ids, no admin notes, no timestamps the site does not display.
- **Asset paths are root-relative to the old site's origin**: team photos (`/images/team/…`), report PDFs (`/reports/…`), resource files (`/resources/…`) and blog images (`/blog/images/…`, also inside `contentHtml`). They are files on the old app's persistent `public/` volume. The consumer must make them resolve (proxy those path prefixes to the old origin, or move the files later), or prefix them itself. A blog `image` may also be an absolute `https://` URL (legacy WordPress images).
- Errors are JSON, `{ "error": "<code>", ... }`. Unhandled server failures (for example the database being down) are a plain HTTP 500; the handlers only set `s-maxage` on successful answers, so nothing is told to cache a failure.
- Dates are the strings the site shows (`"21 Mei 2026"`) next to ISO sort keys (`"2026-05-21"`); none of the public tables expose a raw timestamp.

## Caching

| Endpoint | `Cache-Control` |
| --- | --- |
| `team`, `reports`, `resources`, `blog`, `blog/[slug]` | `public, s-maxage=60, stale-while-revalidate=300` |
| `announcements/current` | `public, s-maxage=30, stale-while-revalidate=60` |
| `blog/[slug]` unknown slug (404) | `public, s-maxage=30` |
| `POST contact`, every error | `no-store` |

Why: the data changes when an admin saves, and those saves call `revalidateTag`, so **the origin is fresh immediately** (the handlers read through the same `unstable_cache` readers as the pages and are `force-dynamic`, so no response is frozen at build time). What can lag is a cache in front of it: at most `s-maxage` fresh, then one stale answer while it refetches, so an edit shows within about a minute and never takes more than about six. Announcements get the shorter window because an urgent notice should appear and disappear quickly. A 404 is cached for 30 s so probing cannot hammer the origin, while a newly published article still appears within 30 s.

`Vary`: responses depend on no request header. Next adds its RSC headers (`rsc`, `next-router-state-tree`, …) to `Vary` on every app-router response; a server-to-server caller never sends them, so there is a single variant. Responses are safe to share across callers.

## Endpoints

### `GET /api/public/team`

Team members, ordered by category (`dewan_pembina`, `dewan_pengawas`, `pengurus`), then the admin's manual order. Source: `lib/team.ts` (`tag "team"`).

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

`image`, `bio` may be `null`. `degree`, `year`, `period` may be `null` or absent. `id` is a UUID the site uses as a stable key.

### `GET /api/public/reports`

Reports, newest academic year first, then newest upload first (the order `/laporan` groups by). Source: `lib/reports.ts` (`tag "reports"`).

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

`category` is `yearly | financial | impact | donation`; `year` is `"2025"` or `"2025/2026"`; `fileSize` is bytes; `description` may be `null`. Group by `year` on the consumer side (descending string order is chronological).

### `GET /api/public/resources`

Documents of `/gabung-siswa/docs`, flattened in the page's order: categories `panduan`, `berkas-pendaftaran`, `berkas-marketing`, `tutorial`, `lainnya` (empty ones absent), then the admin's manual order inside each. Group by `category` on the consumer side. Source: `lib/site-resources.ts` (`tag "site-resources"`).

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

Exactly one of `filePath` (+ `fileSize`), `externalUrl`, `bodyText` is set, matching `contentType` (`file | url | text`); the others are `null`. The admin-only `notes` field is not exposed.

### `GET /api/public/announcements/current`

The active announcement for the strip, or `null`. Source: `lib/announcements.ts` (`tag "announcements"`). The older `GET /api/announcements/current` (full row, used by the Navbar) is unchanged.

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

`severity` is `info | warning | urgent`; `ctaLabel`/`ctaUrl` may be `null`; `ctaUrl` is relative or absolute. When nothing is active: `{ "announcement": null }`.

### `GET /api/public/blog?page=&pageSize=`

The `/blog` index: one **featured** article (the newest flagged `featured`, otherwise the newest) plus the rest, newest first, in pages. The featured article is not repeated in `articles`. The old page shows it on page 1 only; the API always returns it. Source: `lib/blog.ts` (`tag "blog"`), logic shared with the page in `lib/blog-types.ts` (`buildBlogIndex`).

| Query | Default | Rule |
| --- | --- | --- |
| `page` | `1` | integer; out of range is **clamped** to `1..totalPages` (never an error); non-numeric means `1` |
| `pageSize` | `15` | integer, bounded to `1..50`; non-numeric means `15` |

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
    "author": "Deanita",
    "featured": true
  },
  "articles": [ { "slug": "...", "title": "...", "category": "News", "date": "...", "dateISO": "...", "excerpt": "...", "image": null, "author": "...", "featured": false } ],
  "page": 1,
  "pageSize": 15,
  "total": 79,
  "totalPages": 6
}
```

`total` counts the articles across all pages **excluding the featured one**. `excerpt` has the WordPress `[…]` trailer already stripped (`cleanExcerpt`). `image` is `null` when the article has none. `slug` is `BlogArticle.id` of the old type. `featured` is `null` only on an empty blog (then `articles: []`, `page: 1`, `totalPages: 1`).

### `GET /api/public/blog/[slug]`

One article, with the markdown source, the rendered HTML and related articles. An unknown slug is `404` with `{ "error": "not_found" }`.

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
    "author": "Deanita",
    "featured": true,
    "contentMarkdown": "### **Kenal Dengan Ahdan** ...",
    "contentHtml": "<h3><strong>Kenal Dengan Ahdan</strong></h3>\n<p>...</p>"
  },
  "related": [ { "slug": "...", "title": "...", "category": "...", "date": "...", "dateISO": "...", "excerpt": "...", "image": "...", "author": "...", "featured": false } ]
}
```

- `image` is the hero image. `modifiedISO` and `author` feed the page's structured data.
- `related`: up to 3 summaries (never the article itself): same category, or published within 180 days; if none match, the newest others. The same rule as the page (`pickRelatedArticles` in `lib/blog-types.ts`). Their `slug`s are the "related slugs"; the full summary saves the consumer a request per card.
- `contentHtml` is the markdown rendered **the way the site renders it** (`lib/public-api/blog-html.ts`; the same remark-parse + remark-gfm + remark-rehype pipeline react-markdown uses, ending in an HTML string, because Next does not allow `react-dom/server` in a route handler). It is safe to inject as is: raw HTML in the markdown is shown as escaped text, link and image URLs go through react-markdown's `defaultUrlTransform` (`javascript:` and similar become empty). Links to `http(s)` get `target="_blank"`, every link gets `rel="noopener noreferrer"`, and a markdown link title is not rendered (as on the site). Images are a plain `<img class="rounded-xl max-w-full h-auto my-6" loading="lazy">`: the site's `next/image` optimizer has no equivalent in a static string. The outer `<div class="blog-content">` is **not** included; wrap it, so the existing `.blog-content` styles apply. Known, intentional differences from the site, none of which occurs in `content/blog` today: table column alignment comes out as an `align` attribute (the site turns it into `style="text-align:…"`), and footnote links keep their `id`/`aria-*` attributes.

### `POST /api/public/contact`

The contact form, called by the Astro Worker. **Not for browsers.** Every request is authenticated with an HMAC signature.

**Request**

```
POST /api/public/contact
Content-Type: application/json
X-Sakem-Timestamp: 1760000000
X-Sakem-Signature: 100be0a7675a05a0ce1be2619094b68d1bd9a269f233f58248cd01a6afa030e4
X-Sakem-Client-Ip: 203.0.113.7

{"fullName":"Budi Santoso","email":"budi@example.com","subject":"other","message":"Halo, saya ingin bertanya soal program.","website":""}
```

| Body field | Rule |
| --- | --- |
| `fullName` | string, trimmed, 2 to 120 characters |
| `email` | string, trimmed, lower-cased, valid email, at most 254 characters |
| `subject` | `partnership`, `donation` or `other` |
| `message` | string, trimmed, 10 to 5000 characters |
| `website` | honeypot: omit it or send `""`. A non-empty value is answered with the normal `201` and nothing is saved (the form does the same). |

The rules are the on-site form's (`contactSchema` in `lib/contact.ts`, one definition for both), and so is the Indonesian wording of the messages. The body is limited to 32 KiB.

**Authentication: the exact algorithm**

```
signature = lowercase-hex( HMAC-SHA256( key  = the secret, as its UTF-8 bytes,
                                        data = timestamp + "." + rawBody ) )
```

- `timestamp`: Unix time in **seconds**, decimal digits only (`"1760000000"`). Sent as `X-Sakem-Timestamp`. The server accepts a clock difference of up to **5 minutes** in either direction; otherwise `401`.
- `rawBody`: the **exact string/bytes you send as the request body**. Serialize once, sign that string, send that same string. Never sign an object and let the HTTP client serialize it again.
- The secret is used as the plain string (not base64-decoded). It is the value of `PUBLIC_API_SHARED_SECRET`, at least 32 characters; the same value is set as a secret on the Worker.
- `X-Sakem-Signature`: the hex digest, 64 characters (upper case is accepted).
- `X-Sakem-Client-Ip`: the visitor's address (the Worker's `CF-Connecting-IP`), an IPv4 or IPv6 literal. The request itself reaches this app from a Cloudflare address, so without this header every visitor would share one rate-limit bucket. The header is only trusted **after** the signature verified, and is used as the rate-limit key. Note what the signature covers: exactly `timestamp + "." + rawBody`, not this header; the address is believed because only the secret holder can call the endpoint at all.

Test vector (check your implementation against it before talking to the server):

```
secret    = 0123456789abcdef0123456789abcdef
timestamp = 1760000000
body      = {"fullName":"Budi Santoso","email":"budi@example.com","subject":"other","message":"Halo, saya ingin bertanya soal program.","website":""}
signature = 100be0a7675a05a0ce1be2619094b68d1bd9a269f233f58248cd01a6afa030e4
```

(Reproduce it with `printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex`.)

Signing in a Worker (Web Crypto):

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
const res = await fetch(`${ORIGIN}/api/public/contact`, {
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

**Responses**

Checks run in this order, and the first failure answers. Authentication comes before anything that costs a database query, so an unsigned caller can neither fill rate-limit buckets nor probe validation.

| Status | `error` | When |
| --- | --- | --- |
| `503` | `service_unavailable` | `PUBLIC_API_SHARED_SECRET` is not set. The endpoint fails closed; the rest of the app is unaffected. |
| `400` | `body_too_large` | Body over 32 KiB (checked before the signature). |
| `401` | `unauthorized` | Missing headers, bad or tampered signature, or timestamp outside the 5-minute window. A `reason` field says which: `missing_headers`, `timestamp_out_of_window` or `signature_mismatch`. |
| `400` | `invalid_client_ip` | `X-Sakem-Client-Ip` missing or not a single IP literal. |
| `429` | `rate_limited` | Over 5 submissions per minute for that visitor IP (the same `contact.submit` bucket the on-site form uses). Carries `Retry-After` and `retryAfterSeconds`. |
| `400` | `invalid_json` | The signed body is not JSON. |
| `400` | `validation_failed` | Field rules not met. Body: `{ error, message, fieldErrors }` with `fieldErrors` as `{ "email": ["Format email belum benar"], ... }`. |
| `429` | `duplicate_recent` | The same email already wrote within 5 minutes; nothing is saved. Carries `Retry-After` (300) and `retryAfterSeconds`. |
| `201` | none | Saved. Body: `{ "ok": true, "message": "Pesan kamu sudah kami terima. ..." }` (the id of the new row is not returned). The same body answers a honeypot hit. |

Every response is `Cache-Control: no-store`. `429` and `validation_failed` bodies also carry a ready-to-show Indonesian `message`.

What a successful call does is what the form does: writes a `contact_messages` row, an audit entry (`contact_message.submit`), and `revalidateTag("contact-messages")` plus the admin paths, so the message shows up in `/admin/messages` at once.

Limits worth knowing: within the 5-minute window an identical signed request can be replayed by someone who captured it (TLS protects the wire). The same-email guard and the rate limit bound the effect; there is no nonce store.

## Configuration

| Name | Where | Notes |
| --- | --- | --- |
| `PUBLIC_API_SHARED_SECRET` | GitHub secret in the `production` environment (a repo admin creates it), written to the server's `.env.local` by `.github/workflows/deploy.yml`; also a secret on the Worker | At least 32 characters (`openssl rand -base64 32`; avoid `$`, see [`../current-state/deployment.md`](../current-state/deployment.md)). **Blank or unset is safe:** `lib/env.ts` treats it as unset, the app boots, and `POST /api/public/contact` answers `503`. A set value shorter than 32 characters stops the app at boot with `Invalid environment variables`. Rotating it means changing both sides. |

The `GET` endpoints need no configuration. `.env.example` lists the name only.

## What the new Worker API must reproduce

The Astro site is written against this contract. The Worker API that replaces this seam in phase 2 is conforming when it:

1. Serves the same paths and methods, with the shapes of `lib/public-api/types.ts` (that file is the typed source of truth; the examples above are illustrative).
2. Exposes only those fields. New columns stay private until added deliberately.
3. Keeps the orders: team by category then manual order; reports newest year then newest upload; resources by category order then manual order; blog newest first.
4. Keeps the blog index semantics: featured picked as described and excluded from `articles`; `page` clamped, `pageSize` default 15 and bounded to `1..50`; `total` excludes the featured article; unknown slug is a JSON `404`; `related` follows the 180-day/same-category rule with the newest-others fallback.
5. Returns `contentHtml` rendered with the semantics above (raw HTML escaped, URL protocols filtered, link and image attributes). On the free Workers plan (10 ms CPU per request) render it **when an article is saved** and store it next to the markdown, not on each request.
6. Sends the cache headers of the table above (or equivalent edge caching) and keeps the origin fresh on admin saves.
7. Keeps the contact contract: the same field rules and Indonesian messages, honeypot answered with `201`, one message per email per 5 minutes (`429 duplicate_recent`), 5 submissions per minute per visitor IP (`429 rate_limited` with `Retry-After`), the same error codes, and no id in the `201` body. The HMAC scheme only matters while a separate caller signs requests; if the new API receives the form directly (or through a service binding), authentication can change, the rest of the contract stays.
8. Keeps asset paths as they are today (root-relative), or the Astro site must be told how to resolve them.

## Operating notes

- Order of rollout: merge, create the `PUBLIC_API_SHARED_SECRET` secret, deploy (until then the contact endpoint answers `503` and every `GET` already works), set the same secret on the Worker, then send the test vector's request to confirm `401`/`201` behave as above.
- If `GET`s answer `500`, the database is unreachable (the readers are not tolerant, unlike the announcement strip); check `docker compose logs app`.
- Deleting this seam later: remove `app/api/public/`, `lib/public-api/`, `lib/contact.ts`'s API use, the env variable and its workflow line. `lib/contact.ts` itself stays: the on-site form uses it.
