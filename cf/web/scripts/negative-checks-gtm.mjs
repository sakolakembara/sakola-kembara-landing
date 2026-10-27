// Proves the tests of Google Tag Manager are not vacuous (SAKEM-108): each check breaks ONE safeguard (the id's shape, which
// page reads which source, the log line, the two parts, the layout, the build constant, the printers), runs the tests that
// must notice, expects them to FAIL, and always restores the file.
//
//   node scripts/negative-checks-gtm.mjs        (pnpm test:negative:gtm)
//
// Run it on a clean tree. A pattern found other than exactly once is reported as FAIL, so a refactor that moves the code
// cannot silently turn a check into a no-op. The rendered and prerendered pages themselves are covered by scripts/e2e.mjs
// (group "gtm") and scripts/e2e-analytics.mjs, not by these.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
process.chdir(webRoot);

const TESTS = ['tests/google-tag-manager.test.ts', 'tests/production-scripts.test.ts'];
const config = 'google-tag-manager.config.mjs';
const lib = 'src/lib/google-tag-manager.ts';
const layout = 'src/layouts/Base.astro';
const head = 'src/components/GoogleTagManager.astro';
const noscript = 'src/components/GoogleTagManagerNoscript.astro';
const astroConfig = 'astro.config.mjs';
const staging = '../scripts/staging-deploy-command.mjs';
const production = '../scripts/production-deploy-command.mjs';

const checks = [
  // the id's shape (it is written into an inline script)
  { name: 'lower-case or other characters are accepted', file: config, from: 'const GTM_ID = /^GTM-[0-9A-Z]{4,12}$/;', to: 'const GTM_ID = /^GTM-[^\\s]{4,12}$/;' },
  { name: 'the pattern is not anchored', file: config, from: 'const GTM_ID = /^GTM-[0-9A-Z]{4,12}$/;', to: 'const GTM_ID = /GTM-[0-9A-Z]{4,12}/;' },
  { name: 'surrounding whitespace is not ignored', file: config, from: 'const id = value.trim();', to: 'const id = value;' },
  { name: 'the variable is renamed with TOKEN in it', file: config, from: "export const GTM_ID_VARIABLE = 'GTM_CONTAINER_ID';", to: "export const GTM_ID_VARIABLE = 'GTM_TOKEN';" },

  // which page reads which source
  { name: 'a prerendered page falls back to the Worker variable', file: lib, from: 'if (prerendered) return parseGtmId(build);', to: 'if (prerendered) return parseGtmId(build ?? runtime);' },
  { name: 'a rendered page falls back to the build value', file: lib, from: "if (runtime === undefined || runtime.trim() === '') return null;", to: "if (runtime === undefined || runtime.trim() === '') return parseGtmId(build);" },

  // the log line
  { name: 'an invalid value is repeated in the log line', file: lib, from: 'the page is rendered without it`);', to: 'the page is rendered without it: ${runtime}`);' },
  { name: 'the invalid-value line is logged on every render', file: lib, from: 'if (id === null && !state.invalid) {', to: 'if (id === null) {' },

  // the two parts
  { name: 'the head script sends to another data layer', file: lib, from: "(window,document,'script','dataLayer',", to: "(window,document,'script','gtmLayer'," },
  { name: 'the id is written without quotes', file: lib, from: '${JSON.stringify(id)});`', to: '${id});`' },
  { name: 'the frame loads another page', file: lib, from: 'return `${GTM_ORIGIN}/ns.html?id=${id}`;', to: 'return `${GTM_ORIGIN}/ns.html?id=${id}&x=1`;' },
  { name: 'the head part is rendered without an id', file: head, from: '{id && <script is:inline', to: '{true && <script is:inline' },
  { name: 'the frame is visible', file: noscript, from: 'style="display:none;visibility:hidden"', to: 'style=""' },
  { name: 'the page\'s kind is no longer told to the head part', file: head, from: 'prerendered: Astro.isPrerendered', to: 'prerendered: false' },

  // the layout
  { name: 'the head part is placed with whitespace before it', file: layout, from: '<meta charset="utf-8" /><GoogleTagManager />', to: '<meta charset="utf-8" />\n    <GoogleTagManager />' },
  { name: 'the frame is placed after the footer instead of after <body>', file: layout, from: '<body class="antialiased"><GoogleTagManagerNoscript />', to: '<body class="antialiased">' },

  // the build constant
  { name: 'the build constant is not defined', file: astroConfig, from: ', __GTM_CONTAINER_ID__: JSON.stringify(gtmId)', to: '' },

  // the printers
  { name: 'staging accepts the id (test visits would reach Google Analytics)', file: staging, from: "  [/^GTM_CONTAINER_ID$/, 'production only (SAKEM-108): a staging visit would be counted in the real Google Analytics'],\n", to: '' },
  { name: 'production no longer requires the id', file: production, from: "{ name: 'GTM_CONTAINER_ID', required: true, kind: 'gtm' }", to: "{ name: 'GTM_CONTAINER_ID', required: false, kind: 'gtm' }" },
  { name: 'the build line no longer carries the id', file: production, from: "const prefix = ['WEB_ANALYTICS_BEACON_ID', 'GTM_CONTAINER_ID', 'PORTAL_ENABLED']", to: "const prefix = ['WEB_ANALYTICS_BEACON_ID', 'PORTAL_ENABLED']" },
  { name: 'the dist/ check no longer looks at Tag Manager', file: production, from: "    problems.push(...builtGtmProblems(html, gtmId).map((p) => `dist/client/index.html: ${p}`));\n", to: '' },
  { name: 'the printer accepts any shape for the id', file: production, from: 'return parseGtmId(value) === value ? null :', to: 'return value ? null :' },
];

let bad = 0;
for (const check of checks) {
  const original = readFileSync(check.file, 'utf8');
  const found = original.split(check.from).length - 1;
  if (found !== 1) {
    console.log(`FAIL  ${check.name}: pattern found ${found} times in ${check.file}, expected exactly once`);
    bad++;
    continue;
  }
  try {
    writeFileSync(check.file, original.replace(check.from, () => check.to));
    const run = spawnSync('pnpm', ['exec', 'vitest', 'run', ...TESTS], { encoding: 'utf8' });
    const failed = (run.stdout + run.stderr).match(/Tests\s+(\d+) failed/);
    if (run.status !== 0 && failed) console.log(`OK    ${check.name}: ${failed[1]} test(s) failed as they should`);
    else {
      console.log(`FAIL  ${check.name}: tests still pass (exit ${run.status})`);
      bad++;
    }
  } finally {
    writeFileSync(check.file, original);
  }
}
console.log(bad === 0 ? `\nAll ${checks.length} safeguards are covered by tests.` : `\n${bad} of ${checks.length} checks did not behave.`);
process.exit(bad === 0 ? 0 : 1);
