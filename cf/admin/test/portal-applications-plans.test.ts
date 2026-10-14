import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import {
  anyDraftQuery,
  dbOf,
  filesQuery,
  historyQuery,
  openStateQuery,
  openStateWithAnswersQuery,
  RAW_STATEMENTS,
  recentWhatsappQuery,
  slotCountsQuery,
  statusQuery,
} from "../src/portal/queries";
import { spyOnD1 } from "./crud-app";
import { addApplication, addBatch } from "./pendaftaran-helpers";
import { portalCall } from "./portal-helpers";
import {
  addFileRow,
  addRequiredFiles,
  CURRENT,
  draftOf,
  openBatch,
  OVERVIEW,
  putStep,
  saveAll,
  stepPath,
  STATUS,
  student,
  SUBMIT,
  VALID,
} from "./portal-applications-helpers";
import { DAY, instrumentD1 } from "./public-helpers";

// What the student's application API costs D1 (docs/cloudflare/portal-architecture.md, section 10): the plan of every
// query (EXPLAIN QUERY PLAN: an index seek, never a scan), the round trips and statements of every route, and the rows
// read and written, measured on the local D1 (`meta.rows_read`, `meta.rows_written`). The real D1 and the CPU are
// SAKEM-084's: workerd freezes its timers during synchronous code, so CPU cannot be measured here.

async function plan(sql: string, params: unknown[]): Promise<string[]> {
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>();
  return results.map((row) => row.detail);
}

const planOf = (query: { toSQL(): { sql: string; params: unknown[] } }) => plan(query.toSQL().sql, query.toSQL().params);

/** A line of a plan that reads a whole table (a `SCAN <table>` with no index) is what none of these may have. */
const bareScans = (lines: string[]) => lines.filter((line) => /^SCAN \w+$/.test(line.trim()));

const db = () => dbOf(env.DB);
const now = new Date();

describe("no per-request initialisation", () => {
  test("the Drizzle handle (it walks the whole schema when built: about 90 microseconds in Node, more in a cold isolate) is built once per binding, not once per request", () => {
    expect(dbOf(env.DB)).toBe(dbOf(env.DB));
    const other = { ...env.DB } as unknown as D1Database;
    expect(dbOf(other)).not.toBe(dbOf(env.DB));
    expect(dbOf(other)).toBe(dbOf(other));
  });
});

describe("plans: every read is a seek on an index", () => {
  test("the open batch is a walk down the opens_at index (no sort), and the student's application and draft are seeks on the unique (user_id, batch_id) indexes", async () => {
    for (const query of [openStateQuery(db(), "u", now), openStateWithAnswersQuery(db(), "u", now)]) {
      expect(await planOf(query)).toEqual([
        "SEARCH admission_batches USING INDEX admission_batches_opens_at_idx (opens_at<?)",
        "SEARCH student_applications USING INDEX student_applications_user_batch_unique (user_id=? AND batch_id=?) LEFT-JOIN",
        "SEARCH application_drafts USING INDEX application_drafts_user_batch_unique (user_id=? AND batch_id=?) LEFT-JOIN",
      ]);
    }
    expect(await planOf(anyDraftQuery(db(), "u"))).toEqual(["SEARCH application_drafts USING INDEX application_drafts_user_batch_unique (user_id=?)"]);
  });

  test("the history and the status page: the student's rows by the unique index, each batch by primary key (a handful of rows, sorted in a temp tree)", async () => {
    for (const query of [historyQuery(db(), "u"), statusQuery(db(), "u")]) {
      expect(await planOf(query)).toEqual([
        "SEARCH student_applications USING INDEX student_applications_user_batch_unique (user_id=?)",
        "SEARCH admission_batches USING INDEX sqlite_autoindex_admission_batches_1 (id=?)",
        "USE TEMP B-TREE FOR ORDER BY",
      ]);
    }
  });

  test("the files of an application and their counts: the (application_id, slot) index", async () => {
    expect(await planOf(filesQuery(db(), "a"))).toEqual(["SEARCH application_files USING INDEX application_files_application_slot_idx (application_id=?)"]);
    expect(await planOf(slotCountsQuery(db(), "a"))).toEqual(["SEARCH application_files USING INDEX application_files_application_slot_idx (application_id=?)"]);
  });

  test("the anti-duplicate is a range on the submitted_at index: the last hour's rows, not the table", async () => {
    expect(await planOf(recentWhatsappQuery(db(), "6281", now))).toEqual(["SEARCH student_applications USING INDEX student_applications_submitted_at_idx (submitted_at>?)"]);
  });

  test("the raw statements of a save and a submit: no bare scan anywhere, every table is reached by an index", async () => {
    const params: Record<keyof typeof RAW_STATEMENTS, unknown[]> = {
      upsertDraft: ["i", "u", "b", "identity", "{}", 1, "$.identity"],
      selectRemovableDtks: ["u", "b"],
      releaseRemovableDtks: ["u", "b", 1],
      markRemovableDtks: ["u", "b", 1],
      summary: ["u", "b"],
      slotCounts: ["u", "b"],
      insertApplication: ["i", "u", "n", "e", "w", "s", "g", "b", "{}", 1, 1, "a", "{}", "b"],
      insertAudit: ["i", "u", "n", "e", "w", "s", "g", "b", "{}", 1, 1, "a", "{}"],
      deleteDraft: ["i", "u", "n", "e", "w", "s", "g", "b", "{}", 1, 1],
    };
    for (const [name, sql] of Object.entries(RAW_STATEMENTS)) {
      const lines = await plan(sql, params[name as keyof typeof params]);
      expect(bareScans(lines), name).toEqual([]);
      // Each line that reads a real table names an index; the one scan allowed is the draft's own `json_each` (at most seven keys).
      for (const line of lines) if (/^SEARCH (application_|admission_|student_|private_|audit_)/.test(line)) expect(line, name).toContain("USING");
    }
    expect(await plan(RAW_STATEMENTS.insertApplication, params.insertApplication)).toEqual([
      "SEARCH d USING INDEX sqlite_autoindex_application_drafts_1 (id=?)",
      "SEARCH b EXISTS USING INDEX sqlite_autoindex_admission_batches_1 (id=?)",
    ]);
    expect(await plan(RAW_STATEMENTS.summary, params.summary)).toEqual(["SEARCH d USING INDEX application_drafts_user_batch_unique (user_id=? AND batch_id=?)", "CORRELATED SCALAR SUBQUERY 1", "SCAN json_each VIRTUAL TABLE INDEX 1:"]);
  });
});

