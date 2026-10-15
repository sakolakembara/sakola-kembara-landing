import { env } from "cloudflare:workers";
import { fillPlaceholders, sql } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { relatedWindow } from "../src/public/blog-rules";
import { batchAll, publicQueries } from "../src/public/prepared";
import { articleQuery, blogPageQuery, featuredPostQuery, newestOthersQuery, publishedCountQuery, relatedQuery, reportsQuery, resourcesQuery, teamQuery } from "../src/public/queries";
import { shortlinkQuery } from "../src/public/shortlink";
import { getDb } from "../src/db/client";
import * as schema from "../src/db/schema";
import { addPost, addPosts, addReport, addTeam, DAY, orm } from "./public-helpers";

// The public reads are built once per isolate with `sql.placeholder` and run with bound values (SAKEM-091,
// src/public/prepared.ts). The risk of that is a prepared query that is not the one the builder describes, or rows
// decoded differently: these tests compare it, statement by statement, with the builder run the old way.

const db = () => getDb(env.DB);
const ph = sql.placeholder;

describe("a placeholder is the same SQL and the same parameters as the literal value", () => {
  test("blog page: limit and offset", () => {
    const literal = blogPageQuery(db(), 15, 30).toSQL();
    const prepared = blogPageQuery(db(), ph("limit"), ph("offset")).toSQL();
    expect(prepared.sql).toBe(literal.sql);
    expect(fillPlaceholders(prepared.params, { limit: 15, offset: 30 })).toEqual(literal.params);
  });

  test("article: the slug", () => {
    const literal = articleQuery(db(), "un-slug").toSQL();
    const prepared = articleQuery(db(), ph("slug")).toSQL();
    expect(prepared.sql).toBe(literal.sql);
    expect(fillPlaceholders(prepared.params, { slug: "un-slug" })).toEqual(literal.params);
  });

  test("related: the id, the category and the date window (the Date becomes its milliseconds either way)", () => {
    const publishedAtMs = Date.UTC(2026, 4, 21, 5);
    const { from, to } = relatedWindow(publishedAtMs);
    const literal = relatedQuery(db(), { id: "an-id", category: "Cerita", publishedAtMs }).toSQL();
    const prepared = relatedQuery(db(), { id: ph("id"), category: ph("category"), from: ph("from"), to: ph("to") }).toSQL();
    expect(prepared.sql).toBe(literal.sql);
    expect(fillPlaceholders(prepared.params, { id: "an-id", category: "Cerita", from, to })).toEqual(literal.params);
  });

  test("newest others and the short link lookup", () => {
    const others = newestOthersQuery(db(), "an-id").toSQL();
    expect(newestOthersQuery(db(), ph("id")).toSQL().sql).toBe(others.sql);
    expect(fillPlaceholders(newestOthersQuery(db(), ph("id")).toSQL().params, { id: "an-id" })).toEqual(others.params);

    const link = shortlinkQuery(db(), "un-slug").toSQL();
    expect(shortlinkQuery(db(), ph("slug")).toSQL().sql).toBe(link.sql);
    expect(fillPlaceholders(shortlinkQuery(db(), ph("slug")).toSQL().params, { slug: "un-slug" })).toEqual(link.params);
  });
});

