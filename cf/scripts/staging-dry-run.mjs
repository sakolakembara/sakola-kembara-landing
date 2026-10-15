#!/usr/bin/env node
// Dry-run of the STAGING deploy of one Worker (SAKEM-084, docs/cloudflare/staging-runbook.md):
//
//   node ../scripts/staging-dry-run.mjs admin     (from cf/admin, after `pnpm build:spa`)
//   node ../scripts/staging-dry-run.mjs portal    (from cf/admin, after `pnpm build:portal-spa`)
//   node ../scripts/staging-dry-run.mjs web       (from cf/web, after `pnpm build:staging`)
//
// The package scripts `deploy:staging:dry` run the build and then this. It runs `wrangler deploy --dry-run`
// and nothing else: the flag is part of the command line below, there is no option to leave it out, the
// Cloudflare credentials of the shell are removed from the environment of the child process, and no
// network call is made (a dry run only bundles). The REAL deploy is never scripted: the runbook has the
// command, and `pnpm deploy:staging:command` prints it.
//
// What it proves, beyond "wrangler exits 0": the bundle is the STAGING Worker (the name wrangler writes
// into the output folder, the staging D1 database and R2 bucket, the staging environment variable, the
// service binding of the site pointing at the staging admin Worker; for the portal, its own private bucket and
// none of the admin's) and not the production one, and the
// bundle is still far below the limit it would have had under the old 3 MiB compressed rule.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfRoot = path.resolve(here, '..');

const RATE_LIMITS = [
  'RL_LOGIN (5 requests/60s)',
  'RL_LOGIN_ACCOUNT (20 requests/60s)',
  'RL_REGISTER (10 requests/60s)',
  'RL_RESET (5 requests/60s)',
  'RL_VERIFY_RESEND (2 requests/60s)',
  'RL_MAIL_TARGET (3 requests/60s)',
  'RL_TOKEN (20 requests/60s)',
  'RL_CONTACT (5 requests/60s)',
  'RL_UPLOAD (20 requests/60s)',
  'RL_BLOG_PREVIEW (60 requests/60s)',
  // The student portal's (SAKEM-083): written out in the staging block too, as its test requires.
  'RL_PORTAL_READ (60 requests/60s)',
  'RL_PORTAL_SAVE (30 requests/60s)',
  'RL_PORTAL_UPLOAD (20 requests/60s)',
  'RL_PORTAL_SUBMIT (3 requests/60s)',
  'RL_ADMIN_FILE (120 requests/60s)',
].map((line) => `env.${line}`);

// The portal's: written out in its own staging block, with its own namespaces (81xx). It has no RL_CONTACT, RL_UPLOAD,
// RL_BLOG_PREVIEW or RL_ADMIN_FILE: those are the admin's concerns (a test of the portal config says so).
const PORTAL_RATE_LIMITS = [
  'RL_LOGIN (5 requests/60s)',
  'RL_LOGIN_ACCOUNT (20 requests/60s)',
  'RL_REGISTER (10 requests/60s)',
  'RL_RESET (5 requests/60s)',
  'RL_VERIFY_RESEND (2 requests/60s)',
  'RL_MAIL_TARGET (3 requests/60s)',
  'RL_TOKEN (20 requests/60s)',
  'RL_PORTAL_READ (60 requests/60s)',
  'RL_PORTAL_SAVE (30 requests/60s)',
  'RL_PORTAL_UPLOAD (20 requests/60s)',
  'RL_PORTAL_SUBMIT (3 requests/60s)',
].map((line) => `env.${line}`);

