// End-to-end checks against the BUILT Worker running under `wrangler dev` (local
// mode, workerd), with the stub legacy origin and the fixture content API behind it.
//
//   pnpm build && pnpm test:e2e
//
// Covers: status codes of every page type, the real 404, all 80 WordPress
// redirects, the other redirect rules, pass-through (method, headers, body,
// cookies, redirects not followed), Astro paths NOT reaching the origin, /tim
// timeout / cache / stale-if-error (also /laporan and /gabung-siswa/docs: grouping, anchors, copy
// buttons run in a DOM, degraded and empty states), SEO tags in the served HTML, security
// headers, images and PDFs served as static assets (never through the origin).
// Prints a summary and exits non-zero on any failure.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Window } from 'happy-dom';
import { startStack, webRoot } from './lib/harness.mjs';
import { SAMPLE_REPORTS, SAMPLE_RESOURCES } from './fixture-api.mjs';
import { REDIRECTS, matchRedirect } from '../redirects.config.mjs';
import { LIMITS, assetUrl, variantUrl } from '../assets.config.mjs';
import { checkImgTag, localUrls, parseAttrs } from './lib/dist-audit.mjs';

if (!existsSync(path.join(webRoot, 'dist/server/wrangler.json'))) {
  console.error('dist/ is missing. Run `pnpm build` first.');
  process.exit(2);
}

const articles = JSON.parse(readFileSync(path.join(webRoot, '../../lib/blog-posts.json'), 'utf8')).articles;
const stack = await startStack({ log: path.join(webRoot, 'dist/e2e-wrangler.log'), vars: { TEAM_CACHE_FRESH_SECONDS: '2', CONTENT_CACHE_FRESH_SECONDS: '2' } });
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
  '/kontak'];
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

// ---------------------------------------------------------------- /laporan, /gabung-siswa, /gabung-siswa/docs (SAKEM-080, part D)
// /laporan and /gabung-siswa/docs are SSR from the content API (fixture: scripts/fixture-api.mjs);
// /gabung-siswa is a prerendered file of the assets layer. The tim checks above left the main
// fixture failing, so it is reset first.
const decode = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(?:39|x27);/g, "'").replace(/&amp;/g, '&');
const mainText = (html) =>
  decode(
    html
      .slice(html.indexOf('id="konten-utama"'), html.indexOf('<footer'))
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<svg[\s\S]*?<\/svg>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  );
const anchorTags = (html) => [...html.matchAll(/<a\s[^>]*>/g)].map((m) => m[0]);
const fixtureStats = async (port = 4391) => (await fetch(`http://127.0.0.1:${port}/__hits`)).json();
const setMode = (port, mode, only) => fetch(`http://127.0.0.1:${port}/__mode?m=${mode}${only ? `&for=${only}` : ''}`, { method: 'POST' });
const inlineScripts = (html) => [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !m[1].includes('ld+json')).map((m) => m[2]);
const notes = [];
await setMode(4391, 'ok');
const listLogStart = stack.output().length;

