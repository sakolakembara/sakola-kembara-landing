import { api } from "../api";
import { resetConfig, useConfig } from "../config";
import { describeFailure, MESSAGES } from "./errors";
import type { UploadKindName } from "./upload-kinds";

// The browser side of `POST /api/admin/uploads` (docs/cloudflare/uploads.md). A file upload cannot go through
// `api()`: only XMLHttpRequest reports progress, so this has its own request, behind a seam like the
// transport (`setUploader`) so the mock and the tests replace it.

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
export const xhrUploader: Uploader = ({ kind, file, onProgress, signal }) =>
  new Promise<UploadOutcome>((resolve) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", file);

    const fail = (status: number, message: string, code?: string) => resolve({ ok: false, status, message, code });

    xhr.open("POST", `/api/admin/uploads?kind=${encodeURIComponent(kind)}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(Math.min(1, event.loaded / event.total));
    });
    xhr.addEventListener("load", () => {
      const body = parseJson(xhr.responseText);
      if (xhr.status === 201 && isResult(body)) {
        onProgress?.(1);
        resolve({ ok: true, result: body });
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) return fail(xhr.status, UPLOAD_MESSAGES_CLIENT.badAnswer);
      // The Worker's refusals are `{ error, message }`, the message ready to show.
      const retry = xhr.getResponseHeader("Retry-After");
      const described = describeFailure({
        ok: false,
        status: xhr.status,
        code: typeof body?.error === "string" ? body.error : undefined,
        message: typeof body?.message === "string" ? body.message : undefined,
        retryAfter: retry && /^\d+$/.test(retry) ? Number(retry) : undefined,
      });
      fail(xhr.status, described.message, typeof body?.error === "string" ? body.error : undefined);
    });
    xhr.addEventListener("error", () => fail(0, MESSAGES.offline));
    xhr.addEventListener("timeout", () => fail(0, MESSAGES.offline));
    xhr.addEventListener("abort", () => fail(0, UPLOAD_MESSAGES_CLIENT.aborted, "aborted"));

    if (signal) {
      if (signal.aborted) return fail(0, UPLOAD_MESSAGES_CLIENT.aborted, "aborted");
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });

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
