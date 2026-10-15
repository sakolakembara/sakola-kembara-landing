import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REDIRECTS, matchRedirect } from '../redirects.config.mjs';
import {
  LEGACY_PATHS,
  NOT_YET_PORTED,
  PORTAL_OWNED_PATHS,
  isAdminPath,
  isApiPath,
  isLegacyPath,
  isPortalOwnedPath,
  isShortlinkCandidate,
  legacyKind,
} from '~/lib/legacy-paths';
import {
  HOP_BY_HOP_HEADERS,
  forwardRequestHeaders,
  legacyTarget,
  rewriteLocation,
  stripHopByHop,
} from '~/lib/legacy-proxy';
import { PROGRAM_IDS, STATIC_ROUTES } from '~/lib/sitemap';
import { readRoot, readWeb, repoRoot, webRoot } from './helpers';

// SAKEM-103, Phase A of the cutover: the origin behind the Worker's route is the live WordPress site, so the forwarded list is
// WordPress's own paths, and ONLY those. The served behaviour (a request reaching a stand-in origin, a look-alike that does not) is
// checked end to end in scripts/e2e.mjs, group `pass-through`.

/** What the list must hold, in order, and how each entry matches. */
const WORDPRESS = [
  ['/wp-admin', 'prefix'],
  ['/wp-login.php', 'exact'],
  ['/wp-content', 'prefix'],
  ['/wp-includes', 'prefix'],
  ['/wp-json', 'prefix'],
  ['/xmlrpc.php', 'exact'],
  ['/login', 'exact'],
] as const;

