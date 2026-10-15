import { describe, expect, it } from 'vitest';
import { adminOrigin, adminRedirectTarget } from '~/lib/admin-redirect';
import { REGISTRATION_PATH, REGISTRATION_SLUG } from '~/lib/site';
import { readWeb } from './helpers';

// The student portal is a Worker of its own at the path /portal of this host (M4, SAKEM-083) and is NOT live in Phase A of the cutover
// (SAKEM-103: the navbar offers "Daftar Sekarang" and carries no session call until PORTAL_ENABLED says otherwise); this Worker no longer
// forwards the signed-in surface. What is left on this side: the navbar's links and its session call, the 308 of the
// old admin paths to the admin host, and the 404 of /api. The served behaviour is checked end to end in
// scripts/e2e.mjs (groups `portal-paths` and `redirects`).

describe('the navbar button follows the portal switch (SAKEM-103, Phase A)', () => {
  const navbar = readWeb('src/components/Navbar.astro');
  const session = readWeb('src/components/NavbarSession.astro');

  it('"Masuk" goes to /portal/login, in the desktop bar and in the mobile menu, and only in the branch of a portal that is on', () => {
    expect(navbar.match(/<a href="\/portal\/login" data-auth-link/g)).toHaveLength(2);
    expect(navbar.match(/portalOn \? \(\s*<a href="\/portal\/login" data-auth-link/g)).toHaveLength(2);
    expect(navbar).not.toMatch(/href="\/login"/);
  });

  it('while the portal is off the same two slots hold "Daftar Sekarang", a link to the registration shortlink', () => {
    expect(navbar.match(/<a href=\{REGISTRATION_PATH\} class=\{buttonClasses\(\{ variant: 'neutral', size: '(sm|md)' \}\)\}>Daftar Sekarang<\/a>/g)).toHaveLength(2);
    // the same variant and sizes as the "Masuk" button it stands in for (DESIGN.md: neutral, 40px on desktop, 44px in the menu)
    expect(navbar).toContain("variant: 'neutral', size: 'sm'");
    expect(navbar).toContain("variant: 'neutral', size: 'md'");
  });

  it('the portal switch is read the way the beacon is: the page\'s own kind decides which source, no fallback', () => {
    expect(navbar).toContain("portalEnabled({ prerendered: Astro.isPrerendered, build: BUILD_PORTAL_ENABLED, runtime: env.PORTAL_ENABLED })");
    expect(navbar).toContain("import { BUILD_PORTAL_ENABLED, portalEnabled } from '~/lib/portal-enabled';");
  });

  it('the session is asked of the portal Worker (Better Auth get-session), not of an /api the apex does not have, by NavbarSession alone', () => {
    expect(session).toContain("'/portal/api/auth/get-session'");
    expect(session).not.toContain("'/api/auth/session'");
    // the navbar's own script has no auth code left: not the address, not the roles, not the word the button turns into
    expect(navbar).not.toContain('get-session');
    expect(navbar).not.toContain('ADMIN_ROLES');
    expect(navbar).not.toContain("'Dashboard'");
    expect(navbar).not.toContain("querySelectorAll<HTMLAnchorElement>('[data-auth-link]')");
    expect(navbar).not.toContain('sk:session');
  });

  it('NavbarSession is rendered ONLY when the portal is on, right after the navbar script (no whitespace of its own, so a page without it is byte for byte as before)', () => {
    expect(navbar).toContain('</script>{portalOn && <NavbarSession />}');
    expect(navbar.match(/<NavbarSession\b/g)).toHaveLength(1);
    expect(navbar).toContain("import NavbarSession from './NavbarSession.astro';");
    // nothing else of the site includes it
    for (const file of ['src/layouts/Base.astro', 'src/components/Footer.astro', 'src/pages/index.astro']) expect(readWeb(file), file).not.toContain('NavbarSession');
  });

  it('a signed-in student goes to /portal, an admin to /admin (which this Worker sends on to the admin host)', () => {
    expect(session).toContain("a.href = admin ? '/admin' : '/portal';");
    expect(session).toContain("const ADMIN_ROLES = ['viewer', 'editor', 'super_admin'];");
  });
});

describe('the "Daftar Sekarang" buttons all go to the registration shortlink', () => {
  it('/gabung-siswa (the two white buttons), its documents page (the "formulir pendaftaran" link), the home page\'s student card and the navbar use REGISTRATION_PATH, and none names /portal/daftar', () => {
    const page = readWeb('src/pages/gabung-siswa.astro');
    expect(page.match(/<Button href=\{REGISTRATION_PATH\} variant="white-on-navy" size="lg">/g)).toHaveLength(2);
    expect(page).not.toContain('href="/portal/daftar"');
    const docs = readWeb('src/pages/gabung-siswa/docs.astro');
    expect(docs).toContain('<a href={REGISTRATION_PATH} class="underline font-semibold hover:text-white">formulir pendaftaran</a>');
    expect(docs).not.toContain('/portal/daftar');
    expect(readWeb('src/components/sections/CTASection.astro')).toContain('href: REGISTRATION_PATH,');
    expect(readWeb('src/components/sections/CTASection.astro')).not.toContain("href: '/gabung-siswa'");
  });

  it('REGISTRATION_PATH is /daftar, a shortlink name: the address of the form is in no file of this repository', () => {
    expect(REGISTRATION_PATH).toBe('/daftar');
    expect(REGISTRATION_SLUG).toBe('daftar');
    for (const file of ['src/lib/site.ts', 'src/pages/[...path].astro', 'src/components/RegistrationUnavailablePage.astro']) {
      expect(readWeb(file), file).not.toMatch(/s\.id|forms\.gle|docs\.google\.com|bit\.ly/);
    }
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
