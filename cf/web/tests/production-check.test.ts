import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_HOSTS,
  EXPECT,
  HOSTS,
  MIN_DELAY_MS,
  PLAN,
  RefusedHost,
  USER_AGENT,
  UsageError,
  createClient,
  legacyHeaders,
  looksLikeWordPress,
  main,
  parseCli,
  render,
  runChecks,
  summarize,
} from '../../scripts/check-production-site.mjs';
import { FILE_URL, FORM_URL, SECURITY, SLUG, fakeFetch, healthySite, type Entry, type Recorded } from './production-site-fixture';
import { repoRoot } from './helpers';

// cf/scripts/check-production-site.mjs (SAKEM-104, cutover Phase A): the read-only check of the real site after the switch.
// Every answer below is recorded or invented (tests/production-site-fixture.ts); no test asks a network.

const noSleep = async () => undefined;

/** A client over a fake site, with a clock that only moves when the client sleeps (so the pace can be read from the sleeps). */
function setup(mutate: (site: Map<string, Entry>) => void = () => undefined) {
  const site = healthySite();
  mutate(site);
  const fake = fakeFetch(site);
  const waits: number[] = [];
  let clock = 0;
  const client = createClient({
    fetchImpl: fake.fetchImpl,
    sleep: async (ms: number) => {
      waits.push(ms);
      clock += ms;
    },
    now: () => clock,
  });
  return { site, client, log: fake.log, counts: fake.counts, waits };
}
const run = async (mutate: (site: Map<string, Entry>) => void = () => undefined, options: Partial<Omit<Parameters<typeof runChecks>[0], 'client'>> = {}) => {
  const s = setup(mutate);
  const results = await runChecks({ client: s.client, ...options });
  return { ...s, results };
};
const entry = (site: Map<string, Entry>, url: string): Recorded => {
  const e = site.get(url)!;
  return typeof e === 'function' ? e(1) : e;
};
const patch = (site: Map<string, Entry>, url: string, over: Partial<Recorded> & { headers?: Record<string, string>; drop?: string[] }) => {
  const before = site.get(url)!;
  site.set(url, (nth: number) => {
    const base = typeof before === 'function' ? before(nth) : before;
    const headers = { ...base.headers, ...over.headers };
    for (const name of over.drop ?? []) delete headers[name];
    return { status: over.status ?? base.status, headers, body: over.body ?? base.body };
  });
};
const failures = (results: { id: string; level: string; text: string }[]) => results.filter((r) => r.level === 'FAIL');
const one = (results: { id: string; level: string; text: string }[], id: string, level?: string) => results.filter((r) => r.id === id && (level === undefined || r.level === level));
const SITE = 'https://sakolakembara.org';

describe('a healthy Phase A site', () => {
  it('passes every check, with no warning, and every request is planned', async () => {
    const { results, log } = await run();
    expect(failures(results)).toEqual([]);
    expect(results.filter((r) => r.level === 'WARN')).toEqual([]);
    expect(log.unexpected).toEqual([]);
    const ids = new Set(results.map((r) => r.id));
    for (const id of ['T-01', 'TA-01', 'T-02', 'T-03', 'T-04', 'T-05', 'T-06', 'C-02', 'T-07', 'T-08', 'T-10', 'T-14', 'T-15', 'T-18', 'T-19', 'T-37', 'T-20', 'T-09', 'T-16', 'T-17', 'T-34', 'T-35', 'T-36', 'TA-02', 'TA-03', 'TA-04', 'TA-05', 'TA-06']) {
      expect(ids.has(id), id).toBe(true);
    }
    expect(summarize(results).fail).toBe(0);
  });

  it('asks a known number of URLs (a new request is a decision) and none twice by accident', async () => {
    const { log, counts } = await run();
    expect(log.calls.length).toBe(50);
    expect([...counts.entries()].filter(([, n]) => n > 1).map(([url]) => url).sort()).toEqual([
      'https://files.sakolakembara.org/uploads/blog/2026/10/cover-1a2b3c.webp',
      'https://sakolakembara.org/_astro/Base.CYEQ0bMh.css',
      'https://sakolakembara.org/_img/27f45874d486-480.webp',
      'https://sakolakembara.org/blog',
    ]);
  });

  it('names the runbook test of every line, in a short report with a summary', async () => {
    const { results } = await run();
    const text = render(results, { requests: 50, seconds: 50 });
    expect(text.split('\n')[0]).toContain('Phase A');
    expect(text).toMatch(/^PASS T-01 /m);
    expect(text).toMatch(/^PASS TA-04 /m);
    expect(text).toMatch(/-- \d+ passed, 0 failed, 0 warnings, \d+ notes; 50 requests in 50 s$/);
    expect(text.split('\n').length).toBeLessThan(60);
  });

  it('the notes say where /daftar goes and what the cache status was, and never a path of a secret', async () => {
    const { results } = await run();
    expect(one(results, 'TA-02', 'INFO')[0]!.text).toContain('registrasi.example.test');
    expect(one(results, 'C-09', 'INFO').map((r) => r.text).join('\n')).toMatch(/cf-cache-status MISS then HIT/);
  });
});

