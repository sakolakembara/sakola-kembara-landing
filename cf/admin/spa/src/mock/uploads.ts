import { accessTo } from "~/lib/access";
import { parseMe } from "~/lib/me";
import type { Uploader } from "~/lib/crud/upload-client";
import { checkUploadFile, FILE_TYPES, type FileTypeName, UPLOAD_KINDS } from "~/lib/crud/upload-kinds";
import { mockMeBody } from "./fixtures";
import type { Persona } from "./persona";

// MOCK, local development only (see mock/install.ts). The upload API in miniature: the same area check and the
// same client-visible limits as the Worker, a progress bar that fills over about a second, and a made-up path.
// The file itself is never sent anywhere or kept (so a stored path has no picture behind it: `UploadField`
// shows its own local preview of what was just picked, and the "tidak tersedia" icon for anything else).
//
// A file named `gagal-...` is refused with a server error, to see that state: "gagal-besar.png" answers 413,
// anything else starting with "gagal" answers 500.

const EXTENSION: Record<FileTypeName, string> = { png: "png", jpeg: "jpg", webp: "webp", gif: "gif", pdf: "pdf" };

function slug(name: string): string {
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  return stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "file";
}

export function createMockUploader(persona: Persona): Uploader {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  return async ({ kind, file, onProgress, signal }) => {
    const rule = UPLOAD_KINDS[kind];
    if (accessTo(parseMe(mockMeBody(persona)), rule.area) !== "write") return { ok: false, status: 403, message: "Kamu tidak punya izin untuk melakukan ini.", code: "forbidden" };
    const problem = checkUploadFile(file, kind);
    if (problem) return { ok: false, status: problem.startsWith("Ukuran") ? 413 : 415, message: problem };

    const steps = 8;
    for (let step = 1; step <= steps; step++) {
      if (signal?.aborted) return { ok: false, status: 0, message: "Unggahan dibatalkan.", code: "aborted" };
      await sleep(120);
      onProgress?.(step / steps);
    }
    if (file.name.toLowerCase().startsWith("gagal-besar")) return { ok: false, status: 413, message: `Ukuran file maksimal ${rule.maxBytes / 1_000_000} MB.`, code: "too_large" };
    if (file.name.toLowerCase().startsWith("gagal")) return { ok: false, status: 500, message: "Terjadi kesalahan di server. Coba lagi sebentar lagi." };

    const claimed = file.type.toLowerCase();
    const type = (Object.keys(FILE_TYPES) as FileTypeName[]).find((name) => FILE_TYPES[name].mime === claimed) ?? rule.types[0]!;
    const id = crypto.randomUUID();
    return {
      ok: true,
      result: {
        id,
        path: `/uploads/${kind}/${new Date().getUTCFullYear()}/${id}-${slug(file.name)}.${EXTENSION[type]}`,
        contentType: FILE_TYPES[type].mime,
        size: file.size,
        width: type === "pdf" ? null : 800,
        height: type === "pdf" ? null : 600,
      },
    };
  };
}
