import { env } from "cloudflare:workers";
import type { Bindings } from "../src/env";
import { call } from "./helpers";

// Fixtures and calls for the upload tests. The files are built byte by byte:
// the checks under test read headers only, so a file needs a REAL header
// (signature, size fields) and may be padded with zeros to reach a size.

const text = (value: string) => new TextEncoder().encode(value);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const be16 = (n: number) => new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
const be32 = (n: number) => new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
const le16 = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
const le24 = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]);
const le32 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

/** Appends zeros until the file is `size` bytes (nothing happens when it is already larger). */
export function padTo(bytes: Uint8Array, size: number): Uint8Array {
  return bytes.length >= size ? bytes : concat(bytes, new Uint8Array(size - bytes.length));
}

/** Signature, IHDR with the given size, IEND. The CRCs are zeros: nothing here checks them. */
export function png(width: number, height: number): Uint8Array {
  const ihdr = concat(be32(13), text("IHDR"), be32(width), be32(height), new Uint8Array([8, 2, 0, 0, 0]), be32(0));
  const iend = concat(be32(0), text("IEND"), be32(0));
  return concat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, iend);
}

/**
 * SOI, a JFIF segment, `metadataBytes` of comment segments (EXIF and ICC profiles in real files),
 * the start-of-frame segment with the size, then a scan marker and EOI.
 */
export function jpeg(width: number, height: number, metadataBytes = 0): Uint8Array {
  const jfif = concat(new Uint8Array([0xff, 0xe0]), be16(16), text("JFIF\0"), new Uint8Array([1, 1, 0]), be16(1), be16(1), new Uint8Array([0, 0]));
  const comments: Uint8Array[] = [];
  for (let left = metadataBytes; left > 0; ) {
    const chunk = Math.min(left, 60_000);
    comments.push(concat(new Uint8Array([0xff, 0xfe]), be16(chunk + 2), new Uint8Array(chunk)));
    left -= chunk;
  }
  const sof = concat(new Uint8Array([0xff, 0xc0]), be16(17), new Uint8Array([8]), be16(height), be16(width), new Uint8Array([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]));
  const scan = concat(new Uint8Array([0xff, 0xda]), be16(12), new Uint8Array(10), new Uint8Array(32), new Uint8Array([0xff, 0xd9]));
  return concat(new Uint8Array([0xff, 0xd8]), jfif, ...comments, sof, scan);
}

/** A RIFF/WebP file of one of the three flavours. */
export function webp(flavour: "lossy" | "lossless" | "extended", width: number, height: number): Uint8Array {
  let chunk: Uint8Array;
  if (flavour === "lossy") {
    // frame tag (3 bytes), start code, 14-bit width and height
    chunk = concat(text("VP8 "), le32(10), new Uint8Array([0x10, 0x02, 0x00]), new Uint8Array([0x9d, 0x01, 0x2a]), le16(width), le16(height));
  } else if (flavour === "lossless") {
    const bits = ((height - 1) << 14) | (width - 1);
    chunk = concat(text("VP8L"), le32(5), new Uint8Array([0x2f]), le32(bits >>> 0));
  } else {
    chunk = concat(text("VP8X"), le32(10), new Uint8Array([0, 0, 0, 0]), le24(width - 1), le24(height - 1));
  }
  const body = concat(text("WEBP"), chunk);
  return padTo(concat(text("RIFF"), le32(body.length), body), 30);
}

/** "GIF89a" (or "GIF87a"), the logical screen descriptor with the canvas size, a trailer: the smallest GIF a decoder reads. */
export function gif(width: number, height: number, version: "87a" | "89a" = "89a"): Uint8Array {
  return concat(text(`GIF${version}`), le16(width), le16(height), new Uint8Array([0x00, 0x00, 0x00]), new Uint8Array([0x3b]));
}

