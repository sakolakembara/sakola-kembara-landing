import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { WORKERS, buildCommand, extraNotes, parseVarsFile, validateVars } from '../../scripts/staging-deploy-command.mjs';
import { SECURITY_HEADERS } from '~/lib/security-headers';
import { BEACON_ID_VARIABLE, BEACON_REPORT_ORIGIN, BEACON_SCRIPT_URL, BUILD_BEACON_ID, beaconAttribute, webAnalyticsBeaconId } from '~/lib/web-analytics';
import { parseBeaconId } from '../web-analytics.config.mjs';
import { readWeb, repoRoot, webRoot } from './helpers';

// Cloudflare Web Analytics (SAKEM-095, decision D-07): which beacon id a page gets, the tag, where the tag is NOT, the
// headers, the declarations of the variable, and the deploy-command printer. The tag in rendered pages (SSR) is
// checked against the built Worker by scripts/e2e.mjs (group "analytics"); the prerendered half against a second build
// by scripts/e2e-analytics.mjs; the built HTML of the default build by tests/web-analytics-built.test.ts. Nothing here
// talks to Cloudflare, and the id below is invented.

/** An invented beacon id (the shape of a site token, 32 hexadecimal characters). */
const ID = '0123456789abcdef0123456789abcdef';
const OTHER_ID = 'ABCDEF0123456789ABCDEF0123456789';

describe('the beacon id: exactly 32 hexadecimal characters, anything else is nothing', () => {
  it('accepts 32 hexadecimal characters in either case and ignores surrounding whitespace', () => {
    expect(parseBeaconId(ID)).toBe(ID);
    expect(parseBeaconId(OTHER_ID)).toBe(OTHER_ID);
    expect(parseBeaconId(`  ${ID}\n`)).toBe(ID);
    expect(parseBeaconId(`\t${OTHER_ID} `)).toBe(OTHER_ID);
  });

  it('refuses a wrong length, a non-hex character, text around the id, several lines, other shapes and non-strings', () => {
    const invalid: unknown[] = [
      '',
      '   ',
      ID.slice(1), // 31
      `${ID}0`, // 33
      `${ID.slice(1)}g`,
      `${ID.slice(1)}-`,
      '01234567-89ab-cdef-0123-456789abcdef', // a UUID
      `0x${ID.slice(2)}`,
      `${ID};alert(1)`,
      `"${ID}"`,
      `'${ID}'`,
      `${ID}\n${ID}`,
      `${ID} ${ID}`,
      `{"token":"${ID}"}`,
      `?token=${ID}`,
      '"><script>alert(1)</script>',
      `${ID.slice(0, 31)}١`, // an Arabic-Indic digit is not a hexadecimal digit
      '０１２３４５６７８９ａｂｃｄｅｆ０１２３４５６７８９ａｂｃｄｅｆ', // full-width digits and letters
      undefined,
      null,
      32,
      {},
      [ID],
      true,
    ];
    for (const value of invalid) expect(parseBeaconId(value), String(value)).toBeNull();
  });

  it('never throws, whatever it is given', () => {
    const hostile = { toString: () => { throw new Error('boom'); } };
    expect(() => parseBeaconId(hostile)).not.toThrow();
    expect(() => parseBeaconId(Symbol('x'))).not.toThrow();
    expect(() => parseBeaconId('x'.repeat(1_000_000))).not.toThrow();
  });
});

