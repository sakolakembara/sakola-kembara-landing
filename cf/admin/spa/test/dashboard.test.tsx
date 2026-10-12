import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

const batch = {
  id: "b1",
  year: 2026,
  phase: "awaiting_decisions",
  opensAt: "2026-08-01T00:00:00.000Z",
  closesAt: "2026-09-30T00:00:00.000Z",
  undecided: 10,
};
const activity = [
  { id: "a1", actorEmail: "ani@contoh.test", action: "announcement.create", resourceType: "announcement", resourceId: "r1", createdAt: "2026-10-12T05:30:00.000Z" },
  { id: "a2", actorEmail: "budi@contoh.test", action: "announcement.delete", resourceType: "announcement", resourceId: "r2", createdAt: "2026-10-11T05:30:00.000Z" },
];
const full = {
  attention: { pendingApplications: 7, underReviewApplications: 3, unreadMessages: 4, batch },
  recentActivity: activity,
};

async function open(role: Parameters<typeof meBody>[0], areas: Parameters<typeof meBody>[1], dashboard: Response | (() => Response | Promise<Response>)) {
  const api = stubApi({
    "GET /api/me": respond(meBody(role, areas)),
    "GET /api/dashboard": dashboard as never,
  });
  renderApp("/");
  await screen.findByRole("navigation", { name: "Menu utama" });
  return api;
}

const attention = () => screen.getByRole("region", { name: "Perlu perhatian" });

describe("dashboard: data", () => {
  test("greets by name and sets the tab title", async () => {
    await open("super_admin", [], respond(full));
    expect(await screen.findByRole("heading", { level: 1, name: "Halo, Tester" })).toBeTruthy();
    expect(document.title).toBe("Dashboard | Admin Sakola Kembara");
  });

  test("Perlu perhatian: the counts, each a link to the filtered list", async () => {
    await open("super_admin", [], respond(full));
    const block = await screen.findByRole("region", { name: "Perlu perhatian" });
    const tile = (label: string) => within(block).getByText(label).closest("a")!;

    expect(tile("Pendaftar pending").textContent).toContain("7");
    expect(tile("Pendaftar pending").getAttribute("href")).toBe("/applications?status=pending");
    expect(tile("Pendaftar dalam review").textContent).toContain("3");
    expect(tile("Pendaftar dalam review").getAttribute("href")).toBe("/applications?status=under_review");
    expect(tile("Pesan belum dibaca").textContent).toContain("4");
    expect(tile("Pesan belum dibaca").getAttribute("href")).toBe("/messages?filter=unread");
  });

  test("Perlu perhatian: the batch, in the words of the batch list", async () => {
    await open("super_admin", [], respond(full));
    const link = (await screen.findByText("Batch 2026")).closest("a")!;
    expect(link.textContent).toContain("Menunggu keputusan: 10 belum diputuskan");
    expect(link.getAttribute("href")).toBe("/batches/b1");
  });

  test.each([
    ["upcoming", "Dibuka"],
    ["open", "Buka sampai"],
    ["awaiting_decisions", "Menunggu keputusan: 10 belum diputuskan"],
    ["ready_to_publish", "Siap dipublikasikan"],
    ["published", "Hasil dipublikasikan"],
  ])("batch phase %s reads %s", async (phase, text) => {
    await open("viewer", [], respond({ attention: { ...full.attention, batch: { ...batch, phase } } }));
    const link = (await screen.findByText("Batch 2026")).closest("a")!;
    expect(link.textContent).toContain(text);
  });

  test("a count of zero is a quiet tile, not an alert", async () => {
    await open("viewer", [], respond({ attention: { pendingApplications: 0, underReviewApplications: 2, unreadMessages: 0, batch: null } }));
    const block = await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(within(block).getAllByLabelText("Perlu tindakan")).toHaveLength(1); // only the one with 2
    expect(within(block).queryByText(/^Batch /)).toBeNull();
  });

  test("Aktivitas terakhir: labels, who, a link to the target, none for a deletion", async () => {
    await open("super_admin", [], respond(full));
    const widget = await screen.findByRole("region", { name: "Aktivitas terakhir" });
    expect(within(widget).getByText("Pengumuman dibuat")).toBeTruthy();
    expect(within(widget).getByText("ani@contoh.test")).toBeTruthy();
    expect(within(widget).getByText("Pengumuman dibuat").closest("a")?.getAttribute("href")).toBe("/announcements/r1/edit");
    expect(within(widget).getByText("Pengumuman dihapus").closest("a")).toBeNull();
    expect(within(widget).getByRole("link", { name: "Semua" }).getAttribute("href")).toBe("/audit");
    expect(widget.querySelectorAll("time")).toHaveLength(2);
  });
});

