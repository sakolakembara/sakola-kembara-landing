# Authentication, email, Turnstile and admin users (SAKEM-081, part B)

How people sign in to the new admin/portal Worker ([`cf/admin`](../../cf/admin)), what protects each route, and how admins are managed. Epic SAKEM-074, milestone M2. **No production change: everything here ran against a local D1 and fake keys** (no Cloudflare account was used, no resource exists, no secret is in the repo). Part A (schema, areas, `requireArea`) is in [`d1-schema.md`](d1-schema.md); the skeleton and its CPU numbers are in [`admin-skeleton.md`](admin-skeleton.md).

Decided by Dzul, not reopened here: passwords stay for students and admins; Google sign-in stays; email verification is required; email goes through Resend; Turnstile on login, registration, forgot-password and contact; Cloudflare rate limit bindings; no public admin sign-up (a super_admin creates or invites admins); students register themselves in the portal.

## Contents

[Flows](#flows) · [Endpoints](#endpoints) · [Registration contract](#registration-contract) · [Turnstile](#turnstile) · [Rate limits](#rate-limits) · [Email](#email) · [Cookies and CSRF](#cookies-and-csrf) · [Account linking](#account-linking) · [Sessions](#sessions) · [Admin users](#admin-users) · [Audit](#audit) · [Retention](#retention) · [Variables, secrets, bindings](#variables-secrets-bindings) · [Run it locally](#run-it-locally) · [Tests](#tests) · [Not built, and what only a real account can settle](#not-built)

## Flows

| Flow | What happens |
| --- | --- |
| **Student registers** | `POST /api/auth/register` (Turnstile, limits). Account created as `student`, unverified, no session. A verification email goes out. The answer is the same for every address. |
| **Verify email** | The link in the email (`GET /api/auth/verify-email?token=...`, 24 hours) marks the address verified and redirects to the `callbackURL` the form sent. It does not sign anyone in. Opening it twice is harmless. |
| **Sign in** | `POST /api/auth/sign-in/email`. An unverified account answers 403 `EMAIL_NOT_VERIFIED` and gets a fresh link; a deactivated one 403 `ACCOUNT_DEACTIVATED`. |
| **Forgot password** | `POST /api/auth/request-password-reset`, same answer for every address. The link (30 minutes, single use) goes to the SPA with `?token=`; `POST /api/auth/reset-password` redeems it. **All sessions of that user end.** Redeeming proves the mailbox, so it also marks the address verified. |
| **Google** | `POST /api/auth/sign-in/social` then the callback. Disabled (and the route absent) until both Google variables are set. See [account linking](#account-linking). |
| **Admin invited** | A super_admin posts `POST /api/admin/users`. The invitee gets a link valid 7 days; opening it lands on `/reset-password?invite=1&token=...`, they choose a password, and from then on they sign in like anyone. |
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
| `GET /api/admin/users`, `POST /api/admin/users`, `PATCH /api/admin/users/:id`, `POST /api/admin/users/:id/deactivate`, `.../reactivate`, `.../resend-invite`, `PUT /api/admin/users/:id/areas` | `sistem` area: super_admin only | [Admin users](#admin-users). |
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

* **A 429** carries `Retry-After: 60` and `{ error: "rate_limited", message, retryAfterSeconds }` with the legacy Indonesian copy: "Terlalu banyak percobaan masuk. Silakan tunggu beberapa menit lalu coba lagi." (sign-in), "...pendaftaran..." (register), "Terlalu banyak percobaan. Coba lagi dalam beberapa menit." (tokens), "Terlalu banyak percobaan pengiriman. Silakan tunggu satu menit lalu coba lagi." (contact). The legacy "sekitar satu jam" for forgot-password is now "satu menit", and "Coba lagi sekitar satu menit lagi" for resend, because the windows are a minute.
* **The visitor's address is `CF-Connecting-IP` and nothing else** (legacy bug SAKEM-008: the old limiter keyed on `X-Forwarded-For`, which the client writes). Missing or malformed: one shared `unknown` bucket (over-throttles, never under). Tested by rotating `X-Forwarded-For`.
* Email addresses are never in a key: it is the first 32 hex characters of the SHA-256 of the trimmed, lowercased address. Keys by email are skipped when the body has no email, so junk requests do not share one bucket.
* A classroom behind one address is not locked out by address alone: the IP-only buckets are the email-sending ones and registration.
* **Differences from the legacy limiter**, all because a binding is a 10 or 60 second window counted per Cloudflare location and eventually consistent: it is a brake, not an exact quota. Legacy windows were 5 minutes to an hour (3 registrations per 5 minutes, 3 reset requests per hour), so sustained abuse is allowed more here; Turnstile and the per-mailbox cap make up for it. A per-account lockout over minutes needs a SQLite-backed Durable Object (available on Free); not built.
* **In-memory fallback, for local runs and tests only**: when a binding is absent AND `ENVIRONMENT` is `development` or `test`, a fixed-window counter in the isolate's memory with the same limit and period is used. `wrangler dev` and the tests always have the real bindings; the fallback is for someone running the worker without them. **In production a missing binding is a configuration error: the route answers 503 `service_unavailable` and logs the binding's name.**

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
| `GET /api/admin/users` | Admins with `status` (`active`, `invited`, `deactivated`), `emailVerified`, `deactivatedAt`, `areas` (editors only). Students are not listed. |
| `POST /api/admin/users` | `{ email, name?, role, password? }`, `role` one of `viewer`, `editor`, `super_admin`. **Without `password` it is an invitation**: the account exists (unverified, no password) and an email carries a 7-day link. **With `password`** the account can sign in once its verification email is confirmed (nothing is verified on the super_admin's word: a typo in the address must not hand someone an admin account). 201 `{ user, email: { sent, kind } }`; 409 `email_taken` for an address with any account (students are not promoted here); 400 `invalid`; 503 when production has no email provider; **502** with the created user when the email did not go out. |
| `PATCH /api/admin/users/:id` | `{ role?, name? }`. Moving away from `editor` removes that user's area grants in the same transaction. 409 `last_super_admin` (legacy message) when it would leave no active super_admin. No change = 200 and no audit row. |
| `POST /api/admin/users/:id/deactivate` | Sets `deactivated_at`, deletes the sessions and any outstanding reset or invite links. Idempotent. 409 `cannot_deactivate_self`, 409 `last_super_admin`. |
| `POST /api/admin/users/:id/reactivate` | Clears it. They sign in again; old sessions are not restored. Idempotent. |
| `POST /api/admin/users/:id/resend-invite` | Only while `status` is `invited`: a new link, the old one stops working. 409 `not_pending_invite` otherwise. |
| `PUT /api/admin/users/:id/areas` | Part A. |

**The last super_admin.** The API answers 409 first; underneath, migration `0006_keep_one_super_admin.sql` is a trigger that aborts any `UPDATE` of `role` or `deactivated_at` that would leave no active super_admin. It runs inside the same transaction, so two super_admins demoting or deactivating each other at the same moment cannot both succeed (tested with concurrent requests: one 200, one 409) and neither can a script.

**Invite links** are Better Auth reset tokens (same table, same hashing, same `/reset-password` endpoint), created by us with a 7-day life instead of 30 minutes. Redeeming one sets the password, marks the address verified, ends any session and is single use. The SPA route that receives it is `/reset-password?invite=1&token=...`.

Deactivation replaces the legacy delete: the audit trail keeps pointing at a real row, and a mistake is reversible. Nothing deletes a user.

## Audit

Written by auth (the person is the actor): `student.register` (metadata `{ via: "email" | "google" }`), `user.email_verified`, `user.password_reset`. Written by Pengaturan (the super_admin is the actor, with their id and email): `admin.create` (`{ email, role, mode }`, never a password), `admin.update` (`roleFrom`, `roleTo`, `areasRemoved`, `nameChanged`, or the area grants of part A), `admin.deactivate`, `admin.reactivate`, `admin.invite_resend`. A failed audit write inside a Better Auth flow is logged and swallowed (it must not undo a password reset); in Pengaturan the change and its row are one transaction.

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

If you ran the part A migrations before: `pnpm db:migrate:local` applies `0005` (deactivation) and `0006` (the trigger) on top; nothing needs wiping.

## Tests

`pnpm test` (workerd, a real local D1 and the real rate limit bindings; Resend and Siteverify are faked, any other outbound request fails the test), `pnpm test:negative` (each safeguard is broken in turn and the tests must fail; restores every file), `pnpm db:drift`, `pnpm measure`. Counts and numbers are in [Results](#results).

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