describe('what each failure looks like', () => {
  it('HSTS: the old long value, a missing header, includeSubDomains or preload (TA-01)', async () => {
    for (const [value, why] of [['max-age=31536000; includeSubDomains; preload', /expected "max-age=300"/], ['max-age=300; includeSubDomains', /expected "max-age=300"/], ['max-age=3600', /expected "max-age=300"/], [null, /no strict-transport-security/]] as const) {
      const { results } = await run((site) => patch(site, `${SITE}/`, { headers: value ? { 'strict-transport-security': value } : {}, drop: value ? [] : ['strict-transport-security'] }));
      expect(one(results, 'TA-01', 'FAIL')[0]!.text, String(value)).toMatch(why);
    }
  });

  it('the other security headers, on the home page and on a static asset (TA-01, T-20)', async () => {
    let r = await run((site) => patch(site, `${SITE}/`, { drop: ['x-content-type-options'] }));
    expect(one(r.results, 'TA-01', 'FAIL')[0]!.text).toContain('x-content-type-options is missing');
    r = await run((site) => patch(site, `${SITE}/`, { headers: { 'x-frame-options': 'SAMEORIGIN' } }));
    expect(one(r.results, 'TA-01', 'FAIL')[0]!.text).toContain('x-frame-options is "SAMEORIGIN"');
    r = await run((site) => patch(site, `${SITE}/`, { drop: ['referrer-policy', 'permissions-policy'] }));
    expect(one(r.results, 'TA-01', 'FAIL')[0]!.text).toMatch(/no referrer-policy; no permissions-policy/);
    r = await run((site) => patch(site, `${SITE}/_astro/Base.CYEQ0bMh.css`, { headers: { 'strict-transport-security': 'max-age=31536000' } }));
    expect(one(r.results, 'T-20', 'FAIL')[0]!.text).toContain('strict-transport-security');
  });

  it('the old site answering the home page (T-01 and TA-04)', async () => {
    const { results } = await run((site) => patch(site, `${SITE}/`, { body: '<html lang="en-US"><head><link rel="canonical" href="https://sakolakembara.org/"></head><body><img src="/wp-content/uploads/x.jpg"></body></html>', headers: { 'x-powered-by': 'PHP/8.2.12', 'set-cookie': 'wordpress_test_cookie=WP%20Cookie%20check; path=/' } }));
    const text = one(results, 'T-01', 'FAIL')[0]!.text;
    expect(text).toContain('not lang="id-ID"');
    expect(text).toContain('wp-content');
    expect(text).toContain('a cookie is set');
    expect(one(results, 'TA-04', 'FAIL')[0]!.text).toMatch(/sakolakembara\.org\/ \(set-cookie, x-powered-by\)/);
  });

  it('a WordPress, PHP or LiteSpeed header on ANY new-site answer fails TA-04 and names the path and the header, never its value (a blog page, the sitemap, a redirect, an asset, the admin, the 404 of /api)', async () => {
    const cases: [string, Record<string, string>, string][] = [
      [`${SITE}/blog`, { 'x-litespeed-cache': 'hit' }, 'x-litespeed-cache'],
      [`${SITE}/sitemap.xml`, { 'set-cookie': 'wordpress_logged_in_x=1; path=/' }, 'set-cookie'],
      [`${SITE}/laporan`, { 'x-redirect-by': 'WordPress' }, 'x-redirect-by'],
      [`${SITE}/_img/27f45874d486-480.webp`, { server: 'LiteSpeed' }, 'server'],
      ['https://admin.sakolakembara.org/api/me', { 'x-powered-by': 'PHP/8.1' }, 'x-powered-by'],
      [`${SITE}/api/check-x`, { link: '<https://sakolakembara.org/wp-json/>; rel="https://api.w.org/"' }, 'link'],
      [`${SITE}/robots.txt`, { 'x-pingback': 'https://sakolakembara.org/xmlrpc.php' }, 'x-pingback'],
      [`${SITE}/blog/${SLUG}`, { 'x-wp-total': '86' }, 'x-wp-total'],
    ];
    for (const [url, headers, name] of cases) {
      const { results } = await run((site) => patch(site, url, { headers }));
      const text = one(results, 'TA-04', 'FAIL')[0]?.text ?? '';
      expect(text, url).toContain(name);
      expect(text, url).toContain(new URL(url).pathname === '/' ? '/' : new URL(url).pathname);
      for (const value of Object.values(headers)) expect(text, url).not.toContain(value);
    }
  });

  it('a header recorded at DNS inventory step 6 (--legacy-header) counts too, with or without a pattern', async () => {
    const withPattern = await run((site) => patch(site, `${SITE}/blog`, { headers: { 'x-old-stack': 'wp-engine' } }), { legacy: [{ name: 'x-old-stack', pattern: /engine/i }] });
    expect(one(withPattern.results, 'TA-04', 'FAIL')[0]!.text).toContain('x-old-stack');
    const noPattern = await run((site) => patch(site, `${SITE}/blog`, { headers: { 'x-old-stack': 'anything' } }), { legacy: [{ name: 'x-old-stack', pattern: null }] });
    expect(one(noPattern.results, 'TA-04', 'FAIL').length).toBe(1);
    const other = await run((site) => patch(site, `${SITE}/blog`, { headers: { 'x-old-stack': 'fine' } }), { legacy: [{ name: 'x-old-stack', pattern: /engine/i }] });
    expect(one(other.results, 'TA-04', 'PASS').length).toBe(1);
  });

  it('the old stack on the paths that SHOULD reach it (wp-login, wp-admin) is not a failure of TA-04', async () => {
    const { results } = await run((site) => patch(site, `${SITE}/wp-login.php`, { headers: { 'x-powered-by': 'PHP/8.2', 'set-cookie': 'wordpress_test_cookie=WP%20Cookie%20check' } }));
    expect(one(results, 'TA-04', 'PASS').length).toBe(1);
    expect(one(results, 'TA-03', 'FAIL')).toEqual([]);
  });

  it('http without a redirect, a redirect to http, a loop or a temporary redirect (T-02)', async () => {
    for (const over of [{ status: 200, headers: {} }, { status: 301, headers: { location: 'http://sakolakembara.org/' } }, { status: 302, headers: { location: 'https://sakolakembara.org/' } }] as Recorded[]) {
      const { results } = await run((site) => site.set('http://sakolakembara.org/', { status: over.status, headers: over.headers }));
      expect(one(results, 'T-02', 'FAIL').length, JSON.stringify(over)).toBe(1);
    }
  });

  it('www: a 302, a lost query, another target, a loop (T-03)', async () => {
    for (const over of [{ status: 302, headers: { location: 'https://sakolakembara.org/blog?x=1' } }, { status: 301, headers: { location: 'https://sakolakembara.org/blog' } }, { status: 301, headers: { location: 'https://www.sakolakembara.org/blog?x=1' } }, { status: 200, headers: {} }] as Recorded[]) {
      const { results } = await run((site) => site.set('https://www.sakolakembara.org/blog?x=1', over));
      expect(one(results, 'T-03', 'FAIL').length, JSON.stringify(over)).toBe(1);
    }
  });

  it('robots.txt that blocks the site, lacks the Sitemap line or is the wrong type (T-04)', async () => {
    for (const [body, why] of [['User-agent: *\nDisallow: /\n', /blocks the whole site/], ['User-agent: *\nDisallow: /admin\nDisallow: /api\n', /no Sitemap line/], ['User-agent: *\nAllow: /\nSitemap: https://sakolakembara.org/sitemap.xml\n', /no "Disallow: \/admin"/]] as const) {
      const { results } = await run((site) => patch(site, `${SITE}/robots.txt`, { body }));
      expect(one(results, 'T-04', 'FAIL')[0]!.text).toMatch(why);
    }
    const wrongType = await run((site) => patch(site, `${SITE}/robots.txt`, { headers: { 'content-type': 'text/html' } }));
    expect(one(wrongType.results, 'T-04', 'FAIL')[0]!.text).toContain('content-type text/html');
  });

  it('a sitemap that is short, on the wrong host, not from the API or a 503 (T-05)', async () => {
    const urls = (n: number, host = 'sakolakembara.org') => `<urlset>${Array.from({ length: n }, (_, i) => `<url><loc>https://${host}/blog/a-${i}</loc></url>`).join('')}</urlset>`;
    let r = await run((site) => patch(site, `${SITE}/sitemap.xml`, { body: urls(50) }));
    expect(one(r.results, 'T-05', 'FAIL')[0]!.text).toContain('50 URLs, expected at least 90');
    r = await run((site) => patch(site, `${SITE}/sitemap.xml`, { body: urls(95, 'www.sakolakembara.org') }));
    expect(one(r.results, 'T-05', 'FAIL')[0]!.text).toContain('not on sakolakembara.org (for example www.sakolakembara.org)');
    r = await run((site) => patch(site, `${SITE}/sitemap.xml`, { body: urls(95, 'sakem-web-staging.acme.workers.dev') }));
    expect(one(r.results, 'T-05', 'FAIL')[0]!.text).toContain('workers.dev');
    r = await run((site) => patch(site, `${SITE}/sitemap.xml`, { headers: { 'x-blog-source': 'stale' } }));
    expect(one(r.results, 'T-05', 'FAIL')[0]!.text).toContain('x-blog-source is stale');
    r = await run((site) => patch(site, `${SITE}/sitemap.xml`, { status: 503 }));
    expect(one(r.results, 'T-05', 'FAIL')[0]!.text).toContain('status 503');
    // with no sitemap the dependent checks are skipped, not guessed
    expect(one(r.results, 'T-07', 'WARN').length).toBe(0);
  });

  it('a /blog with another cache-control, or not answered by the Worker, or no article list (T-06); a second answer that is not a copy is a warning (C-02)', async () => {
    let r = await run((site) => patch(site, `${SITE}/blog`, { headers: { 'cache-control': 'public, max-age=3600' } }));
    expect(one(r.results, 'T-06', 'FAIL')[0]!.text).toContain('cache-control is "public, max-age=3600"');
    r = await run((site) => patch(site, `${SITE}/blog`, { drop: ['x-blog-source'] }));
    expect(one(r.results, 'T-06', 'FAIL')[0]!.text).toContain('no x-blog-source');
    r = await run((site) => patch(site, `${SITE}/blog`, { body: '<html lang="id-ID"></html>' }));
    expect(one(r.results, 'T-06', 'FAIL')[0]!.text).toContain('no article link');
    r = await run((site) => site.set(`${SITE}/blog`, { status: 200, headers: { ...SECURITY, 'cache-control': EXPECT.blogCacheControl, 'x-blog-source': 'network' }, body: '<a href="/blog/abc">x</a>' }));
    expect(failures(r.results)).toEqual([]);
    expect(one(r.results, 'C-02', 'WARN')[0]!.text).toContain('network then network');
  });

  it('an article with the wrong canonical, a relative og:image, no JSON-LD, or an image on r2.dev (T-07)', async () => {
    const good = entry(healthySite(), `${SITE}/blog/${SLUG}`).body!;
    for (const [body, why] of [
      [good.replace(`https://sakolakembara.org/blog/${SLUG}"`, 'https://sakem-web-staging.acme.workers.dev/blog/x"'), /canonical https:\/\/sakem-web-staging/],
      [good.replace('content="https://sakolakembara.org/blog/images', 'content="/blog/images'), /og:image is \/blog\/images/],
      [good.replace('BlogPosting', 'Thing'), /no BlogPosting/],
      [good.replace(FILE_URL, 'https://pub-0123abcd.r2.dev/uploads/x.webp'), /served from pub-0123abcd.r2.dev: UPLOADS_BASE_URL is wrong/],
    ] as const) {
      const { results } = await run((site) => patch(site, `${SITE}/blog/${SLUG}`, { body }));
      expect(one(results, 'T-07', 'FAIL')[0]!.text).toMatch(why);
    }
  });

  it('old WordPress URLs: a 307, a wrong target, a 404 (T-08)', async () => {
    for (const over of [{ status: 307, headers: { location: `/blog/${SLUG}` } }, { status: 308, headers: { location: '/blog' } }, { status: 404, headers: {} }] as Recorded[]) {
      const { results } = await run((site) => site.set(`${SITE}/cerita/${SLUG}/`, over));
      expect(one(results, 'T-08', 'FAIL').length, JSON.stringify(over)).toBe(1);
    }
    const archive = await run((site) => site.set(`${SITE}/education/`, { status: 404, headers: {} }));
    expect(one(archive.results, 'T-08', 'FAIL').length).toBe(1);
  });

  it("an unknown path: a 200 or a 500 fails; a 404 without noindex fails; the old origin's own 404 fails too, SAKEM-103 forwards only WordPress's own paths (T-10)", async () => {
    const url = `${SITE}/no-such-page-check-1f3a`;
    for (const over of [{ status: 200 }, { status: 500 }] as Recorded[]) {
      const { results } = await run((site) => patch(site, url, over));
      expect(one(results, 'T-10', 'FAIL').length, JSON.stringify(over)).toBe(1);
    }
    const noindex = await run((site) => patch(site, url, { body: '<html lang="id-ID"><body>404</body></html>' }));
    expect(one(noindex.results, 'T-10', 'FAIL')[0]!.text).toContain('noindex');
    const origin = await run((site) => patch(site, url, { body: '<html lang="en-US"><body class="error404"><link href="/wp-content/themes/x/style.css"></body></html>', headers: { 'x-powered-by': 'PHP/8.2' } }));
    const text = one(origin.results, 'T-10', 'FAIL')[0]!.text;
    expect(text).toContain('the old origin answered');
    expect(text).toContain('not the new site\'s 404 page');
  });

  it('/api: a JSON that is not the 404, a cached one, an HTML one (T-14, T-18)', async () => {
    let r = await run((site) => site.set(`${SITE}/api/public/blog`, { status: 200, headers: { 'content-type': 'application/json' }, body: '{"items":[]}' }));
    expect(one(r.results, 'T-14', 'FAIL').length).toBe(1);
    r = await run((site) => patch(site, `${SITE}/api/check-x`, { drop: ['cache-control'] }));
    expect(one(r.results, 'T-18', 'FAIL')[0]!.text).toContain('cache-control missing');
    r = await run((site) => patch(site, `${SITE}/api/check-x`, { headers: { 'content-type': 'text/html' }, body: '<html>404</html>' }));
    expect(one(r.results, 'T-18', 'FAIL')[0]!.text).toContain('not the JSON');
  });

  it('/admin: a 404, a redirect that loses the query or goes elsewhere (T-15); /gabung-siswa/ with a 307 (T-19)', async () => {
    for (const over of [{ status: 404, headers: {} }, { status: 308, headers: { location: 'https://admin.sakolakembara.org/blog' } }, { status: 308, headers: { location: 'https://sakem-admin-staging.acme.workers.dev/blog?x=1' } }] as Recorded[]) {
      const { results } = await run((site) => site.set(`${SITE}/admin/blog?x=1`, over));
      expect(one(results, 'T-15', 'FAIL').length, JSON.stringify(over)).toBe(1);
    }
    const slash = await run((site) => site.set(`${SITE}/gabung-siswa/`, { status: 307, headers: { location: '/gabung-siswa' } }));
    expect(one(slash.results, 'T-19', 'FAIL')[0]!.text).toContain('status 307, expected 308');
  });

  it('SAKEM-105 (T-37): /laporan and /laporan/ must each be ONE 308 to /donasi#laporan: a page, another status, another target, a lost fragment or a chain through the slashless address all fail', async () => {
    for (const [url, over, why] of [
      [`${SITE}/laporan`, { status: 200, headers: {}, body: '<html lang="id-ID"></html>' }, 'status 200, expected 308'],
      [`${SITE}/laporan`, { status: 307, headers: { location: '/donasi#laporan' } }, 'status 307, expected 308'],
      [`${SITE}/laporan`, { status: 301, headers: { location: '/donasi#laporan' } }, 'status 301, expected 308'],
      [`${SITE}/laporan`, { status: 308, headers: { location: '/donasi' } }, 'location https://sakolakembara.org/donasi, expected https://sakolakembara.org/donasi#laporan'],
      [`${SITE}/laporan`, { status: 308, headers: { location: '/laporan/' } }, 'expected https://sakolakembara.org/donasi#laporan'],
      [`${SITE}/laporan/`, { status: 308, headers: { location: '/laporan' } }, 'location https://sakolakembara.org/laporan, expected'],
      [`${SITE}/laporan/`, { status: 404, headers: {} }, 'status 404, expected 308'],
    ] as [string, Recorded, string][]) {
      const { results } = await run((site) => site.set(url, over));
      const found = one(results, 'T-37', 'FAIL');
      expect(found.length, `${url} ${JSON.stringify(over)}`).toBe(1);
      expect(found[0]!.text, url).toContain(why);
    }
    // the healthy site: both are one hop (the checker never follows a redirect, so a chain would show as the first hop's target)
    const healthy = await run();
    expect(one(healthy.results, 'T-37', 'PASS').map((r) => r.text)).toEqual([
      expect.stringContaining('/laporan and /laporan/ are each ONE 308 to /donasi#laporan'),
      expect.stringContaining('/donasi: 200 html with the Laporan section'),
    ]);
  });

  it('SAKEM-105 (T-37): /donasi must be the 200 with the Laporan section, a healthy reports source and the footer link, and nothing may link to /laporan (the menu lost the item)', async () => {
    const page = (extra: string, head = '<link rel="canonical" href="https://sakolakembara.org/donasi">') =>
      `<!doctype html><html lang="id-ID"><head>${head}</head><body><main>${extra}</main><footer><a href="/donasi#laporan">Laporan</a></footer></body></html>`;
    const section = '<section id="laporan"><h2>Laporan</h2></section>';
    const cases: [string, Partial<Recorded> & { headers?: Record<string, string>; drop?: string[] }, RegExp][] = [
      ['a 503', { status: 503 }, /status 503/],
      ['no section', { body: page('<section><h2>Laporan</h2></section>') }, /no section with id="laporan"/],
      ['a div with the id is not the section', { body: page('<div id="laporan"></div>') }, /no section with id="laporan"/],
      ['the stale copy', { headers: { 'x-reports-source': 'stale' } }, /x-reports-source is stale/],
      ['the failure panel (the API cannot answer, nothing cached)', { headers: { 'x-reports-source': 'empty' }, body: page(`${section}<p>Laporan belum dapat ditampilkan</p>`) }, /x-reports-source is empty[\s\S]*the Laporan section shows its failure panel/],
      ['no header at all (is the Worker answering?)', { drop: ['x-reports-source'] }, /x-reports-source is missing/],
      ['the old menu item', { body: page(`${section}<nav><a href="/laporan">Laporan</a></nav>`) }, /a link to \/laporan/],
      ['the old menu item with a slash', { body: page(`${section}<a href='/laporan/'>Laporan</a>`) }, /a link to \/laporan/],
      ['no footer link', { body: `<!doctype html><html lang="id-ID"><head><link rel="canonical" href="https://sakolakembara.org/donasi"></head><body>${section}</body></html>` }, /no link to \/donasi#laporan/],
      ['a canonical of another page', { body: page(section, '<link rel="canonical" href="https://sakolakembara.org/laporan">') }, /canonical https:\/\/sakolakembara\.org\/laporan/],
    ];
    for (const [name, over, why] of cases) {
      const { results } = await run((site) => patch(site, `${SITE}/donasi`, over));
      const found = one(results, 'T-37', 'FAIL');
      expect(found.length, name).toBe(1);
      expect(found[0]!.text, name).toMatch(why);
    }
    // a healthy answer from the data cache is fine too
    const cached = await run((site) => patch(site, `${SITE}/donasi`, { headers: { 'x-reports-source': 'cache' } }));
    expect(one(cached.results, 'T-37', 'FAIL')).toEqual([]);
  });

  it('SAKEM-105 (T-05): the sitemap lists /donasi and no longer /laporan, which is a redirect', async () => {
    const withLaporan = await run((site) => patch(site, `${SITE}/sitemap.xml`, { body: (entry(site, `${SITE}/sitemap.xml`).body ?? '').replace('</urlset>', '<url><loc>https://sakolakembara.org/laporan</loc></url></urlset>') }));
    expect(one(withLaporan.results, 'T-05', 'FAIL')[0]!.text).toContain('lists /laporan, which is a redirect since SAKEM-105');
    const withoutDonasi = await run((site) => patch(site, `${SITE}/sitemap.xml`, { body: (entry(site, `${SITE}/sitemap.xml`).body ?? '').replace('<url><loc>https://sakolakembara.org/donasi</loc></url>', '') }));
    expect(one(withoutDonasi.results, 'T-05', 'FAIL')[0]!.text).toContain('does not list /donasi');
  });

  it('a static asset without the immutable cache-control, or with a cookie (T-20); a missing asset reference is a warning, not a guess', async () => {
    let r = await run((site) => patch(site, `${SITE}/_astro/Base.CYEQ0bMh.css`, { headers: { 'cache-control': 'public, max-age=0, must-revalidate' } }));
    expect(one(r.results, 'T-20', 'FAIL')[0]!.text).toContain('cache-control is "public, max-age=0, must-revalidate"');
    r = await run((site) => patch(site, `${SITE}/_img/27f45874d486-480.webp`, { headers: { 'set-cookie': 'a=b' } }));
    expect(one(r.results, 'T-20', 'FAIL')[0]!.text).toContain('a cookie is set');
    r = await run((site) => patch(site, `${SITE}/`, { body: '<html lang="id-ID"><head><link rel="canonical" href="https://sakolakembara.org/"></head><body></body></html>' }));
    expect(one(r.results, 'T-20', 'WARN').length).toBe(2);
  });

  it('/daftar: the old 308 to /gabung-siswa, a target on workers.dev, a target that is not the one named, no redirect (TA-02)', async () => {
    for (const over of [{ status: 308, headers: { location: '/gabung-siswa' } }, { status: 307, headers: { location: 'https://sakem-web-staging.acme.workers.dev/form' } }, { status: 307, headers: {} }, { status: 404, headers: {} }, { status: 307, headers: { location: 'http://registrasi.example.test/form' } }] as Recorded[]) {
      const { results } = await run((site) => site.set(`${SITE}/daftar`, over));
      expect(one(results, 'TA-02', 'FAIL').length, JSON.stringify(over)).toBe(1);
    }
    const named = await run(undefined, { daftarTarget: FORM_URL });
    expect(one(named.results, 'TA-02', 'PASS').length).toBe(1);
    const other = await run(undefined, { daftarTarget: 'https://registrasi.example.test/lain' });
    expect(one(other.results, 'TA-02', 'FAIL')[0]!.text).toContain('--daftar-target');
  });

  it('/daftar before the shortlink exists is the polite 404 page: the failure says P-25, not "wrong status" (TA-02)', async () => {
    const polite: Recorded = { status: 404, headers: { ...SECURITY, 'content-type': 'text/html', 'cache-control': 'no-store' }, body: '<html lang="id-ID"><body><h1>Formulir pendaftaran belum tersedia</h1></body></html>' };
    const { results } = await run((site) => site.set(`${SITE}/daftar`, polite));
    expect(one(results, 'TA-02', 'FAIL')[0]!.text).toContain('does not exist or is switched off');
    expect(one(results, 'TA-02', 'FAIL')[0]!.text).toContain('P-25');
  });

  it('/daftar must never be kept (no-store), its slash is a 308 to /daftar, its capital form a 307, and /gabung-siswa links to it and not into /portal (TA-02)', async () => {
    let r = await run((site) => patch(site, `${SITE}/daftar`, { drop: ['cache-control'] }));
    expect(one(r.results, 'TA-02', 'FAIL')[0]!.text).toContain('expected no-store');
    // a 308 to a real https form, even with no-store, is not the shortlink's 307 (the old static rule was a 308)
    r = await run((site) => site.set(`${SITE}/daftar`, { status: 308, headers: { location: FORM_URL, 'cache-control': 'no-store' } }));
    expect(one(r.results, 'TA-02', 'FAIL')[0]!.text).toContain('status 308, expected 307');
    for (const over of [{ status: 307, headers: { location: '/daftar' } }, { status: 308, headers: { location: '/gabung-siswa' } }, { status: 404, headers: {} }] as Recorded[]) {
      r = await run((site) => site.set(`${SITE}/daftar/`, over));
      expect(one(r.results, 'TA-02', 'FAIL')[0]!.text, JSON.stringify(over)).toContain('expected a 308 to /daftar');
    }
    r = await run((site) => site.set(`${SITE}/Daftar`, { status: 404, headers: {} }));
    expect(one(r.results, 'TA-02', 'FAIL')[0]!.text).toContain('/Daftar is 404, expected 307');
    r = await run((site) => patch(site, `${SITE}/gabung-siswa`, { body: '<html lang="id-ID"><a href="/portal/daftar">Daftar Sekarang</a></html>' }));
    const text = one(r.results, 'TA-02', 'FAIL')[0]!.text;
    expect(text).toContain('no "Daftar Sekarang" link to /daftar');
    expect(text).toContain('still links into /portal');
  });

  it('WordPress paths: the new site answering them (its 404) fails TA-03; a redirect to somewhere else fails; WordPress itself passes', async () => {
    let r = await run((site) => site.set(`${SITE}/wp-login.php`, { status: 404, headers: { ...SECURITY, 'content-type': 'text/html' }, body: '<html lang="id-ID"><body>404</body></html>' }));
    expect(one(r.results, 'TA-03', 'FAIL')[0]!.text).toMatch(/status 404/);
    r = await run((site) => site.set(`${SITE}/wp-login.php`, { status: 200, headers: { 'content-type': 'text/html' }, body: '<html lang="id-ID">the home page</html>' }));
    expect(one(r.results, 'TA-03', 'FAIL')[0]!.text).toContain("not WordPress's login page");
    r = await run((site) => site.set(`${SITE}/wp-admin/`, { status: 404, headers: {} }));
    expect(one(r.results, 'TA-03', 'FAIL').length).toBe(1);
    r = await run((site) => site.set(`${SITE}/wp-admin/`, { status: 301, headers: { location: 'https://admin.sakolakembara.org/' } }));
    expect(one(r.results, 'TA-03', 'FAIL')[0]!.text).toContain('expected /wp-admin/ or /wp-login.php');
    r = await run((site) => patch(site, `${SITE}/wp-login.php`, { body: '<html>nothing</html>', headers: { 'set-cookie': 'wordpress_test_cookie=WP%20Cookie%20check; path=/' } }));
    expect(one(r.results, 'TA-03', 'FAIL')).toEqual([]);
    r = await run((site) => site.set(`${SITE}/wp-json/`, { status: 404, headers: {} }));
    expect(one(r.results, 'TA-03', 'FAIL')[0]!.text).toContain('/wp-json/');
    r = await run((site) => patch(site, `${SITE}/wp-json/`, { headers: { 'content-type': 'text/html' } }));
    expect(one(r.results, 'TA-03', 'FAIL')[0]!.text).toContain('expected JSON');
  });

  it("a WordPress path answered with the Worker's own HSTS was answered by the Worker, not WordPress (TA-03, T-31)", async () => {
    for (const path of ['/wp-login.php', '/wp-admin/', '/wp-json/']) {
      const { results } = await run((site) => patch(site, `${SITE}${path}`, { headers: { 'strict-transport-security': 'max-age=300' } }));
      expect(one(results, 'TA-03', 'FAIL')[0]!.text, path).toContain("the Worker answered, not WordPress");
    }
  });

  it('a Cloudflare challenge in front of WordPress (a zone rule) is a warning that says to look by hand, not a failure (TA-03)', async () => {
    const challenge = { status: 403, headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html', server: 'cloudflare' }, body: '<html>Just a moment...</html>' };
    const { results } = await run((site) => {
      site.set(`${SITE}/wp-login.php`, challenge);
      site.set(`${SITE}/wp-admin/`, challenge);
    });
    expect(failures(results)).toEqual([]);
    const warnings = one(results, 'TA-03', 'WARN');
    expect(warnings.length).toBe(2);
    expect(warnings[0]!.text).toContain('open it by hand in a browser');
  });

  it('the admin app sending no X-Frame-Options or no nosniff is a warning that names F-19, not a failure (TA-05)', async () => {
    const { results } = await run((site) => patch(site, 'https://admin.sakolakembara.org/', { drop: ['x-frame-options', 'x-content-type-options'] }));
    expect(failures(results)).toEqual([]);
    const warning = one(results, 'TA-05', 'WARN')[0]!;
    expect(warning.text).toContain('no x-frame-options and no x-content-type-options');
    expect(warning.text).toContain('F-19');
    const one_ = await run((site) => patch(site, 'https://admin.sakolakembara.org/', { drop: ['x-frame-options'] }));
    expect(one(one_.results, 'TA-05', 'WARN')[0]!.text).toContain('no x-frame-options:');
  });

  it('/login is WordPress, not a 308 into /portal, not the site\'s 404, not the Worker (T-16)', async () => {
    for (const over of [{ status: 308, headers: { location: '/portal/login' } }, { status: 308, headers: { location: 'https://sakolakembara.org/wp-login.php' } }, { status: 404, headers: {} }, { status: 302, headers: { location: 'https://sakolakembara.org/wp-admin/' } }, { status: 200, headers: {} }, { status: 302, headers: { location: 'https://sakolakembara.org/wp-login.php', 'strict-transport-security': 'max-age=300' } }] as Recorded[]) {
      const { results } = await run((site) => site.set(`${SITE}/login`, over));
      expect(one(results, 'T-16', 'FAIL').length, JSON.stringify(over)).toBe(1);
    }
    const ok = await run();
    expect(one(ok.results, 'T-16', 'PASS').length).toBe(2);
  });

  it("/register, /forgot-password, /portal and /portal/status are the site's 404 page: a redirect, a 200 and WordPress's own 404 fail (T-16, T-17)", async () => {
    for (const [id, path] of [['T-16', '/register'], ['T-16', '/forgot-password'], ['T-17', '/portal'], ['T-17', '/portal/status']] as const) {
      for (const over of [{ status: 308, headers: { location: '/portal/login' } }, { status: 200, headers: { 'content-type': 'text/html' }, body: '<html lang="id-ID"></html>' }] as Recorded[]) {
        const { results } = await run((site) => site.set(`${SITE}${path}`, over));
        expect(one(results, id, 'FAIL')[0]!.text, `${path} ${JSON.stringify(over)}`).toContain(path);
      }
      const wordpress = await run((site) => site.set(`${SITE}${path}`, { status: 404, headers: { 'content-type': 'text/html', 'x-powered-by': 'PHP/8.2' }, body: '<html lang="en-US"><body class="error404"></body></html>' }));
      expect(one(wordpress.results, id, 'FAIL')[0]!.text, path).toContain('the old origin answered');
    }
  });

  it("a look-alike of a WordPress path that WordPress answers fails (T-34): /wp-adminx, /wp-login, /wp-login.php.bak, /login/x, /Login", async () => {
    for (const path of ['/wp-adminx', '/wp-login', '/wp-login.php.bak', '/login/x', '/Login']) {
      const { results } = await run((site) => site.set(`${SITE}${path}`, { status: 404, headers: { 'content-type': 'text/html', server: 'LiteSpeed' }, body: '<html lang="en-US"><body class="error404"></body></html>' }));
      expect(one(results, 'T-34', 'FAIL')[0]!.text, path).toContain(`${path}: `);
    }
    const ok = await run();
    expect(one(ok.results, 'T-34', 'PASS').length).toBe(1);
  });

  it('the portal switch: "Masuk", the session address, the auth link, a registration button in the navbar or a filled slot, on the home page or on /blog, fails (T-35)', async () => {
    const withIn = (html: string, extra: string) => html.replace('</nav>', `${extra}</nav>`);
    const cases: [string, string, string][] = [
      ['/', '<a href="/portal/login" data-auth-link>Masuk</a>', 'has the "Masuk" link'],
      ['/blog', '<a href="/portal/login" data-auth-link>Masuk</a>', 'has the "Masuk" link'],
      ['/', '<a href="/daftar">Daftar Sekarang</a>', 'the navbar has a registration button'],
      ['/blog', '<span class="justify-self-end"></span>', 'the navbar slot of the button is not empty'],
    ];
    for (const [path, extra, why] of cases) {
      const { results } = await run((site) => patch(site, `${SITE}${path}`, { body: withIn(entry(site, `${SITE}${path}`).body!, extra) }));
      expect(one(results, 'T-35', 'FAIL')[0]!.text, `${path} ${extra}`).toContain(why);
    }
    const session = await run((site) => patch(site, `${SITE}/blog`, { body: entry(site, `${SITE}/blog`).body!.replace('</body>', "<script>fetch('/portal/api/auth/get-session')</script></body>") }));
    expect(one(session.results, 'T-35', 'FAIL')[0]!.text).toContain("calls the portal's session address");
    const masuk = await run((site) => patch(site, `${SITE}/`, { body: entry(site, `${SITE}/`).body!.replace('<button', '<span>Masuk</span><button') }));
    expect(one(masuk.results, 'T-35', 'FAIL')[0]!.text).toContain('the navbar says "Masuk"');
  });

  it('HSTS must be exactly max-age=300 on the Worker\'s own answers: a long value, includeSubDomains, preload or none on /blog, /daftar, a 404, robots.txt or an image fails and names the path (T-36)', async () => {
    const cases: [string, Record<string, string>, string[]][] = [
      ['/blog', { 'strict-transport-security': 'max-age=31536000; includeSubDomains; preload' }, []],
      ['/daftar', { 'strict-transport-security': 'max-age=300; includeSubDomains' }, []],
      ['/no-such-page-check-1f3a', {}, ['strict-transport-security']],
      ['/robots.txt', { 'strict-transport-security': 'max-age=300; preload' }, []],
      ['/_img/27f45874d486-480.webp', { 'strict-transport-security': 'max-age=86400' }, []],
    ];
    for (const [path, headers, drop] of cases) {
      const { results } = await run((site) => patch(site, `${SITE}${path}`, { headers, drop }));
      expect(one(results, 'T-36', 'FAIL')[0]!.text, path).toContain(`${path}: `);
    }
    const ok = await run();
    expect(one(ok.results, 'T-36', 'PASS').length).toBe(1);
  });

  it('an upload an article uses is ONE 308 to its copy; a two-hop chain, a 404 or a 200 fails; no migrated image in the article is a warning (T-09)', async () => {
    const url = `${SITE}/wp-content/uploads/2026/08/photo-1.jpeg`;
    for (const over of [{ status: 307, headers: { location: '/blog/images/2026/08/photo-1.jpeg' } }, { status: 308, headers: { location: '/wp-content/uploads/2026/08/photo-1-1024x768.jpeg' } }, { status: 404, headers: {} }, { status: 200, headers: {} }] as Recorded[]) {
      const { results } = await run((site) => site.set(url, over));
      expect(one(results, 'T-09', 'FAIL').length, JSON.stringify(over)).toBe(1);
    }
    const none = await run((site) => patch(site, `${SITE}/blog/${SLUG}`, { body: entry(site, `${SITE}/blog/${SLUG}`).body!.replaceAll('/blog/images/2026/08/photo-1.jpeg', '/other.png') }));
    expect(one(none.results, 'T-09', 'WARN').length).toBe(1);
  });

  it('a request that fails on /portal is a failure of T-17, with the reason (no answer), never a pass', async () => {
    const { results } = await run((site) => {
      site.set(`${SITE}/portal`, () => {
        throw new Error('boom');
      });
    });
    expect(one(results, 'T-17', 'FAIL')[0]!.text).toContain('no answer (Error)');
  });

  it('the admin host: a test key, a key that is not set, files or site URLs of staging, a config that is not JSON (TA-05)', async () => {
    const config = (over: Record<string, unknown>) => ({ status: 200, headers: { 'cache-control': 'no-store', 'content-type': 'application/json' }, body: JSON.stringify({ google: false, turnstileSiteKey: '0x4AAAAAAAdemoKey123456', uploadsBaseUrl: 'https://files.sakolakembara.org', siteUrl: 'https://sakolakembara.org', ...over }) });
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ turnstileSiteKey: '1x00000000000000000000AA' }, /TEST key/],
      [{ turnstileSiteKey: null }, /turnstileSiteKey is not set/],
      [{ uploadsBaseUrl: 'https://pub-0123abcd.r2.dev' }, /uploadsBaseUrl is "https:\/\/pub-0123abcd.r2.dev"/],
      [{ uploadsBaseUrl: '' }, /uploadsBaseUrl is ""/],
      [{ siteUrl: 'https://sakem-web-staging.acme.workers.dev' }, /siteUrl is "https:\/\/sakem-web-staging/],
    ];
    for (const [over, why] of cases) {
      const { results } = await run((site) => site.set('https://admin.sakolakembara.org/api/config', config(over)));
      expect(failures(results).filter((r) => r.id === 'TA-05')[0]!.text, JSON.stringify(over)).toMatch(why);
    }
    const notJson = await run((site) => site.set('https://admin.sakolakembara.org/api/config', { status: 200, headers: { 'cache-control': 'no-store' }, body: '<html>' }));
    expect(failures(notJson.results).filter((r) => r.id === 'TA-05')[0]!.text).toContain('not JSON');
    const cached = await run((site) => patch(site, 'https://admin.sakolakembara.org/api/config', { drop: ['cache-control'] }));
    expect(failures(cached.results)[0]!.text).toContain('cache-control missing');
  });

  it('the admin host: a session answered 200, the public reads or the local-only routes existing, an app that is not html (TA-05, T-14)', async () => {
    let r = await run((site) => site.set('https://admin.sakolakembara.org/api/me', { status: 200, headers: {}, body: '{"user":{}}' }));
    expect(failures(r.results)[0]!.text).toContain('status 200, expected 401');
    for (const p of ['/api/public/team', '/uploads/check-x', '/api/dev/mailbox']) {
      r = await run((site) => site.set(`https://admin.sakolakembara.org${p}`, { status: 200, headers: {}, body: '{}' }));
      expect(one(r.results, 'T-14', 'FAIL')[0]!.text, p).toContain('status 200, expected 404');
    }
    r = await run((site) => patch(site, 'https://admin.sakolakembara.org/', { headers: { 'content-type': 'application/json' } }));
    expect(failures(r.results)[0]!.text).toContain('content-type application/json');
  });

  it('the files host: a listing, an object without the immutable cache-control or with a cookie, a missing object that answers 200 (TA-06)', async () => {
    let r = await run((site) => site.set('https://files.sakolakembara.org/', { status: 200, headers: { 'content-type': 'application/xml' }, body: '<ListBucketResult><Contents><Key>a</Key></Contents></ListBucketResult>' }));
    expect(one(r.results, 'TA-06', 'FAIL')[0]!.text).toContain('the bucket lists its objects');
    r = await run((site) => patch(site, FILE_URL, { headers: { 'cache-control': 'public, max-age=60' } }));
    expect(one(r.results, 'TA-06', 'FAIL')[0]!.text).toContain('cache-control is "public, max-age=60"');
    r = await run((site) => patch(site, FILE_URL, { headers: { 'set-cookie': 'a=b' } }));
    expect(one(r.results, 'TA-06', 'FAIL')[0]!.text).toContain('a cookie is set');
    r = await run((site) => patch(site, FILE_URL, { headers: { 'content-type': 'text/html' } }));
    expect(one(r.results, 'TA-06', 'FAIL')[0]!.text).toContain('content-type text/html');
    r = await run((site) => site.set('https://files.sakolakembara.org/uploads/check-x-missing.png', { status: 200, headers: { 'content-type': 'image/png' } }));
    expect(one(r.results, 'TA-06', 'FAIL')[0]!.text).toContain('status 200, expected 404');
  });

  it('with no uploaded file referenced yet the files host says so (a note) and checks the rest', async () => {
    const { results } = await run((site) => {
      patch(site, `${SITE}/blog/${SLUG}`, { body: entry(site, `${SITE}/blog/${SLUG}`).body!.replace(FILE_URL, '/blog/images/x.png') });
      site.set(`${SITE}/tim`, { status: 200, headers: { 'content-type': 'text/html' }, body: '<html>no photos yet</html>' });
    });
    expect(failures(results)).toEqual([]);
    expect(one(results, 'TA-06', 'INFO')[0]!.text).toContain('no uploaded file is referenced');
  });

  it('a request that fails is a failure with the reason, not a crash and not a pass', async () => {
    const down = await run((site) => {
      site.set(`${SITE}/`, () => {
        throw new Error('boom');
      });
    });
    expect(one(down.results, 'T-01', 'FAIL')[0]!.text).toContain('no answer');
    expect(one(down.results, 'TA-01', 'FAIL')[0]!.text).toContain('no answer');
  });
});

