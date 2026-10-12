import { afterEach, describe, expect, test } from "vitest";
import { BODY_MAX, EXCERPT_MAX, EXCERPT_MIN, AUTHOR_MAX, AUTHOR_MIN, BODY_MIN, SLUG_MAX, startOfIsoDayJakarta, TITLE_MAX, TITLE_MIN } from "../src/blog/rules";
import { blogCategories } from "../src/db/schema";
import { longDateJakarta } from "../src/public/dates";
import { api, setTransport } from "../spa/src/lib/api";
import { parseListQuery, toApiQuery } from "../spa/src/lib/crud/query";
import { ifMatch } from "../spa/src/lib/crud/etag";
import { API_PATH, type BlogItem, FIELD_TAB, LIST_SPEC, PREVIEW_PATH, toBody, toValues } from "../spa/src/pages/blog/form";
import { BLOG_CATEGORIES, BODY_LIMIT_LABEL, defaultAuthor, formatIsoDay, LIMITS } from "../spa/src/pages/blog/rules";
import { call, signedInCookie, uniqueEmail } from "./helpers";

// What the SPA's blog screens send and expect, checked against the real Worker in workerd (the SPA tests stub the API,
// so these are what keep the two sides honest): the limits and categories the form shows, the date it writes, the
// body it sends for a save, the query of its list and the names of its fields. Same idea as crud-spa-contract.test.ts.

afterEach(() => setTransport(null));

function over(cookie: string) {
  setTransport(async (path, init) => call(path, { method: init.method, headers: init.headers as Record<string, string> | undefined, body: init.body as string | undefined, cookie }));
}

describe("the numbers and lists the form shows are the Worker's", () => {
  test("limits", () => {
    expect(LIMITS).toEqual({ titleMin: TITLE_MIN, titleMax: TITLE_MAX, excerptMin: EXCERPT_MIN, excerptMax: EXCERPT_MAX, bodyMin: BODY_MIN, bodyMax: BODY_MAX, authorMin: AUTHOR_MIN, authorMax: AUTHOR_MAX, slugMax: SLUG_MAX });
  });

  test("categories", () => {
    expect([...BLOG_CATEGORIES]).toEqual([...blogCategories]);
  });

  test("the Worker's message about the body limit is written with the SPA's label of it", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["konten"]);
    over(cookie);
    const result = await api<unknown>(API_PATH, { method: "POST", json: { ...toBody(toValues(null)), title: "Judul sah", excerpt: "x".repeat(30), author: "Dzul", contentMarkdown: "x".repeat(BODY_MAX + 1) } });
    expect(result).toMatchObject({ ok: false, status: 400, fields: { contentMarkdown: `Isi maksimal ${BODY_LIMIT_LABEL} karakter` } });
    const preview = await api<unknown>(PREVIEW_PATH, { method: "POST", json: { contentMarkdown: "x".repeat(BODY_MAX + 1) } });
    expect(preview).toMatchObject({ ok: false, status: 400, fields: { contentMarkdown: `Isi maksimal ${BODY_LIMIT_LABEL} karakter` } });
  });

  test("the long date is the one the public API computes for the same day, for every month", () => {
    for (const day of ["2026-01-01", "2026-02-28", "2026-03-15", "2026-04-30", "2026-05-21", "2026-06-06", "2026-07-17", "2026-08-17", "2026-09-09", "2026-10-12", "2026-11-30", "2026-12-31", "2024-02-29"]) {
      expect(formatIsoDay(day), day).toBe(longDateJakarta(startOfIsoDayJakarta(day).getTime()));
    }
  });

  test("a new article's author is made from the email like the legacy page did", () => {
    expect(defaultAuthor("nama.depan@contoh.test")).toBe("nama depan");
  });
});

describe("what the form sends is what the Worker takes", () => {
  test("the list: every filter and sort of the spec, ascending and descending, is accepted", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    over(cookie);
    const values: Record<string, string> = { status: "draft", category: "Tips" };
    for (const filter of LIST_SPEC.filters ?? []) {
      const query = parseListQuery(new URLSearchParams({ [filter]: values[filter]! }), LIST_SPEC);
      expect((await api(`${API_PATH}?${toApiQuery(query, LIST_SPEC)}`)).ok, filter).toBe(true);
    }
    for (const sort of LIST_SPEC.sorts ?? []) {
      for (const direction of ["", "-"]) {
        const query = parseListQuery(new URLSearchParams({ sort: `${direction}${sort}` }), LIST_SPEC);
        expect((await api(`${API_PATH}?${toApiQuery(query, LIST_SPEC)}`)).ok, `${direction}${sort}`).toBe(true);
      }
    }
    expect((await api(`${API_PATH}?${toApiQuery(parseListQuery(new URLSearchParams(), LIST_SPEC), LIST_SPEC)}`)).ok).toBe(true);
  });

  test("a create, then the item the Worker answers opened in the form and saved unchanged, then published and saved again", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["konten"]);
    over(cookie);
    const typed = { ...toValues(null, "dzul@sakolakembara.org"), title: "Cara Belajar yang Efektif", excerpt: "Ringkasan artikel tentang cara belajar yang efektif.", contentMarkdown: "## Mulai\n\nBuat jadwal belajar harian dan patuhi dengan **disiplin** setiap hari." };
    const created = await api<{ item: BlogItem }>(API_PATH, { method: "POST", json: toBody(typed) });
    if (!created.ok) throw new Error(JSON.stringify(created));
    const item = created.data.item;
    expect(item).toMatchObject({ slug: "cara-belajar-yang-efektif", status: "draft", author: "dzul", category: "Cerita", date: null, image: null });

    // What the edit page does: GET, fill the form, press Simpan with nothing changed.
    const opened = await api<{ item: BlogItem }>(`${API_PATH}/${item.id}`);
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    const same = await api<{ item: BlogItem }>(`${API_PATH}/${item.id}`, { method: "PUT", json: toBody(toValues(opened.data.item)), ifMatch: ifMatch(opened.data.item.updatedAt) });
    expect(same).toMatchObject({ ok: true, data: { item: { updatedAt: item.updatedAt } } });

    // Publish what was loaded (a clean form), then open it again as a published article and save: slug and date go along.
    const published = await api<{ item: BlogItem }>(`${API_PATH}/${item.id}/publish`, { method: "POST", ifMatch: ifMatch(item.updatedAt) });
    if (!published.ok) throw new Error(JSON.stringify(published));
    expect(published.data.item.status).toBe("published");
    expect(published.data.item.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const again = await api<{ item: BlogItem }>(`${API_PATH}/${item.id}`, { method: "PUT", json: toBody({ ...toValues(published.data.item), title: "Judul Berubah" }), ifMatch: ifMatch(published.data.item.updatedAt) });
    expect(again).toMatchObject({ ok: true, data: { item: { title: "Judul Berubah", status: "published", slug: item.slug } } });
  });

  test("every field the Worker can complain about has a tab in the form, so no error can be hidden", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["konten"]);
    over(cookie);
    const refused = await api<unknown>(API_PATH, {
      method: "POST",
      json: { title: "x", slug: "Salah Slug", category: "Berita", excerpt: "x", contentMarkdown: "x", author: "x", featured: false, date: "bukan-tanggal", image: "javascript:alert(1)" },
    });
    if (refused.ok) throw new Error("the Worker took a form full of mistakes");
    const names = Object.keys(refused.fields ?? {});
    expect(names.sort()).toEqual(["author", "category", "contentMarkdown", "date", "excerpt", "image", "slug", "title"]);
    for (const name of names) expect(FIELD_TAB[name], name).toBeDefined();
  });
});
