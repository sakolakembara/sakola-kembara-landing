import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { shortlinks, type Shortlink } from "@/lib/db/schema";

/**
 * Path segments the shortlink resolver can never win, because Next.js
 * resolves static routes and `public/` files ahead of the `app/[slug]`
 * dynamic segment. Saving one of these would produce a link that looks fine
 * in the admin list and silently never redirects, so `validateSlug` rejects
 * them up front.
 *
 * Keep in sync when adding a top-level route or a `public/` directory. The
 * list is deliberately a little wider than today's routes — `logout`, `auth`
 * and `dashboard` are reserved so an obvious future route can be added
 * without having to break a link already in circulation.
 */
export const RESERVED_SLUGS = new Set([
  // Route groups / app routes
  "admin",
  "api",
  "portal",
  "login",
  "logout",
  "register",
  "auth",
  "dashboard",
  "forgot-password",
  "reset-password",
  "verify-email",
  "blog",
  "donasi",
  "gabung-siswa",
  "kontak",
  "laporan",
  "program",
  "tim",
  "design", // component catalog, only enabled on previews (DESIGN_CATALOG=1)
  // Generated routes
  "robots",
  "sitemap",
  // public/ directories and Next internals
  "_next",
  "images",
  "files",
  "reports",
  "resources",
  "favicon",
  "static",
]);

/** Slug grammar: lowercase letters, digits and single inner hyphens. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SLUG_MAX_LENGTH = 64;

export type SlugCheck = { ok: true; slug: string } | { ok: false; message: string };

/**
 * Normalize and validate a slug. Returns the lowercased slug on success so
 * callers store exactly what the resolver will look up.
 */
export function validateSlug(input: string): SlugCheck {
  const slug = input.trim().toLowerCase().replace(/^\/+|\/+$/g, "");

  if (!slug) return { ok: false, message: "Slug wajib diisi." };
  if (slug.length > SLUG_MAX_LENGTH) {
    return { ok: false, message: `Slug maksimal ${SLUG_MAX_LENGTH} karakter.` };
  }
  if (!SLUG_RE.test(slug)) {
    return {
      ok: false,
      message:
        "Slug hanya boleh huruf kecil, angka, dan tanda hubung di antaranya (contoh: daftar-2026).",
    };
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

/**
 * Validate a redirect target. Accepts an absolute http(s) URL or a
 * site-internal path beginning with "/". Anything else — `javascript:`,
 * `data:`, a bare domain — is rejected.
 *
 * `slug` is passed so a link cannot be pointed at itself, which would make
 * the browser bounce until it gives up.
 */
export function validateTarget(input: string, slug: string): TargetCheck {
  const url = input.trim();
  if (!url) return { ok: false, message: "URL tujuan wajib diisi." };

  if (url.startsWith("/")) {
    if (url.startsWith("//")) {
      return {
        ok: false,
        message: "Gunakan URL lengkap (https://...) untuk tujuan di luar situs ini.",
      };
    }
    if (url === `/${slug}`) {
      return { ok: false, message: "Tujuan tidak boleh menunjuk ke shortlink itu sendiri." };
    }
    return { ok: true, url };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      message: "Format URL tidak valid. Gunakan https://... atau /path-di-situs-ini.",
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, message: "Hanya URL http:// atau https:// yang diizinkan." };
  }
  // Self-reference through the canonical domain loops just as hard as "/slug".
  if (
    parsed.hostname.replace(/^www\./, "") === "sakolakembara.org" &&
    parsed.pathname.replace(/\/+$/, "") === `/${slug}`
  ) {
    return { ok: false, message: "Tujuan tidak boleh menunjuk ke shortlink itu sendiri." };
  }
  return { ok: true, url: parsed.toString() };
}

/** Admin list — newest first. Always fresh, never cached. */
export async function getAllShortlinks(): Promise<Shortlink[]> {
  return db.select().from(shortlinks).orderBy(desc(shortlinks.createdAt));
}

export async function getShortlinkById(id: string): Promise<Shortlink | null> {
  const row = await db.query.shortlinks.findFirst({ where: eq(shortlinks.id, id) });
  return row ?? null;
}

/**
 * Resolve a slug for the public redirect. Returns the target only for an
 * active row; an inactive one resolves to null so the visitor gets the normal
 * 404 rather than a hint that the slug exists.
 */
export async function resolveShortlink(slug: string): Promise<Shortlink | null> {
  const row = await db.query.shortlinks.findFirst({
    where: eq(shortlinks.slug, slug),
  });
  if (!row || !row.active) return null;
  return row;
}

/**
 * Best-effort click accounting. Never throws — a redirect must not fail
 * because the counter could not be written.
 */
export async function recordShortlinkClick(id: string): Promise<void> {
  try {
    await db
      .update(shortlinks)
      .set({
        clickCount: sql`${shortlinks.clickCount} + 1`,
        lastClickedAt: new Date(),
      })
      .where(eq(shortlinks.id, id));
  } catch (err) {
    console.error("[shortlinks] failed to record click:", err);
  }
}
