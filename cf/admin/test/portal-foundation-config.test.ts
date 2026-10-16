import { describe, expect, test } from "vitest";
import journal from "../migrations/meta/_journal.json";
import packageJson from "../package.json";
import authDoc from "../../../docs/cloudflare/auth.md?raw";
import portalApiDoc from "../../../docs/cloudflare/portal-api.md?raw";
import { AUTH_POLICIES } from "../src/auth/gate";
import { RATE_LIMITS, type LimitName } from "../src/security/rate-limit";
import adminConfigText from "../wrangler.jsonc?raw";
import portalConfigText from "../wrangler.portal.jsonc?raw";

// The two Worker configurations and the shape of the code around them (SAKEM-083, P1a): the portal Worker is a second
// entry of this package, with its own configuration. What must be equal in the two is checked here, so the Workers
// cannot drift; what must not be in either (ids, accounts, routes, secrets) is checked too; and the portal's source may
// not import what would make its bundle the admin's (docs/cloudflare/portal-architecture.md, sections 4.2 and 4.3).

interface WranglerConfig {
  name: string;
  main: string;
  compatibility_date: string;
  compatibility_flags: string[];
  observability?: { enabled: boolean };
  vars: Record<string, string>;
  assets: { directory: string; binding: string; not_found_handling: string; html_handling?: string; run_worker_first: string[] };
  d1_databases: { binding: string; database_name: string; migrations_dir: string; database_id?: string }[];
  r2_buckets: { binding: string; bucket_name: string }[];
  ratelimits: { name: string; namespace_id: string; simple: { limit: number; period: number } }[];
  triggers?: { crons: string[] };
  /** The staging block (SAKEM-084 for the admin's, SAKEM-098 for the portal's): it uses namespaces of its own, which no other block's may collide with. */
  env?: { staging?: { vars?: Record<string, string>; ratelimits?: { name: string; namespace_id: string; simple: { limit: number; period: number } }[] } };
  [key: string]: unknown;
}

/** wrangler.jsonc is JSONC: drop the full-line comments and the trailing commas, then read it. */
function parse(text: string): WranglerConfig {
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1")) as WranglerConfig;
}

const admin = parse(adminConfigText);
const portal = parse(portalConfigText);
const bucketOf = (config: WranglerConfig, binding: string) => config.r2_buckets.find((bucket) => bucket.binding === binding)?.bucket_name;

