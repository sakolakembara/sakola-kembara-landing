import { env } from "cloudflare:workers";
import { describe, expect, inject, test } from "vitest";
import { sqlText } from "../scripts/import-legacy-blog";
import { renderArticle } from "../src/blog/render";
import { ARTICLE_COUNT, call, signedInCookie, uniqueEmail } from "./helpers";
import { internalFetch } from "./public-helpers";

// The import of the migrated articles, 80 + the 6 imported on 2026-10-13 (scripts/import-legacy-blog.ts, docs/cloudflare/admin-blog.md#import-of-the-80-migrated-articles).
//
// The SQL the script writes is run against the real local D1 of the test, and then the PUBLIC API (through the
// `PublicApi` entrypoint, the way the site reaches it) is compared with the answers of cf/web's fixture API for the
// same articles (`inject("blogOracle")`, test/global/blog-oracle.ts): the index at two page sizes and every article
// with its `related`, titles, slugs, dates, excerpts, covers, sizes, HTML and markdown, deep-equal, for every article.

const oracle = inject("blogOracle");

async function runImport() {
  await env.DB.exec(oracle.importSql);
}

async function count() {
  return (await env.DB.prepare("SELECT count(*) AS n FROM blog_posts").first<{ n: number }>())!.n;
}

/** JSON with the keys of every object sorted, so two answers compare equal whatever order their keys came in. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (v !== null && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
}

async function publicJson(path: string) {
  const res = await internalFetch(path);
  expect(res.status, path).toBe(200);
  return res.json();
}

describe("the SQL of the import", () => {
  const statements = oracle.importSql.trimEnd().split("\n");

  test("is one statement per line (what the importers and D1's exec read), each an upsert by slug, under D1's size limit", () => {
    expect(statements).toHaveLength(ARTICLE_COUNT);
    for (const statement of statements) {
      expect(statement.startsWith("INSERT INTO blog_posts (")).toBe(true);
      expect(statement.endsWith(";")).toBe(true);
      expect(statement).toContain("ON CONFLICT(slug) DO UPDATE SET");
      expect(statement.length).toBeLessThan(95_000);
    }
    // Nothing that removes or reshapes: every line is the one INSERT (the words of an article can say "drop" or "alter").
    expect(statements.every((statement) => /^INSERT INTO blog_posts \([a-z_, ]+\) VALUES \(/.test(statement))).toBe(true);
  });

  test("a text literal survives quotes, newlines, semicolons, comments markers, backslashes and emoji exactly", async () => {
    for (const value of ["", "O'Brien's \"quote\"", "satu\ndua\r\ntiga\rempat", "a; DROP TABLE users; --", "/* x */ -- y", "back\\slash\\n", "🙂 日本語 café", "'", "''", "\n", "\n\n x \n"]) {
      const row = await env.DB.prepare(`SELECT ${sqlText(value)} AS v`).first<{ v: string }>();
      expect(row!.v, JSON.stringify(value)).toBe(value);
    }
  });
});

