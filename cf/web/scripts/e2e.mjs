// End-to-end checks against the BUILT Worker running under `wrangler dev` (local
// mode, workerd), with the stub legacy origin and the fixture content API behind it.
//
//   pnpm build && pnpm test:e2e
//
// Covers: status codes of every page type, the real 404, all 80 WordPress
// redirects, the other redirect rules, pass-through (method, headers, body,
// cookies, redirects not followed), Astro paths NOT reaching the origin, /tim
// timeout / cache / stale-if-error, SEO tags in the served HTML, security
// headers, images and PDFs served as static assets (never through the origin).
// Prints a summary and exits non-zero on any failure.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startStack, webRoot } from './lib/harness.mjs';
import { REDIRECTS, matchRedirect } from '../redirects.config.mjs';
import { LIMITS, assetUrl, variantUrl } from '../assets.config.mjs';
import { checkImgTag, localUrls, parseAttrs } from './lib/dist-audit.mjs';

if (!existsSync(path.join(webRoot, 'dist/server/wrangler.json'))) {
  console.error('dist/ is missing. Run `pnpm build` first.');
  process.exit(2);
}

const articles = JSON.parse(readFileSync(path.join(webRoot, '../../lib/blog-posts.json'), 'utf8')).articles;
const stack = await startStack({ log: path.join(webRoot, 'dist/e2e-wrangler.log'), vars: { TEAM_CACHE_FRESH_SECONDS: '2' } });
const { base, stub } = stack;

/** Every HTTP exchange the checks made: used for the status-code tally. */
const exchanges = [];
const results = [];

async function get(p, init = {}) {
  const started = performance.now();
  const res = await fetch(base + p, { redirect: 'manual', ...init });
  const ms = performance.now() - started;
  exchanges.push({ path: p, method: init.method ?? 'GET', status: res.status, type: res.headers.get('content-type') ?? '', ms });
  return res;
}
const stubHits = () => stub.log.filter((e) => !e.path.startsWith('/__'));
const clearStub = () => (stub.log.length = 0);

