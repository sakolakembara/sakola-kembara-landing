// Proves the tests of the page copy are not vacuous (SAKEM-091): each check breaks ONE safeguard in
// src/lib/page-cache.ts (and, since SAKEM-105, in the answer headers of a page that carries a list, src/lib/content-api.ts,
// and in the loader of the reports section, src/lib/reports.ts: /donasi must answer 200 and must never be copied while it is
// degraded), runs the tests that must notice, expects them to FAIL, and always restores the file.
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
// SAKEM-105: /donasi carries the reports. The checks on these files name the tests that must notice (a check without `tests` runs TESTS).
const SECTION = ['tests/reports.test.ts', 'tests/page-cache.test.ts'];
const headers = 'src/lib/content-api.ts';
const reports = 'src/lib/reports.ts';
const donasi = 'src/pages/donasi.astro';
const DONASI_PAGE = ['tests/public-pages.test.ts', 'tests/reports.test.ts'];
const SECTION_DEGRADED = "    default:\n      return { status: 200, headers: { 'cache-control': 'no-store' } };";
const SECTION_STALE = "    case 'stale':\n      return { status: 200, headers: { 'cache-control': 'public, max-age=0, s-maxage=30' } };\n    default:\n      return { status: 200,";
const FIXED = "const FIXED_PAGES = new Set(['/tim', '/donasi', '/gabung-siswa/docs', '/sitemap.xml']);";

const checks = [
  { name: 'an error page is copied (any status)', file: lib, from: "if (configured <= 0 || response.status !== 200) return 0;", to: 'if (configured <= 0) return 0;' },
  { name: 'a stale answer (s-maxage=30) is copied', file: lib, from: 'const MIN_PAGE_MAX_AGE = 60;', to: 'const MIN_PAGE_MAX_AGE = 0;' },
  { name: "a page is kept longer than its own s-maxage", file: lib, from: 'return sMaxAge >= MIN_PAGE_MAX_AGE ? Math.min(configured, sMaxAge) : 0;', to: 'return sMaxAge >= MIN_PAGE_MAX_AGE ? configured : 0;' },
  { name: 'a response that sets a cookie is copied', file: lib, from: "if (response.headers.has('set-cookie')) return 0;", to: '' },
  { name: "a no-store or private page is copied", file: lib, from: "if (/\\b(no-store|private)\\b/i.test(control)) return 0;", to: '' },
  { name: "/tim copies stale or empty data (it answers 200 either way)", file: lib, from: "return teamSource === 'network' || teamSource === 'cache' ? configured : 0;", to: 'return configured;' },
  { name: 'a query string nobody reads makes a new entry (a visitor can fill the cache)', file: lib, from: "if (pathname === '/blog') return `/blog?page=${normalizePage(url.searchParams.get('page'))}`;", to: "if (pathname === '/blog') return `/blog${url.search}`;" },
  { name: 'any path under /blog is a page (an unknown slug, a path with a slash)', file: lib, from: 'return ARTICLE_SLUG.test(slug) ? `/blog/${slug}` : null;', to: 'return `/blog/${slug}`;' },
  { name: 'the form page /kontak is copied', file: lib, from: FIXED, to: FIXED.replace("'/sitemap.xml']", "'/sitemap.xml', '/kontak']") },
  { name: '/donasi is not in the list of copied pages (the Worker renders it now, and it costs what /tim costs: SAKEM-105)', file: lib, from: FIXED, to: FIXED.replace("'/donasi', ", '') },
  { name: 'the old /laporan (a redirect now) is still in the list of copied pages', file: lib, from: FIXED, to: FIXED.replace("'/sitemap.xml']", "'/sitemap.xml', '/laporan']") },

  // ---- /donasi carries the reports (SAKEM-105): the page never fails because of them, and a degraded page is never copied
  { name: 'a /donasi whose reports are missing is a 503 (the page fails because of a section)', file: headers, from: SECTION_DEGRADED, to: SECTION_DEGRADED.replace('status: 200', 'status: 503'), tests: SECTION },
  { name: 'a /donasi whose reports are missing may be cached for a minute (a copy of the failure panel would outlive the outage)', file: headers, from: SECTION_DEGRADED, to: "    default:\n      return { status: 200, headers: { 'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' } };", tests: SECTION },
  { name: 'a /donasi with a stale copy of the reports is a fresh answer (copied for a minute)', file: headers, from: SECTION_STALE, to: SECTION_STALE.replace('s-maxage=30', 's-maxage=60'), tests: SECTION },
  { name: 'a /donasi whose reports are missing says Retry-After (the page is fine; a crawler must not think it is down)', file: headers, from: SECTION_DEGRADED, to: "    default:\n      return { status: 200, headers: { 'cache-control': 'no-store', 'retry-after': '30' } };", tests: SECTION },
  { name: 'the page /donasi answers with the headers of a page that IS the list (a 503 when the API is down)', file: donasi, from: 'contentSectionHeaders(reports.source)', to: 'contentPageHeaders(reports.source)', tests: DONASI_PAGE },
  { name: 'the reports section lets a failure of its loader through (the whole page would be a 500)', file: reports, from: "    result = { reports: null, source: 'empty' };\n  }\n  const list = result.reports ?? [];", to: "    throw new Error('the reports section failed');\n  }\n  const list = result.reports ?? [];", tests: SECTION },
  { name: 'the reports section builds its runtime outside the guard (a missing binding would be a 500 of the whole page)', file: reports, from: '  try {\n    result = await loadReports(runtime());', to: '  const built = runtime();\n  try {\n    result = await loadReports(built);', tests: SECTION },
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
    const run = spawnSync('pnpm', ['exec', 'vitest', 'run', ...(check.tests ?? TESTS)], { encoding: 'utf8' });
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