describe('the groups', () => {
  it('--only limits the plan: www alone is one request, admin alone is six, files alone is three (with no /tim to look in)', async () => {
    const www = await run(undefined, { only: ['www'] });
    expect(www.log.calls.map((c) => c.url)).toEqual(['https://www.sakolakembara.org/blog?x=1']);
    expect(www.results.map((r) => r.id)).toEqual(['T-03', 'TA-04']);
    const admin = await run(undefined, { only: ['admin'] });
    expect(new Set(admin.log.calls.map((c) => new URL(c.url).host))).toEqual(new Set(['admin.sakolakembara.org']));
    expect(admin.log.calls.length).toBe(6);
    const files = await run(undefined, { only: ['files'] });
    expect(files.log.calls.map((c) => new URL(c.url).host)).toEqual(['files.sakolakembara.org', 'files.sakolakembara.org']);
    expect(one(files.results, 'TA-06', 'INFO').length).toBe(1);
  });

  it('the plan names every group once and only the four hosts', () => {
    expect(PLAN.map(([group]) => group)).toEqual(['site', 'www', 'admin', 'files']);
    expect([...ALLOWED_HOSTS].sort()).toEqual(['admin.sakolakembara.org', 'files.sakolakembara.org', 'sakolakembara.org', 'www.sakolakembara.org']);
    expect(Object.values(HOSTS).sort()).toEqual([...ALLOWED_HOSTS].sort());
  });
});

