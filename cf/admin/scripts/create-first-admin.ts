// Creates the FIRST super_admin of an empty database, run by the owner on their own machine
// (docs/cloudflare/first-super-admin.md). Pengaturan needs a super_admin, and a super_admin can only be invited
// from Pengaturan, so the first one has to come from outside the app.
//
//   pnpm db:migrate:local                       # the tables first (the owner does the remote ones in the runbook)
//   pnpm first-admin                            # the LOCAL database, `sakem-admin`
//   pnpm first-admin --database <name> --remote # a real database, named on purpose, with a typed confirmation
//
// What it does, in order: asks for the address, a name and the password (typed twice, NOT shown, never an
// argument or an environment variable, so it is not in the shell history); hashes the password here with the
// Worker's own `hashPassword`; asks for a confirmation (for a real database: its name, typed); looks at the
// database and refuses when a super_admin who can sign in already exists or the address is taken; writes the SQL
// to a private temporary directory OUTSIDE the repository; runs `wrangler d1 execute --file` on it; deletes it;
// checks the result. It prints neither the password nor the hash, and it hides the hash from wrangler's error
// text too.
//
// Safe by default: without `--remote` it only ever touches the local database (`wrangler ... --local`). A real
// database needs `--remote`, `--database <name>` spelled out (there is no default for it) and the name typed again
// at the question. `--no-run --out <file>` writes the SQL (mode 0600, outside the repo) and stops, for an owner who
// wants to read it or run it some other way; then deleting the file is theirs to do.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectSql, makeFirstAdmin, parseEmail, parseName, passwordProblem } from "./first-admin-sql";

const DEFAULT_LOCAL_DATABASE = "sakem-admin";
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

// ------------------------------------------------------------------------------------------------ arguments

interface Options {
  database: string | undefined;
  config: string;
  persistTo: string | undefined;
  remote: boolean;
  noRun: boolean;
  out: string | undefined;
}

function fail(message: string): never {
  process.stderr.write(`\n${message}\n`);
  process.exit(1);
}

function parseArguments(argv: string[]): Options {
  const options: Options = { database: undefined, config: "wrangler.jsonc", persistTo: undefined, remote: false, noRun: false, out: undefined };
  const value = (index: number, flag: string) => argv[index + 1] ?? fail(`${flag} needs a value.`);
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--database":
        options.database = value(i++, "--database");
        break;
      case "--config":
        options.config = value(i++, "--config");
        break;
      case "--persist-to":
        options.persistTo = value(i++, "--persist-to");
        break;
      case "--out":
        options.out = value(i++, "--out");
        break;
      case "--remote":
        options.remote = true;
        break;
      case "--no-run":
        options.noRun = true;
        break;
      case "--help":
      case "-h":
        process.stdout.write("pnpm first-admin [--database <name>] [--remote] [--config <file>] [--persist-to <dir>] [--no-run --out <file>]\nSee docs/cloudflare/first-super-admin.md.\n");
        process.exit(0);
        break;
      default:
        fail(`Unknown argument "${argv[i]}". Run with --help.`);
    }
  }
  if (options.remote && !options.database) fail("--remote needs --database <name>: a real database is named on purpose, there is no default.");
  if (options.remote && options.persistTo) fail("--persist-to is for the local database only.");
  if (options.noRun && (options.remote || !options.out)) fail("--no-run writes the SQL to a file and stops: use it with --out <file> and without --remote.");
  if (options.out && !options.noRun) fail("--out is for --no-run.");
  return options;
}

// ------------------------------------------------------------------------------------------------ questions

// A person at a terminal types, and a password is not shown. Without a terminal (a test, a pipe) the answers are
// read from standard input, one per line, in the order of the questions. The prompts go to stderr, so stdout stays clean.
let piped: string[] | null | undefined;
const pipedAnswers = () => (piped === undefined ? (piped = process.stdin.isTTY ? null : readFileSync(0, "utf8").split(/\r?\n/)) : piped);

