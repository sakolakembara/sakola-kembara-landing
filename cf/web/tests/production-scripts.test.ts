import { execFile } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { unstable_readConfig } from 'wrangler';
import { describe, expect, it } from 'vitest';
import { TARGETS as STAGING_TARGETS } from '../../scripts/staging-dry-run.mjs';
import { parseVarsFile } from '../../scripts/staging-deploy-command.mjs';
import {
  NEVER,
  NOT_PRINTED,
  PRODUCTION_ORIGINS,
  SPECS,
  WORKERS,
  buildCommand,
  buildLine,
  builtBeaconProblems,
  builtConfigProblems,
  builtPortalProblems,
  describeResources,
  missingRequired,
  readJsonc,
  validateVars,
} from '../../scripts/production-deploy-command.mjs';
import { TARGETS, checkProductionDryRun, productionDryRunEnv } from '../../scripts/production-dry-run.mjs';
import { parseBeaconId } from '../web-analytics.config.mjs';
import { parsePortalEnabled } from '../portal-enabled.config.mjs';
import { readRoot, repoRoot, webRoot } from './helpers';

// cf/scripts/production-deploy-command.mjs and cf/scripts/production-dry-run.mjs (SAKEM-104, cutover Phase A). Like their staging
// siblings (tests/staging-scripts.test.ts) both are pure around one spawn or one file read, so the checks run on text. Nothing
// talks to Cloudflare. Every refusal has a test, and `pnpm test:negative:production` breaks each safeguard to prove it.

type WorkerName = 'admin' | 'web';
const WORKER_NAMES: WorkerName[] = ['admin', 'web'];
const validate = (worker: WorkerName, text: string) => validateVars(worker, parseVarsFile(text));

// Invented, public-shaped values (none is a real key): a site key, a 32-character beacon id.
const KEY = '0x4AAAAAAAdemoKey123456';
const BEACON = '0123456789abcdef0123456789abcdef';
const OTHER_BEACON = 'fedcba9876543210fedcba9876543210';

const GOOD = {
  admin: [`TURNSTILE_SITE_KEY=${KEY}`, `UPLOADS_BASE_URL=${PRODUCTION_ORIGINS.UPLOADS_BASE_URL}`, `SITE_URL=${PRODUCTION_ORIGINS.SITE_URL}`].join('\n'),
  web: [
    `TURNSTILE_SITE_KEY=${KEY}`,
    `ADMIN_URL=${PRODUCTION_ORIGINS.ADMIN_URL}`,
    `UPLOADS_BASE_URL=${PRODUCTION_ORIGINS.UPLOADS_BASE_URL}`,
    `WEB_ANALYTICS_BEACON_ID=${BEACON}`,
    'PAGE_CACHE_SECONDS=30',
  ].join('\n'),
};
const exampleOf = (worker: WorkerName) => `cf/${worker}/production.vars.example`;

/** The production top level of a wrangler file, as wrangler's own reader resolves it. */
interface Resolved {
  name: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  routes?: unknown[];
  vars: Record<string, string>;
  services: { binding: string; service: string; entrypoint?: string }[];
  d1_databases: { binding: string; database_name: string }[];
  r2_buckets: { binding: string; bucket_name: string }[];
  ratelimits: { name: string; namespace_id: string; simple: { limit: number; period: number } }[];
}
const read = (rel: string, env?: string) => unstable_readConfig({ config: path.join(repoRoot, rel), env }, {}) as unknown as Resolved;

describe('production-deploy-command: what it accepts', () => {
  it('accepts the public values of each Worker', () => {
    for (const worker of WORKER_NAMES) expect(() => validate(worker, GOOD[worker]), worker).not.toThrow();
    expect(() => validate('admin', `${GOOD.admin}\nEMAIL_FROM=Sakola Kembara <no-reply@sakolakembara.org>`)).not.toThrow();
    expect(() => validate('admin', `${GOOD.admin}\nEMAIL_FROM=no-reply@mail.sakolakembara.org`)).not.toThrow();
    expect(() => validate('web', `${GOOD.web}\nCONTENT_CACHE_FRESH_SECONDS=60\nTEAM_CACHE_FRESH_SECONDS=300`)).not.toThrow();
  });

  it('the example files are placeholders: copied as they are, they are refused, and every name in them is one the Worker accepts', () => {
    for (const worker of WORKER_NAMES) {
      const example = readFileSync(path.join(repoRoot, exampleOf(worker)), 'utf8');
      expect(() => validate(worker, example), worker).toThrow(/placeholder/);
      for (const { name } of parseVarsFile(example)) expect(WORKERS[worker].allowed, `${worker} ${name}`).toContain(name);
    }
  });

  it('a filled example (placeholders replaced by invented values) is accepted, shows every required name, and prints a command', () => {
    for (const worker of WORKER_NAMES) {
      const filled = readFileSync(path.join(repoRoot, exampleOf(worker)), 'utf8').replace('<site key of the production widget>', KEY).replace('<32 hexadecimal characters of the site token>', BEACON);
      const entries = parseVarsFile(filled);
      expect(() => validateVars(worker, entries), worker).not.toThrow();
      expect(missingRequired(worker, entries), worker).toEqual([]);
      // every required name, and PORTAL_ENABLED=false in the site's example (optional: Phase A may also leave it out)
      expect(entries.map((e) => e.name).sort()).toEqual([...SPECS[worker].filter((s) => s.required).map((s) => s.name), ...(worker === 'web' ? ['PORTAL_ENABLED'] : [])].sort());
      expect(buildCommand(worker, entries)).toMatch(/^pnpm exec wrangler deploy /);
    }
  });

  it('the examples name no real key or account value: only the three public hosts and placeholders (the comments may talk about what is refused)', () => {
    for (const worker of WORKER_NAMES) {
      const example = readFileSync(path.join(repoRoot, exampleOf(worker)), 'utf8');
      expect(example).not.toMatch(/\b0x4[A-Za-z0-9_-]{15,}|\bre_[A-Za-z0-9]{12,}|[0-9a-f]{32}/i);
      const values = example.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
      expect(values).not.toMatch(/workers\.dev|r2\.dev|\.invalid|resend\.dev|localhost|staging/i);
      const hosts = new Set([...values.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]));
      expect(hosts.size).toBeGreaterThan(0);
      for (const host of hosts) expect(Object.values(PRODUCTION_ORIGINS).map((o) => new URL(o).host), host).toContain(host);
    }
  });
});

