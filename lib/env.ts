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
  // Comma-separated list of origins allowed to hit the /api/auth/*
  // endpoints from a browser. Prod: "https://lms.sakolakembara.org".
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

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  throw new Error("Invalid environment variables — see logs above and check .env.local against .env.example.");
}

export const env = parsed.data;
export type Env = typeof env;
