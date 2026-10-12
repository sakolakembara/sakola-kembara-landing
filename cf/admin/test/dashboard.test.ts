import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import type { GrantableArea } from "../src/auth/permissions";
import type { UserRole } from "../src/auth/roles";
import { BATCH_CANDIDATES, recentBatchesQuery, undecidedApplicationsQuery, unreadMessagesQuery } from "../src/dashboard/queries";
import * as schema from "../src/db/schema";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { DAY, insertMany, instrumentD1, orm, type D1Stats } from "./public-helpers";

// GET /api/dashboard (SAKEM-082): the "Perlu perhatian" block. What it answers
// to each role and each combination of areas, that it never carries personal
// data, and what it costs D1 (statements, round trips, plans, rows read).
// The pure rules (phases, which batch, what is left out) are in
// test/dashboard-rules.test.ts; the SPA's side of the contract is in
// test/spa-contract.test.ts.

type Status = "pending" | "under_review" | "accepted" | "rejected";
const now = () => Date.now();

// Markers that must never reach the payload: names, addresses, phone numbers,
// message text, a batch's name. Every row below carries them.
const SECRETS = ["Rahasia Pendaftar", "rahasia-pendaftar", "0812000", "SMA Rahasia", "Pengirim Rahasia", "rahasia-pengirim", "Isi pesan rahasia", "Nama Batch Rahasia"];

let sequence = 0;

async function addBatch(year: number, opens: number, closes: number, published = false) {
  const id = crypto.randomUUID();
  await orm()
    .insert(schema.admissionBatches)
    .values({
      id,
      year,
      name: `Nama Batch Rahasia ${year}`,
      opensAt: new Date(now() + opens * DAY),
      closesAt: new Date(now() + closes * DAY),
      resultsPublishedAt: published ? new Date(now() + closes * DAY + DAY) : null,
    });
  return id;
}

async function addApplications(batchId: string, counts: Partial<Record<Status, number>>) {
  const rows = (Object.entries(counts) as [Status, number][]).flatMap(([status, n]) =>
    Array.from({ length: n }, () => {
      sequence += 1;
      return {
        batchId,
        fullName: `Rahasia Pendaftar ${sequence}`,
        email: `rahasia-pendaftar-${sequence}@example.test`,
        whatsapp: `0812000${sequence}`,
        schoolName: `SMA Rahasia ${sequence}`,
        graduationYear: "2026",
        status,
      };
    }),
  );
  await insertMany(schema.studentApplications, rows);
}

async function addMessages(unread: number, read: number) {
  const rows = Array.from({ length: unread + read }, (_, i) => {
    sequence += 1;
    return {
      fullName: `Pengirim Rahasia ${sequence}`,
      email: `rahasia-pengirim-${sequence}@example.test`,
      subject: "other" as const,
      message: `Isi pesan rahasia ${sequence}`,
      readAt: i < unread ? null : new Date(now() - DAY),
    };
  });
  await insertMany(schema.contactMessages, rows);
}

/**
 * A small school: last year's batch closed and waiting for decisions (3 pending,
 * 2 under review, 10 decided), this year's batch open (4 pending, 1 under
 * review, 6 decided), next year's not yet open, and 4 unread messages among 10.
 * Totals: 7 pending, 3 under review, 4 unread; the tile is about last year's.
 */
async function seedSchool() {
  const last = await addBatch(2025, -400, -300);
  const current = await addBatch(2026, -20, 20);
  await addBatch(2027, 300, 360);
  await addApplications(last, { pending: 3, under_review: 2, accepted: 6, rejected: 4 });
  await addApplications(current, { pending: 4, under_review: 1, accepted: 6 });
  await addMessages(4, 6);
  return { last, current };
}

interface Answer {
  res: Response;
  body: { attention: Record<string, unknown> } & Record<string, unknown>;
  text: string;
}

