// Local measurements for docs/cloudflare/admin-skeleton.md.
//
//   pnpm measure
//
// WALL time in Node, not Worker CPU. Node's PBKDF2 uses OpenSSL and its
// timers are real; workerd freezes timers during synchronous code, so CPU
// cannot be measured locally at all. The real number needs a Free account
// (SAKEM-077): the dashboard and `wrangler tail` report CPU ms per request.
import { createAuth } from "../src/auth/factory";
import { hashPassword, verifyPassword } from "../src/auth/password";
import type { Bindings } from "../src/env";

function summary(label: string, samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  console.log(
    `${label.padEnd(44)} median ${at(0.5).toFixed(2)} ms   p95 ${at(0.95).toFixed(2)} ms   min ${sorted[0]!.toFixed(2)}   max ${sorted.at(-1)!.toFixed(2)}   (n=${samples.length})`,
  );
}

async function time(run: () => Promise<unknown> | unknown): Promise<number> {
  const start = performance.now();
  await run();
  return performance.now() - start;
}

const password = "correct horse battery staple";
const hash = await hashPassword(password);

// Warm up: first calls include JIT and OpenSSL setup.
for (let i = 0; i < 5; i++) await verifyPassword({ hash, password });

const verify: number[] = [];
for (let i = 0; i < 51; i++) verify.push(await time(() => verifyPassword({ hash, password })));
summary("PBKDF2-SHA256 100k verify (right password)", verify);

const wrong: number[] = [];
for (let i = 0; i < 51; i++) wrong.push(await time(() => verifyPassword({ hash, password: "nope nope nope" })));
summary("PBKDF2-SHA256 100k verify (wrong password)", wrong);

const hashing: number[] = [];
for (let i = 0; i < 31; i++) hashing.push(await time(() => hashPassword(password)));
summary("PBKDF2-SHA256 100k hash (sign-up / reset)", hashing);

// Cost of building Better Auth on every request (the per-request factory).
// The D1 binding is a stub: construction does not touch the database.
const env = { DB: {}, BETTER_AUTH_SECRET: "measure-only-secret-0123456789-abcdef", ENVIRONMENT: "test" } as unknown as Bindings;
const context = { baseURL: "https://admin.example.test", waitUntil: () => {} };
const first = await time(() => createAuth(env, context));
const init: number[] = [];
for (let i = 0; i < 101; i++) init.push(await time(() => createAuth(env, context)));
console.log(`createAuth() first call (cold module graph)      ${first.toFixed(2)} ms`);
summary("createAuth() per request (warm)", init);