describe('the pass-through list: WordPress\'s own paths', () => {
  it('is exactly the seven the ticket names, with their matching rule', () => {
    expect(LEGACY_PATHS.map((p) => [p.path, p.match ?? 'prefix'])).toEqual(WORDPRESS.map((w) => [...w]));
  });

  it.each([
    '/wp-admin', '/wp-admin/', '/wp-admin/post.php', '/wp-admin/admin-ajax.php', '/wp-admin/network/site-new.php',
    '/wp-login.php', '/wp-login.php/',
    '/wp-content', '/wp-content/', '/wp-content/themes/astra/style.css', '/wp-content/plugins/elementor/a.js', '/wp-content/uploads/2099/01/not-copied.jpg',
    '/wp-includes', '/wp-includes/js/jquery/jquery.min.js',
    '/wp-json', '/wp-json/', '/wp-json/wp/v2/posts',
    '/xmlrpc.php', '/xmlrpc.php/',
    '/login', '/login/',
  ])('%s is forwarded to the origin', (p) => {
    expect(legacyKind(p)).toBe('legacy');
    expect(isLegacyPath(p)).toBe(true);
    expect(isPortalOwnedPath(p)).toBe(false);
  });

  // The look-alikes: a name that starts like a WordPress path, has other case, other punctuation, an extension, or something below a
  // name that matches only itself. None of them is WordPress's; each is the Worker's (a 404 page, or a shortlink lookup).
  it.each([
    '/wp-adminx', '/wp-admin-x', '/wp-admin.php', '/wp-admins/x', '/wp-adm', '/wp',
    '/wp-login', '/wp-login.phpx', '/wp-login.php.bak', '/wp-login.php/x', '/wp-login.php5',
    '/wp-contentx', '/wp-content-x/a.css', '/wp-contents/a.css',
    '/wp-includesx', '/wp-include/a.js',
    '/wp-jsonx', '/wp-json-x', '/wp_json',
    '/xmlrpc', '/xmlrpc.phpx', '/xmlrpc.php/x', '/xmlrpc.php.old',
    '/login/x', '/login/extra/path', '/login-help', '/loginx', '/log-in', '/Login', '/LOGIN',
    '/WP-ADMIN', '/Wp-Admin/x', '/WP-LOGIN.PHP', '/WP-CONTENT/a.css', '/XMLRPC.PHP',
    '//wp-admin', '//wp-admin/', '/blog/wp-admin', '/blog/wp-content/a.jpg', '/portal/login', '/x/login',
  ])('%s is NOT forwarded: it is not WordPress\'s', (p) => {
    expect(legacyKind(p), p).toBeNull();
    expect(isLegacyPath(p), p).toBe(false);
  });

  it('an `exact` entry matches only itself, with or without ONE trailing slash; a prefix entry matches itself and what is below it on a segment boundary', () => {
    expect(isLegacyPath('/login')).toBe(true);
    expect(isLegacyPath('/login/')).toBe(true);
    expect(isLegacyPath('/login//')).toBe(false);
    expect(isLegacyPath('/xmlrpc.php//')).toBe(false);
    expect(isLegacyPath('/wp-admin//x')).toBe(true); // below the prefix, WordPress decides what the extra slash means
    expect(isLegacyPath('/wp-adminx/')).toBe(false);
  });

  // F-10 of the cutover runbook: the old Next app's static prefixes are gone with the VPS. Team photos, reports and resources come from
  // R2 (UPLOADS_BASE_URL), the repo's images and PDFs are static assets, and what is left has no origin that serves it.
  it.each(['/_next/static/chunks/a.js', '/_next/image', '/blog/images/2026/05/a.jpg', '/images/team/a.jpg', '/files/a.pdf', '/reports/2025/a.pdf', '/resources/a.pdf'])(
    '%s is no longer forwarded (the legacy Next app is not the origin)',
    (p) => {
      expect(isLegacyPath(p), p).toBe(false);
    },
  );

  it('nothing the new site serves is on the list: its pages, its program pages, the files it generates, every redirect source, the portal-owned names and the shortlinks the tests use', () => {
    const pages = readdirSync(`${webRoot}src/pages`)
      .filter((entry) => !entry.startsWith('['))
      .map((entry) => `/${entry.replace(/\.(astro|ts)$/, '')}`);
    const redirectSamples = Object.keys(REDIRECTS).map((pattern) => pattern.replace(/\[\.\.\.(\w+)\]/g, 'a/b').replace(/\[(\w+)\]/g, 'x'));
    const served = [
      '/', '/404', '/robots.txt', '/sitemap.xml', '/blog', '/blog/some-article', '/blog/page/2', '/gabung-siswa/docs', '/gabung-siswa/form',
      ...STATIC_ROUTES.map((r) => r.path),
      ...PROGRAM_IDS.map((id) => `/program/${id}`),
      ...pages,
      ...redirectSamples,
      ...PORTAL_OWNED_PATHS.map((p) => p.path),
      '/daftar', '/daftar/', '/daftar-2026', '/gabung', '/unduh-panduan', '/no-such-link', '/admin/blog', '/api/anything',
      '/portal/status', '/portal/daftar', '/portal/api/auth/get-session',
    ];
    expect(served.length).toBeGreaterThan(40);
    for (const p of served) expect(isLegacyPath(p), `${p} would reach the origin`).toBe(false);
  });

  it('no redirect rule of the table has a source on the list, and no entry of the list is a redirect source (a rule would answer first and WordPress would never see the path)', () => {
    for (const entry of LEGACY_PATHS) {
      const sample = entry.match === 'exact' ? entry.path : `${entry.path}/x`;
      expect(matchRedirect(sample), sample).toBeNull();
    }
    for (const pattern of Object.keys(REDIRECTS)) {
      const sample = pattern.replace(/\[\.\.\.(\w+)\]/g, 'a/b').replace(/\[(\w+)\]/g, 'x');
      expect(isLegacyPath(sample), `${pattern} is a redirect AND forwarded`).toBe(false);
    }
  });

  it('every entry says why it is there, is a plain absolute path with no trailing slash, and names only WordPress things', () => {
    for (const p of LEGACY_PATHS) {
      expect(p.path).toMatch(/^\/[A-Za-z0-9_\-./]+$/);
      expect(p.path.endsWith('/')).toBe(false);
      expect(p.why.length).toBeGreaterThan(30);
      expect(['prefix', 'exact', undefined]).toContain(p.match);
      // a file or the one redirect-to-login name matches only itself; a folder is a prefix
      if (p.path.endsWith('.php') || p.path === '/login') expect(p.match, p.path).toBe('exact');
      else expect(p.match ?? 'prefix', p.path).toBe('prefix');
    }
  });

  it('matching is case-sensitive and on a segment boundary', () => {
    expect(isLegacyPath('/Wp-admin')).toBe(false);
    expect(isLegacyPath('/wp-admin/')).toBe(true);
    expect(isLegacyPath('/wp-adminx')).toBe(false);
  });

  it('every public page is ported: nothing is forwarded as not yet ported', () => {
    expect(NOT_YET_PORTED).toEqual([]);
  });

  it('the two lists do not overlap', () => {
    const a = new Set(LEGACY_PATHS.map((p) => p.path));
    for (const p of NOT_YET_PORTED) expect(a.has(p.path)).toBe(false);
  });
});

