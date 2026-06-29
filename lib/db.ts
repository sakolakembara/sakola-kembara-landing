import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "./env";
import * as schema from "./db/schema";

// Reuse the pool across HMR reloads in dev so we don't exhaust Postgres connections.
const globalForPool = globalThis as unknown as { __sakem_pg_pool?: Pool };

export const pool =
  globalForPool.__sakem_pg_pool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
  });

if (env.NODE_ENV !== "production") {
  globalForPool.__sakem_pg_pool = pool;
}

export const db = drizzle(pool, { schema });
export type DB = typeof db;
