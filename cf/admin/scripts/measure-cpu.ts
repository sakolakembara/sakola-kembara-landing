// Local CPU comparison of the admin Worker's hot routes, before and after a change (SAKEM-091).
//
//   pnpm measure:cpu                       the whole table (about 15 minutes)
//   pnpm measure:cpu -- --only me,blog     only the scenarios whose name contains one of these words
//   pnpm measure:cpu -- --repeat 5         fresh processes per scenario for the edge-like numbers (default 3; the median of them)
//   pnpm measure:cpu -- --json out.json    also write the numbers (the default folder, .measure/, is ignored by the repository)
//   pnpm measure:cpu -- --rebuild          make the fixture database again
//
// It runs the REAL Worker code (the Hono apps, Better Auth, Drizzle, the serializers) in plain Node on a local
// SQLite behind a D1-shaped shim (scripts/lib/node-d1.ts), and times what the Worker's own JavaScript spends per
// request, with the time SQLite spent subtracted (on Cloudflare the query runs on the D1 side and costs the Worker no
// CPU). No account, no network, no workerd: workerd freezes its timers during synchronous code, so a Worker cannot
// time itself; Node's timers are real.
//
// Two regimes, because a Worker on the Free plan is mostly cold JavaScript:
//
//   edge-like   a FRESH process per scenario with `node --jitless` (V8's interpreter only, no JIT), 12 requests: the
//               first one (lazy compilation of everything the route touches) and the median of requests 3 to 12.
//               A low-traffic Worker rarely runs a function often enough to be optimised, so the work that
//               matters is how much JavaScript a request runs at all, which is what this regime weighs.
//   warm        the normal Node JIT, 50 warm-up requests, then 300 measured: the floor, what a busy isolate reaches.
//
// The absolute numbers are this machine's and not Cloudflare's. The RELATIVE change between two runs on the same
// machine is the result; the PR that introduced this script compares before and after. Calibration against the
// real edge numbers of 2026-10-14 is in docs/cloudflare/free-plan-audit.md.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const adminRoot = path.resolve(here, "..");
const measureDir = path.join(adminRoot, ".measure");
const fixtureFile = path.join(measureDir, "cpu-fixture.sqlite");
const cookiesFile = path.join(measureDir, "cpu-fixture-cookies.json");

// --------------------------------------------------------------------------------------------- scenarios

interface Scenario {
  /** Short name, also the filter word of `--only`. */
  name: string;
  /** Which app answers: the Worker's default export, or the PublicApi entrypoint's app. */
  app: "default" | "public";
  method?: "GET" | "POST";
  /** JSON body of a POST; `{password}` is the seeded accounts' password. */
  body?: unknown;
  /** Path; `{slug}` is the slug of an article of the fixture. */
  path: string;
  /** Sign in first as this seeded account and send the session cookie. */
  as?: "super_admin" | "editor_konten";
  note: string;
}

