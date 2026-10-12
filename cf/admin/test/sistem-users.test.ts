import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { describe, expect, test } from "vitest";
import { adminListSpec, adminListStatements, emailPrefixRange } from "../src/api/admin-users";
import { parseListQuery } from "../src/api/crud";
import type { GrantableArea } from "../src/auth/permissions";
import type { UserRole } from "../src/auth/roles";
import * as schema from "../src/db/schema";
import { call, cookiesOf, createVerifiedUser, emailsTo, linkIn, PASSWORD, resetTokenIn, signedInCookie, signIn, uniqueEmail } from "./helpers";
import { instrumentD1 } from "./public-helpers";

// Pengaturan, the SPA's view of src/api/admin-users.ts: the list of the CRUD convention, one admin, the whole edit
// form as one `PUT` with `If-Match`, the areas of a new editor, and the flows end to end through the audit log
// (docs/cloudflare/admin-sistem.md). The first endpoints' own behaviour stays in test/admin-users.test.ts and
// test/areas.test.ts, untouched.

const USERS = "/api/admin/users";

interface Item {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  areas: GrantableArea[];
  status: "active" | "invited" | "deactivated";
  emailVerified: boolean;
  deactivatedAt: string | null;
  lastSessionAt: string | null;
  createdAt: string;
  updatedAt: string;
}
interface Listing {
  items: Item[];
  users: Item[];
  page: number;
  pageSize: number;
  total: number;
  error?: string;
  param?: string;
}

async function boss() {
  const email = uniqueEmail("boss");
  const cookie = await signedInCookie(email, "super_admin");
  const id = (await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>())!.id;
  return { email, cookie, id };
}

/** A user row straight into the table, with an email the test chooses. */
async function insertUser(email: string, role: UserRole, extra: { name?: string; deactivated?: boolean; account?: boolean } = {}) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users (id, name, email, email_verified, role, deactivated_at) VALUES (?, ?, ?, 1, ?, ?)")
    .bind(id, extra.name ?? email.split("@")[0], email, role, extra.deactivated ? Date.now() : null)
    .run();
  if (extra.account !== false) {
    await env.DB.prepare("INSERT INTO account (id, account_id, provider_id, user_id, password) VALUES (?, ?, 'credential', ?, 'x')").bind(crypto.randomUUID(), id, id).run();
  }
  return id;
}

async function list(cookie: string, query: Record<string, string | number> = {}) {
  const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)])).toString();
  const res = await call(search ? `${USERS}?${search}` : USERS, { cookie });
  return { res, body: (await res.clone().json()) as Listing };
}

async function one(cookie: string, id: string) {
  const res = await call(`${USERS}/${id}`, { cookie });
  const body = (await res.clone().json()) as { item: Item; error?: string };
  return { res, item: body.item, etag: res.headers.get("etag") };
}

interface Form {
  name?: string;
  role?: string;
  areas?: string[];
}
const put = (cookie: string, id: string, json: unknown, ifMatch?: string | null) =>
  call(`${USERS}/${id}`, { method: "PUT", cookie, json, headers: ifMatch === null ? {} : { "If-Match": ifMatch ?? "" } });

/** Saves a form against the version the admin has now. */
async function save(cookie: string, id: string, form: Form) {
  const { item, etag } = await one(cookie, id);
  const res = await put(cookie, id, { name: item.name, role: item.role, areas: item.areas, ...form }, etag);
  return { res, body: (await res.clone().json()) as { item: Item; error?: string; message?: string; fields?: Record<string, string> }, before: item };
}

async function createAdmin(cookie: string, role: UserRole, extra: Record<string, unknown> = {}) {
  const email = uniqueEmail("admin");
  const res = await call(USERS, { method: "POST", cookie, json: { email, name: "Guru Baru", role, ...extra } });
  const body = (await res.clone().json()) as { item?: Item; user?: Item; error?: string; fields?: Record<string, string>; fieldErrors?: Record<string, string[]>; message?: string };
  return { res, email, body, id: body.item?.id ?? "" };
}

async function auditRows(action?: string) {
  const { results } = await env.DB.prepare(
    `SELECT action, actor_email, resource_type, resource_id, metadata FROM audit_log ${action ? "WHERE action = ?" : ""} ORDER BY created_at, rowid`,
  )
    .bind(...(action ? [action] : []))
    .all<{ action: string; actor_email: string; resource_type: string; resource_id: string; metadata: string | null }>();
  return results.map((row) => ({ ...row, metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null }));
}

async function grantsOf(userId: string) {
  const { results } = await env.DB.prepare("SELECT area, granted_by FROM admin_area_grants WHERE user_id = ? ORDER BY area").bind(userId).all<{ area: string; granted_by: string | null }>();
  return results;
}

const roleOf = async (id: string) => (await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(id).first<{ role: string }>())!.role;

// ───────────────────────────────────────────────────────────────── who may use it

