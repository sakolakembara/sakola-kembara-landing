import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, test, vi } from "vitest";
import { createInternalApp } from "../src/api/public";
import { CLICK_SQL, shortlinkQuery } from "../src/public/shortlink";
import type { Bindings } from "../src/env";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../src/db/schema";
import { count } from "./konten-helpers";
import { countedGet, countedPublicFaceGet, INTERNAL_ORIGIN, instrumentD1, internalFetch, internalFetchWithBindings, json } from "./public-helpers";

// The redirect's API half: GET /api/public/shortlinks/{slug}, served to the site's Worker through the
// `PublicApi` entrypoint (docs/cloudflare/admin-konten.md, "The redirect"). cf/web turns the answer into a 307.
//
// What these tests pin, in the order of the brief:
//   - found / unknown / inactive, and the shape of what is answered;
//   - the click is counted AFTER the answer is decided, through waitUntil: the answer never waits for the write
//     and never fails because of it, and a visit is counted however many there are (no limit, Dzul 2026-10-12);
//   - one indexed read and one write per visit, nothing about the visitor;
//   - nothing under /api/public is served on the Worker's public face.
//
// Negative checks (scripts/negative-checks-konten-misc.mjs): await the write before answering, or let its failure
// out, or drop the unsafe-target check, and the matching test below fails.

async function addLink(over: { slug?: string; target_url?: string; active?: number; click_count?: number } = {}) {
  const row = { id: crypto.randomUUID(), slug: "daftar-2026", target_url: "https://forms.gle/abc123", active: 1, click_count: 0, ...over };
  await env.DB.prepare("INSERT INTO shortlinks (id, slug, target_url, active, click_count) VALUES (?, ?, ?, ?, ?)").bind(row.id, row.slug, row.target_url, row.active, row.click_count).run();
  return row;
}

const clicksOf = async (id: string) => (await env.DB.prepare("SELECT click_count AS n, last_clicked_at AS at, updated_at AS v FROM shortlinks WHERE id = ?").bind(id).first<{ n: number; at: number | null; v: number }>())!;
const get = (slug: string, bindings: Bindings = env) => internalFetchWithBindings(bindings, `/api/public/shortlinks/${slug}`);

