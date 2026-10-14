import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unstable_readConfig } from 'wrangler';
import { describe, expect, it } from 'vitest';
import { readRoot, repoRoot, webRoot } from './helpers';

// The staging environment (SAKEM-084, docs/cloudflare/staging-runbook.md): the same code deployed as Workers
// of other names. wrangler's own reader resolves what each environment inherits, so what is compared here is
// what `wrangler deploy` would use, not what the file looks like. Nothing here talks to Cloudflare.
//
//   cf/web/wrangler.jsonc    the site; the Astro adapter's Vite plugin picks the environment from CLOUDFLARE_ENV at build time
//   cf/admin/wrangler.jsonc  the API Worker; `--env staging`

const adminFile = path.join(repoRoot, 'cf/admin/wrangler.jsonc');
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

describe('nothing in git identifies an account or a resource', () => {
  const files = [adminFile, webFile];

  it('no id, account id, 32-character hex string, host or URL inside the staging blocks', () => {
    for (const file of files) {
      const raw = readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
      const staging = JSON.stringify((JSON.parse(raw) as { env: { staging: unknown } }).env.staging);
      expect(staging, file).not.toMatch(/"(?:database_id|account_id|id|zone_id|pattern)"\s*:/);
      expect(staging, file).not.toMatch(/https?:|\.workers\.dev|\.r2\.dev|[0-9a-f]{32}/i);
    }
  });

  it('only one environment exists in each file: `staging`', () => {
    for (const config of [adminStaging, webStaging]) expect(config.targetEnvironment).toBe('staging');
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
    expect(packages['cf/admin']['deploy:staging:dry']).toBe('pnpm build:spa && node ../scripts/staging-dry-run.mjs admin');
    expect(packages['cf/web']['deploy:staging:dry']).toBe('pnpm build:staging && node ../scripts/staging-dry-run.mjs web');
    expect(packages['cf/admin']['deploy:staging:command']).toBe('node ../scripts/staging-deploy-command.mjs admin');
    expect(packages['cf/web']['deploy:staging:command']).toBe('node ../scripts/staging-deploy-command.mjs web');
    expect(packages['cf/web']['build:staging']).toBe('CLOUDFLARE_ENV=staging pnpm build');
  });

  it('the untracked file of public per-deploy values is git-ignored', () => {
    expect(readRoot('.gitignore')).toMatch(/^cf\/\*\*\/\.staging\.vars\*$/m);
  });
});