describe("only a super_admin, on every route Pengaturan uses", () => {
  const callers: { label: string; role: UserRole; areas?: GrantableArea[] }[] = [
    { label: "a student", role: "student" },
    { label: "a viewer", role: "viewer" },
    { label: "an editor with no area", role: "editor", areas: [] },
    { label: "an editor with every area", role: "editor", areas: ["pendaftaran", "komunikasi", "konten"] },
  ];

  for (const { label, role, areas } of callers) {
    test(`${label}: 403 on the list, one admin, create, the edit form, patch, areas, deactivate, reactivate and resend, and nothing changes`, async () => {
      const root = await boss();
      const victim = await createAdmin(root.cookie, "editor");
      const { etag } = await one(root.cookie, victim.id);
      const cookie = await signedInCookie(uniqueEmail(role), role === "student" ? undefined : role, areas ?? []);
      const rowsBefore = await auditRows();
      const grantsBefore = await grantsOf(victim.id);

      const responses = await Promise.all([
        call(USERS, { cookie }),
        call(`${USERS}/${victim.id}`, { cookie }),
        call(USERS, { method: "POST", cookie, json: { email: uniqueEmail(), role: "editor", areas: ["konten"] } }),
        put(cookie, victim.id, { name: "X", role: "super_admin", areas: [] }, etag),
        call(`${USERS}/${victim.id}`, { method: "PATCH", cookie, json: { role: "super_admin" } }),
        call(`${USERS}/${victim.id}/areas`, { method: "PUT", cookie, json: { areas: ["pendaftaran"] } }),
        call(`${USERS}/${victim.id}/deactivate`, { method: "POST", cookie, json: {} }),
        call(`${USERS}/${victim.id}/reactivate`, { method: "POST", cookie, json: {} }),
        call(`${USERS}/${victim.id}/resend-invite`, { method: "POST", cookie, json: {} }),
      ]);
      expect(responses.map((res) => res.status)).toEqual([403, 403, 403, 403, 403, 403, 403, 403, 403]);
      expect(await auditRows()).toEqual(rowsBefore);
      expect(await grantsOf(victim.id)).toEqual(grantsBefore);
      expect(await roleOf(victim.id)).toBe("editor");
    });
  }

  test("nobody signed in: 401 on all of them", async () => {
    const statuses = [
      (await call(USERS)).status,
      (await call(`${USERS}/x`)).status,
      (await call(USERS, { method: "POST", json: { email: "a@b.test", role: "viewer" } })).status,
      (await call(`${USERS}/x`, { method: "PUT", json: {}, headers: { "If-Match": '"x"' } })).status,
    ];
    expect(statuses).toEqual([401, 401, 401, 401]);
  });

  test("the guard comes before the version: a refused caller is 403 even without If-Match, never 428", async () => {
    const root = await boss();
    const victim = await createAdmin(root.cookie, "viewer");
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    expect((await put(cookie, victim.id, { name: "X", role: "viewer" }, null)).status).toBe(403);
  });
});

// ───────────────────────────────────────────────────────────────────── the list

describe("the list: the convention's envelope, filters, sort and an email prefix", () => {
  test("the envelope, and what an item says", async () => {
    const root = await boss();
    const editor = await createAdmin(root.cookie, "editor", { areas: ["konten", "pendaftaran"] });
    const { body, res } = await list(root.cookie);
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ page: 1, pageSize: 50, total: 2 });
    expect(body.users).toEqual(body.items); // the first version's key, kept
    expect(Object.keys(body.items[0]!).sort()).toEqual(["areas", "createdAt", "deactivatedAt", "email", "emailVerified", "id", "lastSessionAt", "name", "role", "status", "updatedAt"]);
    expect(body.items.find((item) => item.id === editor.id)).toMatchObject({ email: editor.email, name: "Guru Baru", role: "editor", areas: ["pendaftaran", "konten"], status: "invited", emailVerified: false, deactivatedAt: null });
    expect(body.items.find((item) => item.id === root.id)).toMatchObject({ role: "super_admin", areas: [], status: "active", emailVerified: true });
  });

  test("only admins: a student is never listed, and a viewer's stray grant is not shown as a right", async () => {
    const root = await boss();
    await createVerifiedUser(uniqueEmail("siswa"));
    const viewerId = await createVerifiedUser(uniqueEmail("viewer"), "viewer", ["konten"]);
    const { body } = await list(root.cookie);
    expect(body.total).toBe(2);
    expect(body.items.every((item) => item.role !== ("student" as UserRole))).toBe(true);
    expect(body.items.find((item) => item.id === viewerId)!.areas).toEqual([]);
  });

  test("status: invited until the link is used, active with a way to sign in, deactivated over both", async () => {
    const root = await boss();
    const invited = await createAdmin(root.cookie, "viewer");
    const active = await insertUser(uniqueEmail("active"), "viewer");
    const off = await insertUser(uniqueEmail("off"), "viewer", { deactivated: true });
    const statusOf = async (id: string) => (await list(root.cookie)).body.items.find((item) => item.id === id)!.status;
    expect(await statusOf(invited.id)).toBe("invited");
    expect(await statusOf(active)).toBe("active");
    expect(await statusOf(off)).toBe("deactivated");
    for (const [status, ids] of [["invited", [invited.id]], ["active", [root.id, active]], ["deactivated", [off]]] as const) {
      const { body } = await list(root.cookie, { status });
      expect(body.items.map((item) => item.id).sort(), status).toEqual([...ids].sort());
      expect(body.total).toBe(ids.length);
    }
  });

  test("role filter, sort, page size and a page past the end", async () => {
    const root = await boss();
    const ids: Record<string, string> = {};
    for (const [key, role] of [["a", "viewer"], ["b", "editor"], ["c", "viewer"], ["d", "editor"]] as const) {
      ids[key] = await insertUser(`${key}-${uniqueEmail("x")}`, role);
    }
    const emails = async (query: Record<string, string | number>) => (await list(root.cookie, query)).body.items.map((item) => item.email.slice(0, 1));
    expect(await emails({ role: "editor" })).toEqual(["b", "d"]);
    expect(await emails({ role: "viewer", sort: "-email" })).toEqual(["c", "a"]);
    // By role (the strings sort: editor, super_admin, viewer), equal roles in a fixed order (the id), so pages never overlap.
    const roles = async (sort: string) => (await list(root.cookie, { sort })).body.items.map((item) => item.role);
    expect(await roles("role")).toEqual(["editor", "editor", "super_admin", "viewer", "viewer"]);
    expect(await roles("-role")).toEqual(["viewer", "viewer", "super_admin", "editor", "editor"]);
    const first = (await list(root.cookie, { pageSize: 2 })).body;
    expect(first).toMatchObject({ page: 1, pageSize: 2, total: 5 });
    expect(first.items).toHaveLength(2);
    const third = (await list(root.cookie, { pageSize: 2, page: 3 })).body;
    expect(third.items).toHaveLength(1);
    const beyond = (await list(root.cookie, { pageSize: 2, page: 9 })).body;
    expect(beyond).toMatchObject({ items: [], page: 9, total: 5 });
    // Every page is a different set of people: nobody twice, nobody lost.
    const seen = [...first.items, ...(await list(root.cookie, { pageSize: 2, page: 2 })).body.items, ...third.items].map((item) => item.id);
    expect(new Set(seen).size).toBe(5);
  });

  test("an unknown role, status or sort is refused, never ignored", async () => {
    const root = await boss();
    for (const [query, param] of [[{ role: "student" }, "role"], [{ role: "root" }, "role"], [{ status: "weird" }, "status"], [{ sort: "password" }, "sort"], [{ sort: "-id; drop table users" }, "sort"]] as const) {
      const { res, body } = await list(root.cookie, query);
      expect(res.status, JSON.stringify(query)).toBe(400);
      expect(body).toMatchObject({ error: "invalid_query", param });
    }
  });

  test("q is the beginning of an email address: any case, never a substring, wildcards mean themselves", async () => {
    const root = await boss();
    await insertUser("rommy-satu@example.test", "viewer");
    await insertUser("rommy-dua@example.test", "editor");
    await insertUser("dewi@example.test", "viewer");
    await insertUser("rommy-siswa@example.test", "student"); // never an admin: never found
    const found = async (q: string) => (await list(root.cookie, { q })).body.items.map((item) => item.email);
    expect(await found("rom")).toEqual(["rommy-dua@example.test", "rommy-satu@example.test"]);
    expect(await found("  ROM ")).toEqual(["rommy-dua@example.test", "rommy-satu@example.test"]);
    expect(await found("rommy-satu@example.test")).toEqual(["rommy-satu@example.test"]);
    expect(await found("ommy")).toEqual([]);
    expect(await found("example.test")).toEqual([]);
    expect(await found("%")).toEqual([]);
    expect(await found("_ewi")).toEqual([]);
    expect(await found("rommy-s")).toEqual(["rommy-satu@example.test"]); // not the student
    expect((await found("")).length).toBe(4);
    const filtered = (await list(root.cookie, { q: "rom", role: "editor" })).body;
    expect(filtered.items.map((item) => item.email)).toEqual(["rommy-dua@example.test"]);
    expect(filtered.total).toBe(1);
    expect((await list(root.cookie, { q: "x".repeat(300) })).res.status).toBe(200);
  });

  test("the prefix range: from the prefix up to, not including, the prefix with its last letter one later", () => {
    expect(emailPrefixRange("rom")).toEqual({ from: "rom", to: "ron" });
    expect(emailPrefixRange("  Rom ")).toEqual({ from: "rom", to: "ron" });
    expect(emailPrefixRange("a@b.test")).toEqual({ from: "a@b.test", to: "a@b.tesu" });
    expect(emailPrefixRange("   ")).toBeNull();
    expect(emailPrefixRange("")).toBeNull();
  });
});

