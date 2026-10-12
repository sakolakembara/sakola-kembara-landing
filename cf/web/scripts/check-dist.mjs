// Build guard: audits dist/client (see scripts/lib/dist-audit.mjs) and exits 1
// on a problem. `pnpm build` runs it last; run it alone after a build with
//
//   pnpm check:dist            summary
//   pnpm check:dist -- --list  also every <img> of the prerendered HTML

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditDist } from './lib/dist-audit.mjs';

const client = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/client');
if (!existsSync(client)) {
  console.error('dist/client is missing. Run `pnpm build` first.');
  process.exit(2);
}

const audit = auditDist(client);
const mib = (n) => `${(n / 1048576).toFixed(1)} MiB`;
console.log(`check-dist: ${audit.files} files, ${mib(audit.bytes)} in dist/client; ${audit.imgs.length} <img> checked in the prerendered HTML`);
console.log(`  largest: ${audit.largest.map((f) => `/${f.path} ${mib(f.bytes)}`).join(', ')}`);
if (process.argv.includes('--list')) {
  for (const i of audit.imgs) {
    console.log(`  ${i.page.padEnd(48)} ${i.width ?? '-'}x${i.height ?? '-'} srcset:${i.srcset} ${(i.loading || '-').padEnd(5)} ${i.src}${i.problems.length ? `  !! ${i.problems.join('; ')}` : ''}`);
  }
}
if (audit.problems.length > 0) {
  console.error(`check-dist: ${audit.problems.length} problem(s):`);
  for (const p of audit.problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('check-dist: ok');
