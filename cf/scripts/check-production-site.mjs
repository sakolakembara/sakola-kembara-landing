#!/usr/bin/env node
// Read-only check of the PRODUCTION site after the Phase A switch (SAKEM-104, docs/cloudflare/cutover-runbook.md section 14).
//
//   node ../scripts/check-production-site.mjs --allow-network            (from cf/web: `pnpm check:production -- --allow-network`)
//   node ../scripts/check-production-site.mjs --plan                      (prints what it would ask; sends nothing)
//
// It asks the four hosts of the plan, and no other: sakolakembara.org, www., admin. and files. There is NO option to name
// a host (an argument that looks like one is refused), and a URL outside the four is refused before any request, wherever it
// came from (a redirect's Location is read as text and never followed). It sends GET and nothing else, no cookie, no
// credential, no token, one request per second (the pace cannot be lowered), a timeout, no retry, and it writes nothing: no
// file, no report (`--json` prints to standard output). Running it against the real site needs Dzul's approval; the flag
// `--allow-network` is the reminder, as in the SEO parity tool.
//
// What it compares with: the Phase A expectations, listed below as constants and in the runbook (the smoke tests T-xx and the
// new TA-xx). Every line of the output carries the ID of the runbook test it answers. Anything the plan leaves to a decision
// that is not final (what `/login` and `/portal` do in Phase A, which depends on SAKEM-103) is printed as INFO and never fails.
//
//   0 every check passed (warnings may exist)   1 at least one check failed   2 refused or bad arguments   3 nothing answered
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PHASE = 'A';

/** The four hosts, by role. The ONLY hosts this tool talks to. */
export const HOSTS = { site: 'sakolakembara.org', www: 'www.sakolakembara.org', admin: 'admin.sakolakembara.org', files: 'files.sakolakembara.org' };
export const ALLOWED_HOSTS = new Set(Object.values(HOSTS));

export const USER_AGENT = 'sakem-production-check/1.0 (SAKEM-104; read-only: GET only, one request per second, the four hosts of sakolakembara.org)';

