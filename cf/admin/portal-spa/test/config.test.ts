import { describe, expect, test } from "vitest";
import { httpOrigin, NO_PORTAL_CONFIG, parsePortalConfig, siteLink } from "~/lib/public-config";

describe("parsePortalConfig", () => {
  test("reads what the Worker answers", () => {
    expect(parsePortalConfig({ google: true, turnstileSiteKey: "1x00000000000000000000AA", siteUrl: "https://sakolakembara.org", adminUrl: "https://admin.sakolakembara.org" })).toEqual({
      google: true,
      turnstileSiteKey: "1x00000000000000000000AA",
      siteUrl: "https://sakolakembara.org",
      adminUrl: "https://admin.sakolakembara.org",
    });
  });

  test("an answer without the admin's address has no link to it, and nothing else changes", () => {
    expect(parsePortalConfig({ google: false, turnstileSiteKey: null, siteUrl: "" })).toEqual({ ...NO_PORTAL_CONFIG });
  });

  test("anything that is not an object means nothing is configured", () => {
    for (const raw of [null, undefined, "x", 1, [], true]) expect(parsePortalConfig(raw), String(raw)).toEqual(NO_PORTAL_CONFIG);
  });
});

describe("httpOrigin: a place a student may be sent", () => {
  test("an http(s) origin, without a path, a query or a trailing slash", () => {
    expect(httpOrigin("https://sakolakembara.org/")).toBe("https://sakolakembara.org");
    expect(httpOrigin("  http://localhost:5173/x?y=1 ")).toBe("http://localhost:5173");
  });

  test.each(["", "   ", "javascript:alert(1)", "data:text/html,x", "ftp://x.test", "//evil.test", "evil.test", 5, null, undefined, {}])("%j is no place", (value) => {
    expect(httpOrigin(value)).toBe("");
  });
});

describe("siteLink", () => {
  test("with the public site's origin, or a path of this origin (the apex serves both)", () => {
    expect(siteLink("https://sakolakembara.org", "/gabung-siswa")).toBe("https://sakolakembara.org/gabung-siswa");
    expect(siteLink("", "/gabung-siswa")).toBe("/gabung-siswa");
  });
});