export function pdf(): Uint8Array {
  return text("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
}

/** Things that are not what they claim to be. */
export const disguises = {
  exe: concat(text("MZ"), new Uint8Array(62), text("This program cannot be run in DOS mode.")),
  html: text("<!doctype html><html><script>alert(document.cookie)</script></html>"),
  svg: text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  zip: concat(text("PK\x03\x04"), new Uint8Array(40)),
  // "GIF8" with a version nobody wrote: not a GIF.
  gifLookalike: concat(text("GIF88a"), le16(1), le16(1), new Uint8Array(10)),
  empty: new Uint8Array(0),
  text: text("just some text"),
  // PDF text further into the file: the header must be at byte 0.
  lateAndPdfish: concat(text("junk"), pdf()),
};

// ─── Calls ───────────────────────────────────────────────────────────────

export interface UploadCall {
  kind?: string | null;
  /** The file; `null` sends no file field at all. */
  bytes?: Uint8Array | null;
  filename?: string;
  /** What the client CLAIMS the file is (never believed). */
  claimedType?: string;
  cookie?: string;
  /** Appended to the URL, e.g. "?kind=team-photo". */
  query?: string;
  ip?: string | null;
  headers?: Record<string, string>;
  /** Sent as Content-Length instead of the real one; `null` sends none. */
  contentLength?: number | null;
  extraFields?: Record<string, string>;
  /** Replaces bindings for this call only, like `call`. */
  env?: Partial<Bindings>;
}

/** Builds the multipart body the way a browser does and sends it with its real Content-Length. */
export async function upload(init: UploadCall = {}): Promise<Response> {
  const form = new FormData();
  if (init.kind !== null) form.set("kind", init.kind ?? "team-photo");
  for (const [name, value] of Object.entries(init.extraFields ?? {})) form.set(name, value);
  if (init.bytes !== null) {
    const bytes = init.bytes ?? png(10, 10);
    form.set("file", new File([bytes], init.filename ?? "foto.png", { type: init.claimedType ?? "image/png" }));
  }
  // Serialise it once to learn the boundary and the length, exactly what goes on the wire.
  const serialised = new Response(form);
  const contentType = serialised.headers.get("content-type")!;
  const body = await serialised.arrayBuffer();

  const headers: Record<string, string> = { "content-type": contentType, ...init.headers };
  const length = init.contentLength === undefined ? body.byteLength : init.contentLength;
  if (length !== null) headers["content-length"] = String(length);
  return call(`/api/admin/uploads${init.query ?? ""}`, { method: "POST", cookie: init.cookie, ip: init.ip, headers, body, env: init.env });
}

export interface Uploaded {
  id: string;
  path: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
}

// ─── Storage ─────────────────────────────────────────────────────────────

/** Empties the local test bucket (tests share one; the D1 tables are emptied by test/setup.ts). */
export async function clearBucket(): Promise<void> {
  let cursor: string | undefined;
  do {
    const listing = await env.UPLOADS.list({ cursor, limit: 500 });
    if (listing.objects.length > 0) await env.UPLOADS.delete(listing.objects.map((object) => object.key));
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
}

export async function objectKeys(): Promise<string[]> {
  const listing = await env.UPLOADS.list({ limit: 1000 });
  return listing.objects.map((object) => object.key).sort();
}

export async function mediaRows() {
  const { results } = await env.DB.prepare("SELECT id, key, purpose, content_type, size, width, height, uploaded_by FROM media ORDER BY created_at, id").all<{
    id: string;
    key: string;
    purpose: string;
    content_type: string;
    size: number;
    width: number | null;
    height: number | null;
    uploaded_by: string | null;
  }>();
  return results;
}

export async function auditRows() {
  const { results } = await env.DB.prepare("SELECT actor_email, action, resource_type, resource_id, metadata FROM audit_log ORDER BY created_at, rowid").all<{
    actor_email: string;
    action: string;
    resource_type: string;
    resource_id: string;
    metadata: string;
  }>();
  return results;
}
