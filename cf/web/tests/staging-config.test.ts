import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unstable_readConfig } from 'wrangler';
import { describe, expect, it } from 'vitest';
import { WORKERS } from '../../scripts/staging-deploy-command.mjs';
import { readRoot, repoRoot, webRoot } from './helpers';

// The staging environment (SAKEM-084, docs/cloudflare/staging-runbook.md): the same code deployed as Workers
// of other names. wrangler's own reader resolves what each environment inherits, so what is compared here is
// what `wrangler deploy` would use, not what the file looks like. Nothing here talks to Cloudflare.
//
//   cf/web/wrangler.jsonc    the site; the Astro adapter's Vite plugin picks the environment from CLOUDFLARE_ENV at build time
//   cf/admin/wrangler.jsonc  the API Worker; `--env staging`
//   cf/admin/wrangler.portal.jsonc  the student portal's Worker (SAKEM-098); `-c wrangler.portal.jsonc --env staging`

const adminFile = path.join(repoRoot, 'cf/admin/wrangler.jsonc');
const portalFile = path.join(repoRoot, 'cf/admin/wrangler.portal.jsonc');
const webFile = path.join(webRoot, 'wrangler.jsonc');

/** The part of wrangler's resolved configuration these tests read. */
interface Resolved {
  name: string;
  main?: string;
  targetEnvironment?: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  routes?: unknown[];
  vars: Record<string, string>;
  services: { binding: string; service: string; entrypoint?: string }[];
  d1_databases: { binding: string; database_name: string; migrations_dir: string }[];
  r2_buckets: { binding: string; bucket_name: string }[];
  ratelimits: { name: string; namespace_id: string; simple: { limit: number; period: number } }[];
  assets?: unknown;
  triggers?: unknown;
  observability?: unknown;
  compatibility_date?: string;
  compatibility_flags?: string[];
}
const read = (file: string, env?: string) => unstable_readConfig({ config: file, env }, {}) as unknown as Resolved;

const adminProduction = read(adminFile);
const adminStaging = read(adminFile, 'staging');
const webProduction = read(webFile);
const webStaging = read(webFile, 'staging');
const portalProduction = read(portalFile);
const portalStaging = read(portalFile, 'staging');

describe('names', () => {
  it('the staging Workers are `sakem-admin-staging` and `sakem-web-staging`, and the production ones keep their names', () => {
    expect(adminProduction.name).toBe('sakem-admin');
    expect(adminStaging.name).toBe('sakem-admin-staging');
    expect(webProduction.name).toBe('sakola-kembara-web');
    expect(webStaging.name).toBe('sakem-web-staging');
  });

  it('the admin staging name is the production name plus `-staging`: wrangler\'s rule for a binding that targets an environment', () => {
    expect(adminStaging.name).toBe(`${adminProduction.name}-staging`);
  });

  it('the staging names are valid workers.dev labels (63 characters, letters, digits and dashes, no dash at either end)', () => {
    for (const name of [adminStaging.name, webStaging.name]) expect(name).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
  });
});

describe('the service binding of the site', () => {
  it('production: `API` is the PublicApi entrypoint of the production admin Worker', () => {
    expect(webProduction.services).toEqual([{ binding: 'API', service: adminProduction.name, entrypoint: 'PublicApi' }]);
  });

  it('staging: `API` is the PublicApi entrypoint of the STAGING admin Worker, and of no other', () => {
    expect(webStaging.services).toEqual([{ binding: 'API', service: adminStaging.name, entrypoint: 'PublicApi' }]);
    expect(webStaging.services[0]!.service).not.toBe(adminProduction.name);
  });

  it('the entrypoint exists in the admin Worker, which both environments export', () => {
    expect(readRoot('cf/admin/src/worker.ts')).toContain('export { PublicApi }');
  });
});

