import { API_PATH as ANNOUNCEMENTS, type AnnouncementListItem, type AnnouncementStatus } from "~/pages/announcements/model";
import { API_PATH as MESSAGES, LIST_SPEC, type MessageItem, READ_FILTERS } from "~/pages/messages/model";
import type { AccessOf } from "./resources";

// MOCK, local development only. What the Komunikasi screens need beyond the generic resource store (mock/resources.ts):
//
//   Pesan          the whole inbox, with the Worker's own semantics: a GET never marks a message read, `POST /:id/read`
//                  and `/unread` do (idempotent), `GET /counts`, the `filter` and `sort` the list accepts and refuses,
//                  403 for a persona without the komunikasi area (and for a write without write access).
//   Pengumuman     the `status` of each list row ("Tampil sekarang", ...), worked out from the rows of the generic store
//                  with the public strip's rule: switched on, inside its window (both ends inclusive), the most
//                  recently created one wins.
//
// Nothing leaves memory; a reload starts from the seed again. The addresses are example.test, the names made up.

const DAY = 86_400_000;
const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function seedMessages(): MessageItem[] {
  return [
    { id: "msg-1", fullName: "Ayu Contoh", email: "ayu.contoh@example.test", subject: "partnership", message: "Selamat siang, kami dari komunitas literasi ingin bekerja sama mengadakan kelas membaca bersama di bulan depan.\n\nBisakah kami berdiskusi lebih lanjut?", readAt: null, createdAt: iso(-3 * HOUR) },
    { id: "msg-2", fullName: "Budi Contoh", email: "budi.contoh@example.test", subject: "donation", message: "Saya ingin berdonasi rutin tiap bulan. Mohon info rekening resmi dan apakah ada bukti donasi untuk pelaporan.", readAt: null, createdAt: iso(-1 * DAY) },
    { id: "msg-3", fullName: "Citra Contoh", email: "citra.contoh@example.test", subject: "other", message: "Apakah pendaftaran siswa baru masih dibuka untuk angkatan tahun ini?", readAt: iso(-1 * DAY), createdAt: iso(-2 * DAY) },
    { id: "msg-4", fullName: "Dimas Contoh", email: "dimas.contoh@example.test", subject: "partnership", message: "Perusahaan kami membuka program tanggung jawab sosial dan tertarik mendukung kegiatan belajar anak-anak.", readAt: iso(-3 * DAY), createdAt: iso(-4 * DAY) },
    { id: "msg-5", fullName: "Eka Contoh", email: "eka.contoh@example.test", subject: "other", message: "Terima kasih atas kegiatan kemarin, anak saya senang sekali. Semoga terus berlanjut.", readAt: iso(-6 * DAY), createdAt: iso(-7 * DAY) },
    { id: "msg-6", fullName: "Fajar Contoh", email: "fajar.contoh@example.test", subject: "donation", message: "Kami punya buku bacaan anak bekas layak pakai sekitar dua kardus. Ke mana sebaiknya dikirim?", readAt: null, createdAt: iso(-8 * DAY) },
  ];
}

const json = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const error = (status: number, code: string, message?: string, extra: Record<string, unknown> = {}) => json({ error: code, ...(message ? { message } : {}), ...extra }, status);

function positiveInt(raw: string | null, fallback: number, max: number): number {
  if (raw === null || !/^\d{1,30}$/.test(raw.trim())) return fallback;
  const value = Number(raw);
  return value >= 1 ? Math.min(value, max) : fallback;
}

const NOT_FOUND = "Data tidak ditemukan. Mungkin sudah dihapus.";

/** What the generic store gives (the rows of a path and the handler); the mock asks it for announcements. */
interface Store {
  handle(method: string, url: URL, init: RequestInit): Response | null;
  rows(path: string): readonly unknown[];
}

/** The strip's rule, in miniature (src/public/queries.ts): the status of every announcement at `now`. */
export function announcementStatuses(rows: readonly AnnouncementListItem[], now = Date.now()): Map<string, AnnouncementStatus> {
  const live = (row: AnnouncementListItem) => row.active && (!row.startsAt || Date.parse(row.startsAt) <= now) && (!row.endsAt || Date.parse(row.endsAt) >= now);
  // The newest created wins; the generic store puts the newest first, so a tie keeps the earlier row.
  const shown = rows.filter(live).reduce<AnnouncementListItem | null>((best, row) => (best === null || Date.parse(row.createdAt) > Date.parse(best.createdAt) ? row : best), null);
  return new Map(rows.map((row) => [row.id, live(row) ? (row === shown ? "current" : "superseded") : row.active ? "outside_window" : "inactive"]));
}

