import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test } from "vitest";
import { announcementStatuses, CTA_URL_MESSAGES } from "../src/announcements/rules";
import { announcementSeverity, contactSubject } from "../src/db/schema";
import { api, setTransport } from "../spa/src/lib/api";
import { describeFailure } from "../spa/src/lib/crud/errors";
import { parseListQuery, toApiQuery } from "../spa/src/lib/crud/query";
import { ANNOUNCEMENT_STATUSES, API_PATH as ANNOUNCEMENTS, LIST_SPEC as ANNOUNCEMENT_SPEC, SEVERITY_VALUES } from "../spa/src/pages/announcements/spec";
import { API_PATH as MESSAGES, COUNTS_PATH, LIST_SPEC as MESSAGE_SPEC, READ_FILTERS, SUBJECTS } from "../spa/src/pages/messages/spec";
import { call, signedInCookie, uniqueEmail } from "./helpers";

// What the Komunikasi screens send and expect, checked against the real Worker in workerd (the SPA tests stub the API,
// so this is what keeps the two sides honest): the list queries, the value tables, the answers of the new routes
// read through the SPA's own `api()`, and the words of the CTA URL rule. Same idea as test/crud-spa-contract.test.ts.

afterEach(() => setTransport(null));

/** The SPA's `api()` over the real Worker, with this session. */
function over(cookie: string) {
  setTransport(async (path, init) =>
    call(path, { method: init.method, headers: init.headers as Record<string, string> | undefined, body: init.body as string | undefined, cookie }),
  );
}

async function seedMessage(over: { readAt?: number | null } = {}) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO contact_messages (id, full_name, email, subject, message, read_at) VALUES (?, 'Ayu Contoh', 'ayu@example.test', 'donation', 'Isi pesan contoh yang cukup panjang.', ?)")
    .bind(id, over.readAt ?? null)
    .run();
  return id;
}

describe("the value tables are the Worker's", () => {
  test("subjects, severities and announcement statuses", () => {
    expect([...SUBJECTS]).toEqual([...contactSubject]);
    expect([...SEVERITY_VALUES]).toEqual([...announcementSeverity]);
    expect([...ANNOUNCEMENT_STATUSES]).toEqual([...announcementStatuses]);
  });
});

describe("the list queries the SPA builds are what the Worker accepts", () => {
  test("Pesan: the default query, each read filter, the sort both ways", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    over(cookie);
    const asked = (search: string) => toApiQuery(parseListQuery(new URLSearchParams(search), MESSAGE_SPEC), MESSAGE_SPEC);
    const queries = [asked(""), ...READ_FILTERS.map((filter) => asked(`filter=${filter}`)), asked("sort=createdAt"), asked("sort=-createdAt"), asked("filter=unread&page=2")];
    expect(queries[0]).toBe("?page=1&pageSize=20&sort=-createdAt");
    for (const query of queries) {
      const result = await api<{ items: unknown[]; page: number; pageSize: number; total: number }>(`${MESSAGES}${query}`);
      expect(result.ok, query).toBe(true);
    }
  });

  test("Pengumuman: every filter and sort of its spec", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    over(cookie);
    for (const sort of ANNOUNCEMENT_SPEC.sorts ?? []) {
      for (const direction of ["", "-"]) expect((await api(`${ANNOUNCEMENTS}?sort=${direction}${sort}`)).ok, `${direction}${sort}`).toBe(true);
    }
    for (const severity of SEVERITY_VALUES) expect((await api(`${ANNOUNCEMENTS}?severity=${severity}`)).ok).toBe(true);
    for (const active of ["true", "false"]) expect((await api(`${ANNOUNCEMENTS}?active=${active}`)).ok).toBe(true);
  });
});

