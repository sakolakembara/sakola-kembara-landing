# Authentication

How sign-in works, who can reach what, and how to bootstrap a fresh deployment. If you're touching `auth.ts`, `auth.config.ts`, `proxy.ts`, `lib/auth-helpers.ts`, or `scripts/seed-super-admin.mjs`, start here.

## Providers

Two providers side by side, one job each.

| Provider | Who uses it | Registered in |
| --- | --- | --- |
| **Google OAuth** | Anyone — students and admins alike | `auth.config.ts` — Edge-safe |
| **Credentials** (`id: "credentials"`) | Anyone with a `password_hash` — students who registered locally, admins seeded via CLI | `auth.ts` — Node-only |

Google is registered with `prompt: "select_account"` so a shared device (siblings, a school library) always asks which account to use — silent reuse of the wrong Google account was a real risk in the pre-launch preview.

The Credentials provider does not check role — access control is entirely a middleware + `requireAdmin`/`requireStudent` concern. Any `users` row with a non-null `password_hash` can sign in; Google-only accounts (`password_hash IS NULL`) must go through the Google button.

**Students** can also register a local (email + password) account through `/register`. Signup creates a `users` row with `role: "student"` and a bcrypt-hashed password, then immediately signs the user in via the Credentials provider. See `lib/student-signup-service.ts` + `app/(auth)/register/actions.ts`.

## `users` table

Every account is one row in `users` (see `lib/db/schema/users.ts`).

```ts
role: text("role", { enum: ["student", "viewer", "editor", "super_admin"] })
  .notNull()
  .default("student"),
passwordHash: text("password_hash"),   // bcrypt digest; null when Google-only
image: text("image"),                   // avatar URL from Google
```

Role gates:

| Role | `/portal/*` | `/portal/daftar` | `/admin/*` | `/admin/settings` |
| --- | :-: | :-: | :-: | :-: |
| `student` | ✅ | ✅ | ❌ (bounced to `/portal?error=admin-only`) | ❌ |
| `viewer` | ✅ | ✅ | ✅ (read-only) | ❌ |
| `editor` | ✅ | ✅ | ✅ (mutations) | ❌ |
| `super_admin` | ✅ | ✅ | ✅ | ✅ |

`adminRoles = ["viewer", "editor", "super_admin"]` in the schema file. The helper `isAdminRole()` is the only place this is spelled out — reuse it.

## `accounts` table

OAuth linkage table modelled after the NextAuth Drizzle-adapter shape. Today it does exactly one job: map `(provider, providerAccountId)` → `users.id` so we can re-find the account on subsequent Google sign-ins without a full email match. It's shaped adapter-compatible so future DB-backed sessions cost a migration, not a rewrite.

- Cascades on `userId` — deleting a `users` row wipes its OAuth linkages.
- Stores `refresh_token` / `access_token` / `id_token` even though nothing reads them today; they're free to keep and cheap if we later need Google API access on the user's behalf.

## Sessions

`strategy: "jwt"`. No `sessions` table.

Role is stamped onto the token in the `jwt` callback the first time a user signs in, and re-read on every `trigger === "update"` (e.g. after `/admin/settings` promotes someone):

```ts
async jwt({ token, user, trigger }) {
  if (user?.email) {
    const row = await db.query.users.findFirst({
      where: eq(users.email, user.email.toLowerCase()),
      columns: { id: true, role: true, email: true },
    });
    if (row) {
      token.sub = row.id;
      token.email = row.email;
      token.role = row.role;
    }
  }
  if (trigger === "update" && token.email) { /* re-read role */ }
  return token;
}
```

The `session` callback (in the Edge-safe `auth.config.ts`) copies `role` and `id` onto `session.user` so client-side code and middleware read them without a DB hit.

## Split config: `auth.config.ts` vs `auth.ts`

Auth.js's middleware runs on the Edge runtime, which can't load `pg` or `bcryptjs`. So the config splits in two:

- **`auth.config.ts`** — Edge-safe. Registers only the Google provider (pure HTTP) and the `session` callback. `proxy.ts` imports this file directly.
- **`auth.ts`** — Node-only. Imports `auth.config.ts` and extends it with the Credentials provider (needs `bcrypt` + Drizzle), the `signIn` callback (needs DB upserts), the `jwt` callback that reads the DB, and the `events.signIn` hook that stamps `last_login_at`. Server components, server actions, and the `[...nextauth]` handler import from here.