describe("the portal's configuration", () => {
  test("its name, its entry and its assets", () => {
    expect(portal.name).toBe("sakem-portal");
    expect(admin.name).toBe("sakem-admin");
    expect(portal.main).toBe("src/portal/worker.ts");
    expect(portal.assets).toEqual({
      directory: "./dist/portal-spa",
      binding: "ASSETS",
      not_found_handling: "single-page-application",
      html_handling: "none",
      // Only the API runs the Worker; the pattern carries the /portal prefix because assets are matched by pathname.
      run_worker_first: ["/portal/api/*"],
    });
    expect(portal.observability).toEqual({ enabled: true });
  });

  test("no routes, no ids, no accounts, no zone, no cron: nothing that belongs to a real Cloudflare account", () => {
    // `env` is the staging block (SAKEM-098): test/portal-staging-config.test.ts holds it to the same rules.
    expect(Object.keys(portal).sort()).toEqual(["$schema", "assets", "compatibility_date", "compatibility_flags", "d1_databases", "env", "main", "name", "observability", "r2_buckets", "ratelimits", "vars"]);
    expect(Object.keys(portal.env ?? {})).toEqual(["staging"]);
    for (const config of [admin, portal]) {
      for (const forbidden of ["routes", "route", "account_id", "zone_id", "zone_name", "kv_namespaces", "durable_objects", "services"]) expect(config, forbidden).not.toHaveProperty(forbidden);
      // workers_dev may only be switched OFF here (SAKEM-104: a production Worker is never on workers.dev, and wrangler turns that
      // address on at every deploy unless the file says false); it is never turned on at the top level, only by the staging block.
      expect([undefined, false], "workers_dev").toContain((config as { workers_dev?: boolean }).workers_dev);
      for (const database of config.d1_databases) expect(database.database_id, "a D1 id").toBeUndefined();
    }
    expect(portal.triggers).toBeUndefined(); // the daily cleanup runs on the admin Worker
    expect(admin.triggers).toEqual({ crons: ["17 3 * * *"] });
  });

  test("no secret, no id and no hostname other than the public domain is written in either file (comments included)", () => {
    for (const [name, text] of [["wrangler.jsonc", adminConfigText], ["wrangler.portal.jsonc", portalConfigText]] as const) {
      // A real host of an account or a bucket has a name in front of it (the bare words appear in comments as things never to use).
      expect(text, name).not.toMatch(/[a-z0-9-]+\.(workers|pages|r2)\.dev|[a-z0-9-]+\.r2\.cloudflarestorage\.com|\.supabase\./i);
      expect(text, name).not.toMatch(/\b[0-9a-f]{32}\b/); // an account, zone or database id
      expect(text, name).not.toMatch(/\bre_[A-Za-z0-9_]{12,}/); // a Resend key
      expect(text, name).not.toMatch(/-----BEGIN|\bsk_(live|test)_|\bxox[bp]-|AKIA[0-9A-Z]{12}|ghp_[A-Za-z0-9]{20}/);
      expect(text, name).not.toMatch(/\b0x4[A-Za-z0-9_-]{20,}/); // a Turnstile key
      expect(text, name).not.toMatch(/@(?!sakolakembara)[a-z0-9-]+\.(com|org|id|net)\b/i); // an address
    }
  });

  test("the two Workers see one database and one set of migrations", () => {
    expect(portal.d1_databases).toEqual([{ binding: "DB", database_name: "sakem-admin", migrations_dir: "migrations" }]);
    expect(admin.d1_databases).toEqual(portal.d1_databases);
    expect(portal.compatibility_date).toBe(admin.compatibility_date);
    expect(portal.compatibility_flags).toEqual(admin.compatibility_flags);
    expect(portal.compatibility_date >= "2025-04-01").toBe(true); // a navigation is answered by the assets layer without running the Worker
  });

  test("the private bucket is one bucket on both Workers, and never the public one", () => {
    expect(bucketOf(portal, "PRIVATE_FILES")).toBe("sakem-private");
    expect(bucketOf(admin, "PRIVATE_FILES")).toBe(bucketOf(portal, "PRIVATE_FILES"));
    expect(bucketOf(admin, "UPLOADS")).toBe("sakem-files");
    expect(bucketOf(portal, "PRIVATE_FILES")).not.toBe(bucketOf(admin, "UPLOADS"));
    // The portal has the private bucket only: it never serves or writes the admin's public uploads.
    expect(portal.r2_buckets.map((bucket) => bucket.binding)).toEqual(["PRIVATE_FILES"]);
    expect(admin.r2_buckets.map((bucket) => bucket.binding).sort()).toEqual(["PRIVATE_FILES", "UPLOADS"]);
  });

  test("the variables: production by default, the same storage budget, nothing deleted by retention", () => {
    expect(portal.vars.ENVIRONMENT).toBe("production");
    expect(admin.vars.ENVIRONMENT).toBe("production");
    expect(portal.vars.PRIVATE_FILES_BUDGET_BYTES).toBe(admin.vars.PRIVATE_FILES_BUDGET_BYTES);
    const budget = Number(portal.vars.PRIVATE_FILES_BUDGET_BYTES);
    expect(Number.isInteger(budget)).toBe(true);
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThan(10_000_000_000); // under the 10 GB-month of R2 Free
    // Dzul, 2026-10-13: no automatic deletion. 0 means never delete; a retention value above 0 is a decision, made in this file.
    for (const name of ["DRAFT_RETENTION_DAYS", "REJECTED_FILES_RETENTION_DAYS", "ACCEPTED_FILES_RETENTION_DAYS"]) {
      expect(admin.vars[name], name).toBe("0");
      expect(portal.vars[name], name).toBeUndefined(); // no cron reads them; if one ever does it is the admin Worker's
    }
    // Nothing secret is a variable: these are names that wrangler secrets carry.
    for (const config of [admin, portal]) {
      for (const secret of ["BETTER_AUTH_SECRET", "RESEND_API_KEY", "TURNSTILE_SECRET_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "PRIVATE_FILES_KEY"]) expect(config.vars, secret).not.toHaveProperty(secret);
    }
  });

  test("the wizard's two contact values are optional public variables set per deploy: declared in env.ts, named in the portal config and the example, and NO value in any tracked file", () => {
    const names = ["PORTAL_CONTACT_WHATSAPP", "PORTAL_WHATSAPP_GROUP_URL"];
    for (const name of names) {
      expect(envSources["../src/env.ts"], name).toMatch(new RegExp(`${name}\\?:\\s*string;`)); // optional
      // Not in a `vars` block of the production configs or the admin's staging block (a declared one is reset by a deploy that
      // does not pass it, and a value would be in git). The portal's STAGING block does declare both, EMPTY (SAKEM-098: the
      // names are then visible and the dry run lists them); the assertion on it is further down, and a value there fails it.
      for (const config of [admin, portal, { vars: admin.env?.staging ? (admin.env.staging as { vars?: Record<string, string> }).vars ?? {} : {} }]) {
        expect(config.vars, name).not.toHaveProperty(name);
      }
      // Documented by name where the portal's per-deploy variables are listed.
      expect(portalConfigText, name).toContain(name);
      // The example has the name and nothing after the equals sign.
      expect(devVarsExample, name).toMatch(new RegExp(`^${name}=$`, "m"));
    }
    // No real value in the source or the example: no WhatsApp group address, no wa.me link with a number, no number
    // written after either name.
    for (const [file, source] of Object.entries(allSources)) {
      expect(source, file).not.toMatch(/chat\.whatsapp\.com|wa\.me\/\d|api\.whatsapp\.com\/send\?phone=\d/);
    }
    expect(devVarsExample).not.toMatch(/chat\.whatsapp\.com|wa\.me\/\d/);
    for (const text of [portalConfigText, adminConfigText]) expect(text).not.toMatch(/chat\.whatsapp\.com|wa\.me\/\d/);
    // No value after either name, anywhere in the file: the only thing that may follow one is an EMPTY string (the staging block declares both empty, SAKEM-098).
    expect(portalConfigText).not.toMatch(/PORTAL_(CONTACT_WHATSAPP|WHATSAPP_GROUP_URL)["']?\s*[:=]\s*["']?[^"'\s,]/);
    for (const name of names) expect(portal.env?.staging?.vars?.[name], `the staging block's ${name}`).toBe("");
  });

  test("no SSE-C (Dzul, 2026-10-13): no key is declared, and nothing in the source passes one to R2", () => {
    expect(envSources["../src/env.ts"]).toBeDefined();
    expect(envSources["../src/env.ts"]).not.toMatch(/PRIVATE_FILES_KEY\??\s*:/); // not a binding or a variable of the Worker
    for (const [file, source] of Object.entries(allSources)) expect(source, file).not.toMatch(/ssecKey|\bPRIVATE_FILES_KEY\b|\bssec\b/i);
    for (const config of [admin, portal]) expect(config.vars).not.toHaveProperty("PRIVATE_FILES_KEY");
    expect(devVarsExample.length).toBeGreaterThan(0);
    expect(devVarsExample).not.toMatch(/^\s*PRIVATE_FILES_KEY\s*=/m);
  });

  describe("rate limit bindings", () => {
    const namesOf = (config: WranglerConfig) => config.ratelimits.map((entry) => entry.name).sort();

    test("every binding has the limit and the period of src/security/rate-limit.ts (the Worker, the table and the config say one thing)", () => {
      const byBinding = new Map(Object.values(RATE_LIMITS).map((config) => [config.binding, config]));
      for (const config of [admin, portal]) {
        for (const entry of config.ratelimits) {
          const expected = byBinding.get(entry.name as never);
          expect(expected, `${config.name} declares ${entry.name}, which the table does not know`).toBeDefined();
          expect(entry.simple, `${config.name} ${entry.name}`).toEqual({ limit: expected!.limit, period: expected!.period });
        }
      }
      // The admin declares every limiter of the table (the Worker suite runs each against Miniflare's binding).
      expect(namesOf(admin)).toEqual(Object.values(RATE_LIMITS).map((config) => config.binding).sort());
    });

    test("the portal declares every limiter its code uses: the auth routes' and the signed-in student routes'", () => {
      const used = new Set<LimitName>(["portalRead", "portalSave", "portalUpload", "portalSubmit"]);
      for (const policy of AUTH_POLICIES) for (const check of policy.limits({ ip: "203.0.113.1", email: "abc" })) used.add(check.name);
      const needed = [...used].map((name) => RATE_LIMITS[name].binding).sort();
      expect(namesOf(portal)).toEqual(needed);
      expect(needed).toEqual([
        "RL_LOGIN",
        "RL_LOGIN_ACCOUNT",
        "RL_MAIL_TARGET",
        "RL_PORTAL_READ",
        "RL_PORTAL_SAVE",
        "RL_PORTAL_SUBMIT",
        "RL_PORTAL_UPLOAD",
        "RL_REGISTER",
        "RL_RESET",
        "RL_TOKEN",
        "RL_VERIFY_RESEND",
      ]);
      // And not the ones that are the admin's: the portal never uploads through the admin kit, previews markdown or takes the contact form.
      for (const other of ["RL_CONTACT", "RL_UPLOAD", "RL_BLOG_PREVIEW", "RL_ADMIN_FILE"]) expect(namesOf(portal)).not.toContain(other);
    });

    test("namespaces are numbers we choose, unique across BOTH files and BOTH staging blocks (ids are per account, and a shared id would share a counter): the portal's are its own, 80xx, and its staging block's 81xx", () => {
      const staging = admin.env?.staging?.ratelimits ?? [];
      const portalStaging = portal.env?.staging?.ratelimits ?? [];
      expect(staging.length).toBeGreaterThan(0);
      expect(portalStaging.length).toBeGreaterThan(0);
      const all = [...admin.ratelimits, ...staging, ...portal.ratelimits, ...portalStaging].map((entry) => entry.namespace_id);
      expect(new Set(all).size).toBe(all.length);
      for (const entry of portal.ratelimits) expect(entry.namespace_id, entry.name).toMatch(/^80\d\d$/);
      for (const entry of admin.ratelimits) expect(entry.namespace_id, entry.name).toMatch(/^78\d\d$/);
      for (const entry of staging) expect(entry.namespace_id, entry.name).toMatch(/^79\d\d$/);
      for (const entry of portalStaging) expect(entry.namespace_id, entry.name).toMatch(/^81\d\d$/);
    });

    test("a limit is keyed by user id on the student routes, and the ones that count a minute are 60 s windows", () => {
      for (const name of ["portalRead", "portalSave", "portalUpload", "portalSubmit", "adminFile"] as const) expect(RATE_LIMITS[name].period).toBe(60);
      expect(RATE_LIMITS.portalRead.limit).toBe(60);
      expect(RATE_LIMITS.portalSave.limit).toBe(30);
      expect(RATE_LIMITS.portalUpload.limit).toBe(20);
      expect(RATE_LIMITS.portalSubmit.limit).toBe(3);
      expect(RATE_LIMITS.adminFile.limit).toBe(120);
    });
  });
});

describe("the package and the migrations", () => {
  test("the scripts that start and build the portal Worker use its own configuration", () => {
    expect(packageJson.scripts["dev:portal"]).toBe("pnpm build:portal-spa && wrangler dev -c wrangler.portal.jsonc --port 8788");
    expect(packageJson.scripts["build:portal-worker"]).toBe("pnpm build:portal-spa && wrangler deploy --dry-run -c wrangler.portal.jsonc --outdir dist/portal-worker");
    // The admin's are as they were.
    expect(packageJson.scripts["dev"]).toBe("pnpm build:spa && wrangler dev");
    expect(packageJson.scripts["build:worker"]).toBe("pnpm build:spa && wrangler deploy --dry-run --outdir dist/worker");
    expect(packageJson.scripts["db:migrate:local"]).toBe("wrangler d1 migrations apply sakem-admin --local");
  });

  test("the journal lists fourteen migrations in order, the last is 0013_portal_applications", () => {
    expect(journal.entries.map((entry) => entry.tag.slice(0, 4))).toEqual(Array.from({ length: 14 }, (_, i) => String(i).padStart(4, "0")));
    expect(journal.entries.at(-1)!.tag).toBe("0013_portal_applications");
  });
});

// ─── What the portal's source may import ───────────────────────────────

const portalSources = import.meta.glob<string>("../src/portal/**/*.ts", { query: "?raw", import: "default", eager: true });
const privateFileSources = import.meta.glob<string>("../src/private-files/**/*.ts", { query: "?raw", import: "default", eager: true });
const uploadSources = import.meta.glob<string>("../src/uploads/**/*.ts", { query: "?raw", import: "default", eager: true });
const envSources = import.meta.glob<string>("../src/env.ts", { query: "?raw", import: "default", eager: true });
const allSources = import.meta.glob<string>("../src/**/*.ts", { query: "?raw", import: "default", eager: true });
const devVarsFiles = import.meta.glob<string>("../dev.vars.example", { query: "?raw", import: "default", eager: true });
const devVarsExample = Object.values(devVarsFiles)[0] ?? "";
const adminEntry = import.meta.glob<string>("../src/worker.ts", { query: "?raw", import: "default", eager: true });
const authSources = import.meta.glob<string>("../src/auth/**/*.ts", { query: "?raw", import: "default", eager: true });

/** Every module specifier a file imports (static, re-exported or dynamic). */
function importsOf(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm)) found.push(match[1]!);
  return found;
}

