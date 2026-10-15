import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test } from "vitest";
import { BODY_MAX, EXCERPT_MAX, EXCERPT_MIN, AUTHOR_MAX, AUTHOR_MIN, BODY_MIN, cleanMetaDescription, hasMarkup, META_DESCRIPTION_IDEAL, META_DESCRIPTION_MAX, SLUG_MAX, startOfIsoDayJakarta, TITLE_MAX, TITLE_MIN } from "../src/blog/rules";
import { blogCategories } from "../src/db/schema";
import { longDateJakarta } from "../src/public/dates";
import { api, setTransport } from "../spa/src/lib/api";
import { parseListQuery, toApiQuery } from "../spa/src/lib/crud/query";
import { ifMatch } from "../spa/src/lib/crud/etag";
import { API_PATH, type BlogItem, type BlogValues, FIELD_TAB, LIST_SPEC, PREVIEW_PATH, toBody, toValues } from "../spa/src/pages/blog/form";
import { BLOG_CATEGORIES, BODY_LIMIT_LABEL, cleanMetaDescription as spaClean, defaultAuthor, formatIsoDay, hasMarkup as spaHasMarkup, LIMITS, META_DESCRIPTION_IDEAL as SPA_IDEAL } from "../spa/src/pages/blog/rules";
import { META_CASES } from "../spa/test/blog-meta-cases";
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
    expect(LIMITS).toEqual({ titleMin: TITLE_MIN, titleMax: TITLE_MAX, excerptMin: EXCERPT_MIN, excerptMax: EXCERPT_MAX, bodyMin: BODY_MIN, bodyMax: BODY_MAX, authorMin: AUTHOR_MIN, authorMax: AUTHOR_MAX, slugMax: SLUG_MAX, metaDescriptionMax: META_DESCRIPTION_MAX });
  });

  test("the guidance the form gives for the meta description is the Worker's constant", () => {
    expect(SPA_IDEAL).toEqual(META_DESCRIPTION_IDEAL);
  });

  test("the form's copy of the meta description's cleaning is the Worker's: same result for every case of the shared matrix and for every single character", () => {
    for (const entry of META_CASES) {
      if (typeof entry.input !== "string") continue;
      expect(spaClean(entry.input), entry.name).toBe(cleanMetaDescription(entry.input));
      expect(spaHasMarkup(spaClean(entry.input)), entry.name).toBe(hasMarkup(cleanMetaDescription(entry.input)));
      // What the form counts is what is stored (for an accepted text), so the counter never lies.
      if ("stored" in entry) expect(spaClean(entry.input), entry.name).toBe(entry.stored ?? "");
    }
    for (let unit = 0; unit < 0x3100; unit++) {
      const text = `a${String.fromCharCode(unit)}b`;
      const cleaned = cleanMetaDescription(text);
      expect(spaClean(text), `U+${unit.toString(16)}`).toBe(cleaned);
      // Whatever is left is visible: no control, format or surrogate character, no run of spaces, no space at the ends.
      expect(cleaned, `U+${unit.toString(16)}`).not.toMatch(/[\p{Cc}\p{Cf}\p{Cs}]|\s\s|^\s|\s$/u);
    }
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
    const typed = { ...toValues(null, "dzul@contoh.test"), title: "Cara Belajar yang Efektif", metaDescription: "  Cara belajar yang efektif   untuk siswa.  ", excerpt: "Ringkasan artikel tentang cara belajar yang efektif.", contentMarkdown: "## Mulai\n\nBuat jadwal belajar harian dan patuhi dengan **disiplin** setiap hari." };
    const created = await api<{ item: BlogItem }>(API_PATH, { method: "POST", json: toBody(typed) });
    if (!created.ok) throw new Error(JSON.stringify(created));
    const item = created.data.item;
    expect(item).toMatchObject({ slug: "cara-belajar-yang-efektif", status: "draft", author: "dzul", category: "Cerita", date: null, image: null, metaDescription: "Cara belajar yang efektif untuk siswa." });

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

  test("an article stored with an excerpt under the minimum (the import's daffa-najwan) is saved from the form as it is, and refused when the writer shortens it", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["konten"]);
    over(cookie);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO blog_posts (id, slug, title, excerpt, content_markdown, content_html, category, author, featured, status, published_at, created_at, updated_at) VALUES (?, 'pendek', 'Daffa Najwan', 'Manajemen, UGM', ?, '<p>isi</p>', 'Testimonials', 'Daffa', 0, 'published', ?, 1000, 1000)",
    )
      .bind(id, "Kalimat testimoni yang cukup panjang untuk memenuhi batas lima puluh karakter isi.", Date.parse("2025-03-04T00:00:00Z"))
      .run();

    const opened = await api<{ item: BlogItem }>(`${API_PATH}/${id}`);
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    expect(opened.data.item.excerpt).toBe("Manajemen, UGM");
    const send = (values: ReturnType<typeof toValues>) => api<{ item: BlogItem }>(`${API_PATH}/${id}`, { method: "PUT", json: toBody(values), ifMatch: ifMatch(opened.data.item.updatedAt) });

    expect(await send(toValues(opened.data.item))).toMatchObject({ ok: true });
    expect(await send({ ...toValues(opened.data.item), title: "Daffa Najwan, UGM" })).toMatchObject({ ok: true, data: { item: { title: "Daffa Najwan, UGM", excerpt: "Manajemen, UGM" } } });
    // (The save above moved the version: open it again, as the form would after a reload.)
    const reopened = await api<{ item: BlogItem }>(`${API_PATH}/${id}`);
    if (!reopened.ok) throw new Error(JSON.stringify(reopened));
    const shortened = await api<unknown>(`${API_PATH}/${id}`, { method: "PUT", json: toBody({ ...toValues(reopened.data.item), excerpt: "Manajemen" }), ifMatch: ifMatch(reopened.data.item.updatedAt) });
    if (shortened.ok) throw new Error("the Worker took a shorter excerpt");
    expect(shortened.fields).toEqual({ excerpt: "Excerpt minimal 20 karakter" });
  });

  test("the meta description as the form sends it: a typed text is stored cleaned, an emptied field (null in the body) clears it, and a long stored one is saved from the form as it is", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["konten"]);
    over(cookie);
    const long = "Sakola Kembara membuka pintu pendidikan tinggi bagi siswa dari daerah terpencil. ".repeat(7).slice(0, 562).trim();
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO blog_posts (id, slug, title, excerpt, meta_description, content_markdown, content_html, category, author, featured, status, published_at, created_at, updated_at) VALUES (?, 'panjang', 'Artikel panjang', 'Ringkasan yang cukup panjang untuk contoh.', ?, ?, '<p>isi</p>', 'News', 'Tim', 0, 'published', ?, 1000, 1000)",
    )
      .bind(id, long, "Kalimat isi yang cukup panjang untuk memenuhi batas lima puluh karakter isi.", Date.parse("2025-03-04T00:00:00Z"))
      .run();

    const reopen = async () => {
      const opened = await api<{ item: BlogItem }>(`${API_PATH}/${id}`);
      if (!opened.ok) throw new Error(JSON.stringify(opened));
      return opened.data.item;
    };
    const send = async (changes: Partial<BlogValues>) => {
      const item = await reopen();
      return api<{ item: BlogItem }>(`${API_PATH}/${id}`, { method: "PUT", json: toBody({ ...toValues(item), ...changes } as BlogValues), ifMatch: ifMatch(item.updatedAt) });
    };

    // The form opens it with the whole text and saves it back as it is (over 300 characters, but it is the stored one).
    expect((await reopen()).metaDescription).toBe(long);
    expect(toBody(toValues(await reopen())).metaDescription).toBe(long);
    expect(await send({ title: "Artikel panjang, disunting" })).toMatchObject({ ok: true, data: { item: { metaDescription: long, title: "Artikel panjang, disunting" } } });

    // A text typed over it is cleaned; the length of the cleaned text is what counts.
    expect(await send({ metaDescription: `  ${"kata ".repeat(40)}  ` })).toMatchObject({ ok: true, data: { item: { metaDescription: "kata ".repeat(40).trim() } } });
    const tooLong = await send({ metaDescription: "kata ".repeat(70) });
    if (tooLong.ok) throw new Error("the Worker took 349 characters");
    expect(tooLong.fields).toEqual({ metaDescription: "Deskripsi meta maksimal 300 karakter" });

    // An emptied field sends null, which clears it; sending the form again changes nothing.
    expect(toBody({ ...toValues(await reopen()), metaDescription: "" }).metaDescription).toBeNull();
    expect(await send({ metaDescription: "" })).toMatchObject({ ok: true, data: { item: { metaDescription: null } } });
    const cleared = await reopen();
    expect(await send({ metaDescription: "" })).toMatchObject({ ok: true, data: { item: { updatedAt: cleared.updatedAt } } });
  });

  test("every field the Worker can complain about has a tab in the form, so no error can be hidden", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["konten"]);
    over(cookie);
    const refused = await api<unknown>(API_PATH, {
      method: "POST",
      json: { title: "x", slug: "Salah Slug", category: "Berita", excerpt: "x", metaDescription: "<b>x</b>", contentMarkdown: "x", author: "x", featured: false, date: "bukan-tanggal", image: "javascript:alert(1)" },
    });
    if (refused.ok) throw new Error("the Worker took a form full of mistakes");
    const names = Object.keys(refused.fields ?? {});
    expect(names.sort()).toEqual(["author", "category", "contentMarkdown", "date", "excerpt", "image", "metaDescription", "slug", "title"]);
    for (const name of names) expect(FIELD_TAB[name], name).toBeDefined();
  });
});
