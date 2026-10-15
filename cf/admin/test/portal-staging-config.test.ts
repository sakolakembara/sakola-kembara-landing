import { describe, expect, test } from "vitest";
import { isProduction } from "../src/env";
import { RATE_LIMITS } from "../src/security/rate-limit";
import adminConfigText from "../wrangler.jsonc?raw";
import portalConfigText from "../wrangler.portal.jsonc?raw";

// The staging environment of wrangler.portal.jsonc (SAKEM-098, docs/cloudflare/staging-runbook.md, steps 15 to 22) is the
// portal Worker deployed as `sakem-portal-staging` on workers.dev, made of the same code. An environment inherits only some
// keys, so its bindings, assets and vars are written out again, and this test keeps that block the same shape as the top
// level: a binding, a limiter or a variable left out of it would be a staging Worker that is not the one being tested.
// test/staging-config.test.ts does the same for the admin's block; cf/web/tests/staging-config.test.ts checks both files
// from the outside with wrangler's own reader and keeps the printer's list of variables equal to this block's.

interface Limiter {
  name: string;
  namespace_id: string;
  simple: { limit: number; period: number };
}
interface Block {
  name?: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  vars?: Record<string, string>;
  assets?: unknown;
  d1_databases?: { binding: string; database_name: string; migrations_dir: string }[];
  r2_buckets?: { binding: string; bucket_name: string }[];
  ratelimits?: Limiter[];
  triggers?: unknown;
  env?: Record<string, Block>;
  [key: string]: unknown;
}

