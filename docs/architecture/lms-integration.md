# LMS Integration (Django + Nuxt on `lms.sakolakembara.org`)

> **Audience.** The team building the Sakola Kembara LMS. This doc is the contract landing (`sakolakembara.org`) commits to on the auth + user-provisioning boundary. Copy it into the LMS repo when you start.
>
> **Status.** Design locked. Landing-side implementation pending; LMS team can develop against the mocked contract below in parallel.

## The one-sentence design

Landing is the sole identity provider. LMS is a relying party that reads a signed session cookie set on `.sakolakembara.org`, auto-provisions a local Django user with an FK to `landing.users.id` on first sign-in, and gates features by JWT claims — not by blocking the front door.

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
  "role": "student",
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
| `role` | `student` \| `viewer` \| `editor` \| `super_admin` | `student` is the default. The three admin roles indicate a Sakola Kembara staff member; give them read-only access to student data + instructor tools. |
| `acceptedInBatches` | `UUID[]` | Non-empty = alumni or current student. Empty = event-only user. Drives course-content access. |
| `iat` / `exp` | Unix seconds | Enforce `exp`. Reject stale tokens. |
| `iss` | `"sakolakembara.org"` | Must match. |
| `aud` | `"sakolakembara-services"` | Must match. |

### Signing key

**HS256 with a shared secret.** Both apps hold the same `SSO_JWT_SECRET` env var (min 32 bytes, `openssl rand -base64 32`).

```bash
# Both landing and LMS load this from env, never commit to source.
SSO_JWT_SECRET=<same 32-byte base64 on both sides>
```

Rotation: schedule quarterly. To rotate without downtime, publish a new secret, both apps accept OLD-or-NEW for one window, then landing switches signing to NEW-only and LMS drops OLD.

Upgrading to asymmetric (RS256 / EdDSA) is possible later without breaking the contract — the claim shape stays identical.

## Landing endpoints exposed to LMS

Three endpoints. Every one is rate-limited (`5–10 per minute per IP` on the landing side, already in place via `lib/rate-limit.ts`).

### `GET /api/auth/session`

Returns the current session. LMS Nuxt can call this to hydrate SSR without decoding the JWT itself.

```
GET /api/auth/session
Cookie: sakem-session=<jwt>
→ 200 { "authenticated": true, "user": { <same shape as JWT claims minus iat/exp> } }
→ 200 { "authenticated": false }  (no cookie / invalid)
```

### `POST /api/auth/register`

Called by the LMS's own event-registration form (see "Event registration" below). Creates a landing `users` row and sets the shared cookie. Same validation as landing's `/register` page.

```
POST /api/auth/register
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

### `POST /api/auth/signout`

LMS can call this to sign the user out globally. Clears the shared cookie.

```
POST /api/auth/signout
→ 200
   Set-Cookie: sakem-session=; Max-Age=0; Domain=.sakolakembara.org
```

LMS should also expose its own `POST lms.sakolakembara.org/api/logout` that calls this landing endpoint and then clears any LMS-local session storage (unlikely, but future-proofs against LMS adding server-side sessions).

## Django implementation guide

### `lms_users` model

```python
# lms/users/models.py
from django.db import models
from django.contrib.auth.models import AbstractBaseUser
from uuid import UUID

class LandingRole(models.TextChoices):
    STUDENT = "student", "Student"
    VIEWER = "viewer", "Viewer"
    EDITOR = "editor", "Editor"
    SUPER_ADMIN = "super_admin", "Super Admin"

class LMSUser(AbstractBaseUser):
    # Landing owns identity — this is a mirror keyed by FK.
    landing_user_id = models.UUIDField(unique=True, db_index=True)
    email = models.EmailField(unique=True)   # cached; refreshed on each sign-in
    name = models.CharField(max_length=200)  # cached
    role = models.CharField(max_length=32, choices=LandingRole.choices, default=LandingRole.STUDENT)

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

        user, _created = LMSUser.objects.update_or_create(
            landing_user_id=claims["sub"],
            defaults={
                "email": claims["email"].lower(),
                "name": claims.get("name") or "",
                "role": claims.get("role", "student"),
                "accepted_batch_ids": claims.get("acceptedInBatches", []),
            },
        )
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

```python
# lms/courses/decorators.py
from django.http import HttpResponseForbidden

def accepted_student_required(view):
    """Course content — only alumni / current accepted students."""
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return HttpResponseForbidden()
        if not request.user.accepted_batch_ids:
            return HttpResponseForbidden("Not an accepted student.")
        return view(request, *args, **kwargs)
    return wrapped


def admin_role_required(view):
    """Instructor tools — anyone with a landing admin role."""
    def wrapped(request, *args, **kwargs):
        if request.user.role not in {"viewer", "editor", "super_admin"}:
            return HttpResponseForbidden()
        return view(request, *args, **kwargs)
    return wrapped
```

