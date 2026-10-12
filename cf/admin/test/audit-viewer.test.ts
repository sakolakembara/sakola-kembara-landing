import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { dayBound, decodeCursor, encodeCursor } from "../src/audit/cursor";
import { DECLARED_ACTIONS, DECLARED_RESOURCE_TYPES } from "../src/audit/declared";
import { projectDetails } from "../src/audit/present";
import { auditPageQuery, parseAuditFilters, type AuditFilters } from "../src/audit/query";
import * as schema from "../src/db/schema";
import { call, createVerifiedUser, signedInCookie, uniqueEmail } from "./helpers";
import { instrumentD1 } from "./public-helpers";

// Aktivitas: GET /api/admin/audit (docs/cloudflare/admin-sistem.md). Real D1 under workerd.

const PATH = "/api/admin/audit";
const MS = 1;
const DAY = 86_400_000;

interface Row {
  id: string;
  at: number;
  action?: string;
  actorEmail?: string;
  actorId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: unknown;
}

/** Straight into the table (the API under test only reads it). */
async function seed(rows: Row[]) {
  for (let i = 0; i < rows.length; i += 50) {
    await env.DB.batch(
      rows.slice(i, i + 50).map((row) =>
        env.DB.prepare("INSERT INTO audit_log (id, actor_id, actor_email, action, resource_type, resource_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(
          row.id,
          row.actorId ?? null,
          row.actorEmail ?? "pelaku@example.test",
          row.action ?? "announcement.update",
          row.resourceType === undefined ? "announcement" : row.resourceType,
          row.resourceId === undefined ? `r-${row.id}` : row.resourceId,
          row.metadata === undefined ? null : JSON.stringify(row.metadata),
          row.at,
        ),
      ),
    );
  }
}

interface Item {
  id: string;
  createdAt: string;
  action: string;
  actorEmail: string;
  actorName: string | null;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown> | null;
}
interface Page {
  items: Item[];
  pageSize: number;
  nextCursor: string | null;
}

const superAdmin = () => signedInCookie(uniqueEmail("root"), "super_admin");

async function list(cookie: string, query: Record<string, string | number> = {}) {
  const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)])).toString();
  const res = await call(search ? `${PATH}?${search}` : PATH, { cookie });
  return { res, body: (await res.clone().json()) as Page & { error?: string; param?: string } };
}

/** Follows `nextCursor` to the end, returns every id in the order met and the sizes of the pages. */
async function walk(cookie: string, pageSize: number, query: Record<string, string | number> = {}) {
  const ids: string[] = [];
  const sizes: number[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 1000; guard++) {
    const { res, body } = await list(cookie, { ...query, pageSize, ...(cursor ? { cursor } : {}) });
    expect(res.status).toBe(200);
    ids.push(...body.items.map((item) => item.id));
    sizes.push(body.items.length);
    cursor = body.nextCursor;
    if (!cursor) return { ids, sizes };
  }
  throw new Error("the cursor never ended");
}

const newestFirst = (rows: Row[]) => [...rows].sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1)).map((row) => row.id);

// ───────────────────────────────────────────────────────────────── who may read

