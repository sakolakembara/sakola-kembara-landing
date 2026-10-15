#!/usr/bin/env node
// Dry-run of the PRODUCTION deploy of one Worker (SAKEM-104, cutover Phase A, docs/cloudflare/cutover-runbook.md section 14):
//
//   node ../scripts/production-dry-run.mjs admin   (from cf/admin, after `pnpm build:spa`; `pnpm deploy:prod:dry`)
//   node ../scripts/production-dry-run.mjs web     (from cf/web, after `pnpm build:prod`;  `pnpm deploy:prod:dry`)
//
// Same shape as staging-dry-run.mjs and it reuses its checker: it runs `wrangler deploy --dry-run` and nothing else (the
// flag is part of the command line below, there is no option to leave it out), the Cloudflare credentials AND the
// CLOUDFLARE_ENV of the shell are removed from the environment of the child process, and no network call is made (a dry
// run only bundles). It needs no account and no vars file. The REAL deploy is never scripted: the runbook has the
// command, and `pnpm deploy:prod:command` prints it.
//
// What it proves, beyond "wrangler exits 0": the bundle is the PRODUCTION Worker (the name wrangler writes into the output
// folder, the production D1 database and R2 buckets by their names, `ENVIRONMENT` "production", the service binding of the
// site pointing at the production admin Worker), nothing says "staging" or workers.dev anywhere in the listing, and no
// variable that must stay unset in production (an API URL, the legacy origin) leaked into the bundle.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS as STAGING_TARGETS, checkDryRun, dryRunEnv, parseUploadSize } from './staging-dry-run.mjs';
import { builtConfigProblems } from './production-deploy-command.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfRoot = path.resolve(here, '..');

/** Anything of these in a production listing is a staging or local value, or a variable that must stay unset. */
const NEVER_IN_PRODUCTION = ['staging', 'workers.dev', 'env.CONTENT_API_URL', 'env.CONTACT_API_URL', 'env.LEGACY_ORIGIN_URL', 'env.ENVIRONMENT ("development")', 'env.ENVIRONMENT ("test")'];

/** The same fifteen limiters as the staging listing wants: the numbers are one truth (a test compares both with wrangler.jsonc). */
const RATE_LIMITS = STAGING_TARGETS.admin.mustContain.filter((line) => line.startsWith('env.RL_'));

/** What each target must show. Kept apart from the wrangler files on purpose: the test of those files and this check read the same truth from two sides. */
export const TARGETS = {
  admin: {
    dir: 'admin',
    workerName: 'sakem-admin',
    outdir: 'dist/worker-production',
    // `--env=` is the top level, whatever CLOUDFLARE_ENV says; it also silences wrangler's warning about the staging block.
    args: ['deploy', '--dry-run', '--env=', '--outdir', 'dist/worker-production'],
    mustContain: [
      'env.DB (sakem-admin)',
      'env.UPLOADS (sakem-files)',
      'env.PRIVATE_FILES (sakem-private)',
      'env.ENVIRONMENT ("production")',
      'env.PRIVATE_FILES_BUDGET_BYTES ("8000000000")',
      'env.ASSETS',
      ...RATE_LIMITS,
    ],
    mustNotContain: NEVER_IN_PRODUCTION,
  },
  web: {
    dir: 'web',
    workerName: 'sakola-kembara-web',
    outdir: 'dist/worker-production',
    args: ['deploy', '--dry-run', '--outdir', 'dist/worker-production', '-c', 'dist/server/wrangler.json'],
    mustContain: ['env.API (sakem-admin#PublicApi)', 'env.ASSETS'],
    mustNotContain: NEVER_IN_PRODUCTION,
  },
};

/** The environment of the child: no credential, no telemetry, non-interactive, and NO environment selected (production is the top level). */
export function productionDryRunEnv(base) {
  const env = dryRunEnv(base);
  delete env.CLOUDFLARE_ENV;
  return env;
}

/**
 * Problems found in a dry run's output (empty = fine): the staging checker's, with the production lists of TARGETS. Only
 * the listing is read (the `env.` lines and the size line), so a folder of the owner's machine called "staging" cannot
 * fail a production check through the paths wrangler prints.
 */
export function checkProductionDryRun(target, { status, output, readme }) {
  const listing = output
    .split('\n')
    .filter((line) => /^\s*(env\.|Total Upload)/.test(line))
    .join('\n');
  return checkDryRun(target, { status, output: listing, readme }).map((problem) => problem.replace('(a production value in the staging bundle)', '(a staging or local value in the production bundle)'));
}

function main(argv) {
  const target = TARGETS[argv[0]];
  if (!target) {
    process.stderr.write('usage: node ../scripts/production-dry-run.mjs <admin|web>   (there is no production dry run for the student portal: it is not part of Phase A)\n');
    return 2;
  }
  const cwd = path.join(cfRoot, target.dir);
  const preProblems = [];
  if (argv[0] === 'web') {
    const built = path.join(cwd, 'dist/server/wrangler.json');
    if (!existsSync(built)) preProblems.push('dist/server/wrangler.json is missing: run `pnpm build:prod` first');
    else preProblems.push(...builtConfigProblems(JSON.parse(readFileSync(built, 'utf8'))).map((p) => `dist/server/wrangler.json: ${p}`));
  }
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...target.args], { cwd, env: productionDryRunEnv(process.env), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  let readme = '';
  try {
    readme = readFileSync(path.join(cwd, target.outdir, 'README.md'), 'utf8');
  } catch {
    // reported by the check below
  }
  const problems = [...preProblems, ...checkProductionDryRun(target, { status: result.status, output, readme })];
  if (problems.length > 0) {
    process.stderr.write(output.split('\n').slice(-40).join('\n'));
    process.stderr.write(`\nproduction dry-run FAILED for ${target.workerName}:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    return 1;
  }
  const size = parseUploadSize(output);
  process.stdout.write(`production dry-run ok: ${target.workerName}, ${size.raw} KiB, ${size.gzip} KiB gzipped (nothing was deployed; no account was used)\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