describe("last session: the newest session that has not expired, and nothing more", () => {
  test("the start of the newest live session; none after expiry, none after sign-out, none for someone who never signed in", async () => {
    const root = await boss();
    const rootNow = (await one(root.cookie, root.id)).item;
    expect(Date.now() - Date.parse(rootNow.lastSessionAt!)).toBeLessThan(60_000);

    const editorEmail = uniqueEmail("editor");
    const editorId = await createVerifiedUser(editorEmail, "editor");
    expect((await one(root.cookie, editorId)).item.lastSessionAt).toBeNull(); // never signed in
    const signedIn = await signIn(editorEmail);
    expect(signedIn.status).toBe(200);
    const live = (await one(root.cookie, editorId)).item.lastSessionAt;
    expect(Date.now() - Date.parse(live!)).toBeLessThan(60_000);
    expect((await list(root.cookie)).body.items.find((item) => item.id === editorId)!.lastSessionAt).toBe(live);

    await env.DB.prepare("UPDATE session SET expires_at = ? WHERE user_id = ?").bind(Date.now() - 1000, editorId).run(); // expired, not yet cleaned
    expect((await one(root.cookie, editorId)).item.lastSessionAt).toBeNull();

    const again = await signIn(editorEmail);
    await call("/api/auth/sign-out", { method: "POST", cookie: cookiesOf(again), json: {} });
    expect((await one(root.cookie, editorId)).item.lastSessionAt).toBeNull(); // the session is gone with the sign-out
  });
});