/** The imports a portal file must not have: what would drag the blog, the public API, the other admin areas or the markdown libraries into its bundle (docs/cloudflare/portal-architecture.md, 4.2), and the admin's own guards and entry. */
function forbiddenImport(specifier: string): string | null {
  const rules: [RegExp, string][] = [
    [/(^|\/)blog(\/|$)/, "the blog"],
    [/(^|\/)public(\/|$)/, "the public API"],
    [/(^|\/)api\/(?!crud\/errors$)/, "an admin API route file (only the CRUD kit's error envelope is shared)"],
    [/^\.\.\/(reports|shortlinks|announcements|dashboard|audit|cron)(\/|$)/, "another admin area (src/db/audit, the audit row writer, is shared and fine)"],
    [/(^|\/)auth\/(guard|permissions)$/, "the admin's guards (a student route starts with requireStudent)"],
    [/^\.\.\/worker$|^\.\.\/\.\.\/src\/worker$/, "the admin Worker's entry"],
    [/^(unified|remark|rehype|gray-matter|marked|markdown-it)(-|\/|$)/, "a markdown library"],
    [/^(react|react-dom|react-router|lucide-react)(\/|$)/, "a browser library"],
  ];
  for (const [pattern, what] of rules) if (pattern.test(specifier)) return what;
  return null;
}

