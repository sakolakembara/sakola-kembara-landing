import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { accountExistsEmail, passwordResetEmail, verificationEmail } from "../email/templates";
import { sendEmail } from "../email/send";
import { isProduction, type Bindings } from "../env";
import { auditStatement, writeAuditSafely } from "../db/audit";
import * as schema from "../db/schema";
import { parseOrigins } from "../security/csrf";
import { hashPassword, verifyPassword } from "./password";

/** Better Auth's mount point. The SPA and the email links use this prefix. */
export const AUTH_BASE_PATH = "/api/auth";
/** SPA route Better Auth sends the browser to when an auth call fails. */
export const AUTH_ERROR_PATH = "/auth/error";

/** The verification link in an email lives 24 hours (legacy). */
export const VERIFICATION_LINK_SECONDS = 24 * 60 * 60;
/** The reset link lives 30 minutes (legacy). Redeeming it consumes it. */
export const RESET_LINK_SECONDS = 30 * 60;
/** A session lives 7 days from its last refresh, refreshed at most once a day. */
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
const SESSION_REFRESH_SECONDS = 24 * 60 * 60;

/** Legacy bounds (app/(auth)/register/actions.ts): at least 8, at most 200 characters. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

export interface AuthRequestContext {
  /** Origin the browser used, e.g. "https://admin.example.org". */
  baseURL: string;
  /** `ctx.waitUntil` of the current request. Email is sent after the response. */
  waitUntil: (promise: Promise<unknown>) => void;
}

