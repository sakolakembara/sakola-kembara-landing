// Whether this page offers the student portal (SAKEM-103, Phase A of the cutover): the navbar's "Masuk" link and its
// session script. Nothing here runs in the browser; src/components/Navbar.astro asks `portalEnabled` while it renders.
//
//   one variable, PORTAL_ENABLED, two places, because the site has two kinds of page (the same shape as the Web Analytics
//   beacon, src/lib/web-analytics.ts):
//   prerendered   built once, served by the assets layer with no Worker involved, so a Worker variable cannot
//   pages         reach them. They get the value from the BUILD (the shell environment of `astro build`, read by
//                 astro.config.mjs into the constant below). The `env` of the prerender is NOT used: it holds
//                 `.dev.vars`, a local-development file, and must never decide what static HTML contains.
//   rendered      the Worker var (`--var` at deploy), read from `env` at request time.
//   pages
//
// Each kind reads only its own source (no fallback either way), so the rule is one line and a test pins each half.
// A deploy that sets one and not the other is half switched: docs/cloudflare/cutover-runbook.md has the smoke test that
// compares a prerendered page with a rendered one. Unset (local, tests, staging, Phase A): the portal is OFF, and the
// page has no "Masuk" link and no session script at all.
import { PORTAL_ENABLED_VARIABLE, parsePortalEnabled } from '../../portal-enabled.config.mjs';

export { PORTAL_ENABLED_VARIABLE };

/** Set by astro.config.mjs (`vite.define`, and vitest.config.ts): true only when the build's shell had exactly `PORTAL_ENABLED=true`. */
declare const __PORTAL_ENABLED__: boolean;

/** What the build was given (false: not set, set to false, or not a valid value). */
export const BUILD_PORTAL_ENABLED: boolean = __PORTAL_ENABLED__;

export interface PortalSources {
  /** `Astro.isPrerendered`: true while the build renders a prerendered page. */
  prerendered: boolean;
  /** The build's value (`BUILD_PORTAL_ENABLED`). Only a prerendered page reads it. */
  build: boolean;
  /** The Worker variable, as it is (`env.PORTAL_ENABLED`). Only a page rendered by the Worker reads it. */
  runtime: string | undefined;
}

/** One line per isolate, so a wrong value on the Worker costs one log line, not one per page view. */
const reported = { invalid: false };

/**
 * Whether the portal is on for this page. A prerendered page takes the build's value, a page the Worker renders takes
 * the Worker variable. Anything but exactly `true` is off; a value that is set and is neither `true` nor `false` is off and
 * says so once, in fixed words (the value is never put in a log or a page).
 */
export function portalEnabled(
  { prerendered, build, runtime }: PortalSources,
  warn: (message: string) => void = console.warn,
  state: { invalid: boolean } = reported,
): boolean {
  if (prerendered) return build === true;
  const parsed = parsePortalEnabled(runtime);
  if (parsed === null && !state.invalid) {
    state.invalid = true;
    warn(`portal: ${PORTAL_ENABLED_VARIABLE} is set but is neither "true" nor "false"; the page is rendered with the portal off`);
  }
  return parsed === true;
}
