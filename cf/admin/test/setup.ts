import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";

// Runs in every test file: schema once per file, empty tables before each test.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

beforeEach(async () => {
  await env.DB.batch(
    ["audit_log", "announcements", "verification", "account", "session", "users"].map((table) =>
      env.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
});
