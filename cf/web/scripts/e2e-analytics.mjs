// End-to-end check of the Cloudflare Web Analytics beacon (SAKEM-095, decision D-07) and of Google Tag Manager (SAKEM-108) in
// the PRERENDERED pages, against a SECOND build made here with WEB_ANALYTICS_BEACON_ID and GTM_CONTAINER_ID in the build's shell
// environment. Each numbered check below holds for both ids. The plain build is checked by
// tests/web-analytics-built.test.ts and by the "analytics" group of scripts/e2e.mjs; this is the half that needs another build.
//
//   pnpm test:e2e:analytics         (about two minutes: one `astro build`, two `wrangler dev` stacks; E2E_PORT_OFFSET shifts the ports)
//
// What it proves, with an invented id:
//   1. the build variable reaches every prerendered page: exactly one beacon tag, with that id, at the end of <body>;
//   2. the decoy `.dev.vars` it writes for the build (with ANOTHER id) reaches no page and no deployed config: the prerender's
//      `env` holds that file, and a local-development file must never put a value into static HTML;
//   3. the pages the Worker renders and the prerendered ones then carry the SAME id when the Worker variable is set from the
//      same value (the deploy the runbook describes), and
//   4. with the build variable only, the rendered pages have none (no fallback to the build: unsetting the Worker variable is
//      how it is switched off), so the two sources really are separate and the runbook's smoke test has something to find.
//
// It writes a temporary `.dev.vars` in cf/web (git-ignored) and removes it; if one is already there (yours) it stops without
// touching it. Nothing here talks to Cloudflare: the build and the Worker run locally.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startStack, webRoot } from './lib/harness.mjs';

const ID = '0123456789abcdef0123456789abcdef';
const DECOY = 'fedcba9876543210fedcba9876543210';
const GTM = 'GTM-TEST123';
const GTM_DECOY = 'GTM-DECOY99';
const devVars = path.join(webRoot, '.dev.vars');
if (existsSync(devVars)) {
  console.error('cf/web/.dev.vars exists. This check writes its own (with a decoy id) for the build: move yours aside and run it again.');
  process.exit(2);
}

