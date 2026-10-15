import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { GZIP_BUDGET_KIB, TARGETS, checkDryRun, dryRunEnv, parseUploadSize } from '../../scripts/staging-dry-run.mjs';
import { WORKERS, buildCommand, parseVarsFile, shellQuote, validateVars } from '../../scripts/staging-deploy-command.mjs';
import { contactWhatsapp, whatsappGroupUrl } from '../../admin/src/portal/contact';
import { repoRoot, webRoot } from './helpers';

// cf/scripts/staging-dry-run.mjs and cf/scripts/staging-deploy-command.mjs (SAKEM-084, the portal's target SAKEM-098).
// Both are pure around one spawn or one file read, so the checks run on text. Nothing talks to Cloudflare.

type WorkerName = 'admin' | 'web' | 'portal';
const WORKER_NAMES: WorkerName[] = ['admin', 'web', 'portal'];
/** The example each Worker's untracked vars file is copied from. */
const exampleOf = (worker: WorkerName) => (worker === 'portal' ? 'cf/admin/staging.portal.vars.example' : `cf/${worker}/staging.vars.example`);
/** The staging block of a wrangler file, read as JSONC. */
const stagingBlock = (rel: string) =>
  (JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')) as { env: { staging: { vars: Record<string, string>; ratelimits: { name: string; simple: { limit: number; period: number } }[] } } }).env.staging;
const validate = (worker: WorkerName, text: string) => validateVars(worker, parseVarsFile(text));

describe('staging-deploy-command: the variables file', () => {
  it('reads KEY=VALUE lines, comments, blanks and quotes', () => {
    const entries = parseVarsFile('# a comment\n\nTURNSTILE_SITE_KEY=0x4AAAAAAAtest123\nSITE_URL = "https://sakem-web-staging.acme.workers.dev"\nEMAIL_FROM=\'Sakola Kembara <onboarding@resend.dev>\'\n');
    expect(entries.map((e) => [e.name, e.value])).toEqual([
      ['TURNSTILE_SITE_KEY', '0x4AAAAAAAtest123'],
      ['SITE_URL', 'https://sakem-web-staging.acme.workers.dev'],
      ['EMAIL_FROM', 'Sakola Kembara <onboarding@resend.dev>'],
    ]);
    expect(entries[1]!.line).toBe(4);
  });

  it('a line that is not KEY=VALUE is refused with its number', () => {
    expect(() => parseVarsFile('TURNSTILE_SITE_KEY=abc\nnot a line')).toThrow('line 2');
  });

  it('accepts the public values of each Worker', () => {
    expect(() =>
      validate('admin', 'TURNSTILE_SITE_KEY=0x4AAAAAAAtest123\nUPLOADS_BASE_URL=https://pub-0123abcd.r2.dev\nSITE_URL=https://sakem-web-staging.acme.workers.dev\nEMAIL_FROM=Sakola Kembara Staging <onboarding@resend.dev>'),
    ).not.toThrow();
    expect(() =>
      validate('web', 'TURNSTILE_SITE_KEY=0x4AAAAAAAtest123\nADMIN_URL=https://sakem-admin-staging.acme.workers.dev\nUPLOADS_BASE_URL=https://pub-0123abcd.r2.dev\nCONTENT_CACHE_FRESH_SECONDS=30'),
    ).not.toThrow();
  });

  it('refuses every secret name, whatever the Worker, and says why', () => {
    for (const name of ['BETTER_AUTH_SECRET', 'TURNSTILE_SECRET_KEY', 'RESEND_API_KEY', 'GOOGLE_CLIENT_SECRET', 'CLOUDFLARE_API_TOKEN', 'ADMIN_PASSWORD']) {
      for (const worker of WORKER_NAMES) {
        expect(() => validate(worker, `${name}=whatever12345`), `${worker} ${name}`).toThrow(/refused, a secret/);
      }
    }
  });

  it('refuses the variables that would pull the site off its binding or off staging', () => {
    for (const name of ['CONTENT_API_URL', 'CONTACT_API_URL']) expect(() => validate('web', `${name}=https://api.example.org`)).toThrow(/service binding/);
    for (const bad of ['https://sakolakembara.org', 'https://example.com', 'http://127.0.0.1:4390', 'https://x.workers.dev']) {
      expect(() => validate('web', `LEGACY_ORIGIN_URL=${bad}`), bad).toThrow();
    }
    expect(() => validate('web', 'LEGACY_ORIGIN_URL=https://sakolakembara.org')).toThrow(/only a \*\.invalid host/);
    expect(() => validate('web', 'LEGACY_ORIGIN_URL=https://no-legacy-origin.invalid')).not.toThrow();
    expect(() => validate('admin', 'LEGACY_ORIGIN_URL=https://no-legacy-origin.invalid')).toThrow(/not a variable of sakem-admin-staging/);
    expect(() => validate('admin', 'ENVIRONMENT=development')).toThrow(/staging block/);
    expect(() => validate('portal', 'ENVIRONMENT=development')).toThrow(/staging block/);
    expect(() => validate('admin', 'COOKIE_DOMAIN=.workers.dev')).toThrow(/not used on staging/);
  });

  it('refuses a name that belongs to the other Worker', () => {
    expect(() => validate('admin', 'ADMIN_URL=https://sakem-admin-staging.acme.workers.dev')).toThrow(/not a variable of sakem-admin-staging/);
    expect(() => validate('web', 'SITE_URL=https://sakem-web-staging.acme.workers.dev')).toThrow(/not a variable of sakem-web-staging/);
  });

  it('an origin must be https, with no path, trailing slash, query or credentials', () => {
    for (const bad of ['http://x.workers.dev', 'https://x.workers.dev/', 'https://x.workers.dev/admin', 'https://x.workers.dev?a=1', 'https://user:pw@x.workers.dev', 'x.workers.dev', 'javascript:alert(1)']) {
      expect(() => validate('web', `ADMIN_URL=${bad}`), bad).toThrow();
    }
  });

  it('a value left as a placeholder, empty, or with a shell character is refused', () => {
    for (const bad of ['', '<site key of the staging widget>', 'REPLACE_ME_please', 'abc...def', 'a`b`c12345', 'a$(x)bcdefgh']) {
      expect(() => validate('web', `TURNSTILE_SITE_KEY=${bad}`), bad).toThrow();
    }
    expect(() => validate('web', 'ADMIN_URL=https://sakem-admin-staging.<account-subdomain>.workers.dev')).toThrow(/placeholder/);
  });

  it('a Turnstile key, an address and a number of seconds have a shape', () => {
    expect(() => validate('web', 'TURNSTILE_SITE_KEY=short')).toThrow(/site key/);
    expect(() => validate('admin', 'EMAIL_FROM=Sakola <nope>')).toThrow(/Name <address@host>/);
    expect(() => validate('admin', 'EMAIL_FROM=no-reply@example.org')).not.toThrow();
    expect(() => validate('web', 'CONTENT_CACHE_FRESH_SECONDS=soon')).toThrow(/seconds/);
  });

  it('a name set twice is refused', () => {
    expect(() => validate('web', 'TURNSTILE_SITE_KEY=0x4AAAAAAAtest123\nTURNSTILE_SITE_KEY=0x4AAAAAAAtest456')).toThrow(/set twice/);
  });

  it('the example files of the three Workers are placeholders: copied as they are, they are refused', () => {
    for (const worker of WORKER_NAMES) {
      const example = readFileSync(path.join(repoRoot, exampleOf(worker)), 'utf8');
      expect(() => validate(worker, example), worker).toThrow(/placeholder/);
      // ... and every name in the example is one the Worker accepts, so filling it in is enough
      for (const { name } of parseVarsFile(example)) expect(WORKERS[worker].allowed, `${worker} ${name}`).toContain(name);
    }
  });

  it('the portal example is filled in by invented, public values and comes out as a command: placeholders replaced, the two optional lines uncommented', () => {
    const example = readFileSync(path.join(repoRoot, exampleOf('portal')), 'utf8');
    const filled = example
      .replace('<site key of the staging widget>', '0x4AAAAAAAtest123')
      .replace('<account-subdomain>', 'acme')
      .replace('<account-subdomain>', 'acme')
      .replace(/^# (PORTAL_[A-Z_]+=)/gm, '$1');
    const entries = parseVarsFile(filled);
    expect(() => validateVars('portal', entries)).not.toThrow();
    // every name the portal accepts is in the example (so the file shows all of them), the optional two commented out by default
    expect(entries.map((e) => e.name).sort()).toEqual([...WORKERS.portal.allowed].sort());
    expect(parseVarsFile(example).map((e) => e.name).sort()).toEqual(['ADMIN_URL', 'EMAIL_FROM', 'SITE_URL', 'TURNSTILE_SITE_KEY']);
    // and nothing in the example is a real number, address or key
    expect(example).not.toMatch(/chat\.whatsapp\.com|wa\.me|\b0x4[A-Za-z0-9_-]{20,}|\bre_[A-Za-z0-9]{12,}|sakolakembara\.org/);
  });

  it('the allowed lists hold no secret, no API URL and no ENVIRONMENT; the legacy origin only for the site, and only as a *.invalid host', () => {
    for (const worker of Object.values(WORKERS)) {
      for (const name of worker.allowed) expect(name).not.toMatch(/SECRET|TOKEN|PASSWORD|API_KEY|CONTENT_API_URL|CONTACT_API_URL|^ENVIRONMENT$/);
    }
    expect(WORKERS.web.allowed).toContain('LEGACY_ORIGIN_URL');
    expect(WORKERS.admin.allowed).not.toContain('LEGACY_ORIGIN_URL');
    expect(WORKERS.portal.allowed).not.toContain('LEGACY_ORIGIN_URL');
  });

  it('a staging Worker never points at the live domain, whichever origin it is (SITE_URL, ADMIN_URL, UPLOADS_BASE_URL), and the message says which host', () => {
    for (const bad of ['https://sakolakembara.org', 'https://admin.sakolakembara.org', 'https://files.sakolakembara.org', 'https://SAKOLAKEMBARA.ORG']) {
      expect(() => validate('portal', `SITE_URL=${bad}`), bad).toThrow(/production domain/);
      expect(() => validate('portal', `ADMIN_URL=${bad}`), bad).toThrow(/production domain/);
      expect(() => validate('admin', `SITE_URL=${bad}`), bad).toThrow(/production domain/);
      expect(() => validate('web', `ADMIN_URL=${bad}`), bad).toThrow(/production domain/);
      expect(() => validate('admin', `UPLOADS_BASE_URL=${bad}`), bad).toThrow(/production domain/);
    }
    expect(() => validate('portal', 'SITE_URL=https://sakolakembara.org.workers.dev')).not.toThrow();
    expect(() => validate('portal', 'SITE_URL=https://notsakolakembara.org')).not.toThrow();
  });
});

describe('staging-deploy-command: the portal Worker', () => {
  const six = [
    'TURNSTILE_SITE_KEY=0x4AAAAAAAtest123',
    'SITE_URL=https://sakem-web-staging.acme.workers.dev',
    'ADMIN_URL=https://sakem-admin-staging.acme.workers.dev',
    'EMAIL_FROM=Sakola Kembara Staging <onboarding@resend.dev>',
    'PORTAL_CONTACT_WHATSAPP=6281200000000',
    'PORTAL_WHATSAPP_GROUP_URL=https://grup-uji.example.test/pendaftaran',
  ].join('\n');

  it('accepts the six public values, and prints the deploy of the portal configuration in the staging environment with one quoted --var each', () => {
    expect(() => validate('portal', six)).not.toThrow();
    expect(buildCommand('portal', parseVarsFile(six))).toBe(
      "pnpm exec wrangler deploy -c wrangler.portal.jsonc --env staging --var 'TURNSTILE_SITE_KEY:0x4AAAAAAAtest123' --var 'SITE_URL:https://sakem-web-staging.acme.workers.dev' --var 'ADMIN_URL:https://sakem-admin-staging.acme.workers.dev' --var 'EMAIL_FROM:Sakola Kembara Staging <onboarding@resend.dev>' --var 'PORTAL_CONTACT_WHATSAPP:6281200000000' --var 'PORTAL_WHATSAPP_GROUP_URL:https://grup-uji.example.test/pendaftaran'",
    );
    expect(buildCommand('portal', [])).toBe('pnpm exec wrangler deploy -c wrangler.portal.jsonc --env staging');
    expect(WORKERS.portal.name).toBe('sakem-portal-staging');
    expect(WORKERS.portal.deploy).toEqual(['pnpm', 'exec', 'wrangler', 'deploy', '-c', 'wrangler.portal.jsonc', '--env', 'staging']);
    expect(WORKERS.portal.before).toBe('pnpm build:portal-spa');
  });

  it('the two optional values are optional: the other four are enough', () => {
    expect(() => validate('portal', six.split('\n').slice(0, 4).join('\n'))).not.toThrow();
  });

  it('refuses what is not the portal\'s: the admin\'s and the site\'s variables, the fixed settings, the secrets, the options that are off on staging', () => {
    for (const [name, value] of [
      ['UPLOADS_BASE_URL', 'https://pub-0123abcd.r2.dev'],
      ['LEGACY_ORIGIN_URL', 'https://no-legacy-origin.invalid'],
      ['PAGE_CACHE_SECONDS', '30'],
      ['AUDIT_RETENTION_DAYS', '365'],
    ] as const) {
      expect(() => validate('portal', `${name}=${value}`), name).toThrow(/not a variable of sakem-portal-staging/);
    }
    // the settings the configuration fixes: the budget of the private bucket and the "never delete" retention
    for (const name of ['PRIVATE_FILES_BUDGET_BYTES', 'DRAFT_RETENTION_DAYS', 'REJECTED_FILES_RETENTION_DAYS', 'ACCEPTED_FILES_RETENTION_DAYS']) {
      expect(() => validate('portal', `${name}=1`), name).toThrow(/fixed setting of the wrangler configuration/);
    }
    // a key for the private bucket does not exist (no SSE-C), and every secret name is a secret
    expect(() => validate('portal', 'PRIVATE_FILES_KEY=whatever12345')).toThrow(/refused, a secret/);
    for (const name of ['BETTER_AUTH_SECRET', 'RESEND_API_KEY', 'TURNSTILE_SECRET_KEY', 'GOOGLE_CLIENT_SECRET']) expect(() => validate('portal', `${name}=whatever12345`), name).toThrow(/refused, a secret/);
    for (const name of ['COOKIE_DOMAIN', 'TRUSTED_ORIGINS']) expect(() => validate('portal', `${name}=https://x.workers.dev`), name).toThrow(/not used on staging/);
    for (const name of ['CONTENT_API_URL', 'CONTACT_API_URL']) expect(() => validate('portal', `${name}=https://api.example.org`), name).toThrow(/service binding/);
  });

  it('an origin is https, with no path, trailing slash, query or credentials; a placeholder is refused', () => {
    for (const name of ['SITE_URL', 'ADMIN_URL']) {
      for (const bad of ['http://x.workers.dev', 'https://x.workers.dev/', 'https://x.workers.dev/portal', 'https://x.workers.dev?a=1', 'https://user:pw@x.workers.dev', 'x.workers.dev']) {
        expect(() => validate('portal', `${name}=${bad}`), `${name} ${bad}`).toThrow();
      }
      expect(() => validate('portal', `${name}=https://sakem-web-staging.<account-subdomain>.workers.dev`)).toThrow(/placeholder/);
    }
    expect(() => validate('portal', 'TURNSTILE_SITE_KEY=<site key of the staging widget>')).toThrow(/placeholder/);
    expect(() => validate('portal', 'TURNSTILE_SITE_KEY=short')).toThrow(/site key/);
    expect(() => validate('portal', 'EMAIL_FROM=Sakola <nope>')).toThrow(/Name <address@host>/);
  });

  it('the contact number is digits with the country code (8 to 15, no +, no space, no leading zero), and a real group invitation is refused on a public staging page', () => {
    for (const bad of ['+6281200000000', '081200000000', '62 812 0000 0000', '628120', '6281200000000000', '62abc', '<number>']) {
      expect(() => validate('portal', `PORTAL_CONTACT_WHATSAPP=${bad}`), bad).toThrow();
    }
    expect(() => validate('portal', 'PORTAL_CONTACT_WHATSAPP=6281200000000')).not.toThrow();
    for (const bad of ['http://grup.example.test/x', 'javascript:alert(1)', 'https://user:pw@grup.example.test/x', 'https://grup.example.test/a b', "https://grup.example.test/a'b", `https://grup.example.test/${'a'.repeat(300)}`, 'grup.example.test/x', '<invitation>']) {
      expect(() => validate('portal', `PORTAL_WHATSAPP_GROUP_URL=${bad}`), bad).toThrow();
    }
    expect(() => validate('portal', 'PORTAL_WHATSAPP_GROUP_URL=https://grup-uji.example.test/pendaftaran?a=b')).not.toThrow();
    for (const real of ['https://chat.whatsapp.com/AbCdEf123456', 'https://wa.me/6281200000000', 'https://api.whatsapp.com/send?phone=6281200000000']) {
      expect(() => validate('portal', `PORTAL_WHATSAPP_GROUP_URL=${real}`), real).toThrow(/real group invitation|WhatsApp's own address/);
    }
    expect(() => validate('portal', 'PORTAL_WHATSAPP_GROUP_URL=https://sakolakembara.org/grup')).toThrow(/production domain/);
  });

  it('the printer and the Worker agree on a valid value: what src/portal/contact.ts turns into "absent" the printer refuses, and the reverse (apart from the characters no public value may carry)', () => {
    const numbers = ['6281200000000', '62812', '628120000000000', '6281200000000000', '081200000000', '+6281200000000', '62 8120000', ' 6281200000000 ', '', 'abc'];
    for (const value of numbers) {
      const printerAccepts = (() => {
        try {
          validate('portal', `PORTAL_CONTACT_WHATSAPP=${value.trim()}`);
          return true;
        } catch {
          return false;
        }
      })();
      // the printer reads a trimmed line; the Worker trims too, so compare on the trimmed value
      expect(printerAccepts, JSON.stringify(value)).toBe(contactWhatsapp(value.trim()) !== undefined);
    }
    const urls = [
      'https://grup-uji.example.test/pendaftaran',
      'https://grup-uji.example.test',
      'https://grup-uji.example.test/a?b=c#d',
      'http://grup-uji.example.test/x',
      'javascript:alert(1)',
      'https://user:pw@grup-uji.example.test/x',
      'https://grup-uji.example.test/a b',
      'https://grup-uji.example.test/"x',
      "https://grup-uji.example.test/'x",
      'https://grup-uji.example.test/<x>',
      'https://',
      `https://grup-uji.example.test/${'a'.repeat(250)}`,
      `https://grup-uji.example.test/${'a'.repeat(300)}`,
    ];
    for (const value of urls) {
      const printerAccepts = (() => {
        try {
          validate('portal', `PORTAL_WHATSAPP_GROUP_URL=${value}`);
          return true;
        } catch {
          return false;
        }
      })();
      expect(printerAccepts, value.slice(0, 60)).toBe(whatsappGroupUrl(value) !== undefined);
    }
  });

  it('reads .staging.vars.portal by default, never the admin\'s .staging.vars, and the admin printer never reads the portal\'s', async () => {
    const run = promisify(execFile);
    const printer = path.join(repoRoot, 'cf/scripts/staging-deploy-command.mjs');
    const dir = mkdtempSync(path.join(tmpdir(), 'staging-printer-'));
    // The admin's file holds a value only the admin accepts; the portal's holds the portal's own.
    writeFileSync(path.join(dir, '.staging.vars'), 'UPLOADS_BASE_URL=https://pub-0123abcd.r2.dev\n');
    writeFileSync(path.join(dir, '.staging.vars.portal'), 'SITE_URL=https://sakem-web-staging.acme.workers.dev\n');
    const portal = await run(process.execPath, [printer, 'portal'], { cwd: dir, env: { PATH: process.env.PATH ?? '' } });
    expect(portal.stdout.trim()).toBe("pnpm exec wrangler deploy -c wrangler.portal.jsonc --env staging --var 'SITE_URL:https://sakem-web-staging.acme.workers.dev'");
    expect(portal.stderr).toContain('sakem-portal-staging');
    expect(portal.stderr).toContain('pnpm build:portal-spa');
    const admin = await run(process.execPath, [printer, 'admin'], { cwd: dir, env: { PATH: process.env.PATH ?? '' } });
    expect(admin.stdout.trim()).toBe("pnpm exec wrangler deploy --env staging --var 'UPLOADS_BASE_URL:https://pub-0123abcd.r2.dev'");
  });

  it('a missing file names the example to copy; a bad line is named; an unknown Worker prints the usage; none of it exits 0', async () => {
    const run = promisify(execFile);
    const printer = path.join(repoRoot, 'cf/scripts/staging-deploy-command.mjs');
    const dir = mkdtempSync(path.join(tmpdir(), 'staging-printer-'));
    const fails = async (args: string[]) => {
      try {
        await run(process.execPath, [printer, ...args], { cwd: dir, env: { PATH: process.env.PATH ?? '' } });
      } catch (error) {
        const failure = error as { code: number; stderr: string; stdout: string };
        return failure;
      }
      throw new Error(`expected a failure: ${args.join(' ')}`);
    };
    const missing = await fails(['portal']);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('staging.portal.vars.example');
    expect(missing.stderr).toContain('.staging.vars.portal');
    expect(missing.stdout).toBe('');
    writeFileSync(path.join(dir, '.staging.vars.portal'), 'SITE_URL=https://x.workers.dev\nTURNSTILE_SECRET_KEY=abc\n');
    const secret = await fails(['portal']);
    expect(secret.code).toBe(1);
    expect(secret.stderr).toContain('line 2 (TURNSTILE_SECRET_KEY)');
    expect(secret.stdout).toBe('');
    const usage = await fails(['payments']);
    expect(usage.code).toBe(2);
    expect(usage.stderr).toContain('<admin|web|portal>');
  });

  it('prints, never runs: no process is started, no request is made, and the only environment variable read is whether the account is pinned (its value is not printed)', () => {
    const source = readFileSync(path.join(repoRoot, 'cf/scripts/staging-deploy-command.mjs'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/child_process|spawn|execFile|execSync|\bfetch\(|node:http|node:net/);
    expect(source.match(/process\.env[.\w]*/g)).toEqual(['process.env.CLOUDFLARE_ACCOUNT_ID']);
    expect(source).toMatch(/process\.env\.CLOUDFLARE_ACCOUNT_ID \? 'CLOUDFLARE_ACCOUNT_ID is set' : 'CLOUDFLARE_ACCOUNT_ID is NOT set'/);
  });
});

describe('staging-deploy-command: the printed command', () => {
  it('admin: deploys the staging environment and passes every value as one quoted --var', () => {
    const entries = parseVarsFile('TURNSTILE_SITE_KEY=0x4AAAAAAAtest123\nEMAIL_FROM=Sakola Kembara Staging <onboarding@resend.dev>\nSITE_URL=https://sakem-web-staging.acme.workers.dev');
    expect(buildCommand('admin', entries)).toBe(
      "pnpm exec wrangler deploy --env staging --var 'TURNSTILE_SITE_KEY:0x4AAAAAAAtest123' --var 'EMAIL_FROM:Sakola Kembara Staging <onboarding@resend.dev>' --var 'SITE_URL:https://sakem-web-staging.acme.workers.dev'",
    );
  });

  it('web: deploys the config the staging build wrote', () => {
    expect(buildCommand('web', parseVarsFile('ADMIN_URL=https://sakem-admin-staging.acme.workers.dev'))).toBe(
      "pnpm exec wrangler deploy -c dist/server/wrangler.json --var 'ADMIN_URL:https://sakem-admin-staging.acme.workers.dev'",
    );
  });

  it('never prints a command that is not a deploy of a staging Worker', () => {
    for (const worker of ['admin', 'web'] as const) {
      const command = buildCommand(worker, []);
      expect(command).toMatch(/^pnpm exec wrangler deploy /);
      expect(command).not.toContain('--dry-run');
      expect(command).not.toMatch(/--remote|login|secret|delete|tail/);
    }
    expect(WORKERS.admin.deploy).toContain('staging');
    expect(WORKERS.web.deploy).toContain('dist/server/wrangler.json');
  });

  it('quotes a single quote, so a value cannot end the quoting', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote('a b <c>')).toBe("'a b <c>'");
  });
});

describe('staging-dry-run: what a dry run must show', () => {
  const adminOutput = [
    'Total Upload: 3537.46 KiB / gzip: 638.20 KiB',
    'Your Worker has access to the following bindings:',
    'env.DB (sakem-staging)                              D1 Database',
    'env.UPLOADS (sakem-files-staging)                   R2 Bucket',
    'env.PRIVATE_FILES (sakem-private-staging)           R2 Bucket',
    ...TARGETS.admin.mustContain.filter((line) => line.startsWith('env.RL_')).map((line) => `${line}   Rate Limit`),
    'env.ASSETS                                          Assets',
    'env.ENVIRONMENT ("staging")                         Environment Variable',
    '--dry-run: exiting now.',
  ].join('\n');
  const adminReadme = 'This folder contains the built output assets for the worker "sakem-admin-staging" generated at 2026-10-13T06:01:32.242Z.';

  it('a good admin dry run has no problem', () => {
    expect(checkDryRun(TARGETS.admin, { status: 0, output: adminOutput, readme: adminReadme })).toEqual([]);
  });

  it('the production Worker in the output folder is caught', () => {
    const problems = checkDryRun(TARGETS.admin, { status: 0, output: adminOutput, readme: adminReadme.replace('sakem-admin-staging', 'sakem-admin') });
    expect(problems.join('\n')).toContain('not for the worker "sakem-admin-staging"');
  });

  it('a production database, bucket or variable in the bundle is caught, and so is a missing limiter', () => {
    const production = adminOutput.replace('env.DB (sakem-staging)', 'env.DB (sakem-admin)').replace('(sakem-files-staging)', '(sakem-files)').replace('("staging")', '("production")');
    const problems = checkDryRun(TARGETS.admin, { status: 0, output: production, readme: adminReadme }).join('\n');
    expect(problems).toContain('env.DB (sakem-admin)');
    expect(problems).toContain('env.UPLOADS (sakem-files)');
    expect(problems).toContain('env.ENVIRONMENT ("production")');
    const noLimiter = adminOutput.replace(/^env\.RL_BLOG_PREVIEW.*$/m, '');
    expect(checkDryRun(TARGETS.admin, { status: 0, output: noLimiter, readme: adminReadme }).join('\n')).toContain('env.RL_BLOG_PREVIEW (60 requests/60s)');
  });

  it('a failed wrangler, a missing size line and a bundle above the old compressed limit are caught', () => {
    expect(checkDryRun(TARGETS.admin, { status: 1, output: adminOutput, readme: adminReadme }).join('\n')).toContain('exited with 1');
    expect(checkDryRun(TARGETS.admin, { status: 0, output: adminOutput.replace(/Total Upload.*\n/, ''), readme: adminReadme }).join('\n')).toContain('Total Upload');
    const huge = adminOutput.replace('gzip: 638.20 KiB', `gzip: ${GZIP_BUDGET_KIB + 1} KiB`);
    expect(checkDryRun(TARGETS.admin, { status: 0, output: huge, readme: adminReadme }).join('\n')).toContain('guard');
  });

  it('portal: the output folder of the dry run is its own, so the admin\'s and the portal\'s runs never share one', () => {
    expect(TARGETS.portal.outdir).toBe('dist/portal-worker-staging');
    expect(TARGETS.admin.outdir).toBe('dist/worker-staging');
    expect(TARGETS.portal.args).toContain(TARGETS.portal.outdir);
    expect(TARGETS.admin.args).toContain(TARGETS.admin.outdir);
    expect(TARGETS.web.args).toContain(TARGETS.web.outdir);
    expect(TARGETS.portal.args.slice(0, 5)).toEqual(['deploy', '--dry-run', '-c', 'wrangler.portal.jsonc', '--env']);
    expect(TARGETS.portal.args[5]).toBe('staging');
    expect(TARGETS.portal.dir).toBe('admin');
  });

  describe('the portal', () => {
    const portalOutput = [
      'Total Upload: 2943.15 KiB / gzip: 513.95 KiB',
      'Your Worker has access to the following bindings:',
      'env.DB (sakem-staging)                              D1 Database',
      'env.PRIVATE_FILES (sakem-private-staging)           R2 Bucket',
      ...TARGETS.portal.mustContain.filter((line) => line.startsWith('env.RL_')).map((line) => `${line}   Rate Limit`),
      'env.ASSETS                                          Assets',
      'env.ENVIRONMENT ("staging")                         Environment Variable',
      'env.PRIVATE_FILES_BUDGET_BYTES ("8000000000")       Environment Variable',
      ...TARGETS.portal.mustContain.filter((line) => line.endsWith('("")')).map((line) => `${line}   Environment Variable`),
      '--dry-run: exiting now.',
    ].join('\n');
    const readme = 'This folder contains the built output assets for the worker "sakem-portal-staging" generated at 2026-10-15T08:20:44.630Z.';
    const check = (output: string, over: { status?: number; readme?: string } = {}) => checkDryRun(TARGETS.portal, { status: over.status ?? 0, output, readme: over.readme ?? readme }).join('\n');

    it('a good portal dry run has no problem', () => {
      expect(check(portalOutput)).toBe('');
    });

    it('the production portal in the output folder is caught, and so is the admin\'s Worker', () => {
      expect(check(portalOutput, { readme: readme.replace('sakem-portal-staging', 'sakem-portal') })).toContain('not for the worker "sakem-portal-staging"');
      expect(check(portalOutput, { readme: readme.replace('sakem-portal-staging', 'sakem-admin-staging') })).toContain('not for the worker "sakem-portal-staging"');
    });

    it('a production database, bucket or variable in the bundle is caught, and so is a missing limiter or a missing per-deploy variable', () => {
      const production = portalOutput.replace('env.DB (sakem-staging)', 'env.DB (sakem-admin)').replace('(sakem-private-staging)', '(sakem-private)').replace('("staging")', '("production")');
      const problems = check(production);
      expect(problems).toContain('env.DB (sakem-admin)');
      expect(problems).toContain('env.PRIVATE_FILES (sakem-private)');
      expect(problems).toContain('env.ENVIRONMENT ("production")');
      expect(check(portalOutput.replace(/^env\.RL_PORTAL_SUBMIT.*$/m, ''))).toContain('env.RL_PORTAL_SUBMIT (3 requests/60s)');
      expect(check(portalOutput.replace(/^env\.SITE_URL.*$/m, ''))).toContain('env.SITE_URL ("")');
    });

    it('the admin\'s public bucket, its limiters and its variables in the portal bundle are caught (the portal reaches the private bucket only)', () => {
      for (const extra of ['env.UPLOADS (sakem-files-staging)   R2 Bucket', 'env.UPLOADS_BASE_URL ("")', 'env.RL_CONTACT (5 requests/60s)', 'env.RL_UPLOAD (20 requests/60s)', 'env.RL_BLOG_PREVIEW (60 requests/60s)', 'env.RL_ADMIN_FILE (120 requests/60s)']) {
        expect(check(`${portalOutput}\n${extra}`), extra).toContain('must not appear');
      }
    });

    it('a failed wrangler, a missing size line and a bundle above the old compressed limit are caught', () => {
      expect(check(portalOutput, { status: 1 })).toContain('exited with 1');
      expect(check(portalOutput.replace(/Total Upload.*\n/, ''))).toContain('Total Upload');
      expect(check(portalOutput.replace('gzip: 513.95 KiB', `gzip: ${GZIP_BUDGET_KIB + 1} KiB`))).toContain('guard');
    });

    it('the limiter lines the check wants are exactly the ones the staging block declares, with their limits and periods (two views of one truth)', () => {
      const declared = stagingBlock('cf/admin/wrangler.portal.jsonc').ratelimits.map((l) => `env.${l.name} (${l.simple.limit} requests/${l.simple.period}s)`);
      expect(TARGETS.portal.mustContain.filter((line) => line.startsWith('env.RL_')).sort()).toEqual(declared.sort());
    });

    it('the per-deploy variables the check wants empty are exactly the ones the printer may pass', () => {
      const wanted = TARGETS.portal.mustContain.filter((line) => line.endsWith('("")')).map((line) => /^env\.([A-Z_]+) /.exec(line)![1]);
      expect(wanted.sort()).toEqual([...WORKERS.portal.allowed].sort());
      const declared = stagingBlock('cf/admin/wrangler.portal.jsonc').vars;
      for (const name of wanted) expect(declared[name!], name).toBe('');
    });
  });

  it('web: the service binding must name the staging admin Worker', () => {
    const good = 'Total Upload: 833.57 KiB / gzip: 202.61 KiB\nenv.API (sakem-admin-staging#PublicApi)         Worker\nenv.ASSETS                                      Assets\n';
    const readme = 'for the worker "sakem-web-staging" generated';
    expect(checkDryRun(TARGETS.web, { status: 0, output: good, readme })).toEqual([]);
    const production = good.replace('sakem-admin-staging#PublicApi', 'sakem-admin#PublicApi');
    expect(checkDryRun(TARGETS.web, { status: 0, output: production, readme }).join('\n')).toContain('env.API (sakem-admin-staging#PublicApi)');
  });

  it('reads the size line', () => {
    expect(parseUploadSize('x\nTotal Upload: 833.57 KiB / gzip: 202.61 KiB\ny')).toEqual({ raw: 833.57, gzip: 202.61 });
    expect(parseUploadSize('nothing')).toBeNull();
  });

  it('the child runs with no Cloudflare credential, no telemetry and no prompt', () => {
    const env = dryRunEnv({ PATH: '/bin', CLOUDFLARE_API_TOKEN: 'x', CLOUDFLARE_ACCOUNT_ID: 'y', CLOUDFLARE_API_KEY: 'z', CF_API_TOKEN: 'w', HOME: '/h' });
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', WRANGLER_SEND_METRICS: 'false', CI: '1' });
  });

  it('the command line of both targets is a dry run, and nothing else', () => {
    for (const target of Object.values(TARGETS)) {
      expect(target.args[0]).toBe('deploy');
      expect(target.args).toContain('--dry-run');
    }
    const source = readFileSync(path.join(repoRoot, 'cf/scripts/staging-dry-run.mjs'), 'utf8');
    expect(source).toContain("'pnpm', ['exec', 'wrangler', ...target.args]");
    expect(source).not.toMatch(/\bfetch\(|https?:\/\/(?!developers)/);
  });

  it('the names the dry run expects are the names of the wrangler files', () => {
    const admin = readFileSync(path.join(repoRoot, 'cf/admin/wrangler.jsonc'), 'utf8');
    const web = readFileSync(path.join(webRoot, 'wrangler.jsonc'), 'utf8');
    const portal = readFileSync(path.join(repoRoot, 'cf/admin/wrangler.portal.jsonc'), 'utf8');
    expect(admin).toContain(`"name": "${TARGETS.admin.workerName}"`);
    expect(portal).toContain(`"name": "${TARGETS.portal.workerName}"`);
    expect(web).toContain(`"name": "${TARGETS.web.workerName}"`);
    expect(WORKERS.portal.name).toBe(TARGETS.portal.workerName);
    expect(web).toContain(`"service": "${TARGETS.admin.workerName}"`);
    expect(WORKERS.admin.name).toBe(TARGETS.admin.workerName);
    expect(WORKERS.web.name).toBe(TARGETS.web.workerName);
  });
});
