import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Unit test runner. Node environment by default (we don't render React
// components in tests yet — everything under test is either a Zod schema,
// a pure server helper, or a mocked-DB service call). If we add component
// tests later, switch the relevant file's env to "jsdom" via top-of-file
// `// @vitest-environment jsdom`.

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./__tests__/setup.ts"],
    include: ["__tests__/**/*.test.ts", "__tests__/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.ts", "app/**/actions.ts"],
      exclude: [
        "lib/db/schema/**",
        "lib/blog-posts.json",
        "**/*.d.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(path.dirname(fileURLToPath(import.meta.url))),
    },
  },
});
