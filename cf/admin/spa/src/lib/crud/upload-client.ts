import { sendXhr } from "../../../../shared/spa/xhr";
import { api } from "../api";
import { resetConfig, useConfig } from "../config";
import { describeFailure, MESSAGES } from "./errors";
import type { UploadKindName } from "./upload-kinds";

// The browser side of `POST /api/admin/uploads` (docs/cloudflare/uploads.md). A file upload cannot go through
// `api()`: only XMLHttpRequest reports progress, so this has its own request (shared/spa/xhr.ts, which the student
// portal's file client uses too), behind a seam like the transport (`setUploader`) so the mock and the tests replace it.

export interface UploadResult {
  id: string;
  /** Root-relative public path, `/uploads/<kind>/<year>/<id>-<name>.<ext>`: what the form saves. */
  path: string;
  contentType: string;
  size: number;
  /** Null for a PDF. */
  width: number | null;
  height: number | null;
}

export type UploadOutcome = { ok: true; result: UploadResult } | { ok: false; status: number; message: string; code?: string };

export interface UploadRequest {
  kind: UploadKindName;
  file: File;
  /** 0 to 1, as the browser reports bytes sent. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export type Uploader = (request: UploadRequest) => Promise<UploadOutcome>;

export const UPLOAD_MESSAGES_CLIENT = {
  aborted: "Unggahan dibatalkan.",
  badAnswer: "Jawaban server tidak bisa dibaca. Coba lagi.",
} as const;

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isResult(value: Record<string, unknown> | null): value is Record<string, unknown> & UploadResult {
  return value !== null && typeof value.id === "string" && typeof value.path === "string" && typeof value.size === "number";
}

/** The real thing: one multipart POST with `kind` in the form AND the query (so the Worker refuses a wrong area or size before it reads the body). */
export const xhrUploader: Uploader = async ({ kind, file, onProgress, signal }) => {
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", file);

  const fail = (status: number, message: string, code?: string): UploadOutcome => ({ ok: false, status, message, code });
  // No Content-Type: the browser adds the multipart boundary itself.
  const sent = await sendXhr({ method: "POST", url: `/api/admin/uploads?kind=${encodeURIComponent(kind)}`, body: form, headers: { Accept: "application/json" }, onProgress, signal });
  if (sent.kind === "aborted") return fail(0, UPLOAD_MESSAGES_CLIENT.aborted, "aborted");
  if (sent.kind === "network") return fail(0, MESSAGES.offline);

  const body = parseJson(sent.text);
  if (sent.status === 201 && isResult(body)) {
    onProgress?.(1);
    return { ok: true, result: body };
  }
  if (sent.status >= 200 && sent.status < 300) return fail(sent.status, UPLOAD_MESSAGES_CLIENT.badAnswer);
  // The Worker's refusals are `{ error, message }`, the message ready to show.
  const retry = sent.header("Retry-After");
  const described = describeFailure({
    ok: false,
    status: sent.status,
    code: typeof body?.error === "string" ? body.error : undefined,
    message: typeof body?.message === "string" ? body.message : undefined,
    retryAfter: retry && /^\d+$/.test(retry) ? Number(retry) : undefined,
  });
  return fail(sent.status, described.message, typeof body?.error === "string" ? body.error : undefined);
};

let uploader: Uploader = xhrUploader;

/** Replaces the uploader (the mock, the tests); `null` puts the real one back. */
export function setUploader(next: Uploader | null): void {
  uploader = next ?? xhrUploader;
}

export function uploadFile(request: UploadRequest): Promise<UploadOutcome> {
  return uploader(request);
}

/**
 * Removes a file the person uploaded in this form and then replaced or removed before saving, so it does not
 * stay in R2 for nothing. Fire and forget: the Worker refuses (409) a file a row still uses, and a failure
 * only leaves an object behind, which is harmless.
 */
export function discardUpload(id: string): void {
  void api(`/api/admin/uploads/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ------------------------------------------------------------- where the files are shown

/** Forgets what `GET /api/config` said (tests): the answer is shared with the site address, lib/config.ts. */
export const resetUploadsBase = resetConfig;

/**
 * The origin uploaded files are served from (`uploadsBaseUrl` of `GET /api/config`), read once per page load.
 * "" until it is known, and when it cannot be read: paths then stay same-origin, which is right in
 * development (the Vite proxy serves `/uploads`) and a broken image, never a crash, elsewhere.
 */
export function useUploadsBase(): string {
  return useConfig().uploadsBaseUrl;
}
