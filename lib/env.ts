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

  // ----- Observability -----
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