describe('the admin Worker: staging has the same bindings, limiters and settings as production', () => {
  it('the same D1 binding, R2 binding and migrations folder, on resources of their own (named, never identified)', () => {
    expect(adminStaging.d1_databases.map((d) => [d.binding, d.migrations_dir])).toEqual(adminProduction.d1_databases.map((d) => [d.binding, d.migrations_dir]));
    expect(adminStaging.d1_databases.map((d) => d.database_name)).toEqual(['sakem-staging']);
    // The second bucket is the applicants' private one (SAKEM-083, the student portal).
    expect(adminStaging.r2_buckets.map((b) => [b.binding, b.bucket_name])).toEqual([
      ['UPLOADS', 'sakem-files-staging'],
      ['PRIVATE_FILES', 'sakem-private-staging'],
    ]);
    for (const resource of [...adminStaging.d1_databases, ...adminStaging.r2_buckets]) {
      expect(Object.keys(resource).filter((key) => /(^|_)id$/.test(key))).toEqual([]);
    }
  });

  it('every limiter of production is in staging under the same name, with the same limit and period', () => {
    const summary = (r: Resolved['ratelimits']) => r.map((l) => ({ name: l.name, simple: l.simple }));
    expect(summary(adminStaging.ratelimits)).toEqual(summary(adminProduction.ratelimits));
    // Ten of the first milestones, plus the student portal's four RL_PORTAL_* and RL_ADMIN_FILE (SAKEM-083).
    expect(adminProduction.ratelimits).toHaveLength(15);
  });

  it('the namespaces of the two environments are all different (a shared namespace shares counters, even across Workers)', () => {
    const ids = [...adminProduction.ratelimits, ...adminStaging.ratelimits].map((l) => l.namespace_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[1-9][0-9]*$/);
  });

  it('the same assets setup, cron trigger, observability, compatibility date and flags', () => {
    expect(adminStaging.assets).toEqual(adminProduction.assets);
    expect(adminStaging.triggers).toEqual(adminProduction.triggers);
    expect(adminStaging.observability).toEqual(adminProduction.observability);
    expect(adminStaging.compatibility_date).toBe(adminProduction.compatibility_date);
    expect(adminStaging.compatibility_flags).toEqual(adminProduction.compatibility_flags);
    expect(adminStaging.main).toBe(adminProduction.main);
  });

  it('the same variables, and an ENVIRONMENT that is not `development` or `test` (so email, Turnstile and rate limiting fail closed like production)', () => {
    expect(Object.keys(adminStaging.vars).sort()).toEqual(Object.keys(adminProduction.vars).sort());
    expect(adminStaging.vars.ENVIRONMENT).toBe('staging');
    expect(['development', 'test']).not.toContain(adminStaging.vars.ENVIRONMENT);
  });

  it('is on workers.dev only, without per-version preview hosts', () => {
    expect(adminStaging.workers_dev).toBe(true);
    expect(adminStaging.preview_urls).toBe(false);
    expect(adminStaging.routes ?? []).toEqual([]);
  });
});