export const SCENARIOS: readonly Scenario[] = [
  { name: "config", app: "default", path: "/api/config", note: "GET /api/config" },
  { name: "me-anon", app: "default", path: "/api/me", note: "GET /api/me, no cookie (401)" },
  { name: "dashboard-anon", app: "default", path: "/api/dashboard", note: "GET /api/dashboard, no cookie (401)" },
  { name: "adminblog-anon", app: "default", path: "/api/admin/blog", note: "GET /api/admin/blog, no cookie (401)" },
  { name: "public-face-404", app: "default", path: "/api/public/team", note: "GET /api/public/team from the internet (404)" },
  { name: "me-signedin", app: "default", path: "/api/me", as: "super_admin", note: "GET /api/me, signed in" },
  { name: "dashboard-signedin", app: "default", path: "/api/dashboard", as: "super_admin", note: "GET /api/dashboard, signed in" },
  { name: "adminblog-signedin", app: "default", path: "/api/admin/blog", as: "editor_konten", note: "GET /api/admin/blog, signed in (editor)" },
  { name: "messages-signedin", app: "default", path: "/api/admin/messages", as: "super_admin", note: "GET /api/admin/messages, signed in" },
  { name: "shortlinks-signedin", app: "default", path: "/api/admin/shortlinks", as: "super_admin", note: "GET /api/admin/shortlinks, signed in" },
  { name: "announcements-signedin", app: "default", path: "/api/admin/announcements", as: "super_admin", note: "GET /api/admin/announcements, signed in" },
  { name: "team-signedin", app: "default", path: "/api/admin/team", as: "super_admin", note: "GET /api/admin/team, signed in" },
  { name: "signin-ok", app: "default", method: "POST", path: "/api/auth/sign-in/email", body: { email: "super-admin@example.test", password: "{password}" }, note: "POST sign-in, right password" },
  { name: "signin-wrong", app: "default", method: "POST", path: "/api/auth/sign-in/email", body: { email: "super-admin@example.test", password: "not-the-password-0000" }, note: "POST sign-in, wrong password" },
  { name: "pub-blog", app: "public", path: "/api/public/blog?page=1&pageSize=15", note: "PublicApi: blog list" },
  { name: "pub-article", app: "public", path: "/api/public/blog/{slug}", note: "PublicApi: one article" },
  { name: "pub-team", app: "public", path: "/api/public/team", note: "PublicApi: team" },
  { name: "pub-reports", app: "public", path: "/api/public/reports", note: "PublicApi: reports" },
  { name: "pub-resources", app: "public", path: "/api/public/resources", note: "PublicApi: documents" },
  { name: "pub-shortlink", app: "public", path: "/api/public/shortlinks/daftar-contoh", note: "PublicApi: short link lookup (hit)" },
  { name: "pub-shortlink-miss", app: "public", path: "/api/public/shortlinks/measure-unknown-slug", note: "PublicApi: short link lookup (unknown)" },
];

// --------------------------------------------------------------------------------------------- the child

interface ChildResult {
  scenario: string;
  regime: string;
  status: number;
  bytes: number;
  statements: number;
  /** CPU of the JavaScript per request, ms, in request order (SQLite and PBKDF2 subtracted). */
  samples: number[];
  /** PBKDF2 (native WebCrypto) per request, ms; 0 for a route that does not hash. */
  pbkdf: number[];
}

async function startProfile() {
  const { Session } = await import("node:inspector");
  const session = new Session();
  session.connect();
  const post = (method: string, params?: object) => new Promise<any>((resolve, reject) => session.post(method, params as never, (error, result) => (error ? reject(error) : resolve(result))));
  await post("Profiler.enable");
  await post("Profiler.setSamplingInterval", { interval: 100 });
  await post("Profiler.start");
  return {
    async stop(file: string) {
      const { profile } = await post("Profiler.stop");
      writeFileSync(file, JSON.stringify(profile));
    },
  };
}

