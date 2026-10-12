import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { PREVIEW_LENGTH } from "../src/api/messages";
import { spyOnD1 } from "./crud-app";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { instrumentD1 } from "./public-helpers";

// Pesan, `/api/admin/messages` (src/api/messages.ts, docs/cloudflare/admin-komunikasi.md): who may do what,
// what the list and the detail answer, and above all the rule that opening a message (a GET) never marks it read.
// What the CRUD kit does for any resource (the 404 shape, the audit transaction, clamping) is proved by
// test/crud-contract.test.ts; this file proves the Pesan routes are wired to it, and what is specific to them.

const BASE = "/api/admin/messages";

interface Row {
  id: string;
  fullName: string;
  email: string;
  subject: "partnership" | "donation" | "other";
  message: string;
  readAt: number | null;
  createdAt: number;
}

let counter = 0;
/** A message straight into the table (the public form is tested in test/public-contact.test.ts). */
async function seed(over: Partial<Row> = {}): Promise<Row> {
  counter += 1;
  const row: Row = {
    id: crypto.randomUUID(),
    fullName: `Pengirim Contoh ${counter}`,
    email: `pengirim-${counter}@example.test`,
    subject: "other",
    message: `Isi pesan contoh nomor ${counter}, cukup panjang untuk lolos validasi.`,
    readAt: null,
    createdAt: 1_700_000_000_000 + counter * 1000,
    ...over,
  };
  await env.DB.prepare("INSERT INTO contact_messages (id, full_name, email, subject, message, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(row.id, row.fullName, row.email, row.subject, row.message, row.readAt, row.createdAt)
    .run();
  return row;
}

async function readAt(id: string): Promise<number | null> {
  return (await env.DB.prepare("SELECT read_at AS v FROM contact_messages WHERE id = ?").bind(id).first<{ v: number | null }>())!.v;
}

async function count(table: string) {
  return (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
}

async function auditRows() {
  return (await env.DB.prepare("SELECT actor_email, action, resource_type, resource_id, metadata FROM audit_log ORDER BY created_at, rowid").all<{
    actor_email: string;
    action: string;
    resource_type: string;
    resource_id: string;
    metadata: string | null;
  }>()).results;
}

const editor = () => signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);
const viewer = () => signedInCookie(uniqueEmail("viewer"), "viewer");

interface Listed {
  items: { id: string; fullName: string; email: string; subject: string; preview: string; readAt: string | null; createdAt: string }[];
  page: number;
  pageSize: number;
  total: number;
}
const list = async (query = "", cookie?: string) => (await (await call(`${BASE}${query}`, { cookie: cookie ?? (await viewer()) })).json()) as Listed;

describe("who may do what (the role and area matrix)", () => {
  test("nobody signed in: 401 on every route, and nothing changes", async () => {
    const row = await seed();
    const answers = [
      await call(BASE),
      await call(`${BASE}/counts`),
      await call(`${BASE}/${row.id}`),
      await call(`${BASE}/${row.id}/read`, { method: "POST" }),
      await call(`${BASE}/${row.id}/unread`, { method: "POST" }),
      await call(`${BASE}/${row.id}`, { method: "DELETE" }),
    ];
    expect(answers.map((res) => res.status)).toEqual([401, 401, 401, 401, 401, 401]);
    expect(await readAt(row.id)).toBeNull();
    expect(await count("contact_messages")).toBe(1);
    expect(await count("audit_log")).toBe(0);
  });

  // Messages are the `komunikasi` area. Negative test (scripts/negative-checks-komunikasi.mjs): drop the area check of
  // a route, or let a verb need only read access, and one of the cases below fails.
  const cases = [
    { label: "student", role: "student", areas: [], read: 403, write: 403 },
    { label: "viewer", role: "viewer", areas: [], read: 200, write: 403 },
    // A grant row on a viewer is inert: viewer is read-only by role.
    { label: "viewer with a stray komunikasi grant", role: "viewer", areas: ["komunikasi"], read: 200, write: 403 },
    { label: "editor with no grants", role: "editor", areas: [], read: 403, write: 403 },
    { label: "editor of pendaftaran and konten only", role: "editor", areas: ["pendaftaran", "konten"], read: 403, write: 403 },
    { label: "editor of komunikasi", role: "editor", areas: ["komunikasi"], read: 200, write: "ok" },
    { label: "super_admin", role: "super_admin", areas: [], read: 200, write: "ok" },
  ] as const;

  for (const { label, role, areas, read, write } of cases) {
    test(`${label}: reads ${read}, changes ${write === "ok" ? "allowed" : "403"}`, async () => {
      const cookie = await signedInCookie(uniqueEmail(role), role, areas);
      const target = await seed();

      const reads = [await call(BASE, { cookie }), await call(`${BASE}/counts`, { cookie }), await call(`${BASE}/${target.id}`, { cookie })];
      expect(reads.map((res) => res.status)).toEqual([read, read, read]);

      const marked = await call(`${BASE}/${target.id}/read`, { method: "POST", cookie });
      const unmarked = await call(`${BASE}/${target.id}/unread`, { method: "POST", cookie });
      const remaining = await seed();
      const deleted = await call(`${BASE}/${remaining.id}`, { method: "DELETE", cookie });

      if (write === "ok") {
        expect([marked.status, unmarked.status, deleted.status]).toEqual([200, 200, 204]);
        expect((await auditRows()).map((r) => r.action)).toEqual(["contact_message.read", "contact_message.unread", "contact_message.delete"]);
      } else {
        expect([marked.status, unmarked.status, deleted.status]).toEqual([403, 403, 403]);
        // A refused change changes nothing and leaves no audit row.
        expect(await readAt(target.id)).toBeNull();
        expect(await count("contact_messages")).toBe(2);
        expect(await count("audit_log")).toBe(0);
      }
    });
  }

  test("a refused read says nothing about what is there", async () => {
    await seed();
    const cookie = await signedInCookie(uniqueEmail("elsewhere"), "editor", ["konten"]);
    for (const path of [BASE, `${BASE}/counts`]) {
      const res = await call(path, { cookie });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    }
  });

  test("a message cannot be created or edited here: the public form is the only way in", async () => {
    const cookie = await signedInCookie(uniqueEmail("root"), "super_admin");
    const row = await seed();
    const body = { fullName: "Palsu", email: "palsu@example.test", subject: "other", message: "Pesan buatan admin, tidak boleh ada." };
    expect((await call(BASE, { method: "POST", cookie, json: body })).status).toBe(404);
    expect((await call(`${BASE}/${row.id}`, { method: "PUT", cookie, json: body, headers: { "if-match": '"2026-01-01T00:00:00.000Z"' } })).status).toBe(404);
    expect((await call(`${BASE}/${row.id}`, { method: "PATCH", cookie, json: { readAt: null } })).status).toBe(404);
    expect(await count("contact_messages")).toBe(1);
  });
});

describe("the list: newest first, with a preview, and the legacy read filter", () => {
  test("an envelope, newest first, each row a name, an address, a subject, a preview and its read state", async () => {
    const old = await seed({ createdAt: 1000 });
    const fresh = await seed({ createdAt: 3000, readAt: 3500 });
    const middle = await seed({ createdAt: 2000 });
    const body = await list();
    expect(body.items.map((m) => m.id)).toEqual([fresh.id, middle.id, old.id]);
    expect(body).toMatchObject({ page: 1, pageSize: 20, total: 3 });
    expect(Object.keys(body.items[0]!).sort()).toEqual(["createdAt", "email", "fullName", "id", "preview", "readAt", "subject"]);
    expect(body.items[0]).toMatchObject({ fullName: fresh.fullName, email: fresh.email, subject: "other", readAt: new Date(3500).toISOString(), createdAt: new Date(3000).toISOString() });
    expect(body.items[1]!.readAt).toBeNull();
  });

  test("the list carries a preview of the text, not all of it", async () => {
    const long = `${"a".repeat(PREVIEW_LENGTH)}${"#".repeat(4000)}`;
    await seed({ message: long });
    const [item] = (await list()).items;
    expect(item!.preview).toBe("a".repeat(PREVIEW_LENGTH));
    expect(JSON.stringify(item)).not.toContain("#");
  });

  test("?filter=unread and ?filter=read split the inbox, and `total` follows the filter", async () => {
    const a = await seed({ createdAt: 1000 });
    const b = await seed({ createdAt: 2000, readAt: 2500 });
    const c = await seed({ createdAt: 3000 });
    const d = await seed({ createdAt: 4000, readAt: 4500 });
    const ids = async (query: string) => (await list(query)).items.map((m) => m.id);

    expect(await ids("?filter=unread")).toEqual([c.id, a.id]);
    expect(await ids("?filter=read")).toEqual([d.id, b.id]);
    expect((await list("?filter=unread")).total).toBe(2);
    expect((await list("?filter=read")).total).toBe(2);
    expect(await ids("?filter=")).toEqual([d.id, c.id, b.id, a.id]); // empty means no filter
    expect(await ids("?sort=createdAt")).toEqual([a.id, b.id, c.id, d.id]);
  });

  test("a filter or sort the list does not know is refused, never silently ignored", async () => {
    const cookie = await viewer();
    for (const bad of ["?filter=all", "?filter=UNREAD", "?sort=email", "?sort=-message", "?sort=readAt"]) {
      const res = await call(`${BASE}${bad}`, { cookie });
      expect(res.status, bad).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_query" });
    }
  });

  test("pages: 20 by default, at most 100, and a page past the end is empty with the true total", async () => {
    for (let i = 0; i < 25; i++) await seed({ createdAt: 10_000 + i });
    const first = await list();
    expect(first.items).toHaveLength(20);
    expect(first.total).toBe(25);
    const second = await list("?page=2");
    expect(second.items).toHaveLength(5);
    expect(new Set([...first.items, ...second.items].map((m) => m.id)).size).toBe(25); // pages never overlap
    expect((await list("?pageSize=500")).pageSize).toBe(100);
    const past = await list("?page=9");
    expect(past.items).toEqual([]);
    expect(past.total).toBe(25);
  });

  test("there is no free-text search: the legacy inbox had none, and `q` over the text would read every message", async () => {
    await seed({ message: "kata-unik-xyz di dalam isi pesan" });
    await seed();
    expect((await list("?q=kata-unik-xyz")).items).toHaveLength(2);
  });
});

describe("opening a message does not mark it read (a GET changes nothing)", () => {
  // Negative test (scripts/negative-checks-komunikasi.mjs): make `GET /:id` stamp `read_at` and these fail.
  test("GET /:id returns the whole message and leaves it unread, with no audit row, however often it is asked", async () => {
    const cookie = await editor();
    const row = await seed({ message: `Pesan panjang.\nBaris kedua. ${"x".repeat(300)}` });
    for (let i = 0; i < 3; i++) {
      const res = await call(`${BASE}/${row.id}`, { cookie });
      expect(res.status).toBe(200);
      const { item } = (await res.json()) as { item: Record<string, unknown> };
      expect(item).toEqual({
        id: row.id,
        fullName: row.fullName,
        email: row.email,
        subject: "other",
        message: row.message,
        readAt: null,
        createdAt: new Date(row.createdAt).toISOString(),
      });
      expect(res.headers.get("etag")).toBeNull(); // no updated_at, so no version
    }
    expect(await readAt(row.id)).toBeNull();
    expect(await count("audit_log")).toBe(0);
  });

  test("neither the list, the counts nor a read of someone else's message mark anything", async () => {
    const cookie = await editor();
    const a = await seed();
    const b = await seed();
    await call(BASE, { cookie });
    await call(`${BASE}?filter=unread`, { cookie });
    await call(`${BASE}/counts`, { cookie });
    await call(`${BASE}/${a.id}`, { cookie });
    expect(await readAt(a.id)).toBeNull();
    expect(await readAt(b.id)).toBeNull();
    expect(await count("audit_log")).toBe(0);
  });

  test("a HEAD or an OPTIONS-style probe of the detail does not either", async () => {
    const cookie = await editor();
    const row = await seed();
    await call(`${BASE}/${row.id}`, { method: "HEAD", cookie });
    expect(await readAt(row.id)).toBeNull();
    expect(await count("audit_log")).toBe(0);
  });

  test("a missing message is a 404, and so is an id that cannot exist (without asking D1)", async () => {
    const cookie = await viewer();
    expect((await call(`${BASE}/${crypto.randomUUID()}`, { cookie })).status).toBe(404);
    const spy = spyOnD1(env.DB);
    const res = await call(`${BASE}/${"x".repeat(129)}`, { cookie, env: { DB: spy.db } });
    expect(res.status).toBe(404);
    expect(spy.touching("contact_messages")).toHaveLength(0);
  });
});

describe("mark read and unread (explicit actions)", () => {
  test("read stamps read_at, answers the message, and writes one audit row: the action and the id, nothing else", async () => {
    const email = uniqueEmail("editor");
    const cookie = await signedInCookie(email, "editor", ["komunikasi"]);
    const row = await seed();
    const before = Date.now();

    const res = await call(`${BASE}/${row.id}/read`, { method: "POST", cookie });
    expect(res.status).toBe(200);
    const { item } = (await res.json()) as { item: { id: string; readAt: string; message: string } };
    expect(item).toMatchObject({ id: row.id, message: row.message });
    const stamped = await readAt(row.id);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(item.readAt).toBe(new Date(stamped!).toISOString());

    expect(await auditRows()).toEqual([{ actor_email: email, action: "contact_message.read", resource_type: "contact_message", resource_id: row.id, metadata: null }]);
  });

  test("read is idempotent: the second call answers the same message, keeps the first stamp and writes no second audit row", async () => {
    const cookie = await editor();
    const row = await seed();
    await call(`${BASE}/${row.id}/read`, { method: "POST", cookie });
    const first = await readAt(row.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const again = await call(`${BASE}/${row.id}/read`, { method: "POST", cookie });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { item: { readAt: string } }).item.readAt).toBe(new Date(first!).toISOString());
    expect(await readAt(row.id)).toBe(first);
    expect((await auditRows()).map((r) => r.action)).toEqual(["contact_message.read"]);
  });

  test("unread clears it, and is idempotent too", async () => {
    const cookie = await editor();
    const row = await seed({ readAt: 1_700_000_100_000 });
    const res = await call(`${BASE}/${row.id}/unread`, { method: "POST", cookie });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { item: { readAt: unknown } }).item.readAt).toBeNull();
    expect(await readAt(row.id)).toBeNull();
    expect((await call(`${BASE}/${row.id}/unread`, { method: "POST", cookie })).status).toBe(200);
    expect((await auditRows()).map((r) => [r.action, r.resource_id])).toEqual([["contact_message.unread", row.id]]);
  });

  test("read then unread then read leaves three rows of history, in order", async () => {
    const cookie = await editor();
    const row = await seed();
    for (const verb of ["read", "unread", "read"]) await call(`${BASE}/${row.id}/${verb}`, { method: "POST", cookie });
    expect((await auditRows()).map((r) => r.action)).toEqual(["contact_message.read", "contact_message.unread", "contact_message.read"]);
    expect(await readAt(row.id)).not.toBeNull();
  });

  test("a message that does not exist: 404, no audit row, nothing created", async () => {
    const cookie = await editor();
    for (const verb of ["read", "unread"]) {
      const res = await call(`${BASE}/${crypto.randomUUID()}/${verb}`, { method: "POST", cookie });
      expect(res.status, verb).toBe(404);
      expect(await res.json()).toMatchObject({ error: "not_found" });
    }
    expect((await call(`${BASE}/${"x".repeat(129)}/read`, { method: "POST", cookie })).status).toBe(404);
    expect(await count("audit_log")).toBe(0);
    expect(await count("contact_messages")).toBe(0);
  });

  test("a mark of one message touches no other", async () => {
    const cookie = await editor();
    const a = await seed();
    const b = await seed();
    await call(`${BASE}/${a.id}/read`, { method: "POST", cookie });
    expect(await readAt(a.id)).not.toBeNull();
    expect(await readAt(b.id)).toBeNull();
  });

  test("a verb that is not allowed on the route is refused: GET on /read does not mark, and the verbs take no PUT", async () => {
    const cookie = await editor();
    const row = await seed();
    expect((await call(`${BASE}/${row.id}/read`, { cookie })).status).toBe(404);
    expect((await call(`${BASE}/${row.id}/read`, { method: "PUT", cookie })).status).toBe(404);
    expect(await readAt(row.id)).toBeNull();
  });
});

