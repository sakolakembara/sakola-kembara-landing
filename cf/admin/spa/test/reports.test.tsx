import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";
import { resetUploadsBase, setUploader, type UploadOutcome, type UploadRequest } from "~/lib/crud/upload-client";
import { defaultYear, formatBytes, toCreateBody, toUpdateBody, toValues, yearKind, type ReportItem } from "~/pages/reports/model";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

// Laporan, the screens: the list (ListPage) and the form (FormShell with the upload field), against stubbed answers
// in the Worker's shape. What every block does by itself is proved in test/crud/*; this file proves they are wired
// together the way the legacy admin's reports page behaved, and that a read-only role is offered nothing to change.

const LIST = "/api/admin/reports";

function item(overrides: Partial<ReportItem> = {}): ReportItem {
  return {
    id: "r1",
    title: "Laporan Dampak 2025/2026",
    description: "Ringkasan dampak program.",
    category: "impact",
    year: "2025/2026",
    filePath: "/uploads/report/2026/00000000-0000-4000-8000-000000000001-laporan-dampak.pdf",
    fileSize: 1_843_200,
    uploadedAt: "2026-10-01T03:00:00.000Z",
    updatedAt: "2026-10-01T03:00:00.000Z",
    ...overrides,
  };
}

const envelope = (items: unknown[], extra: { total?: number } = {}) => ({ items, page: 1, pageSize: 100, total: extra.total ?? items.length });
type Who = Parameters<typeof meBody>;

afterEach(() => {
  setUploader(null);
  resetUploadsBase();
});

async function openList(who: Who, routes: Parameters<typeof stubApi>[0] = {}, path = "/reports") {
  const api = stubApi({ "GET /api/me": respond(meBody(...who)), "GET /api/config": respond({ uploadsBaseUrl: "https://files.example.test" }), [`GET ${LIST}`]: respond(envelope([item()])), ...routes });
  const view = renderApp(path);
  await screen.findByRole("heading", { level: 1, name: "Laporan" });
  await screen.findByText("Laporan Dampak 2025/2026");
  return { api, ...view };
}

const createButton = () => screen.queryByRole("link", { name: /Upload Laporan/ });