describe('the site: staging has the production settings, and no escape hatch', () => {
  it('the same compatibility date, flags and observability', () => {
    expect(webStaging.compatibility_date).toBe(webProduction.compatibility_date);
    expect(webStaging.compatibility_flags).toEqual(webProduction.compatibility_flags);
    expect(webStaging.observability).toEqual(webProduction.observability);
  });

  it('no variable of either environment is set in the file: no API URL (it would win over the binding), no legacy origin, no key', () => {
    expect(Object.keys(webProduction.vars)).toEqual([]);
    expect(Object.keys(webStaging.vars)).toEqual([]);
  });

  it('is on workers.dev only, without a route (the production route is added at the cutover, not here)', () => {
    expect(webStaging.workers_dev).toBe(true);
    expect(webStaging.preview_urls).toBe(false);
    expect(webStaging.routes ?? []).toEqual([]);
    expect(webProduction.routes ?? []).toEqual([]);
  });

  it('`main` and `assets` stay unset: the adapter injects them at build time (dist/server/wrangler.json)', () => {
    const text = readFileSync(webFile, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(text).not.toMatch(/"main"\s*:/);
    expect(text).not.toMatch(/"assets"\s*:/);
  });
});

describe('the portal Worker: staging has the same bindings, limiters and settings as its top level, and resources of its own', () => {
  const summary = (r: Resolved['ratelimits']) => r.map((l) => ({ name: l.name, simple: l.simple }));
  const FIXED_VARS = ['ENVIRONMENT', 'PRIVATE_FILES_BUDGET_BYTES'];

  it('the Worker is `sakem-portal-staging`, a valid workers.dev label, and the production one keeps its name', () => {
    expect(portalProduction.name).toBe('sakem-portal');
    expect(portalStaging.name).toBe('sakem-portal-staging');
    expect(portalStaging.name).toBe(`${portalProduction.name}-staging`);
    expect(portalStaging.name).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
    expect(portalStaging.name).not.toBe(adminStaging.name);
    expect(portalStaging.name).not.toBe(webStaging.name);
  });

  it('is on workers.dev only, with no route, no preview hosts and no service binding (the portal calls no other Worker)', () => {
    expect(portalStaging.workers_dev).toBe(true);
    expect(portalStaging.preview_urls).toBe(false);
    expect(portalStaging.routes ?? []).toEqual([]);
    expect(portalProduction.routes ?? []).toEqual([]);
    expect(portalStaging.services ?? []).toEqual([]);
    expect(portalStaging.triggers ?? {}).toEqual(portalProduction.triggers ?? {});
    // wrangler resolves `main` to an absolute path: the same entry as the top level's, the portal's, not the admin's.
    expect(portalStaging.main).toBe(portalProduction.main);
    expect(portalStaging.main).toMatch(/\/cf\/admin\/src\/portal\/worker\.ts$/);
  });

  it('the database is the ADMIN STAGING one, named and never identified; the private bucket is the one the admin staging binds, and the portal has no other', () => {
    expect(portalStaging.d1_databases.map((d) => [d.binding, d.migrations_dir])).toEqual(portalProduction.d1_databases.map((d) => [d.binding, d.migrations_dir]));
    expect(portalStaging.d1_databases).toEqual(adminStaging.d1_databases);
    expect(portalStaging.d1_databases.map((d) => d.database_name)).toEqual(['sakem-staging']);
    expect(portalStaging.r2_buckets.map((b) => [b.binding, b.bucket_name])).toEqual([['PRIVATE_FILES', 'sakem-private-staging']]);
    expect(adminStaging.r2_buckets.find((b) => b.binding === 'PRIVATE_FILES')?.bucket_name).toBe('sakem-private-staging');
    for (const resource of [...portalStaging.d1_databases, ...portalStaging.r2_buckets]) {
      expect(Object.keys(resource).filter((key) => /(^|_)id$/.test(key))).toEqual([]);
    }
  });

  it('every limiter of the top level is in staging under the same name, with the same limit and period', () => {
    expect(summary(portalStaging.ratelimits)).toEqual(summary(portalProduction.ratelimits));
    // The seven auth limiters and the four signed-in student ones.
    expect(portalProduction.ratelimits).toHaveLength(11);
    for (const other of ['RL_CONTACT', 'RL_UPLOAD', 'RL_BLOG_PREVIEW', 'RL_ADMIN_FILE']) expect(portalStaging.ratelimits.map((l) => l.name)).not.toContain(other);
  });

  it('the namespaces of ALL FOUR blocks are different (an id is per account, and a shared id shares a counter): staging is the top level plus 100', () => {
    const blocks = { adminProduction, adminStaging, portalProduction, portalStaging };
    const ids = Object.values(blocks).flatMap((block) => block.ratelimits.map((l) => l.namespace_id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[1-9][0-9]*$/);
    for (const entry of portalStaging.ratelimits) {
      const top = portalProduction.ratelimits.find((l) => l.name === entry.name)!;
      expect(Number(entry.namespace_id)).toBe(Number(top.namespace_id) + 100);
    }
  });

  it('the same assets setup, observability, compatibility date and flags; the same variables plus the per-deploy ones; an ENVIRONMENT that is not `development` or `test`', () => {
    expect(portalStaging.assets).toEqual(portalProduction.assets);
    expect(portalStaging.observability).toEqual(portalProduction.observability);
    expect(portalStaging.compatibility_date).toBe(portalProduction.compatibility_date);
    expect(portalStaging.compatibility_flags).toEqual(portalProduction.compatibility_flags);
    expect(Object.keys(portalStaging.vars).filter((name) => Object.keys(portalProduction.vars).includes(name)).sort()).toEqual(Object.keys(portalProduction.vars).sort());
    expect(portalStaging.vars.ENVIRONMENT).toBe('staging');
    expect(['development', 'test']).not.toContain(portalStaging.vars.ENVIRONMENT);
    expect(portalStaging.vars.PRIVATE_FILES_BUDGET_BYTES).toBe(portalProduction.vars.PRIVATE_FILES_BUDGET_BYTES);
  });

  it('the variables the printer may pass are exactly the ones the staging block declares empty (a name in one list and not the other is a deploy that blanks it or a value nothing reads)', () => {
    const declaredEmpty = Object.entries(portalStaging.vars)
      .filter(([name]) => !FIXED_VARS.includes(name))
      .map(([name, value]) => {
        expect(value, name).toBe('');
        return name;
      });
    expect(declaredEmpty.sort()).toEqual([...WORKERS.portal.allowed].sort());
  });
});

describe('nothing in git identifies an account or a resource', () => {
  const files = [adminFile, webFile, portalFile];

  it('no id, account id, 32-character hex string, host or URL inside the staging blocks', () => {
    for (const file of files) {
      const raw = readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
      const staging = JSON.stringify((JSON.parse(raw) as { env: { staging: unknown } }).env.staging);
      expect(staging, file).not.toMatch(/"(?:database_id|account_id|id|zone_id|pattern)"\s*:/);
      expect(staging, file).not.toMatch(/https?:|\.workers\.dev|\.r2\.dev|[0-9a-f]{32}/i);
    }
  });

  it('only one environment exists in each file: `staging`', () => {
    for (const config of [adminStaging, webStaging, portalStaging]) expect(config.targetEnvironment).toBe('staging');
    for (const file of files) {
      const raw = readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
      expect(Object.keys((JSON.parse(raw) as { env: Record<string, unknown> }).env)).toEqual(['staging']);
    }
  });
});

describe('the package scripts never deploy by themselves', () => {
  const scripts = (rel: string) => (JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8')) as { scripts: Record<string, string> }).scripts;
  const packages = { 'cf/admin': scripts('cf/admin/package.json'), 'cf/web': scripts('cf/web/package.json') };

  it('every script that runs `wrangler deploy` is a dry run', () => {
    for (const [pkg, table] of Object.entries(packages)) {
      for (const [name, command] of Object.entries(table)) {
        if (/wrangler\s+deploy|wrangler\s+versions\s+upload/.test(command)) expect(command, `${pkg} ${name}`).toContain('--dry-run');
      }
    }
  });

  it('no script logs in, writes a secret, applies a remote migration or tails a Worker', () => {
    for (const [pkg, table] of Object.entries(packages)) {
      for (const [name, command] of Object.entries(table)) {
        expect(command, `${pkg} ${name}`).not.toMatch(/wrangler\s+(login|logout|secret|tail|delete|r2|kv)|--remote|d1\s+create|migrations\s+apply\s+\S+\s+--remote/);
      }
    }
  });

  it('both packages have the staging dry run and the printed deploy command, through the shared scripts of cf/scripts', () => {
    // The admin package's dry run covers the portal too (the same package, a second configuration); the portal's own can run alone.
    expect(packages['cf/admin']['deploy:staging:dry']).toBe('pnpm build:spa && node ../scripts/staging-dry-run.mjs admin && pnpm deploy:staging:portal:dry');
    expect(packages['cf/admin']['deploy:staging:portal:dry']).toBe('pnpm build:portal-spa && node ../scripts/staging-dry-run.mjs portal');
    expect(packages['cf/web']['deploy:staging:dry']).toBe('pnpm build:staging && node ../scripts/staging-dry-run.mjs web');
    expect(packages['cf/admin']['deploy:staging:command']).toBe('node ../scripts/staging-deploy-command.mjs admin');
    expect(packages['cf/admin']['deploy:staging:portal:command']).toBe('node ../scripts/staging-deploy-command.mjs portal');
    expect(packages['cf/web']['deploy:staging:command']).toBe('node ../scripts/staging-deploy-command.mjs web');
    expect(packages['cf/web']['build:staging']).toBe('CLOUDFLARE_ENV=staging pnpm build');
  });

  it("the untracked file of public per-deploy values is ignored by the repository, the portal's own file name included", () => {
    expect(readRoot('.gitignore')).toMatch(/^cf\/\*\*\/\.staging\.vars\*$/m);
    // The pattern as the ignore file reads it (`**` is any folders, `*` any characters but a slash), against the file each printer reads by default.
    const pattern = /^cf\/(?:.*\/)?\.staging\.vars[^/]*$/;
    for (const worker of Object.values(WORKERS)) {
      const folder = worker.name.includes('web') ? 'cf/web' : 'cf/admin';
      expect(`${folder}/${worker.file}`, worker.name).toMatch(pattern);
    }
    expect(WORKERS.portal.file).toBe('.staging.vars.portal');
    expect(WORKERS.portal.file).not.toBe(WORKERS.admin.file);
  });
});
