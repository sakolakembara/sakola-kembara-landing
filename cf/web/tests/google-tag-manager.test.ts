import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { WORKERS as STAGING_WORKERS, parseVarsFile, validateVars as validateStaging } from '../../scripts/staging-deploy-command.mjs';
import { SPECS, builtGtmProblems, validateVars as validateProduction } from '../../scripts/production-deploy-command.mjs';
import { BUILD_GTM_ID, GTM_ID_VARIABLE, GTM_ORIGIN, gtmContainerId, gtmHeadScript, gtmNoscriptSrc } from '~/lib/google-tag-manager';
import { parseGtmId } from '../google-tag-manager.config.mjs';
import { readWeb, repoRoot, webRoot } from './helpers';

// Google Tag Manager (SAKEM-108): which container id a page gets, the two parts of Google's install code, where they are NOT,
// the declarations of the variable, and both deploy-command printers. The rendered pages are checked against the built Worker
// by scripts/e2e.mjs (group "gtm"), the prerendered ones against a second build by scripts/e2e-analytics.mjs. The ids are invented.

const ID = 'GTM-TEST123';
const OTHER_ID = 'GTM-0THER99';

describe('the container id: GTM- and 4 to 12 upper-case letters or digits, anything else is nothing', () => {
  it('accepts the shape, with surrounding whitespace ignored', () => {
    for (const id of [ID, OTHER_ID, 'GTM-ABCD', 'GTM-ABCDEFGHIJKL', 'GTM-MFNHK7FG']) expect(parseGtmId(id), id).toBe(id);
    expect(parseGtmId(`  ${ID}\n`)).toBe(ID);
  });

  it('refuses everything else, including what would break out of the inline script', () => {
    const invalid = [undefined, null, 42, {}, [], '', ' ', 'GTM-', 'GTM-ABC', 'GTM-ABCDEFGHIJKLM', 'gtm-test123', 'GTM-test123', 'G-TEST123', 'UA-1234-1', `${ID} ${ID}`, `${ID}\n${OTHER_ID}`, `x${ID}`, `${ID}x!`,
      'GTM-AB"CD', "GTM-AB'CD", 'GTM-AB</script>', 'GTM-ABC D', 'GTM-ＡＢＣＤ'];
    for (const value of invalid) expect(parseGtmId(value), String(value)).toBeNull();
    expect(() => parseGtmId('x'.repeat(1_000_000))).not.toThrow();
  });
});

