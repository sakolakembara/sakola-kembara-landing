# LMS Integration (Django + Nuxt on `lms.sakolakembara.org`)

> **Audience.** The team building the Sakola Kembara LMS. This doc is the contract landing (`sakolakembara.org`) commits to on the auth + user-provisioning boundary. Copy it into the LMS repo when you start.
>
> **Status.** Design locked. Landing-side implementation pending; LMS team can develop against the mocked contract below in parallel.

## The one-sentence design

Landing is the sole identity provider. LMS is a relying party that reads a signed session cookie set on `.sakolakembara.org`, auto-provisions a local Django user with an FK to `landing.users.id` on first sign-in, and gates features by JWT claims + LMS-owned state — not by blocking the front door. LMS's role model is fully independent of landing's.

## Why not the alternatives

- **Shared database** — creates tight coupling. LMS can't move DBs or evolve independently, and every schema change to `users` risks breaking LMS.
- **Separate LMS accounts + temp password per accepted student** — gives every user two passwords, and creates the dual-identity problem when an event registrant later applies to the main program: two accounts under the same email that then have to be merged by hand.

Landing-as-IdP is the boundary that avoids both.

## The identity model

| System | Owns | Doesn't own |
| --- | --- | --- |
| Landing (`sakolakembara.org`) | `users` table (email, name, `password_hash`, `role`, Google `accounts` linkage), admissions state (`student_applications`, `admission_batches`) | Learning data (courses, enrollments, grades) |
| LMS (`lms.sakolakembara.org`) | `lms_users` (FK → `landing.users.id`, plus LMS-only prefs), courses, enrollments, submissions, grades, event registrations | User identity, passwords, admissions decisions |

**Golden rule.** LMS never asks a user to set a password. Landing never learns about a course a student is enrolled in. If a feature seems to need to cross that line, it doesn't — it needs a claim added to the JWT or a small landing API endpoint added instead.

## Sign-in flow

```
Student ──▶ https://lms.sakolakembara.org/dashboard
              │
              │ Nuxt: no auth cookie
              ▼
        302 → https://sakolakembara.org/login
                       ?from=https://lms.sakolakembara.org/dashboard
              │
              │ Student signs in on the existing portal
              │ (Google OAuth or email + password — no LMS changes)
              ▼
        Set-Cookie: sakem-session=<JWT>
                    Domain=.sakolakembara.org
                    HttpOnly; Secure; SameSite=Lax
              │
              │ 302 back to lms.sakolakembara.org/dashboard
              ▼
        Nuxt request now carries the cookie
              │
              ▼
        Django middleware:
          1. Read cookie
          2. Verify JWT signature (HS256, shared secret)
          3. Look up or create LMSUser (FK to sub claim)
          4. Attach LMSUser to request.user
              │
              ▼
        Django view renders the dashboard, gating on
        the acceptedInBatches claim + local event_registrations
```

## The auth contract

### Cookie