describe('production-deploy-command: what it refuses', () => {
  it('every secret name, whatever the Worker, and says why', () => {
    for (const name of ['BETTER_AUTH_SECRET', 'TURNSTILE_SECRET_KEY', 'RESEND_API_KEY', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'CLOUDFLARE_API_TOKEN', 'ADMIN_PASSWORD', 'PRIVATE_FILES_KEY']) {
      for (const worker of WORKER_NAMES) expect(() => validate(worker, `${name}=whatever12345`), `${worker} ${name}`).toThrow(/refused, a secret/);
    }
  });

  it('the API URLs, the legacy origin (whatever its value), ENVIRONMENT, the cookie settings and the fixed settings', () => {
    for (const name of ['CONTENT_API_URL', 'CONTACT_API_URL']) for (const worker of WORKER_NAMES) expect(() => validate(worker, `${name}=https://api.example.org`), `${worker} ${name}`).toThrow(/service binding/);
    for (const value of ['https://no-legacy-origin.invalid', 'https://sakolakembara.org', 'https://wordpress-origin.example.net']) {
      expect(() => validate('web', `LEGACY_ORIGIN_URL=${value}`), value).toThrow(/unset in production/);
    }
    for (const worker of WORKER_NAMES) {
      expect(() => validate(worker, 'ENVIRONMENT=production'), worker).toThrow(/top level of the wrangler configuration/);
      expect(() => validate(worker, 'COOKIE_DOMAIN=.sakolakembara.org'), worker).toThrow(/host-only cookies/);
      expect(() => validate(worker, 'TRUSTED_ORIGINS=https://admin.sakolakembara.org'), worker).toThrow(/host-only cookies/);
      for (const name of ['PRIVATE_FILES_BUDGET_BYTES', 'AUDIT_RETENTION_DAYS', 'DRAFT_RETENTION_DAYS', 'REJECTED_FILES_RETENTION_DAYS', 'ACCEPTED_FILES_RETENTION_DAYS']) {
        expect(() => validate(worker, `${name}=1`), `${worker} ${name}`).toThrow(/fixed setting/);
      }
      for (const name of ['PORTAL_CONTACT_WHATSAPP', 'PORTAL_WHATSAPP_GROUP_URL']) expect(() => validate(worker, `${name}=62812000000`), `${worker} ${name}`).toThrow(/not part of Phase A/);
    }
  });

  it("a name that belongs to the other Worker (the admin's SITE_URL on the site, the site's ADMIN_URL on the admin, ...)", () => {
    expect(() => validate('admin', `ADMIN_URL=${PRODUCTION_ORIGINS.ADMIN_URL}`)).toThrow(/not a variable of sakem-admin/);
    expect(() => validate('web', `SITE_URL=${PRODUCTION_ORIGINS.SITE_URL}`)).toThrow(/not a variable of sakola-kembara-web/);
    expect(() => validate('web', 'EMAIL_FROM=Sakola Kembara <no-reply@sakolakembara.org>')).toThrow(/not a variable of sakola-kembara-web/);
    expect(() => validate('admin', 'PAGE_CACHE_SECONDS=30')).toThrow(/not a variable of sakem-admin/);
    expect(() => validate('admin', `WEB_ANALYTICS_BEACON_ID=${BEACON}`)).toThrow(/not a variable of sakem-admin/);
  });

  it('an empty value, for a required and for an optional name', () => {
    for (const worker of WORKER_NAMES) {
      for (const { name } of SPECS[worker]) expect(() => validate(worker, `${name}=`), `${worker} ${name}`).toThrow(/empty/);
    }
  });

  it('a placeholder, or a character that does not belong in a public value', () => {
    for (const bad of ['<site key of the production widget>', 'REPLACE_ME_please', 'abc...def', 'CHANGEME12345', 'placeholder-key']) {
      expect(() => validate('web', `TURNSTILE_SITE_KEY=${bad}`), bad).toThrow(/placeholder/);
    }
    expect(() => validate('web', 'ADMIN_URL=https://admin.<host>.org')).toThrow(/placeholder/);
    for (const bad of ['a`b`c12345', 'a$(x)bcdefgh', 'a\\bcdefghij']) expect(() => validate('web', `TURNSTILE_SITE_KEY=${bad}`), bad).toThrow(/character that does not belong/);
  });

  it('an origin that is not https, has a path, a trailing slash, a query, credentials, or is not the host of its role', () => {
    const origin = PRODUCTION_ORIGINS.ADMIN_URL;
    for (const [bad, why] of [
      ['http://admin.sakolakembara.org', /https origin/],
      [`${origin}/`, /origin only/],
      [`${origin}/admin`, /origin only/],
      [`${origin}?a=1`, /origin only/],
      ['https://user:pw@admin.sakolakembara.org', /origin only/],
      ['admin.sakolakembara.org', /not a URL/],
      ['javascript:alert(1)', /https origin/],
      ['https://www.sakolakembara.org', /not the Phase A host/],
      ['https://admin.sakolakembara.com', /not the Phase A host/],
      ['https://ADMIN.sakolakembara.org', /not the Phase A host/],
      [PRODUCTION_ORIGINS.UPLOADS_BASE_URL, /not the Phase A host/],
    ] as const) {
      expect(() => validate('web', `ADMIN_URL=${bad}`), bad).toThrow(why);
    }
    // each name takes its own host and no other
    expect(() => validate('web', `UPLOADS_BASE_URL=${PRODUCTION_ORIGINS.ADMIN_URL}`)).toThrow(/not the Phase A host/);
    expect(() => validate('admin', `SITE_URL=${PRODUCTION_ORIGINS.ADMIN_URL}`)).toThrow(/not the Phase A host/);
    expect(() => validate('admin', 'SITE_URL=https://www.sakolakembara.org')).toThrow(/not the Phase A host/);
  });

  it('anything that looks like staging or a local run, whatever the name: workers.dev, r2.dev, the always-pass Turnstile test keys, no-legacy-origin.invalid, resend.dev', () => {
    for (const bad of ['https://sakem-admin-staging.acme.workers.dev', 'https://pub-0123abcd.r2.dev', 'https://no-legacy-origin.invalid', 'http://localhost:5173', 'http://127.0.0.1:8787']) {
      for (const [worker, name] of [['web', 'ADMIN_URL'], ['web', 'UPLOADS_BASE_URL'], ['admin', 'UPLOADS_BASE_URL'], ['admin', 'SITE_URL']] as const) {
        expect(() => validate(worker, `${name}=${bad}`), `${worker} ${name} ${bad}`).toThrow(/looks like staging/);
      }
    }
    // Cloudflare's published Turnstile test keys: always pass (1x), always block (2x), forced interactive challenge (3x)
    for (const testKey of ['1x00000000000000000000AA', '2x00000000000000000000AB', '3x00000000000000000000FF']) {
      for (const worker of WORKER_NAMES) expect(() => validate(worker, `TURNSTILE_SITE_KEY=${testKey}`), `${worker} ${testKey}`).toThrow(/TEST key/);
    }
    expect(() => validate('admin', `${GOOD.admin}\nEMAIL_FROM=Sakola Kembara <onboarding@resend.dev>`)).toThrow(/looks like staging/);
    expect(() => validate('admin', `${GOOD.admin}\nEMAIL_FROM=Sakola Kembara Staging <no-reply@sakolakembara.org>`)).toThrow(/looks like staging/);
    expect(() => validate('web', 'ADMIN_URL=https://admin-staging.sakolakembara.org')).toThrow(/looks like staging/);
  });

  it('a value of the wrong shape: a site key, a beacon id, seconds, a sender address', () => {
    expect(() => validate('web', 'TURNSTILE_SITE_KEY=short')).toThrow(/site key/);
    for (const bad of ['0123456789abcdef', `${BEACON}0`, `${BEACON.slice(0, 31)}g`, ` ${BEACON.slice(1)}`, 'not-a-beacon-id']) {
      expect(() => validate('web', `WEB_ANALYTICS_BEACON_ID=${bad}`), bad).toThrow(/beacon id/);
    }
    // the message never repeats the value that was refused
    expect(() => validate('web', 'WEB_ANALYTICS_BEACON_ID=ABCDEFsecretvalue')).toThrow(/^(?!.*secretvalue)/);
    for (const bad of ['0', '121', '-5', 'soon', '30.5', '99999']) expect(() => validate('web', `PAGE_CACHE_SECONDS=${bad}`), bad).toThrow(/seconds/);
    expect(() => validate('web', 'PAGE_CACHE_SECONDS=120')).not.toThrow();
    expect(() => validate('web', 'PAGE_CACHE_SECONDS=1')).not.toThrow();
    expect(() => validate('web', 'CONTENT_CACHE_FRESH_SECONDS=0')).toThrow(/seconds/);
    expect(() => validate('admin', 'EMAIL_FROM=Sakola <nope>')).toThrow(/Name <address@host>/);
    expect(() => validate('admin', 'EMAIL_FROM=no-reply@example.org')).toThrow(/looks like staging/);
    expect(() => validate('admin', 'EMAIL_FROM=no-reply@sakolakembara.com')).toThrow(/must be on sakolakembara.org/);
    expect(() => validate('admin', 'EMAIL_FROM=no-reply@notsakolakembara.org')).toThrow(/must be on sakolakembara.org/);
  });

  it('PORTAL_ENABLED (SAKEM-103): `false` is accepted, `true` is refused in Phase A with its reason, anything else is "exactly true or false", and the admin has no such variable', () => {
    expect(() => validate('web', `${GOOD.web}\nPORTAL_ENABLED=false`)).not.toThrow();
    expect(() => validate('web', `${GOOD.web}\nPORTAL_ENABLED=true`)).toThrow(/Phase A: `true` would show "Masuk"/);
    for (const bad of ['TRUE', 'False', '1', '0', 'yes', 'on', 'enabled', 'true;', 'falsey', '"false"x']) {
      expect(() => validate('web', `${GOOD.web}\nPORTAL_ENABLED=${bad}`), bad).toThrow(/exactly true or false/);
    }
    expect(() => validate('web', `${GOOD.web}\nPORTAL_ENABLED=`)).toThrow(/empty/);
    expect(() => validate('admin', `${GOOD.admin}\nPORTAL_ENABLED=false`)).toThrow(/not a variable of sakem-admin/);
    // it is optional: Phase A may leave it out (the portal is off by default), so a file without it is complete
    expect(missingRequired('web', parseVarsFile(GOOD.web))).toEqual([]);
    expect(SPECS.web.find((spec) => spec.name === 'PORTAL_ENABLED')!.required).toBe(false);
  });

  it("PORTAL_ENABLED is read as the site reads it (portal-enabled.config.mjs): the same text is off, on or invalid in both; the printer refuses `true` on top", () => {
    for (const value of ['true', 'false', ' true ', 'TRUE', '1', 'yes', 'on', 'maybe', '']) {
      let message = '';
      try {
        validate('web', `${GOOD.web}\nPORTAL_ENABLED=${value}`);
      } catch (error) {
        message = (error as Error).message;
      }
      const site = parsePortalEnabled(value.trim());
      if (site === null) expect(message, JSON.stringify(value)).toMatch(/exactly true or false/);
      else if (value.trim() === '') expect(message, JSON.stringify(value)).toMatch(/empty/);
      else if (site === true) expect(message, JSON.stringify(value)).toMatch(/Phase A/);
      else expect(message, JSON.stringify(value)).toBe('');
    }
  });

  it('a name set twice, and a line that is not KEY=VALUE, with its number', () => {
    expect(() => validate('web', `TURNSTILE_SITE_KEY=${KEY}\nTURNSTILE_SITE_KEY=${KEY}x`)).toThrow(/line 2 .*set twice/);
    expect(() => parseVarsFile('TURNSTILE_SITE_KEY=abc\nnot a line')).toThrow('line 2');
  });

  it('a required value that is missing: a deploy without it would remove it', () => {
    for (const worker of WORKER_NAMES) {
      const required = SPECS[worker].filter((s) => s.required).map((s) => s.name);
      expect(required.length).toBeGreaterThanOrEqual(3);
      for (const name of required) {
        const without = parseVarsFile(GOOD[worker]).filter((e) => e.name !== name);
        expect(missingRequired(worker, without), `${worker} ${name}`).toEqual([name]);
      }
      expect(missingRequired(worker, parseVarsFile(GOOD[worker]))).toEqual([]);
    }
    expect(SPECS.web.filter((s) => s.required).map((s) => s.name)).toEqual(expect.arrayContaining(['WEB_ANALYTICS_BEACON_ID', 'PAGE_CACHE_SECONDS']));
  });
});