/** The Phase A expectations. A change here is a decision: write it in the runbook in the same PR. */
export const EXPECT = {
  /** D-04 / F-01: the first weeks' value, with neither `includeSubDomains` nor `preload`. */
  hsts: 'max-age=300',
  blogCacheControl: 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
  immutable: 'public, max-age=31536000, immutable',
  /** T-05: 86 articles and the static pages. */
  minSitemapUrls: 90,
  securityHeaders: { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY' },
  /** The names the Worker's `x-blog-source` header may carry on a healthy answer. */
  healthyBlogSources: ['network', 'cache'],
};

export const MIN_DELAY_MS = 1000;
const MAX_BODY_BYTES = 2_000_000;

export class RefusedHost extends Error {}

// ------------------------------------------------------------------------------------------------ the client

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The only way this tool asks anything. `fetchImpl`, `sleep` and `now` are injectable so a test needs no network.
 * @returns {{ get(url: string): Promise<Answer>, stats: { requests: number, errors: number } }}
 */
export function createClient({ fetchImpl = globalThis.fetch, sleep = realSleep, now = Date.now, delayMs = MIN_DELAY_MS, timeoutMs = 15_000 } = {}) {
  if (!Number.isFinite(delayMs) || delayMs < MIN_DELAY_MS) throw new RangeError(`the pause between requests cannot be below ${MIN_DELAY_MS} ms`);
  const stats = { requests: 0, errors: 0 };
  let last = null;
  async function get(url) {
    const target = new URL(url);
    if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new RefusedHost(`${target.protocol} is not http(s)`);
    if (target.username || target.password || target.port) throw new RefusedHost(`${target.host}: credentials and ports are refused`);
    if (!ALLOWED_HOSTS.has(target.hostname.toLowerCase())) throw new RefusedHost(`${target.hostname} is not one of the four hosts (${[...ALLOWED_HOSTS].join(', ')})`);
    if (last !== null) {
      const wait = last + delayMs - now();
      if (wait > 0) await sleep(wait);
    }
    last = now();
    stats.requests += 1;
    let response;
    try {
      // GET only. The only headers are these three: no cookie, no authorization, nothing that identifies a person.
      response = await fetchImpl(target.href, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.5', 'accept-language': 'id,en;q=0.5' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      stats.errors += 1;
      return { url: target.href, status: 0, headers: {}, body: '', error: error?.cause?.code ?? error?.name ?? 'error' };
    }
    const headers = {};
    for (const [name, value] of response.headers) headers[name.toLowerCase()] = value;
    const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    if (cookies.length > 0) headers['set-cookie'] = cookies.join('\n');
    let body = '';
    const type = headers['content-type'] ?? '';
    if (!type || /^(text\/|application\/(json|xml|xhtml\+xml|javascript|ld\+json))|\+xml/i.test(type)) {
      try {
        body = await readCapped(response);
      } catch {
        body = '';
      }
    } else {
      await response.body?.cancel().catch(() => undefined);
    }
    return { url: target.href, status: response.status, headers, body };
  }
  return { get, stats };
}

async function readCapped(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

// ------------------------------------------------------------------------------------------------ what a page says about itself

/** Names of the response headers that say "WordPress, PHP or LiteSpeed answered this" (never their values). `extra`: `[{ name, pattern|null }]` recorded at DNS inventory step 6. */
export function legacyHeaders(headers, extra = []) {
  const hits = [];
  for (const [name, value] of Object.entries(headers)) {
    if (name === 'x-powered-by' && /php|wordpress/i.test(value)) hits.push(name);
    else if (name.startsWith('x-litespeed') || name.startsWith('x-wp-') || name === 'x-pingback' || name === 'x-redirect-by') hits.push(name);
    else if (name === 'link' && /api\.w\.org|wp-json/i.test(value)) hits.push(name);
    else if (name === 'server' && !/^cloudflare$/i.test(value.trim())) hits.push(name);
    else if (name === 'set-cookie' && /(^|\n)\s*(wordpress_|wp-settings|wp_|phpsessid|comment_author)/i.test(value)) hits.push(name);
    else {
      const rule = extra.find((candidate) => candidate.name === name);
      if (rule && (rule.pattern === null || rule.pattern.test(value))) hits.push(name);
    }
  }
  return hits;
}

/** The body of a page that is WordPress's own (its login form, its markup). */
export const looksLikeWordPress = (body) => /wp-login\.php|name="log"|id="user_login"|wp-content\/|wp-includes\/|<meta name="generator" content="WordPress/i.test(body);

const attr = (html, tag, key, value, read) => new RegExp(`<${tag}\\b[^>]*\\b${key}=["']${value}["'][^>]*>`, 'i').exec(html)?.[0]?.match(new RegExp(`\\b${read}=["']([^"']*)["']`, 'i'))?.[1] ?? null;
const canonicalOf = (html) => attr(html, 'link', 'rel', 'canonical', 'href');
const ogImageOf = (html) => attr(html, 'meta', 'property', 'og:image', 'content');
const hasNoindex = (html) => /<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
const locOf = (response) => {
  const raw = response.headers.location;
  if (!raw) return null;
  try {
    return new URL(raw, response.url).href;
  } catch {
    return null;
  }
};

// ------------------------------------------------------------------------------------------------ the checks

/**
 * @typedef {{ id: string, level: 'PASS'|'FAIL'|'WARN'|'INFO', text: string }} Result
 * @typedef {{ url: string, status: number, headers: Record<string,string>, body: string, error?: string }} Answer
 */

/** Runs the checks of the chosen groups and returns the results. Pure around `client`: nothing here writes anything. */
export async function runChecks({ client, only = ['site', 'www', 'admin', 'files'], legacy = [], daftarTarget = null, minSitemapUrls = EXPECT.minSitemapUrls }) {
  /** @type {Result[]} */
  const results = [];
  const add = (id, level, text) => results.push({ id, level, text });
  const verdict = (id, subject, problems) => add(id, problems.length === 0 ? 'PASS' : 'FAIL', problems.length === 0 ? subject : `${subject}: ${problems.join('; ')}`);
  const legacyFound = []; // [url, [header names]] for every answer that must not carry one
  const cacheSeen = []; // `path=cf-cache-status`
  const ok = (answer, problems) => {
    if (answer.error) problems.push(`no answer (${answer.error})`);
    return !answer.error;
  };
  const pathOf = (answer) => new URL(answer.url).pathname + new URL(answer.url).search;
  /** Every answer of a new-site path is searched for the old stack's headers, and its cache status noted. */
  const examine = (answer) => {
    if (answer.error) return;
    const found = legacyHeaders(answer.headers, legacy);
    if (found.length > 0) legacyFound.push([`${new URL(answer.url).host}${pathOf(answer)}`, found]);
    if (answer.headers['cf-cache-status']) cacheSeen.push(`${pathOf(answer)}=${answer.headers['cf-cache-status']}`);
  };
  const expectRedirect = (answer, statuses, to, problems) => {
    if (!ok(answer, problems)) return;
    if (!statuses.includes(answer.status)) problems.push(`status ${answer.status}, expected ${statuses.join(' or ')}`);
    const where = locOf(answer);
    if (where !== to) problems.push(`location ${where ?? 'missing'}, expected ${to}`);
  };
  const site = (p) => `https://${HOSTS.site}${p}`;
  const admin = (p) => `https://${HOSTS.admin}${p}`;
  const files = (p) => `https://${HOSTS.files}${p}`;
  const found = { slug: null, css: null, img: null, filesUrl: null };

  if (only.includes('site')) {
    // ---- the home page: the new site, with its security headers (T-01, TA-01)
    const home = await client.get(site('/'));
    examine(home);
    {
      const problems = [];
      if (ok(home, problems)) {
        if (home.status !== 200) problems.push(`status ${home.status}`);
        if (!/html/i.test(home.headers['content-type'] ?? '')) problems.push(`content-type ${home.headers['content-type'] ?? 'missing'}`);
        if (!/<html[^>]*\blang=["']id-ID["']/i.test(home.body)) problems.push('not lang="id-ID" (is this the new site?)');
        if (canonicalOf(home.body) !== site('/')) problems.push(`canonical ${canonicalOf(home.body) ?? 'missing'}`);
        if (/wp-content\/|wp-includes\/|wp-json/i.test(home.body)) problems.push('the body mentions wp-content, wp-includes or wp-json');
        if (home.headers['set-cookie']) problems.push('a cookie is set');
      }
      verdict('T-01', `${site('/')} 200 html, the new site's home page (id-ID, canonical itself, no cookie)`, problems);
      const sec = [];
      if (!home.error) {
        const hsts = home.headers['strict-transport-security'];
        if (!hsts) sec.push('no strict-transport-security');
        else if (hsts !== EXPECT.hsts) sec.push(`strict-transport-security is "${hsts}", expected "${EXPECT.hsts}" (no includeSubDomains, no preload)`);
        for (const [name, value] of Object.entries(EXPECT.securityHeaders)) if (home.headers[name] !== value) sec.push(`${name} is ${home.headers[name] ? `"${home.headers[name]}"` : 'missing'}, expected ${value}`);
        if (!home.headers['referrer-policy']) sec.push('no referrer-policy');
        if (!home.headers['permissions-policy']) sec.push('no permissions-policy');
      } else sec.push(`no answer (${home.error})`);
      verdict('TA-01', `security headers on /: HSTS ${EXPECT.hsts}, nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy`, sec);
    }
    // discover what later checks need, from the home page itself (nothing is hard-coded)
    found.css = /\/_astro\/[^"' ]+\.css/.exec(home.body)?.[0] ?? null;
    found.img = /\/_img\/[^"' ,]+\.webp/.exec(home.body)?.[0] ?? null;

    const http = await client.get(`http://${HOSTS.site}/`);
    examine(http);
    {
      const problems = [];
      expectRedirect(http, [301, 308], site('/'), problems);
      verdict('T-02', `http://${HOSTS.site}/ is one permanent redirect to https (no loop)`, problems);
    }

    const robots = await client.get(site('/robots.txt'));
    examine(robots);
    {
      const problems = [];
      if (ok(robots, problems)) {
        if (robots.status !== 200) problems.push(`status ${robots.status}`);
        if (!/text\/plain/i.test(robots.headers['content-type'] ?? '')) problems.push(`content-type ${robots.headers['content-type'] ?? 'missing'}`);
        const lines = robots.body.split(/\r?\n/).map((l) => l.trim());
        for (const rule of ['Disallow: /admin', 'Disallow: /api']) if (!lines.includes(rule)) problems.push(`no "${rule}"`);
        if (lines.includes('Disallow: /')) problems.push('"Disallow: /" blocks the whole site');
        if (!lines.includes(`Sitemap: ${site('/sitemap.xml')}`)) problems.push('no Sitemap line for the apex');
      }
      verdict('T-04', 'robots.txt: 200 text/plain, the disallow list, no "Disallow: /", the Sitemap line', problems);
    }

    const sitemap = await client.get(site('/sitemap.xml'));
    examine(sitemap);
    let articlePaths = [];
    {
      const problems = [];
      if (ok(sitemap, problems)) {
        if (sitemap.status !== 200) problems.push(`status ${sitemap.status}`);
        if (!/xml/i.test(sitemap.headers['content-type'] ?? '')) problems.push(`content-type ${sitemap.headers['content-type'] ?? 'missing'}`);
        const source = sitemap.headers['x-blog-source'];
        if (!EXPECT.healthyBlogSources.includes(source)) problems.push(`x-blog-source is ${source ?? 'missing'}, expected ${EXPECT.healthyBlogSources.join(' or ')}`);
        const locs = [...sitemap.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
        if (locs.length < minSitemapUrls) problems.push(`${locs.length} URLs, expected at least ${minSitemapUrls}`);
        const stray = locs.filter((loc) => !loc.startsWith(`${site('')}/`) && loc !== site(''));
        if (stray.length > 0) problems.push(`${stray.length} URL(s) not on ${HOSTS.site} (for example ${new URL(stray[0]).host})`);
        articlePaths = locs.filter((loc) => loc.startsWith(site('/blog/'))).map((loc) => new URL(loc).pathname);
        found.slug = articlePaths[0]?.slice('/blog/'.length) ?? null;
      }
      verdict('T-05', `sitemap.xml: 200 xml, ${minSitemapUrls}+ URLs all on ${HOSTS.site}, served from the API`, problems);
    }

    const blog = await client.get(site('/blog'));
    examine(blog);
    {
      const problems = [];
      if (ok(blog, problems)) {
        if (blog.status !== 200) problems.push(`status ${blog.status}`);
        if (blog.headers['cache-control'] !== EXPECT.blogCacheControl) problems.push(`cache-control is "${blog.headers['cache-control'] ?? 'missing'}"`);
        if (!blog.headers['x-blog-source']) problems.push('no x-blog-source (is the Worker answering?)');
        if (!/href=["']\/blog\/[a-z0-9]/i.test(blog.body)) problems.push('no article link in the page');
      }
      verdict('T-06', '/blog: 200, the cache-control of the contract, an article list, answered by the Worker', problems);
    }
    const blogAgain = await client.get(site('/blog'));
    examine(blogAgain);
    if (!blog.error && !blogAgain.error) {
      const first = blog.headers['x-blog-source'] ?? 'none';
      const second = blogAgain.headers['x-blog-source'] ?? 'none';
      const copy = blogAgain.headers['x-page-cache'] ? `, x-page-cache ${blog.headers['x-page-cache'] ?? 'none'} then ${blogAgain.headers['x-page-cache']}` : '';
      if (second === 'cache' || blogAgain.headers['x-page-cache'] === 'hit') add('C-02', 'PASS', `/blog twice: x-blog-source ${first} then ${second}${copy}`);
      else add('C-02', 'WARN', `/blog twice: x-blog-source ${first} then ${second}${copy}: the second answer was not from a copy (another data center, or the cache does not work: look at cf-ray and run C-01 to C-03 by hand)`);
    }

    if (found.slug) {
      const article = await client.get(site(`/blog/${found.slug}`));
      examine(article);
      const problems = [];
      if (ok(article, problems)) {
        if (article.status !== 200) problems.push(`status ${article.status}`);
        if (canonicalOf(article.body) !== site(`/blog/${found.slug}`)) problems.push(`canonical ${canonicalOf(article.body) ?? 'missing'}`);
        const og = ogImageOf(article.body);
        if (!og || !/^https:\/\//.test(og)) problems.push(`og:image is ${og ?? 'missing'}, expected an absolute https URL`);
        if (!/"@type":\s*"BlogPosting"/.test(article.body)) problems.push('no BlogPosting JSON-LD');
        const images = [...article.body.matchAll(/<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/gi)].map((m) => new URL(m[1]).host);
        const bad = images.filter((host) => /(^|\.)(r2\.dev|workers\.dev)$/.test(host));
        if (bad.length > 0) problems.push(`an image is served from ${bad[0]}: UPLOADS_BASE_URL is wrong`);
        found.filesUrl = article.body.match(new RegExp(`https://${HOSTS.files.replaceAll('.', '\\.')}/[^"'\\s)<]+`))?.[0] ?? null;
      }
      verdict('T-07', `/blog/${found.slug.slice(0, 40)}${found.slug.length > 40 ? '...' : ''}: 200, canonical itself, absolute og:image, BlogPosting, no image on r2.dev`, problems);

      const old = await client.get(site(`/cerita/${found.slug}/`));
      const archive = await client.get(site('/education/'));
      examine(old);
      examine(archive);
      const problems8 = [];
      expectRedirect(old, [308], site(`/blog/${found.slug}`), problems8);
      expectRedirect(archive, [308], site('/blog'), problems8);
      verdict('T-08', 'old WordPress URLs redirect: /cerita/<slug>/ and /education/ (308 to the new address)', problems8);
    } else {
      add('T-07', 'WARN', 'skipped: no article URL could be read from the sitemap');
    }

    // Not examined for the old stack's headers: an unknown path is the one that may reach the origin by SAKEM-103's design.
    const unknown = await client.get(site('/no-such-page-check-1f3a'));
    {
      const problems = [];
      if (ok(unknown, problems)) {
        if (unknown.status !== 404) problems.push(`status ${unknown.status}, expected 404`);
        else if (!hasNoindex(unknown.body)) problems.push('a 404 without <meta name="robots" content="noindex">');
      }
      const reachedOrigin = !unknown.error && (looksLikeWordPress(unknown.body) || legacyHeaders(unknown.headers, legacy).length > 0);
      if (problems.length === 0) add('T-10', 'PASS', "an unknown path is the new site's 404 with noindex");
      else if (reachedOrigin && unknown.status === 404) add('T-10', 'WARN', "an unknown path was answered by the old origin's 404: whether that is intended is SAKEM-103's call (docs/cloudflare/cutover-runbook.md, TA-04)");
      else add('T-10', 'FAIL', `an unknown path: ${problems.join('; ')}`);
    }

    const apiPublic = await client.get(site('/api/public/blog'));
    const apiOther = await client.get(site('/api/check-x'));
    examine(apiPublic);
    examine(apiOther);
    for (const [id, answer, label] of [['T-14', apiPublic, '/api/public/blog (the public face of the API is empty)'], ['T-18', apiOther, '/api/anything']]) {
      const problems = [];
      if (ok(answer, problems)) {
        if (answer.status !== 404) problems.push(`status ${answer.status}`);
        if (!/json/i.test(answer.headers['content-type'] ?? '') || !/"error"\s*:\s*"not_found"/.test(answer.body)) problems.push('not the JSON {"error":"not_found"}');
        if (answer.headers['cache-control'] !== 'no-store') problems.push(`cache-control ${answer.headers['cache-control'] ?? 'missing'}`);
      }
      verdict(id, `${label}: 404 JSON not_found, no-store`, problems);
    }

    const adminRedirect = await client.get(site('/admin/blog?x=1'));
    examine(adminRedirect);
    {
      const problems = [];
      expectRedirect(adminRedirect, [308], admin('/blog?x=1'), problems);
      verdict('T-15', `/admin/blog?x=1 is a 308 to ${HOSTS.admin}/blog?x=1 (path and query kept)`, problems);
    }

    const slash = await client.get(site('/donasi/'));
    examine(slash);
    {
      const problems = [];
      expectRedirect(slash, [308], site('/donasi'), problems);
      verdict('T-19', '/donasi/ is a 308 to /donasi (not the assets layer\'s 307)', problems);
    }

    // ---- static assets found in the home page: immutable, no cookie, the same security headers (T-20, T-21), cache status noted
    for (const [label, assetPath] of [['css', found.css], ['image', found.img]]) {
      if (!assetPath) {
        add('T-20', 'WARN', `skipped: no ${label} asset found in the home page`);
        continue;
      }
      const first = await client.get(site(assetPath));
      const second = await client.get(site(assetPath));
      examine(first);
      examine(second);
      const problems = [];
      if (ok(first, problems)) {
        if (first.status !== 200) problems.push(`status ${first.status}`);
        if (first.headers['cache-control'] !== EXPECT.immutable) problems.push(`cache-control is "${first.headers['cache-control'] ?? 'missing'}"`);
        if (first.headers['set-cookie']) problems.push('a cookie is set');
        if (first.headers['strict-transport-security'] !== EXPECT.hsts) problems.push(`strict-transport-security is "${first.headers['strict-transport-security'] ?? 'missing'}"`);
        if (first.headers['x-content-type-options'] !== 'nosniff') problems.push('no nosniff');
      }
      verdict('T-20', `${assetPath.split('/').slice(0, 2).join('/')}/... (${label}): 200, immutable, no cookie, the security headers`, problems);
      if (!first.error && !second.error) add('C-09', 'INFO', `${assetPath.split('/').slice(0, 2).join('/')}/... cf-cache-status ${first.headers['cf-cache-status'] ?? 'none'} then ${second.headers['cf-cache-status'] ?? 'none'}`);
    }

    // ---- sign-up and WordPress (TA-02, TA-03)
    const daftar = await client.get(site('/daftar'));
    examine(daftar);
    {
      const problems = [];
      let formHost = null;
      if (ok(daftar, problems)) {
        if (daftar.status !== 307) problems.push(`status ${daftar.status}, expected 307 (a shortlink; a 308 is the old static rule to /gabung-siswa)`);
        const where = locOf(daftar);
        if (!where || !where.startsWith('https://')) problems.push(`location ${where ?? 'missing'}, expected an https URL`);
        else if (/(^|\.)(workers\.dev|r2\.dev)$/.test(new URL(where).hostname)) problems.push('location is on workers.dev or r2.dev');
        else if (daftarTarget && where !== daftarTarget) problems.push('location is not the registration form named with --daftar-target');
        else formHost = new URL(where).host;
      }
      verdict('TA-02', '/daftar is a 307 to the registration form', problems);
      if (formHost) add('TA-02', 'INFO', `/daftar goes to ${formHost}: is that the form WordPress uses today?`);
    }

    const wpLogin = await client.get(site('/wp-login.php'));
    const wpAdmin = await client.get(site('/wp-admin'));
    {
      const problems = [];
      if (!wpLogin.error && wpLogin.headers['cf-mitigated']) {
        // A WAF rule of the zone (a managed challenge, SA-23) answers a script before WordPress does: not a failure of the route.
        add('TA-03', 'WARN', `/wp-login.php was answered by a Cloudflare ${wpLogin.headers['cf-mitigated']} (a zone rule), not by WordPress: open it by hand in a browser`);
      } else {
        if (ok(wpLogin, problems)) {
          if (wpLogin.status !== 200) problems.push(`status ${wpLogin.status}`);
          if (!looksLikeWordPress(wpLogin.body) && !/wordpress_test_cookie/i.test(wpLogin.headers['set-cookie'] ?? '')) problems.push("the answer is not WordPress's login page (the new site's 404? a customised login URL?)");
        }
        verdict('TA-03', '/wp-login.php still reaches WordPress (its login form)', problems);
      }
    }
    if (!wpAdmin.error && wpAdmin.headers['cf-mitigated']) {
      add('TA-03', 'WARN', `/wp-admin was answered by a Cloudflare ${wpAdmin.headers['cf-mitigated']} (a zone rule), not by WordPress: open it by hand in a browser`);
    } else {
      const problems = [];
      let bare = false;
      if (ok(wpAdmin, problems)) {
        const where = locOf(wpAdmin);
        if (![301, 302].includes(wpAdmin.status)) problems.push(`status ${wpAdmin.status}, expected WordPress's 301 or 302`);
        else if (!where || new URL(where).host !== HOSTS.site || !/^\/(wp-admin\/|wp-login\.php)/.test(new URL(where).pathname)) problems.push(`location ${where ?? 'missing'}, expected /wp-admin/ or /wp-login.php on ${HOSTS.site}`);
        else bare = legacyHeaders(wpAdmin.headers, legacy).length === 0;
      }
      verdict('TA-03', '/wp-admin still reaches WordPress (a redirect to /wp-admin/ or its login)', problems);
      if (bare) add('TA-03', 'INFO', '/wp-admin answered with a redirect that carries no WordPress header (Cloudflare may strip some): the location above is what says it is WordPress');
    }

    // ---- what the plan leaves to SAKEM-103: observed, never failed (TA-07)
    for (const p of ['/login', '/register', '/portal', '/portal/status']) {
      const answer = await client.get(site(p));
      if (answer.error) add('TA-07', 'INFO', `${p}: no answer (${answer.error})`);
      else add('TA-07', 'INFO', `${p}: ${answer.status}${locOf(answer) ? ` to ${locOf(answer)}` : ''}${legacyHeaders(answer.headers, legacy).length > 0 ? ' (answered by the old origin)' : ''}`);
    }
  }

  if (only.includes('www')) {
    const www = await client.get(`https://${HOSTS.www}/blog?x=1`);
    examine(www);
    const problems = [];
    expectRedirect(www, [301], site('/blog?x=1'), problems);
    verdict('T-03', `https://${HOSTS.www}/blog?x=1 is one 301 to the apex, path and query kept`, problems);
  }

  if (only.includes('admin')) {
    const shell = await client.get(admin('/'));
    examine(shell);
    {
      const problems = [];
      if (ok(shell, problems)) {
        if (shell.status !== 200) problems.push(`status ${shell.status}`);
        if (!/html/i.test(shell.headers['content-type'] ?? '')) problems.push(`content-type ${shell.headers['content-type'] ?? 'missing'}`);
      }
      verdict('TA-05', `${HOSTS.admin}/ answers 200 html (the admin app's shell)`, problems);
      // The admin app's pages come from the assets layer with no `_headers` file (F-19): the headers must come from a zone rule.
      const missing = ['x-frame-options', 'x-content-type-options'].filter((name) => !shell.error && !shell.headers[name]);
      if (missing.length > 0) add('TA-05', 'WARN', `${HOSTS.admin}/ sends no ${missing.join(' and no ')}: the admin app can be framed and its types sniffed (F-19: add the response header rule of the runbook)`);
    }
    const config = await client.get(admin('/api/config'));
    examine(config);
    {
      const problems = [];
      if (ok(config, problems)) {
        let json = null;
        try {
          json = JSON.parse(config.body);
        } catch {
          problems.push('not JSON');
        }
        if (config.status !== 200) problems.push(`status ${config.status}`);
        if (json) {
          const key = json.turnstileSiteKey;
          if (typeof key !== 'string' || key === '') problems.push('turnstileSiteKey is not set (the sign-in would have no widget)');
          else if (/^[1-9]x0{4,}/i.test(key)) problems.push("turnstileSiteKey is Cloudflare's TEST key");
          if (json.uploadsBaseUrl !== `https://${HOSTS.files}`) problems.push(`uploadsBaseUrl is "${json.uploadsBaseUrl ?? 'missing'}", expected https://${HOSTS.files}`);
          if (json.siteUrl !== site('')) problems.push(`siteUrl is "${json.siteUrl ?? 'missing'}", expected ${site('')}`);
        }
        if (config.headers['cache-control'] !== 'no-store') problems.push(`cache-control ${config.headers['cache-control'] ?? 'missing'}`);
      }
      verdict('TA-05', '/api/config: a real Turnstile site key, uploadsBaseUrl and siteUrl are the production hosts (the --var values were deployed)', problems);
    }
    const me = await client.get(admin('/api/me'));
    const team = await client.get(admin('/api/public/team'));
    const upload = await client.get(admin('/uploads/check-x'));
    const mailbox = await client.get(admin('/api/dev/mailbox'));
    for (const answer of [me, team, upload, mailbox]) examine(answer);
    {
      const problems = [];
      if (ok(me, problems)) {
        if (me.status !== 401) problems.push(`status ${me.status}, expected 401`);
        if (!/"error"\s*:\s*"unauthenticated"/.test(me.body)) problems.push('not {"error":"unauthenticated"}');
      }
      verdict('TA-05', '/api/me without a session: 401 unauthenticated', problems);
    }
    {
      const problems = [];
      for (const [label, answer] of [['/api/public/team', team], ['/uploads/...', upload], ['/api/dev/mailbox', mailbox]]) {
        if (answer.error) problems.push(`${label}: no answer (${answer.error})`);
        else if (answer.status !== 404) problems.push(`${label}: status ${answer.status}, expected 404`);
        else if (!/"error"\s*:\s*"not_found"/.test(answer.body)) problems.push(`${label}: not the JSON not_found`);
      }
      verdict('T-14', `${HOSTS.admin}: /api/public/*, /uploads/* and /api/dev/mailbox are a 404 JSON (the public reads and the local-only routes do not exist here)`, problems);
    }
  }

  if (only.includes('files')) {
    const root = await client.get(files('/'));
    examine(root);
    {
      const problems = [];
      if (ok(root, problems)) {
        if (![403, 404].includes(root.status)) problems.push(`status ${root.status}, expected 404 (or 403)`);
        if (/<ListBucketResult|<Contents>/i.test(root.body)) problems.push('the bucket lists its objects');
      }
      verdict('TA-06', `${HOSTS.files}/ does not list the bucket`, problems);
    }
    const missing = await client.get(files('/uploads/check-x-missing.png'));
    examine(missing);
    {
      const problems = [];
      if (ok(missing, problems) && missing.status !== 404) problems.push(`status ${missing.status}, expected 404`);
      verdict('TA-06', `${HOSTS.files}/uploads/<missing> is a 404`, problems);
    }
    let fileUrl = found.filesUrl;
    if (!fileUrl && only.includes('site')) {
      const team = await client.get(site('/tim'));
      fileUrl = team.body?.match(new RegExp(`https://${HOSTS.files.replaceAll('.', '\\.')}/[^"'\\s)<]+`))?.[0] ?? null;
    }
    if (!fileUrl) add('TA-06', 'INFO', 'no uploaded file is referenced by /tim or the first article yet: open one by hand after the first upload (immutable cache-control, the right content-type)');
    else {
      const file = await client.get(fileUrl);
      const again = await client.get(fileUrl);
      examine(file);
      const problems = [];
      if (ok(file, problems)) {
        if (file.status !== 200) problems.push(`status ${file.status}`);
        if (file.headers['cache-control'] !== EXPECT.immutable) problems.push(`cache-control is "${file.headers['cache-control'] ?? 'missing'}"`);
        if (!/^(image|application\/pdf)/i.test(file.headers['content-type'] ?? '')) problems.push(`content-type ${file.headers['content-type'] ?? 'missing'}`);
        if (file.headers['set-cookie']) problems.push('a cookie is set');
      }
      verdict('TA-06', `an uploaded file on ${HOSTS.files}: 200, immutable, a file content-type, no cookie`, problems);
      if (!file.error && !again.error) add('C-09', 'INFO', `${HOSTS.files} file cf-cache-status ${file.headers['cf-cache-status'] ?? 'none'} then ${again.headers['cf-cache-status'] ?? 'none'}`);
    }
  }

  // ---- the two aggregates
  if (only.length > 0) {
    if (legacyFound.length === 0) add('TA-04', 'PASS', 'no WordPress, PHP or LiteSpeed header on any new-site answer (the new site is not served by the old origin)');
    else add('TA-04', 'FAIL', `the old origin answered: ${legacyFound.map(([where, names]) => `${where} (${names.join(', ')})`).join('; ')}`);
  }
  if (cacheSeen.length > 0) add('C-09', 'INFO', `cf-cache-status seen: ${cacheSeen.slice(0, 12).join(', ')}${cacheSeen.length > 12 ? ', ...' : ''}`);
  return results;
}

// ------------------------------------------------------------------------------------------------ output

export function summarize(results) {
  const count = (level) => results.filter((r) => r.level === level).length;
  return { pass: count('PASS'), fail: count('FAIL'), warn: count('WARN'), info: count('INFO') };
}

export function render(results, { requests, seconds }) {
  const lines = [`sakem-production-check, Phase ${PHASE} (GET only, one request per second, the four hosts of sakolakembara.org)`];
  for (const r of results) lines.push(`${r.level.padEnd(4)} ${r.id.padEnd(5)} ${r.text}`);
  const s = summarize(results);
  lines.push(`-- ${s.pass} passed, ${s.fail} failed, ${s.warn} warnings, ${s.info} notes; ${requests} requests in ${seconds} s`);
  return lines.join('\n');
}

// ------------------------------------------------------------------------------------------------ the program

const HELP = `usage:
  node ../scripts/check-production-site.mjs --allow-network [options]    ask the four hosts (about 40 GET requests, about a minute)
  node ../scripts/check-production-site.mjs --plan                      print what would be asked; nothing is sent

options:
  --allow-network        you have Dzul's approval to send requests to the real site
  --only site,www,admin,files   only these groups of the plan (default: all four)
  --legacy-header name[=regex]  one more header that means "the old stack answered" (repeatable); WordPress, PHP and LiteSpeed
                         headers are known already. Use what DNS inventory step 6 of the runbook recorded.
  --daftar-target URL    the registration form /daftar must redirect to (default: any https URL)
  --min-sitemap-urls N   the least number of URLs the sitemap must list (default ${EXPECT.minSitemapUrls})
  --delay-ms N           pause between requests, at least ${MIN_DELAY_MS} (default ${MIN_DELAY_MS})
  --json                 print the results as JSON on standard output
  -h, --help

There is no option to name a host: this tool asks ${[...ALLOWED_HOSTS].join(', ')} and nothing else.
exit codes: 0 all passed, 1 a check failed, 2 refused or bad arguments, 3 nothing answered.`;

export class UsageError extends Error {}

export function parseCli(argv) {
  const options = { allowNetwork: false, plan: false, json: false, only: ['site', 'www', 'admin', 'files'], legacy: [], daftarTarget: null, minSitemapUrls: EXPECT.minSitemapUrls, delayMs: MIN_DELAY_MS, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new UsageError(`${arg} needs a value`);
      return argv[++i];
    };
    switch (arg) {
      case '--allow-network': options.allowNetwork = true; break;
      case '--plan': case '--dry-run': options.plan = true; break;
      case '--json': options.json = true; break;
      case '-h': case '--help': options.help = true; break;
      case '--only': {
        const groups = value().split(',').map((s) => s.trim()).filter(Boolean);
        for (const g of groups) if (!Object.hasOwn(HOSTS, g)) throw new UsageError(`--only: ${JSON.stringify(g)} is not a group (${Object.keys(HOSTS).join(', ')})`);
        options.only = groups;
        break;
      }
      case '--legacy-header': {
        const [name, ...rest] = value().split('=');
        if (!/^[a-z0-9-]+$/i.test(name)) throw new UsageError('--legacy-header: a header name, optionally name=regex');
        let pattern = null;
        if (rest.length > 0) {
          try {
            pattern = new RegExp(rest.join('='), 'i');
          } catch {
            throw new UsageError('--legacy-header: the regex does not compile');
          }
        }
        options.legacy.push({ name: name.toLowerCase(), pattern });
        break;
      }
      case '--daftar-target': {
        const target = value();
        let url;
        try {
          url = new URL(target);
        } catch {
          throw new UsageError('--daftar-target: not a URL');
        }
        if (url.protocol !== 'https:') throw new UsageError('--daftar-target: must be https');
        options.daftarTarget = url.href;
        break;
      }
      case '--min-sitemap-urls': options.minSitemapUrls = Number(value()); if (!Number.isInteger(options.minSitemapUrls) || options.minSitemapUrls < 1) throw new UsageError('--min-sitemap-urls: a whole number'); break;
      case '--delay-ms': options.delayMs = Number(value()); if (!Number.isFinite(options.delayMs) || options.delayMs < MIN_DELAY_MS) throw new UsageError(`--delay-ms: not below ${MIN_DELAY_MS} (one request per second at most)`); break;
      default:
        throw new UsageError(`unknown argument ${JSON.stringify(arg)}${/^--?(base|host|url|origin|site|target)/i.test(arg) || /^https?:|\./.test(arg) ? ': this tool has no option to name a host, it asks the four hosts of sakolakembara.org only' : ''}`);
    }
  }
  return options;
}

/** The URLs the plan names (the discovered ones are added at run time and are on these hosts too). */
export const PLAN = [
  ['site', ['/', 'http://sakolakembara.org/', '/robots.txt', '/sitemap.xml', '/blog (twice)', '/blog/<first article of the sitemap>', '/cerita/<that slug>/', '/education/', '/no-such-page-check-1f3a', '/api/public/blog', '/api/check-x', '/admin/blog?x=1', '/donasi/', 'the first /_astro/*.css and /_img/*.webp of the home page (twice each)', '/daftar', '/wp-login.php', '/wp-admin', '/login', '/register', '/portal', '/portal/status']],
  ['www', ['/blog?x=1']],
  ['admin', ['/', '/api/config', '/api/me', '/api/public/team', '/uploads/check-x', '/api/dev/mailbox']],
  ['files', ['/', '/uploads/check-x-missing.png', 'one uploaded file referenced by /tim or the first article (twice), when there is one']],
];

export async function main(argv, { out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s), clientFactory = createClient } = {}) {
  let options;
  try {
    options = parseCli(argv);
  } catch (error) {
    err(`refused: ${error.message}\n\n${HELP}\n`);
    return 2;
  }
  if (options.help) {
    out(`${HELP}\n`);
    return 0;
  }
  if (options.plan) {
    for (const [group, paths] of PLAN) {
      if (!options.only.includes(group)) continue;
      const host = HOSTS[group];
      for (const p of paths) out(`GET ${/^https?:/.test(p) ? p : p.startsWith('/') ? `https://${host}${p}` : `${host}: ${p}`}\n`);
    }
    out('plan only: nothing was sent.\n');
    return 0;
  }
  if (!options.allowNetwork) {
    err('refused: this sends about 40 GET requests to the real site. Add --allow-network once Dzul has approved the run (or --plan to see them). Nothing was contacted.\n');
    return 2;
  }
  const started = Date.now();
  const client = clientFactory({ delayMs: options.delayMs });
  let results;
  try {
    results = await runChecks({ client, only: options.only, legacy: options.legacy, daftarTarget: options.daftarTarget, minSitemapUrls: options.minSitemapUrls });
  } catch (error) {
    err(`stopped: ${error.message}\n`);
    return error instanceof RefusedHost ? 2 : 1;
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  if (client.stats.requests > 0 && client.stats.errors === client.stats.requests) {
    err(`nothing answered: every one of ${client.stats.requests} requests failed (no network, or the hosts do not resolve).\n`);
    return 3;
  }
  if (options.json) out(`${JSON.stringify({ phase: PHASE, results, summary: summarize(results), requests: client.stats.requests, seconds }, null, 2)}\n`);
  else out(`${render(results, { requests: client.stats.requests, seconds })}\n`);
  return summarize(results).fail > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
