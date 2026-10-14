import { env } from "cloudflare:workers";
import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import {
  applicantPrefix,
  applicationDetailQuery,
  applicationsPageQuery,
  applicationsTotalQuery,
  batchesPageQuery,
  batchQuery,
  batchRecentApplicantsQuery,
  batchStatusCountsQuery,
} from "../src/admission/queries";
import type { ListQuery } from "../src/api/crud";
import * as schema from "../src/db/schema";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { spyOnD1 } from "./crud-app";
import { addApplication, addApplications, addBatch, addResourceRow, etagOfRow } from "./pendaftaran-helpers";
import { insertMany, instrumentD1, orm, type D1Stats } from "./public-helpers";

// What the Pendaftaran screens cost D1 (docs/cloudflare/admin-crud.md#12-d1-budget-rules): the query plans of every
// list and filter (EXPLAIN QUERY PLAN), the statements and round trips of each request, and the rows read.
// Workers Free: 10 ms CPU a request; D1 Free: 5M rows read and 100k rows written a day. The applications table is
// the one that grows (about 300 a year), so its search must be a PREFIX match on an indexed column.
//
// Rows read are measured on the local D1 (`meta.rows_read`); the real D1 is only confirmed on a deployed Worker (SAKEM-084).

const db = () => drizzle(env.DB, { schema });
const A = schema.studentApplications;

async function plan(query: { toSQL(): { sql: string; params: unknown[] } }): Promise<string[]> {
  const { sql, params } = query.toSQL();
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>();
  return results.map((row) => row.detail);
}

/** A list query the way `parseListQuery` builds it for the applications, for the plan to be that of the route. */
function applicationsQuery(where: ListQuery["where"], sort: "-submittedAt" | "fullName" = "-submittedAt"): ListQuery {
  const order = sort === "fullName" ? [asc(A.fullName), asc(A.id)] : [desc(A.submittedAt), asc(A.id)];
  return { page: 1, pageSize: 20, offset: 0, q: "", sort, order, where };
}

async function rowsRead(query: { toSQL(): { sql: string; params: unknown[] } }): Promise<{ rowsRead: number; returned: number }> {
  const { sql, params } = query.toSQL();
  const result = await env.DB.prepare(sql).bind(...params).all();
  return { rowsRead: result.meta.rows_read, returned: result.results.length };
}

/** `n` applications of one batch with names and emails that can be searched for by their start. */
async function crowd(batchId: string, n: number, label = "Nama") {
  const rows = Array.from({ length: n }, (_, i) =>
    ({
      id: crypto.randomUUID(),
      batchId,
      fullName: `${label} ${i} Contoh`,
      email: `${label.toLowerCase()}${i}@example.test`,
      whatsapp: "0812000",
      schoolName: "SMA Contoh",
      graduationYear: "2026",
      submittedAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
    }) satisfies typeof A.$inferInsert,
  );
  await insertMany(A, rows);
}

const noBareScan = (lines: string[]) => lines.filter((line) => /^SCAN \w+$/.test(line.trim()));

