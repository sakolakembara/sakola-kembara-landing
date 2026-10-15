import { describe, expect, it, vi } from 'vitest';
import { WORKERS, buildCommand, extraNotes, parseVarsFile, validateVars } from '../../scripts/staging-deploy-command.mjs';
import { BUILD_PORTAL_ENABLED, PORTAL_ENABLED_VARIABLE, portalEnabled } from '~/lib/portal-enabled';
import { parsePortalEnabled } from '../portal-enabled.config.mjs';
import { readWeb } from './helpers';

// The student portal switch (SAKEM-103, Phase A of the cutover): whether a page carries the navbar's "Masuk" link and its session
// script. Default OFF, read like the Web Analytics beacon: a prerendered page takes the build's value, a page the Worker renders takes
// the Worker variable, no fallback either way. The rendered halves are checked against the built Worker by scripts/e2e.mjs (group
// `portal`), the prerendered half against two more builds by scripts/e2e-portal.mjs (`pnpm test:e2e:portal`), and the built HTML of the
// default build by tests/portal-enabled-built.test.ts. Nothing here talks to Cloudflare.

describe('the value: exactly "true" turns it on, exactly "false" or nothing leaves it off, anything else is invalid', () => {
  it('true and false, whitespace around them ignored', () => {
    expect(parsePortalEnabled('true')).toBe(true);
    expect(parsePortalEnabled('  true\n')).toBe(true);
    expect(parsePortalEnabled('false')).toBe(false);
    expect(parsePortalEnabled('\tfalse ')).toBe(false);
  });

  it('unset, undefined, null and an empty value are the default: off, and not invalid', () => {
    for (const value of [undefined, null, '', '   ', '\n']) expect(parsePortalEnabled(value), JSON.stringify(value)).toBe(false);
  });

  it('every other text is invalid (null), whatever it looks like: case, 1, yes, on, text around the word, several lines, a quoted word', () => {
    for (const value of ['TRUE', 'True', 'FALSE', 'False', '1', '0', 'yes', 'no', 'on', 'off', 'y', 'enabled', 'true;', 'true false', 'truefalse', '"true"', "'true'", 'true\nfalse', 'tru', 'ｔｒｕｅ', '-true', '/portal']) {
      expect(parsePortalEnabled(value), JSON.stringify(value)).toBeNull();
    }
  });

  it('a value that is not a string is invalid, never on: a JSON boolean or number that reached the Worker as a var does not switch the portal on', () => {
    for (const value of [true, false, 1, 0, {}, [], ['true'], () => 'true', Symbol('x'), 10n]) expect(parsePortalEnabled(value), String(typeof value)).toBeNull();
  });

  it('never throws, and the variable is named PORTAL_ENABLED (public: no TOKEN, SECRET, KEY or PASSWORD in it)', () => {
    expect(() => parsePortalEnabled({ toString() { throw new Error('boom'); } })).not.toThrow();
    expect(PORTAL_ENABLED_VARIABLE).toBe('PORTAL_ENABLED');
    expect(PORTAL_ENABLED_VARIABLE).not.toMatch(/SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE/i);
  });
});

describe('which source a page reads: its own kind decides, no fallback either way', () => {
  const quiet = () => undefined;

  it('a prerendered page takes the BUILD\'s value only: the Worker variable cannot reach static HTML, and a value that was there in the prerender\'s env must not matter', () => {
    expect(portalEnabled({ prerendered: true, build: true, runtime: undefined }, quiet)).toBe(true);
    expect(portalEnabled({ prerendered: true, build: false, runtime: undefined }, quiet)).toBe(false);
    // the Worker variable is not consulted, whichever way it points
    expect(portalEnabled({ prerendered: true, build: false, runtime: 'true' }, quiet)).toBe(false);
    expect(portalEnabled({ prerendered: true, build: true, runtime: 'false' }, quiet)).toBe(true);
    expect(portalEnabled({ prerendered: true, build: false, runtime: 'garbage' }, quiet)).toBe(false);
  });

  it('a page the Worker renders takes the WORKER variable only: unsetting it switches the portal off, whatever the build was given', () => {
    expect(portalEnabled({ prerendered: false, build: false, runtime: 'true' }, quiet)).toBe(true);
    expect(portalEnabled({ prerendered: false, build: true, runtime: undefined }, quiet)).toBe(false);
    expect(portalEnabled({ prerendered: false, build: true, runtime: '' }, quiet)).toBe(false);
    expect(portalEnabled({ prerendered: false, build: true, runtime: 'false' }, quiet)).toBe(false);
    expect(portalEnabled({ prerendered: false, build: false, runtime: undefined }, quiet)).toBe(false);
  });

  it('on only for the exact value true: TRUE, 1, yes and the rest are off on a rendered page', () => {
    for (const runtime of ['TRUE', '1', 'yes', 'on', 'true!', ' no']) expect(portalEnabled({ prerendered: false, build: true, runtime }, quiet), runtime).toBe(false);
    expect(portalEnabled({ prerendered: false, build: false, runtime: ' true ' }, quiet)).toBe(true);
  });

  it('in the unit tests the build was given nothing: the constant is false', () => {
    expect(BUILD_PORTAL_ENABLED).toBe(false);
  });
});

