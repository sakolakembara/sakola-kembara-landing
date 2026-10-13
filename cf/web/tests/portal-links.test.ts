import { describe, expect, it } from 'vitest';
import { adminOrigin, adminRedirectTarget } from '~/lib/admin-redirect';
import { readWeb } from './helpers';

// The student portal is a Worker of its own at the path /portal of this host (M4, SAKEM-083); this Worker no longer
// forwards the signed-in surface. What is left on this side: the navbar's links and its session call, the 308 of the
// old admin paths to the admin host, and the 404 of /api. The served behaviour is checked end to end in
// scripts/e2e.mjs (groups `portal-paths` and `redirects`).

describe('the navbar points at the portal', () => {
  const navbar = readWeb('src/components/Navbar.astro');

  it('"Masuk" goes to /portal/login, in the desktop bar and in the mobile menu', () => {
    expect(navbar.match(/<a href="\/portal\/login" data-auth-link/g)).toHaveLength(2);
    expect(navbar).not.toMatch(/href="\/login"/);
  });

  it('the session is asked of the portal Worker (Better Auth get-session), not of an /api the apex does not have', () => {
    expect(navbar).toContain("'/portal/api/auth/get-session'");
    expect(navbar).not.toContain("'/api/auth/session'");
  });

  it('a signed-in student goes to /portal, an admin to /admin (which this Worker sends on to the admin host)', () => {
    expect(navbar).toContain("a.href = admin ? '/admin' : '/portal';");
    expect(navbar).toContain("const ADMIN_ROLES = ['viewer', 'editor', 'super_admin'];");
  });
});

describe('the "Daftar Sekarang" buttons', () => {
  it('go to /portal/daftar (the wizard of the student portal)', () => {
    const page = readWeb('src/pages/gabung-siswa.astro');
    expect(page.match(/href="\/portal\/daftar"/g)).toHaveLength(2);
    expect(readWeb('src/pages/gabung-siswa/docs.astro')).toContain('href="/portal/daftar"');
  });
});

describe('adminOrigin: only an http(s) origin is a place to send someone', () => {
  it.each([
    ['https://admin.example.org', 'https://admin.example.org'],
    ['https://admin.example.org/', 'https://admin.example.org'],
    ['  http://localhost:5173/some/path?x=1 ', 'http://localhost:5173'],
  ])('%j is %j', (value, origin) => {
    expect(adminOrigin(value)).toBe(origin);
  });

  it.each([undefined, null, '', '   ', 'admin.example.org', '//admin.example.org', 'javascript:alert(1)', 'ftp://admin.example.org', 'data:text/html,x'])('%j is nothing', (value) => {
    expect(adminOrigin(value as string | undefined)).toBeNull();
  });
});

describe('adminRedirectTarget: /admin keeps what comes after it, and the query, on the admin host', () => {
  const admin = 'https://admin.example.org';

  it.each([
    ['/admin', '', `${admin}/`],
    ['/admin/', '', `${admin}/`],
    ['/admin/blog', '', `${admin}/blog`],
    ['/admin/blog/new', '?x=1&y=%20z', `${admin}/blog/new?x=1&y=%20z`],
    ['/admin/applications', '?status=pending', `${admin}/applications?status=pending`],
  ])('%s%s', (pathname, search, expected) => {
    expect(adminRedirectTarget(admin, pathname, search)).toBe(expected);
  });

  it('a path that tries to leave the host stays on it (// after the prefix is not a new host)', () => {
    expect(adminRedirectTarget(admin, '/admin//evil.example', '')).toBe(`${admin}/evil.example`);
    expect(adminRedirectTarget(admin, '/admin///evil.example/x', '')).toBe(`${admin}/evil.example/x`);
    expect(new URL(adminRedirectTarget(admin, '/admin/\\evil.example', '')!).host).toBe('admin.example.org');
    expect(new URL(adminRedirectTarget(admin, '/admin//evil.example', '')!).host).toBe('admin.example.org');
  });

  it('with no admin host configured there is no redirect (the path is the 404)', () => {
    expect(adminRedirectTarget(undefined, '/admin/blog', '')).toBeNull();
    expect(adminRedirectTarget('', '/admin', '')).toBeNull();
    expect(adminRedirectTarget('not a url', '/admin', '')).toBeNull();
    expect(adminRedirectTarget('javascript:alert(1)', '/admin', '')).toBeNull();
  });
});
