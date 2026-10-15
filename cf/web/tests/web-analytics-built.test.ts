import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BEACON_ID_VARIABLE, BEACON_SCRIPT_URL, parseBeaconId } from '../web-analytics.config.mjs';
import { webRoot } from './helpers';

// The Web Analytics beacon in the PRERENDERED pages of the build in dist/ (SAKEM-095). They need `pnpm build` first and
// are skipped, not failed, when dist/ is missing. A page is prerendered, so it holds the beacon if and only if the BUILD
// was given a valid WEB_ANALYTICS_BEACON_ID in its shell environment; this reads the same variable the build read, so the
// plain `pnpm build` of every gate (no variable) must have none, and a build with the variable must have exactly one, the
// same on every page. The pages the Worker renders are checked against the built Worker (scripts/e2e.mjs, group
// "analytics"), and the variant build against its own output (scripts/e2e-analytics.mjs).
const client = path.join(webRoot, 'dist/client');
const built = existsSync(path.join(client, 'index.html'));
const expected = parseBeaconId(process.env[BEACON_ID_VARIABLE]);

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const pages = () => (built ? walk(client).filter((f) => f.endsWith('.html')) : []);
const rel = (file: string) => path.relative(client, file);

describe.skipIf(!built)('the beacon in the prerendered pages of dist/', () => {
  it('there are prerendered pages to look at: the home page, /donasi, /gabung-siswa and the three program pages', () => {
    expect(pages().map(rel).sort()).toEqual(['donasi.html', 'gabung-siswa.html', 'index.html', 'program/pasca-pembinaan.html', 'program/pembinaan.html', 'program/prapembinaan.html']);
  });

  if (expected === null) {
    it('no valid WEB_ANALYTICS_BEACON_ID in the environment: no prerendered page has the script, the tag, the host or the attribute', () => {
      for (const file of pages()) {
        const html = readFileSync(file, 'utf8');
        expect(html, rel(file)).not.toMatch(/cloudflareinsights|data-cf-beacon|beacon\.min\.js/i);
        // and the page ends exactly as it did before the beacon existed (the component leaves no whitespace behind; the build of
        // origin/cloudflare was compared byte for byte, hash by hash, when it was written)
        expect(html.split('</footer> </div> </body></html>').length - 1, rel(file)).toBe(1);
      }
    });
  } else {
    it('a valid WEB_ANALYTICS_BEACON_ID in the environment: every prerendered page has exactly one beacon tag, with that id, at the end of <body>', () => {
      for (const file of pages()) {
        const html = readFileSync(file, 'utf8');
        const tags = [...html.matchAll(/<script\b[^>]*beacon\.min\.js[^>]*>/g)].map((m) => m[0]);
        expect(tags, rel(file)).toHaveLength(1);
        expect(html.split('data-cf-beacon').length - 1, rel(file)).toBe(1);
        expect(tags[0], rel(file)).toContain(`src="${BEACON_SCRIPT_URL}"`);
        expect(tags[0], rel(file)).toContain('type="module"');
        expect(tags[0], rel(file)).toContain(`data-cf-beacon="{&quot;token&quot;:&quot;${expected}&quot;}"`);
        expect(html.lastIndexOf(tags[0]!), rel(file)).toBeGreaterThan(html.lastIndexOf('</footer>'));
        expect(html.indexOf('</body>'), rel(file)).toBeGreaterThan(html.lastIndexOf(tags[0]!));
      }
    });
  }

  it('whatever the build was given, the beacon script is named at most once per page and never by an inline script', () => {
    for (const file of pages()) {
      const html = readFileSync(file, 'utf8');
      expect(html, rel(file)).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>[^<]*(cloudflareinsights|data-cf-beacon)/i);
      expect(html.match(/beacon\.min\.js/g)?.length ?? 0, rel(file)).toBe(expected === null ? 0 : 1);
    }
  });

  it('the assets layer sends no Content-Security-Policy for any of them, so there is nothing to extend for the beacon', () => {
    expect(readFileSync(path.join(client, '_headers'), 'utf8')).not.toMatch(/content-security-policy/i);
  });
});