describe('production-deploy-command: the lists', () => {
  it('hold no secret, no API URL, no ENVIRONMENT, no legacy origin and no portal contact variable (the site has the one switch, PORTAL_ENABLED)', () => {
    for (const worker of Object.values(WORKERS)) {
      for (const name of worker.allowed) expect(name).not.toMatch(/SECRET|TOKEN|PASSWORD|API_KEY|CONTENT_API_URL|CONTACT_API_URL|^ENVIRONMENT$|^LEGACY_ORIGIN_URL$|^PORTAL_(CONTACT_WHATSAPP|WHATSAPP_GROUP_URL)$|^GOOGLE_CLIENT_|COOKIE_DOMAIN|TRUSTED_ORIGINS/);
    }
    expect(WORKERS.admin.allowed).not.toContain('ADMIN_URL');
    expect(WORKERS.web.allowed).not.toContain('SITE_URL');
    // the one switch of SAKEM-103 belongs to the site only
    expect(WORKERS.web.allowed).toContain('PORTAL_ENABLED');
    expect(WORKERS.admin.allowed).not.toContain('PORTAL_ENABLED');
  });

  it("the three public origins are the host plan's and nothing else", () => {
    expect(PRODUCTION_ORIGINS).toEqual({ SITE_URL: 'https://sakolakembara.org', ADMIN_URL: 'https://admin.sakolakembara.org', UPLOADS_BASE_URL: 'https://files.sakolakembara.org' });
  });

  it('every variable a Worker declares is printable, refused with a reason, or listed as belonging to another Worker: a new variable cannot be forgotten', () => {
    // The string variables of each Worker's environment declaration. When a change adds one (SAKEM-103's, for the Phase A
    // pass-through), this test fails until a person decides: add a SPECS entry (printable), or a NEVER entry (refused).
    const declared = {
      web: [...readRoot('cf/web/src/env.d.ts').matchAll(/^\s{4}([A-Z][A-Z0-9_]*)\?: string;/gm)].map((m) => m[1]!),
      admin: [...readRoot('cf/admin/src/env.ts').matchAll(/^\s{2}([A-Z][A-Z0-9_]*)\?: string;/gm)].map((m) => m[1]!),
    };
    for (const worker of WORKER_NAMES) {
      expect(declared[worker].length, worker).toBeGreaterThan(5);
      for (const name of declared[worker]) {
        const classified = WORKERS[worker].allowed.includes(name) || NEVER.some(([pattern]) => pattern.test(name)) || (NOT_PRINTED[worker] as string[]).includes(name);
        expect(classified, `${worker}: ${name} is declared in the environment but the production printer (cf/scripts/production-deploy-command.mjs) neither prints it (SPECS) nor refuses it (NEVER): decide, then add it`).toBe(true);
      }
    }
  });

  it("the printer's beacon check is the site's own (web-analytics.config.mjs): the same values are valid in both", () => {
    for (const value of [BEACON, OTHER_BEACON, BEACON.toUpperCase(), '', '0123', `${BEACON}0`, `${BEACON.slice(0, 31)}g`, 'x'.repeat(32)]) {
      let printer = true;
      try {
        validate('web', `${GOOD.web.replace(`WEB_ANALYTICS_BEACON_ID=${BEACON}`, `WEB_ANALYTICS_BEACON_ID=${value}`)}`);
      } catch (error) {
        if (/beacon id|empty/.test((error as Error).message)) printer = false;
        else throw error;
      }
      expect(printer, JSON.stringify(value)).toBe(parseBeaconId(value) !== null);
    }
  });
});

