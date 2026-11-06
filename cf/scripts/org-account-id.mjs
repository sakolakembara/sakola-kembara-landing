#!/usr/bin/env node
// PRINTS the id of the ORGANISATION Cloudflare account, picked BY NAME from `wrangler whoami --json` (SAKEM-123). The production
// deploy command (production-deploy-command.mjs) runs it in front of `wrangler deploy`, so a deploy never asks "Select an account":
// on 2026-11-06 that prompt's first row, a personal account, was picked by accident and cached by wrangler for the folder.
//
//   node ../scripts/org-account-id.mjs   (from cf/web or cf/admin, where `pnpm exec wrangler` resolves)
//
// It exits 1, printing nothing on standard output, when the account is not in the login's list, so the `&&` of the printed
// command stops before the deploy. The id is not a secret, but like the rest of the tooling it is never written to a log.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The name the Cloudflare dashboard gives the organisation account (decided 2026-10-12, docs/cloudflare). */
export const ORG_ACCOUNT_NAME = "Dzul@sakolakembara.org's Account";

/** The id of the account named `ORG_ACCOUNT_NAME` in the output of `wrangler whoami --json`, or null. */
export function pickOrgAccount(whoami) {
  const match = (whoami?.accounts ?? []).filter((account) => account?.name === ORG_ACCOUNT_NAME);
  return match.length === 1 && typeof match[0].id === 'string' && match[0].id ? match[0].id : null;
}

/** The JSON object in wrangler's output (it may print a banner around it). */
export function parseWhoami(text) {
  const start = text.search(/^\{/m);
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function main() {
  let text;
  try {
    text = execFileSync('pnpm', ['exec', 'wrangler', 'whoami', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    process.stderr.write(`org-account-id: \`wrangler whoami --json\` failed (logged in? run from cf/web or cf/admin): ${error.message.split('\n')[0]}\n`);
    return 1;
  }
  const id = pickOrgAccount(parseWhoami(text));
  if (!id) {
    process.stderr.write(`org-account-id: the login has no account named "${ORG_ACCOUNT_NAME}": nothing deployed (wrangler login with an account that can see it)\n`);
    return 1;
  }
  process.stdout.write(id);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