describe("dashboard: empty, loading, error", () => {
  test("empty: says there is nothing to do, and no activity yet", async () => {
    await open(
      "super_admin",
      [],
      respond({ attention: { pendingApplications: 0, underReviewApplications: 0, unreadMessages: 0, batch: null }, recentActivity: [] }),
    );
    expect((await screen.findByText("Tidak ada yang perlu ditindaklanjuti saat ini.")).closest("section")).toBe(attention());
    expect(screen.getByText("Belum ada aktivitas. Setiap aksi admin akan muncul di sini.")).toBeTruthy();
  });

  test("loading: a status with skeletons, then the data", async () => {
    const gate = deferred<Response>();
    stubApi({ "GET /api/me": respond(meBody("super_admin")), "GET /api/dashboard": () => gate.promise });
    renderApp("/");
    const loading = await screen.findByText("Memuat dashboard…");
    expect(loading.closest("[role=status]")?.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("region", { name: "Perlu perhatian" })).toBeNull();
    // The shortcuts do not wait for the data.
    expect(screen.getByRole("link", { name: "Tulis artikel" })).toBeTruthy();

    gate.resolve(respond(full));
    await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(screen.queryByText("Memuat dashboard…")).toBeNull();
  });

  test("error: says so, and Coba lagi asks again", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const api = await open("super_admin", [], () => (++attempt === 1 ? respond({ error: "internal" }, 500) : respond(full)));
    expect((await screen.findByRole("alert")).textContent).toBe("Gagal memuat data dashboard. Silakan coba lagi.");
    expect(screen.queryByRole("region", { name: "Aktivitas terakhir" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(api.count("GET /api/dashboard")).toBe(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("the server cannot be reached", async () => {
    await open("viewer", [], () => {
      throw new TypeError("Failed to fetch");
    });
    expect((await screen.findByRole("alert")).textContent).toBe("Gagal memuat data dashboard. Silakan coba lagi.");
  });

  test.each([404, 501])("not served yet (%s): an honest note, no retry button", async (status) => {
    await open("viewer", [], respond({ error: "not_implemented" }, status));
    const note = await screen.findByText("Data dashboard belum tersedia di admin baru.");
    expect(note.getAttribute("role")).toBe("status"); // not an alert: nothing is broken
    expect(screen.queryByRole("button", { name: "Coba lagi" })).toBeNull();
  });

  test("a body that is not the documented shape is an error, not a blank dashboard", async () => {
    await open("viewer", [], respond({ attention: { pendingApplications: "banyak" } }));
    expect((await screen.findByRole("alert")).textContent).toBe("Gagal memuat data dashboard. Silakan coba lagi.");
  });
});

describe("dashboard: what each role sees", () => {
  const shortcuts = () => screen.queryByRole("region", { name: "Tindakan Cepat" });
  const labels = () => within(shortcuts()!).getAllByRole("link").map((link) => link.textContent);

  test("a viewer has no shortcuts, even while loading", async () => {
    const gate = deferred<Response>();
    stubApi({ "GET /api/me": respond(meBody("viewer")), "GET /api/dashboard": () => gate.promise });
    renderApp("/");
    await screen.findByText("Memuat dashboard…");
    expect(shortcuts()).toBeNull();
    gate.resolve(respond(full));
    await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(shortcuts()).toBeNull();
    expect(screen.queryByText("Tindakan Cepat")).toBeNull();
  });

  test("an editor of Konten gets the content shortcuts only", async () => {
    await open("editor", ["konten"], respond(full));
    await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(labels()).toEqual(["Tulis artikel", "Unggah laporan", "Tambah anggota tim"]);
  });

  test("an editor of Komunikasi gets the announcement shortcut only", async () => {
    await open("editor", ["komunikasi"], respond(full));
    await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(labels()).toEqual(["Buat pengumuman"]);
  });

  test("an editor with no areas has none", async () => {
    await open("editor", [], respond(full));
    await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(shortcuts()).toBeNull();
  });

  test("super_admin has all four, pointing at the new routes", async () => {
    await open("super_admin", [], respond(full));
    await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(labels()).toEqual(["Tulis artikel", "Buat pengumuman", "Unggah laporan", "Tambah anggota tim"]);
    expect(within(shortcuts()!).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/blog/new",
      "/announcements/new",
      "/reports/new",
      "/team/new",
    ]);
  });

  test("the activity log summary is for those who may open Aktivitas", async () => {
    await open("super_admin", [], respond(full));
    expect(await screen.findByRole("region", { name: "Aktivitas terakhir" })).toBeTruthy();
  });

  test.each([
    ["viewer", [] as never[]],
    ["editor", ["pendaftaran", "komunikasi", "konten"] as ("pendaftaran" | "komunikasi" | "konten")[]],
  ] as const)("%s sees no activity log summary, even if the server sent one", async (role, areas) => {
    await open(role, [...areas], respond(full));
    await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(screen.queryByRole("region", { name: "Aktivitas terakhir" })).toBeNull();
    expect(screen.queryByText("Pengumuman dibuat")).toBeNull();
  });

  test("and no summary when the server left it out", async () => {
    await open("super_admin", [], respond({ attention: full.attention }));
    await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(screen.queryByRole("region", { name: "Aktivitas terakhir" })).toBeNull();
  });
});
