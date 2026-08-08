import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { env } from "@/lib/env";

// Edge-safe NextAuth config — anything that needs Node APIs (DB queries,
// bcrypt, pg) lives in auth.ts instead. Middleware (which runs on the Edge
// runtime by default) imports this file directly.
//
// This file registers the Google provider only. The Credentials-based admin
// login (email + password) is registered in auth.ts so we can call into
// Postgres / bcrypt there.

const googleConfigured = Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);

const googleProvider = googleConfigured
  ? [
      Google({
        clientId: env.AUTH_GOOGLE_ID!,
        clientSecret: env.AUTH_GOOGLE_SECRET!,
        // Allow re-selecting the account each time — students may share a
        // device with a sibling; asking every time avoids the wrong account
        // being reused silently.
        authorization: { params: { prompt: "select_account" } },
      }),
    ]
  : [];

export const authConfig: NextAuthConfig = {
  providers: googleProvider,
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  trustHost: env.AUTH_TRUST_HOST || env.NODE_ENV === "development",
  callbacks: {
    // JWT is the source of truth for role + userId — the middleware runs on
    // Edge and reads the JWT directly (see proxy.ts). Actual role resolution
    // happens in auth.ts (Node runtime, DB access).
    async jwt({ token }) {
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        if (token.email) session.user.email = String(token.email).toLowerCase();
        if (typeof token.role === "string") {
          (session.user as { role?: string }).role = token.role;
        }
        if (typeof token.sub === "string") {
          (session.user as { id?: string }).id = token.sub;
        }
      }
      return session;
    },
  },
};

export const googleConfiguredFlag = googleConfigured;