describe('an invalid Worker variable is off, says so once in fixed words, and its value is never repeated', () => {
  const invalid = 'TRUE-<img src=x onerror=alert(1)>';

  it('one warning per isolate, however many pages are rendered, and the warning does not hold the value', () => {
    const warn = vi.fn();
    const state = { invalid: false };
    for (let i = 0; i < 5; i++) expect(portalEnabled({ prerendered: false, build: false, runtime: invalid }, warn, state)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toBe('portal: PORTAL_ENABLED is set but is neither "true" nor "false"; the page is rendered with the portal off');
    expect(line).not.toContain(invalid);
    expect(line).not.toContain('onerror');
  });

  it('nothing is said for the default (unset, empty), for a valid value or for a prerendered page', () => {
    const warn = vi.fn();
    for (const runtime of [undefined, '', '  ', 'true', 'false']) portalEnabled({ prerendered: false, build: false, runtime }, warn, { invalid: false });
    portalEnabled({ prerendered: true, build: false, runtime: invalid }, warn, { invalid: false });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('the variable is declared where the other optional public variables are', () => {
  it('env.d.ts: an optional string, documented as public and off by default', () => {
    const file = readWeb('src/env.d.ts');
    expect(file).toContain('PORTAL_ENABLED?: string;');
    expect(file).toMatch(/Exactly `true` shows the navbar's "Masuk" link/);
  });

  it('wrangler.jsonc: in the comment of the variables set at deploy, never as a value', () => {
    const file = readWeb('wrangler.jsonc');
    expect(file).toMatch(/\/\/ - PORTAL_ENABLED \(a "vars" entry too, optional, PUBLIC; SAKEM-103, Phase A of the cutover\)/);
    expect(file.replace(/^\s*\/\/.*$/gm, '')).not.toContain('PORTAL_ENABLED');
  });

  it('the two example files leave the portal off: the line is there, commented out', () => {
    for (const name of ['dev.vars.example', 'staging.vars.example']) {
      const text = readWeb(name);
      expect(text, name).toMatch(/^# PORTAL_ENABLED=true$/m);
      expect(parseVarsFile(text).map((e: { name: string }) => e.name), name).not.toContain('PORTAL_ENABLED');
    }
  });

  it('astro.config.mjs takes the prerendered pages\' value from the build\'s process environment only, validated, into the constant the navbar reads; vitest builds nothing, so it is false there', () => {
    const config = readWeb('astro.config.mjs');
    expect(config).toContain('const portalSetting = parsePortalEnabled(process.env[PORTAL_ENABLED_VARIABLE]);');
    expect(config).toContain('const portalEnabled = portalSetting === true;');
    expect(config).toContain('__PORTAL_ENABLED__: JSON.stringify(portalEnabled)');
    expect(config).not.toMatch(/import\.meta\.env\.\w*PORTAL/);
    expect(config).toMatch(/console\.warn\(`\$\{PORTAL_ENABLED_VARIABLE\} is set but is neither "true" nor "false": the prerendered pages are built with the portal off`\)/);
    expect(readWeb('vitest.config.ts')).toContain('__PORTAL_ENABLED__: JSON.stringify(false)');
  });

  it('only the navbar reads it, and only through portalEnabled(): one place in src/', () => {
    const source = readWeb('src/components/Navbar.astro');
    expect(source).toContain('env.PORTAL_ENABLED');
    for (const file of ['src/layouts/Base.astro', 'src/middleware.ts', 'src/components/Footer.astro', 'src/lib/legacy-paths.ts', 'src/pages/gabung-siswa.astro', 'src/pages/index.astro']) {
      expect(readWeb(file), file).not.toMatch(/PORTAL_ENABLED|portalEnabled/);
    }
  });
});

describe('the session script is a component of its own, with its own copy of the one helper it shares with the navbar script', () => {
  const functionOf = (source: string) => {
    const start = source.indexOf('async function cachedJson');
    const end = source.indexOf('\n  }\n', start);
    return source.slice(start, end);
  };

  it('both scripts hold the same cachedJson (an import would make Astro emit a script file for the shared part, and the navbar script is inline on purpose)', () => {
    const navbar = functionOf(readWeb('src/components/Navbar.astro'));
    const session = functionOf(readWeb('src/components/NavbarSession.astro'));
    expect(navbar.length).toBeGreaterThan(400);
    expect(session).toBe(navbar);
  });

  it('neither imports a module (so both stay inline in the page)', () => {
    for (const file of ['src/components/Navbar.astro', 'src/components/NavbarSession.astro']) {
      const script = readWeb(file).split('<script>')[1] ?? '';
      expect(script, file).not.toMatch(/^\s*import\s/m);
    }
  });
});

describe('the staging deploy-command printer', () => {
  const validate = (worker: 'admin' | 'web' | 'portal', text: string) => validateVars(worker, parseVarsFile(text));

  it('accepts PORTAL_ENABLED=true and =false for the site, and prints each as one --var', () => {
    expect(() => validate('web', 'PORTAL_ENABLED=true')).not.toThrow();
    expect(() => validate('web', 'PORTAL_ENABLED=false')).not.toThrow();
    expect(() => validate('web', 'TURNSTILE_SITE_KEY=0x4AAAAAAAtest123\nPORTAL_ENABLED=true')).not.toThrow();
    expect(buildCommand('web', parseVarsFile('PORTAL_ENABLED=true'))).toBe("pnpm exec wrangler deploy -c dist/server/wrangler.json --var 'PORTAL_ENABLED:true'");
  });

  it('it is the site\'s variable only: the admin and portal Workers refuse it', () => {
    expect(WORKERS.web.allowed).toContain('PORTAL_ENABLED');
    expect(WORKERS.admin.allowed).not.toContain('PORTAL_ENABLED');
    expect(WORKERS.portal.allowed).not.toContain('PORTAL_ENABLED');
    expect(() => validate('admin', 'PORTAL_ENABLED=true')).toThrow(/not a variable of sakem-admin-staging/);
    expect(() => validate('portal', 'PORTAL_ENABLED=true')).toThrow(/not a variable of sakem-portal-staging/);
  });

  it('refuses every value but exactly true or false, with the line, and without repeating the value; the same rule as the site\'s own', () => {
    for (const bad of ['TRUE', 'True', '1', '0', 'yes', 'on', 'enabled', 'true;', 'tru', 'truefalse', '<true or false>', '"true"x']) {
      let message = '';
      try {
        validate('web', `PORTAL_ENABLED=${bad}`);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, bad).toMatch(/^line 1 \(PORTAL_ENABLED\): /);
      if (bad.length > 3) expect(message, bad).not.toContain(bad);
    }
    expect(() => validate('web', 'PORTAL_ENABLED=maybe')).toThrow(/exactly true or false/);
    for (const sample of ['true', 'false', 'TRUE', '1', 'yes', 'on', 'enabled', 'tru']) {
      let accepted = true;
      try {
        validate('web', `PORTAL_ENABLED=${sample}`);
      } catch {
        accepted = false;
      }
      expect(accepted, sample).toBe(parsePortalEnabled(sample) !== null);
    }
  });

  it('still refuses every secret name next to it, and refuses a second line for the same name', () => {
    for (const name of ['CLOUDFLARE_API_TOKEN', 'BETTER_AUTH_SECRET', 'TURNSTILE_SECRET_KEY', 'RESEND_API_KEY']) {
      expect(() => validate('web', `PORTAL_ENABLED=true\n${name}=whatever12345`), name).toThrow(/refused, a secret/);
    }
    expect(() => validate('web', 'PORTAL_ENABLED=true\nPORTAL_ENABLED=false')).toThrow(/set twice/);
  });

  it('tells the owner, when the line is in the file, that the prerendered pages need it in the build\'s shell', () => {
    const notes = extraNotes('web', parseVarsFile('PORTAL_ENABLED=true')).join('\n');
    expect(notes).toContain('PORTAL_ENABLED=<the same value> pnpm build:staging');
    expect(extraNotes('web', parseVarsFile('TURNSTILE_SITE_KEY=0x4AAAAAAAtest123'))).toEqual([]);
    expect(extraNotes('admin', parseVarsFile('PORTAL_ENABLED=true'))).toEqual([]);
    // both notes at once keep both
    expect(extraNotes('web', parseVarsFile('PORTAL_ENABLED=true\nWEB_ANALYTICS_BEACON_ID=0123456789abcdef0123456789abcdef')).join('\n')).toMatch(/WEB_ANALYTICS_BEACON_ID=<the same value>[\s\S]*PORTAL_ENABLED=<the same value>/);
  });
});
