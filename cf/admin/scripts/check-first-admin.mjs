// End-to-end check of scripts/create-first-admin.ts (docs/cloudflare/first-super-admin.md), on this machine only:
// a clean local D1 in a temporary directory, the real command, the real `wrangler d1 execute`, and then the Worker
// itself (`wrangler dev`), signed in to through its own sign-in route. No Cloudflare account, no login, no remote
// command: the one remote path is checked by refusing it, with a stand-in `pnpm` that records any call.
//
//   pnpm check:first-admin        (run `pnpm build:spa` once before, or the dev server has no assets directory)
//
// It starts ONE wrangler dev process on a free port and stops exactly that process.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const wranglerBin = resolve("node_modules/wrangler/bin/wrangler.js");
const repoRoot = resolve("..", "..");

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "OK  " : "FAIL"}  ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
  if (!ok) failed++;
};

const work = mkdtempSync(join(tmpdir(), "sakem-check-first-admin-"));
const state = join(work, "state");
const sqlTmp = join(work, "sqltmp"); // the command's TMPDIR: whatever it leaves behind shows up here
const fakeBin = join(work, "bin");
const calls = join(work, "calls.log");
mkdirSync(sqlTmp);
mkdirSync(fakeBin);
writeFileSync(join(fakeBin, "pnpm"), `#!/bin/sh\necho "$@" >> "${calls}"\nexit 97\n`);
chmodSync(join(fakeBin, "pnpm"), 0o755);

const email = "owner-check@example.test";
const password = randomBytes(18).toString("base64url"); // never printed
let transcript = ""; // everything the command printed, scanned for the password at the end

function cli(args, answers, extraEnv = {}) {
  const run = spawnSync(process.execPath, [tsxCli, "scripts/create-first-admin.ts", ...args], {
    input: `${answers.join("\n")}\n`,
    encoding: "utf8",
    env: { ...process.env, TMPDIR: sqlTmp, WRANGLER_SEND_METRICS: "false", CI: "1", ...extraEnv },
  });
  transcript += `${run.stdout}${run.stderr}`;
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}
const answersFor = (confirm) => [email, email, "Pemilik Uji", password, password, confirm];

