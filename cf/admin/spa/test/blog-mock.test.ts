import { describe, expect, test } from "vitest";
import type { Access } from "~/lib/access";
import { ifMatch } from "~/lib/crud/etag";
import blog from "~/mock/resources/blog";
import { createMockResources } from "~/mock/resources";
import { LIMITS } from "~/pages/blog/rules";
import { META_CASES } from "./blog-meta-cases";

// The blog mock (`pnpm dev:spa:mock`): it must behave like the Worker's routes, or a screen built against it would be
// wrong on the real thing. The Worker's own behaviour is proved in test/blog.test.ts; this is the mock in miniature.

const PATH = "/api/admin/blog";
const valid = {
  title: "Judul Artikel Contoh",
  slug: "",
  category: "Tips",
  excerpt: "Ringkasan artikel contoh yang cukup panjang.",
  contentMarkdown: "Isi artikel contoh yang cukup panjang untuk lolos batas lima puluh karakter.",
  author: "Dzul",
  featured: false,
  date: null,
  image: null,
};

function mock(access: Access = "write") {
  const store = createMockResources([blog], () => access);
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = store.handle(method, new URL(path, "http://mock.invalid"), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response) throw new Error(`the mock answered nothing for ${method} ${path}`);
    const answer: Record<string, any> = response.status === 204 ? {} : ((await response.json()) as Record<string, any>);
    return { status: response.status, body: answer, headers: response.headers };
  };
  return { call, rows: () => store.rows(PATH) as Record<string, any>[] };
}

