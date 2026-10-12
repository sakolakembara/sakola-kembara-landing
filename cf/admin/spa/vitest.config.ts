import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// SPA tests run in Node with jsdom, not in workerd (that is the Worker's
// suite, see ../vitest.config.ts). The aliases and `dedupe` come from
// vite.config.ts, so `@/components/ui`, `next/link` and `~/` resolve exactly as
// in the build. jsdom, not happy-dom: the drawer and the forms depend on how
// focus, tab order and disabled controls behave, and jsdom follows the
// browser's rules there more closely; the speed difference does not matter at
// this size.
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
