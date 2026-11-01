import { and, count, desc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { loadAccess, type Access } from "../auth/guard";
import { can } from "../auth/permissions";
import type { AppEnv } from "../context";
import * as schema from "../db/schema";
import { checkLimits, limitedResponse } from "../security/rate-limit";
import { kindOfKey, keyRange, nameOfKey } from "../uploads/key";
import { areaOfPurpose, isUploadKind, KIND_RULES, MAX_UPLOAD_BYTES, megabytes, MULTIPART_OVERHEAD_BYTES, uploadAreas, type UploadKind } from "../uploads/kinds";
import { FILE_TYPES, MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE, SNIFF_WINDOW, sniff, type FileType } from "../uploads/sniff";
import { deleteUnusedUpload, findMedia, menusUsing, storeUpload, updateAltText } from "../uploads/store";
import { getDb } from "../db/client";
import { invalidQuery, notFound, parseBody } from "./crud";

// Uploads to R2 (SAKEM-082, docs/cloudflare/uploads.md) and the Media library on
// top of them (SAKEM-117). Admin only, none of the routes public:
//
//   POST   /api/admin/uploads        multipart: `file` and `kind`
//   GET    /api/admin/uploads        ?kind=&q=&type=&from=&to=&page=&pageSize=   what a picker or the library lists
//   GET    /api/admin/uploads/:id    one file, and the menus that use it
//   PATCH  /api/admin/uploads/:id    its text alternative
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

  const db = getDb(c.env.DB);
  const upload = await storeUpload(c.env, db, access.user, { kind, file, type: found.type, width: found.width, height: found.height });
  return c.json(upload, 201);
});

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback;
}

const MAX_SEARCH_LENGTH = 100;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
/** What the filters take for a date: `2026-10-01` (the start of that day, UTC) or a full instant with its zone. Anything looser is refused: `Date.parse("1")` is a year. */
const INSTANT = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

/** The file name inside a key, in SQL: everything after the last "/". The folder names ("blog-image") must not match a search. */
const fileNameSql = sql`replace(${schema.media.key}, rtrim(${schema.media.key}, replace(${schema.media.key}, '/', '')), '')`;

type Conditions = { ok: true; conditions: SQL[] } | { ok: false; param: string };

/**
 * The search and filters of the list, as conditions on the media table (all on `media` columns, so the count needs no join).
 * `q` is plain text matched against the file's name and its text alternative: `instr`, not LIKE, so a "%" or "_" matches only itself.
 */
function filtersOf(c: Context<AppEnv>): Conditions {
  const conditions: SQL[] = [];

  const q = c.req.query("q")?.trim();
  if (q) {
    if (q.length > MAX_SEARCH_LENGTH) return { ok: false, param: "q" };
    // SQLite's lower() folds ASCII only, which is what file names and Indonesian text are made of.
    const needle = q.toLowerCase();
    conditions.push(or(sql`instr(lower(${fileNameSql}), ${needle}) > 0`, sql`instr(lower(coalesce(${schema.media.altText}, '')), ${needle}) > 0`)!);
  }

  const type = c.req.query("type");
  if (type) {
    if (type === "image") conditions.push(sql`${schema.media.contentType} like 'image/%'`);
    else if (type === "pdf") conditions.push(sql`${schema.media.contentType} = 'application/pdf'`);
    else return { ok: false, param: "type" };
  }

  for (const [param, apply] of [
    ["from", (at: Date) => gte(schema.media.createdAt, at)],
    ["to", (at: Date) => lt(schema.media.createdAt, at)],
  ] as const) {
    const raw = c.req.query(param);
    if (!raw) continue;
    const at = INSTANT.test(raw) ? new Date(raw) : null;
    if (!at || Number.isNaN(at.getTime())) return { ok: false, param };
    conditions.push(apply(at));
  }
  return { ok: true, conditions };
}

interface MediaItemRow {
  id: string;
  key: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  createdAt: Date;
  uploadedByName: string | null;
}

/** What the library and a picker see of one file. Explicit fields: the uploader's id and e-mail are not part of the answer, only the name staff know them by. */
function present(row: MediaItemRow) {
  return {
    id: row.id,
    path: `/${row.key}`,
    name: nameOfKey(row.key),
    kind: kindOfKey(row.key),
    contentType: row.contentType,
    size: row.size,
    width: row.width,
    height: row.height,
    altText: row.altText,
    uploadedByName: row.uploadedByName,
    createdAt: row.createdAt.toISOString(),
  };
}

