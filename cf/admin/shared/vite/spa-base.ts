import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin, UserConfig } from "vite";

// The parts of the two SPAs' Vite configs that must stay the same: the design tokens, the aliases and the plugins.
// The admin's (spa/vite.config.ts) and the student portal's (portal-spa/vite.config.ts) call `spaBase`, and add
// what is theirs (the base path, the output folder, the dev proxy).

const sharedVite = path.dirname(fileURLToPath(import.meta.url));
/** cf/admin/shared */
export const SHARED_ROOT = path.resolve(sharedVite, "..");
/** The repository root: `@/` of the Next app, where the shared kit (components/ui) and the tokens (app/globals.css) live. */
export const REPO_ROOT = path.resolve(sharedVite, "../../../..");

const GLOBALS_CSS = path.join(REPO_ROOT, "app/globals.css");
const GLOBALS_IMPORT = '@import "../../../../app/globals.css";';

/**
 * Brings the Next app's design tokens (app/globals.css) into a SPA without
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
 *
 * `stylesFile` is the SPA's `src/styles.css`, which must contain the import line
 * exactly as above (the same four folders up from `src/`, in both SPAs).
 */
export function sharedTokens(stylesFile: string): Plugin {
  return {
    name: "sakem:shared-tokens",
    enforce: "pre",
    transform(code, id) {
      if (id.split("?")[0] !== stylesFile) return null;
      if (!code.includes(GLOBALS_IMPORT)) this.error(`styles.css must contain: ${GLOBALS_IMPORT}`);
      this.addWatchFile(GLOBALS_CSS);
      const tokens = readFileSync(GLOBALS_CSS, "utf8").replace(/^@source not .*;[ \t]*$/gm, "");
      return code.replace(GLOBALS_IMPORT, () => tokens);
    },
  };
}

/**
 * `plugins` and `resolve` of a SPA's Vite config. `here` is the SPA's own folder (`spa/` or `portal-spa/`).
 *
 * Aliases: `@/` is the repo root, exactly as in the Next app; `~/` is the SPA's own `src/`; `@shared/` is this
 * module's folder (cf/admin/shared); `next/link` is the stand-in the shared kit (components/ui) needs.
 */
export function spaBase(here: string): Required<Pick<UserConfig, "plugins" | "resolve">> {
  return {
    // sharedTokens first: it must rewrite styles.css before Tailwind reads it.
    plugins: [sharedTokens(path.join(here, "src/styles.css")), react(), tailwindcss()],
    resolve: {
      alias: [
        // The shared kit (components/ui at the repo root, read-only) imports `next/link`.
        { find: "next/link", replacement: path.join(SHARED_ROOT, "spa/next-link.tsx") },
        { find: /^@shared\//, replacement: `${SHARED_ROOT}/` },
        // ...and `@/lib/cn`. `@/` is the repo root, exactly as in the Next app.
        { find: /^@\//, replacement: `${REPO_ROOT}/` },
        { find: /^~\//, replacement: `${path.resolve(here, "src")}/` },
      ],
      // Files outside cf/admin must use this app's React and helpers, not the
      // root app's copies (two Reacts break hooks).
      dedupe: ["react", "react-dom", "class-variance-authority", "tailwind-merge"],
    },
  };
}
