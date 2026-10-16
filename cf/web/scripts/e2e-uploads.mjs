// End-to-end check of UPLOADS_BASE_URL (src/lib/uploads.ts) against the BUILT Worker under `wrangler dev`
// (local mode), with the fixture content API behind a small proxy that makes some of its paths admin
// uploads (`/uploads/...`), the way the real API returns them once the admin has uploaded something.
//
//   pnpm build && pnpm test:e2e:uploads         (E2E_PORT_OFFSET=1700 for a second stack on one machine)
//
// Two runs of the same pages:
//   1. UPLOADS_BASE_URL set    upload paths get the base in front on /tim, /donasi (its Laporan section), /gabung-siswa/docs,
//                              /blog and /blog/<slug> (cover, og:image, JSON-LD, the images and links inside
//                              the article); legacy static paths, data- attributes and text in code blocks do not
//   2. UPLOADS_BASE_URL unset  every path is exactly what the API sent, and the base appears nowhere
//
// It is its own file so `pnpm test:e2e` (scripts/e2e.mjs) keeps its fixture and counts unchanged. Nothing here
// talks to Cloudflare.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { PORT_OFFSET, startStack, webRoot } from './lib/harness.mjs';

if (!existsSync(path.join(webRoot, 'dist/server/wrangler.json'))) {
  console.error('dist/ is missing. Run `pnpm build` first.');
  process.exit(2);
}

const BASE = 'https://files.example.org';
const ID = '0b9d8f7e-1234-4abc-9def-0123456789ab';
const up = (kind, name) => `/uploads/${kind}/2026/${ID}-${name}`;
const PATHS = {
  team: up('team-photo', 'foto-anggota.jpg'),
  report: up('report', 'laporan-baru.pdf'),
  resource: up('resource', 'panduan-baru.pdf'),
  cover: up('blog-image', 'sampul.webp'),
  inline: up('blog-image', 'di-dalam-artikel.png'),
  pdf: up('report', 'unduhan-artikel.pdf'),
  related: up('blog-image', 'terkait.jpg'),
};

/** What the article's HTML gets on top of what the fixture renders. */
const INJECTED_HTML = [
  `<p>Satu gambar: <img src="${PATHS.inline}" alt="Di dalam" width="800" height="600" class="rounded-xl" loading="lazy"></p>`,
  `<p>Dengan srcset: <img src="${PATHS.inline}" srcset="${PATHS.inline} 1x, ${PATHS.inline} 2x" alt="Dua"></p>`,
  `<p>Unduh <a href="${PATHS.pdf}" target="_blank" rel="noopener noreferrer">PDF-nya</a>, atau <a href="/blog/images/2025/10/1.png">gambar lama</a>.</p>`,
  `<p><img data-src="${PATHS.inline}" src="/blog/images/2025/10/1.png" alt="Lama"></p>`,
  `<pre><code>&lt;img src="${PATHS.inline}" alt="contoh"&gt;</code></pre>`,
  `<p>Tulis <code>src="${PATHS.inline}"</code> untuk gambar.</p>`,
].join('\n');

/** The fixture API with some paths turned into upload paths. Everything else passes through untouched. */
function startUploadsProxy(target) {
  const server = createServer(async (req, res) => {
    const upstream = await fetch(`${target}${req.url}`, { method: req.method, headers: { accept: 'application/json' } });
    const type = upstream.headers.get('content-type') ?? '';
    const body = await upstream.text();
    const url = new URL(req.url, 'http://x');
    let out = body;
    if (upstream.ok && type.includes('json')) {
      const data = JSON.parse(body);
      if (url.pathname === '/api/public/team') {
        const member = data.members.find((m) => m.id.endsWith('4'));
        member.image = PATHS.team;
      } else if (url.pathname === '/api/public/reports') {
        data.reports[0].filePath = PATHS.report;
      } else if (url.pathname === '/api/public/resources') {
        data.resources[0].filePath = PATHS.resource;
      } else if (url.pathname === '/api/public/blog') {
        data.featured.image = PATHS.cover;
        data.featured.imageWidth = 1600;
        data.featured.imageHeight = 900;
        if (data.articles[0]) data.articles[0].image = PATHS.related;
      } else if (url.pathname.startsWith('/api/public/blog/')) {
        data.article.image = PATHS.cover;
        data.article.imageWidth = 1600;
        data.article.imageHeight = 900;
        data.article.contentHtml += `\n${INJECTED_HTML}`;
        if (data.related[0]) data.related[0].image = PATHS.related;
      }
      out = JSON.stringify(data);
    }
    res.writeHead(upstream.status, { 'content-type': type });
    res.end(out);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => new Promise((r) => server.close(r)) })));
}

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

const count = (haystack, needle) => haystack.split(needle).length - 1;

/** Runs one stack and returns the five pages' HTML. */
async function render({ ports, vars }) {
  const proxy = await startUploadsProxy(`http://127.0.0.1:${ports.fixturePort + PORT_OFFSET}`);
  const stack = await startStack({
    ...ports,
    vars: { CONTENT_API_URL: `http://127.0.0.1:${proxy.port}`, CONTENT_CACHE_FRESH_SECONDS: '1', TEAM_CACHE_FRESH_SECONDS: '1', ...vars },
  });
  try {
    const fixtureBase = `http://127.0.0.1:${stack.fixture.port}`;
    const list = await (await fetch(`${fixtureBase}/api/public/blog?page=1&pageSize=15`)).json();
    const slug = list.featured.slug;
    const get = async (p) => {
      const res = await fetch(stack.base + p);
      assert.equal(res.status, 200, `${p} answered ${res.status}`);
      return res.text();
    };
    return {
      tim: await get('/tim'),
      donasi: await get('/donasi'),
      docs: await get('/gabung-siswa/docs'),
      blog: await get('/blog'),
      article: await get(`/blog/${slug}`),
    };
  } finally {
    await stack.stop();
    await proxy.close();
  }
}

