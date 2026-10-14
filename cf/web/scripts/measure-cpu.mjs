// Local CPU comparison of the site Worker's pages, before and after a change (SAKEM-091).
//
//   pnpm build && pnpm measure:cpu                 the whole table (about 10 minutes)
//   pnpm measure:cpu -- --only blog,tim            only the scenarios whose name contains one of these words
//   pnpm measure:cpu -- --repeat 5                 fresh processes per scenario for the edge-like numbers (default 3; the median of them)
//   pnpm measure:cpu -- --compare-server DIR       measure another build in turns with this one, and print before > after
//   pnpm measure:cpu -- --dump DIR                 no timing: write every answer (body and headers) to DIR, to compare two builds byte for byte
//   pnpm measure:cpu -- --server .measure/baseline-server    measure another build (a copy of dist/server made earlier)
//   pnpm measure:cpu -- --cache hit                the production path: the API answers come from a warm Cache API
//   pnpm measure:cpu -- --page-cache 30            with PAGE_CACHE_SECONDS=30: the first request renders, the next ones are copies
//   pnpm measure:cpu -- --json out.json            also write the numbers (the default folder, .measure/, is ignored by the repository)
//
// It runs the BUILT Worker (dist/server/entry.mjs: Astro, the middleware, the pages, the components) in plain Node,
// with a stand-in for `cloudflare:workers`, a static-assets binding that finds nothing, and an `API` service binding
// that answers from a recording of the content API (scripts/fixture-api.mjs, scaled to school volume: 86 articles,
// 24 team members, 16 reports, 25 documents), so no I/O is involved. It times what the Worker's own JavaScript spends
// per request, the render included (Astro streams the body: the page is built while the body is read). No account,
// no network, no workerd: workerd freezes its timers during synchronous code, so a Worker cannot time itself.
//
// Two regimes, because a Worker on the Free plan is mostly cold JavaScript:
//
//   edge-like   a FRESH process per scenario with `node --jitless` (V8's interpreter only, no JIT), 12 requests: the
//               first one (lazy compilation of everything the route touches) and the median of requests 3 to 12. A
//               low-traffic Worker rarely runs a function often enough to be optimised, so how much JavaScript a
//               request runs at all is what this regime weighs.
//   warm        the normal Node JIT, 50 warm-up requests, then 300 measured: the floor, what a busy isolate reaches.
//
// The absolute numbers are this machine's, not Cloudflare's. The RELATIVE change between two runs on the same
// machine is the result (the numbers of the PR that added this script are in docs/cloudflare/free-plan-audit.md).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const measureDir = path.join(webRoot, '.measure');
const cassetteFile = path.join(measureDir, 'api-cassette.json');

const SLUGS = {
  article1: 'macam-macam-gaya-belajar-dan-cara-mengoptimalkannya',
  article2: 'mau-masuk-ptn-ini-tips-persiapan-kuliah-negeri-anti-gagal',
  article3: 'daffa-najwan',
};

/** The routes the staging probe of 2026-10-14 hit, with the Worker's answer expected. */
export const SCENARIOS = [
  { name: 'blog', path: '/blog', status: 200 },
  { name: 'blog-page2', path: '/blog?page=2', status: 200 },
  { name: 'article-1', path: `/blog/${SLUGS.article1}`, status: 200 },
  { name: 'article-2', path: `/blog/${SLUGS.article2}`, status: 200 },
  { name: 'article-3', path: `/blog/${SLUGS.article3}`, status: 200 },
  { name: 'tim', path: '/tim', status: 200 },
  { name: 'laporan', path: '/laporan', status: 200 },
  { name: 'docs', path: '/gabung-siswa/docs', status: 200 },
  { name: 'kontak', path: '/kontak', status: 200 },
  { name: 'sitemap', path: '/sitemap.xml', status: 200 },
  { name: 'shortlink-miss', path: '/measure-unknown-slug', status: 404 },
  { name: 'page-404', path: '/no/such/page', status: 404 },
  { name: 'portal-session-404', path: '/portal/api/auth/get-session', status: 404 },
  { name: 'announcements-404', path: '/api/announcements/current', status: 404 },
  { name: 'redirect-admin', path: '/admin', status: 308 },
];

