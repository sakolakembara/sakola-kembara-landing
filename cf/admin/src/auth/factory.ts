import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { isProduction, type Bindings } from "../env";
import * as schema from "../db/schema";
import { passwordResetEmail, sendEmail, verificationEmail } from "./email";
import { hashPassword, verifyPassword } from "./password";

/** Better Auth's mount point. The SPA and the email links use this prefix. */
export const AUTH_BASE_PATH = "/api/auth";
/** SPA route Better Auth sends the browser to when an auth call fails. */
export const AUTH_ERROR_PATH = "/auth/error";

const VERIFICATION_LINK_SECONDS = 24 * 60 * 60;
const RESET_LINK_SECONDS = 30 * 60;

export interface AuthRequestContext {
  /** Origin the browser used, e.g. "https://admin.example.org". */
  baseURL: string;
  /** `ctx.waitUntil` of the current request. Email is sent after the response. */
  waitUntil: (promise: Promise<unknown>) => void;
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Better Auth, built once per request. A D1 binding only exists inside a
 * request, so the instance cannot live at module level (same pattern as the
 * Ruang Bakat worker). Its cost per request is measured in
 * docs/cloudflare/admin-skeleton.md.
 */
export function createAuth(env: Bindings, { baseURL, waitUntil }: AuthRequestContext) {
  if (!env.BETTER_AUTH_SECRET) {
    // Never fall back to a built-in secret: sessions would be forgeable.
    throw new Error("BETTER_AUTH_SECRET is not set");
  }
  const db = drizzle(env.DB, { schema });
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : undefined;

  return betterAuth({
    baseURL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    // The request origin is always trusted by Better Auth. These are extra
    // browser origins (e.g. a Vite dev server, or a sibling subdomain).
    trustedOrigins: list(env.TRUSTED_ORIGINS),
    // Failed OAuth/verification links land on a SPA route, not Better Auth's
    // built-in error page.
    onAPIError: { errorURL: AUTH_ERROR_PATH },

    database: drizzleAdapter(db, {
      provider: "sqlite",
      // Keys are Better Auth model names; the user model is renamed to "users" below.
      schema: {
        users: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),

    user: {
      modelName: "users",
      additionalFields: {
        // input:false = the sign-up and update-user endpoints reject a client-sent role.
        role: { type: "string", required: false, defaultValue: "student", input: false },
      },
      // Same rule as the legacy decideGoogleLink (lib/google-account-linking.ts):
      // Google must report the address as verified, exactly `true`. Otherwise
      // nothing is created, updated or linked, and sign-in never gets a session.
      validateUserInfo: ({ source }) => {
        if (source.method === "oauth" && source.oauth?.providerId === "google" && source.oauth.profile?.email_verified !== true) {
          return { error: "email_not_verified", errorDescription: "Google has not verified this email address" };
        }
      },
    },

    // Reset tokens are stored as hashes, so a database read does not hand out live links.
    verification: { storeIdentifier: "hashed" },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      password: { hash: hashPassword, verify: verifyPassword },
      resetPasswordTokenExpiresIn: RESET_LINK_SECONDS,
      revokeSessionsOnPasswordReset: true,
      // The email goes out after the response (ctx.waitUntil). The caller
      // sees the same answer whether or not the address exists or the send
      // works, so it is not an account-enumeration oracle.
      sendResetPassword: async ({ user, url }) => {
        waitUntil(sendEmail(env, passwordResetEmail(user.email, url)));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // A correct password on an unverified account sends a fresh link.
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: VERIFICATION_LINK_SECONDS,
      sendVerificationEmail: async ({ user, url }) => {
        waitUntil(sendEmail(env, verificationEmail(user.email, url)));
      },
    },

    socialProviders: google ? { google } : undefined,
    // Account linking stays at Better Auth's safe defaults on purpose:
    // no `trustedProviders`, no `requireLocalEmailVerified: false`. A Google
    // sign-in links to an existing local account only when that account's
    // email is already verified. See docs/cloudflare/admin-skeleton.md (RBT-D76).

    // Better Auth's own limiter keeps counters in memory (per isolate, so
    // useless on Workers) or in D1 (a write per request, against the 100k/day
    // Free budget). Throttling is done with Cloudflare rate limit bindings in
    // src/auth/rate-limit.ts instead.
    rateLimit: { enabled: false },

    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      useSecureCookies: isProduction(env),
      ...(env.COOKIE_DOMAIN
        ? { crossSubDomainCookies: { enabled: true, domain: env.COOKIE_DOMAIN } }
        : {}),
      backgroundTasks: { handler: waitUntil },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