| Property | Value | Why |
| --- | --- | --- |
| Name | `sakem-session` | Namespaced so it can't collide with other cookies on the domain |
| `Domain` | `.sakolakembara.org` | Shared across all subdomains — this is how SSO works |
| `HttpOnly` | `true` | JS on either side must never read the token |
| `Secure` | `true` (prod), `false` (dev over `http://localhost`) | Prod is TLS-only |
| `SameSite` | `Lax` | Enough for same-site redirects. If you ever need cross-site POSTs from a third party, revisit. |
| `Max-Age` | 30 days (matches landing's Auth.js default) | Keep in sync with landing's session TTL |
| `Path` | `/` | Universal |

### JWT claims (HS256)

```json
{
  "sub": "<landing.users.id — UUID>",
  "email": "budi@gmail.com",
  "name": "Budi Santoso",
  "emailVerified": true,
  "landingRole": "student",
  "acceptedInBatches": ["<admission_batches.id>", ...],
  "iat": 1786600000,
  "exp": 1789192000,
  "iss": "sakolakembara.org",
  "aud": "sakolakembara-services"
}
```

| Claim | Type | Meaning for LMS |
| --- | --- | --- |
| `sub` | UUID | Primary key for `lms_users.landing_user_id`. Stable across sign-ins. |
| `email` | string | Cache locally, but treat landing as source of truth on re-sign-in. Refresh on each auth. |
| `name` | string | Same — cache, refresh on sign-in. |
| `emailVerified` | boolean | Whether landing has confirmed ownership of the email. **Gate on this** for anything that assumes a real inbox (event registration, course access, sending confirmation emails). Google OAuth users are always true; email+password users start false until they click the verification link. |
| `landingRole` | `student` \| `viewer` \| `editor` \| `super_admin` | **Advisory only.** Read this at provisioning time to set sensible defaults (e.g., surface a "you look like Sakola staff, want an instructor role?" prompt to the first LMS admin who onboards them). **Never read it for runtime authorization** — LMS role is fully independent (see below). |
| `acceptedInBatches` | `UUID[]` | Non-empty = alumni or current student. Empty = event-only user. Drives course-content access. |
| `iat` / `exp` | Unix seconds | Enforce `exp`. Reject stale tokens. |
| `iss` | `"sakolakembara.org"` | Must match. |
| `aud` | `"sakolakembara-services"` | Must match. |

**Note on the `landingRole` claim.** It's named with the `landing` prefix on purpose — to make it visually obvious in Django code that this is an *external* system's concept, not the LMS's own role. LMS's own role model lives on `lms_users` (see below) and is the authoritative source for everything the LMS gates.

### Signing key

**HS256 with a shared secret.** Both apps hold the same `SSO_JWT_SECRET` env var (min 32 bytes, `openssl rand -base64 32`).

```bash
# Both landing and LMS load this from env, never commit to source.
SSO_JWT_SECRET=<same 32-byte base64 on both sides>
```

Rotation: schedule quarterly. To rotate without downtime, publish a new secret, both apps accept OLD-or-NEW for one window, then landing switches signing to NEW-only and LMS drops OLD.

Upgrading to asymmetric (RS256 / EdDSA) is possible later without breaking the contract — the claim shape stays identical.

## Landing endpoints exposed to LMS

Three endpoints under `/api/sso/*`. Every one is rate-limited (via `lib/rate-limit.ts`).

**Why `/api/sso/*` and not `/api/auth/*`?** Auth.js owns the entire `/api/auth/*` namespace via its catch-all route handler (`app/api/auth/[...nextauth]/route.ts`). Adding custom routes there would shadow Auth.js's own `/api/auth/session`, `/api/auth/signout`, and `/api/auth/callback/*` endpoints, breaking landing's own client machinery. `/api/sso/*` is a clean namespace for cross-service integration.

### `GET /api/sso/session`

Returns the current session. LMS Nuxt can call this to hydrate SSR without decoding the JWT itself.

```
GET /api/sso/session
Cookie: sakem-session=<jwt>
→ 200 { "authenticated": true, "user": { <same shape as JWT claims minus iat/exp> } }
→ 200 { "authenticated": false }  (no cookie / invalid)
```

### `POST /api/sso/register`

Called by the LMS's own event-registration form (see "Event registration" below). Creates a landing `users` row and sets the shared cookie. Same validation as landing's `/register` page.

```
POST /api/sso/register
Content-Type: application/json
{
  "name": "Budi Santoso",
  "email": "budi@gmail.com",
  "password": "min-8-chars",
  "source": "lms"                 // audit metadata; keep to a short enum
}

→ 201 { "user": { "id": "...", "email": "...", "name": "...", "role": "student" } }
     Set-Cookie: sakem-session=<jwt>; Domain=.sakolakembara.org; ...
→ 409 { "reason": "email_taken" | "email_taken_no_password" }
→ 400 { "fieldErrors": { ... } }
→ 429 { "reason": "rate_limited", "retryAfter": <seconds> }
```

Response cookie is set on the same shared domain so the student is signed in on both apps immediately.

### `POST /api/sso/signout`

LMS can call this to sign the user out globally. Clears the shared cookie.

```
POST /api/sso/signout
→ 200
   Set-Cookie: sakem-session=; Max-Age=0; Domain=.sakolakembara.org
```

LMS should also expose its own `POST lms.sakolakembara.org/api/logout` that calls this landing endpoint and then clears any LMS-local session storage (unlikely, but future-proofs against LMS adding server-side sessions).

## Django implementation guide

### `lms_users` model

The LMS owns its own role enum, wholly independent of landing's. Start
with three values (`learner` / `instructor` / `lms_admin`); grow the enum
freely as new LMS concepts emerge (`mentor`, `author`, `curriculum_reviewer`,
…) without touching landing. Landing's role is stored as an advisory
snapshot only — never read for authorization.

```python
# lms/users/models.py
from django.db import models
from django.contrib.auth.models import AbstractBaseUser

class LMSRole(models.TextChoices):
    LEARNER = "learner", "Learner"
    INSTRUCTOR = "instructor", "Instructor"
    LMS_ADMIN = "lms_admin", "LMS Admin"
    # Grow this enum as LMS needs — mentor, author, etc.

class LandingRole(models.TextChoices):
    """Snapshot of the landing-side role at last sign-in. Advisory only —
    never used for LMS authorization decisions. Kept for UI hints
    (e.g. "this user is Sakola staff") and audit context."""
    STUDENT = "student", "Student"
    VIEWER = "viewer", "Viewer"
    EDITOR = "editor", "Editor"
    SUPER_ADMIN = "super_admin", "Super Admin"

class LMSUser(AbstractBaseUser):
    # Landing owns identity — this is a mirror keyed by FK.
    landing_user_id = models.UUIDField(unique=True, db_index=True)
    email = models.EmailField(unique=True)   # cached; refreshed on each sign-in
    name = models.CharField(max_length=200)  # cached
    email_verified = models.BooleanField(default=False)  # from JWT claim

    # LMS's OWN role — the source of truth for LMS authorization.
    # Everyone starts as LEARNER regardless of landing role. Promotion to
    # INSTRUCTOR / LMS_ADMIN happens via LMS's own admin UI or the
    # `promote_lms_admin` management command.
    role = models.CharField(max_length=32, choices=LMSRole.choices, default=LMSRole.LEARNER)

    # Advisory snapshot of landing role at last sign-in. UI-only — the ONE
    # place that may read this is a "this user is Sakola staff" badge or
    # the provisioning-time default suggestion. Django authorization
    # decorators must NEVER branch on this field.
    landing_role = models.CharField(max_length=32, choices=LandingRole.choices, default=LandingRole.STUDENT)

    # Snapshot of the acceptedInBatches claim at last sign-in. Used for the
    # coarse gate; fresh reads should trust the current JWT, not this field.
    accepted_batch_ids = models.JSONField(default=list)

    # LMS-only preferences go here (notification opts, avatar, etc.)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # This model has no password_hash field — landing owns credentials.
    # AbstractBaseUser requires USERNAME_FIELD; we use email as the natural key.
    USERNAME_FIELD = "email"

    class Meta:
        db_table = "lms_users"
```

### Bootstrap: the first LMS admin

Chicken-and-egg problem: everyone provisioned via SSO starts as `LEARNER`.
Someone has to promote the first `LMS_ADMIN` before that role can be used
through the UI. Solve it with a Django management command analogous to
landing's `seed:super-admin`:

```python
# lms/users/management/commands/promote_lms_admin.py
from django.core.management.base import BaseCommand
from lms.users.models import LMSUser, LMSRole

class Command(BaseCommand):
    help = "Promote an existing LMSUser (identified by email) to LMS_ADMIN."

    def add_arguments(self, parser):
        parser.add_argument("email")

    def handle(self, *args, email, **opts):
        user = LMSUser.objects.get(email=email.lower())
        user.role = LMSRole.LMS_ADMIN
        user.save(update_fields=["role", "updated_at"])
        self.stdout.write(self.style.SUCCESS(f"Promoted {email} to LMS_ADMIN."))
```

Run once on a fresh deployment after the intended admin has signed in at
least once (so the LMSUser row exists):

```bash
docker compose exec lms python manage.py promote_lms_admin admin@sakolakembara.org
```

Subsequent instructor / admin promotions happen in the LMS admin UI, not
via the CLI.

### Custom auth backend

```python
# lms/auth/backend.py
import jwt
from django.conf import settings
from django.contrib.auth.backends import BaseBackend
from lms.users.models import LMSUser

COOKIE_NAME = "sakem-session"
ALGORITHMS = ["HS256"]
ISSUER = "sakolakembara.org"
AUDIENCE = "sakolakembara-services"

class LandingSessionBackend(BaseBackend):
    """Reads the shared cookie, verifies the JWT, upserts an LMSUser."""

    def authenticate(self, request, **kwargs):
        token = request.COOKIES.get(COOKIE_NAME)
        if not token:
            return None
        try:
            claims = jwt.decode(
                token,
                settings.SSO_JWT_SECRET,
                algorithms=ALGORITHMS,
                issuer=ISSUER,
                audience=AUDIENCE,
            )
        except jwt.PyJWTError:
            return None

        # `role` on the LMSUser row is LMS-owned; we DON'T overwrite it on
        # every sign-in — that would demote a promoted instructor back to
        # learner. Set `role` only on initial creation.
        user, created = LMSUser.objects.get_or_create(
            landing_user_id=claims["sub"],
            defaults={
                "email": claims["email"].lower(),
                "name": claims.get("name") or "",
                "email_verified": bool(claims.get("emailVerified", False)),
                "landing_role": claims.get("landingRole", "student"),
                "accepted_batch_ids": claims.get("acceptedInBatches", []),
                # `role` defaults to LMSRole.LEARNER via the model default.
            },
        )
        if not created:
            # Refresh mutable snapshots from the current JWT. Don't touch role.
            user.email = claims["email"].lower()
            user.name = claims.get("name") or user.name
            user.email_verified = bool(claims.get("emailVerified", False))
            user.landing_role = claims.get("landingRole", user.landing_role)
            user.accepted_batch_ids = claims.get("acceptedInBatches", [])
            user.save(update_fields=[
                "email", "name", "email_verified",
                "landing_role", "accepted_batch_ids", "updated_at",
            ])
        return user

    def get_user(self, user_id):
        try:
            return LMSUser.objects.get(pk=user_id)
        except LMSUser.DoesNotExist:
            return None
```

Register in `settings.py`:
```python
AUTHENTICATION_BACKENDS = ["lms.auth.backend.LandingSessionBackend"]
SSO_JWT_SECRET = env("SSO_JWT_SECRET")   # from django-environ or similar
```

### Middleware — "must be signed in"

```python
# lms/auth/middleware.py
from django.http import HttpResponseRedirect
from urllib.parse import urlencode, quote

PUBLIC_PATHS = ("/health", "/static/", "/api/public/", "/oauth/", "/favicon.ico")
LANDING_LOGIN = "https://sakolakembara.org/login"

class RequireLandingSession:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if any(request.path.startswith(p) for p in PUBLIC_PATHS):
            return self.get_response(request)
        # Django's AuthenticationMiddleware runs the backend before us.
        if not request.user.is_authenticated:
            here = request.build_absolute_uri()
            return HttpResponseRedirect(
                f"{LANDING_LOGIN}?{urlencode({'from': here})}"
            )
        return self.get_response(request)
```

### Per-feature gates

Every runtime authorization check reads LMS-owned state (`lms_users.role`,
`accepted_batch_ids`, `email_verified`, LMS's own enrollment tables).
None of them branch on `landing_role`.

```python
# lms/auth/decorators.py
from django.http import HttpResponseForbidden
from lms.users.models import LMSRole

def verified_email_required(view):
    """Anything that assumes a real inbox — event signups, notifications."""
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return HttpResponseForbidden()
        if not request.user.email_verified:
            return HttpResponseForbidden("Verify email first.")
        return view(request, *args, **kwargs)
    return wrapped


def accepted_student_required(view):
    """Course content — only alumni / current accepted students."""
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return HttpResponseForbidden()
        if not request.user.accepted_batch_ids:
            return HttpResponseForbidden("Not an accepted student.")
        return view(request, *args, **kwargs)
    return wrapped


def instructor_required(view):
    """Grading, roster views, cohort announcements."""
    def wrapped(request, *args, **kwargs):
        if request.user.role not in {LMSRole.INSTRUCTOR, LMSRole.LMS_ADMIN}:
            return HttpResponseForbidden()
        return view(request, *args, **kwargs)
    return wrapped


def lms_admin_required(view):
    """LMS-wide admin ops — promoting instructors, managing courses at scale."""
    def wrapped(request, *args, **kwargs):
        if request.user.role != LMSRole.LMS_ADMIN:
            return HttpResponseForbidden()
        return view(request, *args, **kwargs)
    return wrapped
```

Any endpoint that needs finer control (e.g., "enrolled in this specific event", "is instructor OF this specific course") combines these with a lookup on the LMS's own `event_registrations` / `course_instructors` tables.

## Nuxt (LMS frontend) implementation guide

### Cookie propagation

Nuxt runs on the server for SSR — it must forward the `sakem-session` cookie from the incoming request to any fetch calls back to Django. Use Nuxt's `useRequestHeaders` in server components:

```ts
// composables/useAuthedFetch.ts
export function useAuthedFetch<T>(url: string, opts: any = {}) {
  const headers = useRequestHeaders(["cookie"]);
  return useFetch<T>(url, {
    ...opts,
    headers: { ...(opts.headers ?? {}), ...headers },
    credentials: "include",
  });
}
```

Client-side fetches (`useFetch` in setup, or `$fetch` in event handlers) with `credentials: "include"` will automatically send the cookie since it's on the same registrable domain.

### The "not signed in" redirect

Server-middleware pattern:

```ts
// middleware/auth.global.ts
export default defineNuxtRouteMiddleware(async (to) => {
  const config = useRuntimeConfig();
  const publicRoutes = ["/", "/events", "/tentang"];
  if (publicRoutes.includes(to.path)) return;

  const { data } = await useAuthedFetch<{ authenticated: boolean }>(
    `${config.public.landingUrl}/api/sso/session`,
  );
  if (!data.value?.authenticated) {
    const here = `${config.public.lmsUrl}${to.fullPath}`;
    return navigateTo(
      `${config.public.landingUrl}/login?from=${encodeURIComponent(here)}`,
      { external: true },
    );
  }
});
```

### Register form (calls landing)

The LMS shows a Nuxt-native "Daftar Akun" form for event participants. On submit, it POSTs to the landing register endpoint. The cookie lands on `.sakolakembara.org` in the same response, so the browser is authenticated immediately.

```ts
// pages/register.vue submit handler
const submit = async (form: FormValues) => {
  const res = await $fetch<{ user: any } | { reason: string; fieldErrors?: any }>(
    `${config.public.landingUrl}/api/sso/register`,
    {
      method: "POST",
      body: { ...form, source: "lms" },
      credentials: "include",
    },
  );
  if ("reason" in res) {
    // Handle email_taken / email_taken_no_password / rate_limited
    return;
  }
  await navigateTo("/dashboard");
};
```

## Feature gating cheat sheet

| LMS surface | Django decorator / check |
| --- | --- |
| LMS homepage, event catalog | `RequireLandingSession` only (any signed-in user) |
| Free tryout landing pages | `RequireLandingSession` only |
| Event enrollment (tryout, workshop) | `@verified_email_required` + local `event_registrations` insert |
| Course content, cohort forums, grades | `@verified_email_required` + `@accepted_student_required` |
| Instructor gradebook, roster, cohort announcements | `@instructor_required` (LMS role) |
| LMS admin site (promote instructors, manage courses, etc.) | `@lms_admin_required` (LMS role) |

Note: `landing_role` never appears in this table. LMS authorization decisions are made from LMS-owned state only.

## Registration flows

### Path 1 — accepted student, first LMS visit

1. Student is admitted through landing (`admission_batches.results_published_at` fires).
2. Panitia emails them with a link to `https://lms.sakolakembara.org`.
3. Student clicks → LMS has no cookie → redirects to landing `/login?from=lms.sakolakembara.org`.
4. Student signs in on landing (they already have an account from the registration wizard).
5. Landing sets the shared cookie, redirects back to LMS.
6. Django backend upserts `LMSUser` with `accepted_batch_ids` from the JWT. Student lands on the LMS dashboard already in their cohort.

Zero manual provisioning. No temp password.

### Path 2 — event-only registrant (future)

1. Prospect visits LMS event page directly, clicks "Daftar Tryout".
2. Nuxt shows an LMS-styled register form.
3. Submit → `POST landing.sakolakembara.org/api/sso/register` with `source: "lms"`.
4. Landing creates a `users` row (`role=student`, `password_hash` set), sets the shared cookie, returns 201.
5. LMS Nuxt sees the cookie next fetch, Django provisions the `LMSUser`, completes the event enrollment.

If the same prospect later applies to the main program through landing's `/portal/daftar`, they use the same account. No merging ever needed.

### Path 3 — landing student clicks "Ikut Tryout" while signed in

1. Student is already signed in on landing (session cookie exists on `.sakolakembara.org`).
2. Clicks LMS event link.
3. LMS sees the cookie on first request. No login redirect.
4. `LMSUser` is auto-provisioned. Event enrollment recorded locally.

## Local development

Both apps run on `localhost` at different ports:

- Landing: `http://localhost:3000`
- LMS Django: `http://localhost:8000`
- LMS Nuxt: `http://localhost:3100`

The shared-cookie trick doesn't work across ports on plain `localhost` — cookies aren't scoped by port but there's no shared parent domain to attach `Domain=` to. Two options:

**Option A (recommended): a local `.test` domain**

Add to `/etc/hosts`:
```
127.0.0.1  sakem.test
127.0.0.1  lms.sakem.test
```

Landing sets `Domain=.sakem.test` in dev (already the pattern for prod, just a different string). LMS reads the cookie from `lms.sakem.test`. Everything works exactly like production.

Landing `.env.local` additions (on top of the usual `AUTH_SECRET`, `DATABASE_URL`, etc.):
```
NEXTAUTH_URL=http://sakem.test:3000
SSO_JWT_SECRET=<openssl rand -base64 32>
SSO_COOKIE_DOMAIN=.sakem.test
SSO_ALLOWED_ORIGINS=http://lms.sakem.test:3100,http://localhost:3100
```

LMS Django `.env` additions:
```
LANDING_URL=http://sakem.test:3000
SSO_JWT_SECRET=<same base64 string as landing>
SSO_COOKIE_NAME=sakem-session
```

Restart both dev servers after changing the env. Sign in on `http://sakem.test:3000/login`, then visit `http://lms.sakem.test:8000/` — Django's auth backend should see the shared cookie and auto-provision an LMSUser row.

**Option B: dev-only shim**

Landing could expose a `POST /api/dev/mint-token` endpoint (only enabled with `NODE_ENV=development`) that returns a JWT the LMS can manually paste into a cookie in DevTools. Faster to boot for LMS-only work, but doesn't exercise the real handshake. Not implemented yet — build it if the `.test` domain recipe is friction.

Prefer Option A once the two apps talk to each other.

**Single-subdomain fallback**: if `SSO_COOKIE_DOMAIN` is left blank, the SSO cookie is set host-only. Landing still works end-to-end but the LMS won't see the cookie. Fine for landing-only development sessions.

## Security notes

- **CORS**: `POST /api/sso/register` (and `/api/sso/signout`) must accept requests from the LMS origin. Whitelist `https://lms.sakolakembara.org` (prod) and the dev equivalents. Set `Access-Control-Allow-Credentials: true`. Never `Allow-Origin: *`.
- **CSRF**: Auth.js already handles CSRF for its own routes. The two new landing endpoints (`/api/sso/register`, `/api/sso/signout`) called from another origin need their own CSRF story. Simplest: require a double-submit cookie token, or require the request to originate from `*.sakolakembara.org` via the `Origin` header (weaker but pragmatic).
- **Session revocation**: JWT is stateless — if a student is expelled from the program, they stay authed on LMS until the token expires (up to 30 days). Two mitigations:
  - LMS course-content decorators re-check `accepted_batch_ids` on every request and can also hit `landing/api/sso/session` for the freshest state on sensitive actions.
  - For hard revocation (rare), shorten JWT lifetime and add a refresh flow. Not needed at MVP.
- **Never expose the raw JWT to JS**. HttpOnly cookie only. LMS Nuxt never reads or manipulates the token — it just proxies the cookie to Django.
- **Log user IDs, not emails, in LMS access logs**. Emails are PII; the landing UUID is stable and safe.

## What the landing team commits to

Tracked as a checklist so the LMS team knows what to expect. Grouped by
milestone so the SSO handshake can ship independently from the email work.

### Milestone 1 — SSO handshake (blocks LMS integration) ✅ Landed

- [x] Sidecar SSO cookie (`sakem-session`) minted alongside Auth.js's own session cookie. Cookie domain read from `SSO_COOKIE_DOMAIN` — set to `.sakolakembara.org` in prod, `.sakem.test` in dev, blank for single-host dev. (`lib/sso.ts`, `auth.ts` events)
- [x] JWT claims include `sub`, `email`, `name`, `emailVerified` (placeholder `true` until M2 lands), `landingRole` (advisory), `acceptedInBatches`, `iss`, `aud`. (`lib/sso.ts`, `lib/sso-claims.ts`)
- [x] `GET /api/sso/session` endpoint — returns `{ authenticated, user? }`. (`app/api/sso/session/route.ts`)
- [x] `POST /api/sso/register` endpoint — creates a landing student user via the existing `createStudentAccount` service and sets the SSO cookie on the response. (`app/api/sso/register/route.ts`)
- [x] `POST /api/sso/signout` endpoint — clears the shared cookie. (`app/api/sso/signout/route.ts`)
- [x] `SSO_JWT_SECRET`, `SSO_COOKIE_DOMAIN`, `SSO_ALLOWED_ORIGINS` in `.env.example` and validated in `lib/env.ts`.
- [x] Local-dev `sakem.test` / `lms.sakem.test` recipe documented (see "Local development" section below).
- [x] Rate limits on all three endpoints via `lib/rate-limit.ts` (`sso.register`, `sso.signout`; `sso.session` is a bare GET and doesn't need throttling).
- [x] CORS via `lib/cors.ts` — allow-listed origins from `SSO_ALLOWED_ORIGINS`, no wildcards, credentials always on.
- [x] Vitest coverage: `__tests__/sso.test.ts` (roundtrip, tampering, secret rotation, cookie options), `__tests__/sso-claims.test.ts` (student / editor / event-only claim shapes).

### Milestone 2 — Email verification + password reset ✅ Landed

- [x] Vendor: Resend (`resend` npm package). Free tier's 3k emails/mo covers the org's scale for the foreseeable future.
- [ ] Sending domain verified (SPF + DKIM + DMARC on `sakolakembara.org`) — **ops step, not code.** Set up in the Resend dashboard before prod launch. See [`runbook/launch.md`](../runbook/launch.md).
- [x] `lib/email.ts` — Resend wrapper with typed helpers (`sendVerificationEmail`, `sendPasswordResetEmail`), inline-styled HTML shell + plain-text fallback, dev-fallback that prints to stdout when `RESEND_API_KEY` is unset.
- [x] Migration 0011: `users.email_verified_at timestamptz` + index; existing rows backfilled to `now()` in the same migration (`drizzle/0011_users_email_verified_at.sql`).
- [x] Google `signIn` callback stamps `email_verified_at = now()` on account creation (and lifts a legacy password user's unverified state on Google link).
- [x] `POST /api/account/resend-verification` — signed-in user requests a fresh link. Rate-limited 2/hour/user. (`app/api/account/resend-verification/route.ts`)
- [x] `/verify-email?token=...` server-component page — redeems the JWT via `verifyEmailByToken`, idempotent on already-verified accounts, rejects if the email has changed since issue. (`app/(auth)/verify-email/page.tsx`, `lib/account-service.ts`)
- [x] `/forgot-password` page + server action — silent-200 on unknown / Google-only / unverified emails to prevent enumeration. Rate-limited 3/hour/IP. (`app/(auth)/forgot-password/`, `lib/account-service.ts::requestPasswordReset`)
- [x] `/reset-password?token=...` page + server action — validates token, sets bcrypt hash, auto-signs the user in on success. Rate-limited 5/hour/token. (`app/(auth)/reset-password/`, `lib/account-service.ts::resetPasswordByToken`)
- [x] JWT claim `emailVerified` now reads from `users.email_verified_at` (was placeholder `true`).
- [x] Registration wizard action refuses when `!emailVerifiedAt` — points user back to the portal banner.
- [x] Portal home shows a yellow verification banner (`_verify-email-banner.tsx`) with a "Kirim ulang tautan" button that hits `/api/account/resend-verification`. Handles success / rate-limit / error states inline.
- [x] Login page gains a "Lupa password?" link that carries the `from` param through to `/forgot-password`.
- [x] Vitest coverage: `__tests__/account-tokens.test.ts` (purpose-mismatch, tamper, secret rotation), `__tests__/account-service.test.ts` (verify + request + reset happy paths + every rejection reason).

### Milestone 3 — Small landing follow-ups from LMS decisions ✅ Landed

- [x] Revocation transition (accepted → rejected) on `/admin/applications/[id]` is now first-class:
  - Server detects the transition (previousStatus === "accepted" && newStatus === "rejected") and enforces a stricter note requirement (≥ 20 chars — enough to force a real reason).
  - Audit log gets a dedicated `application.revoke` action with `{ previousStatus, revocationReason }` metadata so operators can filter revocations without eyeballing every metadata blob.
  - `/admin/applications/[id]` form is now a client component (`_review-form.tsx`) that renders a red warning banner when the operator selects "rejected" while current status is "accepted", swaps the CTA label to "Cabut Penerimaan", and shows a live character counter against the 20-char minimum.
  - Vitest coverage in `__tests__/application-status-action.test.ts` — normal transitions still emit the plain audit action; revocation with short notes redirects with the specific error; revocation with real notes emits `application.revoke` with the reason in metadata; rejected → rejected (idempotent) is NOT treated as a revocation.

## Locked decisions

Four design decisions were flagged during the initial design pass and have since been resolved. Recording the outcomes here so the LMS team doesn't need to re-litigate them.

### 1. LMS role model is fully independent of landing's

**Decision**: LMS owns its own role enum (`learner` / `instructor` / `lms_admin`, growing to `mentor` / `author` / etc. as needed). Everyone provisioned via SSO starts as `learner`, regardless of landing role. The landing `landingRole` claim is stored on `LMSUser` as an advisory snapshot but is **never read for runtime authorization**. The first `lms_admin` is bootstrapped via `python manage.py promote_lms_admin <email>`; subsequent promotions happen through LMS's own admin UI.

**Why**: coupling LMS permissions to landing's role enum means every future LMS-specific role (`mentor`, `author`, `curriculum_reviewer`) either has to be added to landing's enum (polluting landing with LMS concerns) or requires the LMS to derive-from-landing rules that break whenever landing evolves. Full decoupling keeps both systems free to grow. A Sakola staff member becomes an LMS admin the same way anyone else does: sign in via SSO, then get promoted on the LMS side. Two separate concerns, two separate promotions.

**Impact on code**: `LMSUser.role` = LMS enum, source of truth. `LMSUser.landing_role` = advisory snapshot, UI-only. Every decorator in this doc gates on `LMSUser.role`, never `landing_role`.

### 2. Revoked acceptance: soft-revoke, never hard-delete

**Decision**: When an admin flips `student_applications.status` from `accepted` back to `rejected` (e.g., misconduct, admin error, student drops out), the student's next JWT excludes that batch from `acceptedInBatches`. LMS course-content gates start failing immediately. All `LMSUser` rows, submissions, grades, and forum posts remain in the DB.

**Why**: learning data belongs to the org's institutional memory regardless of the individual's current status. Instructors may still need to grade in-flight submissions. Future decisions (re-admission, appeals) benefit from complete history.

**Impact**:
- No new status enum values on landing — reuse existing `rejected` for revocations. Audit log entries distinguish the transition (`application.rejected` events after `application.accepted` events on the same row).
- Landing UI: reviewer-notes field becomes required when flipping `accepted` → `rejected` (see Milestone 3 checklist).
- LMS: no change beyond the existing decorator logic. Ex-students can't reach course content but their data stays.
- Optional future work: a "self-archive export" for ex-students who ask for a copy. Not MVP.

### 3. Alumni retain permanent course access

**Decision**: Alumni continue to see materials for every batch they were ever accepted in. `acceptedInBatches` naturally carries the full history — no expiry, no time gate.

**Why**: storage is negligible for a foundation this size, and lifetime access to program materials is a real alumni benefit that costs nothing. Multi-batch students (rejected Gen N, accepted Gen N+1; or accepted Gen N, accepted-again Gen N+K) fall out naturally from the same rule.

**Impact**: no code changes. If a real reason to distinguish alumni from current students emerges later (e.g., alumni shouldn't post in the current cohort's forum), LMS adds an `enrollment_status` (`current` | `alumni`) on its own `enrollments` table and derives it from `batch.resultsPublishedAt` age. The JWT stays batch-agnostic.

### 4. Email verification required; bundled with transactional email + password reset

**Decision**: Email+password users must verify their email before submitting the registration wizard, resetting a password, or (on LMS) registering for events or accessing course content. Google OAuth users are auto-verified since Google has already confirmed the address. Verification is delivered via transactional email (Resend recommended, free tier is sufficient for the org's scale). The `/forgot-password` self-service reset is shipped in the same milestone since it needs the same email infrastructure.

**Why**: password reset without email verification is a security hole — an attacker who registered with someone else's email could later reset that person's real account when the victim tries to register. Verification also unlocks trustworthy email delivery for future work (acceptance notifications, event confirmations, LMS mail).

**Impact**:
- New JWT claim `emailVerified: boolean` (see claims table above).
- New Django gate: `@verified_email_required` on any endpoint that assumes a real inbox (see cheat sheet).
- New landing surfaces: `/verify-email`, `/forgot-password`, `/reset-password`, + a persistent banner in `/portal` while unverified.
- Ops: DNS-level setup for the sending domain (SPF + DKIM + DMARC on `sakolakembara.org`) is a one-time ~1-hour job.
- Milestone 2 in the landing checklist above tracks the full scope.

## Related docs

- [`authentication.md`](authentication.md) — how landing's auth works today (Google + Credentials + JWT sessions).
- [`student-portal.md`](student-portal.md) — the `/portal` experience an accepted student comes from before hitting LMS.
- [`admission-batches.md`](admission-batches.md) — where `acceptedInBatches` comes from.
