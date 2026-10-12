import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";
import { resetUploadsBase, setUploader, type UploadOutcome, type UploadRequest } from "~/lib/crud/upload-client";
import { blankEducation, blankWork, cleanEducation, cleanWork, educationRows, fieldLabels, MAX_HISTORY, type TeamItem, toBody, toValues, workRows } from "~/pages/team/model";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

// Tim, the screens: the list (ListPage) and the form (FormShell, the upload field, two editable lists of entries),
// against stubbed answers in the Worker's shape. What every block does by itself is proved in test/crud/*; this
// file proves they are wired the way the legacy admin's team page behaved, and that a read-only role is offered
// nothing to change.

const LIST = "/api/admin/team";

function member(overrides: Partial<TeamItem> = {}): TeamItem {
  return {
    id: "t1",
    name: "Ahmad Fadillah",
    role: "Ketua Umum",
    image: null,
    category: "pengurus",
    bio: null,
    educationHistory: [],
    workHistory: [],
    displayOrder: 10,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

/** What a row of the list is: no bio and no histories. */
const row = (overrides: Partial<TeamItem> = {}) => {
  const { bio: _bio, educationHistory: _education, workHistory: _work, ...rest } = member(overrides);
  return rest;
};

const envelope = (items: unknown[], extra: { total?: number } = {}) => ({ items, page: 1, pageSize: 100, total: extra.total ?? items.length });
type Who = Parameters<typeof meBody>;

afterEach(() => {
  setUploader(null);
  resetUploadsBase();
});

async function openList(who: Who, routes: Parameters<typeof stubApi>[0] = {}, path = "/team", firstName = "Ahmad Fadillah") {
  const api = stubApi({ "GET /api/me": respond(meBody(...who)), "GET /api/config": respond({ uploadsBaseUrl: "https://files.example.test" }), [`GET ${LIST}`]: respond(envelope([row()])), ...routes });
  const view = renderApp(path);
  await screen.findByRole("heading", { level: 1, name: "Tim" });
  await screen.findByText(firstName);
  return { api, ...view };
}

const createButton = () => screen.queryByRole("link", { name: /Tambah Anggota/ });

describe("the list: who sees what", () => {
  test("a viewer reads the list and is offered nothing to change", async () => {
    await openList(["viewer", []]);
    expect(createButton()).toBeNull();
    expect(screen.queryByRole("button", { name: /^Hapus/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Edit/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Lihat Ahmad Fadillah" }).getAttribute("href")).toBe("/team/t1/edit");
  });

  test("an editor of Konten, and super_admin, get the create button and Edit and Hapus on every row", async () => {
    for (const who of [["editor", ["konten"]], ["super_admin", []]] as Who[]) {
      const view = await openList(who);
      expect(createButton()?.getAttribute("href")).toBe("/team/new");
      expect(screen.getByRole("link", { name: "Edit Ahmad Fadillah" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Hapus Ahmad Fadillah" })).toBeTruthy();
      view.unmount();
    }
  });

  test("an editor of other areas cannot open the page at all: the 403 page, and the list is never asked for", async () => {
    const api = stubApi({ "GET /api/me": respond(meBody("editor", ["pendaftaran"])), [`GET ${LIST}`]: respond(envelope([row()])) });
    renderApp("/team");
    expect(await screen.findByRole("heading", { level: 1, name: "Akses ditolak" })).toBeTruthy();
    expect(screen.queryByText("Ahmad Fadillah")).toBeNull();
    expect(api.count(`GET ${LIST}`)).toBe(0);
  });

  test("the empty state: 'Klik ... untuk membuat' only for someone who can create", async () => {
    stubApi({ "GET /api/me": respond(meBody("super_admin")), [`GET ${LIST}`]: respond(envelope([])) });
    const view = renderApp("/team");
    expect(await screen.findByText("Belum ada anggota tim. Klik “Tambah Anggota” untuk membuat.")).toBeTruthy();
    view.unmount();
    stubApi({ "GET /api/me": respond(meBody("viewer")), [`GET ${LIST}`]: respond(envelope([])) });
    renderApp("/team");
    expect(await screen.findByText("Belum ada anggota tim.")).toBeTruthy();
  });
});

describe("the list: what a row shows", () => {
  test("the legacy columns, the category as a tag, the order in monospace, the count and the link to the public page", async () => {
    await openList(["viewer", []], {
      [`GET ${LIST}`]: respond(envelope([row(), row({ id: "t2", name: "Rina", role: "Pembina", category: "dewan_pembina", displayOrder: 5 }), row({ id: "t3", name: "Joko", role: "Pengawas", category: "dewan_pengawas", displayOrder: 7 })])),
    });
    const grid = screen.getByRole("table", { name: /Daftar anggota tim/ });
    expect(within(grid).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Foto", "Nama", "Peran", "Kategori", "Urutan", "Aksi"]);
    for (const tag of ["Pengurus", "Dewan Pembina", "Dewan Pengawas"]) expect(within(grid).getByText(tag)).toBeTruthy();
    expect(within(grid).getByText("5")).toBeTruthy();
    expect(screen.getByText(/3 anggota tampil di/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "/tim" }).getAttribute("href")).toBe("https://sakolakembara.org/tim");
  });

  test("an uploaded photo is read from the public files domain, a legacy photo from where it is, and no photo is a placeholder", async () => {
    await openList(["viewer", []], {
      [`GET ${LIST}`]: respond(
        envelope([
          row({ id: "a", name: "Dengan Unggahan", image: "/uploads/team-photo/2026/00000000-0000-4000-8000-000000000001-foto.png" }),
          row({ id: "b", name: "Dengan Foto Lama", image: "/images/team/lama-ab12cd.jpg" }),
          row({ id: "c", name: "Tanpa Foto" }),
        ]),
      ),
    }, "/team", "Tanpa Foto");
    await waitFor(() => expect(document.querySelectorAll("table img")).toHaveLength(2));
    await waitFor(() => expect([...document.querySelectorAll("table img")].map((img) => img.getAttribute("src"))).toEqual(["https://files.example.test/uploads/team-photo/2026/00000000-0000-4000-8000-000000000001-foto.png", "/images/team/lama-ab12cd.jpg"]));
  });

  test("the Worker is asked for every member the page can hold, in the public page's order", async () => {
    const { api } = await openList(["viewer", []]);
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=100&sort=order`);
  });

  test("the filter bar asks with the Worker's names, and the categories are in the order of the page", async () => {
    const user = userEvent.setup();
    const { api } = await openList(["viewer", []]);
    expect(within(screen.getByLabelText("Kategori")).getAllByRole("option").map((option) => option.textContent)).toEqual(["Semua kategori", "Dewan Pembina", "Dewan Pengawas", "Pengurus"]);
    await user.type(screen.getByLabelText("Cari"), "ahmad");
    await user.selectOptions(screen.getByLabelText("Kategori"), "dewan_pengawas");
    await user.click(screen.getByRole("button", { name: "Terapkan" }));
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=100&q=ahmad&category=dewan_pengawas&sort=order`));
  });
});

describe("the list: delete", () => {
  test("the question names the member and says the photo goes too; the notice is the legacy one", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const { api } = await openList(["editor", ["konten"]], { [`DELETE ${LIST}/t1`]: () => gate.promise });
    await user.click(screen.getByRole("button", { name: "Hapus Ahmad Fadillah" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Hapus anggota?" });
    expect(dialog.textContent).toContain("Anggota “Ahmad Fadillah” akan dihapus. Tindakan ini tidak bisa dibatalkan. Foto juga akan dihapus dari server.");
    await user.click(within(dialog).getByRole("button", { name: "Hapus" }));
    expect(api.last(`DELETE ${LIST}/t1`)?.headers["if-match"]).toBe('"2026-10-01T00:00:00.000Z"');
    await act(async () => gate.resolve(respond(null, 204)));
    expect((await screen.findByRole("status")).textContent).toContain("Anggota berhasil dihapus.");
  });
});

// ---------------------------------------------------------------------------------- the form

async function openForm(who: Who, path: string, routes: Parameters<typeof stubApi>[0] = {}) {
  const api = stubApi({ "GET /api/me": respond(meBody(...who)), "GET /api/config": respond({ uploadsBaseUrl: "" }), ...routes });
  const view = renderApp(path);
  await screen.findByRole("form");
  return { api, ...view };
}
const location = () => screen.getByTestId("location").textContent;

function fakeUploader() {
  const requests: UploadRequest[] = [];
  setUploader(async (request): Promise<UploadOutcome> => {
    requests.push(request);
    return { ok: true, result: { id: "media-1", path: "/uploads/team-photo/2026/00000000-0000-4000-8000-0000000000aa-foto.png", contentType: "image/png", size: request.file.size, width: 10, height: 10 } };
  });
  return requests;
}
const photo = (name = "foto.png") => new File([new Uint8Array(500)], name, { type: "image/png" });
const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;

describe("the form: create", () => {
  test("the legacy form: its sections, labels and hints, the order starting at 100, one empty row for each history", async () => {
    await openForm(["editor", ["konten"]], "/team/new");
    expect(screen.getByRole("heading", { level: 1, name: "Anggota Baru" })).toBeTruthy();
    for (const name of ["Identitas", "Foto", "Bio", "Riwayat Pendidikan", "Riwayat Pekerjaan"]) expect(screen.getByRole("heading", { level: 2, name })).toBeTruthy();
    expect(screen.getByLabelText(/Nama Lengkap/)).toBeTruthy();
    expect(screen.getByLabelText(/Peran/, { selector: "#role" })).toBeTruthy();
    expect(within(screen.getByLabelText(/Kategori/)).getAllByRole("option").map((option) => (option as HTMLOptionElement).value)).toEqual(["dewan_pembina", "dewan_pengawas", "pengurus"]);
    expect((screen.getByLabelText(/Kategori/) as HTMLSelectElement).value).toBe("pengurus");
    expect((screen.getByLabelText(/Urutan Tampil/) as HTMLInputElement).value).toBe("100");
    expect(screen.getByText("Lebih kecil = lebih dulu (dalam kategori yang sama). Kelipatan 10 dianjurkan.")).toBeTruthy();
    expect(screen.getByText("Foto kotak 1:1 paling rapi (akan ditampilkan sebagai lingkaran di publik). Maksimal 5 MB.")).toBeTruthy();
    expect(screen.getAllByText("Kosongkan institusi untuk menghapus baris saat disimpan.")).toHaveLength(1);
    expect(screen.getAllByText("Kosongkan organisasi untuk menghapus baris saat disimpan.")).toHaveLength(1);
    expect(screen.getByLabelText("Institusi pendidikan 1")).toBeTruthy();
    expect(screen.getByLabelText("Organisasi pekerjaan 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Buat Anggota" })).toBeTruthy();
    expect(document.title).toBe("Anggota Baru | Admin Sakola Kembara");
  });

  test("submitting sends the body the Worker takes, once: blank history rows are left out; then the edit page says 'berhasil dibuat'", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const uploads = fakeUploader();
    const { api } = await openForm(["editor", ["konten"]], "/team/new", {
      [`POST ${LIST}`]: () => gate.promise,
      [`GET ${LIST}/new-id`]: respond({ item: member({ id: "new-id", name: "Siti Aminah" }) }),
    });
    await user.type(screen.getByLabelText(/Nama Lengkap/), "  Siti Aminah ");
    await user.type(screen.getByLabelText(/Peran/, { selector: "#role" }), "Sekretaris");
    await user.selectOptions(screen.getByLabelText(/Kategori/), "dewan_pengawas");
    await user.clear(screen.getByLabelText(/Urutan Tampil/));
    await user.type(screen.getByLabelText(/Urutan Tampil/), "30");
    await user.type(screen.getByLabelText(/^Bio/), "Bio singkat");
    await user.upload(fileInput(), photo());
    await screen.findByRole("img", { name: /Pratinjau|Foto/ }).catch(() => undefined);
    expect(uploads.map((request) => request.kind)).toEqual(["team-photo"]);

    // Education: a row with an institution, a row with only a degree (which goes), and an untouched blank one.
    await user.type(screen.getByLabelText("Institusi pendidikan 1"), "Universitas Contoh");
    await user.type(screen.getByLabelText("Gelar atau jurusan pendidikan 1"), "S1 Pendidikan");
    await user.click(screen.getByRole("button", { name: "Tambah Pendidikan" }));
    await user.type(screen.getByLabelText("Gelar atau jurusan pendidikan 2"), "Tanpa institusi");
    await user.click(screen.getByRole("button", { name: "Tambah Pendidikan" }));
    // Work: one row.
    await user.type(screen.getByLabelText("Organisasi pekerjaan 1"), "Yayasan Contoh");
    await user.type(screen.getByLabelText("Peran pekerjaan 1"), "Staf");

    const save = screen.getByRole("button", { name: "Buat Anggota" });
    await act(async () => {
      save.click();
      save.click();
    });
    expect(api.count(`POST ${LIST}`)).toBe(1);
    expect(api.last(`POST ${LIST}`)?.body).toEqual({
      name: "  Siti Aminah ", // as typed: the Worker trims
      role: "Sekretaris",
      category: "dewan_pengawas",
      image: "/uploads/team-photo/2026/00000000-0000-4000-8000-0000000000aa-foto.png",
      bio: "Bio singkat",
      educationHistory: [{ institution: "Universitas Contoh", degree: "S1 Pendidikan", year: null }],
      workHistory: [{ organization: "Yayasan Contoh", role: "Staf", period: null }],
      displayOrder: 30,
    });

    await act(async () => gate.resolve(respond({ item: member({ id: "new-id", name: "Siti Aminah" }) }, 201)));
    await waitFor(() => expect(location()).toBe("/team/new-id/edit"));
    expect(await screen.findByText("Anggota berhasil dibuat.")).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull(); // the unsaved guard let the navigation pass
  });

  test("a row can be removed, and the last row removed leaves none (nothing is sent)", async () => {
    const user = userEvent.setup();
    const { api } = await openForm(["editor", ["konten"]], "/team/new", { [`POST ${LIST}`]: respond({ item: member({ id: "n" }) }, 201), [`GET ${LIST}/n`]: respond({ item: member({ id: "n" }) }) });
    await user.click(screen.getByRole("button", { name: "Tambah Pendidikan" }));
    expect(screen.getAllByRole("button", { name: /^Hapus baris pendidikan/ })).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Hapus baris pendidikan 2" }));
    await user.click(screen.getByRole("button", { name: "Hapus baris pendidikan 1" }));
    expect(screen.queryByLabelText("Institusi pendidikan 1")).toBeNull();
    await user.type(screen.getByLabelText(/Nama Lengkap/), "Ahmad");
    await user.type(screen.getByLabelText(/Peran/, { selector: "#role" }), "Ketua");
    await user.click(screen.getByRole("button", { name: "Buat Anggota" }));
    await waitFor(() => expect(api.count(`POST ${LIST}`)).toBe(1));
    expect(api.last(`POST ${LIST}`)?.body).toMatchObject({ educationHistory: [], workHistory: [] });
  });

  test("at most 20 entries: the button that adds a row is disabled at 20", async () => {
    const user = userEvent.setup();
    await openForm(["editor", ["konten"]], "/team/new");
    for (let n = 1; n < MAX_HISTORY; n++) await user.click(screen.getByRole("button", { name: "Tambah Pendidikan" }));
    expect(screen.getAllByLabelText(/^Institusi pendidikan/)).toHaveLength(MAX_HISTORY);
    expect(screen.getByRole("button", { name: "Tambah Pendidikan" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Tambah Pekerjaan" })).toHaveProperty("disabled", false);
  });

  test("the photo can be picked and then removed: the body carries null", async () => {
    const user = userEvent.setup();
    fakeUploader();
    const { api } = await openForm(["editor", ["konten"]], "/team/new", { [`POST ${LIST}`]: respond({ item: member({ id: "n" }) }, 201), [`GET ${LIST}/n`]: respond({ item: member({ id: "n" }) }) });
    await user.upload(fileInput(), photo());
    await user.click(await screen.findByRole("button", { name: "Hapus" }));
    await user.type(screen.getByLabelText(/Nama Lengkap/), "Ahmad");
    await user.type(screen.getByLabelText(/Peran/, { selector: "#role" }), "Ketua");
    await user.click(screen.getByRole("button", { name: "Buat Anggota" }));
    await waitFor(() => expect(api.count(`POST ${LIST}`)).toBe(1));
    expect(api.last(`POST ${LIST}`)?.body).toMatchObject({ image: null });
  });

  test("a refused form: each field says it; an entry's error is under the row it belongs to, even when a blank row came before it", async () => {
    const user = userEvent.setup();
    await openForm(["editor", ["konten"]], "/team/new", {
      [`POST ${LIST}`]: respond(
        {
          error: "invalid",
          message: "Periksa kembali isian formulir.",
          // The Worker counts the rows that were SENT: the blank first row never was, so index 0 is the second row of the screen.
          fields: { name: "Nama minimal 2 karakter", "educationHistory.0.year": "Tahun maksimal 50 karakter", displayOrder: "Wajib diisi" },
        },
        400,
      ),
    });
    await user.type(screen.getByLabelText(/Nama Lengkap/), "A");
    await user.type(screen.getByLabelText(/Peran/, { selector: "#role" }), "Ketua");
    await user.click(screen.getByRole("button", { name: "Tambah Pendidikan" }));
    await user.type(screen.getByLabelText("Institusi pendidikan 2"), "UI");
    await user.click(screen.getByRole("button", { name: "Buat Anggota" }));

    const summary = await screen.findByRole("alert");
    expect(within(summary).getByRole("link", { name: "Nama Lengkap: Nama minimal 2 karakter" })).toBeTruthy();
    expect(within(summary).getByRole("link", { name: "Pendidikan 1, Tahun: Tahun maksimal 50 karakter" })).toBeTruthy();
    expect(within(summary).getByRole("link", { name: "Urutan Tampil: Wajib diisi" })).toBeTruthy();
    expect(screen.getByLabelText(/Nama Lengkap/).getAttribute("aria-invalid")).toBe("true");
    // The message is under the SECOND row, and the summary's link lands in its box.
    const secondRow = screen.getByLabelText("Institusi pendidikan 2").closest("div.rounded-lg")!;
    expect(within(secondRow as HTMLElement).getByText("Tahun maksimal 50 karakter")).toBeTruthy();
    expect(screen.getByLabelText("Tahun pendidikan 2").id).toBe("educationHistory.0.year");
    await user.click(within(summary).getByRole("link", { name: /^Pendidikan 1, Tahun/ }));
    expect(document.activeElement).toBe(screen.getByLabelText("Tahun pendidikan 2"));
    expect(location()).toBe("/team/new");
  });

  test("a viewer, or an editor of other areas, is not offered an empty form: the 403 page", async () => {
    for (const who of [["viewer", []], ["editor", ["komunikasi"]]] as Who[]) {
      stubApi({ "GET /api/me": respond(meBody(...who)) });
      const view = renderApp("/team/new");
      expect(await screen.findByRole("heading", { level: 1, name: "Akses ditolak" })).toBeTruthy();
      expect(screen.queryByRole("form")).toBeNull();
      view.unmount();
    }
  });
});

describe("the form: edit", () => {
  const loaded = member({
    bio: "Bio lama",
    category: "dewan_pembina",
    displayOrder: 20,
    educationHistory: [{ institution: "UI", degree: "S1", year: "2015" }, { institution: "ITB", degree: null, year: null }],
    workHistory: [{ organization: "Yayasan", role: "Staf", period: "2016 - 2018" }],
  });

  test("the member is loaded into the fields and the rows; saving sends If-Match of the version loaded and says 'berhasil disimpan'", async () => {
    const user = userEvent.setup();
    const { api } = await openForm(["editor", ["konten"]], "/team/t1/edit", {
      [`GET ${LIST}/t1`]: respond({ item: loaded }),
      [`PUT ${LIST}/t1`]: respond({ item: { ...loaded, name: "Nama Baru", updatedAt: "2026-10-02T00:00:00.000Z" } }),
    });
    await waitFor(() => expect((screen.getByLabelText(/Nama Lengkap/) as HTMLInputElement).value).toBe("Ahmad Fadillah"));
    expect((screen.getByLabelText(/Kategori/) as HTMLSelectElement).value).toBe("dewan_pembina");
    expect((screen.getByLabelText(/Urutan Tampil/) as HTMLInputElement).value).toBe("20");
    expect((screen.getByLabelText(/^Bio/) as HTMLTextAreaElement).value).toBe("Bio lama");
    expect((screen.getByLabelText("Institusi pendidikan 1") as HTMLInputElement).value).toBe("UI");
    expect((screen.getByLabelText("Tahun pendidikan 1") as HTMLInputElement).value).toBe("2015");
    expect((screen.getByLabelText("Institusi pendidikan 2") as HTMLInputElement).value).toBe("ITB");
    expect((screen.getByLabelText("Gelar atau jurusan pendidikan 2") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Periode pekerjaan 1") as HTMLInputElement).value).toBe("2016 - 2018");
    expect(screen.getByRole("heading", { level: 1, name: "Edit Anggota" })).toBeTruthy();

    await user.clear(screen.getByLabelText(/Nama Lengkap/));
    await user.type(screen.getByLabelText(/Nama Lengkap/), "Nama Baru");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    expect(await screen.findByText("Anggota tim berhasil disimpan.")).toBeTruthy();
    const put = api.last(`PUT ${LIST}/t1`)!;
    expect(put.headers["if-match"]).toBe('"2026-10-01T00:00:00.000Z"');
    expect(put.body).toMatchObject({
      name: "Nama Baru",
      category: "dewan_pembina",
      displayOrder: 20,
      image: null,
      educationHistory: [{ institution: "UI", degree: "S1", year: "2015" }, { institution: "ITB", degree: null, year: null }],
      workHistory: [{ organization: "Yayasan", role: "Staf", period: "2016 - 2018" }],
    });
    expect(location()).toBe("/team/t1/edit"); // stays, as the legacy admin did
  });

  test("a save that changed nothing but the blank rows still starts the form again from what was saved, and the next save sends the new version", async () => {
    const user = userEvent.setup();
    let version = "2026-10-02T00:00:00.000Z";
    const { api } = await openForm(["editor", ["konten"]], "/team/t1/edit", {
      [`GET ${LIST}/t1`]: respond({ item: loaded }),
      [`PUT ${LIST}/t1`]: () => {
        const saved = { ...loaded, updatedAt: version };
        version = "2026-10-03T00:00:00.000Z";
        return Promise.resolve(respond({ item: saved }));
      },
    });
    await waitFor(() => expect((screen.getByLabelText(/Nama Lengkap/) as HTMLInputElement).value).toBe("Ahmad Fadillah"));
    await user.click(screen.getByRole("button", { name: "Tambah Pekerjaan" }));
    expect(screen.getAllByLabelText(/^Organisasi pekerjaan/)).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await screen.findByText("Anggota tim berhasil disimpan.");
    await waitFor(() => expect(screen.getAllByLabelText(/^Organisasi pekerjaan/)).toHaveLength(1)); // the blank row is gone

    await user.type(screen.getByLabelText(/^Bio/), " lagi");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(api.count(`PUT ${LIST}/t1`)).toBe(2));
    expect(api.last(`PUT ${LIST}/t1`)?.headers["if-match"]).toBe('"2026-10-02T00:00:00.000Z"');
  });

  test("the unsaved-changes guard watches the rows too: an edited entry asks before leaving, an untouched blank row does not", async () => {
    const user = userEvent.setup();
    await openForm(["editor", ["konten"]], "/team/t1/edit", { [`GET ${LIST}/t1`]: respond({ item: loaded }), [`GET ${LIST}`]: respond(envelope([row()])) });
    await waitFor(() => expect((screen.getByLabelText(/Nama Lengkap/) as HTMLInputElement).value).toBe("Ahmad Fadillah"));

    await user.click(screen.getByRole("button", { name: "Tambah Pendidikan" })); // a blank row is not a change
    await user.click(screen.getByRole("link", { name: "Batal" }));
    await waitFor(() => expect(location()).toBe("/team"));
  });

  test("... and an edited entry does ask", async () => {
    const user = userEvent.setup();
    await openForm(["editor", ["konten"]], "/team/t1/edit", { [`GET ${LIST}/t1`]: respond({ item: loaded }), [`GET ${LIST}`]: respond(envelope([row()])) });
    await waitFor(() => expect((screen.getByLabelText("Institusi pendidikan 1") as HTMLInputElement).value).toBe("UI"));
    await user.type(screen.getByLabelText("Institusi pendidikan 1"), " Depok");
    await user.click(screen.getByRole("link", { name: "Batal" }));
    expect(await screen.findByRole("alertdialog", { name: "Tinggalkan halaman?" })).toBeTruthy();
    expect(location()).toBe("/team/t1/edit");
  });

  test("someone saved first (409 stale): the warning, and 'Muat ulang' replaces the form with the newer version", async () => {
    const user = userEvent.setup();
    let served = loaded;
    await openForm(["editor", ["konten"]], "/team/t1/edit", {
      [`GET ${LIST}/t1`]: () => Promise.resolve(respond({ item: served })),
      [`PUT ${LIST}/t1`]: respond({ error: "stale", message: "Data ini sudah diubah orang lain sejak kamu membukanya. Muat ulang untuk melihat versi terbaru." }, 409),
    });
    await waitFor(() => expect((screen.getByLabelText(/Nama Lengkap/) as HTMLInputElement).value).toBe("Ahmad Fadillah"));
    await user.type(screen.getByLabelText(/Nama Lengkap/), " saya");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    expect((await screen.findByText(/Data ini sudah diubah orang lain/)).textContent).toContain("Perubahan yang belum disimpan akan hilang");
    served = { ...loaded, name: "Nama dari orang lain", updatedAt: "2026-10-05T00:00:00.000Z" };
    await user.click(screen.getByRole("button", { name: "Muat ulang" }));
    await waitFor(() => expect((screen.getByLabelText(/Nama Lengkap/) as HTMLInputElement).value).toBe("Nama dari orang lain"));
  });

  test("a read-only role sees the values and the rows, and can change or add none of them", async () => {
    await openForm(["viewer", []], "/team/t1/edit", { [`GET ${LIST}/t1`]: respond({ item: loaded }) });
    await waitFor(() => expect((screen.getByLabelText(/Nama Lengkap/) as HTMLInputElement).value).toBe("Ahmad Fadillah"));
    for (const element of [screen.getByLabelText(/Nama Lengkap/), screen.getByLabelText("Institusi pendidikan 1"), screen.getByRole("button", { name: "Tambah Pendidikan" }), screen.getByRole("button", { name: "Hapus baris pekerjaan 1" })]) {
      expect(element.matches(":disabled")).toBe(true);
    }
    expect(screen.queryByRole("button", { name: "Simpan Perubahan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pilih file" })).toBeNull(); // no way to change the photo either
    expect(screen.getByRole("link", { name: "Tutup" })).toBeTruthy();
  });

  test("a member that is gone: the sentence and a way back", async () => {
    stubApi({ "GET /api/me": respond(meBody("editor", ["konten"])), [`GET ${LIST}/gone`]: respond({ error: "not_found", message: "Data tidak ditemukan. Mungkin sudah dihapus." }, 404) });
    renderApp("/team/gone/edit");
    expect((await screen.findByRole("alert")).textContent).toBe("Data tidak ditemukan. Mungkin sudah dihapus.");
    expect(screen.getByRole("link", { name: "Kembali ke daftar" }).getAttribute("href")).toBe("/team");
  });
});

describe("the model", () => {
  test("rows with no institution (or organization) are left out, the other boxes trimmed and an empty one is null", () => {
    expect(
      cleanEducation([
        { institution: "  UI ", degree: " S1 ", year: "" },
        { institution: "   ", degree: "S2", year: "2020" },
        { institution: "ITB", degree: "", year: " 2018 " },
      ]),
    ).toEqual([
      { institution: "UI", degree: "S1", year: null },
      { institution: "ITB", degree: null, year: "2018" },
    ]);
    expect(
      cleanWork([
        { organization: "Yayasan", role: " Staf ", period: " " },
        { organization: "", role: "Ketua", period: "2020" },
      ]),
    ).toEqual([{ organization: "Yayasan", role: "Staf", period: null }]);
  });

  test("entries from the API become rows of text, and back", () => {
    const entries = [{ institution: "UI", degree: null, year: undefined }];
    expect(educationRows(entries)).toEqual([{ institution: "UI", degree: "", year: "" }]);
    expect(workRows([{ organization: "Y", role: "R" }])).toEqual([{ organization: "Y", role: "R", period: "" }]);
    expect(blankEducation()).toEqual({ institution: "", degree: "", year: "" });
    expect(blankWork()).toEqual({ organization: "", role: "", period: "" });
  });

  test("the body: the order is a number, or null when it is empty or not a number; no photo is null", () => {
    const base = { ...toValues(member()), name: "A", role: "B" };
    expect(toBody({ ...base, displayOrder: "30" }, [], []).displayOrder).toBe(30);
    expect(toBody({ ...base, displayOrder: "" }, [], []).displayOrder).toBeNull();
    expect(toBody({ ...base, displayOrder: "abc" }, [], []).displayOrder).toBeNull();
    expect(toBody({ ...base, displayOrder: " 7 " }, [], []).displayOrder).toBe(7);
    expect(toBody({ ...base, image: "" }, [], []).image).toBeNull();
  });

  test("every field name the Worker can report has a label for the error summary", () => {
    const labels = fieldLabels();
    for (const name of ["name", "role", "category", "displayOrder", "image", "bio", "educationHistory", "workHistory", "educationHistory.19.degree", "workHistory.0.period"]) expect(labels[name], name).toBeTruthy();
  });
});
