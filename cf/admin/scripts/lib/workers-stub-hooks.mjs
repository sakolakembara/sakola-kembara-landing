// Node module hooks for scripts/measure-cpu.ts: `cloudflare:workers` only exists inside workerd, and the Worker's
// entrypoint file imports it (`WorkerEntrypoint`). A stand-in with the same shape lets the file load in Node; the
// measurement drives the Hono apps directly, never through the class. Registered by scripts/lib/register-stub.mjs.

const STUB = "data:text/javascript," + encodeURIComponent(`
export class WorkerEntrypoint {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
}
export const env = {};
export const waitUntil = () => {};
`);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: STUB, shortCircuit: true };
  return nextResolve(specifier, context);
}
