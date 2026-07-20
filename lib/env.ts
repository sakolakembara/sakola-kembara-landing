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

  // ----- Auth (Microsoft Entra ID) -----
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 chars (openssl rand -base64 32)"),
  // Entra credentials are optional in dev — the dev credentials provider
  // (see AUTH_DEV_PROVIDER_ENABLED) lets us run /admin without Entra wired up.
  // For production, set all three.
  AUTH_MICROSOFT_ENTRA_ID_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  AUTH_MICROSOFT_ENTRA_ID_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  AUTH_MICROSOFT_ENTRA_ID_TENANT_ID: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
  // Dev-only escape hatch — enables a simple email-only sign-in flow against
  // existing rows in admin_users. NEVER enable in production.
  AUTH_DEV_PROVIDER_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),

  // ----- Observability -----
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
