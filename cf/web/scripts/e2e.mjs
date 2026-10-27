// End-to-end checks against the BUILT Worker running under `wrangler dev` (local
// mode, workerd), with the stub origin (a stand-in for the WordPress site behind the route) and the fixture content API behind it.
//
//   pnpm build && pnpm test:e2e
//
// Covers: status codes of every page type, the real 404, all 80 WordPress
// redirects, the other redirect rules, pass-through to the WordPress origin (method, headers, body,
// cookies, redirects not followed), Astro paths NOT reaching the origin, /tim
// timeout / cache / stale-if-error (also the Laporan section of /donasi, SAKEM-105, and /gabung-siswa/docs: grouping, anchors, copy
// buttons run in a DOM, degraded and empty states), the blog read from the content API (cache,
// stale-if-error, outage pages, 404, sitemap), the /kontak form without JavaScript (every status
// code of the contract, IP forwarding, no personal data in the log), SEO tags in the served HTML,
// security headers, images and PDFs served as static assets (never through the origin), and the shortlink
// redirect (`/<slug>` looked up through the API: 307, 404, 503, one call per visit, no cache), the registration link /daftar
// (a shortlink, SAKEM-103, with a polite page of its own when it has none), WordPress as the origin behind the route (only its own paths
// are forwarded, none of the new site's), and the student portal switch (PORTAL_ENABLED, off by default).
// Prints a summary and exits non-zero on any failure.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Window } from 'happy-dom';
import { PORT_OFFSET, TURNSTILE_TEST_SITE_KEY, startStack, webRoot } from './lib/harness.mjs';
import { STUB_TOKEN, turnstileStubSource } from './lib/turnstile-stub.mjs';
import { SAMPLE_REPORTS, SAMPLE_RESOURCES, SAMPLE_SHORTLINKS } from './fixture-api.mjs';
import { REDIRECTS, matchRedirect } from '../redirects.config.mjs';
import { LIMITS, assetUrl, variantUrl } from '../assets.config.mjs';
import { checkImgTag, localUrls, parseAttrs } from './lib/dist-audit.mjs';

if (!existsSync(path.join(webRoot, 'dist/server/wrangler.json'))) {
  console.error('dist/ is missing. Run `pnpm build` first.');
  process.exit(2);
}

const articles = JSON.parse(readFileSync(path.join(webRoot, '../../lib/blog-posts.json'), 'utf8')).articles;
const stack = await startStack({ log: path.join(webRoot, 'dist/e2e-wrangler.log'), vars: { TEAM_CACHE_FRESH_SECONDS: '2', CONTENT_CACHE_FRESH_SECONDS: '2', ADMIN_URL: 'https://admin.example.test' } });
const { base, stub } = stack;
const fixtureBase = `http://127.0.0.1:${stack.fixture.port}`;

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
// The JSON-LD of a page (SAKEM-090): ONE site graph per indexable page (Organization, WebSite, WebPage, usually a
// BreadcrumbList; an article adds BlogPosting and Person), then a block of its own where a page has one (a program's).
const ldBlocks = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const graphNodes = (html) => ldBlocks(html)[0]?.['@graph'] ?? [];
const nodeOf = (html, type) => graphNodes(html).find((n) => [].concat(n['@type']).includes(type));
/**
 * The navbar of a page while the portal is off (SAKEM-103; Dzul, 2026-10-15), as a list of problems (empty: as it should be): the logo and the
 * menu links, twice (the bar, the mobile menu), and NOTHING in the slot of the old "Masuk" button: no link or button, no wrapper, no text of a
 * sign-in or a registration. (The menu links are the labels of src/lib/site.ts; this script is plain JavaScript and cannot import them.)
 * And the desktop menu is packed to the RIGHT then (Dzul, 2026-10-16): its <ul> takes the third column of the grid. The classes are written out
 * here (MENU_OFF while the portal is off, MENU_ON while it is on: the menu in the centre column, as before) and are justify-end, not
 * justify-self-end: that word marks the wrapper of "Masuk" in this list, in the built tests and in check:production.
 */