// ------------------------------------------------------------------------------------------------ the recording

async function record() {
  mkdirSync(measureDir, { recursive: true });
  const { startFixtureApi } = await import('./fixture-api.mjs');
  const port = 4391 + 7000 + Number(process.env.E2E_PORT_OFFSET ?? 0);
  const fixture = await startFixtureApi({ port });
  const base = `http://127.0.0.1:${port}`;
  const cassette = {};
  const get = async (p) => {
    const res = await fetch(base + p);
    return { status: res.status, body: await res.text() };
  };
  try {
    for (const p of [
      '/api/public/blog?page=1&pageSize=15',
      '/api/public/blog?page=2&pageSize=15',
      '/api/public/blog?page=1&pageSize=50',
      '/api/public/blog?page=2&pageSize=50',
      ...Object.values(SLUGS).map((s) => `/api/public/blog/${s}`),
      '/api/public/shortlinks/measure-unknown-slug',
    ]) {
      cassette[p] = await get(p);
    }
    // The fixture has a handful of rows; the live site has more. Scale the three lists to school volume.
    const team = JSON.parse((await get('/api/public/team')).body).members;
    const categories = ['dewan_pembina', 'dewan_pengawas', 'pengurus'];
    const members = Array.from({ length: 24 }, (_, i) => ({
      ...team[i % team.length],
      id: `00000000-0000-4000-8000-0000000003${String(i).padStart(2, '0')}`,
      name: `Anggota Contoh ${i + 1}`,
      category: categories[Math.floor(i / 8)],
      displayOrder: (i % 8) + 1,
      bio: 'Biografi contoh untuk uji lokal. '.repeat(8),
      educationHistory: [{ institution: 'Universitas Contoh', degree: 'S1 Contoh', year: '2015' }],
      workHistory: [{ organization: 'Organisasi Contoh', role: 'Peran Contoh', period: '2018 - sekarang' }],
    }));
    cassette['/api/public/team'] = { status: 200, body: JSON.stringify({ members }) };
    const reports = JSON.parse((await get('/api/public/reports')).body).reports;
    cassette['/api/public/reports'] = {
      status: 200,
      body: JSON.stringify({ reports: Array.from({ length: 16 }, (_, i) => ({ ...reports[i % reports.length], id: `00000000-0000-4000-8000-0000000004${String(i).padStart(2, '0')}`, title: `Laporan Contoh ${i + 1}`, year: String(2025 - Math.floor(i / 4)) })) }),
    };
    const resources = JSON.parse((await get('/api/public/resources')).body).resources;
    cassette['/api/public/resources'] = {
      status: 200,
      body: JSON.stringify({ resources: Array.from({ length: 25 }, (_, i) => ({ ...resources[i % resources.length], id: `00000000-0000-4000-8000-0000000005${String(i).padStart(2, '0')}`, title: `${resources[i % resources.length].title} ${Math.floor(i / resources.length) + 1}` })) }),
    };
  } finally {
    await fixture.close();
  }
  writeFileSync(cassetteFile, JSON.stringify(cassette));
  const articles = JSON.parse(cassette['/api/public/blog?page=1&pageSize=50'].body);
  console.log(`recording: ${Object.keys(cassette).length} answers, ${articles.total + 1} articles, ${cassetteFile}`);
}

// ------------------------------------------------------------------------------------------------ the child

