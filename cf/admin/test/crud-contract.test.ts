import { env } from "cloudflare:workers";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { booleanFilter, crudRoutes, enumFilter, uploadPath, type CrudDeps } from "../src/api/crud";
import type { UserRole } from "../src/auth/roles";
import type { GrantableArea } from "../src/auth/permissions";
import { createdAt, updatedAt, uuidPk } from "../src/db/schema/_common";
import type { ContentChange } from "../src/public/purge";
import { deleteUploadByPath } from "../src/uploads/store";
import { appAround, ifMatchOf, spyOnD1 } from "./crud-app";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { png, upload, type Uploaded } from "./uploads-helpers";

// The contract of the admin CRUD convention (docs/cloudflare/admin-crud.md), proved on a throwaway
// resource that exists only in this file: its own table, mounted under /api/admin/__example behind the
// same chain as the real Worker (test/crud-app.ts). Nothing here ships. If this file passes, a resource
// built with `crudRoutes` answers like every other resource; the resource-specific rules are tested by
// the resource's own suite (test/announcements.test.ts is the reference).

const BASE = "/api/admin/__example";
const SISTEM = "/api/admin/__sistem";

// ------------------------------------------------------------------ the example resource

const exampleItems = sqliteTable("example_items", {
  id: uuidPk(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["a", "b", "c"] }).notNull().default("a"),
  image: text("image"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  secretNote: text("secret_note"),
  createdBy: text("created_by"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

const input = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 karakter").max(80, "Nama maksimal 80 karakter"),
  kind: z.enum(["a", "b", "c"], { error: "Jenis tidak dikenal" }).default("a"),
  image: uploadPath(["team-photo"])
    .nullish()
    .transform((value) => value || null),
  active: z.boolean().default(true),
  secretNote: z
    .string()
    .max(200, "Catatan maksimal 200 karakter")
    .nullish()
    .transform((value) => value || null),
});

const notified: { change: ContentChange }[] = [];
const removedPaths: string[] = [];
let realUploadCleanup = false;

const deps: CrudDeps = {
  notify: (change) => void notified.push({ change }),
  deleteUpload: (bindings, user, path) => {
    removedPaths.push(path);
    return realUploadCleanup ? deleteUploadByPath(bindings, user, path) : Promise.resolve({ status: "not_found" as const });
  },
};

function exampleRoutes(area: "komunikasi" | "sistem", overrides: { maxBodyBytes?: number; deleteRoute?: boolean } = {}) {
  return crudRoutes(
    {
      area,
      table: exampleItems,
      version: exampleItems.updatedAt,
      audit: { name: "shortlink", type: "shortlink", label: (row) => row.name },
      schema: input,
      toRow: (value, { user, mode }) => ({
        name: value.name,
        kind: value.kind,
        image: value.image,
        active: value.active,
        secretNote: value.secretNote,
        ...(mode === "create" ? { createdBy: user.id } : {}),
      }),
      // An explicit list: `secretNote` and `createdBy` are never in an answer.
      present: (row) => ({ id: row.id, name: row.name, kind: row.kind, image: row.image, active: row.active, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }),
      list: {
        search: [exampleItems.name],
        filters: { kind: enumFilter(exampleItems.kind, ["a", "b", "c"]), active: booleanFilter(exampleItems.active) },
        sorts: { name: exampleItems.name, kind: exampleItems.kind, createdAt: exampleItems.createdAt },
        defaultSort: "name",
      },
      purge: (row) => ({ area: "team" as const, ...(row.kind === "c" ? {} : {}) }),
      uploads: (row) => [row.image],
      unique: { "example_items.name": { field: "name", message: "Nama sudah dipakai" } },
      inUse: { usedBy: ["Contoh anak"] },
      routes: { delete: overrides.deleteRoute ?? true },
      maxBodyBytes: overrides.maxBodyBytes,
    },
    deps,
  );
}

const app = appAround({ [BASE]: exampleRoutes("komunikasi"), [SISTEM]: exampleRoutes("sistem"), "/api/admin/__small": exampleRoutes("komunikasi", { maxBodyBytes: 300, deleteRoute: false }) });

const via = (path: string, init: Parameters<typeof call>[1] = {}) => call(path, { ...init, via: app });

beforeAll(async () => {
  const now = "(cast(unixepoch('subsecond') * 1000 as integer))";
  await env.DB.prepare(
    `CREATE TABLE example_items (id text PRIMARY KEY NOT NULL, name text NOT NULL, kind text NOT NULL DEFAULT 'a', image text, active integer NOT NULL DEFAULT 1, secret_note text, created_by text, created_at integer NOT NULL DEFAULT ${now}, updated_at integer NOT NULL DEFAULT ${now})`,
  ).run();
  await env.DB.prepare("CREATE UNIQUE INDEX example_items_name_idx ON example_items (name)").run();
  await env.DB.prepare("CREATE TABLE example_children (id text PRIMARY KEY NOT NULL, item_id text NOT NULL REFERENCES example_items(id) ON DELETE RESTRICT)").run();
});

afterAll(async () => {
  await env.DB.prepare("DROP TABLE example_children").run();
  await env.DB.prepare("DROP TABLE example_items").run();
});

beforeEach(async () => {
  notified.length = 0;
  removedPaths.length = 0;
  realUploadCleanup = false;
  await env.DB.prepare("DELETE FROM example_children").run();
  await env.DB.prepare("DELETE FROM example_items").run();
});

// ------------------------------------------------------------------------------ helpers

const ifMatch = (id: string) => ifMatchOf("example_items", id);

interface Item {
  id: string;
  name: string;
  kind: string;
  image: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

async function editor() {
  return signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);
}

async function seed(rows: { name: string; kind?: string; active?: boolean; image?: string | null; createdAt?: number }[]) {
  const ids: string[] = [];
  for (const row of rows) {
    const id = crypto.randomUUID();
    ids.push(id);
    await env.DB.prepare("INSERT INTO example_items (id, name, kind, active, image, secret_note, created_at) VALUES (?, ?, ?, ?, ?, 'rahasia-jangan-bocor', ?)")
      .bind(id, row.name, row.kind ?? "a", row.active === false ? 0 : 1, row.image ?? null, row.createdAt ?? Date.now())
      .run();
  }
  return ids;
}

async function list(cookie: string, query = "") {
  const res = await via(`${BASE}${query}`, { cookie });
  return { res, body: (await res.json()) as { items: Item[]; page: number; pageSize: number; total: number; error?: string; param?: string } };
}

async function auditRows() {
  const { results } = await env.DB.prepare("SELECT actor_email, action, resource_type, resource_id, metadata FROM audit_log ORDER BY created_at, rowid").all<{
    actor_email: string;
    action: string;
    resource_type: string;
    resource_id: string;
    metadata: string | null;
  }>();
  return results.map((row) => ({ ...row, metadata: row.metadata ? (JSON.parse(row.metadata) as { fields?: string[]; label?: string }) : null }));
}

async function uploaded(cookie: string, name: string): Promise<Uploaded> {
  const res = await upload({ cookie, kind: "team-photo", filename: name, bytes: png(8, 8) });
  expect(res.status).toBe(201);
  return (await res.json()) as Uploaded;
}

// ------------------------------------------------------------------------------ lists

describe("list: the envelope, clamping, filters, sort, search", () => {
  test("an empty table is a valid, empty envelope", async () => {
    const { res, body } = await list(await editor());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
  });

  test("pages are slices of one ordered list, `total` counts the whole filtered set", async () => {
    const cookie = await editor();
    await seed(Array.from({ length: 25 }, (_, i) => ({ name: `Item ${String(i).padStart(2, "0")}` })));

    const first = await list(cookie);
    expect(first.body).toMatchObject({ page: 1, pageSize: 20, total: 25 });
    expect(first.body.items).toHaveLength(20);
    const second = await list(cookie, "?page=2");
    expect(second.body.items.map((item) => item.name)).toEqual(["Item 20", "Item 21", "Item 22", "Item 23", "Item 24"]);

    // A page past the end is an empty page with the true total, not an error.
    expect((await list(cookie, "?page=9")).body).toEqual({ items: [], page: 9, pageSize: 20, total: 25 });

    const small = await list(cookie, "?pageSize=7&page=2");
    expect(small.body.items.map((item) => item.name)).toEqual(["Item 07", "Item 08", "Item 09", "Item 10", "Item 11", "Item 12", "Item 13"]);
  });

  test("page and pageSize are clamped, never refused", async () => {
    const cookie = await editor();
    await seed([{ name: "Satu" }]);
    expect((await list(cookie, "?pageSize=500")).body).toMatchObject({ pageSize: 100 });
    expect((await list(cookie, "?pageSize=100")).body).toMatchObject({ pageSize: 100 });
    expect((await list(cookie, "?pageSize=0")).body).toMatchObject({ pageSize: 20 });
    expect((await list(cookie, "?pageSize=-5")).body).toMatchObject({ pageSize: 20 });
    expect((await list(cookie, "?pageSize=abc")).body).toMatchObject({ pageSize: 20 });
    expect((await list(cookie, "?page=0")).body).toMatchObject({ page: 1 });
    expect((await list(cookie, "?page=-1")).body).toMatchObject({ page: 1 });
    expect((await list(cookie, "?page=abc")).body).toMatchObject({ page: 1 });
    expect((await list(cookie, "?page=99999999")).res.status).toBe(200);
  });

  test("paging through ties visits every row exactly once (the id is the last sort key)", async () => {
    const cookie = await editor();
    const ids = await seed(Array.from({ length: 12 }, (_, i) => ({ name: `Tie ${i}`, kind: i % 2 ? "a" : "b" })));
    const seen: string[] = [];
    for (const page of [1, 2, 3, 4]) seen.push(...(await list(cookie, `?sort=kind&pageSize=3&page=${page}`)).body.items.map((item) => item.id));
    expect(seen.sort()).toEqual([...ids].sort());
  });

  test("filters: one value, a boolean, both; an unknown value is 400 invalid_query, an empty one is no filter", async () => {
    const cookie = await editor();
    await seed([{ name: "A1", kind: "a" }, { name: "A2", kind: "a", active: false }, { name: "B1", kind: "b" }, { name: "C1", kind: "c", active: false }]);
    const names = async (query: string) => (await list(cookie, query)).body.items.map((item) => item.name);

    expect(await names("?kind=a")).toEqual(["A1", "A2"]);
    expect(await names("?active=false")).toEqual(["A2", "C1"]);
    expect(await names("?kind=a&active=true")).toEqual(["A1"]);
    expect(await names("?kind=&active=")).toEqual(["A1", "A2", "B1", "C1"]);

    for (const [query, param] of [["?kind=z", "kind"], ["?active=1", "active"], ["?kind=a%27%20or%201%3D1", "kind"]] as const) {
      const { res, body } = await list(cookie, query);
      expect(res.status, query).toBe(400);
      expect(body).toMatchObject({ error: "invalid_query", param });
    }
  });

  test("sort: the whitelist, both directions; a name outside it is 400 and never reaches SQL", async () => {
    const cookie = await editor();
    await seed([{ name: "Bb" }, { name: "Aa" }, { name: "Cc" }]);
    const names = async (query: string) => (await list(cookie, query)).body.items.map((item) => item.name);
    expect(await names("")).toEqual(["Aa", "Bb", "Cc"]);
    expect(await names("?sort=-name")).toEqual(["Cc", "Bb", "Aa"]);
    expect(await names("?sort=name")).toEqual(["Aa", "Bb", "Cc"]);
    for (const bad of ["?sort=secretNote", "?sort=secret_note", "?sort=-id", "?sort=name%3B%20drop%20table%20example_items", "?sort=__proto__"]) {
      expect((await list(cookie, bad)).res.status, bad).toBe(400);
    }
    expect(await env.DB.prepare("SELECT count(*) AS n FROM example_items").first<{ n: number }>()).toEqual({ n: 3 });
  });

  test("search: contains, case-insensitive; % and _ are literal; empty and over-long are fine", async () => {
    const cookie = await editor();
    await seed([{ name: "100% jujur" }, { name: "a_b" }, { name: "abc" }, { name: "Pendaftaran Dibuka" }, { name: "wow!" }]);
    const names = async (query: string) => (await list(cookie, query)).body.items.map((item) => item.name);

    expect(await names("?q=pendaftaran")).toEqual(["Pendaftaran Dibuka"]);
    expect(await names("?q=DAFTAR")).toEqual(["Pendaftaran Dibuka"]);
    expect(await names("?q=%25")).toEqual(["100% jujur"]); // "%" matches only a literal percent sign
    expect(await names("?q=a_b")).toEqual(["a_b"]); // "_" is not "any character": "abc" does not match
    expect(await names("?q=!")).toEqual(["wow!"]);
    expect(await names("?q=")).toHaveLength(5);
    expect(await names("?q=%20%20")).toHaveLength(5); // only spaces: no search
    // D1 refuses a LIKE pattern over 50 bytes: a long search is cut, never an error.
    expect((await list(cookie, `?q=${"x".repeat(500)}`)).res.status).toBe(200);
    expect((await list(cookie, `?q=${"%25".repeat(200)}`)).res.status).toBe(200);
    expect((await list(cookie, `?q=${encodeURIComponent("日本語".repeat(40))}`)).res.status).toBe(200);
    expect(await names("?q=jujur&kind=a")).toEqual(["100% jujur"]); // search and filter together
    expect(await names("?q=jujur&kind=b")).toEqual([]);
  });

  test("a list answers only the fields of `present`: no secrets, no author", async () => {
    const cookie = await editor();
    await seed([{ name: "Satu" }]);
    const text = await (await via(BASE, { cookie })).text();
    expect(text).not.toContain("rahasia-jangan-bocor");
    expect(text).not.toContain("secretNote");
    expect(text).not.toContain("createdBy");
    expect(Object.keys((JSON.parse(text) as { items: object[] }).items[0]!).sort()).toEqual(["active", "createdAt", "id", "image", "kind", "name", "updatedAt"]);
  });
});

// ------------------------------------------------------------------------------ one item

describe("one item", () => {
  test("GET /:id answers { item } with its ETag; a missing or absurd id is 404", async () => {
    const cookie = await editor();
    const [id] = await seed([{ name: "Satu" }]);
    const res = await via(`${BASE}/${id}`, { cookie });
    expect(res.status).toBe(200);
    const { item } = (await res.json()) as { item: Item };
    expect(item).toMatchObject({ id, name: "Satu" });
    expect(res.headers.get("etag")).toBe(`"${item.updatedAt}"`);

    expect((await via(`${BASE}/nope`, { cookie })).status).toBe(404);
    expect((await via(`${BASE}/${"x".repeat(129)}`, { cookie })).status).toBe(404);
    expect(await (await via(`${BASE}/nope`, { cookie })).json()).toMatchObject({ error: "not_found", message: expect.any(String) });
  });
});

// ------------------------------------------------------------------------------ create

describe("create", () => {
  test("201 { item } + ETag; the row is stored; one audit row of field names and the label; the purge hook is told", async () => {
    const email = uniqueEmail("editor");
    const cookie = await signedInCookie(email, "editor", ["komunikasi"]);
    const res = await via(BASE, { method: "POST", cookie, json: { name: "  Baru  ", kind: "b", secretNote: "catatan pribadi" } });
    expect(res.status).toBe(201);
    const { item } = (await res.json()) as { item: Item };
    expect(item).toMatchObject({ name: "Baru", kind: "b", active: true, image: null });
    expect(Object.keys(item).sort()).toEqual(["active", "createdAt", "id", "image", "kind", "name", "updatedAt"]);
    expect(res.headers.get("etag")).toBe(`"${item.updatedAt}"`);

    const row = await env.DB.prepare("SELECT secret_note, created_by FROM example_items WHERE id = ?").bind(item.id).first<{ secret_note: string; created_by: string }>();
    expect(row?.secret_note).toBe("catatan pribadi");
    expect(row?.created_by).toBeTruthy();

    expect(await auditRows()).toEqual([
      { actor_email: email, action: "shortlink.create", resource_type: "shortlink", resource_id: item.id, metadata: { fields: ["name", "kind", "image", "active", "secretNote"], label: "Baru" } },
    ]);
    expect(notified).toEqual([{ change: { area: "team" } }]);
  });

  test("the audit row holds field names and a label and never a value from the body", async () => {
    const cookie = await editor();
    await via(BASE, { method: "POST", cookie, json: { name: "Nama Publik", secretNote: "NOMOR-TELEPON-081234" } });
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    const text = JSON.stringify(rows[0]!.metadata);
    expect(text).not.toContain("NOMOR-TELEPON-081234");
    expect(Object.keys(rows[0]!.metadata!).sort()).toEqual(["fields", "label"]);
  });

  test("validation: the one 400 shape, nothing stored, no audit row, no purge", async () => {
    const cookie = await editor();
    const bad = await via(BASE, { method: "POST", cookie, json: { name: "x", kind: "zzz", active: "yes", secretNote: "y".repeat(201) } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({
      error: "invalid",
      message: "Periksa kembali isian formulir.",
      fields: { name: "Nama minimal 2 karakter", kind: "Jenis tidak dikenal", active: "Isian belum benar.", secretNote: "Catatan maksimal 200 karakter" },
    });
    const missing = await via(BASE, { method: "POST", cookie, json: {} });
    expect(await missing.json()).toMatchObject({ fields: { name: "Wajib diisi." } });
    // Unknown keys cannot reach a column.
    const sneaky = await via(BASE, { method: "POST", cookie, json: { name: "Nama", createdBy: "someone-else", id: "chosen-id", updatedAt: 1 } });
    const { item } = (await sneaky.json()) as { item: Item };
    expect(item.id).not.toBe("chosen-id");
    expect((await env.DB.prepare("SELECT created_by FROM example_items WHERE id = ?").bind(item.id).first<{ created_by: string }>())?.created_by).not.toBe("someone-else");

    expect(await env.DB.prepare("SELECT count(*) AS n FROM example_items").first<{ n: number }>()).toEqual({ n: 1 });
    expect(await auditRows()).toHaveLength(1);
    expect(notified).toHaveLength(1);
  });

  test("body problems: 415 for a form post, 400 invalid_json, 413 over the limit", async () => {
    const cookie = await editor();
    const form = await via(BASE, { method: "POST", cookie, headers: { "content-type": "application/x-www-form-urlencoded" }, body: "name=Halo" });
    expect([form.status, ((await form.json()) as { error: string }).error]).toEqual([415, "json_required"]);
    const broken = await via(BASE, { method: "POST", cookie, headers: { "content-type": "application/json" }, body: "{nope" });
    expect([broken.status, ((await broken.json()) as { error: string }).error]).toEqual([400, "invalid_json"]);

    // The resource at __small lowers the limit to 300 bytes.
    const big = await via("/api/admin/__small", { method: "POST", cookie, json: { name: "Nama", secretNote: "z".repeat(400) } });
    expect(big.status).toBe(413);
    expect(await big.json()).toMatchObject({ error: "too_large", maxBytes: 300 });
    expect((await via("/api/admin/__small", { method: "POST", cookie, json: { name: "Nama kecil" } })).status).toBe(201);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM example_items").first<{ n: number }>()).toEqual({ n: 1 });
  });

  test("a unique index is a 409 conflict on its field; nothing is written", async () => {
    const cookie = await editor();
    await seed([{ name: "Sudah Ada" }]);
    const res = await via(BASE, { method: "POST", cookie, json: { name: "Sudah Ada" } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "conflict", message: expect.any(String), fields: { name: "Nama sudah dipakai" } });
    expect(await auditRows()).toEqual([]);
    expect(notified).toEqual([]);
  });

  test("a cross-origin write is refused by the guard of the app, whatever the route", async () => {
    const cookie = await editor();
    const res = await via(BASE, { method: "POST", cookie, json: { name: "Dari luar" }, origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM example_items").first<{ n: number }>()).toEqual({ n: 0 });
  });
});

// ------------------------------------------------------------------------------ update

describe("update", () => {
  test("PUT needs If-Match: 428 without it, 409 stale with an old one, 200 with the current one", async () => {
    const cookie = await editor();
    const [id] = await seed([{ name: "Satu" }]);
    const first = await ifMatch(id!);

    const missing = await via(`${BASE}/${id}`, { method: "PUT", cookie, json: { name: "Dua" } });
    expect([missing.status, ((await missing.json()) as { error: string }).error]).toEqual([428, "precondition_required"]);

    const ok = await via(`${BASE}/${id}`, { method: "PUT", cookie, headers: first, json: { name: "Dua" } });
    expect(ok.status).toBe(200);
    const { item } = (await ok.json()) as { item: Item };
    expect(item.name).toBe("Dua");
    // A new version: a new ETag, later than the old one.
    expect(ok.headers.get("etag")).toBe(`"${item.updatedAt}"`);
    expect(`"${item.updatedAt}"`).not.toBe(first["if-match"]);
    expect(Date.parse(item.updatedAt)).toBeGreaterThan(Date.parse(first["if-match"].slice(1, -1)));

    const late = await via(`${BASE}/${id}`, { method: "PUT", cookie, headers: first, json: { name: "Tiga" } });
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: "stale" });
    expect((await env.DB.prepare("SELECT name FROM example_items WHERE id = ?").bind(id).first<{ name: string }>())?.name).toBe("Dua");

    // The refused saves left nothing behind: one audit row, one purge.
    expect((await auditRows()).map((row) => row.action)).toEqual(["shortlink.update"]);
    expect(notified).toHaveLength(1);
  });

  test("an If-Match that is not one of our ETags can never match", async () => {
    const cookie = await editor();
    const [id] = await seed([{ name: "Satu" }]);
    for (const value of ["*", "abc", '"2020-01-01T00:00:00.000Z"', "", '"not a date"']) {
      const res = await via(`${BASE}/${id}`, { method: "PUT", cookie, headers: { "if-match": value }, json: { name: "Dua" } });
      expect(res.status, value).toBe(409);
    }
    expect((await env.DB.prepare("SELECT name FROM example_items WHERE id = ?").bind(id).first<{ name: string }>())?.name).toBe("Satu");
  });

  test("two saves of the same version: exactly one wins, the loser leaves no audit row and no purge", async () => {
    const cookie = await editor();
    const [id] = await seed([{ name: "Satu" }]);
    const version = await ifMatch(id!);
    const save = (name: string) => via(`${BASE}/${id}`, { method: "PUT", cookie, headers: version, json: { name } });

    const results = await Promise.all([save("Pertama"), save("Kedua"), save("Ketiga")]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409, 409]);
    const winner = results.find((res) => res.status === 200)!;
    const stored = (await env.DB.prepare("SELECT name FROM example_items WHERE id = ?").bind(id).first<{ name: string }>())?.name;
    expect(((await winner.json()) as { item: Item }).item.name).toBe(stored);
    expect(await auditRows()).toHaveLength(1);
    expect(notified).toHaveLength(1);
  });

  test("the audit row of an update names only the fields that changed", async () => {
    const cookie = await editor();
    const [id] = await seed([{ name: "Satu", kind: "a" }]);
    await via(`${BASE}/${id}`, { method: "PUT", cookie, headers: await ifMatch(id!), json: { name: "Satu", kind: "b", secretNote: "baru" } });
    const [row] = await auditRows();
    expect(row).toMatchObject({ action: "shortlink.update", resource_id: id, metadata: { fields: ["kind", "secretNote"], label: "Satu" } });
  });

  test("saving without changing anything writes nothing: same version, no audit row, no purge", async () => {
    const cookie = await editor();
    const [id] = await seed([{ name: "Satu", kind: "a" }]);
    const before = await ifMatch(id!);
    const res = await via(`${BASE}/${id}`, { method: "PUT", cookie, headers: before, json: { name: "Satu", kind: "a", active: true, secretNote: "rahasia-jangan-bocor" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe(before["if-match"]);
    expect(await ifMatch(id!)).toEqual(before);
    expect(await auditRows()).toEqual([]);
    expect(notified).toEqual([]);
  });

  test("a missing row is 404 (after the body and If-Match are checked), a bad form is 400 before the row is read", async () => {
    const cookie = await editor();
    const stamp = { "if-match": '"2026-01-01T00:00:00.000Z"' };
    expect((await via(`${BASE}/ghost`, { method: "PUT", cookie, headers: stamp, json: { name: "Dua" } })).status).toBe(404);

    const [id] = await seed([{ name: "Satu" }]);
    const spy = spyOnD1(env.DB);
    const bad = await via(`${BASE}/${id}`, { method: "PUT", cookie, headers: stamp, json: { name: "x" }, env: { DB: spy.db } });
    expect(bad.status).toBe(400);
    expect(spy.touching("example_items")).toEqual([]); // not a single read of the table
  });

  test("a unique index is a 409 conflict on its field, and the row keeps its old values", async () => {
    const cookie = await editor();
    const [, second] = await seed([{ name: "Satu" }, { name: "Dua" }]);
    const res = await via(`${BASE}/${second}`, { method: "PUT", cookie, headers: await ifMatch(second!), json: { name: "Satu" } });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "conflict", fields: { name: "Nama sudah dipakai" } });
    expect((await env.DB.prepare("SELECT name FROM example_items WHERE id = ?").bind(second).first<{ name: string }>())?.name).toBe("Dua");
    expect(await auditRows()).toEqual([]);
  });
});

// ------------------------------------------------------------------------------ delete

describe("delete", () => {
  test("204, the row is gone, one audit row with the label, the purge hook is told; a second delete is 404 and writes nothing", async () => {
    const cookie = await editor();
    const [id] = await seed([{ name: "Hapus Saya" }]);
    const res = await via(`${BASE}/${id}`, { method: "DELETE", cookie });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(await env.DB.prepare("SELECT count(*) AS n FROM example_items").first<{ n: number }>()).toEqual({ n: 0 });
    expect(await auditRows()).toMatchObject([{ action: "shortlink.delete", resource_id: id, metadata: { label: "Hapus Saya" } }]);
    expect(notified).toEqual([{ change: { area: "team" } }]);

    expect((await via(`${BASE}/${id}`, { method: "DELETE", cookie })).status).toBe(404);
    expect(await auditRows()).toHaveLength(1);
  });

  test("If-Match is optional on delete, but when it is sent a stale one is refused", async () => {
    const cookie = await editor();
    const [id] = await seed([{ name: "Satu" }]);
    const old = await ifMatch(id!);
    await via(`${BASE}/${id}`, { method: "PUT", cookie, headers: old, json: { name: "Dua" } });

    const stale = await via(`${BASE}/${id}`, { method: "DELETE", cookie, headers: old });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "stale" });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM example_items").first<{ n: number }>()).toEqual({ n: 1 });

    expect((await via(`${BASE}/${id}`, { method: "DELETE", cookie, headers: await ifMatch(id!) })).status).toBe(204);
  });

  test("a foreign key that refuses the delete is 409 in_use naming what holds it; nothing changes", async () => {
    const cookie = await editor();
    const [id] = await seed([{ name: "Punya Anak" }]);
    await env.DB.prepare("INSERT INTO example_children (id, item_id) VALUES ('child', ?)").bind(id).run();
    const res = await via(`${BASE}/${id}`, { method: "DELETE", cookie });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "in_use", message: "Masih dipakai di: Contoh anak. Lepaskan dulu dari sana.", usedBy: ["Contoh anak"] });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM example_items").first<{ n: number }>()).toEqual({ n: 1 });
    expect(await auditRows()).toEqual([]);
    expect(notified).toEqual([]);
  });

  test("a route can be switched off", async () => {
    const cookie = await editor();
    const [id] = await seed([{ name: "Satu" }]);
    expect((await via(`/api/admin/__small/${id}`, { method: "DELETE", cookie })).status).toBe(404);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM example_items").first<{ n: number }>()).toEqual({ n: 1 });
  });
});

