import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REDIRECTS } from '../redirects.config.mjs';
import { RESERVED_SLUGS } from '../../admin/src/shortlinks/reserved';
import { LEGACY_PATHS, NOT_YET_PORTED, PORTAL_OWNED_PATHS, isShortlinkCandidate } from '~/lib/legacy-paths';
import { REGISTRATION_PATH, REGISTRATION_SLUG } from '~/lib/site';
import { readRoot, webRoot } from './helpers';

// A shortlink is looked for only AFTER everything the site really serves has had its chance (the catch-all route
// runs last), so a slug that a page, a legacy prefix, a redirect rule or a static file already answers would sit in
// the admin list looking fine and never fire. The admin refuses those slugs when a link is created
// (cf/admin/src/shortlinks/reserved.ts); this test derives the names the site really claims, from the site, and
// fails when one is missing from that list: the Cloudflare site's version of the legacy `__tests__/shortlinks.test.ts`.
//
// A name only matters here if it could be a slug (lower case letters, digits, hyphens): `robots.txt` has a dot.

/** The first path segment of a pattern such as `/cerita/[slug]` or `/impact-reports`. */
const firstSegment = (pattern: string) => pattern.split('/').filter(Boolean)[0] ?? '';

/** Top-level pages of this Worker: the files and folders of src/pages, without their extension and without dynamic names. */
function pageNames(): string[] {
  const dir = path.join(webRoot, 'src/pages');
  return readdirSync(dir)
    .filter((entry) => !entry.startsWith('['))
    .map((entry) => entry.replace(/\.(astro|ts|md|mdx)$/, '').replace(/\.(txt|xml)$/, ''))
    .filter((name, index, all) => all.indexOf(name) === index);
}

const claimed = (() => {
  const names = new Map<string, string>();
  const claim = (name: string, why: string) => {
    if (isShortlinkCandidate(name) && !names.has(name)) names.set(name, why);
  };
  for (const name of pageNames()) claim(name, 'a page of src/pages');
  for (const { path: prefix } of [...LEGACY_PATHS, ...NOT_YET_PORTED]) claim(firstSegment(prefix), 'a legacy path (src/lib/legacy-paths.ts)');
  // M4: the signed-in and auth surface is no longer forwarded, but the names stay claimed (PORTAL_OWNED_PATHS).
  // SAKEM-103: the forwarded list is WordPress's paths now (wp-admin, wp-content, wp-includes, wp-json, /login) and they are claimed the same way.
  for (const { path: prefix } of PORTAL_OWNED_PATHS) claim(firstSegment(prefix), 'a portal-owned path (PORTAL_OWNED_PATHS in src/lib/legacy-paths.ts)');
  for (const source of Object.keys(REDIRECTS)) claim(firstSegment(source), 'a redirect source (redirects.config.mjs)');
  // The 404 page has a URL of its own.
  claim('404', 'the 404 page');
  return names;
})();

describe('the names the site claims are reserved', () => {
  it('finds a real set of them (the derivation itself works)', () => {
    for (const expected of ['blog', 'tim', 'donasi', 'laporan', 'kontak', 'gabung-siswa', 'program', 'login', 'portal', 'api', 'cerita', 'tentang-kami']) {
      expect(claimed.has(expected), expected).toBe(true);
    }
    expect(claimed.size).toBeGreaterThan(25);
  });

  it('SAKEM-103: the WordPress paths that are forwarded to the origin are claimed (and so reserved): wp-admin, wp-content, wp-includes, wp-json, and /login', () => {
    for (const name of ['wp-admin', 'wp-content', 'wp-includes', 'wp-json', 'login']) {
      expect(claimed.has(name), `${name} is no longer derived as claimed`).toBe(true);
      expect(RESERVED_SLUGS.has(name), `${name} is forwarded to WordPress, so a shortlink with that name would never open`).toBe(true);
    }
    // a file name has a dot, which no slug has: it needs no reservation
    for (const file of ['wp-login.php', 'xmlrpc.php']) expect(isShortlinkCandidate(file), file).toBe(false);
  });

  it('SAKEM-103: `daftar` is the registration shortlink, so NOTHING claims it and the admin does not reserve it', () => {
    expect(claimed.has('daftar'), 'a page, a legacy path or a redirect source takes /daftar again: the registration link would never open').toBe(false);
    expect(RESERVED_SLUGS.has('daftar'), 'the admin refuses the slug the registration link needs').toBe(false);
    expect(REGISTRATION_SLUG).toBe('daftar');
    expect(REGISTRATION_PATH).toBe(`/${REGISTRATION_SLUG}`);
    expect(isShortlinkCandidate(REGISTRATION_SLUG)).toBe(true);
  });

  it('SAKEM-107: `apply` is free for a custom shortlink, so NOTHING claims it and the admin does not reserve it', () => {
    expect(claimed.has('apply'), 'a page, a legacy path or a redirect source takes /apply again: a shortlink called apply would never open').toBe(false);
    expect(RESERVED_SLUGS.has('apply'), 'the admin refuses the slug of the custom link').toBe(false);
    expect(isShortlinkCandidate('apply')).toBe(true);
  });

  it('the portal-owned names stay reserved after they left the legacy list: portal, login, register, forgot-password, reset-password, verify-email, admin, api', () => {
    for (const name of ['portal', 'login', 'register', 'forgot-password', 'reset-password', 'verify-email', 'admin', 'api']) {
      expect(claimed.has(name), `${name} is no longer derived as claimed`).toBe(true);
      expect(RESERVED_SLUGS.has(name), `${name} is no longer reserved: a shortlink with that name would sit in the admin list and never fire`).toBe(true);
    }
  });

  it('they are claimed through PORTAL_OWNED_PATHS (and the redirect table for the auth pages), not through the forwarded list', () => {
    const forwarded = new Set([...LEGACY_PATHS, ...NOT_YET_PORTED].map((p) => firstSegment(p.path)));
    for (const name of ['portal', 'admin', 'api']) expect(forwarded.has(name), name).toBe(false);
    for (const { path: prefix } of PORTAL_OWNED_PATHS) expect(RESERVED_SLUGS.has(firstSegment(prefix)), prefix).toBe(true);
  });

  it.each([...claimed].sort())('%s', (name) => {
    expect(RESERVED_SLUGS.has(name), `"${name}" is ${claimed.get(name)}, so a shortlink called that would never open: add it to cf/admin/src/shortlinks/reserved.ts`).toBe(true);
  });
});

describe('the legacy list is still all there', () => {
  it("every slug of the legacy app's RESERVED_SLUGS (lib/shortlinks.ts) is reserved here too", () => {
    const src = readRoot('lib/shortlinks.ts');
    const block = src.match(/RESERVED_SLUGS = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? '';
    const legacy = [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
    expect(legacy.length).toBeGreaterThan(20);
    for (const slug of legacy) expect(RESERVED_SLUGS.has(slug), slug).toBe(true);
  });

  it('the files at the root of the assets (favicon, icon, og-default) cannot be slugs (they have an extension), and the legacy list reserves favicon anyway', () => {
    expect(existsSync(path.join(webRoot, 'public/_headers'))).toBe(true);
    expect(isShortlinkCandidate('favicon.ico')).toBe(false);
    expect(RESERVED_SLUGS.has('favicon')).toBe(true);
  });
});
