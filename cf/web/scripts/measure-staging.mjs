#!/usr/bin/env node
// CPU measurement of the STAGING Workers on the Free plan (SAKEM-084, docs/cloudflare/staging-runbook.md).
//
//   node scripts/measure-staging.mjs probe   --base https://<web>.<account>.workers.dev [--admin https://<admin>...]
//   node scripts/measure-staging.mjs collect [--file web-tail.jsonl --file admin-tail.jsonl]   (or a pipe)
//   node scripts/measure-staging.mjs plan    --base ...    (what would be asked; nothing is sent)
//
// `probe` asks a bounded number of GET requests per route, politely (one at a time, with a pause), as
// `sakem-staging-measure/1.0`. `collect` reads what `wrangler tail <worker> --format json` printed and turns
// it into per-route numbers: count, p50, p95, p99, max CPU, the outcomes (exceededCpu is error 1102), the
// statuses, the first invocation after an idle gap, and a verdict. The CPU time is Cloudflare's own record of
// each invocation; this tool never measures it by itself (a timer inside a Worker only moves on I/O).
//
// What it will NOT do, by construction (tests/measure-staging.test.ts runs this file against a stub server):
//   - contact anything unless a subcommand `probe` is given with an explicit --base, and only after the host is
//     typed back (a prompt, or --confirm <host> without a terminal). `collect` and `plan` never use the network.
//   - touch anything that is not `*.workers.dev` (or a loopback address, to rehearse locally). The production
//     domain is refused, with no flag to allow it.
//   - send anything but GET, unless --writes AND a second typed confirmation ("write <host>", or
//     --confirm-writes <host>). The POSTs of --writes are the ones the Workers refuse before storing anything.
//   - read a credential, a token, a cookie or any file besides the tail capture you name. It sends no
//     Authorization or Cookie header and reads no environment variable. The routes that need a signed-in session
//     (sign-in, dashboard, lists, blog save and preview, uploads) are driven by hand in a browser while
//     `wrangler tail` runs, and `collect` reads them from the capture (runbook, section "Measure").
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SLUGS, THRESHOLDS, USER_AGENT, aggregate, buildPlan, checkBase, isSlug, parseLine, renderReport } from './lib/staging-measure.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `usage:
  node scripts/measure-staging.mjs probe --base <https://*.workers.dev> [--admin <https://*.workers.dev>] [options]
  node scripts/measure-staging.mjs plan  --base <...> [--admin <...>] [options]       print the requests, send nothing
  node scripts/measure-staging.mjs collect [--file <tail.jsonl> ...] [options]        read a \`wrangler tail --format json\` capture (or stdin)

probe/plan options:
  --rounds N          requests per route, 1-60 (default 12)
  --delay-ms N        pause between requests, at least 250 (default 600)
  --slugs a,b,c       blog articles to ask (default: the longest, the second longest and the shortest of the migrated 80)
  --shortlink slug    a real short link of the staging admin (default: an unknown name, which still costs the lookup)
  --writes            also the POSTs that the Workers refuse before storing anything (needs a second confirmation)
  --confirm host      the host of --base, typed, when there is no terminal
  --confirm-admin h   the same for --admin
  --confirm-writes h  "write <host>" confirmation without a terminal: pass the host of --base
  --out file          where the client-side numbers go (default .measure/staging-probe.json)
  --timeout-ms N      per request (default 20000)

collect options:
  --file path         a capture; repeat for the web and the admin Worker (default: standard input)
  --worker name       only this Worker (scriptName)
  --only-measure      only the requests this tool made (its User-Agent)
  --group-slugs       one row for all of /blog/<slug>
  --idle-gap-s N      seconds without an invocation that make the next one "after idle" (default 60)
  --json file         also write the report as JSON

exit codes: 0 fine, 1 a route failed the gate (probe: aborted), 2 refused or bad arguments, 3 no data.`;

