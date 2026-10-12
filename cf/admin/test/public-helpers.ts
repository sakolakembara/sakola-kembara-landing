import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "../src/db/schema";
import { createInternalApp } from "../src/api/public";
import type { ContactDeps } from "../src/public/contact-deps";
import type { Bindings } from "../src/env";

// Helpers of the public API tests: calling the two faces of the Worker,
// counting what a request asks D1 for, and inserting rows.

type Entrypoint = { fetch(request: Request): Promise<Response> };
const entrypoints = exports as unknown as { PublicApi: Entrypoint };

export const INTERNAL_ORIGIN = "https://api.internal.test";

/**
 * A call through the `PublicApi` entrypoint: what a Worker holding the service
 * binding reaches. It goes through the runtime's own entrypoint stub
 * (`ctx.exports`), the same dispatch a service binding uses.
 */
export async function internalFetch(path: string, init: RequestInit & { json?: unknown; clientIp?: string | null } = {}): Promise<Response> {
  const { json, clientIp, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) {
    headers.set("content-type", "application/json");
    rest.body = JSON.stringify(json);
  }
  if (clientIp) headers.set("x-sakem-client-ip", clientIp);
  return entrypoints.PublicApi.fetch(new Request(`${INTERNAL_ORIGIN}${path}`, { ...rest, headers }));
}