describe("after the import, the public API answers exactly as the fixture API does", () => {
  test("imports every article (80 migrated + 6 imported on 2026-10-13), all published", async () => {
    await runImport();
    expect(await count()).toBe(ARTICLE_COUNT);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM blog_posts WHERE status = 'published'").first()).toEqual({ n: ARTICLE_COUNT });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM blog_posts WHERE featured = 1").first()).toEqual({ n: 1 });
  });

  test("the index, page by page, at the default page size and at the sitemap's", async () => {
    await runImport();
    const keys = Object.keys(oracle.lists);
    expect(keys.length).toBeGreaterThan(7); // 6 pages of 15, 2 of 50
    for (const key of keys) {
      const [pageSize, page] = key.split(":");
      expect(await publicJson(`/api/public/blog?page=${page}&pageSize=${pageSize}`), `page ${page} of ${pageSize}`).toEqual(oracle.lists[key]);
    }
  });

  test("every article, with its related ones: titles, slugs, dates, cover, HTML, markdown", async () => {
    await runImport();
    expect(Object.keys(oracle.payloads)).toHaveLength(ARTICLE_COUNT);
    const wrong: string[] = [];
    for (const article of oracle.articles) {
      const live = await publicJson(`/api/public/blog/${article.slug}`);
      if (canonical(live) !== canonical(oracle.payloads[article.slug])) wrong.push(article.slug);
    }
    expect(wrong).toEqual([]);
    // And not only equal as JSON text: deep-equal for one with images and one without, for a readable failure.
    const withImages = oracle.articles.find((a) => a.html.includes("srcset="))!;
    expect(await publicJson(`/api/public/blog/${withImages.slug}`)).toEqual(oracle.payloads[withImages.slug]);
  });

  test("the HTML of an inline image keeps its srcset, sizes, width and height", async () => {
    await runImport();
    const withImages = oracle.articles.filter((a) => a.html.includes(' srcset="'));
    expect(withImages.length).toBeGreaterThan(10);
    for (const article of withImages) {
      const stored = (await env.DB.prepare("SELECT content_html FROM blog_posts WHERE slug = ?").bind(article.slug).first<{ content_html: string }>())!.content_html;
      expect(stored).toBe(article.html);
    }
  });

  test("an unknown or an unpublished slug is the contract's 404", async () => {
    await runImport();
    expect((await internalFetch("/api/public/blog/tidak-ada")).status).toBe(404);
    await env.DB.prepare("UPDATE blog_posts SET status = 'draft' WHERE slug = ?").bind(oracle.articles[0]!.slug).run();
    expect((await internalFetch(`/api/public/blog/${oracle.articles[0]!.slug}`)).status).toBe(404);
  });
});

describe("the meta description (SAKEM-090)", () => {
  test("each article's front matter `description` is stored, and an article without one stores NULL", async () => {
    await runImport();
    const without: string[] = [];
    for (const article of oracle.articles) {
      const expected = String(article.meta.description ?? "") || null;
      if (!expected) without.push(article.slug);
      const row = await env.DB.prepare("SELECT meta_description AS d FROM blog_posts WHERE slug = ?").bind(article.slug).first<{ d: string | null }>();
      expect(row!.d, article.slug).toBe(expected);
    }
    expect(without).toEqual(["daffa-najwan"]); // its live description was not one ("Manajemen, UGM")
  });

  test("the public article answer carries it (the fixture answers, deep-equal, are in the test above), and null where there is none", async () => {
    await runImport();
    const withOne = oracle.articles.find((a) => a.meta.description)!;
    const without = oracle.articles.find((a) => !a.meta.description)!;
    expect(((await publicJson(`/api/public/blog/${withOne.slug}`)) as { article: { description: string } }).article.description).toBe(withOne.meta.description);
    expect(((await publicJson(`/api/public/blog/${without.slug}`)) as { article: { description: unknown } }).article.description).toBeNull();
  });

  test("an editor's save in the admin keeps it (the form sends it back as the admin read gave it; a client that leaves the key out does not erase it either), and a second import does not put the file's back over an edited article", async () => {
    await runImport();
    const article = oracle.articles.find((a) => a.meta.description)!;
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["konten"]);
    const item = (await env.DB.prepare("SELECT id FROM blog_posts WHERE slug = ?").bind(article.slug).first<{ id: string }>())!;
    const opened = ((await (await call(`/api/admin/blog/${item.id}`, { cookie })).json()) as { item: Record<string, unknown> }).item;
    expect(opened.metaDescription).toBe(article.meta.description); // the admin read carries it (SAKEM-094)
    const put = await call(`/api/admin/blog/${item.id}`, { method: "PUT", cookie, headers: { "if-match": `"${String(opened.updatedAt)}"` }, json: { ...opened, title: "Judul baru" } });
    expect(put.status).toBe(200);
    const description = () => env.DB.prepare("SELECT meta_description AS d FROM blog_posts WHERE slug = ?").bind(article.slug).first<{ d: string | null }>();
    expect((await description())!.d).toBe(article.meta.description);
    // A body without the key (a browser tab of the SPA from before the field existed) does not erase it.
    const { metaDescription: _left, ...without } = opened;
    const reopened = ((await (await call(`/api/admin/blog/${item.id}`, { cookie })).json()) as { item: Record<string, unknown> }).item;
    const bare = await call(`/api/admin/blog/${item.id}`, { method: "PUT", cookie, headers: { "if-match": `"${String(reopened.updatedAt)}"` }, json: { ...without, title: "Judul baru lagi" } });
    expect(bare.status).toBe(200);
    expect((await description())!.d).toBe(article.meta.description);
    // an operator who changed the text by hand: the edited article is not touched by another import
    await env.DB.prepare("UPDATE blog_posts SET meta_description = 'Diubah tangan' WHERE slug = ?").bind(article.slug).run();
    await runImport();
    expect((await description())!.d).toBe("Diubah tangan");
  });
});