describe("only a super_admin reads the log", () => {
  test("nobody signed in is 401, a student, a viewer and every editor are 403, a super_admin is 200", async () => {
    expect((await call(PATH)).status).toBe(401);
    const roles = [
      ["student", undefined, 403],
      ["viewer", undefined, 403],
      ["editor", [], 403],
      ["editor", ["pendaftaran", "komunikasi", "konten"], 403],
      ["super_admin", undefined, 200],
    ] as const;
    for (const [role, areas, status] of roles) {
      const cookie = await signedInCookie(uniqueEmail(role), role === "student" ? undefined : role, areas ? [...areas] : []);
      const res = await call(PATH, { cookie });
      expect(res.status, `${role} ${areas?.join(",") ?? ""}`).toBe(status);
      if (status === 403) expect(await res.json()).toEqual({ error: "forbidden" });
    }
  });

  test("a refused caller learns nothing: no rows, no count, no cursor, and the table is not even queried", async () => {
    await seed([{ id: "a1", at: 1_000 }]);
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["konten", "komunikasi", "pendaftaran"]);
    const { db, stats } = instrumentD1(env.DB);
    const res = await call(PATH, { cookie, env: { DB: db } });
    expect(res.status).toBe(403);
    expect(stats.statements.filter((sql) => sql.includes("audit_log"))).toEqual([]);
    expect(JSON.stringify(await res.json())).not.toMatch(/items|nextCursor|a1/);
  });

  test("a deactivated super_admin is refused on the next request", async () => {
    const email = uniqueEmail("root");
    const cookie = await signedInCookie(email, "super_admin");
    expect((await call(PATH, { cookie })).status).toBe(200);
    // A second super_admin has to exist for the database to allow this.
    await createVerifiedUser(uniqueEmail("other"), "super_admin");
    await env.DB.prepare("UPDATE users SET deactivated_at = ? WHERE email = ?").bind(Date.now(), email).run();
    expect((await call(PATH, { cookie })).status).toBe(401);
  });

  test("it is read-only: nothing else is routed, and nothing is written", async () => {
    const cookie = await superAdmin();
    await seed([{ id: "a1", at: 1_000 }]);
    const before = await env.DB.prepare("SELECT count(*) AS n FROM audit_log").first<{ n: number }>();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const path of [PATH, `${PATH}/a1`]) {
        const res = await call(path, { method, cookie, json: {} });
        expect(res.status, `${method} ${path}`).toBe(404);
      }
    }
    expect(await env.DB.prepare("SELECT count(*) AS n FROM audit_log").first<{ n: number }>()).toEqual(before);
    expect((await call(`${PATH}/a1`, { cookie })).status).toBe(404);
  });

  test("the answer is never cached", async () => {
    const res = await call(PATH, { cookie: await superAdmin() });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

// ──────────────────────────────────────────────────── order, cursor, equal timestamps

describe("newest first, and the cursor visits every row exactly once", () => {
  test("an empty log is an empty page with no cursor", async () => {
    const { res, body } = await list(await superAdmin());
    expect(res.status).toBe(200);
    expect(body).toEqual({ items: [], pageSize: 50, nextCursor: null });
  });

  test("the order is newest first, and a page that ends exactly at the end has no cursor", async () => {
    const cookie = await superAdmin();
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, at: 1_000 + i * 10 }));
    await seed(rows);
    const all = await list(cookie, { pageSize: 7 });
    expect(all.body.items.map((item) => item.id)).toEqual(["r6", "r5", "r4", "r3", "r2", "r1", "r0"]);
    expect(all.body.nextCursor).toBeNull();
    const six = await list(cookie, { pageSize: 6 });
    expect(six.body.items).toHaveLength(6);
    expect(six.body.nextCursor).not.toBeNull();
    const rest = await list(cookie, { pageSize: 6, cursor: six.body.nextCursor! });
    expect(rest.body.items.map((item) => item.id)).toEqual(["r0"]);
    expect(rest.body.nextCursor).toBeNull();
  });

  test("equal timestamps: ten rows in the same millisecond, pages of three, none lost and none repeated, in id order", async () => {
    const cookie = await superAdmin();
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `same-${String(i).padStart(2, "0")}`, at: 5_000 }));
    await seed(rows);
    const { ids, sizes } = await walk(cookie, 3);
    expect(ids).toEqual(newestFirst(rows));
    expect(ids).toEqual([...rows].map((row) => row.id).sort().reverse());
    expect(sizes).toEqual([3, 3, 3, 1]);
  });

  test("a page boundary inside a group of equal timestamps, among rows of other timestamps", async () => {
    const cookie = await superAdmin();
    const rows: Row[] = [];
    for (const [at, n] of [[9_000, 1], [8_000, 4], [7_000, 2], [6_000, 5], [5_000, 1]] as const) {
      for (let i = 0; i < n; i++) rows.push({ id: `g${at}-${i}`, at });
    }
    await seed(rows);
    for (const pageSize of [1, 2, 3, 4, 5, 7, 13]) {
      const { ids } = await walk(cookie, pageSize);
      expect(ids, `pageSize ${pageSize}`).toEqual(newestFirst(rows));
    }
  });

  test("a pseudo-random log with many ties is walked in exactly the order SQL says, whatever the page size", async () => {
    const cookie = await superAdmin();
    let seedValue = 7;
    const next = () => (seedValue = (seedValue * 48271) % 2147483647);
    const rows = Array.from({ length: 237 }, (_, i) => ({ id: `x${String(next() % 100000).padStart(6, "0")}-${i}`, at: 10_000 + (next() % 15) * 1000 }));
    await seed(rows);
    for (const pageSize of [10, 50, 100]) {
      const { ids } = await walk(cookie, pageSize);
      expect(ids).toHaveLength(rows.length);
      expect(new Set(ids).size).toBe(rows.length);
      expect(ids, `pageSize ${pageSize}`).toEqual(newestFirst(rows));
    }
  });

  test("a row written between two pages is newer, so it shifts nothing and repeats nothing; a row deleted between two pages leaves the walk intact", async () => {
    const cookie = await superAdmin();
    const rows = Array.from({ length: 9 }, (_, i) => ({ id: `w${i}`, at: 1_000 + i * 10 }));
    await seed(rows);
    const first = await list(cookie, { pageSize: 3 });
    expect(first.body.items.map((item) => item.id)).toEqual(["w8", "w7", "w6"]);
    await seed([{ id: "late", at: 99_999 }]);
    await env.DB.prepare("DELETE FROM audit_log WHERE id = 'w4'").run();
    const second = await list(cookie, { pageSize: 3, cursor: first.body.nextCursor! });
    expect(second.body.items.map((item) => item.id)).toEqual(["w5", "w3", "w2"]);
    const third = await list(cookie, { pageSize: 3, cursor: second.body.nextCursor! });
    expect(third.body.items.map((item) => item.id)).toEqual(["w1", "w0"]);
    expect(third.body.nextCursor).toBeNull();
  });

  test("the cursor of a row that has been deleted still continues from where it was", async () => {
    const cookie = await superAdmin();
    await seed(Array.from({ length: 6 }, (_, i) => ({ id: `d${i}`, at: 1_000 + i })));
    const first = await list(cookie, { pageSize: 2 });
    await env.DB.prepare("DELETE FROM audit_log WHERE id IN ('d5', 'd4')").run(); // the whole first page is gone
    const second = await list(cookie, { pageSize: 2, cursor: first.body.nextCursor! });
    expect(second.body.items.map((item) => item.id)).toEqual(["d3", "d2"]);
  });

  test("pageSize: 50 when missing or not a number, never above 100, never below 1", async () => {
    const cookie = await superAdmin();
    await seed(Array.from({ length: 120 }, (_, i) => ({ id: `p${String(i).padStart(3, "0")}`, at: 1_000 + i })));
    const sized = async (value: string | number) => (await list(cookie, { pageSize: value })).body.items.length;
    expect(await sized("abc")).toBe(50);
    expect(await sized(0)).toBe(50);
    expect(await sized(-5)).toBe(50);
    expect((await list(cookie)).body.pageSize).toBe(50);
    expect(await sized(1000)).toBe(100);
    expect((await list(cookie, { pageSize: 1000 })).body.pageSize).toBe(100);
    expect(await sized(1)).toBe(1);
    expect(await sized(7)).toBe(7);
  });

  test("the cursor says where, not what: it carries a time and an id and nothing from the row", async () => {
    const cookie = await superAdmin();
    await seed([
      { id: "c1", at: 3_000, actorEmail: "rahasia@example.test", metadata: { label: "Judul rahasia" } },
      { id: "c2", at: 2_000 },
    ]);
    const { body } = await list(cookie, { pageSize: 1 });
    expect(decodeCursor(body.nextCursor!)).toEqual({ createdAt: 3_000, id: "c1" });
    expect(atob(body.nextCursor!.replace(/-/g, "+").replace(/_/g, "/"))).not.toMatch(/rahasia/);
  });
});

