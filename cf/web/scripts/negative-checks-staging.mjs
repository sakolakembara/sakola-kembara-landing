// Proves the tests of the staging scripts are not vacuous (SAKEM-098: the portal's deploy printer, the staging dry run,
// the probe's `--portal` and the reader of a pretty-printed tail capture): each check breaks ONE safeguard in
// cf/scripts/staging-deploy-command.mjs, cf/scripts/staging-dry-run.mjs, scripts/measure-staging.mjs or
// scripts/lib/staging-measure.mjs, runs the tests that must notice, expects them to FAIL, and always restores the file.
//
//   node scripts/negative-checks-staging.mjs                      (pnpm test:negative:staging)
//   node scripts/negative-checks-staging.mjs --only "printer:"    only the checks whose name contains the text
//
// Run it on a clean tree. A pattern found other than exactly once is reported as FAIL, so a refactor that moves the
// code cannot silently turn a check into a no-op.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
process.chdir(webRoot);

const PRINTER = '../scripts/staging-deploy-command.mjs';
const DRY_RUN = '../scripts/staging-dry-run.mjs';
const CLI = 'scripts/measure-staging.mjs';
const LIB = 'scripts/lib/staging-measure.mjs';
const SCRIPTS = 'tests/staging-scripts.test.ts tests/staging-config.test.ts';
const MEASURE = 'tests/measure-staging.test.ts';