const MENU_ON = '<ul class="hidden md:flex items-center gap-6 lg:gap-7">';
const MENU_OFF = '<ul class="hidden md:flex items-center gap-6 lg:gap-7 md:col-start-3 md:justify-end">';
const menuLists = (nav) => nav.match(/<ul class="hidden md:flex[^"]*">/g) ?? [];
function navbarProblems(html) {
  const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
  const menu = ['/', '/tim', '/gabung-siswa', '/donasi', '/blog']; // five items since SAKEM-105: the reports are a section of /donasi
  const hrefs = [...nav.matchAll(/<a\s[^>]*?href="([^"]*)"/g)].map((m) => m[1]);
  const problems = [];
  if (JSON.stringify(hrefs) !== JSON.stringify(['/', ...menu, ...menu])) problems.push(`links: ${hrefs.join(' ')}`);
  for (const bad of ['Daftar Sekarang', 'Masuk', '/daftar', '/portal', 'data-auth-link', 'justify-self-end', 'mt-6']) if (nav.includes(bad)) problems.push(`the navbar has ${bad}`);
  if ((nav.match(/<button\b/g) ?? []).length !== 1) problems.push('more than the menu toggle in the navbar');
  if (JSON.stringify(menuLists(nav)) !== JSON.stringify([MENU_OFF])) problems.push(`the desktop menu is not packed to the right: ${menuLists(nav).join(' ') || 'no menu'}`);
  if ((nav.match(/<ul class="flex flex-col gap-4">/g) ?? []).length !== 1) problems.push('the mobile menu is not as it was');
  return problems;
}
const onlySiteGraph = (html) => {
  assert.equal(ldBlocks(html).length, 1, "only the site graph, no block of the page's own");
  assert.ok(nodeOf(html, 'WebPage') || nodeOf(html, 'CollectionPage'), 'the graph has the page');
};

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
const decodeEntities = (t) => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const apiJson = async (p) => (await fetch(`${fixtureBase}${p}`)).json();
for (const slug of slugs) {
  await check('articles', `GET /blog/${slug}: 200 from the API data, one h1, title, canonical, og, Article JSON-LD, contentHtml as given`, async () => {
    clearStub();
    const res = await get(`/blog/${slug}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    assert.equal(res.headers.get('x-blog-source'), 'network');
    assert.equal(stubHits().length, 0);
    const html = await text(res);
    const { article } = await apiJson(`/api/public/blog/${slug}`);
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
    assert.equal(decodeEntities(tag(html, /<title>([^<]*)<\/title>/)), `${article.title} - Yayasan Sakola Kembara Indonesia`);
    assert.equal(tag(html, /<link rel="canonical" href="([^"]*)"/), `https://sakolakembara.org/blog/${slug}`);
    // SAKEM-090: the page's own meta description first (the migrated articles carry the one their WordPress page had), then the excerpt
    const description = article.description ?? article.excerpt;
    assert.equal(decodeEntities(tag(html, /<meta name="description" content="([^"]*)"/)), description);
    assert.equal(decodeEntities(tag(html, /<meta property="og:description" content="([^"]*)"/)), description);
    assert.equal(decodeEntities(tag(html, /<meta name="twitter:description" content="([^"]*)"/)), description);
    assert.match(tag(html, /<meta property="og:image" content="([^"]*)"/), /^https:\/\/sakolakembara\.org\//);
    // SAKEM-090: one @graph; the BlogPosting is the live site's type
    assert.equal(ldBlocks(html).length, 1);
    const post = nodeOf(html, 'BlogPosting');
    assert.equal(post.headline, article.title);
    assert.equal(post.description, description);
    assert.equal(nodeOf(html, 'WebPage').description, description);
    assert.equal(post.datePublished, article.dateISO);
    assert.equal(post.dateModified, article.modifiedISO);
    assert.equal(post.mainEntityOfPage['@id'], `https://sakolakembara.org/blog/${slug}#webpage`);
    assert.equal(post.image.url, tag(html, /<meta property="og:image" content="([^"]*)"/));
    assert.equal(post.inLanguage, 'id-ID');
    assert.deepEqual(nodeOf(html, 'BreadcrumbList').itemListElement.map((i) => i.name), ['Beranda', 'Blog', article.title]);
    assert.equal(tag(html, /<meta property="og:type" content="([^"]*)"/), 'article');
    assert.equal(tag(html, /<meta property="article:published_time" content="([^"]*)"/), article.dateISO);
    assert.equal(tag(html, /<meta property="article:modified_time" content="([^"]*)"/), article.modifiedISO);
    // the stored HTML is injected as it is (unescaped): the page holds it verbatim
    assert.ok(html.includes(`<div class="blog-content">${article.contentHtml}</div>`), 'contentHtml was changed on the way');
  });
}

// ---------------------------------------------------------------- 404
for (const p of ['/blog/does-not-exist', '/blog/DOES-NOT-EXIST', '/blog/a/b', '/a/b/c', '/404', '/_astro/missing.css', '/wp-admin-old/install.php', '/%E0%A4%A', '/_next/static/a.js', '/files/a.pdf', '/images/team/a.jpg']) {
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
  // SAKEM-103 (Phase A): the old registration form goes to the registration shortlink. /daftar itself is NOT a rule (group `registration`), and
  // neither are the auth names (/login is WordPress's, group `pass-through`; the others are the site's 404, group `portal-paths`).
  ['/gabung-siswa/form', 308, '/daftar'], ['/gabung-siswa/form?utm_source=ig', 308, '/daftar?utm_source=ig'],
  ['/tentang-kami', 308, '/tim'], ['/about', 308, '/tim'],
  // SAKEM-105: the reports are a section of /donasi. The old page and the older name each go straight to it, one hop, with the fragment in the
  // destination (the assets layer accepts it in `_redirects` and puts a query BEFORE it; the middleware does the same for the same table).
  ['/impact-reports', 308, '/donasi#laporan'], ['/impact-reports/2025/foo', 308, '/donasi#laporan'],
  ['/laporan', 308, '/donasi#laporan'], ['/laporan/', 308, '/donasi#laporan'],
  ['/laporan?utm_source=ig', 308, '/donasi?utm_source=ig#laporan'], ['/laporan/?utm_source=ig&x=1', 308, '/donasi?utm_source=ig&x=1#laporan'],
  ['/impact-reports/?utm_source=ig', 308, '/donasi?utm_source=ig#laporan'],
  ['/blog/page/3', 308, '/blog?page=3'], ['/blog/page/3/', 308, '/blog?page=3'],
  ['/feed', 308, '/blog'], ['/feed/atom', 308, '/blog'],
  ['/index.php', 308, '/'],
  // SAKEM-103: a WordPress upload this build copied is one 308 to its copy (a rule per file, written at build time)
  ['/wp-content/uploads/2025/10/1.png', 308, '/blog/images/2025/10/1.png'],
  ['/wp-content/uploads/2025/10/1.png?ver=3', 308, '/blog/images/2025/10/1.png?ver=3'],
  ['/program', 307, '/program/prapembinaan'],
  ['/cerita/some-slug?utm_source=x', 308, '/blog/some-slug?utm_source=x'],
  ['/blog/page/2?utm_source=x', 308, '/blog?page=2'], // the destination has its own query: the incoming one is dropped
  // SAKEM-090: the WordPress pages and archives of the live sitemap, with the trailing slash WordPress used and without it.
  ...[
    ['/home', '/'], ['/sample-page', '/'], ['/who-we-are', '/tim'], ['/our-partners', '/tim'], ['/contact-us', '/kontak'],
    ['/donate', '/donasi'], ['/donation-confirmation', '/donasi'], ['/donation-confirmation-2', '/donasi'],
    ['/donation-failed', '/donasi'], ['/donation-failed-2', '/donasi'], ['/donor-dashboard', '/donasi'],
    ['/donor-dashboard-2', '/donasi'], ['/work-with-us', '/gabung-siswa'],
  ].flatMap(([from, to]) => [[from, 308, to], [`${from}/`, 308, to]]),
  ...['/category/cerita', '/category/kiat-kiat', '/category/news', '/category/education', '/category/tips', '/category/testimonials', '/category/career',
    '/tag/ekonomi', '/tag/sakola-kembara', '/tag/snbt', '/tag/pendidkan'].flatMap((from) => [[from, 308, '/blog'], [`${from}/`, 308, '/blog']]),
  ['/category/news/feed/', 308, '/blog'], ['/tag/ekonomi/page/2/', 308, '/blog'], ['/tag/ekonomi/?utm_source=ig', 308, '/blog?utm_source=ig'],
  ['/donate/?utm_source=ig', 308, '/donasi?utm_source=ig'],
  ['/blog/perjalanan-seorang-founder-rommy-mendirikan-sakola-kembara-untuk-pendidikan-inklusif', 308, '/blog/perjalanan-seorang-founder'],
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
await check('redirects', 'SAKEM-090: every WordPress page and archive of the live sitemap reaches a 200 in exactly one permanent hop, no loop (the real server, hop by hop)', async () => {
  const sources = [
    '/home/', '/sample-page/', '/who-we-are/', '/our-partners/', '/contact-us/', '/donate/', '/donation-confirmation/', '/donation-confirmation-2/',
    '/donation-failed/', '/donation-failed-2/', '/donor-dashboard/', '/donor-dashboard-2/', '/work-with-us/', '/tentang-kami/',
    '/category/news/', '/category/cerita/', '/tag/ekonomi/', '/tag/sakola-kembara/',
  ];
  for (const from of sources) {
    let at = from;
    const trail = [at];
    for (let hop = 0; hop < 10; hop++) {
      const res = await get(at);
      if (res.status === 200) break;
      assert.equal(res.status, 308, `${trail.join(' -> ')}: ${res.status}`);
      at = res.headers.get('location');
      assert.ok(!trail.includes(at), `redirect loop: ${trail.join(' -> ')} -> ${at}`);
      trail.push(at);
    }
    const last = await get(at);
    assert.equal(last.status, 200, `${from} ends on ${at}, which answers ${last.status}`);
    // /tentang-kami is itself a rule (to /tim), so it is one hop; every other source is one hop as well
    assert.equal(trail.length, 2, `${from}: ${trail.join(' -> ')}`);
  }
});
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
// F-03 of the cutover runbook: the assets layer answers a trailing-slash request for a PRERENDERED page with its own 307; since
// SAKEM-090 `_redirects` carries `/<page>/  /<page>  308` for each, and (here, in the local emulation of the layer) it wins.
// (/donasi is not one of them since SAKEM-105: it is rendered by the Worker, which folds its slash itself, checked just below.)
for (const page of ['/gabung-siswa', '/program/prapembinaan', '/program/pembinaan', '/program/pasca-pembinaan']) {
  await check('canonical-url', `${page}/ -> 308 ${page} (not the layer's 307), the query kept, no Worker request to the origin; ${page} itself is a 200`, async () => {
    clearStub();
    const res = await get(`${page}/`);
    assert.equal(res.status, 308);
    assert.equal(res.headers.get('location'), page);
    const withQuery = await get(`${page}/?utm_source=ig`);
    assert.equal(withQuery.status, 308);
    assert.equal(withQuery.headers.get('location'), `${page}?utm_source=ig`);
    assert.equal(stubHits().length, 0);
    assert.equal((await get(page)).status, 200);
  });
}
await check('canonical-url', '/donasi/ (a page the Worker renders since SAKEM-105): the Worker folds the slash, one 308, the query kept', async () => {
  clearStub();
  const res = await get('/donasi/');
  assert.equal(res.status, 308);
  assert.equal(res.headers.get('location'), '/donasi');
  const withQuery = await get('/donasi/?utm_source=ig');
  assert.equal(withQuery.status, 308);
  assert.equal(withQuery.headers.get('location'), '/donasi?utm_source=ig');
  assert.equal(stubHits().length, 0);
});
await check('canonical-url', 'a WordPress path with a trailing slash is not touched: the origin decides (WordPress redirects it itself)', async () => {
  clearStub();
  const res = await get('/wp-content/themes/astra/');
  assert.notEqual(res.status, 308);
  assert.equal(res.headers.get('x-stub-origin'), '1');
  assert.equal(stubHits().length, 1);
});
await check('canonical-url', 'an article with a trailing slash: the Worker sends it to the clean URL (308)', async () => {
  const res = await get(`/blog/${slugs[0]}/`);
  assert.equal(res.status, 308);
  assert.equal(res.headers.get('location'), `/blog/${slugs[0]}`);
});

// ---------------------------------------------------------------- pass-through
// SAKEM-103 (Phase A of the cutover): WordPress is the origin behind the Worker's route, so what is forwarded to it (here: the stub origin,
// scripts/stub-origin.mjs) is WordPress's own paths and nothing else: /wp-admin, /wp-login.php, /wp-content, /wp-includes, /wp-json,
// /xmlrpc.php and /login (src/lib/legacy-paths.ts). Everything the new site serves never reaches it, and the old Next paths (/_next, /images,
// /files, /reports, /resources) are not forwarded any more. The admin and the API are the Worker's own answers (a 308, a JSON 404), and the
// student portal's names are the site's 404 in Phase A (the portal is not live; Phase B attaches a Worker to /portal/*).
const ADMIN_URL = 'https://admin.example.test';
for (const [from, to] of [
  ['/admin', `${ADMIN_URL}/`],
  ['/admin/', `${ADMIN_URL}/`],
  ['/admin/blog', `${ADMIN_URL}/blog`],
  ['/admin/blog/new?x=1&y=%20z', `${ADMIN_URL}/blog/new?x=1&y=%20z`],
  ['/admin/applications?status=pending', `${ADMIN_URL}/applications?status=pending`],
  ['/admin//evil.example', `${ADMIN_URL}/evil.example`],
]) {
  await check('portal-paths', `GET ${from} is a 308 to the admin host: ${to}, and never reaches the origin`, async () => {
    clearStub();
    const res = await get(from);
    assert.equal(res.status, 308);
    assert.equal(res.headers.get('location'), to);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', 'the security headers are on it');
    assert.equal(stubHits().length, 0);
  });
}
await check('portal-paths', 'a POST to /admin is redirected the same way (a 308 keeps the method)', async () => {
  clearStub();
  const res = await get('/admin/blog', { method: 'POST', body: 'x' });
  assert.equal(res.status, 308);
  assert.equal(res.headers.get('location'), `${ADMIN_URL}/blog`);
  assert.equal(stubHits().length, 0);
});
for (const p of ['/administrator', '/adminx/y']) {
  await check('portal-paths', `GET ${p} is not /admin: the site's own 404`, async () => {
    clearStub();
    const res = await get(p);
    assert.equal(res.status, 404);
    assert.match(await text(res), /Halaman tidak ditemukan/);
    assert.equal(stubHits().length, 0);
  });
}
for (const [p, method] of [
  ['/api', 'GET'], ['/api/', 'GET'], ['/api/auth/session', 'GET'], ['/api/announcements/current', 'GET'], ['/api/sso/session', 'GET'],
  ['/api/admin/users', 'GET'], ['/api/auth/callback/credentials?x=1', 'POST'], ['/api/anything', 'DELETE'],
]) {
  await check('portal-paths', `${method} ${p}: a JSON 404 from this Worker (the apex has no API), nothing reaches the origin or the API Worker`, async () => {
    clearStub();
    const res = await get(p, method === 'POST' || method === 'DELETE' ? { method, body: p.includes('?') ? 'x' : undefined } : {});
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { error: 'not_found' });
    assert.equal(stubHits().length, 0);
  });
}
await check('portal-paths', '/apis and /api-docs are not /api: the site\'s own 404 page', async () => {
  for (const p of ['/apis', '/api-docs']) {
    const res = await get(p);
    assert.equal(res.status, 404, p);
    assert.match(await text(res), /Halaman tidak ditemukan/, p);
  }
});
// SAKEM-103, the choice for Phase A (recorded in docs/cloudflare/web-skeleton.md, "Phase A"): the student portal is not live, so /portal and
// below, /register and the three other auth names answer the site's own polite 404 page (the same words as every unknown URL, noindex, a real
// 404 status). They are not looked up as shortlinks (the names are reserved), never reach the origin, and are not redirected anywhere.
const apiAsked = async () => (await fetch(`${fixtureBase}/__requests?for=shortlink`)).json();
for (const p of ['/portal', '/portal/', '/portal/status', '/portal/daftar', '/portal/login', '/portal/api/me', '/portal/api/auth/get-session', '/register', '/register/', '/forgot-password', '/reset-password', '/verify-email', '/register?x=1']) {
  await check('portal-paths', `GET ${p}: the portal is not live, so it is the site's own 404 page (noindex); no redirect, no shortlink lookup, nothing reaches the origin`, async () => {
    clearStub();
    const askedBefore = (await apiAsked()).length;
    const res = await get(p);
    // a trailing slash is folded first (308), and then the same 404
    const final = res.status === 308 ? await get(res.headers.get('location')) : res;
    assert.equal(final.status, 404, `${p}: ${final.status}`);
    const html = await text(final);
    assert.match(html, /Halaman tidak ditemukan/);
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.ok(!/portal|daftar/i.test(html.slice(html.indexOf('<div id="konten-utama">'), html.indexOf('</main>'))), 'the page body does not promise a portal or a form');
    assert.equal(final.headers.get('location'), null);
    assert.equal((await apiAsked()).length, askedBefore, 'the API is not asked for a shortlink');
    assert.equal(stubHits().length, 0);
    assert.equal(final.headers.get('x-stub-origin'), null);
  });
}
await check('portal-paths', '/login and the five other auth paths of the old Next app are NOT redirects any more: no 308 into /portal anywhere', async () => {
  clearStub();
  for (const p of ['/register', '/forgot-password', '/reset-password', '/verify-email', '/gabung-siswa/form']) {
    const res = await get(p);
    assert.ok(!(res.headers.get('location') ?? '').includes('/portal'), `${p} -> ${res.headers.get('location')}`);
  }
  const login = await get('/login');
  assert.ok(!(login.headers.get('location') ?? '').includes('/portal'), `/login -> ${login.headers.get('location')}`);
});

// WordPress paths: forwarded untouched. The stand-in origin (scripts/stub-origin.mjs) answers like WordPress and echoes what it received.
const WORDPRESS_PATHS = [
  '/wp-admin', '/wp-admin/', '/wp-admin/install.php', '/wp-admin/admin-ajax.php', '/wp-login.php', '/wp-content/themes/astra/style.css',
  '/wp-content/plugins/elementor/assets/a.js', '/wp-content/uploads/2099/01/not-copied.jpg', '/wp-includes/js/jquery/jquery.min.js', '/wp-json/',
  '/wp-json/wp/v2/posts', '/xmlrpc.php', '/login', '/login/',
];
for (const p of WORDPRESS_PATHS) {
  await check('pass-through', `GET ${p} is WordPress's: it reaches the origin (same path, no rewrite, no render by the Worker), and the answer is the origin's`, async () => {
    clearStub();
    const res = await get(p);
    assert.equal(res.headers.get('x-stub-origin'), '1', `${p}: the answer is not the origin's (${res.status})`);
    const hits = stubHits();
    assert.equal(hits.length, 1, `${p}: ${hits.length} requests reached the origin`);
    assert.equal(hits[0].path, p.split('?')[0]);
    assert.equal(hits[0].method, 'GET');
    assert.notEqual(res.status, 404, `${p} is a path of the origin: the stub answers it`);
  });
}
await check('pass-through', 'the query string goes along, byte for byte, and a trailing slash is the origin\'s business, not folded by the Worker', async () => {
  clearStub();
  const res = await get('/wp-content/themes/astra/?ver=6.4&x=%20y');
  assert.equal(res.status, 200);
  assert.equal(stubHits()[0].path, '/wp-content/themes/astra/');
  assert.equal(stubHits()[0].search, '?ver=6.4&x=%20y');
  clearStub();
  const login = await get('/login/');
  assert.equal(login.status, 302, 'the Worker did not fold /login/ with a 308 of its own');
  assert.equal(stubHits().length, 1);
});
await check('pass-through', 'a redirect of the origin is NOT followed: the browser gets it, and its Location points at the host the browser used (/login -> /wp-login.php, /wp-admin/ -> the sign-in form)', async () => {
  clearStub();
  const login = await get('/login');
  assert.equal(login.status, 302);
  assert.equal(login.headers.get('location'), `${base}/wp-login.php`, 'the origin\'s own address is not leaked');
  assert.equal(stubHits().length, 1, 'only the first request went to the origin: the Worker did not follow the redirect');
  clearStub();
  const admin = await get('/wp-admin/');
  assert.equal(admin.status, 302);
  assert.equal(admin.headers.get('location'), '/wp-login.php?redirect_to=%2Fwp-admin%2F&reauth=1');
  assert.equal(stubHits().length, 1);
});
await check('pass-through', 'a cookie is preserved: the origin sees it exactly, and answers 200', async () => {
  clearStub();
  const res = await get('/wp-admin/admin-ajax.php', { headers: { cookie: 'stub_auth=1; other=2' } });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '0');
  assert.equal(stubHits()[0].headers.cookie, 'stub_auth=1; other=2');
});
await check('pass-through', 'two Set-Cookie headers from the origin arrive as two (the sign-in form sets its test cookie), and a POST sign-in answers a 302 with two more, none followed', async () => {
  const form = await get('/wp-login.php');
  const cookies = form.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.match(cookies[0], /^stub_test_cookie=check/);
  assert.match(cookies[1], /^stub_other=2/);
  clearStub();
  const post = await get('/wp-login.php', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'log=invented&pwd=invented' });
  assert.equal(post.status, 302);
  assert.equal(post.headers.get('location'), '/wp-admin/');
  assert.equal(post.headers.getSetCookie().length, 2);
  assert.equal(stubHits()[0].method, 'POST');
  assert.equal(stubHits()[0].body, 'log=invented&pwd=invented');
  assert.equal(stubHits().length, 1);
});
await check('pass-through', 'POST: method, query, body and custom headers arrive unchanged', async () => {
  clearStub();
  const payload = JSON.stringify({ title: 'tes', n: 'α β ✓' });
  const res = await get('/wp-json/stub/echo/posts?x=1&y=%20z', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-custom': 'abc', 'x-wp-nonce': 'deadbeef', authorization: 'Bearer fake', cookie: 'a=b' },
    body: payload,
  });
  assert.equal(res.status, 200);
  const seen = stubHits()[0];
  assert.equal(seen.method, 'POST');
  assert.equal(seen.path, '/wp-json/stub/echo/posts');
  assert.equal(seen.search, '?x=1&y=%20z');
  assert.equal(seen.body, payload);
  for (const [k, v] of Object.entries({ 'content-type': 'application/json', 'x-custom': 'abc', 'x-wp-nonce': 'deadbeef', authorization: 'Bearer fake', cookie: 'a=b' })) {
    assert.equal(seen.headers[k], v, k);
  }
  const echoed = await res.json();
  assert.equal(echoed.body, payload);
});
await check('pass-through', 'POST to /xmlrpc.php reaches the origin (an XML body), and a GET gets WordPress\'s own 405', async () => {
  clearStub();
  const xml = '<?xml version="1.0"?><methodCall><methodName>system.listMethods</methodName></methodCall>';
  const post = await get('/xmlrpc.php', { method: 'POST', headers: { 'content-type': 'text/xml' }, body: xml });
  assert.equal(post.status, 200);
  assert.equal(stubHits()[0].method, 'POST');
  assert.equal(stubHits()[0].body, xml);
  const getRes = await get('/xmlrpc.php');
  assert.equal(getRes.status, 405);
  assert.match(await text(getRes), /XML-RPC server accepts POST requests only/);
});
await check('pass-through', 'a 1 MB POST body goes through intact', async () => {
  clearStub();
  const big = 'x'.repeat(1_000_000);
  const res = await get('/wp-json/stub/echo/upload', { method: 'POST', body: big, headers: { 'content-type': 'text/plain' } });
  assert.equal(res.status, 200);
  assert.equal(stubHits()[0].body.length, 1_000_000);
});
await check('pass-through', 'PUT, PATCH, DELETE and HEAD keep their method', async () => {
  for (const method of ['PUT', 'PATCH', 'DELETE', 'HEAD']) {
    clearStub();
    const res = await get('/wp-json/stub/echo/x', { method, ...(method === 'HEAD' || method === 'DELETE' ? {} : { body: 'b' }) });
    assert.equal(res.status, 200, method);
    assert.equal(stubHits()[0].method, method);
  }
});
await check('pass-through', 'hop-by-hop request headers (te, keep-alive, proxy-authorization) are not forwarded', async () => {
  clearStub();
  // fetch() refuses to send some of these, so use a raw request.
  const status = await new Promise((resolve, reject) => {
    const req = http.request(
      `${base}/wp-json/stub/echo/x`,
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
  const res = await get('/wp-content/uploads/2099/01/not-copied.jpg');
  assert.equal(res.headers.get('keep-alive'), null);
  assert.equal(res.headers.get('transfer-encoding') === null || res.headers.get('transfer-encoding') === 'chunked', true);
});
await check('pass-through', 'the origin sees the original host as X-Forwarded-Host (local mode)', async () => {
  clearStub();
  await get('/wp-json/stub/echo/x');
  assert.equal(stubHits()[0].headers['x-forwarded-host'], new URL(base).host);
  assert.equal(stubHits()[0].headers['x-forwarded-proto'], 'http');
});
await check('pass-through', 'origin cache headers survive, and the Worker adds none of its own to an origin answer (the origin\'s headers are untouched, security headers included)', async () => {
  const res = await get('/wp-includes/js/a.js');
  assert.match(res.headers.get('cache-control'), /immutable/);
  const upload = await get('/wp-content/uploads/2099/01/not-copied.jpg');
  assert.equal(upload.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  assert.equal(upload.headers.get('content-type'), 'image/jpeg');
  for (const name of ['strict-transport-security', 'x-frame-options', 'x-content-type-options', 'permissions-policy', 'referrer-policy']) {
    assert.equal(upload.headers.get(name), null, `${name} is the origin's to set on its own answers`);
  }
});

// Strictness, from the other side: a name that merely LOOKS like a WordPress path is the Worker's. It never reaches the origin, so a page of the
// new site can never be mistaken for WordPress (and WordPress can never be mistaken for a page of the new site).
for (const p of [
  '/wp-adminx', '/wp-admin-old/install.php', '/wp-login', '/wp-login.phpx', '/wp-login.php.bak', '/wp-login.php/x', '/wp-contentx/a.css', '/wp-contents/a.css', '/wp-includesx/a.js',
  '/wp-jsonx', '/xmlrpc', '/xmlrpc.phpx', '/xmlrpc.php/x', '/login/x', '/login-help', '/loginx', '/Login', '/WP-ADMIN/', '/Wp-Content/a.css', '/blog/wp-admin', '/x/login',
]) {
  await check('pass-through', `${p} only looks like WordPress: it never reaches the origin (the Worker's own 404 or shortlink lookup)`, async () => {
    clearStub();
    const res = await get(p);
    assert.equal(stubHits().length, 0, `${p} reached the origin`);
    assert.equal(res.headers.get('x-stub-origin'), null);
    assert.ok([404, 308].includes(res.status), `${p}: ${res.status}`);
  });
}
await check('pass-through', 'the new site never reaches the origin: every page, redirect, shortlink, the admin and the API, the portal names and every old Next path', async () => {
  clearStub();
  const paths = [
    // (not /tim, /gabung-siswa/docs or /sitemap.xml: the groups after this one expect their first request to reach the API; the e2e checks them one by one
    // for "never reaches the origin" in their own groups)
    '/', '/blog', '/blog?page=2', `/blog/${slugs[0]}`, '/gabung-siswa', '/gabung-siswa/form', '/donasi', '/kontak',
    '/program/prapembinaan', '/program', '/robots.txt', '/404', '/no-such-page', '/no-such/page/deep', '/cerita/some-slug', '/category/news', '/feed', '/index.php',
    '/daftar', '/daftar/', '/daftar-2026', '/gabung', '/unduh-panduan', '/no-such-link',
    '/portal', '/portal/status', '/register', '/forgot-password', '/reset-password', '/verify-email',
    '/admin', '/admin/blog', '/api', '/api/anything',
    '/_next/static/a.js', '/_next/image', '/images/team/a.jpg', '/blog/images/2099/01/not-copied.jpg', '/files/a.pdf', '/reports/2025/a.pdf', '/resources/a.pdf',
    '/wp-content/uploads/2025/10/1.png', // a copied upload: one 308 to its copy, answered before the Worker
    '/wp-content/uploads/2025/10/1.png?x=1',
  ];
  for (const p of paths) await get(p);
  assert.deepEqual(stubHits().map((h) => h.path), [], 'a request of the new site reached the origin');
});
await check('pass-through', 'an upload the build copied is a 308 to its copy and one the build did not copy is WordPress\'s (the choice behind F-05: no splat over /wp-content/uploads), and an @ in a name is one hop', async () => {
  clearStub();
  const copied = await get('/wp-content/uploads/2025/10/1.png');
  assert.equal(copied.status, 308);
  assert.equal(copied.headers.get('location'), '/blog/images/2025/10/1.png');
  assert.equal((await get(copied.headers.get('location'))).status, 200, 'the copy is a static asset');
  assert.equal(stubHits().length, 0);
  const at = await get('/wp-content/uploads/2026/04/IMG_9167@-1353469099-Azkiya-Najwah-3-scaled.jpg');
  assert.equal(at.status, 308);
  assert.equal(at.headers.get('location'), '/blog/images/2026/04/IMG_9167%40-1353469099-Azkiya-Najwah-3-scaled.jpg', 'the %40 form directly, so no second hop');
  assert.equal((await get(at.headers.get('location'))).status, 200, 'the %40 address is served as it is, with no redirect of its own');
  assert.equal(stubHits().length, 0);
  const other = await get('/wp-content/uploads/2099/01/not-copied.jpg');
  assert.equal(other.status, 200);
  assert.equal(other.headers.get('x-stub-origin'), '1');
  assert.equal(stubHits().length, 1);
});
await check('portal-paths', 'no navbar of any kind of page asks the portal Worker for a session while the portal is off: no script has the address, no page has it', async () => {
  clearStub();
  for (const p of ['/', '/blog', '/gabung-siswa', '/kontak', '/no-such-page', '/daftar']) {
    const html = await text(await get(p));
    assert.ok(!html.includes('get-session'), `${p}: the session call is in the page`);
    assert.ok(!html.includes('/portal'), `${p}: a path of the portal is in the page`);
    assert.ok(!html.includes('data-auth-link'), p);
  }
  assert.equal(stubHits().length, 0);
});
await check('portal-paths', 'the slot of the old "Masuk" button is EMPTY while the portal is off, in the bar and in the mobile menu, on every kind of page: only the logo and the menu links, no button, no wrapper, no "Daftar Sekarang", no "Masuk"', async () => {
  for (const p of ['/', '/blog', '/gabung-siswa', '/kontak', '/donasi', '/program/pembinaan', '/no-such-page']) {
    const html = await text(await get(p));
    assert.deepEqual(navbarProblems(html), [], p);
    assert.ok(!/href="\/(portal\/)?login"/.test(html), p);
  }
});

// shortlinks (SAKEM-082): `/<slug>` is looked up through the API Worker, one call per visit, and the legacy origin
// is not asked any more. The fixture API stands in for the real one and counts a click for every link it finds.
const shortlinkAsked = async () => (await fetch(`${fixtureBase}/__requests?for=shortlink`)).json();
const shortlinkClicks = async () => (await fetch(`${fixtureBase}/__clicks`)).json();
const shortlinkMode = (m) => fetch(`${fixtureBase}/__mode?for=shortlink&m=${m}`, { method: 'POST' });
/** What a visit changed at the fixture API: the paths it was asked for, and the clicks it counted. */
async function visiting(fn) {
  const asked = (await shortlinkAsked()).length;
  const clicks = await shortlinkClicks();
  const result = await fn();
  const after = await shortlinkClicks();
  const counted = {};
  for (const [slug, n] of Object.entries(after)) if (n !== (clicks[slug] ?? 0)) counted[slug] = n - (clicks[slug] ?? 0);
  return { result, asked: (await shortlinkAsked()).slice(asked), counted };
}

await check('shortlinks', '/daftar-2026 is a 307 to its target: Location, not cacheable, the site security headers; one call to the API, one click, the legacy origin not asked', async () => {
  clearStub();
  const { result: res, asked, counted } = await visiting(() => get('/daftar-2026'));
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('location'), 'https://example.org/form');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('strict-transport-security'), 'max-age=300', 'HSTS is staged: five minutes, no includeSubDomains, no preload');
  assert.equal(await res.text(), '');
  assert.deepEqual(asked, ['/api/public/shortlinks/daftar-2026']);
  assert.deepEqual(counted, { 'daftar-2026': 1 });
  assert.equal(stubHits().length, 0, 'the legacy origin must not be asked');
});
await check('shortlinks', 'a path of this site is a target too: Location is that path, the query kept as stored', async () => {
  const { result: res } = await visiting(() => get('/gabung'));
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('location'), '/gabung-siswa?utm_source=ig');
});
await check('shortlinks', '/daftar-2026/ : the trailing slash is folded with a 308 first (like Next), without a call to the API; then the link opens', async () => {
  const folded = await visiting(() => get('/daftar-2026/'));
  assert.equal(folded.result.status, 308);
  assert.equal(folded.result.headers.get('location'), '/daftar-2026');
  assert.deepEqual(folded.asked, []);
  const opened = await visiting(() => get('/daftar-2026'));
  assert.equal(opened.result.status, 307);
  assert.deepEqual(opened.counted, { 'daftar-2026': 1 });
});
await check('shortlinks', 'upper case is looked up as lower case (the legacy resolver lower-cased the slug)', async () => {
  const { result: res, asked } = await visiting(() => get('/Daftar-2026'));
  assert.equal(res.status, 307);
  assert.deepEqual(asked, ['/api/public/shortlinks/daftar-2026']);
});
await check('shortlinks', 'nothing is cached: 12 visits are 12 calls to the API and 12 clicks, every one a 307', async () => {
  const { result: statuses, asked, counted } = await visiting(async () => {
    const out = [];
    for (let n = 0; n < 12; n++) out.push((await get('/unduh-panduan')).status);
    return out;
  });
  assert.deepEqual(statuses, Array(12).fill(307));
  assert.equal(asked.length, 12);
  assert.deepEqual(counted, { 'unduh-panduan': 12 });
});
await check('shortlinks', 'HEAD is a visit too (a link checker or a preview bot): 307 and a click', async () => {
  const { result: res, counted } = await visiting(() => get('/daftar-2026', { method: 'HEAD' }));
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('location'), 'https://example.org/form');
  assert.deepEqual(counted, { 'daftar-2026': 1 });
});
await check('shortlinks', 'other methods are not visits: a POST to a slug is the 404, without a call to the API', async () => {
  const { result: res, asked } = await visiting(() => get('/daftar-2026', { method: 'POST', headers: { origin: base }, body: 'x' }));
  assert.equal(res.status, 404);
  assert.deepEqual(asked, []);
});
await check('shortlinks', "an unknown valid slug (or one switched off: the API says the same for both) is the site's own 404, one call, no click", async () => {
  clearStub();
  const { result: res, asked, counted } = await visiting(() => get('/no-such-link'));
  assert.equal(res.status, 404);
  const html = await res.text();
  assert.match(html, /Halaman tidak ditemukan/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.equal(res.headers.get('x-stub-origin'), null, 'the legacy origin must not answer');
  assert.deepEqual(asked, ['/api/public/shortlinks/no-such-link']);
  assert.deepEqual(counted, {});
  assert.equal(stubHits().length, 0);
});
await check('shortlinks', '/apply is no redirect rule (SAKEM-107): it is a free name like any other, so the API is asked once, and with no shortlink it is the site\'s own 404', async () => {
  clearStub();
  const { result: res, asked, counted } = await visiting(() => get('/apply'));
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('location'), null);
  assert.match(await res.text(), /Halaman tidak ditemukan/);
  assert.equal(res.headers.get('x-stub-origin'), null, 'the legacy origin must not answer');
  assert.deepEqual(asked, ['/api/public/shortlinks/apply']);
  assert.deepEqual(counted, {});
  assert.equal(stubHits().length, 0);
  assert.equal(matchRedirect('/apply'), null);
});
for (const p of ['/no_such_link', '/a--b', '/-a', `/${'a'.repeat(65)}`, '/has.dot', '/a%20b', '/%E0%A4%A']) {
  await check('shortlinks', `${p.slice(0, 20)} cannot be a slug: 404 from the Worker, the API not asked`, async () => {
    clearStub();
    const { result: res, asked } = await visiting(() => get(p));
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('x-stub-origin'), null);
    assert.deepEqual(asked, []);
    assert.equal(stubHits().length, 0);
  });
}
await check('shortlinks', 'static pages and the pages of the Worker win over the catch-all: they never ask the API for a shortlink', async () => {
  clearStub();
  const { asked } = await visiting(async () => {
    for (const p of ['/', '/blog', '/tim', '/kontak', '/donasi', '/gabung-siswa', '/robots.txt', '/program/pembinaan']) await get(p);
  });
  assert.deepEqual(asked, []);
  assert.equal(stubHits().length, 0);
});
await check('shortlinks', 'the names the portal owns (/portal, /admin, /api, the old auth pages) are reserved: they never ask the API for a shortlink either', async () => {
  clearStub();
  const { asked } = await visiting(async () => {
    for (const p of ['/portal', '/admin', '/api', '/register', '/forgot-password', '/reset-password', '/verify-email']) await get(p);
  });
  assert.deepEqual(asked, []);
  assert.equal(stubHits().length, 0);
});
await check('shortlinks', 'the names WordPress owns are reserved too (SAKEM-103): the forwarded ones never ask the API, and neither does another spelling of them (/Login, /WP-ADMIN, /Wp-Json lower-case to a reserved name)', async () => {
  clearStub();
  const { asked } = await visiting(async () => {
    for (const p of ['/wp-admin', '/wp-json', '/wp-content', '/wp-includes', '/login', '/wp-login.php', '/xmlrpc.php']) await get(p);
    for (const p of ['/Login', '/LOGIN', '/WP-ADMIN', '/Wp-Json', '/WP-CONTENT', '/Wp-Includes']) {
      const res = await get(p);
      assert.equal(res.status, 404, p);
    }
  });
  assert.deepEqual(asked, []);
  assert.equal(stubHits().filter((h) => /^\/(Login|LOGIN|WP-|Wp-)/.test(h.path)).length, 0, 'another spelling is not WordPress\'s');
});
await check('shortlinks', 'when the API cannot answer the visitor gets a 503 (never a 404, never a redirect), told to retry, and nothing is cached', async () => {
  try {
    for (const mode of ['500', '429', 'badjson', 'html404', 'unsafe']) {
      await shortlinkMode(mode);
      const { result: res, counted } = await visiting(() => get('/daftar-2026'));
      assert.equal(res.status, 503, `mode ${mode}`);
      assert.equal(res.headers.get('location'), null, `mode ${mode}: nothing to follow`);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal(res.headers.get('retry-after'), '30');
      assert.match(await res.text(), /Tautan ini belum dapat dibuka saat ini\./);
      assert.deepEqual(counted, {}, `mode ${mode}`);
    }
  } finally {
    await shortlinkMode('ok');
  }
});
await check('shortlinks', 'an API that is too slow is cut off after about 2 s: 503, then the link works again', async () => {
  try {
    await shortlinkMode('slow');
    const started = performance.now();
    const res = await get('/daftar-2026');
    assert.equal(res.status, 503);
    assert.ok(performance.now() - started < 4500, 'the visitor is not kept waiting for the 5 s answer');
  } finally {
    await shortlinkMode('ok');
  }
  assert.equal((await get('/daftar-2026')).status, 307);
});
await check('shortlinks', 'the log of a failed lookup holds a fixed reason and never the slug', async () => {
  assert.match(stack.output(), /shortlink api: status 500/);
  assert.doesNotMatch(stack.output(), /shortlink api:[^\n]*(daftar-2026|no-such-link|unduh-panduan)/);
});

