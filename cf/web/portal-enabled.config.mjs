// The "student portal is on" switch of the public pages (SAKEM-103, Phase A of the cutover): its name and the one
// validation, in a pure module (no Node imports) so the build config (astro.config.mjs), the helper the navbar uses
// (src/lib/portal-enabled.ts), the e2e scripts and the tests all agree. How it works and how Phase B turns it on:
// docs/cloudflare/web-skeleton.md, "The student portal switch".
//
// Phase A: the public site and the admin move to sakolakembara.org first, and the student portal follows later (Phase B),
// so until then the site must not offer "Masuk" or ask the portal Worker for a session. Registration stays on the
// external form that `/daftar` (an admin shortlink) points at.

/**
 * The name of the variable, at build time (the shell environment of `astro build`: the prerendered pages) and at run
 * time (a Worker variable, `--var` at deploy: the pages the Worker renders). PUBLIC (it only decides whether a link and a
 * script are in the HTML), optional, and OFF when unset: there is no way to get the portal's links by forgetting something.
 */
export const PORTAL_ENABLED_VARIABLE = 'PORTAL_ENABLED';

/**
 * Strict: exactly `true` or `false` (surrounding whitespace ignored). Unset, `undefined`, `null` and an empty value are
 * `false` (the default is OFF, and silence: nothing was configured). Anything else (`TRUE`, `1`, `yes`, `on`, a boolean or
 * a number that reached the Worker as a JSON value, text around the word) is `null`, which callers treat as OFF and report
 * once, in fixed words, without repeating the value. It never throws.
 *
 * @param {unknown} value
 * @returns {boolean | null}  true: on. false: off, or not configured. null: set, but not a valid value.
 */
export function parsePortalEnabled(value) {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '') return false;
  if (text === 'true') return true;
  if (text === 'false') return false;
  return null;
}
