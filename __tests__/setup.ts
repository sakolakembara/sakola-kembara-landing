// Vitest setup: stub Next.js internals that aren't available under a raw
// Node test runner (they're supplied by Next at build time only), and
// populate the env schema with placeholder values so lib/env.ts doesn't
// throw at module-load time.
import { vi } from "vitest";

// `server-only` is a bare `throw` module that Next uses to guard imports
// against being pulled into a client bundle. In tests we neutralize it.
vi.mock("server-only", () => ({}));

// Baseline env — lib/env.ts is imported by nearly every module and it
// validates required fields at boot. Individual tests may vi.stubEnv over
// these.
process.env.NEXTAUTH_URL ??= "http://localhost:3000";
process.env.AUTH_SECRET ??= "test-auth-secret-that-is-at-least-32-chars-long";
process.env.DATABASE_URL ??= "postgres://sakem:sakem@localhost:5432/test";
process.env.SSO_JWT_SECRET ??= "test-sso-secret-that-is-at-least-32-chars-XXXXX";
