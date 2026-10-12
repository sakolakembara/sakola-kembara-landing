// What the Worker accepts as an upload, as the browser needs it to refuse early (docs/cloudflare/uploads.md,
// docs/cloudflare/admin-crud.md#10-files-upload-references). Pure: no DOM, no React, so the Worker's
// contract test can import it.
//
// This only saves a round trip and a wasted upload: the Worker reads the BYTES of the file, never its name
// or the type the browser claims, and answers 415 or 413 on its own. `UPLOAD_KINDS` is a copy of
// `KIND_RULES` in src/uploads/kinds.ts; test/crud-spa-contract.test.ts fails when the two differ.

export type UploadKindName = "team-photo" | "blog-image" | "report" | "resource" | "registration-document";
export type FileTypeName = "png" | "jpeg" | "webp" | "pdf";

export const FILE_TYPES: Record<FileTypeName, { label: string; mime: string; extensions: readonly string[] }> = {
  png: { label: "PNG", mime: "image/png", extensions: [".png"] },
  jpeg: { label: "JPEG", mime: "image/jpeg", extensions: [".jpg", ".jpeg"] },
  webp: { label: "WebP", mime: "image/webp", extensions: [".webp"] },
  pdf: { label: "PDF", mime: "application/pdf", extensions: [".pdf"] },
};

export interface UploadKindRule {
  /** The area whose writers may upload this kind. */
  area: "konten" | "pendaftaran";
  maxBytes: number;
  types: readonly FileTypeName[];
}

const IMAGES = ["png", "jpeg", "webp"] as const;

export const UPLOAD_KINDS: Record<UploadKindName, UploadKindRule> = {
  "team-photo": { area: "konten", maxBytes: 5_000_000, types: IMAGES },
  "blog-image": { area: "konten", maxBytes: 5_000_000, types: IMAGES },
  report: { area: "konten", maxBytes: 20_000_000, types: ["pdf"] },
  resource: { area: "pendaftaran", maxBytes: 25_000_000, types: [...IMAGES, "pdf"] },
  "registration-document": { area: "pendaftaran", maxBytes: 25_000_000, types: [...IMAGES, "pdf"] },
};

/** "5 MB", as the Worker's messages write it (decimal megabytes). */
export function megabytes(bytes: number): string {
  return `${bytes / 1_000_000} MB`;
}

export const UPLOAD_MESSAGES = {
  empty: "File kosong.",
  tooBig: (bytes: number) => `Ukuran file maksimal ${megabytes(bytes)}.`,
  type: (types: readonly FileTypeName[]) => `Tipe file tidak didukung. Gunakan: ${types.map((type) => FILE_TYPES[type].label).join(", ")}.`,
} as const;

/** The part of a `File` the checks read, so they run on a plain object too. */
export interface FileLike {
  name: string;
  size: number;
  /** The type the browser guessed from the name. Empty is common (and fine: the extension is then looked at). */
  type: string;
}

/**
 * The message to show when `file` cannot be uploaded as `kind`, or null when it may be tried: not empty, not
 * over the kind's limit, and a type of the kind's list by the browser's guess or, with none, by the extension.
 */
export function checkUploadFile(file: FileLike, kind: UploadKindName): string | null {
  const rule = UPLOAD_KINDS[kind];
  if (file.size === 0) return UPLOAD_MESSAGES.empty;
  if (file.size > rule.maxBytes) return UPLOAD_MESSAGES.tooBig(rule.maxBytes);

  const claimed = file.type.trim().toLowerCase();
  const extension = file.name.includes(".") ? `.${file.name.split(".").pop()!.toLowerCase()}` : "";
  const allowed = rule.types.map((type) => FILE_TYPES[type]);
  // No guess, or the catch-all some systems give an unknown file: only the extension is left to look at.
  const guessed = claimed !== "" && claimed !== "application/octet-stream";
  const accepted = guessed ? allowed.some((type) => type.mime === claimed) : allowed.some((type) => type.extensions.includes(extension));
  return accepted ? null : UPLOAD_MESSAGES.type(rule.types);
}

/** The value of `<input accept>` for a kind: types and extensions, so pickers filter the files by either. */
export function acceptFor(kind: UploadKindName): string {
  return UPLOAD_KINDS[kind].types.flatMap((type) => [FILE_TYPES[type].mime, ...FILE_TYPES[type].extensions]).join(",");
}

// ------------------------------------------------------- where a stored file is shown

/** An http(s) origin: scheme, host, optional port. Same rule as the Worker's `uploadsBase` and the public site's. */
const ORIGIN = /^https?:\/\/[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:\d{1,5})?$/;

/** What a path may contain to get a base in front of it: no whitespace, control character, backslash, `..` segment, `?` or `#`. */
const SAFE_UPLOAD_PATH = /^(?!.*\/\.\.(?:\/|$))\/uploads\/[^\s\\?#\u0000-\u001f]+$/;

/** The usable base (no trailing slash), or "" when there is none. */
export function normaliseBase(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  return ORIGIN.test(trimmed) ? trimmed : "";
}

/**
 * `base` + `path` for an upload path; `path` itself for anything else or without a base: the legacy static
 * paths, an absolute address, a path with `..`. The public site's `uploadUrl` (cf/web/src/lib/uploads.ts)
 * with the same rules; test/crud-spa-contract.test.ts runs both on the same inputs.
 */
export function uploadUrl(path: string, base: string | undefined | null): string;
export function uploadUrl(path: string | null, base: string | undefined | null): string | null;
export function uploadUrl(path: string | null, base: string | undefined | null): string | null {
  if (path === null) return null;
  const origin = normaliseBase(base);
  if (!origin || !SAFE_UPLOAD_PATH.test(path)) return path;
  return `${origin}${path}`;
}

/** The file name inside a stored path, for a "foto-ibu.png" label: the id before the first "-" is dropped. */
export function fileNameOf(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/, "");
}