describe('the client: politeness, the four hosts, and reading only', () => {
  it('waits at least a second between two requests, whatever the clock', async () => {
    const { client, waits } = setup();
    await client.get('https://sakolakembara.org/');
    await client.get('https://sakolakembara.org/robots.txt');
    await client.get('https://admin.sakolakembara.org/');
    expect(waits).toEqual([1000, 1000]);
    expect(MIN_DELAY_MS).toBe(1000);
  });

  it('cannot be made faster than a second per request', () => {
    expect(() => createClient({ delayMs: 999 })).toThrow(RangeError);
    expect(() => createClient({ delayMs: 0 })).toThrow(RangeError);
    expect(() => createClient({ delayMs: Number.NaN })).toThrow(RangeError);
    expect(() => createClient({ delayMs: 1000 })).not.toThrow();
  });

  it('refuses any host outside the four before sending anything: another domain, a lookalike, a subdomain nobody listed, a port, credentials, another scheme', async () => {
    const { client, log } = setup();
    for (const url of [
      'https://example.com/',
      'https://sakolakembara.org.evil.test/',
      'https://notsakolakembara.org/',
      'https://lms.sakolakembara.org/',
      'https://staging.sakolakembara.org/',
      'https://sakem-web-staging.acme.workers.dev/',
      'https://pub-0123abcd.r2.dev/x',
      'https://admin.sakolakembara.org:8443/',
      'https://user:pw@sakolakembara.org/',
      'ftp://sakolakembara.org/',
      'http://127.0.0.1:8787/',
    ]) {
      await expect(client.get(url), url).rejects.toThrow(RefusedHost);
    }
    expect(log.calls).toEqual([]);
  });

  it('uppercase hosts of the four are fine (a URL lowercases its host); a redirect is never followed, even to the other three hosts', async () => {
    const { client, log } = setup((site) => site.set('https://sakolakembara.org/loop', { status: 301, headers: { location: 'https://example.com/elsewhere' } }));
    await client.get('https://SAKOLAKEMBARA.ORG/');
    const answer = await client.get('https://sakolakembara.org/loop');
    expect(answer.status).toBe(301);
    expect(answer.headers.location).toBe('https://example.com/elsewhere');
    expect(log.calls.map((c) => c.url)).toEqual(['https://sakolakembara.org/', 'https://sakolakembara.org/loop']);
  });

  it('sends GET only, no cookie, no authorization, no token, redirect manual, credentials omitted, the tool as the user agent', async () => {
    const { client, log } = setup();
    await client.get('https://sakolakembara.org/');
    await client.get('http://sakolakembara.org/');
    await client.get('https://files.sakolakembara.org/');
    for (const call of log.calls) {
      expect(call.method).toBe('GET');
      expect(call.redirect).toBe('manual');
      expect(call.credentials).toBe('omit');
      expect(Object.keys(call.headers).sort()).toEqual(['accept', 'accept-language', 'user-agent']);
      expect(call.headers['user-agent']).toBe(USER_AGENT);
    }
    expect(USER_AGENT).toContain('GET only');
  });

  it('a whole run sends nothing but GET to the four hosts, and the headers are the same three', async () => {
    const { log } = await run();
    expect(new Set(log.calls.map((c) => c.method))).toEqual(new Set(['GET']));
    expect(new Set(log.calls.map((c) => new URL(c.url).host))).toEqual(ALLOWED_HOSTS);
    for (const call of log.calls) expect(Object.keys(call.headers).sort()).toEqual(['accept', 'accept-language', 'user-agent']);
  });

  it('does not read the body of an image or a file, and caps a large page', async () => {
    const { client } = setup((site) => site.set('https://sakolakembara.org/big', { status: 200, headers: { 'content-type': 'text/html' }, body: 'x'.repeat(3_000_000) }));
    const big = await client.get('https://sakolakembara.org/big');
    expect(big.body.length).toBeLessThanOrEqual(2_000_000);
    const image = await client.get('https://sakolakembara.org/_img/27f45874d486-480.webp');
    expect(image.body).toBe('');
  });

  it('counts requests and errors, so a run where nothing answers can be told apart', async () => {
    const dead = createClient({ fetchImpl: (async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); }) as unknown as typeof fetch, sleep: noSleep });
    const answer = await dead.get('https://sakolakembara.org/');
    expect(answer.error).toBe('ENOTFOUND');
    expect(dead.stats).toEqual({ requests: 1, errors: 1 });
  });
});

