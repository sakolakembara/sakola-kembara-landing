// Cloudflare Web Analytics on the public pages (SAKEM-095, decision D-07): which beacon id a page is given, and the
// attributes of the tag. Nothing here runs in the browser; src/components/WebAnalytics.astro (included by the layout) renders the tag.
//
//   one variable, WEB_ANALYTICS_BEACON_ID, two places, because the site has two kinds of page:
//   prerendered   built once, served by the assets layer with no Worker involved, so a Worker variable cannot
//   pages         reach them. They get the value from the BUILD (the shell environment of `astro build`, read by
//                 astro.config.mjs into the constant below). The `env` of the prerender is NOT used: it holds
//                 `.dev.vars`, a local-development file, and must never put a value into static HTML.
//   rendered      the Worker var (`--var` at deploy), read from `env` at request time.
//   pages
//
// Each kind reads only its own source (no fallback either way), so the rule is one line and a test pins each half.
// A deploy that sets one and not the other is half covered; docs/cloudflare/cutover-runbook.md has the smoke test
// that compares a prerendered page with an SSR page. Unset (local, tests, staging): no script and no tag at all.
import { BEACON_ID_VARIABLE, BEACON_REPORT_ORIGIN, BEACON_SCRIPT_URL, parseBeaconId } from '../../web-analytics.config.mjs';

export { BEACON_ID_VARIABLE, BEACON_REPORT_ORIGIN, BEACON_SCRIPT_URL };

/** Set by astro.config.mjs (`vite.define`, and vitest.config.ts): the build's value, already validated, or null. */
declare const __WEB_ANALYTICS_BEACON_ID__: string | null;

/** What the build was given (null: no value, or one that is not a beacon id). */
export const BUILD_BEACON_ID: string | null = __WEB_ANALYTICS_BEACON_ID__;

export interface BeaconSources {
  /** `Astro.isPrerendered`: true while the build renders a prerendered page. */
  prerendered: boolean;
  /** The build's value (`BUILD_BEACON_ID`). Only a prerendered page reads it. */
  build: string | null;
  /** The Worker variable, as it is (`env.WEB_ANALYTICS_BEACON_ID`). Only a page rendered by the Worker reads it. */
  runtime: string | undefined;
}

/** One line per isolate, so a wrong value on the Worker costs one log line, not one per page view. */
const reported = { invalid: false };

/**
 * The beacon id this page gets, or null (no beacon). A prerendered page takes the build's value, a page the Worker
 * renders takes the Worker variable; an invalid Worker variable is nothing (and says so once, in fixed words: the
 * value is never put in a log or a page).
 */
export function webAnalyticsBeaconId(
  { prerendered, build, runtime }: BeaconSources,
  warn: (message: string) => void = console.warn,
  state: { invalid: boolean } = reported,
): string | null {
  if (prerendered) return parseBeaconId(build);
  if (runtime === undefined || runtime.trim() === '') return null;
  const id = parseBeaconId(runtime);
  if (id === null && !state.invalid) {
    state.invalid = true;
    warn(`web analytics: ${BEACON_ID_VARIABLE} is set but is not a beacon id (32 hexadecimal characters); the page is rendered without the beacon`);
  }
  return id;
}

/** The value of the tag's `data-cf-beacon` attribute: Cloudflare's JSON. The attribute escaping is the template's. */
export function beaconAttribute(id: string): string {
  return JSON.stringify({ token: id });
}