/** The internal app with its own limiter, bot check and clock, run directly (the entrypoint always uses the configured ones). */
export async function internalFetchWith(deps: ContactDeps, path: string, init: RequestInit & { json?: unknown; clientIp?: string | null } = {}, bindings: Bindings = env): Promise<Response> {
  const { json, clientIp, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) {
    headers.set("content-type", "application/json");
    rest.body = JSON.stringify(json);
  }
  if (clientIp) headers.set("x-sakem-client-ip", clientIp);
  const ctx = createExecutionContext();
  const response = await createInternalApp(() => deps).fetch(new Request(`${INTERNAL_ORIGIN}${path}`, { ...rest, headers }), bindings, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

/** An address nobody else in the run has used: the rate limit bindings keep their counters for the whole run, and the helper `freshIp` of helpers.ts wraps around after 250 calls. */
export function uniqueIp(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! & 0xffffff;
  return `100.${64 + ((n >> 16) & 0x3f)}.${(n >> 8) & 255}.${(n & 255) || 1}`;
}

/** The internal app with its default collaborators (what the entrypoint runs) but chosen bindings, e.g. production without a rate limit binding. */
export async function internalFetchWithBindings(bindings: Bindings, path: string, init: RequestInit & { json?: unknown; clientIp?: string | null } = {}): Promise<Response> {
  const { json, clientIp, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) {
    headers.set("content-type", "application/json");
    rest.body = JSON.stringify(json);
  }
  if (clientIp) headers.set("x-sakem-client-ip", clientIp);
  const ctx = createExecutionContext();
  const response = await createInternalApp().fetch(new Request(`${INTERNAL_ORIGIN}${path}`, { ...rest, headers }), bindings, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

// ------------------------------------------------------------ D1 counting

export interface D1Stats {
  /** Round trips to D1: a `batch` is one, however many statements it holds. */
  roundTrips: number;
  /** SQL text of every statement run. */
  statements: string[];
  /** Sum of `meta.rows_read` over every statement. */
  rowsRead: number;
}

/**
 * Wraps a D1 binding and records what runs through it. Drizzle reads selects
 * with `raw()`, which carries no `meta`, so for those the statement is run once
 * more with `all()` (not counted as a round trip) just to learn `rows_read`.
 */
export function instrumentD1(real: D1Database): { db: D1Database; stats: D1Stats } {
  const stats: D1Stats = { roundTrips: 0, statements: [], rowsRead: 0 };

  type Wrapped = D1PreparedStatement & { __real: D1PreparedStatement; __sql: string };
  const wrap = (statement: D1PreparedStatement, sql: string): Wrapped =>
    new Proxy(statement, {
      get(target, prop) {
        if (prop === "__real") return target;
        if (prop === "__sql") return sql;
        if (prop === "bind") return (...values: unknown[]) => wrap(target.bind(...values), sql);
        if (prop === "all" || prop === "run") {
          return async () => {
            stats.roundTrips += 1;
            stats.statements.push(sql);
            const result = await target[prop]();
            stats.rowsRead += result.meta.rows_read ?? 0;
            return result;
          };
        }
        if (prop === "raw") {
          return async (options?: { columnNames?: boolean }) => {
            stats.roundTrips += 1;
            stats.statements.push(sql);
            const result = await target.raw(options as never);
            stats.rowsRead += (await target.all()).meta.rows_read ?? 0;
            return result;
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Wrapped;

  const db = new Proxy(real, {
    get(target, prop) {
      if (prop === "prepare") return (sql: string) => wrap(target.prepare(sql), sql);
      if (prop === "batch") {
        return async (statements: Wrapped[]) => {
          stats.roundTrips += 1;
          for (const statement of statements) stats.statements.push(statement.__sql);
          const results = await target.batch(statements.map((statement) => statement.__real));
          for (const result of results) stats.rowsRead += result.meta.rows_read ?? 0;
          return results;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db, stats };
}

/**
 * Calls the `PublicApi` entrypoint's app (the only face that serves the read endpoints, since the public one
 * serves none) with every D1 statement counted. The same app and the same handlers the entrypoint runs, with a
 * D1 binding that records what goes through it.
 */
export async function countedGet(path: string): Promise<{ response: Response; stats: D1Stats }> {
  const { db, stats } = instrumentD1(env.DB);
  const response = await internalFetchWithBindings({ ...env, DB: db } as Bindings, path);
  return { response, stats };
}

/**
 * Calls the worker's DEFAULT export (what a route, workers.dev or a custom domain reaches) with every D1
 * statement counted: the public face, which must not serve `/api/public/*` at all.
 */
export async function countedPublicFaceGet(path: string, init: RequestInit = {}): Promise<{ response: Response; stats: D1Stats }> {
  const { default: worker } = await import("../src/worker");
  const { db, stats } = instrumentD1(env.DB);
  const ctx = createExecutionContext();
  const headers = new Headers(init.headers);
  if (!headers.has("cf-connecting-ip")) headers.set("cf-connecting-ip", "203.0.113.9");
  const response = await worker.fetch!(new Request(`https://admin.test${path}`, { ...init, headers }), { ...env, DB: db } as Bindings, ctx);
  await waitOnExecutionContext(ctx);
  return { response, stats };
}

// ---------------------------------------------------------------- fixtures

export const orm = () => drizzle(env.DB, { schema });

let counter = 0;
const next = () => (counter += 1);

export const DAY = 86_400_000;

/** A user row, for columns that point at one (created_by, uploaded_by ...). Its email and id are used as "private" markers. */
export async function addUser(email = `staff-${next()}@example.test`) {
  const id = crypto.randomUUID();
  await orm().insert(schema.users).values({ id, name: "Contoh Staf", email, role: "editor" });
  return { id, email };
}

type Insert<T extends { $inferInsert: unknown }> = T["$inferInsert"];

export async function addTeam(over: Partial<Insert<typeof schema.teamMembers>> = {}) {
  const n = next();
  const row = { id: crypto.randomUUID(), name: `Anggota ${n}`, role: `Peran ${n}`, category: "pengurus" as const, ...over };
  await orm().insert(schema.teamMembers).values(row);
  return row;
}

export async function addReport(over: Partial<Insert<typeof schema.reports>> = {}) {
  const n = next();
  const row = {
    id: crypto.randomUUID(),
    title: `Laporan ${n}`,
    category: "yearly" as const,
    year: "2025",
    filePath: `/reports/2025/yearly/laporan-${n}.pdf`,
    fileSize: 1000 + n,
    ...over,
  };
  await orm().insert(schema.reports).values(row);
  return row;
}

export async function addResource(over: Partial<Insert<typeof schema.siteResources>> = {}) {
  const n = next();
  const row = {
    id: crypto.randomUUID(),
    title: `Dokumen ${n}`,
    category: "panduan" as const,
    contentType: "file" as const,
    filePath: `/resources/dokumen-${n}.pdf`,
    fileSize: 2000 + n,
    ...over,
  };
  await orm().insert(schema.siteResources).values(row as Insert<typeof schema.siteResources>);
  return row;
}

export async function addAnnouncement(over: Partial<Insert<typeof schema.announcements>> = {}) {
  const n = next();
  const row = { id: crypto.randomUUID(), title: `Pengumuman ${n}`, body: `Isi pengumuman ${n}.`, severity: "info" as const, active: true, ...over };
  await orm().insert(schema.announcements).values(row);
  return row;
}

export async function addPost(over: Partial<Insert<typeof schema.blogPosts>> = {}) {
  const n = next();
  const row = {
    id: crypto.randomUUID(),
    slug: `artikel-${n}`,
    title: `Artikel ${n}`,
    excerpt: `Ringkasan artikel ${n}.`,
    contentMarkdown: `Isi artikel ${n}.`,
    contentHtml: `<p>Isi artikel ${n}.</p>`,
    category: "News" as const,
    author: "Redaksi",
    status: "published" as const,
    publishedAt: new Date(Date.UTC(2026, 4, 1, 3) - n * DAY),
    ...over,
  };
  await orm().insert(schema.blogPosts).values(row);
  return row;
}

/** Inserts many articles in a few batches (D1 allows a limited number of statements per batch). */
export async function addPosts(rows: Partial<Insert<typeof schema.blogPosts>>[]) {
  const db = orm();
  const built = rows.map((over) => {
    const n = next();
    return {
      id: crypto.randomUUID(),
      slug: `artikel-${n}`,
      title: `Artikel ${n}`,
      excerpt: `Ringkasan artikel ${n}.`,
      contentMarkdown: `Isi artikel ${n}.`,
      contentHtml: `<p>Isi artikel ${n}.</p>`,
      category: "News" as const,
      author: "Redaksi",
      status: "published" as const,
      publishedAt: new Date(Date.UTC(2026, 4, 1, 3) - n * DAY),
      ...over,
    };
  });
  for (let i = 0; i < built.length; i += 25) {
    const chunk = built.slice(i, i + 25).map((row) => db.insert(schema.blogPosts).values(row));
    await db.batch(chunk as unknown as [(typeof chunk)[number], ...(typeof chunk)[number][]]);
  }
  return built;
}

/** Inserts rows of any table in batches of 25 statements (one round trip each). `id` and the timestamps default as usual. */
export async function insertMany<T extends SQLiteTable>(table: T, rows: T["$inferInsert"][]) {
  const db = orm();
  for (let i = 0; i < rows.length; i += 25) {
    const chunk = rows.slice(i, i + 25).map((row) => db.insert(table).values(row as never));
    await db.batch(chunk as never);
  }
}

export async function json<T = unknown>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