describe("the list costs the same however many students there are", () => {
  const db = () => drizzle(env.DB, { schema });
  const queryOf = (q: string, extra: Record<string, string> = {}) => {
    const read = (name: string) => ({ ...extra, ...(q ? { q } : {}) })[name];
    const parsed = parseListQuery({} as Context, adminListSpec, read);
    if (!parsed.ok) throw new Error("query");
    return { query: parsed.query, range: emailPrefixRange(q) };
  };
  const plan = async (statement: { toSQL(): { sql: string; params: unknown[] } }) => {
    const { sql, params } = statement.toSQL();
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>();
    return results.map((row) => row.detail);
  };
  async function seedStudents(n: number) {
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${n})
       INSERT INTO users (id, name, email, email_verified, role) SELECT printf('s%06d', i), 'Siswa', printf('siswa%06d@example.test', i), 1, 'student' FROM n`,
    ).run();
  }
  async function rowsRead(q: string) {
    const counted = instrumentD1(env.DB);
    const { query, range } = queryOf(q);
    await Promise.all(adminListStatements(drizzle(counted.db, { schema }), query, range, Date.now()));
    return counted.stats.rowsRead;
  }

  test("the page and the count read admin rows only: 20 students and 3,000 students give the same reads, with and without a prefix", async () => {
    for (const email of ["siswa-admin@example.test", "dewi@example.test", "rommy@example.test"]) await insertUser(email, "editor");
    await seedStudents(20);
    const small = [await rowsRead(""), await rowsRead("siswa"), await rowsRead("rom")];
    await env.DB.prepare("DELETE FROM users WHERE role = 'student'").run();
    await seedStudents(3000);
    const large = [await rowsRead(""), await rowsRead("siswa"), await rowsRead("rom")];
    expect(large).toEqual(small);
    expect(Math.max(...large)).toBeLessThan(60);
  });

  test("the plans, in words: the role index for the page and the count; no scan of the users table", async () => {
    await seedStudents(50);
    const { query, range } = queryOf("rom");
    for (const statement of adminListStatements(db(), query, range, Date.now())) {
      const lines = (await plan(statement)).join("\n");
      expect(lines).toMatch(/SEARCH users USING (COVERING )?INDEX (users_role_idx|users_email_unique)/);
      expect(lines).not.toMatch(/SCAN users(?! USING)/);
    }
  });
});

// ──────────────────────────────────────────────────────────────── one admin

describe("one admin", () => {
  test("the item with an ETag that is its updatedAt in quotes", async () => {
    const root = await boss();
    const { res, item, etag } = await one(root.cookie, root.id);
    expect(res.status).toBe(200);
    expect(etag).toBe(`"${item.updatedAt}"`);
    expect(item).toMatchObject({ id: root.id, email: root.email, role: "super_admin", status: "active" });
  });

  test("404 for an id that does not exist, for a student, and for an id too long to be one (the last without a read of D1)", async () => {
    const root = await boss();
    const studentId = await createVerifiedUser(uniqueEmail("siswa"));
    expect((await one(root.cookie, "no-such-id")).res.status).toBe(404);
    expect((await one(root.cookie, studentId)).res.status).toBe(404);
    const counted = instrumentD1(env.DB);
    const res = await call(`${USERS}/${"x".repeat(129)}`, { cookie: root.cookie, env: { DB: counted.db } });
    expect(res.status).toBe(404);
    // The guard reads the session; the admin's own read joins the grants, and that is the one that must not happen.
    expect(counted.stats.statements.filter((sql) => /admin_area_grants/.test(sql))).toEqual([]);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });
});

// ───────────────────────────────────────────────────────────────── the edit form

describe("PUT /:id: name, role and areas as one change, guarded by If-Match", () => {
  test("a viewer made an editor with two areas: one answer, the areas sorted, who granted them, one audit row, a new version", async () => {
    const root = await boss();
    const viewer = await createAdmin(root.cookie, "viewer");
    const before = (await one(root.cookie, viewer.id)).item;
    const { res, body } = await save(root.cookie, viewer.id, { role: "editor", areas: ["konten", "komunikasi"] });
    expect(res.status).toBe(200);
    expect(body.item).toMatchObject({ id: viewer.id, role: "editor", areas: ["komunikasi", "konten"], name: "Guru Baru" });
    expect(body.item.updatedAt > before.updatedAt).toBe(true);
    expect(res.headers.get("etag")).toBe(`"${body.item.updatedAt}"`);
    expect(await grantsOf(viewer.id)).toEqual([{ area: "komunikasi", granted_by: root.id }, { area: "konten", granted_by: root.id }]);
    const rows = await auditRows("admin.update");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_email: root.email, resource_type: "admin_user", resource_id: viewer.id });
    expect(rows[0]!.metadata).toEqual({ email: viewer.email, roleFrom: "viewer", roleTo: "editor", areasBefore: [], areasAfter: ["komunikasi", "konten"] });
    // What the answer says is what a fresh read says.
    expect((await one(root.cookie, viewer.id)).item).toEqual(body.item);
  });

  test("an editor made a viewer: the areas go in the same transaction, and the audit row says what they were", async () => {
    const root = await boss();
    const editor = await createAdmin(root.cookie, "editor", { areas: ["pendaftaran", "konten"] });
    const { res, body } = await save(root.cookie, editor.id, { role: "viewer", areas: [] });
    expect(res.status).toBe(200);
    expect(body.item).toMatchObject({ role: "viewer", areas: [] });
    expect(await grantsOf(editor.id)).toEqual([]);
    expect((await auditRows("admin.update"))[0]!.metadata).toEqual({ email: editor.email, roleFrom: "editor", roleTo: "viewer", areasBefore: ["pendaftaran", "konten"], areasAfter: [] });
  });

  test("a viewer's stray grant is cleared when they are made an editor: the areas are exactly the ones asked for", async () => {
    const root = await boss();
    const viewerId = await createVerifiedUser(uniqueEmail("viewer"), "viewer", ["pendaftaran"]);
    const { res, body } = await save(root.cookie, viewerId, { role: "editor", areas: ["konten"] });
    expect(res.status).toBe(200);
    expect(body.item.areas).toEqual(["konten"]);
    expect((await grantsOf(viewerId)).map((row) => row.area)).toEqual(["konten"]);
  });

  test("areas: keep what stays (and who granted it), add what is new, remove what is gone; a change of areas alone", async () => {
    const root = await boss();
    const editor = await createAdmin(root.cookie, "editor", { areas: ["komunikasi", "konten"] });
    const other = await boss();
    await env.DB.prepare("UPDATE admin_area_grants SET granted_by = ? WHERE user_id = ? AND area = 'konten'").bind(other.id, editor.id).run();
    const { res } = await save(root.cookie, editor.id, { areas: ["konten", "pendaftaran"] });
    expect(res.status).toBe(200);
    expect(await grantsOf(editor.id)).toEqual([{ area: "konten", granted_by: other.id }, { area: "pendaftaran", granted_by: root.id }]);
    expect((await auditRows("admin.update"))[0]!.metadata).toEqual({ email: editor.email, areasBefore: ["komunikasi", "konten"], areasAfter: ["pendaftaran", "konten"] });
  });

  test("the name alone: no grant touched, the audit row says only that the name changed", async () => {
    const root = await boss();
    const editor = await createAdmin(root.cookie, "editor", { areas: ["konten"] });
    const grants = await grantsOf(editor.id);
    const { res, body } = await save(root.cookie, editor.id, { name: "  Ibu Guru  " });
    expect(res.status).toBe(200);
    expect(body.item.name).toBe("Ibu Guru");
    expect(await grantsOf(editor.id)).toEqual(grants);
    expect((await auditRows("admin.update"))[0]!.metadata).toEqual({ email: editor.email, nameChanged: true });
  });

  test("a save that changes nothing is a 200 with the same version, and writes nothing", async () => {
    const root = await boss();
    const editor = await createAdmin(root.cookie, "editor", { areas: ["konten"] });
    const { item, etag } = await one(root.cookie, editor.id);
    const res = await put(root.cookie, editor.id, { name: item.name, role: "editor", areas: ["konten"] }, etag);
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe(etag);
    expect(((await res.json()) as { item: Item }).item).toEqual(item);
    expect(await auditRows("admin.update")).toEqual([]);
    // A viewer saved with areas ticked that mean nothing for them: the same.
    const viewer = await createAdmin(root.cookie, "viewer");
    const v = (await one(root.cookie, viewer.id)).item;
    expect((await put(root.cookie, viewer.id, { name: v.name, role: "viewer", areas: [] }, `"${v.updatedAt}"`)).status).toBe(200);
    expect(await auditRows("admin.update")).toEqual([]);
  });

  test("428 without If-Match, and nothing is read or changed", async () => {
    const root = await boss();
    const viewer = await createAdmin(root.cookie, "viewer");
    const res = await put(root.cookie, viewer.id, { name: "X", role: "editor", areas: ["konten"] }, null);
    expect(res.status).toBe(428);
    expect(await res.json()).toMatchObject({ error: "precondition_required" });
    expect(await roleOf(viewer.id)).toBe("viewer");
    expect(await grantsOf(viewer.id)).toEqual([]);
  });

  test("409 stale for the version before someone else's save, and for a header that is not a version: no grant, no role, no audit row", async () => {
    const root = await boss();
    const editor = await createAdmin(root.cookie, "editor", { areas: ["konten"] });
    const first = (await one(root.cookie, editor.id)).etag;
    expect((await save(root.cookie, editor.id, { areas: ["konten", "komunikasi"] })).res.status).toBe(200);
    const rowsBefore = await auditRows();
    for (const header of [first!, '"nonsense"', "*", '"2020-01-01T00:00:00.000Z"']) {
      const res = await put(root.cookie, editor.id, { name: "Guru Baru", role: "viewer", areas: [] }, header);
      expect(res.status, header).toBe(409);
      expect(await res.json()).toMatchObject({ error: "stale" });
    }
    expect(await roleOf(editor.id)).toBe("editor");
    expect((await grantsOf(editor.id)).map((row) => row.area)).toEqual(["komunikasi", "konten"]);
    expect(await auditRows()).toEqual(rowsBefore);
  });

  test("two saves of the same version at once: one wins, the other is stale, and the grants are exactly the winner's", async () => {
    const root = await boss();
    const editor = await createAdmin(root.cookie, "editor", { areas: ["konten"] });
    const { item, etag } = await one(root.cookie, editor.id);
    const results = await Promise.all([
      put(root.cookie, editor.id, { name: item.name, role: "editor", areas: ["komunikasi"] }, etag),
      put(root.cookie, editor.id, { name: item.name, role: "editor", areas: ["pendaftaran", "komunikasi"] }, etag),
      put(root.cookie, editor.id, { name: item.name, role: "viewer", areas: [] }, etag),
    ]);
    const statuses = results.map((res) => res.status).sort();
    expect(statuses).toEqual([200, 409, 409]);
    const winner = ((await results.find((res) => res.status === 200)!.json()) as { item: Item }).item;
    const now = (await one(root.cookie, editor.id)).item;
    expect(now).toEqual(winner);
    expect((await grantsOf(editor.id)).map((row) => row.area)).toEqual(winner.areas.slice().sort());
    expect(await roleOf(editor.id)).toBe(winner.role);
    expect(await auditRows("admin.update")).toHaveLength(1);
  });

  test("what is wrong with the form is said per field, in Indonesian, before anything changes", async () => {
    const root = await boss();
    const editor = await createAdmin(root.cookie, "editor", { areas: ["konten"] });
    const { etag } = await one(root.cookie, editor.id);
    const bad = async (form: unknown) => {
      const res = await put(root.cookie, editor.id, form, etag);
      expect(res.status, JSON.stringify(form)).toBe(400);
      return (await res.json()) as { error: string; message: string; fields: Record<string, string> };
    };
    expect(await bad({ name: "", role: "editor", areas: [] })).toMatchObject({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { name: "Nama wajib diisi" } });
    expect((await bad({ name: "x".repeat(121), role: "editor" })).fields.name).toBe("Maksimal 120 karakter");
    expect((await bad({ name: "A", role: "student" })).fields.role).toBe("Peran tidak dikenal");
    expect((await bad({ name: "A", role: "root" })).fields.role).toBe("Peran tidak dikenal");
    expect((await bad({ name: "A", role: "editor", areas: ["sistem"] })).fields.areas).toBe("Area tidak dikenal");
    expect((await bad({ name: "A", role: "editor", areas: ["konten", "sistem", "x", "y"] })).fields.areas).toBeTruthy();
    expect((await bad({ name: "A", role: "viewer", areas: ["konten"] })).fields.areas).toBe("Area hanya untuk peran Editor.");
    expect((await bad({ name: "A", role: "super_admin", areas: ["konten"] })).fields.areas).toBe("Area hanya untuk peran Editor.");
    expect((await bad({ role: "editor" })).fields.name).toBeTruthy();
    expect(await roleOf(editor.id)).toBe("editor");
    expect(await auditRows("admin.update")).toEqual([]);
  });

  test("the body must be JSON and small: 415 and 413, as everywhere else", async () => {
    const root = await boss();
    const editor = await createAdmin(root.cookie, "editor");
    const { etag } = await one(root.cookie, editor.id);
    const text = await call(`${USERS}/${editor.id}`, { method: "PUT", cookie: root.cookie, body: "name=x", headers: { "content-type": "text/plain", "If-Match": etag! } });
    expect(text.status).toBe(415);
    const big = await put(root.cookie, editor.id, { name: "x".repeat(9000), role: "editor" }, etag);
    expect(big.status).toBe(413);
    const broken = await call(`${USERS}/${editor.id}`, { method: "PUT", cookie: root.cookie, body: "{nope", headers: { "content-type": "application/json", "If-Match": etag! } });
    expect(broken.status).toBe(400);
    expect(await broken.json()).toMatchObject({ error: "invalid_json" });
  });

  test("404 for an unknown id and for a student: the form cannot promote someone who is not an admin", async () => {
    const root = await boss();
    const studentId = await createVerifiedUser(uniqueEmail("siswa"));
    for (const id of ["no-such-id", studentId]) {
      const res = await put(root.cookie, id, { name: "A", role: "super_admin", areas: [] }, '"2026-01-01T00:00:00.000Z"');
      expect(res.status, id).toBe(404);
    }
    expect(await roleOf(studentId)).toBe("student");
  });
});

// ───────────────────────────────────────────────────── the last super_admin, over HTTP

describe("the last active super_admin, through the HTTP layer", () => {
  const LEGACY = "Tidak dapat menurunkan peran super admin terakhir. Tambah super admin lain terlebih dahulu.";

  test("the only one cannot step down through the edit form: 409 with the message and the role field, and nothing changes", async () => {
    const root = await boss();
    const { res, body, before } = await save(root.cookie, root.id, { role: "editor", areas: ["konten"] });
    expect(res.status).toBe(409);
    expect(body).toEqual({ error: "last_super_admin", message: LEGACY, fields: { role: "Minimal satu super admin harus tersedia" } });
    const after = (await one(root.cookie, root.id)).item;
    expect(after).toEqual(before);
    expect(await grantsOf(root.id)).toEqual([]);
    expect(await auditRows("admin.update")).toEqual([]);
  });

  test("with a second active super_admin the same save works, and then the remaining one is the last", async () => {
    const root = await boss();
    const second = await createAdmin(root.cookie, "super_admin");
    expect((await save(root.cookie, root.id, { role: "viewer", areas: [] })).res.status).toBe(200);
    // root is now a viewer: their session still works (a viewer reads), but the second one is the last super_admin.
    const secondCookie = await (async () => {
      await env.DB.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").bind(second.id).run();
      const token = resetTokenIn(emailsTo(second.email)[0]!);
      await call("/api/auth/reset-password", { method: "POST", json: { token, newPassword: PASSWORD } });
      return cookiesOf(await signIn(second.email));
    })();
    const { res, body } = await save(secondCookie, second.id, { role: "editor" });
    expect(res.status).toBe(409);
    expect(body.error).toBe("last_super_admin");
  });

  test("two super_admins stepping down at the same moment through the form: one wins, the other is told it is the last", async () => {
    const first = await boss();
    const secondEmail = uniqueEmail("boss2");
    const secondCookie = await signedInCookie(secondEmail, "super_admin");
    const secondId = (await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(secondEmail).first<{ id: string }>())!.id;
    const a = await one(first.cookie, first.id);
    const b = await one(first.cookie, secondId);
    const results = await Promise.all([
      put(first.cookie, first.id, { name: a.item.name, role: "viewer", areas: [] }, a.etag),
      put(secondCookie, secondId, { name: b.item.name, role: "viewer", areas: [] }, b.etag),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(await (results.find((res) => res.status === 409)!).json()).toMatchObject({ error: "last_super_admin" });
    const active = await env.DB.prepare("SELECT count(*) AS n FROM users WHERE role = 'super_admin' AND deactivated_at IS NULL").first<{ n: number }>();
    expect(active!.n).toBe(1);
    expect(await auditRows("admin.update")).toHaveLength(1); // the refused one left no audit row
  });

  test("nobody deactivates themselves, whatever else is true", async () => {
    const root = await boss();
    await createAdmin(root.cookie, "super_admin");
    const res = await call(`${USERS}/${root.id}/deactivate`, { method: "POST", cookie: root.cookie, json: {} });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "cannot_deactivate_self", message: "Tidak dapat menonaktifkan akun sendiri." });
  });
});

// ─────────────────────────────────────────────────────────────── create with areas

describe("POST: the areas of a new editor commit with the account", () => {
  test("an editor with areas: the account, the grants and one audit row (with the areas) in one transaction", async () => {
    const root = await boss();
    const created = await createAdmin(root.cookie, "editor", { areas: ["konten", "pendaftaran", "konten"] });
    expect(created.res.status).toBe(201);
    expect(created.body.item).toMatchObject({ role: "editor", areas: ["pendaftaran", "konten"], status: "invited" });
    expect(created.body.user).toEqual(created.body.item); // the first version's key, kept
    expect(await grantsOf(created.id)).toEqual([{ area: "konten", granted_by: root.id }, { area: "pendaftaran", granted_by: root.id }]);
    expect((await auditRows("admin.create"))[0]!.metadata).toEqual({ email: created.email, role: "editor", mode: "invite", areasAfter: ["pendaftaran", "konten"] });
  });

  test("an editor without areas, and a viewer or super_admin with none, are as before", async () => {
    const root = await boss();
    expect((await createAdmin(root.cookie, "editor")).body.item!.areas).toEqual([]);
    const viewer = await createAdmin(root.cookie, "viewer", { areas: [] });
    expect(viewer.res.status).toBe(201);
    expect((await auditRows("admin.create")).at(-1)!.metadata).toEqual({ email: viewer.email, role: "viewer", mode: "invite" });
  });

  test("areas for a viewer or a super_admin, or the area `sistem`, are refused before anything is created", async () => {
    const root = await boss();
    const before = await env.DB.prepare("SELECT count(*) AS n FROM users").first<{ n: number }>();
    for (const [role, areas, message] of [["viewer", ["konten"], "Area hanya untuk peran Editor."], ["super_admin", ["konten"], "Area hanya untuk peran Editor."], ["editor", ["sistem"], "Area tidak dikenal"]] as const) {
      const created = await createAdmin(root.cookie, role, { areas });
      expect(created.res.status, `${role} ${areas}`).toBe(400);
      expect(created.body.fields?.areas).toBe(message);
      expect(created.body.fieldErrors?.areas).toEqual([message]);
    }
    expect(await env.DB.prepare("SELECT count(*) AS n FROM users").first<{ n: number }>()).toEqual(before);
    expect(await auditRows("admin.create")).toEqual([]);
  });

  test("the first version's 400 and 409 keep their `fieldErrors` and now also say `message` and `fields`", async () => {
    const root = await boss();
    const bad = await call(USERS, { method: "POST", cookie: root.cookie, json: { email: "not an email", role: "editor" } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { email: "Format email tidak valid" }, fieldErrors: { email: ["Format email tidak valid"] } });
    const first = await createAdmin(root.cookie, "viewer");
    const again = await call(USERS, { method: "POST", cookie: root.cookie, json: { email: first.email, role: "viewer" } });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "email_taken", message: "Email ini sudah terdaftar.", fields: { email: "Email sudah digunakan" }, fieldErrors: { email: ["Email sudah digunakan"] } });
  });
});

// ───────────────────────────────────────────────────────── grants take effect at once

describe("a grant or a revoke applies to the next request of the person it concerns", () => {
  const announcements = (cookie: string) => call("/api/admin/announcements", { cookie });

  test("revoking komunikasi through the form: the editor's very next read is 403; granting it back: 200", async () => {
    const root = await boss();
    const editorEmail = uniqueEmail("editor");
    const editorId = await createVerifiedUser(editorEmail, "editor", ["komunikasi", "konten"]);
    const editorCookie = cookiesOf(await signIn(editorEmail));
    expect((await announcements(editorCookie)).status).toBe(200);

    expect((await save(root.cookie, editorId, { areas: ["konten"] })).res.status).toBe(200);
    expect((await announcements(editorCookie)).status).toBe(403);
    const me = (await (await call("/api/me", { cookie: editorCookie })).json()) as { areas: { granted: string[]; visible: string[]; writable: string[] } };
    expect(me.areas).toEqual({ granted: ["konten"], visible: ["konten"], writable: ["konten"] });

    expect((await save(root.cookie, editorId, { areas: ["konten", "komunikasi"] })).res.status).toBe(200);
    expect((await announcements(editorCookie)).status).toBe(200);
  });

  test("a demotion to viewer: reading stays, writing stops, on the next request", async () => {
    const root = await boss();
    const editorEmail = uniqueEmail("editor");
    const editorId = await createVerifiedUser(editorEmail, "editor", ["komunikasi"]);
    const editorCookie = cookiesOf(await signIn(editorEmail));
    const draft = { title: "Judul pengumuman", body: "Isi pengumuman", severity: "info", active: false };
    expect((await call("/api/admin/announcements", { method: "POST", cookie: editorCookie, json: draft })).status).toBe(201);
    expect((await save(root.cookie, editorId, { role: "viewer", areas: [] })).res.status).toBe(200);
    expect((await announcements(editorCookie)).status).toBe(200);
    expect((await call("/api/admin/announcements", { method: "POST", cookie: editorCookie, json: draft })).status).toBe(403);
  });

  test("a promotion to super_admin opens Sistem at once, and Aktivitas with it", async () => {
    const root = await boss();
    const editorEmail = uniqueEmail("editor");
    const editorId = await createVerifiedUser(editorEmail, "editor", ["konten"]);
    const editorCookie = cookiesOf(await signIn(editorEmail));
    expect((await call("/api/admin/audit", { cookie: editorCookie })).status).toBe(403);
    expect((await save(root.cookie, editorId, { role: "super_admin", areas: [] })).res.status).toBe(200);
    expect((await call("/api/admin/audit", { cookie: editorCookie })).status).toBe(200);
    expect((await call(USERS, { cookie: editorCookie })).status).toBe(200);
  });

  test("a deactivation: the next request is 401 and the sign-in is refused; a reactivation lets them sign in again", async () => {
    const root = await boss();
    const email = uniqueEmail("editor");
    const id = await createVerifiedUser(email, "editor", ["komunikasi"]);
    const cookie = cookiesOf(await signIn(email));
    expect((await announcements(cookie)).status).toBe(200);
    expect((await call(`${USERS}/${id}/deactivate`, { method: "POST", cookie: root.cookie, json: {} })).status).toBe(200);
    expect((await announcements(cookie)).status).toBe(401);
    expect((await signIn(email)).status).toBe(403);
    expect((await call(`${USERS}/${id}/reactivate`, { method: "POST", cookie: root.cookie, json: {} })).status).toBe(200);
    expect((await signIn(email)).status).toBe(200);
  });
});

// ───────────────────────────────────────────────── the flows, end to end, through Aktivitas

describe("every Pengaturan change appears in Aktivitas, as the super_admin who made it, without a password or a link", () => {
  test("create with a password and areas, edit, deactivate, reactivate, invite, resend: the rows, newest first, with only the allowed details", async () => {
    const root = await boss();
    const password = "Kata Sandi Awal 12345";
    const withPassword = await createAdmin(root.cookie, "editor", { password, areas: ["komunikasi"] });
    expect(withPassword.res.status).toBe(201);
    const invited = await createAdmin(root.cookie, "viewer");
    expect(invited.res.status).toBe(201);
    expect((await save(root.cookie, withPassword.id, { role: "editor", areas: ["konten"], name: "Guru Terdaftar" })).res.status).toBe(200);
    expect((await call(`${USERS}/${withPassword.id}/deactivate`, { method: "POST", cookie: root.cookie, json: {} })).status).toBe(200);
    expect((await call(`${USERS}/${withPassword.id}/reactivate`, { method: "POST", cookie: root.cookie, json: {} })).status).toBe(200);
    expect((await call(`${USERS}/${invited.id}/resend-invite`, { method: "POST", cookie: root.cookie, json: {} })).status).toBe(200);

    const res = await call("/api/admin/audit", { cookie: root.cookie });
    const text = await res.text();
    // Never the password the super_admin typed, never a link or a token, never the hash.
    expect(text).not.toContain(password);
    expect(text).not.toMatch(/reset-password|verify-email|token|"password":/i);
    const { items } = JSON.parse(text) as { items: { action: string; actorEmail: string; actorName: string | null; resourceType: string; resourceId: string; createdAt: string; details: Record<string, unknown> }[] };
    expect(items.map((item) => item.action).sort()).toEqual(["admin.create", "admin.create", "admin.deactivate", "admin.invite_resend", "admin.reactivate", "admin.update"]);
    expect(items.every((item) => item.actorEmail === root.email && item.resourceType === "admin_user")).toBe(true);
    // Newest first.
    const times = items.map((item) => item.createdAt);
    expect(times).toEqual([...times].sort().reverse());

    const of = (action: string, id: string) => items.find((item) => item.action === action && item.resourceId === id)!;
    expect(of("admin.create", withPassword.id).details).toEqual({ email: withPassword.email, role: "editor", mode: "password", areasAfter: ["komunikasi"] });
    expect(of("admin.create", invited.id).details).toEqual({ email: invited.email, role: "viewer", mode: "invite" });
    expect(of("admin.update", withPassword.id).details).toEqual({ email: withPassword.email, nameChanged: true, areasBefore: ["komunikasi"], areasAfter: ["konten"] });
    expect(of("admin.deactivate", withPassword.id).details).toEqual({ email: withPassword.email, role: "editor" });
    expect(of("admin.reactivate", withPassword.id).details).toEqual({ email: withPassword.email, role: "editor" });
    expect(of("admin.invite_resend", invited.id).details).toEqual({ email: invited.email, role: "viewer" });
  });

  test("the whole life of an invited editor: invited with an area, accepts, works, loses the area, is deactivated, comes back", async () => {
    const root = await boss();
    const created = await createAdmin(root.cookie, "editor", { areas: ["komunikasi"] });
    const message = emailsTo(created.email)[0]!;
    const landing = await call(linkIn(message));
    expect(landing.status).toBe(302);
    const token = resetTokenIn(message);
    expect((await call("/api/auth/reset-password", { method: "POST", json: { token, newPassword: "kata sandi pilihan sendiri" } })).status).toBe(200);
    const cookie = cookiesOf(await signIn(created.email, "kata sandi pilihan sendiri"));
    expect((await (await call(USERS, { cookie: root.cookie })).json() as Listing).items.find((item) => item.id === created.id)).toMatchObject({ status: "active", emailVerified: true, areas: ["komunikasi"] });
    expect((await call("/api/admin/announcements", { cookie })).status).toBe(200);

    expect((await save(root.cookie, created.id, { areas: [] })).res.status).toBe(200);
    expect((await call("/api/admin/announcements", { cookie })).status).toBe(403);
    expect((await call(`${USERS}/${created.id}/resend-invite`, { method: "POST", cookie: root.cookie, json: {} })).status).toBe(409); // accepted: nothing to resend
    expect((await call(`${USERS}/${created.id}/deactivate`, { method: "POST", cookie: root.cookie, json: {} })).status).toBe(200);
    expect((await call("/api/me", { cookie })).status).toBe(401);
    // (The password reset is the invitee's own: the auth flow writes it, with them as the actor.)
    expect((await auditRows()).map((row) => row.action)).toEqual(["admin.create", "user.password_reset", "admin.update", "admin.deactivate"]);
  });
});
