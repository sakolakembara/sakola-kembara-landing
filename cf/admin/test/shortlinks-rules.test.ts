import { describe, expect, test } from "vitest";
import { RESERVED_SLUGS } from "../src/shortlinks/reserved";
import { isSafeTarget, isShortlinkSlug, normaliseSlug, SLUG_MAX_LENGTH, validateSlug, validateTarget } from "../src/shortlinks/rules";

// The rules of what a shortlink may be called and where it may point (src/shortlinks/rules.ts): the legacy
// validateSlug and validateTarget, message for message, plus the three places where the target rule is stricter
// (control characters and backslashes, a loop through a query or another case, and the same check on the way out).

const GRAMMAR = "Slug hanya boleh huruf kecil, angka, dan tanda hubung di antaranya (contoh: daftar-2026).";
const SCHEME = "Hanya URL http:// atau https:// yang diizinkan.";
const FORMAT = "Format URL tidak valid. Gunakan https://... atau /path-di-situs-ini.";
const EXTERNAL = "Gunakan URL lengkap (https://...) untuk tujuan di luar situs ini.";
const SELF = "Tujuan tidak boleh menunjuk ke shortlink itu sendiri.";

describe("validateSlug (the legacy rule)", () => {
  test.each([
    ["daftar-2026", "daftar-2026"],
    ["a", "a"],
    ["a-b-c", "a-b-c"],
    ["2026", "2026"],
    [" DAFTAR-2026 ", "daftar-2026"],
    ["/Daftar-2026/", "daftar-2026"],
    ["///rapat-2026///", "rapat-2026"],
    ["a".repeat(SLUG_MAX_LENGTH), "a".repeat(SLUG_MAX_LENGTH)],
  ])("%j is accepted as %j", (input, slug) => {
    expect(validateSlug(input)).toEqual({ ok: true, slug });
  });

  test("an empty slug", () => {
    for (const input of ["", "   ", "/", "///"]) expect(validateSlug(input), JSON.stringify(input)).toEqual({ ok: false, message: "Slug wajib diisi." });
  });

  test("more than 64 characters", () => {
    expect(validateSlug("a".repeat(65))).toEqual({ ok: false, message: "Slug maksimal 64 karakter." });
  });

  test.each(["daftar--2026", "-daftar", "daftar-", "daftar_2026", "daftar.2026", "daftar 2026", "daftar/2026", "dästar", "日本語", "a%20b", "<script>", "a\nb"])("%j breaks the grammar", (input) => {
    expect(validateSlug(input)).toEqual({ ok: false, message: GRAMMAR });
  });

  test("the grammar is the database's CHECK too: whatever passes here, the table accepts", () => {
    // 1 to 64 characters, lowercase letters and digits, single inner hyphens (shortlinks_slug_check).
    for (const slug of ["a", "a1", "1a", "a-b", "a-b-c-d", "0".repeat(64)]) expect(isShortlinkSlug(slug)).toBe(true);
    for (const slug of ["", "A", "a--b", "-a", "a-", "a_b", "a".repeat(65)]) expect(isShortlinkSlug(slug)).toBe(false);
  });

  test("a reserved slug is refused with the legacy sentence, whatever its case or slashes", () => {
    for (const input of ["donasi", "Donasi", "/tim/", " LAPORAN ", "gabung-siswa", "about", "tentang-kami", "404", "wp-admin", "/WP-JSON/"]) {
      const slug = normaliseSlug(input);
      expect(validateSlug(input), input).toEqual({
        ok: false,
        message: `"${slug}" sudah dipakai halaman lain di situs ini, jadi shortlink dengan slug tersebut tidak akan pernah terbuka. Pilih slug lain.`,
      });
    }
  });

  test("a near miss of a reserved name is a free slug", () => {
    for (const slug of ["donasi-2026", "tim-kami", "blogger", "daftar-2026", "program-baru", "api2", "wp-adminx", "wp-login", "xmlrpc"]) expect(validateSlug(slug), slug).toEqual({ ok: true, slug });
  });

  test("`daftar` is NOT reserved: it is the registration shortlink, whose target an admin sets for each cohort (SAKEM-103)", () => {
    expect(RESERVED_SLUGS.has("daftar")).toBe(false);
    for (const input of ["daftar", "Daftar", "/daftar/", " DAFTAR "]) expect(validateSlug(input), input).toEqual({ ok: true, slug: "daftar" });
  });

  test("`apply` is NOT reserved: it is the volunteer link, a custom shortlink whose target an admin sets (SAKEM-107)", () => {
    expect(RESERVED_SLUGS.has("apply")).toBe(false);
    for (const input of ["apply", "Apply", "/apply/", " APPLY "]) expect(validateSlug(input), input).toEqual({ ok: true, slug: "apply" });
  });
});