// ---------------------------------------------------------------- the registration shortlink (SAKEM-103, Phase A of the cutover)
// Every "Daftar Sekarang" goes to /daftar, an ADMIN shortlink (D1, looked up through the API Worker like any other): a 307 to the form of
// the current cohort, so a new cohort changes the shortlink's target in the admin and nothing is deployed. The address of the form is in no
// file of this repository: the fixture API stands in for the admin's D1 here, with an invented target. When no shortlink answers, the visitor
// gets a polite page of its own (a real 404 status, noindex, never cached) instead of the generic 404.
await check('registration', '/daftar is a 307 to the form the admin pointed it at: Location, no-store, the staged HSTS, one call to the API, one click; the origin is not asked, and no redirect rule of the Worker is involved', async () => {
  clearStub();
  const { result: res, asked, counted } = await visiting(() => get('/daftar'));
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('location'), SAMPLE_SHORTLINKS.daftar);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('strict-transport-security'), 'max-age=300');
  assert.equal(await res.text(), '');
  assert.deepEqual(asked, ['/api/public/shortlinks/daftar']);
  assert.deepEqual(counted, { daftar: 1 });
  assert.equal(stubHits().length, 0);
  assert.equal(matchRedirect('/daftar'), null);
});
await check('registration', '/daftar/ (the address WordPress used, with the slash) is folded with a 308 to /daftar without a call to the API, the query kept; then the link opens (a 307)', async () => {
  const folded = await visiting(() => get('/daftar/'));
  assert.equal(folded.result.status, 308);
  assert.equal(folded.result.headers.get('location'), '/daftar');
  assert.deepEqual(folded.asked, []);
  const withQuery = await get('/daftar/?utm_source=ig');
  assert.equal(withQuery.status, 308);
  assert.equal(withQuery.headers.get('location'), '/daftar?utm_source=ig');
  const opened = await visiting(() => get('/daftar?utm_source=ig'));
  assert.equal(opened.result.status, 307);
  assert.equal(opened.result.headers.get('location'), SAMPLE_SHORTLINKS.daftar);
  assert.deepEqual(opened.counted, { daftar: 1 });
});
await check('registration', 'upper case is the same link (/Daftar, /DAFTAR/), HEAD is a visit (a 307 and a click), and a POST is not (the generic 404, no call)', async () => {
  const upper = await visiting(() => get('/Daftar'));
  assert.equal(upper.result.status, 307);
  assert.deepEqual(upper.asked, ['/api/public/shortlinks/daftar']);
  const slashed = await get('/DAFTAR/');
  assert.equal(slashed.status, 308);
  assert.equal((await get(slashed.headers.get('location'))).status, 307);
  const head = await visiting(() => get('/daftar', { method: 'HEAD' }));
  assert.equal(head.result.status, 307);
  assert.equal(head.result.headers.get('location'), SAMPLE_SHORTLINKS.daftar);
  assert.deepEqual(head.counted, { daftar: 1 });
  const post = await visiting(() => get('/daftar', { method: 'POST', headers: { origin: base }, body: 'x' }));
  assert.equal(post.result.status, 404);
  assert.deepEqual(post.asked, []);
});
await check('registration', 'the old registration form address /gabung-siswa/form goes to /daftar (a 308), and from there to the form (a 307): two hops, no /portal anywhere', async () => {
  clearStub();
  const first = await get('/gabung-siswa/form');
  assert.equal(first.status, 308);
  assert.equal(first.headers.get('location'), '/daftar');
  const second = await get(first.headers.get('location'));
  assert.equal(second.status, 307);
  assert.equal(second.headers.get('location'), SAMPLE_SHORTLINKS.daftar);
  assert.equal(stubHits().length, 0);
});
await check('registration', 'no shortlink for /daftar (never created, or switched off: the API says the same): a polite page of its own, a real 404, noindex, never cached; the generic 404 is not shown, and nothing reaches the origin', async () => {
  try {
    await shortlinkMode('empty');
    clearStub();
    const { result: res, asked, counted } = await visiting(() => get('/daftar'));
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('location'), null);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    const html = await res.text();
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.equal(decodeEntities(tag(html, /<title>([^<]*)<\/title>/)), 'Formulir pendaftaran belum tersedia - Yayasan Sakola Kembara Indonesia');
    assert.equal(html.match(/<link rel="canonical"/g) ?? null, null, 'no canonical: it is not a page to index');
    assert.equal(ldBlocks(html).length, 0, 'no structured data on a page that says "not available"');
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
    const body = html.slice(html.indexOf('<div id="konten-utama">'), html.indexOf('</main>'));
    assert.match(body, /Formulir pendaftaran belum tersedia/);
    assert.ok(decodeEntities(body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).includes('Saat ini formulir pendaftaran belum dapat dibuka. Silakan coba lagi nanti, atau hubungi kami untuk informasi pendaftaran terbaru.'));
    assert.doesNotMatch(body, /Halaman tidak ditemukan|tidak ada atau sudah dipindahkan/);
    assert.deepEqual([...body.matchAll(/<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], m[2].trim()]), [['/kontak', 'Hubungi Kami'], ['/', 'Kembali ke Beranda']]);
    assert.deepEqual(asked, ['/api/public/shortlinks/daftar']);
    assert.deepEqual(counted, {});
    assert.equal(stubHits().length, 0);
    // other unknown links keep the generic page, and the registration link is a 307 again the moment the shortlink is back (nothing was kept)
    const generic = await get('/no-such-link');
    assert.equal(generic.status, 404);
    assert.match(await generic.text(), /Halaman tidak ditemukan/);
    await shortlinkMode('ok');
    const back = await get('/daftar');
    assert.equal(back.status, 307);
    assert.equal(back.headers.get('location'), SAMPLE_SHORTLINKS.daftar);
  } finally {
    await shortlinkMode('ok');
  }
});
await check('registration', 'the polite page is the site\'s shell: navbar and footer, the security headers, no script of its own; HEAD gets the status and no body', async () => {
  try {
    await shortlinkMode('empty');
    const res = await get('/daftar');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('strict-transport-security'), 'max-age=300');
    const html = await res.text();
    assert.ok(html.includes('<nav'), 'the navbar');
    assert.ok(html.includes('<footer'), 'the footer');
    assert.equal([...html.matchAll(/<script([^>]*)>/g)].filter((m) => !m[1].includes('ld+json')).length, 1, 'the navbar script is the only script');
    const head = await get('/daftar', { method: 'HEAD' });
    assert.equal(head.status, 404);
    assert.equal(head.headers.get('cache-control'), 'no-store');
    assert.equal(await head.text(), '');
  } finally {
    await shortlinkMode('ok');
  }
});
await check('registration', 'an API that cannot answer is a 503 for /daftar like for any link (the plain Indonesian sentence, retry, never cached): a working link is not made to look closed', async () => {
  try {
    for (const mode of ['500', 'badjson', 'html404']) {
      await shortlinkMode(mode);
      const res = await get('/daftar');
      assert.equal(res.status, 503, mode);
      assert.equal(res.headers.get('retry-after'), '30');
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.match(await res.text(), /^Tautan ini belum dapat dibuka saat ini\./);
    }
  } finally {
    await shortlinkMode('ok');
  }
});
await check('registration', 'the address of the form is in no page of the site: not in the polite page, not in a navbar, not in /gabung-siswa (only the fixture API, standing in for the admin\'s D1, knows it)', async () => {
  const target = new URL(SAMPLE_SHORTLINKS.daftar);
  // (not /tim or /gabung-siswa/docs: the groups after this one expect their first request to reach the API; /donasi is here, and the group `reports` waits out its 2 s of data copy first)
  for (const p of ['/', '/gabung-siswa', '/donasi', '/program/pembinaan', '/no-such-page']) {
    const html = await text(await get(p));
    assert.ok(!html.includes(target.host + target.pathname), p);
  }
  try {
    await shortlinkMode('empty');
    assert.ok(!(await text(await get('/daftar'))).includes(target.host), 'the polite page');
  } finally {
    await shortlinkMode('ok');
  }
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
    assert.match(tag(html, /<title>([^<]*)<\/title>/), /^Program .+ - Yayasan Sakola Kembara Indonesia$/);
    assert.equal(tag(html, /<link rel="canonical" href="([^"]*)"/), `https://sakolakembara.org/program/${id}`);
    assert.equal(tag(html, /<meta property="og:url" content="([^"]*)"/), `https://sakolakembara.org/program/${id}`);
    assert.match(html, /<meta name="robots" content="index, follow">/);
    assert.match(tag(html, /<meta property="og:image" content="([^"]*)"/), /^https:\/\/sakolakembara\.org\/_astro\/.+\.jpe?g$/);
    assert.equal(ldBlocks(html).length, 2, 'the site graph, then the program block');
    assert.ok(nodeOf(html, 'WebPage') && nodeOf(html, 'BreadcrumbList'));
    const ld = ldBlocks(html)[1];
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
await check('program', 'one URL per stage: /program/<id>.html is redirected by the assets layer (its own 307, nothing links to it), /program/<id>/ by `_redirects` with a 308 (SAKEM-090)', async () => {
  for (const [from, to, status] of [['/program/prapembinaan.html', '/program/prapembinaan', 307], ['/program/pembinaan/', '/program/pembinaan', 308]]) {
    clearStub();
    const res = await get(from);
    assert.equal(res.status, status, from);
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

// /donasi is rendered by the Worker since SAKEM-105 (it carries the Laporan section, so it reads the API); it used to be a static file of the
// assets layer, and tests/program-pages.test.ts read that file. What that test checked is checked here, on the Worker's answer.
const LEGACY_DONASI = readFileSync(path.join(webRoot, '../../app/(public)/donasi/page.tsx'), 'utf8');
const LEGACY_DONASI_LAYOUT = readFileSync(path.join(webRoot, '../../app/(public)/donasi/layout.tsx'), 'utf8');
await check('donasi', '/donasi: 200 html rendered by the Worker, one h1, the legacy head data (title, description, canonical, Open Graph, share image), the site graph only, an empty navbar slot', async () => {
  clearStub();
  const res = await get('/donasi');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.ok(res.headers.get('x-reports-source'), 'the Worker rendered it (it read the reports)');
  assert.equal(stubHits().length, 0, 'must not reach the origin');
  const html = await text(res);
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  const description = LEGACY_DONASI_LAYOUT.match(/description:\s*"([^"]+)"/)[1];
  assert.match(html, /<title>Donasi - Yayasan Sakola Kembara Indonesia<\/title>/);
  assert.equal(tag(html, /<meta name="description" content="([^"]*)"/), description, 'the description is the legacy one, unchanged');
  assert.equal(tag(html, /<link rel="canonical" href="([^"]*)"/), 'https://sakolakembara.org/donasi');
  assert.equal(tag(html, /<meta property="og:title" content="([^"]*)"/), 'Donasi');
  assert.equal(tag(html, /<meta property="og:description" content="([^"]*)"/), description);
  assert.equal(tag(html, /<meta property="og:url" content="([^"]*)"/), 'https://sakolakembara.org/donasi');
  assert.equal(tag(html, /<meta property="og:image" content="([^"]*)"/), 'https://sakolakembara.org/og-default.jpg');
  assert.equal(tag(html, /<meta name="robots" content="([^"]*)"/), 'index, follow');
  assert.deepEqual(navbarProblems(html), [], 'the navbar of the page: five items, the slot of Masuk empty');
  onlySiteGraph(html);
  assert.deepEqual(graphNodes(html).map((n) => [n['@type']].flat().join('+')), ['NGO+EducationalOrganization', 'WebSite', 'WebPage', 'BreadcrumbList']);
  assert.match(html, /Bank Muamalat/);
  assert.match(html, /1010 141 940/);
  assert.match(html, /data-copy-account="1010141940"/);
});
await check('donasi', '/donasi: the QRIS image is a plain <img> with dimensions, served as a hashed PNG by the assets layer (the page is rendered by the Worker, the image is not), and the download link points at it', async () => {
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
  const before = (await (await fetch(`${fixtureBase}/__hits`)).json()).hits;
  const res = await get('/tim');
  const after = (await (await fetch(`${fixtureBase}/__hits`)).json()).hits;
  assert.equal(res.headers.get('x-team-source'), 'cache');
  assert.equal(after, before);
});
await check('tim', 'API answers 500 after the TTL: stale copy is served, page is still 200', async () => {
  await fetch(`${fixtureBase}/__mode?m=500`, { method: 'POST' });
  await new Promise((r) => setTimeout(r, 2500)); // fresh TTL is 2 s in this run
  const res = await get('/tim');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-team-source'), 'stale');
  assert.match(await text(res), /Anggota Contoh 1/);
});
await check('tim', 'while down, the stale copy is re-served as fresh for 30 s (no API call per request)', async () => {
  const before = (await (await fetch(`${fixtureBase}/__hits`)).json()).hits;
  const res = await get('/tim');
  const after = (await (await fetch(`${fixtureBase}/__hits`)).json()).hits;
  assert.equal(res.headers.get('x-team-source'), 'cache');
  assert.equal(after, before);
});
await check('tim', 'API hangs: the 2 s timeout fires and the stale copy is served', async () => {
  // Let the 30 s outage copy be replaced: use a fresh stack instance for a clean timeout case.
  const second = await startStack({ port: 8792, stubPort: 4392, fixturePort: 4393, inspectorPort: 9332, vars: { TEAM_CACHE_FRESH_SECONDS: '1' } });
  try {
    assert.equal((await fetch(`${second.base}/tim`)).headers.get('x-team-source'), 'network');
    await fetch(`http://127.0.0.1:${second.fixture.port}/__mode?m=slow`, { method: 'POST' });
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
    await fetch(`http://127.0.0.1:${third.fixture.port}/__mode?m=500`, { method: 'POST' });
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
    await fetch(`http://127.0.0.1:${fourth.fixture.port}/__mode?m=badjson`, { method: 'POST' });
    const res = await fetch(`${fourth.base}/tim`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-team-source'), 'empty');
  } finally {
    await fourth.stop();
  }
});

// ---------------------------------------------------------------- /donasi (the Laporan section, SAKEM-105), /gabung-siswa, /gabung-siswa/docs (SAKEM-080, part D)
// /donasi (which carries the reports; it was /laporan) and /gabung-siswa/docs are SSR from the content API (fixture: scripts/fixture-api.mjs);
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
// Ports here are base ports, as in startStack: E2E_PORT_OFFSET is added.
const fixtureStats = async (port = 4391) => (await fetch(`http://127.0.0.1:${port + PORT_OFFSET}/__hits`)).json();
const setMode = (port, mode, only) => fetch(`http://127.0.0.1:${port + PORT_OFFSET}/__mode?m=${mode}${only ? `&for=${only}` : ''}`, { method: 'POST' });
const inlineScripts = (html) => [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !m[1].includes('ld+json')).map((m) => m[2]);
const notes = [];
await setMode(4391, 'ok');
const listLogStart = stack.output().length;

await check('reports', '/donasi, its Laporan section: SSR 200 from the API, ONE h1 (the page\'s), the section (id="laporan") after "Cara Berdonasi", years newest first, cards in the API order, PDF links as the API gave them, origin not asked', async () => {
  // Everything that rendered /donasi before this group (the redirect checks end on it, the pass-through and navbar checks visit it, the checks of the
  // `donasi` group above) left the reports in caches.default, which this stack keeps for 2 s (CONTENT_CACHE_FRESH_SECONDS): wait it out, so that
  // this is the request that reaches the API.
  await new Promise((resolve) => setTimeout(resolve, 2300));
  clearStub();
  const res = await get('/donasi');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('x-reports-source'), 'network');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  assert.equal(stubHits().length, 0, 'must not reach the origin');
  const html = await text(res);
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.equal((html.match(/\sid="laporan"/g) ?? []).length, 1, 'one section with the anchor');
  assert.ok(html.includes('<section id="laporan" class="scroll-mt-24'), 'the anchor is on the section, and clears the fixed navbar');
  assert.ok(html.indexOf('<section id="laporan"') > html.indexOf('Cara Berdonasi'), 'the section comes after "Cara Berdonasi"');
  assert.ok(html.indexOf('<section id="laporan"') < html.indexOf('</main>'));
  assert.match(html, /<h2 class="[^"]*" id="laporan-heading">Laporan<\/h2>/);
  const years = [...html.matchAll(/<h3 class="[^"]*">(Tahun[^<]*)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(years, ['Tahun Ajaran 2025/2026', 'Tahun 2025', 'Tahun Ajaran 2024/2025', 'Tahun 2024']);
  assert.deepEqual([...html.matchAll(/<span class="text-sm text-gray-500">(\d+) laporan<\/span>/g)].map((m) => Number(m[1])), [2, 2, 1, 1]);
  const titles = [...html.matchAll(/<h4 class="text-lg font-bold text-gray-900 mb-2 leading-snug">([^<]*)<\/h4>/g)].map((m) => decode(m[1]));
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
  assert.ok(t.includes('Komitmen kami untuk transparansi. Laporan tahunan, keuangan, dampak, dan donasi tersedia untuk diunduh dan dipelajari oleh donor, mitra, dan publik.'));
  assert.ok(t.includes('Punya pertanyaan tentang laporan kami?'));
  assert.ok(t.includes('Tim kami senang membantu menjelaskan angka-angka di balik laporan ini.'));
  assert.ok(t.indexOf('Punya pertanyaan tentang laporan kami?') > t.indexOf('Unduh Laporan'), 'the closing block ends the section');
  assert.ok(html.includes('href="/kontak"'));
  onlySiteGraph(html);
});
await check('donasi', '/donasi with the section: the payment cards, the QRIS card, the copy button, the confirmation and the contact cards are the legacy ones, and the page has its two inline scripts and no script file', async () => {
  const html = await text(await get('/donasi'));
  const t = mainText(html);
  assert.ok(t.includes('Dukung Perjalanan Mereka Setiap donasi Anda membantu siswa dari keluarga kurang mampu untuk mewujudkan impian mereka masuk perguruan tinggi.'));
  assert.ok(t.includes('Cara Berdonasi Pilih salah satu metode di bawah ini. Donasi dengan nominal berapa pun sangat berarti bagi mereka.'));
  assert.ok(t.includes('Scan QRIS'));
  assert.ok(html.includes('Scan via <span class="font-semibold text-gray-700">GoPay, OVO, DANA, ShopeePay</span>, atau m-banking.'));
  assert.ok(t.includes('Transfer Bank Bank Bank Muamalat Kode Bank 147 Nomor Rekening 1010 141 940 Atas Nama Sakola Kembara Indonesia'));
  for (const value of ['Bank Muamalat', '147', '1010 141 940', 'Sakola Kembara Indonesia']) assert.ok(LEGACY_DONASI.includes(`"${value}"`), value);
  assert.equal(attrOf(imgTags(html).find((i) => /alt="QRIS Sakola Kembara"/.test(i)), 'decoding'), 'async');
  for (const img of imgTags(html)) assert.ok(/\swidth="\d+"/.test(img) && /\sheight="\d+"/.test(img) && /\salt="/.test(img), img);
  const number = LEGACY_DONASI.match(/const ACCOUNT_NUMBER = "(\d+)"/)[1];
  assert.ok(html.includes(`data-copy-account="${number}"`));
  assert.match(html, /<span data-copy-idle[^>]*>[\s\S]*?Salin No Rekening/);
  assert.match(html, /<span data-copy-done hidden[^>]*>[\s\S]*?Tersalin!/);
  const form = LEGACY_DONASI.match(/CONFIRMATION_FORM_URL =\s*"([^"]+)"/)[1];
  const link = anchorTags(html).find((a) => attrOf(a, 'href') === form);
  assert.ok(link && link.includes('target="_blank"') && link.includes('rel="noopener noreferrer"'), 'the confirmation form opens in a new tab');
  assert.ok(t.includes('Terima Kasih atas Donasi Anda Setelah berdonasi, mohon konfirmasikan melalui formulir berikut agar donasi Anda dapat kami catat dengan baik. Konfirmasi Donasi'));
  assert.ok(t.includes('Kontak Kami Ada pertanyaan seputar donasi, penyaluran dana, atau laporan penggunaannya? Tim kami siap membantu. Hubungi Kami'));
  assert.ok(anchorTags(html).some((a) => attrOf(a, 'href') === '/kontak' && a.includes('bg-white')));
  // no script file, no framework: the navbar script and the copy-button script, both inline (the Worker renders the page, Astro still inlines them)
  assert.equal([...html.matchAll(/<script[^>]*\ssrc=/g)].length, 0);
  const scripts = inlineScripts(html);
  assert.equal(scripts.length, 2);
  assert.equal(scripts.filter((c) => c.includes('clipboard')).length, 1);
  for (const c of scripts) assert.ok(c.length < 6000);
});
await check('reports', '/donasi: a second request inside the fresh window comes from caches.default (the API is not asked again)', async () => {
  const before = (await fixtureStats()).byEndpoint.reports;
  const res = await get('/donasi');
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
  onlySiteGraph(html);
  const t = mainText(html);
  assert.ok(t.includes('Panduan lengkap, poin-poin penting, dan alur pendaftaran Sakola Kembara.'));
  assert.ok(t.includes('Dokumen tambahan yang tidak masuk kategori di atas.'));
  assert.ok(html.includes('<a href="/daftar"'));
  assert.ok(!html.includes('/portal/daftar'));
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
    window.fetch = () => Promise.reject(new Error('offline')); // the navbar script asks the portal Worker (and for the announcement), which are not here
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
  assert.match(html, /<title>Daftar Siswa - Yayasan Sakola Kembara Indonesia<\/title>/);
  assert.equal(tag(html, /<link rel="canonical" href="([^"]*)"/), 'https://sakolakembara.org/gabung-siswa');
  assert.match(html, /<meta name="description" content="Daftarkan diri sebagai siswa Sakola Kembara\./);
  onlySiteGraph(html);
  const t = mainText(html);
  for (const phrase of ['Open Recruitment Gen 6', 'Wujudkan Mimpimu Bersama Sakola Kembara', 'Manfaat Bergabung dengan Sakola Kembara', 'Alur Pendaftaran', 'Siap Bergabung dengan Sakola Kembara?', 'Pusat Dokumen']) {
    assert.ok(t.includes(phrase), phrase);
  }
  for (const step of ['01', '02', '03', '04']) assert.ok(t.includes(` ${step} `), step);
  assert.equal((html.match(/<h3 class="font-bold text-gray-900 mb-2">/g) ?? []).length, 4, 'four steps');
  const links = anchorTags(html);
  assert.equal(links.filter((a) => attrOf(a, 'href') === '/daftar').length, 2, 'the two Daftar Sekarang buttons of the page (the navbar has none: its slot is empty)');
  assert.equal(links.filter((a) => attrOf(a, 'href') === '/gabung-siswa/docs').length, 1);
  assert.ok(links.some((a) => attrOf(a, 'href') === '#manfaat'));
  assert.ok(html.includes('<section id="manfaat"'));
  assert.equal(inlineScripts(html).length, 1, 'the navbar script is the only script');
});
await check('gabung-siswa', 'trailing slashes: /gabung-siswa/ (assets layer) and /gabung-siswa/docs/ (middleware) go to the clean URL', async () => {
  clearStub();
  const a = await get('/gabung-siswa/');
  assert.equal(a.headers.get('location'), '/gabung-siswa');
  assert.ok([307, 308].includes(a.status));
  for (const [from, to] of [['/gabung-siswa/docs/', '/gabung-siswa/docs']]) {
    const res = await get(from);
    assert.equal(res.status, 308, from);
    assert.equal(res.headers.get('location'), to, from);
  }
  assert.equal(stubHits().length, 0);
});
await check('gabung-siswa', 'the sitemap lists /gabung-siswa (not /gabung-siswa/docs, like the Next sitemap) and no longer /laporan, which is a redirect since SAKEM-105', async () => {
  const xml = await text(await get('/sitemap.xml'));
  assert.ok(!xml.includes('/laporan'));
  assert.ok(xml.includes('<loc>https://sakolakembara.org/donasi</loc>'));
  assert.ok(xml.includes('<loc>https://sakolakembara.org/gabung-siswa</loc>'));
  assert.ok(!xml.includes('/gabung-siswa/docs'));
});
await check('gabung-siswa', 'the Worker logged no error while serving /donasi, /gabung-siswa and /gabung-siswa/docs', async () => {
  assert.doesNotMatch(stack.output().slice(listLogStart), /\[ERROR\]|✘|Uncaught|TypeError|ReferenceError/);
});

// API failure: degraded and empty states, stale-if-error. One stack, steps in order (the cache is shared).
{
  const failing = await startStack({ port: 8795, stubPort: 4398, fixturePort: 4399, inspectorPort: 9335, vars: { CONTENT_CACHE_FRESH_SECONDS: '1' } });
  const page = (p) => fetch(`${failing.base}${p}`, { redirect: 'manual' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // /donasi only CARRIES a list (SAKEM-105): when the reports are missing the page is still a 200, and only its Laporan section says so; the documents
  // page IS its list, and a 503 is its answer. Every step below is the same for both except the first.
  const lists = [
    { path: '/donasi', carries: true, header: 'x-reports-source', endpoint: 'reports', degraded: 'Laporan belum dapat ditampilkan', empty: 'Laporan akan segera tersedia', data: 'Laporan Dampak 2025/2026' },
    { path: '/gabung-siswa/docs', header: 'x-resources-source', endpoint: 'resources', degraded: 'Dokumen belum dapat ditampilkan', empty: 'Dokumen akan segera tersedia', data: 'Panduan Pendaftaran Siswa Baru' },
  ];
  try {
    await setMode(4399, '500', 'resources');
    await setMode(4399, 'badjson', 'reports');
    await check('degraded', `/donasi: the reports API failing and nothing cached -> the page is still a 200 (whole: hero, payment cards, QRIS), only the Laporan section says so; no-store, no Retry-After`, async () => {
      const res = await page('/donasi');
      assert.equal(res.status, 200, 'the Donasi page never fails because of the reports');
      assert.equal(res.headers.get('x-reports-source'), 'empty');
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal(res.headers.get('retry-after'), null);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.match(res.headers.get('content-type'), /text\/html/);
      const html = await res.text();
      const t = mainText(html);
      assert.ok(t.includes('Laporan belum dapat ditampilkan'), 'degraded notice, in the section');
      assert.ok(t.includes('Silakan muat ulang halaman ini beberapa saat lagi.'));
      assert.ok(!t.includes('Laporan akan segera tersedia'), 'must not claim the list is empty');
      assert.ok(html.indexOf('Laporan belum dapat ditampilkan') > html.indexOf('<section id="laporan"'), 'the notice is inside the section');
      assert.ok(html.includes('role="status"'));
      assert.ok(t.includes('Dukung Perjalanan Mereka') && t.includes('Cara Berdonasi') && t.includes('Bank Muamalat') && t.includes('Konfirmasi Donasi'), 'the rest of the page is all there');
      assert.ok(imgTags(html).some((i) => /alt="QRIS Sakola Kembara"/.test(i)));
      assert.ok(html.includes('data-copy-account="1010141940"'));
      assert.ok(t.includes('Punya pertanyaan tentang laporan kami?'), 'the closing block of the section is there too');
      assert.ok(html.includes('id="site-nav"') && html.includes('<footer'), 'shell is there');
      assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
      assert.match(html, /<link rel="canonical" href="https:\/\/sakolakembara\.org\/donasi"/);
      assert.match(html, /<title>Donasi - Yayasan Sakola Kembara Indonesia<\/title>/);
    });
    for (const l of lists.filter((x) => !x.carries)) {
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
    await check('stale', '/donasi: a hanging reports API with a stale copy: after about 2 s the stale copy is served (the page is a 200 either way)', async () => {
      assert.equal((await fetch(`${slow.base}/donasi`)).headers.get('x-reports-source'), 'network');
      await setMode(4401, 'slow', 'reports');
      await new Promise((r) => setTimeout(r, 1300));
      const started = performance.now();
      const res = await fetch(`${slow.base}/donasi`);
      const ms = performance.now() - started;
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-reports-source'), 'stale');
      assert.ok(ms >= 1900 && ms < 3500, `timeout took ${Math.round(ms)} ms`);
    });
    await check('degraded', '/donasi: a hanging reports API on a cold cache costs the page the 2 s timeout, then it is a 200 with the failure panel (never a 503)', async () => {
      const cold = await startStack({ port: 8797, stubPort: 4402, fixturePort: 4403, inspectorPort: 9337, vars: { CONTENT_CACHE_FRESH_SECONDS: '1' } });
      try {
        await setMode(4403, 'slow', 'reports');
        const started = performance.now();
        const res = await fetch(`${cold.base}/donasi`);
        const ms = performance.now() - started;
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.ok(ms >= 1900 && ms < 3500, `timeout took ${Math.round(ms)} ms`);
        assert.ok(mainText(await res.text()).includes('Laporan belum dapat ditampilkan'));
      } finally {
        await cold.stop();
      }
    });
  } finally {
    await slow.stop();
  }
}

// ---------------------------------------------------------------- SEO in served HTML
const SEO_PAGES = [
  // The suffix is the live WordPress pattern (SAKEM-090); the home title has the live site's comma.
  { path: '/', title: 'Sakola Kembara, Pendidikan Untuk Semua', exact: true, canonical: 'https://sakolakembara.org/', graph: ['NGO+EducationalOrganization', 'WebSite', 'WebPage'] },
  { path: '/blog', title: 'Blog &amp; Cerita - Yayasan Sakola Kembara Indonesia', canonical: 'https://sakolakembara.org/blog', graph: ['NGO+EducationalOrganization', 'WebSite', 'CollectionPage', 'BreadcrumbList'] },
  { path: '/tim', title: 'Tim Kami - Yayasan Sakola Kembara Indonesia', canonical: 'https://sakolakembara.org/tim', graph: ['NGO+EducationalOrganization', 'WebSite', 'WebPage', 'BreadcrumbList'] },
  { path: '/donasi', title: 'Donasi - Yayasan Sakola Kembara Indonesia', canonical: 'https://sakolakembara.org/donasi', graph: ['NGO+EducationalOrganization', 'WebSite', 'WebPage', 'BreadcrumbList'] },
  { path: '/gabung-siswa', title: 'Daftar Siswa - Yayasan Sakola Kembara Indonesia', canonical: 'https://sakolakembara.org/gabung-siswa', graph: ['NGO+EducationalOrganization', 'WebSite', 'WebPage', 'BreadcrumbList'] },
  { path: '/gabung-siswa/docs', title: 'Pusat Dokumen &amp; Berkas - Yayasan Sakola Kembara Indonesia', canonical: 'https://sakolakembara.org/gabung-siswa/docs', graph: ['NGO+EducationalOrganization', 'WebSite', 'WebPage', 'BreadcrumbList'] },
  { path: `/blog/${slugs[0]}`, title: ` - Yayasan Sakola Kembara Indonesia`, canonical: `https://sakolakembara.org/blog/${slugs[0]}`, graph: ['NGO+EducationalOrganization', 'WebSite', 'WebPage', 'BreadcrumbList', 'BlogPosting', 'Person'] },
];
for (const page of SEO_PAGES) {
  await check('seo', `${page.path}: lang, title, canonical, og, twitter, robots, the JSON-LD graph (${page.graph.join(', ')})`, async () => {
    const html = await text(await get(page.path));
    assert.match(html, /<html lang="id-ID"/);
    const title = tag(html, /<title>([^<]*)<\/title>/);
    assert.ok(page.exact ? title === page.title : title.endsWith(page.title.replace(/^ /, '')), `title: ${title}`);
    assert.equal(tag(html, /<link rel="canonical" href="([^"]*)"/), page.canonical);
    assert.equal(tag(html, /<meta property="og:url" content="([^"]*)"/), page.canonical);
    assert.match(html, /<meta property="og:site_name" content="Sakola Kembara">/);
    assert.match(html, /<meta property="og:locale" content="id_ID">/);
    assert.match(html, /<meta property="og:image" content="https:\/\/sakolakembara\.org\//);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
    assert.match(html, /<meta name="robots" content="index, follow">/);
    assert.match(html, /<meta name="description" content="[^"]{20,}/);
    assert.deepEqual(graphNodes(html).map((n) => [].concat(n['@type']).join('+')), page.graph);
    assert.equal(ldBlocks(html).length, 1);
  });
}
await check('seo', 'article JSON-LD parses and carries real dates, the author as a Person, the organization as publisher; every reference resolves', async () => {
  const a = articles[0];
  const html = await text(await get(`/blog/${a.id}`));
  const post = nodeOf(html, 'BlogPosting');
  assert.equal(post.datePublished, a.dateISO);
  assert.equal(post.mainEntityOfPage['@id'], `https://sakolakembara.org/blog/${a.id}#webpage`);
  assert.equal(post.inLanguage, 'id-ID');
  assert.equal(post.publisher['@id'], 'https://sakolakembara.org/#organization');
  assert.equal(nodeOf(html, 'Person')['@id'], post.author['@id']);
  assert.equal(nodeOf(html, 'WebSite').inLanguage, 'id-ID');
  // every reference ({"@id": ...} alone) points at a node that is defined in the graph (at the top or nested)
  const defined = new Set();
  const refs = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      if (typeof v['@id'] === 'string') {
        if (Object.keys(v).length === 1) refs.push(v['@id']);
        else defined.add(v['@id']);
      }
      Object.values(v).forEach(walk);
    }
  };
  graphNodes(html).forEach(walk);
  assert.ok(refs.length > 0);
  for (const ref of refs) assert.ok(defined.has(ref), `${ref} is not defined in the graph`);
});
await check('seo', 'skip link is the first focusable element and #konten-utama exists', async () => {
  const html = await text(await get('/'));
  assert.ok(html.indexOf('href="#konten-utama"') < html.indexOf('<nav'));
  assert.match(html, /id="konten-utama"/);
});
await check('seo', 'robots.txt: the rules of the Next app, plus /portal (the student portal is not for search engines)', async () => {
  const body = await text(await get('/robots.txt'));
  assert.equal(body, 'User-Agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\nDisallow: /login\nDisallow: /portal\n\nHost: https://sakolakembara.org\nSitemap: https://sakolakembara.org/sitemap.xml\n');
});
// The articles: the 80 migrated + the 6 imported on 2026-10-13 (SAKEM-090). Counted from lib/blog-posts.json (the sync of
// content/blog) and pinned here, so that an article added without its redirect, sitemap entry and checks fails loudly.
const ARTICLE_COUNT = 86;
await check('seo', `lib/blog-posts.json lists the ${ARTICLE_COUNT} articles of content/blog, the fixture API serves all of them`, async () => {
  assert.equal(articles.length, ARTICLE_COUNT);
  const list = await apiJson('/api/public/blog?page=1&pageSize=50');
  assert.equal(list.total + 1, ARTICLE_COUNT, 'the list counts the articles without the featured one');
});
await check('seo', 'sitemap.xml: every article with real lastmod, static routes without lastmod', async () => {
  const res = await get('/sitemap.xml');
  assert.match(res.headers.get('content-type'), /xml/);
  const xml = await text(res);
  const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
  assert.equal(urls.length, 6 + 3 + ARTICLE_COUNT); // six static routes since SAKEM-105 (/laporan left), three programs
  const blogUrls = urls.filter((u) => /<loc>https:\/\/sakolakembara\.org\/blog\/[^<]+<\/loc>/.test(u));
  assert.equal(blogUrls.length, ARTICLE_COUNT);
  for (const u of blogUrls) assert.match(u, /<lastmod>\d{4}-\d{2}-\d{2}/);
  const staticUrls = urls.filter((u) => !/\/blog\/[^<]+<\/loc>/.test(u));
  assert.equal(staticUrls.length, 9);
  for (const u of staticUrls) assert.doesNotMatch(u, /<lastmod>/);
});

// ---------------------------------------------------------------- headers
for (const p of ['/', '/tim', '/blog', '/blog/nope', `/blog/${slugs[0]}`, '/robots.txt', '/donasi', '/gabung-siswa', '/gabung-siswa/docs']) {
  await check('headers', `${p}: security headers present`, async () => {
    const res = await get(p);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(res.headers.get('strict-transport-security'), 'max-age=300', 'HSTS is staged: five minutes, no includeSubDomains, no preload');
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
await check('home', '/ has the video hero, then the seven sections in order (design "Opsi C", SAKEM-111), answered without touching the origin', async () => {
  clearStub();
  const html = await homeHtml();
  const marks = ['Membuka Pintu', 'id="impact"', 'Mengapa Kami Ada?', 'id="activities"', 'id="cerita"', 'id="partners"', 'id="blog"', 'id="gabung"'];
  const at = marks.map((m) => html.indexOf(m));
  assert.ok(at.every((i) => i > 0), `a section is missing: ${at}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'sections out of order');
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.equal(stubHits().length, 0);
});
await check('home', '/ content counts: 1 share chart, 3 program tiles, 2 stories, 6 partner logos, 4 CTA cards, 3 news cards', async () => {
  const html = await homeHtml();
  assert.equal((html.match(/<div role="img" aria-label=/g) ?? []).length, 1);
  assert.equal((html.match(/<a href="\/program\/[\w-]+"/g) ?? []).length, 3);
  assert.equal((html.slice(html.indexOf('id="cerita"'), html.indexOf('id="partners"')).match(/<figure[\s>]/g) ?? []).length, 2);
  assert.equal((html.match(/<li class="w-\[136px\]/g) ?? []).length, 6);
  assert.equal((html.match(/<a href="\/(?:daftar|donasi|kontak)" class="group/g) ?? []).length, 4);
  const news = html.slice(html.indexOf('id="blog"'));
  assert.equal((news.match(/<a href="\/blog\/[^"]+" class="group block/g) ?? []).length, 3);
});
await check('home', 'the hero video files are static assets: 200 video/mp4, the origin not asked, the phone size the smaller', async () => {
  clearStub();
  const sizes = [];
  for (const url of ['/images/home/hero-loop-720.mp4', '/images/home/hero-loop.mp4']) {
    const res = await get(url);
    assert.equal(res.status, 200, url);
    assert.match(res.headers.get('content-type') ?? '', /video\/mp4/, url);
    sizes.push((await res.arrayBuffer()).byteLength);
  }
  assert.ok(sizes[0] < sizes[1] && sizes[1] < 4 * 1024 * 1024, `video sizes ${sizes}`);
  assert.equal(stubHits().length, 0);
});
await check('home', 'every /_astro and /_img asset the home page references is served by the assets layer: 200, right type, immutable, origin not asked', async () => {
  const html = await homeHtml();
  const urls = [...new Set(html.match(/\/_(?:astro|img)\/[\w.-]+\.(?:webp|png|css|js|woff2)/g) ?? [])];
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
await check('home', 'eager JS of the home page (all inline), as served, stays inside the budget', async () => {
  const html = await homeHtml();
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !m[1].includes('ld+json'));
  assert.equal(scripts.length, 3); // navbar, stat dialog, hero video
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

// ---------------------------------------------------------------- blog from the content API (SAKEM-080, part E)
// The articles and the list are rendered by the Worker from GET /api/public/blog and /blog/<slug> (the fixture server),
// through caches.default with stale-if-error. The per-article SEO checks for every article are in the "articles" group above.
const blogRequests = async (f = fixtureBase) => (await (await fetch(`${f}/__requests?for=blog`)).json());
const blogHits = async (f = fixtureBase) => (await (await fetch(`${f}/__hits`)).json()).byEndpoint.blog;
const setFixtureMode = (f, group, m) => fetch(`${f}/__mode?for=${group}&m=${m}`, { method: 'POST' });

await check('blog', '/blog?page=4: the first view asks the API once (network), the second is served from caches.default (no API call)', async () => {
  const before = await blogRequests();
  const first = await get('/blog?page=4');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('x-blog-source'), 'network');
  assert.equal(first.headers.get('cache-control'), 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  const second = await get('/blog?page=4');
  assert.equal(second.headers.get('x-blog-source'), 'cache');
  const added = (await blogRequests()).slice(before.length);
  assert.deepEqual(added, ['/api/public/blog?page=4&pageSize=15']);
});
await check('blog', '/blog?page=99999999 is capped before it reaches the API (page 500, the same key as ?page=999), and the API clamps it to the last page', async () => {
  const res = await get('/blog?page=99999999');
  assert.equal(res.status, 200);
  assert.match(await text(res), /Halaman 6 dari 6/);
  const requests = await blogRequests();
  assert.ok(requests.includes('/api/public/blog?page=500&pageSize=15'));
  assert.ok(!requests.some((r) => /page=(?:999|99999999)\b/.test(r)), 'an uncapped page number reached the API');
});
await check('blog', 'the featured article is on page 1 only, never repeated in the grid; page 2 has 15 cards', async () => {
  const list1 = await apiJson('/api/public/blog?page=1&pageSize=15');
  const html1 = await text(await get('/blog'));
  const html2 = await text(await get('/blog?page=2'));
  assert.match(html1, /Artikel Terbaru/);
  assert.doesNotMatch(html2, /Artikel Terbaru/);
  const cards = (html) => [...html.matchAll(/<article class="group bg-gray-50/g)].length;
  assert.equal(cards(html1), 15);
  assert.equal(cards(html2), 15);
  const linksOf = (html) => [...html.matchAll(/href="\/blog\/([a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.equal(linksOf(html1).filter((l) => l === list1.featured.slug).length, 1, 'the featured article is linked once on page 1');
  assert.ok(!linksOf(html2).includes(list1.featured.slug));
});
await check('blog', 'an article page lists the three related articles the API sent, in its order, and the hero image has width, height and the manifest srcset', async () => {
  const slug = slugs[0];
  const html = await text(await get(`/blog/${slug}`));
  const { related, article } = await apiJson(`/api/public/blog/${slug}`);
  assert.equal(related.length, 3);
  const section = html.slice(html.indexOf('Artikel Lainnya'));
  const links = [...section.matchAll(/<a\s+href="\/blog\/([a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links, related.map((r) => r.slug));
  const hero = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]).find((i) => /fetchpriority="high"/.test(i));
  assert.ok(hero, 'hero image');
  assert.deepEqual(checkImgTag(hero), []);
  assert.equal(attrOf(hero, 'width'), String(article.imageWidth));
  assert.equal(attrOf(hero, 'height'), String(article.imageHeight));
  assert.ok(attrOf(hero, 'srcset')?.includes('/_img/'), 'the WebP ladder of the asset manifest');
  const res = await get(attrOf(hero, 'src'));
  assert.equal(res.status, 200);
});
await check('blog', 'an unknown slug is a real 404 with the 404 page: the API is asked once, the next view is answered from the remembered "not found" (s-maxage 30)', async () => {
  const before = await blogRequests();
  const first = await get('/blog/no-such-article');
  assert.equal(first.status, 404);
  assert.match(await text(first), /Halaman tidak ditemukan/);
  assert.equal(first.headers.get('cache-control'), 'public, max-age=0, s-maxage=30');
  assert.equal(first.headers.get('x-blog-source'), 'not_found');
  const second = await get('/blog/no-such-article');
  assert.equal(second.status, 404);
  assert.equal(second.headers.get('x-blog-source'), 'not_found');
  assert.deepEqual((await blogRequests()).slice(before.length), ['/api/public/blog/no-such-article']);
});
await check('blog', 'a slug that cannot exist (upper case, a dot, a space, too long) is a 404 without any API request or cache entry', async () => {
  const before = await blogHits();
  for (const p of ['/blog/DOES-NOT-EXIST', '/blog/a.b', `/blog/${'a'.repeat(201)}`, '/blog/a%20b', '/blog/a_b%2Fc']) {
    const res = await get(p);
    assert.equal(res.status, 404, p);
    assert.match(await text(res), /Halaman tidak ditemukan/);
  }
  assert.equal(await blogHits(), before);
});
await check('blog', 'the sitemap enumerates every article by paging the API with pageSize=50 and adding the featured one, with a real lastmod', async () => {
  const before = await blogRequests();
  const res = await get('/sitemap.xml');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/xml/);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600');
  const xml = await text(res);
  const entries = [...xml.matchAll(/<url><loc>https:\/\/sakolakembara\.org\/blog\/([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => ({ slug: m[1], lastmod: m[2] }));
  assert.deepEqual(entries.map((e) => e.slug).sort(), [...slugs].sort());
  const list = [...(await apiJson('/api/public/blog?page=1&pageSize=50')).articles, ...(await apiJson('/api/public/blog?page=2&pageSize=50')).articles, (await apiJson('/api/public/blog?page=1&pageSize=50')).featured];
  for (const e of entries) assert.equal(e.lastmod, list.find((a) => a.slug === e.slug).dateISO, e.slug);
  const requests = (await blogRequests()).slice(before.length).filter((r) => r.includes('pageSize=50'));
  assert.ok(requests.includes('/api/public/blog?page=1&pageSize=50') && requests.includes('/api/public/blog?page=2&pageSize=50'));
});
await check('blog', 'the blog pages and the sitemap never reach the legacy origin, and the Worker logged no error', async () => {
  clearStub();
  for (const p of ['/blog', '/blog?page=3', `/blog/${slugs[1]}`, '/sitemap.xml']) await get(p);
  assert.equal(stubHits().length, 0);
  assert.doesNotMatch(stack.output().slice(logStart), /\[ERROR\]|✘|Uncaught|TypeError|ReferenceError/);
});

// stale-if-error: a short fresh window, then the API goes down
await check('blog', 'stale-if-error: the API fails after the fresh window, /blog, an article and the sitemap are served from the last good copy (200, stale), then recover', async () => {
  const s = await startStack({ port: 8801, stubPort: 4411, fixturePort: 4412, inspectorPort: 9341, vars: { CONTENT_CACHE_FRESH_SECONDS: '1' } });
  const f = `http://127.0.0.1:${s.fixture.port}`;
  try {
    for (const p of ['/blog', `/blog/${slugs[2]}`, '/sitemap.xml']) assert.equal((await fetch(s.base + p)).headers.get('x-blog-source'), 'network', p);
    await setFixtureMode(f, 'blog', '500');
    await new Promise((r) => setTimeout(r, 1500));
    for (const p of ['/blog', `/blog/${slugs[2]}`, '/sitemap.xml']) {
      const res = await fetch(s.base + p);
      assert.equal(res.status, 200, p);
      assert.equal(res.headers.get('x-blog-source'), 'stale', p);
      assert.notEqual(res.headers.get('cache-control'), 'public, max-age=0, s-maxage=60, stale-while-revalidate=300', `${p}: a stale answer must not be told to cache for a minute`);
      if (p !== '/sitemap.xml') assert.match(await res.text(), /Sakola Kembara/);
    }
    // while down, the stale copy is re-served as fresh for 30 s: no API call per request
    const before = await blogHits(f);
    assert.equal((await fetch(`${s.base}/blog`)).headers.get('x-blog-source'), 'cache');
    assert.equal(await blogHits(f), before);
    // an article never fetched has nothing to fall back on: a clear 503, not a 404 and not a 500
    const cold = await fetch(`${s.base}/blog/${slugs[3]}`);
    assert.equal(cold.status, 503);
    assert.match(await cold.text(), /Artikel belum dapat dimuat saat ini/);
    assert.doesNotMatch(s.output(), /\[ERROR\]|Uncaught|TypeError/);
  } finally {
    await s.stop();
  }
});

// outage on a cold cache: a plain notice, never a 500
await check('blog', 'API down on a cold cache: /blog, an article and the sitemap answer 503 with the notice, no-store and Retry-After; an unknown slug is NOT turned into a 404', async () => {
  const s = await startStack({ port: 8802, stubPort: 4413, fixturePort: 4414, inspectorPort: 9342 });
  const f = `http://127.0.0.1:${s.fixture.port}`;
  try {
    await setFixtureMode(f, 'blog', '500');
    for (const p of ['/blog', '/blog?page=2', `/blog/${slugs[0]}`, '/blog/some-valid-looking-slug']) {
      const res = await fetch(s.base + p);
      assert.equal(res.status, 503, p);
      assert.equal(res.headers.get('cache-control'), 'no-store', p);
      assert.equal(res.headers.get('retry-after'), '30', p);
      assert.equal(res.headers.get('x-blog-source'), 'empty', p);
      assert.match(res.headers.get('content-type'), /text\/html/);
      const html = await res.text();
      assert.match(html, /Artikel belum dapat dimuat saat ini\. Silakan coba lagi beberapa saat lagi\./);
      assert.match(html, /<html lang="id-ID"/);
      assert.match(html, />Coba Lagi</);
      assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
    }
    const sitemap = await fetch(`${s.base}/sitemap.xml`);
    assert.equal(sitemap.status, 503);
    assert.equal(sitemap.headers.get('retry-after'), '300');
    assert.equal(sitemap.headers.get('cache-control'), 'no-store');
    // a slug that cannot exist is still a plain 404: that needs no API
    assert.equal((await fetch(`${s.base}/blog/NOT-A-SLUG`)).status, 404);
    // the contact page and the static pages are not affected by a blog outage
    assert.equal((await fetch(`${s.base}/kontak`)).status, 200);
    assert.equal((await fetch(`${s.base}/`)).status, 200);

    // a 404 that is not the contract's JSON (a wrong base URL answering HTML) is an outage, not a deleted article
    await setFixtureMode(f, 'blog', 'html404');
    const wrong = await fetch(`${s.base}/blog/${slugs[5]}`);
    assert.equal(wrong.status, 503);
    // an answer that is not a blog payload is an outage too
    await setFixtureMode(f, 'blog', 'badjson');
    assert.equal((await fetch(`${s.base}/blog?page=3`)).status, 503);
    // a hanging API: the 2 s timeout fires
    await setFixtureMode(f, 'blog', 'slow');
    const started = performance.now();
    const slow = await fetch(`${s.base}/blog/${slugs[6]}`);
    const ms = performance.now() - started;
    assert.equal(slow.status, 503);
    assert.ok(ms >= 1900 && ms < 3500, `timeout took ${Math.round(ms)} ms`);
    // and it comes back: the next view after the API recovers is a normal page
    await setFixtureMode(f, 'blog', 'ok');
    assert.equal((await fetch(`${s.base}/blog/${slugs[7]}`)).status, 200);
    assert.doesNotMatch(s.output(), /\[ERROR\]|Uncaught|TypeError/);
  } finally {
    await s.stop();
  }
});

// ---------------------------------------------------------------- /kontak (SAKEM-080, part E)
const contactLogStart = stack.output().length;
const contactApi = {
  log: async () => (await fetch(`${fixtureBase}/__contact-log`)).json(),
  hits: async () => (await (await fetch(`${fixtureBase}/__hits`)).json()).byEndpoint.contact,
  mode: (m) => setFixtureMode(fixtureBase, 'contact', m),
};
let ipCounter = 10;
/** A plain HTML form post, as a browser without JavaScript sends it. Each call gets its own visitor address unless one is given. */
async function postForm(fields, { ip = `203.0.113.${++ipCounter}`, headers = {}, path: target = '/kontak' } = {}) {
  return get(target, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base, ...(ip ? { 'cf-connecting-ip': ip } : {}), ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}
const VALID_FORM = (n) => ({ fullName: `Budi Marker${n}`, email: `budi.marker${n}@example.com`, subject: 'other', message: `Halo, saya ingin bertanya soal program Marker${n}.`, website: '' });
const valueOf = (html, id) => decodeEntities(html.match(new RegExp(`<input[^>]*\\sid="${id}"[^>]*\\svalue="([^"]*)"`))?.[1] ?? '');
const textarea = (html) => decodeEntities(html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)?.[1] ?? '');

await check('contact', 'GET /kontak: 200 html from the Worker, one h1, SEO tags, the form, the three contact cards, no JSON-LD, origin not asked', async () => {
  clearStub();
  const res = await get('/kontak');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(stubHits().length, 0, 'must not reach the origin');
  const html = await text(res);
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.match(html, />Mari Bergerak Bersama</);
  assert.match(html, /<title>Kontak - Yayasan Sakola Kembara Indonesia<\/title>/);
  assert.equal(tag(html, /<link rel="canonical" href="([^"]*)"/), 'https://sakolakembara.org/kontak');
  assert.equal(tag(html, /<meta property="og:url" content="([^"]*)"/), 'https://sakolakembara.org/kontak');
  assert.match(html, /<meta name="description" content="Hubungi tim Sakola Kembara untuk pertanyaan, kerjasama, atau peluang relawan\. Berbasis di Bandung, melayani siswa di seluruh Indonesia\.">/);
  assert.match(html, /<meta name="robots" content="index, follow">/);
  onlySiteGraph(html);
  // the form: a real POST, every field with its label, the honeypot, no native validation
  assert.match(html, /<form id="kontak-form" method="post" action="\/kontak" class="space-y-5" novalidate>/);
  for (const [id, name] of [['fullName', 'Nama Lengkap'], ['email', 'Email'], ['subject', 'Subjek'], ['message', 'Pesan']]) {
    assert.match(html, new RegExp(`<label for="${id}"[^>]*>\\s*${name}<span aria-hidden="true"`), id);
    assert.match(html, new RegExp(`name="${id}"\\s+required`), id);
  }
  assert.match(html, /<input id="website" type="text" name="website" tabindex="-1" autocomplete="off"/);
  for (const t of ['Kerjasama/Partnership', 'Seputar Donasi', 'Lainnya', 'Pilih subjek', 'Kirim Pesan']) assert.ok(html.includes(t), t);
  assert.match(html, /hello@sakolakembara\.org/);
  assert.match(html, /\+62 812 3456 7890/);
  assert.match(html, /Bandung, Jawa Barat, Indonesia/);
  assert.match(html, /aria-label="Instagram"/);
  assert.ok(!html.includes('Pesan Terkirim'));
});
await check('contact', 'the form\'s own script is inline, under 1 KB, and only toggles the pending state; the page\'s scripts are the navbar\'s, the widget\'s and that one, plus Cloudflare\'s file (see group "turnstile")', async () => {
  const html = await text(await get('/kontak'));
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !m[1].includes('ld+json'));
  const inline = scripts.filter((m) => !/\ssrc=/.test(m[1]));
  assert.equal(inline.length, 3, 'the navbar script, the widget script and the form script');
  assert.deepEqual(
    [...html.matchAll(/<script[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1]),
    ['https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'],
    'no script file of ours: Cloudflare\'s is the only one',
  );
  const formScript = inline.find((m) => m[2].includes('Mengirim...'));
  assert.ok(formScript);
  assert.ok(Buffer.byteLength(formScript[2]) < 1000, `form script is ${Buffer.byteLength(formScript[2])} bytes`);
  assert.doesNotMatch(formScript[2], /fetch\(|XMLHttpRequest/);
});
await check('contact', 'no JavaScript, valid post: 303 to the confirmation, the API got one JSON post with the visitor address, the confirmation page replaces the form', async () => {
  clearStub();
  await contactApi.mode('ok');
  const before = (await contactApi.log()).length;
  const ip = '203.0.113.200';
  const res = await postForm(VALID_FORM(1), { ip });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/kontak?terkirim=1');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const log = (await contactApi.log()).slice(before);
  assert.equal(log.length, 1);
  assert.equal(log[0].clientIp, ip, 'the visitor address from CF-Connecting-IP reaches the API in X-Sakem-Client-Ip');
  assert.equal(log[0].headers['content-type'], 'application/json');
  assert.deepEqual(log[0].body, { ...VALID_FORM(1), website: '' });
  const done = await get('/kontak?terkirim=1');
  assert.equal(done.status, 200);
  const html = await text(done);
  assert.match(html, /Pesan Terkirim/);
  assert.match(html, /Pesan kamu sudah kami terima\. Tim kami akan menghubungi via email\./);
  assert.ok(!html.includes('<form'));
  assert.ok(!html.includes('Marker1'), 'nothing of the message is echoed');
  assert.equal(stubHits().length, 0);
});
await check('contact', 'the API gets the trimmed, lower-cased values, and only the address from CF-Connecting-IP (a client-sent X-Sakem-Client-Ip and X-Forwarded-For are ignored)', async () => {
  const before = (await contactApi.log()).length;
  const res = await postForm(
    { ...VALID_FORM(2), fullName: '  Ana Marker2  ', email: ' ANA.Marker2@Example.COM ' },
    { ip: '203.0.113.201', headers: { 'x-sakem-client-ip': '9.9.9.9', 'x-forwarded-for': '8.8.8.8' } },
  );
  assert.equal(res.status, 303);
  const [entry] = (await contactApi.log()).slice(before);
  assert.equal(entry.clientIp, '203.0.113.201');
  assert.equal(entry.body.fullName, 'Ana Marker2');
  assert.equal(entry.body.email, 'ana.marker2@example.com');
});
await check('contact', 'without a CF-Connecting-IP header the API still gets a valid address literal (the shared "unknown" one), never none', async () => {
  const before = (await contactApi.log()).length;
  const res = await postForm(VALID_FORM(3), { ip: null });
  assert.ok([303, 429].includes(res.status), String(res.status)); // 429 only if an earlier local post shares the bucket
  const [entry] = (await contactApi.log()).slice(before);
  if (entry) assert.match(entry.clientIp, /^(\d{1,3}\.){3}\d{1,3}$|:/);
});
await check('contact', 'invalid form (no JavaScript): 400, the legacy messages under the fields, the typed text kept, aria wired, nothing sent to the API', async () => {
  const hits = await contactApi.hits();
  const res = await postForm({ fullName: 'Ana', email: 'bukan-email', subject: '', message: 'pendek', website: '' });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const html = await text(res);
  assert.match(html, /role="alert"[^>]*>\s*Silakan periksa kembali isian formulir\.\s*<\/div>/);
  assert.match(html, /<p id="email-error"[^>]*>\s*Format email belum benar\s*<\/p>/);
  assert.match(html, /<p id="subject-error"[^>]*>\s*Pilih salah satu subjek\s*<\/p>/);
  assert.match(html, /<p id="message-error"[^>]*>\s*Tulis minimal 10 karakter\s*<\/p>/);
  assert.ok(!html.includes('id="fullName-error"'), 'a valid field shows no error');
  assert.match(html, /id="email"[^>]*aria-describedby="email-error"[^>]*aria-invalid="true"|id="email"[^>]*aria-invalid="true"[^>]*aria-describedby="email-error"/);
  assert.equal(valueOf(html, 'fullName'), 'Ana');
  assert.equal(valueOf(html, 'email'), 'bukan-email');
  assert.equal(textarea(html), 'pendek');
  assert.match(html, /<option value="" disabled selected>/);
  assert.equal(await contactApi.hits(), hits, 'the API was not called');
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
});
await check('contact', 'an empty post shows every legacy message', async () => {
  const html = await text(await postForm({}));
  for (const m of ['Nama lengkap minimal 2 karakter', 'Format email belum benar', 'Pilih salah satu subjek', 'Tulis minimal 10 karakter']) assert.ok(html.includes(m), m);
});
await check('contact', 'the typed text is escaped where it is put back (no markup injection through the form)', async () => {
  const res = await postForm({ fullName: '"><script>alert(1)</script>', email: 'x', subject: 'other', message: '</textarea><script>alert(2)</script>' });
  assert.equal(res.status, 400);
  const html = await text(res);
  // Inside a quoted attribute `<` is harmless; what matters is that the quote cannot be closed and no element is created.
  assert.ok(!html.includes('value=""><script'), 'the quote of the attribute was not escaped');
  // Parse it like a browser would (happy-dom's DOMParser does not run scripts): no element may carry the injected code.
  const { Window } = await import('happy-dom');
  const win = new Window();
  const doc = new win.DOMParser().parseFromString(html, 'text/html');
  assert.deepEqual([...doc.querySelectorAll('script')].filter((el) => el.textContent.includes('alert(')).length, 0, 'a script element was injected');
  assert.equal(doc.querySelector('#fullName')?.getAttribute('value'), '"><script>alert(1)</script>');
  assert.equal(doc.querySelector('#message')?.textContent, '</textarea><script>alert(2)</script>');
  await win.happyDOM.close();
  assert.ok(!html.includes('</textarea><script>'), 'the textarea was closed by the typed text');
  assert.equal(valueOf(html, 'fullName'), '"><script>alert(1)</script>');
  assert.equal(textarea(html), '</textarea><script>alert(2)</script>');
});
await check('contact', 'honeypot: a filled hidden field is answered like a success (303), and the API is never called', async () => {
  const hits = await contactApi.hits();
  const res = await postForm({ ...VALID_FORM(4), website: 'https://spam.example' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/kontak?terkirim=1');
  assert.equal(await contactApi.hits(), hits);
});
await check('contact', 'API 429 rate_limited: 429 with Retry-After, the legacy message, the typed text kept', async () => {
  await contactApi.mode('429');
  try {
    const res = await postForm(VALID_FORM(5));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '42');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const html = await text(res);
    assert.match(html, /Terlalu banyak percobaan pengiriman\. Silakan tunggu satu menit lalu coba lagi\./);
    assert.equal(valueOf(html, 'email'), VALID_FORM(5).email);
    assert.equal(textarea(html), VALID_FORM(5).message);
  } finally {
    await contactApi.mode('ok');
  }
});
await check('contact', 'API 429 duplicate_recent (forced, and for real: the same email twice): 429 with the legacy duplicate message', async () => {
  await contactApi.mode('duplicate');
  try {
    const res = await postForm(VALID_FORM(6));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '300');
    assert.match(await text(res), /Pesan dari email ini baru saja dikirim\. Mohon tunggu beberapa menit sebelum mengirim ulang\./);
  } finally {
    await contactApi.mode('ok');
  }
  assert.equal((await postForm(VALID_FORM(7))).status, 303);
  const again = await postForm(VALID_FORM(7)); // another address, the same email
  assert.equal(again.status, 429);
  assert.match(await text(again), /Pesan dari email ini baru saja dikirim\./);
});
await check('contact', 'API 503, 500, a wrong-URL 404 page and an unreachable API: 503 with Retry-After and one plain sentence, the typed text kept', async () => {
  for (const mode of ['503', '500', 'html404']) {
    await contactApi.mode(mode);
    try {
      const res = await postForm(VALID_FORM(8));
      assert.equal(res.status, 503, mode);
      assert.equal(res.headers.get('retry-after'), '30', mode);
      assert.equal(res.headers.get('cache-control'), 'no-store', mode);
      const html = await text(res);
      assert.match(html, /Pesan belum dapat dikirim saat ini\. Silakan coba lagi beberapa saat lagi\./, mode);
      assert.equal(textarea(html), VALID_FORM(8).message, mode);
    } finally {
      await contactApi.mode('ok');
    }
  }
});
await check('contact', 'API 400 validation_failed: 400 with the API\'s field messages under the legacy banner', async () => {
  await contactApi.mode('invalid');
  try {
    const res = await postForm(VALID_FORM(9));
    assert.equal(res.status, 400);
    const html = await text(res);
    assert.match(html, /Silakan periksa kembali isian formulir\./);
    assert.match(html, /<p id="email-error"[^>]*>\s*Format email belum benar\s*<\/p>/);
  } finally {
    await contactApi.mode('ok');
  }
});
await check('contact', 'API unreachable (a stack whose API is not there): 503 with the plain sentence, the Worker does not crash', async () => {
  const s = await startStack({ port: 8803, stubPort: 4415, fixturePort: 4416, inspectorPort: 9343 });
  try {
    await s.fixture.close(); // the API goes away
    const res = await fetch(`${s.base}/kontak`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: s.base, 'cf-connecting-ip': '203.0.113.250' },
      body: new URLSearchParams(VALID_FORM(10)).toString(),
    });
    assert.equal(res.status, 503);
    assert.match(await res.text(), /Pesan belum dapat dikirim saat ini\./);
    assert.doesNotMatch(s.output(), /Marker10/);
  } finally {
    // the fixture is already closed; stop() closes it again, which must not throw
    await s.stop().catch(() => undefined);
  }
});
await check('contact', 'the Worker limits one address to 5 posts a minute (in-memory fallback, no binding in this stack): the 6th is 429 and never reaches the API', async () => {
  const ip = '203.0.113.210';
  const hits = await contactApi.hits();
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await postForm({ ...VALID_FORM(11), website: 'bot' }, { ip })).status); // honeypot posts: counted, never sent
  assert.deepEqual(statuses, [303, 303, 303, 303, 303, 429]);
  const sixth = await postForm(VALID_FORM(11), { ip });
  assert.equal(sixth.status, 429);
  assert.equal(sixth.headers.get('retry-after'), '60');
  assert.match(await text(sixth), /Terlalu banyak percobaan pengiriman\. Silakan tunggu satu menit lalu coba lagi\./);
  assert.equal(await contactApi.hits(), hits, 'throttled posts did not reach the API');
  assert.equal((await postForm(VALID_FORM(12), { ip: '203.0.113.211' })).status, 303, 'another address is not affected');
});
await check('contact', 'a cross-origin post is refused with 403 and never reaches the API; a post from the site itself is fine', async () => {
  const hits = await contactApi.hits();
  const evil = await postForm(VALID_FORM(13), { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get('cache-control'), 'no-store');
  const cross = await postForm(VALID_FORM(13), { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(cross.status, 403);
  assert.equal(await contactApi.hits(), hits);
  assert.equal((await postForm(VALID_FORM(13))).status, 303);
});
await check('contact', 'other methods: PUT and DELETE are 405 with Allow, HEAD works; a JSON body is a 400 form, a 40 KB body is a 413', async () => {
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    const res = await get('/kontak', { method, ...(method === 'DELETE' ? {} : { body: 'x' }) });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('allow'), 'GET, HEAD, POST');
  }
  assert.equal((await get('/kontak', { method: 'HEAD' })).status, 200);
  const json = await postForm({}, { headers: { 'content-type': 'application/json' } });
  assert.equal(json.status, 400);
  const big = await get('/kontak', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base, 'cf-connecting-ip': '203.0.113.220' },
    body: `message=${'x'.repeat(40 * 1024)}`,
  });
  assert.equal(big.status, 413);
  assert.match(await text(big), /Maksimal 5000 karakter/);
});
await check('contact', '/kontak and its post never reach the legacy origin, and /kontak is in the sitemap', async () => {
  clearStub();
  await get('/kontak');
  await postForm({ ...VALID_FORM(14), website: 'bot' });
  assert.equal(stubHits().length, 0);
  assert.ok((await text(await get('/sitemap.xml'))).includes('<loc>https://sakolakembara.org/kontak</loc>'));
});
await check('contact', 'nothing personal is logged: no name, email address, message text or visitor address appears in the Worker\'s output', async () => {
  const out = stack.output().slice(contactLogStart);
  assert.doesNotMatch(out, /Marker\d|marker\d|@example\.com|Halo, saya ingin bertanya|203\.0\.113\./);
  assert.doesNotMatch(out, /\[ERROR\]|✘|Uncaught|TypeError|ReferenceError/);
});

// the real rate-limit binding (a local miniflare one), with a limit lower than the fallback's, proves the binding is the one asked
await check('contact', 'with a rate-limit binding (CONTACT_LIMITER) the binding decides: a limit of 2 refuses the 3rd post, which the in-memory fallback would have allowed', async () => {
  const config = JSON.parse(readFileSync(path.join(webRoot, 'dist/server/wrangler.json'), 'utf8'));
  config.ratelimits = [{ name: 'CONTACT_LIMITER', namespace_id: '1001', simple: { limit: 2, period: 60 } }];
  const file = path.join(webRoot, 'dist/server/wrangler.ratelimit.json');
  writeFileSync(file, JSON.stringify(config));
  const s = await startStack({ wranglerConfig: file, port: 8804, stubPort: 4417, fixturePort: 4418, inspectorPort: 9344 });
  try {
    const post = (n) =>
      fetch(`${s.base}/kontak`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: s.base, 'cf-connecting-ip': '203.0.113.230' },
        body: new URLSearchParams({ ...VALID_FORM(n), website: 'bot' }).toString(),
      });
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await post(20 + i)).status);
    assert.deepEqual(statuses, [303, 303, 429]);
  } finally {
    await s.stop();
  }
});

// ---------------------------------------------------------------- Turnstile on /kontak (SAKEM-080 + SAKEM-081)
// The Worker only carries the token (the API Worker verifies it): these checks are what the page contains, what
// the API receives, how a refusal is shown, and the page's own scripts run in a DOM next to a stand-in
// `window.turnstile` (scripts/lib/turnstile-stub.mjs). There is no browser and Cloudflare's script is never
// requested: the tag is stripped from the HTML before the DOM runs it, and the stand-in is evaluated from outside.
const CLOUDFLARE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const turnstileLogStart = stack.output().length;
const lastContactEntry = async (before) => (await contactApi.log()).slice(before).at(-1);

await check('turnstile', 'GET /kontak: the slot with the site key (from the Worker var) and the action, Cloudflare\'s script once (explicit, async, defer), the hidden failure line, the notice for visitors without JavaScript, the form still a plain POST', async () => {
  const res = await get('/kontak');
  assert.equal(res.status, 200);
  const html = await text(res);
  assert.match(html, new RegExp(`<div data-turnstile data-sitekey="${TURNSTILE_TEST_SITE_KEY}" data-action="contact" class="min-h-\\[65px\\]"></div>`));
  assert.equal([...html.matchAll(/<script[^>]*challenges\.cloudflare\.com[^>]*>/g)].length, 1, 'Cloudflare\'s script, once');
  assert.match(html, new RegExp(`<script[^>]*\\ssrc="${CLOUDFLARE_SCRIPT.replace(/[.?]/g, '\\$&')}"[^>]*\\sasync[^>]*\\sdefer[^>]*\\sdata-turnstile-api[^>]*>`));
  assert.match(html, /<p data-turnstile-failed hidden role="status"[^>]*>\s*Verifikasi gagal\. Silakan coba lagi\.\s*<\/p>/);
  assert.match(html, /<noscript>\s*<p class="[^"]*border-warning-border bg-warning-bg text-warning-fg[^"]*">\s*Aktifkan JavaScript untuk mengirim pesan\.\s*<\/p>\s*<\/noscript>/);
  assert.match(html, /<form id="kontak-form" method="post" action="\/kontak" class="space-y-5" novalidate>/);
  // inside the form, between the message and the button
  const at = (s) => html.indexOf(s);
  assert.ok(at('name="message"') < at('data-turnstile ') && at('data-turnstile ') < at('type="submit"') && at('type="submit"') < at('</form>'));
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.match(html, /<title>Kontak - Yayasan Sakola Kembara Indonesia<\/title>/, 'the SEO tags are unchanged');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  // size of the widget's script (the one this change added to the page), for the report
  const widget = inlineScripts(html).find((c) => c.includes('data-turnstile'));
  assert.ok(widget, 'the widget script is inline');
  const formScript = inlineScripts(html).find((c) => c.includes('Mengirim...'));
  notes.push(`/kontak scripts: widget ${Buffer.byteLength(widget)} B raw inline, the form's own ${Buffer.byteLength(formScript)} B (unchanged), Cloudflare's file loaded from its origin (not ours)`);
  assert.ok(Buffer.byteLength(widget) < 1500, `${Buffer.byteLength(widget)} bytes`);
});

await check('turnstile', 'Cloudflare\'s script is on /kontak and nowhere else: not on the other pages, the 404, the confirmation or an article', async () => {
  for (const p of ['/', '/donasi', '/tim', '/gabung-siswa', '/gabung-siswa/docs', '/blog', `/blog/${slugs[0]}`, '/program/pembinaan', '/does-not-exist']) {
    const html = await text(await get(p));
    assert.ok(!html.includes('challenges.cloudflare.com'), `${p} names Cloudflare's script`);
    assert.ok(!html.includes('data-turnstile'), `${p} has a widget or its script`);
  }
  // the confirmation has no form, so no slot, no Cloudflare script, no notice (the form component's small
  // inline scripts are on it, as they were before: they find no form and do nothing)
  const done = await text(await get('/kontak?terkirim=1'));
  assert.ok(!done.includes('challenges.cloudflare.com') && !done.includes('<div data-turnstile') && !done.includes('Aktifkan JavaScript'));
});

await check('turnstile', 'a post with the widget\'s token: the API gets it in X-Sakem-Turnstile-Token (never in the body), the visitor gets the 303; the Worker logs nothing of it', async () => {
  await contactApi.mode('ok');
  const before = (await contactApi.log()).length;
  const res = await postForm({ ...VALID_FORM(30), 'cf-turnstile-response': `${STUB_TOKEN}.30` });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/kontak?terkirim=1');
  const entry = await lastContactEntry(before);
  assert.equal(entry.turnstileToken, `${STUB_TOKEN}.30`);
  assert.equal(entry.headers['x-sakem-turnstile-token'], `${STUB_TOKEN}.30`);
  assert.deepEqual(entry.body, { ...VALID_FORM(30), website: '' }, 'the JSON body is the form\'s fields only');
  assert.ok(!JSON.stringify(entry.body).includes('DUMMY'));
  assert.doesNotMatch(stack.output().slice(turnstileLogStart), /DUMMY\.TOKEN/);
});

await check('turnstile', 'a post without a token (no JavaScript; a local run where the API has no secret): still the 303, and the API got no token header: the Worker never refuses for lack of a token, the API decides', async () => {
  await contactApi.mode('ok');
  const before = (await contactApi.log()).length;
  const res = await postForm(VALID_FORM(31));
  assert.equal(res.status, 303);
  const entry = await lastContactEntry(before);
  assert.equal(entry.turnstileToken, undefined);
  assert.equal('x-sakem-turnstile-token' in entry.headers && entry.headers['x-sakem-turnstile-token'] !== undefined, false);
});

await check('turnstile', 'a token that cannot travel in a header (a space, a line break, 3000 characters) is dropped, and the post goes on without it', async () => {
  await contactApi.mode('ok');
  for (const [i, token] of ['two words', 'abc\r\nx-sakem-client-ip: 9.9.9.9', 'a'.repeat(3000)].entries()) {
    const before = (await contactApi.log()).length;
    const res = await postForm({ ...VALID_FORM(32 + i), 'cf-turnstile-response': token }, { ip: `203.0.113.${150 + i}` });
    assert.equal(res.status, 303, token.slice(0, 12));
    const entry = await lastContactEntry(before);
    assert.equal(entry.turnstileToken, undefined);
    assert.equal(entry.clientIp, `203.0.113.${150 + i}`, 'the visitor address header was not touched');
  }
});

await check('turnstile', 'API 400 turnstile_failed: 400, "Verifikasi gagal. Silakan coba lagi.", the typed text kept, no-store, and the form comes back with a fresh widget slot (the reset); no other banner', async () => {
  await contactApi.mode('turnstile');
  try {
    const res = await postForm({ ...VALID_FORM(35), 'cf-turnstile-response': `${STUB_TOKEN}.35` });
    assert.equal(res.status, 400);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('retry-after'), null);
    const html = await text(res);
    assert.match(html, /role="alert"[^>]*>\s*Verifikasi gagal\. Silakan coba lagi\.\s*<\/div>/);
    assert.ok(!html.includes('Silakan periksa kembali isian formulir.') && !html.includes('Pesan belum dapat dikirim'), 'one message, not another');
    assert.ok(!html.includes('API'), 'the API\'s own wording and name are not shown');
    assert.ok(!html.includes('Muat ulang halaman lalu coba lagi'), 'the API\'s own wording is not shown');
    assert.equal(valueOf(html, 'fullName'), VALID_FORM(35).fullName);
    assert.equal(valueOf(html, 'email'), VALID_FORM(35).email);
    assert.equal(textarea(html), VALID_FORM(35).message);
    // a new widget, a new token: the slot and the script are in the page again, and the spent token is not
    assert.match(html, new RegExp(`<div data-turnstile data-sitekey="${TURNSTILE_TEST_SITE_KEY}" data-action="contact"`));
    assert.equal([...html.matchAll(/<script[^>]*challenges\.cloudflare\.com[^>]*>/g)].length, 1);
    assert.ok(!html.includes('cf-turnstile-response') && !html.includes('DUMMY'), 'the spent token is not echoed');
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  } finally {
    await contactApi.mode('ok');
  }
});

await check('turnstile', 'an API that requires a token (the real one, with a secret set): without one 400 turnstile_failed, with one the 303', async () => {
  await contactApi.mode('require_token');
  try {
    const without = await postForm(VALID_FORM(36));
    assert.equal(without.status, 400);
    assert.match(await text(without), /Verifikasi gagal\. Silakan coba lagi\./);
    const withToken = await postForm({ ...VALID_FORM(37), 'cf-turnstile-response': `${STUB_TOKEN}.37` });
    assert.equal(withToken.status, 303);
  } finally {
    await contactApi.mode('ok');
  }
});

/** The served /kontak page in a DOM, as a browser would build it, without any <script> tag running or loading. */
async function kontakInDom(html, { stub = 'before' } = {}) {
  const requests = [];
  const problems = [];
  const sink = (...a) => void problems.push(a.join(' '));
  const window = new Window({
    url: `${base}/kontak`,
    console: { error: sink, warn: sink, log() {}, info() {}, debug() {} },
    settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true },
  });
  window.fetch = (...a) => (requests.push(String(a[0])), Promise.reject(new Error('offline'))); // the navbar script asks the portal Worker (and for the announcement), which are not here
  window.addEventListener('error', (e) => problems.push(`window error: ${e.message}`));
  const scripts = inlineScripts(html);
  // every <script> goes, but Cloudflare's tag stays as an inert element (no src) so the page's script finds its place and a test can fire its events
  window.document.documentElement.innerHTML = html
    .replace(/<script[^>]*challenges\.cloudflare\.com[^>]*><\/script>/, '<script data-turnstile-api type="application/x-inert"></script>')
    .replace(/<script(?![^>]*data-turnstile-api)[\s\S]*?<\/script>/g, '')
    .replace(/<link rel="stylesheet"[^>]*>/g, '')
    .replace(/^<!doctype html>/i, '');
  if (stub === 'before') window.eval(turnstileStubSource);
  // each inline script in a function of its own: they were separate module scripts, and two of them may use the same name at the top level
  for (const code of scripts) window.eval(`(function () {\n${code}\n})();`);
  if (stub === 'after') window.eval(turnstileStubSource);
  return { window, requests, problems, doc: window.document, close: () => window.happyDOM.close() };
}
/** What the stand-in recorded, copied out of the DOM's realm (a plain object of this one). */
const stubCalls = (window) => JSON.parse(window.eval('JSON.stringify(window.__turnstileStub ?? { renders: [], resets: [] })'));
const fillForm = (doc, n) => {
  const v = VALID_FORM(n);
  for (const id of ['fullName', 'email', 'message']) doc.getElementById(id).value = v[id];
  doc.getElementById('subject').value = v.subject;
};
const formFields = (window, doc) => new URLSearchParams(Object.fromEntries([...new window.FormData(doc.getElementById('kontak-form')).entries()].filter(([, v]) => typeof v === 'string')));

await check('turnstile', 'the page\'s scripts in a DOM with a stand-in widget: rendered once with the site key and the action, the token field is in the form, the post carries it to the API; no request goes to Cloudflare', async () => {
  const html = await text(await get('/kontak'));
  const dom = await kontakInDom(html);
  try {
    const calls = stubCalls(dom.window);
    assert.equal(calls.renders.length, 1);
    assert.deepEqual(calls.renders[0].options, { sitekey: TURNSTILE_TEST_SITE_KEY, action: 'contact', theme: 'light', size: 'flexible', language: 'id' });
    const field = dom.doc.querySelector('#kontak-form input[name="cf-turnstile-response"]');
    assert.ok(field, 'the stand-in added the hidden field to the form, like the real widget');
    assert.equal(field.value, `${STUB_TOKEN}.1`);
    assert.equal(dom.doc.querySelector('[data-turnstile-failed]').hidden, true);

    // what the browser would post: the form's own fields, token included
    fillForm(dom.doc, 40);
    const fields = formFields(dom.window, dom.doc);
    assert.equal(fields.get('cf-turnstile-response'), `${STUB_TOKEN}.1`);
    const before = (await contactApi.log()).length;
    const res = await postForm(Object.fromEntries(fields), { ip: '203.0.113.160' });
    assert.equal(res.status, 303);
    const entry = await lastContactEntry(before);
    assert.equal(entry.turnstileToken, `${STUB_TOKEN}.1`);
    assert.equal(entry.body.email, VALID_FORM(40).email);

    // the form's own script still works next to it: pending state, and a restored page resets the spent token
    const button = dom.doc.querySelector('#kontak-form [type=submit]');
    dom.doc.getElementById('kontak-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    assert.equal(button.disabled, true);
    assert.equal(button.textContent.trim(), 'Mengirim...');
    dom.window.dispatchEvent(Object.assign(new dom.window.Event('pageshow'), { persisted: true }));
    assert.equal(button.disabled, false);
    assert.equal(button.textContent.trim(), 'Kirim Pesan');
    assert.deepEqual(stubCalls(dom.window).resets, ['stub-widget-1']);
    assert.equal(dom.doc.querySelector('input[name="cf-turnstile-response"]').value, `${STUB_TOKEN}.reset1`, 'a fresh token after the reset');
    assert.equal(dom.doc.querySelectorAll('input[name="cf-turnstile-response"]').length, 1);
    // the only requests are the navbar's own same-origin ones (the portal's session, the announcement; answered offline here); none goes to Cloudflare
    assert.ok(dom.requests.length > 0 && dom.requests.every((u) => u.startsWith('/portal/api/') || u.startsWith('/api/')), `requests of the page scripts: ${dom.requests.join(', ')}`);
    assert.ok(!dom.requests.some((u) => u.includes('cloudflare')));
  } finally {
    await dom.close();
  }
  assert.deepEqual(dom.problems, []);
});

await check('turnstile', 'in a DOM where Cloudflare\'s script arrives after the page\'s (the load event), the widget still renders once; where it never arrives (the error event) the failure line shows and nothing renders', async () => {
  const html = await text(await get('/kontak'));
  const late = await kontakInDom(html, { stub: 'after' });
  try {
    assert.equal(stubCalls(late.window).renders.length, 0, 'nothing renders before the script is there');
    const tag = late.doc.querySelector('script[data-turnstile-api]');
    tag.dispatchEvent(new late.window.Event('load'));
    assert.equal(stubCalls(late.window).renders.length, 1);
    tag.dispatchEvent(new late.window.Event('load'));
    assert.equal(stubCalls(late.window).renders.length, 1, 'once');
    assert.equal(late.doc.querySelector('[data-turnstile-failed]').hidden, true);
  } finally {
    await late.close();
  }
  const blocked = await kontakInDom(html, { stub: 'none' });
  try {
    const failed = blocked.doc.querySelector('[data-turnstile-failed]');
    assert.equal(failed.hidden, true);
    blocked.doc.querySelector('script[data-turnstile-api]').dispatchEvent(new blocked.window.Event('error'));
    assert.equal(failed.hidden, false);
    assert.equal(failed.textContent.trim(), 'Verifikasi gagal. Silakan coba lagi.');
    assert.equal(blocked.doc.querySelector('input[name="cf-turnstile-response"]'), null);
  } finally {
    await blocked.close();
  }
  assert.deepEqual([...late.problems, ...blocked.problems], []);
});

await check('turnstile', 'the stand-in is not a switch of the site: nothing the Worker serves names it, and a request for it is the real 404', async () => {
  const html = await text(await get('/kontak'));
  assert.doesNotMatch(html, /turnstile-stub|__turnstileStub|DUMMY\.TOKEN|probe-api/);
  for (const p of ['/scripts/lib/turnstile-stub.mjs', '/turnstile-stub.js', '/__turnstile-stub.js']) assert.equal((await get(p)).status, 404, p);
});

await check('turnstile', 'a stack with no TURNSTILE_SITE_KEY: no widget, no Cloudflare script, no notice, the Worker log says so, and the form still posts (the API decides)', async () => {
  const s = await startStack({ port: 8805, stubPort: 4419, fixturePort: 4420, inspectorPort: 9345, turnstileSiteKey: null });
  try {
    const res = await fetch(`${s.base}/kontak`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(!html.includes('challenges.cloudflare.com') && !html.includes('<div data-turnstile') && !html.includes('Aktifkan JavaScript') && !html.includes('<p data-turnstile-failed'));
    assert.match(html, /<form id="kontak-form" method="post" action="\/kontak"/);
    // the Worker's console reaches wrangler's output a moment after the response
    for (let i = 0; i < 30 && !/TURNSTILE_SITE_KEY is not set/.test(s.output()); i++) await new Promise((r) => setTimeout(r, 100));
    assert.match(s.output(), /contact: TURNSTILE_SITE_KEY is not set; the form is rendered without the bot-check widget/);
    const post = await fetch(`${s.base}/kontak`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: s.base, 'cf-connecting-ip': '203.0.113.161' },
      body: new URLSearchParams(VALID_FORM(41)).toString(),
    });
    assert.equal(post.status, 303);
    // the confirmation page has no form, so it neither warns nor shows a widget
    const before = s.output().length;
    await fetch(`${s.base}/kontak?terkirim=1`);
    await new Promise((r) => setTimeout(r, 500));
    assert.doesNotMatch(s.output().slice(before), /TURNSTILE_SITE_KEY/);
  } finally {
    await s.stop();
  }
});

await check('turnstile', 'the Worker\'s output has no token, no personal data and no error from any of the above', async () => {
  const out = stack.output().slice(turnstileLogStart);
  assert.doesNotMatch(out, /DUMMY\.TOKEN|XXXX\./);
  assert.doesNotMatch(out, /Marker\d|marker\d|@example\.com|Halo, saya ingin bertanya|203\.0\.113\./);
  assert.doesNotMatch(out, /\[ERROR\]|✘|Uncaught|TypeError|ReferenceError/);
});

// ---------------------------------------------------------------- the service binding (SAKEM-080 + SAKEM-081)
// The built Worker with NO CONTENT_API_URL and NO CONTACT_API_URL, and a second local Worker named like the
// `services` entry of the built config (`sakem-admin`) standing in for the API Worker on its `PublicApi`
// entrypoint (scripts/lib/probe-api-worker.mjs). Every read and the contact post must go through it: the fixture
// is only reachable from the probe, so a page that renders its data proves the binding carried the request.
await check('binding', 'the built config binds `API` to the PublicApi entrypoint of `sakem-admin`, and sets neither API URL', async () => {
  const config = JSON.parse(readFileSync(path.join(webRoot, 'dist/server/wrangler.json'), 'utf8'));
  assert.deepEqual(config.services, [{ binding: 'API', service: 'sakem-admin', entrypoint: 'PublicApi' }]);
  assert.deepEqual(config.vars, {}, 'no var in the deployed config: no API URL, no key');
});

await check('binding', 'with no API URL set, /tim, /donasi (its Laporan section), /gabung-siswa/docs, the blog and the sitemap are rendered from data that only the binding can reach', async () => {
  const s = await startStack({ port: 8806, stubPort: 4421, fixturePort: 4422, inspectorPort: 9346, binding: true });
  const f = `http://127.0.0.1:${s.fixture.port}`;
  try {
    const hits = async () => (await (await fetch(`${f}/__hits`)).json()).byEndpoint;
    const pages = [
      ['/tim', 'Anggota Contoh 1', 'x-team-source', 'team'],
      ['/donasi', 'Laporan Dampak 2025/2026', 'x-reports-source', 'reports'],
      ['/gabung-siswa/docs', 'Panduan Pendaftaran Siswa Baru', 'x-resources-source', 'resources'],
    ];
    for (const [p, marker, header, endpoint] of pages) {
      const before = (await hits())[endpoint];
      const res = await fetch(s.base + p);
      assert.equal(res.status, 200, p);
      assert.equal(res.headers.get(header), 'network', p);
      assert.ok((await res.text()).includes(marker), `${p} shows the fixture's data`);
      assert.equal((await hits())[endpoint], before + 1, `${p}: the API was asked once, through the binding`);
    }
    const blog = await fetch(`${s.base}/blog`);
    assert.equal(blog.status, 200);
    assert.equal(blog.headers.get('x-blog-source'), 'network');
    const article = await fetch(`${s.base}/blog/${slugs[0]}`);
    assert.equal(article.status, 200);
    assert.equal(article.headers.get('x-blog-source'), 'network');
    assert.equal((await fetch(`${s.base}/blog/does-not-exist`)).status, 404, 'the contract\'s 404 comes through the binding as a real 404');
    assert.equal((await fetch(`${s.base}/sitemap.xml`)).status, 200);
    assert.ok((await hits()).blog >= 4);
    // (the startup banner of wrangler says "[not connected]" for a binding whose Worker registers a moment later; what matters is that no call failed)
    assert.doesNotMatch(s.output(), /\[ERROR\]|Uncaught|TypeError|Couldn't find|could not be found|no local dev session/i);
    assert.match(s.output(), /env\.API \(sakem-admin#PublicApi\)\s+Worker/, 'the binding of the built config, to the entrypoint');
    assert.ok(!/CONTENT_API_URL|CONTACT_API_URL/.test(s.output()), 'neither API URL is set in this stack');
  } finally {
    await s.stop();
  }
});

await check('binding', 'the contact form through the binding: the visitor address and the token reach the API in their headers, the answers map as before (303, turnstile_failed, 429)', async () => {
  const s = await startStack({ port: 8807, stubPort: 4423, fixturePort: 4424, inspectorPort: 9347, binding: true });
  const f = `http://127.0.0.1:${s.fixture.port}`;
  try {
    const post = (n, extra = {}, ip = '203.0.113.170') =>
      fetch(`${s.base}/kontak`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: s.base, 'cf-connecting-ip': ip },
        body: new URLSearchParams({ ...VALID_FORM(n), ...extra }).toString(),
      });
    const sent = await post(50, { 'cf-turnstile-response': `${STUB_TOKEN}.50` });
    assert.equal(sent.status, 303);
    const [entry] = await (await fetch(`${f}/__contact-log`)).json();
    assert.equal(entry.clientIp, '203.0.113.170');
    assert.equal(entry.turnstileToken, `${STUB_TOKEN}.50`);
    assert.equal(entry.headers['content-type'], 'application/json');
    assert.deepEqual(entry.body, { ...VALID_FORM(50), website: '' });
    await setFixtureMode(f, 'contact', 'turnstile');
    const refused = await post(51, { 'cf-turnstile-response': `${STUB_TOKEN}.51` }, '203.0.113.171');
    assert.equal(refused.status, 400);
    assert.match(await refused.text(), /Verifikasi gagal\. Silakan coba lagi\./);
    await setFixtureMode(f, 'contact', '429');
    assert.equal((await post(52, {}, '203.0.113.172')).status, 429);
    await setFixtureMode(f, 'contact', 'ok');
    const page = await fetch(`${s.base}/kontak`);
    assert.equal(page.status, 200, 'the page itself needs no API');
    assert.doesNotMatch(s.output(), /Marker\d|marker\d|@example\.com|DUMMY\.TOKEN|\[ERROR\]|Uncaught|TypeError/);
  } finally {
    await s.stop();
  }
});

await check('binding', 'a shortlink is resolved through the binding (no API URL set): the visitor gets the 307, one lookup per visit reaches the API, which counts the click', async () => {
  const s = await startStack({ port: 8809, stubPort: 4427, fixturePort: 4428, inspectorPort: 9349, binding: true });
  const f = `http://127.0.0.1:${s.fixture.port}`;
  try {
    const first = await fetch(`${s.base}/daftar-2026`, { redirect: 'manual' });
    assert.equal(first.status, 307);
    assert.equal(first.headers.get('location'), 'https://example.org/form');
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await (await fetch(`${f}/__clicks`)).json(), { 'daftar-2026': 1 });
    const unknown = await fetch(`${s.base}/no-such-link`, { redirect: 'manual' });
    assert.equal(unknown.status, 404);
    assert.match(await unknown.text(), /Halaman tidak ditemukan/);
    assert.deepEqual(await (await fetch(`${f}/__requests?for=shortlink`)).json(), ['/api/public/shortlinks/daftar-2026', '/api/public/shortlinks/no-such-link']);

    // Wall time of a visit, from this machine through wrangler dev, the binding and the fixture: a proxy for the cost
    // (docs/cloudflare/admin-konten.md), not Worker CPU, which workerd cannot report locally.
    const times = [];
    for (let n = 0; n < 40; n++) {
      const started = performance.now();
      const res = await fetch(`${s.base}/unduh-panduan`, { redirect: 'manual' });
      await res.arrayBuffer();
      if (n >= 5) times.push(performance.now() - started);
      assert.equal(res.status, 307);
    }
    times.sort((a, b) => a - b);
    notes.push(`shortlink visit through the binding (n=35 after 5 warm-up, wall ms, local): median ${times[17].toFixed(1)}, p95 ${times[33].toFixed(1)}, max ${times[34].toFixed(1)}`);
    assert.deepEqual((await (await fetch(`${f}/__clicks`)).json())['unduh-panduan'], 40, 'every visit was counted');
    assert.doesNotMatch(s.output(), /\[ERROR\]|Uncaught|TypeError/);
  } finally {
    await s.stop();
  }
});

await check('binding', 'a binding whose Worker is gone is an outage, not a crash: the pages show their degraded state (/donasi stays a 200) and the form says it cannot send', async () => {
  const s = await startStack({ port: 8808, stubPort: 4425, fixturePort: 4426, inspectorPort: 9348, binding: true });
  try {
    await s.fixture.close(); // the probe's upstream goes away: the entrypoint answers with a failure
    const tim = await fetch(`${s.base}/tim`);
    assert.equal(tim.status, 200, '/tim keeps its legacy empty state');
    assert.equal(tim.headers.get('x-team-source'), 'empty');
    // /donasi only CARRIES the reports (SAKEM-105): without the API it is still the page, a 200, and the section says so
    const donasi = await fetch(`${s.base}/donasi`);
    assert.equal(donasi.status, 200);
    assert.equal(donasi.headers.get('x-reports-source'), 'empty');
    assert.equal(donasi.headers.get('cache-control'), 'no-store');
    assert.ok((await donasi.text()).includes('Laporan belum dapat ditampilkan'));
    const post = await fetch(`${s.base}/kontak`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: s.base, 'cf-connecting-ip': '203.0.113.173' },
      body: new URLSearchParams(VALID_FORM(53)).toString(),
    });
    assert.equal(post.status, 503);
    assert.match(await post.text(), /Pesan belum dapat dikirim saat ini\./);
    assert.doesNotMatch(s.output(), /Marker\d|@example\.com|Uncaught/);
  } finally {
    await s.stop().catch(() => undefined);
  }
});

