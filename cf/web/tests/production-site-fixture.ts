// A stand-in for the four hosts of the plan, for tests/production-check.test.ts: recorded, invented responses.
//
// The SHAPES come from the built Worker answering on loopback on 2026-10-15 (the headers `_headers` and the middleware add, the
// 308 and 307 answers, `x-blog-source`, the 404 page with its noindex, the JSON 404 of /api, the sitemap with 96 URLs, the
// immutable assets), with two differences made on purpose: the hostnames are the plan's, and HSTS is the Phase A value
// (`max-age=300`), which the code does not send yet. The answers of WordPress, the admin and the files host are invented in
// the same style (WordPress's login form and its 302, the admin's `/api/config` and 401, R2's 404). Nothing here is a real
// key, address or answer of the live site.

export interface Recorded {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}
export type Entry = Recorded | ((nth: number) => Recorded);

export const SLUG = 'sakola-kembara-hadirkan-kelas-belajar-tentang-literasi-keuangan-dan-keadilan-ekonomi';
export const FILE_URL = 'https://files.sakolakembara.org/uploads/blog/2026/10/cover-1a2b3c.webp';
export const FORM_URL = 'https://registrasi.example.test/pendaftaran';

export const SECURITY: Record<string, string> = {
  'strict-transport-security': 'max-age=300',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  server: 'cloudflare',
  'cf-ray': '8f00000000000000-CGK',
};
const html = { 'content-type': 'text/html; charset=utf-8' };

const page = (extra = '', head = '') =>
  `<!doctype html><html lang="id-ID" class="scroll-smooth"><head><meta charset="utf-8">${head}</head><body><main>${extra}</main></body></html>`;

const homeBody = page(
  '<img src="/_img/27f45874d486-480.webp" width="480" height="320" alt="">',
  '<link rel="canonical" href="https://sakolakembara.org/"><link rel="stylesheet" href="/_astro/Base.CYEQ0bMh.css">',
);
const articleBody = page(
  `<img src="/blog/images/2026/08/photo-1.jpeg"><img src="${FILE_URL}"><a href="/blog/other">x</a>`,
  `<link rel="canonical" href="https://sakolakembara.org/blog/${SLUG}"><meta property="og:image" content="https://sakolakembara.org/blog/images/2026/08/photo-1.jpeg"><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BlogPosting","headline":"x"}]}</script>`,
);
const notFoundBody = page('<h1>404</h1>', '<meta name="robots" content="noindex">');
const wordpressLogin =
  '<!DOCTYPE html><html lang="en-US"><head><title>Log In</title></head><body class="login"><form name="loginform" id="loginform" action="https://sakolakembara.org/wp-login.php" method="post"><input type="text" name="log" id="user_login"><input type="password" name="pwd"></form></body></html>';