async function dashboardOf(role: UserRole, areas: readonly GrantableArea[] = []): Promise<Answer> {
  const cookie = await signedInCookie(uniqueEmail(role), role, areas);
  const res = await call("/api/dashboard", { cookie });
  const text = await res.text();
  return { res, text, body: JSON.parse(text) };
}

const ALL: GrantableArea[] = ["pendaftaran", "komunikasi", "konten"];
const keysOf = (answer: Answer) => Object.keys(answer.body.attention).sort();

describe("who gets what: only the items of areas the caller may see", () => {
  const FULL = ["batch", "pendingApplications", "underReviewApplications", "unreadMessages"];
  const ADMISSION = ["batch", "pendingApplications", "underReviewApplications"];

  const cases: { label: string; role: UserRole; areas: GrantableArea[]; keys: string[] }[] = [
    { label: "viewer", role: "viewer", areas: [], keys: FULL },
    { label: "viewer with stray grants", role: "viewer", areas: ["konten"], keys: FULL },
    { label: "super_admin", role: "super_admin", areas: [], keys: FULL },
    { label: "editor of pendaftaran only", role: "editor", areas: ["pendaftaran"], keys: ADMISSION },
    { label: "editor of komunikasi only", role: "editor", areas: ["komunikasi"], keys: ["unreadMessages"] },
    { label: "editor of konten only: nothing to attend to here", role: "editor", areas: ["konten"], keys: [] },
    { label: "editor with no areas", role: "editor", areas: [], keys: [] },
    { label: "editor of pendaftaran and komunikasi", role: "editor", areas: ["pendaftaran", "komunikasi"], keys: FULL },
    { label: "editor of pendaftaran and konten", role: "editor", areas: ["pendaftaran", "konten"], keys: ADMISSION },
    { label: "editor of komunikasi and konten", role: "editor", areas: ["komunikasi", "konten"], keys: ["unreadMessages"] },
    { label: "editor of every area", role: "editor", areas: ALL, keys: FULL },
  ];

  for (const { label, role, areas, keys } of cases) {
    test(`${label}: ${keys.length === 0 ? "an empty attention" : keys.join(", ")}`, async () => {
      await seedSchool();
      const answer = await dashboardOf(role, areas);
      expect(answer.res.status).toBe(200);
      expect(keysOf(answer)).toEqual(keys);
      // Nothing but `attention` at the top: no recent activity, no recent applicants or messages, no totals of content.
      expect(Object.keys(answer.body)).toEqual(["attention"]);
    });
  }

  test("the numbers for a caller who sees everything, each item with the link it leads to", async () => {
    const { last } = await seedSchool();
    const { body } = await dashboardOf("viewer");
    expect(body.attention).toEqual({
      pendingApplications: { count: 7, to: "/applications?status=pending" },
      underReviewApplications: { count: 3, to: "/applications?status=under_review" },
      unreadMessages: { count: 4, to: "/messages?filter=unread" },
      batch: {
        id: last,
        year: 2025,
        phase: "awaiting_decisions",
        opensAt: expect.any(String),
        closesAt: expect.any(String),
        undecided: 5,
        to: `/batches/${last}`,
      },
    });
  });

  test("an editor of one area gets the same numbers as a viewer for that area", async () => {
    await seedSchool();
    const viewer = (await dashboardOf("viewer")).body.attention;
    const admission = (await dashboardOf("editor", ["pendaftaran"])).body.attention;
    const messages = (await dashboardOf("editor", ["komunikasi"])).body.attention;
    expect(admission).toEqual({ pendingApplications: viewer.pendingApplications, underReviewApplications: viewer.underReviewApplications, batch: viewer.batch });
    expect(messages).toEqual({ unreadMessages: viewer.unreadMessages });
  });

  test("an empty school: zero counts (a quiet tile, not a missing one) and no batch", async () => {
    const { body } = await dashboardOf("super_admin");
    expect(body.attention).toEqual({
      pendingApplications: { count: 0, to: "/applications?status=pending" },
      underReviewApplications: { count: 0, to: "/applications?status=under_review" },
      unreadMessages: { count: 0, to: "/messages?filter=unread" },
    });
  });

  test("the numbers are live: a change shows on the next request", async () => {
    const { current } = await seedSchool();
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const read = async () => ((await (await call("/api/dashboard", { cookie })).json()) as { attention: { pendingApplications: { count: number }; unreadMessages: { count: number } } }).attention;
    expect(await read()).toMatchObject({ pendingApplications: { count: 7 }, unreadMessages: { count: 4 } });
    await addApplications(current, { pending: 2 });
    await env.DB.prepare("UPDATE contact_messages SET read_at = ? WHERE read_at IS NULL").bind(now()).run();
    expect(await read()).toMatchObject({ pendingApplications: { count: 9 }, unreadMessages: { count: 0 } });
  });

  test("a grant revoked or given changes what the dashboard shows on the very next request", async () => {
    await seedSchool();
    const email = uniqueEmail("regranted");
    const cookie = await signedInCookie(email, "editor", ["komunikasi"]);
    const keys = async () => Object.keys(((await (await call("/api/dashboard", { cookie })).json()) as Answer["body"]).attention).sort();
    expect(await keys()).toEqual(["unreadMessages"]);
    const id = (await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>())!.id;
    await env.DB.prepare("INSERT INTO admin_area_grants (user_id, area) VALUES (?, 'pendaftaran')").bind(id).run();
    expect(await keys()).toEqual(["batch", "pendingApplications", "underReviewApplications", "unreadMessages"]);
    await env.DB.prepare("DELETE FROM admin_area_grants WHERE user_id = ?").bind(id).run();
    expect(await keys()).toEqual([]);
  });
});

