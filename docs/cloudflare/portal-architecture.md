# Student portal: architecture (SAKEM-083, step 1)

How the student portal of the new stack is built, where it lives, how it is routed, how its data and its private files are kept, and how the build splits into four tasks that do not collide. Ticket: SAKEM-083 (M4 of epic SAKEM-074). The request and response contract the build workers implement and test against is the companion file [`portal-api.md`](portal-api.md).

**Status: design only.** (P2, the SPA shell, the shared module and the `cf/web` side, is built: [`portal-spa.md`](portal-spa.md).) Nothing else here is built, no Cloudflare account was used (the Cloudflare documentation was read on 2026-10-13, nothing else), no resource exists, and no application code, migration or configuration changes with this document. Everything marked "paper estimate" is arithmetic, not a measurement; what only a real zone can settle is listed in [section 14](#14-what-is-not-verified).

## Contents

[1. Decided, and not reopened](#1-decided-and-not-reopened) · [2. Decisions at a glance](#2-decisions-at-a-glance) · [3. D1 How `/portal/*` reaches the portal](#3-d1-how-sakolakembaraorgportal-reaches-the-portal) · [4. D2 The portal Worker](#4-d2-the-portal-worker-sakem-portal) · [5. D3 The portal SPA and the shared module](#5-d3-the-portal-spa-and-the-shared-module) · [6. D4 API surface, cookies, limits](#6-d4-api-surface-cookies-and-limits) · [7. D5 Data model](#7-d5-data-model) · [8. D6 Private file storage](#8-d6-private-file-storage) · [9. D7 Emails](#9-d7-emails) · [10. Cost and limits of the hot paths](#10-cost-and-limits-of-the-hot-paths) · [11. Work breakdown](#11-work-breakdown) · [12. Before go-live](#12-before-go-live) · [13. Open decisions for Dzul](#13-open-decisions-for-dzul) · [14. What is not verified](#14-what-is-not-verified) · [15. Sources](#15-sources)

## 1. Decided, and not reopened

From the epic and its milestones (Saung SAKEM-074, 081, 082, 083; the PM's briefing of 2026-10-13):

- **$0 on Workers Free.** 10 ms CPU per request, 100,000 requests a day per account, D1 Free (5,000,000 rows read and 100,000 rows written a day), R2 Free (10 GB-month, 1 million Class A and 10 million Class B operations a month; a card is on file only because R2 requires it), Resend Free (100 emails a day, 3,000 a month).
- All work lives on the long-lived branch `cloudflare`; the old Next app (`app/(portal)/**`, `app/(auth)/**`, `lib/application-status.ts`, `lib/admission*.ts`, `lib/db/schema/{student-applications,users}.ts`) is the reference for every rule and message. Visual style and Indonesian copy are fixed (`DESIGN.md`, `docs/context/tone-of-voice.md`). Production holds dummy data only, so no data is migrated.
- **The portal lives at the path `/portal` of the apex** (`sakolakembara.org/portal/...`, Dzul: "pake path aja"); the admin lives on its own subdomain of the same domain (`admin.<domain>` below). The student session and the admin session are separate, host-only `__Host-` cookies (PR #49, [`auth.md`](auth.md#cookies-and-csrf)).
- Students register themselves (`POST /api/auth/register`, Turnstile, no enumeration), **verify their email before the first sign-in**, can sign in with password or Google, reset their password. Admins never verify (SAKEM-089) and do not matter here.
- The portal's login, register, forgot, reset and verify pages follow the admin login layout: one narrow column, no card, one heading ([`shared/spa/AuthShell.tsx`](../../cf/admin/shared/spa/AuthShell.tsx), moved there from `spa/src/pages/auth/` by P2); the Indonesian copy is the legacy copy.
- SSO to the LMS is deferred. Nothing in this design depends on it and nothing in it prepares for it, except that the host-only cookie decision stands ([`auth.md`](auth.md#cookies-and-csrf)).
- **New, 2026-10-13: applicants upload their documents to a private R2 bucket.** These are documents of children. Privacy is a first-class requirement, not a feature of the file code: section 8.

## 2. Decisions at a glance

| # | Decision | Alternative considered | Why |
| --- | --- | --- | --- |
| D1 | A **third Worker**, `sakem-portal`, on the route `sakolakembara.org/portal/*` (and `sakolakembara.org/portal`). The web Worker keeps the rest of the apex. | (A) the same route on the admin Worker `sakem-admin`; (B) the web Worker forwards `/portal/*` through a service binding | A Worker has exactly one static-assets collection and one SPA fallback `/index.html`, so two SPAs cannot share one Worker without running the Worker for every page load. B bills the web Worker for every portal file. [Section 3](#3-d1-how-sakolakembaraorgportal-reaches-the-portal) |
| D2 | `sakem-portal` is a **second entry of the `cf/admin` package** (second wrangler config, its own `src/portal/` tree), importing the existing auth, security, email, db and upload helpers. | A new `cf/portal` package | Every shared helper is in `cf/admin/src` and its tests run in one workerd pool; a new package would import source across two `node_modules`. [Section 4](#4-d2-the-portal-worker-sakem-portal) |
| D3 | A **separate Vite app**, `cf/admin/portal-spa/`, base path `/portal/`, with a small shared module `cf/admin/shared/` extracted from the admin SPA. | One SPA for both audiences; copy the admin files | One bundle cannot have two bases and would ship admin code to children's phones; copies drift. [Section 5](#5-d3-the-portal-spa-and-the-shared-module) |
| D4 | The student API lives under **`/portal/api/*`** (Better Auth at `/portal/api/auth/*`); distinct session cookie name and distinct `BETTER_AUTH_SECRET` per Worker; no CORS. | The admin's `/api/*` on a second host | The route only carries `/portal/*`; a distinct secret means a token of one audience is not valid for the other even if a cookie were copied. [Section 6](#6-d4-api-surface-cookies-and-limits) |
| D5 | A draft is a row in a **new table `application_drafts`**; `student_applications` holds submitted applications only (legacy statuses unchanged). The draft's id becomes the application's id. Only a **complete, valid step** is saved to the server; typing in progress is kept locally. | A `draft` status in `student_applications`; the browser only | The admin's lists, counts, publish guard and tests keep meaning "submitted"; no table rebuild; children's half-filled data is never in the admin's reach. [Section 7](#7-d5-data-model) |
| D6 | Files go to a **private bucket** `sakem-private` (binding `PRIVATE_FILES`) through a Worker that streams the body to R2; every read goes through a Worker after an ownership or area check; **no SSE-C** (decided 2026-10-13, [section 13](#13-open-decisions-for-dzul)). | Presigned URLs; the public bucket | A presigned URL is a bearer link that cannot be audited per view; the public bucket serves any key to anyone. [Section 8](#8-d6-private-file-storage) |
| D7 | New emails: **one**, the submission confirmation (best effort). No publication email. A daily send counter protects verification emails at the season peak. | A publication email to every applicant | 100 emails a day cannot reach 300 applicants "at once", which is the privacy promise. [Section 9](#9-d7-emails) |

Five other things this document decides, with the reasons where they appear: an uploaded file is **one request body streamed to R2** (no multipart parse, constant memory; section 8.4); an **admin must hold `pendaftaran` write to open an applicant's file** and a viewer sees metadata only (flagged as open decision 1); **the application id is allocated at the first save** and never changes; the **wizard's UI order follows the legacy order**, not the order in the Saung ticket (open decision 4); the old `/login`, `/register`, ... and `/api` pass-through of `cf/web` is removed (section 6.6).

## 3. D1 How `sakolakembara.org/portal/*` reaches the portal

### 3.1 What Cloudflare documents

Everything below is from the Cloudflare documentation read on 2026-10-13 (URLs in [section 15](#15-sources)). It is paraphrased, not quoted; "verify" marks what the documentation does not state and a real zone must show.

**Routes.**

- A route pattern may contain only the wildcard `*`, no wildcard in the middle of a path, no query string; a path ending in `*` matches every suffix; matching looks at the whole URL, query included. `example.com/portal/*` does not match `example.com/portal`, so two patterns are needed (`.../portal` and `.../portal/*`).
- When several patterns match, **the most specific wins** (the documentation's own example: `example.com/hello/*` beats `example.com/*`). A pattern with no Worker attached negates less specific ones.
- A known bug concerns `.../images/*` against `.../images*` on two Workers (the second wins for all three URLs of the example). We use neither shape against the other; the web Worker's pattern is `.../*` and ours is `.../portal/*`. Verify.
- A route needs a proxied DNS record for its hostname. A Worker's `fetch()` of the incoming URL reaches the origin behind the hostname; **a route cannot be the target of a same-zone `fetch()`**, and Worker-to-Worker calls on one zone go through service bindings. At most 1,000 routes per zone.
- **Routes can `fetch()` a Custom Domain and take precedence over one on the same hostname**; the documented example is a logging Worker on route `app.example.com/*` in front of an application Worker on a Custom Domain of the same hostname. A Custom Domain matches on the exact hostname only; its path is not considered.
- On the Free plan a route has a failure mode once the day's 100,000 requests are spent: fail open bypasses the Worker, fail closed answers error 1027 (the documentation recommends closed for security-critical Workers). It is a toggle on the route.

**Static assets.**

- Requests answered from the assets layer are free and unlimited and cost no Worker request; only requests that reach the Worker script are billed as requests. A Worker has **one** asset collection. An asset is found by the URL **pathname** as it arrives.
- With a Worker script and `not_found_handling: "single-page-application"`, a request that matches no asset is answered with the Worker's own `/index.html` and status 200, and with a compatibility date of 2025-04-01 or later **navigation requests** (`Sec-Fetch-Mode: navigate`) take that path **without invoking the Worker**. Our configs use `2026-09-01`.
- `assets.run_worker_first` as an array runs the Worker first only for matching paths (`*` globs, `!` negations, at most 100 entries); a navigation to a matching path invokes the Worker too (this is how the emailed verification and reset links and the Google callback reach the admin Worker today). **On Free, once the daily limit is exhausted, requests matching these patterns get a 429 instead of falling back to assets**; asset-only requests keep being served.
- `html_handling` decides the redirects and rewrites for HTML (`auto-trailing-slash` by default: `/folder` answers 307 to `/folder/`; `none` turns all of it off). A `_headers` file (up to 100 rules) sets headers on **asset responses only**, never on a response the Worker script produces. Default asset headers: `Cache-Control: public, max-age=0, must-revalidate` and an `ETag`.

**Service bindings and limits (Free).**

- A call through a service binding adds no request fee; billing counts one request for the first Worker and the CPU of both. (This is stated for billing; the page does not say how the callee counts against the Free daily limit. Verify.) A chain is limited to 32 Worker invocations; each call counts as a subrequest.
- Free limits: 100,000 requests a day per **account** (all Workers share it), 10 ms CPU per request, 128 MB of memory per isolate, 50 subrequests per request (D1 and R2 calls are subrequests), 1,000 subrequests to internal services, a request body up to 100 MB (the limit of the Cloudflare plan of the zone), 100 Workers and 20,000 asset files per Worker, 25 MiB per asset file, 3 MiB compressed Worker size.

### 3.2 The three candidates

| | **A. Route to `sakem-admin`** | **B. Web Worker forwards through a service binding** | **C. A third Worker `sakem-portal` on the route** |
| --- | --- | --- | --- |
| How a request gets there | route `apex/portal/*` to the admin Worker | route `apex/*` to the web Worker, which calls `env.PORTAL.fetch(request)` for `/portal/*` | route `apex/portal/*` to `sakem-portal` |
| Portal SPA | The admin Worker already owns its one asset collection and its one `/index.html` fallback. A deep link such as `/portal/status` would be answered with the **admin's** `index.html`. To serve the portal's, `/portal/*` must run the Worker first (a billed request per page load, `env.ASSETS.fetch` for the shell), or the two SPAs become one bundle with one base (rejected: one base cannot be both `/` and `/portal/`, and children's phones would download the admin). | The portal's own assets are not served by the assets layer of the web Worker; every file, including each hashed script, goes **through the web Worker first**. | Own asset collection: the shell, scripts, styles and fonts are free asset requests; deep links get the portal's own fallback. |
| Worker requests for a page view with 6 asset files (the HTML shell included) and 3 API calls | **4**: the shell must run the Worker to be the portal's, the other five files stay free if laid out under `portal/` | **9** on the web Worker, plus the CPU of the Astro middleware for each, plus the calls into the portal Worker | **3** |
| Failure and deploy isolation | A portal change redeploys the admin; a portal bug can take the admin down. | The web Worker is on the critical path of the portal; a web deploy affects it. | Independent deploys; the web and admin Workers never run portal code. |
| Host-dependent code | The same Hono app serves two hosts: every route needs a host check so `/portal/api/admin/*` can never exist and `/api/admin/*` never answers on the apex. | None for the apex, but the web Worker needs a binding and a routing rule. | Each Worker mounts only its own routes; no host check can be forgotten. |
| Staging on `workers.dev` (Dzul's decision) | Works on one host. | Needs both Workers. | Works on one host: the Worker serves the `/portal` prefix itself, so the same build runs at `https://<worker>.<subdomain>.workers.dev/portal/`. |
| Cost of the choice | none | the Free daily request budget | one more Worker (100 allowed per account) and one more `wrangler deploy` |

### 3.3 Decision: C

`sakem-portal` is a Worker of its own. It serves the portal SPA from its own assets and the student API from its script, and it is attached to the zone by two routes on the apex hostname: `sakolakembara.org/portal` and `sakolakembara.org/portal/*`.

Why, from the documented behaviour:

1. The SPA fallback is one `/index.html` per Worker. Only a Worker of its own gives the portal deep links without a billed Worker request per page load.
2. Static asset requests are free and unlimited, and navigations are exempt from the Worker; a page view therefore costs the API calls only (3, not 9).
3. The route precedence rule is documented and does not depend on the web Worker's own routing mode: the web Worker's pattern (`apex/*`, or a Custom Domain on the apex) is less specific than `apex/portal/*`, and a route takes precedence over a Custom Domain on the same hostname.
4. It isolates failure and deploys, and no host check has to be remembered: the portal Worker has no admin route to expose and the admin Worker has no student route to expose.
5. The Worker keeps the `/portal` prefix in its own paths (it does not strip it), so the identical build runs on a `workers.dev` staging host, where routes do not exist.

**Free-tier cost.** Worker requests: the API calls only, about 25 per applicant's wizard session ([section 10](#10-cost-and-limits-of-the-hot-paths)); the asset requests are free. CPU and D1: per route in section 10. **Risk.** (a) The real precedence of two Workers on one hostname, and the behaviour of the known trailing-`/*` bug, are only shown by a real zone: [section 3.6](#36-what-only-a-real-zone-can-verify). (b) All Workers share the 100,000 requests a day; the portal adds a few thousand on a peak day, and when the day is exhausted every `/portal/api/*` call fails (429, or the error 1027 page on a fail-closed route) while the already loaded pages stay up. (c) A third Worker is a third thing to deploy and to keep in step; the checks of [section 11](#11-work-breakdown) pin the shared parts (D1 binding name, migrations folder, rate limit numbers) with tests.

### 3.4 What a request to `/portal/*` costs

| Request | Answered by | Worker requests (of 100,000 a day) | Worker CPU | D1 rows |
| --- | --- | --- | --- | --- |
| Navigation to `/portal`, `/portal/`, `/portal/status`, any SPA path | assets layer (the portal's `/index.html` fallback) | 0 | 0 | 0 |
| `/portal/assets/<hash>.js`, `.css`, fonts, icons | assets layer | 0 | 0 | 0 |
| `/portal/api/*`, `GET` or `POST`, fetch or emailed link | `sakem-portal` script (`run_worker_first`) | 1 | a few ms, unmeasured | 3 to 12 read (session, user, batch), writes per route in section 10 |
| A non-navigation request to a missing asset (`fetch("/portal/x.png")`) | falls through to the script, which answers a JSON 404 | 1 | negligible | 0 |
| Candidate B for comparison: any of the above | web Worker first, then a service-binding call | 1 each, plus the Astro middleware | more | same |

### 3.5 What must be configured at deploy

Not in git (public repository, no ids, no hostnames beyond the public domain): they are set by the deploy ticket, after the zone is active.

- **Names (placeholders).** `sakem-web` (the web Worker; its `name` in `cf/web/wrangler.jsonc` is `sakola-kembara-web`, and `account-setup.md` proposes `sakem-web-staging`: the deploy ticket picks one set), `sakem-admin` (it must equal the `service` of the web Worker's `API` binding, a test keeps the two equal today) and `sakem-portal`.
- **Routes of `sakem-portal`:** `sakolakembara.org/portal` and `sakolakembara.org/portal/*`, zone `sakolakembara.org`, both on the same Worker. The apex needs a proxied DNS record (it exists for the web Worker). `workers_dev` follows the environment: off in production, on for staging (adding `routes` to a config turns `workers_dev` off on the next deploy).
- **The web Worker** stays on its own pattern (`sakolakembara.org/*`, or the Custom Domain decided at M5). M4 does not need to choose; D1 holds in both modes.
- **Failure mode of the two portal routes:** fail closed (the portal holds session-bound data; a bypass would send `/portal/api/*` to the web Worker, which answers 404, and hide the cause).
- **Per Worker, not shared:** a different `BETTER_AUTH_SECRET` for `sakem-portal` and `sakem-admin` ([section 6.2](#62-cookies-and-the-two-audiences)); the same D1 database (binding `DB`, `database_name` equal in both configs, one `migrations/` folder, migrations applied once, from `cf/admin`); the private bucket binding `PRIVATE_FILES` on both Workers.
- **Variables and secrets of `sakem-portal`** (names only): vars `ENVIRONMENT`, `TURNSTILE_SITE_KEY`, `EMAIL_FROM`, `SITE_URL`, `PRIVATE_FILES_BUDGET_BYTES`, `ADMIN_URL` (where the "this is an admin account" screen links); secrets `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (optional). There is **no key for the private bucket**: SSE-C was decided against on 2026-10-13 ([section 8.7](#87-encryption)), so no `PRIVATE_FILES_KEY` is declared in `env.ts` or in a wrangler config and nothing depends on one. The retention variables of [section 8.9](#89-retention-and-deletion-proposal) (`DRAFT_RETENTION_DAYS`, `REJECTED_FILES_RETENTION_DAYS`, `ACCEPTED_FILES_RETENTION_DAYS`) are declared on `sakem-admin` only, at `0` (never delete), and no code reads them: nothing is deleted automatically.

### 3.6 What only a real zone can verify

None of this can be shown locally; each item is a line of SAKEM-084's checklist:

1. Route precedence: `/portal`, `/portal/`, `/portal/status`, `/portal?x=1`, `/portal/api/me` reach `sakem-portal`; `/`, `/portalx`, `/portal-x/y`, `/Portal/x` (the path is case sensitive) reach the web Worker; with the web Worker once as a route (`apex/*`) and once as a Custom Domain.
2. No Worker invocation for `/portal/assets/*` and for navigations (the Workers metrics or `wrangler tail` show nothing), and `/portal/status` as a navigation is answered with the portal's `index.html`, not the admin's.
3. The `run_worker_first` pattern `/portal/api/*` matches pathnames that include the `/portal` prefix, including a navigation from an emailed link.
4. `__Host-` cookies set by a response of `/portal/api/auth/*` with `Path=/` are accepted on the apex and sent to `/portal/api/*`; the Google callback (`SameSite=Lax` state cookie) completes.
5. The `_headers` rules apply to the fallback `index.html` response (the documentation says "asset responses"; the fallback is an asset).
6. What the portal shows when the day's 100,000 requests are spent (the route's failure mode and the 429 of `run_worker_first`).
7. `CF-Connecting-IP` reaches the portal script directly (no service binding is involved, so it should).
8. A service-binding call from the web Worker is not used here; if B is ever revisited, how the callee counts against the Free daily limit.

## 4. D2 The portal Worker (`sakem-portal`)

### 4.1 Where its code lives

A second entry of the existing package, not a new package. Every helper the portal needs (`src/auth/*`, `src/security/*`, `src/email/*`, `src/db/*`, `src/uploads/sniff.ts`, `src/api/crud/*`) is in `cf/admin/src`, the Worker suite runs them in one workerd pool, and a package of its own would import source across two `node_modules` (the lockfile, `better-auth` and `drizzle-orm` versions would have to be kept equal by hand). The cost is a name that is no longer exact ("admin" holds the backend of both audiences); a rename is a later, mechanical ticket and is not part of M4.

```
cf/admin/
  wrangler.jsonc                  sakem-admin (unchanged, plus the private bucket and the admin file limiter)
  wrangler.portal.jsonc           sakem-portal (new): assets, D1, R2, limiters, vars. No routes, no ids
  src/
    worker.ts                     admin entry (as today, plus the admin file routes and the retention cron)
    portal/
      worker.ts                   portal entry: the Hono app, the guards, the mounts; no cron
      applications.ts             overview, current, steps, submit, status list
      files.ts                    student file routes
      guard.ts  headers.ts        requireStudent (session, role, verified address, limiter by user id) and the headers of every answer: built by P1a
      rules.ts  queries.ts  present.ts
    private-files/                slots, key, store, quota, retention
    api/application-files.ts      admin file routes
  shared/                         pure TypeScript used by the Worker and by both SPAs
    application-form/             slots.ts, limits.ts, steps.ts, rules.ts (the rules, no zod), schemas.ts (zod wrapper), form-data.ts
    spa/                          React and browser code shared by the two SPAs
    vite/                         the shared Vite pieces
  spa/                            the admin SPA (as today)
  portal-spa/                     the portal SPA
  dist/spa  dist/portal-spa       build outputs (gitignored)
```

### 4.2 What it shares and what it must not import

- **Shared as they are:** `src/security/{client,csrf,rate-limit,turnstile}.ts`, `src/email/*`, `src/db/*`, `src/uploads/sniff.ts`, the CRUD kit's error envelope (`src/api/crud/errors.ts`).
- **Shared after one change, owned by P1a:** `src/auth/factory.ts`, `gate.ts` and `register.ts` take a **base path and an audience** (`/api/auth` and `admin`, or `/portal/api/auth` and `student`) instead of the constant `AUTH_BASE_PATH`. The admin's behaviour must stay byte for byte the same; the existing Worker suite (1,761 tests at the last count in [`admin-pendaftaran.md`](admin-pendaftaran.md#measured)) is the proof, plus new tests that run the whole route table under the portal base path.
- **Must not be imported:** `src/blog/*`, `src/api/blog.ts`, `src/public/*`, `src/api/public/*`, `src/api/{reports,team,shortlinks,messages,announcements,...}.ts` and the markdown libraries. The portal does not need them. A test fails when a file under `src/portal/` imports one of them (`test/portal-foundation-config.test.ts`; `src/private-files/` is held to the same bucket rule), and the dry-run size is a gate (`pnpm check:portal-worker`). **Measured at P1a, correcting the first draft:** the portal Worker is 2,860 KiB raw, **490.78 KiB gzip**, and the admin Worker 3,548 KiB, 641.23 KiB (at the head of `cloudflare` before P1a: 3,681 KiB, 642.10 KiB). The blog is not what makes these bundles big: better-auth (with the kysely and zod it brings) is most of both, so about 490 KiB gzip is the floor of any Worker of this stack, and the first draft's target of 350 KiB cannot be met. The gate is the measured size plus about 10% (540 KiB gzip); importing the blog's markdown pipeline into the portal measured 595 KiB and fails it. The hard ceiling is the 3 MiB compressed size of the Free plan (the portal uses 16% of it).
- **The Worker suite stays one pool.** `vitest.config.ts` keeps `wrangler.jsonc` as the pool's config (the admin Worker's bindings, which will include `PRIVATE_FILES` and the new limiters); the portal's entry is imported and called directly like `src/worker.ts` is today. A test reads `wrangler.portal.jsonc` and fails if its D1 `database_name`, `migrations_dir`, `compatibility_date`, limiter numbers or R2 bucket name differ from the admin's where they must be equal.

### 4.3 Configuration sketch (no ids, no secrets)

```jsonc
{
  "name": "sakem-portal",
  "main": "src/portal/worker.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "vars": { "ENVIRONMENT": "production", "PRIVATE_FILES_BUDGET_BYTES": "8000000000" },
  "assets": {
    "directory": "./dist/portal-spa",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "html_handling": "none",
    "run_worker_first": ["/portal/api/*"]
  },
  "d1_databases": [{ "binding": "DB", "database_name": "sakem-admin", "migrations_dir": "migrations" }],
  "r2_buckets": [{ "binding": "PRIVATE_FILES", "bucket_name": "sakem-private" }],
  "ratelimits": [ /* RL_LOGIN ... RL_TOKEN as in wrangler.jsonc, own namespace ids (80xx), plus the four of section 6.3 */ ]
  // no "routes": added by the deploy ticket (section 3.5)
}
```

`html_handling: "none"` makes `/portal`, `/portal/` and every other path that is not a file fall through to the single `/index.html`, so there is no 307 between `/portal` and `/portal/`; the asset files are matched by their pathname (`/portal/assets/...`), which is why the build puts them under a `portal/` folder ([section 5.1](#51-layout-and-base-path)). Verify the result on a real zone ([section 3.6](#36-what-only-a-real-zone-can-verify), item 2).

### 4.4 Local development

`pnpm dev:portal` builds the portal SPA and runs `wrangler dev -c wrangler.portal.jsonc --port 8788` next to the admin's 8787; both share the local D1 state. Cookies on `localhost` ignore ports, which is why the two audiences have distinct cookie names even in development ([section 6.2](#62-cookies-and-the-two-audiences)). `pnpm dev:portal-spa:mock` serves the SPA with an invented API (as `dev:spa:mock` does for the admin) so Dzul can check the screens without a Worker.

**Free-tier cost.** None by itself (a Worker with no traffic costs nothing; the 100-Workers limit is far away). **Risk.** The two configs drift: the tests above exist for that. The admin's behaviour regresses through the auth change: the unchanged admin suite is the guard.

## 5. D3 The portal SPA and the shared module

### 5.1 Layout and base path

- A **separate Vite app** `cf/admin/portal-spa/` (React 19, react-router, Tailwind through the same `@/` alias to the repo-root `components/ui` kit and the same shared tokens as the admin).
- **Base path `/portal/`**: Vite `base: "/portal/"`, `createBrowserRouter(..., { basename: "/portal" })`. Router-relative paths (`/login`, `/daftar`, `/status`) are what the pages and `from=` carry; everything sent to the server is absolute (`/portal/api/...`; a `callbackURL` is `/portal/verify-email?status=success`).
- **Output layout, because assets are matched by pathname:** the build writes to `dist/portal-spa/portal/` (so a script is at `portal/assets/<hash>.js`, answering `/portal/assets/<hash>.js`), then a post-build step copies `portal/index.html` to `dist/portal-spa/index.html` (the SPA fallback is the Worker's `/index.html`) and copies `public/_headers` to `dist/portal-spa/_headers`. `wrangler.portal.jsonc` points `assets.directory` at `./dist/portal-spa`.
- **SPA fallback:** `not_found_handling: "single-page-application"` plus `html_handling: "none"` ([section 4.3](#43-configuration-sketch-no-ids-no-secrets)). `index.html` carries `<meta name="robots" content="noindex,nofollow">` (the legacy portal was `noindex`).
- **Routes of the SPA** (router-relative): `/` home, `/status`, `/daftar` (the wizard, lazy), `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/auth/error`, a not-found page, and a screen for an account that is not a student (links to `ADMIN_URL`).
- **Caching headers** (`public/_headers`, asset responses only): `/portal/assets/*` is `Cache-Control: public, max-age=31536000, immutable` (hashed names); `/index.html` and `/portal/index.html` are the default (revalidate every time, with an `ETag`). Security headers on every asset response: `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`, and a CSP: `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` (`blob:` is for the preview of the file a student just picked). Responses made by the Worker script get the same headers in code (`_headers` does not touch them).
- **Dev:** `vite --config portal-spa/vite.config.ts`, proxy `/portal/api` to `http://localhost:8788`.

### 5.2 The shared module: what moves and what is imported

The rule: **the admin SPA must not regress.** The extraction is mechanical (`git mv`, then fix imports), changes no behaviour, and leaves a one-line re-export at the old path wherever a Worker contract test or another admin file imports it, so nothing else has to change. The admin's SPA suite, the Worker contract tests (`test/*-spa-contract.test.ts`), `pnpm check:spa`, `pnpm test:negative` and `pnpm test:negative:spa` must pass without any assertion changed (only the path a negative check patches is updated), and the admin bundle must not grow by more than 1 kB gzip.

| Today (admin SPA, `spa/src/...`) | Moves to | The portal uses it for | Note |
| --- | --- | --- | --- |
| `pages/auth/AuthShell.tsx` (`AuthShell`, `AUTH_LINK`) | `shared/spa/AuthShell.tsx` | all auth pages | four admin pages change one import |
| `components/TurnstileWidget.tsx`, `lib/turnstile.ts`, `lib/captcha.ts` | `shared/spa/` | the widget on register, login, forgot, resend | `TURNSTILE_ROUTES` becomes `turnstileRoutes(apiBase)`; `lib/captcha.ts` re-exports `TURNSTILE_ROUTES = turnstileRoutes("/api")` and `TURNSTILE_HEADER`, so `test/spa-contract.test.ts` keeps its imports |
| `lib/api.ts` (`api`, `setTransport`, `ApiFailure`, `ApiResult`) | `shared/spa/api.ts` | every call | `lib/api.ts` re-exports; the admin-only `Announcement` types stay; `scripts/negative-checks-crud.mjs` patches the new path |
| `lib/auth-errors.ts`, `lib/validation.ts`, `lib/format.ts` | `shared/spa/` | the sign-in, reset and verify messages, the password rules | the two admin-only entries of `QUERY_ERRORS` (`admin-only`, `domain`) stay admin-side through an `extra` argument |
| `lib/hooks.ts`: `useSubmitLock`, `useAutoFocus`, `focusFirstInvalid`, `useFocusTrap`, `usePageTitle` | `shared/spa/hooks.ts` | forms and the nav drawer | `usePageTitle(title, suffix)`; `lib/hooks.ts` keeps the admin's suffix by wrapping |
| `lib/guard.ts`: `safeFrom` and `AUTH_PATHS` | `shared/spa/safe-from.ts` | the `from=` of the sign-in | `decideGuard` and `loginPath` stay (they use `accessTo`) |
| `components/ErrorBoundary.tsx` | `shared/spa/ErrorBoundary.tsx` | the crash screen | |
| the inline `GoogleIcon`, the "atau" rule and the Google button of `pages/auth/Login.tsx` | `shared/spa/GoogleButton.tsx` (`GoogleButton`, `OrDivider`) | login and register | new extraction, identical markup |
| `vite.config.ts`: `sharedTokens()` and the alias block | `shared/vite/spa-base.ts` | the build config of both | parameterised by the styles file; the admin config keeps working unchanged |

`shared/application-form/` is new (P1a): the pure form rules used by the Worker, by the wizard and, for the slot names only, by the admin's Pendaftar detail. `slots.ts` has no dependency (the admin SPA imports it); `schemas.ts` imports `zod` (only the Worker and the portal's lazy wizard chunk import it; the admin bundle must not contain zod, which `check:spa` verifies). Both Vite configs, both `tsconfig.json` files and the SPA vitest configs resolve `@shared/*` to `cf/admin/shared/*`; the Worker imports by relative path. **No barrel files** (an `index.ts` per folder is a merge conflict between tasks).

**Not shared:** the CRUD kit (`components/crud/*`, `lib/crud/*`), the shell, `Sidebar`, `RequireAuth`, `lib/access|me|nav|dashboard|audit`, every admin page, the admin mock. The upload client is the one exception, owned by P4: the XHR core of `lib/crud/upload-client.ts` becomes `shared/spa/xhr.ts` (a generic send with progress and abort); `xhrUploader` becomes a thin caller of it with the same behaviour and tests.

### 5.3 Bundle budget (proposal, enforced by `pnpm check:portal-spa`)

The admin SPA is one chunk of 539 kB raw, 162.7 kB gzip with its CSS at 52 kB raw, 12.8 kB gzip ([`admin-pendaftaran.md`](admin-pendaftaran.md#measured)); a student's phone on mobile data should not pay for that.

| Part | Budget (gzip) | Note |
| --- | --- | --- |
| Initial JS (React, router, auth pages, home, status) | 130 kB | |
| Wizard chunk (lazy: the seven steps, zod, local persistence, the file field) | 90 kB | loaded on `/daftar` only |
| CSS | 14 kB | one stylesheet |
| Fonts | the two `@fontsource-variable` families the admin uses, latin subset only | |

`check:portal-spa` fails when: a mock marker is in the build; any URL in `index.html` does not start with `/portal/`; a referenced file is not at that path under `dist/portal-spa`; `dist/portal-spa/index.html` is missing or differs from `portal/index.html`; `_headers` is missing; a budget is exceeded; `zod` is in the initial chunk.

### 5.4 Mock and tests

`portal-spa/src/mock/` implements the transport seam (`setTransport`) with invented data and personas (`?mock=no-batch`, `draft`, `submitted`, `published-accepted`, `published-rejected`, `admin-account`), as `spa/src/mock` does for the admin, so Dzul can look at every screen with `pnpm dev:portal-spa:mock`. SPA tests run in jsdom (the same setup as the admin's), plus a contract test in the Worker suite that imports the portal SPA's pure files (error maps, request builders) and runs them against the real portal Worker, like `test/spa-contract.test.ts` does for the admin.

**Free-tier cost.** None at runtime (assets are free). **Risk.** The extraction breaks the admin silently: guarded by the unchanged admin suites and the 1 kB bundle rule. A shared file grows admin-specific options and becomes a second admin: keep the shared set to the table above and add to it only through a PR that says why.

## 6. D4 API surface, cookies and limits

### 6.1 Base paths

| Path | Served by | Contents |
| --- | --- | --- |
| `/portal/api/auth/*` | `sakem-portal` | Better Auth through the same route table as the admin (`AUTH_POLICIES`), base path parameterised ([`auth.md`](auth.md#endpoints)) |
| `/portal/api/config`, `/portal/api/me` | `sakem-portal` | public config; the signed-in student |
| `/portal/api/overview`, `/portal/api/applications...`, `/portal/api/files/:id` | `sakem-portal` | the student API ([`portal-api.md`](portal-api.md)) |
| `/portal/api/dev/mailbox` | `sakem-portal`, only `ENVIRONMENT=development` | the emails this isolate "sent" (as the admin's `/api/dev/mailbox`) |
| `/portal/*` anything else | assets layer | the SPA |
| `/api/admin/applications/:id/files/...` | `sakem-admin` | the admin's side of the private files |

The admin Worker's `/api/*` and the portal Worker's `/portal/api/*` have no route in common. There is no `/api` on the apex at all after M4 ([section 6.6](#66-what-happens-to-the-pass-through-of-cfweb)).

### 6.2 Cookies and the two audiences

| | Admin (`admin.` host) | Portal (apex) |
| --- | --- | --- |
| Cookie name, production | `__Host-better-auth.session_token` | `__Host-sakem-student.session_token` |
| Cookie name, development and tests | `better-auth.session_token` | `sakem-student.session_token` (cookies on `localhost` ignore the port, so two names keep the two dev servers from signing each other out) |
| Attributes | host-only, `Secure`, `Path=/`, `HttpOnly`, `SameSite=Lax`, 7 days refreshed daily | the same |
| Signing secret | `BETTER_AUTH_SECRET` of `sakem-admin` | a **different** `BETTER_AUTH_SECRET` on `sakem-portal` |
| Who may use the data routes | admins by role and area | `role = student` only; any other role is `403 student_only` |

Why two names and two secrets although the hosts already differ: the sessions are rows of one `session` table, and a token valid for one audience must not be valid for the other even if a cookie were copied, planted or sent to the wrong Worker by a future routing mistake; a value signed with the other secret is refused. It costs nothing at runtime.

`__Host-` requires `Path=/`, so the browser sends the portal cookie to every path of the apex, including the public pages. The web Worker never reads it, the public pages never set a cookie, and the Cache API keys on the URL, so nothing about public caching changes; the only cost is about 150 bytes on each request to the apex. The cookie is never visible to `admin.` or any other subdomain, and the admin's never to the apex.

**Origin and CSRF.** The same `sameOriginGuard` runs on every write to `/portal/api/*` (the apex's own origin is trusted, `TRUSTED_ORIGINS` stays unset). Note that `admin.<domain>` is **same-site** with the apex, and the guard refuses `Sec-Fetch-Site: same-site`: a page on the admin host cannot post to the portal API, nor the reverse. **CORS: none.** No `Access-Control-*` header is sent by either Worker and there is no `OPTIONS` handler: the portal SPA, the API and the web Worker's navbar calls are all same-origin.

**Google.** The callback is `https://<apex>/portal/api/auth/callback/google`, to be registered as an authorized redirect URI (the admin's is `https://admin.<domain>/api/auth/callback/google`). Two separate OAuth clients (one per Worker) keep a leaked portal secret away from admin sign-in; one client with two URIs works too. Google stays optional (off until both variables exist) and the verified-email rules of [`auth.md`](auth.md#account-linking) apply unchanged.

### 6.3 Turnstile and rate limits

Authenticated routes are limited by **user id**, never by address or email (a school or a warnet shares an address). The auth routes keep the table of [`auth.md`](auth.md#public-auth-routes), including Turnstile and the per-mailbox cap; `resend-verification` finally gets its page (register-success state and the unverified-sign-in message).

| Route | Turnstile (`data-action`) | Limiter (binding, numbers, key) |
| --- | --- | --- |
| `POST /portal/api/auth/register` | `register` | `RL_REGISTER` 10/60 s by address; `RL_MAIL_TARGET` 3/60 s by mailbox |
| `POST /portal/api/auth/sign-in/email` | `login` | `RL_LOGIN` 5/60 s; `RL_LOGIN_ACCOUNT` 20/60 s |
| `POST /portal/api/auth/request-password-reset` | `forgot-password` | `RL_RESET` 5/60 s; `RL_MAIL_TARGET` |
| `POST /portal/api/auth/send-verification-email` | `resend-verification` | `RL_VERIFY_RESEND` 2/60 s; `RL_MAIL_TARGET`; `RL_RESET` |
| reset, verify, social sign-in, callback | none | `RL_TOKEN` 20/60 s by address |
| `PUT .../steps/:step` | none | `RL_PORTAL_SAVE` 30/60 s by user |
| `PUT` and `DELETE .../files/...` | none | `RL_PORTAL_UPLOAD` 20/60 s by user |
| `POST .../submit` | none | `RL_PORTAL_SUBMIT` 3/60 s by user (legacy: 3 per 5 minutes; a binding allows 10 or 60 s only) |
| `GET` of the draft, overview, status, own files | none | `RL_PORTAL_READ` 60/60 s by user |
| admin `GET .../files/:fileId` | none | `RL_ADMIN_FILE` 120/60 s by admin id (on `sakem-admin`) |

The new bindings are declared by P1a (placeholder namespace ids, like the existing ones) and added to `RATE_LIMITS`; the test that compares `RATE_LIMITS` with the wrangler files covers them. As built: the four `RL_PORTAL_*` are declared in both configs (the Worker suite runs every limiter against Miniflare's real binding in the admin's config) and `RL_ADMIN_FILE` in `wrangler.jsonc` only; the portal's own config also carries its copies of the seven auth limiters, with namespace ids of its own (`80xx`, against the admin's `78xx` and its staging block's `79xx`: ids are per account, so a range already taken in the account cannot be reused), the same limiters and variables are written out again in the admin's `env.staging` block (a test of the staging block keeps the two the same), and a test (`test/portal-foundation-config.test.ts`) keeps the numbers equal and the ids distinct. The limiter runs right after the session is read (its key is the user id) and before the body is read or any other D1 or R2 access; in production a missing binding is a 503, as for the existing ones.

### 6.4 Headers on API responses

Every `/portal/api/*` answer: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. File answers add the headers of [section 8.6](#86-reading-a-file).

### 6.5 Who may call what

| Audience | Portal API | Admin API |
| --- | --- | --- |
| Not signed in | `config`, the auth routes | `config`, the auth routes |
| Student | everything under `/portal/api/*` that is theirs | nothing (403) |
| Admin account on the apex | `me` and the auth routes; data routes answer `403 student_only` | nothing (its session is on `admin.`) |

### 6.6 What happens to the pass-through of `cf/web`

The web Worker no longer forwards the signed-in and auth surface. In **P2's cf/web part** (`cf/web/src/lib/legacy-paths.ts`, `redirects.config.mjs`, `src/middleware.ts`, `src/components/Navbar.astro`, `src/lib/sitemap.ts`, the tests):

**Removed from `LEGACY_PATHS`:** `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/portal`, `/admin`, `/api`.

- `/login`, `/register`, `/forgot-password`, `/reset-password` and `/verify-email` become static 308 redirects in `redirects.config.mjs` to `/portal/login`, `/portal/register`, `/portal/forgot-password`, `/portal/reset-password` and `/portal/verify-email` (answered by the assets layer, no Worker request; the incoming query is dropped, which is fine: legacy tokens are not valid in the new system).
- `/portal` is removed because the routing layer gives it to `sakem-portal`; in production the web Worker never sees it.
- `/admin` and `/admin/*` become a middleware redirect (308, path kept) to the admin host, from a public variable `ADMIN_URL`.
- `/api` is removed. The web Worker answers `/api/*` with its own 404, except the one endpoint its navbar needs, below.
- **Kept until the cutover (M5):** `/_next`, `/blog/images`, `/images`, `/files`, `/reports`, `/resources`.
- The shortlink slugs `portal`, `login`, `register`, `forgot-password`, `reset-password`, `verify-email`, `admin` and `api` stay **reserved** (`cf/admin/src/shortlinks/reserved.ts`); `tests/shortlink-reserved.test.ts` must derive them from a `PORTAL_OWNED_PATHS` list instead of the legacy list it reads today.
- `ROBOTS_DISALLOW` gains `/portal`.

**The navbar's two calls.** The inline script of `Navbar.astro` calls `GET /api/auth/session` and `GET /api/announcements/current` and keeps each answer in `sessionStorage` (30 s signed out, 5 min signed in; the announcement 5 min). After M4 the first becomes `GET /portal/api/auth/get-session` (Better Auth's answer has `user.role`, the field the script reads): a role of `viewer`, `editor` or `super_admin` makes the button "Dashboard" and links it to `ADMIN_URL`; any other signed-in user gets "Portal" (`/portal`); "Masuk" links to `/portal/login`. Signed out it costs one Worker request per visit and no D1 read (Better Auth returns `null` when there is no cookie). The announcement call is **not part of M4 and has no owner today**: the public API has `GET /api/public/announcements/current` behind the `API` binding, so the web Worker needs a small `/api/announcements/current` endpoint of its own with a cache. It is listed for SAKEM-084 (cutover); without it the strip stays empty (a missing strip, not an error).

**Free-tier cost.** Section 10. **Risk.** The two-secrets arrangement is operational: the deploy ticket must set two different secrets and say so in the runbook; a test of the Worker cannot see the deployed secrets.

## 7. D5 Data model

### 7.1 States

The legacy statuses are exactly four (`lib/application-status.ts`, `applicationStatus` in the schema): **`pending`, `under_review`, `accepted`, `rejected`** (admin labels "Pending", "Dalam Review", "Diterima", "Ditolak"; the portal words are "Menunggu hasil", "Diterima", "Belum lolos"). There is **no `waitlist` and no `revoked` status**, in the legacy or here: a revocation is an admin moving `accepted` to `rejected` with a note of at least 20 characters, logged as `application.revoke` ([`admin-pendaftaran.md`](admin-pendaftaran.md#pendaftar)). The admin may set any status from any other (no state machine in the legacy code). What this milestone adds is only the **draft**, which is not a status.

| State | Lives in | The student sees | Written by |
| --- | --- | --- | --- |
| none | no row | "Mulai daftar" while a batch is open | |
| **draft** | a row of `application_drafts` (new) | the wizard, resumed where they left | the student, per saved step and per file |
| **submitted** | a row of `student_applications`, status `pending` (the draft is deleted in the same transaction) | "Pendaftaran kamu sudah kami terima"; the result is `processing` | the submit |
| `under_review` | the same row, set by an admin | the same as submitted | the admin |
| `accepted`, `rejected` | the same row, with a review note, set by an admin | `processing` **until the batch's `results_published_at` is set**, then the verdict | the admin |

After submitting, an application is **final for the student** (the legacy had no edit and no withdrawal; neither is added, open decision 13). The privacy contract of [`docs/architecture/student-portal.md`](../architecture/student-portal.md) is enforced **in the API**, not only in the screen: before the batch's results are published the status endpoint does not send the status, the review notes or the review time at all ([`portal-api.md`](portal-api.md#10-status-and-the-privacy-contract)).

### 7.2 The "no open batch" gate

An open batch is the one with `opens_at <= now < closes_at` (the latest `opens_at` if several, as the legacy `getCurrentOpenBatch`), read with `ORDER BY opens_at DESC LIMIT 1` on the existing `admission_batches_opens_at_idx`, which stops at the first row that fits: two or three rows read in the usual case. The server's clock decides; the client only counts down from a `now` the API returns.

It is checked on every call that **changes** something (a step save, a file upload, replace or delete, the submit) and shown by the two that start a session (`overview`, `applications/current`). Reads of a submitted application's status and of one's own files are not gated. Without an open batch: `overview.openBatch` is `null`, `current` answers `gate: "no_open_batch"`, and a write answers `409 no_open_batch` with the legacy sentence ("Belum ada batch pendaftaran yang dibuka. Silakan kembali saat pendaftaran berikutnya diumumkan."). A draft whose batch has closed since stays readable but cannot be saved or submitted (`409 batch_closed`); it is removed by the retention job ([section 8.9](#89-retention-and-deletion-proposal)).

### 7.3 The draft, per-step saving, and local persistence

- **A draft is a row**, `application_drafts`, one per student per batch, holding `form_data` (a JSON object with one key per bucket: `identity`, `household`, `housing`, `organizations`, `documents`, `marketing`, `interview`) and the step the student was on. Its **`id` is allocated at the first save and becomes the application's `id` at submit**, so the files, which reference that id, never have to be touched at submit.
- **Only a complete, valid step is saved to the server.** `PUT /portal/api/applications/current/steps/:step` runs the whole step schema (the legacy zod rules and messages) and stores the bucket; an invalid step is a `400 invalid` with `fields` and nothing is written. What is half typed stays in the browser. The reason: partial schemas would be a second copy of every rule, and the server would hold unvalidated text about minors. The cost: leaving a step half filled and continuing on another device loses that step's typing (the saved steps travel). Open decision 11.
- **A step save replaces that bucket only**, so two tabs saving different steps cannot overwrite each other; two saves of the same step are last write wins, with no `ETag` (the CRUD kit's concurrency control is for records two admins edit; a student edits their own).
- **Local persistence** (the legacy wizard had only this): `localStorage` under `sakem-portal:v1:<user id>:<batch id>` (the legacy key held the **email**; the id carries no personal data), holding the values of every step including the one being typed, the step index, the visited steps and a timestamp (`savedAt`, epoch milliseconds, **required**: a stored copy without a numeric one is purged because it cannot be aged), written on every change. The shape, the key and these rules are in the shared module (`shared/application-form/draft.ts`: `LocalDraft`, `localDraftKey`, `readLocalDraft`, `writeLocalDraft`). On load the saved server steps win unless the local copy of a step is newer and different, in which case it is kept and marked "belum disimpan" until the student saves it. It is **removed** at sign-out, after submit, when the API answers 401, `no_open_batch`, `batch_closed` or already submitted, and when older than 30 days. File bodies are never stored locally. A shared computer (a warnet) keeps the typing of the last student until they sign out: the wipe rules reduce that and do not remove it (open decision 11 asks whether `sessionStorage` is preferred).
- **The submit** reads the saved buckets, validates all of them again in the legacy order (identity, household, housing, organizations, documents, marketing, interview), checks that every required file slot has a file, and in one `db.batch` inserts the application (`id` = the draft's), writes the `application.submit` audit row and deletes the draft, guarded so a draft changed or already gone makes the insert insert nothing and the rest do nothing. It needs a verified email (defence in depth: an unverified student cannot sign in at all), an open batch, no application for this batch, and the legacy anti-duplicate rule (the same WhatsApp number within the last hour). A `student_applications.form_data` written now has **`formVersion: 3`**: the same buckets as version 2, except that `documents` holds only `dtksRegistered` and `marketing` only `instagramUsername`, because the documents are files, not links; version 2 rows (none in production, dummy data only) stay readable by the admin screen.

### 7.4 One application per student per batch

The existing unique index `(user_id, batch_id)` on `student_applications` stays; the drafts table has the same one. The draft insert is `INSERT ... WHERE NOT EXISTS (an application of this student for this batch)`, so a student who submitted cannot open a second draft; a second submit (double click, two tabs) finds no draft and answers `409 already_submitted`, and the unique index is the last line.

### 7.5 Migration `0013_portal_applications` (owned by P1a)

One migration for every table of the portal, so the numbering cannot collide between workers ([section 11](#11-work-breakdown)). Production holds dummy data only, so **no data migration**; the tables are new and `student_applications` is unchanged (the version 3 `form_data` is application code and the version number, not a schema change). Conventions as [`d1-schema.md`](d1-schema.md#conventions): text UUID ids made in the app, epoch-millisecond integers, enums as `CHECK`, JSON as text with `json_valid`.

**`application_drafts`**

| Column | Definition |
| --- | --- |
| `id` | text primary key; becomes `student_applications.id` |
| `user_id` | text not null, foreign key `users(id)` **on delete cascade** |
| `batch_id` | text not null, foreign key `admission_batches(id)` **on delete restrict** (a batch with drafts cannot be deleted; the admin's existing foreign-key-to-409 mapping answers `in_use`) |
| `form_data` | text not null default `'{}'`; `json_valid` and `json_type(form_data) = 'object'` and `length(form_data) <= 98304` (a step body is at most 32 KiB, an interview of six 2,000-character answers with multi-byte characters can pass 16) |
| `last_step` | text, nullable, `CHECK` in the seven bucket names |
| `created_at`, `updated_at` | integer ms, default now |
| Index | `UNIQUE (user_id, batch_id)` |

**`application_files`**

| Column | Definition |
| --- | --- |
| `id` | text primary key; also the object name in R2 |
| `application_id` | text not null. The draft's id and later the application's id (the same value). **No foreign key**: it refers to one table or the other depending on the state, and SQLite cannot express that. Integrity is kept by the insert (`INSERT ... SELECT ... WHERE EXISTS (the draft of this student, still editable)`) and by the retention job's orphan sweep |
| `slot` | text not null, `CHECK` in the sixteen slot names of section 8.2 |
| `content_type` | text not null, `CHECK` in `image/png`, `image/jpeg`, `image/webp`, `application/pdf` (from the sniffed bytes) |
| `size` | integer not null, `CHECK size > 0 AND size <= 10000000` |
| `width`, `height` | integer, nullable, both or neither, positive (images only) |
| `checksum` | text not null, 32 hex characters: the MD5 R2 returns for the object (an integrity check, not a security one) |
| `created_at` | integer ms (the upload time) |
| `deleted_at` | integer ms, nullable: set when the student removes or replaces the file, or the retention job purges it; the row is deleted once the R2 object is gone |
| Index | `(application_id, slot)` (the file list and the per-slot count) |

No client file name is stored anywhere (data minimisation: a name can hold a person's name; the slot says what the file is).

**`private_storage`**: one row, `id text primary key CHECK (id = 'private-files')`, `bytes integer not null CHECK (bytes >= 0)`, `files integer not null CHECK (files >= 0)`, `updated_at`; the migration inserts the row with zeros. It is the hard budget guard of section 8.3 (a counter updated in the same batch as the file row), reconciled daily by the cron.

**`email_daily`**: `day text primary key` (UTC `YYYY-MM-DD`), `sent integer not null CHECK (sent >= 0)`. The send counter of section 9.2.

**Risk.** `0013` is new tables only: it cannot fail on existing data; `pnpm db:drift` and a run of all fourteen migrations on a clean local D1 are the gates. (It was written as `0012` and renumbered to `0013` when SAKEM-090 took `0012` for `blog_posts.meta_description`; the two share no table, so the order they are applied in does not matter.) A later change to a `CHECK` (a new slot) is a table rebuild: slots are therefore fixed by this document and changed only through a migration.

### 7.6 Row budgets

Paper estimates, with the arithmetic of [section 10](#10-cost-and-limits-of-the-hot-paths): one applicant's whole wizard session is about **25 Worker requests, 500 D1 rows read and 100 written**; one visit to the status page is about 10 rows read and none written. A row written counts the table row plus one per index entry, as [`d1-schema.md`](d1-schema.md#free-tier-headroom-estimate) counts.

## 8. D6 Private file storage

### 8.1 The bucket

- A bucket of its own, placeholder name **`sakem-private`**, bound as **`PRIVATE_FILES`** on `sakem-portal` (put, get, delete) and `sakem-admin` (get, and delete for the retention job). R2 gives a binding the whole bucket: the portal cannot be given "write only", so the code paths are the access control.
- **Never a public domain, never `r2.dev`.** A bucket is private by default and becomes public only by an explicit action in the dashboard; the owner step is to confirm it stays that way ([section 12](#12-before-go-live)). The public bucket `sakem-files` (`UPLOADS`, [`uploads.md`](uploads.md)) is never used for an applicant's file, and the admin upload API has no kind for one: a test fails if `PRIVATE_FILES` appears in `src/uploads/` or `UPLOADS` in `src/private-files/`.
- **Keys have no user-controlled part:** `applications/<batch year>/<application id>/<file id>.<ext>`: the year from the batch row, both ids server-made UUIDs, the extension from the sniffed type (`png`, `jpg`, `webp`, `pdf`). The development route `GET /uploads/*` of the admin Worker serves only keys of the public shape and answers 404 for these (a negative check pins it).

### 8.2 The slots: the legacy documents and marketing steps

Each legacy link field becomes a **slot**. Where the legacy said "make one PDF" (several photos, three months of bills) a slot now takes several files, which is the point of uploading from a phone. The `*Url` fields of `formData.documents` and `formData.marketing` disappear from version 3. The authoritative copy of this table is [`portal-api.md`](portal-api.md#111-the-slots-authoritative) (the code is `shared/application-form/slots.ts`); it is repeated here to be read with the reasoning.

| Slot | Legacy field | Label (legacy wording) | Required | Max files |
| --- | --- | --- | --- | --- |
| `father-income` | `fatherIncomeUrl` | Surat Keterangan Penghasilan Ayah | no | 1 |
| `mother-income` | `motherIncomeUrl` | Surat Keterangan Penghasilan Ibu | no | 1 |
| `other-earner-1-income` | `otherEarner1IncomeUrl` | Surat Penghasilan Anggota Keluarga Lain (1) | no | 1 |
| `other-earner-2-income` | `otherEarner2IncomeUrl` | Surat Penghasilan Anggota Keluarga Lain (2) | no | 1 |
| `debt-proof` | `debtProofUrl` | Bukti Hutang | no | 3 |
| `electricity-bill` | `electricityBillUrl` | Tagihan/Token Listrik 3 Bulan Terakhir | yes | 3 |
| `family-card` | `familyCardUrl` | Scan Kartu Keluarga | yes | 2 |
| `parent-permission` | `parentPermissionUrl` | Surat Izin Orang Tua (bermaterai) | yes | 2 |
| `self-photo` | `selfPhotoUrl` | Foto Diri (images only) | yes | 1 |
| `dtks` | `dtksUrl` | SKTM terdaftar DTKS | yes **if** `dtksRegistered = "ya"` | 1 |
| `house-photos` | `houseImagesUrl` | Foto Rumah: depan, ruang tamu, kamar mandi | yes | 6 |
| `vehicle-photos` | `vehicleImagesUrl` | Foto Kendaraan yang ada di rumah (or the statement of having none) | yes | 6 |
| `marketing-follow-proof` | `instagramFollowProofUrl` | Bukti Follow Instagram @sakolakembara | yes | 1 |
| `marketing-broadcast-proof` | `broadcastProofUrl` | Bukti Share Poster + Broadcast ke 3 Grup WhatsApp | yes | 4 |
| `marketing-twibbon-proof` | `twibbonUploadUrl` | Bukti Upload Twibbon di Feed Instagram | yes | 1 |
| `marketing-story-proof` | `storyUploadUrl` | Bukti Share Poster di Story Instagram | yes | 1 |

Sixteen slots, 10 required (11 with DTKS), 35 files at most. The drive-link instructions and the file naming hints of the legacy steps ("Format nama file: NamaLengkap_Cabang_KK", "Setiap link Google Drive harus bisa diakses siapa saja") do not apply to uploads and are replaced; the new wording is part of open decision 5.

### 8.3 Types, limits, and the storage arithmetic

- **Accepted, from the bytes** (`src/uploads/sniff.ts`, reused as is): PNG, JPEG, WebP and PDF; `self-photo` takes images only. No GIF, SVG, AVIF, Office files or archives. The client's `Content-Type` and file name are never read. An image is at most 10,000 pixels a side and 50 megapixels.
- **Per file 10 MB** (decimal, as the admin's kinds), **per application 40 files and 100 MB** of live files. A phone photo is 2 to 6 MB; a scanned page 0.3 to 3 MB; the largest legitimate file is the PDF of three months of bills.
- **The Free request body limit is 100 MB** and a Worker has **128 MB** of memory ([section 3.1](#31-what-cloudflare-documents)), so a 10 MB body is far from the limit; what matters is memory when several students upload at once, which is why the body is streamed ([section 8.4](#84-uploading-a-file)).
- **A hard storage budget**: `PRIVATE_FILES_BUDGET_BYTES` (proposed 8,000,000,000, under the 10 GB-month free) is checked against the `private_storage` counter with one atomic `UPDATE ... WHERE bytes + :size <= :budget` **before** the bytes are written; an upload over the budget is `503 storage_full`. R2 charges $0.015 per GB-month beyond the free 10, rounded up, so an overshoot costs cents, not dollars, but the epic's target is $0 and the guard keeps it so.
- **Client-side compression is part of the design.** The wizard re-encodes an image to JPEG (long side at most 2,000 px, quality about 0.85) in the browser before it is sent. This is not enforceable on the server (the server accepts whatever passes the checks), it is a service to the student's data plan and to the budget, and it **strips the EXIF and GPS data** of the original ([section 8.10](#810-what-is-not-protected-and-what-to-do-about-it)). PDFs are sent as they are. `accept` on the file input lists explicit types (`image/jpeg,image/png,image/webp,application/pdf`, never `image/*`), so an iPhone converts HEIC to JPEG instead of offering a format the server refuses.

| Scenario (assumptions in italics) | Per applicant | 300 applicants a year | Against 10 GB |
| --- | --- | --- | --- |
| *14 files of 0.8 MB, compressed in the browser* | 11 MB | 3.4 GB | 3 seasons fit |
| *14 files of 3 MB, as a phone makes them* | 42 MB | 12.6 GB | **does not fit in the first season** |
| *the same, 30% accepted, the rest deleted 90 days after the results, compressed* | 11 MB | about 1 GB kept per season plus 3.4 GB in flight | about 5 seasons |
| *plus half the accounts that start and never submit: 150 drafts of 4 files* | 3 MB | 0.5 GB | deleted 30 days after the batch closes |

*300 submitted applications a year is the estimate of [`d1-schema.md`](d1-schema.md#free-tier-headroom-estimate) (about 900 after three years); the acceptance rate is an assumption nobody has measured.* Reading: **without compression and a retention policy the 10 GB is spent in the first or second season; with both it lasts years.** Class A operations (puts) are 14 to 35 per applicant, about 4,200 to 10,500 a season against 1,000,000 a month; Class B (gets) about 100 per applicant, 30,000 a season against 10,000,000 a month.

### 8.4 Uploading a file

`PUT /portal/api/applications/current/files/:slot` with the **raw file as the request body** (`Content-Length` required; `Content-Type` is ignored). Not multipart. The admin's upload parses a multipart body in memory (and its document lists the parse of the 20 and 25 MB kinds as the CPU risk to watch); that is acceptable for a few admins and wrong for a public endpoint used by hundreds of children on slow networks, where several 10 MB bodies in one isolate (the body, the parsed copy, the `Blob`) would press on the 128 MB of memory. A raw body costs about 1 MiB of head plus the chunks in flight, whatever the file size.

The order, cheapest first, with nothing but the session read before the limiter (the full status table is in [`portal-api.md`](portal-api.md#11-file-routes-student)):

1. session, role `student`, verified email; `RL_PORTAL_UPLOAD`;
2. the slot exists; `Content-Length` is present, positive and at most 10 MB (`411`, `413`);
3. one D1 read of the draft (the student's own, in an open batch, not submitted) and the counts for the slot and the application; the slot is not full; the application is within 40 files and 100 MB;
4. reserve the bytes in `private_storage` (`503 storage_full` over the budget);
5. read the first 1 MiB (`SNIFF_WINDOW`) from the body and run `sniff()`; unknown type, a type the slot refuses, a damaged header, absurd dimensions are refused before a byte is stored;
6. build the key, then `PRIVATE_FILES.put(key, stream, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: <sniffed>, cacheControl: "private, no-store" }, ssecKey })`, with the head and the rest of the body joined into a `FixedLengthStream` of the declared length (a body shorter or longer than declared makes the put fail: nothing is stored);
7. one `INSERT ... SELECT ... WHERE EXISTS (the draft is still editable)` of the file row with the MD5 R2 returned, and the counter adjustment, in a batch; if it fails the object is deleted and the reservation released.

`?replace=<file id>` makes the new file and the removal of the old one one step: the insert and the soft delete of the old row in one batch, then the old object is deleted (and the counter adjusted). A client that aborts should leave nothing: a put whose stream ends before the declared length fails and stores no object (P4 proves it in workerd, risk (b) below; real R2 is SAKEM-084's).

### 8.5 Removing a file

`DELETE /portal/api/applications/current/files/:fileId`, only while the application is a draft in an open batch and only the student's own. The row is marked `deleted_at`, the object is deleted, then the row is removed; if the object delete fails the row stays marked and the daily cron retries. R2 deletes are free operations.

### 8.6 Reading a file

**Always through a Worker, after an authorization check. There is no URL that works without a session.**

| Reader | Route | Rule |
| --- | --- | --- |
| The student | `GET /portal/api/files/:fileId` | the file belongs to the student's own draft or application, in any batch (any other id, or another student's, is `404`, never `403`); not deleted |
| An admin | `GET /api/admin/applications/:id/files/:fileId` | `requireArea("pendaftaran", "write")`: an editor with the `pendaftaran` grant or a super_admin; the file belongs to application `:id`; not deleted; one audit row per open; `RL_ADMIN_FILE` |

**The viewer.** A `viewer` reads every area except Sistem, but these are documents of minors: scans of the Kartu Keluarga (national ID numbers of the parents and siblings), income letters and photographs of a child and a home. The recommendation is that **a viewer sees what files an applicant has (the list: slot, count, size, type) but cannot open them**: opening needs `pendaftaran` write. The viewer already reads the applicant's address, income and answers; the scans add identity numbers and faces. **Decided 2026-10-13: no** (open decision 1, [section 13](#13-open-decisions-for-dzul)): a viewer sees the list and cannot open a file.

**Response headers** (both routes): `Cache-Control: private, no-store`; `X-Content-Type-Options: nosniff`; `Content-Type` from the stored, sniffed type; `Content-Disposition`: **`inline` for images, `attachment` for PDFs**, with a filename built from the slot and the file id (`family-card-1a2b3c4d.pdf`), never from anything the client sent; `Content-Security-Policy: default-src 'none'; sandbox`; `Cross-Origin-Resource-Policy: same-origin`; `Content-Length`. No `Range`, no conditional requests: every read is a full `200`. The body is the R2 stream, passed through (no buffering).

**The audit row of an admin open:** action `application_file.view`, resource type `application_file`, resource id the file id, metadata `{ applicationId, slot }`: **ids only**, never a name, a size or a file name. It is written in the same request, before the body is streamed; if it cannot be written the file is not served (accountability before convenience). The Aktivitas screen needs the two labels and the declared lists (`src/audit/lists.ts`, `spa/src/lib/audit.ts`); the student's reads and uploads are not audited (the file rows are their record, and an audit row costs 8 D1 rows).

**The screens never load a file by themselves.** The wizard shows type, size and a "Lihat" link for a stored file (the preview of a file just picked comes from the browser's memory); the admin's detail page lists the files with "Lihat" and loads nothing until it is clicked. That keeps the Worker requests down (an automatic thumbnail per file is a request, an R2 read and, for an admin, 8 D1 rows) and makes each audit row a deliberate view.

### 8.7 Encryption

> **Decided 2026-10-13: no SSE-C** (open decision 3, [section 13](#13-open-decisions-for-dzul)). The foundation declares no `PRIVATE_FILES_KEY` (not in `env.ts`, not in a wrangler config, not in `dev.vars.example`) and a test fails if one appears; the file routes pass no key to R2 and `storage_unavailable` means only a missing bucket binding. The paragraph below is kept as the record of the proposal; the code of the file routes (P4) follows the decision, and go-live item 2 of [section 12](#12-before-go-live) falls away.

R2 encrypts every object and its metadata at rest (AES-256-GCM, keys managed by Cloudflare) and all transfers in transit, with nothing to configure. On top of that this design proposes **SSE-C**, which the Workers binding supports (`ssecKey` on `put` and `get`): the Worker keeps a 32-byte key as the secret `PRIVATE_FILES_KEY` (on both Workers), and an object is readable only with it. What it buys: if the bucket were ever exposed by a mistake (a custom domain or `r2.dev` enabled, a leaked R2 token), the bytes would still be unreadable. What it costs: **losing the key loses every file** (Cloudflare cannot recover them), the key must be backed up outside Cloudflare before the first upload, and rotating it means rewriting every object (not planned). In production a missing key is a configuration error: file routes answer `503 storage_unavailable`, as email and Turnstile fail closed. Open decision 3.

### 8.8 What changes in the admin's Pendaftar detail

The screen exists (`spa/src/pages/applications/*`, `src/api/applications.ts`). Exactly:

- **API.** `GET /api/admin/applications/:id` gains `formVersion`, `files` (`[{ id, slot, contentType, size, width, height, uploadedAt }]`, live files only, one more statement in the same round trip) and `canOpenFiles` (the caller's right, [8.6](#86-reading-a-file)); the new route `GET /api/admin/applications/:id/files/:fileId`. The list endpoint is unchanged.
- **`answers.ts` and the page.** For `formVersion` 3 the section "Tautan berkas" becomes **"Berkas"** and "Bukti Marketing" becomes the marketing slots plus the Instagram username: one row per slot (label from `shared/application-form/slots.ts`), showing the count and total size and, when `canOpenFiles`, a "Lihat" link per file (a new tab, `rel="noopener"`); for a viewer the row says the files can be opened only by the Pendaftaran team. A missing required slot shows "—". Version 2 applications keep the link rendering they have today (no such row exists in production). A new `FilesSection.tsx` draws it; `model.ts`, the mock (`spa/src/mock/resources/pendaftaran.ts`) and the tests follow.
- **`ReviewPanel.tsx`** gets one sentence if open decision 9 is accepted ("Catatan ini dibaca siswa setelah hasil diumumkan").
- Nothing else of Pendaftar changes: the list, the filters, the prefix search, the review rules, the batch screens and the dashboard count only submitted applications, exactly as today.

### 8.9 Retention and deletion (proposal)

> **Decided 2026-10-13: no automatic deletion** (open decision 2, [section 13](#13-open-decisions-for-dzul)). The retention job below is **not built**: it is replaced by a **manual purge action**, in the admin's Pendaftar detail, for an editor with the `pendaftaran` grant or a super_admin, with a confirmation and an audit row (ids and counts only), plus a runbook for a family's request to delete. What the foundation (P1a) did about it: the three variables are declared on `sakem-admin` only, at `0` (never delete), and no code reads them; there is no table for retention (the storage counter and the email counter of the budgets stay). The table is kept as the list of cases a person may purge by hand, and the numbers as the proposal that was declined. P4 rewrites this section and the purge action's contract ([`portal-api.md`](portal-api.md) 12.3).

Children's documents should not outlive the need. The existing daily Cron Trigger of `sakem-admin` (03:17 UTC) gets a second job next to the audit and session cleanup, bounded like the first (at most 200 files per run, R2 `delete` takes up to 1,000 keys, one log line with counts only). **Variables:** an empty, zero, negative or unreadable value means **keep** (an unreadable setting never deletes), as `AUDIT_RETENTION_DAYS` does.

| What | When it is deleted | Variable | Proposed |
| --- | --- | --- | --- |
| Orphans: file rows whose application id is in neither table, rows marked deleted whose object is still there | the next run | none | always |
| A draft and its files, of a batch that has closed | N days after `closes_at` | `DRAFT_RETENTION_DAYS` | **30** |
| The files of a `rejected` application (a revoked one counts) | N days after the later of `results_published_at` and `reviewed_at` | `REJECTED_FILES_RETENTION_DAYS` | **90** |
| The files of an `accepted` application | N days after `results_published_at` | `ACCEPTED_FILES_RETENTION_DAYS` | **off until Dzul decides**; recommended 365 (the LMS does not need the application documents) |
| The answers (`form_data`, WhatsApp, address) of a rejected applicant | not in M4 | | recommended: clear after 2 years, a later ticket |
| On a family's request, or when a student's account is deleted | by hand, by a documented command | | a runbook before go-live ([section 12](#12-before-go-live)) |

Each purge writes **one audit row per application** (`application_files.purge`, resource type `application`, metadata `{ reason, count }`, actor `system`), so deletion is as accountable as viewing. Open decision 2.

### 8.10 What is not protected, and what to do about it

| Not protected | Why | Recommended mitigation |
| --- | --- | --- |
| **No virus or malware scan** | Workers cannot run a scanner and nothing in the Free plan offers one | Only PNG, JPEG, WebP and PDF are accepted, by their bytes; PDFs are served as `attachment` with a sandboxing CSP and never rendered by our pages; the admin guidance (in the runbook) is to open a PDF in a patched viewer. A scan outside Workers is a later option |
| **EXIF and GPS data in a file the server receives** | stripping needs a re-encode, which the Free CPU does not allow | the browser re-encodes images before upload ([8.3](#83-types-limits-and-the-storage-arithmetic)), which drops the metadata; a client that skips it can only expose its own data, and only an authorized admin can ever open it |
| **PDF contents** (scripts, links) are not inspected beyond the header | as above | the same: attachment, no inline rendering |
| **A stolen student session** can read that student's own files | it is their account | host-only cookie, 7 days, `no-store`, rate limits; the files are not auto-loaded |
| **A stolen admin session** with `pendaftaran` write can open files | it is their account | every open is audited with the admin's id; `RL_ADMIN_FILE` bounds bulk copying to 120 a minute |
| **Bucket exposed by a dashboard mistake** | configuration | no public domain by design, the owner check at go-live, and SSE-C if accepted |
| **The R2 token or Worker secrets leak** | operations | the CI token is scoped and held by Dzul ([`account-setup.md`](account-setup.md)); SSE-C keeps the bytes unreadable without the Worker secret |

**Free-tier cost.** Storage and operations: [8.3](#83-types-limits-and-the-storage-arithmetic) and [section 10](#10-cost-and-limits-of-the-hot-paths). CPU: the sniff reads at most 1 MiB and runs in microseconds (measured for the admin: median 1 microsecond in Node); the stream is I/O. **Risk.** (a) The 10 GB: the guard, the compression and the retention above. (b) The streaming put is new code (the admin uses `put(File)`): P4 proves it in workerd with a 10 MB body, a body shorter than declared, a body longer than declared and an abort. (c) What nothing here can test is the real R2: the conditional put, the SSE-C round trip and the real stream behaviour, until SAKEM-084.

## 9. D7 Emails

### 9.1 Which emails the portal sends

Everything goes through the existing Resend module (`src/email/`), Indonesian, "kamu", the legacy voice; subjects are constants and a user-supplied value is HTML-escaped and never in a subject.

| Email | Sent when | Origin | Blocking? |
| --- | --- | --- | --- |
| **Verifikasi email Sakola Kembara** (24 hours) | registration; a correct password on an unverified account; "kirim ulang" | legacy copy ([`auth.md`](auth.md#email)) | yes |
| **Reset password akun Sakola Kembara** (30 minutes) | "lupa password" | legacy copy | yes |
| **Kamu sudah punya akun Sakola Kembara** | registration with an address that already has an account | new in PR #49 | yes |
| **Pendaftaran Sakola Kembara kamu sudah kami terima** (the confirmation) | after a successful submit | **new**: the legacy sent none (its code comment mentions confirmations, never written); the ticket lists "konfirmasi" | **no**, best effort |
| A publication notice ("hasil sudah diumumkan") | when a batch's results are published | new, **not built** | |

The confirmation says the batch name, the time received, that the result appears on the status page once the committee has assessed every applicant, and that nothing has to be resent; its one link is `<origin>/portal/status` (no token). It carries **no answer, no file and no document name**. Purpose label `application-received`; sent with `waitUntil` after the response; a failure is logged as the purpose and the reason only (no address) and never fails the submit.

**No publication email.** Publishing makes about 300 results visible at one moment, which is the privacy promise ("everyone at once, no rolling verdicts"). An email to every applicant would need 100 a day and three days, so the last would hear after the first: exactly what the batch rhythm exists to avoid. The announcement strip (Pengumuman, which exists and costs nothing) says the results are out. Open decision 6.

### 9.2 The Resend quota at the season peak

The free plan sends 100 a day and 3,000 a month, shared by the verification, reset, "account exists" and invitation emails and now the confirmation.

| Per applicant | Emails |
| --- | --- |
| verification at registration | 1 |
| a resend or a forgotten password (assumed 30% of them) | 0.3 |
| confirmation at submit | 1 |
| **Total** | about 2.3 |

*Assumptions, not measurements:* 600 accounts and 300 submissions a year (twice as many accounts as applications, as above). **A season** is about 600 × 1.3 + 300 = 1,080 emails, far below 3,000 a month. **A day** is the limit: an announcement that sends 150 people to register the same day needs 150 × 1.3 + 60 submissions = 255 emails, 2.5 times the allowance, and **the 101st person would never receive a link** because the anonymous flows answer the same for everyone and only log a provider failure ([`auth.md`](auth.md#email)): a silent failure for exactly the people who came on the busiest day. Google sign-in needs no email and is a way around it.

What this design adds (P1b, open decision 7):

1. **A daily counter** in `email_daily`, incremented before each send (`INSERT ... ON CONFLICT DO UPDATE ... WHERE sent < :limit RETURNING`, one row written per email). The confirmation is sent only while the day's count is below 80, so the last 20 are kept for verification and reset; at 100 the registration and resend routes answer `503 email_quota` with a global message ("Pendaftaran akun hari ini sudah penuh. Coba lagi besok, atau masuk dengan Google."). That answer is a function of the day, not of the address, so it does not break the no-enumeration rule. The counter also tells the admin, in a log line with the number, how close the day was.
2. The register page offers Google first when Google is on (no new mechanism, only the order of the existing button).
3. If the peak is expected to be above about 60 registrations a day, the owner decides between a paid Resend plan and announcing registration in waves; neither is built.

### 9.3 Fail-closed rules (unchanged, restated)

In production a missing `RESEND_API_KEY` or `EMAIL_FROM` is a `503 email_unavailable` **before** anything is created and before a Turnstile token is spent; no recipient, subject, body or link is ever logged; outside production without a key the message goes to the in-memory mailbox read through `GET /portal/api/dev/mailbox` (development only). The confirmation is the one email that does not fail the request, because the application is already saved and nothing depends on it.

## 10. Cost and limits of the hot paths

Free limits used: 100,000 Worker requests a day (account), 10 ms CPU per request, 50 subrequests per request, 128 MB memory; D1 5,000,000 rows read and 100,000 rows written a day; R2 1 million Class A and 10 million Class B operations a month, 10 GB-month. "Rows read" is `meta.rows_read` as the existing documents estimate it; a written row is the table row plus one per index entry. **Every number is a paper estimate for the design; the real ones are SAKEM-084's.**

| Hot path | Worker requests | CPU | D1 rows read | D1 rows written | R2 | Subrequests |
| --- | --- | --- | --- | --- | --- | --- |
| Status page: `GET /applications` | 1 | about 1 ms | about 10 (session 4, the applications and their batch) | 0 | 0 | 3 |
| Home: `GET /overview` | 1 | about 1 ms | about 11 (session 4, the gate 3, the applications 4) | 0 | 0 | 3 |
| Open the wizard: `GET /applications/current` | 1 | about 1 ms | about 26 (session, gate, draft, files up to 15) | 0 | 0 | 4 |
| Step save: `PUT /steps/:step` | 1 | 1 to 2 ms (parse one bucket, `JSON`) | about 8 | 1 (the first save of a draft: 3) | 0 | 4 |
| File upload, up to 10 MB: `PUT /files/:slot` | 1 | 1 to 2 ms plus the stream (I/O) | about 24 (session, gate, draft, counts, counter) | 4 (the file row 3, the counter 1) | 1 Class A | 8 |
| File delete | 1 | negligible | about 8 | about 5 | a free delete | 5 |
| Read one's own file | 1 | about 1 ms | about 10 | 0 | 1 Class B | 4 |
| Submit: `POST /submit` | 1 | 2 to 3 ms (seven schemas, the transformation, the JSON) | about 30 | about 20 (the application 8, the audit row 8, the draft 3, the email counter 1) | 0 | 6, plus one `fetch` to Resend |
| Admin opens a file | 1 | about 1 ms | about 10 (session, grants, the application and the file) | 8 (the audit row) | 1 Class B | 5 |
| Retention job, per run (cron, not a request) | 1 cron invocation | bounded by the chunk | about 600 | up to about 800 | up to 200 free deletes | under 50 by chunking |
| Register and sign-in (already built, for reference) | 1 | **PBKDF2 8.1 ms wall locally**: the route closest to 10 ms | 4 to 8 | 8 and 4 | 0 | 5 |

**One applicant's whole wizard session**, from the rows above: 1 (open) + 7 saves + 14 uploads + 2 refreshes + 1 submit = **25 Worker requests, about 500 rows read, about 100 rows written**, and 14 Class A operations.

**A peak day** (assumption: an announcement day with 150 registrations, 100 wizard sessions of which 60 submit, 300 status views the day results are published, one navbar session call per visit of about 1,000 visitors):

| Resource | Portal's use | Of the Free limit |
| --- | --- | --- |
| Worker requests | 900 (registrations) + 2,500 (wizards) + 600 (status) + 1,000 (navbar) = about **5,000** | 5% of 100,000, shared with the public site, the admin and the shortlinks |
| D1 rows written | 150 × 13 + 100 × 65 + 60 × 20 = about **9,700** | 10% of 100,000 |
| D1 rows read | about **57,000** | 1% of 5,000,000 |
| R2 Class A | about 1,400 | 0.14% of one month |
| Emails | 255 wanted, 100 allowed | **the binding limit** ([9.2](#92-the-resend-quota-at-the-season-peak)) |

Where the Free limits bind, in order of risk: **(1)** the 100 emails a day; **(2)** the 10 GB of private storage without compression and retention ([8.3](#83-types-limits-and-the-storage-arithmetic)); **(3)** the 10 ms CPU of sign-in and registration (PBKDF2), not new in this milestone; **(4)** the 100,000 writes a day, 10% at the portal's peak, but still unbounded by the one decided writer, the shortlink counter; **(5)** the account-wide 100,000 requests a day, of which the portal is a small share; **(6)** memory on concurrent uploads, which the streaming upload removes by construction. Subrequests stay near 10 of the 50.

## 11. Work breakdown

### 11.1 The four tasks

One worker per task, each with its own files. P1 is delivered as two pull requests (P1a first). All branch from `cloudflare` after this document is merged and target `cloudflare`; the PM merges.

| Task | Scope | Owns (creates or edits) | Starts after | Cannot touch |
| --- | --- | --- | --- | --- |
| **P1a** Backend foundation | the migration and the tables; the shared form module; the base path and audience of auth; the portal Worker skeleton and its config; the new bindings and limiters | `migrations/0013_portal_applications.sql` and `meta/*`; `src/db/schema/portal.ts`, `src/db/schema.ts` (one export); `shared/application-form/**`; `src/auth/{factory,gate,register}.ts` (a handful of lines each; `src/auth/session.ts` is untouched, the portal's copy of the lazy auth closure is `src/portal/auth-context.ts`; the audience values are in the new `src/auth/audience.ts`); `src/portal/worker.ts` (auth mount, `config`, `me`, 404, error handler) with `src/portal/{guard,headers}.ts` (the guards and the answer headers); `shared/application-form/rules.ts` (the rules without zod, which `schemas.ts` wraps); the table lists of `test/{tables,setup,seed.test}.ts` and the emptying order of `scripts/seed-data.ts` (a new table must be in them); `dev.vars.example`; `tsconfig.json` (`include`); `wrangler.portal.jsonc`; `wrangler.jsonc` (the new bindings and variables, declared once for everyone); `src/env.ts`; `src/security/rate-limit.ts`; `vitest.config.ts`; `package.json` scripts (`dev:portal`, `build:portal-worker`); `scripts/negative-checks-portal-foundation.mjs`; tests `test/portal-foundation*.test.ts`, `test/portal-auth.test.ts` | this PR | the SPAs, `src/portal/applications.ts` |
| **P1b** Application API | overview, current, steps, submit, status list; the gate and the state rules; the confirmation email; the email budget | `src/portal/{applications,rules,queries,present}.ts`; one mount line in `src/portal/worker.ts`; `src/email/{send,templates}.ts`; `src/db/schema/admission.ts` (the `StudentApplicationFormData` type becomes version 2 or 3, `CURRENT_FORM_DATA_VERSION` 3); `src/db/audit.ts` only if a label is missing; `docs/cloudflare/portal-api.md` (corrections); tests `test/portal-applications*.test.ts`; `scripts/negative-checks-portal-api.mjs` | P1a merged | `shared/**` (reports a needed change to P1a's owner instead) |
| **P2** Portal SPA shell | the SPA, its routes and auth pages, the nav, the status and home pages, the not-a-student screen, the mock; **the shared module extraction**; the `cf/web` side of [6.6](#66-what-happens-to-the-pass-through-of-cfweb) | `portal-spa/**` (all but `src/pages/daftar/**`); `shared/spa/**` (all but `xhr.ts`), `shared/vite/**`; the admin SPA's import changes and re-export shims; `scripts/check-portal-spa-bundle.mjs`, `scripts/check-spa-bundle.mjs` (one marker: no zod in the admin bundle), `scripts/negative-checks-spa-portal.mjs`; `package.json` scripts; `cf/web/**` as listed in 6.6; `docs/cloudflare/web-skeleton.md` (the pass-through section) | this PR (against the contract and the mock); integrates with the real Worker once P1a is merged | `src/**`, `migrations/**` |
| **P3** The wizard | the seven steps, the review, the success screen, the stepper, local persistence, the per-step save plumbing | `portal-spa/src/pages/daftar/**`, `portal-spa/src/lib/wizard/**`, `portal-spa/src/mock/applications.ts`, tests; one route line in `portal-spa/src/App.tsx` | P2 merged (shell, shared module) and P1a (the form module); the two file steps wait for P4's field | `src/**` |
| **P4** Private files | the bucket binding use; the student upload, delete and read; the admin read; the admin detail changes; ~~the retention job~~ the **manual purge action** that replaced it (decided 2026-10-13: no automatic deletion, so `src/cron/cleanup.ts` gets no retention job) | `src/private-files/**`; `src/portal/files.ts` and one mount line in `src/portal/worker.ts`; `src/api/application-files.ts` and one mount line in `src/worker.ts`; `src/cron/cleanup.ts`; `src/db/audit.ts`, `src/audit/lists.ts`, `spa/src/lib/audit.ts` (the labels); `spa/src/pages/applications/{answers.ts,model.ts,ApplicationDetailPage.tsx,FilesSection.tsx}` and the mock; `portal-spa/src/components/FileSlotField.tsx` and `portal-spa/src/lib/files/**` (compression, the upload client); `shared/spa/xhr.ts` and the thin `spa/src/lib/crud/upload-client.ts`; negative checks and tests | P1a merged (the tables and the worker file); the field after P2's shared module | the wizard's own steps |

### 11.2 Order

```
this PR merges
  P1a (small, merge early) --> P1b -------------------------------------------------+
    |                                                                                |
    +--> P4 --> FileSlotField --> P3: the documents and marketing steps -------------+--> the PM runs the
  P2 --------> P3: steps 1 to 5 and the review ------------------------------------+    full suite once,
                                                                                         then Dzul's visual check
```

- **In parallel at the start:** P1a and P2 (P2 works against the contract and its mock; it integrates with the real Worker when P1a lands).
- **In parallel after P1a:** P1b and P4 (the server side of P4 needs the tables and the Worker file only).
- **P3** starts after P2 and P1a; it needs P4's `FileSlotField` only for its last two steps, so it builds the other steps and the review first.
- **Nothing starts before P1a if it needs a table, a binding or the form module.**

### 11.3 Shared files and how they are touched

| File | Touched by | Rule |
| --- | --- | --- |
| `src/worker.ts` (admin) | P4 | one `app.route(...)` line and the `scheduled` handler change; nobody else |
| `src/portal/worker.ts` | P1a creates; P1b and P4 add one mount line each | a block marked `// mounts`, one line per route file, alphabetical: a conflict is mechanical |
| `migrations/` and `meta/_journal.json` | **P1a only** (`0013`) | P4 needs no table of its own; if a worker finds it needs one it asks the PM, who numbers it `0014` after `0013` has merged |
| `src/db/audit.ts`, `src/audit/lists.ts`, `spa/src/lib/audit.ts` | P4 (`application_file.view`, `application_file.purge`, resource type `application_file`); P1b only if a label is missing | additive |
| `src/env.ts`, both wrangler configs | P1a declares every new binding, variable and limiter for everyone | the others use them |
| `scripts/negative-checks.mjs`, `scripts/negative-checks-spa.mjs` (the runners) | all | each task adds its own module `negative-checks-portal-*.mjs` and **one import and one array entry** to the runner: append-only |
| `spa/test/routes.test.tsx` (admin) | nobody expects to | the admin's routes do not change; the portal has its own `portal-spa/test/routes.test.tsx`, owned by P2, with one case added by P3 |
| `package.json` | P1a (Worker scripts), P2 (SPA scripts) | disjoint blocks |
| `docs/cloudflare/*` | each task updates the document of what it built (`portal-api.md` by P1b and P4; `auth.md` base-path section by P1a; `uploads.md` and `admin-pendaftaran.md` pointers by P4; `web-skeleton.md` by P2) | |
| `shared/spa/*` | P2 creates the folder and its files; P4 adds `xhr.ts` | no barrel file |

### 11.4 Gates every task passes (read from the exit codes, not from a summary)

- `pnpm typecheck` (both the Worker and the SPAs), `pnpm test` (the Worker suite, the admin SPA suite and the portal SPA suite), `pnpm test:negative` and `pnpm test:negative:spa` (every safeguard the task adds is broken in turn and the tests must fail; the runner restores the files), `pnpm db:drift`, `wrangler deploy --dry-run` for **both** configs, `pnpm check:spa` and `pnpm check:portal-spa`.
- The root app is untouched: `pnpm exec tsc --noEmit` and `pnpm test` at the repository root stay green (P2 also runs `cf/web`'s `pnpm test`, `pnpm test:e2e` and `pnpm check`).
- **The admin does not regress:** the unchanged admin suites, and the admin bundle no more than 1 kB gzip larger than before the extraction.
- No secret, no id, no real host and no real personal data in the diff; no recipient, address, answer or file name in any log line (a test reads every console line of a full run, as the Pendaftaran tests do).
- A PR says plainly what it did not verify: visual and interaction checks are Dzul's (the repository rule: no browser), the real zone and the real R2 are SAKEM-084's.

### 11.5 Definition of done for M4

The tickets' criteria: the registration, verification, sign-in, wizard, submit and status flow runs locally with invented data against both Workers and the mock; the batch and status rules equal the legacy's; Dzul's visual check of the portal and of the admin's Pendaftar detail; the real-zone checks of [section 3.6](#36-what-only-a-real-zone-can-verify) and [14](#14-what-is-not-verified) recorded as SAKEM-084's checklist.

## 12. Before go-live

What must exist, and be checked by a person, before a real applicant's file is uploaded. None of it is done by the code.

1. **The private bucket exists and has no public access:** the bucket's settings show no custom domain and the `r2.dev` access disabled, checked by the owner after creation and again after every dashboard change to R2; its name is not `sakem-files`.
2. ~~**`PRIVATE_FILES_KEY`** (if SSE-C is accepted) is generated, stored in the owner's password manager before the first upload, and set on both Workers.~~ **Falls away: no SSE-C** (decided 2026-10-13, [8.7](#87-encryption)). With no key, item 1 is the whole protection of the bytes beyond R2's own encryption: check it after every change to R2 in the dashboard.
3. **Two different `BETTER_AUTH_SECRET`s**, one per Worker.
4. The routes of [3.5](#35-what-must-be-configured-at-deploy) exist with the failure mode set to closed; the apex serves the portal and the web Worker serves the rest ([3.6](#36-what-only-a-real-zone-can-verify) item 1).
5. A **Turnstile widget** for the apex host (`register`, `login`, `forgot-password`, `resend-verification`), the Resend domain verified, the Google redirect URI for the apex (if Google is on).
6. **A billing and usage alert** on the account (R2 storage and operations), as [`account-setup.md`](account-setup.md) recommends.
7. ~~**The retention variables** set to values Dzul decided.~~ **Replaced:** nothing is deleted automatically (decided 2026-10-13, [8.9](#89-retention-and-deletion-proposal)); the variables ship at `0` and the manual purge action and its runbook ([item 9](#12-before-go-live)) take the place of the cron. The privacy policy (item 8) must say that files are kept without an automatic time limit and how to ask for their deletion.
8. **The privacy policy page** (SAKEM-056) is published and linked from the register page and from the wizard's intro and file step. The portal links to it; if the page is not live the link would be dead, so this is a go-live blocker, not a code blocker.
9. **A runbook** for a family's request to delete an applicant's files and answers, and for an admin to open a PDF safely ([8.10](#810-what-is-not-protected-and-what-to-do-about-it)).
10. A **test applicant** goes through registration, upload, submit, publish and status on staging; an admin opens one file and the Aktivitas log shows exactly one `application_file.view` row without a name in it.

## 13. Open decisions for Dzul

Each has a recommendation; none blocks the first build wave except where stated.

Items 1 to 3 were **decided by Dzul on 2026-10-13** (relayed by the PM); where sections 8.6, 8.7, 8.9, 12 and [`portal-api.md`](portal-api.md) section 12.3 still describe the earlier proposals (the SSE-C key, the retention variables and the daily retention job), the decisions below win and those sections are corrected by the task that builds the part.

1. **May a `viewer` open an applicant's files?** **Decided 2026-10-13: no.** A viewer sees the list (slot, count, size, type) and cannot open a file; only `pendaftaran` writers (an editor with the grant, a super_admin) can. The files are scans of identity documents of minors; a viewer already reads the answers.
2. **Retention.** **Decided 2026-10-13: no automatic deletion.** No retention variable is declared with a non-zero default (a retention variable, if one is declared at all, defaults to `0`, which means "never delete") and the daily retention job of section 8.9 is **not built**. It is replaced by a **manual purge action**: an admin editor with the `pendaftaran` grant, or a super_admin, deletes an applicant's files, and every purge is audited (ids and counts only, as the view audit is). The table of section 8.9 stays only as the list of cases a person may purge by hand. The storage counter and the email counter of the budgets stay; they are not retention tables.
3. **SSE-C on the private bucket.** **Decided 2026-10-13: no.** `PRIVATE_FILES_KEY` is not declared in `env.ts` or in a wrangler config, and nothing depends on it: the bucket relies on staying private (no custom domain, no `r2.dev`, [section 12](#12-before-go-live) item 1), R2's encryption at rest, and the Worker as the only reader. The `503 storage_unavailable` of the file routes then means only a missing bucket binding.
4. **The order of the wizard.** The Saung ticket lists identitas, keluarga dan ekonomi, tempat tinggal, organisasi, berkas, berkas marketing, interview, review. The legacy wizard has eight screens in this order: **Sebelum Mulai** (intro), Identitas, Keluarga & Ekonomi, Tempat Tinggal & Hutang, Organisasi, **Interview Tertulis**, **Pengumpulan Berkas** (with the marketing proofs under the documents on the same screen), Tinjau & Kirim. Recommended: keep the legacy order and screens (the contract does not depend on the order: the API has seven buckets and a submit), unless you want berkas and marketing on separate screens, which changes only the SPA.
5. **Copy that must change because links become uploads.** The "Google Drive" instructions, the file-name formats and "Setiap link harus bisa diakses siapa saja" of the legacy document and marketing steps, and the intro line "Link Google Drive per berkas". P3 writes the new lines in the legacy voice and lists them in its PR; you approve the wording.
6. **A publication email.** Recommended: **no** (100 a day cannot reach everyone at once); use the Pengumuman strip.
7. **The email daily counter and the 80/100 reserve** ([9.2](#92-the-resend-quota-at-the-season-peak)). Recommended: **build it**, so the 101st registrant is told instead of waiting. And whether a paid Resend plan is acceptable if a registration day goes above about 60.
8. **Limits and client-side compression:** 10 MB per file, 40 files and 100 MB per application, images re-encoded to JPEG in the browser. Recommended as proposed; the numbers are one constant each (`shared/application-form/limits.ts`).
9. **Review notes are shown to the student after publication** (the legacy status page prints them as the body of the result). The admin's review form does not say so ("Catatan ini disimpan di data pendaftar"), and a revocation reason ("Siswa mengundurkan diri via WhatsApp...") would appear as the rejection text. Recommended: keep the legacy behaviour (equal rules) and add the sentence "Catatan ini dibaca siswa setelah hasil diumumkan" to the review panel; the alternative is a separate student message field (a schema change).
10. **Admin accounts on the portal.** The legacy let any role into `/portal`. Recommended: the portal is for students; an admin account gets a screen with a link to the admin host (`403 student_only` on data routes).
11. **What the browser keeps.** Recommended: only complete steps go to the server and the rest stays in `localStorage` under the user id with the wipe rules of [7.3](#73-the-draft-per-step-saving-and-local-persistence). The alternative, `sessionStorage`, loses typing when the tab closes but leaves nothing on a shared computer.
12. **How the web Worker is attached at M5** (route `apex/*`, or a Custom Domain on the apex) and the failure mode of the portal routes. Not needed for M4: the design holds in both; recommended fail closed for `/portal/*`.
13. **Edit or withdraw after submit.** Not in the legacy and not built; recommended to leave it out of M4. A correction before the batch closes is a support request today.
14. **Two Google OAuth clients** (one per Worker) or one with two redirect URIs. Recommended: two.

## 14. What is not verified

- **Everything about a real Cloudflare zone** ([3.6](#36-what-only-a-real-zone-can-verify)): route precedence between two Workers, the known trailing `/*` bug, asset and navigation behaviour on a route, `_headers` on the fallback, the failure mode at the daily limit, `CF-Connecting-IP`, `__Host-` cookies and the Google callback on the apex.
- **Real R2:** the streaming `put` with a declared length, the conditional put, SSE-C round trips, and the behaviour of the `private_storage` counter under real concurrency. All of it was designed from the documentation and is proven only against the local emulation until SAKEM-084.
- **Worker CPU and the real D1 row counts** of every path in section 10 (workerd freezes its timers during synchronous code, so CPU cannot be measured locally). The numbers there are estimates from the existing measurements of the admin.
- **Whether a service-binding call counts against the Free daily request limit of the callee** (candidate B only; not used).
- **Everything visual or interactive** (the repository rule: no browser): the portal screens, the wizard at phone width, the upload progress, the Turnstile widget on a phone. Dzul's check, with `pnpm dev:portal-spa:mock` once P2 and P3 exist.
- **The acceptance rate, the number of applicants and the real size of a phone photo** behind the storage arithmetic ([8.3](#83-types-limits-and-the-storage-arithmetic)) are assumptions.
- **Resend delivery and the real quota behaviour** (a 429 versus the counter), Google sign-in with a real client, Turnstile with a real site key.
- No existing suite was run for this change: it is documents only, and every statement about the current code (the admin's routes, the auth gate, the SPA files, the bundle sizes) was read from the files and the earlier documents, not re-measured.

## 15. Sources

Cloudflare documentation read on 2026-10-13 (no account was used):

- Routes: https://developers.cloudflare.com/workers/configuration/routing/routes/
- Custom Domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Known issues (route specificity): https://developers.cloudflare.com/workers/platform/known-issues/
- Static assets, binding and `run_worker_first`: https://developers.cloudflare.com/workers/static-assets/binding/
- Static assets, billing and limitations: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- Single page application routing and navigation requests: https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/
- HTML handling: https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/
- Static asset headers (`_headers`): https://developers.cloudflare.com/workers/static-assets/headers/
- Compatibility flag `assets_navigation_prefers_asset_serving`: https://developers.cloudflare.com/workers/configuration/compatibility-flags/
- Service bindings: https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- Workers pricing (service bindings billing): https://developers.cloudflare.com/workers/platform/pricing/
- Workers limits (daily requests, fail open and closed, subrequests, body size): https://developers.cloudflare.com/workers/platform/limits/
- Rate limit binding: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- R2 pricing: https://developers.cloudflare.com/r2/pricing/
- R2 limits: https://developers.cloudflare.com/r2/platform/limits/
- R2 public buckets (private by default): https://developers.cloudflare.com/r2/buckets/public-buckets/
- R2 Workers API (`put`, `get`, `delete`, checksums, SSE-C options): https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- R2 SSE-C: https://developers.cloudflare.com/r2/examples/ssec/
- R2 data security (encryption at rest): https://developers.cloudflare.com/r2/reference/data-security/

Repository references: the legacy code listed at the top; [`auth.md`](auth.md), [`uploads.md`](uploads.md), [`d1-schema.md`](d1-schema.md), [`admin-pendaftaran.md`](admin-pendaftaran.md), [`admin-crud.md`](admin-crud.md), [`web-skeleton.md`](web-skeleton.md), [`account-setup.md`](account-setup.md), [`../architecture/student-portal.md`](../architecture/student-portal.md), [`../architecture/admission-batches.md`](../architecture/admission-batches.md).
