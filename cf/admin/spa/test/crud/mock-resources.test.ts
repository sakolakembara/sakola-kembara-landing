import { describe, expect, test } from "vitest";
import type { Access } from "~/lib/access";
import { ifMatch } from "~/lib/crud/etag";
import { MOCK_RESOURCES } from "~/mock/registry";
import { createMockResources, type MockResource, type MockRowBase } from "~/mock/resources";
import { createMockTransport } from "~/mock/transport";
import { createMockUploader } from "~/mock/uploads";
import { parsePersona } from "~/mock/persona";

// The generic in-memory store area workers build screens against (docs/cloudflare/admin-crud.md#16): it has to
// answer like the Worker, or a screen that works in the mock fails against the real thing.

interface Thing extends MockRowBase {
  name: string;
  kind: string;
  active: boolean;
  [field: string]: unknown;
}

const row = (id: string, name: string, kind: string, createdAt: string, active = true): Thing => ({ id, name, kind, active, createdAt, updatedAt: createdAt });

const THINGS: MockResource<Thing> = {
  path: "/api/admin/things",
  area: "konten",
  seed: () => [row("a", "Alpha", "x", "2026-01-01T00:00:00.000Z"), row("b", "Beta", "y", "2026-01-02T00:00:00.000Z", false), row("c", "Gamma", "x", "2026-01-03T00:00:00.000Z")],
  search: ["name"],
  filters: { kind: ["x", "y"], active: ["true", "false"] },
  sorts: ["name", "createdAt"],
  defaultSort: "-createdAt",
  parse: (body) => (typeof body.name === "string" && body.name.trim().length >= 3 ? { ok: true, values: { name: body.name.trim(), kind: String(body.kind ?? "x"), active: body.active !== false } } : { ok: false, fields: { name: "Nama minimal 3 karakter" } }),
  inUse: (thing) => (thing.id === "a" ? ["Blog"] : null),
};