export function createKomunikasiMock(accessOf: AccessOf) {
  let messages = seedMessages();

  const find = (id: string) => messages.find((message) => message.id === id);

  function listMessages(url: URL): Response {
    const params = url.searchParams;
    const page = positiveInt(params.get("page"), 1, 10_000);
    const pageSize = positiveInt(params.get("pageSize"), 20, 100);
    const wanted = params.get("sort") || LIST_SPEC.defaultSort!;
    if (wanted !== "createdAt" && wanted !== "-createdAt") return error(400, "invalid_query", "Pencarian atau penyaringan tidak dikenal.", { param: "sort" });
    const filter = params.get("filter");
    if (filter && !(READ_FILTERS as readonly string[]).includes(filter)) return error(400, "invalid_query", "Pencarian atau penyaringan tidak dikenal.", { param: "filter" });

    const direction = wanted.startsWith("-") ? -1 : 1;
    const rows = messages
      .filter((message) => (filter === "unread" ? message.readAt === null : filter === "read" ? message.readAt !== null : true))
      .sort((a, b) => direction * (Date.parse(a.createdAt) - Date.parse(b.createdAt)) || (a.id < b.id ? -1 : 1));
    const items = rows.slice((page - 1) * pageSize, page * pageSize).map(({ message, ...rest }) => ({ ...rest, preview: message.slice(0, 200) }));
    return json({ items, page, pageSize, total: rows.length });
  }

  function mark(message: MessageItem | undefined, to: "read" | "unread"): Response {
    if (!message) return error(404, "not_found", NOT_FOUND);
    // Idempotent, like the Worker: the first call changes it, the second answers the same message.
    if (to === "read" && message.readAt === null) message.readAt = new Date().toISOString();
    if (to === "unread" && message.readAt !== null) message.readAt = null;
    return json({ item: message });
  }

  function messagesAnswer(rest: string, method: string, url: URL): Response {
    const access = accessOf("komunikasi");
    // The Worker's guard: reads need any access to the area, changes need `write`.
    if (access === "none" || (method !== "GET" && access !== "write")) return error(403, "forbidden");

    if (rest === "") return method === "GET" ? listMessages(url) : error(404, "not_found");
    if (rest === "counts") {
      if (method !== "GET") return error(404, "not_found");
      return json({ total: messages.length, unread: messages.filter((message) => message.readAt === null).length });
    }
    const [id = "", verb, ...more] = rest.split("/");
    if (more.length > 0) return error(404, "not_found");
    const message = find(decodeURIComponent(id));
    if (verb === undefined) {
      // A GET only ever reads: opening a message marks nothing (the screen asks for that with POST /read).
      if (method === "GET") return message ? json({ item: message }) : error(404, "not_found", NOT_FOUND);
      if (method === "DELETE") {
        if (!message) return error(404, "not_found", NOT_FOUND);
        messages = messages.filter((candidate) => candidate !== message);
        return json(null, 204);
      }
      return error(404, "not_found");
    }
    if (method === "POST" && (verb === "read" || verb === "unread")) return mark(message, verb);
    return error(404, "not_found");
  }

  async function announcementsList(method: string, url: URL, init: RequestInit, store: Store): Promise<Response | null> {
    const answer = store.handle(method, url, init);
    if (!answer || !answer.ok) return answer;
    const body = (await answer.json()) as { items: AnnouncementListItem[] };
    const statuses = announcementStatuses(store.rows(ANNOUNCEMENTS) as AnnouncementListItem[]);
    return json({ ...body, items: body.items.map((item) => ({ ...item, status: statuses.get(item.id) ?? "inactive" })) });
  }

  /** The answer for a path of the Komunikasi screens, or null when the path is not one of them. */
  async function handle(method: string, url: URL, init: RequestInit, store: Store): Promise<Response | null> {
    if (url.pathname === ANNOUNCEMENTS && method === "GET") return announcementsList(method, url, init, store);
    const rest = url.pathname === MESSAGES ? "" : url.pathname.startsWith(`${MESSAGES}/`) ? url.pathname.slice(MESSAGES.length + 1) : null;
    return rest === null ? null : messagesAnswer(rest, method, url);
  }

  return { handle };
}
