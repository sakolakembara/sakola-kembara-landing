import type { Access } from "~/lib/access";
import type { MediaItem } from "~/lib/crud/media";
import { UPLOAD_KINDS, type UploadKindName } from "~/lib/crud/upload-kinds";
import type { MockHandler, MockRequest } from "../handlers";

// MOCK, local development only. The Media library's API without a backend (docs/cloudflare/uploads.md): the list with the
// Worker's own search and filters (`kind`, `q`, `type`, `from`, `to`, `page`, `pageSize`), one file with the menus that use it,
// the text alternative (`PATCH`) and the delete, which is refused (409 `in_use`) while a menu uses the file. The uploads of
// mock/uploads.ts land in the same store, so a file sent from the Media page or a picker shows up in the library.
//
// The files have no pictures behind them (nothing is stored): the page shows its icon for a picture that cannot be read.
// A file whose name starts with "dipakai-" is in use, one with "gagal-" answers a server error to a delete or a text, to
// see those states. Nothing leaves memory; a reload starts again from the seed.

const DAY = 86_400_000;

interface Stored extends MediaItem {
  usedBy: string[];
}

const AREA_OF_KIND: Record<UploadKindName, "konten" | "pendaftaran"> = {
  "blog-image": "konten",
  "team-photo": "konten",
  report: "konten",
  resource: "pendaftaran",
  "registration-document": "pendaftaran",
};

