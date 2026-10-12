# Admin skeleton on Cloudflare Workers (SAKEM-078)

A thin, local-only slice of the future admin/portal backend (epic SAKEM-074, phase 2). It lives in [`cf/admin/`](../../cf/admin) and exists to prove the pattern and to put numbers on the Workers Free CPU budget (10 ms per request). It is **not** the full admin and nothing here is deployed: no Cloudflare account was used, no resource exists, no secret is in the repo.

The Next app and Postgres on the VPS keep running meanwhile and are untouched.

## What it is

One Worker (`sakem-admin`, future host `admin.<domain>`):

| Layer | Choice |
| --- | --- |
| API | Hono, JSON, everything under `/api/*` |
| SPA | Vite + React 19 + react-router, built to `dist/spa`, served by the assets layer |
| Database | D1 through Drizzle (SQLite), migrations in `cf/admin/migrations` |
| Auth | Better Auth 1.7, email + password and Google, per-request factory |
| Password hash | PBKDF2-SHA256, 100,000 iterations, WebCrypto |
| Email | Resend REST API through `fetch`, sent with `ctx.waitUntil` |
| Throttling | Cloudflare rate limit bindings (3 buckets) |
| Sample content | `announcements`, with `audit_log` rows |

Routes: `GET /api/me`, `GET /api/config`, `/api/auth/*` (Better Auth), `GET|POST /api/announcements`, `PUT|DELETE /api/announcements/:id`, `GET /api/dashboard` (SAKEM-082, any admin role, the items of the areas the caller may see); since SAKEM-081 also `GET /api/admin/users` and `PUT /api/admin/users/:id/areas`; the full list with what protects each route is in [`auth.md`](auth.md#endpoints). SPA routes: the sign-in pages (`/login`, `/forgot-password`, `/reset-password`, `/verify-email`, `/auth/error`), the dashboard (`/`) and one route per menu entry; see [SPA shell](#spa-shell-sakem-082-part-a).

Layout: `src/worker.ts` (app and the cron handler), `src/auth/` (factory, gate, register, password, guard, permissions, roles, session), `src/security/` (rate limits, Turnstile, same-origin guard, client address), `src/email/` (Resend, templates, mailbox), `src/cron/` (daily cleanup), `src/api/` (announcements, admin users), `src/db/` (schema in `schema/`, audit, grants), `migrations/`, `spa/`, `test/`, `scripts/`. The full D1 schema is described in [`d1-schema.md`](d1-schema.md).

## Run it

```bash
cd cf/admin
pnpm install                  # independent install, not a workspace
cp dev.vars.example .dev.vars # fake local values; the file is untracked
pnpm db:migrate:local         # D1 in .wrangler/state
pnpm dev                      # builds the SPA, then wrangler dev
```

`pnpm dev:spa` runs Vite on :5173 with `/api` proxied to the worker, for hot reload; `pnpm dev:spa:mock` does the same with no Worker at all (see [SPA shell](#spa-shell-sakem-082-part-a)). Neither was exercised in a browser. With `ENVIRONMENT=development` and no `RESEND_API_KEY`, verification and reset emails are printed to the wrangler console.

`pnpm db:seed:local` fills the local database with sample rows and one sign-in per role (see [`d1-schema.md`](d1-schema.md#migrate-and-seed)). To make an account you created yourself an admin (there is no UI for roles yet):

```bash
pnpm exec wrangler d1 execute sakem-admin --local \
  --command "UPDATE users SET role = 'editor' WHERE email = 'you@example.test'"
```

An editor can only change the areas granted to them; a super admin grants them with `PUT /api/admin/users/:id/areas`.

Gates: `pnpm typecheck` (worker and SPA), `pnpm test` (Worker suite in workerd, then SPA suite in jsdom), `pnpm test:negative` and `pnpm test:negative:spa`, `pnpm build:spa && pnpm check:spa`, `pnpm measure`.

## Decisions

**Per-request Better Auth.** A D1 binding exists only inside a request, so `createAuth(env, { baseURL, waitUntil })` runs per request (Ruang Bakat pattern), lazily: a request that never touches auth never builds it. Cost is in the results below.

**Password hash** (`src/auth/password.ts`). Stored as one string, `pbkdf2-sha256$<iterations>$<salt>$<hash>` (base64). Verification reads the iteration count from the string, so older hashes keep working if the default changes. 100,000 is also treated as the ceiling: Workers is understood to cap PBKDF2 there (not enforced by the local runtime; confirm on the real account), so a stored count above it fails verification, which also keeps a tampered row from becoming a CPU bomb. Random 16-byte salt, 32-byte output, NFKC normalization (as Better Auth's own hash), constant-time XOR compare over the fixed-length digest, never throws on a malformed or tampered string. 100k is below the 600k OWASP guidance for PBKDF2-SHA256; that is the price of the Free budget (see risks).

**Email verification is required** (`requireEmailVerification: true`). Sign-up creates the account and sends a link (24 h). A correct password on an unverified account answers 403 and sends a fresh link (`sendOnSignIn`). Better Auth stores the `verification` identifiers (reset-password tokens) hashed (`verification.storeIdentifier: "hashed"`), so a database read does not yield live reset links. Email-verification tokens are signed JWTs and are not stored.

**Email fails closed** (`src/email/send.ts`; *since SAKEM-081 part B the console fallback below is gone: outside production a message is kept in an in-memory mailbox and never printed, and the routes that send email answer 503 in production before creating anything, see [`auth.md`](auth.md#email)*). `ENVIRONMENT` defaults to production in `wrangler.jsonc`; only an explicit `development` or `test` (in an untracked `.dev.vars`, or the test config) opts out. In production without `RESEND_API_KEY`/`EMAIL_FROM` nothing is sent and the single log line names only the purpose. The recipient, subject and link are printed only outside production. A provider error logs the HTTP status only. Because sending runs in `ctx.waitUntil`, the HTTP answer is identical whether or not the address exists or the send worked, so it cannot be used to enumerate accounts. Cloudflare Queues and Cloudflare Email sending are Paid-only, which is why `waitUntil` is used. (The Workers docs note that each isolate has some built-in slack for a Worker that only occasionally goes over its CPU limit; do not count on it.)

**Account linking stays at Better Auth's safe defaults.** `trustedProviders` is not set and `requireLocalEmailVerified` is not turned off. Ruang Bakat had to do both (RBT-D76) because its sign-up never verified email; the documented cost is that anyone can register someone else's address first and keep the password after the real owner signs in with Google. Here sign-up proves the address, so Google links only to a local account whose email is already verified. A test proves an unverified local account is refused (`test/linking.test.ts`). On top of that, `user.validateUserInfo` refuses Google profiles whose `email_verified` is not exactly `true`, the same rule as the legacy `decideGoogleLink`.

Difference from the legacy behaviour to settle before migration: the legacy app links Google to an *unverified local student row* and clears its password. Here that case is refused until the address is verified. Legacy students who never verified will hit this at cutover.

**Roles** (`src/auth/roles.ts`, `src/auth/permissions.ts`, `src/auth/guard.ts`). *Superseded by SAKEM-081: this slice had one flat matrix (`viewer` read, `editor` and `super_admin` write). Permissions are now per area, with an editor's areas in `admin_area_grants`; the rules, the guard and the API are in [`d1-schema.md`](d1-schema.md#permission-model).* What still holds: the guard answers 401 (no session) or 403 (not enough), an unknown role gets nothing, and sessions are database-backed with no cookie cache, so the role (and now an editor's grants) is read from D1 on every request: a demoted user loses write access on the very next request (tested), like the legacy `requireAdmin` re-reading the row. Cost: one to three D1 reads per authenticated request, far inside the 5M reads/day budget.

**Audit** (`src/db/audit.ts`). Every announcement mutation is a single `db.batch([mutation, auditInsert])`, which D1 runs as one transaction: there is never a change without its audit row. The legacy app writes the row afterwards and swallows failures; the batch costs no extra round trip, so that trade is not needed. A test breaks the audit table and checks the mutation rolls back.

**Rate limiting** (*superseded by SAKEM-081 part B: eight bindings, one per concern, a route table and an in-memory fallback for local runs, see [`auth.md`](auth.md#rate-limits); the paragraph below describes the first slice*) (`ratelimits` in `wrangler.jsonc`). Better Auth's own limiter is off: in memory it is per isolate (useless on Workers) and in D1 it would spend one write per request of the 100k/day budget. Three Cloudflare bindings guard sign-in, sign-up, reset request and resend: per route+IP+email (5/min), per route+email (20/min), and per route+IP (10/min, only on routes that send email). A classroom behind one address is never throttled by address alone. Differences from the legacy limiter: the binding allows only 10 or 60 second periods (legacy: 5 and 15 minutes), and counters are per Cloudflare location and eventually consistent, so this is a brake, not an exact quota.

**Assets and `run_worker_first`.** `["/api/*"]`, not `true` as in the Assafar studio. The studio needs `true` for `/oauth/*` and `/.well-known/*`; this app has nothing outside `/api`, so the SPA and its files are answered by the assets layer with no Worker invocation (no CPU, no request count). Verified with `wrangler dev`: `/login` returns the SPA, `/api/me` returns 401 JSON.

**CSRF.** *Since SAKEM-081 part B there is also an explicit Origin and Sec-Fetch-Site check on every write, see [`auth.md`](auth.md#csrf).* Cookies authenticate the API and a cookie on the parent domain is also sent from sibling subdomains. Mutations require `Content-Type: application/json` (415 otherwise): a cross-site form or `text/plain` post cannot carry it, and any other type needs a CORS preflight that this app never grants. Better Auth does its own origin check on `/api/auth/*` (`trustedOrigins`).

**Cookies and origins from env, not code.** `TRUSTED_ORIGINS` (comma-separated) and `COOKIE_DOMAIN`. *Superseded by SAKEM-081 part B: do not set `COOKIE_DOMAIN`. Production cookies are host-only with the `__Host-` prefix, so the apex and the admin host have separate sessions and no sibling subdomain can read or plant them; rationale in [`auth.md`](auth.md#cookies-and-csrf).* Better Auth's error page is replaced by the SPA route `/auth/error` (`onAPIError.errorURL`); verification failures go back to the `callbackURL` with `?error=`, which the login page shows.

**Set-Cookie.** Better Auth's `Response` is returned as is, then only `Cache-Control: no-store` is added. Tests check that every `Set-Cookie` arrives as its own header (the OAuth callback sets a session cookie and clears state cookies) and that the Google state cookie survives the wrapper (a lost state cookie is `state_mismatch`).

**SPA reuse of `components/ui`.** Read-only reuse through a Vite alias, no file under `components/` is touched:

- `@/` points at the repo root, so the kit's `@/lib/cn` import resolves as in Next.
- `next/link` (imported by `components/ui/button.tsx`) is aliased to `spa/src/shims/next-link.tsx`, a 20-line component that renders react-router's `Link` and swallows the Next-only props (`prefetch`, `scroll`). `Button` runs unchanged. The same mapping is in `spa/tsconfig.json` `paths` so the SPA typechecks.
- `resolve.dedupe` and `paths` force `react`, `class-variance-authority` and `tailwind-merge` to this app's copies. Verified: build and typecheck still pass with the root `node_modules` removed.
- Tokens: `spa/src/styles.css` imports `app/globals.css` itself (one source of truth, per `DESIGN.md`) and adds `@source` for its own files and for `components/ui`. Cost: the blog and map CSS of that file comes along unused. **One catch, fixed in SAKEM-082:** `app/globals.css` contains `@source not "../cf"` (so the Next build ignores the Astro and admin projects), and Tailwind applies that line to every build that imports the file, ahead of any `@source` of ours. The SPA's own files were therefore never scanned: only classes that also appear in `components/ui` were generated, and layout classes such as `h-dvh`, `min-h-screen` and `shadow-lg` were missing (CSS 32 kB before, 42 kB after). A small Vite plugin in `spa/vite.config.ts` (`sharedTokens`) now inlines the file minus its `@source not` lines. If the tokens ever move into their own file, import that instead and delete the plugin.
- Fonts: Plus Jakarta Sans and Lora from `@fontsource-variable` (self-hosted, no Google request), mapped to the kit's `--font-body` and `--font-display`. No icons (`lucide-react` not added).
- Copy: legacy strings are reused (login messages, announcements table, form labels). New strings are only the email-verification messages on `/login`.

**Tests in workerd, not a fake D1.** `@cloudflare/vitest-plugin` (the renamed `@cloudflare/vitest-pool-workers`, whose npm page says deprecated) runs the tests inside the real Workers runtime with a real local D1 and the real rate limit bindings from `wrangler.jsonc`. The worker is called directly, so `fetch` (Resend, Google token endpoint) and `console` can be spied on. A Hono `app.request` with a hand-made D1 would not exercise SQLite semantics, batch atomicity, WebCrypto limits or the rate limit binding. The plugin also loads a developer's `.dev.vars`; the config pins every optional variable so tests do not depend on it (checked with a polluted file).

## SPA shell (SAKEM-082, part A)

The frame every admin page lives in: sidebar and mobile drawer, page header, route guard, 403/404 and error screens, the admin auth pages and the dashboard skeleton. No page body is ported yet: each menu entry shows a placeholder that says "Belum tersedia di admin baru". Visual style and Indonesian copy are the legacy ones (`DESIGN.md`, `docs/context/tone-of-voice.md`); `components/ui` is reused through the alias described above, and `PageHeader` and the sidebar are ports of `app/(admin)/admin/_page-header.tsx` and `_sidebar.tsx`.

### Structure

```
spa/src/
  main.tsx, App.tsx        entry (error boundary, router) and the route table
  lib/
    me.ts                  Me, roles, areas, parseMe (the /api/me payload)
    access.ts              accessTo(me, section): THE visibility function
    nav.ts                 the menu (one list) and what is built from it
    guard.ts               pure guard decisions, safeFrom (the `from` rule)
    session.tsx            SessionProvider: GET /api/me once, sign-out
    api.ts                 typed JSON client, swappable transport, the Turnstile header
    auth-errors.ts         every failure of the auth pages, as Indonesian text
    captcha.ts             what SPA and Worker agree on for Turnstile (pure), parsePublicConfig
    turnstile.ts           Cloudflare's script loader, useTurnstile (token, reset, take)
    public-config.ts       usePublicConfig: GET /api/config (Google, site key)
    validation.ts          form validation (pure)
    dashboard.ts           GET /api/dashboard contract, parser, hook
    hooks.ts               submit lock, focus trap, autofocus, page title
  components/              Shell, Sidebar, MobileDrawer, PageHeader, RequireAuth, ErrorBoundary, TurnstileWidget
  pages/                   dashboard/, auth/, Announcements, Placeholder, Forbidden, NotFound
  mock/                    development mock (never in the build)
spa/test/                  vitest + jsdom
```

### Who sees what

`accessTo(me, section)` is the one function that decides what the SPA shows; the sidebar, the route guard, the placeholder, the dashboard shortcuts and the announcements form all ask it. It answers `none`, `read` or `write`. It does not repeat the permission rules: the Worker works them out (`src/auth/permissions.ts`, the same functions as its route guards, see [`d1-schema.md`](d1-schema.md)) and says the result in `GET /api/me`, and `accessTo` reads those lists. The outcome, as decided for SAKEM-081 and 082:

| Role | Pendaftaran, Komunikasi, Konten Situs | Sistem (Aktivitas, Pengaturan) |
| --- | --- | --- |
| `super_admin` | write | write |
| `editor` | write in the areas granted to them, **nothing** in the others (their menus are hidden and their routes show the 403 page) | none |
| `viewer` | read | none |
| `student`, unknown | none (the guard shows a refusal with Keluar) | none |

"Read" means the page opens and shows no create, edit or delete control and no quick action. The dashboard is open to every admin role (an editor with no areas has the dashboard and nothing else). Whatever the lists say, an account that is not an admin gets nothing. The server stays the authority: the UI hides, the API enforces (a hidden area's reads answer 403).

An editor sees and changes only what was granted to them: until 2026-10-12 they could also read the other areas (read-only), and the other areas' menus were shown; Dzul decided they should not, and the change was one line in `levelIn` in `src/auth/permissions.ts`, which the SPA follows through `areas.visible` and `areas.writable` (for an editor both equal `areas.granted`). Sistem is hidden from every role but `super_admin`, Aktivitas included; this supersedes `admin-ia.md` sections 3.2 and 3.5 as first proposed.

**The `/api/me` contract the SPA reads:** `{ user: { id, email, name, role, emailVerified }, areas: { granted, visible, writable } }`. `granted` is an editor's own grants (empty for other roles), `visible` the areas whose pages the user may open, `writable` the areas where they may change things (area names: `pendaftaran`, `komunikasi`, `konten`, `sistem`). A payload without `areas`, with a list that is not an array, or with names the SPA does not know, is read as empty lists (nothing shown for them), and an unknown role is read as `student`, like the Worker does. `spa/test/access.test.ts` and `spa/test/nav.test.ts` build `Me` from the Worker's own `visibleAreas`, `writableAreas`, `levelIn`, `menuItems` and `visibleMenu`, for every role and every set of grants, so a change to the permission model that the SPA does not follow fails them. `cf/admin/test/spa-contract.test.ts` reads the real `/api/me` of each role, including an editor whose grant is revoked.

### Routes and guards

- Open: `/login`, `/forgot-password`, `/reset-password`, `/verify-email`, `/auth/error`. They do not call `/api/me`.
- Behind sign-in (`RequireAuth` loads the session once): `/` (dashboard) and every menu path with everything below it (`/blog`, `/blog/new`, `/blog/<id>/edit`...). Not signed in: redirect to `/login?from=<page>`; `from` is only honoured when it is a same-origin path and not an auth page (`safeFrom`). After Keluar there is no `from`. Not reaching the server is an error screen with Coba lagi, not a sign-out.
- Per area (`RequireSection`): no access gives the 403 page inside the shell. Unknown paths give the 404 page inside the shell (the assets layer answers 200 for every path, so this is the only 404). A crash while rendering a page shows an Indonesian message inside `<main>` and the menu keeps working; leaving the page clears it.
- Reload on a deep link works because the Worker's assets layer falls back to `index.html`.

### Shell behaviour

Desktop: fixed 240 px sidebar. Below `md`: a top bar with a menu button that opens a modal drawer (`role="dialog"`, `aria-modal`): focus moves in, Tab wraps, Escape and the backdrop close it, focus returns to the button, the page behind is `inert` and does not scroll; following a link closes it. The current link carries `aria-current="page"` (a page below an entry keeps its entry marked). After a route change focus goes to `<main>`; a "Lewati ke konten utama" button is the first tab stop. The sidebar footer shows the email, the role ("Hanya baca" for a viewer) and Keluar.

### Auth pages (admin side only; there is no admin registration)

All call Better Auth through `api()`. None prints a server message or code (they are English and say too much); every failure has Indonesian text in `lib/auth-errors.ts`: wrong credentials, unverified email, rate limited (reads `Retry-After`: "tunggu 1 menit"), expired link, no connection, server error, and the three answers of the security check and the email service (`captcha_failed`, `captcha_unavailable`, `email_unavailable`). Forms are `noValidate` with their own messages, `aria-invalid` and `aria-describedby` through `Field`, the cursor goes to the first invalid field, autofocus only on devices with a mouse-like pointer, and `autocomplete` is `username`/`current-password` on sign-in, `email` on forgot-password and `new-password` on reset. A ref lock (`useSubmitLock`) lets one request through at a time, because two submit events can arrive before the disabled button is drawn.

| Page | Call | Notes |
| --- | --- | --- |
| `/login` | `POST /api/auth/sign-in/email` with `callbackURL: "/verify-email?status=success"`; Google through `/api/auth/sign-in/social` when `/api/config` says so | The callback is for the fresh verification link an unverified account is sent at that moment. `?error=` is mapped from an allow-list; any other text is replaced by the generic line and never echoed. `?reset=1` shows "password berhasil diganti". With a site key, the [security check](#the-security-check-turnstile) sits between the password and the button (action `login`). |
| `/forgot-password` | `POST /api/auth/request-password-reset` with `redirectTo: "/reset-password"` | The page says "Kalau email tersebut terdaftar..." for every address, so it cannot be used to find out which accounts exist; failures read the same for every address too. A hidden honeypot field is kept from the legacy form. With a site key, the [security check](#the-security-check-turnstile) sits above the button (action `forgot-password`). |
| `/reset-password` | `POST /api/auth/reset-password` `{ newPassword, token }` | Better Auth redirects here with `?token=` or `?error=INVALID_TOKEN`; an error (or no token) shows "minta tautan baru" instead of the form. Success goes to `/login?reset=1` (the Worker revokes sessions; unlike the legacy page there is no automatic sign-in). Password 8 to 128 characters, the Worker's limits. |
| `/verify-email` | none | Better Auth verifies on its own endpoint and redirects here with `?status=success` or `?error=<CODE>`; the page only reports. Opened by hand it does not claim success. |
| `/auth/error` | none | Where `onAPIError.errorURL` sends OAuth failures, `?error=<code>` mapped from the allow-list. |

### The security check (Turnstile)

The Worker refuses sign-in and forgot-password without a token Cloudflare has verified ([`auth.md`](auth.md#turnstile)), so these two pages draw the widget. `/reset-password`, `/verify-email` and `/auth/error` have no check on their routes and draw none.

- **Site key at runtime.** `GET /api/config` returns `turnstileSiteKey` (the public variable `TURNSTILE_SITE_KEY`, set per deploy; no rebuild). `usePublicConfig()` reads it once per page. Missing, null, empty or not a string means "no Turnstile here": nothing is drawn, the button is never held and no header is sent, which is the local default (the Worker skips the check outside production without a secret). To try the real widget locally, put one of Cloudflare's published test key pairs in `.dev.vars` (see `dev.vars.example`).
- **The widget.** `components/TurnstileWidget.tsx` loads `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` once per page (`lib/turnstile.ts`, no package; a second caller, or the page mounted again, reuses the element and `window.turnstile`) and renders with the site key, the page's `action`, `theme: "light"`, `size: "flexible"` and `language: "id"`. The frame labels itself, so nothing is wrapped around it. A 65 px box is reserved so the button does not jump when the widget appears.
- **The token.** `useTurnstile(action, siteKey)` holds it. The button is disabled and says "Memeriksa…" until there is one; a submit that does not come from the button is ignored too. `api(..., { turnstileToken })` sends it in the **`X-Turnstile-Token`** header, never in the URL or the body. A token works once, so `take()` hands it out and asks for a fresh challenge in the same step, whatever the answer (success, wrong password, 403, no connection): the next request never carries a spent token, and forgot-password, which stays open after success, can send again. A form that fails validation, or the honeypot, sends nothing and keeps its token. The Google button does not wait: that route has no check.
- **Expiry and timeout.** A token lives five minutes. When the widget reports it expired, or an interactive challenge timed out, the token is dropped (it is never sent), a new challenge is asked for and the button waits again.
- **When it cannot run.** The script cannot be fetched (offline, blocked), the widget cannot be drawn or it reports an error: an `Alert` says "Pemeriksaan keamanan tidak dapat dijalankan. Periksa koneksi internet, lalu muat ulang halaman." (announced at once), the button stays off, and a later token (the widget retries by itself) clears it. A failed script element is removed, so the next mount asks again.
- **The Worker's answers.** `captcha_failed` (403: no token, refused or already used): "Verifikasi keamanan gagal. Tunggu pemeriksaan selesai, lalu coba lagi." `captcha_unavailable` (503: no secret in production, or Siteverify unreachable): "Verifikasi keamanan sedang tidak tersedia. Coba lagi beberapa saat lagi." `email_unavailable` (503, forgot-password only: no email service): "Layanan email sedang tidak tersedia, jadi tautan belum bisa dikirim. Silakan coba lagi nanti." None depends on the address typed. `test/spa-contract.test.ts` pins the header, the action of each route (`TURNSTILE_ROUTES` against `AUTH_POLICIES`) and the three codes against the real Worker.
- **Resend verification.** There is no such button in the SPA: an unverified account that signs in gets a fresh link from Better Auth itself, after the sign-in's own check. `resend-verification` is declared in `lib/captcha.ts` so the first page that resends names its action the way the Worker expects.
- **Mock.** `pnpm dev:spa:mock` shows a stand-in widget (`mock/turnstile.ts`) that solves itself after a second and hands out made-up tokens; the mock API accepts each once, like the Worker, so a page that forgets to reset meets `captcha_failed` there too. Cloudflare's script is never loaded in mock mode (`loadTurnstile` refuses, and the mock's widget is already in place); `check:spa` fails if the stand-in ends up in a build.
- **CSP.** Neither the Worker nor the SPA's `index.html` sets a Content-Security-Policy today (the Worker only answers `/api/*`; the assets layer serves the SPA with no policy of its own), so nothing had to change. A policy added later needs `https://challenges.cloudflare.com` in `script-src`, `frame-src` and `connect-src` (the script, the widget's iframe and its requests). Not tried against a real policy.

### Dashboard

`/` has two blocks and nothing else (decided by Dzul, 2026-10-12; the full reasoning and the Indonesian rules are in [`admin-ia.md`](admin-ia.md#33-dashboard-hanya-perlu-perhatian-dan-tindakan-cepat)):

- **Perlu perhatian**: pending and in-review applicants, unread messages and the state of one admission batch, each tile a link to the list already filtered. It reads `GET /api/dashboard` (Worker: `src/api/dashboard.ts`, rules in `src/dashboard/payload.ts`, statements in `src/dashboard/queries.ts`; contract: the comment at the top of `spa/src/lib/dashboard.ts`). The answer is `{ attention: { pendingApplications?, underReviewApplications?, unreadMessages?, batch? } }`, each item `{ count, to }` (the batch has its state and `to` instead of a count), and **an item is only there when the caller may see its area**: Pendaftaran owns the applicants and the batch, Komunikasi the messages, Konten Situs and Sistem have none, so an editor of Konten alone gets `{ attention: {} }` and the dashboard says "Tidak ada yang perlu ditindaklanjuti saat ini." (the same words as when every count is zero). The SPA draws the items it is given in a fixed order, follows their `to` (a same-site path: `safeFrom` refuses anything else and the answer then counts as malformed) and sizes the loading placeholders by `expectedDashboardTiles`, which the contract test checks against the real answer. Loading (skeleton), empty, error (Coba lagi) and not-served (404 or 501: a note, no retry) states exist.
- **Tindakan Cepat**: from the SPA, not the API. `visibleQuickActions` keeps the shortcuts whose section the user may write to (`areas.writable` of `/api/me`), so there is none for a viewer or an editor without those areas, and they show while the data loads or fails. This is the simpler of the two options (an API list would repeat the routes, labels and icons in the Worker); the Worker's permission functions still decide, because `areas.writable` is theirs.

Not on the dashboard any more: Pendaftar terbaru, Pesan terbaru, the content totals and Aktivitas terakhir (the activity log is only in Sistem › Aktivitas). `lib/audit.ts` (label and link of an audit action) was kept for that page; nothing uses it until it exists. The mock builds its dashboard with the Worker's own `buildDashboard`, so it has the real shape and the same rule per persona (`?mock=editor:konten` gets an empty attention).

### Run it with the mock

```bash
cd cf/admin
pnpm dev:spa:mock     # Vite on :5173, no Worker, no database; API answers come from spa/src/mock
```

A yellow "Mode mock" note is fixed to the corner. Open `http://localhost:5173/login`, then choose who you are from the address bar once (kept for the browser tab):

- `?mock=viewer` · `?mock=editor` (all areas) · `?mock=editor:konten,komunikasi` · `?mock=editor:pendaftaran` · `?mock=editor:-` (no areas: the dashboard and nothing else) · `?mock=super_admin` (default) · `?mock=student`. An editor sees only the menus of the areas listed, and the mock answers 403 to a read of any other (the announcements list, say), like the Worker.
- `?mock-dashboard=ready|empty|error|unavailable|slow`
- Sign in with any password and an email whose part before the `@` is `salah` (wrong credentials), `belum-verifikasi` (unverified), `dibatasi` (rate limited, 60 s) `offline` (no answer), `captcha-gagal` (the security check refuses: 403 `captcha_failed`) or `captcha-tidak-tersedia` (503 `captcha_unavailable`); anything else signs in. On "Lupa password", `email-tidak-tersedia` answers 503 `email_unavailable`. On `/reset-password?token=kedaluwarsa` the reset is refused as spent. The mock widget needs about a second to give the page its token.

The mock is loaded only when `VITE_ADMIN_MOCK=true`, which a normal build never sets. `pnpm build:spa && pnpm check:spa` prints every file's raw and gzip size and fails if mock strings are in the build (checked both ways: a build made with the flag fails it). Mock data is invented and uses reserved example addresses.

### Adding a menu page

1. Add one entry to `NAV` in `lib/nav.ts`: `path`, `label`, optional `title`, and `section` (`pendaftaran`, `komunikasi`, `konten` or `sistem`). The sidebar, the 403 check, the placeholder and the routes (`path` and `path/*`) follow from it. The Worker lists the same menu (`menuItems` in `src/auth/permissions.ts`); add the entry there too, a test compares the two.
2. Build the page as `pages/<Name>.tsx` and register it in `PAGES` in `App.tsx` by path. Start with `<PageHeader title=...>` (it sets the tab title and supports `back`, `overline` and `actions`), pad the page itself (`p-6 md:p-10`), and take the user from `useMe()`.
3. Gate every create, edit and delete control with `accessTo(me, "<section>") === "write"`. Do not compare roles anywhere else. The API route must use the matching `requireArea` (`src/auth/guard.ts`).
4. Talk to the server only through `api()` (so the mock and the tests can stand in), keep Indonesian text next to the page or in `lib/`, use `useSubmitLock` for anything that sends, and add the page's tests.
5. If the page needs a new mock answer, add it in `spa/src/mock/transport.ts`; `test/mock.test.ts` keeps the mock in the documented shapes.

### Tests

`pnpm test:spa` runs 503 tests in about 5 s (vitest with jsdom, config in `spa/vitest.config.ts`, same aliases as the build): `accessTo` (a hand-written table of every role against several sets of grants, an editor getting write or none and never read, and agreement with the Worker's own permission functions for every role and every set of grants), the menu, `parseMe`, the guard and `safeFrom`, form validation, every error mapping, the API client, and component tests that render the whole app: sidebar, drawer (focus trap, Escape, focus return, inert), route guard, 403/404/error boundary, login, forgot and reset password, the security check (Cloudflare's script is played by `test/fake-turnstile.ts`: the token in the header, the reset after every request, the button's states, expiry and timeout, a widget that cannot run, no site key, the mock never loading the script, the three error mappings), verification result, the 403 page for an editor opening an area they were not granted, the dashboard in every state and role (the tiles it is given, the links it follows, the two blocks and no other, placeholders by role), announcements. A test fails if the page logs a console error or warning, so React's act and key warnings count. jsdom rather than happy-dom because the drawer and forms depend on focus, tab order and disabled controls behaving as in a browser, and jsdom follows the specification more closely; the speed difference does not matter at this size. `pnpm test:negative:spa` breaks 43 safeguards one at a time (viewer writes, editor outside its areas, student let in, a dashboard tile for an item the server did not send, a dashboard link that is not checked, redirect loses `from`, off-site `from`, drawer without a trap, double submit, and for the security check: no token header, no reset after a request, a button that does not wait, an expired token kept, a mock that loads Cloudflare's script, an unmapped code...) and expects the tests to notice.

The SPA tests stub the API, so `cf/admin/test/spa-contract.test.ts` (in the Worker suite, in workerd) checks the other side: the exact bodies and callback URLs the auth pages send, the redirects that land on `/verify-email` and `/reset-password`, the error codes and the 8 to 128 password limits the SPA's messages depend on, the Turnstile header, the action of each protected route and the `captcha_failed`, `captcha_unavailable` and `email_unavailable` answers, the `Retry-After` of the limiter, sign-out, the real `/api/me` of each role (including an editor with a grant that is then revoked) read through `parseMe`, `visibleNav` and `accessTo`, and the real `/api/dashboard` of eight kinds of caller read through `parseDashboard` (as many tiles as `expectedDashboardTiles` says, and every link a route of the SPA's menu that the caller may open). It imports the SPA's pure `me.ts`, `dashboard.ts` and `auth-errors.ts`; that is why the fetching hook is in `lib/use-dashboard.ts`, so the contract file stays free of `fetch`.

Not tested: anything visual (layout, colours, the drawer's slide, the `md` breakpoint, focus rings), real browsers and screen readers, `dev:spa` and `dev:spa:mock` in a browser, Google sign-in against Google, and the new pages behind `wrangler dev`. For the security check specifically: **the real Cloudflare widget in a real browser has never run** (not with Cloudflare's test keys, not with a real site key): its look, its size in the column, the Indonesian text of the frame, how the script behaves behind an ad blocker, and the callbacks the real script fires are all taken from Cloudflare's documentation and played by a fake in the tests.

## Results

Machine: Apple M4, Node 22. Wall time, **not Worker CPU**: workerd freezes timers during synchronous code, so CPU cannot be measured locally, and native crypto accounting on Workers is undocumented.

| Measurement | Result |
| --- | --- |
| PBKDF2-SHA256 100k verify, Node (`pnpm measure`) | median 7.74 ms, p95 7.83 ms (n=51); wrong password 7.72 ms; hash 7.72 ms |
| `createAuth()` per request, Node | first call 3.3 ms (cold module graph), then median 0.10 ms (n=101) |
| Local workerd via `wrangler dev` (curl, includes the proxy), median | `/api/config` 1.6 ms · `/api/me` 3.6 ms · `/api/auth/get-session` 3.4 ms · `GET /api/announcements` 3.5 ms (n=40 each) |
| Sign-in, same setup | right password 10.9 ms (n=12) · wrong password 11.1 ms (n=6). About 7 ms above the session baseline, consistent with the hash |
| Worker bundle (`wrangler deploy --dry-run`) | 2.87 MB raw, 475 KiB gzip. Limit per the current Workers limits page: 64 MiB uncompressed on Free (the old 3 MB compressed limit was removed on 2026-09-04) |
| Bundle composition (source bytes) | zod 807 KiB, kysely 657 KiB (pulled in by Better Auth, unused), better-auth 379 KiB + core 272 KiB, opentelemetry conventions 353 KiB, app code 34 KiB |
| Startup (`wrangler check startup`) | 38.9 ms active of a 67 ms window, locally. Limit is 1 s |
| SPA build | JS 343.9 kB (107.3 kB gzip), CSS 42.0 kB (11.1 kB gzip) with the shell, auth pages, dashboard and the security check (`check:spa`, gzip level 9; JS was 348.7 kB (108.7 kB gzip) before the dashboard lost its activity widget, SAKEM-082; the widget code cost 3.2 kB raw, 1.1 kB gzip of JS and 30 bytes of CSS, the rest of the CSS growth since the shell is the kit's invalid-field border, SAKEM-086; Cloudflare's script is loaded from Cloudflare at run time and is not in the bundle). Before the shell: JS 303 kB (96 kB gzip) and CSS 32 kB (9.5 kB gzip), but that CSS was missing the SPA's own classes (see Tokens above), so the two CSS figures are not like for like. One JS chunk: lazy-load heavy pages (the blog editor) when they arrive. Fonts: browsers fetch only the needed subsets, typically the two latin files (27 kB + 38 kB) |
| Tests | Worker: 70 passing in 6 files (about 8 s) at SAKEM-078; 269 in 10 files (about 12 s) after SAKEM-081 (schema, permission matrix, seed); SAKEM-082 part A adds 16 contract tests for the SPA (`test/spa-contract.test.ts`), 285 in 11 files (about 14 s). SPA: 402 passing in 16 files (about 4 s); the security check (SAKEM-082) takes it to 463 in 18 files and the Worker suite by 9 contract tests |
| Negative checks (`pnpm test:negative`) | 8 of 8 safeguards at SAKEM-078 (verification requirement, viewer write, route guard, rate limit mount, production fail-closed, client-set role, Google `email_verified`, weakened account linking); 25 of 25 after SAKEM-081, adding the area rules, the guard, who may grant areas, enum CHECKs, cascade, RESTRICT and uniqueness. SPA: `pnpm test:negative:spa`, 43 of 43 (37 before the dashboard, 20 before the security check); five more in the Worker script break the SPA/Worker agreement from either end. SAKEM-082 (editor sees only its areas, `GET /api/dashboard`) added 17 to the Worker script (the old editor read rule put back, `/api/me` listing every area, and 15 for the dashboard: no guard, student answered, areas ignored, statements run for an area that is not visible, read messages counted, decided applicants counted, no status filter, no limit on the batches, statements one after the other, wrong phase, wrong batch, names and addresses in the answer, no `no-store`, a link to a route that does not exist), so 123 of 123 once the two checks of the public face (SAKEM-080) are counted |

Visual and interaction QA of the SPA was **not** done (no browser by instruction). The SPA was verified by typecheck, build, and `curl` against `wrangler dev` (assets layer returns it; the API behind it was exercised end to end: sign-up, 403 before verification, verification link, sign-in, `/api/me`, viewer read-only, editor create, audit row).

## Risks and gaps

1. **The sign-in CPU budget is tight and unproven.** The hash alone is about 7.7 ms here, and the rest of a sign-in (zod, two or three D1 queries, HMAC cookie signing, JSON) is a couple of ms on top, against a 10 ms limit. Whether native PBKDF2 time counts as CPU on Workers is undocumented. Needs the real Free account (SAKEM-077). If it does not fit: lower iterations (weaker), run the hash in a second Worker called through a service binding (each invocation has its own budget; unverified whether it counts against the Free request limit), move to the paid plan, or avoid passwords for students (reverses a decision).
2. **Legacy password hashes are bcrypt** and cannot be verified here (bcryptjs measured ~54 ms). Migration needs a forced reset at cutover, or a one-off hybrid verify. Not built.
3. **Resend quota can be burned by an attacker** (100/day free): the per-IP bucket slows one address, not many. *Done in SAKEM-081 part B: Turnstile on registration, forgot password, resend and sign-in, plus a per-mailbox cap. Still open: a daily budget counter.*
4. **Long-window throttling is shorter than legacy.** Per-account lockout over minutes needs a SQLite-backed Durable Object (available on Free); not built.
5. **Not built:** SPA sign-up (students register in the portal, a later milestone; there is no admin registration; the registration API exists since SAKEM-081 part B, see [`auth.md`](auth.md#registration-contract)); the page bodies behind the menu (placeholders, see [SPA shell](#spa-shell-sakem-082-part-a)); LMS SSO endpoints; password change; session list; security headers for the SPA (add `public/_headers`: CSP, frame-ancestors, referrer policy); CI for `cf/` (the existing workflows do not run it); linting for `cf/` (the root ESLint ignores it).
6. Better Auth user ids are random strings; legacy ids are UUIDs. Existing ids can be inserted as they are when migrating, new ones stay random.
7. Dev server proxy mode (`dev:spa`) and Google OAuth against real Google were not exercised (the Google flow is tested with a faked token endpoint).

## Port estimate for the full admin (opinion)

Relative to the announcements slice (S). Line counts are the legacy UI code per module, only to anchor the guess; the real cost is in the notes.

| Module | Legacy lines | Size | Notes |
| --- | ---: | :-: | --- |
| Announcements | 694 | done | Edit page and delete button still to add in the SPA |
| Audit viewer | 389 | S | Read-only list, port `audit-labels` |
| Messages (contact) | 394 | S | Public form POST belongs to the public worker; add Turnstile |
| Shortlinks | 670 | M | CRUD is easy; the redirect at the site root lives in the public worker |
| Reports | 672 | M | Attachments go to R2 |
| Team | 913 | M | Photo upload to R2, ordering |
| Resources | 965 | M | Files move from the VPS volume to R2 |
| Batches | 767 | M | Publish guard on results must be kept exactly |
| Settings (admin users) | 632 | M | super_admin only; creating admins needs the invite/reset flow |
| Applications | 1000 | L | Status workflow, emails, student data (privacy), exports |
| Blog | 1084 | L | The legacy writer saves markdown files on disk; Workers has no disk, so storage moves to D1/R2 and the public rendering changes with it |
| Student portal (register, status, wizard) | n/a | L | Multi-step form, verification banner, results privacy contract |
| LMS SSO endpoints | ~190 | M | JWT with `jose` runs on Workers; follows `lms-integration.md` |
| Data migration Postgres to D1 | n/a | M | Scripts, id mapping, forced password reset, dry runs |

Shared groundwork (SPA shell with sidebar and page header, form helpers, R2 upload helper, error and empty states) is about one more S and pays off across all modules. The SPA shell, page header, form helpers and the error and empty states are done (SAKEM-082 part A); the R2 upload helper is not.

## What only a real Free account can settle

- Real CPU per route, in particular sign-in, sign-up and reset (hash plus the rest) against 10 ms. Read it from the dashboard or `wrangler tail`.
- Better Auth CPU in production: per-request construction, cold start, and a bundle that parses 2.9 MB.
- Resend: domain verification (SPF, DKIM), real delivery to school and Gmail addresses, sender name, the 100/day cap in practice.
- Cookie behaviour across subdomains: the `.sakolakembara.org` domain attribute with the `__Secure-` prefix, `SameSite=Lax`, what the public site and the LMS can and cannot read, and logout propagation.
- Rate limit bindings at the edge (per-location counters) and real client IPs in `cf-connecting-ip`.
- `run_worker_first: ["/api/*"]` with SPA fallback on the real assets layer, and response headers for assets.
- D1 real latency, the 5M reads / 100k writes per day budget under real traffic, and migrations on a remote database.
- Google OAuth with the real client: redirect URI on the admin host, consent screen, `email_verified` behaviour for school Workspace accounts.
