import { sql } from "drizzle-orm";
import { check, integer, text, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

// Conventions shared by every table (documented in docs/cloudflare/d1-schema.md):
//
//   ids         text UUIDs generated in the app: crypto.randomUUID() via $defaultFn
//               (Better Auth's own tables use the ids Better Auth generates)
//   timestamps  integer epoch milliseconds, Drizzle `timestamp_ms` (a JS Date in code)
//   booleans    integer 0/1, Drizzle `boolean`
//   json        text holding JSON, Drizzle `mode: "json"`, with $type<...>() and a
//               json_valid() CHECK so a raw write cannot store garbage
//   enums       text with the allowed values in a CHECK constraint (Drizzle's
//               `text({ enum })` only types the column; the CHECK is what enforces it)
//   money/sizes plain integers (bytes, rupiah); no floats

/** Primary key: a UUID made in the app, not in the database. */
export const uuidPk = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const NOW_MS = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/** Epoch milliseconds, defaulted by the database to "now". */
export const createdAt = (name = "created_at") => integer(name, { mode: "timestamp_ms" }).notNull().default(NOW_MS);

/** Like `createdAt`, and refreshed by Drizzle on every `update()`. */
export const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(NOW_MS)
    .$onUpdate(() => new Date());

/** A nullable instant. */
export const timestampMs = (name: string) => integer(name, { mode: "timestamp_ms" });

function literal(value: string): ReturnType<typeof sql.raw> {
  return sql.raw(`'${value.replaceAll("'", "''")}'`);
}

/** CHECK that a text column holds one of the allowed enum values. */
export function enumCheck(name: string, column: AnySQLiteColumn, values: readonly string[]) {
  return check(name, sql`${column} in (${sql.join(values.map(literal), sql.raw(", "))})`);
}

/** CHECK that a JSON text column holds valid JSON (NULL allowed on nullable columns). */
export function jsonCheck(name: string, column: AnySQLiteColumn) {
  return check(name, sql`${column} is null or json_valid(${column})`);
}