function fail(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = { files: [], confirm: undefined };
  const value = (i, name) => rest[i + 1] ?? fail(`${name} needs a value`);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    switch (arg) {
      case '--base': flags.base = value(i++, arg); break;
      case '--admin': flags.admin = value(i++, arg); break;
      case '--rounds': flags.rounds = Number(value(i++, arg)); break;
      case '--delay-ms': flags.delayMs = Number(value(i++, arg)); break;
      case '--slugs': flags.slugs = value(i++, arg).split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--shortlink': flags.shortlink = value(i++, arg); break;
      case '--writes': flags.writes = true; break;
      case '--confirm': flags.confirm = value(i++, arg); break;
      case '--confirm-admin': flags.confirmAdmin = value(i++, arg); break;
      case '--confirm-writes': flags.confirmWrites = value(i++, arg); break;
      case '--out': flags.out = value(i++, arg); break;
      case '--timeout-ms': flags.timeoutMs = Number(value(i++, arg)); break;
      case '--file': flags.files.push(value(i++, arg)); break;
      case '--worker': flags.worker = value(i++, arg); break;
      case '--only-measure': flags.onlyMeasure = true; break;
      case '--group-slugs': flags.groupSlugs = true; break;
      case '--idle-gap-s': flags.idleGapS = Number(value(i++, arg)); break;
      case '--json': flags.json = value(i++, arg); break;
      case '--help': case '-h': process.stdout.write(`${HELP}\n`); process.exit(0);
      default: fail(`unknown argument ${JSON.stringify(arg)}\n\n${HELP}`);
    }
  }
  return { command, flags };
}

// ------------------------------------------------------------------------------------------------ asking the owner

/** The typed confirmation: a line typed at a terminal, or the flag when there is no terminal. Anything else refuses. */
async function confirmed(question, expected, flagValue) {
  if (flagValue !== undefined) return flagValue === expected;
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise((resolve) => rl.question(`${question} `, resolve));
  rl.close();
  return answer.trim() === expected;
}

// ------------------------------------------------------------------------------------------------ probe

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const percentileOf = (sorted, q) => (sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]);

/** The pause after one request of a route: the general one, longer for a route behind a rate limit (not on a loopback rehearsal, which has none). */
const pauseFor = (route, delayMs, loopback) => (loopback ? delayMs : Math.max(delayMs, route.minDelayMs ?? 0));

function describePlan(plan, bases, rounds, delayMs) {
  const lines = plan.map((r) => {
    const target = r.target === 'admin' ? bases.admin.origin : bases.web.origin;
    const pause = pauseFor(r, delayMs, bases.web.loopback);
    return `  ${r.method.padEnd(4)} ${`${target}${r.path}`.padEnd(88)} x${rounds}  pause ${pause} ms  [${r.worker === 'none' ? 'control, no Worker expected' : r.worker}]  ${r.note ?? ''}`;
  });
  const requests = plan.length * rounds;
  const seconds = Math.ceil(plan.reduce((sum, r) => sum + rounds * (pauseFor(r, delayMs, bases.web.loopback) + 150), 0) / 1000);
  const workerRequests = plan.filter((r) => r.worker !== 'none').length * rounds;
  return [
    ...lines,
    '',
    `${requests} requests in total, about ${Math.ceil(seconds / 60)} min, one at a time. About ${workerRequests} of them run a Worker: that is ${((workerRequests / 100000) * 100).toFixed(2)}% of the 100,000 Worker requests a day of the Free plan, counted per account across all its Workers.`,
  ].join('\n');
}