describe("the new routes, read through the SPA's own api()", () => {
  test("list, counts, one, mark read, mark unread, delete: the shapes the screens use", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);
    over(cookie);
    const id = await seedMessage();

    const listed = await api<{ items: { id: string; preview: string; readAt: string | null; createdAt: string }[]; total: number }>(`${MESSAGES}?filter=unread`);
    expect(listed.ok && listed.data.items.map((item) => item.id)).toEqual([id]);

    const counts = await api<{ total: number; unread: number }>(COUNTS_PATH);
    expect(counts).toEqual({ ok: true, data: { total: 1, unread: 1 } });

    const one = await api<{ item: { id: string; message: string; readAt: string | null } }>(`${MESSAGES}/${id}`);
    expect(one.ok && one.data.item).toMatchObject({ id, readAt: null, message: "Isi pesan contoh yang cukup panjang." });

    const read = await api<{ item: { readAt: string } }>(`${MESSAGES}/${id}/read`, { method: "POST" });
    expect(read.ok && Number.isNaN(Date.parse(read.data.item.readAt))).toBe(false);
    const unread = await api<{ item: { readAt: string | null } }>(`${MESSAGES}/${id}/unread`, { method: "POST" });
    expect(unread.ok && unread.data.item.readAt).toBeNull();

    expect((await api(`${MESSAGES}/${id}`, { method: "DELETE" })).ok).toBe(true);
    const gone = await api(`${MESSAGES}/${id}`);
    expect(gone.ok).toBe(false);
    if (!gone.ok) expect(describeFailure(gone).message).toBe("Data tidak ditemukan. Mungkin sudah dihapus.");
  });

  test("a refusal reads as the SPA's sentence, for a viewer's write and for an editor of other areas", async () => {
    const viewer = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const id = await seedMessage();
    over(viewer);
    const refused = await api(`${MESSAGES}/${id}/read`, { method: "POST" });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.status).toBe(403);
      expect(describeFailure(refused).message).toBe("Kamu tidak punya izin untuk melakukan ini.");
    }

    over(await signedInCookie(uniqueEmail("elsewhere"), "editor", ["konten"]));
    for (const path of [MESSAGES, COUNTS_PATH, `${MESSAGES}/${id}`]) {
      const result = await api(path);
      expect(result.ok, path).toBe(false);
      if (!result.ok) expect(result.status).toBe(403);
    }
  });

  test("the list's status values are all ones the screen has a label for", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    over(cookie);
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO announcements (id, title, body, severity, active, starts_at, ends_at, created_at) VALUES ('a', 'Satu', 'Isi satu', 'info', 1, NULL, NULL, ?), ('b', 'Dua', 'Isi dua', 'info', 1, NULL, NULL, ?), ('c', 'Tiga', 'Isi tiga', 'info', 1, ?, NULL, ?), ('d', 'Empat', 'Isi empat', 'info', 0, NULL, NULL, ?)",
    )
      .bind(now - 2000, now - 1000, now + 86_400_000, now, now)
      .run();
    const result = await api<{ items: { title: string; status: string }[] }>(ANNOUNCEMENTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.fromEntries(result.data.items.map((item) => [item.title, item.status]))).toEqual({ Dua: "current", Satu: "superseded", Tiga: "outside_window", Empat: "inactive" });
    for (const item of result.data.items) expect(ANNOUNCEMENT_STATUSES as readonly string[]).toContain(item.status);
  });
});

describe("the CTA URL rule has the words the SPA's mock repeats", () => {
  // spa/test/komunikasi-mock.test.ts asserts the same three sentences.
  test("the three sentences", () => {
    expect(CTA_URL_MESSAGES).toEqual({
      offSite: "Gunakan URL lengkap (https://...) untuk tujuan di luar situs ini.",
      format: "Format URL tidak valid. Gunakan https://... atau /path-di-situs-ini.",
      scheme: "Hanya URL http:// atau https:// yang diizinkan.",
    });
  });

  test("and the Worker answers them on the field the SPA shows them under", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);
    over(cookie);
    const result = await api(ANNOUNCEMENTS, { method: "POST", json: { title: "Judul uji", body: "Isi pengumuman uji", severity: "info", active: false, ctaLabel: "Daftar", ctaUrl: "javascript:alert(1)" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(describeFailure(result).fields).toEqual({ ctaUrl: CTA_URL_MESSAGES.scheme });
  });
});