describe("the list: sorting by a header", () => {
  test("a header button sorts through the address bar and asks the Worker for it; the next press flips it", async () => {
    const user = userEvent.setup();
    const { api } = await openList(["viewer", []]);
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=100&sort=-year`);
    expect(screen.getByRole("columnheader", { name: "Tahun" }).getAttribute("aria-sort")).toBe("descending");

    await user.click(screen.getByRole("button", { name: "Judul" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/reports?sort=title"));
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=100&sort=title`));
    expect(screen.getByRole("columnheader", { name: "Judul" }).getAttribute("aria-sort")).toBe("ascending");

    await user.click(screen.getByRole("button", { name: "Judul" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/reports?sort=-title"));

    // Tahun starts biggest first, which is the default of this list: the address bar is clean again, then it flips.
    await user.click(screen.getByRole("button", { name: "Tahun" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/reports"));
    await user.click(screen.getByRole("button", { name: "Tahun" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/reports?sort=year"));
  });

  test("a new sort goes back to the first page", async () => {
    const user = userEvent.setup();
    const { api } = await openList(["viewer", []], {}, "/reports?page=3");
    await user.click(screen.getByRole("button", { name: "Ukuran" }));
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=100&sort=-fileSize`));
  });
});

describe("the list: nothing found", () => {
  test("says so with an action that shows everything again", async () => {
    const user = userEvent.setup();
    const { api } = await openList(["viewer", []], { [`GET ${LIST}`]: (call) => respond(envelope(call.url.includes("q=") ? [] : [item()])) });
    await user.type(screen.getByLabelText("Cari"), "zzz");
    expect(await screen.findByText("Tidak ada laporan yang cocok dengan filter.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Tampilkan semua" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/reports"));
    expect(await screen.findByText("Laporan Dampak 2025/2026")).toBeTruthy();
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=100&sort=-year`);
  });
});

describe("the list: who sees what", () => {
  test("a viewer reads the list and is offered nothing to change: no create button, no Edit, no Hapus, 'Lihat' for the form", async () => {
    await openList(["viewer", []]);
    expect(createButton()).toBeNull();
    expect(screen.queryByRole("button", { name: /^Hapus/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Edit/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Lihat Laporan Dampak 2025/2026" }).getAttribute("href")).toBe("/reports/r1/edit");
    // The PDF itself is still one click away.
    expect(screen.getByRole("link", { name: "Buka PDF Laporan Dampak 2025/2026" })).toBeTruthy();
  });

  test("an editor of Konten, and super_admin, get the create button and Edit and Hapus on every row", async () => {
    for (const who of [["editor", ["konten"]], ["super_admin", []]] as Who[]) {
      const view = await openList(who);
      expect(createButton()?.getAttribute("href")).toBe("/reports/new");
      expect(screen.getByRole("link", { name: "Edit Laporan Dampak 2025/2026" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Hapus Laporan Dampak 2025/2026" })).toBeTruthy();
      view.unmount();
    }
  });

  test("an editor of other areas cannot open the page at all: the 403 page, and the list is never asked for", async () => {
    const api = stubApi({ "GET /api/me": respond(meBody("editor", ["pendaftaran", "komunikasi"])), [`GET ${LIST}`]: respond(envelope([item()])) });
    renderApp("/reports");
    expect(await screen.findByRole("heading", { level: 1, name: "Akses ditolak" })).toBeTruthy();
    expect(screen.queryByText("Laporan Dampak 2025/2026")).toBeNull();
    expect(api.count(`GET ${LIST}`)).toBe(0);
  });

  test("the empty state: 'Klik ... untuk menambah' only for someone who can create", async () => {
    stubApi({ "GET /api/me": respond(meBody("super_admin")), [`GET ${LIST}`]: respond(envelope([])) });
    const view = renderApp("/reports");
    expect(await screen.findByText("Belum ada laporan. Klik “Upload Laporan” untuk menambah.")).toBeTruthy();
    view.unmount();
    stubApi({ "GET /api/me": respond(meBody("viewer")), [`GET ${LIST}`]: respond(envelope([])) });
    renderApp("/reports");
    expect(await screen.findByText("Belum ada laporan.")).toBeTruthy();
  });
});

describe("the list: what a row shows", () => {
  test("a table named for screen readers with the legacy columns; the category as a tag, the year and its kind, the size, the day", async () => {
    await openList(["viewer", []], {
      [`GET ${LIST}`]: respond(
        envelope([
          item(),
          item({ id: "r2", title: "Laporan Tahunan 2025", description: null, category: "yearly", year: "2025", fileSize: 512, filePath: "/reports/2025/yearly/lama.pdf" }),
          item({ id: "r3", title: "Laporan Keuangan", category: "financial", year: "2024/2025", fileSize: 340 * 1024 }),
        ]),
      ),
    });
    const grid = screen.getByRole("table", { name: /Daftar laporan/ });
    expect(within(grid).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Judul", "Kategori", "Tahun", "Ukuran", "Diupload", "Aksi"]);
    for (const tag of ["Laporan Dampak", "Laporan Tahunan", "Laporan Keuangan"]) expect(within(grid).getAllByText(tag).length).toBeGreaterThan(0);
    expect(within(grid).getAllByText("Tahun Ajaran")).toHaveLength(2);
    expect(within(grid).getAllByText("Tahun")).toHaveLength(2); // the column header and the one single-year row
    expect(within(grid).getByText("1.8 MB")).toBeTruthy();
    expect(within(grid).getByText("512 B")).toBeTruthy();
    expect(within(grid).getByText("340 KB")).toBeTruthy();
    expect(within(grid).getAllByText(/Okt 2026/).length).toBeGreaterThan(0);
    expect(within(grid).getAllByText("Ringkasan dampak program.")).toHaveLength(2); // rows 1 and 3; row 2 has none
    expect(within(grid).getByText("/reports/2025/yearly/lama.pdf")).toBeTruthy();
    expect(screen.getByText(/3 total laporan\. Tampil di publik di/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "/laporan" }).getAttribute("href")).toBe("https://sakolakembara.org/laporan");
  });

  test("'Lihat' opens the PDF in a new tab, from the public files domain; a legacy static path stays where it is", async () => {
    await openList(["viewer", []], { [`GET ${LIST}`]: respond(envelope([item(), item({ id: "r2", title: "Lama", filePath: "/reports/2025/yearly/lama.pdf" })])) });
    const upload = screen.getByRole("link", { name: "Buka PDF Laporan Dampak 2025/2026" });
    await waitFor(() => expect(upload.getAttribute("href")).toBe("https://files.example.test/uploads/report/2026/00000000-0000-4000-8000-000000000001-laporan-dampak.pdf"));
    expect(upload.getAttribute("target")).toBe("_blank");
    expect(upload.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("link", { name: "Buka PDF Lama" }).getAttribute("href")).toBe("/reports/2025/yearly/lama.pdf");
  });

  test("the Worker is asked for every report the page can hold, newest year first", async () => {
    const { api } = await openList(["viewer", []]);
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=100&sort=-year`);
  });

  test("the filter bar asks with the Worker's names, and the address bar says what is applied", async () => {
    const user = userEvent.setup();
    const { api } = await openList(["viewer", []]);
    await user.type(screen.getByLabelText("Cari"), "dampak");
    await user.selectOptions(screen.getByLabelText("Kategori"), "impact");
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/reports?q=dampak&category=impact"));
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=100&q=dampak&category=impact&sort=-year`));
    expect(within(screen.getByLabelText("Kategori")).getAllByRole("option").map((option) => option.textContent)).toEqual(["Semua kategori", "Laporan Tahunan", "Laporan Keuangan", "Laporan Dampak", "Laporan Donasi"]);
  });
});

describe("the list: delete", () => {
  test("the question names the report and says what goes with it; confirming sends DELETE with the version, then the notice", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const { api } = await openList(["editor", ["konten"]], { [`DELETE ${LIST}/r1`]: () => gate.promise });
    await user.click(screen.getByRole("button", { name: "Hapus Laporan Dampak 2025/2026" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Hapus laporan?" });
    expect(dialog.textContent).toContain("Laporan “Laporan Dampak 2025/2026” akan dihapus. Tindakan ini tidak bisa dibatalkan. File PDF dan metadata akan dihapus.");
    await user.click(within(dialog).getByRole("button", { name: "Hapus" }));
    expect(api.last(`DELETE ${LIST}/r1`)?.headers["if-match"]).toBe('"2026-10-01T03:00:00.000Z"');
    await act(async () => gate.resolve(respond(null, 204)));
    expect((await screen.findByRole("status")).textContent).toContain("Laporan berhasil dihapus.");
    expect(api.count(`GET ${LIST}`)).toBe(2);
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

/** An uploader that answers at once with the path and size the Worker would, and records what it was asked. */
function fakeUploader() {
  const requests: UploadRequest[] = [];
  setUploader(async (request): Promise<UploadOutcome> => {
    requests.push(request);
    return {
      ok: true,
      result: { id: "media-1", path: "/uploads/report/2026/00000000-0000-4000-8000-0000000000aa-laporan-baru.pdf", contentType: "application/pdf", size: request.file.size, width: null, height: null },
    };
  });
  return requests;
}
const pdfFile = (name = "Laporan Baru.pdf", size = 2048) => new File([new Uint8Array(size)], name, { type: "application/pdf" });
const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;

describe("the form: create", () => {
  test("the legacy form: sections, the labels, the four categories, the year's suggestion and hint, the file's description", async () => {
    await openForm(["editor", ["konten"]], "/reports/new");
    expect(screen.getByRole("heading", { level: 1, name: "Upload Laporan" })).toBeTruthy();
    for (const name of ["Metadata", "File"]) expect(screen.getByRole("heading", { level: 2, name })).toBeTruthy();
    expect(screen.getByLabelText(/Judul/)).toBeTruthy();
    expect(screen.getByLabelText(/Deskripsi/)).toBeTruthy();
    expect(within(screen.getByLabelText(/Kategori/)).getAllByRole("option").map((option) => (option as HTMLOptionElement).value)).toEqual(["yearly", "financial", "impact", "donation"]);
    expect((screen.getByLabelText(/Kategori/) as HTMLSelectElement).value).toBe("yearly");
    expect((screen.getByLabelText(/Tahun/) as HTMLInputElement).value).toBe(defaultYear());
    const year = new Date().getUTCFullYear();
    expect(screen.getByText(`Tahun laporan. Gunakan format tahun ajaran (${year}/${year + 1}) atau tahun tunggal (${year}).`)).toBeTruthy();
    expect(screen.getByText("PDF, maksimal 20 MB. Wajib diupload.")).toBeTruthy();
    expect(screen.getByRole("group", { name: /File PDF/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pilih file" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload Laporan" })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe("Upload Laporan | Admin Sakola Kembara"));
  });

  test("a PDF is picked, uploaded to the upload API's kind `report`, and its path and size go with the metadata; then the list says 'berhasil diupload'", async () => {
    const user = userEvent.setup();
    const uploads = fakeUploader();
    const { api } = await openForm(["editor", ["konten"]], "/reports/new", {
      [`POST ${LIST}`]: respond({ item: item({ id: "baru", title: "Laporan Baru" }) }, 201),
      [`GET ${LIST}`]: respond(envelope([item({ id: "baru", title: "Laporan Baru" })])),
    });
    await user.type(screen.getByLabelText(/Judul/), "Laporan Baru");
    await user.type(screen.getByLabelText(/Deskripsi/), "Ringkasan");
    await user.selectOptions(screen.getByLabelText(/Kategori/), "financial");
    await user.clear(screen.getByLabelText(/Tahun/));
    await user.type(screen.getByLabelText(/Tahun/), "2025/2026");
    await user.upload(fileInput(), pdfFile());
    await screen.findByRole("link", { name: /laporan-baru\.pdf/ });
    expect(uploads.map((request) => request.kind)).toEqual(["report"]);

    await user.click(screen.getByRole("button", { name: "Upload Laporan" }));
    await waitFor(() => expect(api.count(`POST ${LIST}`)).toBe(1));
    expect(api.last(`POST ${LIST}`)?.body).toEqual({
      title: "Laporan Baru",
      description: "Ringkasan",
      category: "financial",
      year: "2025/2026",
      filePath: "/uploads/report/2026/00000000-0000-4000-8000-0000000000aa-laporan-baru.pdf",
      fileSize: 2048,
    });
    await waitFor(() => expect(location()).toBe("/reports"));
    expect((await screen.findByRole("status")).textContent).toContain("Laporan berhasil diupload.");
    expect(screen.queryByRole("alertdialog")).toBeNull(); // the unsaved guard let the navigation pass
  });

  test("a file that is too big or not a PDF is refused in the browser, with the upload API's own words, and nothing is uploaded", async () => {
    // `applyAccept: false`: a picker would not offer the PNG, but a dropped or renamed file still reaches the input.
    const user = userEvent.setup({ applyAccept: false });
    const uploads = fakeUploader();
    await openForm(["editor", ["konten"]], "/reports/new");
    await user.upload(fileInput(), new File([new Uint8Array(20_000_001)], "besar.pdf", { type: "application/pdf" }));
    expect((await screen.findAllByText("Ukuran file maksimal 20 MB."))[0]).toBeTruthy();
    await user.upload(fileInput(), new File([new Uint8Array(100)], "foto.png", { type: "image/png" }));
    expect((await screen.findAllByText("Tipe file tidak didukung. Gunakan: PDF."))[0]).toBeTruthy();
    expect(uploads).toEqual([]);
  });

  test("no file: the Worker's sentence is shown on the file field and in the summary, which links to it", async () => {
    const user = userEvent.setup();
    await openForm(["editor", ["konten"]], "/reports/new", {
      [`POST ${LIST}`]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { filePath: "File PDF wajib diupload.", fileSize: "File PDF wajib diupload." } }, 400),
    });
    await user.type(screen.getByLabelText(/Judul/), "Laporan Tanpa File");
    await user.click(screen.getByRole("button", { name: "Upload Laporan" }));
    const summary = await screen.findByRole("alert");
    expect(within(summary).getAllByRole("link", { name: "File PDF: File PDF wajib diupload." })).toHaveLength(2);
    expect(within(screen.getByRole("group", { name: /File PDF/ })).getByText("File PDF wajib diupload.")).toBeTruthy();
    await user.click(within(summary).getAllByRole("link", { name: /^File PDF:/ })[0]!);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Pilih file" }));
    expect(location()).toBe("/reports/new");
  });

  test("the Worker's refusal of the metadata is shown on its fields, with the red state", async () => {
    const user = userEvent.setup();
    await openForm(["editor", ["konten"]], "/reports/new", {
      [`POST ${LIST}`]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { year: "Format tahun tidak valid. Contoh: 2025 atau 2025/2026", title: "Judul minimal 3 karakter" } }, 400),
    });
    fakeUploader();
    await user.type(screen.getByLabelText(/Judul/), "ab");
    await user.upload(fileInput(), pdfFile());
    await screen.findByRole("link", { name: /laporan-baru\.pdf/ });
    await user.click(screen.getByRole("button", { name: "Upload Laporan" }));
    const summary = await screen.findByRole("alert");
    expect(within(summary).getByRole("link", { name: "Tahun: Format tahun tidak valid. Contoh: 2025 atau 2025/2026" })).toBeTruthy();
    expect(screen.getByLabelText(/Tahun/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText(/Judul/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText(/Deskripsi/).getAttribute("aria-invalid")).toBeNull();
  });

  test("a viewer is not offered an empty form: the 403 page; an editor of other areas too", async () => {
    for (const who of [["viewer", []], ["editor", ["komunikasi"]]] as Who[]) {
      stubApi({ "GET /api/me": respond(meBody(...who)) });
      const view = renderApp("/reports/new");
      expect(await screen.findByRole("heading", { level: 1, name: "Akses ditolak" })).toBeTruthy();
      expect(screen.queryByRole("form")).toBeNull();
      view.unmount();
    }
  });
});

describe("the form: edit", () => {
  const loaded = item();

  test("the metadata is loaded; the file is shown, not replaceable, with the legacy sentence; saving sends the metadata only, with If-Match", async () => {
    const user = userEvent.setup();
    const { api } = await openForm(["editor", ["konten"]], "/reports/r1/edit", {
      [`GET ${LIST}/r1`]: respond({ item: loaded }),
      [`PUT ${LIST}/r1`]: respond({ item: { ...loaded, title: "Judul baru", updatedAt: "2026-10-02T00:00:00.000Z" } }),
    });
    await waitFor(() => expect((screen.getByLabelText(/Judul/) as HTMLInputElement).value).toBe("Laporan Dampak 2025/2026"));
    expect((screen.getByLabelText(/Deskripsi/) as HTMLTextAreaElement).value).toBe("Ringkasan dampak program.");
    expect((screen.getByLabelText(/Kategori/) as HTMLSelectElement).value).toBe("impact");
    expect((screen.getByLabelText(/Tahun/) as HTMLInputElement).value).toBe("2025/2026");
    expect(screen.getByRole("heading", { level: 1, name: "Edit Metadata" })).toBeTruthy();
    // The file: a link with its size and upload time, and no way to change it.
    expect(screen.getByText("File PDF tidak bisa diganti dari sini. Hapus laporan dan buat baru jika perlu mengganti file.")).toBeTruthy();
    expect(screen.getByRole("link", { name: loaded.filePath }).getAttribute("target")).toBe("_blank");
    expect(screen.getByText(/1\.8 MB · diupload/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pilih file" })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();

    await user.clear(screen.getByLabelText(/Judul/));
    await user.type(screen.getByLabelText(/Judul/), "Judul baru");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    expect((await screen.findByRole("status")).textContent).toContain("Metadata laporan berhasil disimpan.");
    const put = api.last(`PUT ${LIST}/r1`)!;
    expect(put.headers["if-match"]).toBe('"2026-10-01T03:00:00.000Z"');
    expect(put.body).toEqual({ title: "Judul baru", description: "Ringkasan dampak program.", category: "impact", year: "2025/2026" });
    expect(location()).toBe("/reports/r1/edit");
  });

  test("someone saved first (409 stale): the warning, and 'Muat ulang' replaces the form with the newer version", async () => {
    const user = userEvent.setup();
    let served = loaded;
    await openForm(["editor", ["konten"]], "/reports/r1/edit", {
      [`GET ${LIST}/r1`]: () => Promise.resolve(respond({ item: served })),
      [`PUT ${LIST}/r1`]: respond({ error: "stale", message: "Data ini sudah diubah orang lain sejak kamu membukanya. Muat ulang untuk melihat versi terbaru." }, 409),
    });
    await waitFor(() => expect((screen.getByLabelText(/Judul/) as HTMLInputElement).value).toBe("Laporan Dampak 2025/2026"));
    await user.type(screen.getByLabelText(/Judul/), " saya");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    expect((await screen.findByText(/Data ini sudah diubah orang lain/)).textContent).toContain("Perubahan yang belum disimpan akan hilang");
    served = { ...loaded, title: "Judul dari orang lain", updatedAt: "2026-10-05T00:00:00.000Z" };
    await user.click(screen.getByRole("button", { name: "Muat ulang" }));
    await waitFor(() => expect((screen.getByLabelText(/Judul/) as HTMLInputElement).value).toBe("Judul dari orang lain"));
  });

  test("a read-only role sees the values and the file, and can change none of them", async () => {
    await openForm(["viewer", []], "/reports/r1/edit", { [`GET ${LIST}/r1`]: respond({ item: loaded }) });
    await waitFor(() => expect((screen.getByLabelText(/Judul/) as HTMLInputElement).value).toBe("Laporan Dampak 2025/2026"));
    expect(screen.getByLabelText(/Judul/).matches(":disabled")).toBe(true);
    expect(screen.getByLabelText(/Kategori/).matches(":disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Simpan Perubahan" })).toBeNull();
    expect(screen.getByRole("link", { name: loaded.filePath })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tutup" })).toBeTruthy();
  });

  test("a report that is gone: the sentence and a way back", async () => {
    stubApi({ "GET /api/me": respond(meBody("editor", ["konten"])), [`GET ${LIST}/gone`]: respond({ error: "not_found", message: "Data tidak ditemukan. Mungkin sudah dihapus." }, 404) });
    renderApp("/reports/gone/edit");
    expect((await screen.findByRole("alert")).textContent).toBe("Data tidak ditemukan. Mungkin sudah dihapus.");
    expect(screen.getByRole("link", { name: "Kembali ke daftar" }).getAttribute("href")).toBe("/reports");
  });
});

describe("the model", () => {
  test("sizes are written as the legacy page did", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(340 * 1024)).toBe("340 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1_843_200)).toBe("1.8 MB");
  });

  test("the year's kind and the first suggestion", () => {
    expect(yearKind("2025/2026")).toBe("Tahun Ajaran");
    expect(yearKind("2025")).toBe("Tahun");
    expect(defaultYear(new Date(Date.UTC(2026, 9, 12)))).toBe("2026/2027");
  });

  test("a create sends the file, an update never does", () => {
    const values = toValues(item());
    expect(toCreateBody(values)).toMatchObject({ filePath: item().filePath, fileSize: 1_843_200 });
    expect(Object.keys(toUpdateBody(values)).sort()).toEqual(["category", "description", "title", "year"]);
    expect(toCreateBody({ ...toValues(null), fileSize: "" }).fileSize).toBeNull();
  });
});
