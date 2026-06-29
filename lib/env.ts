import { z } from "zod";

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
  AUTH_MICROSOFT_ENTRA_ID_ID: z.string().min(1),
  AUTH_MICROSOFT_ENTRA_ID_SECRET: z.string().min(1),
  AUTH_MICROSOFT_ENTRA_ID_TENANT_ID: z.string().uuid(),

  // ----- Observability -----
  SENTRY_DSN: z.string().url().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  throw new Error("Invalid environment variables — see logs above and check .env.local against .env.example.");
}

export const env = parsed.data;
export type Env = typeof env;
