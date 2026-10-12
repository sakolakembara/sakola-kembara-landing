/** Worker bindings and variables. Secrets are set per environment, never committed. */
export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  AUTH_PAIR_LIMIT: RateLimit;
  AUTH_EMAIL_LIMIT: RateLimit;
  AUTH_IP_LIMIT: RateLimit;
  /** Contact form: 5 submissions per minute per visitor address. Optional so the route falls back to the in-memory limiter without it (src/public/contact-deps.ts). */
  PUBLIC_CONTACT_LIMIT?: RateLimit;

  /** "production" unless set otherwise. Anything else is a local or test run. */
  ENVIRONMENT?: string;
  /** Signs Better Auth cookies and tokens. At least 32 characters. */
  BETTER_AUTH_SECRET?: string;
  /** Comma-separated origins allowed to send cookie-bearing requests. */
  TRUSTED_ORIGINS?: string;
  /** Cookie domain shared by sibling subdomains, e.g. ".example.org". Empty = host-only. */
  COOKIE_DOMAIN?: string;
  RESEND_API_KEY?: string;
  /** From header for transactional email, e.g. "Name <no-reply@example.org>". */
  EMAIL_FROM?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

/** Only an explicit "development" or "test" opts out of production behaviour. */
export function isProduction(env: Pick<Bindings, "ENVIRONMENT">): boolean {
  return env.ENVIRONMENT !== "development" && env.ENVIRONMENT !== "test";
}
