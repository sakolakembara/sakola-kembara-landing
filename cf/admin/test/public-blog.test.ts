import { describe, expect, test } from "vitest";
import { CACHE_CONTENT, CACHE_NOT_FOUND } from "../src/public/cache";
import { pickRelatedArticles } from "../src/public/blog-rules";
import { EMPTY_BLOG, EXAMPLES, sameShape } from "./contract-examples";
import { addPost, addPosts, countedGet, DAY, internalFetch, json } from "./public-helpers";

// GET /api/public/blog and /api/public/blog/{slug}.

// Through the `PublicApi` entrypoint: the only face that serves the read endpoints (test/public-face.test.ts).
const get = (path: string) => internalFetch(path);

interface Card {
  slug: string;
  title: string;
  category: string;
  date: string;
  dateISO: string;
  excerpt: string;
  image: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  author: string;
  featured: boolean;
}
interface ListBody {
  featured: Card | null;
  articles: Card[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** 12:00 in Jakarta of a calendar day: far from any midnight, so the day it reads back as is never in doubt. */
const noon = (iso: string) => new Date(`${iso}T12:00:00+07:00`);
/** 00:00 in Jakarta, the instant an imported date-only article is stored at. */
const midnight = (iso: string) => new Date(`${iso}T00:00:00+07:00`);

const BASE = Date.UTC(2026, 4, 30, 5);
const pad = (i: number) => String(i).padStart(2, "0");

/** `n` published articles, art-00 the newest, one day apart. */
async function seedList(n: number, over: (i: number) => Parameters<typeof addPost>[0] = () => ({})) {
  return addPosts(Array.from({ length: n }, (_, i) => ({ slug: `art-${pad(i)}`, title: `Judul ${i}`, publishedAt: new Date(BASE - i * DAY), ...over(i) })));
}

const slugs = (cards: Card[]) => cards.map((c) => c.slug);

describe("GET /api/public/blog", () => {
  test("serves the contract's example: the featured article exactly, 79 others over 6 pages", async () => {
    const example = EXAMPLES.blogList;
    await addPost({
      slug: example.featured.slug,
      title: example.featured.title,
      category: example.featured.category,
      excerpt: example.featured.excerpt,
      image: example.featured.image,
      imageWidth: example.featured.imageWidth,
      imageHeight: example.featured.imageHeight,
      author: example.featured.author,
      featured: true,
      publishedAt: midnight("2026-05-21"),
    });
    await addPosts(Array.from({ length: 79 }, (_, i) => ({ slug: `lama-${pad(i)}`, publishedAt: new Date(BASE - (i + 40) * DAY) })));

    const body = await json<ListBody>(await get("/api/public/blog"));
    expect(body.featured).toEqual(example.featured);
    expect({ page: body.page, pageSize: body.pageSize, total: body.total, totalPages: body.totalPages }).toEqual({ page: 1, pageSize: 15, total: 79, totalPages: 6 });
    expect(body.articles).toHaveLength(15);
    // Same fields as the example entry, the same kinds of values.
    for (const card of body.articles) expect(sameShape(card, example.articles[0])).toEqual([]);
    expect(sameShape({ ...body, articles: body.articles.slice(0, 1) }, { ...example, articles: example.articles.slice(0, 1) })).toEqual([]);
  });

  test("an empty blog is the contract's empty example", async () => {
    expect(await json(await get("/api/public/blog"))).toEqual(EMPTY_BLOG);
  });

  test("one published article is the featured one and nothing else", async () => {
    await addPost({ slug: "satu" });
    const body = await json<ListBody>(await get("/api/public/blog"));
    expect(body.featured?.slug).toBe("satu");
    expect(body).toMatchObject({ articles: [], total: 0, totalPages: 1, page: 1 });
  });

  test("defaults to page 1 of 15; the featured article is not counted or repeated", async () => {
    await seedList(40);
    const body = await json<ListBody>(await get("/api/public/blog"));
    // 40 published = 1 featured (the newest, nothing is flagged) + 39 in the grid.
    expect(body.featured?.slug).toBe("art-00");
    expect(body).toMatchObject({ page: 1, pageSize: 15, total: 39, totalPages: 3 });
    expect(body.articles).toHaveLength(15);
    expect(slugs(body.articles).slice(0, 2)).toEqual(["art-01", "art-02"]);
    expect(slugs(body.articles)).not.toContain("art-00");
  });

  test("the featured article is the newest one flagged, otherwise the newest", async () => {
    await seedList(6, (i) => ({ featured: i === 2 || i === 4 }));
    const body = await json<ListBody>(await get("/api/public/blog"));
    expect(body.featured?.slug).toBe("art-02");
    expect(body.featured?.featured).toBe(true);
    expect(slugs(body.articles)).toEqual(["art-00", "art-01", "art-03", "art-04", "art-05"]);
    // The other flagged article stays in the grid, still marked.
    expect(body.articles.find((a) => a.slug === "art-04")?.featured).toBe(true);
    expect(body.total).toBe(5);
  });

  test("returns the requested page and the remainder on the last one", async () => {
    await seedList(40);
    const page3 = await json<ListBody>(await get("/api/public/blog?page=3"));
    expect(page3.page).toBe(3);
    expect(page3.articles).toHaveLength(9);
    // The grid is art-01..art-39; page 3 starts at its 31st entry.
    expect(page3.articles[0]!.slug).toBe("art-31");
    expect(page3.articles.at(-1)!.slug).toBe("art-39");
    // The featured article is returned on every page: the consumer decides where to show it.
    expect(page3.featured?.slug).toBe("art-00");
  });

  test("honours pageSize", async () => {
    await seedList(40);
    const body = await json<ListBody>(await get("/api/public/blog?page=2&pageSize=10"));
    expect(body).toMatchObject({ page: 2, pageSize: 10, totalPages: 4, total: 39 });
    expect(slugs(body.articles)).toEqual(Array.from({ length: 10 }, (_, i) => `art-${pad(11 + i)}`));
  });

  test("an out-of-range or non-numeric page is clamped or defaulted, never an error", async () => {
    await seedList(40);
    const cases: [string, number][] = [
      ["page=999", 3],
      ["page=0", 1],
      ["page=-4", 1],
      ["page=abc", 1],
      ["page=", 1],
      ["page=2abc", 2],
      ["page=1.5", 1],
      ["page=%20", 1],
      ["page=99999999999999999999999999", 3],
      ["page=+2", 2],
    ];
    for (const [query, expected] of cases) {
      const res = await get(`/api/public/blog?${query}`);
      expect(res.status, query).toBe(200);
      const body = await json<ListBody>(res);
      expect(body.page, query).toBe(expected);
      // The page it reports is the page it returned.
      expect(body.articles.length, query).toBeGreaterThan(0);
    }
  });

  test("pageSize is bounded to 1..50 and defaults to 15", async () => {
    await seedList(80);
    const cases: [string, number][] = [
      ["pageSize=0", 1],
      ["pageSize=-5", 1],
      ["pageSize=1000", 50],
      ["pageSize=abc", 15],
      ["pageSize=", 15],
      ["pageSize=50", 50],
      ["pageSize=1", 1],
      ["pageSize=7.5", 7],
    ];
    for (const [query, expected] of cases) {
      const body = await json<ListBody>(await get(`/api/public/blog?${query}`));
      expect(body.pageSize, query).toBe(expected);
      expect(body.articles.length, query).toBe(Math.min(expected, 79));
    }
  });

  test("the first of a repeated parameter is the one used", async () => {
    await seedList(40);
    expect((await json<ListBody>(await get("/api/public/blog?page=2&page=3"))).page).toBe(2);
  });

  test("enumerating every article for the sitemap: pages of 50 plus the featured one cover the blog once", async () => {
    await seedList(120);
    const first = await json<ListBody>(await get("/api/public/blog?pageSize=50"));
    const all = [first.featured!.slug];
    for (let page = 1; page <= first.totalPages; page++) all.push(...slugs((await json<ListBody>(await get(`/api/public/blog?pageSize=50&page=${page}`))).articles));
    expect(all).toHaveLength(120);
    expect(new Set(all).size).toBe(120);
  });

  // Negative test: remove the status filter from src/public/queries.ts and a
  // draft shows up in the list, the count and the featured slot.
  test("a draft is never listed, counted or featured, however new or flagged", async () => {
    await seedList(4);
    await addPost({ slug: "draf-baru", status: "draft", featured: true, publishedAt: new Date(BASE + 5 * DAY) });
    await addPost({ slug: "draf-tanpa-tanggal", status: "draft", publishedAt: null });
    const body = await json<ListBody>(await get("/api/public/blog"));
    expect(body.featured?.slug).toBe("art-00");
    expect(slugs(body.articles)).toEqual(["art-01", "art-02", "art-03"]);
    expect(body.total).toBe(3);
    expect(JSON.stringify(body)).not.toContain("draf");
  });

  test("articles saved with the same instant keep a stable order and no article is lost or repeated across pages", async () => {
    await addPosts(Array.from({ length: 30 }, (_, i) => ({ slug: `sama-${pad(i)}`, publishedAt: new Date(BASE) })));
    const walk = async () => {
      const seen: string[] = [];
      const first = await json<ListBody>(await get("/api/public/blog?pageSize=7"));
      seen.push(first.featured!.slug);
      for (let page = 1; page <= first.totalPages; page++) seen.push(...slugs((await json<ListBody>(await get(`/api/public/blog?pageSize=7&page=${page}`))).articles));
      return seen;
    };
    const once = await walk();
    expect(once).toHaveLength(30);
    expect(new Set(once).size).toBe(30);
    expect(await walk()).toEqual(once);
  });

  test("entries are summaries: no body, no ids, no internals", async () => {
    await addPost({ slug: "satu", wpId: 5802, sourceUrl: "https://wp.example.test/lama/" });
    await addPost({ slug: "dua" });
    const text = await (await get("/api/public/blog")).text();
    for (const leaked of ["contentMarkdown", "contentHtml", "wpId", "sourceUrl", "5802", "wp.example.test", "status", "createdBy", "updatedBy"]) expect(text, leaked).not.toContain(leaked);
  });

  test("the excerpt arrives with the WordPress trailer already stripped", async () => {
    await addPost({ slug: "a", excerpt: "Awal cerita [&hellip;]" });
    await addPost({ slug: "b", excerpt: "Awal cerita lain …" });
    await addPost({ slug: "c", excerpt: "  Ringkasan biasa  " });
    const body = await json<ListBody>(await get("/api/public/blog"));
    const byslug = Object.fromEntries([body.featured!, ...body.articles].map((a) => [a.slug, a.excerpt]));
    expect(byslug).toEqual({ a: "Awal cerita ...", b: "Awal cerita lain ...", c: "Ringkasan biasa" });
  });

  test("image is null when there is none, and the dimensions travel with the hero image", async () => {
    await addPost({ slug: "tanpa-gambar", image: null, publishedAt: new Date(BASE - DAY) });
    await addPost({ slug: "kosong", image: "", publishedAt: new Date(BASE - 2 * DAY) });
    await addPost({ slug: "dengan-gambar", image: "/blog/images/a.jpg", imageWidth: 1200, imageHeight: 800, publishedAt: new Date(BASE) });
    const body = await json<ListBody>(await get("/api/public/blog"));
    expect(body.featured).toMatchObject({ slug: "dengan-gambar", image: "/blog/images/a.jpg", imageWidth: 1200, imageHeight: 800 });
    expect(body.articles[0]).toMatchObject({ slug: "tanpa-gambar", image: null, imageWidth: null, imageHeight: null });
    expect(body.articles[1]).toMatchObject({ slug: "kosong", image: null });
  });

  test("dates are the Indonesian long date and the ISO day in Jakarta, at the day boundary too", async () => {
    // 2026-05-20 16:59:59 UTC is still the 20th in Jakarta; one second later it is the 21st.
    await addPost({ slug: "malam", publishedAt: new Date("2026-05-20T16:59:59Z") });
    await addPost({ slug: "pagi", publishedAt: new Date("2026-05-20T17:00:00Z") });
    await addPost({ slug: "tahun-baru", publishedAt: new Date("2025-12-31T17:00:00Z") });
    await addPost({ slug: "satu-digit", publishedAt: new Date("2026-03-05T05:00:00Z") });
    await addPost({ slug: "desember", publishedAt: new Date("2025-12-31T16:59:59Z") });
    const body = await json<ListBody>(await get("/api/public/blog?pageSize=50"));
    const cards = Object.fromEntries([body.featured!, ...body.articles].map((a) => [a.slug, [a.date, a.dateISO]]));
    expect(cards).toEqual({
      malam: ["20 Mei 2026", "2026-05-20"],
      pagi: ["21 Mei 2026", "2026-05-21"],
      "tahun-baru": ["1 Januari 2026", "2026-01-01"],
      "satu-digit": ["5 Maret 2026", "2026-03-05"],
      desember: ["31 Desember 2025", "2025-12-31"],
    });
  });

  test("lists carry the Cache-Control of the contract", async () => {
    expect((await get("/api/public/blog")).headers.get("cache-control")).toBe(CACHE_CONTENT);
  });
});

describe("GET /api/public/blog/{slug}", () => {
  test("serves the contract's example article exactly, and returns related summaries", async () => {
    const a = EXAMPLES.blogArticle.article;
    await addPost({
      slug: a.slug,
      title: a.title,
      category: a.category,
      excerpt: a.excerpt,
      metaDescription: a.description,
      image: a.image,
      imageWidth: a.imageWidth,
      imageHeight: a.imageHeight,
      author: a.author,
      featured: a.featured,
      contentMarkdown: a.contentMarkdown,
      contentHtml: a.contentHtml,
      publishedAt: midnight("2026-05-21"),
      updatedAt: noon("2026-05-21"),
    });
    await addPosts([{ slug: "lain-1", category: "Cerita", image: "/blog/images/lain-1.jpg" }, { slug: "lain-2", image: "/blog/images/lain-2.jpg" }]);

    const res = await get(`/api/public/blog/${a.slug}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(CACHE_CONTENT);
    const body = await json<{ article: unknown; related: Card[] }>(res);
    expect(body.article).toEqual(a);
    expect(body.related.length).toBeGreaterThan(0);
    expect(sameShape(body.related[0], EXAMPLES.blogArticle.related[0])).toEqual([]);
    expect(Object.keys(body).sort()).toEqual(["article", "related"]);
  });

  test("description (SAKEM-090): the stored meta description as it is; null when none is set or it is empty; never in the list", async () => {
    await addPost({ slug: "dengan", metaDescription: "Teks untuk mesin pencari, bukan ringkasan.", excerpt: "Ringkasan kartu [&hellip;]" });
    await addPost({ slug: "tanpa" });
    await addPost({ slug: "kosong", metaDescription: "" });
    const read = async (slug: string) => (await json<{ article: { description: string | null; excerpt: string } }>(await get(`/api/public/blog/${slug}`))).article;
    expect((await read("dengan")).description).toBe("Teks untuk mesin pencari, bukan ringkasan.");
    expect((await read("dengan")).excerpt).toBe("Ringkasan kartu ..."); // the card text is not touched
    expect((await read("tanpa")).description).toBeNull();
    expect((await read("kosong")).description).toBeNull();
    const list = await (await get("/api/public/blog")).text();
    expect(list).not.toContain("Teks untuk mesin pencari");
    expect(list).not.toContain("description");
  });

  test("contentHtml is returned exactly as stored: the read path never renders markdown", async () => {
    await addPost({ slug: "tersimpan", contentMarkdown: "# Judul\n\nParagraf **tebal**.", contentHtml: "<p>HTML tersimpan, bukan hasil render</p>" });
    const { article } = await json<{ article: { contentMarkdown: string; contentHtml: string } }>(await get("/api/public/blog/tersimpan"));
    expect(article.contentHtml).toBe("<p>HTML tersimpan, bukan hasil render</p>");
    expect(article.contentMarkdown).toBe("# Judul\n\nParagraf **tebal**.");
  });

  test("the article carries both dates: published in Jakarta, modified from the last save", async () => {
    await addPost({ slug: "dua-tanggal", publishedAt: new Date("2026-05-20T17:00:00Z"), updatedAt: new Date("2026-06-02T16:59:59Z") });
    const { article } = await json<{ article: { date: string; dateISO: string; modifiedISO: string } }>(await get("/api/public/blog/dua-tanggal"));
    expect(article).toMatchObject({ date: "21 Mei 2026", dateISO: "2026-05-21", modifiedISO: "2026-06-02" });
  });

  test("an unknown slug is a JSON 404 cached for 30 s", async () => {
    await addPost({ slug: "ada" });
    const res = await get("/api/public/blog/tidak-ada");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.headers.get("cache-control")).toBe(CACHE_NOT_FOUND);
    expect(await json(res)).toEqual({ error: "not_found" });
  });

  test("an unpublished slug is the same 404, indistinguishable from an unknown one", async () => {
    await addPost({ slug: "draf-rahasia", status: "draft", title: "Judul rahasia", contentMarkdown: "rahasia" });
    const draft = await get("/api/public/blog/draf-rahasia");
    const unknown = await get("/api/public/blog/draf-lain");
    expect(draft.status).toBe(404);
    expect(await draft.text()).toBe(await unknown.text());
    expect([...draft.headers.entries()].sort()).toEqual([...unknown.headers.entries()].sort());
  });

  test("a slug that cannot exist is a 404 without a database read", async () => {
    const odd = ["Besar", "garis_bawah", "dua--strip", "-awal", "akhir-", "titik.titik", "%2e%2e", "a".repeat(161), "spasi%20spasi", "%E0%A4%A"];
    for (const slug of odd) {
      const { response, stats } = await countedGet(`/api/public/blog/${slug}`);
      expect(response.status, slug).toBe(404);
      expect(stats.roundTrips, slug).toBe(0);
    }
  });

  test("a slug at the 160 character limit is looked up like any other", async () => {
    const slug = "a".repeat(160);
    await addPost({ slug });
    expect((await get(`/api/public/blog/${slug}`)).status).toBe(200);
  });

  test("the list's published rows and the article agree on the title and the date", async () => {
    await addPost({ slug: "sama", title: "Judul yang sama", publishedAt: noon("2026-04-02") });
    const [{ featured }, { article }] = await Promise.all([json<ListBody>(await get("/api/public/blog")), json<{ article: Card }>(await get("/api/public/blog/sama"))]);
    expect(featured).toMatchObject({ slug: article.slug, title: article.title, date: article.date, dateISO: article.dateISO });
  });

  describe("related articles", () => {
    test("never the article itself, a draft or more than three, and each is a summary with its slug", async () => {
      await seedList(8, () => ({ category: "News" }));
      await addPost({ slug: "draf", status: "draft", category: "News", publishedAt: new Date(BASE + DAY) });
      const { related } = await json<{ related: Card[] }>(await get("/api/public/blog/art-03"));
      expect(related).toHaveLength(3);
      expect(slugs(related)).not.toContain("art-03");
      expect(slugs(related)).not.toContain("draf");
      for (const card of related) expect(Object.keys(card).sort()).toEqual(["author", "category", "date", "dateISO", "excerpt", "featured", "image", "imageHeight", "imageWidth", "slug", "title"]);
    }, 20_000);

    test("the first three in newest-first order, not the closest in time", async () => {
      await seedList(8, () => ({ category: "News" }));
      const { related } = await json<{ related: Card[] }>(await get("/api/public/blog/art-05"));
      expect(slugs(related)).toEqual(["art-00", "art-01", "art-02"]);
    });

    test("one match is one related article: the list is not padded", async () => {
      await addPost({ slug: "sasaran", category: "Tips", publishedAt: noon("2024-01-10") });
      await addPost({ slug: "sekategori", category: "Tips", publishedAt: noon("2022-01-10") });
      await addPost({ slug: "jauh-1", category: "News", publishedAt: noon("2020-01-10") });
      await addPost({ slug: "jauh-2", category: "News", publishedAt: noon("2019-01-10") });
      const { related } = await json<{ related: Card[] }>(await get("/api/public/blog/sasaran"));
      expect(slugs(related)).toEqual(["sekategori"]);
    });

    test("when nothing matches, the three newest others", async () => {
      await addPost({ slug: "tunggal", category: "Career", publishedAt: noon("2020-01-10") });
      await seedList(5, () => ({ category: "News" }));
      const { related } = await json<{ related: Card[] }>(await get("/api/public/blog/tunggal"));
      expect(slugs(related)).toEqual(["art-00", "art-01", "art-02"]);
    });

    test("the only article has no related ones", async () => {
      await addPost({ slug: "sendiri" });
      expect((await json<{ related: Card[] }>(await get("/api/public/blog/sendiri"))).related).toEqual([]);
    });

    // Strictly fewer than 180 days apart, counted in Jakarta calendar days: the
    // legacy rule compared date-only values. Negative test: widen or narrow the
    // window in relatedWindow() and the boundary cases fail.
    test("dated within 180 days means a day difference of at most 179, at the day boundary too", async () => {
      await addPost({ slug: "pusat", category: "Tips", publishedAt: noon("2026-03-01") });
      // Other categories, so only the window can make them related. 2026-03-01 + 179 days = 2026-08-27.
      await addPost({ slug: "plus-179-malam", category: "News", publishedAt: new Date("2026-08-27T23:59:00+07:00") });
      await addPost({ slug: "plus-180-tengah-malam", category: "Career", publishedAt: new Date("2026-08-28T00:00:00+07:00") });
      // 2026-03-01 - 179 days = 2025-09-03.
      await addPost({ slug: "minus-179-tengah-malam", category: "Cerita", publishedAt: new Date("2025-09-03T00:00:00+07:00") });
      await addPost({ slug: "minus-180-malam", category: "Education", publishedAt: new Date("2025-09-02T23:59:00+07:00") });
      const { related } = await json<{ related: Card[] }>(await get("/api/public/blog/pusat"));
      expect(slugs(related).sort()).toEqual(["minus-179-tengah-malam", "plus-179-malam"]);
    });

    // The pure rule is the reference; the SQL must give the same three for every article.
    test("the SQL gives what the pure rule gives, for every article of a mixed set", async () => {
      const categories = ["News", "Cerita", "Tips", "Career", "Education"] as const;
      let seed = 7;
      const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      const rows = await addPosts(
        Array.from({ length: 36 }, (_, i) => ({
          slug: `m-${pad(i)}`,
          category: categories[Math.floor(rand() * categories.length)]!,
          // Clustered in time with some far outliers, one article per distinct day.
          publishedAt: new Date(Date.UTC(2026, 0, 1, 5) + (i % 9 === 0 ? -1 : 1) * Math.floor(rand() * 400) * DAY + i * 60_000),
        })),
      );
      const sorted = rows.map((r) => ({ slug: r.slug, category: r.category as string, publishedAtMs: r.publishedAt!.getTime() })).sort((a, b) => b.publishedAtMs - a.publishedAtMs);
      for (const article of sorted) {
        const { related } = await json<{ related: Card[] }>(await get(`/api/public/blog/${article.slug}`));
        expect(slugs(related), article.slug).toEqual(pickRelatedArticles(article, sorted).map((a) => a.slug));
      }
    }, 60_000);
  });
});
