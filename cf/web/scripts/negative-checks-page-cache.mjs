// Proves the tests of the page copy are not vacuous (SAKEM-091): each check breaks ONE safeguard in
// src/lib/page-cache.ts, runs the tests that must notice, expects them to FAIL, and always restores the file.
//
//   node scripts/negative-checks-page-cache.mjs        (pnpm test:negative:page-cache)
//
// Run it on a clean tree. A pattern found other than exactly once is reported as FAIL, so a refactor that moves the
// code cannot silently turn a check into a no-op. The wiring in src/middleware.ts is covered by the page-cache group
// of scripts/e2e.mjs, not by these.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
process.chdir(webRoot);

const TESTS = ['tests/page-cache.test.ts'];
const lib = 'src/lib/page-cache.ts';

const checks = [
  { name: 'an error page is copied (any status)', file: lib, from: "if (configured <= 0 || response.status !== 200) return 0;", to: 'if (configured <= 0) return 0;' },
  { name: 'a stale answer (s-maxage=30) is copied', file: lib, from: 'const MIN_PAGE_MAX_AGE = 60;', to: 'const MIN_PAGE_MAX_AGE = 0;' },
  { name: "a page is kept longer than its own s-maxage", file: lib, from: 'return sMaxAge >= MIN_PAGE_MAX_AGE ? Math.min(configured, sMaxAge) : 0;', to: 'return sMaxAge >= MIN_PAGE_MAX_AGE ? configured : 0;' },
  { name: 'a response that sets a cookie is copied', file: lib, from: "if (response.headers.has('set-cookie')) return 0;", to: '' },
  { name: "a no-store or private page is copied", file: lib, from: "if (/\\b(no-store|private)\\b/i.test(control)) return 0;", to: '' },
  { name: "/tim copies stale or empty data (it answers 200 either way)", file: lib, from: "return teamSource === 'network' || teamSource === 'cache' ? configured : 0;", to: 'return configured;' },
  { name: 'a query string nobody reads makes a new entry (a visitor can fill the cache)', file: lib, from: "if (pathname === '/blog') return `/blog?page=${normalizePage(url.searchParams.get('page'))}`;", to: "if (pathname === '/blog') return `/blog${url.search}`;" },
  { name: 'any path under /blog is a page (an unknown slug, a path with a slash)', file: lib, from: 'return ARTICLE_SLUG.test(slug) ? `/blog/${slug}` : null;', to: 'return `/blog/${slug}`;' },
  { name: 'the form page /kontak is copied', file: lib, from: "const FIXED_PAGES = new Set(['/tim', '/laporan', '/gabung-siswa/docs', '/sitemap.xml']);", to: "const FIXED_PAGES = new Set(['/tim', '/laporan', '/gabung-siswa/docs', '/sitemap.xml', '/kontak']);" },
  { name: 'an expired copy is still served', file: lib, from: 'if (entry.expiresAt <= this.#now()) {', to: 'if (false) {' },
  { name: 'the cache grows without bound', file: lib, from: 'while (this.#entries.size > MAX_ENTRIES)', to: 'while (false)' },
  { name: 'a page of any size is kept', file: lib, from: 'if (response.body.byteLength > MAX_BODY_BYTES) return false;', to: '' },
  { name: 'a hit does not say it is a copy', file: lib, from: "headers.set('x-page-cache', 'hit');", to: '' },
  { name: 'the setting has no ceiling', file: lib, from: 'return Math.min(n, MAX_PAGE_CACHE_SECONDS);', to: 'return n;' },
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