// ---------------------------------------------------------------- the page copy in memory (SAKEM-091, src/lib/page-cache.ts)
// Off unless PAGE_CACHE_SECONDS is set: the whole run above is the proof that nothing changed when it is not. These
// checks start a Worker with it on and look at what a copy may and may not be.
await check('page-cache', 'off by default: no page carries x-page-cache, and every request renders', async () => {
  for (const p of ['/blog', '/tim', '/donasi']) assert.equal((await get(p)).headers.get('x-page-cache'), null, p);
});

await check('page-cache', 'on: the first render says miss and is kept; the next request is a copy (no API call, same bytes, same headers), then it expires', async () => {
  const s = await startStack({ port: 8809, stubPort: 4427, fixturePort: 4428, inspectorPort: 9349, vars: { PAGE_CACHE_SECONDS: '3', CONTENT_CACHE_FRESH_SECONDS: '60', TEAM_CACHE_FRESH_SECONDS: '60' } });
  const f = `http://127.0.0.1:${s.fixture.port}`;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 500));
  const hits = async () => (await (await fetch(`${f}/__hits`)).json()).byEndpoint;
  try {
    const slug = slugs[0];
    const pages = ['/blog', '/blog?page=2', `/blog/${slug}`, '/tim', '/donasi', '/gabung-siswa/docs', '/sitemap.xml'];
    for (const p of pages) {
      const first = await fetch(`${s.base}${p}`);
      assert.equal(first.status, 200, p);
      assert.equal(first.headers.get('x-page-cache'), 'miss', `${p} is rendered and kept`);
      const rendered = await first.text();
      await settle(); // the copy is made after the answer has gone
      const before = await hits();
      const second = await fetch(`${s.base}${p}`);
      assert.equal(second.status, 200, p);
      assert.equal(second.headers.get('x-page-cache'), 'hit', `${p} is a copy`);
      assert.equal(await second.text(), rendered, `${p}: the copy is the page that was rendered, byte for byte`);
      for (const name of ['content-type', 'cache-control', 'x-blog-source', 'x-team-source', 'strict-transport-security', 'x-content-type-options', 'x-frame-options']) {
        assert.equal(second.headers.get(name), first.headers.get(name), `${p}: ${name}`);
      }
      assert.deepEqual(await hits(), before, `${p}: a copy asks nobody`);
      if (p === '/blog') {
        // A query string nobody reads does not make a new page: it is the same copy.
        assert.equal((await fetch(`${s.base}/blog?x=1&y=2`)).headers.get('x-page-cache'), 'hit', 'a query nobody reads shares the copy');
      }
    }

    // The page that IS read in the query is another page: page 3 was never rendered. Its copy ends after the
    // configured seconds (3), and the next request renders it again.
    assert.equal((await fetch(`${s.base}/blog?page=3`)).headers.get('x-page-cache'), 'miss');
    await settle();
    assert.equal((await fetch(`${s.base}/blog?page=3`)).headers.get('x-page-cache'), 'hit');
    await new Promise((resolve) => setTimeout(resolve, 3200));
    assert.equal((await fetch(`${s.base}/blog?page=3`)).headers.get('x-page-cache'), 'miss', 'expired: rendered again');
    assert.doesNotMatch(s.output(), /\[ERROR\]|Uncaught|TypeError/);
  } finally {
    await s.stop();
  }
});