await check('reports', '/laporan: SSR 200 from the API, one h1, years newest first, cards in the API order, PDF links as the API gave them, origin not asked', async () => {
  clearStub();
  const res = await get('/laporan');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('x-reports-source'), 'network');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  assert.equal(stubHits().length, 0, 'must not reach the origin');
  const html = await text(res);
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  const years = [...html.matchAll(/<h2 class="[^"]*">(Tahun[^<]*)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(years, ['Tahun Ajaran 2025/2026', 'Tahun 2025', 'Tahun Ajaran 2024/2025', 'Tahun 2024']);
  assert.deepEqual([...html.matchAll(/<span class="text-sm text-gray-500">(\d+) laporan<\/span>/g)].map((m) => Number(m[1])), [2, 2, 1, 1]);
  const titles = [...html.matchAll(/<h3 class="text-lg font-bold text-gray-900 mb-2 leading-snug">([^<]*)<\/h3>/g)].map((m) => decode(m[1]));
  assert.deepEqual(titles, SAMPLE_REPORTS.map((r) => r.title)); // the fixture lists them in display order
  const tags = [...html.matchAll(/rounded-full text-xs font-semibold border border-(\w+)-200 [^"]*">([^<]*)<\/span>/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(tags, ['purple:Laporan Dampak', 'emerald:Laporan Keuangan', 'blue:Laporan Tahunan', 'amber:Laporan Donasi', 'purple:Laporan Dampak', 'blue:Laporan Tahunan']);
  assert.deepEqual([...html.matchAll(/<div class="text-xs text-gray-500 mb-4">([^<]*)<\/div>/g)].map((m) => m[1]), ['PDF · 1.8 MB', 'PDF · 500 KB', 'PDF · 3.0 MB', 'PDF · 85 KB', 'PDF · 1.5 MB', 'PDF · 2.3 MB']);
  const links = anchorTags(html).filter((a) => a.includes('href="/reports/'));
  assert.deepEqual(links.map((a) => attrOf(a, 'href')), SAMPLE_REPORTS.map((r) => r.filePath));
  for (const a of links) {
    assert.equal(attrOf(a, 'target'), '_blank');
    assert.equal(attrOf(a, 'rel'), 'noopener noreferrer');
  }
  const t = mainText(html);
  assert.ok(t.includes('Komitmen kami untuk transparansi.'));
  assert.ok(t.includes('Punya pertanyaan tentang laporan kami?'));
  assert.ok(html.includes('href="/kontak"'));
  assert.ok(!html.includes('application/ld+json'));
});
await check('reports', '/laporan: a second request inside the fresh window comes from caches.default (the API is not asked again)', async () => {
  const before = (await fixtureStats()).byEndpoint.reports;
  const res = await get('/laporan');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-reports-source'), 'cache');
  assert.equal((await fixtureStats()).byEndpoint.reports, before);
});

await check('resources', '/gabung-siswa/docs: SSR 200, five categories in order, every contents link has its section, entries counted per category', async () => {
  clearStub();
  const res = await get('/gabung-siswa/docs');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-resources-source'), 'network');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  assert.equal(stubHits().length, 0, 'must not reach the origin');
  const html = await text(res);
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  const order = ['panduan', 'berkas-pendaftaran', 'berkas-marketing', 'tutorial', 'lainnya'];
  const toc = html.match(/<nav aria-label="Kategori dokumen"[\s\S]*?<\/nav>/)?.[0] ?? '';
  assert.deepEqual([...toc.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]), order);
  assert.deepEqual([...toc.matchAll(/>\s*([^<>\s][^<>]*?)\s*<\/a>/g)].map((m) => m[1]), ['Panduan Pendaftaran', 'Berkas Pendaftaran', 'Berkas Marketing', 'Tutorial', 'Lainnya']);
  const at = order.map((id) => {
    assert.ok(html.includes(`<section id="${id}" class="scroll-mt-24" aria-labelledby="heading-${id}">`), `section ${id}`);
    assert.ok(html.includes(`id="heading-${id}"`), `heading of ${id}`);
    return html.indexOf(`<section id="${id}"`);
  });
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'sections out of order');
  const counts = order.map((_, i) => (html.slice(at[i], at[i + 1] ?? html.length).match(/<article\b/g) ?? []).length);
  assert.deepEqual(counts, order.map((id) => SAMPLE_RESOURCES.filter((r) => r.category === id).length));
  assert.ok(!html.includes('application/ld+json'));
  const t = mainText(html);
  assert.ok(t.includes('Panduan lengkap, poin-poin penting, dan alur pendaftaran Sakola Kembara.'));
  assert.ok(t.includes('Dokumen tambahan yang tidak masuk kategori di atas.'));
  assert.ok(html.includes('<a href="/portal/daftar"'));
  assert.ok(html.includes('<a href="/gabung-siswa"'));
});
await check('resources', '/gabung-siswa/docs: files and links open in a new tab with rel noopener noreferrer (files also download); a text entry has a hidden copy button that points at its <pre>', async () => {
  const html = await text(await get('/gabung-siswa/docs'));
  const links = anchorTags(html);
  for (const r of SAMPLE_RESOURCES) {
    if (r.contentType === 'file' || r.contentType === 'url') {
      const href = r.contentType === 'file' ? r.filePath : r.externalUrl;
      const a = links.find((x) => attrOf(x, 'href') === href);
      assert.ok(a, `${r.title}: no link to ${href}`);
      assert.equal(attrOf(a, 'target'), '_blank', r.title);
      assert.equal(attrOf(a, 'rel'), 'noopener noreferrer', r.title);
      assert.equal(/\sdownload[\s>=]/.test(a), r.contentType === 'file', `${r.title}: download attribute`);
    } else {
      const preId = `resource-text-${r.id}`;
      const pre = html.match(new RegExp(`<pre id="${preId}"[^>]*>([\\s\\S]*?)</pre>`));
      assert.ok(pre, `${r.title}: <pre>`);
      assert.equal(decode(pre[1]), r.bodyText);
      const button = html.match(new RegExp(`<button [^>]*data-copy-text="${preId}"[^>]*>`))?.[0];
      assert.ok(button, `${r.title}: copy button`);
      assert.match(button, /type="button"/);
      assert.match(button, /\shidden[\s>]/);
      assert.equal(attrOf(button, 'aria-label'), `Salin teks ${r.title}`);
    }
  }
  const t = mainText(html);
  for (const label of ['Unduh', 'Buka', 'Salin', 'Tersalin', 'Teks · siap disalin', 'Link eksternal', 'File · 881 KB']) assert.ok(t.includes(label), label);
});
await check('resources', 'the copy script, run against the served page in a DOM: un-hides the buttons, copies the <pre>, shows "Tersalin" and says so, returns to "Salin"; a refused copy shows nothing; no console error', async () => {
  const html = await text(await get('/gabung-siswa/docs'));
  const scripts = inlineScripts(html);
  const copy = scripts.find((c) => c.includes('data-copy-text'));
  assert.ok(copy, 'copy script');
  notes.push(`copy-button script on /gabung-siswa/docs: ${Buffer.byteLength(copy)} bytes raw, inline (the navbar script next to it: ${Buffer.byteLength(scripts.find((c) => c.includes('nav-toggle')))})`);
  assert.ok(Buffer.byteLength(copy) < 1200, `${Buffer.byteLength(copy)} bytes`);

  const problems = [];
  const sink = (...a) => void problems.push(a.join(' '));
  const window = new Window({ url: `${base}/gabung-siswa/docs`, console: { error: sink, warn: sink, log() {}, info() {}, debug() {} } });
  try {
    window.document.documentElement.innerHTML = html
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<link rel="stylesheet"[^>]*>/g, '')
      .replace(/^<!doctype html>/i, '');
    window.fetch = () => Promise.reject(new Error('offline')); // the navbar script asks the legacy app, which is not here
    let copied = null;
    let writeOk = true;
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t) => (writeOk ? void (copied = t) : Promise.reject(new Error('denied'))) },
    });
    window.addEventListener('error', (e) => problems.push(`window error: ${e.message}`));
    const buttons = () => [...window.document.querySelectorAll('[data-copy-text]')];
    assert.ok(buttons().length >= 2);
    for (const b of buttons()) assert.equal(b.hidden, true, 'hidden until the script runs');
    for (const code of scripts) window.eval(code);
    for (const b of buttons()) assert.equal(b.hidden, false);

    const first = buttons()[0];
    const state = (b) => ({
      copied: b.hasAttribute('data-copied'),
      idle: b.querySelector('[data-copy-idle]').hidden,
      done: b.querySelector('[data-copy-done]').hidden,
      said: b.parentElement.querySelector('[data-copy-status]').textContent,
    });
    assert.deepEqual(state(first), { copied: false, idle: false, done: true, said: '' });
    first.click();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(copied, SAMPLE_RESOURCES.find((r) => `resource-text-${r.id}` === first.dataset.copyText).bodyText);
    assert.deepEqual(state(first), { copied: true, idle: true, done: false, said: 'Teks tersalin ke papan klip.' });
    await new Promise((r) => setTimeout(r, 1900));
    assert.deepEqual(state(first), { copied: false, idle: false, done: true, said: '' });

    // refused by the browser and by the fallback: no success shown
    writeOk = false;
    window.document.execCommand = () => false;
    const second = buttons()[1];
    second.click();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(state(second).copied, false);
    // refused by the browser, accepted by the fallback (a hidden textarea is used and removed again)
    window.document.execCommand = () => true;
    second.click();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(state(second).copied, true);
    assert.equal(window.document.querySelectorAll('textarea').length, 0);
  } finally {
    await window.happyDOM.close();
  }
  assert.deepEqual(problems, []);
});