async function child(name: string, regime: "cold" | "warm") {
  const scenario = SCENARIOS.find((s) => s.name === name);
  if (!scenario) throw new Error(`unknown scenario ${name}`);

  // Node's `Request` global starts compiling an HTTP client in WebAssembly in the background; `--jitless` has no
  // WebAssembly, so that promise rejects. Nothing here makes an HTTP call: ignore exactly that rejection.
  process.on("unhandledRejection", (reason) => {
    if (!(reason instanceof ReferenceError && /WebAssembly/.test(reason.message))) throw reason;
  });

  // In workerd AsyncLocalStorage is native and always available; in Node the first use turns on promise hooks for the
  // whole process, which costs every later `await`. Turn it on before anything is measured, so a build that uses it
  // (the Worker does, for the shared Better Auth) is not charged for Node's start-up of it, and one that does not
  // (a build from before) is measured under the same conditions.
  const { AsyncLocalStorage } = await import("node:async_hooks");
  new AsyncLocalStorage<number>().enterWith(1);

  const { createNodeD1 } = await import("./lib/node-d1");
  const work = mkdtempSync(path.join(tmpdir(), "sakem-cpu-"));
  const file = path.join(work, "db.sqlite");
  copyFileSync(fixtureFile, file);
  const db = createNodeD1(file);
  const env = {
    DB: db,
    ENVIRONMENT: "test",
    BETTER_AUTH_SECRET: "measure-only-secret-0123456789-abcdefghijklmnop",
    TRUSTED_ORIGINS: "",
    COOKIE_DOMAIN: "",
    SITE_URL: "https://site.example.test",
    UPLOADS_BASE_URL: "",
    // Rate limit bindings that always allow: the real ones are I/O, and one address would otherwise be throttled.
    ...Object.fromEntries(
      ["RL_LOGIN", "RL_LOGIN_ACCOUNT", "RL_REGISTER", "RL_RESET", "RL_VERIFY_RESEND", "RL_MAIL_TARGET", "RL_TOKEN", "RL_CONTACT", "RL_UPLOAD", "RL_BLOG_PREVIEW"].map((n) => [n, { limit: async () => ({ success: true }) }]),
    ),
  } as never;

  // PBKDF2 is native in Node and in workerd: counted apart, so the JavaScript around it shows.
  let pbkdfMs = 0;
  const derive = crypto.subtle.deriveBits.bind(crypto.subtle);
  Object.defineProperty(crypto.subtle, "deriveBits", {
    configurable: true,
    value: async (...args: Parameters<SubtleCrypto["deriveBits"]>) => {
      const started = performance.now();
      try {
        return await derive(...args);
      } finally {
        pbkdfMs += performance.now() - started;
      }
    },
  });

  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise.catch(() => undefined));
    },
    passThroughOnException() {},
  } as never;

  const { default: worker } = await import("../src/worker");
  // The Worker warms its hot paths at start-up, not awaited; a real request arrives after it (nothing but microtasks
  // run in it), so the measurement waits for it too. Absent in a build from before the warm-up existed.
  await ((await import("../src/warmup").catch(() => ({ warmUpDone: undefined }))).warmUpDone);
  const { createInternalApp } = await import("../src/api/public");
  const internal = createInternalApp();
  const fetchWorker = (request: Request) => (scenario.app === "default" ? worker.fetch!(request as never, env, ctx) : internal.fetch(request, env, ctx));

  const origin = "https://admin.example.test";
  const slug = (db.sqlite.prepare("SELECT slug FROM blog_posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 1 OFFSET 3").get() as { slug: string }).slug;
  const url = `${origin}${scenario.path.replace("{slug}", slug)}`;

  const headers: Record<string, string> = { "user-agent": "measure-cpu" };
  // The sessions were made when the fixture was built (a sign-in needs `fetch`, which node's jitless mode lacks).
  if (scenario.as) headers.cookie = (JSON.parse(readFileSync(cookiesFile, "utf8")) as Record<string, string>)[scenario.as]!;

  // What the runtime hands a Worker already built (the Request object, crypto, encoding): touched once, so Node's
  // lazy loading of them is not charged to the first request.
  new Request(url);
  new Response("x");
  await crypto.subtle.digest("SHA-256", new Uint8Array(1));
  new TextEncoder().encode("x");

  const { DEV_PASSWORD } = await import("./seed-data");
  const bodyText = scenario.body === undefined ? undefined : JSON.stringify(scenario.body).replace("{password}", DEV_PASSWORD);
  let nth = 0;
  const once = async () => {
    db.resetDbMs();
    pbkdfMs = 0;
    nth += 1;
    const init: RequestInit = { headers: { ...headers } };
    if (scenario.method === "POST") {
      // A different visitor address each time: the limiters are not what is measured.
      Object.assign(init.headers!, { "content-type": "application/json", origin, "cf-connecting-ip": `203.0.113.${nth % 250}` });
      init.method = "POST";
      init.body = bodyText;
    }
    const request = new Request(url, init);
    const start = performance.now();
    const response = await fetchWorker(request);
    await Promise.all(pending.splice(0));
    const total = performance.now() - start;
    const body = await response.text();
    return { cpu: total - db.dbMs() - pbkdfMs, pbkdf: pbkdfMs, status: response.status, bytes: body.length, statements: db.statements() };
  };

  const samples: number[] = [];
  const pbkdf: number[] = [];
  let last = { status: 0, bytes: 0, statements: 0 };
  const count = Number(process.env.MEASURE_COUNT) || (regime === "cold" ? 12 : 300);
  if (regime === "warm") for (let i = 0; i < 50; i++) await once();
  // MEASURE_PROFILE=file.cpuprofile: a V8 CPU profile of the measured requests only (not of the start-up).
  const profile = process.env.MEASURE_PROFILE ? await startProfile() : null;
  for (let i = 0; i < count; i++) {
    const r = await once();
    samples.push(r.cpu);
    pbkdf.push(r.pbkdf);
    last = r;
  }
  if (profile) await profile.stop(process.env.MEASURE_PROFILE!);
  rmSync(work, { recursive: true, force: true });
  const result: ChildResult = { scenario: name, regime, status: last.status, bytes: last.bytes, statements: last.statements, samples, pbkdf };
  process.stdout.write(`\n@@RESULT@@${JSON.stringify(result)}\n`);
}

