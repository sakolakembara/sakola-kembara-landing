# Public content API: how it is built (SAKEM-081, part C)

The implementation of the contract in [`content-api.md`](content-api.md) inside the backend Worker ([`cf/admin`](../../cf/admin), Hono + D1 + Drizzle): the read endpoints under `/api/public/*`, the contact form, and the hook that tells caches a save happened. Epic SAKEM-074, milestone M2. **No production change: local D1 only**, no Cloudflare account was used, no resource exists. The contract is not changed by this page; where the code adds something, [Differences from the contract](#differences-from-the-contract) says so.

## What is in the box

| Part | Where |
| --- | --- |
| Read endpoints (`team`, `reports`, `resources`, `announcements/current`, `blog`, `blog/{slug}`) | `src/api/public/read.ts` |
| The contact form route | `src/api/public/contact.ts` |
| The public face, the internal face, and how they differ | `src/api/public/index.ts`, `src/api/public/internal.ts`, `src/api/public/entrypoint.ts` |
| Every D1 read, as unexecuted Drizzle queries (the plan test runs exactly these) | `src/public/queries.ts` |
| Field allow-list serializers | `src/public/serializers.ts` |
| Wire types, Jakarta dates, the pure blog rules | `src/public/types.ts`, `dates.ts`, `blog-rules.ts` |
| Cache headers and tags | `src/public/cache.ts` |
| Contact rules, messages, write; the limiter and Turnstile seam | `src/public/contact.ts`, `src/public/contact-deps.ts` |
| "Content changed" hook and purge plan | `src/public/purge.ts` |
| Migration `0004_public_blog_index` (one index) | `migrations/` |
| Tests (workerd, real local D1), query budget and plans, 28 negative checks | `test/public-*.test.ts`, `scripts/negative-checks.mjs` |
| Local wall time per route | `scripts/measure-public.mjs` (`pnpm measure:public`) |

Mounted in `src/worker.ts` with two lines (the route, before the admin middleware, and the `PublicApi` export).

## The two faces of the Worker

```
internet ──▶ default export (src/worker.ts) ──▶ GET /api/public/*      (read endpoints only)
                                                POST /api/public/contact → the Worker's ordinary 404

Astro Worker ──service binding, entrypoint "PublicApi"──▶ GET /api/public/*  and  POST /api/public/contact
```

### How the Worker tells a service-binding call from a public request

**It does not look at the request.** Nothing in a request proves where it came from: `X-Sakem-Client-Ip` can be set by anyone, and a service binding adds no header of its own. (Whether `CF-Connecting-IP` survives a binding call is not documented for this case and must be checked on a real zone; the code never depends on it.) The answer is the platform's routing:

- A route, `workers.dev` or a custom domain always runs the Worker's **default export**. The default export (`createPublicApp`) mounts the read endpoints and **nothing else**: there is no contact route on it, so `POST /api/public/contact` from the internet is the Worker's plain JSON 404, with no D1 read and no rate-limit slot used. Test: `test/public-contact.test.ts`, "only through the service binding".
- A **named `WorkerEntrypoint`** (`PublicApi`, `src/api/public/entrypoint.ts`) has no route and no address. Only a Worker that declares a service binding to it can call it (or code inside this Worker through `ctx.exports`). It serves the internal app (`createInternalApp`): the same read endpoints plus the contact route.
- The internal app marks every request (`markServiceBindingCall`), and the contact route refuses a request without the mark (`requireServiceBinding`). That is the second layer: a future edit that mounts the contact route on the public app by mistake still answers 404, instead of trusting a forged header. Test: "a mistake in the wiring still fails closed".
- Only the contact route reads `X-Sakem-Client-Ip`, only behind that mark. Spoofing tests: a forged header on the public face changes nothing (12 posts, all 404, nothing stored); on the internal face the rate-limit bucket is the header's value and never `CF-Connecting-IP`, `X-Forwarded-For`, `X-Real-IP` or `Forwarded`; with the header missing the post is refused (`invalid_client_ip`) even if the others are present.

**One change is needed in the Astro Worker.** `cf/web/wrangler.jsonc` declares today `"services": [{ "binding": "API", "service": "sakola-kembara-api" }]`: a placeholder name and **no `entrypoint`**. A binding without `entrypoint` reaches the public face, where the contact route does not exist (a 404, which the site shows as "unavailable"). It must name this Worker (`sakem-admin` in `cf/admin/wrangler.jsonc`, or whatever the deployed name is) and the entrypoint:

```jsonc
"services": [
  { "binding": "API", "service": "sakem-admin", "entrypoint": "PublicApi" }
]
```

Nothing else changes on that side: the form's call (`src/lib/contact-submit.ts`: JSON to `https://api.internal/api/public/contact` with `x-sakem-client-ip` set from `CF-Connecting-IP`) is what the route expects, and its handling of `201`, `400 validation_failed`, `429 rate_limited` and `429 duplicate_recent` matches the codes below. Two things it does not know yet: the `X-Sakem-Turnstile-Token` header and the `400 turnstile_failed` answer (it would show the latter as "unavailable"), both only relevant once Turnstile is wired. The host in the URL is ignored by a service binding. The read endpoints go through the same binding (`env.API.fetch("https://api.internal/api/public/team")`) or over public HTTP (`CONTENT_API_URL`); the answers are identical.

**Verified:** the two-face split and the header rules by the tests above, through the runtime's own entrypoint dispatch (`ctx.exports.PublicApi`, the loopback of a service binding); a real binding between local `wrangler dev` processes, with a probe Worker and with the built Astro site itself (see [How it was run](#how-it-was-run-locally)). **Not verified:** a deployed zone, and what `CF-Connecting-IP` looks like inside a binding call. That a public hostname cannot address a named entrypoint follows from how Workers dispatch routes to the default export, and the documentation presents named entrypoints only as service-binding targets; I found no sentence that states the negative outright, so check it once on the real zone: `curl -X POST https://<host>/api/public/contact` must be a 404 (it is, locally, because the default export has no such route, which is the guarantee this design leans on).

## Read endpoints

Exactly the contract's shapes, orders and headers. Each response is built by a serializer with an explicit field list (`src/public/serializers.ts`) from a query with an explicit column list (`queries.ts`).

| Endpoint | Statements (round trips) | Notes |
| --- | --- | --- |
| `team` | 1 (1) | category rank written out (`CASE`), then manual order, creation |
| `reports` | 1 (1) | `year` desc, `uploaded_at` desc |
| `resources` | 1 (1) | the page's category order (written out), then manual order |
| `announcements/current` | 1 (1) | window evaluated against the clock of this request |
| `blog` | 3 (1) in a batch; a page out of range costs a 4th (2) | featured, count, page |
| `blog/{slug}` | 2 (2); 3 (3) when nothing is related | article, related, fallback |

- **Order ties.** Every `ORDER BY` ends with the row order (`rowid`), so articles saved in the same instant keep one stable order across pages.
- **Parameters are never an error** (contract): they are read like `parseInt`, as the legacy page and `cf/web/blog-contract.mjs` do (`2.9` is 2, `3abc` is 3, `abc` and an empty value are the default), and an out-of-range one is clamped. So there is no `400` on the read endpoints; a slug that cannot exist (not `[a-z0-9]` words joined by single hyphens, or over 160 characters) is a `404` without touching D1, and an unpublished article is the same `404` as an unknown one.
- **`blog`** is answered from the three statements in one batch; the page is fetched with an optimistic offset and refetched only when `page` was out of range. The featured article is found by the query `ORDER BY featured DESC, published_at DESC LIMIT 1` over published rows, which the new index turns into a seek. `total` is the published count minus the featured one.
- **Dates** (`date`, `dateISO`, `modifiedISO`) are derived in Asia/Jakarta by arithmetic (`src/public/dates.ts`), at the 17:00 UTC boundary too.
- **`related`** is the contract's rule (same category, or published less than 180 Jakarta days apart; the first three, newest first; else the three newest others) done in SQL: the window is a plain range on `published_at`. The pure reference (`pickRelatedArticles`, a port of the legacy function) is in `blog-rules.ts`, and a test runs both over a mixed set of 36 articles and compares them for every article.
- **`contentHtml`** is returned exactly as stored; the read path never renders markdown. Test: stored HTML that does not match its markdown comes back as stored.
- **Headers.** `Cache-Control` as the contract's table (a test reads the table from `content-api.md` and compares), `Content-Type: application/json`, no cookie, **no `Vary`** (no request header changes an answer; a test sends cookies, credentials, `Origin` and a forged address and gets the same bytes), **no CORS** (`OPTIONS` is the Worker's 404), no `ETag`/`Last-Modified` (the contract defines neither; the only consumer keeps its own copy by TTL and never sends a conditional request, so a digest per response would buy nothing; add it if a consumer ever revalidates). A D1 failure is a `500` with `no-store`; the announcement answers `500`, never `{ "announcement": null }`.
- **`Cache-Tag`** (additive, not in the contract): `team`, `reports`, `resources`, `announcement`, `blog`, and `blog-<slug>` plus `blog` on an article. Inert unless something that understands it sits in front of the Worker; it is what a purge by tag needs ([Purge options](#purge-options)).

## Query budget

Free limits: 10 ms CPU per request, D1 5M rows read and 100k written per day. No endpoint loops over rows with a query per row; `test/public-budget.test.ts` counts D1 round trips, statements and `meta.rows_read` at a school-sized volume (250 articles of about 12 KB, 50 team members, 100 reports, 60 documents) and fails above a ceiling, and `EXPLAIN QUERY PLAN` runs on the exact queries.

Measured with that volume in the test run (round trips, statements and `rows_read` of the local D1) and in a `wrangler dev` of the Worker with about the same data (wall time of 40 requests after 5 warm-up, Apple M4, from Node over HTTP, so it includes the local hop; **not Worker CPU**, which workerd cannot report):

| Request | Round trips | Statements | Rows read | Wall time median / p95 (ms) | Body |
| --- | ---: | ---: | ---: | --- | ---: |
| `team` (50 members) | 1 | 1 | 100 | 1.8 / 3.3 | 21 KB |
| `reports` (100) | 1 | 1 | 200 | 1.7 / 2.7 | 16 KB |
| `resources` (60) | 1 | 1 | 120 | 1.6 / 2.1 | 14 KB |
| `announcements/current` | 1 | 1 | 6 | 1.3 / 2.0 | 0.2 KB |
| `blog` (250 articles) | 1 | 3 | 268 | 1.5 / 2.1 | 4 KB |
| `blog?pageSize=50` | 1 | 3 | 303 | 1.7 / 2.5 | 12 KB |
| `blog?page=3` / `page=10` | 1 | 3 | 298 / 403 | 1.5 / 2.5 (page 3) | 4 KB |
| `blog?page=999` (out of range) | 2 | 4 | 753 | not timed | 2 KB |
| `blog/{slug}` (13 KB body) | 2 | 2 | 4 | 1.8 / 2.4 | 13 KB |
| unknown valid slug | 1 | 1 | 0 | 1.4 / 1.9 | 21 B |
| impossible slug (`Tidak_Valid`) | 0 | 0 | 0 | not timed | 21 B |
| contact: saved | 1 | 2 | about 10 written (message with its indexes, audit row; the estimate of `d1-schema.md`) | not timed (needs the binding) | 90 B |
| contact: refused as a duplicate | 1 | 2 | nothing written, one index search | not timed | 160 B |

- **Plans.** The blog queries are index seeks and index-order walks with no sort (`blog_posts_status_featured_published_idx` for the featured article and the count, `blog_posts_status_published_idx` for pages and related, `blog_posts_slug_idx` for an article). `team`, `reports` and `resources` return every row of their table, so a scan reads no more than it returns; the sort of a few dozen small rows is why they read about twice the rows returned. `announcements` uses `announcements_active_idx`.
- **One migration** (`0004_public_blog_index`): `CREATE INDEX blog_posts_status_featured_published_idx ON blog_posts (status, featured, published_at)`. Without it the featured article is a sort of every article (about 600 rows read per index request at 120 articles instead of about 140). Cost: one more index entry per blog save. `pnpm db:drift` passes.
- **What costs the most**: the blog index's `count(*)`, which walks one index entry per published article (250 at school volume). At the 60 s cache window that is far under the daily budget even with every page and size requested once a minute; if the blog grows to thousands of articles, keep the count in a row updated by the save path.
- **Rows read are the local D1's `meta.rows_read`.** The real D1 documents the same meaning (rows scanned); confirm on the deployed Worker (SAKEM-084), together with CPU, which cannot be measured locally (workerd freezes timers during synchronous code).
- **The daily D1 read budget is exposed to anyone who can reach `/api/public/*`.** A response is cached by URL, so a query string nobody uses (`?x=1`, `?x=2`, ...) is a new cache key each time and reaches D1: about 200 rows for `reports`, about 270 for the blog index. 20 to 25 thousand such requests (a quarter of the 100,000 Worker requests a day) spend the 5M rows, and then **every D1 query fails, the admin's sign-in included**, until the day rolls over (the Astro side keeps serving its stale copy, up to 7 days). This is a property of any public endpoint on Free, not of one query. Options, cheapest first: a Cloudflare rate-limiting rule or a Cache Rule that ignores unknown query parameters on `/api/public/*`; a cache inside this Worker keyed by the canonical URL (`page` and `pageSize` only); or take the read endpoints off the public face altogether, because the internal face already serves them: if `cf/web` reads through the service binding, `createPublicApp` can be emptied (one line) and nothing on the internet reaches D1 through this Worker except the admin API. Decision for Dzul, see [Open decisions](#open-decisions).

## Contact form

`POST /api/public/contact`, internal face only. Checks run in the contract's order and the first failure answers; every response is `no-store`.

```
body over 32 KiB → X-Sakem-Client-Ip → rate limit → JSON → fields → bot check → one per email → 201
   400 body_too_large   400 invalid_client_ip   429 rate_limited   400 invalid_json   400 validation_failed
                                                              (honeypot: 201, nothing saved)   400 turnstile_failed*   429 duplicate_recent
```

\* only once a Turnstile check is wired in; see [The seam](#the-seam-for-the-limiter-and-turnstile).

- **Validation** is the on-site form's, word for word (`CONTACT_MESSAGES`, the zod schema in `src/public/contact.ts`). A JSON body can omit a field or send another type, which a form cannot: such a value is treated as empty, so the visitor sees the rule's own Indonesian message. Only text the legacy form never showed was added: `Maksimal 254 karakter` for an email over 254 characters (legacy showed a library default in English) and the bot-check message.
- **Honeypot**: a non-empty `website` is answered `201` with the normal body and nothing is saved, whatever else is wrong (legacy behaviour). It still uses a rate-limit slot, so it cannot be hammered for free.
- **Duplicate guard**, atomic: the check is inside the insert (`INSERT ... SELECT ... WHERE NOT EXISTS`), so two simultaneous posts with one email store one message (the legacy read-then-write let both through; a test fires five at once). The audit row is written only if the message was; both are one D1 batch, one round trip, one transaction (a test makes the audit insert fail and checks the message is rolled back).
- **Audit**: `contact_message.submit`, actor = the sender's email (no user id), metadata `{ subject }`, never the text.
- **Personal data**: no email, name or message text in any log line (a test sends saved, duplicate, invalid, honeypot, bot-check and 500 paths and searches everything logged). Errors log the error name only.
- **Never trusted**: `X-Forwarded-For`, `X-Real-IP`, `Forwarded`, and `CF-Connecting-IP`. The rate-limit key is `contact:<X-Sakem-Client-Ip>`, lower-cased; the header must be a single IPv4 or IPv6 literal. (An IPv6 visitor can rotate addresses inside a /64; bucketing by prefix is a hardening option, not in the contract.)
- **Status codes**: `201`, `400` (`body_too_large`, `invalid_client_ip`, `invalid_json`, `validation_failed`, and `turnstile_failed` if enabled), `429` (`rate_limited`, `duplicate_recent`), plus a plain `500` if D1 or a collaborator fails (nothing stored). `401` and `503 service_unavailable` are the contract's option C (HMAC), which is **not implemented**: transport A needs no secret.

### The seam for the limiter and Turnstile

The route knows two small interfaces (`src/public/contact-deps.ts`) and nothing else:

```ts
interface RateLimiter { hit(key: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> }
type VerifyTurnstile = (input: { token: string | null; ip: string }) => Promise<boolean>
```

`resolveContactDeps(env)` is the **only** place that chooses what stands behind them, with two lines marked `SEAM`:

| | Now | To wire part B's helper |
| --- | --- | --- |
| Rate limiter | the Cloudflare rate-limit binding `PUBLIC_CONTACT_LIMIT` (5 per 60 s, declared in `wrangler.jsonc`, namespace `7811`) through a 12-line adapter, `bindingRateLimiter`; without the binding, an in-memory fixed window (per isolate, so only a brake; production logs one warning) | adapt the shared limiter to `RateLimiter.hit` and return it from the first `SEAM` branch; the key is `contact:<ip>`, the limit 5 per 60 s |
| Turnstile | `turnstileDisabled`: every post passes | adapt the helper to `VerifyTurnstile` (it receives the token from the header `X-Sakem-Turnstile-Token` and the trusted address) and return it from the second `SEAM` line |

The binding answers yes or no and not "how long", so a refusal reports the whole period (60 s) as `retryAfterSeconds`: the honest upper bound. Counters are per Cloudflare location and eventually consistent: a brake, not an exact quota.

The contract has no Turnstile field. Rather than change the body, the token travels in the header `X-Sakem-Turnstile-Token` (set by the Astro Worker from the form's `cf-turnstile-response`), the check runs after the field checks (a typo does not spend a single-use token) and before the duplicate check, and a refusal is `400 { "error": "turnstile_failed", "message": ... }`. This is **an addition to the contract**, inactive until the helper is wired.

## Differences from the contract

None in a payload, header value, status or order that the contract defines. Additions, all inert or additive:

| Addition | Why |
| --- | --- |
| `Cache-Tag` response header on the read endpoints | what a purge by tag needs; invisible to a browser behind Cloudflare |
| Header `X-Sakem-Turnstile-Token` and error `400 turnstile_failed` | the Turnstile seam; only when a check is wired |
| `PUBLIC_CONTACT_LIMIT` rate-limit binding | the contact limiter (contract open question 4) |
| Index `blog_posts_status_featured_published_idx` | the query budget |

Not done, on purpose: the HMAC option C (`401`, `503`), `ETag`/`Last-Modified`, CORS, upload endpoints (milestone M3), the rendering of `contentHtml` (the blog save path renders it; the read path only returns it).

The fixture server of `cf/web` (`scripts/fixture-api.mjs`) differs from the contract in one way: its team members carry `displayOrder`, `createdAt` and `updatedAt`. The contract says they are not part of it (the Astro parser defaults them), so the API does not send them. Everything else matched, field by field, when the fixture's rows were loaded into the API's database, and the blog matched the fixture (which applies `cf/web/blog-contract.mjs` to the 80 migrated articles) for 104 requests (see [How it was run](#how-it-was-run-locally)). The blog rules exist twice by necessity (JavaScript on the site and in the fixture, SQL here); `test/public-blog-parity.test.ts` imports the site's module and fails if the SQL ever disagrees with it.

## Purge options

An admin save should reach the people looking at the site within the contract's window. What can hold an old answer: the Astro Worker's own copy (`caches.default`, per data centre, 60 s fresh, 7 days stale-if-error, and 5 minutes for `/tim` today), and any cache in front of this Worker. `src/public/purge.ts` is the interface and the plan; **the default does nothing and calls no Cloudflare API**.

```ts
notifyContentChanged({ area: "blog", slug }, c.executionCtx.waitUntil.bind(c.executionCtx)); // after the D1 write
```

`planPurge(change)` says what is stale (the public paths, the same keys the consumer caches under, and the cache tags); a `ContentPurger` decides how. The call runs through `waitUntil`: a slow or failing purge never delays or fails a save, and the log line has the purger's name and the error type, no URL.

| Option | What it takes | Staleness after a save | Limits and risks |
| --- | --- | --- | --- |
| **A. TTL only** (implemented, the default) | nothing | at most 60 s in a cache in front of the API (the contract's `s-maxage`), 360 s in the worst case (one stale answer while it refetches); plus the Astro side's own fresh window, so `/tim` can show an old value for about 6 minutes unless `TEAM_CACHE_FRESH_SECONDS` is lowered | none; the simplest thing that is correct |
| **B. Zone purge by URL** (`POST /zones/{zone}/purge_cache`, `files`) | a token with only the *Cache Purge* permission on that one zone, a secret on this Worker, the public origin of the site | seconds, in every data centre | Cloudflare documents that not every purge endpoint reaches entries stored with the Cache API: verify on the real zone that a single-file purge removes the Astro Worker's `caches.default` entry (purge everything always does). A URL purge needs every exact URL: the blog index has one per `page` and `pageSize`, so the plan names `?page=1..N` only. Free limits: 800 URLs per second, 100 per request. The Astro Worker's own copy lives under a synthetic key built by the consumer, which a zone purge may never see: the consumer would have to key its cache on a real URL of the zone |
| **C. Purge by tag** (the zone API with `tags`, or Workers Cache's `ctx.cache.purge({ tags })` if the API Worker's own cache is turned on with `"cache": { "enabled": true }`) | the `Cache-Tag` headers already sent; for Workers Cache a Wrangler version and compatibility date that support it | seconds, global | Free-plan limit for tag, prefix and purge-everything: **5 requests per minute**, so batch tags; Workers Cache is a cache in front of *this* Worker, not the Astro Worker's copy, so the Astro side would call the API through the binding without caching it itself. Documentation read, not tried on an account |

`cache.delete` from this Worker is not an option: the Cache API is per data centre, so it only removes the copy in the data centre that ran the save.

Recommendation: ship with A (it meets the contract), lower the Astro fresh window for `/tim` to 60 s, and decide on B or C only if a minute of staleness proves too long in practice; both are one `ContentPurger` and a change in `activePurger()`.

## Run it locally

```bash
cd cf/admin
pnpm install --frozen-lockfile
cp dev.vars.example .dev.vars        # fake local values, untracked
pnpm db:migrate:local && pnpm db:seed:local
pnpm exec wrangler dev --port 8791   # any free port; the SPA build is not needed for /api
curl -s localhost:8791/api/public/team
curl -s 'localhost:8791/api/public/blog?page=1&pageSize=15'
curl -s localhost:8791/api/public/blog/contoh-cerita-murid-sakola-kembara
```

The contact form cannot be reached by `curl` against the dev server, by design: it is on the `PublicApi` entrypoint, so reach it from a Worker that holds the binding (a second `wrangler dev` with the `services` entry above), or from a test (`internalFetch` in `test/public-helpers.ts`).

Gates: `pnpm typecheck`, `pnpm test` (the public API is `test/public-*.test.ts`), `pnpm test:negative`, `pnpm db:drift`. Wall time per route: `pnpm measure:public --base http://127.0.0.1:8791 [--volume]`.

## How it was run locally

Beyond the tests, with `wrangler dev` only (no account, `WRANGLER_SEND_METRICS=false`, random free ports), against the migrated and seeded local database:

- **Every endpoint by `curl`** on the dev server: 200s with the contract's shapes and headers, an unpublished and an impossible slug as 404, the contact post on the public face as 404 with a forged `X-Sakem-Client-Ip`.
- **The fixture's rows loaded into the API's database**, then the API and the fixture server (`cf/web/scripts/fixture-api.mjs`) compared field by field: `reports` and `resources` identical (same order, same fields, same values); `team` identical except that the fixture also sends `displayOrder`, `createdAt` and `updatedAt` on every member, which the contract says are not part of it (18 differences, all of that kind).
- **The blog against the fixture**: the 80 migrated articles (read with the site's own build-time reader, so with the rendered HTML) were stored as an import would store them, and 104 requests were compared with the fixture server's answers: 21 list variants (pages 0, -3, 999, `abc`, `2abc`, `1.9`, `99999999999999999999`; sizes 0, -4, 7.9, 51, `abc`, 50, 1), every one of the 80 articles with its `related`, and three unknown slugs. **Zero differences**, `Cache-Control` included.
- **The built consumer** (`cf/web`, `pnpm build`, then its own harness with `wrangler dev`) rendered 13 pages twice, once backed by the fixture and once by this API with the same rows (`/tim`, `/laporan`, `/gabung-siswa/docs`, `/blog`, `/blog?page=2`, `?page=6`, `?page=999`, four articles, an unknown article, `/sitemap.xml`): **the HTML is byte for byte identical** on every one, with the same `Cache-Control`.
- **The Astro site itself through the binding**: the built Worker, with its `API` binding pointed at `sakem-admin#PublicApi` (wrangler reports `local [connected]`), served `/blog` identical to the page it serves over `CONTENT_API_URL`, and a real `POST /kontak` form post (same-origin) answered `303` to `/kontak?terkirim=1`, stored the message, and the same email again was refused (`429`).
- **A real service binding** with a probe Worker (`{ "binding": "API", "service": "sakem-admin", "entrypoint": "PublicApi" }`): a post is `201`; the same email again is `429 duplicate_recent` with `Retry-After: 300`; six posts from one reported address are `201 x5` then `429`; a read through the binding answers like the public one; the same post on the Worker's public port with a forged `X-Sakem-Client-Ip` is `404`. The dev server's log contains no email, name or message text, and the audit rows carry no text.
- **Wall time** per route, in [Query budget](#query-budget), with `scripts/measure-public.mjs`.

Not run: anything on a Cloudflare zone or account (SAKEM-084), a browser (no visual QA applies: this is JSON), and the Astro form's own rate limit and Turnstile (not wired).

## Open decisions

1. **Where the read endpoints are reachable from.** Today `/api/public/*` is on the public face (the Astro Worker reads it over `CONTENT_API_URL`), so anyone can spend the daily D1 read budget with cache-busting query strings (see [Query budget](#query-budget)). Either add a rate-limit or Cache Rule at the zone, or have `cf/web` read through the `PublicApi` binding and empty `createPublicApp` (the reads are already on the internal face). Recommended: the binding, since the only consumer is the Astro Worker.
2. **Which purger, and when.** A (TTL only) is in; B or C need a zone, a token or a flag the epic has not decided. See [Purge options](#purge-options).
3. **Bucket IPv6 visitors by /64** in the contact rate limit (a visitor can rotate addresses inside it). One line in the route; not in the contract.
4. **Turnstile on the contact form**: the token transport (a header, as built) and the `400 turnstile_failed` code need the contract's blessing, and the Astro form needs the widget.
5. **`ETag`/`Last-Modified`** if the consumer ever revalidates instead of keeping a copy by TTL.
6. **The blog `count(*)`** is one index entry per article read per uncached request; fine at school volume, worth a stored count past a few thousand articles.
