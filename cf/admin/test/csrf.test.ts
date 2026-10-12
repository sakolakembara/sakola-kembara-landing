import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { checkRequestOrigin, parseOrigins } from "../src/security/csrf";
import { call, createVerifiedUser, emailsTo, linkIn, ORIGIN, PASSWORD, signedInCookie, signUp, uniqueEmail } from "./helpers";

// src/security/csrf.ts: a state-changing request must come from this origin.

const OWN = "https://admin.test";
const headers = (init: Record<string, string>) => new Headers(init);

describe("checkRequestOrigin (the rule, as a pure function)", () => {
  test("Origin: this site's own passes, any other fails, 'null' fails", () => {
    expect(checkRequestOrigin(headers({ origin: OWN }), OWN, [])).toEqual({ ok: true });
    expect(checkRequestOrigin(headers({ origin: "https://admin.test:8443" }), OWN, [])).toMatchObject({ ok: false, reason: "origin_mismatch" });
    expect(checkRequestOrigin(headers({ origin: "http://admin.test" }), OWN, [])).toMatchObject({ ok: false }); // scheme matters
    expect(checkRequestOrigin(headers({ origin: "https://evil.example" }), OWN, [])).toMatchObject({ ok: false, reason: "origin_mismatch" });
    expect(checkRequestOrigin(headers({ origin: "null" }), OWN, [])).toMatchObject({ ok: false, reason: "origin_mismatch" });
    expect(checkRequestOrigin(headers({ origin: "" }), OWN, [])).toMatchObject({ ok: false });
    expect(checkRequestOrigin(headers({ origin: "not a url" }), OWN, [])).toMatchObject({ ok: false });
  });

  test("a sibling subdomain is a different origin", () => {
    expect(checkRequestOrigin(headers({ origin: "https://lms.admin.test" }), OWN, [])).toMatchObject({ ok: false });
    expect(checkRequestOrigin(headers({ origin: "https://test" }), OWN, [])).toMatchObject({ ok: false });
  });

  test("trusted origins pass, compared exactly", () => {
    const trusted = ["http://localhost:5173"];
    expect(checkRequestOrigin(headers({ origin: "http://localhost:5173" }), OWN, trusted)).toEqual({ ok: true });
    expect(checkRequestOrigin(headers({ origin: "http://localhost:5174" }), OWN, trusted)).toMatchObject({ ok: false });
    expect(checkRequestOrigin(headers({ origin: "http://localhost:5173.evil.example" }), OWN, trusted)).toMatchObject({ ok: false });
  });

  test("Origin wins over Sec-Fetch-Site; a wrong Origin is refused even when Sec-Fetch-Site says same-origin", () => {
    expect(checkRequestOrigin(headers({ origin: "https://evil.example", "sec-fetch-site": "same-origin" }), OWN, [])).toMatchObject({ ok: false });
  });

  test("no Origin: Sec-Fetch-Site same-origin and none pass; same-site and cross-site fail", () => {
    expect(checkRequestOrigin(headers({ "sec-fetch-site": "same-origin" }), OWN, [])).toEqual({ ok: true });
    expect(checkRequestOrigin(headers({ "sec-fetch-site": "none" }), OWN, [])).toEqual({ ok: true });
    expect(checkRequestOrigin(headers({ "sec-fetch-site": "same-site" }), OWN, [])).toMatchObject({ ok: false, reason: "cross_site" });
    expect(checkRequestOrigin(headers({ "sec-fetch-site": "cross-site" }), OWN, [])).toMatchObject({ ok: false, reason: "cross_site" });
    expect(checkRequestOrigin(headers({ "sec-fetch-site": "Cross-Site" }), OWN, [])).toMatchObject({ ok: false });
  });

  test("neither: Referer's origin decides", () => {
    expect(checkRequestOrigin(headers({ referer: `${OWN}/settings?x=1` }), OWN, [])).toEqual({ ok: true });
    expect(checkRequestOrigin(headers({ referer: "https://evil.example/page" }), OWN, [])).toMatchObject({ ok: false });
    expect(checkRequestOrigin(headers({ referer: "garbage" }), OWN, [])).toMatchObject({ ok: false });
  });

  test("none of the three: allowed without a cookie, refused with one", () => {
    expect(checkRequestOrigin(headers({}), OWN, [])).toEqual({ ok: true });
    expect(checkRequestOrigin(headers({ cookie: "better-auth.session_token=abc" }), OWN, [])).toEqual({ ok: false, reason: "no_origin_signal" });
  });
});