describe('the middleware forwards exactly what the list says, and nothing else', () => {
  const middleware = readWeb('src/middleware.ts');
  const at = (needle: string) => {
    const index = middleware.indexOf(needle);
    expect(index, needle).toBeGreaterThan(0);
    return index;
  };

  it('the order: the redirect table, then the admin and the API, then the origin\'s paths, then the slash fold, then Astro', () => {
    const order = [
      'const hit = matchRedirect(pathname, search);',
      'if (isAdminPath(pathname)) {',
      'return apiNotFound();',
      'if (isLegacyPath(pathname)) {',
      'const canonical = canonicalPath(pathname);',
      'const response = withSecurityHeaders(await next());',
    ].map(at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('only isLegacyPath decides, the request goes out untouched (forwardToLegacy, the origin variable), and nothing else in src/ forwards', () => {
    expect(middleware).toContain('if (isLegacyPath(pathname)) {\n    return forwardToLegacy(context.request, env.LEGACY_ORIGIN_URL);\n  }');
    expect(middleware.match(/forwardToLegacy\(/g)).toHaveLength(1);
    for (const file of ['src/pages/[...path].astro', 'src/pages/404.astro', 'src/pages/gabung-siswa.astro', 'src/lib/shortlink.ts']) expect(readWeb(file), file).not.toContain('forwardToLegacy');
  });

  it('the pass-through responses are the origin\'s: the Worker adds no security header to them (a WordPress screen that frames itself keeps working), unlike every answer of its own', () => {
    expect(middleware).toContain('return forwardToLegacy(context.request, env.LEGACY_ORIGIN_URL);');
    expect(middleware).not.toMatch(/withSecurityHeaders\(\s*(await\s+)?forwardToLegacy/);
  });
});

describe('the portal-owned names (Phase A: the student portal is not live)', () => {
  it('are exactly seven: the portal, its four auth pages, the admin and the API (/login is WordPress\'s now)', () => {
    expect(PORTAL_OWNED_PATHS.map((p) => p.path).sort()).toEqual(['/admin', '/api', '/forgot-password', '/portal', '/register', '/reset-password', '/verify-email'].sort());
    expect(isPortalOwnedPath('/login')).toBe(false);
    expect(legacyKind('/login')).toBe('legacy');
  });

  it.each([
    '/register', '/forgot-password', '/reset-password', '/verify-email', '/portal', '/portal/status', '/portal/daftar', '/portal/api/auth/get-session',
    '/admin', '/admin/blog/new', '/api', '/api/auth/session', '/api/auth/callback/google', '/api/sso/session', '/api/announcements/current',
  ])('%s is NOT forwarded to the origin, and is portal-owned', (p) => {
    expect(legacyKind(p)).toBeNull();
    expect(isLegacyPath(p)).toBe(false);
    expect(isPortalOwnedPath(p)).toBe(true);
  });

  it('they are matched on a segment boundary, case-sensitively, like the rest', () => {
    for (const p of ['/portal-x', '/portalx', '/administrator', '/apis', '/registered', '/register-now', '/Portal', '/API']) expect(isPortalOwnedPath(p), p).toBe(false);
    expect(isPortalOwnedPath('/admin/')).toBe(true);
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/admin/blog')).toBe(true);
    expect(isAdminPath('/administrator')).toBe(false);
    expect(isApiPath('/api')).toBe(true);
    expect(isApiPath('/api/x')).toBe(true);
    expect(isApiPath('/apis')).toBe(false);
    expect(isApiPath('/portal/api/me')).toBe(false); // that is the portal Worker's, not the apex's
  });

  it('every entry says why it is there, and is a plain absolute path', () => {
    for (const p of PORTAL_OWNED_PATHS) {
      expect(p.path).toMatch(/^\/[A-Za-z0-9_\-/]+$/);
      expect(p.path.endsWith('/')).toBe(false);
      expect(p.why.length).toBeGreaterThan(10);
    }
  });

  it('a name is either forwarded or portal-owned, never both', () => {
    const forwarded = new Set([...LEGACY_PATHS, ...NOT_YET_PORTED].map((p) => p.path));
    for (const p of PORTAL_OWNED_PATHS) expect(forwarded.has(p.path), p.path).toBe(false);
  });
});

describe('the legacy app has no top-level route this Worker does not know about', () => {
  // Top-level segments the legacy app serves, read from its app/ folders (route groups unwrapped).
  const groups = ['(public)', '(auth)', '(portal)', '(admin)'];
  const segments = new Set<string>();
  for (const g of groups) {
    for (const entry of readdirSync(`${repoRoot}app/${g}`, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('[') && !entry.name.startsWith('_')) segments.add(entry.name);
    }
  }
  segments.add('api');

  // Pages the Worker serves itself.
  const astroOwned = new Set(['blog', 'tim', 'program', 'donasi', 'laporan', 'gabung-siswa', 'kontak']);

  it.each([...segments].sort())('/%s is Astro-owned, forwarded or portal-owned', (segment) => {
    const owned = astroOwned.has(segment);
    const listed = isLegacyPath(`/${segment}`);
    const portal = isPortalOwnedPath(`/${segment}`);
    expect(owned || listed || portal, `/${segment} would be answered 404 by the Worker without anyone having decided it`).toBe(true);
    // a listed prefix must not also be Astro's, nor portal-owned
    if (owned) expect(listed || portal).toBe(false);
    if (listed) expect(portal).toBe(false);
  });

  it('every reserved shortlink slug of the legacy app is either a known route/prefix, or just reserved', () => {
    const src = readRoot('lib/shortlinks.ts');
    const block = src.match(/RESERVED_SLUGS = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? '';
    const reserved = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(reserved.length).toBeGreaterThan(20);
    const generated = new Set(['robots', 'sitemap']); // Astro serves them from static files
    const reservedOnly = new Set(['logout', 'auth', 'dashboard', 'favicon', 'static']); // reserved for the future, no route
    // The legacy Next app's static prefixes: forwarded to it until SAKEM-103 (Phase A), and no route of this Worker since. The names stay reserved
    // (a shortlink called `images` would be harmless today, but the admin keeps refusing what the legacy list refused).
    const nextStatic = new Set(['_next', 'images', 'files', 'reports', 'resources']);
    for (const slug of reserved) {
      const known =
        isLegacyPath(`/${slug}`) || isPortalOwnedPath(`/${slug}`) || astroOwned.has(slug) || generated.has(slug) || reservedOnly.has(slug) || nextStatic.has(slug);
      expect(known, `reserved slug "${slug}" is neither listed, portal-owned nor Astro's`).toBe(true);
    }
  });
});

describe('shortlink candidates (same grammar as validateSlug in the root lib/shortlinks.ts)', () => {
  it.each(['daftar-2026', 'daftar', 'a', 'a1-b2-c3', 'x'.repeat(64)])('%s is a candidate', (s) => {
    expect(isShortlinkCandidate(s)).toBe(true);
  });
  it.each(['', 'A', 'a_b', 'a--b', '-a', 'a-', 'has.dot', 'a b', 'x'.repeat(65), 'é'])('%j is not', (s) => {
    expect(isShortlinkCandidate(s)).toBe(false);
  });
  it('matches the root regex and limit', () => {
    const src = readRoot('lib/shortlinks.ts');
    expect(src).toContain('const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;');
    expect(src).toContain('SLUG_MAX_LENGTH = 64');
  });
  it('/daftar is a slug candidate and no list claims it: it is the registration shortlink (SAKEM-103)', () => {
    expect(isShortlinkCandidate('daftar')).toBe(true);
    expect(isLegacyPath('/daftar')).toBe(false);
    expect(isPortalOwnedPath('/daftar')).toBe(false);
    expect(REDIRECTS['/daftar']).toBeUndefined();
    expect(readWeb('src/pages/[...path].astro')).toContain('REGISTRATION_SLUG');
  });
});

describe('forwarding helpers', () => {
  it('legacyTarget: route mode keeps the URL, local mode re-aims path and query at the origin', () => {
    expect(legacyTarget('https://sakolakembara.org/wp-admin/post.php?x=1')).toBe('https://sakolakembara.org/wp-admin/post.php?x=1');
    expect(legacyTarget('http://127.0.0.1:8791/wp-admin/post.php?x=1&y=%20', 'http://127.0.0.1:4390')).toBe(
      'http://127.0.0.1:4390/wp-admin/post.php?x=1&y=%20',
    );
    expect(legacyTarget('http://127.0.0.1:8791/a', 'http://127.0.0.1:4390/ignored/path')).toBe('http://127.0.0.1:4390/a');
  });

  it('forwardRequestHeaders keeps cookies, authorization and custom headers, drops hop-by-hop', () => {
    const incoming = new Headers({
      cookie: 'a=b; c=d',
      authorization: 'Bearer fake',
      'content-type': 'application/json',
      'x-wp-nonce': 'abc',
      te: 'trailers',
      'keep-alive': 'timeout=5',
      'proxy-authorization': 'x',
      upgrade: 'websocket',
      'transfer-encoding': 'chunked',
      connection: 'keep-alive, x-drop-me',
      'x-drop-me': '1',
    });
    const out = forwardRequestHeaders(incoming, { requestUrl: 'https://sakolakembara.org/wp-login.php', local: false });
    expect(out.get('cookie')).toBe('a=b; c=d');
    expect(out.get('authorization')).toBe('Bearer fake');
    expect(out.get('content-type')).toBe('application/json');
    expect(out.get('x-wp-nonce')).toBe('abc');
    for (const h of [...HOP_BY_HOP_HEADERS, 'x-drop-me']) expect(out.has(h), h).toBe(false);
    expect(out.has('x-forwarded-host')).toBe(false);
  });

  it('local mode adds X-Forwarded-Host/Proto from the original request', () => {
    const out = forwardRequestHeaders(new Headers({ host: 'localhost:4321' }), { requestUrl: 'http://localhost:4321/a', local: true });
    expect(out.get('x-forwarded-host')).toBe('localhost:4321');
    expect(out.get('x-forwarded-proto')).toBe('http');
  });

  it('stripHopByHop also drops headers named by Connection, case-insensitively', () => {
    const h = new Headers({ Connection: 'Close, X-Foo', 'X-Foo': '1', 'X-Bar': '2' });
    stripHopByHop(h);
    expect([...h.keys()]).toEqual(['x-bar']);
  });

  it('rewriteLocation points the origin host back at the host the browser used', () => {
    const base = 'http://127.0.0.1:4390';
    const req = 'http://127.0.0.1:8791/login';
    expect(rewriteLocation('http://127.0.0.1:4390/wp-login.php?redirect_to=%2Fwp-admin%2F', base, req)).toBe('http://127.0.0.1:8791/wp-login.php?redirect_to=%2Fwp-admin%2F');
    expect(rewriteLocation('/wp-login.php', base, req)).toBe('/wp-login.php');
    expect(rewriteLocation('https://example.org/x', base, req)).toBe('https://example.org/x');
  });
});
