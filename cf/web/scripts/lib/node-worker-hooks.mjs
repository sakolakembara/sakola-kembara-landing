// Node module hooks for scripts/measure-cpu.mjs: `cloudflare:workers` only exists inside workerd, and the built
// Worker imports it. A stand-in with the same names lets the BUILT bundle (dist/server) run in plain Node, where
// timers are real. `env` is the object the measurement fills (`globalThis.__WORKER_ENV__`).

const STUB =
  'data:text/javascript,' +
  encodeURIComponent(`
export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
export const env = (globalThis.__WORKER_ENV__ ??= {});
export const waitUntil = (promise) => globalThis.__WAIT_UNTIL__?.(promise);
`);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') return { url: STUB, shortCircuit: true };
  return nextResolve(specifier, context);
}
