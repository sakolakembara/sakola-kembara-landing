// Starts the BUILT Worker the way scripts/e2e.mjs does (wrangler dev in local mode, the stub origin and the fixture API
// behind it, the fixture serving every article of content/blog), prints its address and keeps it up until it is stopped
// (Ctrl-C or SIGTERM). It exists to run the SEO parity tool against the local candidate:
//
//   pnpm build
//   E2E_PORT_OFFSET=5100 pnpm serve:candidate                 # prints "READY http://127.0.0.1:13891"
//   node scripts/seo-parity.mjs --live-dir <recorded live pages> --candidate-base http://127.0.0.1:13891 --delay-ms 0 --out <folder>
//
// (docs/cloudflare/seo-audit.md, "Repeating the proof"). No network beyond loopback; no Cloudflare account. The ports are
// the e2e's plus E2E_PORT_OFFSET, so pick an offset that is free.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { PORT_OFFSET, startStack, webRoot } from './lib/harness.mjs';

if (!existsSync(path.join(webRoot, 'dist/server/wrangler.json'))) {
  console.error('dist/ is missing. Run `pnpm build` first.');
  process.exit(2);
}

const stack = await startStack({ log: path.join(webRoot, 'dist/candidate-wrangler.log'), vars: { ADMIN_URL: 'https://admin.example.test' } });
console.log(`READY ${stack.base} (port offset ${PORT_OFFSET}; Ctrl-C stops it)`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await stack.stop();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
setInterval(() => {}, 1 << 30);
