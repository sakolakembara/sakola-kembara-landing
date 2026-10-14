import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";
import { MAX_FILE_BYTES } from "../shared/application-form/limits";
import type { SlotId } from "../shared/application-form/slots";
import type { Bindings } from "../src/env";
import { buildKey, STORED_TYPES, type StoredFileType } from "../src/private-files/key";
import { DAY } from "./public-helpers";
import { cookieHeaderOf, createVerifiedStudent, portalCall, portalSignIn } from "./portal-helpers";
import { addApplication, addBatch } from "./pendaftaran-helpers";
import { uniqueEmail } from "./helpers";
import { jpeg, padTo, pdf, png, webp } from "./uploads-helpers";

// Fixtures and calls for the tests of the private files (SAKEM-083, P4): a student with a cookie, a batch that is open,
// a draft with files, and the readers of the bucket and the tables. The bytes come from test/uploads-helpers.ts (real
// headers, padded with zeros: the checks under test read headers only).

export const FILES = "/portal/api/applications/current/files";
export const OWN_FILE = "/portal/api/files";
export const ADMIN_APPLICATIONS = "/api/admin/applications";

export interface Student {
  id: string;
  email: string;
  cookie: string;
}

/** A verified student, signed in on the portal. */
export async function student(label = "siswa"): Promise<Student> {
  const email = uniqueEmail(label);
  const id = await createVerifiedStudent(email);
  const res = await portalSignIn(email);
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status}`);
  return { id, email, cookie: cookieHeaderOf(res) };
}

/** A batch that is open now, and (unless `year` is given) the next year no batch of this test has used. */
export async function openBatch(over: Parameters<typeof addBatch>[0] = {}) {
  return addBatch({ opensAt: new Date(Date.now() - DAY), closesAt: new Date(Date.now() + 30 * DAY), ...over });
}

export async function addDraft(userId: string, batchId: string, over: { id?: string; formData?: unknown } = {}): Promise<string> {
  const id = over.id ?? crypto.randomUUID();
  await env.DB.prepare("INSERT INTO application_drafts (id, user_id, batch_id, form_data) VALUES (?, ?, ?, ?)")
    .bind(id, userId, batchId, JSON.stringify(over.formData ?? {}))
    .run();
  return id;
}

/** The submitted application of a student (a row of `student_applications`, with the draft's id as the real submit does). */
export async function addSubmitted(student: Student, batchId: string, id: string = crypto.randomUUID()) {
  return addApplication(batchId, { id, userId: student.id, email: student.email });
}

// ─── Bytes ──────────────────────────────────────────────────────────────

export const bytes = {
  png: (size = 0, w = 40, h = 30) => padTo(png(w, h), size),
  jpeg: (size = 0, w = 40, h = 30) => padTo(jpeg(w, h), size),
  webp: (size = 0) => padTo(webp("lossy", 40, 30), size),
  pdf: (size = 0) => padTo(pdf(), size),
};

export type FileKind = "png" | "jpeg" | "webp" | "pdf";
export const bytesOf = (kind: FileKind, size = 0) => bytes[kind](size);

// ─── Calls ──────────────────────────────────────────────────────────────

export interface PutInit {
  cookie?: string;
  /** What the client says the file is: never believed, never read. */
  claimedType?: string;
  replace?: string;
  /** Sent as Content-Length instead of the real one; `null` sends none. */
  contentLength?: number | null;
  headers?: Record<string, string>;
  env?: Partial<Bindings>;
  ip?: string | null;
  query?: string;
}

/** `PUT .../files/:slot` with the raw bytes as the body, as the browser's XMLHttpRequest sends it. */
export function putFile(slot: string, body: Uint8Array | ReadableStream<Uint8Array>, init: PutInit = {}): Promise<Response> {
  const headers: Record<string, string> = { "content-type": init.claimedType ?? "application/octet-stream", ...init.headers };
  const length = init.contentLength === undefined ? (body instanceof Uint8Array ? body.byteLength : undefined) : init.contentLength;
  if (length !== null && length !== undefined) headers["content-length"] = String(length);
  const query = init.replace ? `?replace=${init.replace}` : (init.query ?? "");
  return portalCall(`${FILES}/${slot}${query}`, { method: "PUT", body, cookie: init.cookie, headers, env: init.env, ip: init.ip, duplex: "half" } as RequestInit & Parameters<typeof portalCall>[1]);
}

/** A stream of `chunks` that ends, or fails with `fail` after them (a client that dropped the connection). */
export function streamOf(chunks: Uint8Array[], fail = false): ReadableStream<Uint8Array> {
  let next = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (next < chunks.length) controller.enqueue(chunks[next++]!);
      else if (fail) controller.error(new Error("connection reset"));
      else controller.close();
    },
  });
}

export const deleteFile = (fileId: string, cookie?: string, init: { env?: PutInit["env"] } = {}) =>
  portalCall(`${FILES}/${fileId}`, { method: "DELETE", cookie, env: init.env });

export const readOwnFile = (fileId: string, cookie?: string, init: { headers?: Record<string, string>; method?: string } = {}) =>
  portalCall(`${OWN_FILE}/${fileId}`, { method: init.method ?? "GET", cookie, headers: init.headers });

export interface Uploaded {
  file: { id: string; slot: string; contentType: string; size: number; width: number | null; height: number | null; uploadedAt: string };
  usage: { slotCount: number; slotMax: number; applicationFiles: number; applicationBytes: number };
  draft: { id: string; missingFiles: string[] };
}

/** A file stored through the API; throws unless it answered 201. */
export async function upload(student: Student, slot: SlotId, body: Uint8Array = bytes.png(), init: PutInit = {}): Promise<Uploaded> {
  const res = await putFile(slot, body, { cookie: student.cookie, ...init });
  if (res.status !== 201) throw new Error(`upload to ${slot} answered ${res.status}: ${await res.text()}`);
  return (await res.json()) as Uploaded;
}

// ─── The bucket and the tables ──────────────────────────────────────────

/** Empties the private test bucket (the D1 tables are emptied by test/setup.ts). */
export async function clearPrivateBucket(): Promise<void> {
  let cursor: string | undefined;
  do {
    const listing = await env.PRIVATE_FILES.list({ cursor, limit: 500 });
    if (listing.objects.length > 0) await env.PRIVATE_FILES.delete(listing.objects.map((object) => object.key));
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
}

/** Every test starts with an empty private bucket. Call once at the top of a file. */
export function emptyBucketBeforeEach(): void {
  beforeEach(clearPrivateBucket);
}

export async function privateKeys(): Promise<string[]> {
  const listing = await env.PRIVATE_FILES.list({ limit: 1000 });
  return listing.objects.map((object) => object.key).sort();
}

export interface FileRow {
  id: string;
  application_id: string;
  slot: string;
  content_type: string;
  size: number;
  width: number | null;
  height: number | null;
  checksum: string;
  created_at: number;
  deleted_at: number | null;
}

export async function fileRows(): Promise<FileRow[]> {
  return (await env.DB.prepare("SELECT * FROM application_files ORDER BY created_at, id").all<FileRow>()).results;
}

export async function storage(): Promise<{ bytes: number; files: number }> {
  return (await env.DB.prepare("SELECT bytes, files FROM private_storage WHERE id = 'private-files'").first<{ bytes: number; files: number }>())!;
}

export async function draftRows() {
  return (await env.DB.prepare("SELECT id, user_id, batch_id, form_data, last_step, created_at, updated_at FROM application_drafts ORDER BY created_at").all<{
    id: string;
    user_id: string;
    batch_id: string;
    form_data: string;
    last_step: string | null;
    created_at: number;
    updated_at: number;
  }>()).results;
}

export async function auditRows() {
  return (await env.DB.prepare("SELECT actor_email, action, resource_type, resource_id, metadata FROM audit_log ORDER BY created_at, rowid").all<{
    actor_email: string;
    action: string;
    resource_type: string;
    resource_id: string;
    metadata: string | null;
  }>()).results;
}

/**
 * A file that exists as the API would have made it, without the API: its object in the bucket and its row, under the
 * application `applicationId` of a batch of `year`. The counter is moved too, so the books stay right.
 */
export async function seedFile(options: { applicationId: string; year: number; slot?: SlotId; kind?: FileKind; size?: number; deleted?: boolean | number; at?: number; id?: string }): Promise<{ id: string; key: string; size: number }> {
  const { applicationId, year, slot = "family-card", kind = "png", deleted = false } = options;
  const id = options.id ?? crypto.randomUUID();
  const body = bytesOf(kind, options.size ?? 0);
  const key = buildKey({ year, applicationId, fileId: id, type: kind as StoredFileType });
  await env.PRIVATE_FILES.put(key, body, { httpMetadata: { contentType: STORED_TYPES[kind].contentType } });
  const isImage = kind !== "pdf";
  // The counter is the bytes of the LIVE files: a marked row (`deleted`) was released when it was marked, so it adds nothing.
  const statements = [
    env.DB.prepare("INSERT INTO application_files (id, application_id, slot, content_type, size, width, height, checksum, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(
      id,
      applicationId,
      slot,
      STORED_TYPES[kind].contentType,
      body.byteLength,
      isImage ? 40 : null,
      isImage ? 30 : null,
      "0".repeat(32),
      options.at ?? Date.now(),
      deleted === false ? null : deleted === true ? Date.now() : deleted,
    ),
  ];
  if (deleted === false) statements.push(env.DB.prepare("UPDATE private_storage SET bytes = bytes + ?, files = files + 1 WHERE id = 'private-files'").bind(body.byteLength));
  await env.DB.batch(statements);
  return { id, key, size: body.byteLength };
}

export { MAX_FILE_BYTES };