describe("who is refused", () => {
  test("nobody signed in: 401", async () => {
    const res = await call("/api/dashboard");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  test("a student: 403, and nothing is read for them", async () => {
    await seedSchool();
    const cookie = await signedInCookie(uniqueEmail("student"), "student");
    const { db, stats } = instrumentD1(env.DB);
    const res = await call("/api/dashboard", { cookie, env: { DB: db } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(dataStatements(stats)).toEqual([]);
  });

  test("a role this build does not know is treated as a student: 403", async () => {
    const email = uniqueEmail("odd");
    const cookie = await signedInCookie(email);
    await env.DB.batch([
      env.DB.prepare("PRAGMA ignore_check_constraints = ON"),
      env.DB.prepare("UPDATE users SET role = 'owner' WHERE email = ?").bind(email),
      env.DB.prepare("PRAGMA ignore_check_constraints = OFF"),
    ]);
    expect((await call("/api/dashboard", { cookie })).status).toBe(403);
  });

  test("a deactivated admin: 401 on the next request", async () => {
    const email = uniqueEmail("gone");
    const cookie = await signedInCookie(email, "viewer");
    expect((await call("/api/dashboard", { cookie })).status).toBe(200);
    await env.DB.prepare("UPDATE users SET deactivated_at = ? WHERE email = ?").bind(now(), email).run();
    expect((await call("/api/dashboard", { cookie })).status).toBe(401);
  });

  test("only GET: a write to the dashboard is not a route", async () => {
    const cookie = await signedInCookie(uniqueEmail("boss"), "super_admin");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await call("/api/dashboard", { method, cookie, json: {} });
      expect([404, 405], method).toContain(res.status);
    }
  });
});

describe("the answer is never cached and carries no personal data", () => {
  test("Cache-Control: no-store on the answer and on both refusals", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const student = await signedInCookie(uniqueEmail("student"), "student");
    for (const [label, init, status] of [
      ["200", { cookie }, 200],
      ["401", {}, 401],
      ["403", { cookie: student }, 403],
    ] as const) {
      const res = await call("/api/dashboard", init);
      expect(res.status, label).toBe(status);
      expect(res.headers.get("cache-control"), label).toBe("no-store");
    }
  });

  // Negative test (scripts/negative-checks.mjs): a debug field with applicants' names and addresses fails this.
  test("counts, dates and links only: none of the names, addresses, phone numbers, message texts or batch names that are in the tables", async () => {
    await seedSchool();
    for (const [role, areas] of [["super_admin", []], ["viewer", []], ["editor", ALL]] as const) {
      const { text } = await dashboardOf(role, areas);
      for (const secret of SECRETS) expect(text, `${role}: ${secret}`).not.toContain(secret);
      expect(text).not.toMatch(/@example\.test/); // not even the caller's own address
    }
  });

  test("every key and value has the documented type: numbers, ISO dates, same-site links", async () => {
    await seedSchool();
    const { body } = await dashboardOf("super_admin");
    const allowed = new Set(["attention", "pendingApplications", "underReviewApplications", "unreadMessages", "batch", "count", "to", "id", "year", "phase", "opensAt", "closesAt", "undecided"]);
    const walk = (value: unknown, path: string) => {
      if (value !== null && typeof value === "object") {
        for (const [key, inner] of Object.entries(value)) {
          expect(allowed.has(key), `${path}.${key}`).toBe(true);
          walk(inner, `${path}.${key}`);
        }
      }
    };
    walk(body, "$");
    const attention = body.attention as Record<string, { count?: number; to: string; undecided?: number; opensAt?: string; closesAt?: string; id?: string; year?: number }>;
    for (const key of ["pendingApplications", "underReviewApplications", "unreadMessages"]) {
      expect(Number.isInteger(attention[key]!.count)).toBe(true);
      expect(attention[key]!.to).toMatch(/^\/[a-z]+\?[a-z_]+=[a-z_]+$/);
    }
    const batch = attention.batch!;
    expect(Number.isInteger(batch.undecided)).toBe(true);
    expect(batch.opensAt).toBe(new Date(batch.opensAt!).toISOString());
    expect(batch.closesAt).toBe(new Date(batch.closesAt!).toISOString());
    expect(batch.to).toBe(`/batches/${batch.id}`);
  });
});

describe("the tile of the batch, from real rows", () => {
  const batchOf = async () => ((await dashboardOf("viewer")).body.attention.batch ?? null) as { year: number; phase: string; undecided: number } | null;

  test("no batch: no tile", async () => {
    expect(await batchOf()).toBeNull();
  });

  test("not open yet: upcoming", async () => {
    await addBatch(2027, 10, 70);
    expect(await batchOf()).toMatchObject({ year: 2027, phase: "upcoming", undecided: 0 });
  });

  test("open, with the applications that are still waiting counted", async () => {
    const id = await addBatch(2026, -5, 25);
    await addApplications(id, { pending: 3, under_review: 1, accepted: 2 });
    expect(await batchOf()).toMatchObject({ year: 2026, phase: "open", undecided: 4 });
  });

  test("closed with applications waiting: awaiting_decisions", async () => {
    const id = await addBatch(2026, -60, -10);
    await addApplications(id, { pending: 1, accepted: 5 });
    expect(await batchOf()).toMatchObject({ phase: "awaiting_decisions", undecided: 1 });
  });

  test("closed and every application decided: ready_to_publish", async () => {
    const id = await addBatch(2026, -60, -10);
    await addApplications(id, { accepted: 5, rejected: 2 });
    expect(await batchOf()).toMatchObject({ phase: "ready_to_publish", undecided: 0 });
  });

  test("closed and published: published", async () => {
    const id = await addBatch(2026, -60, -10, true);
    await addApplications(id, { accepted: 5, rejected: 2 });
    expect(await batchOf()).toMatchObject({ phase: "published", undecided: 0 });
  });

  test("last year's batch that still waits is the tile even when this year's is open and newer", async () => {
    const last = await addBatch(2025, -400, -300);
    await addBatch(2026, -10, 20);
    await addApplications(last, { pending: 2 });
    expect(await batchOf()).toMatchObject({ year: 2025, phase: "awaiting_decisions", undecided: 2 });
  });

  test("once last year's is published, this year's open batch is the tile", async () => {
    await addBatch(2025, -400, -300, true);
    await addBatch(2026, -10, 20);
    expect(await batchOf()).toMatchObject({ year: 2026, phase: "open" });
  });

  test("only the newest few batches are looked at: an old unfinished batch beyond them is not the tile", async () => {
    const old = await addBatch(2024, -1500, -1400);
    await addApplications(old, { pending: 9 });
    for (const [year, opens] of [[2025, -1000], [2026, -700], [2027, -400]] as const) await addBatch(year, opens, opens + 90, true);
    expect(BATCH_CANDIDATES).toBe(3);
    expect(await batchOf()).toMatchObject({ year: 2027, phase: "published" });
  });
});

// ─── The cost: statements, round trips, plans and rows read ──────────────────

const DATA_TABLES = /student_applications|contact_messages|admission_batches/;
const dataStatements = (stats: D1Stats) => stats.statements.filter((sql) => DATA_TABLES.test(sql));

/** The calls of one signed-in user, counted: `/api/me` (the guard alone) and then the dashboard. */
async function costOf(role: UserRole, areas: readonly GrantableArea[] = []) {
  const cookie = await signedInCookie(uniqueEmail(role), role, areas);
  const me = instrumentD1(env.DB);
  expect((await call("/api/me", { cookie, env: { DB: me.db } })).status).toBe(200);
  const dash = instrumentD1(env.DB);
  const res = await call("/api/dashboard", { cookie, env: { DB: dash.db } });
  expect(res.status).toBe(200);
  const own = dataStatements(dash.stats);
  return { statements: own, extraRoundTrips: dash.stats.roundTrips - me.stats.roundTrips, rowsRead: dash.stats.rowsRead - me.stats.rowsRead };
}

describe("D1 cost: at most one statement per item, in one round trip, none for an area the caller cannot see", () => {
  test.each([
    ["viewer", "viewer", [], 3],
    ["super_admin", "super_admin", [], 3],
    ["editor of every area", "editor", ALL, 3],
    ["editor of pendaftaran", "editor", ["pendaftaran"], 2],
    ["editor of komunikasi", "editor", ["komunikasi"], 1],
    ["editor of konten", "editor", ["konten"], 0],
    ["editor with no areas", "editor", [], 0],
  ] as const)("%s: %i statements on the data tables", async (_label, role, areas, statements) => {
    await seedSchool();
    const cost = await costOf(role, areas);
    expect(cost.statements).toHaveLength(statements);
    // All of them in one batch: one round trip, however many statements (none at all when there is nothing to ask).
    expect(cost.extraRoundTrips).toBe(statements === 0 ? 0 : 1);
  });

  test("a student costs no read of the data tables, and nobody signed in costs nothing at all", async () => {
    await seedSchool();
    const { db, stats } = instrumentD1(env.DB);
    expect((await call("/api/dashboard", { env: { DB: db } })).status).toBe(401);
    expect(stats.roundTrips).toBeLessThanOrEqual(1); // at most the session lookup
    expect(dataStatements(stats)).toEqual([]);
  });

  test("the statements are the three of src/dashboard/queries.ts, nothing else touches the data tables", async () => {
    await seedSchool();
    const cost = await costOf("viewer");
    const drizzleDb = drizzle(env.DB, { schema });
    const expected = [undecidedApplicationsQuery(drizzleDb), recentBatchesQuery(drizzleDb), unreadMessagesQuery(drizzleDb)].map((query) => query.toSQL().sql);
    expect([...cost.statements].sort()).toEqual([...expected].sort());
  });
});

describe("D1 cost: rows read follow what needs attention, not the history of the school", () => {
  /** Same waiting work every time (60 applications waiting, 12 unread messages); only the history around it differs. */
  async function seedHistory(decidedPerBatch: number, readMessages: number) {
    for (const [year, opens] of [[2024, -1500], [2025, -1100], [2026, -700]] as const) {
      const id = await addBatch(year, opens, opens + 90, true);
      await addApplications(id, { accepted: decidedPerBatch, rejected: Math.floor(decidedPerBatch / 4) });
    }
    const current = await addBatch(2027, -60, -10);
    await addApplications(current, { pending: 40, under_review: 20, accepted: decidedPerBatch });
    await addBatch(2028, 300, 360);
    await addMessages(12, readMessages);
  }

  test("ten times the decided applications and read messages cost the same rows to read", async () => {
    await seedHistory(20, 20);
    const small = await costOf("viewer");
    await env.DB.batch(["student_applications", "admission_batches", "contact_messages"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
    await seedHistory(200, 200);
    const large = await costOf("viewer");
    expect(large.rowsRead).toBe(small.rowsRead);
  });

  test("the ceiling: a few rows per application waiting and per unread message, plus the few batches", async () => {
    await seedHistory(100, 100);
    const cost = await costOf("viewer");
    const waiting = 60;
    const unread = 12;
    // Waiting applications: an index entry and the row each (it needs the batch). Unread messages: index entries only.
    // Batches: the newest three. A margin of 10 for the grouping's bookkeeping.
    expect(cost.rowsRead).toBeLessThanOrEqual(2 * waiting + unread + 2 * BATCH_CANDIDATES + 10);
  });
});

describe("query plans (EXPLAIN QUERY PLAN)", () => {
  const db = () => drizzle(env.DB, { schema });
  const plan = async (query: { toSQL(): { sql: string; params: unknown[] } }) => {
    const { sql, params } = query.toSQL();
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>();
    return results.map((row) => row.detail);
  };

  // Negative test (scripts/negative-checks.mjs): drop the filter and the plan is a scan of every application.
  test("waiting applications: a seek on the status index for those two values, grouped (a sort of the waiting rows only)", async () => {
    expect(await plan(undecidedApplicationsQuery(db()))).toEqual([
      "SEARCH student_applications USING INDEX student_applications_status_idx (status=?)",
      "USE TEMP B-TREE FOR GROUP BY",
    ]);
  });

  test("unread messages: counted on the read_at index alone, the table is not touched", async () => {
    expect(await plan(unreadMessagesQuery(db()))).toEqual(["SEARCH contact_messages USING COVERING INDEX contact_messages_read_at_idx (read_at=?)"]);
  });

  test("the batches: an ordered walk of the opens_at index that stops at the limit, no sort", async () => {
    const lines = await plan(recentBatchesQuery(db()));
    expect(lines).toEqual(["SCAN admission_batches USING INDEX admission_batches_opens_at_idx"]);
    // A scan in index order under a LIMIT reads that many rows and no more: checked in rows, not only in words.
    for (let i = 0; i < 12; i++) await addBatch(2030 + i, i * 400, i * 400 + 90);
    const { db: counted, stats } = instrumentD1(env.DB);
    const rows = await recentBatchesQuery(drizzle(counted, { schema }));
    expect(rows).toHaveLength(BATCH_CANDIDATES);
    expect(stats.rowsRead).toBeLessThanOrEqual(2 * BATCH_CANDIDATES); // 12 batches exist, an index entry and a row for each of the 3 asked for
  });

  test("no statement reads a table it should not: every plan names its own table only", async () => {
    for (const [query, table] of [
      [undecidedApplicationsQuery(db()), "student_applications"],
      [unreadMessagesQuery(db()), "contact_messages"],
      [recentBatchesQuery(db()), "admission_batches"],
    ] as const) {
      const text = (await plan(query)).join(" ");
      const tables = [...text.matchAll(/(?:SCAN|SEARCH) (\w+)/g)].map((m) => m[1]);
      expect(new Set(tables)).toEqual(new Set([table]));
    }
  });
});
