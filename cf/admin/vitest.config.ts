import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run inside workerd (the real Workers runtime) through Miniflare, with a
// real local D1 and the rate limit bindings from wrangler.jsonc. The route tests
// count against a double of those bindings with a clock the test holds still
// (test/limiter-clock.ts), because Miniflare's windows follow the wall clock;
// the real ones are checked in test/rate-limit.test.ts. The worker is called
// directly, so console and fetch can be spied on.

const here = path.dirname(fileURLToPath(import.meta.url));

// The assets directory must exist for the worker config to load. The SPA build
// normally fills it; tests do not need the real build, so a stub is enough.
const assets = path.join(here, "dist/spa");
if (!existsSync(path.join(assets, "index.html"))) {
  mkdirSync(assets, { recursive: true });
  writeFileSync(path.join(assets, "index.html"), "<!doctype html><title>spa stub for tests</title>");
}

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ENVIRONMENT: "test",
          // Fake values, only for tests.
          BETTER_AUTH_SECRET: "test-only-secret-0123456789-abcdefghijklmnop",
          // The plugin also loads a developer's untracked .dev.vars. Pin every
          // optional variable so the tests never depend on it.
          TRUSTED_ORIGINS: "",
          COOKIE_DOMAIN: "",
          RESEND_API_KEY: "",
          EMAIL_FROM: "",
          GOOGLE_CLIENT_ID: "",
          GOOGLE_CLIENT_SECRET: "",
          // Empty = no Turnstile check outside production; the tests that need it set a test secret.
          TURNSTILE_SECRET_KEY: "",
          TURNSTILE_SITE_KEY: "",
          AUDIT_RETENTION_DAYS: "365",
          UPLOADS_BASE_URL: "",
          // The student portal (SAKEM-083): no admin host, the proposed budget, nothing deleted by retention (0 = never).
          PRIVATE_FILES_BUDGET_BYTES: "8000000000",
          ADMIN_URL: "",
          // The wizard's contact values: not configured (a developer's untracked .dev.vars must not leak into a test).
          PORTAL_CONTACT_WHATSAPP: "",
          PORTAL_WHATSAPP_GROUP_URL: "",
          DRAFT_RETENTION_DAYS: "0",
          REJECTED_FILES_RETENTION_DAYS: "0",
          ACCEPTED_FILES_RETENTION_DAYS: "0",
          TEST_MIGRATIONS: await readD1Migrations(path.join(here, "migrations")),
        },
      },
    }),
  ],
  test: {
    // Node-side, before the workers start: the oracle of the blog tests (test/global/blog-oracle.ts).
    globalSetup: ["./test/global/blog-oracle.ts"],
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
  },
}));
