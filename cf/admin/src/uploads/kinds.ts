// What may be uploaded, per kind. One table, so the area check, the size limit
// and the accepted types cannot drift apart between the route, the tests and
// the docs (docs/cloudflare/uploads.md prints the same numbers).
//
// The limits are the legacy app's (`app/(admin)/admin/{team,blog,reports,resources}/actions.ts`),
// decimal megabytes as there:
//
//   team photo     5 MB     blog image     5 MB     report PDF    20 MB     resource    25 MB
//
// The legacy resource action accepted any file; the types here are PNG, JPEG,
// WebP and PDF (see "What is not accepted, and why" in the docs).
//
// Cloudflare's request body limit is 100 MB on Free and Pro, so the largest
// kind (25 MB) is far below it; the Worker's 128 MB of memory is the tighter
// bound (the multipart body is parsed in memory), which is why nothing above
// 25 MB is accepted.

import type { GrantableArea } from "../auth/permissions";
import type { MediaPurpose } from "../db/schema";
import type { FileType } from "./sniff";

export const uploadKinds = ["team-photo", "report", "resource", "blog-image", "registration-document"] as const;
export type UploadKind = (typeof uploadKinds)[number];

export function isUploadKind(value: unknown): value is UploadKind {
  return typeof value === "string" && (uploadKinds as readonly string[]).includes(value);
}

const IMAGES = ["png", "jpeg", "webp"] as const satisfies readonly FileType[];

export interface KindRule {
  /** The area whose writers may upload this kind (403 for everyone else). */
  area: GrantableArea;
  /** What `media.purpose` stores; the column has four values, two kinds share one (see docs). */
  purpose: MediaPurpose;
  /** Largest file, in bytes. */
  maxBytes: number;
  /** Accepted by CONTENT (magic bytes), never by extension or the client's type. */
  types: readonly FileType[];
}

export const KIND_RULES: Record<UploadKind, KindRule> = {
  "team-photo": { area: "konten", purpose: "team", maxBytes: 5_000_000, types: IMAGES },
  "blog-image": { area: "konten", purpose: "blog", maxBytes: 5_000_000, types: IMAGES },
  report: { area: "konten", purpose: "report", maxBytes: 20_000_000, types: ["pdf"] },
  resource: { area: "pendaftaran", purpose: "resource", maxBytes: 25_000_000, types: [...IMAGES, "pdf"] },
  "registration-document": { area: "pendaftaran", purpose: "resource", maxBytes: 25_000_000, types: [...IMAGES, "pdf"] },
};

/** The areas that can upload at all: what the route checks before it reads a body. */
export const uploadAreas: readonly GrantableArea[] = [...new Set(Object.values(KIND_RULES).map((rule) => rule.area))];

/** Largest of the per-kind limits. */
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(KIND_RULES).map((rule) => rule.maxBytes));

/** What a multipart envelope may add around the file: boundary lines, the `kind` field, the file's own headers. */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** The area that owns a `media.purpose`, for deleting a row whose kind folder is not known. */
export function areaOfPurpose(purpose: MediaPurpose): GrantableArea {
  return purpose === "resource" ? "pendaftaran" : "konten";
}

/** "5 MB" as the legacy messages wrote it. */
export function megabytes(bytes: number): string {
  return `${bytes / 1_000_000} MB`;
}
