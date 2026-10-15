import { drizzle } from "drizzle-orm/d1";
import type { Db } from "./audit";
import * as schema from "./schema";

// One Drizzle instance per D1 binding, for the life of the isolate.
//
// `drizzle(binding, { schema })` is not free: it walks every table and relation of the schema to build the
// relational config (`extractTablesRelationalConfig`), which a profile of the Worker's own JavaScript showed as one of
// the larger single costs of a cold request (docs/cloudflare/free-plan-audit.md, "CPU on the hot routes"). The
// instance holds no request state (a D1 binding is not tied to a request, and Drizzle keeps nothing between queries),
// so sharing it is safe; the WeakMap lets it go with its binding (a test, or a new deploy, gets a new one).

const instances = new WeakMap<object, Db>();

/** The Drizzle instance of this D1 binding: built on first use, then reused. */
export function getDb(binding: D1Database): Db {
  let db = instances.get(binding);
  if (!db) {
    db = drizzle(binding, { schema });
    instances.set(binding, db);
  }
  return db;
}