/** The `callbackURL` a registration came with, so the "you already have an account" email can link to the page the form wants. */
async function callbackOf(request: Request | undefined): Promise<string | undefined> {
  try {
    const body = (await request?.clone().json()) as { callbackURL?: unknown } | undefined;
    return typeof body?.callbackURL === "string" ? body.callbackURL : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where the session cookie goes, decided here and explained in
 * docs/cloudflare/auth.md#cookies:
 *
 *   production, COOKIE_DOMAIN empty (the default)
 *     `__Host-better-auth.session_token`: Secure, Path=/, NO Domain, HttpOnly,
 *     SameSite=Lax. The browser keeps it host-only and refuses a Domain
 *     attribute with this prefix, so the admin host and the apex each have their
 *     own session and no sibling subdomain can read it, overwrite it, or plant
 *     a cookie of that name for us ("cookie tossing").
 *   production, COOKIE_DOMAIN set (opt-in, e.g. when the LMS must read it)
 *     `__Secure-better-auth.session_token`, Secure, Domain=<value>.
 *   development and test (plain http)
 *     `better-auth.session_token`, not Secure, host-only.
 */
function cookieSettings(env: Bindings) {
  if (!isProduction(env)) return { useSecureCookies: false };
  if (env.COOKIE_DOMAIN) {
    return { useSecureCookies: true, crossSubDomainCookies: { enabled: true, domain: env.COOKIE_DOMAIN } };
  }
  return {
    // Better Auth only knows the __Secure- prefix; the __Host- one is built from the cookie prefix.
    useSecureCookies: false,
    cookiePrefix: "__Host-better-auth",
    defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: "lax" as const, path: "/" },
  };
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
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, prompt: "select_account" as const }
      : undefined;

  const isDeactivated = (user: unknown) => Boolean((user as { deactivatedAt?: unknown }).deactivatedAt);

  return betterAuth({
    baseURL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    // The request origin is always trusted by Better Auth. These are extra
    // browser origins (e.g. a Vite dev server, or a sibling subdomain).
    trustedOrigins: parseOrigins(env.TRUSTED_ORIGINS),
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
        // input:false = the sign-up and update-user endpoints reject a client-sent value.
        role: { type: "string", required: false, defaultValue: "student", input: false },
        deactivatedAt: { type: "date", required: false, input: false },
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

    session: { expiresIn: SESSION_SECONDS, updateAge: SESSION_REFRESH_SECONDS },

    // Reset tokens are stored as hashes, so a database read does not hand out live links.
    verification: { storeIdentifier: "hashed" },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      password: { hash: hashPassword, verify: verifyPassword },
      resetPasswordTokenExpiresIn: RESET_LINK_SECONDS,
      revokeSessionsOnPasswordReset: true,
      // The email goes out after the response (ctx.waitUntil). The caller
      // sees the same answer whether or not the address exists or the send
      // works, so it is not an account-enumeration oracle.
      sendResetPassword: async ({ user, url }) => {
        if (isDeactivated(user)) return;
        waitUntil(sendEmail(env, passwordResetEmail(user.email, url)));
      },
      // Redeeming a reset (or invite) link proves control of the mailbox, which
      // is all "verified" means. It also lets an invited admin, who has no
      // password and never signed up, sign in after choosing one. Sessions were
      // already revoked by `revokeSessionsOnPasswordReset`.
      onPasswordReset: async ({ user }) => {
        await db.batch([
          db.update(schema.users).set({ emailVerified: true }).where(eq(schema.users.id, user.id)),
          auditStatement(db, user, { action: "user.password_reset", resourceType: "user", resourceId: user.id }),
        ]);
      },
      // Registering with an address that already has an account answers exactly
      // like a new registration (Better Auth returns a synthetic user), so this
      // email is how the owner finds out. No new account, no new token.
      onExistingUserSignUp: async ({ user }, request) => {
        if (isDeactivated(user)) return;
        waitUntil(
          callbackOf(request).then((callback) => {
            // `callbackURL` was already checked against the trusted origins by Better Auth.
            const signIn = new URL(callback ?? "/", baseURL).href;
            return sendEmail(env, accountExistsEmail(user.email, signIn));
          }),
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // A correct password on an unverified account sends a fresh link.
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: VERIFICATION_LINK_SECONDS,
      sendVerificationEmail: async ({ user, url }) => {
        if (isDeactivated(user)) return;
        waitUntil(sendEmail(env, verificationEmail(user.email, url)));
      },
      afterEmailVerification: async (user) => {
        waitUntil(writeAuditSafely(db, user, { action: "user.email_verified", resourceType: "user", resourceId: user.id }));
      },
    },

    databaseHooks: {
      user: {
        create: {
          after: async (user, context) => {
            // Students only: an admin is created by a super_admin (src/api/admin-users.ts), not through here.
            if ((user as { role?: unknown }).role !== "student") return;
            const via = context?.path?.startsWith("/callback") ? "google" : "email";
            waitUntil(writeAuditSafely(db, user, { action: "student.register", resourceType: "user", resourceId: user.id, metadata: { via } }));
          },
        },
      },
      session: {
        create: {
          // The one place every way of signing in passes through (password,
          // Google, a verification link): a deactivated account never gets a session.
          before: async (session) => {
            const row = await db
              .select({ deactivatedAt: schema.users.deactivatedAt })
              .from(schema.users)
              .where(eq(schema.users.id, session.userId))
              .get();
            if (row?.deactivatedAt) {
              throw new APIError("FORBIDDEN", {
                code: "ACCOUNT_DEACTIVATED",
                message: "Akun ini dinonaktifkan. Hubungi super admin.",
              });
            }
          },
        },
      },
    },

    socialProviders: google ? { google } : undefined,
    // Account linking stays at Better Auth's safe defaults on purpose:
    // no `trustedProviders`, no `requireLocalEmailVerified: false`. A Google
    // sign-in links to an existing local account only when that account's
    // email is already verified. See docs/cloudflare/auth.md#account-linking.

    // Better Auth's own limiter keeps counters in memory (per isolate, so
    // useless on Workers) or in D1 (a write per request, against the 100k/day
    // Free budget). Throttling is done with Cloudflare rate limit bindings in
    // src/security/rate-limit.ts instead, mounted in src/auth/gate.ts.
    rateLimit: { enabled: false },

    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      ...cookieSettings(env),
      backgroundTasks: { handler: waitUntil },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
