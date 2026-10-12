import { describe, expect, test } from "vitest";
// The Astro site's own implementation of the blog rules: "the one implementation" the fixture API and the
// site's tests share (cf/web/blog-contract.mjs, plain JS with no imports). The SQL of this Worker must give
// what it gives, for any list and any `page` / `pageSize` text a caller can send.
// @ts-expect-error -- a plain JS module of cf/web with JSDoc types only; no declaration file to resolve here
import { buildListPayload, pickRelated } from "../../web/blog-contract.mjs";
import { serializeBlogSummary } from "../src/public/serializers";
import { addPosts, DAY, internalFetch, json } from "./public-helpers";

const categories = ["News", "Cerita", "Tips", "Career", "Education"] as const;

async function seed(count: number, featuredAt: number[]) {
  let seed = 11;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const rows = await addPosts(
    Array.from({ length: count }, (_, i) => ({
      slug: `p-${String(i).padStart(2, "0")}`,
      category: categories[Math.floor(rand() * categories.length)]!,
      featured: featuredAt.includes(i),
      excerpt: i % 3 === 0 ? `Ringkasan ${i} [&hellip;]` : `Ringkasan ${i}`,
      image: i % 4 === 0 ? null : `/blog/images/${i}.jpg`,
      imageWidth: i % 4 === 0 ? null : 1200,
      imageHeight: i % 4 === 0 ? null : 800,
      // Newest first by index, a day or a few weeks apart: some neighbours inside 180 days, some far outside.
      publishedAt: new Date(Date.UTC(2026, 4, 30, 5) - i * DAY * (1 + Math.floor(rand() * 9)) + i * 60_000),
    })),
  );
  // The wire summaries of every article, newest first (by the instant, as the database orders them): the input of the shared rules.
  return [...rows]
    .sort((a, b) => b.publishedAt!.getTime() - a.publishedAt!.getTime())
    .map((row) => serializeBlogSummary({ ...row, image: row.image ?? null, imageWidth: row.imageWidth ?? null, imageHeight: row.imageHeight ?? null, featured: row.featured ?? false }));
}

describe("the SQL agrees with the shared rules of cf/web (blog-contract.mjs)", () => {
  test("the index, for every page and size text a caller can send", async () => {
    const summaries = await seed(47, [12, 30]);
    const pages = [undefined, "", "1", "2", "3", "4", "0", "-1", "abc", "2abc", "1.9", " 3 ", "+2", "999", "99999999999999999999", "٣"];
    const sizes = [undefined, "", "15", "1", "7", "10", "50", "51", "0", "-3", "abc", "7.9", "1000"];
    for (const page of pages) {
      for (const pageSize of sizes) {
        const query = [page !== undefined ? `page=${encodeURIComponent(page)}` : "", pageSize !== undefined ? `pageSize=${encodeURIComponent(pageSize)}` : ""].filter(Boolean).join("&");
        const res = await internalFetch(`/api/public/blog${query ? `?${query}` : ""}`);
        expect(res.status, query).toBe(200);
        const expected = buildListPayload(summaries, page ?? null, pageSize ?? null);
        expect(await json(res), query).toEqual(expected);
      }
    }
  }, 120_000);

  test("the featured pick: the newest flagged one, else the newest", async () => {
    const none = await seed(10, []);
    expect(await json(await internalFetch("/api/public/blog"))).toEqual(buildListPayload(none, null, null));
  });

  test("the related articles of every article", async () => {
    const summaries = await seed(40, [5]);
    for (const article of summaries) {
      const { related } = await json<{ related: unknown[] }>(await internalFetch(`/api/public/blog/${article.slug}`));
      expect(related, article.slug).toEqual(pickRelated(article, summaries));
    }
  }, 120_000);
});
