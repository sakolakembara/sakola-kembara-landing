import { screen, waitFor, within } from "@testing-library/react";
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
  to: "/batches/b1",
};
const pending = { count: 7, to: "/applications?status=pending" };
const underReview = { count: 3, to: "/applications?status=under_review" };
const unread = { count: 4, to: "/messages?filter=unread" };
const full = { attention: { pendingApplications: pending, underReviewApplications: underReview, unreadMessages: unread, batch } };
/** What the Worker sends an editor of Komunikasi alone, an editor of Pendaftaran alone, and one of Konten alone. */
const messagesOnly = { attention: { unreadMessages: unread } };
const admissionOnly = { attention: { pendingApplications: pending, underReviewApplications: underReview, batch } };
const nothingToSee = { attention: {} };

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
const tileLabels = () => within(attention()).getAllByRole("link").map((link) => link.querySelector("div:last-child")?.textContent);

describe("dashboard: data", () => {
  test("greets by name and sets the tab title", async () => {
    await open("super_admin", [], respond(full));
    expect(await screen.findByRole("heading", { level: 1, name: "Halo, Tester" })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe("Dashboard | Admin Sakola Kembara"));
  });

  test("Perlu perhatian: the counts, each a link to where the server says it leads", async () => {
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

  test("the links are the server's, not the page's own (a changed target is followed)", async () => {
    await open(
      "super_admin",
      [],
      respond({ attention: { pendingApplications: { count: 1, to: "/applications?status=pending&batch=b9" }, batch: { ...batch, to: "/batches/b9" } } }),
    );
    const block = await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(within(block).getByText("Pendaftar pending").closest("a")!.getAttribute("href")).toBe("/applications?status=pending&batch=b9");
    expect(within(block).getByText("Batch 2026").closest("a")!.getAttribute("href")).toBe("/batches/b9");
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
    ["closed_empty", "Ditutup, tanpa pendaftar"],
    ["published", "Hasil dipublikasikan"],
  ])("batch phase %s reads %s", async (phase, text) => {
    await open("viewer", [], respond({ attention: { ...full.attention, batch: { ...batch, phase } } }));
    const link = (await screen.findByText("Batch 2026")).closest("a")!;
    expect(link.textContent).toContain(text);
  });

  test.each([
    ["awaiting_decisions", true],
    ["ready_to_publish", true],
    ["closed_empty", false], // nothing to decide or publish: a quiet tile
    ["published", false],
    ["open", false],
    ["upcoming", false],
  ])("batch phase %s: the tile is amber (needs a person): %s", async (phase, amber) => {
    await open("viewer", [], respond({ attention: { batch: { ...batch, phase, undecided: 0 } } }));
    const link = (await screen.findByText("Batch 2026")).closest("a")!;
    expect(link.className.includes("amber")).toBe(amber);
  });

  test("a count of zero is a quiet tile, not an alert", async () => {
    await open("viewer", [], respond({ attention: { pendingApplications: { ...pending, count: 0 }, underReviewApplications: { ...underReview, count: 2 }, unreadMessages: { ...unread, count: 0 } } }));
    const block = await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(within(block).getAllByLabelText("Perlu tindakan")).toHaveLength(1); // only the one with 2
    expect(within(block).queryByText(/^Batch /)).toBeNull();
  });

  test("only the tiles the server sent are drawn, in a fixed order", async () => {
    await open("editor", ["komunikasi"], respond(messagesOnly));
    await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(tileLabels()).toEqual(["Pesan belum dibaca"]);
    expect(screen.queryByText("Pendaftar pending")).toBeNull();
    expect(screen.queryByText(/^Batch /)).toBeNull();
  });

  test("an editor of Pendaftaran gets the applicants and the batch, no messages", async () => {
    await open("editor", ["pendaftaran"], respond(admissionOnly));
    await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(tileLabels()).toEqual(["Pendaftar pending", "Pendaftar dalam review", "Batch 2026"]);
    expect(screen.queryByText("Pesan belum dibaca")).toBeNull();
  });
});

describe("dashboard: two blocks and nothing else", () => {
  const gone = ["Aktivitas terakhir", "Pendaftar terbaru", "Pesan terbaru", "Ringkasan", "Artikel blog", "Laporan", "Anggota tim", "Pengumuman aktif"];

  test.each([
    ["super_admin", [] as never[]],
    ["viewer", [] as never[]],
    ["editor", ["pendaftaran", "komunikasi", "konten"] as ("pendaftaran" | "komunikasi" | "konten")[]],
  ] as const)("%s sees only Perlu perhatian and (if allowed) Tindakan Cepat, even if the server sent more", async (role, areas) => {
    await open(
      role,
      [...areas],
      respond({
        ...full,
        recentActivity: [{ id: "a1", actorEmail: "ani@contoh.test", action: "announcement.create", resourceType: "announcement", resourceId: "r1", createdAt: "2026-10-12T05:30:00.000Z" }],
        recentApplications: [{ fullName: "Contoh Nama" }],
      }),
    );
    await screen.findByRole("region", { name: "Perlu perhatian" });
    const main = screen.getByRole("main");
    const headings = within(main).getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(role === "viewer" ? ["Perlu perhatian"] : ["Perlu perhatian", "Tindakan Cepat"]);
    for (const text of gone) expect(within(main).queryByText(text)).toBeNull();
    expect(within(main).queryByText("ani@contoh.test")).toBeNull();
    expect(within(main).queryByText("Pengumuman dibuat")).toBeNull();
    expect(within(main).queryByText("Contoh Nama")).toBeNull();
  });
});

describe("dashboard: empty, loading, error", () => {
  const allZero = { attention: { pendingApplications: { ...pending, count: 0 }, underReviewApplications: { ...underReview, count: 0 }, unreadMessages: { ...unread, count: 0 } } };

  test("empty: says there is nothing to do", async () => {
    await open("super_admin", [], respond(allZero));
    expect((await screen.findByText("Tidak ada yang perlu ditindaklanjuti saat ini.")).closest("section")).toBe(attention());
    expect(screen.queryByText("Belum ada aktivitas. Setiap aksi admin akan muncul di sini.")).toBeNull();
  });

  test("an editor who may see nothing here (Konten alone) gets the same words, and still has their shortcuts", async () => {
    await open("editor", ["konten"], respond(nothingToSee));
    expect((await screen.findByText("Tidak ada yang perlu ditindaklanjuti saat ini.")).closest("section")).toBe(attention());
    expect(screen.getByRole("region", { name: "Tindakan Cepat" })).toBeTruthy();
  });

  test("an editor with no area at all is told to ask a super admin, and there is no shortcut block", async () => {
    await open("editor", [], respond(nothingToSee));
    expect((await screen.findByText("Akunmu belum punya akses ke area mana pun. Hubungi super admin untuk meminta akses.")).closest("section")).toBe(attention());
    expect(screen.queryByText("Tidak ada yang perlu ditindaklanjuti saat ini.")).toBeNull();
    expect(screen.queryByRole("region", { name: "Tindakan Cepat" })).toBeNull();
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

  test.each([
    ["super_admin", [] as never[], 4],
    ["viewer", [] as never[], 4],
    ["editor", ["pendaftaran"] as "pendaftaran"[], 3],
    ["editor", ["komunikasi"] as "komunikasi"[], 1],
    ["editor", ["konten"] as "konten"[], 0],
  ] as const)("loading: %s %j has as many placeholders as tiles to come (%i)", async (role, areas, tiles) => {
    const gate = deferred<Response>();
    stubApi({ "GET /api/me": respond(meBody(role, [...areas])), "GET /api/dashboard": () => gate.promise });
    renderApp("/");
    const status = (await screen.findByText("Memuat dashboard…")).closest("[role=status]")!;
    expect(status.querySelectorAll(".animate-pulse")).toHaveLength(tiles);
  });

  test("error: says so, and Coba lagi asks again", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const api = await open("super_admin", [], () => (++attempt === 1 ? respond({ error: "internal" }, 500) : respond(full)));
    expect((await screen.findByRole("alert")).textContent).toBe("Gagal memuat data dashboard. Silakan coba lagi.");
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

  test.each([404, 501])("not served (%s): an honest note, no retry button", async (status) => {
    await open("viewer", [], respond({ error: "not_implemented" }, status));
    const note = await screen.findByText("Data dashboard belum tersedia di admin baru.");
    expect(note.getAttribute("role")).toBe("status"); // not an alert: nothing is broken
    expect(screen.queryByRole("button", { name: "Coba lagi" })).toBeNull();
  });

  test("a body that is not the documented shape is an error, not a blank dashboard", async () => {
    await open("viewer", [], respond({ attention: { pendingApplications: 7 } }));
    expect((await screen.findByRole("alert")).textContent).toBe("Gagal memuat data dashboard. Silakan coba lagi.");
  });

  test("a link that leaves the app is an error, not a tile", async () => {
    await open("viewer", [], respond({ attention: { unreadMessages: { count: 1, to: "https://elsewhere.example/" } } }));
    expect((await screen.findByRole("alert")).textContent).toBe("Gagal memuat data dashboard. Silakan coba lagi.");
    expect(screen.queryByText("Pesan belum dibaca")).toBeNull();
  });
});

describe("dashboard: Tindakan Cepat, from what the role may change", () => {
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
    await open("editor", ["konten"], respond(nothingToSee));
    await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(labels()).toEqual(["Tulis artikel", "Unggah laporan", "Tambah anggota tim"]);
  });

  test("an editor of Komunikasi gets the announcement shortcut only", async () => {
    await open("editor", ["komunikasi"], respond(messagesOnly));
    await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(labels()).toEqual(["Buat pengumuman"]);
  });

  test("an editor of Pendaftaran alone has none (nothing to create from here)", async () => {
    await open("editor", ["pendaftaran"], respond(admissionOnly));
    await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(shortcuts()).toBeNull();
  });

  test("an editor with no areas has none", async () => {
    await open("editor", [], respond(nothingToSee));
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

  test("the shortcuts are there when the data failed to load", async () => {
    await open("super_admin", [], respond({ error: "internal" }, 500));
    await screen.findByRole("alert");
    expect(labels()).toEqual(["Tulis artikel", "Buat pengumuman", "Unggah laporan", "Tambah anggota tim"]);
  });
});