describe("delete", () => {
  test("a delete removes the message and writes one audit row without any of its content", async () => {
    const email = uniqueEmail("editor");
    const cookie = await signedInCookie(email, "editor", ["komunikasi"]);
    const row = await seed({ fullName: "Nama Rahasia Pengirim", email: "rahasia.pengirim@example.test", message: "ISI-PESAN-RAHASIA yang tidak boleh masuk jejak audit." });

    const res = await call(`${BASE}/${row.id}`, { method: "DELETE", cookie });
    expect(res.status).toBe(204);
    expect(await count("contact_messages")).toBe(0);

    const audit = await auditRows();
    expect(audit).toEqual([{ actor_email: email, action: "contact_message.delete", resource_type: "contact_message", resource_id: row.id, metadata: null }]);
  });

  test("a delete needs no If-Match (the table has no version) and a second one is a 404", async () => {
    const cookie = await editor();
    const row = await seed();
    expect((await call(`${BASE}/${row.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect((await call(`${BASE}/${row.id}`, { method: "DELETE", cookie })).status).toBe(404);
    expect((await auditRows()).map((r) => r.action)).toEqual(["contact_message.delete"]); // the 404 wrote nothing
  });

  test("a deleted message cannot be marked, and the unread count follows it", async () => {
    const cookie = await editor();
    const row = await seed();
    await seed();
    await call(`${BASE}/${row.id}`, { method: "DELETE", cookie });
    expect((await call(`${BASE}/${row.id}/read`, { method: "POST", cookie })).status).toBe(404);
    expect(await (await call(`${BASE}/counts`, { cookie })).json()).toEqual({ total: 1, unread: 1 });
  });
});

describe("audit rows hold no personal data, whatever was done", () => {
  test("after every kind of change, no audit row contains a name, an address or a word of the text", async () => {
    const cookie = await editor();
    const row = await seed({ fullName: "Budi Pengirim Unik", email: "budi.unik@example.test", message: "KATA-PESAN-UNIK-123 selamat siang kami ingin bekerja sama." });
    await call(`${BASE}/${row.id}/read`, { method: "POST", cookie });
    await call(`${BASE}/${row.id}/unread`, { method: "POST", cookie });
    await call(`${BASE}/${row.id}`, { method: "DELETE", cookie });

    const raw = (await env.DB.prepare("SELECT * FROM audit_log").all()).results;
    expect(raw).toHaveLength(3);
    const text = JSON.stringify(raw);
    for (const secret of ["Budi", "Unik", "budi.unik", "KATA-PESAN", "selamat siang", "bekerja sama"]) expect(text, secret).not.toContain(secret);
    // Every row says what happened and to which id, and its metadata is empty.
    expect(raw.every((r) => (r as { metadata: unknown }).metadata === null)).toBe(true);
  });
});

describe("the counts, and the dashboard's unread number (one definition)", () => {
  test("counts answer the total and the unread, and the unread equals the filter's total", async () => {
    const cookie = await viewer();
    await seed();
    await seed({ readAt: 5000 });
    await seed();
    const counts = (await (await call(`${BASE}/counts`, { cookie })).json()) as { total: number; unread: number };
    expect(counts).toEqual({ total: 3, unread: 2 });
    expect((await list("?filter=unread", cookie)).total).toBe(counts.unread);
    expect((await list("?filter=read", cookie)).total).toBe(counts.total - counts.unread);
    expect((await list("", cookie)).total).toBe(counts.total);
  });

  test("an empty inbox is zeros, not an error", async () => {
    expect(await (await call(`${BASE}/counts`, { cookie: await viewer() })).json()).toEqual({ total: 0, unread: 0 });
  });

  // Negative test (scripts/negative-checks-komunikasi.mjs): change `isUnreadMessage` and the three numbers part ways.
  test("/api/dashboard's unread tile, the counts and the filtered list agree after every kind of change", async () => {
    const cookie = await signedInCookie(uniqueEmail("root"), "super_admin");
    const a = await seed();
    await seed();
    await seed();
    await seed({ readAt: 9000 });

    const unreadEverywhere = async () => {
      const tile = ((await (await call("/api/dashboard", { cookie })).json()) as { attention: { unreadMessages?: { count: number } } }).attention.unreadMessages?.count;
      const counts = ((await (await call(`${BASE}/counts`, { cookie })).json()) as { unread: number }).unread;
      const filtered = (await list("?filter=unread", cookie)).total;
      return [tile, counts, filtered];
    };

    expect(await unreadEverywhere()).toEqual([3, 3, 3]);
    await call(`${BASE}/${a.id}/read`, { method: "POST", cookie });
    expect(await unreadEverywhere()).toEqual([2, 2, 2]);
    await call(`${BASE}/${a.id}/unread`, { method: "POST", cookie });
    expect(await unreadEverywhere()).toEqual([3, 3, 3]);
    await call(`${BASE}/${a.id}`, { method: "DELETE", cookie });
    expect(await unreadEverywhere()).toEqual([2, 2, 2]);
    // Opening one (a GET) changes none of them.
    const next = (await list("?filter=unread", cookie)).items[0]!;
    await call(`${BASE}/${next.id}`, { cookie });
    expect(await unreadEverywhere()).toEqual([2, 2, 2]);
  });
});

describe("D1 budget and plans (docs/cloudflare/admin-crud.md#12-d1-budget-rules)", () => {
  async function trips(run: (cookie: string, bindings: { DB: D1Database }) => Promise<Response>, role: "viewer" | "editor" = "editor") {
    const cookie = role === "viewer" ? await viewer() : await editor();
    const spy = spyOnD1(env.DB);
    const res = await run(cookie, { DB: spy.db });
    const events = spy.events.filter((event) => event.sql.some((sql) => sql.includes("contact_messages") || sql.includes("audit_log")));
    return { res, events };
  }
  const shape = (events: { kind: string; sql: string[] }[]) => events.map((event) => [event.kind, event.sql.length]);

  test("the list is one round trip of two statements; the counts one of two; one message one statement", async () => {
    const row = await seed();
    const listing = await trips((cookie, bindings) => call(BASE, { cookie, env: bindings }), "viewer");
    expect(listing.res.status).toBe(200);
    expect(shape(listing.events)).toEqual([["batch", 2]]);

    const counts = await trips((cookie, bindings) => call(`${BASE}/counts`, { cookie, env: bindings }), "viewer");
    expect(counts.res.status).toBe(200);
    expect(shape(counts.events)).toEqual([["batch", 2]]);

    const one = await trips((cookie, bindings) => call(`${BASE}/${row.id}`, { cookie, env: bindings }), "viewer");
    expect(one.res.status).toBe(200);
    expect(shape(one.events)).toEqual([["single", 1]]);
  });

  test("marking a message that changes is one round trip of two statements (the update and its audit row); asking again adds a read, no write", async () => {
    const row = await seed();
    const first = await trips((cookie, bindings) => call(`${BASE}/${row.id}/read`, { method: "POST", cookie, env: bindings }));
    expect(first.res.status).toBe(200);
    expect(shape(first.events)).toEqual([["batch", 2]]);

    const again = await trips((cookie, bindings) => call(`${BASE}/${row.id}/read`, { method: "POST", cookie, env: bindings }));
    expect(again.res.status).toBe(200);
    // The batch still runs (its UPDATE matches nothing and its audit row follows `changes()`), then one read for the answer.
    expect(shape(again.events)).toEqual([["batch", 2], ["single", 1]]);
    expect(await count("audit_log")).toBe(1);
  });

  test("a delete is a read, then one round trip of two statements", async () => {
    const row = await seed();
    const { res, events } = await trips((cookie, bindings) => call(`${BASE}/${row.id}`, { method: "DELETE", cookie, env: bindings }));
    expect(res.status).toBe(204);
    expect(shape(events)).toEqual([["single", 1], ["batch", 2]]);
  });

  const plan = async (sql: string, ...params: unknown[]) =>
    (await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>()).results.map((row) => row.detail);

  test("the list walks the created_at index (no sort of the whole table); the unread filter seeks the read_at index", async () => {
    const all = await plan("SELECT * FROM contact_messages ORDER BY created_at DESC, id ASC LIMIT 20 OFFSET 0");
    expect(all[0]).toBe("SCAN contact_messages USING INDEX contact_messages_created_at_idx");
    const unread = await plan("SELECT * FROM contact_messages WHERE read_at IS NULL ORDER BY created_at DESC, id ASC LIMIT 20 OFFSET 0");
    expect(unread[0]).toBe("SEARCH contact_messages USING INDEX contact_messages_read_at_idx (read_at=?)");
    const unreadCount = await plan("SELECT count(*) FROM contact_messages WHERE read_at IS NULL");
    expect(unreadCount).toEqual(["SEARCH contact_messages USING COVERING INDEX contact_messages_read_at_idx (read_at=?)"]);
    // The total counts index entries only: the table itself is not read for it.
    const total = await plan("SELECT count(*) FROM contact_messages");
    expect(total[0]).toMatch(/^SCAN contact_messages USING COVERING INDEX contact_messages_/);
  });

  test("rows read: the page, plus the index entries the count walks, and never the messages' text of the rest", async () => {
    const cookie = await viewer();
    // 120 messages, 40 of them read.
    for (let i = 0; i < 120; i++) await seed({ createdAt: 20_000 + i, readAt: i % 3 === 0 ? 30_000 : null });
    const measure = async (path: string) => {
      const { db, stats } = instrumentD1(env.DB);
      const res = await call(path, { cookie, env: { DB: db } });
      expect(res.status, path).toBe(200);
      const own = stats.statements.filter((sql) => sql.includes("contact_messages"));
      return { rowsRead: stats.rowsRead, statements: own.length };
    };
    // The page is 20 rows (and their index entries); the total is one walk of a covering index, 120 entries.
    // Measured in this setup: list 163, unread filter 244, read filter 125, counts 203.
    const all = await measure(BASE);
    const unread = await measure(`${BASE}?filter=unread`);
    const read = await measure(`${BASE}?filter=read`);
    const counts = await measure(`${BASE}/counts`);
    // The auth lookups of the request (session, user, grants) are in these numbers: about 10 rows.
    expect(all.rowsRead).toBeLessThanOrEqual(120 + 2 * 20 + 25);
    // The unread filter reads every unread message (an index entry and the row, to sort them), so its cost follows the
    // unread backlog and not the history: 80 unread here.
    expect(unread.rowsRead).toBeLessThanOrEqual(3 * 80 + 25);
    expect(read.rowsRead).toBeLessThanOrEqual(120 + 2 * 20 + 25);
    expect(counts.rowsRead).toBeLessThanOrEqual(120 + 80 + 30);
    // A page-size of 100 reads more rows but is still one batch.
    expect((await measure(`${BASE}?pageSize=100`)).statements).toBe(2);
  });
});