describe("the reserved list", () => {
  // The legacy RESERVED_SLUGS (lib/shortlinks.ts), copied: none of them may ever leave the list.
  const LEGACY = [
    "admin", "api", "portal", "login", "logout", "register", "auth", "dashboard", "forgot-password", "reset-password", "verify-email",
    "blog", "donasi", "gabung-siswa", "kontak", "laporan", "program", "tim", "robots", "sitemap", "_next", "images", "files", "reports",
    "resources", "favicon", "static",
  ];
  // What the Cloudflare site added: the 404 page, and the sources of cf/web/redirects.config.mjs that are one segment.
  const NEW = ["404", "cerita", "education", "news", "tips", "testimonials", "career", "kiat-kiat", "tentang-kami", "about", "impact-reports", "feed", "wp-content", "wp-admin", "wp-includes", "wp-json"];
  // SAKEM-090: the WordPress pages and archives the table now redirects.
  const WORDPRESS_PAGES = [
    "home", "sample-page", "who-we-are", "our-partners", "contact-us", "donate", "donation-confirmation", "donation-confirmation-2",
    "donation-failed", "donation-failed-2", "donor-dashboard", "donor-dashboard-2", "work-with-us", "category", "tag",
  ];

  test.each([...LEGACY, ...NEW, ...WORDPRESS_PAGES])("%s is reserved", (slug) => {
    expect(RESERVED_SLUGS.has(slug)).toBe(true);
  });

  test("it holds names and nothing else: lower case, no slash", () => {
    for (const slug of RESERVED_SLUGS) expect(slug, slug).toMatch(/^[a-z0-9_][a-z0-9_-]*$/);
  });
});