async function runProbe(flags, { sendNothing }) {
  if (!flags.base) fail('refused: --base is required (the staging site, https://<worker>.<account>.workers.dev). Nothing was contacted.');
  let web;
  let admin;
  try {
    web = checkBase(flags.base, '--base');
    admin = flags.admin ? checkBase(flags.admin, '--admin') : null;
  } catch (error) {
    fail(`refused: ${error.message}. Nothing was contacted.`);
  }
  const rounds = flags.rounds ?? 12;
  const delayMs = flags.delayMs ?? 600;
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 60) fail('refused: --rounds is a whole number from 1 to 60');
  if (!Number.isFinite(delayMs) || delayMs < (web.loopback ? 0 : 250)) fail('refused: --delay-ms must be at least 250 (the pause is the politeness of the tool)');
  const slugs = flags.slugs ?? DEFAULT_SLUGS;
  for (const slug of [...slugs, ...(flags.shortlink ? [flags.shortlink] : [])]) if (!isSlug(slug)) fail(`refused: ${JSON.stringify(slug)} is not a slug`);
  if (flags.writes && !flags.base) fail('refused: --writes needs --base');

  const plan = buildPlan({ slugs, shortlink: flags.shortlink, web: true, admin: Boolean(admin), writes: Boolean(flags.writes) });
  const bases = { web, admin };
  process.stderr.write(`Plan (user agent: ${USER_AGENT})\n${describePlan(plan, bases, rounds, delayMs)}\n\n`);
  if (sendNothing) {
    process.stderr.write('plan only: nothing was sent.\n');
    return 0;
  }

  if (!(await confirmed(`Type the host of --base to send these requests (${web.host}):`, web.host, flags.confirm))) {
    fail('refused: the host was not typed back (a prompt, or --confirm <host> without a terminal). Nothing was contacted.');
  }
  if (admin && !(await confirmed(`Type the host of --admin to include it (${admin.host}):`, admin.host, flags.confirmAdmin))) {
    fail('refused: the admin host was not typed back (--confirm-admin <host> without a terminal). Nothing was contacted.');
  }
  if (flags.writes) {
    process.stderr.write(
      'WRITES: this includes POST requests (the contact form without a Turnstile token, and a sign-in with an unknown address). The Workers are expected to refuse them before storing anything, but they count against the rate limits and write to the logs.\n',
    );
    if (!(await confirmed(`Type "write ${web.host}" to include the POSTs:`, `write ${web.host}`, flags.confirmWrites === undefined ? undefined : `write ${flags.confirmWrites}`))) {
      fail('refused: the second confirmation was not given (--confirm-writes <host> without a terminal). Nothing was contacted.');
    }
  }

  const results = new Map(plan.map((r, index) => [index, { route: r, wall: [], statuses: {}, notes: new Set(), suspected1102: 0, colos: new Set() }]));
  let consecutiveErrors = 0;
  let aborted = null;
  const skipped = new Set();
  const started = Date.now();

  loop: for (let round = 1; round <= rounds; round++) {
    for (const [index, r] of plan.entries()) {
      if (skipped.has(index)) continue;
      const origin = r.target === 'admin' ? admin.origin : web.origin;
      const headers = { 'user-agent': USER_AGENT, accept: r.path.endsWith('.xml') ? 'application/xml' : 'text/html,application/json;q=0.9,*/*;q=0.8', ...(r.headers ?? {}) };
      if (r.withOrigin) headers.origin = origin;
      const result = results.get(index);
      const t0 = performance.now();
      try {
        const response = await fetch(`${origin}${r.path}`, { method: r.method, headers, body: r.body, redirect: 'manual', signal: AbortSignal.timeout(flags.timeoutMs ?? 20000) });
        const body = await response.text();
        const wall = performance.now() - t0;
        result.wall.push(wall);
        result.statuses[response.status] = (result.statuses[response.status] ?? 0) + 1;
        const ray = response.headers.get('cf-ray');
        if (ray) result.colos.add(ray.split('-').pop());
        const source = response.headers.get('x-blog-source');
        if (source) result.notes.add(`x-blog-source: ${source}`);
        if (response.status >= 500 && /1102|exceeded resource limits/i.test(body.slice(0, 20000))) {
          result.suspected1102 += 1;
          result.notes.add('ERROR 1102: the Worker exceeded its resource limits');
        }
        consecutiveErrors = 0;
        if (response.status === 429) {
          result.notes.add('429: a rate limit answered; this route is skipped from now on');
          skipped.add(index);
        }
      } catch (error) {
        result.notes.add(`request failed: ${error?.name ?? 'error'}`);
        result.statuses.error = (result.statuses.error ?? 0) + 1;
        consecutiveErrors += 1;
        if (consecutiveErrors >= 5) {
          aborted = '5 requests in a row failed: stopped';
          break loop;
        }
      }
      await sleep(pauseFor(r, delayMs, web.loopback));
    }
  }

  const rows = [...results.values()].map(({ route, wall, statuses, notes, suspected1102, colos }) => {
    const sorted = [...wall].sort((a, b) => a - b);
    return {
      worker: route.worker,
      method: route.method,
      url: `${route.target === 'admin' ? 'admin' : 'web'}${route.path}`,
      requests: wall.length,
      statuses,
      clientWallMs: sorted.length > 0 ? { p50: Math.round(percentileOf(sorted, 0.5)), p95: Math.round(percentileOf(sorted, 0.95)), max: Math.round(sorted[sorted.length - 1]) } : null,
      suspected1102,
      locations: [...colos],
      notes: [...notes],
    };
  });
  const out = path.resolve(root, flags.out ?? '.measure/staging-probe.json');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ agent: USER_AGENT, rounds, delayMs, startedAt: new Date(started).toISOString(), aborted, rows }, null, 2)}\n`);

  process.stdout.write('Client side (wall time as the client saw it, INCLUDING the network: not CPU):\n');
  for (const row of rows) {
    const statuses = Object.entries(row.statuses).map(([k, v]) => `${k}:${v}`).join(' ');
    process.stdout.write(`  ${row.method.padEnd(4)} ${row.url.padEnd(52)} n=${String(row.requests).padStart(3)}  ${statuses.padEnd(14)} wall p50 ${row.clientWallMs?.p50 ?? '-'} ms  p95 ${row.clientWallMs?.p95 ?? '-'} ms${row.suspected1102 ? '  ERROR 1102 x' + row.suspected1102 : ''}${row.notes.length > 0 ? `  [${row.notes.join('; ')}]` : ''}\n`);
  }
  process.stdout.write(`\nwritten: ${path.relative(root, out)}\nNow read the CPU time of these invocations from the \`wrangler tail ... --format json\` capture: node scripts/measure-staging.mjs collect --file <capture> --only-measure\n`);
  if (aborted) {
    process.stderr.write(`${aborted}\n`);
    return 1;
  }
  return rows.some((row) => row.suspected1102 > 0) ? 1 : 0;
}