await check('page-cache', 'on: what must not be copied is not: a 404, a stale or failed answer, a form, a short link, other pages', async () => {
  const s = await startStack({ port: 8810, stubPort: 4429, fixturePort: 4430, inspectorPort: 9350, vars: { PAGE_CACHE_SECONDS: '30', CONTENT_CACHE_FRESH_SECONDS: '1', TEAM_CACHE_FRESH_SECONDS: '1' } });
  const f = `http://127.0.0.1:${s.fixture.port}`;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 500));
  try {
    // An unknown article is a 404 each time (the API is asked again), never a copy.
    const asked = async () => (await (await fetch(`${f}/__requests?for=blog`)).json()).filter((p) => p.includes('no-such-article')).length;
    const miss = await fetch(`${s.base}/blog/no-such-article`);
    assert.equal(miss.status, 404);
    assert.equal(miss.headers.get('x-page-cache'), null);
    await settle();
    const again = await fetch(`${s.base}/blog/no-such-article`);
    assert.equal(again.status, 404);
    assert.equal(again.headers.get('x-page-cache'), null);
    assert.ok((await asked()) >= 1);

    // Pages that are not on the list never carry the header.
    for (const p of ['/kontak', '/gabung-siswa', '/laporan', '/tim/extra', '/no/such/page']) {
      const res = await fetch(`${s.base}${p}`, { redirect: 'manual' });
      assert.equal(res.headers.get('x-page-cache'), null, p);
    }

    // The API fails and nothing is stored for /donasi (SAKEM-105): the page is still a 200 (it never fails because of the reports) and says no-store,
    // so it is NOT copied (a copy of the failure panel would keep the panel for the configured 30 s after the API is back): recovery shows at once.
    await setFixtureMode(f, 'reports', '500');
    const down = await fetch(`${s.base}/donasi`);
    assert.equal(down.status, 200);
    assert.equal(down.headers.get('x-reports-source'), 'empty');
    assert.equal(down.headers.get('cache-control'), 'no-store');
    assert.equal(down.headers.get('x-page-cache'), null);
    assert.ok((await down.text()).includes('Laporan belum dapat ditampilkan'));
    await settle();
    const downAgain = await fetch(`${s.base}/donasi`);
    assert.equal(downAgain.headers.get('x-page-cache'), null, 'the degraded page is not a copy, however many times it is asked for');
    await setFixtureMode(f, 'reports', 'ok');
    const back = await fetch(`${s.base}/donasi`);
    assert.equal(back.status, 200, 'the failure panel was not kept');
    assert.equal(back.headers.get('x-page-cache'), 'miss');
    const backText = await back.text();
    assert.ok(backText.includes('Laporan Dampak 2025/2026') && !backText.includes('Laporan belum dapat ditampilkan'));

    // A copy is of the data as it was: an outage after the copy was made does not touch it until it expires.
    await settle();
    await setFixtureMode(f, 'reports', '500');
    const served = await fetch(`${s.base}/donasi`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('x-page-cache'), 'hit');
    assert.ok((await served.text()).includes('Laporan Dampak 2025/2026'));
    assert.doesNotMatch(s.output(), /\[ERROR\]|Uncaught|TypeError/);
  } finally {
    await s.stop();
  }
});

