import { describe, expect, test } from "vitest";
import { accessTo } from "~/lib/access";
import { parseMe } from "~/lib/me";
import type { MediaItem } from "~/lib/crud/media";
import { mockMeBody } from "~/mock/fixtures";
import media, { addMockUpload } from "~/mock/handlers/media";
import { parsePersona } from "~/mock/persona";

// The mock of the Media library (mock/handlers/media.ts): `pnpm dev:spa:mock`. It answers in the Worker's shape and by its rules
// (docs/cloudflare/uploads.md), so the page and the picker can be looked at without a backend. The store lives for the page, so the
// tests that change it use a file of their own.

function setup(persona = "super_admin") {
  const me = mockMeBody(parsePersona(persona));
  const accessOf = (area: Parameters<typeof accessTo>[1]) => accessTo(parseMe(me), area);
  const ask = async (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) };
    const response = media({ method, url: new URL(path, "http://mock.invalid"), init, accessOf, self: me.user });
    if (!response) throw new Error(`the handler did not answer ${method} ${path}`);
    return { status: response.status, body: (response.status === 204 ? null : await response.json()) as Record<string, any> };
  };
  return Object.assign(ask, { answers: (method: string, path: string) => media({ method, url: new URL(path, "http://mock.invalid"), init: { method }, accessOf, self: me.user }) !== null });
}

const names = (body: Record<string, any>) => (body.items as MediaItem[]).map((item) => item.name);

describe("the list", () => {
  test("what is not its own is left to the next handler", () => {
    const ask = setup();
    expect(ask.answers("GET", "/api/admin/blog")).toBe(false);
    expect(ask.answers("GET", "/api/admin/uploads/a/b")).toBe(false);
    expect(ask.answers("POST", "/api/admin/uploads")).toBe(false); // an upload goes through the uploader, not this
  });

  test("the Worker's envelope, newest first, and no key, no uploader id: only what the screens show", async () => {
    const { status, body } = await setup()("GET", "/api/admin/uploads?pageSize=50");
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["items", "page", "pageSize", "total", "totalPages"]);
    expect(body.total).toBeGreaterThan(40); // a second page of the Media page's 40 exists
    const dates = (body.items as MediaItem[]).map((item) => item.createdAt);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(Object.keys(body.items[0]).sort()).toEqual(["altText", "contentType", "createdAt", "height", "id", "kind", "name", "path", "size", "uploadedByName", "width"]);
  });

  test("a page is bounded like the Worker's: 50 at most, junk is the default", async () => {
    const ask = setup();
    expect((await ask("GET", "/api/admin/uploads?pageSize=500")).body.items).toHaveLength(50);
    expect((await ask("GET", "/api/admin/uploads?pageSize=abc&page=-1")).body).toMatchObject({ page: 1, pageSize: 20 });
    const second = (await ask("GET", "/api/admin/uploads?pageSize=40&page=2")).body;
    expect(second.page).toBe(2);
    expect(second.totalPages).toBe(2);
  });

  test("?kind= narrows to one kind; an empty or unknown one is 400, and so is a search of 101 characters", async () => {
    const ask = setup();
    const reports = (await ask("GET", "/api/admin/uploads?kind=report")).body;
    expect((reports.items as MediaItem[]).every((item) => item.kind === "report")).toBe(true);
    for (const kind of ["", "video", "../x"]) expect((await ask("GET", `/api/admin/uploads?kind=${kind}`)).status, kind).toBe(400);
    expect((await ask("GET", `/api/admin/uploads?q=${"a".repeat(101)}`)).body).toMatchObject({ error: "invalid_query", param: "q" });
  });

  test("q looks at the name and the text alternative, without case, and not at the folders of the path", async () => {
    const ask = setup();
    expect(names((await ask("GET", "/api/admin/uploads?q=WISUDA")).body)).toContain("wisuda-2026.webp");
    expect(names((await ask("GET", "/api/admin/uploads?q=ruang%20kelas")).body)).toContain("hero-kelas.webp"); // its text alternative
    expect((await ask("GET", "/api/admin/uploads?q=uploads")).body.total).toBe(0);
    expect((await ask("GET", "/api/admin/uploads?q=blog-image")).body.total).toBe(0);
  });

  test("type is image or pdf; anything else is refused with its name", async () => {
    const ask = setup();
    expect((await ask("GET", "/api/admin/uploads?type=pdf&pageSize=50")).body.items.every((item: MediaItem) => item.contentType === "application/pdf")).toBe(true);
    expect((await ask("GET", "/api/admin/uploads?type=image&pageSize=50")).body.items.every((item: MediaItem) => item.contentType.startsWith("image/"))).toBe(true);
    expect((await ask("GET", "/api/admin/uploads?type=video")).body).toMatchObject({ error: "invalid_query", param: "type" });
  });

  test("from is the start of a day and to is where the next begins; a date that is not one is refused, a bare number is not a year", async () => {
    const ask = setup();
    const all = (await ask("GET", "/api/admin/uploads?pageSize=50")).body.items as MediaItem[];
    const day = all[0]!.createdAt.slice(0, 10);
    const none = (await ask("GET", `/api/admin/uploads?from=${new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}`)).body;
    expect(none.total).toBe(0);
    const since = (await ask("GET", `/api/admin/uploads?from=${day}&pageSize=50`)).body;
    expect(names(since)).toContain(all[0]!.name);
    const before = (await ask("GET", `/api/admin/uploads?to=${day}&pageSize=50`)).body;
    expect(names(before)).not.toContain(all[0]!.name);
    for (const bad of ["1", "kemarin", "2026-13-45x"]) expect((await ask("GET", `/api/admin/uploads?from=${bad}`)).body, bad).toMatchObject({ error: "invalid_query", param: "from" });
  });

  test("who may read: a viewer and a konten editor see the library; a pendaftaran editor only the resources; a student nothing", async () => {
    expect((await setup("viewer")("GET", "/api/admin/uploads")).status).toBe(200);
    const content = (await setup("editor:konten")("GET", "/api/admin/uploads?pageSize=50")).body.items as MediaItem[];
    expect(content.some((item) => item.kind === "resource")).toBe(false);
    expect(content.length).toBeGreaterThan(0);
    const registration = (await setup("editor:pendaftaran")("GET", "/api/admin/uploads?pageSize=50")).body.items as MediaItem[];
    expect(registration.length).toBeGreaterThan(0);
    expect(registration.every((item) => item.kind === "resource")).toBe(true);
    expect((await setup("editor:pendaftaran")("GET", "/api/admin/uploads?kind=blog-image")).status).toBe(403);
    expect((await setup("student")("GET", "/api/admin/uploads")).status).toBe(403);
  });
});

