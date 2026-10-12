import { describe, expect, test } from "vitest";
import type { AnnouncementListItem } from "~/pages/announcements/model";
import { announcementStatuses } from "~/mock/komunikasi";
import { parsePersona } from "~/mock/persona";
import { createMockTransport } from "~/mock/transport";

// The mock of the Komunikasi screens (src/mock/komunikasi.ts): not shipped, but it is how they are reviewed without a
// backend (`pnpm dev:spa:mock`), so it has to say what the Worker says, or a screen that works here fails against
// the real thing. The Worker's side of each rule is in test/messages.test.ts and test/announcements-rules.test.ts.

function mock(persona = "super_admin") {
  const transport = createMockTransport({ persona: parsePersona(persona), dashboard: "ready", session: { get: () => true, set: () => {} }, delayMs: 0 });
  const call = async (method: string, path: string, json?: unknown) => {
    const res = await transport(path, { method, headers: json === undefined ? undefined : { "Content-Type": "application/json" }, body: json === undefined ? undefined : JSON.stringify(json) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: (res.status === 204 ? null : await res.json()) as any };
  };
  return { call };
}

const MESSAGES = "/api/admin/messages";

describe("Pesan in the mock", () => {
  test("the list: newest first, a preview and never the whole text, the envelope", async () => {
    const { call } = mock();
    const { status, body } = await call("GET", MESSAGES);
    expect(status).toBe(200);
    expect(body).toMatchObject({ page: 1, pageSize: 20, total: body.items.length });
    const times = body.items.map((item: { createdAt: string }) => Date.parse(item.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(Object.keys(body.items[0]).sort()).toEqual(["createdAt", "email", "fullName", "id", "preview", "readAt", "subject"]);
    // Only made-up people on an address nobody owns.
    expect(body.items.every((item: { email: string }) => item.email.endsWith("@example.test"))).toBe(true);
  });

  test("the filters and sort the screen asks for work, and others are refused like the Worker refuses them", async () => {
    const { call } = mock();
    const unread = (await call("GET", `${MESSAGES}?filter=unread`)).body;
    const read = (await call("GET", `${MESSAGES}?filter=read`)).body;
    const all = (await call("GET", MESSAGES)).body;
    expect(unread.total + read.total).toBe(all.total);
    expect(unread.items.every((item: { readAt: unknown }) => item.readAt === null)).toBe(true);
    expect(read.items.every((item: { readAt: unknown }) => item.readAt !== null)).toBe(true);
    expect((await call("GET", `${MESSAGES}?sort=createdAt`)).status).toBe(200);
    for (const bad of ["?filter=all", "?sort=email", "?sort=-message"]) {
      const res = await call("GET", `${MESSAGES}${bad}`);
      expect(res.status, bad).toBe(400);
      expect(res.body).toMatchObject({ error: "invalid_query" });
    }
  });

  // Negative test (scripts/negative-checks-spa-komunikasi.mjs): make the mock's GET mark a message read and this fails.
  test("a GET marks nothing; the verbs do, once, and the counts follow", async () => {
    const { call } = mock();
    const before = (await call("GET", `${MESSAGES}/counts`)).body;
    const unread = (await call("GET", `${MESSAGES}?filter=unread`)).body.items[0];

    expect((await call("GET", `${MESSAGES}/${unread.id}`)).body.item.readAt).toBeNull();
    expect((await call("GET", `${MESSAGES}/${unread.id}`)).body.item.readAt).toBeNull();
    expect((await call("GET", `${MESSAGES}/counts`)).body).toEqual(before);

    const first = (await call("POST", `${MESSAGES}/${unread.id}/read`)).body.item;
    expect(first.readAt).not.toBeNull();
    const again = (await call("POST", `${MESSAGES}/${unread.id}/read`)).body.item;
    expect(again.readAt).toBe(first.readAt); // idempotent: the first stamp stays
    expect((await call("GET", `${MESSAGES}/counts`)).body).toEqual({ total: before.total, unread: before.unread - 1 });

    expect((await call("POST", `${MESSAGES}/${unread.id}/unread`)).body.item.readAt).toBeNull();
    expect((await call("GET", `${MESSAGES}/counts`)).body).toEqual(before);
  });

  test("delete removes it; a second delete, a verb on it and a read of it are 404", async () => {
    const { call } = mock();
    const { id } = (await call("GET", MESSAGES)).body.items[0];
    expect((await call("DELETE", `${MESSAGES}/${id}`)).status).toBe(204);
    expect((await call("DELETE", `${MESSAGES}/${id}`)).status).toBe(404);
    expect((await call("GET", `${MESSAGES}/${id}`)).status).toBe(404);
    expect((await call("POST", `${MESSAGES}/${id}/read`)).status).toBe(404);
  });

  test("nothing can be created or edited, and the verbs are POST only", async () => {
    const { call } = mock();
    const { id } = (await call("GET", MESSAGES)).body.items[0];
    expect((await call("POST", MESSAGES, { fullName: "x" })).status).toBe(404);
    expect((await call("PUT", `${MESSAGES}/${id}`, {})).status).toBe(404);
    expect((await call("GET", `${MESSAGES}/${id}/read`)).status).toBe(404);
  });

  test("who may: a viewer reads and cannot change; an editor of other areas gets 403 on everything", async () => {
    const viewer = mock("viewer");
    const { id } = (await viewer.call("GET", MESSAGES)).body.items[0];
    expect((await viewer.call("GET", `${MESSAGES}/counts`)).status).toBe(200);
    expect((await viewer.call("POST", `${MESSAGES}/${id}/read`)).status).toBe(403);
    expect((await viewer.call("DELETE", `${MESSAGES}/${id}`)).status).toBe(403);

    const elsewhere = mock("editor:konten,pendaftaran");
    for (const [method, path] of [["GET", MESSAGES], ["GET", `${MESSAGES}/counts`], ["GET", `${MESSAGES}/${id}`], ["POST", `${MESSAGES}/${id}/read`], ["DELETE", `${MESSAGES}/${id}`]] as const) {
      expect((await elsewhere.call(method, path)).status, `${method} ${path}`).toBe(403);
    }
    const komunikasi = mock("editor:komunikasi");
    expect((await komunikasi.call("POST", `${MESSAGES}/${id}/read`)).status).toBe(200);
  });
});

describe("Pengumuman in the mock", () => {
  test("each list row carries the status the strip implies, and exactly one is current", async () => {
    const { call } = mock();
    const { body } = await call("GET", "/api/admin/announcements");
    const byTitle = Object.fromEntries(body.items.map((item: AnnouncementListItem) => [item.title, item.status]));
    expect(byTitle).toEqual({
      "Pendaftaran Angkatan 2026 Dibuka": "current", // active, no window
      "Jadwal wawancara berubah": "outside_window", // active, starts in two days
      "Pengumuman lama": "inactive",
    });
  });

  test("a newer live announcement takes the strip, and the older one says it is covered", async () => {
    const { call } = mock();
    const created = await call("POST", "/api/admin/announcements", { title: "Yang lebih baru", body: "Isi pengumuman baru", severity: "info", active: true });
    expect(created.status).toBe(201);
    const { body } = await call("GET", "/api/admin/announcements");
    const byTitle = Object.fromEntries(body.items.map((item: AnnouncementListItem) => [item.title, item.status]));
    expect(byTitle["Yang lebih baru"]).toBe("current");
    expect(byTitle["Pendaftaran Angkatan 2026 Dibuka"]).toBe("superseded");
  });

  test("the rule: both ends of the window are inclusive, either may be open, the newest created wins", () => {
    const now = Date.parse("2026-11-15T00:00:00.000Z");
    const row = (id: string, over: Partial<AnnouncementListItem>) =>
      ({ id, active: true, startsAt: null, endsAt: null, createdAt: "2026-11-01T00:00:00.000Z", ...over }) as AnnouncementListItem;
    const status = (rows: AnnouncementListItem[]) => Object.fromEntries([...announcementStatuses(rows, now)]);
    expect(status([row("a", { startsAt: new Date(now).toISOString() })])).toEqual({ a: "current" });
    expect(status([row("a", { startsAt: new Date(now + 1).toISOString() })])).toEqual({ a: "outside_window" });
    expect(status([row("a", { endsAt: new Date(now).toISOString() })])).toEqual({ a: "current" });
    expect(status([row("a", { endsAt: new Date(now - 1).toISOString() })])).toEqual({ a: "outside_window" });
    expect(status([row("a", { active: false })])).toEqual({ a: "inactive" });
    expect(status([row("old", { createdAt: "2026-11-01T00:00:00.000Z" }), row("new", { createdAt: "2026-11-02T00:00:00.000Z" })])).toEqual({ old: "superseded", new: "current" });
  });

  // The Worker's literals (test/announcements-rules.test.ts) say the same words.
  test("the CTA URL rule has the Worker's words", async () => {
    const { call } = mock();
    const save = (ctaUrl: string) => call("POST", "/api/admin/announcements", { title: "Judul uji", body: "Isi pengumuman uji", severity: "info", active: false, ctaLabel: "Daftar", ctaUrl });
    const message = async (url: string) => (await save(url)).body.fields?.ctaUrl;
    expect(await message("javascript:alert(1)")).toBe("Hanya URL http:// atau https:// yang diizinkan.");
    expect(await message("//evil.example/x")).toBe("Gunakan URL lengkap (https://...) untuk tujuan di luar situs ini.");
    expect(await message("gabung-siswa")).toBe("Format URL tidak valid. Gunakan https://... atau /path-di-situs-ini.");
    expect(await message("/jalan\\keluar")).toBe("Format URL tidak valid. Gunakan https://... atau /path-di-situs-ini.");
    expect(await message("/gabung-siswa")).toBeUndefined();
    expect(await message("https://example.org/donasi")).toBeUndefined();
  });
});
