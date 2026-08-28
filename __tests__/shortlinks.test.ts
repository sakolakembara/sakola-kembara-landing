import { describe, expect, test } from "vitest";
import {
  RESERVED_SLUGS,
  SLUG_MAX_LENGTH,
  validateSlug,
  validateTarget,
} from "@/lib/shortlinks";

// These two validators are the whole safety story for shortlinks: the slug
// check keeps an admin from minting a link that a real route silently
// shadows, and the target check keeps the redirect from being pointed at
// something dangerous or at itself.

describe("validateSlug", () => {
  test("accepts a plain slug", () => {
    expect(validateSlug("daftar-2026")).toEqual({ ok: true, slug: "daftar-2026" });
  });

  test("normalizes case and surrounding whitespace", () => {
    expect(validateSlug("  Daftar-2026 ")).toEqual({
      ok: true,
      slug: "daftar-2026",
    });
  });

  test("strips leading and trailing slashes so a pasted path works", () => {
    expect(validateSlug("/daftar/")).toEqual({ ok: true, slug: "daftar" });
  });

  test.each([
    ["", "empty"],
    ["   ", "whitespace only"],
    ["-daftar", "leading hyphen"],
    ["daftar-", "trailing hyphen"],
    ["daftar--2026", "doubled hyphen"],
    ["daftar 2026", "space"],
    ["daftar_2026", "underscore"],
    ["daftar/2026", "inner slash"],
    ["daftar.html", "dot"],
    ["daftär", "non-ascii"],
    ["daftar?x=1", "query string"],
  ])("rejects %j (%s)", (input) => {
    expect(validateSlug(input).ok).toBe(false);
  });

  test("rejects a slug longer than the limit", () => {
    expect(validateSlug("a".repeat(SLUG_MAX_LENGTH + 1)).ok).toBe(false);
    expect(validateSlug("a".repeat(SLUG_MAX_LENGTH)).ok).toBe(true);
  });

  test("rejects every reserved slug, case-insensitively", () => {
    for (const reserved of RESERVED_SLUGS) {
      expect(validateSlug(reserved).ok, reserved).toBe(false);
      expect(validateSlug(reserved.toUpperCase()).ok, reserved).toBe(false);
    }
  });

  test("reserves the real top-level routes", () => {
    // Guards against someone trimming the list without checking the router.
    for (const route of ["admin", "blog", "donasi", "tim", "portal", "login"]) {
      expect(RESERVED_SLUGS.has(route), route).toBe(true);
    }
  });

  test("allows a slug that merely starts with a reserved word", () => {
    expect(validateSlug("blog-2026").ok).toBe(true);
    expect(validateSlug("admin-panduan").ok).toBe(true);
  });
});

describe("validateTarget", () => {
  test("accepts an absolute https URL", () => {
    const result = validateTarget("https://forms.gle/abc123", "daftar");
    expect(result.ok).toBe(true);
  });

  test("accepts an internal path", () => {
    expect(validateTarget("/gabung-siswa", "daftar")).toEqual({
      ok: true,
      url: "/gabung-siswa",
    });
  });

  test.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
  ])("rejects the %j scheme", (input) => {
    expect(validateTarget(input, "daftar").ok).toBe(false);
  });

  test("rejects a protocol-relative URL", () => {
    // "//evil.com" would resolve off-site while looking like a local path.
    expect(validateTarget("//evil.com", "daftar").ok).toBe(false);
  });

  test("rejects an empty target", () => {
    expect(validateTarget("   ", "daftar").ok).toBe(false);
  });

  test("rejects a bare domain with no scheme", () => {
    expect(validateTarget("forms.gle/abc", "daftar").ok).toBe(false);
  });

  test("rejects a self-referential internal path", () => {
    expect(validateTarget("/daftar", "daftar").ok).toBe(false);
  });

  test.each([
    "https://sakolakembara.org/daftar",
    "https://www.sakolakembara.org/daftar",
    "https://sakolakembara.org/daftar/",
  ])("rejects the self-referential absolute URL %j", (input) => {
    expect(validateTarget(input, "daftar").ok).toBe(false);
  });

  test("allows the canonical domain when the path differs", () => {
    expect(validateTarget("https://sakolakembara.org/donasi", "daftar").ok).toBe(
      true,
    );
  });
});
