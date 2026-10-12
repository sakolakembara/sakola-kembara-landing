import type { ApiFailure } from "../api";
import { formatWait } from "../format";

// What a failed request says to a person (docs/cloudflare/admin-crud.md#5-errors). Pure: the Worker's
// contract test feeds it every error the CRUD kit can answer.
//
// The Worker's `message` is Indonesian and ready to show, so it wins when it is there. The guards
// (`unauthenticated`, `forbidden`) and anything that never reached the Worker carry none, and the codes
// below have a line of their own. A raw code is never shown.

export const MESSAGES = {
  offline: "Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.",
  unauthenticated: "Sesi kamu sudah berakhir. Masuk lagi untuk melanjutkan.",
  forbidden: "Kamu tidak punya izin untuk melakukan ini.",
  notFound: "Data tidak ditemukan. Mungkin sudah dihapus.",
  stale: "Data ini sudah diubah orang lain sejak kamu membukanya. Muat ulang untuk melihat versi terbaru. Perubahan yang belum disimpan akan hilang.",
  invalid: "Periksa kembali isian formulir.",
  tooLarge: "Isi yang dikirim terlalu besar.",
  preconditionRequired: "Versi data tidak disertakan. Muat ulang halaman lalu coba lagi.",
  rateLimited: "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.",
  server: "Terjadi kesalahan di server. Coba lagi sebentar lagi.",
  generic: "Terjadi kesalahan. Coba lagi.",
  loadFailed: "Gagal memuat data. Periksa koneksi internet lalu coba lagi.",
} as const;

export interface Described {
  /** One sentence for the person (a banner, the top of a form). */
  message: string;
  /** `{ field: message }` for the `Field`s; empty when the error is not about a field. */
  fields: Record<string, string>;
  /** The save lost to someone else's: the form offers "Muat ulang". */
  stale: boolean;
}

export function describeFailure(failure: ApiFailure): Described {
  const fields = failure.fields ?? {};
  const stale = failure.status === 409 && failure.code === "stale";
  // The SPA's line for a stale save says what happens to the form; it wins over the shorter one of the Worker.
  return { message: stale ? MESSAGES.stale : (failure.message ?? fallbackMessage(failure)), fields, stale };
}

function fallbackMessage(failure: ApiFailure): string {
  if (failure.status === 0) return MESSAGES.offline;
  switch (failure.code) {
    case "unauthenticated":
      return MESSAGES.unauthenticated;
    case "forbidden":
      return MESSAGES.forbidden;
    case "not_found":
      return MESSAGES.notFound;
    case "stale":
      return MESSAGES.stale;
    case "too_large":
      return MESSAGES.tooLarge;
    case "precondition_required":
      return MESSAGES.preconditionRequired;
    case "invalid":
    case "invalid_json":
    case "invalid_query":
      return MESSAGES.invalid;
    case "rate_limited":
      return failure.retryAfter ? `Terlalu banyak permintaan. Coba lagi dalam ${formatWait(failure.retryAfter)}.` : MESSAGES.rateLimited;
  }
  switch (failure.status) {
    case 401:
      return MESSAGES.unauthenticated;
    case 403:
      return MESSAGES.forbidden;
    case 404:
      return MESSAGES.notFound;
    case 413:
      return MESSAGES.tooLarge;
    case 429:
      return failure.retryAfter ? `Terlalu banyak permintaan. Coba lagi dalam ${formatWait(failure.retryAfter)}.` : MESSAGES.rateLimited;
  }
  return failure.status >= 500 ? MESSAGES.server : MESSAGES.generic;
}
