// Google Tag Manager on the public pages (SAKEM-108): which container id a page is given, and the two parts of Google's
// install code. Nothing here runs in the browser; src/components/GoogleTagManager.astro (in <head>) and
// GoogleTagManagerNoscript.astro (right after <body>), both included by the layout, render the parts.
//
// The id has the two sources of the Web Analytics beacon (src/lib/web-analytics.ts), for the same reason:
//   prerendered pages   static files: the value of the BUILD (the shell environment of `astro build`, read by
//                       astro.config.mjs into the constant below), never the prerender's `env` (it holds `.dev.vars`).
//   rendered pages      the Worker var (`--var` at deploy), read from `env` at request time.
// Each kind reads only its own source (no fallback either way). Unset (local, tests, staging): nothing at all on the page,
// so no visit of a test run is counted in Google Analytics.
//
// The portal and the admin are other Workers with their own SPAs and never load this (tests/google-tag-manager.test.ts).
import { GTM_ID_VARIABLE, GTM_ORIGIN, parseGtmId } from '../../google-tag-manager.config.mjs';

export { GTM_ID_VARIABLE, GTM_ORIGIN };

/** Set by astro.config.mjs (`vite.define`, and vitest.config.ts): the build's value, already validated, or null. */
declare const __GTM_CONTAINER_ID__: string | null;

/** What the build was given (null: no value, or one that is not a container id). */
export const BUILD_GTM_ID: string | null = __GTM_CONTAINER_ID__;

export interface GtmSources {
  /** `Astro.isPrerendered`: true while the build renders a prerendered page. */
  prerendered: boolean;
  /** The build's value (`BUILD_GTM_ID`). Only a prerendered page reads it. */
  build: string | null;
  /** The Worker variable, as it is (`env.GTM_CONTAINER_ID`). Only a page rendered by the Worker reads it. */
  runtime: string | undefined;
}

/** One line per isolate, so a wrong value on the Worker costs one log line, not one per page view. */
const reported = { invalid: false };

/**
 * The container id this page gets, or null (no tag). A prerendered page takes the build's value, a page the Worker renders
 * takes the Worker variable; an invalid Worker variable is nothing (and says so once, in fixed words: the value is never put
 * in a log or a page).
 */
export function gtmContainerId(
  { prerendered, build, runtime }: GtmSources,
  warn: (message: string) => void = console.warn,
  state: { invalid: boolean } = reported,
): string | null {
  if (prerendered) return parseGtmId(build);
  if (runtime === undefined || runtime.trim() === '') return null;
  const id = parseGtmId(runtime);
  if (id === null && !state.invalid) {
    state.invalid = true;
    warn(`google tag manager: ${GTM_ID_VARIABLE} is set but is not a container id (GTM- and 4 to 12 letters or digits); the page is rendered without it`);
  }
  return id;
}

/**
 * The inline script of the <head> part: Google's code, unchanged but for its line breaks, with the id as a JSON string. The id
 * only ever comes from `gtmContainerId`, so it is `GTM-` and letters and digits, and cannot end the script or the string.
 */
export function gtmHeadScript(id: string): string {
  return (
    "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});" +
    "var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;" +
    `j.src='${GTM_ORIGIN}/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${JSON.stringify(id)});`
  );
}

/** The address of the <noscript> iframe of the <body> part. */
export function gtmNoscriptSrc(id: string): string {
  return `${GTM_ORIGIN}/ns.html?id=${id}`;
}