// ------------------------------------------------------------------ who may (guards)

describe("who may do what: requireArea on every route, per role and per area", () => {
  type Case = { label: string; role: UserRole; areas: GrantableArea[]; write: boolean };
  const writers: Case[] = [
    { label: "super_admin", role: "super_admin", areas: [], write: true },
    { label: "editor granted komunikasi", role: "editor", areas: ["komunikasi"], write: true },
    { label: "editor granted every area", role: "editor", areas: ["pendaftaran", "komunikasi", "konten"], write: true },
  ];
  const nonWriters: Case[] = [
    { label: "student", role: "student", areas: [], write: false },
    { label: "viewer", role: "viewer", areas: [], write: false },
    { label: "viewer with a stray komunikasi grant", role: "viewer", areas: ["komunikasi"], write: false },
    { label: "editor with no grants", role: "editor", areas: [], write: false },
    { label: "editor granted other areas only", role: "editor", areas: ["pendaftaran", "konten"], write: false },
  ];

  test("nobody signed in: 401 on all five routes, nothing changes", async () => {
    const [id] = await seed([{ name: "Satu" }]);
    const stamp = { "if-match": '"2026-01-01T00:00:00.000Z"' };
    const statuses = [
      (await via(BASE)).status,
      (await via(`${BASE}/${id}`)).status,
      (await via(BASE, { method: "POST", json: { name: "Dua" } })).status,
      (await via(`${BASE}/${id}`, { method: "PUT", headers: stamp, json: { name: "Dua" } })).status,
      (await via(`${BASE}/${id}`, { method: "DELETE" })).status,
    ];
    expect(statuses).toEqual([401, 401, 401, 401, 401]);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM example_items").first<{ n: number }>()).toEqual({ n: 1 });
    expect(await auditRows()).toEqual([]);
  });

  for (const { label, role, areas } of writers) {
    test(`${label}: reads and writes`, async () => {
      const cookie = await signedInCookie(uniqueEmail(role), role, areas);
      const [id] = await seed([{ name: "Satu" }]);
      expect((await via(BASE, { cookie })).status).toBe(200);
      expect((await via(`${BASE}/${id}`, { cookie })).status).toBe(200);
      expect((await via(BASE, { method: "POST", cookie, json: { name: "Dua" } })).status).toBe(201);
      expect((await via(`${BASE}/${id}`, { method: "PUT", cookie, headers: await ifMatch(id!), json: { name: "Tiga" } })).status).toBe(200);
      expect((await via(`${BASE}/${id}`, { method: "DELETE", cookie })).status).toBe(204);
    });
  }

  for (const { label, role, areas } of nonWriters) {
    test(`${label}: every write is 403 and leaves no trace`, async () => {
      const cookie = await signedInCookie(uniqueEmail(role), role, areas);
      const [id] = await seed([{ name: "Satu" }]);
      const stamp = await ifMatch(id!);
      const writes = [
        (await via(BASE, { method: "POST", cookie, json: { name: "Dua" } })).status,
        (await via(`${BASE}/${id}`, { method: "PUT", cookie, headers: stamp, json: { name: "Tiga" } })).status,
        (await via(`${BASE}/${id}`, { method: "DELETE", cookie })).status,
      ];
      expect(writes).toEqual([403, 403, 403]);
      expect((await env.DB.prepare("SELECT name FROM example_items").all<{ name: string }>()).results.map((row) => row.name)).toEqual(["Satu"]);
      expect(await auditRows()).toEqual([]);
      expect(notified).toEqual([]);
      expect(removedPaths).toEqual([]);
    });
  }

  test("a student cannot read either (who may read an area is the permission model's rule)", async () => {
    const cookie = await signedInCookie(uniqueEmail("student"), "student");
    const [id] = await seed([{ name: "Satu" }]);
    expect((await via(BASE, { cookie })).status).toBe(403);
    expect((await via(`${BASE}/${id}`, { cookie })).status).toBe(403);
  });

  test("a viewer reads", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    expect((await via(BASE, { cookie })).status).toBe(200);
  });

  test("a resource of the sistem area is for super_admin only, for reads and writes", async () => {
    const [id] = await seed([{ name: "Satu" }]);
    const admin = await signedInCookie(uniqueEmail("admin"), "super_admin");
    expect((await via(SISTEM, { cookie: admin })).status).toBe(200);
    expect((await via(SISTEM, { method: "POST", cookie: admin, json: { name: "Dua" } })).status).toBe(201);

    for (const [role, areas] of [["viewer", []], ["editor", ["pendaftaran", "komunikasi", "konten"]], ["student", []]] as const) {
      const cookie = await signedInCookie(uniqueEmail(role), role, areas);
      expect((await via(SISTEM, { cookie })).status, `${role} reads`).toBe(403);
      expect((await via(`${SISTEM}/${id}`, { cookie })).status, `${role} reads one`).toBe(403);
      expect((await via(SISTEM, { method: "POST", cookie, json: { name: `Dari ${role}` } })).status, `${role} writes`).toBe(403);
    }
  });

  test("a role or grant changed in the database applies to the very next request (nothing is cached in the kit)", async () => {
    const email = uniqueEmail("editor");
    const cookie = await signedInCookie(email, "editor", ["komunikasi"]);
    expect((await via(BASE, { method: "POST", cookie, json: { name: "Satu" } })).status).toBe(201);
    await env.DB.prepare("DELETE FROM admin_area_grants").run();
    expect((await via(BASE, { method: "POST", cookie, json: { name: "Dua" } })).status).toBe(403);
  });
});

