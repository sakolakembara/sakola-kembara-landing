import type { StorybookConfig } from "@storybook/nextjs-vite";

/**
 * Storybook for the design system (SAKEM-048): the components in
 * components/ (ui, layout, sections, blog) and the shared admin and portal
 * parts in app/, one story per state that matters.
 * Rules live in DESIGN.md; the stories are the living examples.
 */
const config: StorybookConfig = {
  stories: ["./*.mdx", "../components/**/*.stories.tsx", "../app/**/*.stories.tsx"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: "@storybook/nextjs-vite",
  core: { disableTelemetry: true },
  // Vite copies public/ into the build by default. The components import
  // their images, so that would only add ~200 MB of site files to the build.
  viteFinal: (config) => ({ ...config, publicDir: false }),
};

export default config;
