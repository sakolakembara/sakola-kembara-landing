import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
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

// Node-runtime Auth.js setup. Adds the admin Credentials provider (email +
// bcrypt password against `users`) on top of the edge-safe Google config.
// Server components, server actions, and the [...nextauth] route handler
// should import from here. Middleware imports auth.config.ts directly so the
// Edge runtime doesn't try to load pg / bcrypt.

const adminCredentialsProvider = Credentials({
  id: "admin-credentials",
  name: "Admin sign-in",
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
    // Only admin roles may sign in via password. Student accounts must use
    // Google — we don't collect passwords from them.
    if (!row || !row.passwordHash) return null;
    if (!(adminRoles as readonly string[]).includes(row.role)) return null;

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
  providers: [...authConfig.providers, adminCredentialsProvider],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      // Credentials sign-in has already been validated in `authorize`.
      if (account?.provider === "admin-credentials") return true;

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
          await db
            .update(users)
            .set({
              name: existing.name ?? (profile?.name as string | null) ?? null,
              image: existing.image ?? (profile?.picture as string | null) ?? null,
              updatedAt: new Date(),
            })
            .where(eq(users.id, existing.id));
        } else {
          const [inserted] = await db
            .insert(users)
            .values({
              email,
              name: (profile?.name as string | null) ?? null,
              image: (profile?.picture as string | null) ?? null,
              role: "student",
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
    },
  },
});

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
