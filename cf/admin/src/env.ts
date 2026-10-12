/** Worker bindings and variables. Secrets are set per environment, never committed. */
export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;

  // Cloudflare rate limit bindings, one per concern (wrangler.jsonc "ratelimits",
  // limits and keys in src/security/rate-limit.ts). Declared here as present;
  // the code still treats a missing one as a configuration error (production
  // fails closed, local runs fall back to an in-memory counter).
  RL_LOGIN: RateLimit;
  RL_LOGIN_ACCOUNT: RateLimit;
  RL_REGISTER: RateLimit;
  RL_RESET: RateLimit;
  RL_VERIFY_RESEND: RateLimit;
  RL_MAIL_TARGET: RateLimit;
  RL_TOKEN: RateLimit;
  /** Contact form, used by src/public/contact-deps.ts (the one limiter for POST /api/public/contact). */
  RL_CONTACT: RateLimit;

  /** "production" unless set otherwise. Anything else is a local or test run. */
  ENVIRONMENT?: string;
  /** Signs Better Auth cookies and tokens. At least 32 characters. */
  BETTER_AUTH_SECRET?: string;
  /** Comma-separated origins allowed to send cookie-bearing requests. */
  TRUSTED_ORIGINS?: string;
  /**
   * Cookie domain shared by sibling subdomains, e.g. ".example.org". Empty (the
   * default) = host-only cookies with the __Host- prefix. Only set it when
   * another subdomain must read the session; see docs/cloudflare/auth.md.
   */
  COOKIE_DOMAIN?: string;
  /** Resend API key (secret). Production without it: email fails closed. */
  RESEND_API_KEY?: string;
  /** From header for transactional email, e.g. "Name <no-reply@example.org>". */
  EMAIL_FROM?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Turnstile secret key (secret). Production without it: protected routes fail closed. */
  TURNSTILE_SECRET_KEY?: string;
  /** Turnstile site key (public, served by GET /api/config for the widget). */
  TURNSTILE_SITE_KEY?: string;
  /** Days to keep audit_log rows. Empty, 0 or not a number = keep everything. */
  AUDIT_RETENTION_DAYS?: string;
}

/** Only an explicit "development" or "test" opts out of production behaviour. */
export function isProduction(env: Pick<Bindings, "ENVIRONMENT">): boolean {
  return env.ENVIRONMENT !== "development" && env.ENVIRONMENT !== "test";
}