Never import `@/auth` from a file that could be reached by middleware (anything under `proxy.ts`'s matcher). Use `@/auth.config` there.

## Guards: `requireAdmin` / `requireStudent`

`lib/auth-helpers.ts` exports three server-only helpers. Prefer these over hand-rolled `auth()` + role checks in each action.

| Helper | Redirects when | Returns |
| --- | --- | --- |
| `requireAdmin()` | unauthenticated → `/login`; student → `/portal?error=admin-only` | `{ email, userId, role }` |
| `requireSuperAdmin()` | not super_admin → `/admin/settings?error=...` | same shape |
| `requireStudent(fromPath?)` | unauthenticated → `/login?from=<fromPath>` | `{ email, userId, role, name, image }` |

All three re-read the `users` row so a demoted user loses access mid-session even before their JWT rotates. Use `userId` from the return for audit writes and FKs — never trust the raw session id.

## Sign-in flows

### Google — new user
1. Click "Masuk dengan Google" on `/login`.
2. Google returns to `/api/auth/callback/google` with `profile.email`.
3. `signIn` callback in `auth.ts` looks up the email in `users` — no match, so inserts a new row with `role: "student"`, copies `name` + `image` from Google.
4. Upserts an `accounts` row keyed on `(provider="google", providerAccountId)`.
5. `jwt` callback stamps `sub`, `email`, `role="student"` onto the token.
6. `redirectTo` (from `/login`'s server action) is `safeFrom ?? "/portal"` — new students land on `/portal`.

### Google — existing user
Same flow, but the `users` row already exists. `name` / `image` are refreshed from Google, `role` is **never demoted**. If the account had been promoted to `editor` or `super_admin`, that stays.

### Email + password
Works for anyone with a `password_hash` — students who registered locally, or admins seeded via `npm run seed:super-admin`. The form on `/login` is deliberately neutral (no "admin" label) so the admin path isn't signposted to the public.

1. Submit email + password on `/login`.
2. The Credentials provider's `authorize()` runs:
   - Lowercase-trim the email, look up in `users`.
   - Fail if no row or no `password_hash` (Google-only account).
   - `bcrypt.compare(password, row.passwordHash)`.
3. `jwt` callback stamps `role` (student or one of the admin roles) onto the token.
4. `credentialsSignIn` in `app/(auth)/login/actions.ts` sends the user to `safeFrom ?? "/portal"`. On the next protected request the middleware bounces admins to `/admin` if they landed on `/portal` first.

### Student — register (local)
1. `/register` — name, email, password, confirm. Rate-limited (3 per 5 min per IP).
2. `registerStudent` in `app/(auth)/register/actions.ts` calls `createStudentAccount()` which:
   - Rejects `email_taken` (user should sign in) or `email_taken_no_password` (user should sign in with Google).
   - Otherwise inserts a `users` row with `role: "student"` and the bcrypt hash.
3. Immediately calls `signIn("credentials", ...)` so the user lands on `/portal` already authenticated.

### Admin — password
Admins are seeded via `npm run seed:super-admin` (see below); after that they sign in through the same neutral form as students. The middleware routes them to `/admin` on their first protected request.

### Sign-out
Any surface. `signOut({ redirectTo: "/" })` — sign-out returns to the public homepage.

## Middleware routing (`proxy.ts`)

```ts
const ADMIN_ROLES = new Set(["viewer", "editor", "super_admin"]);

if (isAdminArea && !ADMIN_ROLES.has(role)) {
  return Response.redirect(new URL("/portal?error=admin-only", req.nextUrl));
}
if (isPortalArea && role !== "student" && !ADMIN_ROLES.has(role)) {
  return Response.redirect(new URL("/login", req.nextUrl));
}
```

Matcher: `/admin/:path*`, `/api/admin/:path*`, `/portal/:path*`, `/api/portal/:path*`. Public routes never hit auth at all.

## Local development

```bash
# 1. .env.local
AUTH_SECRET=$(openssl rand -base64 32)
# Google is optional in dev if you'll sign in as an admin via password.
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
# Seed values for the bootstrap super_admin.
SEED_SUPER_ADMIN_EMAIL=you@example.com
SEED_SUPER_ADMIN_PASSWORD=change-me-min-8-chars
SEED_SUPER_ADMIN_NAME=Your Name

# 2. Boot Postgres + migrate + seed
npm run db:up
npm run db:migrate
npm run seed:super-admin

# 3. Dev
npm run dev
```

Sign in at `http://localhost:3000/login` with your seeded email + password (the form is unified — no admin toggle). Students can also self-register at `http://localhost:3000/register`. To try Google, register a Cloud OAuth client (see below) and add `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI.

## Production

1. **Google OAuth client** — one-time. Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → Web application. Authorized redirect URIs:
   - `https://sakolakembara.org/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google` (optional, for local staging tests)
   Configure the OAuth consent screen (external, name = `Sakola Kembara`, scopes = defaults) and **publish** it before real students arrive. Verification is usually not required for the default `openid email profile` scopes.
2. **Populate `.env.production`** on the VPS with `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `NEXTAUTH_URL=https://sakolakembara.org`, `AUTH_TRUST_HOST=true`, and the `SEED_SUPER_ADMIN_*` triple.
3. **First boot** — `docker compose up -d`, then `docker compose exec app npm run seed:super-admin`. This upserts a super_admin row so someone can sign in immediately via the admin password form.
4. **After first sign-in** — remove the `SEED_SUPER_ADMIN_*` values from `.env.production` if you don't intend to rotate through the CLI. The row stays; only the env vars go.

## Handoff to the LMS

The upcoming LMS (`lms.sakolakembara.org`, Django + Nuxt) consumes landing's identity via SSO rather than managing its own users. Landing is the identity provider; LMS auto-provisions a local user with an FK to `landing.users.id` on first sign-in. Contract, endpoints landing must expose, Django/Nuxt implementation guide, and the landing-side checklist are in [`lms-integration.md`](lms-integration.md).

## Migration 0008 — snapshot resync required

`drizzle/0008_unified_auth_and_batches.sql` was hand-written to rename `admin_users → users`, add `accounts`, add `admission_batches`, and extend `student_applications` with `user_id` + `batch_id`. `drizzle/meta/` was **not** regenerated because drizzle-kit's rename detection requires an interactive TTY prompt that can't run in CI.

**After applying 0008 to a fresh dev DB**, run

```bash
npm run db:generate -- --name resync_snapshot
```

in a terminal with a real TTY to refresh the snapshot. Otherwise the next `db:generate` will produce a garbage diff (dropping + recreating unchanged columns).
