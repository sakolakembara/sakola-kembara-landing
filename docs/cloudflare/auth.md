# Authentication, email, Turnstile and admin users (SAKEM-081, part B)

How people sign in to the new admin/portal Worker ([`cf/admin`](../../cf/admin)), what protects each route, and how admins are managed. Epic SAKEM-074, milestone M2. **No production change: everything here ran against a local D1 and fake keys** (no Cloudflare account was used, no resource exists, no secret is in the repo). Part A (schema, areas, `requireArea`) is in [`d1-schema.md`](d1-schema.md); the skeleton and its CPU numbers are in [`admin-skeleton.md`](admin-skeleton.md).

Decided by Dzul, not reopened here: passwords stay for students and admins; Google sign-in stays; email verification is required **for students** (an admin created or invited by a super_admin never has to verify, SAKEM-089: [why and how](#admins-and-email-verification)); email goes through Resend; Turnstile on login, registration, forgot-password and contact; Cloudflare rate limit bindings; no public admin sign-up (a super_admin creates or invites admins); students register themselves in the portal.

## Contents

[Flows](#flows) · [Endpoints](#endpoints) · [Registration contract](#registration-contract) · [Turnstile](#turnstile) · [Rate limits](#rate-limits) · [Email](#email) · [Cookies and CSRF](#cookies-and-csrf) · [Base path and audience](#base-path-and-audience) · [Account linking](#account-linking) · [Sessions](#sessions) · [Admin users](#admin-users) · [Audit](#audit) · [Retention](#retention) · [Variables, secrets, bindings](#variables-secrets-bindings) · [Run it locally](#run-it-locally) · [Tests](#tests) · [Not built, and what only a real account can settle](#not-built)

## Flows

| Flow | What happens |
| --- | --- |
| **Student registers** | `POST /api/auth/register` (Turnstile, limits). Account created as `student`, unverified, no session. A verification email goes out. The answer is the same for every address. |
| **Verify email** | The link in the email (`GET /api/auth/verify-email?token=...`, 24 hours) marks the address verified and redirects to the `callbackURL` the form sent. It does not sign anyone in. Opening it twice is harmless. |
| **Sign in** | `POST /api/auth/sign-in/email`. An unverified account (in practice a student's: an admin is made verified, [below](#admins-and-email-verification)) answers 403 `EMAIL_NOT_VERIFIED` and gets a fresh link; a deactivated one 403 `ACCOUNT_DEACTIVATED`. A wrong password, and an invited admin who has not opened the link (nothing to sign in with), both answer 401 `INVALID_EMAIL_OR_PASSWORD`. |
| **Forgot password** | `POST /api/auth/request-password-reset`, same answer for every address. The link (30 minutes, single use) goes to the SPA with `?token=`; `POST /api/auth/reset-password` redeems it. **All sessions of that user end.** Redeeming proves the mailbox, so it also marks the address verified. |
| **Google** | `POST /api/auth/sign-in/social` then the callback. Disabled (and the route absent) until both Google variables are set. See [account linking](#account-linking). |
| **First super_admin** | There is no public sign-up and Pengaturan needs a super_admin, so the first one on an empty database comes from outside the app: the owner runs `pnpm first-admin` on their own machine. [`first-super-admin.md`](first-super-admin.md). |
| **Admin invited** | A super_admin posts `POST /api/admin/users` without a password. The invitee gets a link valid 7 days; opening it lands on `/reset-password?invite=1&token=...`, they choose a password, which **verifies the address and creates their credential account** in one step, and from then on they sign in like anyone. Until they do, an invited super_admin is **not** counted as one who can sign in ([the last super_admin](#the-last-super_admin)). |
| **Admin created with a password** | The same `POST /api/admin/users` with a `password`. The admin is **verified in the same insert and can sign in at once**; nothing is mailed. The super_admin tells them the password themselves. |
| **Admin deactivated** | Sessions deleted now, sign-in refused by every method, outstanding links deleted. Reversible. |
| **Sign out** | `POST /api/auth/sign-out`. |

## Endpoints

Everything is JSON under `/api/*`. `POST` bodies must be `application/json` (415 otherwise; send `{}` when there is no body) and at most 8 KiB (413). Every write must come from this site's own origin ([CSRF](#cookies-and-csrf)). Responses are `Cache-Control: no-store`.

### Public auth routes

Only the routes in this table exist under `/api/auth`; everything else Better Auth ships (`sign-up/email`, `update-user`, `delete-user`, `change-email`, `change-password`, `list-sessions`, `link-social`, ...) answers 404. The table is `AUTH_POLICIES` in `src/auth/gate.ts`; a test pins it.

| Method and path | Turnstile (`data-action`) | Rate limits | Needs email to work | Notes |
| --- | :-: | --- | :-: | --- |
| `POST /api/auth/register` | `register` | `register` (IP), `mailTarget` (email) | yes | Ours. [Contract below](#registration-contract). |
| `POST /api/auth/sign-in/email` | `login` | `login` (IP+email), `loginAccount` (email) | no | `{ email, password, rememberMe? }`. Sets the session cookie. |
| `POST /api/auth/request-password-reset` | `forgot-password` | `reset` (IP), `mailTarget` (email) | yes | `{ email, redirectTo }`. `redirectTo` must be a path on this origin or a trusted origin (403 otherwise). 200 for every address. |
| `POST /api/auth/send-verification-email` | `resend-verification` | `verifyResend` (email), `mailTarget` (email), `reset` (IP) | yes | `{ email, callbackURL? }`. 200 for every address. Takes 0.5 s on purpose (Better Auth's constant-time floor). |
| `POST /api/auth/reset-password` | none | `token` (IP) | no | `{ token, newPassword }`; 8 to 128 characters; the token is consumed. |
| `GET /api/auth/reset-password/:token?callbackURL=...` | none | `token` (IP) | no | The emailed link. Redirects to `callbackURL?token=...`, or `?error=INVALID_TOKEN`. |
| `GET /api/auth/verify-email?token=...&callbackURL=...` | none | `token` (IP) | no | The emailed link. Redirects to `callbackURL`, or `?error=INVALID_TOKEN` / `TOKEN_EXPIRED`. |
| `POST /api/auth/sign-in/social` | none | `token` (IP) | no | `{ provider: "google", callbackURL }`. Answers `{ url }`. |
| `GET /api/auth/callback/google` | none | `token` (IP) | no | Failures redirect to the SPA route `/auth/error?error=...`. |
| `POST /api/auth/sign-out` | none | none | no | `{}`. |
| `GET /api/auth/get-session` | none | none | no | |

Why `send-verification-email` has Turnstile although the decision named four forms: it sends email to an address the caller chooses, and without a session. Left open it is the cheapest way to burn the Resend quota (100 a day). The legacy button was behind a session.

"Needs email to work": in production, when `RESEND_API_KEY` or `EMAIL_FROM` is missing these routes answer **503** `email_unavailable` before they create anything or spend a Turnstile token.

### Other routes

| Method and path | Who | Notes |
| --- | --- | --- |
| `GET /api/config` | anyone | `{ google: boolean, turnstileSiteKey: string \| null }`. The widget needs the site key; the secret never leaves the Worker. |
| `GET /api/me` | signed in | User, role and the areas (visible, writable, granted). 401 otherwise. |
| `GET /api/dev/mailbox` | only `ENVIRONMENT=development` | The emails this isolate "sent". 404 everywhere else, including in tests and production. |
| `GET /api/admin/users`, `GET /api/admin/users/:id`, `POST /api/admin/users`, `PUT /api/admin/users/:id`, `PATCH /api/admin/users/:id`, `POST /api/admin/users/:id/deactivate`, `.../reactivate`, `.../resend-invite`, `PUT /api/admin/users/:id/areas` | `sistem` area: super_admin only | [Admin users](#admin-users); the list, the edit form and the screens are in [`admin-sistem.md`](admin-sistem.md). |
| `GET /api/admin/audit` | `sistem` area: super_admin only | The audit log, newest first, with a cursor and filters; [`admin-sistem.md`](admin-sistem.md#3-aktivitas). |
| `/api/admin/announcements` | `komunikasi` area | Part A; the CRUD convention of [`admin-crud.md`](admin-crud.md). An editor needs the `komunikasi` grant to read it too: an editor has no access outside the areas granted to them. |
| `GET /api/dashboard` | any admin role (viewer, editor, super_admin); 401 without a session, 403 for a student | The "Perlu perhatian" items for the areas the caller may see (applicant counts and the batch for `pendaftaran`, unread messages for `komunikasi`); counts and links only, never cached. [`admin-ia.md`](admin-ia.md#33-dashboard-hanya-perlu-perhatian-dan-tindakan-cepat). |
| `POST /api/public/contact` | the Astro Worker, through the `PublicApi` service binding only | Not on the public face at all (404 there). Turnstile and `RL_CONTACT` as above; see [`public-api.md`](public-api.md). |

### Error shapes

`{ error: <code>, message?: <Indonesian text for the user>, ... }`. Codes used by the auth surface: `json_required` 415, `body_too_large` 413, `forbidden` 403 (with `reason`: the Origin check), `captcha_failed` 403, `captcha_unavailable` 503, `rate_limited` 429 (with `Retry-After` and `retryAfterSeconds`), `service_unavailable` 503 (a rate limit binding is missing), `email_unavailable` 503, `invalid` 400 (with `fieldErrors`), `not_found` 404. Better Auth's own errors keep its shape (`{ code, message }`).

## Registration contract

`POST /api/auth/register`, for the portal's registration page (a later milestone) or anything else that wants to register a student.

```http
POST /api/auth/register
Content-Type: application/json
X-Turnstile-Token: <token from the widget, data-action="register">

{ "name": "Sari Dewi", "email": "sari@example.org", "password": "at least 8 characters",
  "confirmPassword": "optional, checked when sent", "callbackURL": "/login?verified=1",
  "website": "" }
```

| Field | Rule (legacy `app/(auth)/register/actions.ts`, same wording) |
| --- | --- |
| `name` | trimmed, 2 to 120 characters: "Nama minimal 2 karakter", "Maksimal 120 karakter" |
| `email` | trimmed, lowercased, a valid address of at most 254 characters: "Format email belum benar" |
| `password` | 8 to 128 characters: "Password minimal 8 karakter", "Password maksimal 128 karakter". The legacy form allowed 200; 128 is Better Auth's bound and the one the SPA already states (`spa/src/lib/validation.ts`, pinned by `test/spa-contract.test.ts`), so the code keeps one rule (`PASSWORD_MAX_LENGTH` in `src/auth/factory.ts`; change it with the SPA constant). |
| `confirmPassword` | optional; when sent it must equal `password`: "Konfirmasi password tidak cocok" |
| `callbackURL` | optional; where the verification link sends the browser, and where the "you already have an account" email links. A path on this origin or a trusted origin (403 otherwise). Use the sign-in page. |
| `website` | honeypot, a field humans never see. Anything in it gets the success answer and creates nothing. |

Answers: **200** `{ "ok": true, "message": "Pendaftaran diterima. Cek email kamu untuk langkah berikutnya (periksa juga folder spam)." }` for a new address, for an address that already has an account, and for a honeypot hit: identical status, body and headers, so the form cannot be used to find out who is registered. **400** `{ error: "invalid", message: "Periksa kembali isian formulir.", fieldErrors: { name?: [...], ... } }`. 403 (Turnstile or `callbackURL`), 415, 429, 503 as above.

What the address's owner receives: a new address gets the verification email (24 hours). An address that already has an account (verified or not) gets an **"Akun kamu sudah ada"** email with a link to `callbackURL` and a pointer to "Lupa password". No second account is created and nothing about the existing one changes, including its password. The role is always `student`: it is not an input.

Pre-registration squatting (someone registers your address first, with a password they know): the account cannot be used until the address is verified, and nobody can verify it but the mailbox owner. If the owner clicks an unsolicited verification link they would verify the squatter's account, which is why the email says to ignore it if they did not register. If the owner registers themselves later they get the "already exists" email, and "Lupa password" replaces the squatter's password and verifies the address in one step (`test/auth.test.ts`). Not mitigated further: it would need a pending-registration table, and the account holds nothing until the student fills the application.

## Turnstile

Server-side Siteverify through `fetch` (`src/security/turnstile.ts`), 5 second timeout, `remoteip` from `CF-Connecting-IP`.

* The SPA sends the widget token in the **`X-Turnstile-Token`** header, once per request (a token works once; reset the widget after a failure). The widget needs `data-action` set to the value in the [table](#public-auth-routes); Siteverify echoes it back and a token minted for another form is refused. A widget without an action still passes.
* **Fails closed in production**: a missing `TURNSTILE_SECRET_KEY`, Siteverify unreachable, timing out, answering an error or something that is not JSON all refuse the request (503 `captcha_unavailable`); a failed or reused token is 403 `captcha_failed`.
* Outside production (`ENVIRONMENT` is exactly `development` or `test`) **with no secret set**, the check is skipped, so the forms work without a Cloudflare account. With a secret set it is used for real.
* Local keys: Cloudflare's published test secrets work anywhere and need no account: `1x0000000000000000000000000000000AA` always passes (token `XXXX.DUMMY.TOKEN.XXXX`), `2x...AA` always fails, `3x...AA` reports the token as spent. Exported as `TURNSTILE_TEST_SECRETS` and used by the tests (which fake Siteverify; nothing in the test run goes to the network).
* Rate limits are counted before Turnstile, so a bot that fails the challenge still fills its own bucket and cannot hammer Siteverify.
* **The contact endpoint uses it** (`src/public/contact-deps.ts`, the seam of [`public-api.md`](public-api.md#the-seam-for-the-limiter-and-turnstile)): action `contact`, the token from the `X-Sakem-Turnstile-Token` header the Astro Worker forwards, the trusted address from `X-Sakem-Client-Ip` as `remoteip`. A failed, missing or reused token answers `400 turnstile_failed`; no secret in production, or Siteverify unreachable, is a `500` that stores nothing. Any other worker can do the same: `guardTurnstile(env, request, "contact", token)` (the file imports only `./client`) with `checkLimits` and `limitedResponse` from `src/security/rate-limit.ts`.

## Rate limits

Cloudflare rate limit bindings, one per concern, declared in `wrangler.jsonc` (`ratelimits`) with **placeholder** `namespace_id`s (`7801` to `7808`; a number we choose, unique per account, not a resource id: change one if the account already uses it). The numbers live in `src/security/rate-limit.ts` too (`RATE_LIMITS`); a test reads `wrangler.jsonc` and fails if the two differ.

| Binding | Counts | Key | Limit | Used by |
| --- | --- | --- | --- | --- |
| `RL_LOGIN` | sign-in tries | IP + email hash | 5 / 60 s | sign-in |
| `RL_LOGIN_ACCOUNT` | tries on one account from anywhere | email hash | 20 / 60 s | sign-in |
| `RL_REGISTER` | registrations | IP | 10 / 60 s | register |
| `RL_RESET` | link requests | IP | 5 / 60 s | forgot password, resend verification |
| `RL_VERIFY_RESEND` | resends to one mailbox | email hash | 2 / 60 s | resend verification |
| `RL_MAIL_TARGET` | any email to one mailbox | email hash | 3 / 60 s | register, forgot, resend, admin invite |
| `RL_TOKEN` | token redemptions, Google start | IP | 20 / 60 s | reset-password, verify-email, social sign-in |
| `RL_CONTACT` | contact form posts | `contact:<address>`, the address from `X-Sakem-Client-Ip` only | 5 / 60 s | `POST /api/public/contact` (`src/public/contact-deps.ts`). The one limiter of that route: it replaced the `PUBLIC_CONTACT_LIMIT` binding of the first public API PR |
| `RL_BLOG_PREVIEW` | the blog editor's preview (a markdown render per request) | `blog-preview:<user id>` | 60 / 60 s | `POST /api/admin/blog/preview` (`src/api/blog.ts`, [`admin-blog.md`](admin-blog.md)); namespace `7822`, a placeholder like the others. `RL_UPLOAD` (uploads, `7821`) is described in [`uploads.md`](uploads.md) |

* **A 429** carries `Retry-After: 60` and `{ error: "rate_limited", message, retryAfterSeconds }` with the legacy Indonesian copy: "Terlalu banyak percobaan masuk. Silakan tunggu beberapa menit lalu coba lagi." (sign-in), "...pendaftaran..." (register), "Terlalu banyak percobaan. Coba lagi dalam beberapa menit." (tokens), "Terlalu banyak percobaan pengiriman. Silakan tunggu satu menit lalu coba lagi." (contact). The legacy "sekitar satu jam" for forgot-password is now "satu menit", and "Coba lagi sekitar satu menit lagi" for resend, because the windows are a minute.
* **The visitor's address is `CF-Connecting-IP` and nothing else** (legacy bug SAKEM-008: the old limiter keyed on `X-Forwarded-For`, which the client writes). Missing or malformed: one shared `unknown` bucket (over-throttles, never under). Tested by rotating `X-Forwarded-For`.
* Email addresses are never in a key: it is the first 32 hex characters of the SHA-256 of the trimmed, lowercased address. Keys by email are skipped when the body has no email, so junk requests do not share one bucket.
* A classroom behind one address is not locked out by address alone: the IP-only buckets are the email-sending ones and registration.
* **Differences from the legacy limiter**, all because a binding is a 10 or 60 second window counted per Cloudflare location and eventually consistent: it is a brake, not an exact quota. Legacy windows were 5 minutes to an hour (3 registrations per 5 minutes, 3 reset requests per hour), so sustained abuse is allowed more here; Turnstile and the per-mailbox cap make up for it. A per-account lockout over minutes needs a SQLite-backed Durable Object (available on Free); not built.
* **In-memory fallback, for local runs and tests only**: when a binding is absent AND `ENVIRONMENT` is `development` or `test`, a fixed-window counter in the isolate's memory with the same limit and period is used. `wrangler dev` always has the real bindings; the fallback is for someone running the worker without them, and the tests exercise it with `Date` frozen ([Tests](#controlling-the-limiter-clock-in-tests)). **In production a missing binding is a configuration error: the route answers 503 `service_unavailable` and logs the binding's name.**

## Email

Resend's HTTPS API through `fetch` (no SDK), `src/email/`. Free tier: 3,000 a month and **100 a day**.

* **Fails closed in production.** Without `RESEND_API_KEY` or `EMAIL_FROM` nothing is sent, one log line names only the purpose (`[email] provider not configured; verify-email email was not sent`), and the routes that need email answer 503 before creating anything (legacy bug SAKEM-010: the old app printed the link to its logs and reported success). A Resend answer other than 2xx is a failure; 429 is told apart (`provider_rate_limited`, with `Retry-After` when Resend sends one, and Resend's error name, e.g. `daily_quota_exceeded`, in the log).
* **What the API can and cannot report.** The admin invite is sent inside the request and a failure is a **502** with the created user (`email_failed`, or `email_rate_limited` for the quota): never a plain success, and "resend invite" retries. The anonymous flows (register, forgot, resend) send after the response and answer the same for everyone, because reporting a provider failure only for addresses that exist would let anyone enumerate accounts, and the quota is exactly the thing an attacker can exhaust. A runtime provider failure there is logged (status and error name only) and the person can ask again. A *missing configuration* is different: it is global, not a function of the address, so it is reported (503) uniformly.
* **Nothing sensitive in logs.** No recipient, subject, body or URL, ever; a provider error logs `HTTP <status> <Resend's short error name>`.
* **Outside production without a key** the message is kept in memory (`mailbox`, newest 50) and never printed. Tests read `mailbox.messages`; a developer reads `GET /api/dev/mailbox` (exactly `ENVIRONMENT=development`; 404 in production, in tests and for any other value). With a key set, the real send path is used in every environment.
* Templates (`src/email/templates.ts`) are Indonesian, "kamu", HTML and plain text, subjects constant: **Verifikasi email Sakola Kembara** (24 hours), **Reset password akun Sakola Kembara** (30 minutes), both the legacy copy; **Undangan admin Sakola Kembara** (7 days, single use) and **Kamu sudah punya akun Sakola Kembara** are new. User-supplied text (the inviter's name) is HTML-escaped and never in a subject.
* Resend needs a verified domain (SPF, DKIM) before real delivery; that is account work, not tested here.

## Cookies and CSRF

| Setting | Value | Why |
| --- | --- | --- |
| Name, production | `__Host-better-auth.session_token` | The `__Host-` prefix makes the browser require `Secure`, `Path=/` and **no `Domain`**, and refuse to let a sibling subdomain set a cookie of that name. |
| Domain | none (host-only) | The apex (`/portal`, students) and `admin.` (admins) each get their own session. No feature needs one session across both, and a host-only cookie is never sent to the LMS, previews or any other subdomain, so none of them can read it, fixate it or overwrite it ("cookie tossing"). |
| `SameSite` | `Lax` | `Strict` would drop the cookie on the first navigation from an email link or from Google's redirect, and the OAuth state cookie would not come back (`state_mismatch`). `Lax` still keeps it off cross-site `POST`s; the [Origin check](#csrf) is the second layer. |
| `Secure` | always in production | |
| `HttpOnly` | yes | |
| Lifetime | 7 days, refreshed at most once a day | One extra D1 write per active user per day. |
| Development and test | `better-auth.session_token`, not `Secure` | Plain `http://localhost`. |
| `COOKIE_DOMAIN` set (opt-in) | `__Secure-better-auth.session_token`, `Domain=<value>` | Only if another subdomain must read the session (LMS SSO is the case that came up; it has its own token, [`lms-integration.md`](../architecture/lms-integration.md)). `__Host-` cannot carry a Domain, so this gives up the cookie-tossing protection. Leave it empty. |

The earlier skeleton note said production would set `COOKIE_DOMAIN=.sakolakembara.org`. This supersedes it: do not set it.

### CSRF

`src/security/csrf.ts`, mounted on `/api/*` before anything reads a cookie or the database, for every method except `GET`, `HEAD` and `OPTIONS`:

1. `Origin` present: it must be this site's own origin or listed in `TRUSTED_ORIGINS` (exact match; `null` never matches).
2. No `Origin`: `Sec-Fetch-Site` must be `same-origin` or `none`. `same-site` fails: a sibling subdomain is same-site.
3. Neither: `Referer`'s origin, same rule.
4. None of the three: allowed only without a cookie (a non-browser client has nothing to abuse), refused with one.

A refusal is 403 `{ error: "forbidden", reason }` and nothing else runs. `GET`s are exempt because the emailed links open from a mail client, which is a cross-site navigation. Better Auth's own origin check still runs on its routes for cookie-bearing requests; ours is the one for everything else and for the cookie-less sign-in (login CSRF). Mutations also keep requiring a JSON content type, which a cross-site form cannot send.

## Base path and audience

One Better Auth, **two audiences**, two Workers (SAKEM-083, P1a; the portal's design is [`portal-architecture.md`](portal-architecture.md), its contract [`portal-api.md`](portal-api.md)). The admin Worker `sakem-admin` serves the `admin` audience on the admin host; the portal Worker `sakem-portal` ([`wrangler.portal.jsonc`](../../cf/admin/wrangler.portal.jsonc), entry `src/portal/worker.ts`) serves the `student` audience on the apex, under `/portal`. They share the `users`, `session` and `account` tables, so what keeps a student's session out of the admin and an admin's out of the portal is not the database but the three things in the table: the mount point, the cookie name and the signing secret.

| | Admin (`admin.` host) | Portal (apex) |
| --- | --- | --- |
| Worker | `sakem-admin` | `sakem-portal` |
| Better Auth's mount point (`basePath`) | `/api/auth` | `/portal/api/auth` |
| Where a failed auth call lands (`errorPath`) | `/auth/error` | `/portal/auth/error` |
| Cookie, development and tests | `better-auth.session_token` | `sakem-student.session_token` |
| Cookie, production | `__Host-better-auth.session_token` | `__Host-sakem-student.session_token` |
| Cookie with `COOKIE_DOMAIN` set (opt-in, leave unset) | `__Secure-better-auth.session_token` | `__Secure-sakem-student.session_token` |
| Signing secret | `BETTER_AUTH_SECRET` of `sakem-admin` | `BETTER_AUTH_SECRET` of `sakem-portal`, **a different value** |
| Google redirect URI | `https://<admin host>/api/auth/callback/google` | `https://<apex>/portal/api/auth/callback/google` (the host of the request: nothing is configured) |
| Rate limit bindings | `wrangler.jsonc`, namespaces `78xx` | `wrangler.portal.jsonc`, its own copies, namespaces `79xx` |
| Who may use the data routes | by role and area (`requireArea`, `src/auth/guard.ts`) | role `student` only (`requireStudent`, `src/portal/guard.ts`): any other role is `403 student_only` |

* **The route table is the same.** The table of [public auth routes](#public-auth-routes) is `AUTH_POLICIES`, one list for both Workers: read every `/api/auth/` in it as `/portal/api/auth/` for the portal. The same limits, the same Turnstile actions, the same error codes, the same cookie attributes. Registration is `POST /portal/api/auth/register`; its `callbackURL` should be `/portal/login?verified=1`, the reset link's `redirectTo` is `/portal/reset-password`, and Better Auth's error page is `/portal/auth/error`.
* **Why the secret must differ, not only the cookie name.** A session token is a row of the shared `session` table, and the cookie's *name* is not part of its signature: a portal cookie renamed to `better-auth.session_token` is valid on the admin if both Workers sign with the same secret (`test/portal-auth.test.ts`, "WHY the secrets must differ", does exactly that on purpose). With two secrets the renamed cookie is refused, and a verification link minted by one Worker verifies nothing on the other. The deployed secrets are a deploy step that no test can see: the deploy ticket must set two different values and the runbook must say so ([`portal-architecture.md`](portal-architecture.md#12-before-go-live), item 3). Locally both Workers read the same `.dev.vars`, so they share one secret there; the cookie names still differ, which is what keeps the two dev servers (same `localhost`, cookies ignore the port) from signing each other out.
* **Any account can sign in on the apex.** The portal does not turn an admin account away at sign-in: `GET /portal/api/me` answers its role and the SPA shows the "this is an admin account" screen that links to the admin host; every data route answers `403 student_only`. The reverse is the admin's existing behaviour (a student can sign in on the admin host and every admin route refuses them).
* **Two Google OAuth clients**, one per Worker (a leaked portal secret stays away from admin sign-in); Google stays optional and off until both variables exist, and the [account-linking rules](#account-linking) apply unchanged.
* **What changed in the code**, so the admin stays byte for byte what it was: `src/auth/factory.ts` exports `ADMIN_AUDIENCE` and `STUDENT_AUDIENCE` (`{ name, basePath, errorPath, cookiePrefix }`) and `createAuth(env, { baseURL, waitUntil, audience })` defaults to the admin's; `src/auth/session.ts` has `createAuthContext(audience)` (and `authContext` is the admin's); `src/auth/gate.ts` has `createAuthGate(basePath)` and `findPolicy(method, path, basePath)` (`authGate` and the one-argument `findPolicy` are the admin's); `src/auth/register.ts` has `createRegisterStudent(basePath)` (`registerStudent` is the admin's). `src/worker.ts` is untouched. `src/portal/worker.ts` mounts `createAuthContext(STUDENT_AUDIENCE)`, `createAuthGate(STUDENT_AUDIENCE.basePath)` and the registration route under `/portal/api/auth`.
* **Tests.** `test/portal-auth.test.ts` runs the whole table under the portal's base path (an unlisted route does not exist, JSON only and the body cap, Turnstile on the four routes, email required where it is sent, the rate limits, the address from `CF-Connecting-IP` only), the registration, verification, sign-in, `me` and sign-out flow, forgot password, the cookies in development and production, the Google redirect URI of each host and the whole Google flow, and the separation of the two audiences (a cookie of one is nobody on the other, with and without a renamed cookie). `test/portal-foundation.test.ts` covers the guard of a student route (session, role, verified address, limiter by user id), the headers of every answer, `config` and `me`. The existing admin suites run unchanged.
* **Not decided here:** the daily email counter and the `503 email_quota` answer of register, resend and forgot ([`portal-architecture.md`](portal-architecture.md#92-the-resend-quota-at-the-season-peak)) belong to the application API task; the table above does not have them yet.

## Account linking

Better Auth's defaults, on purpose (no `trustedProviders`, no `requireLocalEmailVerified: false`):

* Google links to an existing local account **only if that account's email is already verified**. An unverified local account is refused (`/auth/error`), nothing is linked, no session is made. Ruang Bakat had to loosen this (RBT-D76) because its sign-up never verified; here it does.
* Google must report `email_verified` as exactly `true`, otherwise nothing is created, updated or linked (legacy `decideGoogleLink`).
* A Google sign-in never changes a role, and a linked password keeps working. A new Google user is a verified `student`.
* Difference from legacy, to settle before cutover: the legacy app linked Google to an *unverified* local student row and **cleared its password**. Here the case is refused until the address is verified. Legacy students who never verified will meet it.
* Difference from legacy, forgot password: legacy sent nothing to a Google-only account or to an unverified one. Here the reset link is sent to any existing account and **sets** a password if there was none (Better Auth creates the credential account). That is safe because redeeming it proves control of the mailbox (and verifies the address), and it is how an invited admin gets a password. A person who signed up with Google can therefore add a password this way.
* A deactivated account cannot get a session through Google either (the session hook), and is sent no reset or verification email.
* The Google account chooser is always shown (`prompt: select_account`), as in legacy, for shared devices.

## Sessions

Database-backed, no cookie cache: every request reads the session and the user row, and an editor's area grants, from D1, so a demotion, a revoked grant or a deactivation applies to the very next request (tested). A session ends when: the user signs out; the password is reset (every device); the account is deactivated; it expires (7 days). A deactivated account is refused at three points: session creation (`databaseHooks.session.create.before`, which every way of signing in passes through), `currentUser` (a session that raced the deactivation), and the deletion of its sessions.

## Admin users

All routes need the `sistem` area (super_admin). Every mutation and its audit row commit in one `db.batch`.

| Route | Does |
| --- | --- |
| `GET /api/admin/users` | Admins with `status` (`active`, `invited`, `deactivated`), `emailVerified`, `deactivatedAt`, `lastSessionAt`, `updatedAt`, `areas` (editors only). Students are not listed. Since SAKEM-082 it takes `page`, `pageSize`, `sort`, `role`, `status` and `q` (an email prefix) and answers `{ items, page, pageSize, total }` (`users` repeats `items`): [`admin-sistem.md`](admin-sistem.md#42-the-list). |
| `GET /api/admin/users/:id` | One admin, `{ item }`, with an `ETag` (the admin's `updatedAt`). |
| `PUT /api/admin/users/:id` | The edit form as one change: `{ name, role, areas }` with `If-Match` (428 without, 409 `stale`), one transaction, one `admin.update` audit row; 409 `last_super_admin` with the `role` field. [`admin-sistem.md`](admin-sistem.md#43-the-edit-form-one-put). |
| `POST /api/admin/users` | `{ email, name?, role, password?, areas? }`, `role` one of `viewer`, `editor`, `super_admin`; `areas` only for an editor, saved with the account. **Without `password` it is an invitation**: the account exists (unverified, no password) and an email carries a 7-day link; opening it verifies the address and creates the account. **With `password`** the account is **verified at once and can sign in right away**, and no email is sent (SAKEM-089: [why that is safe](#admins-and-email-verification)). 201 `{ item, user }`, plus `email: { sent: true, kind: "invite" }` for an invitation only; 409 `email_taken` for an address with any account (students are not promoted, or verified, here); 400 `invalid`, which includes the role `student`; 503 when production has no email provider **and this is an invitation** (a password needs no email); **502** with the created user when the invitation's email did not go out. |
| `PATCH /api/admin/users/:id` | `{ role?, name? }`. Moving away from `editor` removes that user's area grants in the same transaction. 409 `last_super_admin` (legacy message) when it would leave no super_admin who can sign in ([the rule](#the-last-super_admin)). No change = 200 and no audit row. |
| `POST /api/admin/users/:id/deactivate` | Sets `deactivated_at`, deletes the sessions and any outstanding reset or invite links. Idempotent. 409 `cannot_deactivate_self`, 409 `last_super_admin`. |
| `POST /api/admin/users/:id/reactivate` | Clears it. They sign in again; old sessions are not restored. Idempotent. |
| `POST /api/admin/users/:id/resend-invite` | Only while `status` is `invited`: a new link, the old one stops working. 409 `not_pending_invite` otherwise. |
| `PUT /api/admin/users/:id/areas` | Part A. |

### Admins and email verification

**An admin never has to verify an email address** (SAKEM-089; Dzul, 2026-10-13: an admin created or invited by a super_admin can be active without verifying; the invitation is the trust). **Students are unchanged**: they register themselves, `requireEmailVerification` stays on, and an unverified student still gets 403 `EMAIL_NOT_VERIFIED` and a fresh link. There is still no public admin sign-up.

**Where it is done.** At the two places an admin gets a way in, not at sign-in: the global requirement is not loosened and nothing special-cases a role in the sign-in route.

| How the admin gets in | What makes them verified | Sign-in meanwhile |
| --- | --- | --- |
| Created with a password | `email_verified = true` in the same insert as the user, with the credential account in the same batch (`src/api/admin-users.ts`). No email is sent, so this path does not need an email provider either. | 200 straight away |
| Invited (no password) | The account starts unverified and with no credential account. Opening the link and choosing a password (`POST /api/auth/reset-password`) makes Better Auth create the credential account, and `onPasswordReset` (`src/auth/factory.ts`) sets `email_verified`. Asking for a new password through "Lupa password" instead does exactly the same, since it is the same endpoint: the mailbox is the proof either way. | 401 `INVALID_EMAIL_OR_PASSWORD` before (nothing to sign in with, the answer of a wrong password), 200 after |
| `pnpm first-admin` | Verified in its insert, as before. | 200 |

**Why it is safe to take a super_admin's word.** Only a signed-in super_admin (`sistem`, write) can create or invite an admin. The role of the new row is fixed on the server: the body's role is checked against the three admin roles (`student` is a 400), and an address that already has an account of any role is a 409, so this route can neither verify nor promote a student. The public sign-up (`POST /api/auth/register`) makes students only, the role is not an input there and Better Auth refuses one, and Better Auth's own `sign-up/email` is not exposed. A deactivated account is still refused by every method, whatever its verification.

**The invariant the rule relies on:** every admin who has an account is verified. The two paths above and the first-admin command keep it; migration `0011` established it for rows made before (its last statement verifies the admins who already had a way in). The view of [the last super_admin](#the-last-super_admin) therefore does not ask for verification. A row that breaks the invariant (an admin with an account and `email_verified = 0`) can only come from SQL run by hand; it would count there and still be refused by the sign-in route. Nothing in the app makes one.

**What a mistyped address costs.** The password path sends no email, so a typo in the address sends nothing to anyone, and the account is the one the super_admin typed, with the password they typed. Before, the owner of the mistyped mailbox would have had to open the verification link first, which also needed no knowledge of the password. Now they need nothing: if they have a Google account on exactly that address, "Sign in with Google" links to the (verified) local account and signs them in with the role they were given. That exposure existed before in a narrower form (open the link, then use Google); it is wider now. Two ways to avoid it: check the address (the form says so), or **invite instead** (the link only reaches the mailbox that was typed, and nothing exists to link to before it is opened). Whether to keep it that way is an open decision for Dzul ([`admin-sistem.md`](admin-sistem.md#open-decisions), item 11); the code does not decide it.

**The other flows, for an admin** (`test/admin-no-verify.test.ts`):

* *Forgot password*: the same answer for an admin and for an address nobody has; the email goes only to a real, not deactivated account. Unchanged.
* *Resend verification* (`POST /api/auth/send-verification-email`): Better Auth answers 200 identically for an unknown address and for an already verified one, and sends nothing for either, so a verified admin gets the same neutral answer. An invited admin (unverified, no account) who asks is sent an ordinary verification email: opening it verifies the address and nothing more, since it makes no account, so they still accept the invitation to sign in.
* *Google*: the policy is unchanged (it links only to a local account whose address is verified, and only when Google says `email_verified`). A password-made admin is verified, so Google works for them at once. An invited admin who has not opened the link is not verified and has no account, so Google is refused (`/auth/error`) until they accept.
* *Invite emails* still go through the fail-closed email module: an invitation in production without a provider is a 503 and nothing is created; a failed send is a 502 with the created user and "resend invite" retries.

### The last super_admin

Pengaturan is the only place admins are invited, given areas or deactivated, so the system must never be left without a super_admin who can open it. The rule, since SAKEM-087 (migration `0010_last_super_admin_signin.sql`, its view replaced by `0011_admin_signin_without_verification.sql`): **the last super_admin who can sign in can be neither demoted nor deactivated.**

**Who "can sign in".** A super_admin counts when both hold. They are what the sign-in itself enforces for an admin, so the count cannot say "yes" for someone who would be turned away:

| Condition | Why it is the sign-in's own condition |
| --- | --- |
| `deactivated_at` is null | The session hook (`databaseHooks.session.create.before` in `src/auth/factory.ts`) refuses a session to a deactivated account, by every method. |
| an `account` row exists | A password (`credential`) or a linked Google account. An invitation nobody has accepted has none: the invite link is what creates the credential account. |

Not part of it any more: `email_verified`. Migration `0010` asked for it as a third condition, because `requireEmailVerification` turns an unverified account away. Since SAKEM-089 an admin never has to verify an address and every admin with an account is verified ([above](#admins-and-email-verification)), so for an admin it is not a gate any more; students are not super_admins and never enter the view.

The first version of the rule (migration `0006`) asked only for `deactivated_at is null`, so an invitation nobody had opened counted. The only super_admin who could sign in could then step down while the other had never accepted, and nobody could open Pengaturan again.

**One definition, two readers.** It lives in one place, the view `signable_super_admins` (the ids of the super_admins who can sign in). The trigger `users_keep_one_super_admin` (`0010`) and the API (`wouldLeaveNoSignableSuperAdmin` in `src/api/admin-users.ts`) both read the view, so the friendly 409 and the guarantee underneath it cannot drift apart. Changing the definition means a new migration that replaces the view: that is what `0011` did, and the trigger followed without being replaced, because it reads the view by name.

**What it does.** The API answers 409 first, from one read (is this person one of them, and is there another?), before anything is written. Underneath, the trigger aborts any `UPDATE` of `role` or `deactivated_at` that would take the last one out, inside the same transaction, so two super_admins demoting or deactivating each other at the same moment cannot both succeed (tested with concurrent requests, with an unopened invitation waiting as the tempting third: one 200, one 409) and neither can a script. Messages and status codes are the legacy ones.

**What it does not guard.** Someone who cannot sign in anyway (a pending invitation, a deactivated account) takes nobody away when they are demoted or deactivated, so that is allowed. Statements that change the two conditions by another route are not guarded either, as before: no API route deletes a user or an account or unlinks a provider (Better Auth's `delete-user`, `change-email` and `unlink-account` are not exposed, see the route table), and a direct `DELETE` or `UPDATE` by the owner on the database is the owner's to do carefully. The list's **Aktif** now means exactly "can sign in" for a super_admin too (has an account, not deactivated), so the old mismatch (an admin created with a password showing "Aktif" while unable to sign in) is gone.

**Deploy order.** `0010` came before the Worker that reads the view (the view did not exist before). `0011` goes the other way round: ship the Worker of SAKEM-089 first, then apply `0011`. The new Worker already makes admins verified, so it satisfies the old view as well (an admin it creates counts under both). The old Worker on the new view would count an admin created with a password and not yet verified as one who can sign in, which it cannot there: a window to avoid, not a failure. `0011` replaces the view and does not touch the trigger; its last statement sets `email_verified = 1` on admins who already had an account (nothing, on an empty database). After applying it to a real database, check the guard is there and the view is the new one:

```sql
SELECT type, name FROM sqlite_master WHERE name IN ('signable_super_admins', 'users_keep_one_super_admin');
-- two rows: a view and a trigger
SELECT sql FROM sqlite_master WHERE name = 'signable_super_admins';
-- the text asks for deactivated_at and an account, and does not mention email_verified
```

**Invite links** are Better Auth reset tokens (same table, same hashing, same `/reset-password` endpoint), created by us with a 7-day life instead of 30 minutes. Redeeming one sets the password, marks the address verified, ends any session and is single use. The SPA route that receives it is `/reset-password?invite=1&token=...`.

Deactivation replaces the legacy delete: the audit trail keeps pointing at a real row, and a mistake is reversible. Nothing deletes a user.

## Audit

Written by auth (the person is the actor): `student.register` (metadata `{ via: "email" | "google" }`), `user.email_verified`, `user.password_reset`. Written by Pengaturan (the super_admin is the actor, with their id and email): `admin.create` (`{ email, role, mode }`, never a password), `admin.update` (`roleFrom`, `roleTo`, `areasRemoved`, `nameChanged`, the area grants of part A, or, from the edit form, `roleFrom`, `roleTo`, `nameChanged`, `areasBefore` and `areasAfter` for whatever changed), `admin.deactivate`, `admin.reactivate`, `admin.invite_resend`. A failed audit write inside a Better Auth flow is logged and swallowed (it must not undo a password reset); in Pengaturan the change and its row are one transaction.

## Retention

A Cron Trigger (`wrangler.jsonc` `triggers.crons`, `17 3 * * *`, 10:17 in Jakarta) runs `src/cron/cleanup.ts`:

| Table | Deleted |
| --- | --- |
| `session` | `expires_at` in the past |
| `verification` | `expires_at` in the past (reset links, invites, OAuth state) |
| `audit_log` | older than `AUDIT_RETENTION_DAYS` (default **365**, a variable in `wrangler.jsonc`). Empty, `0`, negative, fractional or not plain digits means keep everything: an unreadable setting never deletes evidence. |

At most 5,000 rows per table per run, in chunks of 500 (a run has a bounded cost; the rest goes tomorrow). One log line with counts only: `[cron] cleanup: sessions=N verifications=N audit=N retention=365`. A failure is logged by message and rethrown so the run shows as failed. Deleted rows count as rows written on D1 Free, indexes included: negligible at this scale. The audit log holds registrants' email addresses (`actor_email`), so retention is also a privacy setting: Dzul to confirm 365 days.

## Variables, secrets, bindings

Names only. Secrets are set with `wrangler secret put` (deploy ticket); nothing real is in the repo.

| Name | Kind | Production | Notes |
| --- | --- | --- | --- |
| `ENVIRONMENT` | var | `production` (in `wrangler.jsonc`) | Only `development` or `test` relax anything. |
| `BETTER_AUTH_SECRET` | **secret** | required | 32+ characters. No default; the worker refuses to run without it. |
| `RESEND_API_KEY` | **secret** | required | Missing: email routes answer 503. |
| `EMAIL_FROM` | var | required | e.g. `Sakola Kembara <no-reply@...>`, on the verified Resend domain. |
| `TURNSTILE_SECRET_KEY` | **secret** | required | Missing: Turnstile routes answer 503. |
| `TURNSTILE_SITE_KEY` | var | set per deploy | Public; served by `/api/config`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | **secret** | optional | Google is off until both exist. |
| `TRUSTED_ORIGINS` | var | optional | Extra origins for the Origin check and `callbackURL`. |
| `COOKIE_DOMAIN` | var | leave unset | See [cookies](#cookies-and-csrf). |
| `AUDIT_RETENTION_DAYS` | var | `365` | |
| `DB`, `ASSETS` | bindings | | |
| `RL_LOGIN`, `RL_LOGIN_ACCOUNT`, `RL_REGISTER`, `RL_RESET`, `RL_VERIFY_RESEND`, `RL_MAIL_TARGET`, `RL_TOKEN`, `RL_CONTACT` | rate limit bindings | declared in `wrangler.jsonc` | [Table](#rate-limits). |

The portal Worker has its own configuration (`wrangler.portal.jsonc`) with its own `BETTER_AUTH_SECRET` (a different value), its own copies of the seven auth limiters and the four `RL_PORTAL_*` ones, and the variables and secrets of the student portal (`ADMIN_URL`, `PRIVATE_FILES_BUDGET_BYTES`, the optional `PRIVATE_FILES_KEY`): [Base path and audience](#base-path-and-audience) and [`portal-architecture.md`](portal-architecture.md#35-what-must-be-configured-at-deploy).

## Run it locally

```bash
cd cf/admin
pnpm install --frozen-lockfile
cp dev.vars.example .dev.vars   # fake values; ENVIRONMENT=development
pnpm db:migrate:local
pnpm db:seed:local              # optional: one verified sign-in per role (see d1-schema.md)
pnpm dev                        # builds the SPA, then wrangler dev
```

Register and read the link: `curl -s localhost:8787/api/dev/mailbox` (nothing is printed to the console). To exercise Turnstile for real, put one of the test secrets from `dev.vars.example` in `.dev.vars` and send the dummy token. Without `TURNSTILE_SECRET_KEY` the check is skipped. A local `wrangler dev` has the rate limit bindings; without them the in-memory fallback applies.

If you ran the part A migrations before: `pnpm db:migrate:local` applies `0005` (deactivation), `0006` (the trigger), `0010` (the view and the new trigger) and `0011` (the view without the verified-address condition, and the one-off verifying of admins who already had an account) on top; nothing needs wiping. `pnpm db:seed:local` creates a super_admin who can sign in; on an empty database of your own, `pnpm first-admin` does ([`first-super-admin.md`](first-super-admin.md)).

## Tests

`pnpm test` (workerd and a real local D1; Resend and Siteverify are faked, any other outbound request fails the test; the rate limit bindings are Miniflare's in the contract tests and a test double with a held clock everywhere else, see below), `pnpm test:negative` (each safeguard is broken in turn and the tests must fail; restores every file; `--only "rate limit:"` runs the ones about the limiters), `pnpm db:drift`, `pnpm measure`. Counts and numbers are in [Results](#results).

### Controlling the limiter clock in tests

A test that counts ("five tries pass, the sixth is refused") must not depend on what time it is. Miniflare's rate limit binding does: its window is `floor(Date.now() / period)`, so it **ends on the clock** (at :00 for 60 s), not 60 s after the first try, and the counters restart under any test that happens to run across it. The chance is the test's duration over the period, so it grows with machine load and fails as "the sixth attempt was not refused" (SAKEM-088: `[401 x6]` where `[401 x5, 429]` was expected). The binding runs outside the test's isolate, so its clock cannot be faked from the test. What the tests do instead, all in `test/limiter-clock.ts`:

* **Route tests (the default).** `call()` gives the worker a limiter per `RL_*` binding (`limiterBindings()`): the numbers of `RATE_LIMITS`, Miniflare's contract (counters per key, a window per multiple of the period, a refused call is not counted, the argument is `{ key }` and nothing else), and a clock only the test moves. `limiterClock` starts every test at `LIMITER_START` (a window's first millisecond) and stands still: `limiterClock.advance(60_000)` is the next minute, `advance(59_999)` is still the same one, `set(ms)` jumps. Counters are empty before each test (`test/setup.ts`).
* **The in-memory fallback** (`env: { RL_X: undefined }`) reads `Date.now()` and its window runs from the first try. Wrap the scenario in `withFrozenDate(async (clock) => { ... clock.advance(ms) ... })`, which freezes `Date` (only `Date`) at the real time it started and restores it. Do not use it around code that orders rows by their timestamps.
* **`InMemoryRateLimiter`** (the contact seam's double, `src/public/contact-deps.ts`) takes its clock as the third argument: `new InMemoryRateLimiter(5, 60, limiterClock.read)`.
* **The real binding** (`env.RL_X`, or `realLimiterBindings(env)` as the worker's env, or the `PublicApi` entrypoint, which always has it) is used only where the test exists to check it, and only inside `inOneRealWindow(period, async () => { ... })`: a failure with the real window turned during the scenario runs it again from the start (use keys of your own and undo what it wrote), and a failure inside one window is thrown as it is. `test/rate-limit.test.ts` asks the real binding and the double the same questions for each of the ten limiters, so the double cannot drift from the binding without a test noticing.
* Do not wait for a window (`setTimeout` until the minute turns, `Date.now() % 60_000`): move the clock instead. Give a counting scenario a key of its own (`uniqueEmail()`, `freshIp()`, `uniqueIp()`) so no other test's count is in it.

## Results

Machine: Apple M4, Node 22, 2026-10-12. Every timing here is **wall time on a laptop, not Worker CPU**: workerd freezes timers during synchronous code, so CPU cannot be measured locally, and whether native PBKDF2 time counts as CPU on Workers is undocumented. A proxy for ranking, not a verdict against the 10 ms limit.

| Measurement | Result |
| --- | --- |
| `pnpm test` in `cf/admin` (workerd, real local D1 and rate limit bindings) | 712 passed in 26 files, public API and contact tests included (269 after part A, 70 at SAKEM-078). The SPA's own suite, `pnpm test:spa`: 402 passed, unchanged. |
| `pnpm test:negative` | 99 of 99 safeguards make the tests fail (25 from part A, 28 from the public API, 41 for auth, 5 for the contact seam; the auth ones: verification, the Origin guard in three ways, the route table, JSON only and the body cap, Turnstile in four ways, fail-closed email, `X-Forwarded-For` as the address, the per-mailbox cap, no-enumeration, the honeypot, session revocation, the `__Host-` cookie, the last super_admin trigger and its 409, self-deactivation, invite lifetime and revocation, cron retention). |
| `pnpm db:drift` | exit 0, schema and the seven migrations agree. `wrangler d1 migrations apply --local` on a clean state applies all seven, trigger included. |
| Root `pnpm exec tsc --noEmit`, `pnpm test` | exit 0, 229 passed (unchanged). |
| PBKDF2-SHA256 100k, Node (`pnpm measure`) | verify median 8.10 ms, p95 8.34 (n=51); wrong password 8.04; hash 8.13 (n=31) |
| `createAuth()` per request, warm | median 0.19 ms, p95 0.66 (0.10 at SAKEM-078: the new hooks and settings cost 0.1 ms) |
| `emailKey()` (the gate's SHA-256) | median 0.02 ms |
| Local `wrangler dev`, HTTP wall time, medians (includes the dev proxy) | `/api/config` 1.2 ms (n=40) · `/api/me` 3.1 ms (n=40) · sign-in right password 13.1 ms (n=12) · sign-in wrong password 11.9 ms (n=12) · `register` 12.1 ms (n=8) · `request-password-reset`, known address 5.7 ms (n=4) |
| Worker bundle (`wrangler deploy --dry-run`, config valid with eight rate limit bindings, the cron trigger and the vars) | 2893.81 KiB, gzip 497.16 KiB, with the public API (475 KiB gzip at SAKEM-078; the auth code is about 16 KiB of that) |

Reading the numbers: a sign-in is the session baseline (`/api/me` 3.1 ms) plus about 10 ms, of which the hash is 8.1 ms. At SAKEM-078 the same measure was 10.9 ms for sign-in on a 3.6 ms baseline (7 ms above), so the gate, the body read, the SHA-256, the extra `session.create` query and the audit-aware hooks add roughly 2 to 3 ms of wall time, mostly I/O that is not CPU. Registration costs one hash too, and reset costs one (at redemption, not at request). **Sign-in remains the route to watch against the 10 ms CPU limit**; SAKEM-084 on a real Free account decides. If it does not fit: fewer iterations (weaker), or the hash in a second Worker behind a service binding, or the paid plan.

Not measured at all: Siteverify latency (a `fetch`, I/O), the rate limit bindings at the edge, and Resend.

Visual and interaction QA of the SPA was **not** done (no browser by instruction); nothing in this part has a UI.

## Not built

* **The admin SPA speaks Turnstile now (SAKEM-082), but only a real browser and a real site key can settle it.** The sign-in and forgot-password pages draw the widget (`spa/src/components/TurnstileWidget.tsx`, the site key from `GET /api/config`, `action` `login` and `forgot-password`, light theme, Indonesian), hold the button ("Memeriksa…") until there is a token, send it in `X-Turnstile-Token`, and ask for a fresh challenge after every request that used one. `lib/auth-errors.ts` maps `captcha_failed`, `captcha_unavailable` and `email_unavailable`, and `test/spa-contract.test.ts` pins the header, the actions and the three codes against this Worker. Nothing was looked at in a browser and Cloudflare's real script was never loaded (the SPA tests play it); with no `TURNSTILE_SITE_KEY` the SPA draws nothing and sends nothing, which is the local default. The SPA has no resend-verification button yet (the sign-in of an unverified account makes Better Auth send a fresh link by itself), so `resend-verification` is named in `spa/src/lib/captcha.ts` and waits for its page. The student registration page is part of the portal milestone; its API is final. The invite link lands on `/reset-password?invite=1&token=...`, which the existing reset page handles (it does not show invite wording).
* ~~**The Astro contact form forwards no Turnstile token yet.**~~ **Done** (the `cf/web` PR that bound the site to the API Worker): the form renders the widget (`data-action="contact"`), `cf/web/src/lib/contact-submit.ts` sends the token in `X-Sakem-Turnstile-Token` and shows `400 turnstile_failed` as "Verifikasi gagal. Silakan coba lagi."; see [`web-skeleton.md`](web-skeleton.md). It needs `TURNSTILE_SITE_KEY` on the site and `TURNSTILE_SECRET_KEY` here at deploy, and a visitor without JavaScript cannot send a message in production. The admin SPA draws its widget too (above).
* Password change for a signed-in user, session list and "sign out everywhere": Better Auth has them; they are not in the route table, so they answer 404 until they are added on purpose.
* Resend webhooks (bounces and complaints), a daily send counter, per-account lockout over minutes (Durable Object).
* Promoting an existing student to admin (the invite refuses an address that already has an account).
* Legacy password hashes are bcrypt and cannot be verified here (measured about 54 ms): migration needs a forced reset at cutover (the "forgot password" flow works for every migrated account once the address is verified).

**Only a real Free account can settle:** CPU per route (sign-in, registration and reset against 10 ms), whether native PBKDF2 time counts as CPU, Siteverify from a Worker (latency, the real answer shape for a widget with and without `data-action`), rate limit bindings at the edge (per-location counters, `CF-Connecting-IP`), cookie behaviour on the two real hosts (`__Host-` accepted, Google callback with `SameSite=Lax`), Resend domain verification and real delivery, the Cron Trigger firing, and `wrangler secret put` of the secrets above.