describe('what counts as the old stack', () => {
  it('names WordPress, PHP and LiteSpeed headers, and nothing the new site sends', () => {
    expect(legacyHeaders({ 'x-powered-by': 'PHP/8.2' })).toEqual(['x-powered-by']);
    expect(legacyHeaders({ 'x-powered-by': 'Express' })).toEqual([]);
    expect(legacyHeaders({ server: 'cloudflare' })).toEqual([]);
    expect(legacyHeaders({ server: 'LiteSpeed' })).toEqual(['server']);
    expect(legacyHeaders({ 'x-litespeed-cache': 'hit', 'x-litespeed-tag': 'x' })).toEqual(['x-litespeed-cache', 'x-litespeed-tag']);
    expect(legacyHeaders({ link: '</wp-json/>; rel="https://api.w.org/"' })).toEqual(['link']);
    expect(legacyHeaders({ link: '</blog>; rel="canonical"' })).toEqual([]);
    expect(legacyHeaders({ 'set-cookie': 'PHPSESSID=abc; path=/' })).toEqual(['set-cookie']);
    expect(legacyHeaders({ 'set-cookie': 'a=b' })).toEqual([]);
    for (const [name, headers] of [['security headers', SECURITY], ['immutable asset', { 'cache-control': 'public, max-age=31536000, immutable', 'cf-cache-status': 'HIT', etag: '"x"' }]] as const) {
      expect(legacyHeaders(headers as Record<string, string>), name).toEqual([]);
    }
  });

  it('recognises WordPress by its markup', () => {
    expect(looksLikeWordPress('<form id="loginform" action="/wp-login.php"><input name="log">')).toBe(true);
    expect(looksLikeWordPress('<link href="/wp-content/themes/x.css">')).toBe(true);
    expect(looksLikeWordPress('<html lang="id-ID"><body>Sakola Kembara</body></html>')).toBe(false);
  });
});

