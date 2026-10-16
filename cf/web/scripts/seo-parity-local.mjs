// Rehearsal of the SEO parity tool on this machine, with NO real site and NO network beyond loopback:
//
//   candidate = the BUILT Worker under `wrangler dev` (local mode), with the stub origin and the fixture API
//               behind it, started the way scripts/e2e.mjs starts it (E2E_PORT_OFFSET shifts every port);
//   live      = scripts/lib/wp-stub.mjs, a stand-in that serves invented WordPress-shaped pages built from the
//               candidate's own content, with a few differences planted on purpose.
//
//   pnpm build && E2E_PORT_OFFSET=3000 pnpm seo:parity:local
//
// It runs the real tool (scripts/seo-parity.mjs) against the two, writes the report to .seo-parity/local/, and
// checks that the tool found what was planted and nothing it should not have. Exit 0 = the tool behaved. A BLOCKER
// in the report is NOT a failure of this script: the stub plants three on purpose. What this proves is the tool
// and the local candidate; it proves nothing about the real WordPress site (its HTML has not been seen here).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PORT_OFFSET, startStack, webRoot } from './lib/harness.mjs';
import { PLANTED, startWpStub } from './lib/wp-stub.mjs';
import { extractPage, USER_AGENT } from './lib/seo-parity-core.mjs';
import { parseCli, runFromOptions } from './seo-parity.mjs';
import { cleanExcerpt } from '../blog-contract.mjs';

if (!existsSync(path.join(webRoot, 'dist/server/wrangler.json'))) {
  console.error('dist/ is missing. Run `pnpm build` first.');
  process.exit(2);
}