// ---------------------------------------------------------------- Cloudflare Web Analytics (SAKEM-095, decision D-07)
// ONE beacon tag at the end of <body>, only when a valid WEB_ANALYTICS_BEACON_ID is configured, and a page gets it from
// its own source: the pages the Worker renders from the Worker variable (checked here, with a `--var`), the prerendered
// ones from the build's environment (checked by scripts/e2e-analytics.mjs against a second build). This group runs the
// plain build: nothing is configured in `stack`, so nothing carries the beacon, and a Worker variable alone cannot
// reach a static file. The id is invented.
const BEACON_ID = '0123456789abcdef0123456789abcdef';
const BEACON_PRERENDERED = ['/', '/gabung-siswa', '/program/prapembinaan', '/program/pembinaan', '/program/pasca-pembinaan'];
const BEACON_RENDERED = ['/blog', '/blog?page=2', `/blog/${slugs[0]}`, '/tim', '/donasi', '/gabung-siswa/docs', '/kontak', '/kontak?terkirim=1', '/no-such-page', '/blog/no-such-article'];
const BEACON_ANYWHERE = /cloudflareinsights|data-cf-beacon|beacon\.min\.js/i;
const beaconTags = (html) => [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]).filter((t) => BEACON_ANYWHERE.test(t));

