import { env } from "cloudflare:workers";
import { describe, expect, test, vi } from "vitest";
import type { Bindings } from "../src/env";
import { CACHE_ANNOUNCEMENT, CACHE_CONTENT, CACHE_NONE, CACHE_NOT_FOUND } from "../src/public/cache";
import { cacheControlRows, EXAMPLES } from "./contract-examples";
import { addAnnouncement, addReport, addResource, addTeam, DAY, internalFetch, internalFetchWithBindings, json } from "./public-helpers";
import { call } from "./helpers";

// The read endpoints that are plain lists (team, reports, resources) and the
// announcement strip. The blog has its own file. What each answer must look
// like is the contract's (docs/cloudflare/content-api.md): the examples are
// read from that document and compared with what the API serves for the same
// rows.

// The read endpoints are served by the `PublicApi` entrypoint only (what the Astro Worker's service binding
// reaches): the default export, the public face, mounts none of them (test/public-face.test.ts). So every read
// below goes through the entrypoint, and `call` (the default export) is used only for the admin API's own routes.
const get = (path: string) => internalFetch(path);

describe("GET /api/public/team", () => {
  test("serves exactly the contract's example for the same row", async () => {
    await addTeam(EXAMPLES.team.members[0]);
    const res = await get("/api/public/team");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual(EXAMPLES.team);
  });

  test("an empty table is an empty list, not an error", async () => {
    const res = await get("/api/public/team");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ members: [] });
  });

  // Negative test (scripts/negative-checks.mjs): take the category rank out of
  // the ORDER BY and the sections of /tim come back mixed.
  test("orders by category rank, then the admin's manual order, then creation", async () => {
    const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));
    await addTeam({ name: "pengurus 2", category: "pengurus", displayOrder: 2, createdAt: at(1) });
    await addTeam({ name: "pengawas 1", category: "dewan_pengawas", displayOrder: 1, createdAt: at(2) });
    await addTeam({ name: "pembina 5 lama", category: "dewan_pembina", displayOrder: 5, createdAt: at(3) });
    await addTeam({ name: "pembina 5 baru", category: "dewan_pembina", displayOrder: 5, createdAt: at(4) });
    await addTeam({ name: "pembina 1", category: "dewan_pembina", displayOrder: 1, createdAt: at(5) });
    await addTeam({ name: "pengurus 1", category: "pengurus", displayOrder: 1, createdAt: at(6) });

    const { members } = await json<{ members: { name: string }[] }>(await get("/api/public/team"));
    expect(members.map((m) => m.name)).toEqual(["pembina 1", "pembina 5 lama", "pembina 5 baru", "pengawas 1", "pengurus 1", "pengurus 2"]);
  });

  test("a malformed history entry is dropped, the member and the page survive", async () => {
    await addTeam({
      name: "Anggota",
      educationHistory: [{ institution: "Institut Contoh" }, "bukan objek", { degree: "tanpa institusi" }] as never,
      workHistory: [{ organization: "Lembaga", role: "Staf", period: "2020" }, { organization: "tanpa peran" }, 42] as never,
    });
    const { members } = await json<{ members: { educationHistory: unknown; workHistory: unknown }[] }>(await get("/api/public/team"));
    expect(members[0]!.educationHistory).toEqual([{ institution: "Institut Contoh", degree: null, year: null }]);
    expect(members[0]!.workHistory).toEqual([{ organization: "Lembaga", role: "Staf", period: "2020" }]);
  });
});

describe("GET /api/public/reports", () => {
  test("serves exactly the contract's example for the same row", async () => {
    await addReport(EXAMPLES.reports.reports[0]);
    expect(await json(await get("/api/public/reports"))).toEqual(EXAMPLES.reports);
  });

  test("newest year first (text order: 2025/2026 above 2025), then newest upload first", async () => {
    const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));
    await addReport({ title: "2024", year: "2024", uploadedAt: at(1) });
    await addReport({ title: "2025 lama", year: "2025", uploadedAt: at(2) });
    await addReport({ title: "2025/2026", year: "2025/2026", uploadedAt: at(3) });
    await addReport({ title: "2024/2025", year: "2024/2025", uploadedAt: at(4) });
    await addReport({ title: "2025 baru", year: "2025", uploadedAt: at(5) });

    const { reports } = await json<{ reports: { title: string }[] }>(await get("/api/public/reports"));
    expect(reports.map((r) => r.title)).toEqual(["2025/2026", "2025 baru", "2025 lama", "2024/2025", "2024"]);
  });

  test("an empty table is an empty list", async () => {
    expect(await json(await get("/api/public/reports"))).toEqual({ reports: [] });
  });
});

