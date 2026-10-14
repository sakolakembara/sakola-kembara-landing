// A D1 binding on top of node:sqlite (Node 22.5 or later), for the local CPU measurement
// (scripts/measure-cpu.ts, docs/cloudflare/free-plan-audit.md "CPU on the hot routes"). It speaks the part of the
// D1 API this Worker uses (prepare / bind / all / first / raw / run, batch, exec) and returns the same shapes.
//
// What it is for: running the REAL Worker code (the Hono app, Better Auth, Drizzle, the serializers) in plain Node,
// where timers are real, so the CPU the Worker's own JavaScript spends per request can be measured, with the time
// SQLite itself spent subtracted: on Cloudflare the query runs on the D1 side and costs the Worker no CPU, only the
// JavaScript around it does. `dbMs()` is that time.
//
// What it is not: a model of D1 (no latency, no limits, no sessions). Local numbers only.

import { DatabaseSync, type StatementSync } from "node:sqlite";

type Param = string | number | bigint | null | Uint8Array;

export interface D1Meta {
  changes: number;
  last_row_id: number;
  rows_read: number;
  rows_written: number;
  duration: number;
}

export interface NodeD1 extends D1Database {
  /** Milliseconds spent inside SQLite since the last `resetDbMs()`. */
  dbMs(): number;
  resetDbMs(): void;
  /** Number of statements executed since the last `resetDbMs()` (a batch counts each statement). */
  statements(): number;
  /** The raw handle, for loading migrations and fixtures. */
  readonly sqlite: DatabaseSync;
}

function toParam(value: unknown): Param {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "string" || typeof value === "bigint") return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof Uint8Array) return value;
  throw new Error(`node-d1: cannot bind a ${typeof value}`);
}

export function createNodeD1(file = ":memory:"): NodeD1 {
  const sqlite = new DatabaseSync(file);
  sqlite.exec("PRAGMA foreign_keys = ON");
  const cache = new Map<string, StatementSync>();
  let ns = 0n;
  let count = 0;

  const timed = <T>(run: () => T, statements = 1): T => {
    const start = process.hrtime.bigint();
    try {
      return run();
    } finally {
      ns += process.hrtime.bigint() - start;
      count += statements;
    }
  };

  const statementFor = (sql: string): StatementSync => {
    let statement = cache.get(sql);
    if (!statement) {
      statement = sqlite.prepare(sql);
      cache.set(sql, statement);
    }
    return statement;
  };

  const metaOf = (changes: number | bigint, lastId: number | bigint): D1Meta => ({
    changes: Number(changes),
    last_row_id: Number(lastId),
    rows_read: 0,
    rows_written: Number(changes),
    duration: 0,
  });

  class Prepared {
    constructor(
      readonly sql: string,
      readonly params: Param[] = [],
    ) {}
    bind(...values: unknown[]) {
      return new Prepared(this.sql, values.map(toParam));
    }
    /** Runs synchronously; the promise wrappers below only give it D1's shape. */
    exec(mode: "all" | "raw" | "run"): { results: unknown[]; meta: D1Meta } {
      return timed(() => {
        const statement = statementFor(this.sql);
        if (mode === "run") {
          const info = statement.run(...this.params);
          return { results: [], meta: metaOf(info.changes, info.lastInsertRowid) };
        }
        statement.setReturnArrays(mode === "raw");
        const rows = statement.all(...this.params).map((row) => (mode === "raw" ? [...(row as unknown as unknown[])] : { ...(row as object) }));
        // `changes` is the connection's last count: reading it after a SELECT is meaningless, so 0.
        return { results: rows, meta: metaOf(0, 0) };
      });
    }
    async all() {
      const { results, meta } = this.exec("all");
      return { success: true, results, meta };
    }
    async raw(options?: { columnNames?: boolean }) {
      const { results } = this.exec("raw");
      if (options?.columnNames) {
        const names = statementFor(this.sql).columns().map((column) => column.name);
        return [names, ...results];
      }
      return results;
    }
    async first(column?: string) {
      const { results } = this.exec("all");
      const row = results[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      return column === undefined ? row : (row[column] ?? null);
    }
    async run() {
      const { results, meta } = this.exec("run");
      return { success: true, results, meta };
    }
  }

  const db = {
    sqlite,
    prepare: (sql: string) => new Prepared(sql),
    async batch(statements: Prepared[]) {
      return timed(() => {
        sqlite.exec("BEGIN");
        try {
          const out = statements.map((statement) => {
            // A D1 batch answers every statement in the `all` shape.
            const statementRows = statementFor(statement.sql);
            statementRows.setReturnArrays(false);
            const reads = /^\s*(select|with|pragma|explain)\b/i.test(statement.sql) || /\breturning\b/i.test(statement.sql);
            if (reads) {
              const rows = statementRows.all(...statement.params).map((row) => ({ ...(row as object) }));
              count += 1;
              return { success: true, results: rows, meta: metaOf(0, 0) };
            }
            const info = statementRows.run(...statement.params);
            count += 1;
            return { success: true, results: [], meta: metaOf(info.changes, info.lastInsertRowid) };
          });
          sqlite.exec("COMMIT");
          return out;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      }, 0);
    },
    async exec(sql: string) {
      timed(() => sqlite.exec(sql));
      return { count: 1, duration: 0 };
    },
    dbMs: () => Number(ns) / 1e6,
    resetDbMs() {
      ns = 0n;
      count = 0;
    },
    statements: () => count,
  };
  return db as unknown as NodeD1;
}
