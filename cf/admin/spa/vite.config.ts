import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
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
