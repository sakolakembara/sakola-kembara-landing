import { env } from "cloudflare:workers";
import { describe, expect, inject, test } from "vitest";
import { sqlText } from "../scripts/import-legacy-blog";
import { renderArticle } from "../src/blog/render";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { internalFetch } from "./public-helpers";

// The import of the 80 migrated articles (scripts/import-legacy-blog.ts, docs/cloudflare/admin-blog.md#import-of-the-80-migrated-articles).
//
// The SQL the script writes is run against the real local D1 of the test, and then the PUBLIC API (through the
// `PublicApi` entrypoint, the way the site reaches it) is compared with the answers of cf/web's fixture API for the
// same articles (`inject("blogOracle")`, test/global/blog-oracle.ts): the index at two page sizes and every article
// with its `related`, titles, slugs, dates, excerpts, covers, sizes, HTML and markdown, deep-equal, for all 80.

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
    expect(statements).toHaveLength(80);
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
  test("imports 80 articles, all published", async () => {
    await runImport();
    expect(await count()).toBe(80);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM blog_posts WHERE status = 'published'").first()).toEqual({ n: 80 });
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

  test("every one of the 80 articles, with its related ones: titles, slugs, dates, cover, HTML, markdown", async () => {
    await runImport();
    expect(Object.keys(oracle.payloads)).toHaveLength(80);
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
    expect(await count()).toBe(80);
  });
});

describe("an imported article opens in the editor and can be saved again", () => {
  test("every one of the 80, opened and saved with the form's own values, is accepted and changes nothing (one needs a longer excerpt, as it did in the legacy form)", async () => {
    await runImport();
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["konten"]);
    const list = (await (await call("/api/admin/blog?pageSize=100", { cookie })).json()) as { items: { id: string; slug: string }[]; total: number };
    expect(list.total).toBe(80);

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
    // one of 14 ("Manajemen, UGM"): it was never editable there either. The rule is kept; the editor lengthens the
    // excerpt on the first edit. No other article is refused, and the list of exceptions must not grow.
    expect(refused).toEqual({ "daffa-najwan": { error: "invalid", message: "Periksa kembali isian formulir.", fields: { excerpt: "Excerpt minimal 20 karakter" } } });
    expect(changed).toEqual([]);
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