describe("what src/portal may import (the bundle stays the portal's, not the admin's)", () => {
  test("the rules catch what they are meant to catch (so the test below cannot pass by looking at nothing)", () => {
    for (const bad of ["../blog/render", "../public/queries", "../api/blog", "../api/applications", "../api/public/entrypoint", "../reports/rules", "../audit/lists", "../auth/guard", "../auth/permissions", "../worker", "unified", "remark-gfm", "rehype-stringify", "react"]) {
      expect(forbiddenImport(bad), bad).not.toBeNull();
    }
    for (const good of ["hono", "zod", "drizzle-orm", "../auth/session", "../auth/factory", "../db/schema", "../db/audit", "../email/send", "../security/csrf", "../uploads/sniff", "../api/crud/errors", "../../shared/application-form/schemas", "./guard", "../config/public-origin"]) {
      expect(forbiddenImport(good), good).toBeNull();
    }
    expect(importsOf(`import { a } from "../x";\nexport * from "../y";\nconst z = await import("../z");\nimport "side-effect";`)).toEqual(["../x", "../y", "../z", "side-effect"]);
  });

  test("no file under src/portal imports one of them", () => {
    const files = Object.keys(portalSources);
    expect(files.length).toBeGreaterThanOrEqual(3); // worker.ts, guard.ts, headers.ts, and whatever the other tasks add
    for (const [file, source] of Object.entries(portalSources)) {
      for (const specifier of importsOf(source)) expect(forbiddenImport(specifier), `${file} imports ${specifier}`).toBeNull();
    }
  });

  test("the admin Worker and the shared auth code do not import the portal (the audiences stay two Workers)", () => {
    for (const [file, source] of [...Object.entries(adminEntry), ...Object.entries(authSources)]) {
      for (const specifier of importsOf(source)) expect(specifier, `${file} imports ${specifier}`).not.toMatch(/(^|\/)portal(\/|$)/);
    }
  });

  test("the bucket of applicants' files and the bucket of public uploads never meet in code", () => {
    for (const [file, source] of Object.entries(uploadSources)) expect(source, `${file} mentions PRIVATE_FILES`).not.toMatch(/\bPRIVATE_FILES\b/);
    for (const [file, source] of Object.entries(privateFileSources)) expect(source, `${file} mentions UPLOADS`).not.toMatch(/\bUPLOADS\b/);
    for (const [file, source] of Object.entries(portalSources)) expect(source, `${file} mentions UPLOADS`).not.toMatch(/\bUPLOADS\b/);
  });

  test("the Worker has the reserved mount block for the tasks that add routes, and no cron", () => {
    const worker = portalSources["../src/portal/worker.ts"]!;
    expect(worker).toContain("// mounts:");
    expect(worker).toContain('// P1b: app.route(API, applicationRoutes);');
    expect(worker).toContain('// P4: app.route(API, fileRoutes);');
    expect(worker).not.toMatch(/scheduled/);
    // Every data route starts with the guard, and the guard is the one module that compares the role.
    expect(Object.entries(portalSources).filter(([file, source]) => file !== "../src/portal/guard.ts" && /role\s*[!=]==?\s*["']/.test(source))).toEqual([]);
  });
});

describe("the documents the code points at", () => {
  test("docs/cloudflare/auth.md has the section the comments link to, and says what the audience is", () => {
    expect(authDoc).toMatch(/^## Base path and audience/m);
    expect(authDoc).toContain("/portal/api/auth");
    expect(authDoc).toContain("sakem-student");
    expect(authDoc).toContain("test/portal-auth.test.ts");
  });

  test("docs/cloudflare/portal-api.md says what GET /portal/api/config answers, adminUrl included", () => {
    expect(portalApiDoc).toContain('`{ "google": boolean, "turnstileSiteKey": string | null, "siteUrl": string, "adminUrl": string, "contactWhatsapp"?: string, "whatsappGroupUrl"?: string }`');
    for (const name of ["PORTAL_CONTACT_WHATSAPP", "PORTAL_WHATSAPP_GROUP_URL"]) expect(portalApiDoc, name).toContain(name);
  });
});
