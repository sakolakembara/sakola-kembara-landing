import { RESERVED_SLUGS } from "./reserved";

// What a shortlink may be called and where it may point. Port of validateSlug and validateTarget in the legacy
// lib/shortlinks.ts, with the legacy messages word for word. docs/cloudflare/admin-konten.md lists the three
// places where the target rule is stricter than the legacy one, and why.
//
// The database repeats the slug grammar and the shape of the target as CHECK constraints
// (shortlinks_slug_check, shortlinks_target_check), so a raw write cannot store what these refuse. The reserved
// list stays code: it follows the routing of the public site.

export const SLUG_MAX_LENGTH = 64;

/** Lowercase letters, digits and single inner hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The same grammar as a yes or no, for the public lookup: a path that cannot be a slug is a 404 without a D1 read. */
export function isShortlinkSlug(value: string): boolean {
  return value.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(value);
}

export type SlugCheck = { ok: true; slug: string } | { ok: false; message: string };

/** Trimmed, lower-cased and stripped of surrounding slashes, so pasting `/Daftar-2026/` works. What is stored is what the resolver looks up. */
export function normaliseSlug(input: string): string {
  return input.trim().toLowerCase().replace(/^\/+|\/+$/g, "");
}

export function validateSlug(input: string): SlugCheck {
  const slug = normaliseSlug(input);

  if (!slug) return { ok: false, message: "Slug wajib diisi." };
  if (slug.length > SLUG_MAX_LENGTH) return { ok: false, message: `Slug maksimal ${SLUG_MAX_LENGTH} karakter.` };
  if (!SLUG_PATTERN.test(slug)) {
    return { ok: false, message: "Slug hanya boleh huruf kecil, angka, dan tanda hubung di antaranya (contoh: daftar-2026)." };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return {
      ok: false,
      message: `"${slug}" sudah dipakai halaman lain di situs ini, jadi shortlink dengan slug tersebut tidak akan pernah terbuka. Pilih slug lain.`,
    };
  }
  return { ok: true, slug };
}

export type TargetCheck = { ok: true; url: string } | { ok: false; message: string };

const MESSAGES = {
  required: "URL tujuan wajib diisi.",
  format: "Format URL tidak valid. Gunakan https://... atau /path-di-situs-ini.",
  external: "Gunakan URL lengkap (https://...) untuk tujuan di luar situs ini.",
  scheme: "Hanya URL http:// atau https:// yang diizinkan.",
  self: "Tujuan tidak boleh menunjuk ke shortlink itu sendiri.",
} as const;

/** The host the site answers on: a target on it that points back at the slug is a loop (legacy: SITE_URL). */
const SITE_HOST = "sakolakembara.org";

/**
 * A tab, a newline or any other control character, or a backslash, anywhere in the target. NOT in the legacy
 * rule, and the one real hole in it: a URL parser deletes tabs and newlines and reads `\` as `/`, so `/\evil.example`
 * and `/<tab>/evil.example` pass the legacy test for "a path that does not start with //" and then redirect off
 * the site. Nothing legitimate contains any of these.
 */
const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/;

/** The path of a site-internal target: no query, no fragment, no trailing slash, lower case (the resolver lower-cases the slug it is asked for). */
function pathOf(target: string): string {
  return target.split(/[?#]/, 1)[0]!.replace(/\/+$/, "").toLowerCase();
}

/**
 * An absolute http(s) URL, or a site-internal path starting with a single "/". `javascript:`, `data:` and a bare
 * domain are refused, and so is `//host`, which reads as a path and resolves off the site. `slug` is passed so a
 * link cannot point at itself, which would make the browser bounce until it gives up.
 */
export function validateTarget(input: string, slug: string): TargetCheck {
  const url = input.trim();
  if (!url) return { ok: false, message: MESSAGES.required };
  if (CONTROL_OR_BACKSLASH.test(url)) return { ok: false, message: MESSAGES.format };

  if (url.startsWith("/")) {
    if (url.startsWith("//")) return { ok: false, message: MESSAGES.external };
    // Legacy refused only "/slug"; the same loop is "/Slug/", "/slug?utm=x" and "/slug#top".
    if (pathOf(url) === `/${slug}`) return { ok: false, message: MESSAGES.self };
    return { ok: true, url };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, message: MESSAGES.format };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, message: MESSAGES.scheme };
  // Self-reference through the canonical domain loops just as hard as "/slug".
  if (parsed.hostname.replace(/^www\./, "") === SITE_HOST && pathOf(parsed.pathname) === `/${slug}`) {
    return { ok: false, message: MESSAGES.self };
  }
  return { ok: true, url: parsed.toString() };
}

/**
 * What the public side checks again before it redirects: the target must be a single-slash path or an http(s)
 * URL with no control character or backslash. The admin never stores anything else (this file and the table's
 * CHECK), so this only matters if something other than the admin wrote the row; the cost is one pass over a short string.
 */
export function isSafeTarget(target: string): boolean {
  if (CONTROL_OR_BACKSLASH.test(target)) return false;
  if (target.startsWith("/")) return !target.startsWith("//");
  try {
    const parsed = new URL(target);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
