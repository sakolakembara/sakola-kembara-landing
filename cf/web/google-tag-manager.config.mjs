// Google Tag Manager (SAKEM-108, decided by Dzul on 2026-10-27, next to the Cloudflare Web Analytics beacon of SAKEM-095):
// its constants and the one validation, in a pure module (no Node imports) so the build config (astro.config.mjs), the
// layout's helper (src/lib/google-tag-manager.ts), the deploy-command printer, the e2e scripts and the tests all agree.
// How it works and why: docs/cloudflare/web-skeleton.md, "Google Tag Manager".
//
// Source of the snippet (Google's install code for a web container, as given by Dzul on 2026-10-27): one inline script as
// high in <head> as possible, and a <noscript><iframe> right after the opening <body> tag.

/** The origin both parts load from. It is what a Content-Security-Policy `script-src` and `frame-src` would name. */
export const GTM_ORIGIN = 'https://www.googletagmanager.com';

/**
 * The name of the variable, at build time (the shell environment of `astro build`: the prerendered pages) and at run time
 * (a Worker variable, `--var` at deploy: the pages the Worker renders). It holds the container id, `GTM-` and a few
 * letters and digits. It is PUBLIC (every page of the site carries it), and it has no `TOKEN` or `SECRET` in it, so the
 * deploy-command printers' refusal of secret names stays whole.
 */
export const GTM_ID_VARIABLE = 'GTM_CONTAINER_ID';

/** The shape of a container id: `GTM-` then 4 to 12 upper-case letters or digits. Anchored: an id inside other text is not one. */
const GTM_ID = /^GTM-[0-9A-Z]{4,12}$/;

/**
 * The container id in `value` (surrounding whitespace ignored), or null when `value` is not one, is not a string or is
 * missing. It never throws and never returns or logs what it was given: an invalid value is simply nothing, so it cannot
 * reach a page (the id is written into an inline script, so only this exact shape may get there).
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function parseGtmId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return GTM_ID.test(id) ? id : null;
}
