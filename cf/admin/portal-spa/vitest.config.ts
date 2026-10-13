import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// The portal SPA's tests run in Node with jsdom, not in workerd (that is the Worker's suite, see ../vitest.config.ts),
// exactly as the admin SPA's do (../spa/vitest.config.ts). The aliases and `dedupe` come from vite.config.ts, so
// `@/components/ui`, `@shared/`, `next/link` and `~/` resolve as in the build.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      setupFiles: ["./test/setup.ts"],
      include: ["test/**/*.test.{ts,tsx}"],
      restoreMocks: true,
    },
  }),
);