describe('which id a page gets: the build for a prerendered page, the Worker variable for a rendered one', () => {
  const quiet = () => {};

  it('a prerendered page reads the build only, never the Worker variable', () => {
    expect(gtmContainerId({ prerendered: true, build: ID, runtime: undefined }, quiet)).toBe(ID);
    expect(gtmContainerId({ prerendered: true, build: null, runtime: ID }, quiet)).toBeNull();
    expect(gtmContainerId({ prerendered: true, build: ID, runtime: OTHER_ID }, quiet)).toBe(ID);
    expect(gtmContainerId({ prerendered: true, build: 'nope', runtime: ID }, quiet)).toBeNull();
  });

  it('a rendered page reads the Worker variable only, never the build', () => {
    expect(gtmContainerId({ prerendered: false, build: null, runtime: ID }, quiet)).toBe(ID);
    expect(gtmContainerId({ prerendered: false, build: ID, runtime: undefined }, quiet)).toBeNull();
    expect(gtmContainerId({ prerendered: false, build: ID, runtime: '' }, quiet)).toBeNull();
    expect(gtmContainerId({ prerendered: false, build: ID, runtime: OTHER_ID }, quiet)).toBe(OTHER_ID);
  });

  it('unset is silent; an invalid value is said once per isolate, in fixed words, without the value', () => {
    const warn = vi.fn();
    for (const runtime of [undefined, '', '  ']) expect(gtmContainerId({ prerendered: false, build: null, runtime }, warn, { invalid: false })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    const state = { invalid: false };
    for (let i = 0; i < 4; i++) expect(gtmContainerId({ prerendered: false, build: null, runtime: 'GTM-secretlooking' }, warn, state)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0]![0] as string;
    expect(line).toContain(GTM_ID_VARIABLE);
    expect(line).not.toContain('secretlooking');
  });

  it('under vitest nothing was built, so there is no build value', () => {
    expect(BUILD_GTM_ID).toBeNull();
  });
});

describe('the two parts', () => {
  it('the head script is Google\'s code for a web container, with the id as a JSON string', () => {
    const script = gtmHeadScript(ID);
    expect(script).toBe(
      "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0]," +
        "j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;" +
        `f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',"${ID}");`,
    );
    // it runs: the loader gets inserted with the id, and the data layer gets its start event
    const inserted: { src?: string; async?: boolean }[] = [];
    const first = { parentNode: { insertBefore: (j: { src?: string }) => inserted.push(j) } };
    const w: Record<string, unknown> = {};
    const d = { getElementsByTagName: () => [first], createElement: () => ({}) };
    new Function('window', 'document', script)(w, d);
    expect(inserted).toEqual([{ async: true, src: `https://www.googletagmanager.com/gtm.js?id=${ID}` }]);
    expect((w.dataLayer as { event: string }[])[0]!.event).toBe('gtm.js');
  });

  it('the noscript frame loads ns.html with the id, from the one origin', () => {
    expect(GTM_ORIGIN).toBe('https://www.googletagmanager.com');
    // the name the printers, the runbook and the Worker know, with nothing in it that the printers' secret guard refuses
    expect(GTM_ID_VARIABLE).toBe('GTM_CONTAINER_ID');
    expect(GTM_ID_VARIABLE).not.toMatch(/SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE/i);
    expect(gtmNoscriptSrc(ID)).toBe(`https://www.googletagmanager.com/ns.html?id=${ID}`);
  });

  describe('the components and the layout', () => {
    const layout = readWeb('src/layouts/Base.astro');
    const head = readWeb('src/components/GoogleTagManager.astro');
    const noscript = readWeb('src/components/GoogleTagManagerNoscript.astro');
    const template = (source: string) => source.replace(/^---[\s\S]*?\n---\n/, '').trim();

    it('each component renders its part once, guarded by the id, and asks for the id with the page\'s own kind', () => {
      expect(template(head)).toBe('{id && <script is:inline set:html={gtmHeadScript(id)} />}');
      expect(template(noscript)).toBe('{id && <noscript><iframe src={gtmNoscriptSrc(id)} height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>}');
      for (const source of [head, noscript]) {
        expect(source).toContain('const id = gtmContainerId({ prerendered: Astro.isPrerendered, build: BUILD_GTM_ID, runtime: env.GTM_CONTAINER_ID });');
        expect(source).toContain("import { env } from 'cloudflare:workers';");
      }
    });

    it('the layout puts the script right after the charset meta tag and the frame right after the opening body tag, with no whitespace, once each', () => {
      expect(layout).toContain('<meta charset="utf-8" /><GoogleTagManager />');
      expect(layout).toContain('<body class="antialiased"><GoogleTagManagerNoscript />');
      const page = layout.slice(layout.indexOf('<!doctype html>'));
      expect(page.split('<GoogleTagManager />').length - 1).toBe(1);
      expect(page.split('<GoogleTagManagerNoscript />').length - 1).toBe(1);
      expect(layout).not.toMatch(/googletagmanager|gtmHeadScript|gtmNoscriptSrc/);
    });

    it('nothing else renders the components or names the origin', () => {
      const files = walkAll(path.join(webRoot, 'src')).filter((f) => /\.(ts|astro)$/.test(f) && !f.includes(`${path.sep}generated${path.sep}`));
      const own = new Set(['src/lib/google-tag-manager.ts', 'src/components/GoogleTagManager.astro', 'src/components/GoogleTagManagerNoscript.astro', 'src/layouts/Base.astro', 'src/env.d.ts'].map((f) => path.join(...f.split('/'))));
      for (const file of files) {
        const rel = path.relative(webRoot, file);
        if (own.has(rel)) continue;
        expect(readFileSync(file, 'utf8'), rel).not.toMatch(/googletagmanager|GoogleTagManager|gtmContainerId|GTM_CONTAINER_ID/);
      }
    });
  });
});

describe('where it is not: the admin and the portal', () => {
  it('nothing of cf/admin (the admin SPA, the portal SPA, both Workers) names Tag Manager, its host or its variable', () => {
    const root = path.join(repoRoot, 'cf/admin');
    const skip = new Set(['node_modules', 'dist', '.wrangler', '.astro']);
    const files = walkAll(root, skip).filter((f) => /\.(ts|tsx|html|json|jsonc|mjs|css|example)$/.test(f) && statSync(f).size < 2_000_000);
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) expect(readFileSync(file, 'utf8'), path.relative(repoRoot, file)).not.toMatch(/googletagmanager|GTM_CONTAINER_ID|GTM-[0-9A-Z]{4,}/);
  });
});