const articles = JSON.parse(readFileSync(path.join(webRoot, '../../lib/blog-posts.json'), 'utf8')).articles;
const out = path.join(webRoot, '.seo-parity/local');
const checks = [];
const check = (name, fn) => {
  try {
    fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
};

console.log(`starting the local stack (port offset ${PORT_OFFSET})...`);
const stack = await startStack({ log: path.join(webRoot, 'dist/seo-parity-wrangler.log'), vars: { ADMIN_URL: 'https://admin.example.test' } });
let stub;
let exitCode = 1;
try {
  // The live stub is made of the candidate's own content, so the baseline is "the same words in WordPress clothes".
  // (/laporan is not one of them since SAKEM-105: it is a 308 to /donasi#laporan, listed by the tool with the other redirects)
  const pagePaths = ['/', '/blog', '/tim', '/kontak', '/donasi', '/gabung-siswa', '/program/prapembinaan', '/program/pembinaan', '/program/pasca-pembinaan'];
  const pages = [];
  for (const p of pagePaths) {
    const res = await fetch(`${stack.base}${p}`, { redirect: 'manual' });
    const page = extractPage(await res.text());
    const home = p === '/';
    // the candidate's suffix is the live WordPress pattern since SAKEM-090 (" - Yayasan Sakola Kembara Indonesia")
    const core = home ? page.title : (page.title ?? '').replace(/\s+-\s+Yayasan Sakola Kembara Indonesia$/, '');
    const ogImage = page.og.image ? new URL(page.og.image).pathname : null;
    pages.push({ path: home ? '/' : `${p}/`, core, exactTitle: home, description: page.description ?? '', h1: page.h1[0], image: ogImage });
  }

  stub = await startWpStub({ articles, pages, cleanExcerpt });
  console.log(`live stub on ${stub.base}, candidate on ${stack.base}`);

  const options = parseCli(['--live-base', stub.base, '--candidate-base', stack.base, '--include-images', '--delay-ms', '0', '--out', out, '--quiet']);
  const result = await runFromOptions(options, { log: () => {} });
  const byPath = new Map(result.json.results.map((r) => [r.path, r]));
  const codes = (p) => (byPath.get(p)?.findings ?? []).map((f) => f.code);

  check('the tool compared every URL it listed, and the report files exist', () => {
    assert.ok(result.summary.compared >= 250, `compared ${result.summary.compared}`);
    assert.ok(existsSync(path.join(out, 'report.md')) && existsSync(path.join(out, 'report.json')));
  });
  check('the stub saw GET only, no cookie, no authorization, always the tool\'s User-Agent', () => {
    assert.ok(stub.log.length > 200);
    assert.ok(stub.log.every((e) => e.method === 'GET'), 'a non-GET request reached the live side');
    assert.ok(stub.log.every((e) => e.cookie === null && e.authorization === null));
    assert.ok(stub.log.every((e) => e.userAgent === USER_AGENT));
  });
  check(`every one of the ${articles.length} WordPress article URLs: the candidate redirects once, permanently, to a 200; no blocker, no chain, no canonical problem`, () => {
    for (const a of articles) {
      const p = new URL(a.sourceUrl).pathname;
      const r = byPath.get(p);
      assert.ok(r, `no result for ${p}`);
      assert.ok(codes(p).includes('address-moved'), `${p}: ${codes(p).join(', ')}`);
      assert.equal(r.findings.filter((f) => f.severity === 'BLOCKER').length, 0, `${p}: ${r.findings.map((f) => f.message).join('; ')}`);
      assert.ok(!codes(p).some((c) => ['redirect-chain', 'redirect-temporary', 'canonical-other-url', 'canonical-host', 'canonical-missing'].includes(c)), `${p}: ${codes(p).join(', ')}`);
      assert.equal(r.candidate.final.path, `/blog/${a.id}`);
      assert.deepEqual(r.candidate.chain.map((h) => h.status), [308]);
    }
  });
  check('SAKEM-105: /laporan/, a page that moved into /donasi, is ONE 308 to a 200 on the candidate: INFO only (no blocker, no chain, not "missing"), the tool reads it as a redirect to a page that exists', () => {
    const r = byPath.get('/laporan/');
    assert.ok(r, 'the tool lists /laporan/ (a static source of the redirect table)');
    assert.deepEqual(r.candidate.chain.map((h) => h.status), [308]);
    assert.equal(r.candidate.final.path, '/donasi');
    assert.equal(r.findings.filter((f) => f.severity === 'BLOCKER').length, 0, codes('/laporan/').join(', '));
    assert.ok(!codes('/laporan/').some((c) => ['url-missing', 'redirect-chain', 'redirect-temporary', 'canonical-other-url'].includes(c)), codes('/laporan/').join(', '));
  });
  check('planted: the pages only the live site has are BLOCKERs (url-missing)', () => {
    for (const p of PLANTED.missingOnCandidate) assert.ok(codes(p).includes('url-missing'), `${p}: ${codes(p).join(', ')}`);
  });
  check('category archives the candidate sends to the blog index are INFO (address-moved), never a blocker', () => {
    for (const p of PLANTED.redirectedArchives) {
      assert.ok(codes(p).includes('address-moved'), `${p}: ${codes(p).join(', ')}`);
      assert.equal((byPath.get(p)?.findings ?? []).filter((f) => f.severity === 'BLOCKER').length, 0, p);
    }
  });
  check('planted: a changed title is a WARN, a dropped BreadcrumbList is a WARN, a feed that becomes HTML is a WARN, a moved page is INFO', () => {
    assert.ok(codes(PLANTED.titleChanged).includes('title-changed'), codes(PLANTED.titleChanged).join(', '));
    assert.ok(codes(PLANTED.breadcrumbDropped).includes('jsonld-type-dropped'), codes(PLANTED.breadcrumbDropped).join(', '));
    assert.ok(codes(PLANTED.feed).includes('content-type-changed'), codes(PLANTED.feed).join(', '));
    assert.ok(codes(PLANTED.moved).includes('address-moved'), codes(PLANTED.moved).join(', '));
  });
  check('real gap: every WordPress /?p=<id> shortlink is served by the candidate home page without a redirect (WARN live-redirect-dropped)', () => {
    for (const a of articles.filter((x) => x.wpId)) assert.ok(codes(`/?p=${a.wpId}`).includes('live-redirect-dropped'), `/?p=${a.wpId}: ${codes(`/?p=${a.wpId}`).join(', ')}`);
  });
  check('the sitemap of the candidate lists the new address of every article (no not-in-candidate-sitemap on any of them)', () => {
    for (const a of articles) assert.ok(!codes(new URL(a.sourceUrl).pathname).includes('not-in-candidate-sitemap'), a.id);
  });
  check('the report says FAIL (the planted blockers) and the exit code of the tool run is 1', () => {
    assert.equal(result.summary.pass, false);
    assert.equal(result.exitCode, 1);
    assert.match(result.markdown, /## Verdict: FAIL/);
  });

  console.log('');
  for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.ok ? '' : `\n     ${c.detail}`}`);
  const s = result.summary;
  console.log(`\ntool verdict on the rehearsal: ${s.compared} URLs, ${s.blocker} blocker, ${s.warn} warn, ${s.info} info only, ${s.ok} identical, ${s.skipped} skipped; site-level blockers ${s.siteBlockers}`);
  console.log('counts by code:', JSON.stringify(s.byCode));
  console.log(`report: ${path.relative(process.cwd(), path.join(out, 'report.md'))} and report.json`);
  exitCode = checks.every((c) => c.ok) ? 0 : 1;
} finally {
  await stub?.close();
  await stack.stop();
}
console.log(exitCode === 0 ? '\nrehearsal: the tool found what was planted and nothing it should not have' : '\nrehearsal: FAILED');
process.exit(exitCode);