describe("plans: no list, filter or search of the applications reads the table end to end", () => {
  test("by batch: a seek on the batch index (the rows of that batch are read, and sorted)", async () => {
    const batch = await addBatch();
    const lines = await plan(applicationsPageQuery(db(), applicationsQuery(eq(A.batchId, batch.id))));
    expect(lines).toEqual([
      "SEARCH admission_batches USING INDEX sqlite_autoindex_admission_batches_1 (id=?)",
      "SEARCH student_applications USING INDEX student_applications_batch_id_idx (batch_id=?)",
      "USE TEMP B-TREE FOR ORDER BY",
    ]);
    expect(await plan(applicationsTotalQuery(db(), applicationsQuery(eq(A.batchId, batch.id))))).toEqual(["SEARCH student_applications USING COVERING INDEX student_applications_batch_id_idx (batch_id=?)"]);
  });

  test("by status: a seek on the status index, and the count never touches the table", async () => {
    const where = eq(A.status, "pending");
    expect((await plan(applicationsPageQuery(db(), applicationsQuery(where)))).join(" | ")).toContain("SEARCH student_applications USING INDEX student_applications_status_idx (status=?)");
    expect(await plan(applicationsTotalQuery(db(), applicationsQuery(where)))).toEqual(["SEARCH student_applications USING COVERING INDEX student_applications_status_idx (status=?)"]);
  });

  test("newest first with no filter: a walk of the submitted_at index that stops at the limit", async () => {
    const lines = await plan(applicationsPageQuery(db(), applicationsQuery(undefined)));
    expect(lines[0]).toBe("SCAN student_applications USING INDEX student_applications_submitted_at_idx");
    expect(noBareScan(lines)).toEqual([]);
  });

  // Negative test (scripts/negative-checks-pendaftaran.mjs): `%q%` instead of `q%` and the plan is a scan of the table.
  test("the search: a name prefix walks the NOCASE name index and an email prefix the email index, together as one OR over both", async () => {
    const lines = await plan(applicationsPageQuery(db(), applicationsQuery(applicantPrefix("nama 1"))));
    const text = lines.join(" | ");
    expect(text).toContain("MULTI-INDEX OR");
    expect(text).toContain("SEARCH student_applications USING INDEX student_applications_full_name_idx (full_name>? AND full_name<?)");
    expect(text).toContain("SEARCH student_applications USING INDEX student_applications_email_idx (email>? AND email<?)");
    expect(noBareScan(lines)).toEqual([]);
    expect(await plan(applicationsTotalQuery(db(), applicationsQuery(applicantPrefix("nama 1"))))).toEqual([
      "MULTI-INDEX OR",
      "INDEX 1",
      "SEARCH student_applications USING INDEX student_applications_full_name_idx (full_name>? AND full_name<?)",
      "INDEX 2",
      "SEARCH student_applications USING INDEX student_applications_email_idx (email>? AND email<?)",
    ]);
  });

  test("the search inside a batch starts from the batch index: the batch's own rows, never the table", async () => {
    const batch = await addBatch();
    const lines = await plan(applicationsPageQuery(db(), applicationsQuery(and(eq(A.batchId, batch.id), applicantPrefix("nama")))));
    expect(lines.join(" | ")).toContain("SEARCH student_applications USING INDEX student_applications_batch_id_idx (batch_id=?)");
    expect(noBareScan(lines)).toEqual([]);
  });

  test("the detail is a lookup by primary key", async () => {
    expect(await plan(applicationDetailQuery(db(), "x"))).toEqual([
      "SEARCH student_applications USING INDEX sqlite_autoindex_student_applications_1 (id=?)",
      "SEARCH admission_batches USING INDEX sqlite_autoindex_admission_batches_1 (id=?)",
    ]);
  });
});

describe("plans: the batches", () => {
  test("the list walks the unique year index in order, with an EXISTS per batch that stops at the first applicant", async () => {
    const lines = await plan(batchesPageQuery(db(), { page: 1, pageSize: 20, offset: 0, q: "", sort: "-year", order: [desc(schema.admissionBatches.year), asc(schema.admissionBatches.id)], where: undefined }));
    expect(lines).toEqual([
      "SCAN admission_batches USING INDEX admission_batches_year_unique",
      "CORRELATED SCALAR SUBQUERY 1",
      "SEARCH student_applications USING COVERING INDEX student_applications_batch_id_idx (batch_id=?)",
    ]);
  });

  test("the detail: the batch by primary key, its counts and its newest applicants by the batch index", async () => {
    expect(await plan(batchQuery(db(), "x"))).toEqual([
      "SEARCH admission_batches USING INDEX sqlite_autoindex_admission_batches_1 (id=?)",
      "CORRELATED SCALAR SUBQUERY 1",
      "SEARCH student_applications USING COVERING INDEX student_applications_batch_id_idx (batch_id=?)",
    ]);
    expect(await plan(batchStatusCountsQuery(db(), "x"))).toEqual(["SEARCH student_applications USING INDEX student_applications_batch_id_idx (batch_id=?)", "USE TEMP B-TREE FOR GROUP BY"]);
    expect(await plan(batchRecentApplicantsQuery(db(), "x", 5))).toEqual(["SEARCH student_applications USING INDEX student_applications_batch_id_idx (batch_id=?)", "USE TEMP B-TREE FOR ORDER BY"]);
  });
});