describe('which beacon id a page gets: the build for a prerendered page, the Worker variable for a rendered one', () => {
  const quiet = () => undefined;

  it('a prerendered page takes the build value', () => {
    expect(webAnalyticsBeaconId({ prerendered: true, build: ID, runtime: undefined }, quiet)).toBe(ID);
  });

  it('a prerendered page never reads the Worker variable: the prerender\'s env holds .dev.vars, which must not put a value into static HTML', () => {
    expect(webAnalyticsBeaconId({ prerendered: true, build: null, runtime: ID }, quiet)).toBeNull();
    expect(webAnalyticsBeaconId({ prerendered: true, build: ID, runtime: OTHER_ID }, quiet)).toBe(ID);
  });

  it('a prerendered page with an invalid build value has no beacon', () => {
    for (const build of ['', 'nope', `${ID}0`, ID.slice(1)]) expect(webAnalyticsBeaconId({ prerendered: true, build, runtime: ID }, quiet), build).toBeNull();
  });

  it('a rendered page takes the Worker variable', () => {
    expect(webAnalyticsBeaconId({ prerendered: false, build: null, runtime: ID }, quiet)).toBe(ID);
    expect(webAnalyticsBeaconId({ prerendered: false, build: null, runtime: `  ${OTHER_ID} ` }, quiet)).toBe(OTHER_ID);
  });

  it('a rendered page never falls back to the build value: unsetting the Worker variable is how it is switched off', () => {
    expect(webAnalyticsBeaconId({ prerendered: false, build: ID, runtime: undefined }, quiet)).toBeNull();
    expect(webAnalyticsBeaconId({ prerendered: false, build: ID, runtime: '' }, quiet)).toBeNull();
    expect(webAnalyticsBeaconId({ prerendered: false, build: ID, runtime: OTHER_ID }, quiet)).toBe(OTHER_ID);
  });

  it('both kinds of page give the same id when both are configured with one value', () => {
    expect(webAnalyticsBeaconId({ prerendered: true, build: ID, runtime: ID }, quiet)).toBe(webAnalyticsBeaconId({ prerendered: false, build: ID, runtime: ID }, quiet));
  });

  it('unset, empty or blank is silent: no beacon, no log line', () => {
    const warn = vi.fn();
    for (const runtime of [undefined, '', '   ', '\n']) expect(webAnalyticsBeaconId({ prerendered: false, build: null, runtime }, warn, { invalid: false })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('an invalid Worker variable is nothing, says so once in fixed words, and the value is never in the line', () => {
    const warn = vi.fn();
    const state = { invalid: false };
    const secretLooking = 'VERY-DISTINCTIVE-WRONG-VALUE-0000';
    for (let i = 0; i < 5; i++) expect(webAnalyticsBeaconId({ prerendered: false, build: null, runtime: secretLooking }, warn, state)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]![0]);
    expect(line).toContain(BEACON_ID_VARIABLE);
    expect(line).not.toContain(secretLooking);
    expect(line).not.toMatch(/VERY|DISTINCTIVE|0000/);
  });

  it('under vitest nothing was built, so there is no build value', () => {
    expect(BUILD_BEACON_ID).toBeNull();
  });
});

describe('the tag', () => {
  it('data-cf-beacon is Cloudflare\'s JSON with the token and nothing else', () => {
    expect(JSON.parse(beaconAttribute(ID))).toEqual({ token: ID });
    expect(Object.keys(JSON.parse(beaconAttribute(ID)))).toEqual(['token']);
  });

  it('the script and the report endpoint are the ones Cloudflare\'s FAQ names for a manual setup', () => {
    // https://developers.cloudflare.com/web-analytics/faq/ (read 2026-10-15): the snippet, `script-src` and `connect-src`.
    expect(BEACON_SCRIPT_URL).toBe('https://static.cloudflareinsights.com/beacon.min.js');
    expect(BEACON_REPORT_ORIGIN).toBe('https://cloudflareinsights.com');
    expect(new URL(BEACON_REPORT_ORIGIN).pathname).toBe('/');
    expect(BEACON_ID_VARIABLE).toBe('WEB_ANALYTICS_BEACON_ID');
  });

  describe('the component and the layout', () => {
    const layout = readWeb('src/layouts/Base.astro');
    const component = readWeb('src/components/WebAnalytics.astro');
    const tag = '<script is:inline type="module" src={BEACON_SCRIPT_URL} data-cf-beacon={beaconAttribute(beaconId)} />';

    it('the component has the tag once, guarded by the id, as a module script with a src and a data attribute, with no inline code', () => {
      expect(component.split('data-cf-beacon').length - 1).toBe(1);
      expect(component).toContain(`{beaconId && ${tag}}`);
      expect(tag).not.toMatch(/\b(defer|async)\b/);
      expect(component).not.toMatch(/cloudflareinsights/);
      expect(component.replace(/^---[\s\S]*?\n---\n/, '').trim()).toBe(`{beaconId && ${tag}}`);
    });

    it('the component asks which id with the page\'s own kind, the build value and the Worker variable, and nothing else', () => {
      expect(component).toContain('const beaconId = webAnalyticsBeaconId({ prerendered: Astro.isPrerendered, build: BUILD_BEACON_ID, runtime: env.WEB_ANALYTICS_BEACON_ID });');
      expect(component).toContain("import { env } from 'cloudflare:workers';");
    });

    it('the layout includes it once, at the end of <body> after the footer, with NO whitespace before it, and never in <head>', () => {
      // Astro writes the whitespace after </body> differently in a layout that holds a <script> element, and keeps whitespace around an
      // expression that renders nothing: the component, placed right after <Footer />, is what keeps an unset page byte for byte as before
      const body = layout.slice(layout.indexOf('<body'));
      expect(body.split('<WebAnalytics />').length - 1).toBe(1);
      expect(layout).toContain('<Footer /><WebAnalytics />');
      expect(body.indexOf('<WebAnalytics />')).toBeGreaterThan(body.indexOf('<Footer />'));
      expect(body.indexOf('<WebAnalytics />')).toBeLessThan(body.indexOf('</body>'));
      expect(layout.slice(layout.indexOf('<meta charset'), layout.indexOf('</head>'))).not.toContain('WebAnalytics');
      expect(layout).not.toMatch(/data-cf-beacon|BEACON_SCRIPT_URL|beaconAttribute|webAnalyticsBeaconId/);
      // the head has the JSON-LD scripts; the body of the layout holds no <script> element at all
      expect(layout.slice(layout.indexOf('<body'))).not.toContain('<script');
    });

    it('nothing else renders the component', () => {
      const users = walkAll(path.join(webRoot, 'src')).filter((f) => /import WebAnalytics from/.test(readFileSync(f, 'utf8')));
      expect(users.map((f) => path.relative(webRoot, f))).toEqual([path.join('src', 'layouts', 'Base.astro')]);
    });
  });

  it('one place: no other file of src/ names the beacon, so no page or component can add a second tag (Cloudflare reads one per page)', () => {
    const files = walkAll(path.join(webRoot, 'src')).filter((f) => /\.(ts|astro)$/.test(f) && !f.includes(`${path.sep}generated${path.sep}`));
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const rel = path.relative(webRoot, file);
      if (rel === path.join('src', 'components', 'WebAnalytics.astro')) continue;
      if (rel === path.join('src', 'lib', 'web-analytics.ts')) continue;
      expect(text, rel).not.toMatch(/cloudflareinsights|data-cf-beacon|BEACON_SCRIPT_URL|beaconAttribute/);
    }
    // the URL itself lives in one pure module
    expect(readWeb('web-analytics.config.mjs').match(/export const BEACON_SCRIPT_URL = 'https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js';/g)).toHaveLength(1);
  });
});

describe('where the beacon is not: the admin and the portal', () => {
  it('nothing of cf/admin (the admin SPA, the portal SPA, both Workers) names the beacon, its tag, its host or its variable', () => {
    const root = path.join(repoRoot, 'cf/admin');
    const skip = new Set(['node_modules', 'dist', '.wrangler', '.astro']);
    const files = walkAll(root, skip).filter((f) => /\.(ts|tsx|html|json|jsonc|mjs|css|example)$/.test(f) && statSync(f).size < 2_000_000);
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), path.relative(repoRoot, file)).not.toMatch(/cloudflareinsights|data-cf-beacon|WEB_ANALYTICS_BEACON_ID/i);
    }
  });

  it('the site has no page of the admin or the portal: /admin is a redirect, /api a JSON 404, /portal another Worker (the e2e checks the answers)', () => {
    const middleware = readWeb('src/middleware.ts');
    expect(middleware).toContain('adminRedirectTarget(env.ADMIN_URL, pathname, search)');
    expect(middleware).toContain('return apiNotFound();');
    expect(readWeb('src/lib/legacy-paths.ts')).toContain("'/portal'");
  });
});