/** A D1 whose statements starting with `UPDATE` are replaced by `replace`; everything else is the real thing. */
function withUpdate(real: D1Database, replace: (run: () => Promise<D1Result>) => Promise<D1Result>): D1Database {
  return new Proxy(real, {
    get(target, property) {
      if (property !== "prepare") {
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (sql: string) => {
        const statement = target.prepare(sql);
        if (!/^\s*UPDATE\b/i.test(sql)) return statement;
        return {
          bind: (...values: unknown[]) => {
            const bound = statement.bind(...values);
            return { run: () => replace(() => bound.run()) };
          },
        } as unknown as D1PreparedStatement;
      };
    },
  });
}

describe("the lookup: found, unknown, inactive", () => {
  test("an active link answers its target, and nothing else about itself", async () => {
    const link = await addLink();
    const res = await get("daftar-2026");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ shortlink: { targetUrl: "https://forms.gle/abc123" } });
    // No id, no slug, no count, no note.
    expect(JSON.stringify(await clicksOf(link.id))).toBeTruthy();
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });

  test("a path of this site is a valid target too", async () => {
    await addLink({ slug: "gabung", target_url: "/gabung-siswa?utm_source=ig" });
    expect(await json(await get("gabung"))).toEqual({ shortlink: { targetUrl: "/gabung-siswa?utm_source=ig" } });
  });

  test("the answer is never cacheable, carries no cookie, no tag and no CORS grant", async () => {
    await addLink();
    const res = await get("daftar-2026");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.has("cache-tag")).toBe(false);
    expect(res.headers.has("etag")).toBe(false);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(res.headers.has("access-control-allow-origin")).toBe(false);
    const missing = await get("tidak-ada");
    expect(missing.headers.get("cache-control")).toBe("no-store");
  });

  test("an unknown slug is a JSON 404 that counts nothing", async () => {
    const other = await addLink({ slug: "ada" });
    const res = await get("tidak-ada");
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "not_found" });
    expect((await clicksOf(other.id)).n).toBe(0);
  });

  test("an inactive link is the same 404 as an unknown one, and is not counted", async () => {
    const link = await addLink({ slug: "kampanye-lama", active: 0 });
    const inactive = await get("kampanye-lama");
    const unknown = await get("kampanye-tak-pernah-ada");
    expect(inactive.status).toBe(404);
    expect(await inactive.text()).toBe(await unknown.text()); // it does not confirm that the slug exists
    expect(Object.fromEntries(inactive.headers)).toEqual(Object.fromEntries(unknown.headers));
    expect((await clicksOf(link.id)).n).toBe(0);
  });

  test("switching a link off and on takes effect at the very next visit (nothing is cached)", async () => {
    const link = await addLink();
    expect((await get("daftar-2026")).status).toBe(200);
    await env.DB.prepare("UPDATE shortlinks SET active = 0 WHERE id = ?").bind(link.id).run();
    expect((await get("daftar-2026")).status).toBe(404);
    await env.DB.prepare("UPDATE shortlinks SET active = 1, target_url = '/blog' WHERE id = ?").bind(link.id).run();
    expect(await json(await get("daftar-2026"))).toEqual({ shortlink: { targetUrl: "/blog" } });
  });

  test("something that cannot be a slug is a 404 without one D1 round trip", async () => {
    await addLink();
    for (const slug of ["Daftar-2026", "daftar_2026", "daftar--2026", "-daftar", "daftar-", "a.b", "a%20b", "a".repeat(65), "%E0%A4%A", "dästar", "..", "a;b"]) {
      const { response, stats } = await countedGet(`/api/public/shortlinks/${slug}`);
      expect(response.status, slug).toBe(404);
      expect(stats.roundTrips, slug).toBe(0);
      expect(stats.statements, slug).toEqual([]);
    }
    // The grammar's last legal length still reaches D1.
    const { stats } = await countedGet(`/api/public/shortlinks/${"a".repeat(64)}`);
    expect(stats.roundTrips).toBe(1);
  });

  test("the lookup is by slug exactly: a prefix, a suffix and another case do not match", async () => {
    await addLink({ slug: "daftar-2026" });
    for (const slug of ["daftar", "daftar-20", "daftar-2026-b", "Daftar-2026", "xdaftar-2026"]) expect((await get(slug)).status, slug).toBe(404);
  });

  test("a target the admin could not have stored is not followed, and not counted (the row was written by something else)", async () => {
    // The table's CHECK refuses `javascript:` and `//host`, but not these two, which only the admin's own rule refuses.
    const evil = await addLink({ slug: "satu", target_url: "/\\evil.example" });
    const tab = await addLink({ slug: "dua", target_url: "/\t/evil.example" });
    for (const slug of ["satu", "dua"]) {
      const res = await get(slug);
      expect(res.status, slug).toBe(404);
    }
    expect((await clicksOf(evil.id)).n + (await clicksOf(tab.id)).n).toBe(0);
  });
});

