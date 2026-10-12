// Local wall time of the public read endpoints, as a proxy for their CPU cost
// (workerd freezes timers during synchronous code, so CPU cannot be measured
// locally; the real number is SAKEM-084 on a Free account). Run against a
// `wrangler dev` that has the dev seed (pnpm db:migrate:local, pnpm db:seed:local):
//
//   pnpm exec wrangler dev --port 8791 &        # or any free port
//   node scripts/measure-public.mjs --base http://127.0.0.1:8791 [--n 40] [--volume] [--slug vol-artikel-100]
//   node scripts/measure-public.mjs --clean-volume      # removes what --volume added
//
// --volume first adds school-sized volume to the LOCAL database (250 articles of
// about 12 KB, 50 team members, 100 reports, 60 documents), the size the budget
// in docs/cloudflare/public-api.md is written for. It only ever runs
// `wrangler d1 execute --local`; nothing here can reach an account.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

const base = option("--base", "http://127.0.0.1:8787").replace(/\/+$/, "");
const n = Number(option("--n", "40"));
const WARMUP = 5;

const q = (value) => `'${String(value).replaceAll("'", "''")}'`;

function volumeSql() {
  const lines = [];
  const day = 86_400_000;
  const base = Date.UTC(2026, 4, 30, 5);
  const categories = ["News", "Cerita", "Tips", "Career", "Education"];
  for (let i = 0; i < 250; i++) {
    const body = "Paragraf contoh untuk ukuran. ".repeat(200); // about 6 KB
    const html = `<p>${body}</p>`.repeat(1);
    lines.push(
      `INSERT INTO blog_posts (id, slug, title, excerpt, content_markdown, content_html, category, author, featured, status, published_at) VALUES (${q(`vol-${i}`)}, ${q(`vol-artikel-${String(i).padStart(3, "0")}`)}, ${q(`Artikel volume ${i}`)}, ${q(`Ringkasan ${i} [&hellip;]`)}, ${q(body)}, ${q(html)}, ${q(categories[i % 5])}, 'Contoh Penulis', ${i % 31 === 7 ? 1 : 0}, 'published', ${base - i * day});`,
    );
  }
  const members = ["dewan_pembina", "dewan_pengawas", "pengurus"];
  for (let i = 0; i < 50; i++) {
    lines.push(`INSERT INTO team_members (id, name, role, category, bio, display_order) VALUES (${q(`vol-t-${i}`)}, ${q(`Anggota volume ${i}`)}, 'Peran contoh', ${q(members[i % 3])}, ${q("Bio contoh. ".repeat(20))}, ${i});`);
  }
  for (let i = 0; i < 100; i++) {
    lines.push(`INSERT INTO reports (id, title, category, year, file_path, file_size) VALUES (${q(`vol-r-${i}`)}, ${q(`Laporan volume ${i}`)}, 'yearly', ${q(String(2000 + (i % 25)))}, ${q(`/reports/vol-${i}.pdf`)}, 1000);`);
  }
  const cats = ["panduan", "berkas-pendaftaran", "berkas-marketing", "tutorial", "lainnya"];
  for (let i = 0; i < 60; i++) {
    lines.push(`INSERT INTO site_resources (id, title, category, display_order, content_type, file_path, file_size) VALUES (${q(`vol-d-${i}`)}, ${q(`Dokumen volume ${i}`)}, ${q(cats[i % 5])}, ${i}, 'file', ${q(`/resources/vol-${i}.pdf`)}, 1000);`);
  }
  return lines.join("\n");
}

function runSql(sql) {
  const dir = mkdtempSync(join(tmpdir(), "sakem-volume-"));
  try {
    const file = join(dir, "volume.sql");
    writeFileSync(file, sql);
    execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "sakem-admin", "--local", "--file", file], { stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CLEAN_SQL = [
  "DELETE FROM blog_posts WHERE id LIKE 'vol-%';",
  "DELETE FROM team_members WHERE id LIKE 'vol-t-%';",
  "DELETE FROM reports WHERE id LIKE 'vol-r-%';",
  "DELETE FROM site_resources WHERE id LIKE 'vol-d-%';",
].join("\n");

if (flag("--clean-volume")) {
  runSql(CLEAN_SQL);
  console.log("volume rows removed");
  process.exit(0);
}
if (flag("--volume")) {
  runSql(`${CLEAN_SQL}\n${volumeSql()}`);
  console.log("volume rows added (remove them with --clean-volume)");
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)];

const routes = [
  "/api/public/team",
  "/api/public/reports",
  "/api/public/resources",
  "/api/public/announcements/current",
  "/api/public/blog",
  "/api/public/blog?page=3",
  "/api/public/blog?pageSize=50",
  "/api/public/blog/__first__",
  "/api/public/blog/tidak-ada-artikel-ini",
];

// An article slug that exists: --slug, else the featured one of the index.
const index = await (await fetch(`${base}/api/public/blog?pageSize=1`)).json();
const slug = option("--slug", index.featured?.slug ?? index.articles?.[0]?.slug);

console.log(`base ${base}, ${n} requests per route after ${WARMUP} warm-up, wall time in ms (includes the local HTTP hop)\n`);
console.log("route".padEnd(46), "status", "bytes".padStart(8), "median".padStart(8), "p95".padStart(8));
for (const route of routes) {
  const url = `${base}${route.replace("__first__", slug ?? "x")}`;
  const times = [];
  let status = 0;
  let bytes = 0;
  for (let i = 0; i < n + WARMUP; i++) {
    const start = performance.now();
    const res = await fetch(url);
    const body = await res.arrayBuffer();
    const elapsed = performance.now() - start;
    status = res.status;
    bytes = body.byteLength;
    if (i >= WARMUP) times.push(elapsed);
  }
  console.log(route.padEnd(46), String(status).padEnd(6), String(bytes).padStart(8), median(times).toFixed(1).padStart(8), p95(times).toFixed(1).padStart(8));
}