// ── 1. with a base ───────────────────────────────────────────────────────────
const withBase = await render({ ports: { port: 8821, stubPort: 4421, fixturePort: 4422, inspectorPort: 9351 }, vars: { UPLOADS_BASE_URL: `${BASE}/` } });

check('with a base: /tim puts the base before the uploaded photo, in the card and in the profile', () => {
  assert.equal(count(withBase.tim, `src="${BASE}${PATHS.team}"`), 2);
  assert.equal(count(withBase.tim, `src="${PATHS.team}"`), 0);
});
check('with a base: /tim leaves a legacy static photo path alone', () => {
  assert.ok(withBase.tim.includes('src="/images/team/contoh.jpg"'));
  assert.ok(!withBase.tim.includes(`${BASE}/images/team/`));
});
check('with a base: /donasi links the uploaded PDF on the files domain and keeps the legacy links', () => {
  assert.equal(count(withBase.donasi, `href="${BASE}${PATHS.report}"`), 1);
  assert.ok(withBase.donasi.includes('href="/reports/2025-2026/financial/laporan-keuangan-semester-1-contoh.pdf"'));
});
check('with a base: /gabung-siswa/docs links the uploaded file on the files domain and keeps the legacy ones', () => {
  assert.equal(count(withBase.docs, `href="${BASE}${PATHS.resource}"`), 1);
  assert.ok(withBase.docs.includes('href="/resources/template-surat-izin-contoh.docx"'));
  assert.ok(withBase.docs.includes('href="https://example.org/twibbon-contoh"'));
});
check('with a base: /blog covers (featured and a card) come from the files domain', () => {
  assert.ok(withBase.blog.includes(`src="${BASE}${PATHS.cover}"`));
  assert.ok(withBase.blog.includes(`src="${BASE}${PATHS.related}"`));
  assert.ok(!withBase.blog.includes(`src="${PATHS.cover}"`));
});
check('with a base: the article cover, og:image and JSON-LD use the files domain', () => {
  assert.ok(withBase.article.includes(`src="${BASE}${PATHS.cover}"`));
  assert.ok(withBase.article.includes(`<meta property="og:image" content="${BASE}${PATHS.cover}"`));
  const jsonLd = [...withBase.article.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(jsonLd.some((block) => block.includes(`${BASE}${PATHS.cover}`)), 'no JSON-LD block carries the cover on the files domain');
});
check('with a base: images and links inside the article are rewritten, srcset included', () => {
  const html = withBase.article;
  assert.ok(html.includes(`<img src="${BASE}${PATHS.inline}" alt="Di dalam" width="800" height="600" class="rounded-xl" loading="lazy">`));
  assert.ok(html.includes(`srcset="${BASE}${PATHS.inline} 1x, ${BASE}${PATHS.inline} 2x"`));
  assert.ok(html.includes(`href="${BASE}${PATHS.pdf}" target="_blank" rel="noopener noreferrer"`));
});
check('with a base: what must not change inside the article does not (legacy paths, data- attributes, code, text)', () => {
  const html = withBase.article;
  assert.ok(html.includes('href="/blog/images/2025/10/1.png"'));
  assert.ok(html.includes(`data-src="${PATHS.inline}"`));
  assert.ok(html.includes(`&lt;img src="${PATHS.inline}" alt="contoh"&gt;`));
  assert.ok(html.includes(`<code>src="${PATHS.inline}"</code>`));
  assert.equal(count(html, `${BASE}${BASE}`), 0);
});

// ── 2. without a base ────────────────────────────────────────────────────────
const without = await render({ ports: { port: 8822, stubPort: 4423, fixturePort: 4424, inspectorPort: 9352 }, vars: {} });

check('without a base: every upload path is what the API sent (same-origin), on all five pages', () => {
  assert.equal(count(without.tim, `src="${PATHS.team}"`), 2);
  assert.equal(count(without.donasi, `href="${PATHS.report}"`), 1);
  assert.equal(count(without.docs, `href="${PATHS.resource}"`), 1);
  assert.ok(without.blog.includes(`src="${PATHS.cover}"`));
  assert.ok(without.article.includes(`src="${PATHS.cover}"`));
  assert.ok(without.article.includes(`<img src="${PATHS.inline}" alt="Di dalam" width="800" height="600" class="rounded-xl" loading="lazy">`));
  assert.ok(without.article.includes(`href="${PATHS.pdf}" target="_blank" rel="noopener noreferrer"`));
});
check('without a base: the files domain appears nowhere', () => {
  for (const [page, html] of Object.entries(without)) assert.ok(!html.includes('files.example.org'), `${page} mentions the files domain`);
});
check('without a base: the article HTML is the API HTML byte for byte (the injected block is in it unchanged)', () => {
  assert.ok(without.article.includes(INJECTED_HTML));
});

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.detail}`}`);
  if (!r.ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
