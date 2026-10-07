import type { StorybookConfig } from "@storybook/nextjs-vite";

/**
 * Server actions (`"use server"` modules) run on the server with the database
 * and auth. Storybook has neither, so each such module is replaced by stubs
 * with the same export names: calling one logs it and never settles, so a
 * form shows its pending state instead of failing. Nothing from the real
 * module (database, auth, file system) reaches the browser bundle.
 */
const stubServerActions = {
  name: "sakem:stub-server-actions",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (id.includes("/node_modules/") || !/\.tsx?$/.test(id) || !/^\s*["']use server["']/.test(code)) return;
    const names = [...code.matchAll(/export\s+async\s+function\s+(\w+)/g)].map(([, name]) => name);
    return names
      .map(
        (name) =>
          `export async function ${name}() { console.info("[storybook] server action ${name} is not available"); return new Promise(() => {}); }`,
      )
      .join("\n");
  },
};

/**
 * Storybook for the design system (SAKEM-048): every component in
 * components/ and every reusable part in app/, one story per state that
 * matters. Rules live in DESIGN.md; the stories are the living examples.
 */
const config: StorybookConfig = {
  stories: ["./*.mdx", "../components/**/*.stories.tsx", "../app/**/*.stories.tsx"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: "@storybook/nextjs-vite",
  core: { disableTelemetry: true },
  viteFinal: (config) => ({
    ...config,
    // Vite copies public/ into the build by default. The components import
    // their images, so that would only add ~200 MB of site files.
    publicDir: false,
    plugins: [stubServerActions, ...(config.plugins ?? [])],
  }),
};

export default config;
