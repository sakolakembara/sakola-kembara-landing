// Checks the SPA build in dist/spa (run `pnpm build:spa` first):
//   - prints the size of every JS and CSS file, raw and gzip;
//   - fails when the development mock (spa/src/mock) ended up in the build;
//   - fails when the CSS lacks classes only this app's own files use, which is
//     what happens when Tailwind stops scanning them (see sharedTokens in
//     shared/vite/spa-base.ts), or classes only the module shared with the
//     student portal's SPA (shared/spa) uses;
//   - fails when zod is in the build: the admin sends no form to a schema, and
//     zod (the portal wizard's, shared/application-form/schemas.ts) must stay
//     out of it (docs/cloudflare/portal-architecture.md#52-the-shared-module-what-moves-and-what-is-imported).
//
//   pnpm build:spa && pnpm check:spa
//
// The mock answers every API call with invented data, so it must never ship.
// main.tsx loads it only when VITE_ADMIN_MOCK=true, which a normal build never
// sets; this check proves the build really left it out.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/spa");

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

// Strings that exist only in the mock.
const MOCK_MARKERS = [
  "Mode mock",
  "sakem-admin-mock",
  "mock-batch-2026",
  "belum-verifikasi@",
  "createMockTransport",
  // The stand-in for Cloudflare's widget (shared/spa/mock-turnstile.ts).
  "Pemeriksaan keamanan tiruan",
  "mock-turnstile-token-",
  "mock-site-key",
];

// Strings that exist only in zod 4's bundle (they survive minification: names it tags its classes with).
const ZOD_MARKERS = ["$ZodType", "$ZodObject", "$ZodError"];

// Classes used by this app's own files and not by components/ui (the shell's
// frame, the auth card, the drawer). If they are missing, Tailwind did not scan the SPA.
// The last two are used only by files in shared/spa (the auth layout, the crash screen): if they are missing,
// the shared module is no longer scanned (`@source "../../shared/spa"` in spa/src/styles.css).
const SPA_ONLY_CLASSES = ["h-dvh", "min-h-screen", "max-w-md", "starting\\:-translate-x-full", "sm\\:max-w-sm", "max-w-lg"];

const kb = (bytes) => `${(bytes / 1000).toFixed(2)} kB`;
let failed = false;
let total = { raw: 0, gzip: 0 };
let css = "";

for (const file of walk(root)) {
  if (!/\.(js|css|html)$/.test(file)) continue;
  const content = readFileSync(file);
  const text = content.toString("utf8");
  const gzip = gzipSync(content, { level: 9 }).length;
  if (!file.endsWith(".html")) {
    total = { raw: total.raw + content.length, gzip: total.gzip + gzip };
  }
  if (file.endsWith(".css")) css += text;
  console.log(`${path.relative(root, file).padEnd(40)} ${kb(content.length).padStart(11)}  gzip ${kb(gzip).padStart(10)}`);
  for (const marker of MOCK_MARKERS) {
    if (text.includes(marker)) {
      console.error(`FAIL: ${path.relative(root, file)} contains the mock ("${marker}")`);
      failed = true;
    }
  }
  for (const marker of ZOD_MARKERS) {
    if (text.includes(marker)) {
      console.error(`FAIL: ${path.relative(root, file)} contains zod ("${marker}"): the admin bundle must not ship it`);
      failed = true;
    }
  }
}

for (const name of SPA_ONLY_CLASSES) {
  if (!css.includes(name)) {
    console.error(`FAIL: the CSS has no .${name.replace(/\\/g, "")}: Tailwind is not scanning spa/src (see sharedTokens in spa/vite.config.ts)`);
    failed = true;
  }
}

console.log(`${"JS + CSS total".padEnd(40)} ${kb(total.raw).padStart(11)}  gzip ${kb(total.gzip).padStart(10)}`);
if (failed) process.exit(1);
console.log("OK: the mock and zod are not in the build, and the SPA's own classes are in the CSS.");