/** What each target must show. Kept apart from the wrangler files on purpose: the test of those files and this check read the same truth from two sides. */
export const TARGETS = {
  admin: {
    dir: 'admin',
    workerName: 'sakem-admin-staging',
    outdir: 'dist/worker-staging',
    args: ['deploy', '--dry-run', '--env', 'staging', '--outdir', 'dist/worker-staging'],
    mustContain: ['env.DB (sakem-staging)', 'env.UPLOADS (sakem-files-staging)', 'env.PRIVATE_FILES (sakem-private-staging)', 'env.ENVIRONMENT ("staging")', 'env.ASSETS', ...RATE_LIMITS],
    mustNotContain: ['env.DB (sakem-admin)', 'env.UPLOADS (sakem-files)', 'env.PRIVATE_FILES (sakem-private)', 'env.ENVIRONMENT ("production")'],
  },
  // The student portal (SAKEM-098): the same package as the admin, its own configuration and its own output folder (the
  // admin's dry run and this one may follow each other without one folder holding both). The per-deploy public values are
  // declared empty in the staging block, so the listing must show every one of them as ("") when no --var was given.
  portal: {
    dir: 'admin',
    workerName: 'sakem-portal-staging',
    outdir: 'dist/portal-worker-staging',
    args: ['deploy', '--dry-run', '-c', 'wrangler.portal.jsonc', '--env', 'staging', '--outdir', 'dist/portal-worker-staging'],
    mustContain: [
      'env.DB (sakem-staging)',
      'env.PRIVATE_FILES (sakem-private-staging)',
      'env.ENVIRONMENT ("staging")',
      'env.PRIVATE_FILES_BUDGET_BYTES ("8000000000")',
      'env.ASSETS',
      ...['SITE_URL', 'ADMIN_URL', 'TURNSTILE_SITE_KEY', 'EMAIL_FROM', 'PORTAL_CONTACT_WHATSAPP', 'PORTAL_WHATSAPP_GROUP_URL'].map((name) => `env.${name} ("")`),
      ...PORTAL_RATE_LIMITS,
    ],
    // The admin's database (production name), its two buckets, the public bucket's variable, and the admin's limiters.
    mustNotContain: [
      'env.DB (sakem-admin)',
      'env.PRIVATE_FILES (sakem-private)',
      'env.UPLOADS',
      'env.ENVIRONMENT ("production")',
      'env.RL_CONTACT',
      'env.RL_UPLOAD',
      'env.RL_BLOG_PREVIEW',
      'env.RL_ADMIN_FILE',
    ],
  },
  web: {
    dir: 'web',
    workerName: 'sakem-web-staging',
    outdir: 'dist/worker-staging',
    args: ['deploy', '--dry-run', '--outdir', 'dist/worker-staging', '-c', 'dist/server/wrangler.json'],
    mustContain: ['env.API (sakem-admin-staging#PublicApi)', 'env.ASSETS'],
    mustNotContain: ['env.API (sakem-admin#PublicApi)', 'env.API (sakem-admin)'],
  },
};

/** Gzip size of the upload in KiB below which the check passes: the OLD Free limit (3 MiB compressed) with a little room, so a regression shows before anyone has to trust a changed limit. */
export const GZIP_BUDGET_KIB = 3000;

/** `Total Upload: 3537.46 KiB / gzip: 638.20 KiB` -> { raw, gzip } in KiB, or null. */
export function parseUploadSize(output) {
  const match = /Total Upload:\s*([\d.]+)\s*KiB\s*\/\s*gzip:\s*([\d.]+)\s*KiB/.exec(output);
  return match ? { raw: Number(match[1]), gzip: Number(match[2]) } : null;
}

/** Problems found in a dry run's output (empty = fine). Pure, so a test can feed it text. */
export function checkDryRun(target, { status, output, readme }) {
  const problems = [];
  if (status !== 0) problems.push(`wrangler exited with ${status}`);
  if (!readme.includes(`worker "${target.workerName}"`)) problems.push(`the output folder is not for the worker "${target.workerName}": ${JSON.stringify(readme.trim())}`);
  for (const line of target.mustContain) if (!output.includes(line)) problems.push(`missing in the binding list: ${line}`);
  for (const line of target.mustNotContain) if (output.includes(line)) problems.push(`must not appear (a production value in the staging bundle): ${line}`);
  const size = parseUploadSize(output);
  if (!size) problems.push('no "Total Upload" line in the output');
  else if (size.gzip > GZIP_BUDGET_KIB) problems.push(`the upload is ${size.gzip} KiB gzipped, above the ${GZIP_BUDGET_KIB} KiB guard`);
  return problems;
}

/** The environment of the child: nothing that could sign it in to an account, no telemetry, non-interactive. */
export function dryRunEnv(base) {
  const env = { ...base, WRANGLER_SEND_METRICS: 'false', CI: '1' };
  for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL', 'CLOUDFLARE_ACCOUNT_ID', 'CF_API_TOKEN', 'CF_ACCOUNT_ID']) delete env[name];
  return env;
}

function main(argv) {
  const target = TARGETS[argv[0]];
  if (!target) {
    process.stderr.write('usage: node ../scripts/staging-dry-run.mjs <admin|portal|web>\n');
    return 2;
  }
  const cwd = path.join(cfRoot, target.dir);
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...target.args], { cwd, env: dryRunEnv(process.env), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  let readme = '';
  try {
    readme = readFileSync(path.join(cwd, target.outdir, 'README.md'), 'utf8');
  } catch {
    // reported by the check below
  }
  const problems = checkDryRun(target, { status: result.status, output, readme });
  if (problems.length > 0) {
    process.stderr.write(output.split('\n').slice(-40).join('\n'));
    process.stderr.write(`\nstaging dry-run FAILED for ${target.workerName}:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    return 1;
  }
  const size = parseUploadSize(output);
  process.stdout.write(`staging dry-run ok: ${target.workerName}, ${size.raw} KiB, ${size.gzip} KiB gzipped (nothing was deployed; no account was used)\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