describe("GET /api/public/resources", () => {
  test("serves exactly the contract's example for the same row", async () => {
    await addResource(EXAMPLES.resources.resources[0]);
    expect(await json(await get("/api/public/resources"))).toEqual(EXAMPLES.resources);
  });

  test("flattened in the page's category order, then the admin's manual order", async () => {
    const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));
    const text = { contentType: "text" as const, filePath: null, fileSize: null, bodyText: "isi" };
    await addResource({ title: "lainnya", category: "lainnya", displayOrder: 1, createdAt: at(1), ...text });
    await addResource({ title: "tutorial", category: "tutorial", displayOrder: 1, createdAt: at(2), ...text });
    await addResource({ title: "marketing 2", category: "berkas-marketing", displayOrder: 2, createdAt: at(3), ...text });
    await addResource({ title: "panduan", category: "panduan", displayOrder: 1, createdAt: at(4), ...text });
    await addResource({ title: "marketing 1", category: "berkas-marketing", displayOrder: 1, createdAt: at(5), ...text });
    await addResource({ title: "pendaftaran", category: "berkas-pendaftaran", displayOrder: 9, createdAt: at(6), ...text });

    const { resources } = await json<{ resources: { title: string }[] }>(await get("/api/public/resources"));
    expect(resources.map((r) => r.title)).toEqual(["panduan", "pendaftaran", "marketing 1", "marketing 2", "tutorial", "lainnya"]);
  });

  test("each row is exactly one of file, url or text, the others null", async () => {
    await addResource({ title: "file", category: "panduan" });
    await addResource({ title: "url", category: "tutorial", contentType: "url", filePath: null, fileSize: null, externalUrl: "https://example.test/x" });
    await addResource({ title: "text", category: "lainnya", contentType: "text", filePath: null, fileSize: null, bodyText: "salin ini" });
    const { resources } = await json<{ resources: Record<string, unknown>[] }>(await get("/api/public/resources"));
    for (const r of resources) {
      const set = (["filePath", "externalUrl", "bodyText"] as const).filter((key) => r[key] !== null);
      expect(set, String(r.title)).toHaveLength(1);
      expect(r.contentType === "file" ? "filePath" : r.contentType === "url" ? "externalUrl" : "bodyText").toBe(set[0]);
      expect(r.fileSize === null).toBe(r.contentType !== "file");
    }
  });
});

describe("GET /api/public/announcements/current", () => {
  test("serves exactly the contract's example for the same row", async () => {
    await addAnnouncement(EXAMPLES.announcement.announcement);
    expect(await json(await get("/api/public/announcements/current"))).toEqual(EXAMPLES.announcement);
  });

  test("nothing active is { announcement: null }, with the same cache window", async () => {
    const res = await get("/api/public/announcements/current");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ announcement: null });
    expect(res.headers.get("cache-control")).toBe(CACHE_ANNOUNCEMENT);
  });

  // Negative test: drop `eq(announcements.active, true)` from the query and
  // the first case fails; drop the window and the next two fail.
  test("only a switched-on announcement inside its window is current", async () => {
    const now = Date.now();
    await addAnnouncement({ title: "mati", active: false });
    await addAnnouncement({ title: "belum mulai", startsAt: new Date(now + DAY) });
    await addAnnouncement({ title: "sudah berakhir", startsAt: new Date(now - 3 * DAY), endsAt: new Date(now - DAY) });
    expect(await json(await get("/api/public/announcements/current"))).toEqual({ announcement: null });

    await addAnnouncement({ title: "berjalan", startsAt: new Date(now - DAY), endsAt: new Date(now + DAY) });
    const { announcement } = await json<{ announcement: { title: string } }>(await get("/api/public/announcements/current"));
    expect(announcement.title).toBe("berjalan");
  });

  test("either end of the window may be open", async () => {
    const now = Date.now();
    await addAnnouncement({ title: "tanpa batas", createdAt: new Date(now - 4000) });
    expect((await json<{ announcement: { title: string } }>(await get("/api/public/announcements/current"))).announcement.title).toBe("tanpa batas");
    await env.DB.prepare("DELETE FROM announcements").run();

    await addAnnouncement({ title: "hanya mulai", startsAt: new Date(now - DAY) });
    expect((await json<{ announcement: { title: string } }>(await get("/api/public/announcements/current"))).announcement.title).toBe("hanya mulai");
    await env.DB.prepare("DELETE FROM announcements").run();

    await addAnnouncement({ title: "hanya akhir", endsAt: new Date(now + DAY) });
    expect((await json<{ announcement: { title: string } }>(await get("/api/public/announcements/current"))).announcement.title).toBe("hanya akhir");
  });

  test("when several match, the most recently created wins", async () => {
    const now = Date.now();
    await addAnnouncement({ title: "lama", createdAt: new Date(now - 3 * DAY) });
    await addAnnouncement({ title: "baru", createdAt: new Date(now - 1 * DAY) });
    await addAnnouncement({ title: "tengah", createdAt: new Date(now - 2 * DAY) });
    expect((await json<{ announcement: { title: string } }>(await get("/api/public/announcements/current"))).announcement.title).toBe("baru");
  });

  // The legacy reader cached "the current announcement" behind a tag with no
  // expiry: an announcement whose end had passed stayed visible. Here the
  // window is read against the clock on every request that reaches the Worker.
  test("the window is evaluated at request time, not cached by the Worker", async () => {
    const row = await addAnnouncement({ title: "sebentar", endsAt: new Date(Date.now() + DAY) });
    expect((await json<{ announcement: unknown }>(await get("/api/public/announcements/current"))).announcement).not.toBeNull();

    // Time passes: the end of the window is now behind us.
    await env.DB.prepare("UPDATE announcements SET ends_at = ? WHERE id = ?").bind(Date.now() - 1000, row.id).run();
    expect(await json(await get("/api/public/announcements/current"))).toEqual({ announcement: null });

    // And one that has not started yet appears once its start has passed.
    await env.DB.prepare("UPDATE announcements SET starts_at = ?, ends_at = NULL WHERE id = ?").bind(Date.now() + DAY, row.id).run();
    expect(await json(await get("/api/public/announcements/current"))).toEqual({ announcement: null });
    await env.DB.prepare("UPDATE announcements SET starts_at = ? WHERE id = ?").bind(Date.now() - 1000, row.id).run();
    expect((await json<{ announcement: unknown }>(await get("/api/public/announcements/current"))).announcement).not.toBeNull();
  });

  test("a database failure is a 500 that is not cacheable, never a false { announcement: null }", async () => {
    await addAnnouncement();
    const broken = { ...env, DB: { prepare() { throw new Error("D1_ERROR: database is down"); }, batch() { throw new Error("D1_ERROR: database is down"); } } } as unknown as Bindings;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await internalFetchWithBindings(broken, "/api/public/announcements/current");
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe(CACHE_NONE);
    expect(res.headers.get("cache-control")).not.toContain("s-maxage");
    expect(await res.json()).toEqual({ error: "internal" });
  });
});

