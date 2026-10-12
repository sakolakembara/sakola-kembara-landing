import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_PATHS,
  NOT_YET_PORTED,
  isLegacyPath,
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
import { readRoot, repoRoot } from './helpers';

describe('legacy path list', () => {
  it.each([
    '/login', '/register', '/forgot-password', '/reset-password', '/verify-email',
    '/portal', '/portal/status', '/portal/daftar', '/admin', '/admin/blog/new',
    '/api', '/api/auth/session', '/api/auth/callback/google', '/api/sso/session', '/api/announcements/current',
    '/_next/static/chunks/a.js', '/_next/image',
    '/blog/images/2026/05/a.jpg', '/images/team/a.jpg', '/files/a.pdf', '/reports/2025/a.pdf', '/resources/a.pdf',
  ])('%s is forwarded as legacy', (p) => {
    expect(legacyKind(p)).toBe('legacy');
    expect(isLegacyPath(p)).toBe(true);
  });

  it('every public page is ported: nothing is forwarded as not yet ported', () => {
    expect(NOT_YET_PORTED).toEqual([]);
  });

  it.each(['/', '/blog', '/blog/some-slug', '/blog/imagesx', '/tim', '/program', '/program/prapembinaan', '/program/pembinaan', '/program/pasca-pembinaan', '/donasi', '/kontak', '/laporan', '/gabung-siswa', '/gabung-siswa/docs', '/robots.txt', '/sitemap.xml', '/404', '/portal-x', '/administrator', '/apis', '/login-help', '/images-old', '/_nextx', '/_astro/a.css'])(
    '%s belongs to the Worker',
    (p) => {
      expect(legacyKind(p)).toBeNull();
    },
  );

  it('matching is on a segment boundary and case-sensitive like Next', () => {
    expect(isLegacyPath('/Admin')).toBe(false);
    expect(isLegacyPath('/admin/')).toBe(true);
  });

  it('every entry says why it is there, and is a plain absolute path', () => {
    for (const p of [...LEGACY_PATHS, ...NOT_YET_PORTED]) {
      expect(p.path).toMatch(/^\/[A-Za-z0-9_\-/]+$/);
      expect(p.path.endsWith('/')).toBe(false);
      expect(p.why.length).toBeGreaterThan(10);
    }
  });

  it('the two lists do not overlap', () => {
    const a = new Set(LEGACY_PATHS.map((p) => p.path));
    for (const p of NOT_YET_PORTED) expect(a.has(p.path)).toBe(false);
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

  it.each([...segments].sort())('/%s is Astro-owned or listed', (segment) => {
    const owned = astroOwned.has(segment);
    const listed = isLegacyPath(`/${segment}`);
    expect(owned || listed, `/${segment} would be answered 404 by the Worker`).toBe(true);
    // a listed prefix must not also be Astro's
    if (owned) expect(listed).toBe(false);
  });

  it('every reserved shortlink slug of the legacy app is either a known route/prefix, or just reserved', () => {
    const src = readRoot('lib/shortlinks.ts');
    const block = src.match(/RESERVED_SLUGS = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? '';
    const reserved = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(reserved.length).toBeGreaterThan(20);
    const generated = new Set(['robots', 'sitemap']); // Astro serves them from static files
    const reservedOnly = new Set(['logout', 'auth', 'dashboard', 'favicon', 'static']); // reserved for the future, no route
    for (const slug of reserved) {
      const known = isLegacyPath(`/${slug}`) || astroOwned.has(slug) || generated.has(slug) || reservedOnly.has(slug);
      expect(known, `reserved slug "${slug}" is neither listed nor Astro's`).toBe(true);
    }
  });
});

describe('shortlink candidates (same grammar as validateSlug in the root lib/shortlinks.ts)', () => {
  it.each(['daftar-2026', 'a', 'a1-b2-c3', 'x'.repeat(64)])('%s is a candidate', (s) => {
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
});

describe('forwarding helpers', () => {
  it('legacyTarget: route mode keeps the URL, local mode re-aims path and query at the origin', () => {
    expect(legacyTarget('https://sakolakembara.org/portal/status?x=1')).toBe('https://sakolakembara.org/portal/status?x=1');
    expect(legacyTarget('http://127.0.0.1:8791/portal/status?x=1&y=%20', 'http://127.0.0.1:4390')).toBe(
      'http://127.0.0.1:4390/portal/status?x=1&y=%20',
    );
    expect(legacyTarget('http://127.0.0.1:8791/a', 'http://127.0.0.1:4390/ignored/path')).toBe('http://127.0.0.1:4390/a');
  });

  it('forwardRequestHeaders keeps cookies, authorization and custom headers, drops hop-by-hop', () => {
    const incoming = new Headers({
      cookie: 'a=b; c=d',
      authorization: 'Bearer fake',
      'content-type': 'application/json',
      'next-action': 'abc',
      te: 'trailers',
      'keep-alive': 'timeout=5',
      'proxy-authorization': 'x',
      upgrade: 'websocket',
      'transfer-encoding': 'chunked',
      connection: 'keep-alive, x-drop-me',
      'x-drop-me': '1',
    });
    const out = forwardRequestHeaders(incoming, { requestUrl: 'https://sakolakembara.org/login', local: false });
    expect(out.get('cookie')).toBe('a=b; c=d');
    expect(out.get('authorization')).toBe('Bearer fake');
    expect(out.get('content-type')).toBe('application/json');
    expect(out.get('next-action')).toBe('abc');
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
    const req = 'http://127.0.0.1:8791/portal';
    expect(rewriteLocation('http://127.0.0.1:4390/login?from=%2Fportal', base, req)).toBe('http://127.0.0.1:8791/login?from=%2Fportal');
    expect(rewriteLocation('/login', base, req)).toBe('/login');
    expect(rewriteLocation('https://example.org/x', base, req)).toBe('https://example.org/x');
  });
});
