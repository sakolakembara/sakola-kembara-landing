# Admin Dashboard — Route Layout

> **Decision (locked).** The admin dashboard lives in **this repo**, as a route group inside the same Next.js app — not as a separate project. Auth is handled by **Auth.js v5** with **two providers**: Google OAuth (used by both students and admins) and a Credentials provider (email + bcrypt password) that only accepts rows whose role is `viewer`, `editor`, or `super_admin`. Role-based gating replaces the earlier `@sakolakembara.org` domain check.
>
> This doc covers the **route + role structure** for `/admin/*`. Auth mechanics (providers, callbacks, session shape, helpers) live in [`../architecture/authentication.md`](../architecture/authentication.md). Data-model detail is in [`data-model.md`](data-model.md).

## Why this shape

- **One Next.js app, three surfaces.** The public site, the signed-in student portal, and the admin dashboard share `lib/`, `components/`, fonts, tokens, and the deploy. All three read from the same Postgres.
- **Route groups** (`(public)`, `(auth)`, `(portal)`, `(admin)`) let each surface own its layout without changing URLs — `/admin` still serves at `/admin`, `/portal` at `/portal`, `/login` at `/login`.
- **Role-based gating** at the middleware + server-action level lets us mix student and admin traffic in one Auth.js session without leaking either into the wrong surface.

## Folder structure

```
app/
├── (public)/                          # public site (unchanged)
│   ├── layout.tsx                     # Navbar + Footer
│   └── ...                            # /, /blog, /donasi, /tim, /gabung-siswa, ...
│
├── (auth)/
│   └── login/
│       ├── page.tsx                   # Google button + collapsible admin form
│       ├── _admin-form.tsx            # email + password client form
│       ├── _google-button.tsx
│       └── actions.ts                 # signIn server action
│
├── (portal)/
│   └── portal/
│       ├── layout.tsx                 # student shell (requireStudent guard)
│       ├── page.tsx                   # home: current-batch CTA + application history
│       └── status/page.tsx            # per-application result view
│
├── (admin)/
│   └── admin/
│       ├── layout.tsx                 # sidebar shell + requireAdmin() guard
│       ├── page.tsx                   # dashboard home (stat cards + recent audit)
│       ├── batches/                   # admission-batch CRUD + publish
│       ├── applications/              # student-application review
│       ├── announcements/, reports/, blog/, team/, resources/
│       ├── messages/, audit/, settings/
│       └── _actions.ts, _sidebar.tsx
│
├── api/
│   └── auth/[...nextauth]/route.ts    # Auth.js handler
│
└── layout.tsx                          # root <html lang="id"> + fonts

auth.config.ts                          # Edge-safe Auth.js (Google-only)
auth.ts                                 # Node Auth.js (adds admin Credentials)
proxy.ts                                # middleware — gates /admin/* and /portal/*
lib/auth-helpers.ts                     # requireAdmin / requireSuperAdmin / requireStudent
```

`(admin)/login/` no longer exists — the sign-in page moved to `(auth)/login/` so both students and admins share one URL.

## Role model

`users.role` is one of `student | viewer | editor | super_admin`. Admin roles are `viewer`, `editor`, `super_admin` (see `adminRoles` in `lib/db/schema/users.ts`).

- **`student`** — can sign in (Google only), reach `/portal/*` and the auth-gated `/gabung-siswa/form`. Cannot reach `/admin/*`.
- **`viewer`** — read-only across `/admin/*`.
- **`editor`** — content mutations (blog, announcements, reports, team, resources, batches, application review).
- **`super_admin`** — everything, plus `/admin/settings` role management.

Gating happens in three places, cheapest first:

1. **`proxy.ts`** — Edge middleware. Redirects unauthenticated users to `/login` and bounces students who reach `/admin/*` to `/portal?error=admin-only`.
2. **`requireAdmin()`** / **`requireSuperAdmin()`** in `lib/auth-helpers.ts` — server-side guard used by every `/admin/*` page and server action. Re-reads the DB row so a demoted user loses access mid-session.
3. **`writeAudit()`** — every mutation appends to `audit_log`; a leaked route is at least traceable after the fact.

## Environment variables

See `.env.example` at the repo root for the authoritative list. Auth-relevant keys:

| Var | Purpose |
| --- | --- |
| `AUTH_SECRET` | Signs the session JWT. Rotate by re-issuing — invalidates all sessions. |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google OAuth client credentials. Required in prod; optional in dev if you only ever sign in as an admin via password. |
| `SEED_SUPER_ADMIN_EMAIL`, `SEED_SUPER_ADMIN_PASSWORD`, `SEED_SUPER_ADMIN_NAME` | Consumed by `scripts/seed-super-admin.mjs` to bootstrap the first admin. |
| `AUTH_TRUST_HOST` | `"true"` in production (behind Caddy). |
| `NEXTAUTH_URL` | e.g. `https://sakolakembara.org`. |

The old `AUTH_MICROSOFT_ENTRA_ID_*` and `AUTH_DEV_PROVIDER_ENABLED` variables are gone.

## Google OAuth client (one-time)

1. Google Cloud Console → **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google` (dev)
   - `https://sakolakembara.org/api/auth/callback/google` (prod)
4. Copy the client ID + secret into `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.
5. On the **OAuth consent screen**, publish the app (or add test users while it stays in `Testing` status). Scopes needed: the default `openid`, `email`, `profile`.

Details on how the callback wires up (upserting `users` + `accounts`, defaulting new sign-ins to `student`) are in [`../architecture/authentication.md`](../architecture/authentication.md).

## Public site impact

Zero URL changes. Adding `(portal)/` and `(auth)/` alongside the existing groups doesn't shift any path.

## Hosting

The dashboard ships on the **same VPS + Docker Compose stack** as the public site (see [`infrastructure.md`](infrastructure.md) and [`../current-state/deployment.md`](../current-state/deployment.md)).

- **App container** serves `/`, `/portal/*`, `/admin/*`, and every API route — no separate process.
- **Postgres** holds `users`, `accounts`, `admission_batches`, `student_applications`, and the rest of the MVP tables.
- **`public/` volume** persists dashboard-uploaded PDFs and images across deploys.
- **Caddy** terminates TLS for `sakolakembara.org`. Google's OAuth callback resolves to `https://sakolakembara.org/api/auth/callback/google`.

## See also

- [`../architecture/authentication.md`](../architecture/authentication.md) — providers, callbacks, session shape, helpers, sign-in flows.
- [`../architecture/student-portal.md`](../architecture/student-portal.md) — the `/portal` surface that lives next to `/admin`.
- [`../architecture/admission-batches.md`](../architecture/admission-batches.md) — how `/admin/batches` and the publish action work.
- [`data-model.md`](data-model.md) — schemas for `users`, `accounts`, `admission_batches`, and the rest.
