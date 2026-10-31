import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { type BatchDetail, type BatchListed, fromLocalDatetime, toBody, toLocalDatetime, toValues } from "~/pages/batches/model";
import { deferred, meBody, renderApp, respond, stubApi } from "../helpers";

// The Batch screens (SAKEM-082): the list, the form and the page of one batch, against stubbed answers in the
// Worker's shape (test/pendaftaran-spa-contract.test.ts proves the Worker answers that shape). What the kit's
// blocks do by themselves is proved in test/crud/*; this file proves the batch screens are wired the way the
// legacy ones behaved: the same words, who sees which buttons, and what the publish panel does.

const LIST = "/api/admin/batches";
type Who = Parameters<typeof meBody>;
const editorWho: Who = ["editor", ["pendaftaran"]];

function listed(over: Partial<BatchListed> = {}): BatchListed {
  return {
    id: "b1",
    year: 2026,
    name: "Gen 7 — 2026/2027",
    description: null,
    opensAt: "2026-08-01T00:00:00.000Z",
    closesAt: "2026-09-30T00:00:00.000Z",
    resultsPublishedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    phase: "awaiting_decisions",
    pending: 3,
    underReview: 2,
    ...over,
  };
}

function detail(over: Partial<BatchDetail> = {}): BatchDetail {
  const { phase: _phase, pending: _pending, underReview: _underReview, ...base } = listed();
  return {
    ...base,
    phase: "awaiting_decisions",
    counts: { pending: 3, under_review: 2, accepted: 4, rejected: 1, total: 10 },
    canPublish: false,
    recent: [
      { id: "a1", fullName: "Siti Contoh", email: "siti@contoh.test", schoolName: "SMAN 1 Contoh", status: "pending", submittedAt: "2026-09-29T03:00:00.000Z" },
      { id: "a2", fullName: "Budi Contoh", email: "budi@contoh.test", schoolName: "SMK Contoh", status: "accepted", submittedAt: "2026-09-28T03:00:00.000Z" },
    ],
    ...over,
  };
}

const envelope = (items: unknown[], total = items.length) => ({ items, page: 1, pageSize: 20, total });
const location = () => screen.getByTestId("location").textContent;

async function openList(who: Who, routes: Parameters<typeof stubApi>[0] = {}, path = "/batches") {
  const api = stubApi({ "GET /api/me": respond(meBody(...who)), [`GET ${LIST}`]: respond(envelope([listed()])), ...routes });
  const view = renderApp(path);
  await screen.findByRole("heading", { level: 1, name: "Batch Pendaftaran" });
  await screen.findByText("Gen 7 — 2026/2027");
  return { api, ...view };
}

