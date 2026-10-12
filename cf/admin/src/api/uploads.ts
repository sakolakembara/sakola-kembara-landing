import { and, count, desc, gte, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { loadAccess, type Access } from "../auth/guard";
import { can } from "../auth/permissions";
import type { AppEnv } from "../context";
import * as schema from "../db/schema";
import { checkLimits, limitedResponse } from "../security/rate-limit";
import { keyRange } from "../uploads/key";
import { areaOfPurpose, isUploadKind, KIND_RULES, MAX_UPLOAD_BYTES, megabytes, MULTIPART_OVERHEAD_BYTES, uploadAreas, type UploadKind } from "../uploads/kinds";
import { FILE_TYPES, MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE, SNIFF_WINDOW, sniff, type FileType } from "../uploads/sniff";
import { deleteUnusedUpload, findMedia, storeUpload } from "../uploads/store";

// Uploads to R2 (SAKEM-082, docs/cloudflare/uploads.md). Admin only. Three
// routes, none of them public:
//
//   POST   /api/admin/uploads        multipart: `file` and `kind`
//   GET    /api/admin/uploads        ?kind=&page=&pageSize=   what a picker lists
//   DELETE /api/admin/uploads/:id    only while no content row references the file
//
// The owning area comes from the KIND (src/uploads/kinds.ts), and the caller
// needs write access to that area (read access to list). The guard cannot be a
// static `requireArea` because the area depends on the kind, so: the caller
// must be able to write at least one upload area before the body is touched
// (viewer, student and editors of other areas stop there, cheaply), and the
// exact area of the kind is checked as soon as the kind is known. The client
// may announce the kind in `?kind=` too, which moves that check, and the
// size check, in front of the body; the form field is still the truth and a
// different value is refused.

export const uploadRoutes = new Hono<AppEnv>();

/** The legacy messages' wording where one existed ("Ukuran maksimal 5 MB.", "File kosong."). */
const MESSAGES = {
  noFile: "Tidak ada file.",
  empty: "File kosong.",
  corrupt: "File rusak atau tidak bisa dibaca. Coba simpan ulang lalu unggah lagi.",
  unreadableSize: "Ukuran gambar tidak terbaca. Simpan ulang gambar tanpa metadata yang besar.",
  tooBig: (bytes: number) => `Ukuran file maksimal ${megabytes(bytes)}.`,
  dimensions: `Dimensi gambar terlalu besar (maksimal ${String(MAX_IMAGE_SIDE).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} piksel per sisi dan ${MAX_IMAGE_PIXELS / 1_000_000} megapiksel).`,
  type: (types: readonly FileType[]) => `Tipe file tidak didukung. Gunakan: ${types.map(typeName).join(", ")}.`,
};

const typeName = (type: FileType) => (type === "jpeg" ? "JPEG" : type === "webp" ? "WebP" : type.toUpperCase());

/** A rejected upload: always `{ error, message }`, `message` ready to show. */
function refuse(c: Context<AppEnv>, status: 400 | 403 | 411 | 413 | 415 | 422, error: string, message: string, extra: Record<string, unknown> = {}) {
  return c.json({ error, message, ...extra }, status);
}

function mayWrite(access: Access, kind: UploadKind) {
  return can(access.user.role, access.grantedAreas, KIND_RULES[kind].area, "write");
}

/**
 * 401 for nobody, 403 unless the caller can write at least one upload area,
 * then the rate limit (per user: staff behind one office address must not
 * share a bucket), all before any body is read.
 */
const uploadWriter: MiddlewareHandler<AppEnv> = async (c, next) => {
  const access = await loadAccess(c);
  if (!access) return c.json({ error: "unauthenticated" }, 401);
  if (!uploadAreas.some((area) => can(access.user.role, access.grantedAreas, area, "write"))) return c.json({ error: "forbidden" }, 403);
  c.set("user", access.user);
  c.set("grantedAreas", access.grantedAreas);

  const limit = await checkLimits(c.env, [{ name: "upload", key: `upload:${access.user.id}` }]);
  if (!limit.allowed) return limitedResponse(limit);
  await next();
};

uploadRoutes.post("/", uploadWriter, async (c) => {
  const access: Access = { user: c.get("user"), grantedAreas: c.get("grantedAreas") };

  if (!c.req.header("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    return refuse(c, 415, "multipart_required", "Kirim file sebagai multipart/form-data.");
  }

  // The declared length is trustworthy: HTTP framing ends the body there. Required, so the size is known
  // before a single byte is read (a chunked body has no declared length and would be buffered unbounded).
  const declared = c.req.header("content-length");
  if (!declared || !/^\d{1,12}$/.test(declared)) return refuse(c, 411, "length_required", "Panjang permintaan tidak diketahui.");
  const length = Number(declared);

  // Optional early view of the kind, so that a wrong area or an oversized body is refused before the body is read.
  const announced = c.req.query("kind");
  if (announced !== undefined) {
    if (!isUploadKind(announced)) return refuse(c, 400, "invalid_kind", "Jenis unggahan tidak dikenal.");
    if (!mayWrite(access, announced)) return c.json({ error: "forbidden" }, 403);
    if (length > KIND_RULES[announced].maxBytes + MULTIPART_OVERHEAD_BYTES) return refuse(c, 413, "too_large", MESSAGES.tooBig(KIND_RULES[announced].maxBytes), { maxBytes: KIND_RULES[announced].maxBytes });
  } else if (length > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return refuse(c, 413, "too_large", MESSAGES.tooBig(MAX_UPLOAD_BYTES), { maxBytes: MAX_UPLOAD_BYTES });
  }

  // The one place the body is read. Parsed natively; the file stays a Blob that R2 takes as it is.
  const form = await c.req.raw.formData().catch(() => null);
  if (!form) return refuse(c, 400, "invalid_form", "Isi permintaan tidak bisa dibaca.");

  const kind = form.get("kind");
  if (!isUploadKind(kind)) return refuse(c, 400, "invalid_kind", "Jenis unggahan tidak dikenal.");
  if (announced !== undefined && announced !== kind) return refuse(c, 400, "kind_mismatch", "Jenis unggahan di alamat dan di formulir berbeda.");
  const rule = KIND_RULES[kind];
  if (!mayWrite(access, kind)) return c.json({ error: "forbidden" }, 403);

  const file = form.get("file");
  if (!(file instanceof File)) return refuse(c, 400, "file_required", MESSAGES.noFile);
  if (file.size === 0) return refuse(c, 400, "empty_file", MESSAGES.empty);
  if (file.size > rule.maxBytes) return refuse(c, 413, "too_large", MESSAGES.tooBig(rule.maxBytes), { maxBytes: rule.maxBytes });

  // Identify the file by its bytes: only the first megabyte is read, whatever the size.
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, SNIFF_WINDOW)).arrayBuffer());
  const found = sniff(head, file.size);
  if (!found.ok) {
    switch (found.reason) {
      case "unknown_type":
        return refuse(c, 415, "unsupported_type", MESSAGES.type(rule.types), { allowed: rule.types.map((type) => FILE_TYPES[type].contentType) });
      case "dimensions_too_large":
        return refuse(c, 422, "dimensions_too_large", MESSAGES.dimensions, { maxSide: MAX_IMAGE_SIDE, maxPixels: MAX_IMAGE_PIXELS });
      case "unreadable_size":
        return refuse(c, 422, "unreadable_size", MESSAGES.unreadableSize);
      default:
        return refuse(c, 422, "invalid_file", MESSAGES.corrupt);
    }
  }
  if (!rule.types.includes(found.type)) {
    return refuse(c, 415, "unsupported_type", MESSAGES.type(rule.types), { allowed: rule.types.map((type) => FILE_TYPES[type].contentType) });
  }

  const db = drizzle(c.env.DB, { schema });
  const upload = await storeUpload(c.env, db, access.user, { kind, file, type: found.type, width: found.width, height: found.height });
  return c.json(upload, 201);
});

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback;
}

