# Student portal SPA (SAKEM-083, tasks P2 and P3)

What tasks P2 and P3 built: the portal's SPA (`cf/admin/portal-spa/`), the module it shares with the admin SPA (`cf/admin/shared/spa/`, `shared/vite/`), the `cf/web` side of the move (all P2) and, on top of the shell, the registration wizard (P3, [below](#the-wizard-p3)). The design and the reasons are in [`portal-architecture.md`](portal-architecture.md) (sections 5 and 6.6), the endpoints in [`portal-api.md`](portal-api.md); this file is the hand-over for whoever works on the SPA next and the check list for the day the real portal Worker exists. Everything here was built against the contract and a mock: **no browser was opened and no Cloudflare account was used** (the wizard's pure files were also run against the real portal Worker in the Worker suite, see [what P3 checked](#what-p3-checked-against-the-real-worker)).

## Run it

| Command (in `cf/admin`) | What it does |
| --- | --- |
| `pnpm dev:portal-spa:mock` | The SPA at `http://localhost:5174/portal/` with an invented API (`portal-spa/src/mock`), no Worker needed. Pick a state with `?mock=<persona>` once (kept for the tab): `open` (default), `no-batch`, `draft`, `submitted`, `published-accepted`, `published-rejected`, `published-undecided`, `unverified`, `admin-account`, `error`. Sign in with any address and password; `salah`, `belum-verifikasi`, `dibatasi`, `offline`, `captcha-gagal`, `captcha-tidak-tersedia` before the `@` make the failures; registration also knows `email-tidak-tersedia`, `kuota-penuh`, `isian-salah`. The wizard has its own words, see [the mock of the wizard](#the-mock-of-the-wizard) |
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
  src/lib/files/           the file client, compression and types (P4)
  src/lib/wizard/          the wizard's logic (P3): api, values, screens, persist, fields, summary, config, use-wizard
  src/components/          PortalShell, PortalNav, RequireStudent, ResendVerification, VerifyEmailBanner, ErrorBoundary, LoadState, Centered, FileSlotField (P4)
  src/pages/               Home, Status, NotStudent, NotFound, auth/{Login,Register,ForgotPassword,ResetPassword,VerifyEmail,AuthError}
  src/pages/daftar/        the wizard's screens (P3): DaftarRoute (the lazy loader), DaftarPage, Wizard, Stepper, ErrorSummary, form (the controls),
                           Gates, Success, steps/{Intro,Identity,Household,Housing,Organizations,Interview,Documents,Review}
  src/mock/                the mock (personas, fixtures, transport, install) and the wizard's routes (applications)
  test/                    32 files; `helpers.tsx` has `renderApp`, `stubApi`, `respond`, `meBody`, `overviewBody`; `wizard-helpers.tsx` has the wizard's
  public/_headers          cache, security headers and CSP of the asset responses
```

Routes (relative to the router's basename `/portal`): `/` home, `/status`, `/daftar` (the wizard, its own lazy chunk), `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/auth/error`, and a 404 inside the shell. Everything behind sign-in sits under `RequireStudent`: not signed in goes to `/login?from=<page>`, an account whose role is not exactly `student` gets the "not a student" screen (and no data request is made).

## Working on the SPA

- **The route.** `src/App.tsx` mounts `DaftarRoute` on `daftar`: a Suspense and a loader, the only part of the wizard in the first load (the placeholder of P2 is gone). The home page's "Mulai daftar" / "Lanjutkan pendaftaran" and the public site's "Daftar Sekarang" point at `/portal/daftar`.
- **Imports.** `@shared/spa/*` is `cf/admin/shared/spa/*` (both Vite configs, both tsconfigs, both vitest configs); `~/` is `portal-spa/src`; `@/` is the repository root (the shared kit `components/ui`). No barrel files.
- **Calling the API.** `api()` from `@shared/spa/api` (never throws; `{ ok, data }` or `{ ok: false, status, code, message?, fields?, retryAfter? }`), with the paths in `~/lib/paths` (`ENDPOINTS`, all under `/portal/api`). `useApiData(path, parse)` (`~/lib/use-api-data`) is the read-once hook of the home and status pages: it turns a 401 into "sign in again" for the whole app. A write that answers 401 should call `useSession().expire()` the same way.
- **What the browser keeps of a half-typed application** (`~/lib/local-drafts` for the shell, `~/lib/wizard/persist` for the wizard, architecture section 7.3): the key is `localDraftKey(userId, batchId)` = `sakem-portal:v1:<user id>:<batch id>`, the value is JSON **with a numeric `savedAt` (epoch ms), written on every change** (`shared/application-form/draft.ts` is the shape). The shell wipes the student's copies at sign-out and on a 401, and removes every copy older than 30 days, **and every copy without a readable `savedAt`**, whenever the portal opens. The wizard writes it, reads it (and removes one that is expired or unreadable), and removes its own after the submit and on `no_open_batch`, `batch_closed` and already submitted ([what the wizard does with it](#what-the-browser-keeps-and-when-it-goes)).
- **The session.** `useMe()` (id, name, email, `emailVerified`, `role`) inside the shell; `useSession()` for `signOut`, `expire`, `reload`.
- **The mock.** `portal-spa/src/mock/transport.ts` answers what the shell calls and hands every other route to `mock/applications.ts` (the wizard's). Personas are the single place the screens' states are chosen.
- **Tests.** `portal-spa/test/helpers.tsx` renders the whole app under a data router with the basename, like `main.tsx`. A test fails on any `console.error` or `console.warn` it did not take with `takeConsoleProblems()` (`test/setup.ts`). The Turnstile stand-in is `@shared/spa/test/fake-turnstile`.
- **Negative checks.** A check in `negative-checks-spa-portal.mjs` names `config: "portal-spa/vitest.config.ts"` and its tests as `portal-spa/test/<name>`; the runner reads `check.config` (default: the admin's).
- **Bundle budget.** The initial JS is about 125.3 kB gzip of the 130 kB budget (the wizard is lazy and costs the first load about 0.3 kB: the route's loader), the wizard's chunk is about 27.5 kB of its 90 kB; a new dependency in the initial load needs a reason.

## The wizard (P3)

`/portal/daftar`: the registration form. Eight screens in the legacy order, over the seven buckets of the API (`shared/application-form/steps.ts`: `UI_STEP_ORDER`, `UI_STEP_BUCKETS`): **Sebelum Mulai** (intro), **Identitas Pribadi**, **Keluarga & Ekonomi**, **Tempat Tinggal & Hutang**, **Organisasi**, **Interview Tertulis**, **Pengumpulan Berkas** (the documents, and under them the marketing proofs: one screen, two buckets, `documents` then `marketing`), **Tinjau & Kirim**, then the confirmation. The words are the legacy words (`app/(portal)/portal/daftar/**`), except where a document is an upload and no longer a pasted link ([the new copy](#copy-that-is-new)).

### How it works

- **Opening.** `GET /portal/api/applications/current` (`DaftarPage`) decides what the student sees: `gate: "open"` is the form; `no_open_batch` and `submitted` are the legacy screens ("Belum ada batch pendaftaran yang dibuka", "Pendaftaran kamu untuk ... sudah kami terima", `Gates.tsx`); a body the parser does not recognise, or a failure, is the "Coba lagi" screen (a student's work is not lost: it is in the browser and on the server). Nothing of the form is drawn, and no save can be made, from a gate screen.
- **Typing** is kept in the browser at once; nothing is sent while the student types. **"Selanjutnya"** checks the screen with the Worker's own function (`validateStep` of `shared/application-form/rules.ts`: the wizard does not carry a copy of a rule and does not import zod), and only if it passes sends each bucket of the screen that the server does not already hold the same (`PUT .../steps/:step`, the validated value). The next screen opens when the server has taken it. The documents screen also needs every required file (the ten, and `dtks` when DTKS is "ya": the legacy sentence), and saves `documents` then `marketing`.
- **Going back and jumping** (`Sebelumnya`, the list of screens, "Ubah" in the review) send nothing: what was typed is in the browser. A bucket that differs from what the server holds is marked "Belum disimpan" (the list, the review); it is saved by the next "Selanjutnya" through it or, at the latest, by "Kirim Pendaftaran", which first checks all seven buckets in the Worker's order (identity, household, housing, organizations, documents, marketing, interview) and the files, saves every bucket the server does not hold the same, and only then sends. The list opens a screen only if the student has been there; going forward is "Selanjutnya".
- **Files.** Each slot is P4's `FileSlotField` (it keeps no file of its own: the wizard holds the list from `current.files` and applies every `onChange`). A file goes straight to the Worker from the field; the wizard never reads its bytes and never keeps one. A save of `documents` with DTKS "tidak" makes the Worker remove the `dtks` files: the screen says so before, and forgets them when the answer lists `removedSlots`.
- **Resume.** The server's saved buckets, then the browser's copy over them where it should win (below). The student carries on at the first screen whose buckets the server does not hold (the review when it holds them all; the first form screen for a draft that has only files; the intro for a student with nothing), with every screen they have been to open in the list.
- **Review and send.** The review shows every answer as typed (a document as "N berkas"), a pencil per section, "Belum disimpan" on a section the server does not hold. `201` shows the confirmation (the legacy words, the id, the WhatsApp group when the deployment configures it) and removes the copy in the browser.
- **Accessibility.** Every field is labelled; a group of options is a `<fieldset>` with a `<legend>` (the kit's `Field group`), so the arrow keys and Space are the browser's. A refused screen shows one summary box (role `alert`, the legacy sentence "Beberapa isian belum lengkap...", one link per field that moves focus to it) and **takes focus**; each field also carries its own message (`aria-invalid`, `aria-describedby`). A new screen takes focus on its heading. One `role="status" aria-live="polite"` line says "Menyimpan…", "Mengirim…" and "Bagian X tersimpan.". The list of screens is a list of buttons (`aria-current="step"`, the locked ones disabled with a lock icon, "Belum disimpan" in words); on a phone it is folded behind one button that says where the student is (`aria-expanded`). Nothing depends on colour alone. Buttons and cards of a choice are 44 px high; a delete button is 44 px square.
- **Phone first.** One column, 16 px margin, 24 px in the card (a field is 280 px wide at 360 px); the grids of choices are one column until `sm`; the two columns (list and form) begin at `lg`; the buttons stack with "Selanjutnya" on top; nothing has a fixed width over 340 px. `wizard-layout.test.tsx` checks these classes (no browser was used: how it LOOKS is Dzul's check).

### What the browser keeps, and when it goes

`localStorage`, key `sakem-portal:v1:<user id>:<batch id>` (two ids, no email), value a `LocalDraft`: the answers of every bucket as typed (including the one being typed), the screen, the screens visited, and `savedAt`, **written on every change and not on opening**. Never a file, never the email. It goes: at sign-out and on a 401 (the shell: every copy of the student, a 401 of the page, of a save, of the send or of a file call alike), after the send, on `no_open_batch`/`batch_closed`/already submitted (a 409 of a save or of the send, or the `gate` of `current`: for no open batch, where no key can be named, every copy of the student), when it is 30 days old (`readLocalDraft`; the shell also purges on every opening), and when it cannot be read (not JSON, an unknown shape, no numeric `savedAt`: removed on the spot).

When the wizard opens with both a server draft and a copy: a bucket the server does not hold is the copy's; a bucket both hold stays the server's **unless the copy was written after the server's draft last changed and differs from it**, and then the copy is kept and the screen is marked "Belum disimpan". "After" is compared on the server's clock: the `now` of `current` against the phone's `Date.now()` gives the phone's error, which is taken off `savedAt` (a phone that is minutes ahead must not decide). Two buckets are compared by the text `validateStep` would store (so a trailing space, or a count that was a number on one side, is not a difference). A copy somebody edited cannot break a screen (`normalizeBucket` keeps the known keys with their own types and defaults the rest).

A student whose session ends loses the typing the server does not hold: the 401 rule wipes the copy (a shared computer). The saved buckets travel; the half-typed one does not. Whether that is the right trade for a phone on a weak connection is open decision 11 of the architecture.

### Refusals

| The Worker answers | The student sees |
| --- | --- |
| `400 invalid` with `fields` | each field's message under it and in the summary (the summary takes focus); the student stays |
| `409 no_open_batch`, `batch_closed` | the "Belum ada batch..." screen with the Worker's sentence on top; the copy is removed |
| `409 already_submitted` | the page reads `current` again: "sudah kami terima"; the copy is removed |
| `409 duplicate_whatsapp` (send) | the identity screen, the number's field says it |
| `409 draft_changed` (send) | the Worker's sentence on the review; the next press sends |
| `422 incomplete`, `404 no_draft` (send) | the Worker's sentence on the review, and the screen reads `current` again (files, saved buckets) so the next press does not repeat itself; a wrong guess of the screen is fixed |
| `401` | the sign-in page (`/login?from=/daftar`), the copies removed |
| `429` | the Worker's sentence, or "Terlalu banyak percobaan. Coba lagi dalam N menit/detik." |
| offline | "Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi."; nothing is lost; the button is there again |
| `5xx`, a body not understood | "Terjadi kesalahan di server..." / "Jawaban server tidak bisa dibaca. Coba lagi." |

`api()` keeps `status`, `code`, `message`, `fields` and `retryAfter` and drops the rest of an error body (`step`, `missingFiles`, `max`): the wizard does not need them, because it validates every bucket and counts the files itself before it asks. (If the Worker's `step` were wanted, `shared/spa/api.ts` would have to keep it.)

### The mock of the wizard

`mock/applications.ts` answers `GET applications/current`, `PUT steps/:step`, `POST submit`, `DELETE files/:id` and the upload (through `setFileUploader`: it keeps no bytes). **A step is checked with the shared module's real `validateStep`, the documents with its `missingSlots`**, so the mock cannot drift from the Worker on what is valid; it makes up only the clock, the ids and the files. State lives in memory for the life of the page (a reload starts again from the persona: `open` is empty, `draft` has identity and household saved and a Kartu Keluarga, `submitted`/`published-*` and `no-batch` are the gates, `unverified` is refused with the Worker's sentences, `error` fails). Type one of these as the **Nama Panggilan** of the Identitas step to see a refusal a form cannot be made to produce: `offline` (network error), `dibatasi` (429), `kedaluwarsa` (401), `ditutup` (409 `batch_closed`), and, for the send, `kembar` (409 `duplicate_whatsapp`) or `berubah` (409 `draft_changed`). After a mock send the home page still says what the persona says (the mock keeps the wizard's state apart from the overview's).

### Copy that is new

Nothing in the legacy had to be reworded except where a document is an upload and where the browser and the server both keep the work. The list is in the pull request of P3 (for Dzul's approval), sentence by sentence; the contact number of the admissions desk and the invitation to the participants' WhatsApp group are **not in the repository**: the wizard reads `contactWhatsapp` and `whatsappGroupUrl` from `GET /portal/api/config` when the Worker sends them (below) and shows its words without the link when it does not.

### Needed from the Worker side (P1a/P1b, not changed here)

1. `GET /portal/api/config` should carry two optional deployment values: `contactWhatsapp` (digits with the country code) and `whatsappGroupUrl` (an https address). The legacy intro ("Butuh bantuan? Chat Kesiswaan ... di WhatsApp +62 ...") and the legacy confirmation ("Gabung Grup WhatsApp") need them, and a public repository is not the place for either. Until then the first screen links to the Kontak page of the public site and the confirmation has no group button.
2. Nothing else: the wizard needs no other route or field than `portal-api.md` lists.

### What P3 checked against the real Worker

The wizard's pure files (`lib/wizard/api.ts`, `values.ts`, `screens.ts`) were run against the real portal Worker in the Worker suite (workerd, local D1) in a scratch test: no batch (the gate and every write's 409); an open batch with nothing started (`gate: "open"`, `draft: null`, `no_draft`); no session (`unauthorized` on all three calls); **each of the seven buckets as the wizard sends it comes back from `current` as the same bucket by `canon`** (so nothing shows "Belum disimpan" after a round trip) and the saved list, `lastStep` and the resume screen are right; for bad buckets the fields the Worker names equal the fields `validateStep` names (the rules cannot disagree); the send with documents missing (`incomplete`; the Worker names the documents' slots first and the proofs only once those are there, as 9.1 says), the `201` and the `submitted` gate after it, the second send and a save (`already_submitted`); the DTKS removal (`removedSlots`). It passed (8 tests). It is not committed: `cf/admin/test/` is outside the files of P3. It is `portal-wizard-spa-contract.test.ts`, to be added to the Worker suite by whoever owns it.

### Tests

`portal-spa/test/wizard-*.test.ts(x)`: `lib` (parsers, refusals, buckets, the merge, screens, summary, config), `persist` (the copy: key, stamp, expiry, unreadable, no storage), `steps` (each screen's refusals in the legacy words, the toggles, DTKS, the files), `flow` (the way through, going back and jumping, the review and the send, coming back), `errors` (every refusal on a save and on the send), `gates`, `a11y`, `layout` (the classes at 360 px), `privacy` (a whole run reads every console line, every address and request, the title, the cookies and storage), `rules` (a source scan: no console, no session storage, no `fetch`, nothing into an address, no file bytes, `localStorage` only in `persist.ts`, no zod, the first load imports only the loader), `mock` (the mock against the wizard's parsers and the real rules), `route` (the loader). `routes.test.tsx` (P2's) has one case changed: `/daftar` opens the wizard. The negative checks are `scripts/negative-checks-spa-portal-wizard.mjs` (`node scripts/negative-checks-spa.mjs --only "portal wizard:"`).

## What changed in the admin SPA

Nothing a person sees. The shared files moved with `git mv`; the old paths are re-exports (`export * from "../../../shared/spa/<file>"`, relative so the Worker's contract tests, which have no alias, still import them), except where the admin has something of its own: `lib/api.ts` keeps the `Announcement` types, `lib/captcha.ts` keeps `TURNSTILE_ROUTES` with its three entries (the shared `turnstileRoutes(apiBase)` has four: the portal adds `register`), `lib/auth-errors.ts` keeps the two `?error=` codes only its sign-in page gets (`admin-only`, `domain`), `lib/hooks.ts` keeps its tab-title template, `components/ErrorBoundary.tsx` keeps its words. `spa/src/styles.css` gained `@source "../../shared/spa"`: without it Tailwind stops scanning the moved files and drops their classes from the CSS (`check:spa` now fails if `sm:max-w-sm` or `max-w-lg` is missing). The admin bundle grew by 290 bytes gzip (178,447 to 178,737; the budget is 1 kB). `check:spa` also fails if zod is in the admin bundle.

## Integration check list for the real portal Worker (P1a and later)

None of this could be run: tick it when `pnpm dev:portal` exists.

1. `pnpm build:portal-spa`, then `wrangler dev -c wrangler.portal.jsonc`: `/portal/`, `/portal/status` and a deep link such as `/portal/daftar` answer the portal's `index.html` (the fallback), `/portal/assets/<hash>.js` answers the file with `immutable`, `/portal/api/me` answers JSON and not the page.
2. `GET /portal/api/config` carries `google`, `turnstileSiteKey`, `siteUrl`. **It does not carry `adminUrl`**, which the "not a student" screen links to (the architecture's variable `ADMIN_URL` exists, the contract's answer does not list it): the SPA reads it when it is there (an http(s) origin) and shows no link when it is not. P1a/P1b: add it to `portal-api.md` section 4.1 and to the answer, or tell P2 that the screen is to link somewhere else.
3. Register, verify, sign in, sign out with the local mailbox (`/portal/api/dev/mailbox`): the registration `callbackURL` is `/portal/login?verified=1`, the sign-in's is `/portal/verify-email?status=success`, a reset's `redirectTo` is `/portal/reset-password`, Google's is the page or `/portal/`. Each must be accepted by the Worker's callback check (a path on the origin) and land on a page of this SPA.
4. An unverified sign-in answers `403 EMAIL_NOT_VERIFIED` (Better Auth's `code`), and `POST /portal/api/auth/send-verification-email` takes `{ email, callbackURL }` with the Turnstile header and action `resend-verification`; `register` takes `{ name, email, password, confirmPassword, callbackURL }` and answers `400 invalid` with `fieldErrors: { name?, email?, password?, confirmPassword? }` as arrays; `503 email_quota` is read from `error`.
5. `GET /portal/api/me` answers for an admin account (200, any role); `GET /portal/api/overview` and `/portal/api/applications` answer it `403 student_only`.
6. `GET /portal/api/overview` and `/portal/api/applications` match `portal-spa/src/lib/overview.ts` and `status.ts` (those files are the SPA's reading of the contract: a body they do not recognise is an error screen). The test the Worker suite should get, as `test/spa-contract.test.ts` has for the admin: those two parsers and `lib/register.ts` / `lib/verification.ts` run against the real routes.
7. The 401 path: delete the session row, reload a page: the SPA goes to `/portal/login?from=...` and the local drafts of the student are gone.
8. On a real zone (SAKEM-084): `_headers` applies to the fallback `index.html` (CSP, `nosniff`), the Turnstile widget loads under that CSP, the Google callback completes, the navbar of the public site asks `/portal/api/auth/get-session` and shows "Portal".
9. The wizard against `pnpm dev:portal` (P3): sign in as a student, open `/portal/daftar`, go through the eight screens with real files (local R2), reload in the middle (the resume), send, and see the application on the status page and in the admin's Pendaftar detail with its files. The chunk `portal/assets/DaftarPage-<hash>.js` loads on `/portal/daftar` only, with `immutable`, and the CSP of `_headers` does not stop it or the file field (`blob:` previews).
10. `GET /portal/api/config` carries `contactWhatsapp` and `whatsappGroupUrl` when the deployment sets them: the first screen's help card shows the number and the confirmation shows the group button (until then the help card links to the Kontak page).

## Not verified

No visual or interaction check in a browser (the repository rule; Dzul looks at `pnpm dev:portal-spa:mock`): the layout at phone width (the wizard's classes at 360 px are checked as classes only), the nav's second row, the folded list of screens on a phone, the status page's tones, the focus ring, the Turnstile stand-in, the radio cards, the summary box and its focus, the upload progress. The real Worker, a real zone, Resend, Google and Turnstile with real keys, real R2. The accessibility claims (roles, names, `aria-current`, `aria-live`, keyboard order, focus after navigation and after a refusal) are tested in jsdom, which does not do layout, contrast, a virtual keyboard or a screen reader. Real phones: the keyboard (`inputMode="numeric"` on the counts and amounts), autofill (`autoComplete` on the name and the number), and what a student's browser does with `localStorage` in a private window (the wizard then keeps nothing and says nothing; only the saved buckets travel).
