// Proves the shortlink redirect's tests are not vacuous (SAKEM-080, SAKEM-082): each check breaks ONE safeguard in
// src/lib/shortlink.ts (or in the admin's reserved list, which tests/shortlink-reserved.test.ts reads), runs the tests
// that must notice, expects them to FAIL, and always restores the file.
//
//   node scripts/negative-checks-shortlink.mjs        (pnpm test:negative:shortlink)
//
// Run it on a clean tree. A pattern found other than exactly once is reported as FAIL, so a refactor that moves the
// code cannot silently turn a check into a no-op. The Worker half of the redirect has its own list
// (cf/admin/scripts/negative-checks-konten-misc.mjs).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
process.chdir(webRoot);

const TESTS = ['tests/shortlink.test.ts', 'tests/shortlink-reserved.test.ts'];
const lib = 'src/lib/shortlink.ts';
const reserved = '../admin/src/shortlinks/reserved.ts';

const checks = [
  {
    name: 'a target that is not safe is followed (the payload parser does not check it)',
    file: lib,
    from: "typeof target === 'string' && target !== '' && isSafeTarget(target) ? target : null",
    to: "typeof target === 'string' && target !== '' ? target : null",
  },
  {
    name: "any 404 is 'not found' (an HTML page from a wrong base URL makes every link look deleted)",
    file: lib,
    from: "return fail('status 404 without the not_found body');",
    to: "return { kind: 'not_found' };",
  },
  { name: 'the redirect is permanent (308), so browsers keep it past an edit', file: lib, from: 'status: 307, headers: { location: target', to: 'status: 308, headers: { location: target' },
  {
    name: 'the redirect may be cached (a cache would swallow clicks)',
    file: lib,
    from: "headers: { location: target, 'cache-control': 'no-store' }",
    to: "headers: { location: target, 'cache-control': 'public, max-age=300' }",
  },
  { name: 'a backslash or a tab in a target is allowed', file: lib, from: 'if (/[\\u0000-\\u001f\\u007f\\\\]/.test(target)) return false;', to: '' },
  { name: "an outage is reported as 'not found' (a failed lookup looks like a dead link)", file: lib, from: 'if (!res.ok) return fail(`status ${res.status}`);', to: "if (!res.ok) return { kind: 'not_found' };" },
  { name: 'the lookup is not bounded in time', file: lib, from: '      signal: AbortSignal.timeout(timeoutMs),\n', to: '' },
  { name: "a slug of a redirect source of the site is not reserved by the admin (daftar)", file: reserved, from: '  "daftar",\n', to: '' },
  { name: "the 404 page's slug is not reserved by the admin", file: reserved, from: '  "404",\n', to: '' },
];

let bad = 0;
for (const check of checks) {
  const original = readFileSync(check.file, 'utf8');
  const found = original.split(check.from).length - 1;
  if (found !== 1) {
    console.log(`FAIL  ${check.name}: pattern found ${found} times in ${check.file}, expected exactly once`);
    bad++;
    continue;
  }
  try {
    writeFileSync(check.file, original.replace(check.from, () => check.to));
    const run = spawnSync('pnpm', ['exec', 'vitest', 'run', ...TESTS], { encoding: 'utf8' });
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
console.log(bad === 0 ? `\nAll ${checks.length} safeguards are covered by tests.` : `\n${bad} of ${checks.length} checks did not behave.`);
process.exit(bad === 0 ? 0 : 1);