// ─── The cost of each request ───

const MINE = /admission_batches|application_drafts|application_files|student_applications|private_storage|audit_log|email_daily/;

/** One request, counted: the round trips and statements that touch the portal's tables (the session lookup is Better Auth's, and not what a budget is about). */
async function trips(path: string, init: Parameters<typeof portalCall>[1]) {
  const spy = spyOnD1(env.DB);
  const res = await portalCall(path, { ...init, env: { DB: spy.db } });
  const own = spy.events.filter((event) => event.sql.some((sql) => MINE.test(sql)));
  return { status: res.status, events: own.map((event) => [event.kind, event.sql.length] as const) };
}

/** The rows a request read and wrote on the local D1, session reads included; compare with `me`, which is the session and nothing else. */
async function rows(path: string, init: Parameters<typeof portalCall>[1]) {
  const { db: counted, stats } = instrumentD1(env.DB);
  let written = 0;
  const proxy = new Proxy(counted, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: unknown[]) => {
          const results = await (target as unknown as { batch: (s: unknown[]) => Promise<{ meta: { rows_written?: number } }[]> }).batch(statements);
          for (const result of results) written += result.meta.rows_written ?? 0;
          return results;
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  const res = await portalCall(path, { ...init, env: { DB: proxy as D1Database } });
  return { status: res.status, read: stats.rowsRead, written };
}

describe("round trips: a read is one, a save is a read and a batch, a submit is three plus the counter", () => {
  test("overview: ONE round trip (the open batch with the student's rows, and the history, in one batch of two), however many applications there are", async () => {
    const who = await student();
    expect(await trips(OVERVIEW, { cookie: who.cookie })).toEqual({ status: 200, events: [["batch", 2]] });
    // Ten applications: the same trip, the same statements (no N+1).
    for (let i = 0; i < 10; i++) {
      const batch = await addBatch({ opensAt: new Date(Date.now() - 400 * DAY + i * DAY), closesAt: new Date(Date.now() - 300 * DAY + i * DAY) });
      await addApplication(batch.id, { userId: who.id, submittedAt: new Date(Date.now() - (50 - i) * DAY) });
    }
    expect(await trips(OVERVIEW, { cookie: who.cookie })).toEqual({ status: 200, events: [["batch", 2]] });
  });

  test("applications (status): ONE round trip of one statement, with ten applications as with none", async () => {
    const who = await student();
    expect(await trips(STATUS, { cookie: who.cookie })).toEqual({ status: 200, events: [["single", 1]] });
    for (let i = 0; i < 10; i++) {
      const batch = await addBatch({ opensAt: new Date(Date.now() - 400 * DAY + i * DAY), closesAt: new Date(Date.now() - 300 * DAY + i * DAY) });
      await addApplication(batch.id, { userId: who.id });
    }
    expect(await trips(STATUS, { cookie: who.cookie })).toEqual({ status: 200, events: [["single", 1]] });
  });

  test("current: one trip when there is no draft (or no batch), two when there is something to list: the state, then the files, however many files there are", async () => {
    const who = await student();
    expect(await trips(CURRENT, { cookie: who.cookie })).toEqual({ status: 200, events: [["single", 1]] });
    await openBatch();
    expect(await trips(CURRENT, { cookie: who.cookie })).toEqual({ status: 200, events: [["single", 1]] });
    await putStep(who, "identity", VALID.identity);
    const draft = (await draftOf(who.id))!;
    expect(await trips(CURRENT, { cookie: who.cookie })).toEqual({ status: 200, events: [["single", 1], ["single", 1]] });
    for (const slot of ["house-photos", "vehicle-photos"] as const) for (let i = 0; i < 6; i++) await addFileRow(draft.id, slot);
    for (const slot of ["electricity-bill", "family-card", "parent-permission"] as const) await addFileRow(draft.id, slot);
    expect(await trips(CURRENT, { cookie: who.cookie })).toEqual({ status: 200, events: [["single", 1], ["single", 1]] });
  });

  test("a step save: the state (one statement), then ONE batch (the upsert, what the answer needs, the file counts); `documents` with tidak adds the three of the DTKS cleanup to the same batch", async () => {
    await openBatch();
    const who = await student();
    expect(await trips(stepPath("identity"), { method: "PUT", cookie: who.cookie, json: VALID.identity })).toEqual({ status: 200, events: [["single", 1], ["batch", 3]] });
    expect(await trips(stepPath("household"), { method: "PUT", cookie: who.cookie, json: VALID.household })).toEqual({ status: 200, events: [["single", 1], ["batch", 3]] });
    expect(await trips(stepPath("documents"), { method: "PUT", cookie: who.cookie, json: { dtksRegistered: "tidak" } })).toEqual({ status: 200, events: [["single", 1], ["batch", 6]] });
  });

  test("a refused save reads and writes nothing more than the gate: no batch is the state and the draft check, a bad body is the state alone", async () => {
    const who = await student();
    expect(await trips(stepPath("identity"), { method: "PUT", cookie: who.cookie, json: VALID.identity })).toEqual({ status: 409, events: [["single", 1], ["single", 1]] });
    await openBatch();
    expect(await trips(stepPath("identity"), { method: "PUT", cookie: who.cookie, json: { fullName: "x" } })).toEqual({ status: 400, events: [["single", 1]] });
  });

  test("a submit: the state, the files and the anti-duplicate in one batch, ONE batch of three writes, and the confirmation's counter after the answer", async () => {
    await openBatch();
    const who = await student();
    await saveAll(who);
    const draft = (await draftOf(who.id))!;
    await addRequiredFiles(draft.id);
    const result = await trips(SUBMIT, { method: "POST", cookie: who.cookie, json: {} });
    expect(result.status).toBe(201);
    expect(result.events).toEqual([["single", 1], ["batch", 2], ["batch", 3], ["single", 1]]);
  });
});

describe("rows read and written (local D1; the session's own reads are `me`)", () => {
  async function baseline() {
    const who = await student();
    const me = await rows("/portal/api/me", { cookie: who.cookie });
    return { who, me: me.read };
  }

  test("the reads cost a handful of rows beyond the session", async () => {
    await openBatch();
    const { who, me } = await baseline();
    expect((await rows(OVERVIEW, { cookie: who.cookie })).read - me).toBeLessThanOrEqual(6);
    expect((await rows(STATUS, { cookie: who.cookie })).read - me).toBeLessThanOrEqual(3);
    expect((await rows(CURRENT, { cookie: who.cookie })).read - me).toBeLessThanOrEqual(6);

    for (const step of ["identity", "household", "housing", "organizations", "documents", "marketing", "interview"] as const) await putStep(who, step, VALID[step]);
    const draft = (await draftOf(who.id))!;
    await addRequiredFiles(draft.id);
    // The wizard's bootstrap with a complete draft and ten files: the draft's answers once, ten file rows.
    expect((await rows(CURRENT, { cookie: who.cookie })).read - me).toBeLessThanOrEqual(20);
    expect((await rows(OVERVIEW, { cookie: who.cookie })).read - me).toBeLessThanOrEqual(8);
  });

  test("a step save: about ten rows read and one row written (three the first time, when the draft is made)", async () => {
    await openBatch();
    const { who, me } = await baseline();
    const first = await rows(stepPath("identity"), { method: "PUT", cookie: who.cookie, json: VALID.identity });
    expect(first.status).toBe(200);
    expect(first.read - me).toBeLessThanOrEqual(14);
    expect(first.written).toBeLessThanOrEqual(4);
    const second = await rows(stepPath("household"), { method: "PUT", cookie: who.cookie, json: VALID.household });
    expect(second.read - me).toBeLessThanOrEqual(18);
    expect(second.written).toBeLessThanOrEqual(2);
  });

  test("a submit: the application, its audit row and the draft's removal are the writes (about 17 rows with their indexes); the reads stay near twenty", async () => {
    await openBatch();
    const { who, me } = await baseline();
    await saveAll(who);
    const draft = (await draftOf(who.id))!;
    await addRequiredFiles(draft.id);
    const submitted = await rows(SUBMIT, { method: "POST", cookie: who.cookie, json: {} });
    expect(submitted.status).toBe(201);
    expect(submitted.read - me).toBeLessThanOrEqual(28);
    expect(submitted.written).toBeLessThanOrEqual(22);
  });
});
