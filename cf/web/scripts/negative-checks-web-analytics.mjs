// Proves the tests of the Web Analytics beacon are not vacuous (SAKEM-095): each check breaks ONE safeguard (the id's shape,
// which page reads which source, the log line, the tag's form, the headers, the deploy-command printer, the build constant),
// runs the tests that must notice, expects them to FAIL, and always restores the file.
//
//   node scripts/negative-checks-web-analytics.mjs        (pnpm test:negative:web-analytics)
//
// Run it on a clean tree. A pattern found other than exactly once is reported as FAIL, so a refactor that moves the code
// cannot silently turn a check into a no-op. The Worker half (the tag in the pages the Worker renders) and the prerendered
// half (a second build) are covered by scripts/e2e.mjs and scripts/e2e-analytics.mjs, not by these.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
process.chdir(webRoot);

const TESTS = ['tests/web-analytics.test.ts'];
const config = 'web-analytics.config.mjs';
const lib = 'src/lib/web-analytics.ts';
const layout = 'src/layouts/Base.astro';
const component = 'src/components/WebAnalytics.astro';
const headers = 'src/lib/security-headers.ts';
const astroConfig = 'astro.config.mjs';
const printer = '../scripts/staging-deploy-command.mjs';

const WARN_LINE = 'warn(`web analytics: ${BEACON_ID_VARIABLE} is set but is not a beacon id (32 hexadecimal characters); the page is rendered without the beacon`);';

const checks = [
  // the id's shape
  { name: 'an id longer than 32 characters is accepted', file: config, from: '[0-9a-fA-F]{32}$/;', to: '[0-9a-fA-F]{32,}$/;' },
  { name: 'a non-hexadecimal character is accepted', file: config, from: '[0-9a-fA-F]{32}$/;', to: '[0-9a-zA-Z]{32}$/;' },
  { name: 'the pattern is not anchored (an id inside other text, or several lines, is accepted)', file: config, from: 'const BEACON_ID = /^[0-9a-fA-F]{32}$/;', to: 'const BEACON_ID = /[0-9a-fA-F]{32}/;' },
  { name: 'surrounding whitespace is not ignored', file: config, from: 'const id = value.trim();', to: 'const id = value;' },
  { name: 'a value that is not a string is not refused (it throws or passes)', file: config, from: "if (typeof value !== 'string') return null;", to: '' },
  { name: 'the variable is renamed with TOKEN in it (the printer\'s secret guard would have to be loosened)', file: config, from: "export const BEACON_ID_VARIABLE = 'WEB_ANALYTICS_BEACON_ID';", to: "export const BEACON_ID_VARIABLE = 'WEB_ANALYTICS_TOKEN';" },

  // which page reads which source
  { name: 'a prerendered page falls back to the Worker variable (the prerender\'s env holds .dev.vars)', file: lib, from: 'if (prerendered) return parseBeaconId(build);', to: 'if (prerendered) return parseBeaconId(build ?? runtime);' },
  { name: 'a rendered page falls back to the build value (the variable could not be unset to switch it off)', file: lib, from: "if (runtime === undefined || runtime.trim() === '') return null;", to: "if (runtime === undefined || runtime.trim() === '') return parseBeaconId(build);" },

  // the log line
  { name: 'an invalid value is repeated in the log line', file: lib, from: WARN_LINE, to: 'warn(`web analytics: ${BEACON_ID_VARIABLE} is set but is not a beacon id (32 hexadecimal characters); the page is rendered without the beacon; value: ${runtime}`);' },
  { name: 'the invalid-value line is logged on every render, not once per isolate', file: lib, from: 'if (id === null && !state.invalid) {', to: 'if (id === null) {' },

  // the tag
  { name: 'the attribute carries more than the token', file: lib, from: 'return JSON.stringify({ token: id });', to: "return JSON.stringify({ token: id, spa: true });" },
  { name: 'the tag is not a module script (Cloudflare\'s documented form)', file: component, from: '<script is:inline type="module" src={BEACON_SCRIPT_URL}', to: '<script is:inline defer src={BEACON_SCRIPT_URL}' },
  { name: 'the tag is rendered without an id', file: component, from: '{beaconId && <script is:inline', to: '{true && <script is:inline' },
  { name: 'the page\'s kind is no longer told (a prerendered page would read the Worker variable)', file: component, from: 'prerendered: Astro.isPrerendered', to: 'prerendered: false' },

  { name: 'the component is included with whitespace before it (an unset page would no longer be byte for byte as before)', file: layout, from: '<Footer /><WebAnalytics />', to: '<Footer />\n      <WebAnalytics />' },

  // headers
  { name: 'a Content-Security-Policy appears in the security headers without the beacon\'s two origins', file: headers, from: "  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',", to: "  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',\n  'Content-Security-Policy': \"default-src 'self'\"," },

  // the build constant
  { name: 'the build constant is not defined (the prerendered pages could never get the variable)', file: astroConfig, from: ', __WEB_ANALYTICS_BEACON_ID__: JSON.stringify(beaconId)', to: '' },

  // the deploy-command printer
  { name: 'the printer accepts any hexadecimal length for the id', file: printer, from: '/^[0-9a-fA-F]{32}$/.test(value)', to: '/^[0-9a-fA-F]{10,64}$/.test(value)' },
  { name: 'the printer stops refusing names with TOKEN in them', file: printer, from: '/^BETTER_AUTH_SECRET$|SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE/i', to: '/^BETTER_AUTH_SECRET$|SECRET|PASSWORD|API_KEY|PRIVATE/i' },
  { name: 'the admin Worker accepts the site\'s variable', file: printer, from: "allowed: ['TURNSTILE_SITE_KEY', 'UPLOADS_BASE_URL', 'SITE_URL', 'EMAIL_FROM'],", to: "allowed: ['TURNSTILE_SITE_KEY', 'UPLOADS_BASE_URL', 'SITE_URL', 'EMAIL_FROM', 'WEB_ANALYTICS_BEACON_ID']," },
  { name: 'the printer stops telling the owner about the build\'s shell', file: printer, from: "if (worker === 'web' && entries.some((e) => e.name === 'WEB_ANALYTICS_BEACON_ID')) {", to: 'if (false) {' },
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