describe('production-deploy-command: the printed command', () => {
  it('admin: deploys the top level with --env="" (which beats a CLOUDFLARE_ENV left in the shell) and passes every value as one quoted --var', () => {
    expect(buildCommand('admin', parseVarsFile(`${GOOD.admin}\nEMAIL_FROM=Sakola Kembara <no-reply@sakolakembara.org>`))).toBe(
      `pnpm exec wrangler deploy --env="" --var 'TURNSTILE_SITE_KEY:${KEY}' --var 'UPLOADS_BASE_URL:https://files.sakolakembara.org' --var 'SITE_URL:https://sakolakembara.org' --var 'EMAIL_FROM:Sakola Kembara <no-reply@sakolakembara.org>'`,
    );
  });

  it('web: deploys the config the production build wrote, and the build line carries the beacon id that the --var carries', () => {
    const entries = parseVarsFile(GOOD.web);
    const command = buildCommand('web', entries);
    expect(command.startsWith('pnpm exec wrangler deploy -c dist/server/wrangler.json --var ')).toBe(true);
    expect(command).toContain(`--var 'WEB_ANALYTICS_BEACON_ID:${BEACON}'`);
    expect(buildLine('web', entries)).toBe(`WEB_ANALYTICS_BEACON_ID=${BEACON} pnpm build:prod`);
    expect(buildLine('admin', parseVarsFile(GOOD.admin))).toBe('pnpm build:spa');
    // PORTAL_ENABLED, when the file has it, is on the build line from the same file as the --var
    const withPortal = parseVarsFile(`${GOOD.web}\nPORTAL_ENABLED=false`);
    expect(buildLine('web', withPortal)).toBe(`WEB_ANALYTICS_BEACON_ID=${BEACON} PORTAL_ENABLED=false pnpm build:prod`);
    expect(buildCommand('web', withPortal)).toContain("--var 'PORTAL_ENABLED:false'");
    expect(buildCommand('web', withPortal)).toContain(`--var 'WEB_ANALYTICS_BEACON_ID:${BEACON}'`);
  });

  it('never prints a command that is not a deploy of a production Worker', () => {
    for (const worker of WORKER_NAMES) {
      const command = buildCommand(worker, parseVarsFile(GOOD[worker]));
      expect(command).toMatch(/^pnpm exec wrangler deploy /);
      expect(command).not.toContain('--dry-run');
      expect(command).not.toMatch(/staging|workers\.dev|r2\.dev|--remote|login|secret|delete|tail|--keep-vars/);
    }
    expect(WORKERS.admin.deploy).toContain('--env=""');
    expect(WORKERS.web.deploy).toContain('dist/server/wrangler.json');
  });

  it('prints, never runs: no process is started, no request is made, the only environment variables read are CLOUDFLARE_ENV (refused when set) and whether the account is pinned', () => {
    const source = readFileSync(path.join(repoRoot, 'cf/scripts/production-deploy-command.mjs'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/child_process|spawn|execFile|execSync|\bfetch\(|node:http|node:net/);
    expect([...new Set(source.match(/process\.env[.\w]*/g))].sort()).toEqual(['process.env.CLOUDFLARE_ACCOUNT_ID', 'process.env.CLOUDFLARE_ENV']);
  });
});

describe('production-deploy-command: the program', () => {
  const run = promisify(execFile);
  const printer = path.join(repoRoot, 'cf/scripts/production-deploy-command.mjs');
  const fresh = () => mkdtempSync(path.join(tmpdir(), 'production-printer-'));
  const exec = (dir: string, args: string[], env: Record<string, string> = {}) => run(process.execPath, [printer, ...args], { cwd: dir, env: { PATH: process.env.PATH ?? '', ...env } });
  const fails = async (dir: string, args: string[], env: Record<string, string> = {}) => {
    try {
      await exec(dir, args, env);
    } catch (error) {
      return error as { code: number; stderr: string; stdout: string };
    }
    throw new Error(`expected a failure: ${args.join(' ')}`);
  };
  /** A fake `dist/` of the site: the config the build writes, and the home page with (or without) the beacon. */
  const writeDist = (dir: string, over: { name?: string; service?: string; vars?: object; workersDev?: boolean; beacon?: string | null; tags?: number; portal?: boolean } = {}) => {
    mkdirSync(path.join(dir, 'dist/server'), { recursive: true });
    mkdirSync(path.join(dir, 'dist/client'), { recursive: true });
    writeFileSync(
      path.join(dir, 'dist/server/wrangler.json'),
      JSON.stringify({ name: over.name ?? 'sakola-kembara-web', services: [{ binding: 'API', service: over.service ?? 'sakem-admin', entrypoint: 'PublicApi' }], vars: over.vars ?? {}, workers_dev: over.workersDev ?? false }),
    );
    const tag = (id: string) => `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon="{&quot;token&quot;:&quot;${id}&quot;}"></script>`;
    const beacon = over.beacon === undefined ? BEACON : over.beacon;
    const body = beacon === null ? '' : Array.from({ length: over.tags ?? 1 }, () => tag(beacon)).join('');
    const portal = over.portal ? '<a href="/portal/login" data-auth-link>Masuk</a><script>fetch("/portal/api/auth/get-session")</script>' : '';
    writeFileSync(path.join(dir, 'dist/client/index.html'), `<html lang="id-ID"><body><nav>menu${portal}</nav>home${body}</body></html>`);
  };

  it('admin: prints the command on standard output and the notes on standard error, and exits 0', async () => {
    const dir = fresh();
    writeFileSync(path.join(dir, '.production.vars'), `${GOOD.admin}\n`);
    const { stdout, stderr } = await exec(dir, ['admin'], { CLOUDFLARE_ACCOUNT_ID: 'pinned' });
    expect(stdout.trim()).toBe(`pnpm exec wrangler deploy --env="" --var 'TURNSTILE_SITE_KEY:${KEY}' --var 'UPLOADS_BASE_URL:https://files.sakolakembara.org' --var 'SITE_URL:https://sakolakembara.org'`);
    expect(stderr).toContain('sakem-admin (PRODUCTION');
    expect(stderr).toContain('CLOUDFLARE_ACCOUNT_ID is set');
    expect(stderr).not.toContain('pinned');
    expect(stderr).toContain('pnpm build:spa');
    expect(stderr).toContain('BETTER_AUTH_SECRET, TURNSTILE_SECRET_KEY, RESEND_API_KEY');
    expect(stderr).toContain('not set in .production.vars (optional): EMAIL_FROM');
  });

  it('an account that is not pinned is said loudly, and the Worker names the resources it expects (read from wrangler.jsonc)', async () => {
    const dir = fresh();
    writeFileSync(path.join(dir, '.production.vars'), `${GOOD.admin}\n`);
    copyFileSync(path.join(repoRoot, 'cf/admin/wrangler.jsonc'), path.join(dir, 'wrangler.jsonc'));
    const { stderr } = await exec(dir, ['admin']);
    expect(stderr).toContain('CLOUDFLARE_ACCOUNT_ID is NOT set: do not run anything yet');
    for (const line of ['Worker         sakem-admin', 'D1 database    sakem-admin  (binding DB)', 'R2 bucket      sakem-files  (binding UPLOADS; public, through https://files.sakolakembara.org', 'R2 bucket      sakem-private  (binding PRIVATE_FILES; PRIVATE: must exist', 'Custom Domain  admin.sakolakembara.org', 'workers.dev    off']) {
      expect(stderr, line).toContain(line);
    }
  });

  it('refuses while CLOUDFLARE_ENV is set, prints nothing, and says how to unset it', async () => {
    const dir = fresh();
    writeFileSync(path.join(dir, '.production.vars'), `${GOOD.admin}\n`);
    for (const value of ['staging', 'production']) {
      const failure = await fails(dir, ['admin'], { CLOUDFLARE_ENV: value });
      expect(failure.code).toBe(1);
      expect(failure.stdout).toBe('');
      expect(failure.stderr).toContain('unset CLOUDFLARE_ENV');
    }
  });

  it('a missing file names the example to copy; a bad line is named with its number and prints nothing; a missing required value is named', async () => {
    const dir = fresh();
    const missing = await fails(dir, ['web']);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('production.vars.example');
    expect(missing.stderr).toContain('.production.vars');
    expect(missing.stdout).toBe('');
    writeFileSync(path.join(dir, '.production.vars'), `${GOOD.web}\nTURNSTILE_SECRET_KEY=abc\n`);
    const secret = await fails(dir, ['web']);
    expect(secret.code).toBe(1);
    expect(secret.stderr).toContain('line 6 (TURNSTILE_SECRET_KEY)');
    expect(secret.stdout).toBe('');
    writeFileSync(path.join(dir, '.production.vars'), `TURNSTILE_SITE_KEY=${KEY}\n`);
    const incomplete = await fails(dir, ['admin']);
    expect(incomplete.code).toBe(1);
    expect(incomplete.stderr).toContain('required and missing: UPLOADS_BASE_URL, SITE_URL');
    expect(incomplete.stdout).toBe('');
  });

  it('an unknown Worker, and the portal in particular (not part of Phase A), print the usage and exit 2', async () => {
    const dir = fresh();
    for (const name of ['portal', 'payments']) {
      const usage = await fails(dir, [name]);
      expect(usage.code).toBe(2);
      expect(usage.stderr).toContain('<admin|web>');
      expect(usage.stdout).toBe('');
    }
  });

  it('web with no dist/: prints, and says to build first; with the production build of the beacon in the file: prints and says it checked', async () => {
    const dir = fresh();
    writeFileSync(path.join(dir, '.production.vars'), `${GOOD.web}\n`);
    const notBuilt = await exec(dir, ['web']);
    expect(notBuilt.stdout.trim().startsWith('pnpm exec wrangler deploy -c dist/server/wrangler.json --var ')).toBe(true);
    expect(notBuilt.stderr).toContain('dist/ is not built yet');
    expect(notBuilt.stderr).toContain(`WEB_ANALYTICS_BEACON_ID=${BEACON} pnpm build:prod`);
    writeDist(dir);
    const built = await exec(dir, ['web']);
    expect(built.stdout).toBe(notBuilt.stdout);
    expect(built.stderr).toContain('dist/ checked: the production build');
    expect(built.stderr).toContain('secrets: none on sakola-kembara-web');
  });

  it('web: a dist/ that is not the production build of this beacon is refused, with nothing printed: a staging build, a build with no beacon, another beacon, two tags, a leaked variable, workers.dev on', async () => {
    const dir = fresh();
    writeFileSync(path.join(dir, '.production.vars'), `${GOOD.web}\n`);
    const cases: [string, Parameters<typeof writeDist>[1], RegExp][] = [
      ['a staging build', { name: 'sakem-web-staging', service: 'sakem-admin-staging' }, /sakem-web-staging/],
      ['the staging admin as the binding', { service: 'sakem-admin-staging' }, /service binding/],
      ['a build made without the beacon id', { beacon: null }, /no Web Analytics beacon/],
      ['a build made with another beacon id', { beacon: OTHER_BEACON }, /not the one in the vars file/],
      ['two beacon tags', { tags: 2 }, /2 beacon tags/],
      ['a variable in the build', { vars: { CONTENT_API_URL: 'http://127.0.0.1:1' } }, /carries variables \(CONTENT_API_URL\)/],
      ['workers.dev left on', { workersDev: true }, /workers_dev is not false/],
    ];
    for (const [label, over, why] of cases) {
      writeDist(dir, over);
      const failure = await fails(dir, ['web']);
      expect(failure.code, label).toBe(1);
      expect(failure.stdout, label).toBe('');
      expect(failure.stderr, label).toMatch(why);
      expect(failure.stderr, label).toContain(`Build with: WEB_ANALYTICS_BEACON_ID=${BEACON} pnpm build:prod`);
    }
  });

  it('web: PORTAL_ENABLED=false in the file is on the printed build line and the --var; a dist/ whose home page offers the portal is refused with or without the line; `true` is refused before anything is read', async () => {
    const dir = fresh();
    writeFileSync(path.join(dir, '.production.vars'), `${GOOD.web}\nPORTAL_ENABLED=false\n`);
    writeDist(dir);
    const ok = await exec(dir, ['web']);
    expect(ok.stdout).toContain("--var 'PORTAL_ENABLED:false'");
    expect(ok.stderr).toContain(`# 2. WEB_ANALYTICS_BEACON_ID=${BEACON} PORTAL_ENABLED=false pnpm build:prod`);
    expect(ok.stderr).toContain('the portal is OFF there as the file says');
    writeDist(dir, { portal: true });
    const on = await fails(dir, ['web']);
    expect(on.code).toBe(1);
    expect(on.stdout).toBe('');
    expect(on.stderr).toContain('offers the student portal');
    expect(on.stderr).toContain('PORTAL_ENABLED=false pnpm build:prod');
    // without the line the portal is off by default, so a dist/ with the portal on is just as wrong
    writeFileSync(path.join(dir, '.production.vars'), `${GOOD.web}\n`);
    const noLine = await fails(dir, ['web']);
    expect(noLine.stderr).toContain('offers the student portal');
    expect(noLine.stderr).toContain(`Build with: WEB_ANALYTICS_BEACON_ID=${BEACON} pnpm build:prod`);
    writeDist(dir);
    const clean = await exec(dir, ['web']);
    expect(clean.stderr).toContain("PORTAL_ENABLED is not in the file: the portal is OFF (the default)");
    expect(clean.stdout).not.toContain('PORTAL_ENABLED');
    writeFileSync(path.join(dir, '.production.vars'), `${GOOD.web}\nPORTAL_ENABLED=true\n`);
    const refused = await fails(dir, ['web']);
    expect(refused.stderr).toContain('line 6 (PORTAL_ENABLED)');
    expect(refused.stdout).toBe('');
  });

  it('the portal check of a built dist/ as a function: off needs none of the three markers, on needs the link and the session call', () => {
    expect(builtPortalProblems('<nav>menu</nav>', false)).toEqual([]);
    for (const marker of ['<a href="/portal/login">Masuk</a>', '<a data-auth-link>x</a>', "<script>fetch('/portal/api/auth/get-session')</script>"]) {
      expect(builtPortalProblems(`<nav>${marker}</nav>`, false)[0], marker).toMatch(/offers the student portal/);
    }
    expect(builtPortalProblems('<nav>menu</nav>', true)[0]).toMatch(/no "Masuk" link or session call/);
    expect(builtPortalProblems('<a href="/portal/login" data-auth-link>Masuk</a><script>get-session</script>', true)).toEqual([]);
  });

  it('the checks of a built dist/ as functions: the config and the beacon', () => {
    expect(builtConfigProblems({ name: 'sakola-kembara-web', services: [{ binding: 'API', service: 'sakem-admin', entrypoint: 'PublicApi' }], vars: {}, workers_dev: false })).toEqual([]);
    expect(builtConfigProblems({ name: 'sakem-web-staging', services: [], vars: { A: 'b' } }).length).toBe(4);
    const tag = (id: string) => `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon="{&quot;token&quot;:&quot;${id}&quot;}"></script>`;
    expect(builtBeaconProblems(tag(BEACON), BEACON)).toEqual([]);
    expect(builtBeaconProblems('<html></html>', BEACON)[0]).toMatch(/no Web Analytics beacon/);
    expect(builtBeaconProblems(tag(OTHER_BEACON), BEACON)[0]).toMatch(/not the one in the vars file/);
    expect(builtBeaconProblems(tag(BEACON) + tag(BEACON), BEACON)[0]).toMatch(/2 beacon tags/);
  });
});

describe('readJsonc', () => {
  it('drops comments and trailing commas outside strings and keeps what looks like a comment inside one', () => {
    expect(readJsonc('{\n // c\n "a": "https://x.example/y", /* b */ "b": [1, 2,],\n}\n')).toEqual({ a: 'https://x.example/y', b: [1, 2] });
    expect(readJsonc('{"a": "say \\"// no\\" // really"}')).toEqual({ a: 'say "// no" // really' });
  });

  it('reads both wrangler files of Phase A', () => {
    for (const rel of ['cf/admin/wrangler.jsonc', 'cf/web/wrangler.jsonc']) expect(readJsonc(readRoot(rel)).name, rel).toMatch(/^sak/);
  });
});

describe('the production top level of the wrangler files', () => {
  const adminProd = read('cf/admin/wrangler.jsonc');
  const webProd = read('cf/web/wrangler.jsonc');
  const adminStaging = read('cf/admin/wrangler.jsonc', 'staging');
  const webStaging = read('cf/web/wrangler.jsonc', 'staging');

  it('the production Workers are never on workers.dev, have no route in the file (the dashboard attaches them) and no variable; the staging blocks stay on workers.dev', () => {
    for (const config of [adminProd, webProd]) {
      expect(config.workers_dev).toBe(false);
      expect(config.preview_urls).toBe(false);
      expect(config.routes ?? []).toEqual([]);
    }
    expect(Object.keys(webProd.vars)).toEqual([]);
    expect(adminProd.vars.ENVIRONMENT).toBe('production');
    expect(adminStaging.workers_dev).toBe(true);
    expect(webStaging.workers_dev).toBe(true);
  });

  it('the names are the ones the printers and the dry runs expect, and none is a staging name', () => {
    expect(adminProd.name).toBe(WORKERS.admin.name);
    expect(webProd.name).toBe(WORKERS.web.name);
    expect(adminProd.name).toBe(TARGETS.admin.workerName);
    expect(webProd.name).toBe(TARGETS.web.workerName);
    expect(adminProd.d1_databases.map((d) => d.database_name)).toEqual(['sakem-admin']);
    expect(adminProd.r2_buckets.map((b) => [b.binding, b.bucket_name])).toEqual([['UPLOADS', 'sakem-files'], ['PRIVATE_FILES', 'sakem-private']]);
    expect(webProd.services).toEqual([{ binding: 'API', service: 'sakem-admin', entrypoint: 'PublicApi' }]);
    for (const name of [adminProd.name, webProd.name, ...adminProd.d1_databases.map((d) => d.database_name), ...adminProd.r2_buckets.map((b) => b.bucket_name)]) expect(name).not.toMatch(/staging/);
    expect(webProd.name).not.toBe(webStaging.name);
    expect(adminProd.name).not.toBe(adminStaging.name);
  });

  it('holds no id, account, route, host or URL in the production top level (only the staging block names a host-shaped thing, and not even that)', () => {
    for (const rel of ['cf/admin/wrangler.jsonc', 'cf/web/wrangler.jsonc']) {
      const { env: _env, ...top } = readJsonc(readRoot(rel));
      const text = JSON.stringify(top);
      expect(text, rel).not.toMatch(/"(?:database_id|account_id|id|zone_id|zone_name|pattern|route|routes)"\s*:/);
      expect(text, rel).not.toMatch(/https?:|\.workers\.dev|\.r2\.dev|\.sakolakembara\.org|[0-9a-f]{32}/i);
    }
  });

  it('describeResources names exactly what the top level holds, so the owner can compare it with the dashboard', () => {
    const admin = describeResources('admin', readJsonc(readRoot('cf/admin/wrangler.jsonc'))).join('\n');
    for (const name of ['sakem-admin', 'sakem-files', 'sakem-private', 'admin.sakolakembara.org']) expect(admin).toContain(name);
    expect(admin).toContain('workers.dev    off');
    const web = describeResources('web', readJsonc(readRoot('cf/web/wrangler.jsonc'))).join('\n');
    expect(web).toContain('Worker         sakola-kembara-web');
    expect(web).toContain('API -> sakem-admin#PublicApi');
    expect(web).toContain('sakolakembara.org/*');
    expect(web).toContain('fail OPEN');
    // a configuration that left workers.dev on is said so
    expect(describeResources('web', { name: 'x', services: [] }).join('\n')).toContain('NOT OFF');
  });
});

describe('production-dry-run: what a dry run must show', () => {
  const adminOutput = [
    'Total Upload: 3679.75 KiB / gzip: 662.27 KiB',
    'Your Worker has access to the following bindings:',
    'env.DB (sakem-admin)                                      D1 Database',
    'env.UPLOADS (sakem-files)                                 R2 Bucket',
    'env.PRIVATE_FILES (sakem-private)                         R2 Bucket',
    ...TARGETS.admin.mustContain.filter((line) => line.startsWith('env.RL_')).map((line) => `${line}   Rate Limit`),
    'env.ASSETS                                                Assets',
    'env.ENVIRONMENT ("production")                            Environment Variable',
    'env.PRIVATE_FILES_BUDGET_BYTES ("8000000000")             Environment Variable',
    '--dry-run: exiting now.',
  ].join('\n');
  const adminReadme = 'This folder contains the built output assets for the worker "sakem-admin" generated at 2026-10-15T12:12:59.963Z.';
  const check = (output: string, over: { status?: number; readme?: string } = {}) => checkProductionDryRun(TARGETS.admin, { status: over.status ?? 0, output, readme: over.readme ?? adminReadme }).join('\n');

  it('a good admin dry run has no problem', () => {
    expect(check(adminOutput)).toBe('');
  });

  it('the staging Worker in the output folder is caught, and so is the web Worker', () => {
    expect(check(adminOutput, { readme: adminReadme.replace('sakem-admin', 'sakem-admin-staging') })).toContain('not for the worker "sakem-admin"');
    expect(check(adminOutput, { readme: adminReadme.replace('sakem-admin', 'sakola-kembara-web') })).toContain('not for the worker "sakem-admin"');
  });

  it('a staging database, bucket or variable in the bundle is caught, wherever the word shows up in the listing, and so is a missing limiter or binding', () => {
    expect(check(adminOutput.replace('env.DB (sakem-admin)', 'env.DB (sakem-staging)'))).toContain('staging');
    expect(check(adminOutput.replace('(sakem-files)', '(sakem-files-staging)'))).toContain('missing in the binding list: env.UPLOADS (sakem-files)');
    expect(check(adminOutput.replace('("production")', '("staging")'))).toContain('env.ENVIRONMENT ("production")');
    expect(check(adminOutput.replace(/^env\.RL_BLOG_PREVIEW.*$/m, ''))).toContain('env.RL_BLOG_PREVIEW (60 requests/60s)');
    expect(check(adminOutput.replace(/^env\.PRIVATE_FILES \(.*$/m, ''))).toContain('env.PRIVATE_FILES (sakem-private)');
  });

  it('a variable that must stay unset in production, or a development environment, is caught', () => {
    for (const extra of ['env.CONTENT_API_URL ("http://127.0.0.1:4391")', 'env.CONTACT_API_URL ("x")', 'env.LEGACY_ORIGIN_URL ("x")', 'env.ENVIRONMENT ("development")']) {
      expect(check(`${adminOutput}\n${extra}`), extra).toContain('must not appear');
    }
  });

  it('only the listing is read: a path with the word staging in it (the owner\'s folder) is not a failure', () => {
    expect(check(`✨ Read 14 files from the assets directory /Users/dzul/staging/cf/admin/dist/spa\n${adminOutput}`)).toBe('');
  });

  it('a failed wrangler, a missing size line and a bundle above the old compressed limit are caught', () => {
    expect(check(adminOutput, { status: 1 })).toContain('exited with 1');
    expect(check(adminOutput.replace(/Total Upload.*\n/, ''))).toContain('Total Upload');
    expect(check(adminOutput.replace('gzip: 662.27 KiB', 'gzip: 3001 KiB'))).toContain('guard');
  });

  it('web: the service binding must name the production admin Worker, the listing must not carry a variable', () => {
    const good = 'Total Upload: 850.86 KiB / gzip: 207.62 KiB\nenv.API (sakem-admin#PublicApi)         Worker\nenv.ASSETS                              Assets\n';
    const readme = 'for the worker "sakola-kembara-web" generated';
    expect(checkProductionDryRun(TARGETS.web, { status: 0, output: good, readme })).toEqual([]);
    expect(checkProductionDryRun(TARGETS.web, { status: 0, output: good.replace('sakem-admin#', 'sakem-admin-staging#'), readme }).join('\n')).toContain('env.API (sakem-admin#PublicApi)');
    expect(checkProductionDryRun(TARGETS.web, { status: 0, output: `${good}env.CONTENT_API_URL ("x")\n`, readme }).join('\n')).toContain('must not appear');
    expect(checkProductionDryRun(TARGETS.web, { status: 0, output: good, readme: readme.replace('sakola-kembara-web', 'sakem-web-staging') }).join('\n')).toContain('not for the worker "sakola-kembara-web"');
  });

  it('the child runs with no Cloudflare credential, no environment selected, no telemetry and no prompt', () => {
    const env = productionDryRunEnv({ PATH: '/bin', CLOUDFLARE_API_TOKEN: 'x', CLOUDFLARE_ACCOUNT_ID: 'y', CLOUDFLARE_ENV: 'staging', CF_API_TOKEN: 'w', HOME: '/h' });
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', WRANGLER_SEND_METRICS: 'false', CI: '1' });
  });

  it('the command line of both targets is a dry run, selects no staging, and nothing else is spawned', () => {
    for (const target of Object.values(TARGETS)) {
      expect(target.args[0]).toBe('deploy');
      expect(target.args).toContain('--dry-run');
      expect(target.args.join(' ')).not.toMatch(/staging|--remote|login/);
    }
    expect(TARGETS.admin.args).toContain('--env=');
    const source = readFileSync(path.join(repoRoot, 'cf/scripts/production-dry-run.mjs'), 'utf8');
    expect(source).toContain("'pnpm', ['exec', 'wrangler', ...target.args]");
    expect((source.match(/spawnSync\(/g) ?? []).length).toBe(1);
    expect(source).not.toMatch(/\bfetch\(|https?:\/\/(?!developers)/);
  });

  it('the limiter lines and the names the check wants are the ones of the top level (two views of one truth, and the staging check agrees)', () => {
    const top = read('cf/admin/wrangler.jsonc');
    const declared = top.ratelimits.map((l) => `env.${l.name} (${l.simple.limit} requests/${l.simple.period}s)`);
    expect(TARGETS.admin.mustContain.filter((line) => line.startsWith('env.RL_')).sort()).toEqual(declared.sort());
    expect(TARGETS.admin.mustContain.filter((line) => line.startsWith('env.RL_')).sort()).toEqual(STAGING_TARGETS.admin.mustContain.filter((line) => line.startsWith('env.RL_')).sort());
    expect(TARGETS.admin.mustContain).toContain(`env.DB (${top.d1_databases[0]!.database_name})`);
    expect(TARGETS.admin.mustContain).toContain(`env.UPLOADS (${top.r2_buckets[0]!.bucket_name})`);
    expect(TARGETS.admin.mustContain).toContain(`env.PRIVATE_FILES (${top.r2_buckets[1]!.bucket_name})`);
    expect(TARGETS.admin.mustContain).toContain(`env.PRIVATE_FILES_BUDGET_BYTES ("${top.vars.PRIVATE_FILES_BUDGET_BYTES}")`);
    expect(TARGETS.web.mustContain).toContain(`env.API (${read('cf/web/wrangler.jsonc').services[0]!.service}#PublicApi)`);
  });
});

describe('package scripts and the ignore file', () => {
  const scripts = (rel: string) => (JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8')) as { scripts: Record<string, string> }).scripts;
  const admin = scripts('cf/admin/package.json');
  const web = scripts('cf/web/package.json');

  it('both packages have the production dry run and the printed deploy command, through the shared scripts of cf/scripts', () => {
    expect(admin['deploy:prod:dry']).toBe('pnpm build:spa && node ../scripts/production-dry-run.mjs admin');
    expect(admin['deploy:prod:command']).toBe('node ../scripts/production-deploy-command.mjs admin');
    expect(web['deploy:prod:dry']).toBe('pnpm build:prod && node ../scripts/production-dry-run.mjs web');
    expect(web['deploy:prod:command']).toBe('node ../scripts/production-deploy-command.mjs web');
  });

  it('the production build unsets CLOUDFLARE_ENV (a shell left on staging cannot build the staging Worker), and it is the build the printer prints', () => {
    expect(web['build:prod']).toBe('env -u CLOUDFLARE_ENV pnpm build');
    expect(WORKERS.web.before).toBe('pnpm build:prod');
    expect(WORKERS.admin.before).toBe('pnpm build:spa');
    expect(admin[WORKERS.admin.before.replace('pnpm ', '')]).toBeDefined();
  });

  it('no script deploys, signs in, writes a secret or applies a remote change (the existing rule, for the new scripts too)', () => {
    for (const [pkg, table] of Object.entries({ 'cf/admin': admin, 'cf/web': web })) {
      for (const [name, command] of Object.entries(table)) {
        if (/wrangler\s+deploy/.test(command)) expect(command, `${pkg} ${name}`).toContain('--dry-run');
        expect(command, `${pkg} ${name}`).not.toMatch(/wrangler\s+(login|logout|secret|tail|delete|r2|kv)|--remote|d1\s+create/);
      }
    }
  });

  it("the untracked file of public per-deploy values is ignored by the repository, and its example is not", () => {
    expect(readRoot('.gitignore')).toMatch(/^cf\/\*\*\/\.production\.vars\*$/m);
    const pattern = /^cf\/(?:.*\/)?\.production\.vars[^/]*$/;
    for (const folder of ['cf/web', 'cf/admin']) {
      expect(`${folder}/${WORKERS.admin.file}`).toMatch(pattern);
      expect(`${folder}/production.vars.example`).not.toMatch(pattern);
    }
    expect(WORKERS.admin.file).toBe('.production.vars');
    expect(WORKERS.web.file).toBe('.production.vars');
    expect(webRoot).toContain('cf/web');
  });
});