const mediaColumns = {
  id: schema.media.id,
  key: schema.media.key,
  purpose: schema.media.purpose,
  contentType: schema.media.contentType,
  size: schema.media.size,
  width: schema.media.width,
  height: schema.media.height,
  altText: schema.media.altText,
  createdAt: schema.media.createdAt,
  uploadedByName: schema.users.name,
};

// What a picker or the Media library shows: newest first. With `kind`, one kind (a picker for a field that takes only that kind);
// without it, every file the caller may read (the library). Read access to the kind's area (to the area of each purpose) is enough.
uploadRoutes.get("/", async (c) => {
  const access = await loadAccess(c);
  if (!access) return c.json({ error: "unauthenticated" }, 401);
  const db = getDb(c.env.DB);

  const kind = c.req.query("kind");
  let scope: SQL;
  if (kind !== undefined) {
    if (!isUploadKind(kind)) return refuse(c, 400, "invalid_kind", "Jenis unggahan tidak dikenal.");
    if (!can(access.user.role, access.grantedAreas, KIND_RULES[kind].area, "read")) return c.json({ error: "forbidden" }, 403);
    const range = keyRange(kind);
    scope = and(gte(schema.media.key, range.from), lt(schema.media.key, range.to))!;
  } else {
    // The library: the purposes whose area the caller can read. A caller who can read none gets the same refusal as a picker.
    const purposes = schema.mediaPurpose.filter((purpose) => can(access.user.role, access.grantedAreas, areaOfPurpose(purpose), "read"));
    if (purposes.length === 0) return c.json({ error: "forbidden" }, 403);
    scope = inArray(schema.media.purpose, purposes);
  }

  const filters = filtersOf(c);
  if (!filters.ok) return invalidQuery(c, filters.param);
  const where = and(scope, ...filters.conditions);

  const page = positiveInt(c.req.query("page"), 1, 100_000);
  const pageSize = positiveInt(c.req.query("pageSize"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  // One round trip: the page and the total.
  const [rows, totals] = await db.batch([
    db
      .select(mediaColumns)
      .from(schema.media)
      .leftJoin(schema.users, eq(schema.media.uploadedBy, schema.users.id))
      .where(where)
      .orderBy(desc(schema.media.createdAt), desc(schema.media.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(schema.media).where(where),
  ]);
  const total = totals[0]?.total ?? 0;

  return c.json({
    items: rows.map(present),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

async function loadMedia(c: Context<AppEnv>, id: string) {
  const [row] = await getDb(c.env.DB).select(mediaColumns).from(schema.media).leftJoin(schema.users, eq(schema.media.uploadedBy, schema.users.id)).where(eq(schema.media.id, id)).limit(1);
  return row ?? null;
}

// One file with the menus that use it (the panel of the library: "Dipakai di").
uploadRoutes.get("/:id", async (c) => {
  const access = await loadAccess(c);
  if (!access) return c.json({ error: "unauthenticated" }, 401);
  const id = c.req.param("id");
  const row = UUID.test(id) ? await loadMedia(c, id) : null;
  if (!row) return notFound(c);
  if (!can(access.user.role, access.grantedAreas, areaOfPurpose(row.purpose), "read")) return c.json({ error: "forbidden" }, 403);
  return c.json({ item: present(row), usedBy: await menusUsing(c.env.DB, `/${row.key}`) });
});

/** The text alternative: up to 300 characters (a sentence or two); empty is none. */
const altTextBody = z.object({
  altText: z
    .string()
    .trim()
    .max(300, "Teks alternatif maksimal 300 karakter.")
    .nullable()
    .transform((value) => (value === "" ? null : value)),
});

// Only the text alternative can be edited: the file itself never changes (a name is never overwritten). Same area rule as a delete.
// No If-Match: a media row has no version, and two people writing the same sentence for a picture is not worth a conflict.
uploadRoutes.patch("/:id", async (c) => {
  const access = await loadAccess(c);
  if (!access) return c.json({ error: "unauthenticated" }, 401);
  const id = c.req.param("id");
  const found = UUID.test(id) ? await findMedia(c.env.DB, { id }) : null;
  if (!found) return notFound(c);
  if (!can(access.user.role, access.grantedAreas, areaOfPurpose(found.purpose), "write")) return c.json({ error: "forbidden" }, 403);

  const body = await parseBody(c, altTextBody);
  if (!body.ok) return body.response;
  if (!(await updateAltText(c.env, access.user, id, body.data.altText))) return notFound(c);
  const row = await loadMedia(c, id);
  return row ? c.json({ item: present(row) }) : notFound(c);
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
