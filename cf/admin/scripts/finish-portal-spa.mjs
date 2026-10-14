// The last step of `pnpm build:portal-spa` (docs/cloudflare/portal-architecture.md#51-layout-and-base-path).
//
// Vite writes the portal SPA to dist/portal-spa/portal/, so a script is at portal/assets/<hash>.js and answers the
// URL /portal/assets/<hash>.js: the Worker's assets are found by the pathname as it arrives. Two files belong at the
// ROOT of dist/portal-spa instead, and this puts them there:
//
//   index.html   a copy of portal/index.html. With `not_found_handling: "single-page-application"` the assets layer
//                answers every path that is no file (/portal, /portal/status, ...) with the Worker's own /index.html.
//   _headers     public/_headers: the rules for asset responses (cache, security headers, CSP).
//
// It removes both first, so a build never leaves the previous one's copy behind.
import { copyFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist/portal-spa");
const page = path.join(out, "portal/index.html");
const headers = path.join(root, "portal-spa/public/_headers");

if (!existsSync(page)) {
  console.error(`FAIL: ${path.relative(root, page)} is missing: run vite build --config portal-spa/vite.config.ts first`);
  process.exit(1);
}
if (!existsSync(headers)) {
  console.error(`FAIL: ${path.relative(root, headers)} is missing`);
  process.exit(1);
}

rmSync(path.join(out, "index.html"), { force: true });
rmSync(path.join(out, "_headers"), { force: true });
copyFileSync(page, path.join(out, "index.html"));
copyFileSync(headers, path.join(out, "_headers"));
console.log("portal SPA: dist/portal-spa/index.html and dist/portal-spa/_headers written.");
