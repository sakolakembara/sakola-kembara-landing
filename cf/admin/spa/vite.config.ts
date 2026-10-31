import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { spaBase } from "../shared/vite/spa-base.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

// The design tokens, the aliases (`@/`, `~/`, `@shared/`, `next/link`) and the plugins are shared with the student
// portal's SPA: cf/admin/shared/vite/spa-base.ts.
const base = spaBase(here);

/**
 * Asks the browser for the main font at the top of the page, with the script and the stylesheet, instead of when the first
 * text is drawn: the file's name has a hash that only the build knows, and without this the text first shows in a fallback face
 * and changes shape when the font arrives. Only the Latin file (the others are fetched when a page uses their characters);
 * `crossorigin` is needed for a font even from the same origin. Nothing in development, where nothing is hashed.
 */
function preloadMainFont(): Plugin {
  return {
    name: "preload-main-font",
    transformIndexHtml: {
      order: "post",
      handler(_html, context) {
        const file = Object.keys(context.bundle ?? {}).find((name) => /plus-jakarta-sans-latin-wght-normal-[\w-]+\.woff2$/.test(name));
        if (!file) return undefined;
        return [{ tag: "link", attrs: { rel: "preload", as: "font", type: "font/woff2", crossorigin: "", href: `/${file}` }, injectTo: "head" }];
      },
    },
  };
}

export default defineConfig({
  root: here,
  plugins: [...base.plugins, preloadMainFont()],
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
