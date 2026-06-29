# Admin Dashboard — Architecture Sketch

> **Decision (locked).** The admin dashboard lives in **this repo**, as a route group inside the same Next.js app — not as a separate project. Auth uses **Microsoft Entra ID** (the org tenant behind `@sakolakembara.org`) via **Auth.js** (NextAuth v5). Only signed-in users whose email is `*@sakolakembara.org` can reach `/admin/*`.
>
> This doc covers the **route + auth structure**. Data models (DB schema for announcements / applications / reports), the dashboard UI design, and hosting migration are separate work.

## Why this shape

- **One Next.js app, two surfaces.** The public site and the dashboard share `lib/`, `components/`, fonts, tokens, and the deploy. The dashboard reads/writes the same content the public site renders.
- **Route groups** (`(public)`, `(admin)`) let us split layouts cleanly without changing URLs — `app/(admin)/admin/page.tsx` still serves `/admin`, and the admin shell (sidebar, sign-out) doesn't leak into the public layout.
- **Microsoft Entra ID** is the org's existing identity boundary. We don't manage passwords; we don't run a password-reset flow; we don't store secrets. IT off-boards a leaver in Microsoft, and they instantly lose dashboard access.

## Folder structure

```
app/
├── (public)/                          # current public site, moved into a group
│   ├── layout.tsx                     # uses Navbar + Footer
│   ├── page.tsx                       # homepage (was app/page.tsx)
│   ├── blog/
│   │   ├── page.tsx
│   │   └── [id]/page.tsx
│   ├── donasi/page.tsx
│   ├── gabung-siswa/page.tsx
│   ├── kontak/page.tsx
│   ├── program/[id]/page.tsx
│   └── tim/page.tsx
│
├── (admin)/
│   ├── login/
│   │   └── page.tsx                   # "Masuk dengan Microsoft" button
│   └── admin/
│       ├── layout.tsx                 # admin shell: sidebar, top bar, sign-out
│       ├── page.tsx                   # dashboard home (counts, recent activity)
│       ├── blog/
│       │   ├── page.tsx               # list posts
│       │   ├── new/page.tsx           # create
│       │   └── [id]/edit/page.tsx     # edit one post (writes content/blog/*.md or DB)
│       ├── announcements/
│       │   ├── page.tsx
│       │   └── [id]/page.tsx
│       ├── reports/
│       │   └── page.tsx               # PDF uploader → /impact-reports listing
│       ├── applications/              # student registrations
│       │   ├── page.tsx
│       │   └── [id]/page.tsx          # review + accept/reject
│       ├── team/page.tsx              # edit teamMembers
│       └── settings/page.tsx          # org-level config (optional)
│
├── api/
│   ├── auth/
│   │   └── [...nextauth]/route.ts     # Auth.js handlers
│   └── admin/                         # admin-only API routes (mutations, file uploads)
│       ├── blog/route.ts
│       ├── announcements/route.ts
│       ├── reports/route.ts           # POST multipart PDF
│       └── applications/route.ts
│
└── layout.tsx                          # root <html lang="id"> + fonts (unchanged)

auth.ts                                 # Auth.js config — provider + callbacks
middleware.ts                           # gates /admin/* and /api/admin/*
```

**Route-group naming is invisible in URLs.** `(public)` and `(admin)` are organizational only — `/blog` is still `/blog`, `/admin` is still `/admin`. The grouping just lets each group own its own `layout.tsx` (so the admin layout doesn't render Navbar/Footer, and the public layout doesn't render the admin sidebar).

## Auth.js config (`auth.ts`)

```ts
import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

const ALLOWED_DOMAIN = "sakolakembara.org";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID!,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
      // Single-tenant: only this Entra tenant can even reach the consent screen.
      issuer: `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID}/v2.0`,
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    // Belt-and-suspenders: even if a guest user is invited into the tenant,
    // their UPN won't end in @sakolakembara.org, so we reject here.
    async signIn({ profile }) {
      const email = (profile?.email ?? "").toLowerCase();
      return email.endsWith(`@${ALLOWED_DOMAIN}`);
    },
    async jwt({ token, profile }) {
      if (profile?.email) token.email = profile.email.toLowerCase();
      // Future: look up token.role from an `admin_users` table here.
      return token;
    },
    async session({ session, token }) {
      if (token.email) session.user.email = token.email as string;
      // session.user.role = token.role as string | undefined;
      return session;
    },
  },
});
```