describe("the click: counted after the answer, never in its way", () => {
  test("a visit adds one to the count and stamps the time, once the request's background work is done", async () => {
    const link = await addLink({ click_count: 4 });
    const before = Date.now();
    const res = await get("daftar-2026"); // waits for waitUntil, like the runtime
    expect(res.status).toBe(200);
    const after = await clicksOf(link.id);
    expect(after.n).toBe(5);
    expect(after.at).toBeGreaterThanOrEqual(before);
    expect(after.at).toBeLessThanOrEqual(Date.now());
  });

  test("through the real entrypoint (what the service binding calls) the click is counted too", async () => {
    const link = await addLink();
    expect((await internalFetch("/api/public/shortlinks/daftar-2026")).status).toBe(200);
    await vi.waitFor(async () => expect((await clicksOf(link.id)).n).toBe(1), { timeout: 3000, interval: 25 });
  });

  test("the answer is sent while the write is still waiting: it never depends on it", async () => {
    const link = await addLink();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const db = withUpdate(env.DB, async (run) => {
      await gate; // the click's write is held back
      return run();
    });

    const ctx = createExecutionContext();
    const response = await createInternalApp().fetch(new Request(`${INTERNAL_ORIGIN}/api/public/shortlinks/daftar-2026`), { ...env, DB: db } as Bindings, ctx);
    // The visitor already has everything the redirect needs, and the count has not happened.
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ shortlink: { targetUrl: "https://forms.gle/abc123" } });
    expect((await clicksOf(link.id)).n).toBe(0);

    release();
    await waitOnExecutionContext(ctx);
    // The write was handed to waitUntil, so it still happened.
    expect((await clicksOf(link.id)).n).toBe(1);
  });

  test("a write that fails does not fail the answer: same status, same body, one fixed line in the log with nothing in it", async () => {
    const link = await addLink({ slug: "tetap-jalan" });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = withUpdate(env.DB, () => Promise.reject(new Error("D1 is down: sensitive details tetap-jalan " + link.id)));

    const res = await get("tetap-jalan", { ...env, DB: db } as Bindings);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ shortlink: { targetUrl: "https://forms.gle/abc123" } });
    expect((await clicksOf(link.id)).n).toBe(0); // nothing was counted, and nobody was told but the log
    expect(log.mock.calls).toEqual([["[shortlinks] could not count a click"]]);
    expect(JSON.stringify(log.mock.calls)).not.toContain(link.id);
    expect(JSON.stringify(log.mock.calls)).not.toContain("tetap-jalan");
    log.mockRestore();
  });

  test("a write that never returns does not hold the answer either", async () => {
    await addLink();
    const db = withUpdate(env.DB, () => new Promise<D1Result>(() => undefined)); // pends forever
    const ctx = createExecutionContext();
    const response = await createInternalApp().fetch(new Request(`${INTERNAL_ORIGIN}/api/public/shortlinks/daftar-2026`), { ...env, DB: db } as Bindings, ctx);
    expect(response.status).toBe(200);
    // (The context is left alone: this write will never finish, which is the point.)
  });

  test("every visit is counted, with no limit and no sampling: 40 visits, 40 clicks", async () => {
    const link = await addLink();
    for (let n = 0; n < 40; n++) expect((await get("daftar-2026")).status).toBe(200);
    expect((await clicksOf(link.id)).n).toBe(40);
  });

  test("visits at the same moment all count (the addition is SQL's, not a read then a write)", async () => {
    const link = await addLink();
    const results = await Promise.all(Array.from({ length: 12 }, () => get("daftar-2026")));
    expect(results.map((r) => r.status)).toEqual(Array(12).fill(200));
    expect((await clicksOf(link.id)).n).toBe(12);
  });

  test("only the link that was visited is counted", async () => {
    const one = await addLink({ slug: "satu" });
    const two = await addLink({ slug: "dua" });
    await get("dua");
    await get("dua");
    expect([(await clicksOf(one.id)).n, (await clicksOf(two.id)).n]).toEqual([0, 2]);
  });

  test("a click is not an edit: updated_at keeps its value, so counting can never make an admin's save stale", async () => {
    const link = await addLink();
    const before = (await clicksOf(link.id)).v;
    await get("daftar-2026");
    await get("daftar-2026");
    expect((await clicksOf(link.id)).v).toBe(before);
  });
});

