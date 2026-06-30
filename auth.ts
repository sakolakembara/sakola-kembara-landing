import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { eq } from "drizzle-orm";
import { ALLOWED_DOMAIN, authConfig, entraConfiguredFlag } from "@/auth.config";
import { db } from "@/lib/db";
import { adminUsers } from "@/lib/db/schema";
import { env } from "@/lib/env";

// Node-runtime Auth.js setup. Adds the dev Credentials provider (which
// queries Postgres) on top of the edge-safe auth.config. Server components,
// server actions, and the [...nextauth] route handler should import from
// here. Middleware imports auth.config.ts directly so the Edge runtime
// doesn't try to load pg.

const devProviderActive =
  env.NODE_ENV === "development" && env.AUTH_DEV_PROVIDER_ENABLED;

const devProvider = devProviderActive
  ? [
      Credentials({
        id: "dev",
        name: "Dev sign-in",
        credentials: {
          email: { label: "Email", type: "email" },
        },
        async authorize(creds) {
          const email = String(creds?.email ?? "").toLowerCase().trim();
          if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) return null;
          const row = await db.query.adminUsers.findFirst({
            where: eq(adminUsers.email, email),
          });
          if (!row) return null;
          return {
            id: row.id,
            email: row.email,
            name: row.displayName ?? row.email,
          };
        },
      }),
    ]
  : [];

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [...authConfig.providers, ...devProvider],
});

export { ALLOWED_DOMAIN };

export const authStatus = {
  entraConfigured: entraConfiguredFlag,
  devProviderActive,
};