// ----------------------------------------------------------- uploads referenced by a row

describe("upload references: a path replaced or removed is cleaned up after the save", () => {
  test("replace: the old path is handed to the cleanup, the new one and an unchanged one are not", async () => {
    const cookie = await signedInCookie(uniqueEmail("admin"), "super_admin");
    const a = await uploaded(cookie, "a.png");
    const b = await uploaded(cookie, "b.png");
    const created = await via(BASE, { method: "POST", cookie, json: { name: "Foto", image: a.path } });
    const { item } = (await created.json()) as { item: Item };
    expect(item.image).toBe(a.path);
    expect(removedPaths).toEqual([]); // nothing was replaced yet

    // The same path again, and another field changed: nothing to clean.
    await via(`${BASE}/${item.id}`, { method: "PUT", cookie, headers: await ifMatch(item.id), json: { name: "Foto 2", image: a.path } });
    expect(removedPaths).toEqual([]);

    // A new path: the old one goes.
    await via(`${BASE}/${item.id}`, { method: "PUT", cookie, headers: await ifMatch(item.id), json: { name: "Foto 2", image: b.path } });
    expect(removedPaths).toEqual([a.path]);

    // Removed from the row: the current one goes.
    await via(`${BASE}/${item.id}`, { method: "PUT", cookie, headers: await ifMatch(item.id), json: { name: "Foto 2", image: null } });
    expect(removedPaths).toEqual([a.path, b.path]);
  });

  test("delete: every path the row held is handed to the cleanup", async () => {
    const cookie = await signedInCookie(uniqueEmail("admin"), "super_admin");
    const a = await uploaded(cookie, "a.png");
    const [id] = await seed([{ name: "Foto", image: a.path }]);
    expect((await via(`${BASE}/${id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect(removedPaths).toEqual([a.path]);
  });

  test("with the real cleanup the object and its media row are removed once nothing refers to them (and a failed save cleans nothing)", async () => {
    realUploadCleanup = true;
    const cookie = await signedInCookie(uniqueEmail("admin"), "super_admin");
    const a = await uploaded(cookie, "a.png");
    const b = await uploaded(cookie, "b.png");
    const key = (path: string) => path.slice(1);
    const [id] = await seed([{ name: "Foto", image: a.path }]);

    // A stale save changes nothing, so it cleans nothing.
    const stale = await via(`${BASE}/${id}`, { method: "PUT", cookie, headers: { "if-match": '"2020-01-01T00:00:00.000Z"' }, json: { name: "Foto", image: b.path } });
    expect(stale.status).toBe(409);
    expect(await env.UPLOADS.head(key(a.path))).not.toBeNull();

    const ok = await via(`${BASE}/${id}`, { method: "PUT", cookie, headers: await ifMatch(id!), json: { name: "Foto", image: b.path } });
    expect(ok.status).toBe(200);
    expect(await env.UPLOADS.head(key(a.path))).toBeNull();
    expect(await env.DB.prepare("SELECT count(*) AS n FROM media WHERE id = ?").bind(a.id).first<{ n: number }>()).toEqual({ n: 0 });
    expect(await env.UPLOADS.head(key(b.path))).not.toBeNull();
  });

  test("a path of another kind, an address, or a traversal is a validation error on the field", async () => {
    const cookie = await signedInCookie(uniqueEmail("admin"), "super_admin");
    for (const image of ["https://evil.example/x.png", "/uploads/report/2026/11111111-2222-3333-4444-555555555555-x.pdf", "/images/../secret.png", "javascript:alert(1)"]) {
      const res = await via(BASE, { method: "POST", cookie, json: { name: "Foto", image } });
      expect(res.status, image).toBe(400);
      expect(await res.json()).toMatchObject({ fields: { image: "Berkas tidak valid. Unggah ulang berkasnya." } });
    }
    // A legacy static path keeps working.
    expect((await via(BASE, { method: "POST", cookie, json: { name: "Foto lama", image: "/images/team/ayu.jpg" } })).status).toBe(201);
  });
});

// ------------------------------------------------------------------ the D1 budget

describe("D1 budget: statements and round trips per request (docs/cloudflare/admin-crud.md#12)", () => {
  /** What a request ran against the example table (and its audit rows): one entry per round trip. */
  async function trips(run: (cookie: string, env: { DB: D1Database }) => Promise<Response>) {
    const cookie = await editor();
    const spy = spyOnD1(env.DB);
    const res = await run(cookie, { DB: spy.db });
    const events = spy.events.filter((event) => event.sql.some((sql) => sql.includes("example_items") || sql.includes("audit_log")));
    return { res, events, statements: events.flatMap((event) => event.sql).length };
  }

  test("a list is one round trip of two statements (the page and the count)", async () => {
    await seed([{ name: "Satu" }]);
    const { res, events } = await trips((cookie, bindings) => via(BASE, { cookie, env: bindings }));
    expect(res.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("batch");
    expect(events[0]!.sql).toHaveLength(2);
  });

  test("one item is one statement", async () => {
    const [id] = await seed([{ name: "Satu" }]);
    const { events } = await trips((cookie, bindings) => via(`${BASE}/${id}`, { cookie, env: bindings }));
    expect(events).toHaveLength(1);
    expect(events[0]!.sql).toHaveLength(1);
  });

  test("a create is one round trip of two statements (insert and audit)", async () => {
    const { res, events } = await trips((cookie, bindings) => via(BASE, { method: "POST", cookie, json: { name: "Baru" }, env: bindings }));
    expect(res.status).toBe(201);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "batch" });
    expect(events[0]!.sql).toHaveLength(2);
  });

  test("an update is a read, then one round trip of two statements; a delete the same", async () => {
    const [id] = await seed([{ name: "Satu" }]);
    const headers = await ifMatch(id!);
    const update = await trips((cookie, bindings) => via(`${BASE}/${id}`, { method: "PUT", cookie, headers, json: { name: "Dua" }, env: bindings }));
    expect(update.res.status).toBe(200);
    expect(update.events.map((event) => [event.kind, event.sql.length])).toEqual([["single", 1], ["batch", 2]]);

    const remove = await trips((cookie, bindings) => via(`${BASE}/${id}`, { method: "DELETE", cookie, env: bindings }));
    expect(remove.res.status).toBe(204);
    expect(remove.events.map((event) => [event.kind, event.sql.length])).toEqual([["single", 1], ["batch", 2]]);
  });

  test("the list's plan is an index lookup, not a table scan (EXPLAIN QUERY PLAN)", async () => {
    // The plan of the page statement for the default sort (`name`, an indexed column) and a filter.
    const plan = async (sql: string) => (await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).all<{ detail: string }>()).results.map((row) => row.detail).join(" | ");
    const byName = await plan("SELECT * FROM example_items ORDER BY name ASC, id ASC LIMIT 20 OFFSET 0");
    expect(byName).toContain("USING INDEX example_items_name_idx");
    expect(byName).not.toContain("USE TEMP B-TREE FOR ORDER BY");
    const byName2 = await plan("SELECT * FROM example_items WHERE name = 'x'");
    expect(byName2).toContain("SEARCH example_items USING INDEX example_items_name_idx");
  });
});

// ----------------------------------------------------- audit rows never hold what they must not

describe("audit privacy across the whole suite of operations", () => {
  test("after every kind of change, each audit row has only `fields` (names) and `label`, and no body text", async () => {
    const cookie = await editor();
    const secret = "RAHASIA-ISI-FORMULIR-081234567890";
    const created = await via(BASE, { method: "POST", cookie, json: { name: "Nama Publik", kind: "b", secretNote: secret } });
    const { item } = (await created.json()) as { item: Item };
    await via(`${BASE}/${item.id}`, { method: "PUT", cookie, headers: await ifMatch(item.id), json: { name: "Nama Baru", kind: "c", secretNote: `${secret}-2` } });
    await via(`${BASE}/${item.id}`, { method: "DELETE", cookie });

    const raw = (await env.DB.prepare("SELECT metadata FROM audit_log").all<{ metadata: string | null }>()).results;
    expect(raw).toHaveLength(3);
    for (const row of raw) {
      const metadata = JSON.parse(row.metadata!) as { fields?: string[]; label?: string };
      expect(Object.keys(metadata).every((key) => key === "fields" || key === "label")).toBe(true);
      for (const field of metadata.fields ?? []) expect(["name", "kind", "image", "active", "secretNote"]).toContain(field);
      expect(row.metadata).not.toContain("RAHASIA");
    }
  });
});
