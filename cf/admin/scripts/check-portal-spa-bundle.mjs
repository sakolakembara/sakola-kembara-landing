// Checks the student portal's SPA build in dist/portal-spa (run `pnpm build:portal-spa` first):
//
//   pnpm build:portal-spa && pnpm check:portal-spa
//
// It prints the size of every JS and CSS file, raw and gzip, and FAILS when
//   - the development mock (portal-spa/src/mock) ended up in the build: it answers every call with invented data;
//   - any URL in index.html does not start with /portal/, or names a file that is not at that path under
//     dist/portal-spa (the Worker's assets are found by the pathname as it arrives);
//   - the CSS or the JS refers to a file (`url(...)`, a chunk) that is not there;
//   - dist/portal-spa/index.html (the SPA fallback) is missing or differs from portal/index.html;
//   - _headers is missing, or lost the rules the portal relies on (immutable hashed assets, the CSP);
//   - a budget is exceeded (docs/cloudflare/portal-architecture.md#53-bundle-budget-proposal-enforced-by-pnpm-checkportal-spa):
//     initial JS 130 kB gzip, each lazy chunk (the wizard) 90 kB, CSS 14 kB; the fonts are the latin subset only;
//   - zod is in the initial chunk (it belongs to the wizard's lazy chunk only);
//   - the CSS lacks classes only this app's own files, or the module shared with the admin (shared/spa), use: that
//     is what happens when Tailwind stops scanning them (see sharedTokens in shared/vite/spa-base.ts).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/portal-spa");
const portal = path.join(dist, "portal");

const BUDGET = { initialJs: 130_000, lazyJs: 90_000, css: 14_000 };

// Strings that exist only in the mock.
const MOCK_MARKERS = [
  "Mode mock",
  "sakem-portal-mock",
  "createMockTransport",
  "mock-student-1",
  "rina.pengurus@",
  // The stand-in for Cloudflare's widget (shared/spa/mock-turnstile.ts).
  "Pemeriksaan keamanan tiruan",
  "mock-turnstile-token-",
  "mock-site-key",
];

// Strings that exist only in zod 4's bundle (they survive minification: names it tags its classes with).
const ZOD_MARKERS = ["$ZodType", "$ZodObject", "$ZodError"];

// Classes used by this app's own files (the nav, the layout) and by shared/spa (the auth layout, the crash screen), and not
// by components/ui. If they are missing, Tailwind did not scan them.
const SPA_ONLY_CLASSES = ["aria-\\[current\\=page\\]\\:border-primary-blue", "sm\\:max-w-sm", "max-w-lg", "min-h-dvh"];

const kb = (bytes) => `${(bytes / 1000).toFixed(2)} kB`;
let failed = false;
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  failed = true;
};

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

if (!existsSync(portal)) {
  console.error(`FAIL: ${path.relative(process.cwd(), portal)} does not exist: run pnpm build:portal-spa first`);
  process.exit(1);
}

// ---- index.html: the shell and its URLs
const indexPath = path.join(portal, "index.html");
const rootIndexPath = path.join(dist, "index.html");
const index = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : null;
if (index === null) fail("dist/portal-spa/portal/index.html is missing");
if (!existsSync(rootIndexPath)) fail("dist/portal-spa/index.html (the SPA fallback) is missing");
else if (index !== null && readFileSync(rootIndexPath, "utf8") !== index) fail("dist/portal-spa/index.html differs from portal/index.html");

const initialJs = new Set();
const referenced = [];
for (const match of (index ?? "").matchAll(/\s(?:src|href)="([^"]*)"/g)) {
  const url = match[1];
  if (/^(?:[a-z]+:)?\/\//i.test(url)) continue; // another site's file: not the build's
  if (!url.startsWith("/portal/")) {
    fail(`index.html refers to ${url}, which does not start with /portal/`);
    continue;
  }
  referenced.push(url);
  if (!existsSync(path.join(dist, url))) fail(`index.html refers to ${url}, which is not at dist/portal-spa${url}`);
  else if (url.endsWith(".js")) initialJs.add(path.join(dist, url));
}
if (!/<meta name="robots" content="noindex, ?nofollow"/.test(index ?? "")) fail("index.html lost its noindex meta (the portal is not for search engines)");

