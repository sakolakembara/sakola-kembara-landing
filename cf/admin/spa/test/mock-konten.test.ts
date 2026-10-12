import { describe, expect, test } from "vitest";
import { accessTo } from "~/lib/access";
import { ifMatch } from "~/lib/crud/etag";
import { parseMe } from "~/lib/me";
import { mockMeBody } from "~/mock/fixtures";
import { parsePersona } from "~/mock/persona";
import { MOCK_RESOURCES } from "~/mock/registry";
import { createMockResources } from "~/mock/resources";
import { createMockUploader } from "~/mock/uploads";
import { SCREENS } from "~/pages/screens";

// `pnpm dev:spa:mock` for the three Konten Situs screens: the mock answers like the Worker (the contract is proved
// for the generic store in crud/mock-resources.test.ts; this proves these three resources are registered, seeded with
// rows their own rules accept, and refuse what the Worker refuses), and the screens are registered in the router.

const store = (persona: string) => {
  const me = parseMe(mockMeBody(parsePersona(persona)));
  const resources = createMockResources(MOCK_RESOURCES, (area) => accessTo(me, area));
  return async (method: string, path: string, init: { json?: unknown; ifMatch?: string } = {}) => {
    const response = resources.handle(method, new URL(path, "http://mock.invalid"), {
      method,
      headers: init.ifMatch ? { "If-Match": init.ifMatch } : undefined,
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
    });
    if (!response) throw new Error(`nobody handled ${method} ${path}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: response.status, body: (response.status === 204 ? null : await response.json()) as Record<string, any> };
  };
};

describe("the screens are registered", () => {
  test.each(["/reports", "/team", "/shortlinks"])("%s has a list, a create page and an edit page", (path) => {
    const screen = SCREENS[path];
    expect(screen?.index).toBeTypeOf("function");
    expect(screen?.routes?.map((route) => route.path)).toEqual(["new", ":id/edit"]);
  });

  test("the three resources are mocked, for the area konten", () => {
    for (const path of ["/api/admin/reports", "/api/admin/team", "/api/admin/shortlinks"]) {
      expect(MOCK_RESOURCES.find((resource) => resource.path === path)?.area, path).toBe("konten");
    }
  });
});

describe("who may do what in the mock", () => {
  test("a viewer reads and cannot write; an editor of komunikasi cannot even read; an editor of konten and super_admin do both", async () => {
    for (const path of ["/api/admin/reports", "/api/admin/team", "/api/admin/shortlinks"]) {
      const viewer = store("viewer");
      expect((await viewer("GET", path)).status, path).toBe(200);
      expect((await viewer("POST", path, { json: {} })).status, path).toBe(403);
      const elsewhere = store("editor:komunikasi");
      expect((await elsewhere("GET", path)).status, path).toBe(403);
      for (const persona of ["editor:konten", "super_admin"]) {
        const call = store(persona);
        expect((await call("GET", path)).status, `${persona} ${path}`).toBe(200);
        expect((await call("POST", path, { json: {} })).status, `${persona} ${path}`).toBe(400); // allowed in, refused by the rules
      }
    }
  });
});

describe("reports", () => {
  const body = { title: "Laporan Baru", description: "", category: "impact", year: "2025/2026", filePath: "/uploads/report/2026/00000000-0000-4000-8000-0000000000aa-laporan-baru.pdf", fileSize: 1024 };

  test("newest year first, like the Worker; the seed has a file for every row", async () => {
    const list = (await store("viewer")("GET", "/api/admin/reports")).body.items as { year: string; filePath: string }[];
    expect(list.map((row) => row.year)).toEqual([...list.map((row) => row.year)].sort().reverse());
    expect(list.every((row) => row.filePath.startsWith("/uploads/report/"))).toBe(true);
  });

  test("a create needs the file; an update is the metadata only and leaves the file alone", async () => {
    const call = store("editor:konten");
    const refused = await call("POST", "/api/admin/reports", { json: { ...body, filePath: "" } });
    expect(refused.status).toBe(400);
    expect(refused.body.fields).toEqual({ filePath: "File PDF wajib diupload." });

    const created = await call("POST", "/api/admin/reports", { json: body });
    expect(created.status).toBe(201);
    expect(created.body.item).toMatchObject({ title: "Laporan Baru", description: null, filePath: body.filePath, fileSize: 1024 });
    expect(created.body.item.uploadedAt).toBeTruthy();

    const id = created.body.item.id as string;
    const updated = await call("PUT", `/api/admin/reports/${id}`, { ifMatch: ifMatch(created.body.item.updatedAt), json: { title: "Judul baru", category: "financial", year: "2025" } });
    expect(updated.status).toBe(200);
    expect(updated.body.item).toMatchObject({ title: "Judul baru", category: "financial", year: "2025", filePath: body.filePath, fileSize: 1024 });
    expect((await call("DELETE", `/api/admin/reports/${id}`)).status).toBe(204);
  });

  test("the year is the Worker's own rule", async () => {
    const call = store("editor:konten");
    for (const year of ["2025/2027", "25", "2017", "2025-2026"]) {
      expect((await call("POST", "/api/admin/reports", { json: { ...body, year } })).body.fields, year).toEqual({ year: "Format tahun tidak valid. Contoh: 2025 atau 2025/2026" });
    }
  });
});

describe("team", () => {
  const body = { name: "Siti Aminah", role: "Sekretaris", category: "pengurus", image: null, bio: "", educationHistory: [], workHistory: [], displayOrder: 100 };

  test("the default order is the public page's: category, then display order", async () => {
    const list = (await store("viewer")("GET", "/api/admin/team")).body.items as { category: string; displayOrder: number }[];
    const keys = list.map((row) => `${row.category}|${String(row.displayOrder).padStart(4, "0")}`);
    expect(keys).toEqual([...keys].sort());
  });

  test("a created member lands in its category and order; a member's order can be changed", async () => {
    const call = store("editor:konten");
    const created = await call("POST", "/api/admin/team", { json: { ...body, category: "dewan_pembina", displayOrder: 1 } });
    expect(created.status).toBe(201);
    const list = (await call("GET", "/api/admin/team")).body.items as { name: string }[];
    expect(list[0]?.name).toBe("Siti Aminah"); // dewan_pembina, order 1
  });

  test("the rules of the Worker: names, the order, the histories", async () => {
    const call = store("editor:konten");
    const post = async (over: Record<string, unknown>) => (await call("POST", "/api/admin/team", { json: { ...body, ...over } })).body.fields as Record<string, string>;
    expect(await post({ name: "A", role: "B" })).toEqual({ name: "Nama minimal 2 karakter", role: "Peran minimal 2 karakter" });
    expect(await post({ displayOrder: -1 })).toEqual({ displayOrder: "Tidak boleh negatif" });
    expect(await post({ displayOrder: 10_000 })).toEqual({ displayOrder: "Maksimal 9999" });
    expect(await post({ displayOrder: null })).toEqual({ displayOrder: "Wajib diisi" });
    expect(await post({ category: "direksi" })).toEqual({ category: "Kategori tidak dikenal" });
    expect(await post({ educationHistory: Array.from({ length: 21 }, () => ({ institution: "UI" })) })).toEqual({ educationHistory: "Maksimal 20 entri" });
    expect(Object.keys(await post({ workHistory: [{ organization: "Y", role: "" }] }))).toEqual(["workHistory"]);
  });
});

describe("shortlinks", () => {
  const body = { slug: "rapat-2026", targetUrl: "https://forms.gle/abc123", note: "", active: true };

  test("the slug and the target go through the Worker's own functions: the same refusals in the same words", async () => {
    const call = store("editor:konten");
    const post = async (over: Record<string, unknown>) => (await call("POST", "/api/admin/shortlinks", { json: { ...body, ...over } })).body.fields as Record<string, string>;
    expect(await post({ slug: "" })).toEqual({ slug: "Slug wajib diisi." });
    expect(await post({ slug: "donasi" })).toEqual({ slug: '"donasi" sudah dipakai halaman lain di situs ini, jadi shortlink dengan slug tersebut tidak akan pernah terbuka. Pilih slug lain.' });
    expect(await post({ slug: "Salah_Slug", targetUrl: "javascript:alert(1)" })).toMatchObject({ targetUrl: "Hanya URL http:// atau https:// yang diizinkan." });
    expect(await post({ targetUrl: "/\\evil.example" })).toEqual({ targetUrl: "Format URL tidak valid. Gunakan https://... atau /path-di-situs-ini." });
    expect(await post({ targetUrl: "/rapat-2026" })).toEqual({ targetUrl: "Tujuan tidak boleh menunjuk ke shortlink itu sendiri." });
  });

  test("a created link is stored normalised and counts no clicks yet; switching it off keeps the rest", async () => {
    const call = store("editor:konten");
    const created = await call("POST", "/api/admin/shortlinks", { json: { ...body, slug: " /Rapat-Baru/ ", note: " untuk rapat " } });
    expect(created.status).toBe(201);
    expect(created.body.item).toMatchObject({ slug: "rapat-baru", note: "untuk rapat", active: true });
    const id = created.body.item.id as string;
    const off = await call("PUT", `/api/admin/shortlinks/${id}`, { ifMatch: ifMatch(created.body.item.updatedAt), json: { ...body, slug: "rapat-baru", active: false } });
    expect(off.body.item).toMatchObject({ active: false, slug: "rapat-baru" });
  });

  test("filter by status and search by slug, like the Worker; a bad filter value is refused", async () => {
    const call = store("viewer");
    const off = (await call("GET", "/api/admin/shortlinks?active=false")).body.items as { active: boolean }[];
    expect(off.length).toBeGreaterThan(0);
    expect(off.every((row) => !row.active)).toBe(true);
    expect(((await call("GET", "/api/admin/shortlinks?q=BIO")).body.items as { slug: string }[]).map((row) => row.slug)).toEqual(["bio-instagram"]);
    expect((await call("GET", "/api/admin/shortlinks?active=maybe")).status).toBe(400);
  });
});

describe("the mock uploader accepts what the Worker's kinds accept", () => {
  test("a PDF for a report and a photo for a team member, for someone who may write konten; nothing for a viewer", async () => {
    const editor = createMockUploader(parsePersona("editor:konten"));
    const pdf = await editor({ kind: "report", file: new File([new Uint8Array(100)], "Laporan.pdf", { type: "application/pdf" }) });
    expect(pdf).toMatchObject({ ok: true, result: { path: expect.stringMatching(/^\/uploads\/report\/\d{4}\/[0-9a-f-]{36}-laporan\.pdf$/), contentType: "application/pdf", size: 100, width: null } });
    const photo = await editor({ kind: "team-photo", file: new File([new Uint8Array(100)], "Foto Ibu.png", { type: "image/png" }) });
    expect(photo).toMatchObject({ ok: true, result: { path: expect.stringMatching(/^\/uploads\/team-photo\/\d{4}\/[0-9a-f-]{36}-foto-ibu\.png$/) } });
    const viewer = createMockUploader(parsePersona("viewer"));
    expect(await viewer({ kind: "report", file: new File([new Uint8Array(100)], "Laporan.pdf", { type: "application/pdf" }) })).toMatchObject({ ok: false, status: 403 });
  });
});
