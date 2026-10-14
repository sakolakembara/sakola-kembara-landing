// The one place an applicant's file leaves this code: the answer to the student's own read and to an admin's open.
// There is no URL that works without a session; the bytes come from the private bucket through the Worker, after the
// caller was authorized, and are passed through as a stream (never buffered). docs/cloudflare/portal-architecture.md,
// 8.6. Nothing in this file builds a link to a file or reads one from a public place.

import { extensionOf, isInlineContentType } from "./key";

/** What the routes know about a file when they serve it (all from the row, none from the client). */
export interface ServedFile {
  id: string;
  slot: string;
  contentType: string;
}

/**
 * `<slot>-<first 8 characters of the id>.<ext>`, built from the slot and the id only, never from anything a client
 * sent. Both parts are [a-z0-9-], so the header needs no quoting rules beyond the quotes themselves.
 */
export function downloadName(file: ServedFile): string {
  return `${file.slot}-${file.id.slice(0, 8)}.${extensionOf(file.contentType)}`;
}

/**
 * The headers of a served file: not cacheable by anyone (`private, no-store`), no sniffing, the stored (sniffed) type,
 * `inline` for an image and `attachment` for a PDF (a PDF is never rendered by our pages), a CSP that lets nothing run
 * from the file (`default-src 'none'; sandbox`), and same-origin only for embedding. No `Range`, no conditional
 * request: every read is a full 200.
 */
export function fileHeaders(file: ServedFile, size: number): Headers {
  const disposition = isInlineContentType(file.contentType) ? "inline" : "attachment";
  return new Headers({
    "Content-Type": file.contentType,
    "Content-Disposition": `${disposition}; filename="${downloadName(file)}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Length": String(size),
  });
}

/** 200 with the object's body passed through. The caller has already authorized and (for an admin) audited. */
export function fileResponse(file: ServedFile, object: Pick<R2ObjectBody, "body" | "size">): Response {
  return new Response(object.body, { status: 200, headers: fileHeaders(file, object.size) });
}
