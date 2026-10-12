import { describe, expect, test } from "vitest";
import { createPublicApp } from "../src/api/public";
import { call } from "./helpers";
import { addAnnouncement, addPost, addReport, addResource, addTeam, countedPublicFaceGet, internalFetch, json } from "./public-helpers";

// The Worker's public face is empty: what a route, workers.dev or a custom domain reaches (the default
// export) serves NOTHING under /api/public. The read endpoints and the contact form exist only on the
// `PublicApi` entrypoint, which only the Astro Worker's service binding can call
// (docs/cloudflare/public-api.md). Why: a response is cached by URL, so with the reads on the public face
// anyone could request `?x=1`, `?x=2`, ... and make D1 read rows for every one, spending the daily budget
// (5 million rows) in about 20 to 25 thousand requests, after which every D1 query fails, the admin's
// sign-in included. With the reads off the public face such a request is a 404 that touches no database.
//
// Negative tests (scripts/negative-checks.mjs): mount the read routes on `createPublicApp`, or drop them from
// the internal app, and these fail.

const READ_PATHS = [
  "/api/public/team",
  "/api/public/reports",
  "/api/public/resources",
  "/api/public/announcements/current",
  "/api/public/blog",
  "/api/public/blog?page=2&pageSize=50",
  "/api/public/blog/un-artikel",
];

async function seed() {
  await addTeam({ name: "Anggota Rahasia Publik" });
  await addReport({ title: "Laporan Rahasia Publik" });
  await addResource({ title: "Dokumen Rahasia Publik" });
  await addAnnouncement({ title: "Pengumuman Rahasia Publik" });
  await addPost({ slug: "un-artikel", title: "Artikel Rahasia Publik" });
}

describe("the default export serves no /api/public route", () => {
  test("createPublicApp mounts nothing", () => {
    expect(createPublicApp().routes).toEqual([]);
  });

  test.each(READ_PATHS)("GET %s from the internet is the Worker's plain JSON 404: no data, not cacheable, and not one D1 round trip", async (path) => {
    await seed();
    const { response, stats } = await countedPublicFaceGet(path);
    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({ error: "not_found" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("cache-tag")).toBe(false);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(stats.roundTrips).toBe(0);
    expect(stats.statements).toEqual([]);
    expect(stats.rowsRead).toBe(0);
  });

  test("the same URLs answer 200 with the data on the entrypoint: the reads moved, they did not go", async () => {
    await seed();
    for (const path of READ_PATHS.filter((p) => !p.includes("page=2"))) {
      const res = await internalFetch(path);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toMatch(/Rahasia Publik/);
      expect((await call(path)).status, `${path} on the public face`).toBe(404);
    }
  });

  test("cache-busting query strings, the way the daily D1 read budget used to be spent, read no row at all", async () => {
    await seed();
    let roundTrips = 0;
    let rowsRead = 0;
    for (let i = 0; i < 60; i++) {
      const path = READ_PATHS[i % READ_PATHS.length]!;
      const { response, stats } = await countedPublicFaceGet(`${path}${path.includes("?") ? "&" : "?"}x=${i}&cb=${crypto.randomUUID()}`);
      expect(response.status).toBe(404);
      roundTrips += stats.roundTrips;
      rowsRead += stats.rowsRead;
    }
    expect({ roundTrips, rowsRead }).toEqual({ roundTrips: 0, rowsRead: 0 });
  });

  test("the contact route is not there either, and a forged address or a same-origin Origin does not change that", async () => {
    await seed();
    for (const headers of [{}, { "x-sakem-client-ip": "198.51.100.9" }, { origin: "https://admin.test" }] as Record<string, string>[]) {
      const { response, stats } = await countedPublicFaceGet("/api/public/contact", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ fullName: "Budi", email: "budi@example.test", subject: "other", message: "Halo, saya ingin bertanya.", website: "" }),
      });
      expect(response.status).toBe(404);
      expect(stats.roundTrips).toBe(0);
    }
  });

  test("every other method on a read URL is a 404 too (no write, no CORS preflight)", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
      const { response, stats } = await countedPublicFaceGet("/api/public/team", { method, headers: { origin: "https://admin.test" } });
      expect(response.status, method).toBe(404);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(stats.roundTrips, method).toBe(0);
    }
  });

  test("the Worker's own API is untouched by the empty face: /api/config and /api/me answer as before", async () => {
    expect((await call("/api/config")).status).toBe(200);
    expect((await call("/api/me")).status).toBe(401);
  });
});