describe("the list", () => {
  test("a viewer reads it and is offered nothing to change: no create button, no Edit, no Hapus; 'Detail' leads to the batch", async () => {
    await openList(["viewer", []]);
    expect(screen.queryByRole("link", { name: /Batch Baru/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Hapus/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Edit/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Detail Gen 7 — 2026/2027" }).getAttribute("href")).toBe("/batches/b1");
  });

  test("an editor of Pendaftaran, and super_admin, get 'Batch Baru' and Kelola, Edit and Hapus on every row", async () => {
    for (const who of [editorWho, ["super_admin", []]] as Who[]) {
      const view = await openList(who);
      expect(screen.getByRole("link", { name: /Batch Baru/ }).getAttribute("href")).toBe("/batches/new");
      expect(screen.getByRole("link", { name: "Kelola Gen 7 — 2026/2027" }).getAttribute("href")).toBe("/batches/b1");
      expect(screen.getByRole("link", { name: "Edit Gen 7 — 2026/2027" }).getAttribute("href")).toBe("/batches/b1/edit");
      expect(screen.getByRole("button", { name: "Hapus Gen 7 — 2026/2027" })).toBeTruthy();
      view.unmount();
    }
  });

  test("an editor of other areas opens the 403 page, and the list is never asked for", async () => {
    const api = stubApi({ "GET /api/me": respond(meBody("editor", ["konten", "komunikasi"])), [`GET ${LIST}`]: respond(envelope([listed()])) });
    renderApp("/batches");
    expect(await screen.findByRole("heading", { level: 1, name: "Akses ditolak" })).toBeTruthy();
    expect(screen.queryByText("Gen 7 — 2026/2027")).toBeNull();
    expect(api.count(`GET ${LIST}`)).toBe(0);
  });

  test("the legacy columns, the phase of every kind as a tag, and where the undecided counts lead", async () => {
    await openList(["viewer", []], {
      [`GET ${LIST}`]: respond(
        envelope([
          listed({ id: "b5", year: 2027, name: "Gen 8", phase: "upcoming", pending: 0, underReview: 0 }),
          listed({ id: "b4", year: 2026, name: "Gen 7 — 2026/2027", phase: "open", pending: 1, underReview: 0 }),
          listed({ id: "b3", year: 2025, name: "Gen 6", phase: "awaiting_decisions", pending: 3, underReview: 2 }),
          listed({ id: "b2", year: 2024, name: "Gen 5", phase: "ready_to_publish", pending: 0, underReview: 0 }),
          listed({ id: "b1", year: 2023, name: "Gen 4", phase: "closed_empty", pending: 0, underReview: 0 }),
          listed({ id: "b0", year: 2022, name: "Gen 3", phase: "published", pending: 0, underReview: 0, resultsPublishedAt: "2022-12-01T00:00:00.000Z" }),
        ]),
      ),
    });
    const grid = screen.getByRole("table", { name: /Daftar batch pendaftaran/ });
    expect(within(grid).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Tahun", "Nama", "Periode", "Status", "Belum diputuskan", "Aksi"]);
    for (const label of ["Akan datang", "Buka", "Menunggu keputusan", "Siap dipublikasikan", "Ditutup, tanpa pendaftar", "Hasil dipublikasikan"]) {
      expect(within(grid).getByText(label), label).toBeTruthy();
    }
    // The applicants still waiting, each count a link to the list filtered to that batch and status.
    expect(within(grid).getByRole("link", { name: "3 pending" }).getAttribute("href")).toBe("/applications?batch=b3&status=pending");
    expect(within(grid).getByRole("link", { name: "2 dalam review" }).getAttribute("href")).toBe("/applications?batch=b3&status=under_review");
    expect(within(grid).getByRole("link", { name: "1 pending" }).getAttribute("href")).toBe("/applications?batch=b4&status=pending");
    expect(within(grid).queryByRole("link", { name: /0 /})).toBeNull();
    expect(screen.getByText("Pendaftaran siswa dibuka satu batch per tahun. Buat batch baru untuk membuka periode pendaftaran, lalu publikasikan hasil setelah semua keputusan selesai.")).toBeTruthy();
  });

  test("the empty list: 'Klik Batch Baru' only for someone who can create", async () => {
    stubApi({ "GET /api/me": respond(meBody(...editorWho)), [`GET ${LIST}`]: respond(envelope([])) });
    const view = renderApp("/batches");
    expect(await screen.findByText("Belum ada batch. Klik Batch Baru untuk membuka periode pendaftaran pertama.")).toBeTruthy();
    view.unmount();
    stubApi({ "GET /api/me": respond(meBody("viewer")), [`GET ${LIST}`]: respond(envelope([])) });
    renderApp("/batches");
    expect(await screen.findByText("Belum ada batch.")).toBeTruthy();
  });

  test("the search asks the Worker for the name, and the address says so", async () => {
    const user = userEvent.setup();
    const { api } = await openList(["viewer", []]);
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=20&sort=-year`);
    await user.type(screen.getByLabelText("Cari"), "gen 7{Enter}");
    await waitFor(() => expect(location()).toBe("/batches?q=gen+7"));
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=20&q=gen+7&sort=-year`));
  });

  test("deleting a batch that has applicants: the Worker's sentence, and no second try", async () => {
    const user = userEvent.setup();
    const message = "Batch ini masih punya pendaftar, jadi tidak bisa dihapus.";
    await openList(editorWho, { [`DELETE ${LIST}/b1`]: respond({ error: "in_use", message, usedBy: ["Pendaftar"] }, 409) });
    await user.click(screen.getByRole("button", { name: "Hapus Gen 7 — 2026/2027" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Hapus batch?" });
    await user.click(within(dialog).getByRole("button", { name: "Hapus" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(message);
    expect(within(dialog).queryByRole("button", { name: "Hapus" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: /Tutup|Batal/ })).toBeTruthy();
  });

  test("deleting an empty batch sends DELETE with its version, says so, and loads the list again", async () => {
    const user = userEvent.setup();
    const { api } = await openList(editorWho, { [`DELETE ${LIST}/b1`]: respond(null, 204) });
    await user.click(screen.getByRole("button", { name: "Hapus Gen 7 — 2026/2027" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Hapus" }));
    expect((await screen.findByRole("status")).textContent).toContain("Batch berhasil dihapus.");
    expect(api.last(`DELETE ${LIST}/b1`)?.headers["if-match"]).toBe('"2026-07-01T00:00:00.000Z"');
    expect(api.count(`GET ${LIST}`)).toBe(2);
  });
});

// ---------------------------------------------------------------------------------- the form

async function openForm(who: Who, path: string, routes: Parameters<typeof stubApi>[0] = {}) {
  const api = stubApi({ "GET /api/me": respond(meBody(...who)), ...routes });
  const view = renderApp(path);
  await screen.findByRole("form");
  return { api, ...view };
}

describe("the form: create", () => {
  // The browser itself refuses to submit a form with an empty required field (and so does jsdom), so a test of what the
  // Worker refuses fills the required ones first.
  async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/Nama batch/), "Gen 12");
    await user.type(screen.getByLabelText(/Buka pendaftaran/), "2031-08-01T09:00");
    await user.type(screen.getByLabelText(/Tutup pendaftaran/), "2031-09-30T17:00");
  }

  test("the legacy fields, labels and hints; the year starts at next year", async () => {
    await openForm(editorWho, "/batches/new");
    expect(screen.getByRole("heading", { level: 1, name: "Batch Baru" })).toBeTruthy();
    expect((screen.getByLabelText(/Tahun angkatan/) as HTMLInputElement).value).toBe(String(new Date().getFullYear() + 1));
    expect(screen.getByLabelText(/Tahun angkatan/).getAttribute("min")).toBe("2024");
    expect(screen.getByLabelText(/Tahun angkatan/).getAttribute("max")).toBe("2100");
    expect(screen.getByText("Contoh: 2026 untuk periode 2026/2027.")).toBeTruthy();
    expect(screen.getByText("Muncul di halaman siswa dan admin. Contoh: “Gen 7 — 2026/2027”.")).toBeTruthy();
    expect(screen.getByLabelText(/Nama batch/).getAttribute("placeholder")).toBe("Contoh: Gen 7 — 2026/2027");
    expect(screen.getByLabelText("Deskripsi (opsional)")).toBeTruthy();
    expect(screen.getByLabelText(/Buka pendaftaran/).getAttribute("type")).toBe("datetime-local");
    expect(screen.getByLabelText(/Tutup pendaftaran/).getAttribute("type")).toBe("datetime-local");
    expect(screen.getByRole("button", { name: "Buat Batch" })).toBeTruthy();
    // One bar: the breadcrumb is the way back and ends with the page, "Batal" is the other way out.
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getByRole("link", { name: "Batch" }).getAttribute("href")).toBe("/batches");
    expect(await crumbs.findByText("Batch baru")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Batal" }).getAttribute("href")).toBe("/batches");
    expect(screen.queryByRole("link", { name: "Kembali" })).toBeNull(); // no bar or back button of the form's own
    // the schedule is a card of its own in the side column, apart from the batch's name and year
    const card = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("[data-slot='card']")!;
    expect(card("Jadwal pendaftaran").contains(screen.getByLabelText(/Buka pendaftaran/))).toBe(true);
    expect(card("Jadwal pendaftaran").contains(screen.getByLabelText(/Tutup pendaftaran/))).toBe(true);
    expect(card("Jadwal pendaftaran").parentElement).not.toBe(card("Batch").parentElement);
    await waitFor(() => expect(document.title).toBe("Batch Baru | Admin Sakola Kembara"));
  });

  test("submitting sends the body the Worker takes, once, then opens the batch with 'Batch berhasil dibuat.'", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const created = listed({ id: "new-id", year: 2031, name: "Gen 12" });
    const { api } = await openForm(editorWho, "/batches/new", {
      [`POST ${LIST}`]: () => gate.promise,
      [`GET ${LIST}/new-id`]: respond({ item: detail({ ...created, phase: "upcoming", counts: { pending: 0, under_review: 0, accepted: 0, rejected: 0, total: 0 }, recent: [] }) }),
    });
    await user.clear(screen.getByLabelText(/Tahun angkatan/));
    await user.type(screen.getByLabelText(/Tahun angkatan/), "2031");
    await user.type(screen.getByLabelText(/Nama batch/), "Gen 12");
    await user.type(screen.getByLabelText(/Deskripsi/), "Angkatan baru");
    await user.type(screen.getByLabelText(/Buka pendaftaran/), "2031-08-01T09:00");
    await user.type(screen.getByLabelText(/Tutup pendaftaran/), "2031-09-30T17:00");
    const save = screen.getByRole("button", { name: "Buat Batch" });
    await act(async () => {
      save.click();
      save.click();
    });
    expect(api.count(`POST ${LIST}`)).toBe(1);
    expect(api.last(`POST ${LIST}`)?.body).toEqual({
      year: 2031,
      name: "Gen 12",
      description: "Angkatan baru",
      opensAt: new Date("2031-08-01T09:00").toISOString(),
      closesAt: new Date("2031-09-30T17:00").toISOString(),
    });
    await act(async () => gate.resolve(respond({ item: created }, 201)));
    await waitFor(() => expect(location()).toBe("/batches/new-id"));
    expect((await screen.findByRole("status", { name: "" })).textContent).toContain("Batch berhasil dibuat.");
    expect(screen.queryByRole("alertdialog")).toBeNull(); // the unsaved guard let the navigation pass
  });

  test("a refused form: each field says it, in the legacy words, and the summary links to the field", async () => {
    const user = userEvent.setup();
    await openForm(editorWho, "/batches/new", {
      [`POST ${LIST}`]: respond(
        { error: "invalid", message: "Periksa kembali isian formulir.", fields: { year: "Tahun terlalu jauh ke belakang", name: "Nama minimal 3 karakter", closesAt: "Tanggal tutup harus setelah tanggal buka" } },
        400,
      ),
    });
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Buat Batch" }));
    const summary = await screen.findByRole("alert");
    expect(within(summary).getByRole("link", { name: "Tahun angkatan: Tahun terlalu jauh ke belakang" })).toBeTruthy();
    expect(within(summary).getByRole("link", { name: "Nama batch: Nama minimal 3 karakter" })).toBeTruthy();
    expect(within(summary).getByRole("link", { name: "Tutup pendaftaran: Tanggal tutup harus setelah tanggal buka" })).toBeTruthy();
    expect(screen.getByLabelText(/Nama batch/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText(/Buka pendaftaran/).getAttribute("aria-invalid")).toBeNull();
    expect(location()).toBe("/batches/new");
  });

  test("a year that another batch has: the Worker's 409 lands on the year field", async () => {
    const user = userEvent.setup();
    await openForm(editorWho, "/batches/new", {
      [`POST ${LIST}`]: respond({ error: "conflict", message: "Data bentrok dengan data lain yang sudah ada.", fields: { year: "Tahun sudah dipakai batch lain" } }, 409),
    });
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Buat Batch" }));
    expect(await screen.findByRole("link", { name: "Tahun angkatan: Tahun sudah dipakai batch lain" })).toBeTruthy();
    expect(screen.getByLabelText(/Tahun angkatan/).getAttribute("aria-invalid")).toBe("true");
  });

  test("a viewer opening the form gets it read-only: disabled fields, no save", async () => {
    await openForm(["viewer", []], "/batches/new");
    expect(screen.queryByRole("button", { name: "Buat Batch" })).toBeNull();
    expect(screen.getByLabelText(/Nama batch/).matches(":disabled")).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Kamu hanya bisa melihat data ini");
  });
});

describe("the form: edit", () => {
  const loaded = listed({ id: "b1", year: 2026, name: "Gen 7", description: "Lama", opensAt: "2026-08-01T01:30:00.000Z", closesAt: "2026-09-30T10:00:00.000Z" });

  test("the batch is loaded into the fields (dates in local time), and saving sends If-Match and stays with the legacy notice", async () => {
    const user = userEvent.setup();
    const { api } = await openForm(editorWho, "/batches/b1/edit", {
      [`GET ${LIST}/b1`]: respond({ item: loaded }),
      [`PUT ${LIST}/b1`]: respond({ item: { ...loaded, name: "Gen 7 baru", updatedAt: "2026-07-02T00:00:00.000Z" } }),
    });
    await waitFor(() => expect((screen.getByLabelText(/Nama batch/) as HTMLInputElement).value).toBe("Gen 7"));
    expect((screen.getByLabelText(/Tahun angkatan/) as HTMLInputElement).value).toBe("2026");
    expect((screen.getByLabelText(/Deskripsi/) as HTMLTextAreaElement).value).toBe("Lama");
    expect((screen.getByLabelText(/Buka pendaftaran/) as HTMLInputElement).value).toBe(toLocalDatetime("2026-08-01T01:30:00.000Z"));
    expect(screen.getByRole("heading", { level: 1, name: "Edit Batch" })).toBeTruthy();
    // The breadcrumb ends with the batch's name, and "Batal" goes to the batch's page, not the list.
    expect(await within(screen.getByRole("navigation", { name: "Breadcrumb" })).findByText("Gen 7")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Batal" }).getAttribute("href")).toBe("/batches/b1");

    await user.clear(screen.getByLabelText(/Nama batch/));
    await user.type(screen.getByLabelText(/Nama batch/), "Gen 7 baru");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));

    expect((await screen.findByRole("status")).textContent).toContain("Perubahan berhasil disimpan.");
    const put = api.last(`PUT ${LIST}/b1`)!;
    expect(put.headers["if-match"]).toBe('"2026-07-01T00:00:00.000Z"');
    expect(put.body).toMatchObject({ year: 2026, name: "Gen 7 baru", description: "Lama" });
    expect(put.body!.opensAt).toBe("2026-08-01T01:30:00.000Z");
    expect(location()).toBe("/batches/b1/edit");
  });

  test("someone saved first (409 stale): the warning, and 'Muat ulang' replaces the form with the newer version", async () => {
    const user = userEvent.setup();
    let served = loaded;
    const { api } = await openForm(editorWho, "/batches/b1/edit", {
      [`GET ${LIST}/b1`]: () => Promise.resolve(respond({ item: served })),
      [`PUT ${LIST}/b1`]: respond({ error: "stale", message: "Data ini sudah diubah orang lain sejak kamu membukanya." }, 409),
    });
    await waitFor(() => expect((screen.getByLabelText(/Nama batch/) as HTMLInputElement).value).toBe("Gen 7"));
    await user.type(screen.getByLabelText(/Nama batch/), " saya");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    expect((await screen.findByText(/Data ini sudah diubah orang lain/)).textContent).toContain("Perubahan yang belum disimpan akan hilang");

    served = { ...loaded, name: "Gen 7 dari orang lain", updatedAt: "2026-07-05T00:00:00.000Z" };
    await user.click(screen.getByRole("button", { name: "Muat ulang" }));
    await waitFor(() => expect((screen.getByLabelText(/Nama batch/) as HTMLInputElement).value).toBe("Gen 7 dari orang lain"));
    expect(api.count(`GET ${LIST}/b1`)).toBe(2);
  });

  test("a read-only role sees the values and can change none of them", async () => {
    await openForm(["viewer", []], "/batches/b1/edit", { [`GET ${LIST}/b1`]: respond({ item: loaded }) });
    await waitFor(() => expect((screen.getByLabelText(/Nama batch/) as HTMLInputElement).value).toBe("Gen 7"));
    expect(screen.getByLabelText(/Nama batch/).matches(":disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Simpan Perubahan" })).toBeNull();
  });

  test("a batch that is gone: the sentence and a way back", async () => {
    stubApi({ "GET /api/me": respond(meBody(...editorWho)), [`GET ${LIST}/gone`]: respond({ error: "not_found", message: "Data tidak ditemukan. Mungkin sudah dihapus." }, 404) });
    renderApp("/batches/gone/edit");
    expect((await screen.findByRole("alert")).textContent).toBe("Data tidak ditemukan. Mungkin sudah dihapus.");
    expect(screen.getByRole("link", { name: "Kembali ke daftar" }).getAttribute("href")).toBe("/batches");
  });
});

describe("the form's values and body", () => {
  test("a date goes to the Worker as an instant and comes back as local time; an unreadable one goes as typed", () => {
    expect(fromLocalDatetime("2031-08-01T09:00")).toBe(new Date("2031-08-01T09:00").toISOString());
    expect(toLocalDatetime(new Date("2031-08-01T09:00").toISOString())).toBe("2031-08-01T09:00");
    expect(fromLocalDatetime("")).toBe("");
    expect(fromLocalDatetime("bukan tanggal")).toBe("bukan tanggal");
    expect(toLocalDatetime(null)).toBe("");
    expect(toLocalDatetime("bukan tanggal")).toBe("");
  });

  test("the year is sent as a number, or as an empty text when it is empty (the Worker answers like the legacy form)", () => {
    const values = toValues(null, new Date("2026-10-12T00:00:00Z"));
    expect(values.year).toBe("2027");
    expect(toBody({ ...values, year: "2031" }).year).toBe(2031);
    expect(toBody({ ...values, year: "  " }).year).toBe("");
  });
});

// ------------------------------------------------------------------------- the page of one batch

async function openDetail(who: Who, batch: BatchDetail, routes: Parameters<typeof stubApi>[0] = {}, path = `/batches/${batch.id}`) {
  const api = stubApi({ "GET /api/me": respond(meBody(...who)), [`GET ${LIST}/${batch.id}`]: respond({ item: batch }), ...routes });
  const view = renderApp(path);
  await screen.findByRole("heading", { level: 1, name: batch.name });
  return { api, ...view };
}

describe("the page of one batch", () => {
  test("the facts: the name, the year, the window, the phase, and the legacy ways back", async () => {
    await openDetail(editorWho, detail());
    expect(screen.getByText("Batch 2026")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kembali ke daftar batch" }).getAttribute("href")).toBe("/batches");
    expect(screen.getByText("Menunggu keputusan")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ubah Data" }).getAttribute("href")).toBe("/batches/b1/edit");
    await waitFor(() => expect(document.title).toBe("Gen 7 — 2026/2027 | Admin Sakola Kembara"));
  });

  test("the tiles are the four statuses with their counts, each a link to the applicants of this batch in that status", async () => {
    await openDetail(["viewer", []], detail());
    const summary = screen.getByRole("region", { name: /Ringkasan Pendaftar/ });
    const tiles = within(summary).getAllByRole("link");
    expect(tiles.map((tile) => [tile.getAttribute("aria-label"), tile.getAttribute("href")])).toEqual([
      ["Pending: 3 pendaftar", "/applications?batch=b1&status=pending"],
      ["Dalam Review: 2 pendaftar", "/applications?batch=b1&status=under_review"],
      ["Diterima: 4 pendaftar", "/applications?batch=b1&status=accepted"],
      ["Ditolak: 1 pendaftar", "/applications?batch=b1&status=rejected"],
    ]);
  });

  test("the newest applicants (not a table of a hundred) with 'Lihat semua' to the list filtered to the batch", async () => {
    await openDetail(["viewer", []], detail());
    const section = screen.getByRole("region", { name: "Pendaftar di batch ini" });
    expect(within(section).getByRole("link", { name: "Lihat semua" }).getAttribute("href")).toBe("/applications?batch=b1");
    const grid = within(section).getByRole("table", { name: /Lima pendaftar terbaru/ });
    expect(within(grid).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Nama", "Sekolah", "Status", "Dikirim"]);
    expect(within(grid).getByRole("link", { name: "Siti Contoh" }).getAttribute("href")).toBe("/applications/a1");
    expect(within(grid).getByText("siti@contoh.test")).toBeTruthy();
    expect(within(grid).getByText("Diterima")).toBeTruthy();
  });

  test("a batch nobody applied to says so", async () => {
    await openDetail(["viewer", []], detail({ counts: { pending: 0, under_review: 0, accepted: 0, rejected: 0, total: 0 }, recent: [], phase: "closed_empty" }));
    expect(screen.getByText("Belum ada pendaftar untuk batch ini.")).toBeTruthy();
    expect(screen.getByText("Ditutup, tanpa pendaftar")).toBeTruthy();
  });

  test("a batch that is gone: the sentence and a way back; a failure to load: 'Coba lagi'", async () => {
    const user = userEvent.setup();
    stubApi({ "GET /api/me": respond(meBody(...editorWho)), [`GET ${LIST}/gone`]: respond({ error: "not_found", message: "Data tidak ditemukan. Mungkin sudah dihapus." }, 404) });
    const view = renderApp("/batches/gone");
    expect((await screen.findByRole("alert")).textContent).toBe("Data tidak ditemukan. Mungkin sudah dihapus.");
    expect(screen.getByRole("link", { name: "Kembali ke daftar batch" }).getAttribute("href")).toBe("/batches");
    view.unmount();

    let calls = 0;
    stubApi({ "GET /api/me": respond(meBody(...editorWho)), [`GET ${LIST}/b1`]: () => Promise.resolve(++calls === 1 ? respond({ error: "internal" }, 500) : respond({ item: detail() })) });
    renderApp("/batches/b1");
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    await screen.findByRole("heading", { level: 1, name: "Gen 7 — 2026/2027" });
  });
});

describe("the page of one batch: publishing the results", () => {
  const ready = detail({ phase: "ready_to_publish", canPublish: true, counts: { pending: 0, under_review: 0, accepted: 4, rejected: 1, total: 5 } });
  const published = (over: Partial<BatchDetail> = {}) => ({ ...ready, phase: "published" as const, canPublish: false, resultsPublishedAt: "2026-10-12T03:00:00.000Z", updatedAt: "2026-10-12T03:00:00.000Z", ...over });

  test("the panel says the legacy things: the rule, the numbers, and why the button is off", async () => {
    await openDetail(editorWho, detail());
    const panel = screen.getByRole("complementary", { name: "Publikasi Hasil" });
    expect(within(panel).getByText(/Siswa hanya melihat hasil pendaftarannya setelah kamu klik publikasikan/)).toBeTruthy();
    expect(within(panel).getByText(/Total pendaftar:/).textContent).toBe("• Total pendaftar: 10");
    expect(within(panel).getByText(/Belum diputuskan:/).textContent).toBe("• Belum diputuskan: 5");
    expect(within(panel).getByText(/Diterima:/).textContent).toBe("• Diterima: 4");
    expect(within(panel).getByText(/Ditolak:/).textContent).toBe("• Ditolak: 1");
    expect(within(panel).getByRole("button", { name: "Publikasikan Hasil" })).toHaveProperty("disabled", true);
    expect(within(panel).getByText("Selesaikan semua keputusan (Diterima / Ditolak) terlebih dahulu.")).toBeTruthy();
  });

  test("with no applicant at all the hint says that instead", async () => {
    await openDetail(editorWho, detail({ counts: { pending: 0, under_review: 0, accepted: 0, rejected: 0, total: 0 }, recent: [], phase: "closed_empty" }));
    expect(screen.getByText("Belum ada pendaftar.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publikasikan Hasil" })).toHaveProperty("disabled", true);
  });

  test("publishing: one request however often it is pressed, then the legacy notice and the published state with its way back", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const { api } = await openDetail(editorWho, ready, { [`POST ${LIST}/b1/publish`]: () => gate.promise });
    const button = screen.getByRole("button", { name: "Publikasikan Hasil" });
    expect(button).toHaveProperty("disabled", false);
    await act(async () => {
      button.click();
      button.click();
    });
    expect(api.count(`POST ${LIST}/b1/publish`)).toBe(1);
    expect(screen.getByRole("button", { name: "Mempublikasikan..." })).toHaveProperty("disabled", true);

    await act(async () => gate.resolve(respond({ item: published() })));
    expect((await screen.findByRole("status", { name: "" })).textContent).toContain("Hasil batch berhasil dipublikasikan.");
    expect(screen.getByText(/Hasil sudah dipublikasikan pada/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Batalkan Publikasi" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Publikasikan Hasil" })).toBeNull();
    expect(screen.getByText(/^Hasil dipublikasikan/, { selector: "span" })).toBeTruthy();
  });

  test("a refusal from the Worker is shown in its own words, and the batch is loaded again to show why", async () => {
    const user = userEvent.setup();
    let served: BatchDetail = ready;
    const { api } = await openDetail(editorWho, ready, {
      [`GET ${LIST}/b1`]: () => Promise.resolve(respond({ item: served })),
      [`POST ${LIST}/b1/publish`]: () => {
        served = detail({ counts: { pending: 1, under_review: 0, accepted: 4, rejected: 1, total: 6 }, canPublish: false });
        return Promise.resolve(respond({ error: "undecided", message: "Masih ada 1 pendaftar yang belum diputuskan", undecided: 1 }, 409));
      },
    });
    await user.click(screen.getByRole("button", { name: "Publikasikan Hasil" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Masih ada 1 pendaftar yang belum diputuskan");
    await waitFor(() => expect(api.count(`GET ${LIST}/b1`)).toBe(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Publikasikan Hasil" })).toHaveProperty("disabled", true));
    expect(screen.getByText(/Belum diputuskan:/).textContent).toBe("• Belum diputuskan: 1");
  });

  test("a published batch: the date, and 'Batalkan Publikasi' puts it back with the legacy notice", async () => {
    const user = userEvent.setup();
    const { api } = await openDetail(editorWho, published(), { [`POST ${LIST}/b1/unpublish`]: respond({ item: ready }) });
    expect(screen.getByText(/Hasil sudah dipublikasikan pada/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Batalkan Publikasi" }));
    expect((await screen.findByRole("status", { name: "" })).textContent).toContain("Publikasi hasil dibatalkan.");
    expect(api.count(`POST ${LIST}/b1/unpublish`)).toBe(1);
    expect(screen.getByRole("button", { name: "Publikasikan Hasil" })).toHaveProperty("disabled", false);
  });

  // Negative test (scripts/negative-checks-spa-pendaftaran.mjs): show the publish buttons to a role that cannot write.
  test("a viewer sees the state and the numbers and no button to publish or to cancel", async () => {
    await openDetail(["viewer", []], ready);
    const panel = screen.getByRole("complementary", { name: "Publikasi Hasil" });
    expect(within(panel).getByText(/Total pendaftar:/)).toBeTruthy();
    expect(within(panel).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link", { name: "Ubah Data" })).toBeNull();
    expect(screen.getByRole("link", { name: "Lihat Data" }).getAttribute("href")).toBe("/batches/b1/edit");
    const view = screen.getByRole("main");
    expect(within(view).queryByRole("button", { name: /Publikasikan|Batalkan/ })).toBeNull();
  });

  test("a viewer sees a published batch and no way to cancel it", async () => {
    await openDetail(["viewer", []], published());
    expect(screen.getByText(/Hasil sudah dipublikasikan pada/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Batalkan Publikasi" })).toBeNull();
  });
});