// ---- every file: sizes, mock, zod, references
let css = "";
let cssGzip = 0;
let initialGzip = 0;
let lazyGzip = 0;
const lazy = [];
for (const file of walk(portal)) {
  const rel = path.relative(dist, file);
  if (!/\.(js|css|html|woff2?|png)$/.test(file)) continue;
  const content = readFileSync(file);
  const gzip = gzipSync(content, { level: 9 }).length;

  if (/\.woff2?$/.test(file)) {
    console.log(`${rel.padEnd(76)} ${kb(content.length).padStart(11)}`);
    if (!/-latin-wght-/.test(path.basename(file))) fail(`${rel} is not the latin subset: only the latin files of the two fonts belong in the build`);
    continue;
  }
  if (file.endsWith(".png")) {
    console.log(`${rel.padEnd(76)} ${kb(content.length).padStart(11)}`);
    continue;
  }

  const text = content.toString("utf8");
  if (!file.endsWith(".html")) console.log(`${rel.padEnd(76)} ${kb(content.length).padStart(11)}  gzip ${kb(gzip).padStart(10)}`);

  for (const marker of MOCK_MARKERS) {
    if (text.includes(marker)) fail(`${rel} contains the mock ("${marker}")`);
  }

  if (file.endsWith(".css")) {
    css += text;
    cssGzip += gzip;
    for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      const url = match[1];
      if (url.startsWith("data:") || /^(?:[a-z]+:)?\/\//i.test(url)) continue;
      if (!url.startsWith("/portal/")) fail(`${rel} refers to ${url}, which does not start with /portal/`);
      else if (!existsSync(path.join(dist, url))) fail(`${rel} refers to ${url}, which is not at dist/portal-spa${url}`);
    }
  }

  if (file.endsWith(".js")) {
    for (const match of text.matchAll(/["'`](\/portal\/[^"'`\s]+\.(?:js|css|woff2?|png))["'`]/g)) {
      if (!existsSync(path.join(dist, match[1]))) fail(`${rel} refers to ${match[1]}, which is not at dist/portal-spa${match[1]}`);
    }
    if (initialJs.has(file)) {
      initialGzip += gzip;
      for (const marker of ZOD_MARKERS) {
        if (text.includes(marker)) fail(`${rel} is part of the initial load and contains zod ("${marker}"): zod belongs to the wizard's lazy chunk`);
      }
    } else {
      lazyGzip += gzip;
      lazy.push({ rel, gzip });
    }
  }
}

// ---- budgets
console.log(`${"initial JS".padEnd(76)} ${"".padStart(11)}  gzip ${kb(initialGzip).padStart(10)}  (budget ${kb(BUDGET.initialJs)})`);
if (initialGzip > BUDGET.initialJs) fail(`the initial JS is ${kb(initialGzip)} gzip, over the budget of ${kb(BUDGET.initialJs)}`);
if (initialJs.size === 0) fail("index.html loads no script");
for (const chunk of lazy) {
  console.log(`${`lazy chunk ${chunk.rel}`.padEnd(76)} ${"".padStart(11)}  gzip ${kb(chunk.gzip).padStart(10)}  (budget ${kb(BUDGET.lazyJs)})`);
  if (chunk.gzip > BUDGET.lazyJs) fail(`${chunk.rel} is ${kb(chunk.gzip)} gzip, over the budget of ${kb(BUDGET.lazyJs)} for a lazy chunk`);
}
console.log(`${"CSS".padEnd(76)} ${"".padStart(11)}  gzip ${kb(cssGzip).padStart(10)}  (budget ${kb(BUDGET.css)})`);
if (cssGzip > BUDGET.css) fail(`the CSS is ${kb(cssGzip)} gzip, over the budget of ${kb(BUDGET.css)}`);

for (const name of SPA_ONLY_CLASSES) {
  if (!css.includes(name)) fail(`the CSS has no .${name.replace(/\\/g, "")}: Tailwind is not scanning portal-spa/src or shared/spa (see sharedTokens in shared/vite/spa-base.ts)`);
}

// ---- _headers
const headersPath = path.join(dist, "_headers");
if (!existsSync(headersPath)) fail("dist/portal-spa/_headers is missing: the assets would be served without the portal's cache rules and security headers");
else {
  const headers = readFileSync(headersPath, "utf8");
  if (!/^\/portal\/assets\/\*\s*\n\s+Cache-Control:.*immutable/m.test(headers)) fail("_headers lost the rule that makes the hashed files under /portal/assets/ immutable");
  if (!/Content-Security-Policy:.*frame-ancestors 'none'/.test(headers)) fail("_headers lost its Content-Security-Policy");
  if (!/X-Content-Type-Options:\s*nosniff/.test(headers)) fail("_headers lost X-Content-Type-Options: nosniff");
}

console.log(`${"JS + CSS (initial + lazy + CSS)".padEnd(76)} ${"".padStart(11)}  gzip ${kb(initialGzip + lazyGzip + cssGzip).padStart(10)}`);
if (failed) process.exit(1);
console.log("OK: the mock and zod are not in the initial load, every URL is under /portal/ and exists, the budgets hold, the fonts are the latin subset.");
