// End-to-end check of the student portal switch in the PRERENDERED pages (SAKEM-103, Phase A of the cutover), against TWO more builds made
// here. The plain build (no PORTAL_ENABLED anywhere) is checked by tests/portal-enabled-built.test.ts and by the `portal-paths` and `portal`
// groups of scripts/e2e.mjs, which also check the pages the Worker renders with a Worker variable; this is the half that needs other builds.
//
//   pnpm test:e2e:portal         (about three minutes: two `astro build`, five `wrangler dev` stacks; E2E_PORT_OFFSET shifts the ports)
//
// What it proves, with a made-up `.dev.vars`:
//   Build A: PORTAL_ENABLED=true in the build's shell, and a decoy `.dev.vars` with PORTAL_ENABLED=false.
//     1. every prerendered page has "Masuk" in the bar and in the menu and one inline session script;
//        so the decoy file, which the prerender's `env` holds, did not decide (a local-development file never decides what static HTML says);
//     2. the deployed config has no PORTAL_ENABLED var (it is a per-deploy value);
//     3. with the Worker variable set from the same decision (the deploy of Phase B), the pages the Worker renders agree with the prerendered ones;
//     4. with the build variable only, the pages the Worker renders are OFF (no fallback to the build: unsetting the Worker variable switches
//        them off), and so is a Worker variable of false: the two sources are separate, so the runbook's smoke test has something to find.
//   Build B: PORTAL_ENABLED=<not true or false> in the shell, and a decoy `.dev.vars` with PORTAL_ENABLED=true.
//     5. the build says so once, in fixed words, without the value, and every prerendered page is OFF: an invalid value and the decoy file
//        do not switch the portal on;
//     6. the deployed config has no var either, and a stack of that build with no Worker variable is OFF on both kinds of page.
//
// It writes a temporary `.dev.vars` in cf/web (git-ignored) and removes it; if one is already there (yours) it stops without touching it.
// Nothing here talks to Cloudflare: the builds and the Worker run locally.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startStack, webRoot } from './lib/harness.mjs';

const devVars = path.join(webRoot, '.dev.vars');
if (existsSync(devVars)) {
  console.error('cf/web/.dev.vars exists. This check writes its own (with a decoy value) for each build: move yours aside and run it again.');
  process.exit(2);
}

const PRERENDERED = ['/', '/donasi', '/gabung-siswa', '/program/prapembinaan', '/program/pembinaan', '/program/pasca-pembinaan'];
const RENDERED = ['/blog', '/tim', '/laporan', '/gabung-siswa/docs', '/kontak', '/no-such-page'];
const INVALID = 'yes-please-0123';

