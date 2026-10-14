// `node --import ./scripts/lib/register-node-worker.mjs ...`: makes `import 'cloudflare:workers'` load in Node.
import { register } from 'node:module';

register('./node-worker-hooks.mjs', import.meta.url);