function store(access: Access = "write") {
  const resources = createMockResources([THINGS], () => access);
  const call = async (method: string, path: string, init: { json?: unknown; ifMatch?: string } = {}) => {
    const response = resources.handle(method, new URL(path, "http://mock.invalid"), {
      method,
      headers: init.ifMatch ? { "If-Match": init.ifMatch } : undefined,
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
    });
    if (!response) throw new Error(`nobody handled ${method} ${path}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: response.status, body: (response.status === 204 ? null : await response.json()) as Record<string, any>, headers: response.headers };
  };
  const handles = (path: string) => resources.handle("GET", new URL(path, "http://mock.invalid"), { method: "GET" }) !== null;
  return { call, resources, handles };
}

describe("the mock store answers the contract", () => {
  test("a path that is nobody's is null (the transport answers its own 404)", async () => {
    expect(store().handles("/api/admin/other")).toBe(false);
    expect(store().handles("/api/admin/things/a/extra")).toBe(false);
    expect(store().handles("/api/admin/things")).toBe(true);
    expect(store().handles("/api/admin/things/a")).toBe(true);
  });

  test("list: the envelope, the default sort, pages", async () => {
    const { call } = store();
    const first = await call("GET", "/api/admin/things");
    expect(first.body).toMatchObject({ page: 1, pageSize: 20, total: 3 });
    expect(first.body.items.map((item: Thing) => item.name)).toEqual(["Gamma", "Beta", "Alpha"]); // -createdAt
    const paged = await call("GET", "/api/admin/things?pageSize=2&page=2");
    expect(paged.body.items.map((item: Thing) => item.name)).toEqual(["Alpha"]);
    expect(paged.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    // Clamped, not refused.
    expect((await call("GET", "/api/admin/things?pageSize=500&page=abc")).body).toMatchObject({ page: 1, pageSize: 100 });
  });

  test("filters, search and sort, like the Worker; unknown values are 400 invalid_query", async () => {
    const { call } = store();
    const names = async (query: string) => (await call("GET", `/api/admin/things${query}`)).body.items.map((item: Thing) => item.name);
    expect(await names("?kind=x")).toEqual(["Gamma", "Alpha"]);
    expect(await names("?active=false")).toEqual(["Beta"]);
    expect(await names("?q=ALP")).toEqual(["Alpha"]);
    expect(await names("?sort=name")).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(await names("?sort=-name")).toEqual(["Gamma", "Beta", "Alpha"]);
    for (const bad of ["?kind=z", "?active=maybe", "?sort=secret", "?sort=-id"]) {
      const answer = await call("GET", `/api/admin/things${bad}`);
      expect(answer!.status, bad).toBe(400);
      expect(answer!.body.error).toBe("invalid_query");
    }
  });

  test("GET /:id answers { item } with its ETag; a missing one is 404 in the Worker's shape", async () => {
    const { call } = store();
    const found = await call("GET", "/api/admin/things/b");
    expect(found.status).toBe(200);
    expect(found.body.item.name).toBe("Beta");
    expect(found.headers.get("etag")).toBe(ifMatch("2026-01-02T00:00:00.000Z"));
    const missing = await call("GET", "/api/admin/things/zzz");
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ error: "not_found", message: expect.any(String) });
  });

  test("create: 201 { item } with ids and dates; validation is the 400 shape with Indonesian fields", async () => {
    const { call } = store();
    const created = await call("POST", "/api/admin/things", { json: { name: "  Delta  ", kind: "y" } });
    expect(created.status).toBe(201);
    expect(created.body.item).toMatchObject({ name: "Delta", kind: "y" });
    expect(created.body.item.id).toMatch(/^mock-things-/);
    expect(Date.parse(created.body.item.createdAt)).not.toBeNaN();
    expect((await call("GET", "/api/admin/things")).body.total).toBe(4);
    expect((await call("GET", "/api/admin/things")).body.items[0].name).toBe("Delta"); // newest first

    const bad = await call("POST", "/api/admin/things", { json: { name: "x" } });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { name: "Nama minimal 3 karakter" } });
    expect((await call("GET", "/api/admin/things")).body.total).toBe(4);
  });

  test("update: needs If-Match (428), refuses a stale one (409), and a good one changes the version", async () => {
    const { call } = store();
    expect((await call("PUT", "/api/admin/things/a", { json: { name: "Alpha 2" } })).status).toBe(428);

    const version = ifMatch("2026-01-01T00:00:00.000Z");
    const saved = await call("PUT", "/api/admin/things/a", { json: { name: "Alpha 2" }, ifMatch: version });
    expect(saved.status).toBe(200);
    expect(saved.body.item.name).toBe("Alpha 2");
    expect(saved.body.item.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
    expect(saved.headers.get("etag")).toBe(ifMatch(saved.body.item.updatedAt));

    const stale = await call("PUT", "/api/admin/things/a", { json: { name: "Alpha 3" }, ifMatch: version });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("stale");
    expect((await call("GET", "/api/admin/things/a")).body.item.name).toBe("Alpha 2");

    expect((await call("PUT", "/api/admin/things/a", { json: { name: "x" }, ifMatch: ifMatch(saved.body.item.updatedAt) })).status).toBe(400);
    expect((await call("PUT", "/api/admin/things/zzz", { json: { name: "Nama baru" }, ifMatch: version })).status).toBe(404);
  });

  test("two saves in the same millisecond still get different versions", async () => {
    const { call } = store();
    let version = ifMatch("2026-01-01T00:00:00.000Z");
    const seen = new Set<string>();
    for (const name of ["Satu", "Dua", "Tiga"]) {
      const saved = await call("PUT", "/api/admin/things/a", { json: { name }, ifMatch: version });
      expect(saved.status).toBe(200);
      seen.add(saved.body.item.updatedAt);
      version = ifMatch(saved.body.item.updatedAt);
    }
    expect(seen.size).toBe(3);
  });

  test("delete: 204, 404 when gone, 409 stale for an old version, 409 in_use when the spec says so", async () => {
    const { call } = store();
    expect((await call("DELETE", "/api/admin/things/b")).status).toBe(204);
    expect((await call("GET", "/api/admin/things/b")).status).toBe(404);
    expect((await call("DELETE", "/api/admin/things/b")).status).toBe(404);

    expect((await call("DELETE", "/api/admin/things/c", { ifMatch: ifMatch("2020-01-01T00:00:00.000Z") })).status).toBe(409);
    expect((await call("DELETE", "/api/admin/things/c", { ifMatch: ifMatch("2026-01-03T00:00:00.000Z") })).status).toBe(204);

    const used = await call("DELETE", "/api/admin/things/a");
    expect(used.status).toBe(409);
    expect(used.body).toEqual({ error: "in_use", message: "Masih dipakai di: Blog. Lepaskan dulu dari sana.", usedBy: ["Blog"] });
    expect((await call("GET", "/api/admin/things/a")).status).toBe(200);
  });

  test("a persona without access gets 403 on everything; a read-only one reads and is refused every write", async () => {
    const none = store("none");
    for (const [method, path] of [["GET", "/api/admin/things"], ["GET", "/api/admin/things/a"], ["POST", "/api/admin/things"], ["PUT", "/api/admin/things/a"], ["DELETE", "/api/admin/things/a"]] as const) {
      expect((await none.call(method, path, { json: { name: "Nama baru" } })).status, `none ${method}`).toBe(403);
    }
    const read = store("read");
    expect((await read.call("GET", "/api/admin/things")).status).toBe(200);
    expect((await read.call("GET", "/api/admin/things/a")).status).toBe(200);
    for (const [method, path] of [["POST", "/api/admin/things"], ["PUT", "/api/admin/things/a"], ["DELETE", "/api/admin/things/b"]] as const) {
      expect((await read.call(method, path, { json: { name: "Nama baru" }, ifMatch: ifMatch("2026-01-01T00:00:00.000Z") })).status, `read ${method}`).toBe(403);
    }
    expect((await read.call("GET", "/api/admin/things")).body.total).toBe(3); // nothing changed
  });

  test("the store is per page load: a fresh store starts from the seed again", async () => {
    const first = store();
    await first.call("DELETE", "/api/admin/things/b");
    expect((await store().call("GET", "/api/admin/things")).body.total).toBe(3);
  });
});

describe("the registry and the transport", () => {
  test("every file of mock/resources/ is a mocked resource (announcements is one), with a path under /api/admin", () => {
    expect(MOCK_RESOURCES.map((resource) => resource.path)).toContain("/api/admin/announcements");
    for (const resource of MOCK_RESOURCES) expect(resource.path).toMatch(/^\/api\/admin\/[a-z-]+$/);
  });

  test("through the transport: persona rights decide, and an unregistered path is still 404", async () => {
    const config = (persona: string) => ({ persona: parsePersona(persona), dashboard: "ready" as const, delayMs: 0, session: { get: () => true, set: () => undefined } });
    const call = async (persona: string, method: string, path: string, json?: unknown) => {
      const transport = createMockTransport(config(persona));
      const response = await transport(path, { method, body: json === undefined ? undefined : JSON.stringify(json), headers: { "Content-Type": "application/json" } });
      return response.status;
    };
    expect(await call("super_admin", "GET", "/api/admin/announcements")).toBe(200);
    expect(await call("viewer", "GET", "/api/admin/announcements")).toBe(200);
    expect(await call("viewer", "POST", "/api/admin/announcements", { title: "Halo dunia", body: "Isi pengumuman", severity: "info" })).toBe(403);
    expect(await call("editor:konten", "POST", "/api/admin/announcements", { title: "Halo dunia", body: "Isi pengumuman", severity: "info" })).toBe(403); // not the Komunikasi editor
    expect(await call("editor:komunikasi", "POST", "/api/admin/announcements", { title: "Halo dunia", body: "Isi pengumuman", severity: "info" })).toBe(201);
    expect(await call("super_admin", "GET", "/api/admin/nowhere")).toBe(404);
    expect(await call("super_admin", "GET", "/api/announcements")).toBe(404); // the old sample path is gone
  });
});

describe("the mock uploader", () => {
  const file = (name: string, size: number, type: string) => new File([new Uint8Array(size)], name, { type });

  test("a made-up path of the right kind folder, with progress, for a persona that can write the area", async () => {
    const upload = createMockUploader(parsePersona("editor:konten"));
    const fractions: number[] = [];
    const outcome = await upload({ kind: "team-photo", file: file("Foto Ibu Ayu.PNG", 1000, "image/png"), onProgress: (fraction) => fractions.push(fraction) });
    expect(outcome.ok && outcome.result.path).toMatch(/^\/uploads\/team-photo\/\d{4}\/[0-9a-f-]{36}-foto-ibu-ayu\.png$/);
    expect(fractions.at(-1)).toBe(1);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(outcome.ok && outcome.result).toMatchObject({ contentType: "image/png", size: 1000, width: 800, height: 600 });
  }, 5000);

  test("the Worker's rules: the area, the limits, the types", async () => {
    const asKomunikasi = createMockUploader(parsePersona("editor:komunikasi"));
    expect(await asKomunikasi({ kind: "team-photo", file: file("a.png", 10, "image/png") })).toMatchObject({ ok: false, status: 403 });

    const asKonten = createMockUploader(parsePersona("editor:konten"));
    expect(await asKonten({ kind: "team-photo", file: file("a.png", 5_000_001, "image/png") })).toMatchObject({ ok: false, status: 413, message: "Ukuran file maksimal 5 MB." });
    expect(await asKonten({ kind: "team-photo", file: file("a.pdf", 10, "application/pdf") })).toMatchObject({ ok: false, status: 415 });
    expect(await createMockUploader(parsePersona("viewer"))({ kind: "report", file: file("a.pdf", 10, "application/pdf") })).toMatchObject({ ok: false, status: 403 });
  });

  test("a file named gagal-... fails with a server error, to see that state", async () => {
    const upload = createMockUploader(parsePersona("super_admin"));
    expect(await upload({ kind: "team-photo", file: file("gagal-besar.png", 10, "image/png") })).toMatchObject({ ok: false, status: 413 });
    expect(await upload({ kind: "team-photo", file: file("gagal-lain.png", 10, "image/png") })).toMatchObject({ ok: false, status: 500 });
  }, 5000);

  test("an abort stops it", async () => {
    const controller = new AbortController();
    const upload = createMockUploader(parsePersona("super_admin"));
    const pending = upload({ kind: "team-photo", file: file("a.png", 10, "image/png"), signal: controller.signal });
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, code: "aborted" });
  });
});