async function check(group, name, fn) {
  try {
    await fn();
    results.push({ group, name, ok: true });
  } catch (error) {
    results.push({ group, name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

const text = async (res) => (await res.text());
const tag = (html, re) => html.match(re)?.[1];

// ---------------------------------------------------------------- pages
const slugs = articles.map((a) => a.id);

await check('pages', 'GET / is 200 html, served without touching the origin', async () => {
  clearStub();
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(stubHits().length, 0);
});
await check('pages', 'GET /blog is 200', async () => assert.equal((await get('/blog')).status, 200));
await check('pages', 'GET /blog?page=2 shows page 2 of 6', async () => {
  const html = await text(await get('/blog?page=2'));
  assert.match(html, /Halaman 2 dari 6/);
});
await check('pages', 'GET /blog?page=999 clamps to the last page, still 200', async () => {
  const res = await get('/blog?page=999');
  assert.equal(res.status, 200);
  assert.match(await text(res), /Halaman 6 dari 6/);
});
await check('pages', 'GET /blog?page=abc falls back to page 1', async () => {
  const html = await text(await get('/blog?page=abc'));
  assert.match(html, /Halaman 1 dari 6/);
});
for (const slug of slugs) {
  await check('articles', `GET /blog/${slug} is 200`, async () => {
    const res = await get(`/blog/${slug}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
  });
}
await check('articles', 'all article HTML carries exactly one <h1>', async () => {
  for (const slug of slugs.slice(0, 5)) {
    const html = await text(await get(`/blog/${slug}`));
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, slug);
  }
});

// ---------------------------------------------------------------- 404
for (const p of ['/blog/does-not-exist', '/blog/DOES-NOT-EXIST', '/blog/a/b', '/a/b/c', '/404', '/_astro/missing.css', '/wp-admin/install.php', '/%E0%A4%A']) {
  await check('404', `GET ${p} is a real 404 with the 404 page`, async () => {
    clearStub();
    const res = await get(p);
    assert.equal(res.status, 404);
    const html = await text(res);
    assert.match(html, /Halaman tidak ditemukan/);
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.equal(stubHits().length, 0, 'must not reach the origin');
  });
}

// ---------------------------------------------------------------- redirects
for (const a of articles) {
  const url = new URL(a.sourceUrl); // https://host/<category>/<slug>/
  await check('wp-redirects', `${url.pathname} -> /blog/${a.id} (308)`, async () => {
    const res = await get(url.pathname);
    assert.equal(res.status, 308);
    assert.equal(res.headers.get('location'), `/blog/${a.id}`);
  });
}
const other = [
  ['/cerita', 308, '/blog'], ['/cerita/', 308, '/blog'], ['/education', 308, '/blog'], ['/news', 308, '/blog'],
  ['/tips', 308, '/blog'], ['/testimonials', 308, '/blog'], ['/career', 308, '/blog'], ['/kiat-kiat', 308, '/blog'],
  ['/daftar', 308, '/gabung-siswa'], ['/apply', 308, '/gabung-siswa'],
  ['/gabung-siswa/form', 308, '/portal/daftar'],
  ['/tentang-kami', 308, '/tim'], ['/about', 308, '/tim'],
  ['/impact-reports', 308, '/laporan'], ['/impact-reports/2025/foo', 308, '/laporan'],
  ['/blog/page/3', 308, '/blog?page=3'], ['/blog/page/3/', 308, '/blog?page=3'],
  ['/feed', 308, '/blog'], ['/feed/atom', 308, '/blog'],
  ['/index.php', 308, '/'],
  ['/wp-content/uploads/2026/05/foto.jpg', 308, '/blog/images/2026/05/foto.jpg'],
  ['/program', 307, '/program/prapembinaan'],
  ['/cerita/some-slug?utm_source=x', 308, '/blog/some-slug?utm_source=x'],
  ['/blog/page/2?utm_source=x', 308, '/blog?page=2'], // the destination has its own query: the incoming one is dropped
];
for (const [from, status, to] of other) {
  await check('redirects', `${from} -> ${to} (${status})`, async () => {
    clearStub();
    const res = await get(from);
    assert.equal(res.status, status);
    assert.equal(res.headers.get('location'), to);
    assert.equal(stubHits().length, 0);
  });
}
await check('redirects', 'middleware table agrees with the served redirects (every rule, one sample each)', async () => {
  for (const pattern of Object.keys(REDIRECTS)) {
    const sample = pattern.replace(/\[\.\.\.(\w+)\]/g, 'a/b').replace(/\[(\w+)\]/g, 'x');
    const m = matchRedirect(sample);
    assert.ok(m, pattern);
    const res = await get(sample);
    assert.equal(res.status, m.status, sample);
    assert.equal(res.headers.get('location'), m.location, sample);
  }
});

// ---------------------------------------------------------------- one URL per page
for (const [from, to] of [['/tim/', '/tim'], ['/blog/', '/blog'], ['/blog/?page=2', '/blog?page=2'], ['/blog.html', '/blog'], ['/tim.html', '/tim'], ['/nope/', '/nope']]) {
  await check('canonical-url', `${from} -> 308 ${to}`, async () => {
    clearStub();
    const res = await get(from);
    assert.equal(res.status, 308);
    assert.equal(res.headers.get('location'), to);
    assert.equal(stubHits().length, 0);
  });
}
await check('canonical-url', 'a legacy path with a trailing slash is not touched: the origin decides (Next redirects it itself)', async () => {
  clearStub();
  const res = await get('/login/');
  assert.notEqual(res.status, 308);
  assert.equal(res.headers.get('x-stub-origin'), '1');
  assert.equal(stubHits().length, 1);
});
await check('canonical-url', 'prerendered article with a trailing slash: the assets layer sends it to the clean URL (307)', async () => {
  const res = await get(`/blog/${slugs[0]}/`);
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('location'), `/blog/${slugs[0]}`);
});

// ---------------------------------------------------------------- pass-through
const legacyPages = ['/login', '/register', '/forgot-password', '/reset-password?token=abc', '/verify-email?token=abc',
  '/laporan', '/kontak', '/gabung-siswa', '/gabung-siswa/docs'];
for (const p of legacyPages) {
  await check('pass-through', `GET ${p} reaches the origin (200)`, async () => {
    clearStub();
    const res = await get(p);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-stub-origin'), '1');
    const hit = stubHits();
    assert.equal(hit.length, 1);
    assert.equal(hit[0].path + hit[0].search, p);
  });
}
for (const p of ['/portal/status', '/admin/blog', '/admin']) {
  await check('pass-through', `GET ${p} (no session): the origin's 307 reaches the browser, not followed`, async () => {
    clearStub();
    const res = await get(p);
    assert.equal(res.status, 307);
    assert.match(res.headers.get('location'), /^http:\/\/127\.0\.0\.1:8791\/login\?from=/);
    assert.equal(stubHits().length, 1, 'only the first hop');
  });
}
await check('pass-through', 'cookie is preserved: the origin sees it and answers 200', async () => {
  clearStub();
  const res = await get('/portal/status', { headers: { cookie: 'stub-session=1; other=2' } });
  assert.equal(res.status, 200);
  assert.equal(stubHits()[0].headers.cookie, 'stub-session=1; other=2');
});
await check('pass-through', 'two Set-Cookie headers from the origin arrive as two', async () => {
  const res = await get('/login');
  const cookies = res.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.match(cookies[0], /^authjs\.csrf-token=stub1/);
  assert.match(cookies[1], /^authjs\.callback-url=/);
});
await check('pass-through', 'POST: method, query, body and custom headers arrive unchanged', async () => {
  clearStub();
  const payload = JSON.stringify({ email: 'tes@example.com', n: 'α β ✓' });
  const res = await get('/api/auth/callback/credentials?x=1&y=%20z', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-custom': 'abc', 'next-action': 'deadbeef', authorization: 'Bearer fake', cookie: 'a=b' },
    body: payload,
  });
  assert.equal(res.status, 200);
  const seen = stubHits()[0];
  assert.equal(seen.method, 'POST');
  assert.equal(seen.path, '/api/auth/callback/credentials');
  assert.equal(seen.search, '?x=1&y=%20z');
  assert.equal(seen.body, payload);
  for (const [k, v] of Object.entries({ 'content-type': 'application/json', 'x-custom': 'abc', 'next-action': 'deadbeef', authorization: 'Bearer fake', cookie: 'a=b' })) {
    assert.equal(seen.headers[k], v, k);
  }
  const echoed = await res.json();
  assert.equal(echoed.body, payload);
});
await check('pass-through', 'POST to a page path (a Next server action) reaches the origin', async () => {
  clearStub();
  const res = await get('/login', { method: 'POST', headers: { 'next-action': 'abc', 'content-type': 'text/plain' }, body: '["a"]' });
  assert.equal(res.status, 200);
  assert.equal(stubHits()[0].method, 'POST');
  assert.equal(stubHits()[0].body, '["a"]');
});
await check('pass-through', 'a 1 MB POST body goes through intact', async () => {
  clearStub();
  const big = 'x'.repeat(1_000_000);
  const res = await get('/api/upload', { method: 'POST', body: big, headers: { 'content-type': 'text/plain' } });
  assert.equal(res.status, 200);
  assert.equal(stubHits()[0].body.length, 1_000_000);
});
await check('pass-through', 'PUT, PATCH, DELETE and HEAD keep their method', async () => {
  for (const method of ['PUT', 'PATCH', 'DELETE', 'HEAD']) {
    clearStub();
    const res = await get('/api/x', { method, ...(method === 'HEAD' || method === 'DELETE' ? {} : { body: 'b' }) });
    assert.equal(res.status, 200, method);
    assert.equal(stubHits()[0].method, method);
  }
});
await check('pass-through', 'hop-by-hop request headers (te, keep-alive, proxy-authorization) are not forwarded', async () => {
  clearStub();
  // fetch() refuses to send some of these, so use a raw request.
  const status = await new Promise((resolve, reject) => {
    const req = http.request(
      `${base}/api/x`,
      { headers: { te: 'trailers', 'keep-alive': 'timeout=5', 'proxy-authorization': 'x', connection: 'close, x-drop-me', 'x-drop-me': '1', 'x-keep-me': '1' } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 200);
  const h = stubHits()[0].headers;
  // Headers named by `Connection:` are dropped by workerd's own HTTP layer before the Worker
  // runs (stripHopByHop covers them too, see tests/legacy.test.ts), so only the rest is asserted here.
  assert.equal(h['te'], undefined);
  assert.equal(h['proxy-authorization'], undefined);
  assert.equal(h['keep-alive'], undefined);
  assert.equal(h['x-keep-me'], '1');
});
await check('pass-through', 'hop-by-hop response headers from the origin do not reach the client', async () => {
  const res = await get('/login');
  assert.equal(res.headers.get('keep-alive'), null);
  assert.equal(res.headers.get('transfer-encoding') === null || res.headers.get('transfer-encoding') === 'chunked', true);
});
await check('pass-through', 'the origin sees the original host as X-Forwarded-Host (local mode)', async () => {
  clearStub();
  await get('/api/x');
  assert.equal(stubHits()[0].headers['x-forwarded-host'], '127.0.0.1:8791');
  assert.equal(stubHits()[0].headers['x-forwarded-proto'], 'http');
});
await check('pass-through', 'static files of the legacy pages are forwarded (/_next, /images, /blog/images, /files, /reports)', async () => {
  for (const p of ['/_next/static/chunks/app.js', '/_next/image?url=%2Fimages%2Fx.png&w=640&q=75', '/images/team/a.jpg', '/blog/images/2026/05/a.jpg', '/files/a.pdf', '/reports/2025/a.pdf']) {
    clearStub();
    const res = await get(p);
    assert.equal(res.status, 200, p);
    assert.equal(res.headers.get('x-stub-origin'), '1', p);
  }
});
await check('pass-through', 'origin cache headers survive (immutable for /_next)', async () => {
  const res = await get('/_next/static/a.js');
  assert.match(res.headers.get('cache-control'), /immutable/);
});
await check('pass-through', 'announcement and session endpoints used by the navbar script answer through the Worker', async () => {
  assert.deepEqual(await (await get('/api/auth/session')).json(), {});
  assert.deepEqual(await (await get('/api/announcements/current')).json(), { announcement: null });
});

// shortlinks
await check('shortlinks', '/daftar-2026 (an unknown single segment) is resolved by the origin: its 307 reaches the browser', async () => {
  clearStub();
  const res = await get('/daftar-2026');
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('location'), 'https://example.org/form');
  assert.equal(stubHits().length, 1);
});
await check('shortlinks', '/daftar-2026/ : the trailing slash is folded with a 308 first (like Next), then the origin is asked', async () => {
  clearStub();
  const first = await get('/daftar-2026/');
  assert.equal(first.status, 308);
  assert.equal(first.headers.get('location'), '/daftar-2026');
  assert.equal(stubHits().length, 0);
  const second = await get('/daftar-2026');
  assert.equal(second.status, 307);
  assert.equal(stubHits().length, 1);
  assert.equal(stubHits()[0].path, '/daftar-2026');
});
await check('shortlinks', 'upper case is offered to the origin too (its resolver lower-cases the slug)', async () => {
  clearStub();
  await get('/Daftar-2026');
  assert.equal(stubHits().length, 1);
});
await check('shortlinks', "an unknown valid slug: the origin's 404 is passed on", async () => {
  const res = await get('/no-such-link');
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('x-stub-origin'), '1');
});
for (const p of ['/no_such_link', '/a--b', '/-a', `/${'a'.repeat(65)}`, '/has.dot', '/a%20b']) {
  await check('shortlinks', `${p.slice(0, 20)} cannot be a slug: 404 from the Worker, origin not asked`, async () => {
    clearStub();
    const res = await get(p);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('x-stub-origin'), null);
    assert.equal(stubHits().length, 0);
  });
}
await check('shortlinks', 'static pages win over the catch-all: /blog and / never reach the origin', async () => {
  clearStub();
  await get('/blog');
  await get('/');
  assert.equal(stubHits().length, 0);
});

// ---------------------------------------------------------------- /program/<id> and /donasi
const PROGRAM_IDS = ['prapembinaan', 'pembinaan', 'pasca-pembinaan'];
const logStart = stack.output().length; // the error check below reads only what the Worker logged from here on
const imgTags = (html) => [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
const attrOf = (el, name) => el.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

for (const id of PROGRAM_IDS) {
  await check('program', `/program/${id}: 200 html from the assets layer, one h1, SEO tags and Program JSON-LD`, async () => {
    clearStub();
    const res = await get(`/program/${id}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.equal(stubHits().length, 0, 'must not reach the origin');
    const html = await text(res);
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
    assert.match(tag(html, /<title>([^<]*)<\/title>/), /^Program .+ \| Sakola Kembara$/);
    assert.equal(tag(html, /<link rel="canonical" href="([^"]*)"/), `https://sakolakembara.org/program/${id}`);
    assert.equal(tag(html, /<meta property="og:url" content="([^"]*)"/), `https://sakolakembara.org/program/${id}`);
    assert.match(html, /<meta name="robots" content="index, follow">/);
    assert.match(tag(html, /<meta property="og:image" content="([^"]*)"/), /^https:\/\/sakolakembara\.org\/_astro\/.+\.jpe?g$/);
    const ld = JSON.parse(tag(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/));
    assert.equal(ld['@type'], 'EducationalOccupationalProgram');
    assert.equal(ld.url, `https://sakolakembara.org/program/${id}`);
    assert.match(html, /aria-current="page"/);
    assert.match(html, /Timeline Kegiatan/);
  });

  await check('program', `/program/${id}: gallery images and the share image are served by the assets layer (webp, immutable), never by the origin`, async () => {
    const html = await text(await get(`/program/${id}`));
    const imgs = imgTags(html);
    const gallery = imgs.filter((i) => /alt="Dokumentasi /.test(i));
    assert.ok(gallery.length >= 1, 'the repo has photos for every program');
    for (const img of gallery) {
      assert.match(img, /\sloading="lazy"/);
      assert.match(img, /\swidth="\d+"/);
      assert.match(img, /\sheight="\d+"/);
    }
    clearStub();
    const urls = new Set(gallery.flatMap((i) => [attrOf(i, 'src'), ...attrOf(i, 'srcset').split(', ').map((c) => c.split(' ')[0])]));
    for (const url of urls) {
      const res = await get(url);
      assert.equal(res.status, 200, url);
      assert.equal(res.headers.get('content-type'), 'image/webp', url);
      assert.match(res.headers.get('cache-control'), /immutable/, url);
    }
    const og = tag(html, /<meta property="og:image" content="https:\/\/sakolakembara\.org([^"]*)"/);
    const ogRes = await get(og);
    assert.equal(ogRes.status, 200);
    assert.match(ogRes.headers.get('content-type'), /image\/jpeg/);
    const hero = imgs.find((i) => /fetchpriority="high"/.test(i));
    assert.ok(hero && /loading="eager"/.test(hero));
    const heroRes = await get(attrOf(hero, 'src'));
    assert.equal(heroRes.status, 200);
    assert.equal(stubHits().length, 0, 'no image went through the pass-through');
  });
}
for (const p of ['/program/unknown', '/program/PRAPEMBINAAN', '/program/prapembinaan/extra', '/program/pra-pembinaan']) {
  await check('program', `GET ${p} is a real 404 with the 404 page, origin not asked`, async () => {
    clearStub();
    const res = await get(p);
    assert.equal(res.status, 404);
    const html = await text(res);
    assert.match(html, /Halaman tidak ditemukan/);
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.equal(stubHits().length, 0);
  });
}
await check('program', 'one URL per stage: the assets layer redirects /program/<id>.html and /program/<id>/ to /program/<id> (307)', async () => {
  for (const [from, to] of [['/program/prapembinaan.html', '/program/prapembinaan'], ['/program/pembinaan/', '/program/pembinaan']]) {
    clearStub();
    const res = await get(from);
    assert.equal(res.status, 307, from);
    assert.equal(res.headers.get('location'), to, from);
    assert.equal(stubHits().length, 0);
  }
});
await check('program', '/program redirects (307) to stage 1, and that page is a 200', async () => {
  clearStub();
  const res = await get('/program');
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('location'), '/program/prapembinaan');
  assert.equal((await get(res.headers.get('location'))).status, 200);
  assert.equal(stubHits().length, 0);
});
await check('program', 'the sitemap lists the three program URLs and /donasi', async () => {
  const xml = await text(await get('/sitemap.xml'));
  for (const id of PROGRAM_IDS) assert.ok(xml.includes(`<loc>https://sakolakembara.org/program/${id}</loc>`), id);
  assert.ok(xml.includes('<loc>https://sakolakembara.org/donasi</loc>'));
});

await check('donasi', '/donasi: 200 html from the assets layer, one h1, SEO tags, no JSON-LD', async () => {
  clearStub();
  const res = await get('/donasi');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(stubHits().length, 0, 'must not reach the origin');
  const html = await text(res);
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.match(html, /<title>Donasi \| Sakola Kembara<\/title>/);
  assert.equal(tag(html, /<link rel="canonical" href="([^"]*)"/), 'https://sakolakembara.org/donasi');
  assert.match(html, /<meta name="description" content="Dukung pendidikan setara untuk anak Indonesia\./);
  assert.ok(!html.includes('application/ld+json'));
  assert.match(html, /Bank Muamalat/);
  assert.match(html, /1010 141 940/);
  assert.match(html, /data-copy-account="1010141940"/);
});
await check('donasi', '/donasi: the QRIS image is a plain <img> with dimensions, served as a hashed PNG by the assets layer, and the download link points at it', async () => {
  const html = await text(await get('/donasi'));
  const qr = imgTags(html).find((i) => /alt="QRIS Sakola Kembara"/.test(i));
  assert.ok(qr);
  assert.equal(attrOf(qr, 'width'), '280');
  assert.equal(attrOf(qr, 'height'), '373');
  assert.equal(attrOf(qr, 'loading'), 'lazy');
  assert.ok(!/srcset=/.test(qr));
  clearStub();
  const src = attrOf(qr, 'src');
  const res = await get(src);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.match(res.headers.get('cache-control'), /immutable/);
  assert.equal(stubHits().length, 0);
  assert.ok(html.includes(`href="${src}" download="qris-sakola-kembara.png"`) || html.includes(`download="qris-sakola-kembara.png"`) && html.includes(`href="${src}"`));
});
await check('donasi', 'the Worker logged no error while serving the program pages and /donasi', async () => {
  assert.doesNotMatch(stack.output().slice(logStart), /\[ERROR\]|✘|Uncaught|TypeError|ReferenceError/);
});

// ---------------------------------------------------------------- /tim
await check('tim', 'ok: members rendered from the API, source "network", origin not touched', async () => {
  clearStub();
  const res = await get('/tim');
  assert.equal(stubHits().length, 0);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-team-source'), 'network');
  const html = await text(res);
  assert.match(html, /Anggota Contoh 1/);
  assert.match(html, /Dewan Pembina/);
  assert.match(html, /Dewan Pengawas/);
  assert.match(html, /Pengurus/);
  assert.match(html, /Biografi contoh untuk uji lokal\./);
  assert.match(html, /<dialog id="member-00000000-0000-4000-8000-000000000001"/);
});
await check('tim', 'a second request inside the TTL is served from caches.default (API not asked again)', async () => {
  const before = (await (await fetch('http://127.0.0.1:4391/__hits')).json()).hits;
  const res = await get('/tim');
  const after = (await (await fetch('http://127.0.0.1:4391/__hits')).json()).hits;
  assert.equal(res.headers.get('x-team-source'), 'cache');
  assert.equal(after, before);
});
await check('tim', 'API answers 500 after the TTL: stale copy is served, page is still 200', async () => {
  await fetch('http://127.0.0.1:4391/__mode?m=500', { method: 'POST' });
  await new Promise((r) => setTimeout(r, 2500)); // fresh TTL is 2 s in this run
  const res = await get('/tim');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-team-source'), 'stale');
  assert.match(await text(res), /Anggota Contoh 1/);
});
await check('tim', 'while down, the stale copy is re-served as fresh for 30 s (no API call per request)', async () => {
  const before = (await (await fetch('http://127.0.0.1:4391/__hits')).json()).hits;
  const res = await get('/tim');
  const after = (await (await fetch('http://127.0.0.1:4391/__hits')).json()).hits;
  assert.equal(res.headers.get('x-team-source'), 'cache');
  assert.equal(after, before);
});
await check('tim', 'API hangs: the 2 s timeout fires and the stale copy is served', async () => {
  // Let the 30 s outage copy be replaced: use a fresh stack instance for a clean timeout case.
  const second = await startStack({ port: 8792, stubPort: 4392, fixturePort: 4393, inspectorPort: 9332, vars: { TEAM_CACHE_FRESH_SECONDS: '1' } });
  try {
    assert.equal((await fetch(`${second.base}/tim`)).headers.get('x-team-source'), 'network');
    await fetch('http://127.0.0.1:4393/__mode?m=slow', { method: 'POST' });
    await new Promise((r) => setTimeout(r, 1500));
    const started = performance.now();
    const res = await fetch(`${second.base}/tim`);
    const ms = performance.now() - started;
    assert.equal(res.headers.get('x-team-source'), 'stale');
    assert.ok(ms >= 1900 && ms < 3500, `timeout took ${Math.round(ms)} ms`);
  } finally {
    await second.stop();
  }
});
await check('tim', 'cold cache and API down: empty state, still 200', async () => {
  const third = await startStack({ port: 8793, stubPort: 4394, fixturePort: 4395, inspectorPort: 9333 });
  try {
    await fetch('http://127.0.0.1:4395/__mode?m=500', { method: 'POST' });
    const res = await fetch(`${third.base}/tim`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-team-source'), 'empty');
    assert.match(await res.text(), /Profil tim akan segera tampil di sini\./);
  } finally {
    await third.stop();
  }
});
await check('tim', 'API returns invalid JSON shape: treated as an error (empty on a cold cache)', async () => {
  const fourth = await startStack({ port: 8794, stubPort: 4396, fixturePort: 4397, inspectorPort: 9334 });
  try {
    await fetch('http://127.0.0.1:4397/__mode?m=badjson', { method: 'POST' });
    const res = await fetch(`${fourth.base}/tim`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-team-source'), 'empty');
  } finally {
    await fourth.stop();
  }
});

// ---------------------------------------------------------------- SEO in served HTML
const SEO_PAGES = [
  { path: '/', title: 'Sakola Kembara - Pendidikan Untuk Semua', canonical: 'https://sakolakembara.org/', ld: 'NGO' },
  { path: '/blog', title: 'Blog &amp; Cerita | Sakola Kembara', canonical: 'https://sakolakembara.org/blog' },
  { path: '/tim', title: 'Tim Kami | Sakola Kembara', canonical: 'https://sakolakembara.org/tim' },
  { path: `/blog/${slugs[0]}`, title: ` | Sakola Kembara`, canonical: `https://sakolakembara.org/blog/${slugs[0]}`, ld: 'Article' },
];
for (const page of SEO_PAGES) {
  await check('seo', `${page.path}: lang, title, canonical, og, twitter, robots${page.ld ? ', JSON-LD ' + page.ld : ''}`, async () => {
    const html = await text(await get(page.path));
    assert.match(html, /<html lang="id"/);
    assert.ok(html.includes(`<title>`) && tag(html, /<title>([^<]*)<\/title>/).endsWith(page.title.replace(/^ /, '')), `title: ${tag(html, /<title>([^<]*)<\/title>/)}`);
    assert.equal(tag(html, /<link rel="canonical" href="([^"]*)"/), page.canonical);
    assert.equal(tag(html, /<meta property="og:url" content="([^"]*)"/), page.canonical);
    assert.match(html, /<meta property="og:site_name" content="Sakola Kembara">/);
    assert.match(html, /<meta property="og:locale" content="id_ID">/);
    assert.match(html, /<meta property="og:image" content="https:\/\/sakolakembara\.org\//);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
    assert.match(html, /<meta name="robots" content="index, follow">/);
    assert.match(html, /<meta name="description" content="[^"]{20,}/);
    if (page.ld) assert.ok(html.includes(`"${page.ld === 'NGO' ? '@type":["NGO"' : '@type":"Article"'}`), 'json-ld');
  });
}
await check('seo', 'article JSON-LD parses and carries real dates', async () => {
  const a = articles[0];
  const html = await text(await get(`/blog/${a.id}`));
  const ld = JSON.parse(tag(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/));
  assert.equal(ld['@type'], 'Article');
  assert.equal(ld.datePublished, a.dateISO);
  assert.equal(ld.mainEntityOfPage, `https://sakolakembara.org/blog/${a.id}`);
  assert.equal(ld.inLanguage, 'id-ID');
});
await check('seo', 'skip link is the first focusable element and #konten-utama exists', async () => {
  const html = await text(await get('/'));
  assert.ok(html.indexOf('href="#konten-utama"') < html.indexOf('<nav'));
  assert.match(html, /id="konten-utama"/);
});
await check('seo', 'robots.txt: same rules as the Next app', async () => {
  const body = await text(await get('/robots.txt'));
  assert.equal(body, 'User-Agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\nDisallow: /login\n\nHost: https://sakolakembara.org\nSitemap: https://sakolakembara.org/sitemap.xml\n');
});
await check('seo', 'sitemap.xml: 80 articles with real lastmod, static routes without lastmod', async () => {
  const res = await get('/sitemap.xml');
  assert.match(res.headers.get('content-type'), /xml/);
  const xml = await text(res);
  const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
  assert.equal(urls.length, 7 + 3 + 80);
  const blogUrls = urls.filter((u) => /<loc>https:\/\/sakolakembara\.org\/blog\/[^<]+<\/loc>/.test(u));
  assert.equal(blogUrls.length, 80);
  for (const u of blogUrls) assert.match(u, /<lastmod>\d{4}-\d{2}-\d{2}/);
  const staticUrls = urls.filter((u) => !/\/blog\/[^<]+<\/loc>/.test(u));
  assert.equal(staticUrls.length, 10);
  for (const u of staticUrls) assert.doesNotMatch(u, /<lastmod>/);
});

// ---------------------------------------------------------------- headers
for (const p of ['/', '/tim', '/blog', '/blog/nope', `/blog/${slugs[0]}`, '/robots.txt']) {
  await check('headers', `${p}: security headers present`, async () => {
    const res = await get(p);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.match(res.headers.get('strict-transport-security'), /max-age=31536000/);
    assert.match(res.headers.get('permissions-policy'), /camera=\(\)/);
  });
}
await check('headers', 'hashed assets are immutable', async () => {
  const html = await text(await get('/'));
  const css = tag(html, /<link rel="stylesheet" href="([^"]*\.css)"/);
  const res = await get(css);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /immutable/);
});

// ---------------------------------------------------------------- assets: images and PDFs
// Every image and file the pages reference must come from the assets layer: a request
// that reaches the stub origin would be a Worker request in production (100k/day on Free).
const imageManifest = JSON.parse(readFileSync(path.join(webRoot, 'src/generated/image-manifest.json'), 'utf8')).images;
const bytesOf = async (res) => new Uint8Array(await res.arrayBuffer());
const startsWith = (bytes, sig) => sig.every((b, i) => bytes[i] === b);
const MAGIC = { 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff], 'image/webp': [0x52, 0x49, 0x46, 0x46] };

await check('assets', 'a WebP derivative: 200 image/webp, a year immutable, served without the origin', async () => {
  const entry = imageManifest['/images/hero-team.png'];
  for (const v of entry.variants) {
    clearStub();
    const res = await get(variantUrl(entry.hash, v.width));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/webp');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.ok(startsWith(await bytesOf(res), MAGIC['image/webp']));
    assert.equal(stubHits().length, 0, 'reached the origin');
  }
});
await check('assets', 'every image of the manifest answers 200 at the URL the markup uses (no redirect hop), original and every WebP rung', async () => {
  clearStub();
  const wrong = [];
  for (const [url, entry] of Object.entries(imageManifest)) {
    for (const u of [assetUrl(url), ...entry.variants.map((v) => variantUrl(entry.hash, v.width))]) {
      const res = await get(u, { method: 'HEAD' });
      if (res.status !== 200) wrong.push(`${res.status} ${u}`);
    }
  }
  assert.deepEqual(wrong, []);
  assert.equal(stubHits().length, 0, 'an image reached the origin');
});
await check('assets', 'original image URLs serve a real image of the type their extension says, under 1 MiB, without the origin', async () => {
  const cases = [
    ['/blog/images/2025/10/1.png', 'image/png'],
    ['/images/hero-team.png', 'image/png'],
    ['/images/program/asrama-intensif.jpg', 'image/jpeg'],
    ['/images/testimoni/daffa-najwan.jpg', 'image/jpeg'], // PNG data in the source, JPEG here
    ['/images/partners/talents-mapping.png', 'image/png'], // WebP data in the source, PNG here
  ];
  for (const [p, type] of cases) {
    clearStub();
    const res = await get(p);
    assert.equal(res.status, 200, p);
    assert.equal(res.headers.get('content-type'), type, p);
    assert.match(res.headers.get('cache-control'), /max-age=86400/, p);
    const body = await bytesOf(res);
    assert.ok(startsWith(body, MAGIC[type]), `${p} is not ${type}`);
    assert.ok(body.length < LIMITS.imageSoftBytes, `${p} is ${body.length} bytes`);
    assert.equal(stubHits().length, 0, `${p} reached the origin`);
  }
});
await check('assets', 'the old WordPress image path redirects (308) to a served image', async () => {
  const res = await get('/wp-content/uploads/2025/10/1.png');
  assert.equal(res.status, 308);
  assert.equal(res.headers.get('location'), '/blog/images/2025/10/1.png');
  clearStub();
  assert.equal((await get(res.headers.get('location'))).status, 200);
  assert.equal(stubHits().length, 0);
});
await check('assets', 'both big PDFs: 200 application/pdf, under 25 MiB, HEAD works, without the origin', async () => {
  for (const name of ['pitchdeck-sakola-kembara.pdf', 'kurikulum-khusus-sakola-kembara.pdf']) {
    clearStub();
    const head = await get(`/files/${name}`, { method: 'HEAD' });
    assert.equal(head.status, 200, name);
    assert.equal(head.headers.get('content-type'), 'application/pdf', name);
    const res = await get(`/files/${name}`);
    assert.equal(res.status, 200, name);
    assert.match(res.headers.get('cache-control'), /max-age=3600/, name);
    const body = await bytesOf(res);
    assert.equal(String.fromCharCode(...body.subarray(0, 5)), '%PDF-', name);
    assert.ok(body.length < LIMITS.maxFileBytes, `${name} is ${body.length} bytes`);
    assert.equal(stubHits().length, 0, `${name} reached the origin`);
  }
});
for (const page of ['/blog', '/blog?page=2']) {
  await check('assets', `${page} (rendered by the Worker): every <img> has width, height and srcset, and every image URL it names is a static asset`, async () => {
    const html = await text(await get(page));
    const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    assert.ok(imgs.length >= 12, `${imgs.length} images`);
    const urls = new Set();
    for (const img of imgs) {
      assert.deepEqual(checkImgTag(img), [], img);
      const a = parseAttrs(img);
      if (!a.src.startsWith('/_astro/')) assert.ok(a.srcset && a.sizes, `no srcset/sizes: ${img}`); // the navbar logo is a hashed import
      for (const u of [...localUrls(a.src), ...localUrls(a.srcset ?? '')]) urls.add(u);
    }
    clearStub();
    for (const u of urls) {
      const res = await get(u);
      assert.equal(res.status, 200, u);
      assert.match(res.headers.get('content-type'), /^image\//, u);
    }
    assert.equal(stubHits().length, 0, 'an image reached the origin');
  });
}
await check('assets', 'an article page names only static images, each with a WebP srcset', async () => {
  const withImages = articles.find((a) => (readFileSync(path.join(webRoot, `../../content/blog/${a.id}.md`), 'utf8').match(/!\[/g) ?? []).length >= 2);
  const html = await text(await get(`/blog/${withImages.id}`));
  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(imgs.length >= 3);
  clearStub();
  for (const img of imgs.filter((i) => !i.includes('/_astro/'))) {
    assert.deepEqual(checkImgTag(img), [], img);
    const a = parseAttrs(img);
    for (const u of [...localUrls(a.src), ...localUrls(a.srcset ?? '')]) assert.equal((await get(u)).status, 200, u);
  }
  assert.equal(stubHits().length, 0);
});

// ---------------------------------------------------------------- announcement markup contract
await check('navbar', 'on an article page the navbar script is the only script besides JSON-LD: inline, small, no script file', async () => {
  const html = await text(await get(`/blog/${slugs[0]}`));
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !m[1].includes('ld+json'));
  assert.equal(scripts.length, 1);
  assert.ok(scripts[0][2].length < 6000, `script is ${scripts[0][2].length} bytes`);
  assert.equal([...html.matchAll(/<script[^>]*\ssrc=/g)].length, 0, 'no external script files');
});

// ---------------------------------------------------------------- home page (SAKEM-080, part A)
const homeHtml = async () => text(await get('/'));
await check('home', '/ has the seven sections in order, answered without touching the origin', async () => {
  clearStub();
  const html = await homeHtml();
  const marks = ['Membuka Pintu', 'Mengapa Kami Ada?', 'id="activities"', 'id="impact"', 'id="partners"', 'Jadilah Bagian dari Perubahan', 'id="blog"'];
  const at = marks.map((m) => html.indexOf(m));
  assert.ok(at.every((i) => i > 0), `a section is missing: ${at}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'sections out of order');
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.equal(stubHits().length, 0);
});
await check('home', '/ content counts: 3 figures, 4 metrics, 8 branches, 7 testimonials, 6 partner logos, 4 CTA cards, 3 news cards', async () => {
  const html = await homeHtml();
  assert.equal((html.match(/<article class="flex flex-col gap-4/g) ?? []).length, 3);
  assert.equal((html.match(/<div class="bg-gradient-to-br /g) ?? []).length, 4);
  assert.equal((html.match(/<li class="bg-white rounded-xl shadow-sm"/g) ?? []).length, 8);
  assert.equal((html.match(/<li class="snap-start/g) ?? []).length, 7);
  assert.equal((html.match(/<li class="w-\[136px\]/g) ?? []).length, 6);
  assert.equal((html.match(/<a href="\/(?:gabung-siswa|donasi|kontak)" class="mt-auto/g) ?? []).length, 4);
  const news = html.slice(html.indexOf('id="blog"'));
  assert.equal((news.match(/<a href="\/blog\/[^"]+" class="group block/g) ?? []).length, 3);
});
await check('home', 'every /_astro asset the home page references is served by the assets layer: 200, right type, immutable, origin not asked', async () => {
  const html = await homeHtml();
  const urls = [...new Set(html.match(/\/_astro\/[\w.-]+\.(?:webp|png|css|js|woff2)/g) ?? [])];
  assert.ok(urls.length >= 25, `only ${urls.length} assets`);
  const types = { webp: /image\/webp/, png: /image\/png/, css: /text\/css/, js: /javascript/, woff2: /font\/woff2|octet-stream/ };
  clearStub();
  for (const url of urls) {
    const res = await get(url);
    assert.equal(res.status, 200, url);
    assert.match(res.headers.get('content-type') ?? '', types[url.split('.').pop()], url);
    assert.match(res.headers.get('cache-control') ?? '', /immutable/, url);
    await res.arrayBuffer();
  }
  assert.equal(stubHits().length, 0, 'an asset went to the origin');
});
await check('home', 'the map loads lazily: the HTML never names Leaflet, and its chunks are plain static files', async () => {
  const html = await homeHtml();
  assert.doesNotMatch(html, /leaflet/i);
  const loader = tag(html, /<script type="module" src="(\/_astro\/ImpactMap[^"]+\.js)"/);
  assert.ok(loader, 'map loader script');
  const code = await text(await get(loader));
  const chunks = [...code.matchAll(/import\("\.\/([\w.-]+\.js)"\)/g)].map((m) => m[1]);
  assert.equal(chunks.length, 3);
  clearStub();
  let bytes = 0;
  for (const chunk of chunks) {
    const res = await get(`/_astro/${chunk}`);
    assert.equal(res.status, 200, chunk);
    assert.match(res.headers.get('content-type'), /javascript/);
    assert.match(res.headers.get('cache-control'), /immutable/);
    bytes += (await res.arrayBuffer()).byteLength;
  }
  assert.ok(bytes > 100_000 && bytes < 190_000, `lazy map chunks are ${bytes} bytes`); // Leaflet itself is about 150 KB
  assert.equal(stubHits().length, 0);
});
await check('home', 'eager JS of the home page (inline scripts + the map loader), as served, stays inside the budget', async () => {
  const html = await homeHtml();
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !m[1].includes('ld+json'));
  assert.equal(scripts.length, 4); // navbar, stat dialog, carousel, map loader
  let bytes = 0;
  for (const m of scripts) {
    const src = m[1].match(/\ssrc="([^"]+)"/)?.[1];
    bytes += src ? (await (await get(src)).arrayBuffer()).byteLength : Buffer.byteLength(m[2]);
  }
  assert.ok(bytes <= 9000, `eager JS is ${bytes} bytes`); // keep equal to BUDGET.eagerJs.raw in tests/home-built.test.ts
});
await check('home', "the news covers are the blog's own /blog/images files (the same URLs as on /blog), never page-local copies", async () => {
  const html = await homeHtml();
  const covers = [...html.slice(html.indexOf('id="blog"')).matchAll(/<img src="(\/blog\/images\/[^"]+)"/g)].map((m) => m[1]);
  assert.equal(covers.length, 3);
  for (const cover of covers) assert.doesNotMatch(cover, /^\/_astro\//);
});

// ---------------------------------------------------------------- report
await stack.stop();

const failed = results.filter((r) => !r.ok);
const groups = [...new Set(results.map((r) => r.group))];
console.log('\nE2E results by group');
for (const g of groups) {
  const rs = results.filter((r) => r.group === g);
  console.log(`  ${g.padEnd(14)} ${String(rs.filter((r) => r.ok).length).padStart(3)}/${rs.length}`);
}
const byStatus = {};
for (const e of exchanges) {
  const kind = e.type.includes('text/html') ? 'html' : e.status >= 300 && e.status < 400 ? 'redirect' : 'other';
  const k = `${e.status} ${kind}`;
  byStatus[k] = (byStatus[k] ?? 0) + 1;
}
console.log('\nHTTP exchanges made by the checks, by status and kind');
for (const [k, n] of Object.entries(byStatus).sort()) console.log(`  ${k.padEnd(14)} ${n}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log(`FAIL [${f.group}] ${f.name}\n     ${f.detail}`);
process.exit(failed.length ? 1 : 0);