/** A Cache API in memory, like the real one on a custom domain: match gives a new Response each time. */
function memoryCache() {
  const store = new Map();
  return {
    async match(request) {
      const hit = store.get(typeof request === 'string' ? request : request.url);
      return hit ? new Response(hit.body, hit.init) : undefined;
    },
    async put(request, response) {
      store.set(typeof request === 'string' ? request : request.url, { body: await response.text(), init: { status: response.status, headers: [...response.headers] } });
    },
    async delete(request) {
      return store.delete(typeof request === 'string' ? request : request.url);
    },
  };
}

async function startProfile() {
  const { Session } = await import('node:inspector');
  const { writeFileSync } = await import('node:fs');
  const session = new Session();
  session.connect();
  const post = (method, params) => new Promise((resolve, reject) => session.post(method, params, (error, result) => (error ? reject(error) : resolve(result))));
  await post('Profiler.enable');
  await post('Profiler.setSamplingInterval', { interval: 100 });
  await post('Profiler.start');
  return {
    async stop(file) {
      const { profile } = await post('Profiler.stop');
      writeFileSync(file, JSON.stringify(profile));
    },
  };
}

async function child(name, regime, serverDir, cacheMode) {
  const scenario = SCENARIOS.find((s) => s.name === name);
  if (!scenario) throw new Error(`unknown scenario ${name}`);

  // Node's `Request` global starts compiling an HTTP client in WebAssembly in the background; `--jitless` has no
  // WebAssembly, so that promise rejects. Nothing here makes an HTTP call: ignore exactly that rejection.
  process.on('unhandledRejection', (reason) => {
    if (!(reason instanceof ReferenceError && /WebAssembly/.test(reason.message))) throw reason;
  });

  const cassette = JSON.parse(readFileSync(cassetteFile, 'utf8'));
  const pending = [];
  globalThis.__WAIT_UNTIL__ = (promise) => pending.push(promise.catch(() => undefined));
  const env = (globalThis.__WORKER_ENV__ ??= {});
  env.UPLOADS_BASE_URL = '';
  env.ADMIN_URL = 'https://admin.example.test';
  env.TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
  env.ASSETS = { fetch: async () => new Response('not found', { status: 404 }) };
  env.API = {
    async fetch(input) {
      const url = new URL(typeof input === 'string' ? input : input.url);
      const hit = cassette[url.pathname + url.search];
      if (!hit) return new Response('{"error":"not_found"}', { status: 404, headers: { 'content-type': 'application/json' } });
      return new Response(hit.body, { status: hit.status, headers: { 'content-type': 'application/json' } });
    },
  };
  // The console is part of what a Worker does per request, but its cost belongs to the runtime: keep it quiet.
  console.warn = () => {};
  // MEASURE_PAGE_CACHE=30: the page copy in memory is on (PAGE_CACHE_SECONDS); the first request renders and stores it.
  if (process.env.MEASURE_PAGE_CACHE) env.PAGE_CACHE_SECONDS = process.env.MEASURE_PAGE_CACHE;
  if (cacheMode === 'hit') globalThis.caches = { default: memoryCache() };

  const entry = pathToFileURL(path.resolve(webRoot, serverDir, 'entry.mjs')).href;
  const worker = (await import(entry)).default;
  const ctx = { waitUntil: (promise) => pending.push(promise.catch(() => undefined)), passThroughOnException() {}, props: {} };

  // What the runtime hands a Worker already built: touched once so Node's lazy loading is not charged to request 1.
  new Request('https://site.example.test/');
  new Response('x');
  new Headers();
  new TextEncoder().encode('x');
  AbortSignal.timeout(1000);

  const url = `https://site.example.test${scenario.path}`;
  const once = async () => {
    const request = new Request(url, { headers: { 'user-agent': 'measure-cpu', 'cf-connecting-ip': '203.0.113.7' }, redirect: 'manual' });
    const start = performance.now();
    const response = await worker.fetch(request, env, ctx);
    const body = await response.text();
    await Promise.all(pending.splice(0));
    const cpu = performance.now() - start;
    return { cpu, status: response.status, bytes: body.length, source: response.headers.get('x-blog-source'), body, headers: [...response.headers].sort() };
  };

  // MEASURE_WARMUP=/path: one request to another route first, not measured (what a warm-up at start-up would do).
  if (process.env.MEASURE_WARMUP) {
    const warmup = new Request(`https://site.example.test${process.env.MEASURE_WARMUP}`, { headers: { 'cf-connecting-ip': '203.0.113.7' } });
    await (await worker.fetch(warmup, env, ctx)).text();
    await Promise.all(pending.splice(0));
  }
  if (cacheMode === 'hit') await once(); // the first answer fills the cache; it is not measured
  const samples = [];
  let last;
  const count = Number(process.env.MEASURE_COUNT) || (regime === 'cold' ? 12 : 300);
  if (regime === 'warm') for (let i = 0; i < 50; i++) await once();
  // MEASURE_PROFILE=file.cpuprofile: a V8 CPU profile of the measured requests only (not of the start-up).
  const profile = process.env.MEASURE_PROFILE ? await startProfile() : null;
  for (let i = 0; i < count; i++) {
    last = await once();
    samples.push(last.cpu);
  }
  if (profile) await profile.stop(process.env.MEASURE_PROFILE);
  if (last.status !== scenario.status) throw new Error(`${name}: expected ${scenario.status}, got ${last.status}`);
  // MEASURE_DUMP=dir: the last answer (body and headers), so two builds can be compared byte for byte.
  if (process.env.MEASURE_DUMP) {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(process.env.MEASURE_DUMP, { recursive: true });
    writeFileSync(path.join(process.env.MEASURE_DUMP, `${name}.body`), last.body);
    writeFileSync(path.join(process.env.MEASURE_DUMP, `${name}.headers`), last.headers.map(([k, v]) => `${k}: ${v}`).join('\n') + '\n');
  }
  process.stdout.write(`\n@@RESULT@@${JSON.stringify({ scenario: name, regime, status: last.status, bytes: last.bytes, source: last.source, samples })}\n`);
}