describe('the command line', () => {
  const capture = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
  };
  const factory = (mutate: (site: Map<string, Entry>) => void = () => undefined) => {
    const s = setup(mutate);
    return { ...s, clientFactory: () => s.client };
  };

  it('refuses to send anything without --allow-network, and says why (exit 2)', async () => {
    const c = capture();
    const f = factory();
    expect(await main([], { ...c.io, clientFactory: f.clientFactory })).toBe(2);
    expect(c.err.join('')).toContain('--allow-network');
    expect(f.log.calls).toEqual([]);
  });

  it('--plan prints the GET lines and sends nothing, with or without --allow-network (exit 0)', async () => {
    for (const argv of [['--plan'], ['--plan', '--allow-network'], ['--dry-run']]) {
      const c = capture();
      const f = factory();
      expect(await main(argv, { ...c.io, clientFactory: f.clientFactory })).toBe(0);
      expect(c.out.join('')).toContain('GET https://sakolakembara.org/');
      expect(c.out.join('')).toContain('GET https://admin.sakolakembara.org/api/config');
      expect(c.out.join('')).toContain('nothing was sent');
      expect(f.log.calls).toEqual([]);
    }
  });

  it('has no option to name a host: --base, --host, a URL and a bare host are refused (exit 2)', async () => {
    for (const argv of [['--base', 'https://example.com'], ['--host', 'example.com'], ['--url=https://example.com'], ['https://example.com'], ['example.com'], ['--origin', 'https://staging.acme.workers.dev'], ['--allow-network', '--site', 'https://sakolakembara.org']]) {
      const c = capture();
      const f = factory();
      expect(await main(argv, { ...c.io, clientFactory: f.clientFactory }), argv.join(' ')).toBe(2);
      expect(c.err.join('')).toContain('no option to name a host');
      expect(f.log.calls).toEqual([]);
    }
  });

  it('refuses a pause below a second, an unknown group, a bad --daftar-target and a bad regex (exit 2)', async () => {
    for (const argv of [['--allow-network', '--delay-ms', '500'], ['--allow-network', '--delay-ms', 'soon'], ['--allow-network', '--only', 'lms'], ['--allow-network', '--daftar-target', 'http://x.example.test/'], ['--allow-network', '--daftar-target', 'nope'], ['--allow-network', '--legacy-header', 'x-a=('], ['--allow-network', '--min-sitemap-urls', '0'], ['--allow-network', '--delay-ms']]) {
      const c = capture();
      const f = factory();
      expect(await main(argv, { ...c.io, clientFactory: f.clientFactory }), argv.join(' ')).toBe(2);
      expect(f.log.calls).toEqual([]);
    }
  });

  it('parses the options it has', () => {
    const o = parseCli(['--allow-network', '--only', 'site,www', '--legacy-header', 'x-old=wp', '--legacy-header', 'x-other', '--daftar-target', FORM_URL, '--min-sitemap-urls', '95', '--delay-ms', '1500', '--json']);
    expect(o.only).toEqual(['site', 'www']);
    expect(o.legacy.map((l: { name: string }) => l.name)).toEqual(['x-old', 'x-other']);
    expect(o.daftarTarget).toBe(FORM_URL);
    expect(o.minSitemapUrls).toBe(95);
    expect(o.delayMs).toBe(1500);
    expect(o.json).toBe(true);
    expect(() => parseCli(['--bogus'])).toThrow(UsageError);
  });

  it('a healthy run prints the report and exits 0; a failing run exits 1; a run where nothing answers exits 3', async () => {
    let c = capture();
    let f = factory();
    expect(await main(['--allow-network'], { ...c.io, clientFactory: f.clientFactory })).toBe(0);
    expect(c.out.join('')).toMatch(/0 failed/);
    expect(f.waits.every((w) => w >= 1000)).toBe(true);

    c = capture();
    f = factory((site) => patch(site, `${SITE}/`, { headers: { 'strict-transport-security': 'max-age=31536000; includeSubDomains; preload' } }));
    expect(await main(['--allow-network'], { ...c.io, clientFactory: f.clientFactory })).toBe(1);
    expect(c.out.join('')).toMatch(/^FAIL TA-01 /m);

    c = capture();
    const dead = createClient({ fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch, sleep: noSleep });
    expect(await main(['--allow-network'], { ...c.io, clientFactory: () => dead })).toBe(3);
    expect(c.err.join('')).toContain('nothing answered');
    expect(c.out.join('')).toBe('');
  });

  it('--json prints the results and the summary, and --only is passed on', async () => {
    const c = capture();
    const f = factory();
    expect(await main(['--allow-network', '--only', 'www', '--json'], { ...c.io, clientFactory: f.clientFactory })).toBe(0);
    const parsed = JSON.parse(c.out.join(''));
    expect(parsed.phase).toBe('A');
    expect(parsed.results.map((r: { id: string }) => r.id)).toEqual(['T-03', 'TA-04']);
    expect(parsed.summary).toEqual({ pass: 2, fail: 0, warn: 0, info: 0 });
    expect(parsed.requests).toBe(1);
  });

  it('a host refusal inside a run stops it with exit 2', async () => {
    const c = capture();
    const client = { get: async () => { throw new RefusedHost('x'); }, stats: { requests: 0, errors: 0 } };
    expect(await main(['--allow-network'], { ...c.io, clientFactory: () => client })).toBe(2);
  });

  it('as a program: no flags is a refusal with exit 2 and nothing on standard output; --plan works; --help works', async () => {
    const exec = promisify(execFile);
    const script = path.join(repoRoot, 'cf/scripts/check-production-site.mjs');
    const fails = async (args: string[]) => {
      try {
        await exec(process.execPath, [script, ...args], { env: { PATH: process.env.PATH ?? '' } });
      } catch (error) {
        return error as { code: number; stdout: string; stderr: string };
      }
      throw new Error('expected a failure');
    };
    const none = await fails([]);
    expect(none.code).toBe(2);
    expect(none.stdout).toBe('');
    expect(none.stderr).toContain('--allow-network');
    const host = await fails(['--base', 'https://example.com']);
    expect(host.code).toBe(2);
    expect(host.stderr).toContain('no option to name a host');
    const plan = await exec(process.execPath, [script, '--plan'], { env: { PATH: process.env.PATH ?? '' } });
    expect(plan.stdout).toContain('GET https://files.sakolakembara.org/');
    const help = await exec(process.execPath, [script, '--help'], { env: { PATH: process.env.PATH ?? '' } });
    expect(help.stdout).toContain('There is no option to name a host');
  });
});

