// Starts the local test stack used by scripts/e2e.mjs and scripts/measure.mjs:
//   - the stub legacy origin   (scripts/stub-origin.mjs)
//   - the fixture content API  (scripts/fixture-api.mjs)
//   - `wrangler dev` in LOCAL mode on the built output (dist/server/wrangler.json)
//
// Nothing here talks to Cloudflare: wrangler runs workerd locally, metrics are
// off, and no account, login or remote binding is involved.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStubOrigin } from '../stub-origin.mjs';
import { startFixtureApi } from '../fixture-api.mjs';

export const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const distServer = path.join(webRoot, 'dist/server');

/**
 * @param {{ wranglerConfig?: string, port?: number, stubPort?: number, fixturePort?: number,
 *           inspectorPort?: number, vars?: Record<string,string>, log?: string }} [opts]
 */
export async function startStack(opts = {}) {
  const {
    wranglerConfig = path.join(distServer, 'wrangler.json'),
    port = 8791,
    stubPort = 4390,
    fixturePort = 4391,
    inspectorPort = 9331,
    vars = {},
    log,
  } = opts;

  const stub = await startStubOrigin({ port: stubPort });
  const fixture = await startFixtureApi({ port: fixturePort });
  const persist = mkdtempSync(path.join(tmpdir(), 'sakem-wrangler-'));

  const args = [
    'dev',
    '-c', wranglerConfig,
    '--port', String(port),
    '--inspector-port', String(inspectorPort),
    '--persist-to', persist,
    '--var', `LEGACY_ORIGIN_URL:http://127.0.0.1:${stubPort}`,
    '--var', `CONTENT_API_URL:http://127.0.0.1:${fixturePort}`,
    ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`]),
  ];
  const child = spawn(path.join(webRoot, 'node_modules/.bin/wrangler'), args, {
    cwd: webRoot,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = log ? createWriteStream(log) : null;
  let output = '';
  const onData = (d) => {
    output += d;
    out?.write(d);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (exited) throw new Error(`wrangler dev exited early:\n${output.slice(-2000)}`);
    try {
      const res = await fetch(`${base}/robots.txt`);
      if (res.status === 200) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`wrangler dev did not start:\n${output.slice(-2000)}`);
    await new Promise((r) => setTimeout(r, 250));
  }

  async function stop() {
    child.kill('SIGTERM');
    await new Promise((r) => {
      if (exited) return r();
      child.once('exit', r);
      setTimeout(r, 5000);
    });
    out?.end();
    await stub.close();
    await fixture.close();
    rmSync(persist, { recursive: true, force: true });
  }

  return { base, stub, fixture, stop, output: () => output };
}

/**
 * wrangler config for the prerender experiment: same build, but the Worker entry
 * is wrapped so every invocation is counted. Written next to the built entry,
 * inside dist/ (gitignored).
 */
export function writeCountingConfig() {
  const entry = `import astro from './entry.mjs';
let hits = 0;
const seen = [];
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/__worker-hits') return Response.json({ hits, seen });
    hits++;
    seen.push(request.method + ' ' + url.pathname);
    const res = await astro.fetch(request, env, ctx);
    const out = new Response(res.body, res);
    out.headers.set('x-worker-hit', String(hits));
    return out;
  },
};
`;
  writeFileSync(path.join(distServer, 'counting-entry.mjs'), entry);
  const config = JSON.parse(readFileSync(path.join(distServer, 'wrangler.json'), 'utf8'));
  config.main = 'counting-entry.mjs';
  const file = path.join(distServer, 'wrangler.count.json');
  writeFileSync(file, JSON.stringify(config));
  return file;
}
