// Something built from a D1 binding, built once per binding for the life of the isolate. For a prepared Drizzle
// query that is the whole point: the query builder runs on the first request and never again
// (src/public/prepared.ts says why, and docs/cloudflare/free-plan-audit.md has the measurement). The WeakMap lets
// the value go with its binding.

const memos = new WeakMap<object, Map<string, unknown>>();

export function memoPerBinding<T>(binding: object, key: string, build: () => T): T {
  let byKey = memos.get(binding);
  if (!byKey) {
    byKey = new Map();
    memos.set(binding, byKey);
  }
  if (byKey.has(key)) return byKey.get(key) as T;
  const value = build();
  byKey.set(key, value);
  return value;
}
