import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";
import { TABLES_CHILD_FIRST } from "./tables";

// Runs in every test file: schema once per file, empty tables before each test.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

beforeEach(async () => {
  await env.DB.batch(TABLES_CHILD_FIRST.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
});