// ─── The cost of each request: statements and round trips ───────────────────

/** One request, counted: the events of the area's tables only (the session lookup of Better Auth is not what a budget is about). */
async function cost(path: string, init: Parameters<typeof call>[1], tables: RegExp) {
  const spy = spyOnD1(env.DB);
  const res = await call(path, { ...init, env: { DB: spy.db } });
  const own = spy.events.filter((event) => event.sql.some((sql) => tables.test(sql)));
  return { status: res.status, events: own, statements: own.reduce((n, event) => n + event.sql.length, 0) };
}

describe("round trips: a list is one trip, a detail is one, a write is a read and a batch", () => {
  const AREA = /student_applications|admission_batches|site_resources/;

  test("every read of the area is ONE round trip, with these statements", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const batch = await addBatch();
    const [application] = await addApplications(batch.id, { pending: 3, accepted: 2 });
    const resource = await addResourceRow();
    const reads: [string, string, number][] = [
      ["applications list", "/api/admin/applications?status=pending&q=pend", 2],
      // The application and the list of its files (docs/cloudflare/portal-api.md, 12.1): two statements, one round trip.
      ["application detail", `/api/admin/applications/${application!.id}`, 2],
      ["batches list", "/api/admin/batches", 3],
      ["batch detail", `/api/admin/batches/${batch.id}`, 3],
      ["resources list", "/api/admin/resources", 2],
      ["resource detail", `/api/admin/resources/${resource.id}`, 1],
    ];
    for (const [label, path, statements] of reads) {
      const result = await cost(path, { cookie }, AREA);
      expect(result.status, label).toBe(200);
      expect(result.events, label).toHaveLength(1);
      expect(result.statements, label).toBe(statements);
    }
  });

  test("a review is two round trips: the application (with its batch), then the update and its audit row in one batch", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["pendaftaran"]);
    const batch = await addBatch();
    const application = await addApplication(batch.id);
    const result = await cost(`/api/admin/applications/${application.id}/status`, { method: "POST", cookie, headers: await etagOfRow("student_applications", application.id), json: { status: "under_review" } }, /student_applications|audit_log/);
    expect(result.status).toBe(200);
    expect(result.events.map((event) => [event.kind, event.sql.length])).toEqual([["single", 1], ["batch", 2]]);
  });

  test("publishing is two round trips as well: the detail, then the guarded update and its audit row in one batch", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["pendaftaran"]);
    const batch = await addBatch();
    await addApplications(batch.id, { accepted: 3 });
    const result = await cost(`/api/admin/batches/${batch.id}/publish`, { method: "POST", cookie }, /student_applications|admission_batches|audit_log/);
    expect(result.status).toBe(200);
    expect(result.events.map((event) => [event.kind, event.sql.length])).toEqual([["batch", 3], ["batch", 2]]);
  });

  test("a batch or a resource written is a read of the row and one batch of two statements (create: one batch)", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["pendaftaran"]);
    const form = { year: 2090, name: "Gen 66", opensAt: new Date(Date.now() + 1e9).toISOString(), closesAt: new Date(Date.now() + 2e9).toISOString() };
    const created = await cost("/api/admin/batches", { method: "POST", cookie, json: form }, /admission_batches|audit_log/);
    expect(created.status).toBe(201);
    expect(created.events.map((event) => [event.kind, event.sql.length])).toEqual([["batch", 2]]);

    const resource = await addResourceRow();
    const edited = await cost(`/api/admin/resources/${resource.id}`, { method: "PUT", cookie, headers: await etagOfRow("site_resources", resource.id), json: { title: "Baru", category: "panduan", displayOrder: 1, contentType: "text", bodyText: "isi" } }, /site_resources|audit_log/);
    expect(edited.status).toBe(200);
    expect(edited.events.map((event) => [event.kind, event.sql.length])).toEqual([["single", 1], ["batch", 2]]);
  });
});

