// Measurements for the SAKEM-075 report. Needs `pnpm build` first.
//
//   node scripts/measure.mjs                      sizes, warm timings, prerender-vs-Worker proof
//   node scripts/measure.mjs --next http://127.0.0.1:3055   also the legacy Next home page (run
//                                                  `next start -p 3055` in the repo root first)
//
// Local numbers only: workerd on this machine, a stub origin on loopback. They
// prove behaviour and relative size, not Cloudflare CPU time (see the doc).

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { startStack, writeCountingConfig, webRoot } from './lib/harness.mjs';

const dist = path.join(webRoot, 'dist');
const gz = (buf) => gzipSync(buf, { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const out = {};

// ------------------------------------------------------------------ 1. sizes of what `/` loads
function pageWeight(htmlFile) {
  const html = readFileSync(htmlFile);
  const text = html.toString('utf8');
  const inline = [...text.matchAll(/<script(?![^>]*ld\+json)([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/\ssrc=/.test(m[1]));
  const inlineJs = Buffer.from(inline.map((m) => m[2]).join('\n'));
  // Script files count too (no page has one since the home page map left, SAKEM-111).
  const jsFiles = [...text.matchAll(/<script(?![^>]*ld\+json)[^>]*\ssrc="([^"]+)"/g)].map((m) => readFileSync(path.join(dist, 'client', m[1])));
  const css = [
    ...[...text.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => readFileSync(path.join(dist, 'client', m[1]))),
    ...[...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => Buffer.from(m[1])), // small sheets Astro inlines
  ];
  const fonts = [...text.matchAll(/<link rel="preload" href="([^"]+)" as="font"/g)].map((m) => readFileSync(path.join(dist, 'client', m[1])));
  const cssAll = Buffer.concat(css);
  return {
    html: { raw: html.length, gzip: gz(html) },
    js: {
      raw: inlineJs.length + jsFiles.reduce((n, f) => n + f.length, 0),
      gzip: gz(inlineJs) + jsFiles.reduce((n, f) => n + gz(f), 0),
      files: jsFiles.length,
      inlineScripts: inline.length,
    },
    css: { raw: cssAll.length, gzip: gz(cssAll) },
    preloadedFonts: { raw: fonts.reduce((n, f) => n + f.length, 0), files: fonts.length },
  };
}
out.astroHome = pageWeight(path.join(dist, 'client/index.html'));
// out.astroArticle is measured further down: the article is rendered by the Worker now, so there is no file in dist/.
{
  const hero = readFileSync(path.join(dist, 'client/index.html'), 'utf8').match(/srcset="([^"]+)"/)?.[1] ?? '';
  const mid = hero.split(', ')[1]?.split(' ')[0]; // the 800w candidate
  out.astroHeroImage800 = mid ? statSync(path.join(dist, 'client', mid)).size : null;
}

// ------------------------------------------------------------------ 2. Worker bundle
const modules = walk(path.join(dist, 'server')).filter((f) => f.endsWith('.mjs'));
out.worker = {
  modules: modules.length,
  raw: modules.reduce((n, f) => n + statSync(f).size, 0),
  gzipSum: modules.reduce((n, f) => n + gz(readFileSync(f)), 0),
  largest: modules
    .map((f) => [path.relative(path.join(dist, 'server'), f), statSync(f).size])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4),
};

// ------------------------------------------------------------------ 3. legacy Next home (optional)
const nextArg = process.argv.indexOf('--next');
if (nextArg > 0) {
  const base = process.argv[nextArg + 1];
  const res = await fetch(`${base}/`);
  const html = Buffer.from(await res.arrayBuffer());
  const text = html.toString('utf8');
  const srcs = new Set([
    ...[...text.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]),
    ...[...text.matchAll(/<link[^>]*rel="preload"[^>]*as="script"[^>]*href="([^"]+)"/g)].map((m) => m[1]),
  ]);
  const css = new Set([...text.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]));
  const fetchAll = async (set) => {
    const bufs = [];
    for (const u of set) bufs.push(Buffer.from(await (await fetch(new URL(u, base))).arrayBuffer()));
    return bufs;
  };
  const js = await fetchAll(srcs);
  const styles = await fetchAll(css);
  const inlineScripts = [...text.matchAll(/<script(?![^>]*\ssrc=)(?![^>]*ld\+json)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const inline = Buffer.from(inlineScripts.join('\n'));
  out.nextHome = {
    html: { raw: html.length, gzip: gz(html) },
    jsFiles: js.length,
    js: { raw: js.reduce((n, b) => n + b.length, 0), gzip: js.reduce((n, b) => n + gz(b), 0) },
    inlineJs: { raw: inline.length, gzip: gz(inline), scripts: inlineScripts.length },
    css: { raw: styles.reduce((n, b) => n + b.length, 0), gzip: styles.reduce((n, b) => n + gz(b), 0) },
  };
}

// ------------------------------------------------------------------ 4. warm timings (proxy only, not CPU)
const articleSlug = 'sejarah-sakola-kembara'; // one of the 80 migrated articles (content/blog)
const routes = [
  ['/ (prerendered)', '/'],
  ['/blog (SSR)', '/blog'],
  ['/blog?page=3 (SSR)', '/blog?page=3'],
  [`/blog/<slug> (SSR, API data from caches.default)`, `/blog/${articleSlug}`],
  ['/kontak (SSR)', '/kontak'],
  ['/sitemap.xml (SSR, 2 API pages from caches.default)', '/sitemap.xml'],
  ['/tim (SSR, cache hit)', '/tim'],
  ['404 (SSR render)', '/blog/does-not-exist'],
  ['redirect (/cerita/x/, _redirects)', '/cerita/some-slug/'],
  ['pass-through (/wp-content/uploads/..., stub origin)', '/wp-content/uploads/2099/01/a.jpg'],
  ['/api/* (JSON 404 of the middleware, M4)', '/api/auth/session'],
  ['/admin (308 to the admin host, M4)', '/admin/blog'],
  ['/robots.txt (static)', '/robots.txt'],
];
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return { median: s[Math.floor(s.length / 2)], p95: s[Math.floor(s.length * 0.95)], min: s[0] };
};
{
  const stack = await startStack({ port: 8796, stubPort: 4398, fixturePort: 4399, inspectorPort: 9336, vars: { ADMIN_URL: 'https://admin.example.test' } });
  out.timings = {};
  try {
    // The article is rendered by the Worker: fetch it and weigh it like the prerendered pages.
    mkdirSync(path.join(webRoot, '.measure'), { recursive: true });
    const articleFile = path.join(webRoot, '.measure/article.html');
    writeFileSync(articleFile, await (await fetch(`${stack.base}/blog/${articleSlug}`)).text());
    out.astroArticle = pageWeight(articleFile);
    for (const [name, p] of routes) {
      const N = 60;
      for (let i = 0; i < 5; i++) await (await fetch(stack.base + p, { redirect: 'manual' })).arrayBuffer(); // warm up
      const times = [];
      let status = 0;
      let bytes = 0;
      for (let i = 0; i < N; i++) {
        const t = performance.now();
        const res = await fetch(stack.base + p, { redirect: 'manual' });
        const body = await res.arrayBuffer();
        times.push(performance.now() - t);
        status = res.status;
        bytes = body.byteLength;
      }
      out.timings[name] = { status, bytes, ...stats(times) };
    }
  } finally {
    await stack.stop();
  }
}

// ------------------------------------------------------------------ 5. prerendered routes: Worker or assets layer?
{
  const stack = await startStack({ wranglerConfig: writeCountingConfig(), port: 8797, stubPort: 4400, fixturePort: 4401, inspectorPort: 9337 });
  out.invocation = [];
  try {
    const probes = [
      ['/', 'prerendered page'],
      [`/blog/${articleSlug}`, 'SSR article (API data)'],
      ['/robots.txt', 'prerendered endpoint'],
      ['/sitemap.xml', 'SSR endpoint (API data)'],
      ['/kontak', 'SSR page (contact form)'],
      ['/favicon.ico', 'public/ file'],
      ['/og-default.jpg', 'public/ file'],
      ['__css__', 'hashed asset (/_astro/*.css)'],
      ['__img__', 'hashed asset (/_astro/*.webp)'],
      ['/cerita/some-slug/', '_redirects rule (placeholder)'],
      ['/program', '_redirects rule (static)'],
      ['/wp-content/uploads/2025/10/1.png', '_redirects rule (one per mirrored upload)'],
      ['/blog', 'SSR page'],
      ['/tim', 'SSR page'],
      ['/blog/does-not-exist', 'unknown path -> 404'],
      ['/wp-content/uploads/2099/01/a.jpg', 'WordPress pass-through'],
      ['/wp-login.php', 'WordPress pass-through'],
      ['/donasi', 'not yet ported -> pass-through'],
      ['/no-such-link', 'shortlink candidate -> API lookup, 404'],
    ];
    const home = await (await fetch(`${stack.base}/`)).text(); // (this request is counted too)
    const css = home.match(/href="(\/_astro\/[^"]+\.css)"/)?.[1];
    const img = home.match(/src="(\/_astro\/[^"]+\.webp)"/)?.[1];
    for (const [p0, kind] of probes) {
      const p = p0 === '__css__' ? css : p0 === '__img__' ? img : p0;
      const before = (await (await fetch(`${stack.base}/__worker-hits`)).json()).hits;
      const res = await fetch(stack.base + p, { redirect: 'manual' });
      await res.arrayBuffer();
      const after = (await (await fetch(`${stack.base}/__worker-hits`)).json()).hits;
      const delta = after - before - 1; // minus the /__worker-hits call itself
      out.invocation.push({ path: p, kind, status: res.status, workerInvoked: delta > 0 || res.headers.has('x-worker-hit') });
    }
    out.invocationLog = (await (await fetch(`${stack.base}/__worker-hits`)).json()).seen;
  } finally {
    await stack.stop();
  }
}