// --------------------------------------------------------------------------------------------- the fixture

/** The seeded database plus the real 86 articles and school-sized lists, as a SQLite file the children copy. */
async function buildFixture() {
  mkdirSync(measureDir, { recursive: true });
  rmSync(fixtureFile, { force: true });
  const { createNodeD1 } = await import("./lib/node-d1");
  const { seed } = await import("./seed-data");
  const { readLegacyArticles, importStatements } = await import("./import-legacy-blog");
  const { readdirSync, readFileSync } = await import("node:fs");

  const db = createNodeD1(":memory:");
  for (const file of readdirSync(path.join(adminRoot, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    db.sqlite.exec(readFileSync(path.join(adminRoot, "migrations", file), "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  await seed(db);
  db.sqlite.exec("DELETE FROM blog_posts");
  const articles = await readLegacyArticles();
  for (const statement of importStatements(articles)) db.sqlite.exec(statement);

  // School-sized lists on top of the seed's handful (about what the live site has).
  const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const rows: string[] = [];
  const categories = ["dewan_pembina", "dewan_pengawas", "pengurus"];
  for (let i = 0; i < 24; i++) {
    const edu = JSON.stringify([{ institution: `Universitas Contoh ${i}`, degree: "S1", year: "2010" }]);
    const work = JSON.stringify([{ organization: `Lembaga Contoh ${i}`, role: "Anggota", period: "2015 - 2020" }]);
    rows.push(
      `INSERT INTO team_members (id, name, role, category, image, bio, display_order, education_history, work_history) VALUES (${q(`vol-t-${i}`)}, ${q(`Anggota Volume ${i}`)}, 'Peran Contoh', ${q(categories[i % 3]!)}, ${q(`/images/team/volume-${i}.jpg`)}, ${q("Bio contoh. ".repeat(25))}, ${i}, ${q(edu)}, ${q(work)});`,
    );
  }
  for (let i = 0; i < 16; i++) {
    rows.push(`INSERT INTO reports (id, title, category, year, file_path, file_size) VALUES (${q(`vol-r-${i}`)}, ${q(`Laporan Volume ${i}`)}, 'yearly', ${q(String(2010 + i))}, ${q(`/reports/volume-${i}.pdf`)}, 1000000);`);
  }
  const cats = ["panduan", "berkas-pendaftaran", "berkas-marketing", "tutorial", "lainnya"];
  for (let i = 0; i < 25; i++) {
    rows.push(
      `INSERT INTO site_resources (id, title, category, display_order, content_type, file_path, file_size) VALUES (${q(`vol-d-${i}`)}, ${q(`Dokumen Volume ${i}`)}, ${q(cats[i % 5]!)}, ${i}, 'file', ${q(`/resources/volume-${i}.pdf`)}, 500000);`,
    );
  }
  db.sqlite.exec(rows.join("\n"));

  // Two sessions, made through the real sign-in route, so the signed-in scenarios send a real cookie.
  register("./lib/workers-stub-hooks.mjs", import.meta.url);
  const { default: worker } = await import("../src/worker");
  // The Worker warms its hot paths at start-up, not awaited; a real request arrives after it (nothing but microtasks
  // run in it), so the measurement waits for it too. Absent in a build from before the warm-up existed.
  await ((await import("../src/warmup").catch(() => ({ warmUpDone: undefined }))).warmUpDone);
  const { DEV_PASSWORD } = await import("./seed-data");
  const env = { DB: db, ENVIRONMENT: "test", BETTER_AUTH_SECRET: "measure-only-secret-0123456789-abcdefghijklmnop" } as never;
  const waiting: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => waiting.push(p.catch(() => undefined)), passThroughOnException() {} } as never;
  const origin = "https://admin.example.test";
  const cookies: Record<string, string> = {};
  for (const [as, email] of [["super_admin", "super-admin@example.test"], ["editor_konten", "editor-konten@example.test"]] as const) {
    const response = await worker.fetch!(
      new Request(`${origin}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ email, password: DEV_PASSWORD }) }) as never,
      env,
      ctx,
    );
    if (response.status !== 200) throw new Error(`sign-in as ${as} failed: ${response.status}`);
    cookies[as] = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    await Promise.all(waiting.splice(0));
  }
  writeFileSync(cookiesFile, JSON.stringify(cookies));
  db.sqlite.exec(`VACUUM INTO '${fixtureFile.replaceAll("'", "''")}'`);
  console.log(`fixture: ${articles.length} articles, ${fixtureFile}`);
}

// --------------------------------------------------------------------------------------------- the parent

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const fmt = (n: number | undefined) => (n === undefined ? "".padStart(7) : n.toFixed(2).padStart(7));

function runChild(name: string, regime: "cold" | "warm", root: string = adminRoot): ChildResult {
  const nodeArgs = [...(regime === "cold" ? ["--jitless"] : []), "--no-warnings", "--import", "tsx", "--import", "./scripts/lib/register-stub.mjs", "scripts/measure-cpu.ts", "--child", name, regime];
  const run = spawnSync(process.execPath, nodeArgs, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60_000 });
  const marker = run.stdout.split("@@RESULT@@")[1];
  if (!marker) throw new Error(`${name} (${regime}) failed:\n${run.stdout.slice(-1500)}\n${run.stderr.slice(-1500)}`);
  return JSON.parse(marker) as ChildResult;
}

/** One fresh process is noisy (the first request above all): the edge-like numbers are the median of the fresh processes for "first" and "p50", and the worst of them for "max". */
function summarize(colds: ChildResult[], warm: ChildResult) {
  const sorted = [...warm.samples].sort((a, b) => a - b);
  const hashes = warm.pbkdf.filter((x) => x > 0);
  return {
    status: colds[0]!.status,
    statements: colds[0]!.statements,
    bytes: colds[0]!.bytes,
    first: median(colds.map((run) => run.samples[0]!)),
    p50: median(colds.map((run) => median(run.samples.slice(2)))),
    max: Math.max(...colds.map((run) => Math.max(...run.samples.slice(2)))),
    warmP50: median(warm.samples),
    warmP95: sorted[Math.floor(sorted.length * 0.95)]!,
    pbkdf2: hashes.length > 0 ? median(hashes) : undefined,
  };
}

async function main(argv: string[]) {
  const childAt = argv.indexOf("--child");
  if (childAt >= 0) return child(argv[childAt + 1]!, argv[childAt + 2] as "cold" | "warm");

  if (argv.includes("--rebuild") || !existsSync(fixtureFile) || !existsSync(cookiesFile)) await buildFixture();

  const onlyAt = argv.indexOf("--only");
  const words = onlyAt >= 0 ? argv[onlyAt + 1]!.split(",") : [];
  const picked = SCENARIOS.filter((s) => words.length === 0 || words.some((w) => s.name.includes(w)));
  const repeatAt = argv.indexOf("--repeat");
  const repeat = repeatAt >= 0 ? Number(argv[repeatAt + 1]) : 3;
  // --compare DIR: another copy of cf/admin (an earlier commit, with this script copied into it) is measured with
  // this one, process by process in turns, so the load of the machine falls on both alike. The table shows
  // "before > after".
  const compareAt = argv.indexOf("--compare");
  const otherRoot = compareAt >= 0 ? path.resolve(argv[compareAt + 1]!) : null;
  if (otherRoot && (!existsSync(path.join(otherRoot, ".measure/cpu-fixture.sqlite")) || argv.includes("--rebuild"))) {
    const built = spawnSync(process.execPath, ["--no-warnings", "--import", "tsx", "scripts/measure-cpu.ts", "--rebuild", "--only", "none-such"], { cwd: otherRoot, encoding: "utf8" });
    if (built.status !== 0) throw new Error(`could not build the fixture of ${otherRoot}:\n${built.stdout}${built.stderr}`);
  }

  console.log("ms of the Worker's own JavaScript per request (SQLite and native PBKDF2 subtracted); sql = statements per request" + (otherRoot ? "; each cell is before > after" : ""));
  const pair = (b: number | undefined, a: number | undefined) => (otherRoot ? `${fmt(b)} >${fmt(a)}` : fmt(a));
  const width = otherRoot ? 16 : 7;
  console.log(
    `${"scenario".padEnd(20)} ${"status".padEnd(6)} ${"sql".padStart(3)} ${"bytes".padStart(7)} | edge-like: ${"first".padStart(width)} ${"p50".padStart(width)} ${"max".padStart(width)} | warm: ${"p50".padStart(width)} ${"p95".padStart(width)} | ${"pbkdf2".padStart(7)}`,
  );
  const rows: Record<string, unknown>[] = [];
  for (const scenario of picked) {
    const before: ChildResult[] = [];
    const after: ChildResult[] = [];
    for (let i = 0; i < repeat; i++) {
      if (otherRoot) before.push(runChild(scenario.name, "cold", otherRoot));
      after.push(runChild(scenario.name, "cold"));
    }
    const beforeWarm = otherRoot ? runChild(scenario.name, "warm", otherRoot) : null;
    const now = summarize(after, runChild(scenario.name, "warm"));
    const old = otherRoot ? summarize(before, beforeWarm!) : null;
    console.log(
      `${scenario.name.padEnd(20)} ${String(now.status).padEnd(6)} ${String(now.statements).padStart(3)} ${String(now.bytes).padStart(7)} |            ${pair(old?.first, now.first)} ${pair(old?.p50, now.p50)} ${pair(old?.max, now.max)} |       ${pair(old?.warmP50, now.warmP50)} ${pair(old?.warmP95, now.warmP95)} | ${fmt(now.pbkdf2)}`,
    );
    rows.push({ scenario: scenario.name, status: now.status, statements: now.statements, bytes: now.bytes, before: old, after: now });
  }
  const jsonAt = argv.indexOf("--json");
  if (jsonAt >= 0) {
    const out = path.resolve(argv[jsonAt + 1]!);
    writeFileSync(out, JSON.stringify({ node: process.version, platform: `${process.platform}-${process.arch}`, rows }, null, 2));
    console.log(`written ${out}`);
  }
}

await main(process.argv.slice(2));