describe("what a visit costs D1", () => {
  test("one indexed read and one write, in two round trips, and nothing in the audit trail", async () => {
    await addLink();
    const { response, stats } = await countedGet("/api/public/shortlinks/daftar-2026");
    expect(response.status).toBe(200);
    expect(stats.roundTrips).toBe(2);
    expect(stats.statements).toHaveLength(2);
    expect(stats.statements[0]).toMatch(/^select .*from "shortlinks" where/i);
    expect(stats.statements[1]).toBe(CLICK_SQL);
    expect(await count("audit_log")).toBe(0);
  });

  test("the read is a seek on the unique slug index and reads the one row it finds", async () => {
    for (let n = 0; n < 30; n++) await addLink({ slug: `link-${n}` });
    const query = shortlinkQuery(drizzle(env.DB, { schema }), "link-7").toSQL();
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).bind(...query.params).all<{ detail: string }>();
    expect(plan.results.map((row) => row.detail).join(" | ")).toMatch(/SEARCH shortlinks USING INDEX shortlinks_slug_idx \(slug=\?\)/);
    expect(plan.results.map((row) => row.detail).join(" | ")).not.toMatch(/SCAN/);

    const { stats } = await countedGet("/api/public/shortlinks/link-7");
    // An index entry and the row: two rows however many links there are, plus the same two for the write's WHERE.
    expect(stats.rowsRead).toBeLessThanOrEqual(4);
  });

  test("the write changes exactly one row, and one row is what D1 bills for it", async () => {
    const link = await addLink();
    const result = await env.DB.prepare(CLICK_SQL).bind(Date.now(), link.id).run();
    expect(result.meta.changes).toBe(1);
    // `click_count` and `last_clicked_at` are in no index, so the table row is the only row written.
    expect(result.meta.rows_written).toBe(1);
  });

  test("an unknown slug costs one read and no write", async () => {
    await addLink();
    const { response, stats } = await countedGet("/api/public/shortlinks/tidak-ada");
    expect(response.status).toBe(404);
    expect(stats.roundTrips).toBe(1);
    expect(stats.statements.some((sql) => /^\s*update/i.test(sql))).toBe(false);
  });

  test("nothing about the visitor is read or kept: no header of the request reaches D1, and the row has no such column", async () => {
    const link = await addLink();
    const { db, stats } = instrumentD1(env.DB);
    const res = await internalFetchWithBindings({ ...env, DB: db } as Bindings, "/api/public/shortlinks/daftar-2026", {
      headers: { "cf-connecting-ip": "203.0.113.77", "user-agent": "UnikBot/9.9", referer: "https://orang.example/halaman", "x-sakem-client-ip": "198.51.100.5", cookie: "sesi=rahasia" },
    });
    expect(res.status).toBe(200);
    expect(JSON.stringify(stats.statements)).not.toMatch(/203\.0\.113|UnikBot|orang\.example|198\.51|rahasia/);
    const columns = (await env.DB.prepare("PRAGMA table_info(shortlinks)").all<{ name: string }>()).results.map((column) => column.name).sort();
    expect(columns).toEqual(["active", "click_count", "created_at", "created_by", "id", "last_clicked_at", "note", "slug", "target_url", "updated_at"]);
    expect((await clicksOf(link.id)).n).toBe(1);
  });
});

describe("who can reach it", () => {
  test("not the internet: the Worker's public face answers the plain JSON 404, even for a link that exists, with no D1 round trip", async () => {
    await addLink();
    const { response, stats } = await countedPublicFaceGet("/api/public/shortlinks/daftar-2026");
    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({ error: "not_found" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(stats.roundTrips).toBe(0);
    expect(stats.rowsRead).toBe(0);
  });

  test("a cache-busting query string on the public face reads nothing, and counts nothing", async () => {
    const link = await addLink();
    for (let n = 0; n < 20; n++) {
      const { stats } = await countedPublicFaceGet(`/api/public/shortlinks/daftar-2026?x=${n}`);
      expect(stats.roundTrips).toBe(0);
    }
    expect((await clicksOf(link.id)).n).toBe(0);
  });

  test("only GET is a lookup: POST, PUT and DELETE on the entrypoint are the 404, and count nothing", async () => {
    const link = await addLink();
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await internalFetchWithBindings(env, "/api/public/shortlinks/daftar-2026", { method });
      expect(res.status, method).toBe(404);
    }
    expect((await clicksOf(link.id)).n).toBe(0);
  });
});