describe("headers of every read endpoint", () => {
  const endpoints = ["/api/public/team", "/api/public/reports", "/api/public/resources", "/api/public/announcements/current", "/api/public/blog"];

  test("the Cache-Control constants are the contract's table, row for row", () => {
    const rows = cacheControlRows();
    const valueOf = (needle: string) => rows.find((row) => row.endpoints.includes(needle))?.value;
    expect(valueOf("`team`")).toBe(CACHE_CONTENT);
    expect(valueOf("`blog/{slug}`")).toBe(rows.find((row) => row.endpoints.startsWith("`team`"))?.value);
    expect(valueOf("announcements/current")).toBe(CACHE_ANNOUNCEMENT);
    expect(valueOf("unknown slug")).toBe(CACHE_NOT_FOUND);
    expect(valueOf("POST contact")).toBe(CACHE_NONE);
  });

  test.each(endpoints)("%s: JSON, the contract's Cache-Control, no cookie, no Vary, no CORS", async (path) => {
    const res = await get(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("cache-control")).toBe(path.includes("announcements") ? CACHE_ANNOUNCEMENT : CACHE_CONTENT);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(res.headers.has("vary")).toBe(false);
    expect([...res.headers.keys()].filter((name) => name.startsWith("access-control-"))).toEqual([]);
  });

  test.each(endpoints)("%s: the answer depends on no request header", async (path) => {
    await addTeam({ name: "Satu" });
    const plain = await (await get(path)).text();
    // Cookies, credentials and a spoofed visitor address change nothing: the answer depends on no request header.
    const res = await internalFetch(path, { headers: { cookie: "better-auth.session_token=abc", authorization: "Bearer x", "x-sakem-client-ip": "198.51.100.1", origin: "https://evil.example" } });
    expect(await res.text()).toBe(plain);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("the answers are not behind the admin API's blanket no-store, which still covers the rest of /api", async () => {
    expect((await get("/api/public/team")).headers.get("cache-control")).toBe(CACHE_CONTENT);
    expect((await call("/api/config")).headers.get("cache-control")).toBe("no-store");
  });

  test("HEAD works like GET without a body; OPTIONS is the Worker's 404, with no CORS grant", async () => {
    const head = await internalFetch("/api/public/team", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("cache-control")).toBe(CACHE_CONTENT);
    expect(await head.text()).toBe("");

    const options = await internalFetch("/api/public/team", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "GET" } });
    expect(options.status).toBe(404);
    expect(options.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("writes are not routes: POST, PUT and DELETE on a read endpoint are 404", async () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await internalFetch("/api/public/team", { method, json: { name: "x" } });
      expect(res.status, method).toBe(404);
    }
    expect(await env.DB.prepare("SELECT count(*) AS n FROM team_members").first()).toEqual({ n: 0 });
  });

  test("an unknown path under /api/public is a JSON 404 that is not cacheable", async () => {
    const res = await get("/api/public/nope");
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "not_found" });
    expect(res.headers.get("cache-control")).toBe(CACHE_NONE);
  });

  test("a database failure on a list is a 500 without s-maxage", async () => {
    const broken = { ...env, DB: { prepare() { throw new Error("D1_ERROR: boom"); }, batch() { throw new Error("D1_ERROR: boom"); } } } as unknown as Bindings;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const path of endpoints) {
      const res = await internalFetchWithBindings(broken, path);
      expect(res.status, path).toBe(500);
      expect(res.headers.get("cache-control"), path).toBe(CACHE_NONE);
    }
    spy.mockRestore();
  });
});