describe('no Content-Security-Policy to extend', () => {
  const NAME = /content-security-policy/i;

  it('the site sends none: not in the security headers of the middleware, not in public/_headers', () => {
    const expectation = [
      'A Content-Security-Policy was added. With the beacon configured it must allow EXACTLY this, and nothing more:',
      `  script-src ${BEACON_SCRIPT_URL}`,
      `  connect-src ${BEACON_REPORT_ORIGIN}`,
      '(https://developers.cloudflare.com/web-analytics/faq/, "What do I need to add to my Content Security Policy"). The tag has no inline code, so no \'unsafe-inline\' is needed for it.',
      'Add both to the policy, then change this test to check that they are there.',
    ].join('\n');
    expect(Object.keys(SECURITY_HEADERS).filter((name) => NAME.test(name)), expectation).toEqual([]);
    expect(NAME.test(readWeb('public/_headers')), expectation).toBe(false);
    expect(NAME.test(readWeb('src/middleware.ts')), expectation).toBe(false);
  });
});

describe('the variable is declared where the other optional public variables are', () => {
  it('env.d.ts: an optional string', () => {
    expect(readWeb('src/env.d.ts')).toContain('WEB_ANALYTICS_BEACON_ID?: string;');
  });

  it('wrangler.jsonc: in the comment of the variables set at deploy, never as a value (no id in git)', () => {
    const file = readWeb('wrangler.jsonc');
    expect(file).toMatch(/\/\/ - WEB_ANALYTICS_BEACON_ID \(a "vars" entry too, optional, PUBLIC\)/);
    const code = file.replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('WEB_ANALYTICS');
    expect(file).not.toMatch(/[0-9a-fA-F]{32}/);
  });

  it('the two example files leave the beacon off: the line is there, commented out and empty', () => {
    for (const name of ['dev.vars.example', 'staging.vars.example']) {
      const text = readWeb(name);
      expect(text, name).toMatch(/^# WEB_ANALYTICS_BEACON_ID=$/m);
      expect(parseVarsFile(text).map((e: { name: string }) => e.name), name).not.toContain('WEB_ANALYTICS_BEACON_ID');
      expect(text, name).not.toMatch(/[0-9a-fA-F]{32}/);
    }
  });

  it('astro.config.mjs takes the prerendered pages\' value from the build\'s process environment only, validated, into the constant the layout reads', () => {
    const config = readWeb('astro.config.mjs');
    expect(config).toContain('const beaconId = parseBeaconId(process.env[BEACON_ID_VARIABLE]);');
    expect(config).toContain('__WEB_ANALYTICS_BEACON_ID__: JSON.stringify(beaconId)');
    expect(config).not.toMatch(/import\.meta\.env\.\w*(BEACON|ANALYTICS)/);
    // an invalid value is warned about without being repeated
    expect(config).toMatch(/console\.warn\(`\$\{BEACON_ID_VARIABLE\} is set but is not a beacon id \(32 hexadecimal characters\): the prerendered pages are built without the beacon`\)/);
  });

  it('vitest.config.ts builds nothing, so the constant is null there', () => {
    expect(readWeb('vitest.config.ts')).toContain('__WEB_ANALYTICS_BEACON_ID__: JSON.stringify(null)');
  });
});

describe('the staging deploy-command printer', () => {
  const validate = (worker: 'admin' | 'web', text: string) => validateVars(worker, parseVarsFile(text));

  it('accepts the beacon id for the site as a public value and prints it as one --var', () => {
    expect(() => validate('web', `WEB_ANALYTICS_BEACON_ID=${ID}`)).not.toThrow();
    expect(() => validate('web', `WEB_ANALYTICS_BEACON_ID=${OTHER_ID}`)).not.toThrow();
    expect(() => validate('web', `TURNSTILE_SITE_KEY=0x4AAAAAAAtest123\nWEB_ANALYTICS_BEACON_ID=${ID}`)).not.toThrow();
    const command = buildCommand('web', parseVarsFile(`WEB_ANALYTICS_BEACON_ID=${ID}`));
    expect(command).toBe(`pnpm exec wrangler deploy -c dist/server/wrangler.json --var 'WEB_ANALYTICS_BEACON_ID:${ID}'`);
  });

  it('it is the site\'s variable only: the admin Worker refuses it', () => {
    expect(WORKERS.web.allowed).toContain('WEB_ANALYTICS_BEACON_ID');
    expect(WORKERS.admin.allowed).not.toContain('WEB_ANALYTICS_BEACON_ID');
    expect(() => validate('admin', `WEB_ANALYTICS_BEACON_ID=${ID}`)).toThrow(/not a variable of sakem-admin-staging/);
  });

  it('refuses a value that is not 32 hexadecimal characters, with the line, and without repeating the value', () => {
    const distinctive = 'wrongwrongwrongwrongwrongwrongwr'; // 32 characters, not hexadecimal
    for (const bad of [ID.slice(1), `${ID}0`, distinctive, '<beacon id from Web Analytics>', `"${ID}"x`, '0x' + ID.slice(2), '', '01234567-89ab-cdef-0123-456789abcdef']) {
      let message = '';
      try {
        validate('web', `WEB_ANALYTICS_BEACON_ID=${bad}`);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, bad).toMatch(/^line 1 \(WEB_ANALYTICS_BEACON_ID\): /);
      if (bad.length > 3) expect(message, bad).not.toContain(bad);
    }
    expect(() => validate('web', `WEB_ANALYTICS_BEACON_ID=${distinctive}`)).toThrow(/beacon id \(exactly 32 hexadecimal characters\)/);
  });

  it('keeps the same shape as the site\'s own validation (cf/web/web-analytics.config.mjs): the two accept exactly the same values', () => {
    const samples = [ID, OTHER_ID, ID.slice(1), `${ID}0`, `${ID.slice(1)}g`, '０'.repeat(32), '0'.repeat(32), 'f'.repeat(32), 'F'.repeat(32), 'g'.repeat(32), `${ID.slice(0, 16)}-${ID.slice(17)}`];
    for (const sample of samples) {
      let accepted = true;
      try {
        validate('web', `WEB_ANALYTICS_BEACON_ID=${sample}`);
      } catch {
        accepted = false;
      }
      expect(accepted, sample).toBe(parseBeaconId(sample) !== null);
    }
  });

  it('still refuses every secret name, even next to a valid beacon id, and every API URL: naming the beacon id without TOKEN is what keeps the guard whole', () => {
    for (const name of ['WEB_ANALYTICS_TOKEN', 'CLOUDFLARE_API_TOKEN', 'BETTER_AUTH_SECRET', 'TURNSTILE_SECRET_KEY', 'RESEND_API_KEY', 'ADMIN_PASSWORD', 'ANALYTICS_PRIVATE_KEY']) {
      expect(() => validate('web', `${name}=${ID}`), name).toThrow(/refused, a secret/);
      expect(() => validate('web', `WEB_ANALYTICS_BEACON_ID=${ID}\n${name}=${ID}`), name).toThrow(/refused, a secret/);
    }
    for (const name of ['CONTENT_API_URL', 'CONTACT_API_URL']) expect(() => validate('web', `${name}=https://api.example.org`)).toThrow(/service binding/);
    expect(BEACON_ID_VARIABLE).not.toMatch(/SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE/i);
  });

  it('refuses a placeholder or a second line for the same name', () => {
    expect(() => validate('web', 'WEB_ANALYTICS_BEACON_ID=<32 hex characters>')).toThrow();
    expect(() => validate('web', `WEB_ANALYTICS_BEACON_ID=${ID}\nWEB_ANALYTICS_BEACON_ID=${OTHER_ID}`)).toThrow(/set twice/);
  });

  it('tells the owner, when the beacon id is in the file, that the prerendered pages need it in the build\'s shell', () => {
    const withId = parseVarsFile(`WEB_ANALYTICS_BEACON_ID=${ID}`);
    const notes = extraNotes('web', withId).join('\n');
    expect(notes).toContain('WEB_ANALYTICS_BEACON_ID=<the same value> pnpm build:staging');
    expect(notes).not.toContain(ID);
    expect(extraNotes('web', parseVarsFile('TURNSTILE_SITE_KEY=0x4AAAAAAAtest123'))).toEqual([]);
    expect(extraNotes('admin', withId)).toEqual([]);
  });
});

function walkAll(dir: string, skip: Set<string> = new Set()): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (skip.has(name)) return [];
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? walkAll(file, skip) : [file];
  });
}