const checks = [
  // ---------------------------------------------------------------- the printer
  {
    name: 'printer: a key for the private bucket is no longer refused as a secret',
    file: PRINTER,
    from: '|API_KEY|PRIVATE/i,',
    to: '|API_KEY/i,',
    tests: SCRIPTS,
  },
  {
    name: "printer: the portal may pass the admin's public bucket address",
    file: PRINTER,
    from: "allowed: ['TURNSTILE_SITE_KEY', 'SITE_URL', 'ADMIN_URL', 'EMAIL_FROM', 'PORTAL_CONTACT_WHATSAPP', 'PORTAL_WHATSAPP_GROUP_URL'],",
    to: "allowed: ['TURNSTILE_SITE_KEY', 'SITE_URL', 'ADMIN_URL', 'EMAIL_FROM', 'PORTAL_CONTACT_WHATSAPP', 'PORTAL_WHATSAPP_GROUP_URL', 'UPLOADS_BASE_URL'],",
    tests: SCRIPTS,
  },
  {
    name: 'printer: a staging Worker may point at the production domain',
    file: PRINTER,
    from: "if (PRODUCTION_DOMAIN.test(url.hostname)) throw new Error(`${where}: refused, ${url.hostname} is the production domain; staging points at staging hosts only`);",
    to: '',
    tests: SCRIPTS,
  },
  {
    name: "printer: a real WhatsApp group invitation is accepted on a public staging page",
    file: PRINTER,
    from: "if (/(^|\\.)(whatsapp\\.com|wa\\.me)$/i.test(url.hostname)) throw",
    to: "if (false) throw",
    tests: SCRIPTS,
  },
  {
    name: 'printer: the contact number may start with 0 (a local number, not the country code)',
    file: PRINTER,
    from: '/^[1-9]\\d{7,14}$/.test(value)',
    to: '/^\\d{7,14}$/.test(value)',
    tests: SCRIPTS,
  },
  {
    name: "printer: the portal's values are read from the admin's file",
    file: PRINTER,
    from: "file: '.staging.vars.portal',",
    to: "file: '.staging.vars',",
    tests: SCRIPTS,
  },
  {
    name: 'printer: the portal deploy command is not the staging environment (it would deploy the production-named Worker)',
    file: PRINTER,
    from: "deploy: ['pnpm', 'exec', 'wrangler', 'deploy', '-c', 'wrangler.portal.jsonc', '--env', 'staging'],",
    to: "deploy: ['pnpm', 'exec', 'wrangler', 'deploy', '-c', 'wrangler.portal.jsonc'],",
    tests: SCRIPTS,
  },
  {
    name: 'printer: an example file with its placeholders is accepted (the placeholder check is off for the portal)',
    file: PRINTER,
    from: "const placeholder = /\\.\\.\\.|REPLACE|CHANGEME|placeholder/i.test(value) || (name !== 'EMAIL_FROM' && /[<>]/.test(value));",
    to: "const placeholder = false;",
    tests: SCRIPTS,
  },

  // ---------------------------------------------------------------- the staging dry run
  {
    name: "dry run: the portal's bundle may carry the admin's file-open limiter",
    file: DRY_RUN,
    from: "      'env.RL_ADMIN_FILE',\n",
    to: '',
    tests: SCRIPTS,
  },
  {
    name: "dry run: the portal and the admin write their output to one folder",
    file: DRY_RUN,
    from: "    outdir: 'dist/portal-worker-staging',",
    to: "    outdir: 'dist/worker-staging',",
    tests: SCRIPTS,
  },

  // ---------------------------------------------------------------- the probe's --portal
  {
    name: 'probe: the portal host is not typed back before anything is sent',
    file: CLI,
    from: 'if (portal && !(await confirmed(',
    to: 'if (false && portal && !(await confirmed(',
    tests: MEASURE,
  },
  {
    name: 'probe: the portal host is not checked (the production domain, a foreign host)',
    file: CLI,
    from: "portal = flags.portal ? checkBase(flags.portal, '--portal') : null;",
    to: "portal = flags.portal ? { origin: flags.portal, host: new URL(flags.portal).host, loopback: false } : null;",
    tests: MEASURE,
  },
  {
    name: "probe: a portal route is asked of the site's host",
    file: LIB,
    from: "add('portal', 'GET', '/portal/api/me', { target: 'portal', ",
    to: "add('portal', 'GET', '/portal/api/me', { ",
    tests: MEASURE,
  },
  {
    name: 'probe: --writes adds a request for the portal',
    file: LIB,
    from: '  if (writes) {\n    if (web) {',
    to: "  if (writes) {\n    if (portal) add('portal', 'POST', '/portal/api/auth/sign-in/email', { target: 'portal', body: SIGN_IN_BODY, headers: { 'content-type': 'application/json' }, withOrigin: true, minDelayMs: 13_000 });\n    if (web) {",
    tests: MEASURE,
  },

  // ---------------------------------------------------------------- the capture reader
  {
    name: 'capture: an object that was cut swallows the objects after it',
    file: LIB,
    from: '        // Neither indented nor the closing brace: the object was cut. This line is read afresh.\n        dropPending();\n',
    to: '        // (removed)\n',
    tests: MEASURE,
  },
  {
    name: 'capture: a banner line or text is not counted as skipped',
    file: LIB,
    from: '    read += 1;\n    skipped += 1; // a banner line, text, an array',
    to: '    read += 1; // a banner line, text, an array',
    tests: MEASURE,
  },
  {
    name: 'capture: a pretty-printed object is read only when its closing brace has no carriage return (a CRLF file loses every event)',
    file: LIB,
    from: "const text = line.endsWith('\\r') ? line.slice(0, -1) : line;",
    to: 'const text = line;',
    tests: MEASURE,
  },
  {
    name: 'capture: an object cut at the end of the input is dropped without a trace',
    file: LIB,
    from: '    end() {\n      dropPending();\n',
    to: '    end() {\n',
    tests: MEASURE,
  },
];

// `--only <text>` runs the checks whose name contains <text>.
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined;

let bad = 0;
let ran = 0;
for (const check of checks) {
  if (only && !check.name.includes(only)) continue;
  ran++;
  const original = readFileSync(check.file, 'utf8');
  const found = original.split(check.from).length - 1;
  if (found !== 1) {
    console.log(`FAIL  ${check.name}: pattern found ${found} times in ${check.file}, expected exactly once`);
    bad++;
    continue;
  }
  try {
    writeFileSync(check.file, original.replace(check.from, () => check.to));
    const run = spawnSync('pnpm', ['exec', 'vitest', 'run', ...check.tests.split(' ')], { encoding: 'utf8' });
    const failed = (run.stdout + run.stderr).match(/Tests\s+(\d+) failed/);
    if (run.status !== 0 && failed) console.log(`OK    ${check.name}: ${failed[1]} test(s) failed as they should`);
    else {
      console.log(`FAIL  ${check.name}: tests still pass (exit ${run.status})`);
      bad++;
    }
  } finally {
    writeFileSync(check.file, original);
  }
}
console.log(bad === 0 ? `\nAll ${ran} safeguards are covered by tests.` : `\n${bad} of ${ran} checks did not behave.`);
process.exit(bad === 0 ? 0 : 1);
