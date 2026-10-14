import { api } from "../../../../shared/spa/api";
import { NETWORK_ERROR } from "../../../../shared/spa/auth-errors";
import { sendXhr } from "../../../../shared/spa/xhr";
import type { SlotId } from "../../../../shared/application-form/slots";
import { removePath, uploadPath } from "./paths";
import { parseUploadResponse, type UploadResponse } from "./types";

export { FILES_API, fileHref } from "./paths";

// The browser side of the student's file routes (docs/cloudflare/portal-api.md, 11.2 to 11.4). An upload cannot go
// through `api()`: only XMLHttpRequest reports progress, so it has its own request (shared/spa/xhr.ts, which the admin's
// upload uses too), behind a seam like the transport (`setFileUploader`) so the mock and the tests replace it.
//
//   PUT    /portal/api/applications/current/files/:slot[?replace=<file id>]    the raw file as the body
//   DELETE /portal/api/applications/current/files/:fileId
//   GET    /portal/api/files/:fileId                                           a link, opened in a new tab by the student
//
// The file name the browser had is never sent: the body is the bytes, the type is the server's to find, and the
// `Content-Type` is a constant.

export const CLIENT_MESSAGES = {
  aborted: "Unggahan dibatalkan.",
  badAnswer: "Jawaban server tidak bisa dibaca. Coba lagi.",
  server: "Terjadi kesalahan di server. Coba lagi sebentar lagi.",
  expired: "Sesi kamu sudah berakhir. Silakan masuk lagi.",
  deleteFailed: "Berkas belum bisa dihapus. Coba lagi.",
} as const;

export interface FileUploadRequest {
  slot: SlotId;
  /** The bytes to send (an image already re-encoded: src/lib/files/compress.ts). */
  body: Blob;
  /** The id of a live file of this slot that the new one takes the place of, in one step. */
  replace?: string;
  /** 0 to 1, as the browser reports bytes sent. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export type FileUploadOutcome =
  | { ok: true; response: UploadResponse }
  /** `message` is Indonesian and ready to show; `code` is the Worker's `error` (never shown); status 401 means the session ended. */
  | { ok: false; status: number; message: string; code?: string };

export type FileUploader = (request: FileUploadRequest) => Promise<FileUploadOutcome>;

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The sentence for an answer that is not a stored file. The Worker's refusals carry their own Indonesian message
 * (`too_large`, `slot_full`, `storage_full`, the gate's three, the limiter's...); the guards' (401, a bare 403) and
 * anything that is not the Worker's (a proxy's HTML) get the SPA's own line, never a code.
 */
export function failureMessage(status: number, body: Record<string, unknown> | null): string {
  if (status === 401) return CLIENT_MESSAGES.expired;
  const message = body?.message;
  if (typeof message === "string" && message.trim() !== "") return message;
  return CLIENT_MESSAGES.server;
}

/** The real thing: one `PUT` of the raw bytes. */
export const xhrFileUploader: FileUploader = async ({ slot, body, replace, onProgress, signal }) => {
  const sent = await sendXhr({ method: "PUT", url: uploadPath(slot, replace), body, headers: { "Content-Type": "application/octet-stream", Accept: "application/json" }, onProgress, signal });
  if (sent.kind === "aborted") return { ok: false, status: 0, message: CLIENT_MESSAGES.aborted, code: "aborted" };
  if (sent.kind === "network") return { ok: false, status: 0, message: NETWORK_ERROR };

  const json = parseJson(sent.text);
  if (sent.status === 201) {
    const response = parseUploadResponse(json);
    if (response) {
      onProgress?.(1);
      return { ok: true, response };
    }
    return { ok: false, status: sent.status, message: CLIENT_MESSAGES.badAnswer };
  }
  if (sent.status >= 200 && sent.status < 300) return { ok: false, status: sent.status, message: CLIENT_MESSAGES.badAnswer };
  return { ok: false, status: sent.status, message: failureMessage(sent.status, json), code: typeof json?.error === "string" ? json.error : undefined };
};

let uploader: FileUploader = xhrFileUploader;

/** Replaces the uploader (the mock, the tests); `null` puts the real one back. */
export function setFileUploader(next: FileUploader | null): void {
  uploader = next ?? xhrFileUploader;
}

export function uploadFile(request: FileUploadRequest): Promise<FileUploadOutcome> {
  return uploader(request);
}

export type RemoveOutcome = { ok: true } | { ok: false; status: number; message: string };

/**
 * Removes one of the student's own files. A 404 means it is already gone (another tab, a double click): the goal is
 * reached. Goes through `api()`, so the transport seam of the tests and the mock applies.
 */
export async function removeFile(fileId: string): Promise<RemoveOutcome> {
  const result = await api(removePath(fileId), { method: "DELETE" });
  if (result.ok || result.status === 404) return { ok: true };
  if (result.status === 0) return { ok: false, status: 0, message: NETWORK_ERROR };
  if (result.status === 401) return { ok: false, status: 401, message: CLIENT_MESSAGES.expired };
  return { ok: false, status: result.status, message: result.message ?? CLIENT_MESSAGES.deleteFailed };
}
