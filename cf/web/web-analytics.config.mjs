// The Cloudflare Web Analytics beacon (SAKEM-095, decision D-07): its constants and the one validation, in a pure
// module (no Node imports) so the build config (astro.config.mjs), the layout's helper (src/lib/web-analytics.ts),
// the e2e scripts and the tests all agree. How it works and why: docs/cloudflare/web-skeleton.md, "Web Analytics".
//
// Source of the snippet's form (read 2026-10-15): https://developers.cloudflare.com/web-analytics/faq/
//   <script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "$SITE_TOKEN"}'></script>
// `type="module"` is what the page says the dashboard's snippet carries (it keeps old browsers from running a script
// they cannot parse); a module script is deferred by definition, so there is no `defer` next to it.

/** The beacon script of a manual setup. The exact URL, which is also what a Content-Security-Policy `script-src` would name. */
export const BEACON_SCRIPT_URL = 'https://static.cloudflareinsights.com/beacon.min.js';

/**
 * Where a manually embedded beacon reports (a proxied zone with the automatic setup reports to its own `/cdn-cgi/rum`
 * instead, which is not what this site uses). It is what a Content-Security-Policy `connect-src` would name. This site
 * sends no Content-Security-Policy today, so nothing names either value in a header; tests/web-analytics.test.ts pins both.
 */
export const BEACON_REPORT_ORIGIN = 'https://cloudflareinsights.com';

/**
 * The name of the variable, at build time (the shell environment of `astro build`: the prerendered pages) and at run
 * time (a Worker variable, `--var` at deploy: the pages the Worker renders). It holds what Cloudflare calls the site
 * token (`"token"` in the snippet). It is PUBLIC (every page of the site carries it), and it is deliberately not named
 * `..._TOKEN`, so the deploy-command printer's refusal of secret names (`TOKEN`) stays whole.
 */
export const BEACON_ID_VARIABLE = 'WEB_ANALYTICS_BEACON_ID';

/** The shape of a site token: 32 hexadecimal characters. Anchored: a token inside other text is not one. */
const BEACON_ID = /^[0-9a-fA-F]{32}$/;

/**
 * The beacon id in `value` (surrounding whitespace ignored), or null when `value` is not exactly 32 hexadecimal
 * characters, is not a string or is missing. It never throws and never returns or logs what it was given: an invalid
 * value is simply nothing, so it cannot reach a page.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function parseBeaconId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return BEACON_ID.test(id) ? id : null;
}
