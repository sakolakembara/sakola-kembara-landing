# Student portal SPA shell (SAKEM-083, task P2)

What task P2 built: the portal's SPA (`cf/admin/portal-spa/`), the module it shares with the admin SPA (`cf/admin/shared/spa/`, `shared/vite/`) and the `cf/web` side of the move. The design and the reasons are in [`portal-architecture.md`](portal-architecture.md) (sections 5 and 6.6), the endpoints in [`portal-api.md`](portal-api.md); this file is the hand-over for the workers that build on it (P3 the wizard, P4 the files) and the check list for the day the real portal Worker exists. Everything here was built against the contract and a mock: **no portal Worker existed**, no browser was opened and no Cloudflare account was used.

## Run it

| Command (in `cf/admin`) | What it does |
| --- | --- |
| `pnpm dev:portal-spa:mock` | The SPA at `http://localhost:5174/portal/` with an invented API (`portal-spa/src/mock`), no Worker needed. Pick a state with `?mock=<persona>` once (kept for the tab): `open` (default), `no-batch`, `draft`, `submitted`, `published-accepted`, `published-rejected`, `published-undecided`, `unverified`, `admin-account`, `error`. Sign in with any address and password; `salah`, `belum-verifikasi`, `dibatasi`, `offline`, `captcha-gagal`, `captcha-tidak-tersedia` before the `@` make the failures; registration also knows `email-tidak-tersedia`, `kuota-penuh`, `isian-salah` |
| `pnpm dev:portal-spa` | The same SPA against the real Worker: `/portal/api` is proxied to `localhost:8788` (`pnpm dev:portal`, P1a) |
| `pnpm build:portal-spa` | Vite writes `dist/portal-spa/portal/` (base `/portal/`, so assets are at the pathname the Worker's assets layer matches), then `scripts/finish-portal-spa.mjs` copies `portal/index.html` to `dist/portal-spa/index.html` (the SPA fallback) and `portal-spa/public/_headers` to `dist/portal-spa/_headers` |
| `pnpm check:portal-spa` | `scripts/check-portal-spa-bundle.mjs`: no mock in the build, every URL under `/portal/` and present, the fallback equals the page, `_headers` present with its rules, initial JS at most 130 kB gzip, each lazy chunk at most 90 kB, CSS at most 14 kB, latin fonts only, no zod in the initial load |
| `pnpm test:portal-spa` | The SPA suite (vitest, jsdom). `pnpm test` runs the Worker suite, the admin SPA suite and this one |
| `pnpm test:negative:spa` | Breaks each safeguard in turn (the portal's are `scripts/negative-checks-spa-portal.mjs`, run with `--only portal:`) |

## What is where

```
cf/admin/shared/spa/       API client, Turnstile (widget, state, loader, mock widget), form hooks, the auth layout, the Google button,
                           the error boundary, the auth texts, validation, formatting, `safeFrom`, the `next/link` stand-in
cf/admin/shared/vite/      spa-base.ts: the design tokens plugin, the aliases (`@/`, `~/`, `@shared/`, `next/link`), the plugins
cf/admin/spa/              the admin SPA: its old files at their old paths are one-line re-exports of the shared ones
cf/admin/portal-spa/       the portal SPA (base /portal/)
  src/lib/                 paths, me, guard, session, use-api-data, public-config, overview, status, register, verification, local-drafts
  src/components/          PortalShell, PortalNav, RequireStudent, ResendVerification, VerifyEmailBanner, ErrorBoundary, LoadState, Centered
  src/pages/               Home, Status, NotStudent, NotFound, DaftarPlaceholder, auth/{Login,Register,ForgotPassword,ResetPassword,VerifyEmail,AuthError}
  src/mock/                the mock (personas, fixtures, transport, install)
  test/                    18 files; `helpers.tsx` has `renderApp`, `stubApi`, `respond`, `meBody`, `overviewBody`
  public/_headers          cache, security headers and CSP of the asset responses
```

Routes (relative to the router's basename `/portal`): `/` home, `/status`, `/daftar` (a "Belum tersedia" placeholder), `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/auth/error`, and a 404 inside the shell. Everything behind sign-in sits under `RequireStudent`: not signed in goes to `/login?from=<page>`, an account whose role is not exactly `student` gets the "not a student" screen (and no data request is made).

## For P3 (the wizard) and P4 (the files)

- **The route.** `src/App.tsx` mounts `DaftarPlaceholderPage` on `daftar`: replace that one line with the wizard (lazy: it must stay out of the initial chunk, and `zod` belongs to its chunk only; `check:portal-spa` fails otherwise), and delete `src/pages/DaftarPlaceholder.tsx`. The home page's "Mulai daftar" / "Lanjutkan pendaftaran" and the public site's "Daftar Sekarang" already point at `/portal/daftar`.
- **Imports.** `@shared/spa/*` is `cf/admin/shared/spa/*` (both Vite configs, both tsconfigs, both vitest configs); `~/` is `portal-spa/src`; `@/` is the repository root (the shared kit `components/ui`). No barrel files.
- **Calling the API.** `api()` from `@shared/spa/api` (never throws; `{ ok, data }` or `{ ok: false, status, code, message?, fields?, retryAfter? }`), with the paths in `~/lib/paths` (`ENDPOINTS`, all under `/portal/api`). `useApiData(path, parse)` (`~/lib/use-api-data`) is the read-once hook of the home and status pages: it turns a 401 into "sign in again" for the whole app. A write that answers 401 should call `useSession().expire()` the same way.
- **What the browser keeps of a half-typed application** (`~/lib/local-drafts`, architecture section 7.3): the key is `localDraftKey(userId, batchId)` = `sakem-portal:v1:<user id>:<batch id>`, the value is JSON **with a numeric `savedAt` (epoch ms), written on every change**. The shell wipes the student's copies at sign-out and on a 401, and removes every copy older than 30 days, **and every copy without a readable `savedAt`**, whenever the portal opens: a wizard that writes its timestamp under another name would lose its drafts on every visit. The wizard itself removes its copy after the submit and on `no_open_batch`, `batch_closed` and already submitted.
- **The session.** `useMe()` (id, name, email, `emailVerified`, `role`) inside the shell; `useSession()` for `signOut`, `expire`, `reload`.
- **The mock.** `portal-spa/src/mock/transport.ts` answers what the shell calls; P3 adds its own handlers in `mock/applications.ts` (its file) and one `case`/`default` hand-off in the transport. Personas are the single place the screens' states are chosen.
- **Tests.** `portal-spa/test/helpers.tsx` renders the whole app under a data router with the basename, like `main.tsx`. A test fails on any `console.error` or `console.warn` it did not take with `takeConsoleProblems()` (`test/setup.ts`). The Turnstile stand-in is `@shared/spa/test/fake-turnstile`.
- **Negative checks.** A check in `negative-checks-spa-portal.mjs` names `config: "portal-spa/vitest.config.ts"` and its tests as `portal-spa/test/<name>`; the runner reads `check.config` (default: the admin's).
- **Bundle budget.** The initial JS of the shell is about 125 kB gzip of the 130 kB budget: the wizard has to be lazy, and a new dependency in the initial load needs a reason.

## What changed in the admin SPA

Nothing a person sees. The shared files moved with `git mv`; the old paths are re-exports (`export * from "../../../shared/spa/<file>"`, relative so the Worker's contract tests, which have no alias, still import them), except where the admin has something of its own: `lib/api.ts` keeps the `Announcement` types, `lib/captcha.ts` keeps `TURNSTILE_ROUTES` with its three entries (the shared `turnstileRoutes(apiBase)` has four: the portal adds `register`), `lib/auth-errors.ts` keeps the two `?error=` codes only its sign-in page gets (`admin-only`, `domain`), `lib/hooks.ts` keeps its tab-title template, `components/ErrorBoundary.tsx` keeps its words. `spa/src/styles.css` gained `@source "../../shared/spa"`: without it Tailwind stops scanning the moved files and drops their classes from the CSS (`check:spa` now fails if `sm:max-w-sm` or `max-w-lg` is missing). The admin bundle grew by 290 bytes gzip (178,447 to 178,737; the budget is 1 kB). `check:spa` also fails if zod is in the admin bundle.

## Integration check list for the real portal Worker (P1a and later)

None of this could be run: tick it when `pnpm dev:portal` exists.

1. `pnpm build:portal-spa`, then `wrangler dev -c wrangler.portal.jsonc`: `/portal/`, `/portal/status` and a deep link such as `/portal/daftar` answer the portal's `index.html` (the fallback), `/portal/assets/<hash>.js` answers the file with `immutable`, `/portal/api/me` answers JSON and not the page.
2. `GET /portal/api/config` carries `google`, `turnstileSiteKey`, `siteUrl` and, since P1a, `adminUrl` (the "not a student" screen links to it: the SPA reads it when it is an http(s) origin and shows no link when it is not); and, optionally, `contactWhatsapp` and `whatsappGroupUrl`, present only when the deployment configured valid values (`portal-api.md` 4.1). *(This item first said the Worker did not carry `adminUrl`; it does.)*
3. Register, verify, sign in, sign out with the local mailbox (`/portal/api/dev/mailbox`): the registration `callbackURL` is `/portal/login?verified=1`, the sign-in's is `/portal/verify-email?status=success`, a reset's `redirectTo` is `/portal/reset-password`, Google's is the page or `/portal/`. Each must be accepted by the Worker's callback check (a path on the origin) and land on a page of this SPA.
4. An unverified sign-in answers `403 EMAIL_NOT_VERIFIED` (Better Auth's `code`), and `POST /portal/api/auth/send-verification-email` takes `{ email, callbackURL }` with the Turnstile header and action `resend-verification`; `register` takes `{ name, email, password, confirmPassword, callbackURL }` and answers `400 invalid` with `fieldErrors: { name?, email?, password?, confirmPassword? }` as arrays; `503 email_quota` is read from `error`.
5. `GET /portal/api/me` answers for an admin account (200, any role); `GET /portal/api/overview` and `/portal/api/applications` answer it `403 student_only`.
6. `GET /portal/api/overview` and `/portal/api/applications` match `portal-spa/src/lib/overview.ts` and `status.ts` (those files are the SPA's reading of the contract: a body they do not recognise is an error screen). The test the Worker suite should get, as `test/spa-contract.test.ts` has for the admin: those two parsers and `lib/register.ts` / `lib/verification.ts` run against the real routes.
7. The 401 path: delete the session row, reload a page: the SPA goes to `/portal/login?from=...` and the local drafts of the student are gone.
8. On a real zone (SAKEM-084): `_headers` applies to the fallback `index.html` (CSP, `nosniff`), the Turnstile widget loads under that CSP, the Google callback completes, the navbar of the public site asks `/portal/api/auth/get-session` and shows "Portal".

## Not verified

No visual or interaction check in a browser (the repository rule; Dzul looks at `pnpm dev:portal-spa:mock`): the layout at phone width, the nav's second row, the status page's tones, the focus ring, the Turnstile stand-in. The real Worker, a real zone, Resend, Google and Turnstile with real keys. The accessibility claims (roles, names, `aria-current`, keyboard order, focus after navigation) are tested in jsdom, which does not do layout, contrast or a screen reader.
