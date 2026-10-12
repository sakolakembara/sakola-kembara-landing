import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../src/db/schema";
import { INSERT_AUDIT_SQL, INSERT_MESSAGE_SQL } from "../src/public/contact";
import { articleQuery, blogPageQuery, currentAnnouncementQuery, featuredPostQuery, newestOthersQuery, publishedCountQuery, relatedQuery, reportsQuery, resourcesQuery, teamQuery } from "../src/public/queries";
import { addPost, addPosts, countedGet, DAY, instrumentD1, insertMany, internalFetchWith, uniqueIp, type D1Stats } from "./public-helpers";
import { InMemoryRateLimiter, turnstileDisabled } from "../src/public/contact-deps";
import type { Bindings } from "../src/env";

// What a request costs the Workers Free budget: D1 round trips and statements
// (no N+1: the cost must not grow with what is on the page) and rows read
// (D1 Free: 5M a day; it counts rows scanned, so a plan that scans more than
// it returns shows here). The ceilings are the design's, with a margin; a
// change that breaks one needs a reason written next to the new number.
//
// "rows read" is what the local D1 reports in `meta.rows_read`. The real D1
// counts the same way as far as the documentation says, but it is only
// confirmed on the deployed Worker (SAKEM-084).

// A realistic school-sized volume (docs/cloudflare/d1-schema.md, headroom): 250 articles after about 3 years.
const VOLUME = { posts: 250, featured: 8, team: 50, reports: 100, resources: 60 };

beforeEach(async () => {
  const categories = ["News", "Cerita", "Tips", "Career", "Education"] as const;
  await addPosts(
    Array.from({ length: VOLUME.posts }, (_, i) => ({
      slug: `v-${String(i).padStart(3, "0")}`,
      category: categories[i % categories.length]!,
      featured: i % Math.floor(VOLUME.posts / VOLUME.featured) === 7,
      // About 12 KB of body per article, as estimated: a list must never read it.
      contentMarkdown: "x".repeat(6000),
      contentHtml: "<p>x</p>".repeat(900),
      publishedAt: new Date(Date.UTC(2026, 4, 30, 5) - i * DAY),
    })),
  );
  await insertMany(
    schema.teamMembers,
    Array.from({ length: VOLUME.team }, (_, i) => ({ name: `Anggota ${i}`, role: "Peran", category: (["dewan_pembina", "dewan_pengawas", "pengurus"] as const)[i % 3], displayOrder: i })),
  );
  await insertMany(
    schema.reports,
    Array.from({ length: VOLUME.reports }, (_, i) => ({ title: `Laporan ${i}`, category: "yearly" as const, year: `${2000 + (i % 25)}`, filePath: `/reports/${i}.pdf`, fileSize: 1000, uploadedAt: new Date(Date.UTC(2026, 0, 1) - i * DAY) })),
  );
  await insertMany(
    schema.siteResources,
    Array.from({ length: VOLUME.resources }, (_, i) => ({
      title: `Dokumen ${i}`,
      category: (["panduan", "berkas-pendaftaran", "berkas-marketing", "tutorial", "lainnya"] as const)[i % 5],
      displayOrder: i,
      contentType: "file" as const,
      filePath: `/resources/${i}.pdf`,
      fileSize: 1000,
    })),
  );
  await insertMany(
    schema.announcements,
    Array.from({ length: 5 }, (_, i) => ({ title: `Pengumuman ${i}`, body: "Isi pengumuman.", active: i < 3, createdAt: new Date(Date.now() - i * DAY) })),
  );
}, 60_000);

async function cost(path: string) {
  const { response, stats } = await countedGet(path);
  return { status: response.status, ...stats };
}