// ─── The search never sends a pattern that starts with a wildcard ───────────

describe("the search that reaches D1", () => {
  /** Every value bound to a statement of the applications table during one request. */
  async function boundValues(path: string, cookie: string) {
    const seen: { sql: string; values: unknown[] }[] = [];
    const wrapStatement = (statement: D1PreparedStatement, sql: string): D1PreparedStatement =>
      new Proxy(statement, {
        get(target, property) {
          const value = Reflect.get(target, property, target) as unknown;
          if (property === "bind") return (...values: unknown[]) => (seen.push({ sql, values }), wrapStatement((value as (...a: unknown[]) => D1PreparedStatement).apply(target, values), sql));
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    const proxied = new Proxy(env.DB, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown;
        if (property === "prepare") return (sql: string) => wrapStatement(target.prepare(sql), sql);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const res = await call(path, { cookie, env: { DB: proxied } });
    expect(res.status).toBe(200);
    return seen.filter((entry) => entry.sql.includes("student_applications"));
  }

  test("a LIKE pattern is the text and then %, never % and the text, and an email is a range", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const batch = await addBatch();
    await crowd(batch.id, 30);
    for (const q of ["nama 1", "NAMA", "100%", "a_b", "x".repeat(60), "漢字"]) {
      const bound = await boundValues(`/api/admin/applications?q=${encodeURIComponent(q)}&batch=all`, cookie);
      const withLike = bound.filter((entry) => / like /i.test(entry.sql));
      expect(withLike.length, q).toBeGreaterThan(0);
      for (const entry of withLike) {
        const patterns = entry.values.filter((value): value is string => typeof value === "string" && value.endsWith("%"));
        expect(patterns.length, q).toBeGreaterThan(0);
        for (const pattern of patterns) {
          expect(pattern.startsWith("%"), `${q}: ${pattern}`).toBe(false);
          expect(new TextEncoder().encode(pattern).length, q).toBeLessThanOrEqual(50);
        }
      }
      // The SQL itself has no pattern written in: it is always a bound parameter.
      for (const entry of bound) expect(entry.sql).not.toMatch(/like\s+'/i);
    }
  });

  test("a search that is not there sends no LIKE at all", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const batch = await addBatch();
    await crowd(batch.id, 3);
    const bound = await boundValues("/api/admin/applications?status=pending&batch=all", cookie);
    expect(bound.filter((entry) => / like /i.test(entry.sql))).toEqual([]);
  });
});

// ─── Rows read follow the question, not the history of the school ───────────

describe("rows read (local D1, `meta.rows_read`)", () => {
  /** The rows read by one list request, in total. */
  async function listCost(path: string, cookie: string): Promise<D1Stats> {
    const { db: counted, stats } = instrumentD1(env.DB);
    const res = await call(path, { cookie, env: { DB: counted } });
    expect(res.status).toBe(200);
    return stats;
  }

  test("an email prefix reads the matching rows and a few index entries, however many applicants there are", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const one = await addBatch();
    await crowd(one.id, 300);
    const small = await listCost("/api/admin/applications?q=nama29@&batch=all", cookie);
    const other = await addBatch();
    await crowd(other.id, 900, "Orang");
    const large = await listCost("/api/admin/applications?q=nama29@&batch=all", cookie);
    // One match (nama29@...): its index entry and its row, the join to its batch, and the counting of the
    // other index entries in range: a handful, and the same with three times as many applicants.
    expect(small.rowsRead).toBeLessThanOrEqual(30);
    expect(large.rowsRead - small.rowsRead).toBeLessThanOrEqual(5);
  });

  test("a name prefix reads in proportion to what matches", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const batch = await addBatch();
    await crowd(batch.id, 300);
    await crowd((await addBatch()).id, 300, "Orang");
    // "Nama 2": Nama 2, Nama 20..29, Nama 200..299 = 111 applicants of 600.
    const stats = await listCost("/api/admin/applications?q=nama%202&batch=all", cookie);
    expect(stats.rowsRead).toBeGreaterThan(111);
    // Per match: its index entry, its row, the lookup of its batch (the join comes before the sort), and one more
    // index entry for the count: four. Measured: 452 for 111.
    expect(stats.rowsRead).toBeLessThanOrEqual(4 * 111 + 40);
  });

  test("the newest batch's list reads that batch (a seek and a sort), and the history of other batches costs nothing", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const current = await addBatch();
    await crowd(current.id, 100);
    const small = await listCost(`/api/admin/applications?batch=${current.id}`, cookie);
    for (let i = 0; i < 3; i++) await crowd((await addBatch()).id, 300, `Lama${i}`);
    const large = await listCost(`/api/admin/applications?batch=${current.id}`, cookie);
    expect(Math.abs(large.rowsRead - small.rowsRead)).toBeLessThanOrEqual(5);
    // Two reads per applicant of the batch (index entry and row), the count over the index, and a few lookups.
    expect(small.rowsRead).toBeLessThanOrEqual(3 * 100 + 40);
  });

  test("the first page of every batch is a walk of the newest applications: the page costs the same however many there are", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const batch = await addBatch();
    await crowd(batch.id, 100);
    const pageOnly = async () => {
      const q = applicationsQuery(undefined);
      const { db: counted, stats } = instrumentD1(env.DB);
      await applicationsPageQuery(drizzle(counted, { schema }), q);
      return stats.rowsRead;
    };
    const small = await pageOnly();
    await crowd((await addBatch()).id, 800, "Banyak");
    expect(await pageOnly()).toBe(small);
    expect(small).toBeLessThanOrEqual(5 * 20);
    // The total of the same list is a count over the smallest index: it grows with the table (honest: see the doc).
    expect((await listCost("/api/admin/applications?batch=all", cookie)).rowsRead).toBeLessThanOrEqual(small + 1000 + 20);
  });

  test("a batch's detail reads its own applicants, and nobody else's", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const batch = await addBatch();
    await crowd(batch.id, 100);
    const small = await listCost(`/api/admin/batches/${batch.id}`, cookie);
    await crowd((await addBatch()).id, 600, "Lain");
    const large = await listCost(`/api/admin/batches/${batch.id}`, cookie);
    expect(Math.abs(large.rowsRead - small.rowsRead)).toBeLessThanOrEqual(5);
    // The counts and the newest five each read the batch's rows (an index entry and a row per applicant).
    expect(small.rowsRead).toBeLessThanOrEqual(4 * 100 + 40);
  });

  test("a review writes the row, the index entries that changed and the audit row: a handful of rows", async () => {
    const batch = await addBatch();
    await crowd(batch.id, 50);
    const application = await addApplication(batch.id);
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["pendaftaran"]);
    const { db: counted, stats } = instrumentD1(env.DB);
    const res = await call(`/api/admin/applications/${application.id}/status`, { method: "POST", cookie, headers: await etagOfRow("student_applications", application.id), json: { status: "under_review" }, env: { DB: counted } });
    expect(res.status).toBe(200);
    // The application and its batch by key, then the write (the audit row is an insert). Nothing scales with the 50 others.
    expect(stats.rowsRead).toBeLessThanOrEqual(12);
  });
});

void orm;