await check('analytics', 'no beacon id configured (the plain build, no Worker variable): no page of either kind has the script, the tag or the host, and none sends a policy or a cookie', async () => {
  for (const p of [...BEACON_PRERENDERED, ...BEACON_RENDERED]) {
    const res = await get(p);
    const html = await text(res);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/, p);
    assert.doesNotMatch(html, BEACON_ANYWHERE, p);
    assert.ok(html.includes('</footer> </div> </body></html>'), `${p}: the page ends as it did before the beacon`);
    assert.equal(res.headers.get('content-security-policy'), null, p);
    assert.equal(res.headers.get('content-security-policy-report-only'), null, p);
    assert.equal(res.headers.get('set-cookie'), null, p);
  }
});

await check('analytics', 'a stack with the Worker variable: every page the Worker renders has exactly one beacon tag, a module script with the token, after the footer; status and policy headers are as without it', async () => {
  const s = await startStack({ port: 8811, stubPort: 4431, fixturePort: 4432, inspectorPort: 9351, vars: { WEB_ANALYTICS_BEACON_ID: BEACON_ID, ADMIN_URL: 'https://admin.example.test' } });
  const plain = (p) => fetch(`${stack.base}${p}`, { redirect: 'manual' });
  try {
    for (const p of BEACON_RENDERED) {
      const res = await fetch(`${s.base}${p}`, { redirect: 'manual' });
      const html = await res.text();
      const tags = beaconTags(html);
      assert.equal(tags.length, 1, `${p}: one tag`);
      assert.equal(html.split('data-cf-beacon').length - 1, 1, `${p}: one attribute`);
      const tag = tags[0];
      assert.match(tag, /^<script type="module" src="https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js" data-cf-beacon="[^"]*">$/, p);
      assert.doesNotMatch(tag, /\b(defer|async)\b/, p);
      const json = JSON.parse(decodeEntities(tag.match(/data-cf-beacon="([^"]*)"/)[1]));
      assert.deepEqual(json, { token: BEACON_ID }, p);
      assert.ok(html.lastIndexOf(tag) > html.lastIndexOf('</footer>') && html.indexOf('</body>') > html.lastIndexOf(tag), `${p}: at the end of <body>`);
      assert.doesNotMatch(html.slice(0, html.indexOf('</head>')), BEACON_ANYWHERE, `${p}: not in <head>`);
      // the beacon changes nothing else about the answer
      const without = await plain(p);
      assert.equal(res.status, without.status, `${p}: status`);
      assert.equal(res.headers.get('content-security-policy'), null, p);
      assert.equal(res.headers.get('set-cookie'), null, p);
      assert.equal(res.headers.get('cache-control'), without.headers.get('cache-control'), `${p}: cache-control`);
    }
    // what the beacon must not do to the pages' own facts: the contact form and the 404 keep their statuses
    assert.equal((await fetch(`${s.base}/no-such-page`)).status, 404);
    assert.equal((await fetch(`${s.base}/kontak`)).status, 200);
  } finally {
    await s.stop();
  }
});

await check('analytics', 'with only the Worker variable the prerendered pages (static files) have no beacon, and the answers that are not HTML (a redirect to the admin host, the JSON 404 of /api, robots.txt, the sitemap) carry none either', async () => {
  const s = await startStack({ port: 8811, stubPort: 4431, fixturePort: 4432, inspectorPort: 9351, vars: { WEB_ANALYTICS_BEACON_ID: BEACON_ID, ADMIN_URL: 'https://admin.example.test' } });
  try {
    for (const p of BEACON_PRERENDERED) {
      const res = await fetch(`${s.base}${p}`, { redirect: 'manual' });
      assert.equal(res.status, 200, p);
      assert.doesNotMatch(await res.text(), BEACON_ANYWHERE, `${p}: static HTML cannot see a Worker variable`);
    }
    const admin = await fetch(`${s.base}/admin/blog`, { redirect: 'manual' });
    assert.equal(admin.status, 308);
    assert.equal(admin.headers.get('location'), 'https://admin.example.test/blog');
    assert.equal(await admin.text(), '');
    const api = await fetch(`${s.base}/api/anything`, { redirect: 'manual' });
    assert.equal(api.status, 404);
    assert.match(api.headers.get('content-type') ?? '', /json/);
    assert.doesNotMatch(await api.text(), BEACON_ANYWHERE);
    for (const p of ['/robots.txt', '/sitemap.xml']) {
      const res = await fetch(`${s.base}${p}`);
      assert.doesNotMatch(await res.text(), BEACON_ANYWHERE, p);
    }
  } finally {
    await s.stop();
  }
});

await check('analytics', 'an invalid Worker variable is ignored: no tag on any rendered page, the value is in no page and no log line, and the Worker says once, in fixed words, that it is wrong', async () => {
  const hostile = '"><img src=x onerror=alert(1)>0123456789';
  const s = await startStack({ port: 8812, stubPort: 4433, fixturePort: 4434, inspectorPort: 9352, vars: { WEB_ANALYTICS_BEACON_ID: hostile } });
  try {
    for (const p of ['/blog', `/blog/${slugs[0]}`, '/tim', '/kontak', '/no-such-page', '/blog']) {
      const res = await fetch(`${s.base}${p}`, { redirect: 'manual' });
      const html = await res.text();
      assert.doesNotMatch(html, BEACON_ANYWHERE, p);
      assert.ok(!html.includes('onerror') && !html.includes('src=x') && !html.includes('0123456789&quot;'), `${p}: the value is not echoed`);
    }
    for (let i = 0; i < 30 && !/WEB_ANALYTICS_BEACON_ID is set but is not a beacon id/.test(s.output()); i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 300));
    const out = s.output();
    assert.equal(out.split('WEB_ANALYTICS_BEACON_ID is set but is not a beacon id (32 hexadecimal characters); the page is rendered without the beacon').length - 1, 1, 'one line per isolate');
    assert.doesNotMatch(out, /onerror|src=x|alert\(1\)/);
  } finally {
    await s.stop();
  }
});