Any endpoint that needs finer control (e.g., "enrolled in this specific event") should combine these with a lookup on the LMS's own `event_registrations` table.

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
    `${config.public.landingUrl}/api/auth/session`,
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
    `${config.public.landingUrl}/api/auth/register`,
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
| Event enrollment (tryout, workshop) | `RequireLandingSession` + local `event_registrations` insert |
| Course content, cohort forums, grades | `@accepted_student_required` |
| Instructor gradebook, roster, submissions | `@admin_role_required` |
| Admin site (`/admin/`) | `role == "super_admin"` — reuse landing's role, don't duplicate |

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
3. Submit → `POST landing.sakolakembara.org/api/auth/register` with `source: "lms"`.
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

Landing env:
```
SSO_COOKIE_DOMAIN=.sakem.test
NEXTAUTH_URL=http://sakem.test:3000
```

LMS Django env:
```
LANDING_URL=http://sakem.test:3000
SSO_COOKIE_DOMAIN=.sakem.test
SSO_JWT_SECRET=<same as landing>
```

**Option B: dev-only shim**

Landing exposes a `POST /api/dev/mint-token` endpoint (only enabled with `NODE_ENV=development`) that returns a JWT the LMS can manually paste into a cookie in DevTools. Faster to boot for LMS-only work, but doesn't exercise the real handshake.

Prefer Option A once the two apps talk to each other.

## Security notes

- **CORS**: `POST /api/auth/register` (and `/api/auth/signout`) must accept requests from the LMS origin. Whitelist `https://lms.sakolakembara.org` (prod) and the dev equivalents. Set `Access-Control-Allow-Credentials: true`. Never `Allow-Origin: *`.
- **CSRF**: Auth.js already handles CSRF for its own routes. The two new landing endpoints (`/api/auth/register`, `/api/auth/signout`) called from another origin need their own CSRF story. Simplest: require a double-submit cookie token, or require the request to originate from `*.sakolakembara.org` via the `Origin` header (weaker but pragmatic).
- **Session revocation**: JWT is stateless — if a student is expelled from the program, they stay authed on LMS until the token expires (up to 30 days). Two mitigations:
  - LMS course-content decorators re-check `accepted_batch_ids` on every request and can also hit `landing/api/auth/session` for the freshest state on sensitive actions.
  - For hard revocation (rare), shorten JWT lifetime and add a refresh flow. Not needed at MVP.
- **Never expose the raw JWT to JS**. HttpOnly cookie only. LMS Nuxt never reads or manipulates the token — it just proxies the cookie to Django.
- **Log user IDs, not emails, in LMS access logs**. Emails are PII; the landing UUID is stable and safe.

## What the landing team commits to

Tracked as a checklist so the LMS team knows what to expect:

- [ ] Auth.js session cookie config: `cookies.sessionToken.options.domain = ".sakolakembara.org"` in production (`localhost` fallback in dev)
- [ ] Session cookie renamed to `sakem-session` for clarity (or a public alias next to the existing name)
- [ ] JWT claims augmented with `role` (already present), `acceptedInBatches`, `iss`, `aud`
- [ ] `GET /api/auth/session` endpoint returning `{ authenticated, user? }`
- [ ] `POST /api/auth/register` endpoint (extracted from the current `registerStudent` server action) with CORS for `lms.sakolakembara.org`
- [ ] `POST /api/auth/signout` endpoint that clears the shared cookie
- [ ] `SSO_JWT_SECRET` published to both apps' env
- [ ] Local-dev `sakem.test` / `lms.sakem.test` recipe documented in landing's README
- [ ] Rate limits applied to the new endpoints (reuse `lib/rate-limit.ts`)

## Open decisions to make before implementation

1. **Instructor role on LMS**. Landing has `viewer`, `editor`, `super_admin`. Should LMS treat all three as instructors, or should there be a distinct `instructor` role? If distinct, does it live on landing (needs schema change) or LMS (needs a promotion UI)? **Recommendation**: reuse landing's admin roles for LMS instructor access initially. Split later if the concerns actually diverge.
2. **What happens to a student who was accepted, then had their acceptance revoked?** The `acceptedInBatches` claim would no longer include that batch. LMS auto-revokes course access on next sign-in. Do we want to preserve their submissions / grades? **Recommendation**: yes, keep the `LMSUser` row + all submissions; just drop them from `active_enrollments`. Never hard-delete learning data.
3. **Multi-batch students** (someone applied Gen 6, was rejected, applied Gen 7, was accepted). Do they get access to Gen 6 materials? **Recommendation**: no — course access is scoped to batches where they were accepted. `acceptedInBatches` already carries the exact list.
4. **Password reset UX**. Only landing knows about passwords. If a student clicks "Lupa password?" on the LMS login redirect page, they're bounced to landing's reset flow. Landing needs a `/forgot-password` page. (This is a landing gap regardless of LMS.)

## Related docs

- [`authentication.md`](authentication.md) — how landing's auth works today (Google + Credentials + JWT sessions).
- [`student-portal.md`](student-portal.md) — the `/portal` experience an accepted student comes from before hitting LMS.
- [`admission-batches.md`](admission-batches.md) — where `acceptedInBatches` comes from.