## Middleware (`middleware.ts`)

```ts
import { auth } from "@/auth";

const ALLOWED_DOMAIN = "sakolakembara.org";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAdminPage = pathname.startsWith("/admin");
  const isAdminApi = pathname.startsWith("/api/admin");
  if (!isAdminPage && !isAdminApi) return;

  // Not signed in → bounce to /login, preserve where they were heading.
  if (!req.auth) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("from", pathname);
    return Response.redirect(url);
  }

  // Signed in but wrong domain (defense in depth — should already be caught by signIn callback).
  const email = (req.auth.user?.email ?? "").toLowerCase();
  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    return Response.redirect(new URL("/login?error=domain", req.nextUrl));
  }
});

export const config = {
  // Don't run middleware on static assets — let _next, images, etc. through.
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
```

## Auth.js handler (`app/api/auth/[...nextauth]/route.ts`)

```ts
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

## Login page (`app/(admin)/login/page.tsx`)

```tsx
import { signIn } from "@/auth";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { from?: string; error?: string };
}) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-lg p-10 max-w-sm w-full">
        <h1 className="font-[var(--font-display)] text-2xl text-gray-900 mb-2">
          Admin Sakola Kembara
        </h1>
        <p className="text-sm text-gray-600 mb-6">
          Masuk dengan akun Microsoft organisasi (@sakolakembara.org).
        </p>

        {searchParams.error === "domain" && (
          <p className="text-sm text-red-600 mb-4">
            Akun ini bukan akun organisasi Sakola Kembara.
          </p>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("microsoft-entra-id", {
              redirectTo: searchParams.from || "/admin",
            });
          }}
        >
          <button
            type="submit"
            className="w-full px-6 py-3 bg-primary-blue text-white font-semibold rounded-lg
                       hover:bg-primary-blue-dark transition-colors"
          >
            Masuk dengan Microsoft
          </button>
        </form>
      </div>
    </main>
  );
}
```

## Admin layout (`app/(admin)/admin/layout.tsx`)

```tsx
import { auth, signOut } from "@/auth";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Page-level guard: even if middleware is misconfigured, this server component
  // double-checks the session before rendering any admin chrome.
  const session = await auth();
  if (!session?.user?.email?.endsWith("@sakolakembara.org")) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className="w-60 bg-gray-900 text-white p-6 flex flex-col">
        <div className="font-[var(--font-display)] text-xl mb-8">SK Admin</div>
        <nav className="flex flex-col gap-1 text-sm">
          <Link href="/admin">Dashboard</Link>
          <Link href="/admin/blog">Blog</Link>
          <Link href="/admin/announcements">Pengumuman</Link>
          <Link href="/admin/reports">Laporan</Link>
          <Link href="/admin/applications">Pendaftar</Link>
          <Link href="/admin/team">Tim</Link>
        </nav>
        <form
          className="mt-auto"
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button type="submit" className="text-sm text-gray-400 hover:text-white">
            Keluar — {session.user.email}
          </button>
        </form>
      </aside>
      <main className="flex-1 p-10">{children}</main>
    </div>
  );
}
```

## Defense in depth

Four enforcement layers, ordered cheapest to strictest. **All four stay on, even though any one of them could in theory be enough** — when an attacker bypasses one, the next catches it.

1. **Entra ID app registration**: configured as **single-tenant** so the Microsoft consent screen rejects consumer accounts and other tenants at the IdP. This is the strongest guarantee — nothing reaches our server.
2. **`signIn` callback**: rejects any UPN that doesn't end `@sakolakembara.org`. Catches guest users invited into the tenant whose primary email lives elsewhere.
3. **Middleware**: every request to `/admin/*` or `/api/admin/*` needs a valid session + correct email domain. Redirect to `/login` otherwise.
4. **Server-side `auth()` call in admin layout and every mutating server action / API route**: never trust just middleware. Run `const session = await auth();` and re-check the domain before doing anything sensitive.

## Environment variables

Add to `.env.local` for dev and `/opt/sakem/.env.production` on the VPS. All entries below are required unless marked optional:

| Var | Source | Purpose |
| --- | --- | --- |
| `AUTH_SECRET` | `openssl rand -base64 32` | Signs the session JWT. **Rotate by re-issuing — invalidates all sessions.** |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | Entra app registration → Overview | Client ID |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | Entra app registration → Certificates & secrets | Client secret (expires; rotate before expiry) |
| `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID` | Entra portal → Overview → Tenant ID | The Sakola Kembara tenant. Single-tenant means non-org accounts can't even start the OAuth flow. |
| `AUTH_TRUST_HOST` | `"true"` in production (behind Caddy) | Auth.js needs this when not on Vercel |
| `NEXTAUTH_URL` | e.g. `https://sakolakembara.org` | Canonical site URL for OAuth redirects |

`.gitignore` excludes `.env*`, so these stay out of git. The repo will carry a `.env.example` (forthcoming) with the full key list — including the DB / Sentry vars from [`infrastructure.md`](infrastructure.md).

## Azure / Entra setup (one-time, by an IT admin)

1. Sign in to **Azure Portal → Microsoft Entra ID → App registrations → New registration**.
2. **Name**: `Sakola Kembara Admin Dashboard`.
3. **Supported account types**: *"Accounts in this organizational directory only (Sakola Kembara — Single tenant)"*. **Critical** — this is what blocks personal `@outlook.com` accounts at the IdP.
4. **Redirect URI** (Web):
   - `https://sakolakembara.org/api/auth/callback/microsoft-entra-id`
   - `http://localhost:3000/api/auth/callback/microsoft-entra-id` (dev)
5. After creation: copy the **Application (client) ID** and **Directory (tenant) ID** into env vars.
6. **Certificates & secrets → New client secret** → copy the **Value** (only shown once) into `AUTH_MICROSOFT_ENTRA_ID_SECRET`.
7. **API permissions**: keep the default `User.Read` (Microsoft Graph). The OIDC scopes `openid profile email` are auto-included by Auth.js and give us the UPN.
8. Optional: **Enterprise applications → [the app] → Users and groups → require assignment** if you want to limit even further to a named admin group inside the tenant.

## Roles (forward-looking)

Not needed for MVP — anyone in the org with a valid email can do everything. When the team grows, add a small `admin_users` table:

```
admin_users(email PRIMARY KEY, role ENUM('super', 'editor', 'viewer'), created_at)
```

Look up role in the `jwt` callback on first sign-in, cache in the token, gate UI on `session.user.role`. The first super admin gets seeded manually.

## Public site impact

**Zero URL changes.** Moving the existing pages into `app/(public)/` doesn't change any path. The migration is a pure file move + creating `app/(public)/layout.tsx` that wraps children with the existing Navbar + Footer.

A small win: the public site stops re-rendering Navbar / Footer in *each page* (`app/donasi/page.tsx` etc. currently each include `<Navbar /> ... <Footer />` manually) — the public group layout does it once.

## Hosting

The dashboard ships on the **same VPS + Docker Compose stack** as the public site (see [`infrastructure.md`](infrastructure.md) and [`../current-state/deployment.md`](../current-state/deployment.md)). Specifically:

- **App container** serves both `/admin/*` and the public routes — no separate process.
- **Postgres** (in the same Compose stack) holds `admin_users`, `student_applications`, `announcements`, `reports`, `audit_log`. Auth.js sessions stay JWT-only — no `sessions` table.
- **`public/` volume** persists dashboard-uploaded PDFs and images across deploys.
- **Caddy** auto-issues TLS for `sakolakembara.org`. The Microsoft Entra redirect URI is `https://sakolakembara.org/api/auth/callback/microsoft-entra-id`.

No infra split, no cross-origin auth, no separate deploy target.

## What this doc does NOT cover

- **Data models** for announcements / applications / reports — separate doc when the DB engine is picked.
- **Dashboard UI design** — color/spacing follow `docs/design/*`, but specific screens get designed per feature.
- **File-upload pipeline** for report PDFs — depends on hosting decision.
- **Email notifications** (e.g. "Pendaftaranmu sudah diterima") — needs an email provider (Resend / Postmark / SES).
- **Audit log** of admin actions — recommended but post-MVP.