const sitemap = (): string => {
  const locs = ['https://sakolakembara.org', 'https://sakolakembara.org/blog', 'https://sakolakembara.org/tim', 'https://sakolakembara.org/laporan', 'https://sakolakembara.org/donasi', 'https://sakolakembara.org/gabung-siswa', 'https://sakolakembara.org/kontak', 'https://sakolakembara.org/program/pembinaan', 'https://sakolakembara.org/program/prapembinaan', 'https://sakolakembara.org/program/pasca-pembinaan'];
  locs.push(`https://sakolakembara.org/blog/${SLUG}`, ...Array.from({ length: 85 }, (_, i) => `https://sakolakembara.org/blog/artikel-${i + 1}`));
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((loc) => `<url><loc>${loc}</loc></url>`).join('')}</urlset>`;
};

const json = (value: unknown) => JSON.stringify(value);
const apiNotFound: Recorded = { status: 404, headers: { ...SECURITY, 'content-type': 'application/json', 'cache-control': 'no-store' }, body: json({ error: 'not_found' }) };
const redirect = (status: number, location: string, extra: Record<string, string> = {}): Recorded => ({ status, headers: { ...SECURITY, location, ...extra } });
const immutable = 'public, max-age=31536000, immutable';

/** The four hosts as they should answer after the Phase A switch, by exact URL. */
export function healthySite(): Map<string, Entry> {
  const m = new Map<string, Entry>();
  const set = (url: string, entry: Entry) => m.set(new URL(url).href, entry);

  // ---- sakolakembara.org: the new site
  set('https://sakolakembara.org/', { status: 200, headers: { ...SECURITY, ...html, 'cache-control': 'public, max-age=0, must-revalidate', etag: '"3a02"', 'cf-cache-status': 'DYNAMIC' }, body: homeBody });
  set('http://sakolakembara.org/', { status: 301, headers: { location: 'https://sakolakembara.org/', server: 'cloudflare' } });
  set('https://sakolakembara.org/robots.txt', {
    status: 200,
    headers: { ...SECURITY, 'content-type': 'text/plain; charset=utf-8' },
    body: 'User-Agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\nDisallow: /login\nDisallow: /portal\n\nHost: https://sakolakembara.org\nSitemap: https://sakolakembara.org/sitemap.xml\n',
  });
  set('https://sakolakembara.org/sitemap.xml', { status: 200, headers: { ...SECURITY, 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600', 'x-blog-source': 'network', 'x-page-cache': 'miss' }, body: sitemap() });
  set('https://sakolakembara.org/blog', (nth) => ({
    status: 200,
    headers: { ...SECURITY, 'content-type': 'text/html', 'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300', 'x-blog-source': nth === 1 ? 'network' : 'cache', 'x-page-cache': nth === 1 ? 'miss' : 'hit' },
    body: page('<a href="/blog/sakola-kembara-x">x</a>'),
  }));
  set(`https://sakolakembara.org/blog/${SLUG}`, { status: 200, headers: { ...SECURITY, 'content-type': 'text/html', 'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300', 'x-blog-source': 'network' }, body: articleBody });
  set(`https://sakolakembara.org/cerita/${SLUG}/`, redirect(308, `/blog/${SLUG}`));
  set('https://sakolakembara.org/education/', redirect(308, '/blog'));
  set('https://sakolakembara.org/no-such-page-check-1f3a', { status: 404, headers: { ...SECURITY, 'content-type': 'text/html' }, body: notFoundBody });
  set('https://sakolakembara.org/api/public/blog', apiNotFound);
  set('https://sakolakembara.org/api/check-x', apiNotFound);
  set('https://sakolakembara.org/admin/blog?x=1', redirect(308, 'https://admin.sakolakembara.org/blog?x=1'));
  set('https://sakolakembara.org/donasi/', redirect(308, '/donasi'));
  set('https://sakolakembara.org/_astro/Base.CYEQ0bMh.css', (nth) => ({ status: 200, headers: { ...SECURITY, 'content-type': 'text/css; charset=utf-8', 'cache-control': immutable, 'cf-cache-status': nth === 1 ? 'MISS' : 'HIT' }, body: 'body{}' }));
  set('https://sakolakembara.org/_img/27f45874d486-480.webp', (nth) => ({ status: 200, headers: { ...SECURITY, 'content-type': 'image/webp', 'cache-control': immutable, 'cf-cache-status': nth === 1 ? 'MISS' : 'HIT' } }));
  set('https://sakolakembara.org/tim', { status: 200, headers: { ...SECURITY, 'content-type': 'text/html' }, body: page(`<img src="${FILE_URL}">`) });
  // the sign-up shortlink and the two WordPress paths that must still reach WordPress
  set('https://sakolakembara.org/daftar', redirect(307, FORM_URL));
  set('https://sakolakembara.org/wp-login.php', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=UTF-8', server: 'cloudflare', 'x-frame-options': 'SAMEORIGIN', 'cache-control': 'no-cache, must-revalidate, max-age=0', 'cf-ray': '8f00000000000001-CGK' },
    body: wordpressLogin,
  });
  set('https://sakolakembara.org/wp-admin', { status: 302, headers: { server: 'cloudflare', 'x-redirect-by': 'WordPress', location: 'https://sakolakembara.org/wp-login.php?redirect_to=https%3A%2F%2Fsakolakembara.org%2Fwp-admin%2F&reauth=1' } });
  // what the plan leaves to SAKEM-103: only observed
  set('https://sakolakembara.org/login', redirect(308, '/portal/login'));
  set('https://sakolakembara.org/register', redirect(308, '/portal/register'));
  set('https://sakolakembara.org/portal', { status: 404, headers: { ...SECURITY, 'content-type': 'text/html' }, body: notFoundBody });
  set('https://sakolakembara.org/portal/status', { status: 404, headers: { ...SECURITY, 'content-type': 'text/html' }, body: notFoundBody });

  // ---- www
  set('https://www.sakolakembara.org/blog?x=1', { status: 301, headers: { location: 'https://sakolakembara.org/blog?x=1', server: 'cloudflare' } });

  // ---- admin
  const noStore = { 'cache-control': 'no-store', 'content-type': 'application/json', server: 'cloudflare' };
  // The admin app's pages carry no security headers of their own (F-19); a zone rule adds these two, as the runbook says.
  set('https://admin.sakolakembara.org/', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', server: 'cloudflare', 'cache-control': 'public, max-age=0, must-revalidate', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff' }, body: '<!doctype html><html lang="id"><body><div id="root"></div></body></html>' });
  set('https://admin.sakolakembara.org/api/config', { status: 200, headers: noStore, body: json({ google: false, turnstileSiteKey: '0x4AAAAAAAdemoKey123456', uploadsBaseUrl: 'https://files.sakolakembara.org', siteUrl: 'https://sakolakembara.org' }) });
  set('https://admin.sakolakembara.org/api/me', { status: 401, headers: noStore, body: json({ error: 'unauthenticated' }) });
  set('https://admin.sakolakembara.org/api/public/team', { status: 404, headers: noStore, body: json({ error: 'not_found' }) });
  set('https://admin.sakolakembara.org/uploads/check-x', { status: 404, headers: noStore, body: json({ error: 'not_found' }) });
  set('https://admin.sakolakembara.org/api/dev/mailbox', { status: 404, headers: noStore, body: json({ error: 'not_found' }) });

  // ---- files
  const r2 = { server: 'cloudflare', 'content-type': 'text/plain;charset=UTF-8' };
  set('https://files.sakolakembara.org/', { status: 404, headers: r2, body: 'Not found' });
  set('https://files.sakolakembara.org/uploads/check-x-missing.png', { status: 404, headers: r2, body: 'Not found' });
  set(FILE_URL, (nth) => ({ status: 200, headers: { server: 'cloudflare', 'content-type': 'image/webp', 'cache-control': immutable, 'cf-cache-status': nth === 1 ? 'MISS' : 'HIT' } }));
  return m;
}

export interface FakeFetchLog {
  calls: { url: string; method: string; headers: Record<string, string>; redirect?: string; credentials?: string }[];
  unexpected: string[];
}

/** A `fetch` that answers from the map by exact URL, counts how many times each URL was asked, and records every call (and every URL nobody planned). */
export function fakeFetch(site: Map<string, Entry>, log: FakeFetchLog = { calls: [], unexpected: [] }) {
  const counts = new Map<string, number>();
  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input)).href;
    log.calls.push({ url, method: String(init.method), headers: Object.fromEntries(new Headers(init.headers).entries()), redirect: init.redirect, credentials: init.credentials });
    const entry = site.get(url);
    if (!entry) {
      log.unexpected.push(url);
      throw new Error(`unexpected request ${url}`);
    }
    const nth = (counts.get(url) ?? 0) + 1;
    counts.set(url, nth);
    const recorded = typeof entry === 'function' ? entry(nth) : entry;
    const headers = new Headers(recorded.headers ?? {});
    // a Set-Cookie of the invented WordPress answers, as separate headers like a real response
    return new Response(recorded.body ?? null, { status: recorded.status, headers });
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, log, counts };
}