// ------------------------------------------------------------------------------------------------ collect

async function readLines(files) {
  const lines = [];
  const sources = files.length > 0 ? files.map((file) => createReadStream(file, 'utf8')) : [process.stdin];
  if (files.length === 0 && process.stdin.isTTY) fail('collect reads a capture: pass --file <tail.jsonl> or pipe `wrangler tail <worker> --format json` into it');
  for (const stream of sources) {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) lines.push(line);
  }
  return lines;
}

async function runCollect(flags) {
  let lines;
  try {
    lines = await readLines(flags.files);
  } catch (error) {
    fail(`could not read the capture: ${error.message}`);
  }
  const records = [];
  let skipped = 0;
  let read = 0;
  for (const line of lines) {
    const parsed = parseLine(line, { groupSlugs: flags.groupSlugs });
    if (parsed === null) continue;
    read += 1;
    if (parsed === 'skip') skipped += 1;
    else records.push(parsed);
  }
  const report = aggregate(records, {
    worker: flags.worker,
    onlyMeasure: flags.onlyMeasure,
    idleGapMs: flags.idleGapS === undefined ? THRESHOLDS.idleGapMs : flags.idleGapS * 1000,
  });
  process.stdout.write(`${renderReport(report, { lines: read, skipped })}\n`);
  if (flags.json) {
    mkdirSync(path.dirname(path.resolve(flags.json)), { recursive: true });
    writeFileSync(path.resolve(flags.json), `${JSON.stringify({ totals: { lines: read, skipped }, ...report }, null, 2)}\n`);
  }
  if (report.overall.verdict === 'FAIL') return 1;
  if (report.overall.verdict === 'NO-DATA' || report.overall.verdict === 'NO-CPU') return 3;
  return 0;
}

// ------------------------------------------------------------------------------------------------ main

const { command, flags } = parseArgs(process.argv.slice(2));
if (command === 'probe') process.exitCode = await runProbe(flags, { sendNothing: false });
else if (command === 'plan') process.exitCode = await runProbe(flags, { sendNothing: true });
else if (command === 'collect') process.exitCode = await runCollect(flags);
else fail(`${command ? `unknown command ${JSON.stringify(command)}\n\n` : ''}${HELP}\n\nNothing was contacted: a command and an explicit --base are required.`);
