#!/usr/bin/env node
// STOPS a production deploy unless this checkout is exactly `origin/main` and clean (SAKEM-126): what is live is what is on
// `main`, so a feature branch, an unmerged commit or an edit that is not committed never reaches the real domain. The production
// deploy command (production-deploy-command.mjs) runs it first, before the account pin and `wrangler deploy`.
//
//   node ../scripts/on-main.mjs   (from cf/web or cf/admin)
//
// It fetches `main` from `origin` first, so "behind origin/main" is caught too. It prints nothing on standard output and exits 1
// with the reason on standard error when the checkout is not `origin/main`, so the `&&` of the printed command stops there.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The branch production is deployed from (decided by Dzul on 2026-11-08). */
export const LIVE_BRANCH = 'main';

/**
 * Why this checkout may not be deployed, or [] when it may: `head` and `main` are commit ids (`main` is null when
 * `origin/main` could not be read), `status` is the output of `git status --porcelain` (git-ignored files are not in it).
 */
export function mainProblems({ head, main, status }) {
  const problems = [];
  if (!main) problems.push(`origin/${LIVE_BRANCH} could not be read (fetch failed?)`);
  else if (head !== main) problems.push(`this checkout is ${head?.slice(0, 7) ?? 'unknown'}, origin/${LIVE_BRANCH} is ${main.slice(0, 7)}: merge into ${LIVE_BRANCH}, then \`git switch --detach origin/${LIVE_BRANCH}\``);
  if (status.trim() !== '') problems.push(`the working tree has changes that are not committed:\n${status.trimEnd()}`);
  return problems;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}

function main() {
  let main = null;
  try {
    git('fetch', '--quiet', 'origin', LIVE_BRANCH);
    main = git('rev-parse', `origin/${LIVE_BRANCH}`);
  } catch {
    main = null;
  }
  const problems = mainProblems({ head: git('rev-parse', 'HEAD'), main, status: git('status', '--porcelain') });
  if (problems.length === 0) return 0;
  process.stderr.write(`on-main: nothing deployed. Production is deployed only from origin/${LIVE_BRANCH}:\n${problems.map((p) => `- ${p}`).join('\n')}\n`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