describe("one file", () => {
  const first = async (ask: ReturnType<typeof setup>, query = "") => ((await ask("GET", `/api/admin/uploads?pageSize=50${query}`)).body.items as MediaItem[])[0]!;

  test("the item and the menus that use it, once each; an id nobody has is 404", async () => {
    const ask = setup();
    const used = (await ask("GET", "/api/admin/uploads?q=dipakai-sampul")).body.items[0] as MediaItem;
    const detail = await ask("GET", `/api/admin/uploads/${used.id}`);
    expect(detail.body.item).toEqual(used);
    expect(detail.body.usedBy).toEqual(["Blog", "Pengumuman"]);
    expect((await ask("GET", "/api/admin/uploads/tidak-ada")).status).toBe(404);
  });

  test("the text alternative is trimmed, cleared by an empty one, refused over 300 characters; a viewer may not, and a PDF's is as good as nothing", async () => {
    const ask = setup();
    const target = await first(ask, "&q=ruang-baca");
    expect((await ask("PATCH", `/api/admin/uploads/${target.id}`, { altText: "  Rak buku  " })).body.item.altText).toBe("Rak buku");
    expect((await ask("GET", "/api/admin/uploads?q=rak%20buku")).body.total).toBe(1); // and the search finds it by that
    expect((await ask("PATCH", `/api/admin/uploads/${target.id}`, { altText: "" })).body.item.altText).toBeNull();
    expect((await ask("PATCH", `/api/admin/uploads/${target.id}`, { altText: "a".repeat(301) })).body).toMatchObject({ error: "invalid", fields: { altText: "Teks alternatif maksimal 300 karakter." } });
    expect((await ask("PATCH", `/api/admin/uploads/${target.id}`, { altText: 3 })).status).toBe(400);
    expect((await setup("viewer")("PATCH", `/api/admin/uploads/${target.id}`, { altText: "x" })).status).toBe(403);
  });

  test("a file in use is refused with its menus; one that is not is deleted and is then gone; a viewer may not", async () => {
    const ask = setup();
    const used = (await ask("GET", "/api/admin/uploads?q=dipakai-sampul")).body.items[0] as MediaItem;
    const refused = await ask("DELETE", `/api/admin/uploads/${used.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: "in_use", usedBy: ["Blog", "Pengumuman"], message: "File masih dipakai di: Blog, Pengumuman. Lepaskan dulu dari sana." });

    const free = (await ask("GET", "/api/admin/uploads?q=logo-mitra&pageSize=1")).body.items[0] as MediaItem;
    expect((await setup("viewer")("DELETE", `/api/admin/uploads/${free.id}`)).status).toBe(403);
    expect((await ask("DELETE", `/api/admin/uploads/${free.id}`)).status).toBe(204);
    expect((await ask("GET", `/api/admin/uploads/${free.id}`)).status).toBe(404);
  });

  test("a file the uploader stored is first in the library, with no text alternative and nothing using it", async () => {
    const ask = setup();
    const item: MediaItem = { id: "baru-1", path: "/uploads/blog-image/2026/baru-1-foto.webp", name: "foto-uji.webp", kind: "blog-image", contentType: "image/webp", size: 1, width: 8, height: 8, altText: null, uploadedByName: "Admin Mock", createdAt: new Date().toISOString() };
    addMockUpload(item);
    expect((await first(ask)).id).toBe("baru-1");
    expect((await ask("GET", "/api/admin/uploads/baru-1")).body).toEqual({ item, usedBy: [] });
  });
});