let server;
try {
  // 1. A clean local D1 with every migration.
  const migrations = readdirSync("migrations").filter((f) => f.endsWith(".sql")).length;
  const migrate = spawnSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "sakem-admin", "--local", "--persist-to", state], {
    encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
  });
  check(`a clean local D1: ${migrations} migrations apply (exit 0)`, migrate.status === 0, `${migrate.stdout}${migrate.stderr}`.slice(-600));

  // 2. Refusals that must happen before anything is touched.
  const noName = cli(["--remote"], []);
  check("--remote without --database is refused", noName.status === 1 && /needs --database/.test(noName.out));
  const wrongConfirm = cli(["--remote", "--database", "sakem-admin"], answersFor("not-the-name"), { PATH: `${fakeBin}:${process.env.PATH}` });
  check("--remote with the name typed wrong is refused", wrongConfirm.status === 1 && /Not confirmed/.test(wrongConfirm.out));
  check("...and no wrangler (no pnpm) call was even attempted", !existsSync(calls), existsSync(calls) ? readFileSync(calls, "utf8") : "");
  const shortPassword = cli(["--persist-to", state], [email, email, "", "short", "short", "y"]);
  check("a password under 8 characters is refused", shortPassword.status === 1 && /at least 8/.test(shortPassword.out));
  const mismatch = cli(["--persist-to", state], [email, email, "", password, `${password}x`, "y"]);
  check("two different passwords are refused", mismatch.status === 1 && /different/.test(mismatch.out));
  const declined = cli(["--persist-to", state], answersFor("n"));
  check("answering anything but y writes nothing", declined.status === 1 && /Not confirmed/.test(declined.out));

  // 3. The real thing, on the local database.
  const created = cli(["--persist-to", state], answersFor("y"));
  check("the command creates the first super_admin (exit 0)", created.status === 0 && /Done:/.test(created.out), created.out.slice(-600));
  // (Node and tsx keep their own caches in the same TMPDIR; what matters is the command's directory.)
  const leftover = readdirSync(sqlTmp).filter((name) => name.startsWith("sakem-first-admin-"));
  check("the temporary SQL file and its directory are gone", leftover.length === 0, leftover.join(", "));

  // 4. A second run, and a taken address, are refused.
  const again = cli(["--persist-to", state], answersFor("y"));
  check("a second run is refused: a super_admin who can sign in exists", again.status === 1 && /already exists/.test(again.out), again.out.slice(-300));

  // 5. --no-run: a file, mode 0600, outside the repo; never inside it.
  const inside = cli(["--no-run", "--out", join(repoRoot, "first-admin-check.sql")], []);
  check("--no-run --out inside the repository is refused", inside.status === 1 && /outside the repository/.test(inside.out) && !existsSync(join(repoRoot, "first-admin-check.sql")));
  const outFile = join(work, "written.sql");
  const written = cli(["--no-run", "--out", outFile], [email, email, "", password, password]);
  const mode = existsSync(outFile) ? statSync(outFile).mode & 0o777 : 0;
  const text = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";
  check("--no-run writes the SQL with mode 0600, with the hash and without the password", written.status === 0 && mode === 0o600 && text.includes("pbkdf2-sha256$") && !text.includes(password), `status ${written.status} mode ${mode.toString(8)}`);
  const overwrite = cli(["--no-run", "--out", outFile], []);
  check("--no-run does not overwrite a file", overwrite.status === 1 && /already exists/.test(overwrite.out));

  // 6. The Worker: sign in through its own route, with what was typed.
  const port = await new Promise((resolvePort) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address();
      probe.close(() => resolvePort(free));
    });
  });
  if (!existsSync("dist/spa/index.html")) {
    mkdirSync("dist/spa", { recursive: true });
    writeFileSync("dist/spa/index.html", "<!doctype html><title>spa stub for the check</title>");
  }
  server = spawn(
    process.execPath,
    [wranglerBin, "dev", "--local", "--persist-to", state, "--ip", "127.0.0.1", "--port", String(port), "--var", "ENVIRONMENT:development", "--var", `BETTER_AUTH_SECRET:${randomBytes(24).toString("hex")}`],
    { env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" }, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  server.stdout.on("data", (chunk) => (log += chunk));
  server.stderr.on("data", (chunk) => (log += chunk));
  const base = `http://127.0.0.1:${port}`;
  const ready = await new Promise((resolveReady) => {
    const timer = setTimeout(() => resolveReady(false), 90_000);
    const poll = setInterval(() => {
      if (/Ready on/.test(log)) {
        clearInterval(poll);
        clearTimeout(timer);
        resolveReady(true);
      }
    }, 250);
    server.on("exit", () => resolveReady(false));
  });
  check("wrangler dev is up on a free port", ready, log.slice(-600));

  if (ready) {
    const post = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body) });
    const wrong = await post("/api/auth/sign-in/email", { email, password: `${password}x` });
    check("a wrong password does not sign in (401)", wrong.status === 401, String(wrong.status));
    const signIn = await post("/api/auth/sign-in/email", { email, password });
    const cookie = (signIn.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    check("the typed email and password sign in through the Worker (200, a session cookie)", signIn.status === 200 && cookie !== "", String(signIn.status));
    const me = await (await fetch(`${base}/api/me`, { headers: { cookie } })).json();
    check("the session is a super_admin", me?.user?.role === "super_admin" && me.user.email === email, JSON.stringify(me).slice(0, 200));
    const users = await fetch(`${base}/api/admin/users`, { headers: { cookie } });
    const body = await users.json().catch(() => ({}));
    check("Pengaturan opens, listing that one admin as active", users.status === 200 && body.items?.length === 1 && body.items[0].status === "active", JSON.stringify(body).slice(0, 200));
    const audit = await fetch(`${base}/api/admin/audit`, { headers: { cookie } });
    const rows = (await audit.json().catch(() => ({}))).items ?? [];
    check("Aktivitas shows the creation as the first row", rows[0]?.action === "admin.create" && rows[0]?.actorEmail === email, JSON.stringify(rows[0] ?? null));
  }
} finally {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolveExit) => {
      const timer = setTimeout(() => {
        server.kill("SIGKILL");
        resolveExit();
      }, 10_000);
      server.on("exit", () => {
        clearTimeout(timer);
        resolveExit();
      });
    });
  }
  check("the password never appeared in what the command printed", !transcript.includes(password) && !transcript.includes("pbkdf2-sha256$"));
  rmSync(work, { recursive: true, force: true });
}

console.log(failed === 0 ? "\nThe first-admin command works end to end on a clean local database." : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