describe('it never writes anything, and never asks for more than it says', () => {
  const source = readFileSync(path.join(repoRoot, 'cf/scripts/check-production-site.mjs'), 'utf8').replace(/^\s*\/\/.*$/gm, '');

  it('imports nothing that can write or start a process: only node:path and node:url', () => {
    expect([...source.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]).sort()).toEqual(['node:path', 'node:url']);
    expect(source).not.toMatch(/node:fs|writeFile|appendFile|createWriteStream|child_process|\bspawn|execSync|execFile|node:net|node:http|XMLHttpRequest|WebSocket/);
  });

  it('has one method, GET, and no header that carries a cookie, a credential or a token', () => {
    expect([...source.matchAll(/method:\s*'([A-Z]+)'/g)].map((m) => m[1])).toEqual(['GET']);
    expect(source).not.toMatch(/method:\s*'(?!GET')/);
    expect(source).not.toMatch(/['"](cookie|authorization|x-api-key|cf-access[\w-]*)['"]\s*:/i);
    expect(source).not.toMatch(/process\.env|readFileSync|CLOUDFLARE_|api[_-]?token/i);
    expect(source.match(/\bfetchImpl\(/g)?.length).toBe(1);
    expect(source).toContain("redirect: 'manual'");
    expect(source).toContain("credentials: 'omit'");
  });

  it('keeps the four hosts as the only hosts in the file (a URL in the code is one of them)', () => {
    const hosts = new Set([...source.matchAll(/(?:https?:\/\/)([a-z0-9.-]+)/gi)].map((m) => m[1]!.toLowerCase()));
    for (const host of hosts) expect(['sakolakembara.org', 'www.sakolakembara.org', 'admin.sakolakembara.org', 'files.sakolakembara.org', 'schema.org'].includes(host) || host.endsWith('.sakolakembara.org') || host === 'sakolakembara.org', host).toBe(true);
  });
});