describe("running the import again", () => {
  test("changes nothing: same rows, same ids, same answers", async () => {
    await runImport();
    const before = (await env.DB.prepare("SELECT id, slug, updated_at, content_html FROM blog_posts ORDER BY slug").all()).results;
    await runImport();
    await runImport();
    const after = (await env.DB.prepare("SELECT id, slug, updated_at, content_html FROM blog_posts ORDER BY slug").all()).results;
    expect(after).toEqual(before);
    expect(await publicJson("/api/public/blog?page=1&pageSize=15")).toEqual(oracle.lists["15:1"]);
  });

  test("restores a row nobody edited, and leaves an article an editor changed in the admin alone", async () => {
    await runImport();
    const [first, second] = oracle.articles;
    // A raw change (what a bad earlier import might have left): the import puts it right.
    await env.DB.prepare("UPDATE blog_posts SET title = 'RUSAK' WHERE slug = ?").bind(first!.slug).run();
    // An editor's change goes through the admin, which records who made it.
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["konten"]);
    const item = (await env.DB.prepare("SELECT id FROM blog_posts WHERE slug = ?").bind(second!.slug).first<{ id: string }>())!;
    const edited = await call(`/api/admin/blog/${item.id}`, { cookie });
    const body = ((await edited.json()) as { item: Record<string, unknown> }).item;
    const put = await call(`/api/admin/blog/${item.id}`, {
      method: "PUT",
      cookie,
      headers: { "if-match": `"${String(body.updatedAt)}"` },
      json: { ...body, title: "Judul yang diubah editor" },
    });
    expect(put.status).toBe(200);

    await runImport();
    expect((await env.DB.prepare("SELECT title FROM blog_posts WHERE slug = ?").bind(first!.slug).first<{ title: string }>())!.title).toBe(String(first!.meta.title));
    expect((await env.DB.prepare("SELECT title FROM blog_posts WHERE slug = ?").bind(second!.slug).first<{ title: string }>())!.title).toBe("Judul yang diubah editor");
    expect(await count()).toBe(ARTICLE_COUNT);
  });
});

