import { z } from "zod";

// .env files can't distinguish "unset" from "empty string", and an empty
// string slips past `.optional()`. Coerce "" → undefined before validation
// so optional URL/UUID fields don't blow up when left blank.
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

const schema = z.object({
  // ----- App -----
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  NEXTAUTH_URL: z.string().url(),
  AUTH_TRUST_HOST: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),

  // ----- Database -----
  DATABASE_URL: z.string().url(),

  // ----- Auth (unified: Google OAuth + Credentials for admins) -----
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 chars (openssl rand -base64 32)"),
  // Google OAuth — used by both students and admins. Optional in local dev if
  // you only intend to sign in as an admin via email + password.
  AUTH_GOOGLE_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  AUTH_GOOGLE_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

  // ----- Seed super-admin (used by `npm run seed:super-admin`) -----
  SEED_SUPER_ADMIN_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
  SEED_SUPER_ADMIN_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(8).optional()),
  SEED_SUPER_ADMIN_NAME: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

  // ----- Transactional email (Resend) -----
  // Optional in dev — when unset, lib/email.ts logs the outbound message
  // to the console instead of hitting the vendor. Prod must set it.
  RESEND_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  // The From address on outbound mail. Resend defaults to
  // "onboarding@resend.dev" (their sandbox domain) which works without
  // domain verification but shows a "sent via" banner. Prod should use
  // "no-reply@sakolakembara.org" after the sending domain is verified
  // (SPF + DKIM records).
  EMAIL_FROM: z.preprocess(
    emptyToUndefined,
    z.string().optional().default("Sakola Kembara <onboarding@resend.dev>"),
  ),
  // Canonical origin used to build absolute URLs in emails
  // (verify / reset links). Falls back to NEXTAUTH_URL.
  APP_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),

  // ----- SSO / LMS integration -----
  // HS256 signing key for the cross-subdomain session JWT read by the LMS.
  // Distinct from AUTH_SECRET so we can rotate either independently. Same
  // value must be shared with the LMS backend.
  SSO_JWT_SECRET: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .min(32, "SSO_JWT_SECRET must be at least 32 chars (openssl rand -base64 32)")
      .optional(),
  ),
  // Domain the SSO cookie is scoped to. Must start with a dot. Prod:
  // ".sakolakembara.org". Dev via /etc/hosts: ".sakem.test". Leave blank
  // to fall back to a host-only cookie (single-subdomain dev without the
  // hosts entries — SSO won't reach the LMS in that mode).
  SSO_COOKIE_DOMAIN: z.preprocess(
    emptyToUndefined,
    z.string().startsWith(".").optional(),
  ),
  // Comma-separated list of origins allowed to hit the /api/sso/*
  // endpoints from a browser. Prod: "https://lms.sakolakembara.org".
  // REQUIRED in production: POST /api/sso/{register,signout} fail closed
  // when this is empty.
  // Dev: add "http://lms.sakem.test:3100" or similar.
  SSO_ALLOWED_ORIGINS: z.preprocess(
    emptyToUndefined,
    z.string().optional(),
  ),

  // ----- Observability -----
  // Server-side DSN. Client uses NEXT_PUBLIC_SENTRY_DSN (Next.js requires
  // the NEXT_PUBLIC_ prefix to expose an env var to the browser bundle,
  // so it isn't declared in this schema).
  SENTRY_DSN: z.preprocess(emptyToUndefined, z.string().url().optional()),
});

const parsed = schema.safeParse(process.env);

// During `next build` env vars aren't present (the container gets them at
// runtime via .env.local), so page-data collection would crash on the throw.
// Skip the hard fail in the build phase; validation still runs at runtime.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

if (!parsed.success && !isBuildPhase) {
  console.error("Invalid environment variables:");
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  throw new Error("Invalid environment variables — see logs above and check .env.local against .env.example.");
}

// In the build phase parsed.data is undefined; fall back to the raw env so
// type-shape holds. Real validation happens on the first runtime import.
export const env = (parsed.success ? parsed.data : process.env) as z.infer<typeof schema>;
export type Env = typeof env;