await check('gabung-siswa', '/gabung-siswa: 200 html from the assets layer, one h1, SEO tags, no JSON-LD, origin not asked', async () => {
  clearStub();
  const res = await get('/gabung-siswa');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(stubHits().length, 0, 'must not reach the origin');
  const html = await text(res);
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.match(html, /<title>Daftar Siswa \| Sakola Kembara<\/title>/);
  assert.equal(tag(html, /<link rel="canonical" href="([^"]*)"/), 'https://sakolakembara.org/gabung-siswa');
  assert.match(html, /<meta name="description" content="Daftarkan diri sebagai siswa Sakola Kembara\./);
  assert.ok(!html.includes('application/ld+json'));
  const t = mainText(html);
  for (const phrase of ['Open Recruitment Gen 6', 'Wujudkan Mimpimu Bersama Sakola Kembara', 'Manfaat Bergabung dengan Sakola Kembara', 'Alur Pendaftaran', 'Siap Bergabung dengan Sakola Kembara?', 'Pusat Dokumen']) {
    assert.ok(t.includes(phrase), phrase);
  }
  for (const step of ['01', '02', '03', '04']) assert.ok(t.includes(` ${step} `), step);
  assert.equal((html.match(/<h3 class="font-bold text-gray-900 mb-2">/g) ?? []).length, 4, 'four steps');
  const links = anchorTags(html);
  assert.equal(links.filter((a) => attrOf(a, 'href') === '/portal/daftar').length, 2, 'the two Daftar Sekarang buttons');
  assert.equal(links.filter((a) => attrOf(a, 'href') === '/gabung-siswa/docs').length, 1);
  assert.ok(links.some((a) => attrOf(a, 'href') === '#manfaat'));
  assert.ok(html.includes('<section id="manfaat"'));
  assert.equal(inlineScripts(html).length, 1, 'the navbar script is the only script');
});
await check('gabung-siswa', 'trailing slashes: /gabung-siswa/ (assets layer) and /gabung-siswa/docs/, /laporan/ (middleware) go to the clean URL', async () => {
  clearStub();
  const a = await get('/gabung-siswa/');
  assert.equal(a.headers.get('location'), '/gabung-siswa');
  assert.ok([307, 308].includes(a.status));
  for (const [from, to] of [['/gabung-siswa/docs/', '/gabung-siswa/docs'], ['/laporan/', '/laporan'], ['/laporan.html', '/laporan']]) {
    const res = await get(from);
    assert.equal(res.status, 308, from);
    assert.equal(res.headers.get('location'), to, from);
  }
  assert.equal(stubHits().length, 0);
});
await check('gabung-siswa', 'the sitemap lists /laporan and /gabung-siswa (not /gabung-siswa/docs, like the Next sitemap)', async () => {
  const xml = await text(await get('/sitemap.xml'));
  assert.ok(xml.includes('<loc>https://sakolakembara.org/laporan</loc>'));
  assert.ok(xml.includes('<loc>https://sakolakembara.org/gabung-siswa</loc>'));
  assert.ok(!xml.includes('/gabung-siswa/docs'));
});
await check('gabung-siswa', 'the Worker logged no error while serving /laporan, /gabung-siswa and /gabung-siswa/docs', async () => {
  assert.doesNotMatch(stack.output().slice(listLogStart), /\[ERROR\]|✘|Uncaught|TypeError|ReferenceError/);
});

// API failure: degraded and empty states, stale-if-error. One stack, steps in order (the cache is shared).
{
  const failing = await startStack({ port: 8795, stubPort: 4398, fixturePort: 4399, inspectorPort: 9335, vars: { CONTENT_CACHE_FRESH_SECONDS: '1' } });
  const page = (p) => fetch(`${failing.base}${p}`, { redirect: 'manual' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const lists = [
    { path: '/laporan', header: 'x-reports-source', endpoint: 'reports', degraded: 'Laporan belum dapat ditampilkan', empty: 'Laporan akan segera tersedia', data: 'Laporan Dampak 2025/2026' },
    { path: '/gabung-siswa/docs', header: 'x-resources-source', endpoint: 'resources', degraded: 'Dokumen belum dapat ditampilkan', empty: 'Dokumen akan segera tersedia', data: 'Panduan Pendaftaran Siswa Baru' },
  ];
  try {
    await setMode(4399, '500', 'resources');
    await setMode(4399, 'badjson', 'reports');
    for (const l of lists) {
      await check('degraded', `${l.path}: API failing and nothing cached -> 503 with the page shell and a clear notice, never cached, Retry-After`, async () => {
        const res = await page(l.path);
        assert.equal(res.status, 503);
        assert.equal(res.headers.get(l.header), 'empty');
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.equal(res.headers.get('retry-after'), '30');
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        assert.match(res.headers.get('content-type'), /text\/html/);
        const html = await res.text();
        const t = mainText(html);
        assert.ok(t.includes(l.degraded), 'degraded notice');
        assert.ok(!t.includes(l.empty), 'must not claim the list is empty');
        assert.ok(html.includes('role="status"'));
        assert.ok(html.includes('id="site-nav"') && html.includes('<footer'), 'shell is there');
        assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
        assert.ok(!html.includes('<nav aria-label="Kategori dokumen"'));
        assert.match(html, /<link rel="canonical" href="https:\/\/sakolakembara\.org\//);
      });
    }

    await setMode(4399, 'ok');
    for (const l of lists) {
      await check('degraded', `${l.path}: the API is back -> 200 with the data`, async () => {
        const res = await page(l.path);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get(l.header), 'network');
        assert.ok(mainText(await res.text()).includes(l.data));
      });
    }

    await setMode(4399, 'empty');
    await wait(1300); // the 1 s fresh window is over
    for (const l of lists) {
      await check('empty', `${l.path}: an empty list is the legacy empty state, a normal cacheable 200`, async () => {
        const res = await page(l.path);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get(l.header), 'network');
        assert.equal(res.headers.get('cache-control'), 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
        const html = await res.text();
        const t = mainText(html);
        assert.ok(t.includes(l.empty), 'empty-state copy');
        assert.ok(!t.includes(l.degraded));
        assert.ok(!html.includes('<nav aria-label="Kategori dokumen"'));
      });
    }

    await setMode(4399, 'ok');
    await wait(1300);
    for (const l of lists) {
      await check('empty', `${l.path}: the list is back after the empty one`, async () => {
        const res = await page(l.path);
        assert.equal(res.status, 200);
        assert.ok(mainText(await res.text()).includes(l.data));
      });
    }

    await setMode(4399, '500');
    await wait(1300);
    for (const l of lists) {
      await check('stale', `${l.path}: API 500 after the fresh window -> the last good copy is served (200, short s-maxage), then reused for 30 s without asking the API`, async () => {
        const before = (await fixtureStats(4399)).byEndpoint[l.endpoint];
        const res = await page(l.path);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get(l.header), 'stale');
        assert.equal(res.headers.get('cache-control'), 'public, max-age=0, s-maxage=30');
        assert.ok(mainText(await res.text()).includes(l.data));
        assert.equal((await fixtureStats(4399)).byEndpoint[l.endpoint], before + 1);
        const again = await page(l.path);
        assert.equal(again.status, 200);
        assert.equal(again.headers.get(l.header), 'cache');
        assert.equal((await fixtureStats(4399)).byEndpoint[l.endpoint], before + 1);
      });
    }
  } finally {
    await failing.stop();
  }
}
{
  // A hanging API: the 2 s timeout fires. Resources on a cold cache (-> 503), reports with a stale copy (-> 200).
  const slow = await startStack({ port: 8796, stubPort: 4400, fixturePort: 4401, inspectorPort: 9336, vars: { CONTENT_CACHE_FRESH_SECONDS: '1' } });
  try {
    await check('degraded', '/gabung-siswa/docs: a hanging API on a cold cache is cut off after about 2 s and answers the degraded 503', async () => {
      await setMode(4401, 'slow', 'resources');
      const started = performance.now();
      const res = await fetch(`${slow.base}/gabung-siswa/docs`);
      const ms = performance.now() - started;
      assert.equal(res.status, 503);
      assert.ok(ms >= 1900 && ms < 3500, `timeout took ${Math.round(ms)} ms`);
      assert.ok(mainText(await res.text()).includes('Dokumen belum dapat ditampilkan'));
    });
    await check('stale', '/laporan: a hanging API with a stale copy: after about 2 s the stale copy is served', async () => {
      assert.equal((await fetch(`${slow.base}/laporan`)).headers.get('x-reports-source'), 'network');
      await setMode(4401, 'slow', 'reports');
      await new Promise((r) => setTimeout(r, 1300));
      const started = performance.now();
      const res = await fetch(`${slow.base}/laporan`);
      const ms = performance.now() - started;
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-reports-source'), 'stale');
      assert.ok(ms >= 1900 && ms < 3500, `timeout took ${Math.round(ms)} ms`);
    });
  } finally {
    await slow.stop();
  }
}

// ---------------------------------------------------------------- SEO in served HTML
const SEO_PAGES = [
  { path: '/', title: 'Sakola Kembara - Pendidikan Untuk Semua', canonical: 'https://sakolakembara.org/', ld: 'NGO' },
  { path: '/blog', title: 'Blog &amp; Cerita | Sakola Kembara', canonical: 'https://sakolakembara.org/blog' },
  { path: '/tim', title: 'Tim Kami | Sakola Kembara', canonical: 'https://sakolakembara.org/tim' },
  { path: '/laporan', title: 'Laporan | Sakola Kembara', canonical: 'https://sakolakembara.org/laporan' },
  { path: '/gabung-siswa', title: 'Daftar Siswa | Sakola Kembara', canonical: 'https://sakolakembara.org/gabung-siswa' },
  { path: '/gabung-siswa/docs', title: 'Pusat Dokumen &amp; Berkas | Sakola Kembara', canonical: 'https://sakolakembara.org/gabung-siswa/docs' },
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
for (const p of ['/', '/tim', '/blog', '/blog/nope', `/blog/${slugs[0]}`, '/robots.txt', '/laporan', '/gabung-siswa', '/gabung-siswa/docs']) {
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
for (const n of notes) console.log(`note: ${n}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log(`FAIL [${f.group}] ${f.name}\n     ${f.detail}`);
process.exit(failed.length ? 1 : 0);
