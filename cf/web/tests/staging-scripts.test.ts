import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GZIP_BUDGET_KIB, TARGETS, checkDryRun, dryRunEnv, parseUploadSize } from '../../scripts/staging-dry-run.mjs';
import { WORKERS, buildCommand, parseVarsFile, shellQuote, validateVars } from '../../scripts/staging-deploy-command.mjs';
import { repoRoot, webRoot } from './helpers';

// cf/scripts/staging-dry-run.mjs and cf/scripts/staging-deploy-command.mjs (SAKEM-084). Both are pure around
// one spawn or one file read, so the checks run on text. Nothing talks to Cloudflare.

type WorkerName = 'admin' | 'web';
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
      for (const worker of ['admin', 'web'] as const) {
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

  it('the example files of both Workers are placeholders: copied as they are, they are refused', () => {
    for (const worker of ['admin', 'web'] as const) {
      const example = readFileSync(path.join(repoRoot, `cf/${worker}/staging.vars.example`), 'utf8');
      expect(() => validate(worker, example), worker).toThrow(/placeholder/);
      // ... and every name in the example is one the Worker accepts, so filling it in is enough
      for (const { name } of parseVarsFile(example)) expect(WORKERS[worker].allowed, `${worker} ${name}`).toContain(name);
    }
  });

  it('the allowed lists hold no secret, no API URL and no ENVIRONMENT; the legacy origin only for the site, and only as a *.invalid host', () => {
    for (const worker of Object.values(WORKERS)) {
      for (const name of worker.allowed) expect(name).not.toMatch(/SECRET|TOKEN|PASSWORD|API_KEY|CONTENT_API_URL|CONTACT_API_URL|^ENVIRONMENT$/);
    }
    expect(WORKERS.web.allowed).toContain('LEGACY_ORIGIN_URL');
    expect(WORKERS.admin.allowed).not.toContain('LEGACY_ORIGIN_URL');
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
    expect(admin).toContain(`"name": "${TARGETS.admin.workerName}"`);
    expect(web).toContain(`"name": "${TARGETS.web.workerName}"`);
    expect(web).toContain(`"service": "${TARGETS.admin.workerName}"`);
    expect(WORKERS.admin.name).toBe(TARGETS.admin.workerName);
    expect(WORKERS.web.name).toBe(TARGETS.web.workerName);
  });
});
