// Writing and removing uploads: the R2 object, the `media` row and the audit
// row, kept consistent. The routes (src/api/uploads.ts) call these, and so
// will every later screen that replaces or removes a file:
//
//   deleteUploadByPath(c.env, user, oldPath)
//
// Call it AFTER the content row was saved without that path (a replaced photo,
// a deleted report). It removes the object and its `media` row only when no
// content row still references the path (src/uploads/references.ts), and it
// returns what it did instead of throwing, so a CRUD handler can ignore it: an
// object left behind is harmless, a file removed under a live page is not.
// Paths that are not uploads (the legacy static ones: /blog/images/..., /files/...)
// are not ours and are answered "not_found" without touching anything.

import type { AuthUser } from "../context";
import { auditStatement, type Db } from "../db/audit";
import * as schema from "../db/schema";
import type { MediaPurpose } from "../db/schema";
import type { Bindings } from "../env";
import { buildKey, keyForPath, pathForKey, slugFromFilename } from "./key";
import type { UploadKind } from "./kinds";
import { KIND_RULES } from "./kinds";
import { isReferencedSql, labelsInRow, referencingLabelsSql } from "./references";
import { FILE_TYPES, type FileType } from "./sniff";

/** Names are unique per upload (the id is in them), so a file never changes: browsers and the CDN may keep it for good. */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export interface UploadRecord {
  id: string;
  path: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
}

export interface UploadInput {
  kind: UploadKind;
  file: File;
  /** Found in the bytes by sniff(), not taken from the client. */
  type: FileType;
  width: number | null;
  height: number | null;
}

type Actor = Pick<AuthUser, "id" | "email">;
type Storage = Pick<Bindings, "UPLOADS" | "DB">;

export async function storeUpload(env: Storage, db: Db, actor: Actor, input: UploadInput, now: Date = new Date()): Promise<UploadRecord> {
  const { kind, file, type, width, height } = input;
  const { contentType, ext } = FILE_TYPES[type];
  const id = crypto.randomUUID();
  const key = buildKey({ kind, now, id, slug: slugFromFilename(file.name), ext });

  // The Blob goes to R2 as it is: no copy through JavaScript. `onlyIf` makes the put refuse an existing key
  // (it cannot exist, the id is new; this is the belt to the braces of the unique id).
  const stored = await env.UPLOADS.put(key, file, {
    httpMetadata: { contentType, cacheControl: IMMUTABLE_CACHE_CONTROL },
    onlyIf: { etagDoesNotMatch: "*" },
  });
  if (!stored) throw new Error("upload key already exists");

  try {
    await db.batch([
      db.insert(schema.media).values({
        id,
        key,
        purpose: KIND_RULES[kind].purpose,
        contentType,
        size: file.size,
        width,
        height,
        uploadedBy: actor.id,
      }),
      auditStatement(db, actor, {
        action: "upload.create",
        resourceType: "media",
        resourceId: id,
        metadata: { kind, path: pathForKey(key), contentType, size: file.size, width, height },
      }),
    ]);
  } catch (error) {
    // The row (and its audit entry) did not commit: do not leave an object nobody can find.
    await env.UPLOADS.delete(key).catch(() => console.error("[uploads] could not remove the object of a failed upload"));
    throw error;
  }

  return { id, path: pathForKey(key), contentType, size: file.size, width, height };
}

export type DeleteOutcome =
  | { status: "deleted" }
  | { status: "not_found" }
  /** `usedBy`: the menus (Blog, Tim, ...) that still reference the file. */
  | { status: "in_use"; usedBy: string[] };

export interface MediaRef {
  id: string;
  key: string;
}

export interface MediaRow extends MediaRef {
  purpose: MediaPurpose;
}

export async function findMedia(d1: D1Database, by: { id: string } | { key: string }): Promise<MediaRow | null> {
  const [column, value] = "id" in by ? (["id", by.id] as const) : (["key", by.key] as const);
  return d1.prepare(`SELECT id, key, purpose FROM media WHERE ${column} = ?`).bind(value).first<MediaRow>();
}