await check('analytics', 'unset is silent: the default stack\'s Worker output has no line about the beacon', async () => {
  assert.doesNotMatch(stack.output(), /WEB_ANALYTICS_BEACON_ID|beacon/i, 'nothing to say when it is unset');
});

// ---------------------------------------------------------------- Google Tag Manager (SAKEM-108)
// Google's two parts, only when a valid GTM_CONTAINER_ID is configured: the inline script right after <meta charset> and the
// <noscript> frame right after <body>. The pages the Worker renders take the Worker variable (checked here); the prerendered
// ones take the build's value (scripts/e2e-analytics.mjs). The plain build and the default stack have none. The id is invented.
const GTM_ID = 'GTM-TEST123';
const GTM_ANYWHERE = /googletagmanager|GTM-[0-9A-Z]{4,}/i;
const gtmParts = (html) => ({ scripts: html.split('googletagmanager.com/gtm.js').length - 1, frames: html.split('googletagmanager.com/ns.html').length - 1 });

await check('gtm', 'no container id configured (the plain build, no Worker variable): no page of either kind names Tag Manager', async () => {
  for (const p of [...BEACON_PRERENDERED, ...BEACON_RENDERED]) assert.doesNotMatch(await text(await get(p)), GTM_ANYWHERE, p);
  assert.doesNotMatch(stack.output(), /GTM_CONTAINER_ID|tag manager/i, 'nothing to say when it is unset');
});

await check('gtm', 'a stack with the Worker variable: every rendered page has one script right after <meta charset> and one frame right after <body>, with the id; the prerendered pages and the answers that are not HTML have none', async () => {
  const s = await startStack({ port: 8815, stubPort: 4439, fixturePort: 4440, inspectorPort: 9355, vars: { GTM_CONTAINER_ID: GTM_ID, ADMIN_URL: 'https://admin.example.test' } });
  try {
    for (const p of BEACON_RENDERED) {
      const res = await fetch(`${s.base}${p}`, { redirect: 'manual' });
      const html = await res.text();
      assert.deepEqual(gtmParts(html), { scripts: 1, frames: 1 }, p);
      assert.ok(html.includes(`'dataLayer',"${GTM_ID}");</script>`), `${p}: the id in the script`);
      assert.match(html, /<meta charset="utf-8"><script>\(function\(w,d,s,l,i\)/, `${p}: the script right after the charset`);
      assert.ok(html.includes(`<body class="antialiased"><noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`), `${p}: the frame right after <body>`);
      assert.equal(res.headers.get('set-cookie'), null, p);
      assert.equal(res.headers.get('content-security-policy'), null, p);
    }
    for (const p of BEACON_PRERENDERED) assert.doesNotMatch(await (await fetch(`${s.base}${p}`, { redirect: 'manual' })).text(), GTM_ANYWHERE, `${p}: static HTML cannot see a Worker variable`);
    for (const p of ['/robots.txt', '/sitemap.xml', '/api/anything']) assert.doesNotMatch(await (await fetch(`${s.base}${p}`, { redirect: 'manual' })).text(), GTM_ANYWHERE, p);
  } finally {
    await s.stop();
  }
});

await check('gtm', 'an invalid Worker variable is ignored: no part on any rendered page, the value is in no page and no log line, and the Worker says once that it is wrong', async () => {
  const hostile = 'GTM-X");alert(1);("';
  const s = await startStack({ port: 8816, stubPort: 4441, fixturePort: 4442, inspectorPort: 9356, vars: { GTM_CONTAINER_ID: hostile } });
  try {
    for (const p of ['/blog', '/tim', '/kontak', '/no-such-page', '/blog']) {
      const html = await (await fetch(`${s.base}${p}`, { redirect: 'manual' })).text();
      assert.doesNotMatch(html, /googletagmanager|alert\(1\)/, p);
    }
    for (let i = 0; i < 30 && !/GTM_CONTAINER_ID is set but is not a container id/.test(s.output()); i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 300));
    const out = s.output();
    assert.equal(out.split('GTM_CONTAINER_ID is set but is not a container id').length - 1, 1, 'one line per isolate');
    assert.doesNotMatch(out, /alert\(1\)/);
  } finally {
    await s.stop();
  }
});

// ---------------------------------------------------------------- the student portal switch (SAKEM-103, Phase A of the cutover)
// The navbar's "Masuk" link and its session script exist only while PORTAL_ENABLED says the portal is live. Default OFF: the plain stack above
// has neither anywhere (group `portal-paths`). A page gets the value from its own source: the pages the Worker renders from the Worker variable
// (checked here, with a `--var`), the prerendered ones from the build's environment (checked by scripts/e2e-portal.mjs against two more
// builds). This group runs the plain build, so a Worker variable alone cannot reach a static file. Only strict values count.
const PORTAL_PRERENDERED = ['/', '/gabung-siswa', '/program/prapembinaan', '/program/pembinaan', '/program/pasca-pembinaan'];
const PORTAL_RENDERED = ['/blog', '/blog?page=2', `/blog/${slugs[0]}`, '/tim', '/donasi', '/gabung-siswa/docs', '/kontak', '/kontak?terkirim=1', '/no-such-page', '/blog/no-such-article'];
const portalNav = (html) => html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
const portalScripts = (html) => [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);

await check('portal', 'the portal switch with the Worker variable true: every page the Worker renders has "Masuk" in the bar and in the menu (/portal/login), one inline session script and no "Daftar Sekarang" in the navbar; status and cache headers are as without it', async () => {
  const s = await startStack({ port: 8816, stubPort: 4439, fixturePort: 4440, inspectorPort: 9355, vars: { PORTAL_ENABLED: 'true', ADMIN_URL: 'https://admin.example.test' } });
  const plain = (p) => fetch(`${stack.base}${p}`, { redirect: 'manual' });
  try {
    for (const p of PORTAL_RENDERED) {
      const res = await fetch(`${s.base}${p}`, { redirect: 'manual' });
      const html = await res.text();
      const nav = portalNav(html);
      assert.equal((nav.match(/<a href="\/portal\/login" data-auth-link/g) ?? []).length, 2, `${p}: Masuk in the bar and in the menu`);
      assert.ok(!nav.includes('Daftar Sekarang'), `${p}: the registration button is not in the navbar while the portal is on`);
      assert.deepEqual(menuLists(nav), [MENU_ON], `${p}: the menu stays in the centre column while the portal is on (no class that moves it right)`);
      assert.ok(!nav.includes('col-start-3'), p);
      const session = portalScripts(html).filter((code) => code.includes('get-session'));
      assert.equal(session.length, 1, `${p}: one session script`);
      assert.ok(session[0].includes('/portal/api/auth/get-session') && session[0].includes('sk:session') && session[0].includes('super_admin'), `${p}: it is the whole session script`);
      assert.ok(!session[0].includes('announcement'), `${p}: it is a script of its own, apart from the navbar's`);
      assert.equal((html.match(/get-session/g) ?? []).length, 1, p);
      assert.deepEqual([...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]).filter((src) => !src.startsWith('https://challenges.cloudflare.com/')), [], `${p}: the script is inline: no script file of ours (the contact form has Cloudflare's own)`);
      // the navbar script itself is the same as without the portal (the announcement strip, the menu, the year)
      assert.equal(portalScripts(html).filter((code) => code.includes('nav-toggle')).length, 1, p);
      // nothing else about the answer changes
      const without = await plain(p);
      assert.equal(res.status, without.status, `${p}: status`);
      assert.equal(res.headers.get('cache-control'), without.headers.get('cache-control'), `${p}: cache-control`);
      assert.equal(res.headers.get('strict-transport-security'), without.headers.get('strict-transport-security'), p);
      assert.equal(res.headers.get('set-cookie'), null, p);
    }
    assert.equal((await fetch(`${s.base}/no-such-page`)).status, 404);
    assert.equal((await fetch(`${s.base}/kontak`)).status, 200);
  } finally {
    await s.stop();
  }
});

await check('portal', 'with only the Worker variable the prerendered pages (static files) are unchanged: the empty slot, no "Masuk", no session script (a Worker variable cannot reach static HTML); the redirects, the admin and API answers do not change either', async () => {
  const s = await startStack({ port: 8816, stubPort: 4439, fixturePort: 4440, inspectorPort: 9355, vars: { PORTAL_ENABLED: 'true', ADMIN_URL: 'https://admin.example.test' } });
  try {
    for (const p of PORTAL_PRERENDERED) {
      const res = await fetch(`${s.base}${p}`, { redirect: 'manual' });
      assert.equal(res.status, 200, p);
      const html = await res.text();
      assert.ok(!html.includes('get-session'), `${p}: a Worker variable cannot put the session call in static HTML`);
      assert.ok(!html.includes('/portal'), p);
      assert.deepEqual(navbarProblems(html), [], `${p}: still the empty slot`);
    }
    // /portal itself is still the site's 404 in this stack: nothing attaches a portal Worker to the route here, whatever the switch says
    const portal = await fetch(`${s.base}/portal`, { redirect: 'manual' });
    assert.equal(portal.status, 404);
    const admin = await fetch(`${s.base}/admin/blog`, { redirect: 'manual' });
    assert.equal(admin.status, 308);
    assert.equal(admin.headers.get('location'), 'https://admin.example.test/blog');
    const api = await fetch(`${s.base}/api/anything`, { redirect: 'manual' });
    assert.equal(api.status, 404);
    assert.match(api.headers.get('content-type') ?? '', /json/);
  } finally {
    await s.stop();
  }
});

await check('portal', 'PORTAL_ENABLED=false is off and silent: the same pages as unset, and no line in the Worker log', async () => {
  const s = await startStack({ port: 8817, stubPort: 4441, fixturePort: 4442, inspectorPort: 9356, vars: { PORTAL_ENABLED: 'false' } });
  try {
    for (const p of ['/blog', '/tim', '/kontak', '/no-such-page']) {
      const html = await (await fetch(`${s.base}${p}`, { redirect: 'manual' })).text();
      assert.ok(!html.includes('get-session') && !html.includes('data-auth-link'), p);
      assert.deepEqual(navbarProblems(html), [], p);
    }
    await new Promise((r) => setTimeout(r, 300));
    assert.doesNotMatch(s.output(), /portal: PORTAL_ENABLED/, 'a valid false is not reported');
  } finally {
    await s.stop();
  }
});

await check('portal', 'a value that is not exactly true or false (TRUE, 1, yes, a hostile string) leaves the portal off: the page is the Phase A page, the value is in no page and no log line, and the Worker says once, in fixed words, that it is wrong', async () => {
  const hostile = '"><img src=x onerror=alert(1)>true';
  for (const [value, port] of [[hostile, 8818], ['TRUE', 8819], ['1', 8820]]) {
    const s = await startStack({ port, stubPort: port - 8818 + 4443, fixturePort: port - 8818 + 4444, inspectorPort: port - 8818 + 9357, vars: { PORTAL_ENABLED: value } });
    try {
      for (const p of ['/blog', `/blog/${slugs[0]}`, '/tim', '/kontak', '/no-such-page', '/blog']) {
        const html = await (await fetch(`${s.base}${p}`, { redirect: 'manual' })).text();
        assert.ok(!html.includes('get-session') && !html.includes('data-auth-link'), `${JSON.stringify(value)} ${p}`);
        assert.ok(!html.includes('onerror') && !html.includes('src=x'), `${p}: the value is not echoed`);
        assert.deepEqual(navbarProblems(html), [], p);
      }
      for (let i = 0; i < 30 && !/PORTAL_ENABLED is set but is neither/.test(s.output()); i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 300));
      const out = s.output();
      assert.equal(out.split('portal: PORTAL_ENABLED is set but is neither "true" nor "false"; the page is rendered with the portal off').length - 1, 1, `${JSON.stringify(value)}: one line per isolate`);
      assert.doesNotMatch(out, /onerror|src=x|alert\(1\)/);
    } finally {
      await s.stop();
    }
  }
});

await check('portal', 'unset is silent: the default stack\'s Worker output has no line about the portal switch', async () => {
  assert.doesNotMatch(stack.output(), /portal: PORTAL_ENABLED/, 'nothing to say when it is unset');
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