function askTerminal(question: string, hidden: boolean): Promise<string> {
  return new Promise((resolveAnswer) => {
    process.stderr.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let typed = "";
    const finish = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          finish();
          resolveAnswer(typed);
          return;
        }
        if (char === "\u0003") {
          finish();
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") {
          if (typed.length > 0) {
            typed = typed.slice(0, -1);
            if (!hidden) process.stderr.write("\b \b");
          }
        } else if (char >= " ") {
          typed += char;
          if (!hidden) process.stderr.write(char);
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function ask(question: string, { hidden = false } = {}): Promise<string> {
  const answers = pipedAnswers();
  if (answers) {
    process.stderr.write(`${question}\n`);
    return answers.shift() ?? "";
  }
  return askTerminal(question, hidden);
}

// ------------------------------------------------------------------------------------------------ wrangler

function wrangler(options: Options, database: string, args: string[]) {
  const target = options.remote ? ["--remote"] : ["--local", ...(options.persistTo ? ["--persist-to", options.persistTo] : [])];
  return spawnSync("pnpm", ["exec", "wrangler", "d1", "execute", database, ...target, "--config", options.config, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: process.env.WRANGLER_SEND_METRICS ?? "false" },
  });
}

interface Inspection {
  signable: number;
  sameEmail: number;
}

function inspect(options: Options, database: string, email: string, hide: string[]): Inspection {
  const run = wrangler(options, database, ["--command", inspectSql(email), "--json"]);
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  if (run.error) fail(`Could not run wrangler: ${run.error.message}`);
  if (run.status !== 0) {
    if (/no such (table|view)/i.test(output)) {
      fail("The database has no tables yet, or it is missing migration 0010. Apply the migrations first (docs/cloudflare/first-super-admin.md, step 2).");
    }
    fail(`wrangler could not read the database:\n${redact(output, hide).trim()}`);
  }
  const start = (run.stdout ?? "").indexOf("[");
  try {
    const row = JSON.parse((run.stdout ?? "").slice(start))[0].results[0] as { signable: number; same_email: number };
    return { signable: Number(row.signable), sameEmail: Number(row.same_email) };
  } catch {
    return fail("wrangler answered something this command does not understand. Nothing was written.");
  }
}

function redact(text: string, secrets: string[]): string {
  return secrets.reduce((out, secret) => (secret ? out.replaceAll(secret, "[hidden]") : out), text);
}

// ------------------------------------------------------------------------------------------------ the command

const options = parseArguments(process.argv.slice(2));
const database = options.database ?? DEFAULT_LOCAL_DATABASE;

if (!options.noRun && !existsSync(options.config)) fail(`${options.config} not found. Run this from cf/admin (or pass --config).`);
if (options.out) {
  const target = resolve(options.out);
  const parent = existsSync(dirname(target)) ? realpathSync(dirname(target)) : dirname(target);
  if (`${parent}${sep}`.startsWith(`${realpathSync(repoRoot)}${sep}`)) fail("--out must be outside the repository: the file holds a password hash, and the repository is public.");
  if (existsSync(target)) fail(`${target} already exists; this command does not overwrite.`);
}

process.stderr.write(
  options.remote
    ? `\nREMOTE: this will change the real database "${database}" in your Cloudflare account.\n\n`
    : options.noRun
      ? "\nThis writes the SQL to a file and does not touch any database.\n\n"
      : `\nThis creates the first super_admin in the LOCAL database "${database}" (nothing leaves this machine).\n\n`,
);

const rawEmail = await ask("Email address of the first super_admin: ");
const email = parseEmail(rawEmail);
if (!email) fail("That is not a usable email address.");
if (parseEmail(await ask("Type the address again: ")) !== email) fail("The two addresses are different. Nothing was done.");
const name = parseName(await ask("Name (Enter = the part before the @): "), email);
if (!name) fail("That name is too long (120 characters at most).");
const password = await ask("Password (not shown): ", { hidden: true });
const problem = passwordProblem(password);
if (problem) fail(`${problem} Nothing was done.`);
if ((await ask("Type the password again (not shown): ", { hidden: true })) !== password) fail("The two passwords are different. Nothing was done.");

const { input, sql } = await makeFirstAdmin({ email, name, password });
const secrets = [input.passwordHash, password];

if (options.noRun) {
  const target = resolve(options.out!);
  writeFileSync(target, sql, { mode: 0o600, flag: "wx" });
  chmodSync(target, 0o600);
  process.stderr.write(`\nWrote ${target} (mode 0600). It holds the password HASH: keep it off chat and out of the repository, run it, then delete it.\n`);
  process.stderr.write(`Run it with: pnpm exec wrangler d1 execute <database> <--local or --remote> --file ${target}\n`);
  process.exit(0);
}

// The confirmation comes BEFORE the first command that reaches the database, even the one that only reads: a real
// database is not touched until its name has been typed.
const confirmed = options.remote
  ? (await ask(`Type the database name (${database}) to create ${email} as super_admin there: `)) === database
  : /^y(es)?$/i.test((await ask(`Create ${email} as super_admin in the local database "${database}"? Type y to continue: `)).trim());
if (!confirmed) fail("Not confirmed. Nothing was done.");

// What the database says now, before anything is written.
const before = inspect(options, database, email, secrets);
if (before.signable > 0) fail("A super_admin who can sign in already exists. Sign in and invite further admins from Pengaturan. Nothing was done.");
if (before.sameEmail > 0) fail("That address already has an account (any role). Use another address. Nothing was done.");

// The SQL lives in a private directory under the system temp, never in the repository, and is removed whatever happens.
const directory = mkdtempSync(join(tmpdir(), "sakem-first-admin-"));
try {
  const file = join(directory, "first-admin.sql");
  writeFileSync(file, sql, { mode: 0o600 });
  const run = wrangler(options, database, ["--file", file]);
  if (run.error) fail(`Could not run wrangler: ${run.error.message}`);
  if (run.status !== 0) fail(`wrangler failed:\n${redact(`${run.stdout ?? ""}${run.stderr ?? ""}`, secrets).trim()}`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}

const after = inspect(options, database, email, secrets);
if (after.signable < 1 || after.sameEmail !== 1) fail(`The statements ran but the database does not show ${email} as a super_admin who can sign in. Check it before trying again; do not run this twice blindly.`);
process.stdout.write(`\nDone: ${email} is a super_admin and can sign in with the password just typed (it was not stored anywhere but as a hash in the database).\nThe temporary SQL file was deleted.\n`);