describe("parseOrigins", () => {
  test("splits, trims, drops a trailing slash, lowercases, and keeps only http(s) origins", () => {
    expect(parseOrigins(" http://localhost:5173/ , HTTPS://Admin.Example.org,ftp://x.test, javascript:alert(1), https://a.test/path, ,")).toEqual([
      "http://localhost:5173",
      "https://admin.example.org",
    ]);
    expect(parseOrigins(undefined)).toEqual([]);
    expect(parseOrigins("")).toEqual([]);
  });
});

const announcement = { title: "Pendaftaran Dibuka", body: "Daftar sekarang melalui halaman Gabung Siswa.", severity: "info", active: true };

async function announcementCount(): Promise<number> {
  return (await env.DB.prepare("SELECT count(*) AS n FROM announcements").first<{ n: number }>())!.n;
}

describe("the guard in the worker", () => {
  // Negative check: remove `app.use("/api/*", sameOriginGuard);` from src/worker.ts.
  test("a signed-in editor's cookie sent from another site changes nothing", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);

    const fromEvil = await call("/api/announcements", { method: "POST", cookie, json: announcement, origin: "https://evil.example" });
    expect(fromEvil.status).toBe(403);
    expect(await fromEvil.json()).toEqual({ error: "forbidden", reason: "origin_mismatch" });
    expect(await announcementCount()).toBe(0);

    const crossSite = await call("/api/announcements", { method: "POST", cookie, json: announcement, origin: null, headers: { "sec-fetch-site": "cross-site" } });
    expect(crossSite.status).toBe(403);
    expect(await announcementCount()).toBe(0);

    // Same request from the site itself works.
    expect((await call("/api/announcements", { method: "POST", cookie, json: announcement })).status).toBe(201);
  });

  test("every unsafe method is checked: POST, PUT, PATCH, DELETE", async () => {
    const cookie = await signedInCookie(uniqueEmail("admin"), "super_admin");
    const created = await call("/api/announcements", { method: "POST", cookie, json: announcement });
    const id = ((await created.json()) as { announcement: { id: string } }).announcement.id;

    for (const [method, path] of [
      ["PUT", `/api/announcements/${id}`],
      ["DELETE", `/api/announcements/${id}`],
      ["PATCH", `/api/admin/users/${id}`],
      ["POST", `/api/admin/users/${id}/deactivate`],
      ["PUT", `/api/admin/users/${id}/areas`],
      ["POST", "/api/admin/users"],
    ] as const) {
      const res = await call(path, { method, cookie, json: announcement, origin: "https://evil.example" });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect(await announcementCount()).toBe(1); // still there
  });

  test("login CSRF: an attacker's page cannot sign a victim in to the attacker's account", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    for (const attempt of [{ origin: "https://evil.example" }, { origin: null, headers: { "sec-fetch-site": "cross-site" } }]) {
      const res = await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: PASSWORD }, ...attempt });
      expect(res.status).toBe(403);
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  test("registration and reset requests from another site are refused too", async () => {
    const email = uniqueEmail();
    const res = await call("/api/auth/register", { method: "POST", json: { name: "Sari", email, password: PASSWORD }, origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM users").first<{ n: number }>())!.n).toBe(0);
  });

  test("GET is never checked: the emailed links open from a mail client, which is a cross-site navigation", async () => {
    const email = uniqueEmail();
    await signUp(email);
    const link = linkIn(emailsTo(email)[0]!);
    const res = await call(link, { headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", referer: "https://mail.example/inbox" } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?verified=1");
  });

  test("a trusted origin may post (a dev server in front of the worker)", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);
    const trusted = { TRUSTED_ORIGINS: "http://localhost:5173" };
    const ok = await call("/api/announcements", { method: "POST", cookie, json: announcement, origin: "http://localhost:5173", env: trusted });
    expect(ok.status).toBe(201);
    const other = await call("/api/announcements", { method: "POST", cookie, json: announcement, origin: "http://localhost:5199", env: trusted });
    expect(other.status).toBe(403);
  });

  test("a client with no browser headers and no cookie is not refused by the guard (the route still demands a session)", async () => {
    const res = await call("/api/announcements", { method: "POST", json: announcement, origin: null });
    expect(res.status).toBe(401);
  });

  test("with a cookie and no signal at all, it is refused", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);
    const res = await call("/api/announcements", { method: "POST", cookie, json: announcement, origin: null });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden", reason: "no_origin_signal" });
  });

  test("the answer is not cacheable", async () => {
    const res = await call("/api/announcements", { method: "POST", json: announcement, origin: "https://evil.example" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(ORIGIN).toBe("https://admin.test");
  });
});
