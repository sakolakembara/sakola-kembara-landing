import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { spaBase } from "../shared/vite/spa-base.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

// The design tokens, the aliases (`@/`, `~/`, `@shared/`, `next/link`) and the plugins are shared with the student
// portal's SPA: cf/admin/shared/vite/spa-base.ts.
const base = spaBase(here);

export default defineConfig({
  root: here,
  plugins: base.plugins,
  resolve: base.resolve,
  build: {
    outDir: path.resolve(here, "../dist/spa"),
    emptyOutDir: true,
  },
  server: {
    // `pnpm dev:spa` next to `wrangler dev` (8787): same origin from the browser's view.
    // /uploads is the local R2 emulation (src/api/dev-uploads.ts), so uploaded images show in the SPA without a public domain.
    proxy: { "/api": "http://localhost:8787", "/uploads": "http://localhost:8787" },
  },
});
