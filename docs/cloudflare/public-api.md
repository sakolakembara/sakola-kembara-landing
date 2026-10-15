# Public content API: how it is built (SAKEM-081, part C)

The implementation of the contract in [`content-api.md`](content-api.md) inside the backend Worker ([`cf/admin`](../../cf/admin), Hono + D1 + Drizzle): the read endpoints under `/api/public/*`, the contact form, and the hook that tells caches a save happened. Epic SAKEM-074, milestone M2. **No production change: local D1 only**, no Cloudflare account was used, no resource exists. The contract is not changed by this page; where the code adds something, [Differences from the contract](#differences-from-the-contract) says so.

## What is in the box

| Part | Where |
| --- | --- |
| Read endpoints (`team`, `reports`, `resources`, `announcements/current`, `blog`, `blog/{slug}`) | `src/api/public/read.ts` |
| The shortlink lookup (an addition, SAKEM-082: [`admin-konten.md`](admin-konten.md#6-the-redirect)) | `src/api/public/shortlink.ts`, `src/public/shortlink.ts` (its query and its click write) |
| The contact form route | `src/api/public/contact.ts` |
| The public face, the internal face, and how they differ | `src/api/public/index.ts`, `src/api/public/internal.ts`, `src/api/public/entrypoint.ts` |
| Every D1 read, as unexecuted Drizzle queries (the plan test runs exactly these) | `src/public/queries.ts` |
| The same queries built once per isolate (`sql.placeholder` for the values), and the one-round-trip `batchAll` | `src/public/prepared.ts`, `src/db/client.ts` (one Drizzle instance per binding), `src/db/memo.ts` |
| Field allow-list serializers | `src/public/serializers.ts` |
| Wire types, Jakarta dates, the pure blog rules | `src/public/types.ts`, `dates.ts`, `blog-rules.ts` |
| Cache headers and tags | `src/public/cache.ts` |
| Contact rules, messages, write; the limiter and Turnstile seam | `src/public/contact.ts`, `src/public/contact-deps.ts` |
| "Content changed" hook and purge plan | `src/public/purge.ts` |
| Migration `0004_public_blog_index` (one index) | `migrations/` |
| Tests (workerd, real local D1), query budget and plans, 28 negative checks | `test/public-*.test.ts`, `scripts/negative-checks.mjs` |
| Local wall time per route | `scripts/measure-public.mjs` (`pnpm measure:public`) |

Mounted in `src/worker.ts` with two lines (`createPublicApp()`, which mounts nothing, and the `PublicApi` export).

## The two faces of the Worker

```
internet ──▶ default export (src/worker.ts) ──▶ GET  /api/public/*       → the Worker's ordinary 404, no D1 read
                                                POST /api/public/contact → the Worker's ordinary 404

Astro Worker ──service binding, entrypoint "PublicApi"──▶ GET /api/public/*  and  POST /api/public/contact
```

**The public face is empty (the PR that wired `cf/web` to this Worker).** Until then the read endpoints were on both faces, so anyone could spend the daily D1 read budget with cache-busting query strings (see [Open decisions](#open-decisions), 1, now settled). Now `createPublicApp()` mounts no route, and the only consumer, the Astro Worker, reads through the binding. What changed in this Worker: `src/api/public/index.ts` (the function is empty, with the reason in a comment), comments in `src/worker.ts`, `internal.ts`, `entrypoint.ts` and `read.ts`, and the tests: every read test now calls the entrypoint (`internalFetch`, `countedGet` and `internalFetchWithBindings` of `test/public-helpers.ts`) instead of the default export, because that is the only face that serves the reads (nothing was removed from them: same assertions, same data, same headers); `test/public-face.test.ts` (new, 13 tests) pins the invariant: every read URL and the contact route, on the default export, is the plain JSON 404 (`no-store`, no `Cache-Tag`, no cookie) with **zero D1 round trips and zero rows read**, 60 cache-busting requests read nothing, every other method is a 404 with no CORS grant, the same URLs answer 200 with the data on the entrypoint, and `createPublicApp().routes` is empty. In `scripts/negative-checks.mjs` the old check "public answers put behind the admin API's blanket no-store" (it broke the public face, which no longer serves them) became the same hazard on the entrypoint's app, and two checks were added: the read routes mounted on the public face again, and the read routes dropped from the entrypoint's app (the Astro Worker would read nothing); the "contact route mounted on the public app" check also runs the new file. Nothing was weakened: the public-face 404 for the contact route is still asserted (`test/public-contact.test.ts`, "only through the service binding"), now together with the reads.

### How the Worker tells a service-binding call from a public request

**It does not look at the request.** Nothing in a request proves where it came from: `X-Sakem-Client-Ip` can be set by anyone, and a service binding adds no header of its own. (Whether `CF-Connecting-IP` survives a binding call is not documented for this case and must be checked on a real zone; the code never depends on it.) The answer is the platform's routing:

- A route, `workers.dev` or a custom domain always runs the Worker's **default export**. The default export (`createPublicApp`) mounts **nothing under `/api/public`**: there is no read endpoint and no contact route on it, so `POST /api/public/contact` and every `GET /api/public/*` from the internet are the Worker's plain JSON 404, with no D1 read and no rate-limit slot used. Tests: `test/public-face.test.ts` and `test/public-contact.test.ts`, "only through the service binding".
- A **named `WorkerEntrypoint`** (`PublicApi`, `src/api/public/entrypoint.ts`) has no route and no address. Only a Worker that declares a service binding to it can call it (or code inside this Worker through `ctx.exports`). It serves the internal app (`createInternalApp`): the read endpoints and the contact route, the only place either exists.
- The internal app marks every request (`markServiceBindingCall`), and the contact route refuses a request without the mark (`requireServiceBinding`). That is the second layer: a future edit that mounts the contact route on the public app by mistake still answers 404, instead of trusting a forged header. Test: "a mistake in the wiring still fails closed".
- Only the contact route reads `X-Sakem-Client-Ip`, only behind that mark. Spoofing tests: a forged header on the public face changes nothing (12 posts, all 404, nothing stored); on the internal face the rate-limit bucket is the header's value and never `CF-Connecting-IP`, `X-Forwarded-For`, `X-Real-IP` or `Forwarded`; with the header missing the post is refused (`invalid_client_ip`) even if the others are present.

**The Astro Worker is wired (the same PR, `cf/web`: [`web-skeleton.md`](web-skeleton.md), "Service binding and Turnstile").** `cf/web/wrangler.jsonc` now declares

```jsonc
"services": [
  { "binding": "API", "service": "sakem-admin", "entrypoint": "PublicApi" }
]
```

`sakem-admin` is a placeholder for the deployed name (it is the `name` in `cf/admin/wrangler.jsonc`, a test keeps the two equal); without `entrypoint` the binding would reach the empty public face and every call would be a 404. The form's call (`src/lib/contact-submit.ts`: JSON to `https://api.internal/api/public/contact`, `x-sakem-client-ip` set from `CF-Connecting-IP`, the widget's token in `X-Sakem-Turnstile-Token` when the form has one) is what the route expects, and its handling of `201`, `400 validation_failed`, `400 turnstile_failed` ("Verifikasi gagal. Silakan coba lagi."), `429 rate_limited` and `429 duplicate_recent` matches the codes below. The host in the URL is ignored by a service binding. **Every read goes through the same binding** (`env.API.fetch("https://api.internal/api/public/team")`): `/tim`, `/laporan`, `/gabung-siswa/docs` and the blog; `CONTENT_API_URL` (a fixture or a local API) wins over it where it is set, for local runs and CI, and must not be set in production.

**Verified:** the two-face split and the header rules by the tests above, through the runtime's own entrypoint dispatch (`ctx.exports.PublicApi`, the loopback of a service binding); a real binding between local `wrangler dev` processes, with a probe Worker and with the built Astro site itself (see [How it was run](#how-it-was-run-locally)); and, in the `cf/web` e2e (group `binding`), the built site with neither API URL set reading all its pages and posting the form through a local service binding to a stand-in named `sakem-admin` on the `PublicApi` entrypoint. **Not verified:** a deployed zone, and what `CF-Connecting-IP` looks like inside a binding call. That a public hostname cannot address a named entrypoint follows from how Workers dispatch routes to the default export, and the documentation presents named entrypoints only as service-binding targets; I found no sentence that states the negative outright, so check it once on the real zone: `curl -X POST https://<host>/api/public/contact` **and `curl https://<host>/api/public/team`** must both be a 404 (they are, locally, because the default export has no such route, which is the guarantee this design leans on).

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
| `shortlinks/{slug}` (addition) | 1 (1), then 1 write in `waitUntil` after the answer; 0 for a path that cannot be a slug | the redirect's lookup. **The one read with a side effect**: it counts the click, without a limit, after the answer is decided; `no-store`, never cached. Contract: [`content-api.md`](content-api.md#get-apipublicshortlinksslug) |

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
| contact: saved | 1 | 2 | about 13 written (message with its indexes, audit row of 8; the estimate of `d1-schema.md`) | not timed (needs the binding) | 90 B |
| contact: refused as a duplicate | 1 | 2 | nothing written, one index search | not timed | 160 B |

- **Built once, bound per request (SAKEM-091).** The query builder is not free: a profile of the Worker's own JavaScript in a cold isolate put Drizzle at more than half of a read (`entity.is`, the SQL chunks, `extractTablesRelationalConfig` on every `drizzle()` call) while the SQL it produces never changes. So `src/public/prepared.ts` builds each query ONCE per D1 binding, from the same builders as above with `sql.placeholder` where a value varies (a slug, a page size, an offset, the date window of the related cards), on the first read of that query, and a request binds its values and executes. What does not change: the SQL text and the plans (`test/public-prepared.test.ts` compares the placeholder form with the literal form, statement by statement), the columns read, the decoding of the rows (Drizzle's own, from the prepared query), the round trips (the blog index is still one `batch`, now `batchAll`, which binds each prepared statement and maps its rows with the query's own decoder; `public-budget.test.ts` still counts 1), and the answers (every read and parity test passes unchanged). Nothing is remembered about an answer: only the statement. Local measurement of the Worker's own JavaScript per read, edge-like regime, median: blog 0.70 to 0.19 ms, article 0.68 to 0.17, team 0.51 to 0.20, reports 0.45 to 0.13, resources 0.49 to 0.16, short link 0.40 to 0.11 ([`free-plan-audit.md`](free-plan-audit.md#10-cpu-on-the-hot-routes-sakem-091)).
- **Plans.** The blog queries are index seeks and index-order walks with no sort (`blog_posts_status_featured_published_idx` for the featured article and the count, `blog_posts_status_published_idx` for pages and related, `blog_posts_slug_idx` for an article). `team`, `reports` and `resources` return every row of their table, so a scan reads no more than it returns; the sort of a few dozen small rows is why they read about twice the rows returned. `announcements` uses `announcements_active_idx`.
- **One migration** (`0004_public_blog_index`): `CREATE INDEX blog_posts_status_featured_published_idx ON blog_posts (status, featured, published_at)`. Without it the featured article is a sort of every article (about 600 rows read per index request at 120 articles instead of about 140). Cost: one more index entry per blog save. `pnpm db:drift` passes.
- **What costs the most**: the blog index's `count(*)`, which walks one index entry per published article (250 at school volume). At the 60 s cache window that is far under the daily budget even with every page and size requested once a minute; if the blog grows to thousands of articles, keep the count in a row updated by the save path.
- **Rows read are the local D1's `meta.rows_read`.** The real D1 documents the same meaning (rows scanned); confirm on the deployed Worker (SAKEM-084), together with CPU, which cannot be measured locally (workerd freezes timers during synchronous code).
- **The daily D1 read budget, and why the reads are not on the public face (settled).** A response is cached by URL, so a query string nobody uses (`?x=1`, `?x=2`, ...) is a new cache key each time and reaches D1: about 200 rows for `reports`, about 270 for the blog index. 20 to 25 thousand such requests (a quarter of the 100,000 Worker requests a day) would spend the 5M rows, and then **every D1 query fails, the admin's sign-in included**, until the day rolls over (the Astro side keeps serving its stale copy, up to 7 days). This is a property of any public endpoint on Free, not of one query. It was open while the reads were on the public face; now `cf/web` reads through the service binding and `createPublicApp` mounts nothing, so a request from the internet to `/api/public/*` is a 404 that reads no row (`test/public-face.test.ts`: 60 cache-busting requests, zero round trips). What is still reachable from the internet on this Worker and touches D1: the admin API and sign-in (rate-limited, behind Turnstile), nothing public. Requests from the Astro Worker are bounded by what it asks: it builds the paths itself (`page` and `pageSize` only, both clamped), caches 60 s per key and remembers an unknown slug for 30 s.

## Contact form

`POST /api/public/contact`, internal face only. Checks run in the contract's order and the first failure answers; every response is `no-store`.

```
body over 32 KiB → X-Sakem-Client-Ip → rate limit → JSON → fields → bot check → one per email → 201
   400 body_too_large   400 invalid_client_ip   429 rate_limited   400 invalid_json   400 validation_failed
                                                              (honeypot: 201, nothing saved)   400 turnstile_failed*   429 duplicate_recent
```

\* when `TURNSTILE_SECRET_KEY` is set (always in production; unset, the check is skipped outside production); see [The seam](#the-seam-for-the-limiter-and-turnstile).

- **Validation** is the on-site form's, word for word (`CONTACT_MESSAGES`, the zod schema in `src/public/contact.ts`). A JSON body can omit a field or send another type, which a form cannot: such a value is treated as empty, so the visitor sees the rule's own Indonesian message. Only text the legacy form never showed was added: `Maksimal 254 karakter` for an email over 254 characters (legacy showed a library default in English) and the bot-check message.
- **Honeypot**: a non-empty `website` is answered `201` with the normal body and nothing is saved, whatever else is wrong (legacy behaviour). It still uses a rate-limit slot, so it cannot be hammered for free.
- **Duplicate guard**, atomic: the check is inside the insert (`INSERT ... SELECT ... WHERE NOT EXISTS`), so two simultaneous posts with one email store one message (the legacy read-then-write let both through; a test fires five at once). The audit row is written only if the message was; both are one D1 batch, one round trip, one transaction (a test makes the audit insert fail and checks the message is rolled back).
- **Audit**: `contact_message.submit`, actor = the sender's email (no user id), metadata `{ subject }`, never the text.
- **Personal data**: no email, name or message text in any log line (a test sends saved, duplicate, invalid, honeypot, bot-check and 500 paths and searches everything logged). Errors log the error name only.
- **Never trusted**: `X-Forwarded-For`, `X-Real-IP`, `Forwarded`, and `CF-Connecting-IP`. The rate-limit key is `contact:<X-Sakem-Client-Ip>`, lower-cased; the header must be a single IPv4 or IPv6 literal. (An IPv6 visitor can rotate addresses inside a /64; bucketing by prefix is a hardening option, not in the contract.)
- **Status codes**: `201`, `400` (`body_too_large`, `invalid_client_ip`, `invalid_json`, `validation_failed`, and `turnstile_failed` when a Turnstile secret is set), `429` (`rate_limited`, `duplicate_recent`), plus a plain `500` if D1 or a collaborator fails (nothing stored): including a production Worker without `TURNSTILE_SECRET_KEY` or without the `RL_CONTACT` binding, and Siteverify being unreachable. `401` and `503 service_unavailable` are the contract's option C (HMAC), which is **not implemented**: transport A needs no secret.

### The seam for the limiter and Turnstile

The route knows two small interfaces (`src/public/contact-deps.ts`) and nothing else:

```ts
interface RateLimiter { hit(key: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> }
type VerifyTurnstile = (input: { token: string | null; ip: string }) => Promise<boolean>
```

`resolveContactDeps(env)` is the **only** place that chooses what stands behind them. **Wired since the auth work (SAKEM-081 part B, [`auth.md`](auth.md))**:

| | Behind it | Behaviour |
| --- | --- | --- |
| Rate limiter | `sharedRateLimiter`: the shared limiter of `src/security/rate-limit.ts`, binding `RL_CONTACT` (5 per 60 s, namespace `7808`). **One limiter only**: it replaced the `PUBLIC_CONTACT_LIMIT` binding (namespace `7811`) this route first declared, because the shared one fails closed in production | the key is `contact:<ip>` with the address from `X-Sakem-Client-Ip` and nothing else; a refusal reports the whole period (60 s); a missing `RL_CONTACT` binding is a throw in production (500, nothing stored, the binding named in the log) and the shared in-memory counter outside it |
| Turnstile | `sharedTurnstile`: `verifyTurnstile` of `src/security/turnstile.ts`, action `contact` | receives the token from `X-Sakem-Turnstile-Token` and the trusted address (sent to Siteverify as `remoteip`); a failed, missing or reused token is `false` (400 `turnstile_failed`); no `TURNSTILE_SECRET_KEY` in production, or Siteverify unreachable or unreadable, is a throw (500, nothing stored); outside production without a secret the check is skipped |

The binding answers yes or no and not "how long", so a refusal reports the whole period (60 s) as `retryAfterSeconds`: the honest upper bound. Counters are per Cloudflare location and eventually consistent: a brake, not an exact quota. `InMemoryRateLimiter` and `turnstileDisabled` remain in `contact-deps.ts` only as the test doubles of `test/public-contact.test.ts`.

The contract has no Turnstile field. Rather than change the body, the token travels in the header `X-Sakem-Turnstile-Token` (set by the Astro Worker from the form's `cf-turnstile-response`), the check runs after the field checks (a typo does not spend a single-use token) and before the duplicate check, and a refusal is `400 { "error": "turnstile_failed", "message": ... }`. This is **an addition to the contract**; the helper is wired (above), and with `TURNSTILE_SECRET_KEY` set (always in production) a post without a good token is refused. **The Astro Worker now does its part** (`cf/web`, [`web-skeleton.md`](web-skeleton.md)): the form renders the widget (`data-action="contact"`), the Worker forwards `cf-turnstile-response` in this header (dropped if it cannot travel in a header: printable ASCII without spaces, at most 2048 characters) and shows `400 turnstile_failed` as "Verifikasi gagal. Silakan coba lagi." with a fresh widget. A visitor without JavaScript cannot run the widget, so the form tells them to enable it, and in production their post is refused here; where no secret is set (local runs, tests) it is accepted, which is what keeps the e2e able to post without a browser.

## Differences from the contract

None in a payload, header value, status or order that the contract defines. Additions, all inert or additive:

| Addition | Why |
| --- | --- |
| `Cache-Tag` response header on the read endpoints | what a purge by tag needs; invisible to a browser behind Cloudflare |
| Header `X-Sakem-Turnstile-Token` and error `400 turnstile_failed` | the Turnstile check, now wired to the shared helper |
| `RL_CONTACT` rate-limit binding (was `PUBLIC_CONTACT_LIMIT`) | the contact limiter (contract open question 4), shared with the auth routes' limiter module |
| Index `blog_posts_status_featured_published_idx` | the query budget |
| `GET /api/public/shortlinks/{slug}` on the internal face, with its `Cache-Control: no-store` and a click counted in `waitUntil` | the short-link redirect of the site (SAKEM-082, [`admin-konten.md`](admin-konten.md#6-the-redirect)); the contract has it as an addition |

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

Neither the read endpoints nor the contact form can be reached by `curl` against this Worker's own dev server, by design: they are on the `PublicApi` entrypoint (the public face serves none of them), so reach them from a Worker that holds the binding, or from a test (`internalFetch` in `test/public-helpers.ts`). The built site and this Worker run in **one `wrangler dev` session** (a real local service binding, `sakem-admin#PublicApi`), which is also how the whole chain was checked in the PR that wired them (below):

```bash
cd cf/web && pnpm install --frozen-lockfile && pnpm build
cd ../admin
pnpm install --frozen-lockfile
cp dev.vars.example .dev.vars        # fake local values, untracked; ENVIRONMENT=development
mkdir -p dist/spa && touch dist/spa/index.html   # wrangler wants the assets directory; the SPA build is not needed for /api
pnpm db:migrate:local && pnpm db:seed:local
cd ../web
pnpm exec wrangler dev -c dist/server/wrangler.json -c ../admin/wrangler.jsonc --persist-to ../admin/.wrangler/state \
  --var LEGACY_ORIGIN_URL:http://127.0.0.1:4390 --var TURNSTILE_SITE_KEY:1x00000000000000000000AA
curl -s localhost:8787/tim                       # the team, read from this Worker's D1 through the binding
curl -s -D - -X POST localhost:8787/kontak -H 'origin: http://localhost:8787' --data-urlencode ...   # the form, through the binding
```

`--persist-to ../admin/.wrangler/state` is the directory `pnpm db:migrate:local` writes, so the site's Worker and this one share one local D1. With `.dev.vars` absent the API Worker runs as production (fail closed): a post answers 500 here and the site shows its "unavailable" page.

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
- **The PR that wired `cf/web` (this Worker's public face emptied): the built site and the real Worker in one `wrangler dev` session**, no API URL set, an empty D1 migrated by `db:migrate:local` plus one team member and one report inserted: `/tim` and `/laporan` showed those rows (read through `sakem-admin#PublicApi`); a form post with a dummy token was a `303`, one `contact_messages` row and one audit row were written (with no Turnstile secret set and `ENVIRONMENT=development` the check is skipped, so the token's verification was **not** exercised); the same Worker without `.dev.vars` (production mode, no secret) answered the post with a 500, nothing was stored (count unchanged), the log said the secret is not set, and the site showed "Pesan belum dapat dikirim saat ini." with a 503. Siteverify itself was never called (it is a request to Cloudflare; the API's tests fake it).

Not run in the first PR (#48): anything on a Cloudflare zone or account (SAKEM-084), a browser (no visual QA applies: this is JSON), and the Astro form with a Turnstile widget (it did not forward a token yet; it does now, tested against a stand-in widget, never Cloudflare's script). Not run in the wiring PR either: a browser, a Cloudflare zone or account, Cloudflare's real Turnstile script and Siteverify. Note: the first bullet's `curl` of the dev server's read endpoints no longer works (the public face serves none of them); read them through the site (see "Run it locally") or `internalFetch`.

## Open decisions

1. ~~**Where the read endpoints are reachable from.**~~ **Settled:** `cf/web` reads through the `PublicApi` binding and `createPublicApp` is empty, so nothing under `/api/public` is reachable from the internet and cache-busting query strings cannot reach D1 (see [Query budget](#query-budget) and [The two faces](#the-two-faces-of-the-worker)). One thing left to check on the real zone: that a public hostname gets a 404 for both a read URL and the contact route.
2. **Which purger, and when.** A (TTL only) is in; B or C need a zone, a token or a flag the epic has not decided. See [Purge options](#purge-options).
3. **Bucket IPv6 visitors by /64** in the contact rate limit (a visitor can rotate addresses inside it). One line in the route; not in the contract.
4. **Turnstile on the contact form**: the check is wired (above) and the Astro form now renders the widget (`data-action="contact"`), forwards the token in `X-Sakem-Turnstile-Token` and shows `400 turnstile_failed` (`cf/web`, same PR as the empty public face). **Still open:** the token transport (a header) and the code need the contract's blessing (they are additions to `content-api.md`), and nobody without JavaScript can send a message in production (the trade-off is documented in `web-skeleton.md`).
5. **`ETag`/`Last-Modified`** if the consumer ever revalidates instead of keeping a copy by TTL.
6. **The blog `count(*)`** is one index entry per article read per uncached request; fine at school volume, worth a stored count past a few thousand articles.
