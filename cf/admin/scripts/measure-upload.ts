// Local wall time of the upload endpoint, as a proxy for its cost (SAKEM-082).
//
// Workerd freezes its timers during synchronous code, so the CPU time of a
// request cannot be measured locally; the real number needs a Free account
// (SAKEM-084: the dashboard and `wrangler tail` report CPU ms per request, and
// the limit is 10 ms). What this prints is the wall time a client sees for a
// whole upload to a local `wrangler dev`: the transfer over localhost, the
// multipart parse, the byte checks, the write to the local R2 emulation, the D1
// batch. It includes things the real platform does not charge to the Worker
// (the transfer, the emulated storage), so read it as an upper bound of the
// Worker's own work, not as CPU.
//
// Run it against a `wrangler dev` with the dev seed, in a scratch directory so
// nothing lands in .wrangler/state of the project:
//
//   pnpm exec wrangler d1 migrations apply sakem-admin --local --persist-to /tmp/sakem-measure
//   pnpm exec tsx scripts/seed.ts --persist-to /tmp/sakem-measure
//   pnpm exec wrangler dev --port 8831 --persist-to /tmp/sakem-measure     # with .dev.vars: ENVIRONMENT=development
//   pnpm measure:upload -- --base http://127.0.0.1:8831 [--n 10]
//
// It only talks to the base URL it is given and signs in with the fake
// accounts of scripts/seed-data.ts. Nothing here can reach a Cloudflare account.

import { DEV_PASSWORD, SEED_USERS } from "./seed-data";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => (args.includes(name) ? args[args.indexOf(name) + 1]! : fallback);
const base = option("--base", "http://127.0.0.1:8787").replace(/\/+$/, "");
const n = Number(option("--n", "10"));
const WARMUP = 2;

const text = (value: string) => new TextEncoder().encode(value);
const be32 = (v: number) => new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
const be16 = (v: number) => new Uint8Array([(v >> 8) & 255, v & 255]);
function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}
const padTo = (bytes: Uint8Array, size: number) => (bytes.length >= size ? bytes : concat(bytes, new Uint8Array(size - bytes.length)));

/** A PNG header padded with zeros to `size` bytes: what the Worker reads (the first bytes) is real, the rest is filler. */
function png(width: number, height: number, size: number) {
  const ihdr = concat(be32(13), text("IHDR"), be32(width), be32(height), new Uint8Array([8, 2, 0, 0, 0]), be32(0));
  return padTo(concat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, be32(0), text("IEND"), be32(0)), size);
}

/** A JPEG whose size segment sits behind 180 kB of metadata, like a phone photo, padded to `size`. */
function jpeg(width: number, height: number, size: number) {
  const jfif = concat(new Uint8Array([0xff, 0xe0]), be16(16), text("JFIF\0"), new Uint8Array([1, 1, 0]), be16(1), be16(1), new Uint8Array([0, 0]));
  const exif = concat(new Uint8Array([0xff, 0xe1]), be16(60_002), new Uint8Array(60_000));
  const sof = concat(new Uint8Array([0xff, 0xc0]), be16(17), new Uint8Array([8]), be16(height), be16(width), new Uint8Array([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]));
  return padTo(concat(new Uint8Array([0xff, 0xd8]), jfif, exif, exif, exif, sof, new Uint8Array([0xff, 0xda, 0, 12, ...new Uint8Array(10)])), size);
}

const pdf = (size: number) => padTo(text("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"), size);

async function signIn(email: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email, password: process.env.SEED_PASSWORD ?? DEV_PASSWORD }),
  });
  if (response.status !== 200) throw new Error(`sign-in as ${email} answered ${response.status}`);
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}

const sessions = [
  await signIn(SEED_USERS.find((u) => u.key === "super_admin")!.email),
  await signIn(SEED_USERS.find((u) => u.key === "editor_multi")!.email),
];
let turn = 0;

async function upload(kind: string, bytes: Uint8Array, filename: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", new File([bytes], filename));
    const cookie = sessions[turn++ % sessions.length]!;
    const started = performance.now();
    const response = await fetch(`${base}/api/admin/uploads?kind=${kind}`, { method: "POST", headers: { cookie, origin: base }, body: form });
    const ms = performance.now() - started;
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, Number(response.headers.get("retry-after") ?? "60") * 1000));
      continue;
    }
    if (response.status !== 201) throw new Error(`upload of ${kind} answered ${response.status}: ${await response.text()}`);
    await response.arrayBuffer();
    return ms;
  }
  throw new Error("rate limited three times in a row");
}

function summary(label: string, bytes: number, samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const mb = (bytes / 1_000_000).toFixed(1);
  console.log(`${label.padEnd(46)} ${mb.padStart(5)} MB   median ${at(0.5).toFixed(1).padStart(6)} ms   p95 ${at(0.95).toFixed(1).padStart(6)} ms   min ${sorted[0]!.toFixed(1)}   max ${sorted.at(-1)!.toFixed(1)}   (n=${samples.length})`);
}

const cases: { label: string; kind: string; make: () => Uint8Array; name: string }[] = [
  { label: "team photo, small PNG (60 kB)", kind: "team-photo", make: () => png(400, 400, 60_000), name: "kecil.png" },
  { label: "team photo, the largest allowed (PNG)", kind: "team-photo", make: () => png(4000, 3000, 5_000_000), name: "terbesar.png" },
  { label: "blog image, the largest allowed (JPEG, EXIF)", kind: "blog-image", make: () => jpeg(4000, 3000, 5_000_000), name: "terbesar.jpg" },
  { label: "report, the largest allowed (PDF)", kind: "report", make: () => pdf(20_000_000), name: "terbesar.pdf" },
  { label: "resource, the largest allowed (PDF)", kind: "resource", make: () => pdf(25_000_000), name: "terbesar.pdf" },
];

console.log(`upload wall time against ${base} (n=${n} each after ${WARMUP} warm-up uploads; the client's time, localhost, local R2 emulation)\n`);
for (const c of cases) {
  const bytes = c.make();
  for (let i = 0; i < WARMUP; i++) await upload(c.kind, bytes, c.name);
  const samples: number[] = [];
  for (let i = 0; i < n; i++) samples.push(await upload(c.kind, bytes, c.name));
  summary(c.label, bytes.length, samples);
}
