import { describe, expect, test } from "vitest";
import wranglerConfig from "../wrangler.jsonc?raw";
import { isProduction } from "../src/env";
import { RATE_LIMITS } from "../src/security/rate-limit";

// The staging environment of wrangler.jsonc (SAKEM-084, docs/cloudflare/staging-runbook.md) is a second
// Worker made of the same code. An environment inherits only some keys, so its bindings and vars are written out
// again, and this test keeps that block the same shape as the top level: a binding left out of it would be a
// staging Worker that is not the one being tested. (cf/web/tests/staging-config.test.ts checks the same two
// files from the outside with wrangler's own reader, plus the service binding of the site.)

interface Block {
  name?: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  vars?: Record<string, string>;
  assets?: unknown;
  d1_databases?: { binding: string; database_name: string; migrations_dir: string }[];
  r2_buckets?: { binding: string; bucket_name: string }[];
  ratelimits?: { name: string; namespace_id: string; simple: { limit: number; period: number } }[];
  triggers?: { crons: string[] };
  services?: unknown;
  env?: { staging: Block };
}

const json = wranglerConfig.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1");
const production = JSON.parse(json) as Block;
const staging = production.env!.staging;

describe("the staging block of wrangler.jsonc", () => {
  test("is the Worker `<name>-staging`, on workers.dev only, with no per-version preview hosts", () => {
    expect(production.name).toBe("sakem-admin");
    expect(staging.name).toBe(`${production.name}-staging`);
    expect(staging.workers_dev).toBe(true);
    expect(staging.preview_urls).toBe(false);
    expect(Object.keys(production.env!)).toEqual(["staging"]);
  });

  test("has the same bindings as production: the database, the bucket and every limiter, by name", () => {
    expect(staging.d1_databases!.map((d) => [d.binding, d.migrations_dir])).toEqual(production.d1_databases!.map((d) => [d.binding, d.migrations_dir]));
    expect(staging.r2_buckets!.map((b) => b.binding)).toEqual(production.r2_buckets!.map((b) => b.binding));
    expect(staging.ratelimits!.map((r) => r.name)).toEqual(production.ratelimits!.map((r) => r.name));
    expect(staging.assets).toEqual(production.assets);
    expect(staging.triggers).toEqual(production.triggers);
  });

  test("never names a production resource: its own database, its own bucket", () => {
    expect(staging.d1_databases![0]!.database_name).toBe("sakem-staging");
    expect(staging.d1_databases![0]!.database_name).not.toBe(production.d1_databases![0]!.database_name);
    expect(staging.r2_buckets![0]!.bucket_name).toBe("sakem-files-staging");
    expect(staging.r2_buckets![0]!.bucket_name).not.toBe(production.r2_buckets![0]!.bucket_name);
  });

  test("has the limits the code assumes, and namespaces of its own (a shared namespace would share counters with production)", () => {
    for (const config of Object.values(RATE_LIMITS)) {
      const entry = staging.ratelimits!.find((candidate) => candidate.name === config.binding);
      expect(entry, config.binding).toBeDefined();
      expect(entry!.simple, config.binding).toEqual({ limit: config.limit, period: config.period });
    }
    const productionIds = production.ratelimits!.map((r) => r.namespace_id);
    const stagingIds = staging.ratelimits!.map((r) => r.namespace_id);
    expect(new Set(stagingIds).size).toBe(stagingIds.length);
    expect(stagingIds.filter((id) => productionIds.includes(id))).toEqual([]);
    for (const id of stagingIds) expect(id).toMatch(/^[1-9][0-9]*$/);
  });

  test("sets the same variables as production, with an environment that still counts as production (email, Turnstile and rate limits fail closed)", () => {
    expect(Object.keys(staging.vars!).sort()).toEqual(Object.keys(production.vars!).sort());
    expect(staging.vars!.ENVIRONMENT).toBe("staging");
    expect(isProduction({ ENVIRONMENT: staging.vars!.ENVIRONMENT })).toBe(true);
    expect(staging.vars!.AUDIT_RETENTION_DAYS).toBe(production.vars!.AUDIT_RETENTION_DAYS);
  });

  test("holds no id, account, host, URL or key: those are set at deploy time, outside git", () => {
    const stagingText = JSON.stringify(staging);
    expect(stagingText).not.toMatch(/"(?:database_id|account_id|id)"\s*:/);
    expect(stagingText).not.toMatch(/https?:|\.workers\.dev|\.r2\.dev|[0-9a-f]{32}/i);
    for (const name of Object.keys(staging.vars!)) expect(name).not.toMatch(/KEY|SECRET|TOKEN|PASSWORD|URL/);
  });
});