// What a picker shows: newest first, one kind at a time. Read access to the kind's area is enough.
uploadRoutes.get("/", async (c) => {
  const access = await loadAccess(c);
  if (!access) return c.json({ error: "unauthenticated" }, 401);
  const kind = c.req.query("kind");
  if (!isUploadKind(kind)) return refuse(c, 400, "invalid_kind", "Jenis unggahan tidak dikenal.");
  if (!can(access.user.role, access.grantedAreas, KIND_RULES[kind].area, "read")) return c.json({ error: "forbidden" }, 403);

  const page = positiveInt(c.req.query("page"), 1, 100_000);
  const pageSize = positiveInt(c.req.query("pageSize"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const db = drizzle(c.env.DB, { schema });
  const range = keyRange(kind);
  const inKind = and(gte(schema.media.key, range.from), lt(schema.media.key, range.to));

  // One round trip: the page and the total.
  const [rows, totals] = await db.batch([
    db
      .select({
        id: schema.media.id,
        key: schema.media.key,
        contentType: schema.media.contentType,
        size: schema.media.size,
        width: schema.media.width,
        height: schema.media.height,
        createdAt: schema.media.createdAt,
      })
      .from(schema.media)
      .where(inKind)
      .orderBy(desc(schema.media.createdAt), desc(schema.media.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(schema.media).where(inKind),
  ]);
  const total = totals[0]?.total ?? 0;

  // Explicit fields: the uploader's id is not part of the answer.
  return c.json({
    items: rows.map((row) => ({
      id: row.id,
      path: `/${row.key}`,
      contentType: row.contentType,
      size: row.size,
      width: row.width,
      height: row.height,
      createdAt: row.createdAt.toISOString(),
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

uploadRoutes.delete("/:id", uploadWriter, async (c) => {
  const id = c.req.param("id");
  const media = /^[0-9a-f-]{36}$/.test(id) ? await findMedia(c.env.DB, { id }) : null;
  if (!media) return c.json({ error: "not_found" }, 404);

  // The owning area follows from what the file was uploaded for.
  const access: Access = { user: c.get("user"), grantedAreas: c.get("grantedAreas") };
  if (!can(access.user.role, access.grantedAreas, areaOfPurpose(media.purpose), "write")) return c.json({ error: "forbidden" }, 403);

  const outcome = await deleteUnusedUpload(c.env, access.user, media);
  switch (outcome.status) {
    case "deleted":
      return c.body(null, 204);
    case "in_use":
      return c.json({ error: "in_use", message: `File masih dipakai di: ${outcome.usedBy.join(", ")}. Lepaskan dulu dari sana.`, usedBy: outcome.usedBy }, 409);
    default:
      return c.json({ error: "not_found" }, 404);
  }
});