function seed(): Stored[] {
  const now = Date.now();
  const pictures: [string, UploadKindName, string | null, string[]][] = [
    ["hero-kelas.webp", "blog-image", "Siswa belajar bersama di ruang kelas", ["Blog"]],
    ["wisuda-2026.webp", "blog-image", "Para lulusan berfoto saat wisuda 2026", ["Blog"]],
    ["ruang-baca.webp", "blog-image", null, []],
    ["buku-hibah.webp", "blog-image", "Tumpukan buku hibah untuk perpustakaan", []],
    ["kegiatan-sabtu.webp", "blog-image", null, ["Blog"]],
    ["poster-pmb.webp", "blog-image", "Poster penerimaan murid baru", []],
    ["logo-mitra.webp", "blog-image", null, []],
    ["belajar-bareng.webp", "blog-image", "Kelompok belajar di halaman sekolah", []],
    ["kunjungan.webp", "blog-image", null, []],
    ["dipakai-sampul.webp", "blog-image", "Sampul yang masih dipakai artikel", ["Blog", "Pengumuman"]],
    ["foto-ketua.webp", "team-photo", "Ketua yayasan tersenyum", ["Tim"]],
    ["foto-guru-1.webp", "team-photo", null, ["Tim"]],
    ["foto-guru-2.webp", "team-photo", null, []],
  ];
  const documents: [string, UploadKindName, string[]][] = [
    ["laporan-dampak-2025.pdf", "report", ["Laporan"]],
    ["laporan-keuangan-2024.pdf", "report", ["Laporan"]],
    ["laporan-tahunan-2023.pdf", "report", []],
    ["panduan-pendaftaran.pdf", "resource", ["Pusat Dokumen"]],
  ];
  const items: Stored[] = [];
  let n = 0;
  const base = (name: string, kind: UploadKindName, contentType: string) => {
    n += 1;
    const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    return {
      id,
      path: `/uploads/${kind}/2026/${id}-${name}`,
      name,
      kind,
      contentType,
      uploadedByName: n % 3 === 0 ? "Dewi Pengurus" : "Admin Mock",
      createdAt: new Date(now - n * 2.2 * DAY).toISOString(),
    };
  };
  for (const [name, kind, altText, usedBy] of pictures) {
    items.push({ ...base(name, kind, "image/webp"), size: 90_000 + n * 17_000, width: 1920, height: 1080, altText, usedBy });
  }
  for (const [name, kind, usedBy] of documents) {
    items.push({ ...base(name, kind, "application/pdf"), size: 400_000 + n * 120_000, width: null, height: null, altText: null, usedBy });
  }
  // Enough of them for a second page (40 a page on the Media page).
  const first = [...items];
  for (let round = 1; items.length < 52; round++) {
    for (const source of first.slice(0, 13)) {
      if (items.length >= 52) break;
      const copy = base(source.name.replace(/(\.\w+)$/, `-${round + 1}$1`), source.kind ?? "blog-image", source.contentType);
      items.push({ ...copy, size: source.size, width: source.width, height: source.height, altText: null, usedBy: [] });
    }
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const library: Stored[] = seed();

/** Called by the mock uploader: a file just stored is in the library. */
export function addMockUpload(item: MediaItem): void {
  library.unshift({ ...item, usedBy: [] });
}

const present = ({ usedBy: _usedBy, ...item }: Stored): MediaItem => item;

const json = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const error = (status: number, code: string, message?: string, extra: Record<string, unknown> = {}) =>
  json({ error: code, ...(message ? { message } : {}), ...extra }, status);

const readable = (access: Access) => access !== "none";

function positive(raw: string | null, fallback: number, max: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? Math.min(value, max) : fallback;
}

/** `2026-10-01` or a full instant with its zone, as the Worker takes them; anything looser is refused. */
const INSTANT = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

function list({ url, accessOf }: MockRequest): Response {
  const kind = url.searchParams.get("kind");
  let visible: Stored[];
  if (kind !== null) {
    if (!(kind in UPLOAD_KINDS)) return error(400, "invalid_kind", "Jenis unggahan tidak dikenal.");
    if (!readable(accessOf(AREA_OF_KIND[kind as UploadKindName]))) return error(403, "forbidden");
    visible = library.filter((item) => item.kind === kind);
  } else {
    visible = library.filter((item) => item.kind !== null && readable(accessOf(AREA_OF_KIND[item.kind])));
    if (!readable(accessOf("konten")) && !readable(accessOf("pendaftaran"))) return error(403, "forbidden");
  }

  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length > 100) return error(400, "invalid_query", "Pencarian atau penyaringan tidak dikenal.", { param: "q" });
  const type = url.searchParams.get("type");
  if (type && type !== "image" && type !== "pdf") return error(400, "invalid_query", "Pencarian atau penyaringan tidak dikenal.", { param: "type" });
  const bounds: Record<"from" | "to", number | null> = { from: null, to: null };
  for (const param of ["from", "to"] as const) {
    const raw = url.searchParams.get(param);
    if (!raw) continue;
    const at = INSTANT.test(raw) ? Date.parse(raw) : Number.NaN;
    if (Number.isNaN(at)) return error(400, "invalid_query", "Pencarian atau penyaringan tidak dikenal.", { param });
    bounds[param] = at;
  }

  const matches = visible.filter((item) => {
    if (q && !item.name.toLowerCase().includes(q) && !(item.altText ?? "").toLowerCase().includes(q)) return false;
    if (type === "image" && !item.contentType.startsWith("image/")) return false;
    if (type === "pdf" && item.contentType !== "application/pdf") return false;
    const at = Date.parse(item.createdAt);
    return (bounds.from === null || at >= bounds.from) && (bounds.to === null || at < bounds.to);
  });
  const pageSize = positive(url.searchParams.get("pageSize"), 20, 50);
  const page = positive(url.searchParams.get("page"), 1, 100_000);
  return json({
    items: matches.slice((page - 1) * pageSize, page * pageSize).map(present),
    page,
    pageSize,
    total: matches.length,
    totalPages: Math.max(1, Math.ceil(matches.length / pageSize)),
  });
}

const handler: MockHandler = (request) => {
  const { method, url, init, accessOf } = request;
  if (url.pathname === "/api/admin/uploads" && method === "GET") return list(request);

  const match = /^\/api\/admin\/uploads\/([^/]+)$/.exec(url.pathname);
  if (!match) return null;
  const item = library.find((entry) => entry.id === decodeURIComponent(match[1]!));
  if (!item || item.kind === null) return error(404, "not_found");
  const area = AREA_OF_KIND[item.kind];

  if (method === "GET") {
    if (!readable(accessOf(area))) return error(403, "forbidden");
    return json({ item: present(item), usedBy: [...new Set(item.usedBy)] });
  }
  if (method === "PATCH") {
    if (accessOf(area) !== "write") return error(403, "forbidden");
    if (item.name.startsWith("gagal-")) return error(500, "server_error", "Terjadi kesalahan di server. Coba lagi sebentar lagi.");
    let altText: unknown;
    try {
      altText = (JSON.parse(String(init.body ?? "null")) as { altText?: unknown } | null)?.altText;
    } catch {
      return error(415, "invalid_json");
    }
    if (altText !== null && typeof altText !== "string")
      return error(400, "invalid", "Periksa kembali isian formulir.", { fields: { altText: "Teks alternatif harus berupa teks." } });
    const text = (altText ?? "").trim();
    if (text.length > 300) return error(400, "invalid", "Periksa kembali isian formulir.", { fields: { altText: "Teks alternatif maksimal 300 karakter." } });
    item.altText = text === "" ? null : text;
    return json({ item: present(item) });
  }
  if (method === "DELETE") {
    if (accessOf(area) !== "write") return error(403, "forbidden");
    if (item.name.startsWith("gagal-")) return error(500, "server_error", "Terjadi kesalahan di server. Coba lagi sebentar lagi.");
    const users = [...new Set(item.usedBy)];
    if (users.length > 0) return error(409, "in_use", `File masih dipakai di: ${users.join(", ")}. Lepaskan dulu dari sana.`, { usedBy: users });
    library.splice(library.indexOf(item), 1);
    return json(null, 204);
  }
  return null;
};

export default handler;
