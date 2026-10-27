import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PORTAL_ENABLED_VARIABLE, parsePortalEnabled } from '../portal-enabled.config.mjs';
import { navLinks } from '~/lib/site';
import { webRoot } from './helpers';

// The student portal switch in the PRERENDERED pages of the build in dist/ (SAKEM-103, Phase A of the cutover). They need `pnpm build`
// first and are skipped, not failed, when dist/ is missing. A prerendered page offers the portal if and only if the BUILD was given
// PORTAL_ENABLED=true in its shell environment; this reads the same variable the build read, so the plain `pnpm build` of every gate (no
// variable) must have no "Masuk" link and no session script on any page, and a build with the variable must have both on every page.
// The pages the Worker renders are checked against the built Worker (scripts/e2e.mjs, group `portal`), and the variant builds against their
// own output (scripts/e2e-portal.mjs).
const client = path.join(webRoot, 'dist/client');
const built = existsSync(path.join(client, 'index.html'));
const on = parsePortalEnabled(process.env[PORTAL_ENABLED_VARIABLE]) === true;

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const pages = () => (built ? walk(client).filter((f) => f.endsWith('.html')) : []);
const rel = (file: string) => path.relative(client, file);
const inlineScripts = (html: string) => [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const navOf = (html: string) => html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
// The <ul> of the desktop menu (Dzul, 2026-10-16): in the centre column while the portal is on, in the third column and packed to the right while it is off.
// (justify-end, not justify-self-end: that word marks the wrapper of "Masuk" in these tests, scripts/e2e*.mjs and check:production.)
const MENU_ON = '<ul class="hidden md:flex items-center gap-6 lg:gap-7">';
const MENU_OFF = '<ul class="hidden md:flex items-center gap-6 lg:gap-7 md:col-start-3 md:justify-end">';
const menuLists = (nav: string) => nav.match(/<ul class="hidden md:flex[^"]*">/g) ?? [];

describe.skipIf(!built)('the portal switch in the prerendered pages of dist/', () => {
  it('there are prerendered pages to look at: the home page, /gabung-siswa and the three program pages (/donasi is rendered by the Worker since SAKEM-105)', () => {
    expect(pages().map(rel).sort()).toEqual(['gabung-siswa.html', 'index.html', 'program/pasca-pembinaan.html', 'program/pembinaan.html', 'program/prapembinaan.html']);
  });

  if (!on) {
    it('no PORTAL_ENABLED=true in the environment (Phase A): no page has a "Masuk" link, the address of the session call, or any path of the portal', () => {
      for (const file of pages()) {
        const html = readFileSync(file, 'utf8');
        expect(html, rel(file)).not.toContain('/portal');
        expect(html, rel(file)).not.toContain('get-session');
        expect(html, rel(file)).not.toContain('data-auth-link');
        expect(html, rel(file)).not.toMatch(/>\s*Masuk\s*</);
        expect(html, rel(file)).not.toContain('sk:session');
      }
    });

    it('the slot of the button is EMPTY in the bar and in the menu (Dzul, 2026-10-15): the navbar has the logo and the menu links, twice (bar, menu), and no other link, button, wrapper or text of a registration or sign-in', () => {
      for (const file of pages()) {
        const html = readFileSync(file, 'utf8');
        const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
        const hrefs = [...nav.matchAll(/<a\s[^>]*?href="([^"]*)"/g)].map((m) => m[1]);
        // the text links, then Donasi as the one button (SAKEM-111), in the bar and again in the menu
        const menu = [...navLinks.filter((l) => l.href !== '/donasi'), ...navLinks.filter((l) => l.href === '/donasi')].map((l) => l.href);
        expect(hrefs, rel(file)).toEqual(['/', ...menu, ...menu]);
        expect(nav, rel(file)).not.toContain('Daftar Sekarang');
        expect(nav, rel(file)).not.toContain('/daftar');
        expect(nav, rel(file)).not.toContain('justify-self-end');
        expect(nav, rel(file)).not.toContain('mt-6');
        expect(nav.match(/<button\b/g) ?? [], rel(file)).toHaveLength(1); // the menu toggle, nothing else
      }
    });

    it('the desktop menu is on the RIGHT while the portal is off (Dzul, 2026-10-16): its <ul> takes the third column of the grid and packs its links to the end, once per page; the mobile menu is as before', () => {
      for (const file of pages()) {
        const nav = navOf(readFileSync(file, 'utf8'));
        expect(menuLists(nav), rel(file)).toEqual([MENU_OFF]);
        expect(nav.match(/col-start-3/g) ?? [], rel(file)).toHaveLength(1);
        expect(nav.match(/<ul class="flex flex-col gap-4">/g) ?? [], rel(file)).toHaveLength(1);
      }
    });

    it('exactly one inline navbar script, with no auth code in it: the menu, the announcement strip and the year', () => {
      for (const file of pages()) {
        const scripts = inlineScripts(readFileSync(file, 'utf8')).filter((code) => code.includes('nav-toggle'));
        expect(scripts, rel(file)).toHaveLength(1);
        expect(scripts[0], rel(file)).toContain('announcement-slot');
        expect(scripts[0], rel(file)).toContain('copyright-year');
        expect(scripts[0], rel(file)).not.toMatch(/\/portal|get-session|viewer|super_admin|Dashboard/);
      }
    });
  } else {
    it('PORTAL_ENABLED=true in the environment (Phase B): every prerendered page has "Masuk" twice and the session script once, and no "Daftar Sekarang" in the navbar', () => {
      for (const file of pages()) {
        const html = readFileSync(file, 'utf8');
        expect(html.match(/<a href="\/portal\/login" data-auth-link/g), rel(file)).toHaveLength(2);
        const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
        expect(nav, rel(file)).not.toContain('Daftar Sekarang');
        expect(inlineScripts(html).filter((code) => code.includes('get-session')), rel(file)).toHaveLength(1);
      }
    });

    it('and the menu stays where it was (Phase B): the <ul> has neither of the two classes that move it right, so it sits in the centre column with "Masuk" in the third', () => {
      for (const file of pages()) {
        const nav = navOf(readFileSync(file, 'utf8'));
        expect(menuLists(nav), rel(file)).toEqual([MENU_ON]);
        expect(nav, rel(file)).not.toContain('col-start-3');
        expect(nav, rel(file)).not.toContain('md:justify-end');
        expect(nav.match(/<div class="hidden md:flex items-center justify-self-end">/g) ?? [], rel(file)).toHaveLength(1);
        expect(nav.match(/<ul class="flex flex-col gap-4">/g) ?? [], rel(file)).toHaveLength(1);
      }
    });
  }

  it('whatever the build was given, the stylesheet of every page defines the two classes the menu moves with (Tailwind did not leave them out), and the grid they work in', () => {
    for (const file of pages()) {
      const html = readFileSync(file, 'utf8');
      const sheets = [...html.matchAll(/<link rel="stylesheet" href="(\/_astro\/[^"]+\.css)"/g)].map((m) => readFileSync(path.join(client, m[1]), 'utf8'));
      expect(sheets.length, rel(file)).toBeGreaterThan(0);
      const css = sheets.join('\n');
      expect(css, rel(file)).toContain('.md\\:col-start-3{grid-column-start:3}');
      expect(css, rel(file)).toContain('.md\\:justify-end{justify-content:flex-end}');
      expect(css, rel(file)).toContain('md\\:grid-cols-\\[1fr_auto_1fr\\]');
    }
  });

  it('whatever the build was given, no script FILE and no other address of the portal API is in a page: the session call is one inline script or nothing', () => {
    for (const file of pages()) {
      const html = readFileSync(file, 'utf8');
      expect(html.match(/get-session/g)?.length ?? 0, rel(file)).toBe(on ? 1 : 0);
      expect(html, rel(file)).not.toContain('/api/auth/session');
    }
  });

  it('the deployed config of the build sets no PORTAL_ENABLED var: the Worker variable is a per-deploy value, never in git', () => {
    const config = JSON.parse(readFileSync(path.join(webRoot, 'dist/server/wrangler.json'), 'utf8'));
    expect(config.vars ?? {}).not.toHaveProperty('PORTAL_ENABLED');
  });
});
