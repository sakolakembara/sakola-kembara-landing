/** Worker bindings and variables. Secrets are set per environment, never committed. */
export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  /** R2 bucket of admin uploads (wrangler.jsonc `r2_buckets`; src/uploads, docs/cloudflare/uploads.md). Served to visitors from a separate public domain, never by this Worker (except the local-only GET /uploads/*). */
  UPLOADS: R2Bucket;
  /**
   * R2 bucket of applicants' files (wrangler.jsonc and wrangler.portal.jsonc `r2_buckets`, placeholder name
   * `sakem-private`), SAKEM-083. PRIVATE: no public domain, no r2.dev, never the bucket of `UPLOADS`. Every read
   * goes through a Worker after an ownership or area check. docs/cloudflare/portal-architecture.md, section 8.
   */
  PRIVATE_FILES: R2Bucket;

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
  /** Admin uploads, per user (src/api/uploads.ts). */
  RL_UPLOAD: RateLimit;
  /** The blog editor's preview, per user (src/api/blog.ts). */
  RL_BLOG_PREVIEW: RateLimit;
  /** The student portal's signed-in routes, per user id (src/portal/guard.ts). Declared by the portal Worker with namespaces of its own. */
  RL_PORTAL_READ: RateLimit;
  RL_PORTAL_SAVE: RateLimit;
  RL_PORTAL_UPLOAD: RateLimit;
  RL_PORTAL_SUBMIT: RateLimit;
  /** An admin opening an applicant's file, per admin id (admin Worker). */
  RL_ADMIN_FILE: RateLimit;

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
  /**
   * Public origin the uploaded files are served from (public variable, like the public site's variable of the
   * same name). Empty or unset = same origin: local development, where GET /uploads/* serves the emulated bucket.
   * Answered to the SPA by GET /api/config as `uploadsBaseUrl`. docs/cloudflare/uploads.md, owner steps.
   */
  UPLOADS_BASE_URL?: string;
  /**
   * Origin of the public site (public variable), e.g. "https://sakolakembara.org": what the "Lihat di publik" link
   * of a published blog article is built from. Empty, unset or not a plain http(s) origin = no link. Answered to the
   * SPA by GET /api/config as `siteUrl`. docs/cloudflare/admin-blog.md.
   */
  SITE_URL?: string;

  // ─── The student portal (SAKEM-083). Declared once for every task of the milestone; docs/cloudflare/portal-architecture.md, 3.5 and 8. ───

  /**
   * Origin of the admin host (public variable, portal Worker), e.g. "https://admin.sakolakembara.org": where the
   * portal's "this is an admin account" screen links. Answered to the SPA by GET /portal/api/config as `adminUrl`.
   * Empty, unset or not a plain http(s) origin = no link.
   */
  ADMIN_URL?: string;
  // There is no secret for the private bucket: Dzul decided on 2026-10-13 against SSE-C (customer-provided keys), so no
  // key is declared and nothing may depend on one. The bucket's protection is that it stays private, R2's encryption
  // at rest, and the Worker as the only reader.
  /** The hard storage budget of the private bucket, in bytes (public variable). Proposed 8,000,000,000, under the 10 GB-month free. Empty or unreadable = the code's default. */
  PRIVATE_FILES_BUDGET_BYTES?: string;
  /**
   * Retention of applicants' files, in days. Dzul decided on 2026-10-13 that NOTHING is deleted automatically, so all
   * three ship as `0`, which means "never delete" (so do empty, negative and unreadable values: an unreadable setting
   * never deletes, as `AUDIT_RETENTION_DAYS` does). No code reads them: the retention cron of the first design was
   * replaced by a manual purge action (an editor with the Pendaftaran grant, or a super_admin; audited). They stay
   * declared, at `0`, so that turning an automatic rule on later is a decision made in one visible place; a task that
   * finds it never needs them may delete them.
   */
  DRAFT_RETENTION_DAYS?: string;
  REJECTED_FILES_RETENTION_DAYS?: string;
  ACCEPTED_FILES_RETENTION_DAYS?: string;
}

/** Only an explicit "development" or "test" opts out of production behaviour. */
export function isProduction(env: Pick<Bindings, "ENVIRONMENT">): boolean {
  return env.ENVIRONMENT !== "development" && env.ENVIRONMENT !== "test";
}