describe("D1 cost of the read endpoints at school-sized volume", () => {
  // Every list returns all its rows; the scan plus the sort of a small table is
  // about twice the rows returned. If a table ever grows past what a Free
  // request can sensibly send, paginate it in the contract first.
  test.each([
    ["/api/public/team", VOLUME.team],
    ["/api/public/reports", VOLUME.reports],
    ["/api/public/resources", VOLUME.resources],
  ] as const)("%s: one statement, one round trip, at most twice the rows it returns", async (path, rows) => {
    const c = await cost(path);
    expect(c.status).toBe(200);
    expect(c.roundTrips).toBe(1);
    expect(c.statements).toHaveLength(1);
    expect(c.rowsRead).toBeLessThanOrEqual(rows * 2 + 10);
  });

  test("announcements/current: one statement over the few active rows", async () => {
    const c = await cost("/api/public/announcements/current");
    expect(c).toMatchObject({ status: 200, roundTrips: 1 });
    expect(c.statements).toHaveLength(1);
    expect(c.rowsRead).toBeLessThanOrEqual(10);
  });

  test("blog index: one round trip of three statements, rows near the count of articles plus the page", async () => {
    const c = await cost("/api/public/blog");
    expect(c.status).toBe(200);
    expect(c.roundTrips).toBe(1);
    expect(c.statements).toHaveLength(3);
    // The count walks the index once (250); the page and the featured lookup are a few dozen.
    expect(c.rowsRead).toBeLessThanOrEqual(VOLUME.posts + 60);
  });

  test("blog index: the cost does not grow with the page size, only with the rows asked for", async () => {
    const small = await cost("/api/public/blog?pageSize=1");
    const large = await cost("/api/public/blog?pageSize=50");
    expect(small.roundTrips).toBe(1);
    expect(large.roundTrips).toBe(1);
    expect(large.statements).toHaveLength(3);
    expect(large.rowsRead - small.rowsRead).toBeLessThanOrEqual(2 * 50);
  });

  test("blog index: a deep page costs the rows it skips, still one round trip", async () => {
    const c = await cost("/api/public/blog?page=10");
    expect(c.roundTrips).toBe(1);
    expect(c.rowsRead).toBeLessThanOrEqual(VOLUME.posts + 10 * 15 + 60);
  });

  test("blog index: only a page out of range costs a second round trip", async () => {
    const c = await cost("/api/public/blog?page=999");
    expect(c.status).toBe(200);
    expect(c.roundTrips).toBe(2);
    expect(c.statements.length).toBeLessThanOrEqual(4);
    const huge = await cost("/api/public/blog?page=99999999999999999999");
    expect(huge.roundTrips).toBe(2);
  });

  test("article: the article with both bodies, then its related ones: two statements", async () => {
    const c = await cost("/api/public/blog/v-100");
    expect(c.status).toBe(200);
    expect(c.roundTrips).toBe(2);
    expect(c.statements).toHaveLength(2);
    expect(c.rowsRead).toBeLessThanOrEqual(16);
  });

  test("article: the fallback to the newest others is a third statement, only when nothing is related", async () => {
    await env.DB.prepare("DELETE FROM blog_posts").run();
    await addPost({ slug: "satu-satunya", category: "Career", publishedAt: new Date("2020-01-01T05:00:00Z") });
    await addPosts(Array.from({ length: 4 }, (_, i) => ({ slug: `baru-${i}`, category: "News" as const, publishedAt: new Date(Date.UTC(2026, 0, 1, 5) + i * DAY) })));
    const c = await cost("/api/public/blog/satu-satunya");
    expect(c.roundTrips).toBe(3);
  });

  test("a slug that cannot exist costs nothing; an unknown valid one is a single seek", async () => {
    expect((await cost("/api/public/blog/Tidak_Valid")).roundTrips).toBe(0);
    const unknown = await cost("/api/public/blog/tidak-ada");
    expect(unknown).toMatchObject({ status: 404, roundTrips: 1 });
    expect(unknown.rowsRead).toBeLessThanOrEqual(2);
  });

  test("an unpublished slug costs one seek like an unknown one", async () => {
    await addPost({ slug: "draf", status: "draft" });
    const c = await cost("/api/public/blog/draf");
    expect(c).toMatchObject({ status: 404, roundTrips: 1 });
  });
});

describe("D1 cost of the contact form", () => {
  test("a saved message is one round trip of two statements; a duplicate is the same, writing nothing", async () => {
    const { db, stats } = instrumentD1(env.DB);
    const bindings = { ...env, DB: db } as Bindings;
    const deps = { rateLimiter: new InMemoryRateLimiter(100, 60), verifyTurnstile: turnstileDisabled, now: Date.now };
    const send = (email: string) =>
      internalFetchWith(deps, "/api/public/contact", { method: "POST", json: { fullName: "Budi", email, subject: "other", message: "Halo, saya ingin bertanya." }, clientIp: uniqueIp() }, bindings);

    expect((await send("a@example.test")).status).toBe(201);
    expect(stats.roundTrips).toBe(1);
    expect(stats.statements).toHaveLength(2);

    const before: D1Stats = { ...stats, statements: [...stats.statements] };
    expect((await send("a@example.test")).status).toBe(429);
    expect(stats.roundTrips - before.roundTrips).toBe(1);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM contact_messages").first()).toEqual({ n: 1 });
  });
});

