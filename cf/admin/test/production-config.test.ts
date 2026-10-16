import { describe, expect, test } from "vitest";
import wranglerConfig from "../wrangler.jsonc?raw";
import { isProduction } from "../src/env";

// The production top level of wrangler.jsonc (SAKEM-104, cutover Phase A, docs/cloudflare/cutover-runbook.md section 14), seen from
// the admin package. cf/web/tests/production-scripts.test.ts checks the same file with wrangler's own reader and compares it with
// the production printer and dry run; this test pins the facts the admin Worker's own deploy depends on, with the names written
// out a second time on purpose (a rename in the file alone fails here).

interface Top {
  name?: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  routes?: unknown;
  route?: unknown;
  vars?: Record<string, string>;
  d1_databases?: { binding: string; database_name: string }[];
  r2_buckets?: { binding: string; bucket_name: string }[];
  ratelimits?: { name: string; namespace_id: string }[];
  services?: unknown;
  env?: { staging: { name: string; workers_dev: boolean; preview_urls: boolean } };
}

const top = JSON.parse(wranglerConfig.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1")) as Top;

describe("the production top level of wrangler.jsonc", () => {
  test("is the Worker `sakem-admin`, never on workers.dev, with no per-version preview hosts, and no route or domain in the file (the dashboard attaches the Custom Domain)", () => {
    expect(top.name).toBe("sakem-admin");
    expect(top.workers_dev).toBe(false);
    expect(top.preview_urls).toBe(false);
    expect(top.routes).toBeUndefined();
    expect(top.route).toBeUndefined();
  });

  test("the staging block still turns workers.dev on for itself", () => {
    expect(top.env!.staging.name).toBe("sakem-admin-staging");
    expect(top.env!.staging.workers_dev).toBe(true);
    expect(top.env!.staging.preview_urls).toBe(false);
  });

  test("names the production resources, none of them a staging one: the database `sakem-admin`, the public bucket `sakem-files`, the private bucket `sakem-private`", () => {
    expect(top.d1_databases!.map((d) => [d.binding, d.database_name])).toEqual([["DB", "sakem-admin"]]);
    expect(top.r2_buckets!.map((b) => [b.binding, b.bucket_name])).toEqual([
      ["UPLOADS", "sakem-files"],
      ["PRIVATE_FILES", "sakem-private"],
    ]);
    for (const name of [top.name, top.d1_databases![0]!.database_name, ...top.r2_buckets!.map((b) => b.bucket_name)]) expect(name).not.toMatch(/staging/);
  });

  test("is production: the variable says so, so email, Turnstile and rate limiting fail closed, and it carries no per-deploy value (those are passed with --var)", () => {
    expect(top.vars!.ENVIRONMENT).toBe("production");
    expect(isProduction({ ENVIRONMENT: top.vars!.ENVIRONMENT })).toBe(true);
    for (const name of ["TURNSTILE_SITE_KEY", "UPLOADS_BASE_URL", "SITE_URL", "EMAIL_FROM", "ADMIN_URL", "CONTENT_API_URL", "LEGACY_ORIGIN_URL"]) expect(top.vars, name).not.toHaveProperty(name);
    expect(top.services).toBeUndefined();
  });

  test("holds no id, account, route, host or URL outside its comments (the owner's steps give those at deploy time)", () => {
    const { env: _env, ...production } = top;
    const text = JSON.stringify(production);
    expect(text).not.toMatch(/"(?:database_id|account_id|id|zone_id|zone_name|pattern|custom_domain)"\s*:/);
    expect(text).not.toMatch(/https?:|\.workers\.dev|\.r2\.dev|\.sakolakembara\.org|[0-9a-f]{32}/i);
  });
});
