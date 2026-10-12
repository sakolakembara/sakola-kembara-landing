import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

const GLOBALS_CSS = path.join(repoRoot, "app/globals.css");
const GLOBALS_IMPORT = '@import "../../../../app/globals.css";';

/**
 * Brings the Next app's design tokens (app/globals.css) into the SPA without
 * its `@source not` lines.
 *
 * That file tells Tailwind not to scan `cf/` (`@source not "../cf"`), so the
 * Next build ignores the Astro and admin projects. Tailwind applies the line to
 * every build that imports the file, and it wins over any `@source` of our
 * own, so on its own it hides this whole app from the scanner: only classes
 * that happen to appear in components/ui would be generated, and layout
 * classes such as `h-dvh` or `min-h-screen` would be missing. Inlining the file
 * minus those lines keeps one source of truth for the tokens and lets
 * styles.css scan its own files.
 */
function sharedTokens(): Plugin {
  return {
    name: "sakem:shared-tokens",
    enforce: "pre",
    transform(code, id) {
      if (id.split("?")[0] !== path.join(here, "src/styles.css")) return null;
      if (!code.includes(GLOBALS_IMPORT)) this.error(`styles.css must contain: ${GLOBALS_IMPORT}`);
      this.addWatchFile(GLOBALS_CSS);
      const tokens = readFileSync(GLOBALS_CSS, "utf8").replace(/^@source not .*;[ \t]*$/gm, "");
      return code.replace(GLOBALS_IMPORT, () => tokens);
    },
  };
}

export default defineConfig({
  root: here,
  // sharedTokens first: it must rewrite styles.css before Tailwind reads it.
  plugins: [sharedTokens(), react(), tailwindcss()],
  resolve: {
    alias: [
      // The shared kit (components/ui at the repo root, read-only) imports `next/link`.
      { find: "next/link", replacement: path.resolve(here, "src/shims/next-link.tsx") },
      // ...and `@/lib/cn`. `@/` is the repo root, exactly as in the Next app.
      { find: /^@\//, replacement: `${repoRoot}/` },
      { find: /^~\//, replacement: `${path.resolve(here, "src")}/` },
    ],
    // Files outside cf/admin must use this app's React and helpers, not the
    // root app's copies (two Reacts break hooks).
    dedupe: ["react", "react-dom", "class-variance-authority", "tailwind-merge"],
  },
  build: {
    outDir: path.resolve(here, "../dist/spa"),
    emptyOutDir: true,
  },
  server: {
    // `pnpm dev:spa` next to `wrangler dev` (8787): same origin from the browser's view.
    proxy: { "/api": "http://localhost:8787" },
  },
});
