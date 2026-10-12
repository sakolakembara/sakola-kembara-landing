import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { authContext } from "../src/auth/session";
import type { AppEnv } from "../src/context";
import type { Bindings } from "../src/env";
import { sameOriginGuard } from "../src/security/csrf";

// Mounting routes that are not part of the shipped Worker (the throwaway
// `__example` resource of the contract test) or that need a spy injected (the
// announcement routes with a fake purger), behind the same chain src/worker.ts
// puts around every /api route: Cache-Control, the same-origin guard, the
// session, and the JSON 404 and 500. Use it with `call(path, { via: app })`.

export function appAround(mounts: Record<string, Hono<AppEnv>>): { fetch: (request: Request, env: Bindings, ctx: ExecutionContext) => Promise<Response> } {
  const app = new Hono<AppEnv>();
  app.use("/api/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
  app.use("/api/*", sameOriginGuard);
  app.use("/api/*", authContext);
  for (const [path, routes] of Object.entries(mounts)) app.route(path, routes);
  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((error, c) => {
    console.error(`[worker] unhandled error: ${error.message}`);
    return c.json({ error: "internal" }, 500);
  });
  return { fetch: (request, bindings, ctx) => Promise.resolve(app.fetch(request, bindings, ctx)) };
}

export interface D1Event {
  /** A statement run on its own, or a `batch` of several. */
  kind: "single" | "batch";
  /** The SQL text of each statement. */
  sql: string[];
}

/**
 * A D1 binding that records what runs through it: pass it as `env: { DB: spy.db }` to `call`, then read
 * `spy.events`. `touching("example_items")` keeps the events that involve one table (Better Auth reads
 * the session from the same binding, and that is not what a budget is about). Used to prove the D1
 * budget of docs/cloudflare/admin-crud.md#12-d1-budget-rules.
 */
export function spyOnD1(real: D1Database) {
  const events: D1Event[] = [];
  const sqlOf = new WeakMap<object, string>();

  function track(statement: D1PreparedStatement, query: string): D1PreparedStatement {
    const proxy = new Proxy(statement, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown;
        if (typeof value !== "function") return value;
        if (property === "bind") return (...args: unknown[]) => track((value as (...a: unknown[]) => D1PreparedStatement).apply(target, args), query);
        if (property === "first" || property === "all" || property === "run" || property === "raw") {
          return (...args: unknown[]) => {
            events.push({ kind: "single", sql: [query] });
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return value.bind(target);
      },
    });
    // Drizzle hands the proxy back to `batch`, so the proxy is what has to be looked up there.
    sqlOf.set(proxy, query);
    return proxy;
  }

  const db = new Proxy(real, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function") return value;
      if (property === "prepare") return (query: string) => track(target.prepare(query), query);
      if (property === "batch") {
        return (statements: D1PreparedStatement[]) => {
          events.push({ kind: "batch", sql: statements.map((statement) => sqlOf.get(statement) ?? "?") });
          return target.batch(statements);
        };
      }
      return value.bind(target);
    },
  });

  return {
    db,
    events,
    touching: (table: string) => events.filter((event) => event.sql.some((sql) => sql.includes(table))),
  };
}

/** The `If-Match` header of a row, as the SPA builds it from the `updatedAt` it loaded. */
export async function ifMatchOf(table: string, id: string): Promise<{ "if-match": string }> {
  const row = await env.DB.prepare(`SELECT updated_at AS v FROM ${table} WHERE id = ?`).bind(id).first<{ v: number }>();
  if (!row) throw new Error(`no row ${id} in ${table}`);
  return { "if-match": `"${new Date(row.v).toISOString()}"` };
}
