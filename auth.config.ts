import type { NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { env } from "@/lib/env";

export const ALLOWED_DOMAIN = "sakolakembara.org";

// Edge-safe NextAuth config — anything that needs Node APIs (DB queries,
// fs, pg) lives in auth.ts instead. Middleware (which runs on the Edge
// runtime by default) imports this file directly.

const entraConfigured = Boolean(
  env.AUTH_MICROSOFT_ENTRA_ID_ID &&
    env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
    env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID,
);

const entraProvider = entraConfigured
  ? [
      MicrosoftEntraID({
        clientId: env.AUTH_MICROSOFT_ENTRA_ID_ID!,
        clientSecret: env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
        issuer: `https://login.microsoftonline.com/${env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID}/v2.0`,
      }),
    ]
  : [];

export const authConfig: NextAuthConfig = {
  providers: entraProvider,
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  trustHost: env.AUTH_TRUST_HOST || env.NODE_ENV === "development",
  callbacks: {
    async signIn({ profile, user }) {
      const email = String(profile?.email ?? user?.email ?? "").toLowerCase();
      return email.endsWith(`@${ALLOWED_DOMAIN}`);
    },
    async jwt({ token, profile, user }) {
      const email =
        profile?.email ?? user?.email ?? (token.email as string | undefined);
      if (email) token.email = String(email).toLowerCase();
      return token;
    },
    async session({ session, token }) {
      if (token.email) session.user.email = String(token.email);
      return session;
    },
  },
};

export const entraConfiguredFlag = entraConfigured;