describe("query plans (EXPLAIN QUERY PLAN)", () => {
  const db = () => drizzle(env.DB, { schema });
  const plan = async (query: { toSQL(): { sql: string; params: unknown[] } }) => {
    const { sql, params } = query.toSQL();
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>();
    return results.map((row) => row.detail);
  };
  const planOf = async (sql: string, ...params: unknown[]) => (await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>()).results.map((row) => row.detail);

  // Negative test (scripts/negative-checks.mjs): drop the new index from the
  // migration and the featured lookup falls back to sorting every article.
  test("the featured article is an index seek with no sort of the articles", async () => {
    const lines = await plan(featuredPostQuery(db()));
    expect(lines).toEqual(["SEARCH blog_posts USING INDEX blog_posts_status_featured_published_idx (status=?)"]);
  });

  test("the count only walks an index", async () => {
    expect(await plan(publishedCountQuery(db()))).toEqual(["SEARCH blog_posts USING COVERING INDEX blog_posts_status_featured_published_idx (status=?)"]);
  });

  test("a page of the grid is read in index order with no sort, the featured one found by a seek", async () => {
    const lines = await plan(blogPageQuery(db(), 15, 30));
    expect(lines.join(" | ")).toContain("SEARCH blog_posts USING INDEX blog_posts_status_published_idx (status=?)");
    expect(lines.join(" | ")).toContain("SEARCH blog_posts USING INDEX blog_posts_status_featured_published_idx (status=?)");
    expect(lines.some((line) => line.includes("TEMP B-TREE"))).toBe(false);
    expect(lines.some((line) => /\bSCAN\b/.test(line))).toBe(false);
  });

  test("an article is one seek on the unique slug", async () => {
    expect(await plan(articleQuery(db(), "x"))).toEqual(["SEARCH blog_posts USING INDEX blog_posts_slug_idx (slug=?)"]);
  });

  test("related articles and the fallback walk the published index newest first, no sort", async () => {
    for (const query of [relatedQuery(db(), { id: "i", category: "News", publishedAtMs: Date.now() }), newestOthersQuery(db(), "i")]) {
      expect(await plan(query)).toEqual(["SEARCH blog_posts USING INDEX blog_posts_status_published_idx (status=?)"]);
    }
  });

  test("the announcement uses the (active, starts_at, ends_at) index", async () => {
    const lines = await plan(currentAnnouncementQuery(db(), new Date()));
    expect(lines[0]).toBe("SEARCH announcements USING INDEX announcements_active_idx (active=?)");
  });

  // These three return every row of their table, so a scan reads no more than it
  // returns; the temp b-tree is the sort of at most a few hundred small rows.
  test("team, reports and resources are one scan of their own table", async () => {
    expect((await plan(teamQuery(db()))).filter((l) => l.startsWith("SCAN"))).toEqual(["SCAN team_members"]);
    expect((await plan(reportsQuery(db()))).filter((l) => l.startsWith("SCAN"))).toEqual(["SCAN reports"]);
    expect((await plan(resourcesQuery(db()))).filter((l) => l.startsWith("SCAN"))).toEqual(["SCAN site_resources"]);
  });

  test("no public query reads a table it should not: every plan names only its own", async () => {
    const own: [{ toSQL(): { sql: string; params: unknown[] } }, string][] = [
      [teamQuery(db()), "team_members"],
      [reportsQuery(db()), "reports"],
      [resourcesQuery(db()), "site_resources"],
      [currentAnnouncementQuery(db(), new Date()), "announcements"],
      [featuredPostQuery(db()), "blog_posts"],
      [blogPageQuery(db(), 15, 0), "blog_posts"],
      [articleQuery(db(), "x"), "blog_posts"],
    ];
    for (const [query, table] of own) {
      const text = (await plan(query)).join(" ");
      const tables = [...text.matchAll(/(?:SCAN|SEARCH) (\w+)/g)].map((m) => m[1]);
      expect(new Set(tables)).toEqual(new Set([table]));
    }
  });

  test("the duplicate check of the contact form is an index search, never a scan of the messages", async () => {
    const lines = await planOf(INSERT_MESSAGE_SQL, "id", "n", "e@example.test", "other", "m", "e@example.test", 0);
    const text = lines.join(" | ");
    expect(text).toMatch(/SEARCH contact_messages (EXISTS )?USING (COVERING )?INDEX contact_messages_(email|created_at)_idx/);
    expect(text).not.toMatch(/SCAN contact_messages/);
  });

  test("the audit row's guard is a primary key lookup", async () => {
    const text = (await planOf(INSERT_AUDIT_SQL, "a", "e@example.test", "id", "{}", "id")).join(" | ");
    expect(text).toMatch(/SEARCH contact_messages (EXISTS )?USING (COVERING )?INDEX \w+ \(id=\?\)/);
    expect(text).not.toMatch(/SCAN contact_messages/);
  });
});
