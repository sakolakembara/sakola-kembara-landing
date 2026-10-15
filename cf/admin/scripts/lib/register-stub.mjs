// `node --import ./scripts/lib/register-stub.mjs ...`: makes `import "cloudflare:workers"` load in Node.
import { register } from "node:module";

register("./workers-stub-hooks.mjs", import.meta.url);