const navOf = (html) => html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
const scriptsOf = (html) => [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
/** What a page's navbar says: 'on' (Masuk twice, one session script), 'off' (the slot of the button EMPTY: only the logo and the menu links, no session address anywhere), or the problem. */
function stateOf(html) {
  const nav = navOf(html);
  const masuk = (nav.match(/<a href="\/portal\/login" data-auth-link/g) ?? []).length;
  const menu = ['/', '/tim', '/gabung-siswa', '/donasi', '/laporan', '/blog'];
  const hrefs = [...nav.matchAll(/<a\s[^>]*?href="([^"]*)"/g)].map((m) => m[1]);
  const empty = JSON.stringify(hrefs) === JSON.stringify(['/', ...menu, ...menu]) && !/Masuk|Daftar Sekarang|\/daftar|\/portal|data-auth-link|justify-self-end|mt-6/.test(nav) && (nav.match(/<button\b/g) ?? []).length === 1;
  const sessions = scriptsOf(html).filter((code) => code.includes('get-session')).length;
  const mentions = (html.match(/get-session/g) ?? []).length;
  if (masuk === 2 && !nav.includes('Daftar Sekarang') && sessions === 1 && mentions === 1) return 'on';
  if (masuk === 0 && empty && sessions === 0 && mentions === 0 && !html.includes('data-auth-link')) return 'off';
  return `inconsistent (Masuk ${masuk}, empty slot ${empty}, session scripts ${sessions}, mentions ${mentions})`;
}

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

/** `astro build` into `out` with `shell` as the build's PORTAL_ENABLED (undefined: not set) and `decoy` in a `.dev.vars` that exists only during the build. */
function build(out, { shell, decoy }) {
  writeFileSync(devVars, `PORTAL_ENABLED=${decoy}\n`);
  try {
    // CLOUDFLARE_ENV is removed: this is the production-shaped build, not the staging one
    const env = { ...process.env, CI: '1', NO_COLOR: '1' };
    delete env.CLOUDFLARE_ENV;
    delete env.PORTAL_ENABLED;
    if (shell !== undefined) env.PORTAL_ENABLED = shell;
    const res = spawnSync(path.join(webRoot, 'node_modules/.bin/astro'), ['build', '--outDir', out], { cwd: webRoot, env, encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`astro build failed (exit ${res.status}):\n${(res.stdout + res.stderr).slice(-2500)}`);
    return res.stdout + res.stderr;
  } finally {
    rmSync(devVars, { force: true });
  }
  // (the Cloudflare Vite plugin copies .dev.vars into the build output, where `wrangler dev` of that build would load it; the caller removes that copy)
}

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const htmlOf = (client, file) => readFileSync(path.join(client, file === '/' ? 'index.html' : `${file.slice(1)}.html`), 'utf8');

const outA = mkdtempSync(path.join(tmpdir(), 'sakem-portal-build-a-'));
const outB = mkdtempSync(path.join(tmpdir(), 'sakem-portal-build-b-'));
let exitCode = 1;
try {
  console.log('assets (warm: the generated images are reused)...');
  run('node', ['scripts/sync-assets.mjs']);
  run('node', ['scripts/build-assets.mjs']);

  console.log('build A: PORTAL_ENABLED=true in the shell, decoy .dev.vars with false...');
  const logA = build(outA, { shell: 'true', decoy: 'false' });
  rmSync(path.join(outA, 'server/.dev.vars'), { force: true });
  console.log('build B: an invalid value in the shell, decoy .dev.vars with true...');
  const logB = build(outB, { shell: INVALID, decoy: 'true' });
  rmSync(path.join(outB, 'server/.dev.vars'), { force: true });

  const clientA = path.join(outA, 'client');
  const clientB = path.join(outB, 'client');
  const configA = path.join(outA, 'server/wrangler.json');
  const configB = path.join(outB, 'server/wrangler.json');

  await check('both builds prerendered the six pages', () => {
    for (const client of [clientA, clientB]) {
      assert.deepEqual(walk(client).filter((f) => f.endsWith('.html')).map((f) => path.relative(client, f)).sort(), ['donasi.html', 'gabung-siswa.html', 'index.html', 'program/pasca-pembinaan.html', 'program/pembinaan.html', 'program/prapembinaan.html']);
    }
  });

  await check('1. build A (shell true, decoy false): every prerendered page is ON: Masuk twice, one inline session script', () => {
    // (stateOf also proves the session script is inline: its address is in the page exactly once, inside a <script type="module"> with code in it)
    for (const p of PRERENDERED) assert.equal(stateOf(htmlOf(clientA, p)), 'on', p);
  });

  await check('2. the deployed config of build A has no PORTAL_ENABLED var, and the decoy is in no page', () => {
    const config = readFileSync(configA, 'utf8');
    assert.deepEqual(JSON.parse(config).vars, {});
    assert.ok(!config.includes('PORTAL_ENABLED'));
  });

  await check('3. build A with the Worker variable true as well (the deploy of Phase B): the pages the Worker renders and the prerendered ones are ON together', async () => {
    const s = await startStack({ wranglerConfig: configA, port: 8831, stubPort: 4451, fixturePort: 4452, inspectorPort: 9371, vars: { PORTAL_ENABLED: 'true' } });
    try {
      for (const p of [...PRERENDERED, ...RENDERED]) {
        const res = await fetch(`${s.base}${p}`, { redirect: 'manual' });
        assert.equal(stateOf(await res.text()), 'on', p);
        assert.equal(res.headers.get('set-cookie'), null, p);
      }
      assert.equal((await fetch(`${s.base}/no-such-page`)).status, 404);
    } finally {
      await s.stop();
    }
  });

  await check('4. build A with the build variable only, or with the Worker variable false: the prerendered pages stay ON and the pages the Worker renders are OFF (no fallback to the build)', async () => {
    for (const [vars, port] of [[{}, 8832], [{ PORTAL_ENABLED: 'false' }, 8833]]) {
      const s = await startStack({ wranglerConfig: configA, port, stubPort: port - 8832 + 4453, fixturePort: port - 8832 + 4454, inspectorPort: port - 8832 + 9373, vars });
      try {
        for (const p of PRERENDERED) assert.equal(stateOf(await (await fetch(`${s.base}${p}`, { redirect: 'manual' })).text()), 'on', `${JSON.stringify(vars)} ${p}`);
        for (const p of RENDERED) assert.equal(stateOf(await (await fetch(`${s.base}${p}`, { redirect: 'manual' })).text()), 'off', `${JSON.stringify(vars)} ${p}`);
        assert.doesNotMatch(s.output(), /portal: PORTAL_ENABLED/, 'unset and false are silent');
      } finally {
        await s.stop();
      }
    }
  });

  await check('5. build B (an invalid value in the shell, decoy true): the build says so once, in fixed words and without the value, and every prerendered page is OFF', () => {
    const line = 'PORTAL_ENABLED is set but is neither "true" nor "false": the prerendered pages are built with the portal off';
    assert.equal(logB.split(line).length - 1, 1, 'one warning');
    assert.ok(!logB.includes(INVALID), 'the value is not repeated');
    assert.ok(!logA.includes('neither "true" nor "false"'), 'a valid value is silent');
    for (const p of PRERENDERED) assert.equal(stateOf(htmlOf(clientB, p)), 'off', p);
  });

  await check('6. build B: the deployed config has no var, and a stack with no Worker variable is OFF on both kinds of page (the decoy file switched nothing on)', async () => {
    const config = readFileSync(configB, 'utf8');
    assert.deepEqual(JSON.parse(config).vars, {});
    const s = await startStack({ wranglerConfig: configB, port: 8834, stubPort: 4455, fixturePort: 4456, inspectorPort: 9375 });
    try {
      for (const p of [...PRERENDERED, ...RENDERED]) assert.equal(stateOf(await (await fetch(`${s.base}${p}`, { redirect: 'manual' })).text()), 'off', p);
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
  rmSync(outA, { recursive: true, force: true });
  rmSync(outB, { recursive: true, force: true });
}
process.exit(exitCode);