// ------------------------------------------------------------------------------------------------ the parent

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const fmt = (n) => (n === undefined ? ''.padStart(7) : n.toFixed(2).padStart(7));

function runChild(name, regime, serverDir, cacheMode) {
  const nodeArgs = [
    ...(regime === 'cold' ? ['--jitless'] : []),
    '--no-warnings',
    '--import',
    './scripts/lib/register-node-worker.mjs',
    'scripts/measure-cpu.mjs',
    '--child',
    name,
    regime,
    serverDir,
    cacheMode,
  ];
  const run = spawnSync(process.execPath, nodeArgs, { cwd: webRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60_000 });
  const marker = run.stdout.split('@@RESULT@@')[1];
  if (!marker) throw new Error(`${name} (${regime}) failed:\n${run.stdout.slice(-1500)}\n${run.stderr.slice(-2500)}`);
  return JSON.parse(marker);
}

async function main(argv) {
  const childAt = argv.indexOf('--child');
  if (childAt >= 0) return child(argv[childAt + 1], argv[childAt + 2], argv[childAt + 3], argv[childAt + 4]);

  const option = (flag, fallback) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback);
  const serverDir = option('--server', 'dist/server');
  const cacheMode = option('--cache', 'none');
  if (option('--page-cache', '')) process.env.MEASURE_PAGE_CACHE = option('--page-cache');
  if (!existsSync(path.join(webRoot, serverDir, 'entry.mjs'))) {
    console.error(`${serverDir}/entry.mjs is missing: run \`pnpm build\` first.`);
    process.exit(2);
  }
  if (argv.includes('--rebuild') || !existsSync(cassetteFile)) await record();

  const words = option('--only', '') ? option('--only', '').split(',') : [];
  const picked = SCENARIOS.filter((s) => words.length === 0 || words.some((w) => s.name.includes(w)));

  // --dump DIR: no timing, only the answer of every scenario (body and headers) written to DIR, so two builds can be
  // compared byte for byte (`diff -r dirA dirB`): the proof that a change did not touch the HTML or the headers.
  if (argv.includes('--dump')) {
    const dir = path.resolve(option('--dump'));
    for (const scenario of picked) {
      process.env.MEASURE_DUMP = dir;
      process.env.MEASURE_COUNT = '1';
      runChild(scenario.name, 'warm', serverDir, cacheMode);
    }
    console.log(`${picked.length} answers written to ${dir}`);
    return;
  }

  // --compare-server DIR: another build (a copy of dist/server made earlier) is measured with this one, process by
  // process in turns, so the load of the machine falls on both alike. The table shows "before > after".
  const otherServer = option('--compare-server', '');
  console.log(
    `build ${serverDir}${otherServer ? ` (after) against ${otherServer} (before)` : ''}, Cache API: ${cacheMode === 'hit' ? 'warm (a custom zone)' : 'none (workers.dev)'}, page copy: ${process.env.MEASURE_PAGE_CACHE ? `${process.env.MEASURE_PAGE_CACHE} s` : 'off'}; ms of the Worker's own JavaScript per request, the render included${otherServer ? '; each cell is before > after' : ''}`,
  );
  const width = otherServer ? 16 : 7;
  const pair = (b, a) => (otherServer ? `${fmt(b)} >${fmt(a)}` : fmt(a));
  console.log(`${'scenario'.padEnd(20)} ${'status'.padEnd(6)} ${'bytes'.padStart(7)} | edge-like: ${'first'.padStart(width)} ${'p50'.padStart(width)} ${'max'.padStart(width)} | warm: ${'p50'.padStart(width)} ${'p95'.padStart(width)}`);
  const rows = [];
  // One fresh process is noisy (the first request above all): the edge-like numbers are the median of `--repeat`
  // fresh processes (default 3) for "first" and "p50", and the worst of them for "max".
  const repeat = Number(option('--repeat', '3'));
  const summarize = (colds, warm) => {
    const sorted = [...warm.samples].sort((a, b) => a - b);
    return {
      status: colds[0].status,
      bytes: colds[0].bytes,
      first: median(colds.map((run) => run.samples[0])),
      p50: median(colds.map((run) => median(run.samples.slice(2)))),
      max: Math.max(...colds.map((run) => Math.max(...run.samples.slice(2)))),
      warmP50: median(warm.samples),
      warmP95: sorted[Math.floor(sorted.length * 0.95)],
    };
  };
  for (const scenario of picked) {
    const before = [];
    const after = [];
    for (let i = 0; i < repeat; i++) {
      if (otherServer) before.push(runChild(scenario.name, 'cold', otherServer, cacheMode));
      after.push(runChild(scenario.name, 'cold', serverDir, cacheMode));
    }
    const beforeWarm = otherServer ? runChild(scenario.name, 'warm', otherServer, cacheMode) : null;
    const now = summarize(after, runChild(scenario.name, 'warm', serverDir, cacheMode));
    const old = otherServer ? summarize(before, beforeWarm) : null;
    console.log(
      `${scenario.name.padEnd(20)} ${String(now.status).padEnd(6)} ${String(now.bytes).padStart(7)} |            ${pair(old?.first, now.first)} ${pair(old?.p50, now.p50)} ${pair(old?.max, now.max)} |       ${pair(old?.warmP50, now.warmP50)} ${pair(old?.warmP95, now.warmP95)}`,
    );
    rows.push({ scenario: scenario.name, status: now.status, bytes: now.bytes, before: old, after: now });
  }
  const jsonAt = argv.indexOf('--json');
  if (jsonAt >= 0) {
    const out = path.resolve(argv[jsonAt + 1]);
    writeFileSync(out, JSON.stringify({ node: process.version, platform: `${process.platform}-${process.arch}`, server: serverDir, cache: cacheMode, rows }, null, 2));
    console.log(`written ${out}`);
  }
}

await main(process.argv.slice(2));