/** The menus (Blog, Tim, ...) whose registered columns mention `path`, once each; empty when nothing does. */
export async function menusUsing(d1: D1Database, path: string): Promise<string[]> {
  const probe = referencingLabelsSql(path);
  return labelsInRow(probe.labels, await d1.prepare(probe.sql.text).bind(...probe.sql.params).first<Record<string, unknown>>());
}

/** The audit row of a text alternative's change, written only when the media row is there (the statement before it updated it). Field names only, never the text. */
const AUDIT_UPDATE_SQL = `INSERT INTO audit_log (id, actor_id, actor_email, action, resource_type, resource_id, metadata)
SELECT ?, ?, ?, 'upload.update', 'media', ?, ?
WHERE EXISTS (SELECT 1 FROM media WHERE id = ?)`;

/** Sets (or, with null, clears) the text alternative of a media row. False when there is no such row. One batch: the change and its audit row. */
export async function updateAltText(env: Storage, actor: Actor, id: string, altText: string | null): Promise<boolean> {
  const [update] = await env.DB.batch<{ id: string }>([
    env.DB.prepare("UPDATE media SET alt_text = ? WHERE id = ? RETURNING id").bind(altText, id),
    env.DB.prepare(AUDIT_UPDATE_SQL).bind(crypto.randomUUID(), actor.id, actor.email.toLowerCase(), id, JSON.stringify({ fields: ["altText"] }), id),
  ]);
  return Boolean(update && update.results.length > 0);
}

/** The audit row of a delete, written only when the media row is gone (the statement before it removed it). */
const AUDIT_DELETE_SQL = `INSERT INTO audit_log (id, actor_id, actor_email, action, resource_type, resource_id, metadata)
SELECT ?, ?, ?, 'upload.delete', 'media', ?, ?
WHERE NOT EXISTS (SELECT 1 FROM media WHERE id = ?)`;

/**
 * Removes the media row and the R2 object unless a content row references the path.
 *
 * The check and the delete are ONE statement (`DELETE ... WHERE NOT <referenced> RETURNING`), so a reference
 * saved a moment earlier cannot be missed, and the audit row is written in the same batch only when that
 * delete took effect. The object goes second: the worst a failure there leaves is an unreferenced object.
 */
export async function deleteUnusedUpload(env: Storage, actor: Actor, media: MediaRef): Promise<DeleteOutcome> {
  const path = pathForKey(media.key);
  const referenced = isReferencedSql(path);
  const [removal] = await env.DB.batch<{ id: string }>([
    env.DB.prepare(`DELETE FROM media WHERE id = ? AND NOT ${referenced.text} RETURNING id`).bind(media.id, ...referenced.params),
    env.DB.prepare(AUDIT_DELETE_SQL).bind(crypto.randomUUID(), actor.id, actor.email.toLowerCase(), media.id, JSON.stringify({ path }), media.id),
  ]);

  if (!removal || removal.results.length === 0) {
    const usedBy = await menusUsing(env.DB, path);
    // Nothing references it and it was not deleted: it was already gone.
    return usedBy.length > 0 ? { status: "in_use", usedBy } : { status: "not_found" };
  }

  try {
    await env.UPLOADS.delete(media.key);
  } catch {
    console.error("[uploads] the media row was removed but its object could not be deleted");
  }
  return { status: "deleted" };
}

/** For later CRUD: see the comment at the top of this file. */
export async function deleteUploadByPath(env: Storage, actor: Actor, path: string): Promise<DeleteOutcome> {
  const key = keyForPath(path);
  if (!key) return { status: "not_found" };
  const row = await findMedia(env.DB, { key });
  return row ? deleteUnusedUpload(env, actor, row) : { status: "not_found" };
}