describe("the blog mock", () => {
  test("lists newest edit first with the Worker's envelope, filters and search", async () => {
    const { call } = mock();
    const list = await call("GET", PATH);
    expect(list.body).toMatchObject({ page: 1, pageSize: 20 });
    expect(list.body.total).toBeGreaterThan(5);
    const updated = list.body.items.map((item: { updatedAt: string }) => item.updatedAt);
    expect(updated).toEqual([...updated].sort().reverse());
    expect((await call("GET", `${PATH}?status=draft`)).body.items.every((item: { status: string }) => item.status === "draft")).toBe(true);
    expect((await call("GET", `${PATH}?category=Career`)).body.items.map((item: { category: string }) => item.category)).toEqual(["Career"]);
    expect((await call("GET", `${PATH}?q=ptn`)).body.items).toHaveLength(1);
    expect((await call("GET", `${PATH}?status=archived`)).status).toBe(400);
    expect((await call("GET", `${PATH}?sort=contentMarkdown`)).status).toBe(400);
  });

  test("the minimum of the excerpt is for a text the writer changes: a stored excerpt under it stays valid, like the Worker", async () => {
    const { call, rows } = mock();
    const created = await call("POST", PATH, valid);
    const id = created.body.item.id as string;
    // As if it had come from the import: an excerpt of 14 characters.
    rows().find((row) => row.id === id)!.excerpt = "Manajemen, UGM";
    const save = async (excerpt: string, extra: Record<string, unknown> = {}) => {
      const current = rows().find((row) => row.id === id)!;
      return call("PUT", `${PATH}/${id}`, { ...valid, excerpt, ...extra }, { "If-Match": ifMatch(current.updatedAt) });
    };

    expect((await save("Manajemen, UGM", { title: "Judul lain" })).status).toBe(200);
    expect((await save("  Manajemen, UGM  ", { title: "Judul lain lagi" })).status).toBe(200);
    for (const excerpt of ["Manajemen", "x", "   "]) {
      const refused = await save(excerpt);
      expect(refused.status, excerpt).toBe(400);
      expect(refused.body.fields, excerpt).toEqual({ excerpt: "Excerpt minimal 20 karakter" });
    }
    expect((await save("Manajemen, Universitas Gadjah Mada")).status).toBe(200);
    // A new article never gets the exception.
    const fresh = await call("POST", PATH, { ...valid, excerpt: "Manajemen, UGM" });
    expect(fresh.status).toBe(400);
    expect(fresh.body.fields).toEqual({ excerpt: "Excerpt minimal 20 karakter" });
  });

  // SAKEM-094: the SAME table of cases the Worker's tests run against the real routes (blog-meta-cases.ts), so the mock
  // cannot say yes where the Worker says no, or the other way round.
  test("the meta description: every case of the shared matrix gets the answer the Worker gives", async () => {
    const { call, rows } = mock();
    const before = rows().length;
    let written = 0;
    for (const entry of META_CASES) {
      const res = await call("POST", PATH, { ...valid, metaDescription: entry.input });
      if ("stored" in entry) {
        expect(res.status, entry.name).toBe(201);
        written += 1;
        expect(res.body.item.metaDescription, entry.name).toBe(entry.stored);
      } else {
        expect(res.status, entry.name).toBe(400);
        expect(res.body.fields, entry.name).toEqual({ metaDescription: entry.refused });
      }
    }
    expect(rows()).toHaveLength(before + written);
    // And on an update.
    const item = (await call("POST", PATH, { ...valid, metaDescription: "Awal." })).body.item;
    for (const entry of META_CASES) {
      if (!("refused" in entry)) continue;
      const res = await call("PUT", `${PATH}/${item.id}`, { ...valid, metaDescription: entry.input }, { "If-Match": ifMatch(item.updatedAt) });
      expect(res.status, entry.name).toBe(400);
      expect(res.body.fields, entry.name).toEqual({ metaDescription: entry.refused });
    }
  });

  test("the meta description: a create without it has none; an update that leaves the key out keeps it, null, empty or spaces clear it", async () => {
    const { call, rows } = mock();
    expect((await call("POST", PATH, valid)).body.item.metaDescription).toBeNull();
    const item = (await call("POST", PATH, { ...valid, metaDescription: "Teks untuk mesin pencari." })).body.item;
    const save = async (extra: Record<string, unknown>) => {
      const current = rows().find((row) => row.id === item.id)!;
      return call("PUT", `${PATH}/${item.id}`, { ...valid, ...extra }, { "If-Match": ifMatch(current.updatedAt) });
    };
    expect((await save({ title: "Judul lain" })).body.item).toMatchObject({ title: "Judul lain", metaDescription: "Teks untuk mesin pencari." });
    expect((await save({ title: "Judul lain", metaDescription: "  Teks   baru " })).body.item.metaDescription).toBe("Teks baru");
    const version = rows().find((row) => row.id === item.id)!.updatedAt;
    expect((await save({ title: "Judul lain", metaDescription: "Teks baru" })).body.item.updatedAt).toBe(version); // the same text: no new version
    for (const empty of [null, "", "  \n "]) {
      await save({ title: "Judul lain", metaDescription: "Ada isinya." });
      expect((await save({ title: "Judul lain", metaDescription: empty })).body.item.metaDescription, JSON.stringify(empty)).toBeNull();
    }
  });

  test("the meta description: the one an article already has stays valid whatever its length; a different long text, and any text on a create, must fit", async () => {
    const { call, rows } = mock();
    const long = "Sakola Kembara membuka pintu pendidikan tinggi bagi siswa dari daerah terpencil. ".repeat(7).slice(0, 562).trim();
    const item = (await call("POST", PATH, valid)).body.item;
    rows().find((row) => row.id === item.id)!.metaDescription = long; // as if it had come from the import
    const save = async (extra: Record<string, unknown>) => {
      const current = rows().find((row) => row.id === item.id)!;
      return call("PUT", `${PATH}/${item.id}`, { ...valid, ...extra }, { "If-Match": ifMatch(current.updatedAt) });
    };
    expect((await save({ title: "Judul lain", metaDescription: long })).status).toBe(200);
    expect((await save({ title: "Judul lain", metaDescription: `  ${long.replace(" ", "   ")} ` })).status).toBe(200);
    const longer = await save({ metaDescription: `${long} Tambahan.` });
    expect(longer.status).toBe(400);
    expect(longer.body.fields).toEqual({ metaDescription: "Deskripsi meta maksimal 300 karakter" });
    expect((await save({ metaDescription: "Dipendekkan." })).status).toBe(200);
    expect((await save({ metaDescription: long })).status).toBe(400);
    expect((await call("POST", PATH, { ...valid, metaDescription: long })).status).toBe(400);
  });

  test("every article of the seed carries the field, and one has a description to look at", async () => {
    const { call } = mock();
    const list = await call("GET", `${PATH}?pageSize=100`);
    const first = list.body.items[0].id as string;
    const articles = await Promise.all(list.body.items.map(async (item: { id: string }) => (await call("GET", `${PATH}/${item.id}`)).body.item as Record<string, unknown>));
    expect(articles.every((article) => "metaDescription" in article)).toBe(true);
    expect(articles.filter((article) => article.metaDescription).length).toBeGreaterThanOrEqual(1);
    expect(first).toBeTruthy();
  });

  test("creates a draft with a slug made from the title, numbered when taken, or the one given", async () => {
    const { call } = mock();
    const first = await call("POST", PATH, valid);
    expect(first.status).toBe(201);
    expect(first.body.item).toMatchObject({ slug: "judul-artikel-contoh", status: "draft", date: null });
    expect((await call("POST", PATH, valid)).body.item.slug).toBe("judul-artikel-contoh-2");
    expect((await call("POST", PATH, { ...valid, slug: "Pilihan-Saya" })).body.item.slug).toBe("pilihan-saya");
    const taken = await call("POST", PATH, { ...valid, slug: "pilihan-saya" });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ error: "conflict", fields: { slug: "Slug sudah dipakai" } });
  });

  test("refuses the legacy rules with the legacy messages", async () => {
    const { call } = mock();
    const refused = await call("POST", PATH, { ...valid, title: "ab", excerpt: "pendek", contentMarkdown: "pendek", author: "D", category: "Berita", date: "2026-02-31", slug: "Salah Slug" });
    expect(refused.status).toBe(400);
    expect(refused.body.fields).toEqual({
      title: "Judul minimal 3 karakter",
      slug: "Slug hanya boleh huruf kecil, angka, dan tanda hubung",
      excerpt: "Excerpt minimal 20 karakter",
      contentMarkdown: "Isi minimal 50 karakter",
      author: "Wajib diisi",
      category: "Kategori tidak dikenal",
      date: "Format harus YYYY-MM-DD",
    });
    expect((await call("POST", PATH, { ...valid, contentMarkdown: "x".repeat(LIMITS.bodyMax + 1) })).body.fields).toEqual({ contentMarkdown: "Isi maksimal 12.000 karakter" });
  });

  test("an update needs If-Match, refuses a stale one, writes nothing when nothing changed, and locks the slug once published", async () => {
    const { call, rows } = mock();
    const item = (await call("POST", PATH, { ...valid, date: "2026-03-04" })).body.item;
    expect((await call("PUT", `${PATH}/${item.id}`, valid)).status).toBe(428);

    const first = await call("PUT", `${PATH}/${item.id}`, { ...valid, date: "2026-03-04", title: "Judul Baru" }, { "If-Match": ifMatch(item.updatedAt) });
    expect(first.status).toBe(200);
    expect(first.body.item.updatedAt > item.updatedAt).toBe(true);
    const stale = await call("PUT", `${PATH}/${item.id}`, { ...valid, date: "2026-03-04", title: "Lagi" }, { "If-Match": ifMatch(item.updatedAt) });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("stale");

    const same = await call("PUT", `${PATH}/${item.id}`, { ...valid, date: "2026-03-04", title: "Judul Baru" }, { "If-Match": ifMatch(first.body.item.updatedAt) });
    expect(same.body.item.updatedAt).toBe(first.body.item.updatedAt);

    const published = await call("POST", `${PATH}/${item.id}/publish`, undefined, { "If-Match": ifMatch(first.body.item.updatedAt) });
    expect(published.body.item).toMatchObject({ status: "published", date: "2026-03-04" });
    const locked = await call("PUT", `${PATH}/${item.id}`, { ...valid, date: "2026-03-04", title: "Judul Baru", slug: "slug-lain" }, { "If-Match": ifMatch(published.body.item.updatedAt) });
    expect(locked.body.fields).toEqual({ slug: "Slug tidak bisa diubah setelah artikel terbit" });
    const dateless = await call("PUT", `${PATH}/${item.id}`, { ...valid, date: null, title: "Judul Baru" }, { "If-Match": ifMatch(published.body.item.updatedAt) });
    expect(dateless.body.fields).toEqual({ date: "Format harus YYYY-MM-DD" });
    expect(rows().find((row) => row.id === item.id)?.status).toBe("published");
  });

  test("publish dates an undated draft today, unpublish keeps the date, both need the current version", async () => {
    const { call } = mock();
    const item = (await call("POST", PATH, valid)).body.item;
    expect((await call("POST", `${PATH}/${item.id}/publish`)).status).toBe(428);
    const out = await call("POST", `${PATH}/${item.id}/publish`, undefined, { "If-Match": ifMatch(item.updatedAt) });
    expect(out.body.item.status).toBe("published");
    expect(out.body.item.date).toBe(new Date().toISOString().slice(0, 10));
    expect((await call("POST", `${PATH}/${item.id}/unpublish`, undefined, { "If-Match": ifMatch(item.updatedAt) })).status).toBe(409);
    const back = await call("POST", `${PATH}/${item.id}/unpublish`, undefined, { "If-Match": ifMatch(out.body.item.updatedAt) });
    expect(back.body.item).toMatchObject({ status: "draft", date: out.body.item.date });
    expect((await call("POST", `${PATH}/missing/publish`, undefined, { "If-Match": '"x"' })).status).toBe(404);
  });

  test("the preview is a stand-in renderer that escapes what a writer typed", async () => {
    const { call } = mock();
    const out = await call("POST", `${PATH}/preview`, { contentMarkdown: "## Judul\n\nIsi **tebal** dan <script>alert(1)</script>\n\n- satu\n- dua" });
    expect(out.status).toBe(200);
    expect(out.body.html).toContain("<h2>Judul</h2>");
    expect(out.body.html).toContain("<strong>tebal</strong>");
    expect(out.body.html).toContain("&lt;script&gt;");
    expect(out.body.html).not.toContain("<script>");
    expect(out.body.html).toContain("<ul><li>satu</li><li>dua</li></ul>");
    expect((await call("POST", `${PATH}/preview`, { contentMarkdown: "x".repeat(LIMITS.bodyMax + 1) })).status).toBe(400);
  });

  test("a viewer reads everything and writes nothing; another area sees nothing", async () => {
    const viewer = mock("read");
    expect((await viewer.call("GET", PATH)).status).toBe(200);
    const row = viewer.rows()[0]!;
    expect((await viewer.call("GET", `${PATH}/${row.id}`)).status).toBe(200);
    for (const [method, path] of [["POST", PATH], ["PUT", `${PATH}/${row.id}`], ["DELETE", `${PATH}/${row.id}`], ["POST", `${PATH}/${row.id}/publish`], ["POST", `${PATH}/${row.id}/unpublish`], ["POST", `${PATH}/preview`]] as const) {
      expect((await viewer.call(method, path, valid, { "If-Match": ifMatch(row.updatedAt) })).status, `${method} ${path}`).toBe(403);
    }
    const nobody = mock("none");
    expect((await nobody.call("GET", PATH)).status).toBe(403);
    expect((await nobody.call("POST", `${PATH}/preview`, { contentMarkdown: "x" })).status).toBe(403);
  });

  test("delete is the generic one: 204, then gone", async () => {
    const { call } = mock();
    const item = (await call("POST", PATH, valid)).body.item;
    expect((await call("DELETE", `${PATH}/${item.id}`)).status).toBe(204);
    expect((await call("GET", `${PATH}/${item.id}`)).status).toBe(404);
  });
});