describe("a prepared query returns exactly the rows the builder returns", () => {
  async function seed() {
    const author = await addPosts(
      Array.from({ length: 20 }, (_, i) => ({
        slug: `p-${String(i).padStart(2, "0")}`,
        category: (["News", "Cerita", "Tips"] as const)[i % 3]!,
        featured: i === 7,
        publishedAt: new Date(Date.UTC(2026, 4, 30, 5) - i * 30 * DAY),
        metaDescription: i % 2 === 0 ? `Deskripsi ${i}` : null,
      })),
    );
    await addTeam({ name: "Anggota A", educationHistory: [{ institution: "Kampus", degree: "S1", year: "2015" }], workHistory: [{ organization: "Lembaga", role: "Anggota", period: "2018" }] });
    await addTeam({ name: "Anggota B", category: "dewan_pembina" });
    await addReport({ year: "2024/2025" });
    await addReport({ year: "2025" });
    await orm().insert(schema.siteResources).values({ title: "Dokumen", category: "panduan", displayOrder: 1, contentType: "text", bodyText: "isi" });
    await orm()
      .insert(schema.shortlinks)
      .values([
        { slug: "hidup", targetUrl: "/gabung-siswa", active: true },
        { slug: "mati", targetUrl: "/blog", active: false },
      ]);
    return author;
  }

  test("the lists", async () => {
    await seed();
    const queries = publicQueries(env.DB);
    expect(await queries.team.all()).toEqual(await teamQuery(orm()));
    expect(await queries.reports.all()).toEqual(await reportsQuery(orm()));
    expect(await queries.resources.all()).toEqual(await resourcesQuery(orm()));
  });

  test("the article, its related cards and the fallback, with dates and booleans decoded the same way", async () => {
    await seed();
    const queries = publicQueries(env.DB);
    for (const slug of ["p-00", "p-07", "p-13", "does-not-exist"]) {
      const viaBuilder = await articleQuery(orm(), slug);
      const viaPrepared = await queries.article.all({ slug });
      expect(viaPrepared).toEqual(viaBuilder);
      const row = viaBuilder[0];
      if (!row) continue;
      const publishedAtMs = row.publishedAt!.getTime();
      const { from, to } = relatedWindow(publishedAtMs);
      expect(await queries.related.all({ id: row.id, category: row.category, from, to })).toEqual(await relatedQuery(orm(), { id: row.id, category: row.category, publishedAtMs }));
      expect(await queries.newestOthers.all({ id: row.id })).toEqual(await newestOthersQuery(orm(), row.id));
    }
  });

  test("the short link lookup: an active one is found, an inactive or unknown one is not", async () => {
    await seed();
    const queries = publicQueries(env.DB);
    for (const slug of ["hidup", "mati", "nada"]) expect(await queries.shortlink.all({ slug })).toEqual(await shortlinkQuery(orm(), slug));
    expect(await queries.shortlink.all({ slug: "mati" })).toEqual([]);
  });

  test("the blog index batch: three statements, one round trip, the rows of db.batch", async () => {
    await seed();
    const queries = publicQueries(env.DB);
    let trips = 0;
    const counting = new Proxy(env.DB, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (prop === "batch") {
          return (...args: Parameters<D1Database["batch"]>) => {
            trips += 1;
            return target.batch(...args);
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database;
    for (const [limit, offset] of [[15, 0], [5, 5], [50, 0], [3, 100]] as const) {
      trips = 0;
      const [featured, count, page] = await batchAll(counting, [[queries.featured], [queries.count], [queries.page, { limit, offset }]]);
      expect(trips).toBe(1);
      const expected = await orm().batch([featuredPostQuery(orm()), publishedCountQuery(orm()), blogPageQuery(orm(), limit, offset)]);
      expect(featured).toEqual(expected[0]);
      expect(count).toEqual(expected[1]);
      expect(page).toEqual(expected[2]);
    }
  });
});

describe("publicQueries", () => {
  test("is built per D1 binding, and each query only when it is first read", () => {
    const binding = {} as D1Database;
    // Building touches the binding only through Drizzle's `prepare`: give it one, and count.
    let prepared = 0;
    const counting = { prepare: () => ((prepared += 1), {}) } as unknown as D1Database;
    const queries = publicQueries(counting);
    expect(publicQueries(counting)).toBe(queries);
    expect(publicQueries(binding)).not.toBe(queries);
    expect(prepared).toBe(0);
    void queries.team;
    expect(prepared).toBe(1);
    void queries.team;
    expect(prepared).toBe(1);
    void queries.reports;
    expect(prepared).toBe(2);
  });
});
