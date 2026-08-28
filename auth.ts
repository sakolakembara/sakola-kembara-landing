import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { authConfig, googleConfiguredFlag } from "@/auth.config";
import { db } from "@/lib/db";
import {
  accounts,
  adminRoles,
  users,
  type AdminRole,
  type UserRole,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { buildSsoClaims } from "@/lib/sso-claims";
import {
  clearSsoCookieOptions,
  signSsoToken,
  ssoCookieOptions,
} from "@/lib/sso";

// Node-runtime Auth.js setup. Adds the Credentials provider (email + bcrypt
// password against `users`) on top of the edge-safe Google config. Server
// components, server actions, and the [...nextauth] route handler should
// import from here. Middleware imports auth.config.ts directly so the Edge
// runtime doesn't try to load pg / bcrypt.
//
// The Credentials provider is unified: any user with a `password_hash` can
// sign in — students who registered with email + password, or admins who
// were seeded via `npm run seed:super-admin`. Role is not checked here; the
// middleware and requireAdmin/requireStudent guards handle route access.

const credentialsProvider = Credentials({
  id: "credentials",
  name: "Email & password",
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Password", type: "password" },
  },
  async authorize(creds) {
    const email = String(creds?.email ?? "").toLowerCase().trim();
    const password = String(creds?.password ?? "");
    if (!email || !password) return null;

    const row = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    // Google-only accounts have no password_hash and can't sign in this way —
    // they must go through the Google button on /login.
    if (!row || !row.passwordHash) return null;

    const ok = await bcrypt.compare(password, row.passwordHash);
    if (!ok) return null;

    return {
      id: row.id,
      email: row.email,
      name: row.name ?? row.email,
      image: row.image ?? null,
    };
  },
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [...authConfig.providers, credentialsProvider],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      // Credentials sign-in has already been validated in `authorize`.
      if (account?.provider === "credentials") return true;

      // Google sign-in: upsert the users row and (provider, providerAccountId)
      // linkage so subsequent sign-ins skip account creation. New accounts
      // default to the "student" role — admins are promoted manually via
      // /admin/settings.
      if (account?.provider === "google") {
        const email = String(profile?.email ?? user?.email ?? "").toLowerCase();
        if (!email) return false;

        const existing = await db.query.users.findFirst({
          where: eq(users.email, email),
        });

        let userId: string;
        if (existing) {
          userId = existing.id;
          // Keep name/image fresh from Google, but never demote role.
          // Also stamp email_verified_at if the pre-existing row was an
          // unverified local-password user who just linked Google — Google
          // has now confirmed the email, so lift the verification hold.
          await db
            .update(users)
            .set({
              name: existing.name ?? (profile?.name as string | null) ?? null,
              image: existing.image ?? (profile?.picture as string | null) ?? null,
              emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
              updatedAt: new Date(),
            })
            .where(eq(users.id, existing.id));
        } else {
          // Google has already verified the email; mark it verified
          // immediately so this account skips the verification banner.
          const [inserted] = await db
            .insert(users)
            .values({
              email,
              name: (profile?.name as string | null) ?? null,
              image: (profile?.picture as string | null) ?? null,
              role: "student",
              emailVerifiedAt: new Date(),
            })
            .returning({ id: users.id });
          userId = inserted.id;
        }

        // Upsert the accounts row.
        await db
          .insert(accounts)
          .values({
            userId,
            provider: "google",
            providerAccountId: String(account.providerAccountId),
            type: account.type ?? "oauth",
            refreshToken: (account.refresh_token as string | undefined) ?? null,
            accessToken: (account.access_token as string | undefined) ?? null,
            expiresAt: (account.expires_at as number | undefined) ?? null,
            tokenType: (account.token_type as string | undefined) ?? null,
            scope: (account.scope as string | undefined) ?? null,
            idToken: (account.id_token as string | undefined) ?? null,
            sessionState: (account.session_state as string | undefined) ?? null,
          })
          .onConflictDoUpdate({
            target: [accounts.provider, accounts.providerAccountId],
            set: {
              userId,
              accessToken: (account.access_token as string | undefined) ?? null,
              refreshToken: (account.refresh_token as string | undefined) ?? null,
              expiresAt: (account.expires_at as number | undefined) ?? null,
              idToken: (account.id_token as string | undefined) ?? null,
              updatedAt: new Date(),
            },
          });

        // Stash the row id on the `user` object so the jwt callback below
        // picks it up as `token.sub`.
        (user as { id?: string }).id = userId;
        return true;
      }

      return true;
    },
    async jwt({ token, user, trigger }) {
      // On sign-in, load the DB row and pin id + role onto the token.
      if (user?.email) {
        const row = await db.query.users.findFirst({
          where: eq(users.email, user.email.toLowerCase()),
          columns: { id: true, role: true, email: true },
        });
        if (row) {
          token.sub = row.id;
          token.email = row.email;
          (token as { role?: UserRole }).role = row.role;
        }
      }
      // On session refresh (e.g. after promoting a user), re-read the role.
      if (trigger === "update" && token.email) {
        const row = await db.query.users.findFirst({
          where: eq(users.email, String(token.email).toLowerCase()),
          columns: { role: true },
        });
        if (row) (token as { role?: UserRole }).role = row.role;
      }
      return token;
    },
  },
  events: {
    async signIn({ user }) {
      const email = user?.email?.toLowerCase();
      if (!email) return;
      try {
        await db
          .update(users)
          .set({ lastLoginAt: new Date() })
          .where(eq(users.email, email));
      } catch (err) {
        console.error("[auth] failed to update lastLoginAt:", err);
      }
      await mintSsoCookie(email);
    },
    async signOut() {
      await clearSsoCookie();
    },
  },
});

/**
 * Set the cross-subdomain SSO cookie so services on other subdomains
 * (currently: the LMS) can read the session. No-op when SSO_JWT_SECRET is
 * unset — landing keeps working without SSO configured. Best-effort:
 * failures are logged but never break the sign-in flow.
 */
async function mintSsoCookie(email: string): Promise<void> {
  if (!env.SSO_JWT_SECRET) return;
  try {
    const row = await db.query.users.findFirst({
      where: eq(users.email, email),
      columns: { id: true },
    });
    if (!row) return;
    const claims = await buildSsoClaims(row.id);
    if (!claims) return;
    const token = await signSsoToken(claims);
    const opts = ssoCookieOptions();
    const store = await cookies();
    store.set({ ...opts, value: token });
  } catch (err) {
    console.error("[auth] failed to mint SSO cookie:", err);
  }
}

async function clearSsoCookie(): Promise<void> {
  if (!env.SSO_JWT_SECRET) return;
  try {
    const opts = clearSsoCookieOptions();
    const store = await cookies();
    store.set({ ...opts, value: "" });
  } catch (err) {
    console.error("[auth] failed to clear SSO cookie:", err);
  }
}

// Exported so route handlers (POST /api/sso/register + /signout) can
// reuse the mint/clear logic without going through Auth.js events.
export { mintSsoCookie, clearSsoCookie };

export const authStatus = {
  googleConfigured: googleConfiguredFlag,
};

/**
 * Server-only guard used by /admin pages and actions. Redirects to /login
 * (via the caller) when the session is missing or lacks an admin role.
 */
export function isAdminSessionRole(role: unknown): role is AdminRole {
  return typeof role === "string" && (adminRoles as readonly string[]).includes(role);
}
