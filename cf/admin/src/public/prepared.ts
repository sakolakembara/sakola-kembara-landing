import { fillPlaceholders, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import {
  articleQuery,
  blogPageQuery,
  featuredPostQuery,
  newestOthersQuery,
  publishedCountQuery,
  relatedQuery,
  reportsQuery,
  resourcesQuery,
  teamQuery,
} from "./queries";
import { shortlinkQuery } from "./shortlink";

// The public reads, built once.
//
// Each read of the public API is the same statement with other values (a slug, a page, an offset). Building it with
// Drizzle's query builder on every request is most of what a read costs in a cold isolate: a profile of the Worker's
// own JavaScript put the builder at more than half of a read, and the SQL it produces never changes
// (docs/cloudflare/free-plan-audit.md, "CPU on the hot routes"). So the builders in ./queries.ts are run ONCE per D1
// binding, with `sql.placeholder` where a value varies, and each request only binds its values and executes.
//
// What stays the same: the SQL text (the plan tests read it from the same builders, and test/public-prepared.test.ts
// compares the placeholder form with the literal form), the columns read, the decoding of the rows (Drizzle's own,
// from the prepared query), and the number of round trips (the blog index is still one `batch`). What changes: the
// work done per request.

const placeholder = sql.placeholder;

/** An object whose properties are built on first read, once: the first read of one query must not pay for building the others. */
function lazy<T extends Record<string, () => unknown>>(builders: T): { [K in keyof T]: ReturnType<T[K]> } {
  const out = {} as Record<string, unknown>;
  for (const [key, build] of Object.entries(builders)) {
    // Not enumerable: nothing that walks the object (a logger, a deep comparison) may build the queries by accident.
    Object.defineProperty(out, key, {
      enumerable: false,
      configurable: true,
      get() {
        const value = build();
        Object.defineProperty(out, key, { value, enumerable: false });
        return value;
      },
    });
  }
  return out as never;
}

function compile(binding: D1Database) {
  const db = getDb(binding);
  return lazy({
    team: () => teamQuery(db).prepare(),
    reports: () => reportsQuery(db).prepare(),
    resources: () => resourcesQuery(db).prepare(),
    featured: () => featuredPostQuery(db).prepare(),
    count: () => publishedCountQuery(db).prepare(),
    page: () => blogPageQuery(db, placeholder("limit"), placeholder("offset")).prepare(),
    article: () => articleQuery(db, placeholder("slug")).prepare(),
    related: () => relatedQuery(db, { id: placeholder("id"), category: placeholder("category"), from: placeholder("from"), to: placeholder("to") }).prepare(),
    newestOthers: () => newestOthersQuery(db, placeholder("id")).prepare(),
    shortlink: () => shortlinkQuery(db, placeholder("slug")).prepare(),
  });
}

export type PublicQueries = ReturnType<typeof compile>;

const compiled = new WeakMap<object, PublicQueries>();

/**
 * The prepared public queries of this D1 binding: each is built on its first use, then reused for the life of the isolate. They
 * hold the binding's own prepared statements, so they live exactly as long as the binding does (a WeakMap on it).
 */
export function publicQueries(binding: D1Database): PublicQueries {
  let queries = compiled.get(binding);
  if (!queries) {
    queries = compile(binding);
    compiled.set(binding, queries);
  }
  return queries;
}

/** What `batchAll` needs of a prepared Drizzle query. */
interface Batchable {
  getQuery(): { sql: string; params: unknown[] };
  mapResult(response: unknown, isFromBatch?: boolean): unknown;
  all(values?: Record<string, unknown>): Promise<unknown>;
}

type RowsOf<Q extends Batchable> = Awaited<ReturnType<Q["all"]>>;

/**
 * Several prepared queries in ONE D1 round trip (`D1Database.batch`), what `db.batch` does for query builders, for
 * queries that are already built: each statement is bound with its values and the rows come back mapped by the
 * query's own decoder, in order. One failing statement fails the batch, as before.
 */
export async function batchAll<const T extends readonly (readonly [Batchable, Record<string, unknown>?])[]>(
  binding: D1Database,
  queries: T,
): Promise<{ -readonly [K in keyof T]: RowsOf<T[K][0]> }> {
  const statements = queries.map(([query, values]) => {
    const { sql: text, params } = query.getQuery();
    return binding.prepare(text).bind(...fillPlaceholders(params, values ?? {}));
  });
  const results = await binding.batch(statements);
  return queries.map(([query], index) => query.mapResult(results[index], true)) as never;
}