describe("an imported article opens in the editor and can be saved again", () => {
  test("every article, opened and saved with the form's own values, is accepted and changes nothing (one needs a longer excerpt, as it did in the legacy form)", async () => {
    await runImport();
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["konten"]);
    const list = (await (await call("/api/admin/blog?pageSize=100", { cookie })).json()) as { items: { id: string; slug: string }[]; total: number };
    expect(list.total).toBe(ARTICLE_COUNT);

    const refused: Record<string, unknown> = {};
    const changed: string[] = [];
    for (const { id, slug } of list.items) {
      const opened = (await (await call(`/api/admin/blog/${id}`, { cookie })).json()) as { item: Record<string, unknown> };
      // What the SPA's form sends: the item's fields as they are.
      const res = await call(`/api/admin/blog/${id}`, { method: "PUT", cookie, headers: { "if-match": `"${String(opened.item.updatedAt)}"` }, json: opened.item });
      if (res.status !== 200) {
        refused[slug] = await res.json();
        continue;
      }
      if (((await res.json()) as { item: { updatedAt: string } }).item.updatedAt !== opened.item.updatedAt) changed.push(slug);
    }
    // The legacy form demanded an excerpt of at least 20 characters, and the WordPress testimonial "Daffa Najwan" has
    // one of 14 ("Manajemen, UGM"): it was never editable there. The import keeps it as it is, and a save that does not
    // change the excerpt is accepted (the minimum applies to a text the writer changes). Nothing is refused.
    expect(refused).toEqual({});
    expect(changed).toEqual([]);
    // SAKEM-094: the meta description goes back with the form too. Many migrated ones are over the form's maximum of 300
    // characters, and it is only because an article keeps the description it has that they are accepted.
    expect(oracle.articles.filter((a) => String(a.meta.description ?? "").length > 300).length).toBeGreaterThan(20);
  });

  test("the article with the 14-character excerpt is imported as it is, can be edited around it, and a new short excerpt is refused", async () => {
    await runImport();
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["konten"]);
    const id = (await env.DB.prepare("SELECT id FROM blog_posts WHERE slug = 'daffa-najwan'").first<{ id: string }>())!.id;
    const open = async () => ((await (await call(`/api/admin/blog/${id}`, { cookie })).json()) as { item: Record<string, unknown> }).item;
    const save = async (item: Record<string, unknown>, changes: Record<string, unknown>) => {
      const res = await call(`/api/admin/blog/${id}`, { method: "PUT", cookie, headers: { "if-match": `"${String(item.updatedAt)}"` }, json: { ...item, ...changes } });
      return { status: res.status, body: (await res.json()) as { item?: Record<string, unknown>; fields?: Record<string, string> } };
    };

    const opened = await open();
    expect(opened.excerpt).toBe("Manajemen, UGM");

    const renamed = await save(opened, { title: "Daffa Najwan (UGM)" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.item).toMatchObject({ title: "Daffa Najwan (UGM)", excerpt: "Manajemen, UGM" });

    const shorter = await save(await open(), { excerpt: "Manajemen" });
    expect(shorter.status).toBe(400);
    expect(shorter.body.fields).toEqual({ excerpt: "Excerpt minimal 20 karakter" });

    const longer = await save(await open(), { excerpt: "Manajemen, Universitas Gadjah Mada" });
    expect(longer.status).toBe(200);
  });

  test("editing the text of an imported article renders it again with its images intact", async () => {
    await runImport();
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["konten"]);
    const original = oracle.articles.find((a) => a.html.includes(' srcset="'))!;
    const id = (await env.DB.prepare("SELECT id FROM blog_posts WHERE slug = ?").bind(original.slug).first<{ id: string }>())!.id;

    const save = async (markdown: string) => {
      const opened = ((await (await call(`/api/admin/blog/${id}`, { cookie })).json()) as { item: Record<string, unknown> }).item;
      const res = await call(`/api/admin/blog/${id}`, { method: "PUT", cookie, headers: { "if-match": `"${String(opened.updatedAt)}"` }, json: { ...opened, contentMarkdown: markdown } });
      expect(res.status).toBe(200);
      return (await env.DB.prepare("SELECT content_html FROM blog_posts WHERE id = ?").bind(id).first<{ content_html: string }>())!.content_html;
    };

    const edited = await save(`${original.markdown}\n\nSatu paragraf tambahan.`);
    expect(edited).toContain("Satu paragraf tambahan.");
    expect(edited.replace(/\n<p>Satu paragraf tambahan\.<\/p>$/, "")).toBe(original.html);
    // Put back, it is the build's HTML again, byte for byte.
    expect(await save(original.markdown)).toBe(original.html);
    expect(renderArticle(original.markdown).html).toBe(original.html);
  });

  test("the cover and its size are what the build knows", async () => {
    await runImport();
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["konten"]);
    for (const article of oracle.articles.slice(0, 8)) {
      const id = (await env.DB.prepare("SELECT id FROM blog_posts WHERE slug = ?").bind(article.slug).first<{ id: string }>())!.id;
      const { item } = (await (await call(`/api/admin/blog/${id}`, { cookie })).json()) as { item: { image: string | null; imageWidth: number | null; imageHeight: number | null; status: string; date: string } };
      const summary = (oracle.payloads[article.slug] as { article: { image: string | null; imageWidth: number | null; imageHeight: number | null; dateISO: string } }).article;
      expect(item).toMatchObject({ image: summary.image, imageWidth: summary.imageWidth, imageHeight: summary.imageHeight, status: "published", date: summary.dateISO });
    }
  });
});