describe("validateTarget: where a link may point", () => {
  test.each([
    ["/gabung-siswa", "/gabung-siswa"],
    ["/gabung-siswa?utm_source=ig#daftar", "/gabung-siswa?utm_source=ig#daftar"],
    ["/blog/artikel-saya", "/blog/artikel-saya"],
    ["/", "/"],
    ["https://forms.gle/abc123", "https://forms.gle/abc123"],
    ["http://example.org/halaman?x=1", "http://example.org/halaman?x=1"],
    // An absolute URL is stored as the URL parser writes it (legacy: parsed.toString()).
    ["https://example.org", "https://example.org/"],
    ["HTTPS://Example.ORG/Path", "https://example.org/Path"],
    ["  https://example.org/a b  ", "https://example.org/a%20b"],
    ["https://sakolakembara.org/gabung-siswa", "https://sakolakembara.org/gabung-siswa"],
  ])("%j is accepted as %j", (input, url) => {
    expect(validateTarget(input, "daftar-2026")).toEqual({ ok: true, url });
  });

  test("an empty target", () => {
    for (const input of ["", "   "]) expect(validateTarget(input, "x")).toEqual({ ok: false, message: "URL tujuan wajib diisi." });
  });

  // The legacy rule: only http(s) is followed. Nothing that runs code, shows a local file or leaves the browser.
  test.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(document.cookie)",
    "jAvAsCrIpT:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.org/x",
    "mailto:someone@example.org",
    "tel:+620000000",
    "blob:https://example.org/00000000-0000-0000-0000-000000000000",
    "about:blank",
    "chrome://settings",
  ])("%j is refused as a scheme", (input) => {
    expect(validateTarget(input, "x")).toEqual({ ok: false, message: SCHEME });
  });

  test("a bare domain, a half URL and text are refused as a format", () => {
    for (const input of ["example.org", "www.example.org/path", "https://", "http://", "https:// example.org", "forms.gle/abc", "halo", "?x=1", "#top"]) {
      expect(validateTarget(input, "x"), input).toEqual({ ok: false, message: FORMAT });
    }
  });

  test("//host reads as a path and leaves the site: refused (legacy)", () => {
    for (const input of ["//evil.example", "//evil.example/path", "///evil.example"]) {
      expect(validateTarget(input, "x"), input).toEqual({ ok: false, message: EXTERNAL });
    }
  });

  // NOT in the legacy rule: the same off-site jump written so that `startsWith("//")` does not see it. A URL parser
  // reads `\` as `/` and deletes tabs and newlines, so each of these is `//evil.example` to a browser.
  test.each(["/\\evil.example", "/\\/evil.example", "\\\\evil.example", "\\/evil.example", "/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/\u0000/evil.example", "https://exa\tmple.org", "https://example.org/a\nb", "/ok\\path", "https://example.org\\@evil.example"])(
    "%j is refused",
    (input) => {
      expect(validateTarget(input, "x")).toEqual({ ok: false, message: FORMAT });
    },
  );

  test("a percent-encoded tab is just text and stays on the site", () => {
    expect(validateTarget("/%09/evil.example", "x")).toEqual({ ok: true, url: "/%09/evil.example" });
    expect(validateTarget("/%5Cevil.example", "x")).toEqual({ ok: true, url: "/%5Cevil.example" });
  });

  test.each(["/daftar-2026", "/Daftar-2026", "/daftar-2026/", "/daftar-2026//", "/daftar-2026?utm=x", "/daftar-2026#top", "/DAFTAR-2026/?a=1#b"])("%j points at its own shortlink", (input) => {
    expect(validateTarget(input, "daftar-2026")).toEqual({ ok: false, message: SELF });
  });

  test.each([
    "https://sakolakembara.org/daftar-2026",
    "https://www.sakolakembara.org/daftar-2026",
    "https://www.sakolakembara.org/Daftar-2026/",
    "HTTPS://SAKOLAKEMBARA.ORG/daftar-2026?x=1",
    "http://sakolakembara.org/daftar-2026#top",
  ])("%j points at its own shortlink through the canonical domain", (input) => {
    expect(validateTarget(input, "daftar-2026")).toEqual({ ok: false, message: SELF });
  });

  test("close to itself but not itself is allowed", () => {
    for (const input of ["/daftar-2026/lagi", "/daftar-20260", "/daftar", "https://sakolakembara.org/daftar-2026/lagi", "https://other.example/daftar-2026", "https://sakolakembara.org.evil.example/daftar-2026"]) {
      expect(validateTarget(input, "daftar-2026").ok, input).toBe(true);
    }
  });
});

describe("isSafeTarget: the same check, once more, on the way out", () => {
  test.each(["/gabung-siswa", "/", "/a?b=c#d", "https://example.org/x", "http://example.org", "https://sakolakembara.org/daftar"])("%j may be followed", (target) => {
    expect(isSafeTarget(target)).toBe(true);
  });
  test.each(["", "javascript:alert(1)", "data:text/html,x", "//evil.example", "/\\evil.example", "/\t/evil.example", "evil.example", "https://", "ftp://example.org", "https://example.org/a\nb"])("%j may not", (target) => {
    expect(isSafeTarget(target)).toBe(false);
  });
});
