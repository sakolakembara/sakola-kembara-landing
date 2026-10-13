import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { REPO_ROOT, spaBase } from "../shared/vite/spa-base.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

// The design tokens, the aliases (`@/`, `~/`, `@shared/`, `next/link`) and the plugins are the admin SPA's:
// cf/admin/shared/vite/spa-base.ts.
const base = spaBase(here);

// The student portal lives at the path /portal of the apex (docs/cloudflare/portal-architecture.md#51-layout-and-base-path):
// `base` makes every URL in the build start with /portal/, and the build is written to dist/portal-spa/portal/ because
// the Worker's assets are found by the pathname as it arrives. scripts/finish-portal-spa.mjs then adds the files that
// belong at the root of dist/portal-spa (the SPA fallback index.html and _headers).
export default defineConfig({
  root: here,
  base: "/portal/",
  plugins: base.plugins,
  resolve: base.resolve,
  build: {
    outDir: path.resolve(here, "../dist/portal-spa/portal"),
    emptyOutDir: true,
    // public/_headers is not an asset of the page: finish-portal-spa.mjs puts it at the root of dist/portal-spa.
    copyPublicDir: false,
  },
  server: {
    // `pnpm dev:portal-spa` next to `pnpm dev:portal` (8788): same origin from the browser's view, at http://localhost:5174/portal/.
    port: 5174,
    // The shared kit and the logo live at the repo root (outside this folder).
    fs: { allow: [REPO_ROOT] },
    proxy: { "/portal/api": "http://localhost:8788" },
  },
});
