# Workers Free plan audit

Every Cloudflare feature, binding and limit that `cf/web` and `cf/admin` rely on, checked against the **current Cloudflare documentation** (read on 2026-10-13), with what we use, a verdict and a fallback. Ticket: SAKEM-084 (M5-A). The decision it serves: the whole site runs on the Workers **Free** plan, $0, in the organisation account ([`README.md`](README.md), [`account-setup.md`](account-setup.md)).

**Method and limits of this audit.** Documentation reading only, plus `wrangler deploy --dry-run` and `wrangler check startup` on this machine. No account was used: no login, no deploy, no remote command. A document that is silent is reported as silent, never as "available". Where only a deployed Worker can answer, the row says **Real account** and the question is in [section 9](#9-what-only-a-real-account-can-settle), in the order a staging run settles it. Vendor pages other than Cloudflare's (Resend) are cited the same way.

**Verdicts.**

- **OK**: available on Free, our usage is well inside the limit.
- **RISK**: available, but our usage may reach the limit, or the behaviour has a sharp edge, or the documentation does not settle it. Every RISK has a fallback.
- **BLOCKER**: documented as unavailable on Free, or provably over a limit, with no way around it inside the plan.

## 1. Result

**No documented BLOCKER.** Nothing we use is documented as Paid-only, and nothing is provably over a limit. Three items are not settled by documentation and would **become BLOCKERs** if the real account answers badly; they come first because the rest of the plan depends on them:

1. **The Rate Limiting binding (`ratelimits`) on Free: the documentation does not say.** The page lists no plan, no quota and no price; the GA announcement says "stable and recommended for all production workloads" and names no plan either. Every limit of the site is built on it (sign-in, registration, password reset, the mail target, token redemption, the contact form, uploads, the blog preview: ten bindings). The code **fails closed** when a binding is missing (sign-in and contact answer 503), so if a deploy were refused, or the binding did nothing, the admin could not be used. Nothing short of deploying settles this. The fallback design is in [3.1](#31-rate-limiting-binding-ratelimits). **Decided (PM, 2026-10-13): if the binding is refused on Free, the fallback to build is the SQLite-backed Durable Object limiter, as a separate task; it is not built now.** **First thing to check in the first staging deploy, before anything else.**
2. **Admin sign-in CPU.** PBKDF2-SHA256 at 100,000 iterations took 8.1 ms of wall time in Node for the hash alone; the route measured 13 ms of wall time through a local `wrangler dev`. Cloudflare says authentication and server-side rendering "typically use 10-20 ms" and does not say whether native WebCrypto time counts as CPU. It probably does. Registration and the password reset do the same hash. Likely a failure on Free; the measurement settles it ([2.3](#23-cpu-time-per-request)). **Decided fallback order (PM, 2026-10-13): fewer iterations first (the stored hash carries its own count, so it is safe to change), then sign-in with Google (already wired), then the Paid plan.** The hash in a second Worker behind a service binding is not part of that order (the documentation does not say whether the CPU limit applies to each Worker or to the sum).
3. **A fresh isolate.** The first request into a cold isolate pays for module start-up (local profile: 85 ms of CPU for the admin, 52 ms for the site, against a 1 s start-up limit) and, for the blog save, the first markdown render (two to three times a warm one). Whether start-up counts against the 10 ms of a request is not stated. The measurement tool reports the first invocation after an idle gap apart for this reason.

**Update, 2026-10-14 (SAKEM-091).** The first CPU measurement on a real Worker came back with the admin's 401 routes at 5 to 18 ms, the site's pages at 5 to 13 ms (maximum 56) and a sign-in at 89 ms, none of them killed. [Section 10](#10-cpu-on-the-hot-routes-sakem-091) has the numbers, a local before/after harness for both Workers, where the CPU goes (Better Auth built per request, Drizzle's builder, Astro's renderer, compilation on a first call) and what was changed; the sign-in item below (2) and the CPU row of the table are not settled by it.

**Other RISKs that need a decision or a watch** (each in its section):

| Where | RISK | Fallback in one line |
| --- | --- | --- |
| [2.3](#23-cpu-time-per-request) | Blog save and preview render, SSR pages, large multipart uploads: CPU never measured on Cloudflare | `BODY_MAX` lower, render in the browser, raw-body upload; numbers from `measure-staging.mjs` |
| [2.4](#24-requests-per-day) | 100,000 Worker requests a day for the whole account (staging included); over it, error 1027 | **decided:** the public production route fails OPEN to the old origin (the WordPress site behind the same hostname), the admin host fails CLOSED |
| [3.4](#34-cache-api-cachesdefault) | Cache API is only documented to work on custom domains: no cache on `workers.dev`, so the staging numbers are the uncached worst case | code already treats a miss as the normal path; test the cache on cutover day |
| [4.1](#41-d1) | One viral short link can spend the day's 100,000 D1 writes (accepted by Dzul, 2026-10-12) | per-link daily cap or no counting |
| [4.2](#42-r2) | `r2.dev` is rate limited and "not for production": production needs the zone and a custom domain | `files.` custom domain at cutover |
| [5](#5-observability) | Workers Logs records the **full request URL** of every invocation, including `?token=` of verification links and OAuth callbacks | **decided:** `invocation_logs` stays ON during M5 (the CPU record needs it); log retention and URL-token exposure are decided before cutover (go-live precondition P-23 of the cutover runbook) |
| [7](#7-staging-findings) | On `workers.dev` a pass-through path (`/wp-login.php`, `/wp-admin/*`, `/wp-content/*`; before SAKEM-103 `/_next/*`, `/images/team/*`) fetches the Worker's own address again: up to 16 invocations per request | `LEGACY_ORIGIN_URL` as a `*.invalid` host at deploy (done in the deploy command) |
| [6.2](#62-resend) | Resend Free: 100 mails a day, 3,000 a month; without a verified domain only the account owner receives mail | verify a domain at cutover; invite yourself on staging |

**A stale statement, now fixed.** Several pages quoted "3 MB compressed Worker size" for Free ([`README.md`](README.md), [`web-skeleton.md`](web-skeleton.md), [`admin-crud.md`](admin-crud.md), [`admin-blog.md`](admin-blog.md); [`admin-skeleton.md`](admin-skeleton.md) already had the new rule). The limits page says there is **no compressed limit and 64 MiB uncompressed** on Free and Paid ([2.1](#21-worker-size)). Our bundles pass either rule. Those lines now say so and point here.

**Decisions taken on the open points (PM, 2026-10-13):** D1 and R2 location hint `apac`; `invocation_logs` stays on during M5 and log retention and URL-token exposure are decided before cutover (cutover precondition P-23); if the Rate Limiting binding is refused on Free, the Durable Object (SQLite) limiter is the fallback, built as a separate task and not now; sign-in CPU fallback order: fewer iterations, then Google, then Paid; the public production route fails OPEN to the old origin and the admin host fails CLOSED. Each is recorded where it applies below and in [`staging-runbook.md`](staging-runbook.md) and [`cutover-runbook.md`](cutover-runbook.md).

### All verdicts

| # | Feature | Free? | Verdict |
| --- | --- | --- | --- |
| 2.1 | Worker size | 64 MiB uncompressed, no compressed limit | OK |
| 2.2 | Worker start-up time | 1 s | OK |
| 2.3 | CPU per request | 10 ms | **RISK** (measured on staging 2026-10-14: [section 10](#10-cpu-on-the-hot-routes-sakem-091); sign-in, the site's pages and the first request of an isolate are above the target) |
| 2.4 | Requests per day | 100,000, account-wide | RISK (low), watch |
| 2.5 | Subrequests per request | 50 (1,000 to internal services) | OK |
| 2.6 | Memory, connections, body size, variables | 128 MB, 6, 100 MB, 64 x 5 KB | OK (25 MB upload: watch) |
| 3.1 | Rate Limiting binding | **not documented either way** | **RISK, BLOCKER if refused** |
| 3.2 | Service bindings and named `WorkerEntrypoint` | yes | OK |
| 3.3 | Static assets, `run_worker_first`, `_headers`, `_redirects` | yes, free and unlimited | OK (one file at 93% of its limit) |
| 3.4 | Cache API on `workers.dev` | documented for custom domains only | RISK (not testable on staging) |
| 3.5 | `waitUntil` | yes, 30 s after the response | OK |
| 3.6 | `nodejs_compat`, compatibility date | yes | OK |
| 3.7 | Wrangler environments and provisioning | yes | OK (a write-back trap, handled) |
| 3.8 | `workers.dev`, Preview URLs | yes, "free website" | OK |
| 4.1 | D1 | 5M reads and 100k writes a day, 500 MB per database | OK (the write budget is the tight one) |
| 4.2 | R2 | 10 GB, 1M Class A, 10M Class B a month | OK on staging, RISK for production without a custom domain |
| 4.3 | Cron Triggers | 5 per account | OK |
| 5 | Workers Logs | 200,000 events a day, 3 days | OK (privacy RISK) |
| 6.1 | Turnstile | free, 20 widgets, 10 hostnames each | OK |
| 6.2 | Resend | 100 a day, 3,000 a month | OK (RISK at volume) |
| 7 | Staging on `workers.dev` | | findings |

## 2. Workers: size, start-up, CPU, requests

### 2.1 Worker size

| | |
| --- | --- |
| Free plan | **64 MiB uncompressed; "There is no compressed size limit. Only the uncompressed bundle size counts."** Same on Paid. Check with `wrangler deploy --outdir ... --dry-run`, "Total Upload". |
| Our usage (`pnpm deploy:staging:dry`, 2026-10-13) | admin **3,537.46 KiB raw, 638.20 KiB gzip** (Hono, Better Auth, Kysely, Zod, the markdown pipeline and the sanitiser); site **833.57 KiB raw, 202.62 KiB gzip**. 5.4% and 1.3% of 64 MiB. Under the old 3 MiB compressed rule they were 21% and 7%. |
| Verdict | **OK** |
| Check kept in the repo | `cf/scripts/staging-dry-run.mjs` fails when the gzip size passes 3,000 KiB (the old limit), so a regression is seen before anyone has to trust a changed limit. |

Source: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/#worker-size).

### 2.2 Worker start-up time

| | |
| --- | --- |
| Free plan | 1 second of global-scope execution; over it the deploy fails ("Script startup exceeded CPU time limit", 10021). |
| Our usage | `wrangler check startup` (local profile, a different CPU from Cloudflare's): admin **85.1 ms active** in a 119 ms window, site **52.2 ms** in 68 ms. An earlier run on the admin gave 38.9 ms: the numbers move with the machine. |
| Verdict | **OK** (8.5% of the limit). Whether a cold isolate's start-up counts toward the first request's 10 ms is not stated: see [section 1](#1-result), item 3. |

Source: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/#worker-startup-time).

### 2.3 CPU time per request

| | |
| --- | --- |
| Free plan | **10 ms of CPU per HTTP request** and per Cron Trigger. Waiting on `fetch`, KV, D1 or R2 does **not** count. Over the limit: error **1102** to the client, outcome `exceededCpu`. "Each isolate has some built-in flexibility" for work that only occasionally goes over, so an occasional 11 ms is not always an error, and a route that keeps doing it is stopped. The CPU chart's high quantiles "may appear to exceed CPU time limits without generating invocation errors" for the same reason. Cloudflare's own figure: the average Worker uses about 2.2 ms; "heavier workloads that handle authentication, server-side rendering, or parse large payloads typically use 10-20 ms". |
| What we know | Only local wall time and Node timings, **never Cloudflare CPU** (workerd freezes its timers during synchronous code). The table below is what is known per route and why it matters. |
| Verdict | **RISK.** Sign-in, registration and password reset are the likely failures; every other row is unmeasured. |

| Route | Why it can be heavy | Known (local, not CPU) | Fallback if it fails |
| --- | --- | --- | --- |
| `POST /api/auth/sign-in/email`, `register`, `reset-password` | PBKDF2-SHA256, 100,000 iterations, in native WebCrypto | hash 8.1 ms (Node, [`auth.md`](auth.md#results)); route 13.1 ms through `wrangler dev` | **Decided order (PM, 2026-10-13):** 1. fewer iterations (hash format `pbkdf2-sha256$<n>$...` is self-describing, so old hashes still verify); 2. Google sign-in, no hash; 3. Workers Paid, which is not $0. Not in the order: the hash in a second Worker through a service binding (billing sums the CPU of both Workers; whether the limit does is not documented). The 100,000 cap the code assumes is **not on the WebCrypto page** (only "PBKDF2 supported"); confirm on the account |
| `POST /api/admin/blog` (save) and `/preview` | markdown render and sanitiser on the Worker, up to 12,000 characters | about 0.45 ms per 1,000 characters warm; 4.1 ms (wall) for 12,000; two to three times that in a fresh isolate ([`admin-blog.md`](admin-blog.md#11-measured)) | lower `BODY_MAX`, render once at module load, render in the browser (documented there) |
| `POST /api/admin/uploads`, 20 and 25 MB kinds | multipart parse of a body held in memory | 225 to 263 ms wall locally, CPU unknown ([`uploads.md`](uploads.md#what-was-not-verified)) | lower limits for those kinds, or a raw-body `PUT` streamed to R2 with no parse |
| `GET /blog`, `/blog/<slug>`, `/tim`, `/donasi` (the page `/laporan` was before SAKEM-105, see [10.9](#109-donasi-becomes-a-worker-page-sakem-105-the-extra-request-and-cpu-budget)), `/gabung-siswa/docs`, `/sitemap.xml` | Astro render plus a `JSON.parse` of the API answer; no cache on staging | wall 1.4 to 3.2 ms warm through `wrangler dev` ([`web-skeleton.md`](web-skeleton.md)); **measured on staging: 5 to 13 ms of CPU (section 10)** | `PAGE_CACHE_SECONDS` (done, off by default); drop `contentMarkdown` from the public article payload, cache the rendered HTML, prerender the 80 migrated articles again |
| `GET /portal/api/auth/get-session` (navbar) | a full 404 page render on every first visit, because the portal Worker is not on staging | | route it to a cheap JSON 404 when the portal is not deployed |
| The first request into a new isolate | start-up of a 3.5 MiB (admin) or 0.8 MiB (site) bundle | 85 ms and 52 ms of local CPU | see item 3 of [section 1](#1-result) |
| A `waitUntil` job (cache write, click count, purge notice) | counts: a 200 response can still end with outcome `exceededCpu` | | keep jobs I/O-bound |
| Cron cleanup | at most 30 D1 statements (3 tables x 10 chunks of 500) | I/O only | lower `MAX_ROUNDS` |

How to read the real numbers: `pnpm measure:staging` in `cf/web` and the dashboard, both in [`staging-runbook.md`](staging-runbook.md#13-measure-cpu-per-route). Thresholds: OK under 5 ms at p99, RISK from 5 to 8, FAIL above 8, at 10, or on any `exceededCpu`; justified in `cf/web/scripts/lib/staging-measure.mjs`.

Sources: [Workers limits, CPU time](https://developers.cloudflare.com/workers/platform/limits/#cpu-time), [metrics and analytics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/), [Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).

### 2.4 Requests per day

| | |
| --- | --- |
| Free plan | **100,000 requests a day for the whole account** (every Worker in it, staging included), reset at 00:00 UTC. No general requests-per-second limit. Past it: **error 1027** (a route in *fail open* mode bypasses the Worker as if none were there; *fail closed* shows the 1027 page); in a project with static assets, a request that matches a `run_worker_first` pattern gets **429** instead of falling back to the assets. **Requests for static assets are free and unlimited**; a Workers cache hit would be billed as a request (we do not enable it). A service binding call is billed as one request, with the CPU of both Workers. |
| Our usage | Prerendered pages, `_redirects` answers (`/laporan` is one since SAKEM-105), images, PDFs, fonts and the admin SPA never invoke a Worker. A Worker request is an SSR page (`/blog`, `/blog/<slug>`, `/tim`, `/donasi` since SAKEM-105, `/gabung-siswa/docs`, `/kontak`, `/sitemap.xml`), a short link, a 404, an admin API call, and each navbar call once per browser session (`/portal/api/auth/get-session` goes to the portal Worker, `/api/announcements/current` is a JSON 404 of the site's Worker until it gets an endpoint). Roughly 3 Worker requests for a first page view and 1 for each further SSR page: about 30,000 visits a day before the wall. |
| Verdict | **RISK (low).** A crawler or a scan of random `/<slug>` URLs spends the same budget as visitors, and every miss is a Worker request and a D1 read. |
| Watch | The dashboard, Workers, the account's requests chart; the probe prints the share of the budget it uses. |
| Fallback | **Decided (PM, 2026-10-13): the public production route fails OPEN** (past the limit, requests bypass the Worker and the visitor gets the origin behind the hostname: the WordPress site, which the cutover runbook keeps behind the same hostname, so a page instead of an error page), **and the admin host's route fails CLOSED** (a 1027 page, never a bypass of a security-critical Worker). The route's fail mode is a toggle on the route; the cutover runbook records it (D-06, step S-33). Either way the limit is an incident. Reduce Worker requests: prerender the 80 articles again; answer the navbar's two calls without a Worker (the strip as static JSON). |

Sources: [Workers limits, daily requests](https://developers.cloudflare.com/workers/platform/limits/#daily-requests), [static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [Workers pricing, notes 3 and 4 and service bindings](https://developers.cloudflare.com/workers/platform/pricing/).

### 2.5 Subrequests per request

| | |
| --- | --- |
| Free plan | **50 per invocation** for `fetch()` and calls to R2, KV and D1; Cache API calls share it; each redirect hop counts. "Subrequests to internal services": 1,000. A service binding call counts as a subrequest, and one request may cause at most 32 Worker invocations. Calling another Worker on the same zone with the global `fetch()` fails (error 1042); that is what service bindings are for. D1: "queries per Worker invocation" is 50 on Free. |
| Our usage | A page: one or two binding calls plus cache `match` and `put` (about 3 to 6). The sitemap: about three calls per API page of 50 articles, under 50 up to roughly 800 articles. Admin routes: one to ten D1 statements, one `db.batch()` counts as one round trip. Upload: one R2 `put` and two D1 statements. Cron: at most 30 D1 statements. |
| Verdict | **OK** |

Sources: [Workers limits, subrequests](https://developers.cloudflare.com/workers/platform/limits/#subrequests), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [service bindings, limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/#limits), [Workers errors, loop limit](https://developers.cloudflare.com/workers/observability/errors/).

### 2.6 Memory, connections, request body, variables, counts

| Limit (Free) | Value | Our usage | Verdict |
| --- | --- | --- | --- |
| Memory per isolate | 128 MB | the multipart body of a 25 MB upload is held once as a `Blob` | OK; **watch** the 25 MB kinds on staging |
| Simultaneous open connections | 6 | one to three | OK |
| Request body | 100 MB (set by the zone plan) | at most 25 MB plus a 64 KiB envelope | OK |
| Variables per Worker | 64, 5 KB each | admin 2 in the file, 4 per deploy, 3 to 5 secrets; site 0 in the file, 3 to 4 per deploy | OK |
| Workers per account | 100 | 2 staging + 2 production (+ 1 portal later) | OK |
| Log data per request | 256 KB | far below | OK |
| Cron Triggers per account | 5 | 1 per environment | OK |

Source: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## 3. Bindings and platform features

### 3.1 Rate Limiting binding (`ratelimits`)

**This is the critical row.** Ten bindings, all in `cf/admin/wrangler.jsonc`: `RL_LOGIN`, `RL_LOGIN_ACCOUNT`, `RL_REGISTER`, `RL_RESET`, `RL_VERIFY_RESEND`, `RL_MAIL_TARGET`, `RL_TOKEN`, `RL_CONTACT`, `RL_UPLOAD`, `RL_BLOG_PREVIEW`.

| | |
| --- | --- |
| Free plan | **Not documented either way.** The page has no plan table, no quota and no price. It is GA since 2025-09-19 ("stable and recommended for all production workloads"), needs Wrangler 4.36.0 or later (we have 4.149.0), and "is backed by the same infrastructure that serves rate limiting rules". The pricing, limits and Wrangler configuration pages do not mention it. A third-party write-up says there is no extra charge beyond the Worker's own requests and CPU; that is not Cloudflare's word. |
| What is documented | `namespace_id`: a positive integer, as a string, "unique to your Cloudflare account", **chosen by us, nothing to create**; two bindings with the same id share counters, even across Workers (so staging uses its own ids). `simple.period` is **10 or 60** seconds only. Counters are **per Cloudflare location** ("for each unique key there is a unique limit per location"), cached on the machine and updated in the background: "permissive, eventually consistent, and intentionally designed to not be used as an accurate accounting system". Not visible in the dashboard. Cloudflare advises against IP addresses as keys; ours are IP, email hash and user id. |
| What that means for us | The limits are a brake against floods and guessing, not exact quotas (the repo already says so). Five sign-in attempts a minute is per location: a botnet spread over many locations gets more, which is why Turnstile sits in front of sign-in and the contact form. |
| Verdict | **RISK. Becomes a BLOCKER if the deploy is refused or the binding is inert**, because every protected route fails closed without it. |
| Real account | The first staging deploy settles "is the binding accepted" (the dry run cannot). Then `RL_CONTACT` (5 a minute) is exercised by `measure-staging.mjs --writes` and by hand: the sixth request inside a minute must be a 429. |

**Fallback design, if Free refuses it or it misbehaves** (**decided, PM 2026-10-13: option 1 is the one to build, as a separate task, only if the real account refuses the binding; nothing is built now**):

1. **Durable Object limiter, SQLite-backed.** Durable Objects are on Free **only with the SQLite backend**, with 100,000 requests and 13,000 GB-s a day. One object per `(limiter, key)`; `limit()` becomes one RPC call, exact and global (no per-location drift). Costs a Durable Object request per check (the sign-in does three) and a config change (`exports` or `migrations` with `new_sqlite_classes`, the class exported from the admin Worker). `src/security/rate-limit.ts` already isolates the binding behind one function, so it is a contained change.
2. **D1 counter table** (`key, window, count`, one upsert per check). One row written per attempt, from the shared 100,000 a day: only for the low-volume routes (sign-in, reset, contact), never uploads or preview, and Turnstile stays the first defence. A flood must not be able to spend the write budget, so this is the weaker option.
3. **Outer layer once the zone exists:** a WAF rate limiting rule on `sakolakembara.org`. On a Free zone: **1 rule**, counting period 10 s, per IP, path matching only. It cannot replace the per-account and per-user limits.
4. Not suitable: KV (1,000 writes a day on Free and eventually consistent), an in-memory counter (one isolate, useless), turning the checks off.

Sources: [Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [GA announcement](https://developers.cloudflare.com/changelog/post/2025-09-19-ratelimit-workers-ga/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [WAF rate limiting availability](https://developers.cloudflare.com/waf/rate-limiting-rules/#availability), [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/).

### 3.2 Service bindings and named `WorkerEntrypoint` entrypoints

| | |
| --- | --- |
| Free plan | Yes. A binding names `service` and optionally `entrypoint` (a class that extends `WorkerEntrypoint`; "entrypoints without a named handler are not supported", ours has `fetch`). No extra request fee: one request for the first Worker, the CPU of both. The target Worker must exist when the caller is deployed. To target an environment the name is `<worker>-<environment>` (wrangler's rule): `sakem-web-staging` binds to `sakem-admin-staging`, which a test pins. A named entrypoint has no route, no `workers.dev` address and no custom domain, which is what keeps `/api/public/*` off the internet. |
| Our usage | `API` = `{ service, entrypoint: "PublicApi" }` from the site to the admin Worker for every read and the contact post: 1 to 6 calls a request. |
| Verdict | **OK** |
| Real account | `CF-Connecting-IP` inside the binding call; `POST /api/public/contact` and `GET /api/public/*` from the internet are 404 (listed in the first-deploy smoke tests). |

Sources: [service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/), [RPC and named entrypoints](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/), [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/#service-bindings), [pricing](https://developers.cloudflare.com/workers/platform/pricing/#service-bindings).

### 3.3 Static assets

| Item | Free plan | Our usage | Verdict |
| --- | --- | --- | --- |
| Requests | free and unlimited ([billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)) | prerendered pages, images, PDFs, fonts, the admin SPA | OK |
| Files per version | 20,000 ([limits](https://developers.cloudflare.com/workers/platform/limits/)) | site 988 (wrangler reads 1,016), admin 14 | OK |
| Size per file | 25 MiB | the two decks are **23.2 and 23.1 MiB**, 93% of the limit; `pnpm build` fails above 25 MiB | OK, low RISK: a new deck needs the R2 route in [`web-skeleton.md`](web-skeleton.md#large-pdfs) |
| `run_worker_first` as an array | globs with `*`, negative patterns with `!`, at most 100 entries ([binding](https://developers.cloudflare.com/workers/static-assets/binding/#run_worker_first)) | `["/api/*", "/uploads/*"]` on the admin | OK. Over the daily request limit those two patterns answer 429 while the SPA keeps loading |
| `not_found_handling: "single-page-application"` | yes | admin SPA | OK |
| `_redirects` | 2,000 static and 100 dynamic rules, 1,000 characters each; statuses 301, 302, 303, 307, 308 ([redirects](https://developers.cloudflare.com/workers/static-assets/redirects/)) | 61 rules: 42 static, 19 dynamic, all 308 except `/program` (307) | OK |
| `_headers` | 100 rules, 2,000 characters a line; **not applied to responses a Worker generates** ([headers](https://developers.cloudflare.com/workers/static-assets/headers/)) | 6 path rules; the middleware adds the same security headers to Worker responses, a test keeps both equal | OK |
| Workers Caching (`cache.enabled`) | would bill every request, assets included ([pricing, note 4](https://developers.cloudflare.com/workers/platform/pricing/)) | not enabled, by decision | OK |

The headers file can also match a host: the page documents a rule with `X-Robots-Tag: noindex` for keeping `workers.dev` addresses out of search results (its example, `https://:version.:subdomain.workers.dev/*`, matches the per-version hosts; a rule on a Worker's own host uses the same syntax). Not added (see [7](#7-staging-findings)): staging pages declare the production canonical URL anyway, and Worker-rendered pages would not carry it.

### 3.4 Cache API (`caches.default`)

| | |
| --- | --- |
| Free plan | The Cache API is not a plan feature. The page says "Workers deployed to **custom domains** have access to functional `cache` operations" (Pages Functions too, on custom domains or `*.pages.dev`), that operations in the dashboard editor and playground "will have no impact", and that it is "not currently available" for Workers fronted by Cloudflare Access. **`workers.dev` is not mentioned as working.** (A note elsewhere on the page says redirects with a query string are cached on `.workers.dev` with the query in the key, which suggests a cache exists there; it is not a promise.) The cache is per data centre; `stale-while-revalidate` and `stale-if-error` "are not supported" for `put` and `match`. |
| Our usage | `/tim`, `/donasi` (its Laporan section), `/gabung-siswa/docs`, `/blog`, `/blog/<slug>`, `/sitemap.xml` keep the API answer 60 s (5 min for `/tim`) and the last good copy 7 days, with our own stale-if-error. Every cache call is wrapped: a miss, an error or an absent cache is the normal path, not a failure. |
| Verdict | **RISK**: staging cannot prove cache behaviour (hit, stale, the 60 s window, purge), only that the code works without one. Dzul's decision (2026-10-12): staging on `workers.dev`, cache tested on cutover day. The staging CPU and D1 numbers are therefore the **uncached worst case**, conservative for both the 10 ms and the 5M-row limits. |
| Real account | On the production hostname: `cache-control`, the second request faster, stale-if-error with the API Worker stopped, `x-blog-source: cache`. Owned by the cutover runbook (M5-B). |

Sources: [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/), [Workers Caching](https://developers.cloudflare.com/workers/cache/).

### 3.5 `waitUntil`

Available on Free. Up to **30 seconds after the response** (shared by all calls of the request); promises still pending are cancelled with a warning in Workers Logs. The CPU of that work counts: a 200 response can still end as `exceededCpu`. Our jobs: cache writes (site), the short-link click count and the content-change notice (admin). **OK.** Source: [Context, `waitUntil`](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil).

### 3.6 `nodejs_compat` and the compatibility date

Available on Free. For a compatibility date of **2026-08-04 or later**, Workers enables `nodejs_compat` and `nodejs_compat_v2` by default; our date is `2026-09-01`, so the `compatibility_flags: ["nodejs_compat"]` line is redundant and harmless ("existing projects do not need to remove these flags"). The date must not be later than the runtime Cloudflare runs: it is before today and local workerd runs it. **OK.** Sources: [Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/), [compatibility dates](https://developers.cloudflare.com/workers/configuration/compatibility-dates/).

### 3.7 Wrangler: environments and automatic provisioning

| | |
| --- | --- |
| Environments | `--env staging` makes a Worker named `<top-level-name>-staging` unless `name` says otherwise; bindings and `vars` are **not inherited** and are written out per environment; the Vite plugin (the Astro adapter) takes the environment from `CLOUDFLARE_ENV` at **build** time and writes the flattened config to `dist/server/wrangler.json`. Verified here: the staging build's config carries `name: sakem-web-staging` and the staging service binding. |
| Automatic provisioning (read in the installed Wrangler 4.149, which matches the docs) | At `wrangler deploy`, a D1 binding with a `database_name` and no id **connects to the existing database of that name, or creates it**; an R2 binding with a `bucket_name` connects to an existing bucket, or creates it. The ids stay on Cloudflare's side. **The trap:** an interactive deploy (and an interactive `wrangler d1 create`) offers to **write the new ids into the tracked `wrangler.jsonc`**. `CI=1` turns the write-back off, and the runbook creates the resources first, by name, and checks `git status` after each real command. `wrangler d1 execute --remote` and `d1 migrations apply --remote` find the database **by its name** through the API, so no id is needed in any file. |
| Verdict | **OK**, with the runbook's guard. |

Sources: [environments](https://developers.cloudflare.com/workers/wrangler/environments/), [Wrangler configuration, automatic provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning), [Vite plugin, Cloudflare environments](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/).

### 3.8 `workers.dev`

Every Worker gets `<name>.<account subdomain>.workers.dev` unless `workers_dev: false`; names are at most 63 characters, letters, digits and dashes, no dash at either end (`sakem-admin-staging`, `sakem-web-staging` pass; a test checks the pattern). The subdomain is chosen once per account. `workers.dev` is "treated as a Free website ... intended for personal or hobby projects", not for production. `preview_urls: false` in both staging blocks, so no per-version hosts exist. Cloudflare Access can protect a `workers.dev` URL, but then the Cache API is not available and the probe would need a service token; not used. **OK.** Source: [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

## 4. Storage

### 4.1 D1

| | Free plan | Our usage | Verdict |
| --- | --- | --- | --- |
| Rows read a day | **5,000,000**, per account, reset 00:00 UTC | uncached page view about 300 rows (so about 16,000 uncached views); admin request 4 to 10 | OK; staging is uncached, so its numbers are the worst case |
| Rows written a day | **100,000**, per account. A row written is the table row **plus one per index**; DDL counts; queries from Wrangler and the dashboard count too | admin save 9 to 13, sign-in 4, contact form 13, **short-link click 1 (unbounded)** | OK, with the accepted RISK below |
| When a daily limit is spent | "you will not be able to run queries"; the API returns errors; upgrading removes the limit "typically within minutes" | the site shows its 503 notices, sign-in and saves fail, redirects (reads only) keep working until the read limit | by design |
| Database size | **500 MB each**, 5 GB per account | about 20 MB after three years (paper estimate in [`d1-schema.md`](d1-schema.md#free-tier-headroom-estimate)) | OK |
| Databases per account | 10 | 2 (staging, production) | OK |
| Time Travel | **7 days on Free** (30 on Paid), always on, free; restores are a `wrangler d1 time-travel` command | the revert for a bad import or migration on staging | OK |
| `EXPLAIN` | `EXPLAIN QUERY PLAN` is documented for checking index use on D1 | already run on every hot statement locally | OK |
| Bound parameters per query | **100** | one statement can exceed it: the blog save looks up the media rows of an article's inline images in one `IN (...)` ([`src/api/blog.ts`](../../cf/admin/src/api/blog.ts) `uploadSizes`), so an article with 100 or more distinct uploaded images would fail with a 500; the 12,000-character body makes it possible in theory, an editor would never do it | low RISK; fix: chunk by 90 |
| Statement length / row size | 100,000 bytes / 2,000,000 bytes | the import writes one statement per article; the longest is **21,161 bytes** (86 articles, 1,080,402 bytes in all, measured with `pnpm blog:import:local -- --out` on 2026-10-13) | OK |
| Queries per invocation | 50 | at most 30 (cron), usually under 10 | OK |
| Batches | statements in a `batch()` are one transaction; each keeps the per-statement limits | used for audit and write pairs | OK |
| Migrations | `wrangler d1 migrations apply` runs each file in a transaction and rolls back a failing one; takes a backup after applying | fourteen, `0000` to `0013` | OK |

**The accepted RISK.** Every short-link click is counted, with no cap (Dzul, 2026-10-12): one link that goes viral can spend the day's 100,000 writes, after which every write (admin sign-in, a contact message) fails until 00:00 UTC while redirects keep working. Rows written per day is on the watch list ([`staging-runbook.md`](staging-runbook.md#14-limits-to-watch)). The two fallbacks he named: a per-link cap of 2,000 clicks a day, or no counting. The account limit is shared by staging and production.

Sources: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [use indexes, `EXPLAIN QUERY PLAN`](https://developers.cloudflare.com/d1/best-practices/use-indexes/), [Wrangler `d1` commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/).

### 4.2 R2

| | Free plan | Our usage | Verdict |
| --- | --- | --- | --- |
| Storage and operations a month | **10 GB-month, 1 million Class A, 10 million Class B**; egress free; the free tier is for Standard storage only | one Class A per upload, none per delete; reads of public files count as Class B | OK |
| A card | needed to enable R2 | on file, as decided; **a card is not a spending cap**: set the billing notification | OK |
| `r2.dev` public URL | for non-production; "a variable rate limit": past "hundreds of requests/second" a 429; bandwidth may be throttled; no WAF, caching or access controls; enable it in the bucket settings (type `allow`), or `wrangler r2 bucket dev-url enable` | staging uploads, dummy data only | OK for staging |
| Custom domain | the domain must be a **zone in the same account**; created in the bucket's settings | `files.sakolakembara.org` at cutover | RISK for production until the zone is active (a cutover step; the page also names a "partial (CNAME) setup" for a domain that stays elsewhere, which is not the plan for this site and whose plan requirement was not checked) |
| Object key and metadata | key 1,024 bytes, metadata 8,192 bytes, one write a second to the same key (429 above that) | keys are unique per upload; `Cache-Control` and `Content-Type` are set as metadata | OK |
| Bucket delete | the bucket must be empty | teardown deletes the objects first | OK |

Sources: [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/), [R2 limits](https://developers.cloudflare.com/r2/platform/limits/).

### 4.3 Cron Triggers

Available on Free: **5 per account**, CPU 10 ms per run, changes take up to 15 minutes to propagate, times are UTC. We use one per environment (`17 3 * * *`, the daily cleanup), two in all. The job is I/O only (at most 30 D1 statements). **OK.** Real account: the first run shows in Workers Logs as a `cron` invocation. Sources: [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [limits](https://developers.cloudflare.com/workers/platform/limits/).

## 5. Observability

| | |
| --- | --- |
| Workers Logs | Included on Free: **200,000 log events a day, retention 3 days** until 2026-12-01. From **2026-12-01** Workers Logs moves to the common Observability pricing: **0.5 GB a day on Free, seven-day retention**, ingestion stops at the daily limit and resumes at 00:00 UTC. Each invocation writes one **invocation log** (message `<Method> <URL>`) plus our own `console` lines. The 100,000 requests a day wall allows 100,000 invocation logs and as many custom lines. Invocation logs carry CPU time and wall time (published for every invocation since 2025-04-09). |
| Where the CPU number lives on Free | The dashboard, **Workers, the Worker, Metrics: "CPU Time per execution"** (quantiles, reservoir-sampled, per Worker, not per route); **Workers Logs** (the invocation log has CPU and wall time, and the Query Builder can compute the median of them; filtering or grouping by URL path is the way to a per-route p50 and p99 within the 3 days, but the pages read here do not spell that out, so try it); `wrangler tail` (real-time, [whether its JSON carries `cpuTime` is not confirmed by the docs](#9-what-only-a-real-account-can-settle)). **Tail Workers and Logpush are Paid-only**, so the trace item's `cpuTime` and `wallTime` and the Logpush `CPUTimeMs` and `WallTimeMs` fields exist but cannot be used on Free. |
| Real-time logs | `wrangler tail`: up to 10 viewers per Worker, "sampling mode" under high traffic (events dropped, a notice is printed); the tail redacts header values that look secret and URL segments that look like ids. |
| Verdict | **OK** on volume. **RISK (privacy):** the invocation log holds the **full URL with its query**, so `GET /api/auth/verify-email?token=...` and the OAuth callback `?code=...&state=...` are stored for three days and shown to every member of the account. The tokens are single-use and short-lived; the app's own logs never print them ([`auth.md`](auth.md)). **Decided (PM, 2026-10-13): `invocation_logs` stays on during M5**, because the CPU record needs it. Before cutover the owner decides the log retention and the exposure of URL tokens (accept, or `"observability": { "logs": { "invocation_logs": false } }` once the measurement is done, which removes the per-request CPU record from Workers Logs): it is go-live precondition P-23 of [`cutover-runbook.md`](cutover-runbook.md#3-preconditions). |

Sources: [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), [Observability pricing](https://developers.cloudflare.com/observability/pricing/), [real-time logs](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/), [CPU and wall time announcement](https://developers.cloudflare.com/changelog/post/2025-04-09-workers-timing/), [Tail Workers](https://developers.cloudflare.com/workers/observability/logs/tail-workers/), [Workers pricing, Logpush](https://developers.cloudflare.com/workers/platform/pricing/#workers-trace-events-logpush), [metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/).

## 6. Third parties

### 6.1 Turnstile

Free: unlimited challenges, **20 widgets, 10 hostnames per widget**, 7 days of analytics, no "any hostname" widget (Enterprise). "Wildcard characters are not supported ... However, adding a hostname automatically authorizes all of its subdomains": one hostname `<account subdomain>.workers.dev` covers both staging Workers. Staging gets its own widget (the production site key and secret stay out of staging). The site key is public and goes into both Workers' `TURNSTILE_SITE_KEY`; the secret goes to the admin Worker only. Siteverify is a `fetch` from the Worker (I/O, one subrequest). **OK.** Real account: the real widget in a real browser at 320 px, `data-action` handling, a reused token refused. Sources: [plans](https://developers.cloudflare.com/turnstile/plans/), [hostname management](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/).

### 6.2 Resend

| | Free plan | Our usage | Verdict |
| --- | --- | --- | --- |
| Volume | **100 emails a day** (UTC day), **3,000 a month**; over it a 429 `daily_quota_exceeded` or `monthly_quota_exceeded` | invitations, password resets, verification links, all behind `RL_MAIL_TARGET` (3 a minute per mailbox) | OK; a registration wave (500 sign-ups with a verification mail each) would pass 100 in a day: RISK at volume |
| Domains, API rate | 3 domains; 10 requests a second per team (default) | one | OK |
| Sender | a **verified domain** is needed to send as your own address. Without one, `onboarding@resend.dev` works "only for testing" and **delivers only to the email address of the Resend account** ("You can only send testing emails to your own email address"); test recipients `delivered@resend.dev` and `bounced@resend.dev` count against the quota | staging: `EMAIL_FROM=Sakola Kembara Staging <onboarding@resend.dev>`, invite yourself; production: a verified subdomain with SPF and DKIM | OK |
| Retention | 30 days | | OK |

The admin Worker fails closed when `RESEND_API_KEY` is missing in production mode; staging runs in that mode (`ENVIRONMENT=staging`), so the key is needed for any route that sends mail. Sources: [pricing](https://resend.com/pricing), [rate limits and quotas](https://resend.com/docs/api-reference/rate-limit), [the 403 on `resend.dev`](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain), [domains](https://resend.com/docs/dashboard/domains/introduction).

## 7. Staging findings

Things that are true of `*.workers.dev` staging and not of production, found while preparing it:

1. **Pass-through paths loop.** The site forwards WordPress's own paths (`/wp-admin/*`, `/wp-login.php`, `/wp-content/*`, `/wp-includes/*`, `/wp-json/*`, `/xmlrpc.php`, `/login`; since SAKEM-103, Phase A of the cutover; before it `/_next/*`, `/images/*`, `/blog/images/*`, `/files/*`, `/reports/*` and `/resources/*`) to "the legacy origin" with `fetch(request)`, which in production (route mode) reaches the WordPress site behind the same hostname. **A scanner on staging now has more paths to probe** (`/wp-login.php` and `/xmlrpc.php` are the most requested paths of the internet): each one still fails at once through the `*.invalid` host and costs one Worker request, but it is a real exception in the logs (the old prefixes were never probed). Production adds a second cost: each such request is a Worker request and an origin request (runbook F-09). On `workers.dev` nothing sits behind the hostname, so the fetch goes back into the same Worker, and Cloudflare stops it only at its loop limit: "A Worker cannot call itself or another Worker more than 16 times" (error 1019). One scanner request for `/_next/x` could cost up to 16 Worker invocations of the 100,000 a day. **Mitigation, no code change:** the staging deploy command passes `LEGACY_ORIGIN_URL` as a `*.invalid` host (RFC 2606: never resolves), so the forward fails at once; the command accepts no other value. Not verified on a real account (the loop is inferred from the documented limit).
2. **The navbar asks for things staging does not have.** `/portal/api/auth/get-session` (the portal Worker is on a host of its own on staging, not behind the site's, so the site's own host answers) and `/api/announcements/current` (an endpoint the site does not have yet) are both answered by the site's Worker, as a 404 page render and a JSON 404. A staging page view therefore costs up to two Worker requests more than production will. They are in the probe's route list so their CPU is seen.
3. **Canonical, Open Graph and sitemap name `https://sakolakembara.org`**, from `site` in `astro.config.mjs`: a staging page tells crawlers the production URL is the original, which is the safe direction. No `noindex` is added; the documented way is a `_headers` rule on the `workers.dev` host (3.3), which does not cover Worker-rendered pages. Keep the staging URL private.
4. **`Strict-Transport-Security`** is sent on `workers.dev` responses too. Until SAKEM-103 it was the legacy Caddy value, `max-age=31536000; includeSubDomains; preload`, which a browser applies to that host only (harmless there). Since SAKEM-103 it is the staged `max-age=300` everywhere (F-01, D-04).
5. **No cache** (3.4): every view is an API call and a D1 read, so staging is the worst case for both budgets.
6. **Shared account budgets.** Staging and production share the 100,000 requests a day, the D1 read and write budgets, the five cron triggers and the ten databases. Measurement runs spend the same budget the live site will use.

## 8. Wrangler and tooling versions

`wrangler` 4.149.0 in both packages (needs 4.36 for rate limiting, 4.34 for the larger asset limits). `wrangler deploy --dry-run` for both staging configurations exits 0 (`pnpm deploy:staging:dry` in each package). `unstable_readConfig`, used by the tests, resolves both environments offline.

## 9. What only a real account can settle

In the order a staging run answers them ([`staging-runbook.md`](staging-runbook.md)):

1. **The first admin deploy:** is the `ratelimits` binding accepted on the Free plan (3.1)? Is the D1 database found by its name? Does the account have a `workers.dev` subdomain?
2. `RL_CONTACT` and `RL_LOGIN` really count: the sixth request in a minute is a 429; `CF-Connecting-IP` is present in the binding call.
3. Sign-in, registration and reset CPU, and whether native PBKDF2 time counts (2.3). Whether 100,000 is the iteration cap.
4. CPU per route of the table in 2.3, p50, p95, p99, max, and the first invocation after idle; whether a cold start counts.
5. Whether **`wrangler tail --format json` carries `cpuTime` and `wallTime`** (the trace item has them; the real-time stream's example in the docs shows neither). The first capture settles it: `head -1 capture | jq 'keys'`. If not, read the numbers in Workers Logs and the dashboard (the runbook has both routes).
6. The Cache API on `workers.dev`: nothing to settle there (not testable); on the production hostname, the cutover list.
7. Multipart uploads of 5, 20 and 25 MB: CPU and memory.
8. D1 rows read and written per request on the real database (`meta`), the shortlink click as one written row, the Time Travel bookmark.
9. The cron trigger firing and its log line.
10. R2: the conditional `put`, the `Cache-Control` the public URL serves, the `r2.dev` address answering with the right `Content-Type`.
11. Turnstile: the real widget, Siteverify, hostname `workers.dev`; Resend: a real mail to the account owner.
12. `__Host-` cookies on the two `workers.dev` hosts, sign-in across the SPA and the API.
13. The self-fetch loop of 7.1 (do not provoke it on purpose; look at the request count after a scanner visits).
14. The student portal (runbook steps 15 to 22, SAKEM-098): a private R2 bucket that no request can read without the Worker's code (the three checks of step 16); a 10 MB body streamed into R2 and the CPU and memory of it; the portal's `__Host-` cookie and its `_headers` on `workers.dev`; the real Turnstile widget with the portal's four `data-action` values and Resend with the sandbox sender or a verified domain; the register, sign-in, wizard and submit routes' CPU (the sign-in being PBKDF2 again); and what a request that is not a navigation gets for a path that is no file (the SPA's `index.html` in the local emulation, the Worker's JSON 404 in the design).

## 10. CPU on the hot routes (SAKEM-091)

First measurement of CPU on a real Worker (the staging probe of 2026-10-14, step 13 of [`staging-runbook.md`](staging-runbook.md#13-measure-cpu-per-route)), what it showed, where the CPU goes according to a profile, what was changed, and what is left. Ticket SAKEM-091. Everything under "local" below is a measurement on a laptop and **not Cloudflare CPU**; the PM re-runs the staging probe after the merge and that, not this section, is the verdict.

### 10.1 What the staging probe measured

Cloudflare's own `cpuTime`, 307 invocations, 12 rounds of 27 GET routes 600 ms apart, warm, no Cache API (it does not work on `workers.dev`, so these are uncached numbers), Free plan, every outcome `ok`. Medians and maxima over 12 samples, in ms (so the maximum stands in for p99). The probe has no session, so the admin rows are the 401 paths.

| Worker, route | p50 | max | Gate (p99 under 5 OK, 5 to 8 RISK, over 8 FAIL) |
| --- | ---: | ---: | --- |
| site `GET /blog` (and `?page=2`) | 13 | 56 | FAIL |
| site `GET /blog/<slug>` | 7 to 9 | 12 to 18 | FAIL |
| site `/sitemap.xml`, `/tim` | 7 | 14, 13 | FAIL |
| site `/kontak`, `/laporan` (a page then; since SAKEM-105 its reports are the section of `/donasi`, 10.9), `/gabung-siswa/docs` | 5, 5, 6 | 12, 9, 8 | FAIL, FAIL, RISK |
| admin `GET /api/me`, no cookie (401) | 18 | 38 | FAIL |
| admin `/api/dashboard`, `/api/admin/blog` (401) | 5, 6 | 11, 12 | FAIL |
| admin `GET /api/config` | 4 | 9 | FAIL |
| admin `PublicApi`, per read (a second invocation behind every page): blog list, article, short link, team/reports/resources | 7, 5, 4, 2 to 3 | 30, 14, 22, - | |
| 308 redirects, 404, `/uploads/*`, `/api/public/*` from the internet | 0 to 2 | | OK |

A second set of single samples (one request each, 2026-10-14): sign-in with the right password 89 ms (wall 290 ms); `/api/me` 30 ms with a session and 39 ms without; authenticated reads 8 to 25 ms (`/api/admin/messages` 25, `/api/dashboard` 19, `/api/admin/shortlinks` 19, `/api/admin/announcements` 17, `/api/admin/blog` 15, `/api/admin/team` 8); writes 14 to 24 ms; `/api/config` 1 ms once warm. Nothing was killed. Why nothing was is not known (see 10.6).

### 10.2 How it was measured locally, and how far to trust it

Two scripts, `pnpm measure:cpu` in `cf/admin` and in `cf/web`. They run the **real code** in plain Node, where timers are real (workerd freezes its timers during synchronous code, so a Worker cannot time itself):

- **admin**: the Hono apps (the default export and the `PublicApi` entrypoint's app), Better Auth, Drizzle and the serializers, on a D1-shaped shim over `node:sqlite` (`scripts/lib/node-d1.ts`) holding the seed, the 86 real articles and school-sized lists. The time SQLite spends is subtracted (on Cloudflare a query costs the Worker no CPU, only the JavaScript around it does), and so is the native PBKDF2 of a sign-in (reported apart).
- **site**: the **built** Worker (`dist/server/entry.mjs`: Astro, the middleware, the pages) with a stand-in for `cloudflare:workers`, a static-assets binding that finds nothing and an `API` binding that answers from a recording of the content API at school volume (86 articles, 24 team members, 16 reports, 25 documents). Astro streams its body, so the page is rendered while the body is read: that is inside the timed region.
- **Two regimes**, because a Free Worker is mostly cold JavaScript. *Edge-like*: a fresh process per scenario with `node --jitless` (V8's interpreter only: a low-traffic Worker rarely runs a function often enough to be optimised), twelve requests; the first one (every function it touches is compiled on first use) and the median of requests 3 to 12, the median of three such processes. *Warm*: the normal JIT, 50 warm-up requests, then 300.
- **Before and after are measured in turns**, process by process (`--compare`, `--compare-server`), so the load of the machine falls on both alike.

How far to trust it: only the **relative change** between two runs on one machine is a result. Against the staging numbers: the single-sample authenticated reads of 10.1 (8 to 25 ms) sit close to the local *first-request* cost of the same routes (13 to 14 ms before this change) and far above the local *steady* cost (1.8 to 2.4 ms), which is what a cold first call of each route in an isolate would look like; the steady 401 routes (5 to 6 ms) are 6 to 8 times the local steady cost (0.8 ms). For the site, the ranking of the pages locally matches the edge's except `/blog`, which the edge puts at about twice what the local ranking predicts; the cause was not found. Not modelled at all: the D1 binding's own JavaScript, the service binding call, workerd's per-request overhead.

### 10.3 Where the CPU goes: what was proved by a profile, and what is only suspected

Proved (V8 CPU profiles of the real code, the interpreter regime, requests only, and the before/after tables of 10.5):

1. **Better Auth was built and initialised on every request** (`createAuth` per request: the auth context, the table definitions, about forty endpoints with their schemas, the Drizzle adapter), and **a request without a session cookie built it too**, only to answer 401. Local, edge-like: the 401 routes cost 0.8 ms each against 0.08 for `/api/config`, and the first one of an isolate 8 to 10 ms against 1.6.
2. **Drizzle's query builder is more than half of a public read**: `entity.is`, the SQL chunks, `extractTablesRelationalConfig` on every `drizzle(binding, { schema })` call (a walk over every table and relation of the schema), none of which changes between requests. 73% of the blog index (24 of 33 ms over 40 requests) before any change, still 52% (37 of 71 ms over 100 requests) once the instance was shared.
3. **An SSR page is mostly Astro's renderer**: 53% of `/blog` and 67% of `/tim` (24 members, 116 KB of HTML) in the compiled runtime and the Astro app, about a tenth (12% and 9%) in this repository's code (the loaders, the blog helpers, the SEO graph, the middleware), the rest the platform's Request, Response and stream objects (JavaScript in Node, native in workerd). Nothing a page's own code does changes what the renderer costs per component: removing the `Tag` and `Icon` component of the 15 cards of `/blog` entirely, a crude upper bound that changes the HTML, saves 27%; Astro's `experimental.queuedRendering` gives no measurable gain (identical HTML, `/blog` 2.13 and 1.93 ms); non-streaming rendering saves 10 to 20% but needs a custom entry that copies the adapter's handler (not done).
4. **The first request of an isolate costs several times a later one**: 8 to 14 ms against 0.8 to 2 ms for the admin routes, 12 to 16 ms against 1 to 4 ms for a page, because V8 compiles each function on its first call. Rendering one page first takes `/blog`'s first request from 15.8 to 5.8 ms locally. **Where the 89 ms of the first sign-in goes, as far as a laptop can say:** the hash is 8.3 ms of native PBKDF2; the JavaScript around it (the auth gate, Better Auth's HTTP router, the sign-in endpoint, the session and its cookie) is 18.2 ms on the first call of a process, 3.1 ms on the next ones and 1.5 ms once warm. So a cold sign-in is mostly JavaScript, not hash, and a second sign-in in the same isolate is the figure to read for the hash (10.8). This is an inference from one staging sample and local ratios, not a measurement of the edge.
5. **What a guard adds**: a signed-in `/api/me` is 0.72 ms locally after the changes, of which the session read (two D1 statements decoded by Better Auth's adapter, the user mapping) is about 0.63; the guard itself (`requireAdmin`, `requireArea`, `can`) is microseconds; `/api/dashboard` adds 0.2 ms of its own statements and an editor's list one statement for their grants (built once per isolate now). A request without a session cookie adds nothing: 0.09 ms, the cost of a 404.

Suspected, not provable here:

- **The edge multiplier** (the staging figures are 4 to 10 times the local steady figures): not a constant, so no local number converts to an edge number.
- **Whether Cloudflare counts start-up and first-call compilation as CPU of the request** (the first-call figures above say it may), **and whether the tail's `cpuTime` is the figure the limit is enforced on** (sign-in at 89 ms was not killed).
- **Whether the start-up warm-up of 10.4 moves the first-call cost out of the request** (it can only do so if start-up CPU is not charged to it).
- **The share of the D1 binding's JavaScript** in an authenticated read, and the two sequential D1 round trips of Better Auth's session lookup (a session, then its user).

### 10.4 What changed

| Change | Where | Effect (local, edge-like) | Risk and how it is kept safe |
| --- | --- | --- | --- |
| One Better Auth per isolate, keyed by the D1 binding, the audience, every text variable and secret, and the origin (at most 8 per binding); `waitUntil` looked up per call in an `AsyncLocalStorage` scope. The student portal Worker mounts the same context for its audience (`createAuthContext(STUDENT_AUDIENCE)`, after the portal foundation merged: it had its own per-request copy) | `src/auth/session.ts`, `src/portal/auth-context.ts` | signed-in admin routes -44 to -57% steady, first request -59 to -68% (with the warm-up); the portal's routes run the same code and were not measured separately | a shared instance must hold nothing of a request: sessions are still read from D1 on every call, background work goes to the right request (a test runs two overlapping requests with two contexts, for each Worker), a changed variable is a different instance, and so is the other audience (its mount point and cookie name); `test/auth-shared.test.ts`, five negative checks; validated in `wrangler dev` with 40 concurrent signed-in requests of three roles (admin Worker only: the portal Worker was run through the test suite, not through `wrangler dev`) |
| A request whose Cookie header names no `session_token` is answered "no session" without asking Better Auth | `src/auth/session.ts` (`mayCarrySession`) | the 401 routes: 0.80 to 0.09 ms, first request 9.8 to 0.6 ms | the answer is the one Better Auth gives; a cookie that is only shaped like a session cookie still goes to Better Auth; tests and two negative checks (always ask, never ask) |
| One Drizzle instance per D1 binding | `src/db/client.ts` and every route | about 0.2 ms off every request that built one | the instance holds no request state |
| The public reads and an editor's grants built once per isolate (`sql.placeholder`), the blog index still one D1 batch | `src/public/prepared.ts`, `src/db/grants.ts` | public reads -61 to -79% steady, first request -52 to -65% | same SQL text and plans (compared statement by statement), same rows (compared with the builder's), same round trips (`public-budget.test.ts`), same answers (every read and parity test unchanged) |
| Start-up warm-up of the library code (Hono's router lookups, Better Auth and its HTTP router, the prepared queries, the serializers) against a stand-in environment | `src/warmup.ts` | first signed-in request: about 14 ms with the shared instance alone, 4.6 to 6 ms with the warm-up (locally) | reads no real binding, writes and sends nothing, unawaited, guarded per group, one fixed log line on failure; Workers refuses a `Response`, I/O, a timer or a random number in global scope, so no route can be warmed; `WARM_UP_ENABLED` switches it off |
| An optional copy of the rendered page in the isolate's memory | `src/lib/page-cache.ts`, `src/middleware.ts` | a view of a list or article page -68 to -89% (see 10.5) | **off unless `PAGE_CACHE_SECONDS` is set**; with it unset the HTML and headers of 15 routes are byte for byte what they were; with it on, an allow-list of pages, only a fresh 200, the query reduced to what the page reads, bounded; unit tests, 3 e2e checks, 14 negative checks. Adds that many seconds of staleness; nothing purges it |

### 10.5 Before and after, per route

Local, edge-like regime, ms of the Worker's own JavaScript per request, median of three fresh processes; `first` is the first request of the process; `before > after`. 86 articles; PBKDF2 of a sign-in (8.3 ms, native) not included.

**Admin Worker**

| Route | first | p50 (requests 3 to 12) | warm p50 |
| --- | --- | --- | --- |
| `GET /api/config` | 1.58 > 0.67 | 0.08 > 0.08 | 0.01 > 0.02 |
| `GET /api/me`, no cookie (401) | 9.78 > 0.59 | 0.80 > 0.09 | 0.22 > 0.02 |
| `GET /api/dashboard`, no cookie (401) | 9.32 > 0.54 | 0.81 > 0.09 | 0.23 > 0.02 |
| `GET /api/admin/blog`, no cookie (401) | 8.30 > 0.56 | 0.78 > 0.09 | 0.23 > 0.02 |
| `GET /api/me`, signed in | 12.47 > 3.94 | 1.29 > 0.72 | 0.44 > 0.22 |
| `GET /api/dashboard`, signed in | 13.08 > 4.85 | 1.98 > 0.90 | 0.58 > 0.30 |
| `GET /api/admin/blog`, an editor | 13.99 > 5.56 | 2.36 > 1.01 | 0.74 > 0.38 |
| `GET /api/admin/messages` | 13.52 > 5.60 | 1.82 > 0.88 | 0.58 > 0.28 |
| `GET /api/admin/shortlinks` | 14.21 > 4.78 | 1.95 > 0.88 | 0.57 > 0.27 |
| `GET /api/admin/announcements` | 13.43 > 5.16 | 1.99 > 1.11 | 0.62 > 0.35 |
| `GET /api/admin/team` | 13.63 > 5.48 | 1.85 > 0.98 | 0.61 > 0.33 |
| `POST /api/auth/sign-in/email`, right password (+ 8.3 native hash) | 18.16 > 10.56 | 3.14 > 2.50 | 1.51 > 1.27 |
| the same, wrong password | 16.95 > 10.01 | 2.56 > 2.04 | 1.32 > 1.20 |
| `PublicApi` blog list | 3.87 > 1.80 | 0.70 > 0.19 | 0.24 > 0.06 |
| `PublicApi` article | 3.54 > 1.70 | 0.68 > 0.17 | 0.21 > 0.06 |
| `PublicApi` team (24 members) | 3.02 > 1.44 | 0.51 > 0.20 | 0.17 > 0.06 |
| `PublicApi` reports, documents | 3.05 > 1.27, 3.41 > 1.20 | 0.45 > 0.13, 0.49 > 0.16 | 0.12 > 0.02, 0.14 > 0.03 |
| `PublicApi` short link, unknown short link | 2.90 > 1.29, 2.82 > 1.19 | 0.40 > 0.11, 0.39 > 0.08 | 0.11 > 0.02, 0.10 > 0.01 |

**Site Worker** (built `dist/server`). With `PAGE_CACHE_SECONDS` unset nothing changed (the figures are within the noise of the method: `/blog` 2.08 and 1.91 ms, `/tim` 3.96 and 4.13, every page's first request 12 to 17 ms) and **the HTML and headers of all 15 routes are byte for byte equal** (`--dump`, `diff -r`). With the copy on (`PAGE_CACHE_SECONDS=30`; the first request renders and stores, the next ones are copies):

| Page | p50 render > copy | warm p50 render > copy | the miss costs |
| --- | --- | --- | --- |
| `/blog`, `/blog?page=2` | 1.99 > 0.42, 1.93 > 0.39 | 0.71 > 0.17, 0.67 > 0.16 | about 1 ms more on first sight, locally |
| `/blog/<slug>` (three articles) | 1.55 > 0.38, 1.34 > 0.36, 1.23 > 0.37 | 0.52 > 0.14 | |
| `/tim` (24 members) | 4.10 > 0.46 | 1.16 > 0.22 | |
| `/laporan` (then; now the section of `/donasi`, 10.9), `/gabung-siswa/docs` | 2.15 > 0.38, 2.48 > 0.38 | 0.59 > 0.15, 0.71 > 0.18 | |
| `/sitemap.xml` | 1.02 > 0.33 | 0.56 > 0.13 | |
| `/kontak`, the 404 pages, the redirects | unchanged (not copied) | | |

### 10.6 What is left, and why

- **The uncached render of a page is unchanged**, and it is the main cost of the site Worker: 13 ms at the edge for `/blog`, 7 to 9 for an article, 5 to 7 for the other pages, against a gate of 5 at p99. Only the page copy changes that, and only where it is on and the copy is warm. Beyond it: the Cache API on the production zone (a data-centre-wide copy, not testable on `workers.dev`, and the first thing to try at the cutover), a custom entry with non-streaming rendering (10 to 20%, copies the adapter's handler), and turning repeated card markup into strings (about 20% on `/blog`, at the price of keeping the design in TypeScript templates): not done. The first request of a cold isolate on the site cannot be warmed: rendering a page needs a `Response`.
- **Sign-in**: the hash (100,000 iterations of PBKDF2-SHA256, untouched) is 8.3 ms natively on a fast laptop; the JavaScript around it is about 1.5 ms warm, 3 ms on the next calls of a cold process and 18 ms on a first call (10.6 ms after the warm-up), because Better Auth's HTTP router and the sign-in endpoint are built on every call (`handler` calls `router(ctx, options)` each time, inside Better Auth) and the sign-in code is compiled on its first call. The warm-up compiles the router, not the endpoint (it would draw a random number, which global scope refuses). Whether sign-in fits 10 ms on Free is for a warm second sign-in on staging to say; measuring it is the follow-up named in the ticket.
- **The authenticated CRUD routes** still run Drizzle's query builder per request (a list is dynamic: filters, search, sort, page): about 30% of a list route locally after the changes. The shared instance and the one-time grants query took the fixed part.
- **Better Auth reads a session in two sequential D1 round trips** (the session, then its user); a join would make it one (`experimental.joins` needs Drizzle relations in the schema it is given). Not done.
- **The public article answer still carries `contentMarkdown`** (half of its bytes, never read by the site). Dropping it is a change of the contract in [`content-api.md`](content-api.md) and the saving is JSON work in two Workers; not done.
- Not measured: the real edge, a custom zone, the Cache API, the share of D1 and binding JavaScript, writes and uploads, the cron.

### 10.7 What was not tested here

Everything on a real zone or the edge (the Cache API, `workers.dev` against a route, Cloudflare's accounting of start-up and of first calls); visual and interaction QA (no page's markup changed, and with the copy off the bytes are equal; with it on a page is the stored bytes); the real Turnstile and the real rate limit bindings (the tests use doubles, as before). What was verified in a real workerd (`wrangler dev`, local D1, fake values): the shared Better Auth and the prepared reads across many separate requests, 40 concurrent signed-in requests of three roles, two overlapping reset requests each delivering its own email, sign-out, the site reading through a real service binding five rounds and 30 concurrent requests, no error in either log, and that the warm-up runs in global scope without a refusal.

### 10.8 How to check it on staging

[`staging-runbook.md`](staging-runbook.md#13-measure-cpu-per-route), step 13g: re-run the probe and compare with the table of 10.1; the 401 routes should now cost about what `/api/config` costs; look at the first invocation after idle (the warm-up); sign in twice; try `PAGE_CACHE_SECONDS=30` on the site as an A/B. The local harness (`pnpm measure:cpu`, `--compare` / `--compare-server` against a copy of an earlier commit, `--page-cache 30`, `--dump` for a byte comparison) is the way to measure a further change before deploying it.

### 10.9 `/donasi` becomes a Worker page (SAKEM-105): the extra request and CPU budget

SAKEM-105 (variant A, approved by Dzul) moved the reports into a section of `/donasi` (`id="laporan"`) and made `/laporan` a permanent redirect to `/donasi#laporan`. Reading the reports from the API needs the Worker, so **`/donasi` is no longer a static file**: the Workers assets layer answered it with no Worker request at all, and now the Worker renders it (`export const prerender = false`), like `/tim` or `/gabung-siswa/docs`. What that costs on the Free plan, and what was done about it:

**Requests (100,000 a day for the whole account, 2.4).**

| | Before | After |
| --- | --- | --- |
| a visit to `/donasi` | 0 Worker requests (a static file) | **1 Worker request** |
| a visit to `/laporan` (an old link, a bookmark, a search result) | 1 Worker request (SSR) | **0**: a `_redirects` answer of the assets layer (a 308, free and unlimited), then the 1 of `/donasi` above |
| the footer's "Laporan", `/impact-reports` | 1 (the page), a 308 then 1 | a link to `/donasi#laporan`: 1; `/impact-reports` is one free 308, then 1 |
| the sitemap | lists `/laporan` | does not (a redirect is not a sitemap URL) |

So the change is **+1 Worker request per visit to `/donasi`** (the page visitors reach from the menu and from every "Dukung" button), and **no change** for someone who came for the reports. In the model of 2.4 (about 3 Worker requests for a first page view, 1 for each further SSR page), if `/donasi` is 5 to 10% of page views, the daily total grows by that share of the page views: for 30,000 visits a day (the wall of 2.4) that is roughly 1,500 to 3,000 requests, 1.5 to 3% of the budget. The page copy (`PAGE_CACHE_SECONDS`) cuts the CPU of a request, **not the number of requests**: a copy is still answered by the Worker. Nothing here is measured on a real zone; the dashboard's request chart after the first week is the figure.

**CPU (10 ms per request, 2.3).** Local only: `pnpm measure:cpu` in `cf/web`, the built Worker in plain Node, the content API answered from the recording at school volume (16 reports), 2026-10-16, ms of the Worker's own JavaScript per request, median of three fresh processes (edge-like: `node --jitless`) and a warm run. **These are this machine's numbers and not Cloudflare's CPU**: the staging probe of 10.1 measured the old `/laporan` at 5 ms p50 and 9 ms at the maximum on the real edge, with no Cache API, where this harness says 1.8 ms: the ratio of about 3 is the one to carry over, not the figures.

| Page | edge-like first | p50 | max | warm p50 | warm p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| old `/donasi` (static) | 0 (no Worker) | | | | |
| old `/laporan` (SSR, 16 reports) | 2.00 | 1.78 | 2.90 | 0.53 | 1.52 |
| **new `/donasi`** (SSR, the page and the section) | **2.59** | **2.07** | 2.48 | **0.58** | 1.82 |
| new `/donasi` with `PAGE_CACHE_SECONDS=30` (a copy) | 0.47 | 0.33 | 0.62 | 0.13 | 0.33 |
| `/laporan` answered by the middleware (when the assets layer does not) | 0.33 | 0.26 | 0.60 | 0.10 | 0.24 |
| control, the same two sessions: `/blog` | 2.05 > 2.09 | 1.66 > 1.70 | | 0.56 > 0.55 | |
| control: `/tim` | 3.52 > 3.55 | 3.38 > 3.52 | | 1.00 > 1.00 | |

Without a Cache API (the `workers.dev` regime of staging): old `/laporan` first 12.40, p50 1.83, warm p50 0.53; new `/donasi` first 13.07, p50 2.15, warm p50 0.59. The new page is about 15% heavier than the old `/laporan` (it is that page plus the payment cards, 56 KB of HTML against 49 KB), and a copy brings it to the cost of a redirect. **Reading it with the edge's ratio, an uncached `/donasi` is expected at about 6 ms p50 and 10 ms at the maximum on Cloudflare, which is the band the gate calls FAIL (p99 over 8): the page that was free is now one of the heavier ones.** It is the donation page, so the options, in the order I would take them (the decision is the PM's and Dzul's):

1. **Turn the page copy on at the cutover** (`--var PAGE_CACHE_SECONDS:30`, no code change; `/donasi` is on its list, [`web-skeleton.md`](web-skeleton.md)). A copy costs about a sixth of a render, and only a fresh answer is ever copied (never the degraded page, which is a 200 with `no-store`, nor a stale one).
2. The production zone's Cache API (3.4) is already counted on for the API answers; it is not a copy of the page.
3. If the staging probe still says FAIL after 1: keep `/donasi` static and let the Laporan section read the reports in the browser from a small endpoint, which is a different design from the approved one (and would need the endpoint, CORS, and a second look at the failure panel). Not done, not proposed as the first choice.

**What the page does when the API cannot answer.** `/donasi` never fails because of the reports: the Laporan section shows its failure panel and the page is still a **200** (`cache-control: no-store`, no `Retry-After`), where `/laporan` was a 503. With the API down and a cold cache a visit waits the loader's 2 s timeout once (the stale copy of the last 7 days, when there is one, answers instead, and an outage costs one wait per 30 s, not one per request). That wait is the price of reading the reports at request time; a shorter timeout for this page would trade it for more failure panels and is not applied.

**What was not measured:** Cloudflare CPU of any of this, the Cache API on a real zone, the real distribution of visits between `/donasi` and the rest.

## Sources

Cloudflare documentation (read as the `index.md` form of each page on 2026-10-13): Workers [limits](https://developers.cloudflare.com/workers/platform/limits/), [pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/), [static assets](https://developers.cloudflare.com/workers/static-assets/), [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/), [Context](https://developers.cloudflare.com/workers/runtime-apis/context/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), [Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/), [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), [environments](https://developers.cloudflare.com/workers/wrangler/environments/), [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), [errors](https://developers.cloudflare.com/workers/observability/errors/); [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [limits](https://developers.cloudflare.com/d1/platform/limits/); [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/), [limits](https://developers.cloudflare.com/r2/platform/limits/); [Turnstile plans](https://developers.cloudflare.com/turnstile/plans/); [Observability pricing](https://developers.cloudflare.com/observability/pricing/); [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/); [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/); [WAF rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/). Resend: [pricing](https://resend.com/pricing), [rate limits](https://resend.com/docs/api-reference/rate-limit), [resend.dev 403](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).