const parse = (text: string) => JSON.parse(text.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1")) as Block;
const adminProduction = parse(adminConfigText);
const adminStaging = adminProduction.env!.staging!;
const production = parse(portalConfigText);
const staging = production.env!.staging!;

/** The per-deploy PUBLIC values of the portal: declared empty in the staging block, passed with `--var` by the printed deploy command. */
const DEPLOY_VARS = ["ADMIN_URL", "EMAIL_FROM", "PORTAL_CONTACT_WHATSAPP", "PORTAL_WHATSAPP_GROUP_URL", "SITE_URL", "TURNSTILE_SITE_KEY"];

describe("the staging block of wrangler.portal.jsonc", () => {
  test("is the Worker `sakem-portal-staging`, on workers.dev only, with no preview hosts, no route and no cron; the only environment of the file", () => {
    expect(production.name).toBe("sakem-portal");
    expect(staging.name).toBe(`${production.name}-staging`);
    expect(staging.workers_dev).toBe(true);
    expect(staging.preview_urls).toBe(false);
    expect(Object.keys(production.env!)).toEqual(["staging"]);
    // Exactly these keys: a `routes`, `services`, `triggers`, `account_id`, `kv_namespaces` or `durable_objects` would be a decision, made here.
    expect(Object.keys(staging).sort()).toEqual(["assets", "d1_databases", "name", "preview_urls", "r2_buckets", "ratelimits", "vars", "workers_dev"]);
    expect(production.triggers).toBeUndefined();
    expect(staging.triggers).toBeUndefined();
  });

  test("has the same bindings as the top level: the database and the private bucket by binding name, every limiter by name, and the same assets setup", () => {
    expect(staging.d1_databases!.map((d) => [d.binding, d.migrations_dir])).toEqual(production.d1_databases!.map((d) => [d.binding, d.migrations_dir]));
    expect(staging.r2_buckets!.map((b) => b.binding)).toEqual(production.r2_buckets!.map((b) => b.binding));
    expect(staging.r2_buckets!.map((b) => b.binding)).toEqual(["PRIVATE_FILES"]);
    expect(staging.ratelimits!.map((r) => r.name)).toEqual(production.ratelimits!.map((r) => r.name));
    expect(staging.assets).toEqual(production.assets);
    expect(staging.assets).toMatchObject({ directory: "./dist/portal-spa", binding: "ASSETS", not_found_handling: "single-page-application", html_handling: "none", run_worker_first: ["/portal/api/*"] });
  });

  test("names the resources of staging, never a production one: the admin staging's database, a private bucket of its own, and no public bucket", () => {
    // One database for both Workers, as in production: the portal writes what the admin reads.
    expect(staging.d1_databases).toEqual([{ binding: "DB", database_name: "sakem-staging", migrations_dir: "migrations" }]);
    expect(staging.d1_databases).toEqual(adminStaging.d1_databases);
    expect(staging.d1_databases![0]!.database_name).not.toBe(production.d1_databases![0]!.database_name);
    // The same private bucket as the admin's staging block binds (the admin opens and purges what the portal stores) ...
    const adminPrivate = adminStaging.r2_buckets!.find((b) => b.binding === "PRIVATE_FILES")!.bucket_name;
    expect(staging.r2_buckets).toEqual([{ binding: "PRIVATE_FILES", bucket_name: "sakem-private-staging" }]);
    expect(staging.r2_buckets![0]!.bucket_name).toBe(adminPrivate);
    // ... never the production one, and never the admin's PUBLIC staging bucket (the portal has no binding to it).
    expect(staging.r2_buckets![0]!.bucket_name).not.toBe(production.r2_buckets![0]!.bucket_name);
    const adminPublic = adminStaging.r2_buckets!.find((b) => b.binding === "UPLOADS")!.bucket_name;
    expect(staging.r2_buckets!.map((b) => b.bucket_name)).not.toContain(adminPublic);
    expect(staging.r2_buckets!.some((b) => b.binding === "UPLOADS")).toBe(false);
  });

  test("has the limits the code assumes, and the top level's own numbers, for every limiter", () => {
    for (const config of Object.values(RATE_LIMITS)) {
      const entry = staging.ratelimits!.find((candidate) => candidate.name === config.binding);
      const top = production.ratelimits!.find((candidate) => candidate.name === config.binding);
      // The portal declares the limiters its code uses (test/portal-foundation-config.test.ts); the ones it does not use are not in either block.
      expect(Boolean(entry), `${config.binding} in staging`).toBe(Boolean(top));
      if (entry) expect(entry.simple, config.binding).toEqual({ limit: config.limit, period: config.period });
    }
    const summary = (list: Limiter[]) => list.map((entry) => ({ name: entry.name, simple: entry.simple }));
    expect(summary(staging.ratelimits!)).toEqual(summary(production.ratelimits!));
    expect(staging.ratelimits).toHaveLength(11);
    // Never the admin's concerns: the contact form, the admin's uploads, the blog preview, the admin's file opens.
    for (const other of ["RL_CONTACT", "RL_UPLOAD", "RL_BLOG_PREVIEW", "RL_ADMIN_FILE"]) expect(staging.ratelimits!.map((r) => r.name)).not.toContain(other);
  });

  test("namespaces are the top level's plus 100, in a block of their own (81xx)", () => {
    for (const entry of staging.ratelimits!) {
      const top = production.ratelimits!.find((candidate) => candidate.name === entry.name)!;
      expect(Number(entry.namespace_id), entry.name).toBe(Number(top.namespace_id) + 100);
      expect(entry.namespace_id, entry.name).toMatch(/^81\d\d$/);
    }
  });

  test("every namespace of the four blocks is different (an id is per account, and a shared id shares a counter, across Workers too): 78xx, 79xx, 80xx, 81xx", () => {
    const blocks: [string, Limiter[], RegExp][] = [
      ["admin production", adminProduction.ratelimits!, /^78\d\d$/],
      ["admin staging", adminStaging.ratelimits!, /^79\d\d$/],
      ["portal production", production.ratelimits!, /^80\d\d$/],
      ["portal staging", staging.ratelimits!, /^81\d\d$/],
    ];
    const all: string[] = [];
    for (const [label, list, range] of blocks) {
      for (const entry of list) {
        expect(entry.namespace_id, `${label} ${entry.name}`).toMatch(range);
        all.push(entry.namespace_id);
      }
    }
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(15 + 15 + 11 + 11);
  });

  test("sets the same fixed variables as the top level, plus the per-deploy public ones, each EMPTY; ENVIRONMENT is `staging`, which still counts as production", () => {
    const fixed = Object.keys(production.vars!);
    expect(fixed.sort()).toEqual(["ENVIRONMENT", "PRIVATE_FILES_BUDGET_BYTES"]);
    expect(Object.keys(staging.vars!).sort()).toEqual([...fixed, ...DEPLOY_VARS].sort());
    for (const name of DEPLOY_VARS) expect(staging.vars![name], name).toBe("");
    expect(staging.vars!.PRIVATE_FILES_BUDGET_BYTES).toBe(production.vars!.PRIVATE_FILES_BUDGET_BYTES);
    expect(staging.vars!.ENVIRONMENT).toBe("staging");
    // Not "development" or "test": email, Turnstile and rate limiting fail closed and the cookie keeps its __Host- prefix.
    expect(isProduction({ ENVIRONMENT: staging.vars!.ENVIRONMENT })).toBe(true);
    // The retention variables are the admin's (no code on the portal reads them), and nothing secret is a variable.
    for (const name of ["DRAFT_RETENTION_DAYS", "REJECTED_FILES_RETENTION_DAYS", "ACCEPTED_FILES_RETENTION_DAYS", "UPLOADS_BASE_URL", "AUDIT_RETENTION_DAYS"]) expect(staging.vars, name).not.toHaveProperty(name);
    for (const name of ["BETTER_AUTH_SECRET", "RESEND_API_KEY", "TURNSTILE_SECRET_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "PRIVATE_FILES_KEY", "TRUSTED_ORIGINS", "COOKIE_DOMAIN"]) {
      expect(staging.vars, name).not.toHaveProperty(name);
    }
  });

  test("holds no id, account, host, URL, key, address or number: those are set at deploy time, outside git", () => {
    const text = JSON.stringify(staging);
    expect(text).not.toMatch(/"(?:database_id|account_id|id|zone_id|pattern|route|routes)"\s*:/);
    expect(text).not.toMatch(/https?:|\.workers\.dev|\.r2\.dev|[0-9a-f]{32}|@|\b62\d{8,}\b|whatsapp\.com|wa\.me/i);
    // The staging block's own comments are held to the same rule as the rest of the file (test/portal-foundation-config.test.ts reads the whole text).
    expect(portalConfigText).not.toMatch(/[a-z0-9-]+\.(workers|pages|r2)\.dev|\b[0-9a-f]{32}\b/i);
  });
});

// ─── Every variable the portal's code reads is accounted for ───────────

const sources = import.meta.glob<string>("../src/{portal,auth,security,email,config,private-files,db}/**/*.ts", { query: "?raw", import: "default", eager: true });

describe("what the portal's code reads from its environment", () => {
  /** Every `env.NAME` or `c.env.NAME` in the files a portal bundle contains (the dynamic `env[binding]` of the limiter is covered by the limiter test above). */
  function readNames(): Set<string> {
    const names = new Set<string>();
    for (const source of Object.values(sources)) {
      for (const match of source.matchAll(/\b(?:c\.env|env|deps\.env)\.([A-Z][A-Z0-9_]*)\b/g)) names.add(match[1]!);
    }
    return names;
  }

  test("each is a binding, a declared variable of the staging block, a secret, or an optional value that stays unset on staging: a new one cannot be forgotten", () => {
    const bindings = new Set(["DB", "PRIVATE_FILES", "ASSETS"]);
    const declared = new Set(Object.keys(staging.vars!));
    // Set with `wrangler secret put` (the runbook's step 20), never in a file.
    const secrets = new Set(["BETTER_AUTH_SECRET", "RESEND_API_KEY", "TURNSTILE_SECRET_KEY"]);
    // Read when set, left unset on staging by decision: the Google client (optional), the extra trusted origins and the cookie domain (host-only cookies, same origin).
    const unsetOnStaging = new Set(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TRUSTED_ORIGINS", "COOKIE_DOMAIN"]);
    const unaccounted = [...readNames()].filter((name) => !bindings.has(name) && !declared.has(name) && !secrets.has(name) && !unsetOnStaging.has(name));
    expect(unaccounted).toEqual([]);
  });

  test("the scan sees what it should (so the test above cannot pass by looking at nothing)", () => {
    const names = readNames();
    for (const expected of ["DB", "PRIVATE_FILES", "ENVIRONMENT", "SITE_URL", "ADMIN_URL", "TURNSTILE_SITE_KEY", "EMAIL_FROM", "PORTAL_CONTACT_WHATSAPP", "PORTAL_WHATSAPP_GROUP_URL", "BETTER_AUTH_SECRET", "RESEND_API_KEY", "TURNSTILE_SECRET_KEY", "PRIVATE_FILES_BUDGET_BYTES"]) {
      expect(names.has(expected), expected).toBe(true);
    }
    expect(Object.keys(sources).length).toBeGreaterThan(40);
  });

  test("every per-deploy variable of the block is read by the code (a declared name nothing reads is noise, and would be passed for nothing)", () => {
    const names = readNames();
    for (const name of DEPLOY_VARS) expect(names.has(name), name).toBe(true);
  });
});