// /donasi is a rendered page since SAKEM-105 (it carries the Laporan section): it takes the Worker variable, not the build's.
const PRERENDERED = ['/', '/gabung-siswa', '/program/prapembinaan', '/program/pembinaan', '/program/pasca-pembinaan'];
const RENDERED = ['/blog', '/tim', '/donasi', '/gabung-siswa/docs', '/kontak', '/no-such-page'];
const ANYWHERE = /cloudflareinsights|data-cf-beacon|beacon\.min\.js/i;
const tagsOf = (html) => [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]).filter((t) => ANYWHERE.test(t));
const decode = (t) => t.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const tokenOf = (tag) => JSON.parse(decode(tag.match(/data-cf-beacon="([^"]*)"/)[1])).token;
const GTM_ANYWHERE = /googletagmanager|GTM-[0-9A-Z]{4,}/i;
/** The Tag Manager ids of a page: the one in the script and the one in the frame, once each, or a failed assertion. */
const gtmOf = (html, where) => {
  const scripts = [...html.matchAll(/'dataLayer',"(GTM-[0-9A-Z]+)"\);<\/script>/g)].map((m) => m[1]);
  const frames = [...html.matchAll(/googletagmanager\.com\/ns\.html\?id=(GTM-[0-9A-Z]+)"/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1, `${where}: one Tag Manager script`);
  assert.equal(frames.length, 1, `${where}: one Tag Manager frame`);
  assert.equal(scripts[0], frames[0], `${where}: the same id in both parts`);
  assert.ok(html.indexOf("'dataLayer'") < html.indexOf('</head>') && html.indexOf('ns.html') > html.indexOf('<body'), `${where}: the script in <head>, the frame in <body>`);
  return scripts[0];
};

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

function run(command, args, env = {}) {
  const res = spawnSync(command, args, { cwd: webRoot, env: { ...process.env, CI: '1', NO_COLOR: '1', ...env }, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (exit ${res.status}):\n${(res.stdout + res.stderr).slice(-2500)}`);
  return res;
}

const out = mkdtempSync(path.join(tmpdir(), 'sakem-analytics-build-'));
let exitCode = 1;
try {
  console.log('assets (warm: the generated images are reused)...');
  run('node', ['scripts/sync-assets.mjs']);
  run('node', ['scripts/build-assets.mjs']);

  console.log('building with WEB_ANALYTICS_BEACON_ID and GTM_CONTAINER_ID in the shell and decoy ids in .dev.vars...');
  writeFileSync(devVars, `WEB_ANALYTICS_BEACON_ID=${DECOY}\nGTM_CONTAINER_ID=${GTM_DECOY}\n`);
  try {
    // CLOUDFLARE_ENV is removed: this is the production-shaped build, not the staging one
    const env = { WEB_ANALYTICS_BEACON_ID: ID, GTM_CONTAINER_ID: GTM };
    const clean = { ...process.env };
    delete clean.CLOUDFLARE_ENV;
    const res = spawnSync(path.join(webRoot, 'node_modules/.bin/astro'), ['build', '--outDir', out], { cwd: webRoot, env: { ...clean, ...env, CI: '1', NO_COLOR: '1' }, encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`astro build failed (exit ${res.status}):\n${(res.stdout + res.stderr).slice(-2500)}`);
  } finally {
    rmSync(devVars, { force: true });
  }
  // The Cloudflare Vite plugin copies .dev.vars into the build output (server/.dev.vars), where `wrangler dev` of that build
  // loads it. A deploy never uploads it, so the copy is removed: what the stacks below see is what a deploy would have.
  rmSync(path.join(out, 'server/.dev.vars'), { force: true });

  const client = path.join(out, 'client');
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const htmlFiles = walk(client).filter((f) => f.endsWith('.html'));

  await check('the build prerendered the five pages', () => {
    assert.deepEqual(htmlFiles.map((f) => path.relative(client, f)).sort(), ['gabung-siswa.html', 'index.html', 'program/pasca-pembinaan.html', 'program/pembinaan.html', 'program/prapembinaan.html']);
  });

  await check('1. every prerendered page has exactly one beacon tag with the build\'s id, a module script at the end of <body>', () => {
    for (const file of htmlFiles) {
      const html = readFileSync(file, 'utf8');
      const rel = path.relative(client, file);
      const tags = tagsOf(html);
      assert.equal(tags.length, 1, `${rel}: one tag`);
      assert.equal(html.split('data-cf-beacon').length - 1, 1, `${rel}: one attribute`);
      assert.match(tags[0], /^<script type="module" src="https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js" data-cf-beacon="[^"]*">$/, rel);
      assert.equal(tokenOf(tags[0]), ID, rel);
      assert.ok(html.lastIndexOf(tags[0]) > html.lastIndexOf('</footer>') && html.indexOf('</body>') > html.lastIndexOf(tags[0]), `${rel}: at the end of <body>`);
      assert.doesNotMatch(html.slice(0, html.indexOf('</head>')), ANYWHERE, `${rel}: not in <head>`);
      assert.equal(gtmOf(html, rel), GTM, `${rel}: the build's Tag Manager id`);
    }
  });

  await check('2. the decoy id of .dev.vars is in no prerendered page and not in the deployed config, which has no variable', () => {
    for (const file of htmlFiles) assert.ok(!readFileSync(file, 'utf8').includes(DECOY) && !readFileSync(file, 'utf8').includes(GTM_DECOY), path.relative(client, file));
    const config = readFileSync(path.join(out, 'server/wrangler.json'), 'utf8');
    assert.ok(!config.includes(DECOY) && !config.includes(GTM_DECOY));
    assert.deepEqual(JSON.parse(config).vars, {});
  });

  const config = path.join(out, 'server/wrangler.json');

  await check('3. with the Worker variable set from the same value, the rendered pages and the prerendered pages carry the same id, once each', async () => {
    const s = await startStack({ wranglerConfig: config, port: 8813, stubPort: 4435, fixturePort: 4436, inspectorPort: 9353, vars: { WEB_ANALYTICS_BEACON_ID: ID, GTM_CONTAINER_ID: GTM } });
    try {
      for (const p of [...PRERENDERED, ...RENDERED]) {
        const res = await fetch(`${s.base}${p}`, { redirect: 'manual' });
        const html = await res.text();
        const tags = tagsOf(html);
        assert.equal(tags.length, 1, `${p}: one tag`);
        assert.equal(tokenOf(tags[0]), ID, `${p}: the same id`);
        assert.equal(gtmOf(html, p), GTM, `${p}: the same Tag Manager id`);
        assert.equal(res.headers.get('set-cookie'), null, p);
        assert.equal(res.headers.get('content-security-policy'), null, p);
      }
      assert.equal((await fetch(`${s.base}/no-such-page`)).status, 404);
    } finally {
      await s.stop();
    }
  });

  await check('4. with the build variable only, the prerendered pages keep it and the rendered pages have none (no fallback to the build)', async () => {
    const s = await startStack({ wranglerConfig: config, port: 8814, stubPort: 4437, fixturePort: 4438, inspectorPort: 9354 });
    try {
      for (const p of PRERENDERED) {
        const html = await (await fetch(`${s.base}${p}`, { redirect: 'manual' })).text();
        assert.equal(tokenOf(tagsOf(html)[0]), ID, p);
        assert.equal(gtmOf(html, p), GTM, p);
      }
      for (const p of RENDERED) {
        const html = await (await fetch(`${s.base}${p}`, { redirect: 'manual' })).text();
        const hit = html.search(ANYWHERE);
        assert.equal(hit, -1, `${p}: a beacon on a rendered page with no Worker variable, near: ${hit < 0 ? '' : html.slice(Math.max(0, hit - 120), hit + 160)}`);
        assert.doesNotMatch(html, GTM_ANYWHERE, `${p}: Tag Manager on a rendered page with no Worker variable`);
      }
      assert.doesNotMatch(s.output(), /web analytics:|google tag manager:/i, 'unset is silent');
    } finally {
      await s.stop();
    }
  });

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : `\n     ${r.detail}`}`);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  exitCode = failed.length ? 1 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  rmSync(devVars, { force: true });
  rmSync(out, { recursive: true, force: true });
}
process.exit(exitCode);