mkdirSync(path.join(webRoot, '.measure'), { recursive: true });
writeFileSync(path.join(webRoot, '.measure/results.json'), JSON.stringify(out, null, 2));

// ------------------------------------------------------------------ report
const row = (...c) => `| ${c.join(' | ')} |`;
console.log('\n## Page weight');
console.log(row('', 'HTML raw', 'HTML gzip', 'JS raw', 'JS gzip', 'CSS raw', 'CSS gzip'));
console.log(row('---', '---', '---', '---', '---', '---', '---'));
const w = (n, p) => row(n, kb(p.html.raw), kb(p.html.gzip), kb(p.js.raw), kb(p.js.gzip), kb(p.css.raw), kb(p.css.gzip));
console.log(w('Astro /', out.astroHome));
console.log(w('Astro /blog/<slug>', out.astroArticle));
if (out.nextHome) {
  const n = out.nextHome;
  console.log(row('Next /', kb(n.html.raw), kb(n.html.gzip), `${kb(n.js.raw)} (+${kb(n.inlineJs.raw)} inline)`, `${kb(n.js.gzip)} (+${kb(n.inlineJs.gzip)})`, kb(n.css.raw), kb(n.css.gzip)));
  console.log(`(Next: ${n.jsFiles} script files, ${n.inlineJs.scripts} inline scripts)`);
}
console.log(`\nPreloaded fonts on /: ${out.astroHome.preloadedFonts.files} files, ${kb(out.astroHome.preloadedFonts.raw)}; hero image (800w webp): ${out.astroHeroImage800 ? kb(out.astroHeroImage800) : 'n/a'}`);

console.log('\n## Worker bundle');
console.log(`${out.worker.modules} modules, raw ${kb(out.worker.raw)}, gzip (sum of files) ${kb(out.worker.gzipSum)}`);
for (const [f, s] of out.worker.largest) console.log(`  ${f}  ${kb(s)}`);

console.log('\n## Warm response time (client wall clock through wrangler dev, N=60, ms; NOT CPU time)');
console.log(row('route', 'status', 'bytes', 'median', 'p95', 'min'));
console.log(row('---', '---', '---', '---', '---', '---'));
for (const [name, t] of Object.entries(out.timings)) console.log(row(name, t.status, t.bytes, t.median.toFixed(1), t.p95.toFixed(1), t.min.toFixed(1)));

console.log('\n## Does the Worker run? (wrangler dev local mode, entry wrapped with a counter)');
console.log(row('request', 'kind', 'status', 'Worker invoked'));
console.log(row('---', '---', '---', '---'));
for (const r of out.invocation) console.log(row(r.path.length > 48 ? `${r.path.slice(0, 45)}...` : r.path, r.kind, r.status, r.workerInvoked ? 'YES' : 'no'));