describe('the variable is declared where the other public variables are', () => {
  it('env.d.ts, and wrangler.jsonc in the comment only, never with a value', () => {
    expect(readWeb('src/env.d.ts')).toContain('GTM_CONTAINER_ID?: string;');
    const file = readWeb('wrangler.jsonc');
    expect(file).toMatch(/\/\/ - GTM_CONTAINER_ID \(a "vars" entry too, optional, PUBLIC; SAKEM-108\)/);
    expect(file.replace(/^\s*\/\/.*$/gm, '')).not.toContain('GTM');
  });

  it('the local example leaves it commented out, staging leaves it out, production has a placeholder: no real id in git', () => {
    const dev = readWeb('dev.vars.example');
    expect(dev).toMatch(/^# GTM_CONTAINER_ID=$/m);
    for (const name of ['dev.vars.example', 'staging.vars.example']) expect(parseVarsFile(readWeb(name)).map((e: { name: string }) => e.name), name).not.toContain('GTM_CONTAINER_ID');
    expect(readWeb('production.vars.example')).toMatch(/^GTM_CONTAINER_ID=<GTM- container id from Tag Manager>$/m);
    for (const name of ['dev.vars.example', 'staging.vars.example', 'production.vars.example', 'wrangler.jsonc']) expect(readWeb(name), name).not.toMatch(/GTM-[0-9A-Z]{4,}/);
  });

  it('astro.config.mjs takes the prerendered pages\' value from the build\'s process environment only, validated; vitest has none', () => {
    const config = readWeb('astro.config.mjs');
    expect(config).toContain('const gtmId = parseGtmId(process.env[GTM_ID_VARIABLE]);');
    expect(config).toContain('__GTM_CONTAINER_ID__: JSON.stringify(gtmId)');
    expect(config).not.toMatch(/import\.meta\.env\.\w*GTM/);
    expect(readWeb('vitest.config.ts')).toContain('__GTM_CONTAINER_ID__: JSON.stringify(null)');
  });
});

describe('the deploy-command printers', () => {
  it('staging refuses it with its reason: no test visit is counted in Google Analytics', () => {
    expect(STAGING_WORKERS.web.allowed).not.toContain('GTM_CONTAINER_ID');
    expect(() => validateStaging('web', parseVarsFile(`GTM_CONTAINER_ID=${ID}`))).toThrow(/refused, production only \(SAKEM-108\)/);
  });

  it('production requires it for the site only, and accepts exactly what the site accepts, without repeating a refused value', () => {
    expect(SPECS.web.find((spec) => spec.name === 'GTM_CONTAINER_ID')).toEqual({ name: 'GTM_CONTAINER_ID', required: true, kind: 'gtm' });
    expect(SPECS.admin.map((spec) => spec.name)).not.toContain('GTM_CONTAINER_ID');
    for (const value of [ID, OTHER_ID, 'GTM-ABCD', 'GTM-abc1234', 'GTM-ABC', 'G-ABC1234', 'GTM-ABC1234x!', 'UA-1234-1']) {
      let message = '';
      try {
        validateProduction('web', parseVarsFile(`GTM_CONTAINER_ID=${value}`));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message === '', value).toBe(parseGtmId(value) === value);
      if (message) expect(message, value).not.toContain(value);
    }
  });

  it('the dist/ check: one script and one frame with the file\'s id, or a reason', () => {
    const page = (id: string, n = 1) =>
      `<head>${`<script>(…)(window,document,'script','dataLayer',"${id}");j.src='https://www.googletagmanager.com/gtm.js?id='</script>`.repeat(n)}</head><body>${`<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${id}"></iframe></noscript>`.repeat(n)}</body>`;
    expect(builtGtmProblems(page(ID), ID)).toEqual([]);
    expect(builtGtmProblems('<head></head><body></body>', ID)[0]).toMatch(/no Google Tag Manager/);
    expect(builtGtmProblems(page(OTHER_ID), ID)[0]).toMatch(/not the one in the vars file/);
    expect(builtGtmProblems(page(ID, 2), ID)[0]).toMatch(/2 Tag Manager scripts and 2 noscript frames/);
  });
});

function walkAll(dir: string, skip: Set<string> = new Set()): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (skip.has(name)) return [];
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? walkAll(file, skip) : [file];
  });
}