describe("a cursor that is not ours is refused before anything is read", () => {
  const bad: [string, string][] = [
    ["not base64url", "!!!"],
    ["empty after decoding", encodeCursor({ createdAt: 1, id: "x" }).slice(0, 3)],
    ["not JSON", btoa("hello").replace(/=+$/, "")],
    ["not an array", btoa(JSON.stringify({ createdAt: 1, id: "x" })).replace(/=+$/, "")],
    ["wrong length", btoa(JSON.stringify([1])).replace(/=+$/, "")],
    ["a string time", btoa(JSON.stringify(["1", "x"])).replace(/=+$/, "")],
    ["a fractional time", btoa(JSON.stringify([1.5, "x"])).replace(/=+$/, "")],
    ["a negative time", btoa(JSON.stringify([-1, "x"])).replace(/=+$/, "")],
    ["a time beyond what a Date holds", btoa(JSON.stringify([9e15, "x"])).replace(/=+$/, "")],
    ["a numeric id", btoa(JSON.stringify([1, 2])).replace(/=+$/, "")],
    ["an empty id", btoa(JSON.stringify([1, ""])).replace(/=+$/, "")],
    ["an id of 65 characters", btoa(JSON.stringify([1, "x".repeat(65)])).replace(/=+$/, "")],
    ["longer than 200 characters", "A".repeat(201)],
    ["SQL", "1%27%20OR%201%3D1--"],
  ];

  test.each(bad)("%s: 400 invalid_query naming the cursor, and the table is not queried", async (_name, cursor) => {
    const cookie = await superAdmin();
    const { db, stats } = instrumentD1(env.DB);
    const res = await call(`${PATH}?cursor=${cursor}`, { cookie, env: { DB: db } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_query", message: "Pencarian atau penyaringan tidak dikenal.", param: "cursor" });
    expect(stats.statements.filter((sql) => sql.includes("audit_log"))).toEqual([]);
  });

  test("the cursor round trip, and the largest ids and times it accepts", () => {
    for (const cursor of [{ createdAt: 0, id: "a" }, { createdAt: 1_791_000_000_000, id: "3f2c9d6e-8a41-4b7a-9d55-1c0f5a7e2b10" }, { createdAt: 8.64e15, id: "x".repeat(64) }]) {
      expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────── filters

describe("filters", () => {
  const T = Date.UTC(2026, 9, 1, 3, 0, 0); // 2026-10-01 10:00 WIB
  const rows: Row[] = [
    { id: "f01", at: T + 1 * MS, action: "announcement.create", resourceType: "announcement", actorEmail: "dewi@example.test" },
    { id: "f02", at: T + 2 * MS, action: "announcement.update", resourceType: "announcement", actorEmail: "dewi@example.test" },
    { id: "f03", at: T + 3 * MS, action: "blog.update", resourceType: "blog", actorEmail: "dewi@example.test" },
    { id: "f04", at: T + 4 * MS, action: "announcement.update", resourceType: "announcement", actorEmail: "rommy@example.test" },
    { id: "f05", at: T + DAY, action: "admin.create", resourceType: "admin_user", actorEmail: "rommy@example.test" },
    { id: "f06", at: T + 2 * DAY, action: "application.submit", resourceType: "application", actorEmail: "siswa@example.test" },
    { id: "f07", at: T + 3 * DAY, action: "blog.update", resourceType: "blog", actorEmail: "rommy@example.test" },
    { id: "f08", at: T + 3 * DAY + 5, action: "contact_message.submit", resourceType: "contact_message", actorEmail: "pengirim@example.test" },
  ];
  const idsOf = async (cookie: string, query: Record<string, string>) => {
    const { res, body } = await list(cookie, { ...query, pageSize: 100 });
    expect(res.status, JSON.stringify(query)).toBe(200);
    return body.items.map((item) => item.id);
  };
  const expected = (keep: (row: Row) => boolean) => newestFirst(rows.filter(keep));

  test("each filter alone, and the empty value means no filter", async () => {
    const cookie = await superAdmin();
    await seed(rows);
    expect(await idsOf(cookie, { action: "announcement.update" })).toEqual(expected((r) => r.action === "announcement.update"));
    expect(await idsOf(cookie, { resource: "blog" })).toEqual(expected((r) => r.resourceType === "blog"));
    expect(await idsOf(cookie, { actor: "rommy@example.test" })).toEqual(expected((r) => r.actorEmail === "rommy@example.test"));
    expect(await idsOf(cookie, { action: "", resource: "", actor: "  ", from: "", to: "", cursor: "" })).toEqual(newestFirst(rows));
  });

  test("the actor is matched exactly, in any case and with stray spaces, never as a substring", async () => {
    const cookie = await superAdmin();
    await seed(rows);
    expect(await idsOf(cookie, { actor: "  Rommy@Example.TEST " })).toEqual(expected((r) => r.actorEmail === "rommy@example.test"));
    expect(await idsOf(cookie, { actor: "rommy" })).toEqual([]);
    expect(await idsOf(cookie, { actor: "rommy@example" })).toEqual([]);
    expect(await idsOf(cookie, { actor: "%" })).toEqual([]);
    expect(await idsOf(cookie, { actor: "_ommy@example.test" })).toEqual([]);
  });

  test("combinations narrow, they never widen", async () => {
    const cookie = await superAdmin();
    await seed(rows);
    expect(await idsOf(cookie, { action: "announcement.update", actor: "dewi@example.test" })).toEqual(["f02"]);
    expect(await idsOf(cookie, { action: "blog.update", resource: "blog", actor: "rommy@example.test" })).toEqual(["f07"]);
    expect(await idsOf(cookie, { action: "blog.update", resource: "announcement" })).toEqual([]);
    expect(await idsOf(cookie, { resource: "blog", from: "2026-10-04", to: "2026-10-04" })).toEqual(["f07"]);
    expect(await idsOf(cookie, { actor: "rommy@example.test", from: "2026-10-02" })).toEqual(["f07", "f05"]);
    expect(await idsOf(cookie, { action: "announcement.update", resource: "announcement", actor: "rommy@example.test", from: "2026-10-01", to: "2026-10-01" })).toEqual(["f04"]);
  });

  test("a filter and the cursor together: the walk of a filtered list is complete", async () => {
    const cookie = await superAdmin();
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `m${String(i).padStart(2, "0")}`, at: 10_000 + (i % 5) * 1000, action: i % 3 === 0 ? "blog.update" : "report.create", resourceType: i % 3 === 0 ? "blog" : "report" }));
    await seed(many);
    const queries: { action?: string; resource?: string }[] = [{ action: "blog.update" }, { resource: "report" }, { action: "report.create", resource: "report" }];
    for (const query of queries) {
      const { ids } = await walk(cookie, 4, query as Record<string, string>);
      expect(ids, JSON.stringify(query)).toEqual(newestFirst(many.filter((r) => (query.action ? r.action === query.action : true) && (query.resource ? r.resourceType === query.resource : true))));
    }
  });

  test("days are whole days in WIB: the last millisecond of a day is in it, the next one is not", async () => {
    const cookie = await superAdmin();
    const endOf1Oct = Date.UTC(2026, 9, 1, 16, 59, 59, 999); // 2026-10-01 23:59:59.999 WIB
    await seed([
      { id: "d0", at: endOf1Oct - 1 },
      { id: "d1", at: endOf1Oct },
      { id: "d2", at: endOf1Oct + 1 }, // 2026-10-02 00:00:00.000 WIB
    ]);
    expect(await idsOf(cookie, { from: "2026-10-01", to: "2026-10-01" })).toEqual(["d1", "d0"]);
    expect(await idsOf(cookie, { from: "2026-10-02", to: "2026-10-02" })).toEqual(["d2"]);
    expect(await idsOf(cookie, { to: "2026-10-01" })).toEqual(["d1", "d0"]);
    expect(await idsOf(cookie, { from: "2026-10-02" })).toEqual(["d2"]);
    expect(dayBound("2026-10-01", false)!.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(dayBound("2026-10-01", true)!.toISOString()).toBe("2026-10-01T16:59:59.999Z");
  });

  test("a range that ends before it starts is simply empty", async () => {
    const cookie = await superAdmin();
    await seed(rows);
    expect(await idsOf(cookie, { from: "2026-10-05", to: "2026-10-01" })).toEqual([]);
  });

  test("an action or a resource type that is not declared is refused, and so is every malformed value", async () => {
    const cookie = await superAdmin();
    await seed(rows);
    const refused: [Record<string, string>, string][] = [
      [{ action: "announcement.publish" }, "action"],
      [{ action: "ANNOUNCEMENT.UPDATE" }, "action"],
      [{ action: "announcement.update " }, "action"],
      [{ action: "admin.delete" }, "action"], // a legacy name: its rows are shown, but it is not offered as a filter
      [{ action: "' OR 1=1 --" }, "action"],
      [{ resource: "blog_post" }, "resource"],
      [{ resource: "Blog" }, "resource"],
      [{ actor: "x".repeat(255) }, "actor"],
      [{ from: "2026-02-30" }, "from"],
      [{ from: "2026-13-01" }, "from"],
      [{ from: "26-10-01" }, "from"],
      [{ from: "2026-10-01T00:00:00Z" }, "from"],
      [{ from: "1999-12-31" }, "from"],
      [{ from: "2101-01-01" }, "from"],
      [{ from: "hari ini" }, "from"],
      [{ to: "2026-00-10" }, "to"],
      [{ to: "tomorrow" }, "to"],
    ];
    for (const [query, param] of refused) {
      const { res, body } = await list(cookie, query);
      expect(res.status, JSON.stringify(query)).toBe(400);
      expect(body.error).toBe("invalid_query");
      expect(body.param).toBe(param);
    }
  });

  test("every declared action and resource type is accepted, and the lists have no duplicates", async () => {
    const cookie = await superAdmin();
    expect(new Set(DECLARED_ACTIONS).size).toBe(DECLARED_ACTIONS.length);
    expect(new Set(DECLARED_RESOURCE_TYPES).size).toBe(DECLARED_RESOURCE_TYPES.length);
    for (const action of DECLARED_ACTIONS) expect((await list(cookie, { action })).res.status, action).toBe(200);
    for (const resource of DECLARED_RESOURCE_TYPES) expect((await list(cookie, { resource })).res.status, resource).toBe(200);
  });

  test("rows with a name the page does not offer as a filter are still shown, with the name they were written with", async () => {
    const cookie = await superAdmin();
    await seed([
      { id: "old1", at: 2_000, action: "admin.delete", resourceType: "admin_user" },
      { id: "old2", at: 1_000, action: "blog.upload_image", resourceType: "blog_image" },
    ]);
    const { body } = await list(cookie);
    expect(body.items.map((item) => [item.action, item.resourceType])).toEqual([["admin.delete", "admin_user"], ["blog.upload_image", "blog_image"]]);
  });
});

describe("the filters of a query string", () => {
  test("parseAuditFilters says which parameter is wrong, and what the filters are when all is well", () => {
    const read = (query: Record<string, string>) => (name: string) => query[name];
    expect(parseAuditFilters(read({}))).toEqual({ ok: true, filters: {} });
    expect(parseAuditFilters(read({ action: "nope" }))).toEqual({ ok: false, param: "action" });
    const cursor = encodeCursor({ createdAt: 5, id: "z" });
    const parsed = parseAuditFilters(read({ action: "blog.update", resource: "blog", actor: " A@B.test ", from: "2026-10-01", to: "2026-10-02", cursor }));
    expect(parsed).toEqual({
      ok: true,
      filters: {
        action: "blog.update",
        resource: "blog",
        actor: "a@b.test",
        from: new Date("2026-09-30T17:00:00.000Z"),
        to: new Date("2026-10-02T16:59:59.999Z"),
        cursor: { createdAt: 5, id: "z" },
      },
    });
  });
});

// ─────────────────────────────────────────────────── what a row shows, and what it never does

describe("what a row shows", () => {
  test("the fields of a row, exactly: when, what, who, about what, details", async () => {
    const cookie = await superAdmin();
    await seed([{ id: "s1", at: Date.UTC(2026, 9, 1, 3), action: "announcement.update", actorEmail: "dewi@example.test", resourceType: "announcement", resourceId: "ann-1", metadata: { fields: ["title", "body"], label: "Pendaftaran dibuka" } }]);
    const { body } = await list(cookie);
    expect(body.items).toEqual([
      {
        id: "s1",
        createdAt: "2026-10-01T03:00:00.000Z",
        action: "announcement.update",
        actorEmail: "dewi@example.test",
        actorName: null,
        resourceType: "announcement",
        resourceId: "ann-1",
        details: { fields: ["title", "body"], label: "Pendaftaran dibuka" },
      },
    ]);
    expect(Object.keys(body.items[0]!).sort()).toEqual(["action", "actorEmail", "actorName", "createdAt", "details", "id", "resourceId", "resourceType"]);
  });

  test("a row with no target or no metadata is still a row", async () => {
    const cookie = await superAdmin();
    await seed([{ id: "n1", at: 1_000, action: "user.password_reset", resourceType: null, resourceId: null, metadata: undefined }]);
    const { body } = await list(cookie);
    expect(body.items[0]).toMatchObject({ resourceType: null, resourceId: null, details: null });
  });

  test("an admin shows their name, a student or a visitor never does (their row's own email is all there is)", async () => {
    const cookie = await superAdmin();
    const adminId = await createVerifiedUser(uniqueEmail("admin"), "editor");
    const studentId = await createVerifiedUser(uniqueEmail("siswa"));
    await env.DB.prepare("UPDATE users SET name = 'Dewi Pengurus' WHERE id = ?").bind(adminId).run();
    await env.DB.prepare("UPDATE users SET name = 'Siswa Bernama Rahasia' WHERE id = ?").bind(studentId).run();
    await seed([
      { id: "u1", at: 3_000, actorId: adminId, actorEmail: "dewi@example.test" },
      { id: "u2", at: 2_000, actorId: studentId, actorEmail: "siswa@example.test", action: "student.register", resourceType: "user" },
      { id: "u3", at: 1_000, actorId: null, actorEmail: "pengunjung@example.test", action: "contact_message.submit", resourceType: "contact_message" },
    ]);
    const { res, body } = await list(cookie);
    expect(body.items.map((item) => [item.id, item.actorName, item.actorEmail])).toEqual([
      ["u1", "Dewi Pengurus", "dewi@example.test"],
      ["u2", null, "siswa@example.test"],
      ["u3", null, "pengunjung@example.test"],
    ]);
    expect(await res.clone().text()).not.toContain("Rahasia");
  });

  test("a deactivated admin still shows their name: the audit trail keeps pointing at a real person", async () => {
    const cookie = await superAdmin();
    const adminId = await createVerifiedUser(uniqueEmail("admin"), "viewer");
    await env.DB.prepare("UPDATE users SET name = 'Mantan Pengurus', deactivated_at = ? WHERE id = ?").bind(Date.now(), adminId).run();
    await seed([{ id: "x1", at: 1_000, actorId: adminId }]);
    expect((await list(cookie)).body.items[0]!.actorName).toBe("Mantan Pengurus");
  });
});

describe("details: only what the table of src/audit/present.ts allows, whoever wrote it", () => {
  test("the CRUD kit's rows keep their field names and label, and nothing else that was stored", () => {
    expect(
      projectDetails("announcement.update", {
        fields: ["title", "body"],
        label: "Pendaftaran dibuka",
        name: "Siti Rahayu",
        message: "isi pesan pribadi",
        note: "catatan tinjau",
        email: "siti@example.test",
        phone: "0812",
        body: "<p>isi</p>",
      }),
    ).toEqual({ fields: ["title", "body"], label: "Pendaftaran dibuka" });
  });

  test("an email key is kept for admin rows only", () => {
    const stored = { email: "admin@example.test", role: "editor", mode: "invite", password: "x", token: "t" };
    expect(projectDetails("admin.create", stored)).toEqual({ email: "admin@example.test", role: "editor", mode: "invite" });
    for (const action of ["contact_message.delete", "application.accepted", "announcement.update", "upload.create", "student.register", "user.password_reset"]) {
      expect(projectDetails(action, { email: "siswa@example.test" }), action).toBeNull();
    }
  });

  test("the admin rows: role changes, area lists, and nothing outside the grantable areas", () => {
    expect(projectDetails("admin.update", { email: "a@b.test", roleFrom: "viewer", roleTo: "editor", nameChanged: true, areasRemoved: ["konten"], areasBefore: ["konten"], areasAfter: [], field: "areas", before: ["konten"], after: ["komunikasi"] })).toEqual({
      email: "a@b.test",
      roleFrom: "viewer",
      roleTo: "editor",
      nameChanged: true,
      areasRemoved: ["konten"],
      areasBefore: ["konten"],
      areasAfter: [],
      field: "areas",
      before: ["konten"],
      after: ["komunikasi"],
    });
    // One bad element drops the whole list, never half of it; a role the model does not have is dropped.
    expect(projectDetails("admin.update", { areasAfter: ["konten", "sistem"], roleTo: "root", before: "konten", nameChanged: "yes" })).toBeNull();
  });

  test("an upload row never shows the path (a file name can be a person's), the rest is technical", () => {
    expect(projectDetails("upload.create", { kind: "blog-image", path: "/uploads/blog-image/2026/x-siti-rahayu.png", contentType: "image/png", size: 1234, width: 10, height: null })).toEqual({
      kind: "blog-image",
      contentType: "image/png",
      size: 1234,
      width: 10,
    });
  });

  test("column names are names: a value that does not look like one drops the list", () => {
    expect(projectDetails("blog.update", { fields: ["title", "Siti Rahayu"] })).toBeNull();
    expect(projectDetails("blog.update", { fields: ["title", "1st"] })).toBeNull();
    expect(projectDetails("blog.update", { fields: Array.from({ length: 41 }, () => "title") })).toBeNull();
    expect(projectDetails("blog.update", { fields: "title" })).toBeNull();
  });

  test("anything that is not an object is nothing, and so is an empty object", () => {
    for (const metadata of [null, undefined, "teks", 5, true, ["fields"], {}]) expect(projectDetails("blog.update", metadata)).toBeNull();
  });

  test("a label is text of a sane length, a registration says how it happened", () => {
    expect(projectDetails("blog.update", { label: "" })).toBeNull();
    expect(projectDetails("blog.update", { label: "x".repeat(121) })).toBeNull();
    expect(projectDetails("blog.update", { label: 42 })).toBeNull();
    expect(projectDetails("student.register", { via: "google", name: "Siti" })).toEqual({ via: "google" });
    expect(projectDetails("student.register", { via: "facebook" })).toBeNull();
  });

  test("through the API: a planted secret in a key nobody listed, and a student's name, are nowhere in the answer", async () => {
    const cookie = await superAdmin();
    const studentId = await createVerifiedUser(uniqueEmail("siswa"));
    await env.DB.prepare("UPDATE users SET name = 'Nama Siswa Sungguhan' WHERE id = ?").bind(studentId).run();
    await seed([
      { id: "leak1", at: 3_000, action: "contact_message.delete", resourceType: "contact_message", actorId: studentId, metadata: { fullName: "RAHASIA-NAMA", message: "RAHASIA-ISI", email: "rahasia@example.test", label: "ok" } },
      { id: "leak2", at: 2_000, action: "application.accepted", resourceType: "application", metadata: { note: "RAHASIA-CATATAN", fields: ["status"] } },
      { id: "leak3", at: 1_000, action: "team.update", resourceType: "team_member", metadata: "RAHASIA-TEKS" },
    ]);
    const res = await call(PATH, { cookie });
    const text = await res.text();
    expect(text).not.toMatch(/RAHASIA|rahasia@|Nama Siswa Sungguhan/);
    const items = (JSON.parse(text) as Page).items;
    expect(items.map((item) => item.details)).toEqual([{ label: "ok" }, { fields: ["status"] }, null]);
  });
});

describe("what the API itself writes shows up here", () => {
  test("an announcement created and changed through the API appears newest first, with the actor, the names of the fields and the title as label", async () => {
    const email = uniqueEmail("root");
    const cookie = await signedInCookie(email, "super_admin");
    const created = await call("/api/admin/announcements", { method: "POST", cookie, json: { title: "Pendaftaran dibuka", body: "Isi pengumuman", severity: "info", active: true } });
    expect(created.status).toBe(201);
    const { item } = (await created.json()) as { item: { id: string; updatedAt: string } };
    const updated = await call(`/api/admin/announcements/${item.id}`, { method: "PUT", cookie, headers: { "If-Match": `"${item.updatedAt}"` }, json: { title: "Pendaftaran ditutup", body: "Isi pengumuman", severity: "info", active: true } });
    expect(updated.status).toBe(200);

    const { body } = await list(cookie);
    expect(body.items.map((row) => row.action)).toEqual(["announcement.update", "announcement.create"]);
    expect(body.items[0]).toMatchObject({ actorEmail: email, resourceType: "announcement", resourceId: item.id, details: { fields: ["title"], label: "Pendaftaran ditutup" } });
    expect(body.items[1]!.details).toMatchObject({ label: "Pendaftaran dibuka" });
    expect(await (await call(PATH, { cookie })).text()).not.toContain("Isi pengumuman");
  });
});

// ─────────────────────────────────────────────────────────── plans and rows read

const db = () => drizzle(env.DB, { schema });
const plan = async (query: { toSQL(): { sql: string; params: unknown[] } }) => {
  const { sql, params } = query.toSQL();
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>();
  return results.map((row) => row.detail);
};

/** `n` rows: some admins with many rows each, many one-off actors, a rare action, a rare resource type; many equal timestamps. */
async function seedBig(n: number) {
  const base = Date.UTC(2026, 0, 1);
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${n})
     INSERT INTO audit_log (id, actor_id, actor_email, action, resource_type, resource_id, metadata, created_at)
     SELECT printf('id-%08d', i), NULL,
       CASE WHEN i % 10 < 6 THEN 'admin' || (i % 5) || '@example.test' ELSE 'siswa' || (i % 3000) || '@example.test' END,
       CASE WHEN i % 997 = 0 THEN 'batch.publish_results' WHEN i % 7 = 0 THEN 'announcement.update' WHEN i % 7 = 1 THEN 'blog.update' WHEN i % 7 = 2 THEN 'application.submit' ELSE 'application.accepted' END,
       CASE WHEN i % 997 = 0 THEN 'batch' WHEN i % 7 = 0 THEN 'announcement' WHEN i % 7 = 1 THEN 'blog' ELSE 'application' END,
       printf('r-%d', i), NULL, ${base} + ((i / 3) * 1000)
     FROM n`,
  ).run();
}

const MID = { createdAt: Date.UTC(2026, 0, 1) + 5_000_000, id: "id-00015000" };
const FILTER_SHAPES: [string, AuditFilters][] = [
  ["the first page", {}],
  ["the next page (a cursor)", { cursor: MID }],
  ["a day range", { from: dayBound("2026-01-01", false)!, to: dayBound("2026-01-01", true)! }],
  ["one action", { action: "batch.publish_results" }],
  ["one action, next page", { action: "blog.update", cursor: MID }],
  ["one resource type", { resource: "batch" }],
  ["one resource type, next page", { resource: "application", cursor: MID }],
  ["one actor", { actor: "siswa6@example.test" }],
  ["one actor, next page", { actor: "admin1@example.test", cursor: MID }],
  ["an action in a day range", { action: "batch.publish_results", from: new Date(Date.UTC(2026, 0, 1)), to: new Date(Date.UTC(2026, 0, 6)) }],
  ["an actor and a resource type", { actor: "admin1@example.test", resource: "blog" }],
  ["everything at once", { action: "blog.update", resource: "blog", actor: "admin1@example.test", from: new Date(Date.UTC(2026, 0, 1)), to: new Date(Date.UTC(2026, 0, 6)), cursor: MID }],
];
/** Two keys of two different indexes at once: one is sought, the other tested row by row. */
const COMBINED_SHAPES = ["an actor and a resource type", "everything at once"];
const SINGLE_SHAPES = FILTER_SHAPES.map(([name]) => name).filter((name) => !COMBINED_SHAPES.includes(name));

describe("query plans (EXPLAIN QUERY PLAN) and rows read", () => {
  // Negative test (scripts/negative-checks-sistem.mjs): without the migration's indexes every filter below is a scan of the table.
  test("no page, filtered or not, sorts or scans the log: each is a seek or an ordered walk of an index that ends in (created_at, id)", async () => {
    await seedBig(2000);
    for (const [name, filters] of FILTER_SHAPES) {
      const lines = await plan(auditPageQuery(db(), filters, 51));
      const text = lines.join("\n");
      expect(text, name).not.toMatch(/TEMP B-TREE/);
      // The audit table is always reached through one of the four keyset indexes, never by a bare scan.
      expect(lines.filter((line) => /audit_log/.test(line) && !/USING/.test(line)), name).toEqual([]);
      expect(text, name).toMatch(/audit_log_(created_at_id|action_created|resource_type_created|actor_email_created)_idx/);
    }
  });

  test("the plans, in words (the doc quotes these)", async () => {
    await seedBig(2000);
    const first = await plan(auditPageQuery(db(), {}, 51));
    expect(first[0]).toBe("SCAN audit_log USING INDEX audit_log_created_at_id_idx");
    const next = await plan(auditPageQuery(db(), { cursor: MID }, 51));
    expect(next[0]).toBe("SEARCH audit_log USING INDEX audit_log_created_at_id_idx ((created_at,id)<(?,?))");
    expect((await plan(auditPageQuery(db(), { action: "blog.update" }, 51)))[0]).toBe("SEARCH audit_log USING INDEX audit_log_action_created_idx (action=?)");
    expect((await plan(auditPageQuery(db(), { resource: "blog" }, 51)))[0]).toBe("SEARCH audit_log USING INDEX audit_log_resource_type_created_idx (resource_type=?)");
    expect((await plan(auditPageQuery(db(), { actor: "a@b.test" }, 51)))[0]).toBe("SEARCH audit_log USING INDEX audit_log_actor_email_created_idx (actor_email=?)");
    // The name of an admin: one primary-key lookup per row of the page.
    expect(first[1]).toBe("SEARCH users USING INDEX sqlite_autoindex_users_1 (id=?) LEFT-JOIN");
  });

  test("rows read follow the page, not the table: the same on 2,000 rows and on 20,000, for every shape of filter", async () => {
    const measure = async () => {
      const out: Record<string, number> = {};
      for (const [name, filters] of FILTER_SHAPES) {
        const counted = instrumentD1(env.DB);
        await auditPageQuery(drizzle(counted.db, { schema }), filters, 51);
        out[name] = counted.stats.rowsRead;
      }
      return out;
    };
    await seedBig(2000);
    const small = await measure();
    await env.DB.prepare("DELETE FROM audit_log").run();
    await seedBig(20000);
    const large = await measure();
    // One filter (or none), with or without a cursor or a day range: a seek, then one index entry per row of the
    // page (the join to users reads nothing here, the rows have no actor id). 51 asked for, 51 to 52 read.
    for (const name of SINGLE_SHAPES) expect(large[name], name).toBeLessThanOrEqual(51 + 5);
    // The same on a table ten times the size, for the shapes whose answer is a full page at both sizes.
    for (const name of ["the first page", "the next page (a cursor)", "a day range", "one action, next page", "one resource type, next page", "one actor, next page"]) {
      // (A seek past a cursor touches one entry beyond the page: 51 on one size, 52 on the other, not 10 times more.)
      expect(Math.abs(large[name]! - small[name]!), name).toBeLessThanOrEqual(2);
    }
    // Two filters at once: SQLite seeks the index of ONE of them and tests the other on every row it passes. So the
    // cost is bounded by the rows of that one key (here an admin with 2,000 of the 20,000 rows), never by the table.
    // Measured at 20,000 rows: 355 for an actor and a resource type, 2,001 for an actor and a rare resource type
    // (the whole actor, 2 rows found), 852 for all five filters at once.
    const ACTOR_ROWS = 2000;
    for (const name of COMBINED_SHAPES) expect(large[name], name).toBeLessThanOrEqual(ACTOR_ROWS + 51);
  });

  test("the name of the actor costs a lookup per row of the page, not per row of the log", async () => {
    const adminId = await createVerifiedUser(uniqueEmail("admin"), "editor");
    await seedBig(3000);
    await env.DB.prepare("UPDATE audit_log SET actor_id = ?").bind(adminId).run();
    const counted = instrumentD1(env.DB);
    const rows = await auditPageQuery(drizzle(counted.db, { schema }), {}, 51);
    expect(rows).toHaveLength(51);
    expect(rows.every((row) => row.actorName === "Tester")).toBe(true);
    // The page is 51 rows of the log and a primary-key lookup in `users` for each: measured 102 (2 per row).
    expect(counted.stats.rowsRead).toBeLessThanOrEqual(2 * 51 + 5);
  });

  test("the whole request: one statement on the log (plus the guard's own reads), one round trip", async () => {
    const cookie = await superAdmin();
    await seedBig(500);
    const me = instrumentD1(env.DB);
    await call("/api/me", { cookie, env: { DB: me.db } });
    const counted = instrumentD1(env.DB);
    const res = await call(`${PATH}?action=blog.update`, { cookie, env: { DB: counted.db } });
    expect(res.status).toBe(200);
    const own = counted.stats.statements.filter((sql) => /audit_log/.test(sql));
    expect(own).toHaveLength(1);
    expect(counted.stats.roundTrips - me.stats.roundTrips).toBe(1);
    // The guard's reads are the same as for /api/me; what the page itself adds is the page (about two reads per row at most).
    expect(counted.stats.rowsRead - me.stats.rowsRead).toBeLessThanOrEqual(2 * 51 + 5);
  });
});
