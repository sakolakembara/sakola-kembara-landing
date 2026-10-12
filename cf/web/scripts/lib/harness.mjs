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

/**
 * Added to every port the stack uses (the Worker, the stub origin, the fixture API, the inspector), so two
 * runs on one machine do not collide: `E2E_PORT_OFFSET=1000 pnpm test:e2e`. Default 0.
 */
export const PORT_OFFSET = Number(process.env.E2E_PORT_OFFSET ?? 0);
export const distServer = path.join(webRoot, 'dist/server');

/**
 * Cloudflare's published always-pass TEST site key (works on any host, needs no account): what the stack
 * gives the form's widget, like dev.vars.example. The tests never load Cloudflare's script (there is no
 * browser here, and the DOM runs of scripts/e2e.mjs strip every <script> tag and evaluate the page's own
 * inline scripts next to a stand-in `window.turnstile`, scripts/lib/turnstile-stub.mjs).
 */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';

/** The probe Worker that stands in for the API Worker behind the service binding (scripts/lib/probe-api-worker.mjs). */
const probeEntry = path.join(webRoot, 'scripts/lib/probe-api-worker.mjs');

/**
 * @param {{ wranglerConfig?: string, port?: number, stubPort?: number, fixturePort?: number,
 *           inspectorPort?: number, vars?: Record<string,string>, log?: string,
 *           binding?: boolean, turnstileSiteKey?: string | null }} [opts]
 *   binding: how the content API is reached. false (default): CONTENT_API_URL and CONTACT_API_URL point at
 *     the fixture (a local run, CI), and win over the binding. true: neither is set, so the built Worker
 *     must use its `API` service binding, which a second Worker named like the config's `services` entry
 *     (`sakem-admin`) answers on its `PublicApi` entrypoint by forwarding to the fixture.
 *   turnstileSiteKey: the TURNSTILE_SITE_KEY var (default: the test key); null leaves it unset.
 */
export async function startStack(opts = {}) {
  const {
    wranglerConfig = path.join(distServer, 'wrangler.json'),
    vars = {},
    log,
    binding = false,
    turnstileSiteKey = TURNSTILE_TEST_SITE_KEY,
  } = opts;
  const port = (opts.port ?? 8791) + PORT_OFFSET;
  const stubPort = (opts.stubPort ?? 4390) + PORT_OFFSET;
  const fixturePort = (opts.fixturePort ?? 4391) + PORT_OFFSET;
  const inspectorPort = (opts.inspectorPort ?? 9331) + PORT_OFFSET;

  const stub = await startStubOrigin({ port: stubPort });
  const fixture = await startFixtureApi({ port: fixturePort });
  const persist = mkdtempSync(path.join(tmpdir(), 'sakem-wrangler-'));

  // The probe Worker's own config: the name and entrypoint the web Worker's `services` entry asks for.
  let probeConfig = null;
  if (binding) {
    const web = JSON.parse(readFileSync(wranglerConfig, 'utf8'));
    const service = web.services?.find((s) => s.binding === 'API');
    if (!service) throw new Error(`${wranglerConfig} has no \`API\` service binding`);
    probeConfig = path.join(persist, 'probe-api.wrangler.json');
    writeFileSync(
      probeConfig,
      JSON.stringify({
        name: service.service,
        main: probeEntry,
        compatibility_date: web.compatibility_date,
        vars: { FIXTURE_URL: `http://127.0.0.1:${fixturePort}` },
      }),
    );
  }

  const args = [
    'dev',
    '-c', wranglerConfig,
    ...(probeConfig ? ['-c', probeConfig] : []),
    '--port', String(port),
    '--inspector-port', String(inspectorPort),
    '--persist-to', persist,
    '--var', `LEGACY_ORIGIN_URL:http://127.0.0.1:${stubPort}`,
    ...(binding
      ? []
      : ['--var', `CONTENT_API_URL:http://127.0.0.1:${fixturePort}`, '--var', `CONTACT_API_URL:http://127.0.0.1:${fixturePort}`]),
    ...(turnstileSiteKey ? ['--var', `TURNSTILE_SITE_KEY:${turnstileSiteKey}`] : []),
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
