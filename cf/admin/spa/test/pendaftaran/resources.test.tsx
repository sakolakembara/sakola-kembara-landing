import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";
import { resetUploadsBase, setUploader, type UploadResult } from "~/lib/crud/upload-client";
import { CATEGORIES, formatBytes, groupByCategory, type ResourceItem, toBody, toValues } from "~/pages/resources/model";
import { deferred, meBody, renderApp, respond, stubApi } from "../helpers";

// The Pusat Dokumen screens (SAKEM-082): the list grouped by the five categories, and the form with its three
// shapes, against stubbed answers in the Worker's shape (test/pendaftaran-spa-contract.test.ts proves the Worker
// answers that shape). What the kit's blocks do by themselves is proved in test/crud/*; this file proves the
// screens are wired the way the legacy ones behaved.

const LIST = "/api/admin/resources";
type Who = Parameters<typeof meBody>;
const editorWho: Who = ["editor", ["pendaftaran"]];
const location = () => screen.getByTestId("location").textContent;

afterEach(() => {
  setUploader(null);
  resetUploadsBase();
});

function item(over: Partial<ResourceItem> = {}): ResourceItem {
  return {
    id: "r1",
    title: "Panduan Pendaftaran",
    description: "Baca dulu sebelum mendaftar.",
    category: "panduan",
    displayOrder: 10,
    contentType: "file",
    filePath: "/uploads/resource/2026/0b8d1f5e-2b6f-4d2a-9d53-9a6f2d3c8f10-panduan.pdf",
    fileSize: 1_258_291,
    externalUrl: null,
    bodyText: null,
    notes: "Dari panitia",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

const CATALOG: ResourceItem[] = [
  item(),
  item({ id: "r2", title: "Surat Izin Orang Tua", description: null, category: "berkas-pendaftaran", displayOrder: 10, filePath: "/uploads/resource/2026/0b8d1f5e-2b6f-4d2a-9d53-9a6f2d3c8f11-izin.pdf", fileSize: 85_000 }),
  item({ id: "r3", title: "Folder Berkas", description: null, category: "berkas-pendaftaran", displayOrder: 20, contentType: "url", filePath: null, fileSize: null, externalUrl: "https://drive.contoh.test/folder" }),
  item({ id: "r4", title: "Caption Instagram", description: null, category: "berkas-marketing", contentType: "text", filePath: null, fileSize: null, bodyText: "Aku daftar!" }),
  item({ id: "r5", title: "Video Token PLN", description: null, category: "lainnya", displayOrder: 5, contentType: "url", filePath: null, fileSize: null, externalUrl: "https://youtube.contoh.test/x" }),
];
const envelope = (items: unknown[], total = items.length) => ({ items, page: 1, pageSize: 100, total });

async function openList(who: Who, routes: Parameters<typeof stubApi>[0] = {}, path = "/resources") {
  const api = stubApi({ "GET /api/me": respond(meBody(...who)), [`GET ${LIST}`]: respond(envelope(CATALOG)), ...routes });
  const view = renderApp(path);
  await screen.findByRole("heading", { level: 1, name: "Pusat Dokumen" });
  await screen.findByRole("link", { name: "Panduan Pendaftaran" });
  return { api, ...view };
}

describe("the list: grouped by the five categories of the public page", () => {
  test("a section per category that has documents, in the page's order, each with its heading and count", async () => {
    await openList(["viewer", []]);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    // Order of the CATEGORIES, not the alphabet and not the order of the answer; "Tutorial" has nothing and is left out.
    expect(headings).toEqual(["Panduan Pendaftaran", "Berkas Pendaftaran", "Berkas Marketing", "Lainnya"]);
    const section = screen.getByRole("region", { name: "Berkas Pendaftaran" });
    expect(within(section).getByText("2 berkas")).toBeTruthy();
    expect(within(section).getByRole("table", { name: /Daftar berkas: Berkas Pendaftaran/ })).toBeTruthy();
  });

  test("the rows of a section keep the order the Worker gave (the manual order)", async () => {
    await openList(["viewer", []]);
    const section = screen.getByRole("region", { name: "Berkas Pendaftaran" });
    const titles = within(section).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0]!.textContent);
    expect(titles[0]).toContain("Surat Izin Orang Tua");
    expect(titles[1]).toContain("Folder Berkas");
  });

  test("the legacy columns (without the category: it is the heading), the type with its size, the order, a description under the title", async () => {
    await openList(["viewer", []]);
    const section = screen.getByRole("region", { name: "Panduan Pendaftaran" });
    expect(within(section).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Judul", "Tipe", "Urutan", "Diubah", "Aksi"]);
    expect(within(section).getByText("Baca dulu sebelum mendaftar.")).toBeTruthy();
    expect(within(section).getByText("File · 1.2 MB")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Berkas Marketing" })).getByText("Teks")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Lainnya" })).getByText("Link")).toBeTruthy();
  });

  test("it asks for the page's order and the whole catalog at once", async () => {
    const { api } = await openList(["viewer", []]);
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=100&sort=category`);
  });

  test("a document is opened from its own link: an upload from the files domain, a link as it is, a text has none", async () => {
    await openList(["viewer", []], { "GET /api/config": respond({ google: false, turnstileSiteKey: null, uploadsBaseUrl: "https://files.contoh.test" }) });
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Buka Panduan Pendaftaran" }).getAttribute("href")).toBe(
        "https://files.contoh.test/uploads/resource/2026/0b8d1f5e-2b6f-4d2a-9d53-9a6f2d3c8f10-panduan.pdf",
      ),
    );
    expect(screen.getByRole("link", { name: "Buka Folder Berkas" }).getAttribute("href")).toBe("https://drive.contoh.test/folder");
    expect(screen.getByRole("link", { name: "Buka Folder Berkas" }).getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.queryByRole("link", { name: "Buka Caption Instagram" })).toBeNull();
  });

  test("the page's description links to the public page", async () => {
    await openList(["viewer", []]);
    expect(screen.getByRole("link", { name: "/gabung-siswa/docs" }).getAttribute("href")).toBe("/gabung-siswa/docs");
  });
});

describe("the list: who sees what", () => {
  // Negative test (scripts/negative-checks-spa-pendaftaran.mjs): offer the write buttons to a role that cannot write.
  test("a viewer reads the list and is offered nothing to change: no 'Tambah Berkas', no Edit, no Hapus, 'Detail' instead", async () => {
    await openList(["viewer", []]);
    expect(screen.queryByRole("link", { name: /Tambah Berkas/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Hapus/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Edit/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Lihat Panduan Pendaftaran" }).getAttribute("href")).toBe("/resources/r1/edit");
  });

  test("an editor of Pendaftaran, and super_admin, get 'Tambah Berkas' and Edit and Hapus on every row", async () => {
    for (const who of [editorWho, ["super_admin", []]] as Who[]) {
      const view = await openList(who);
      expect(screen.getByRole("link", { name: /Tambah Berkas/ }).getAttribute("href")).toBe("/resources/new");
      expect(screen.getAllByRole("link", { name: /^Edit / })).toHaveLength(CATALOG.length);
      expect(screen.getAllByRole("button", { name: /^Hapus / })).toHaveLength(CATALOG.length);
      view.unmount();
    }
  });

  test("an editor of other areas opens the 403 page and the list is never asked for", async () => {
    const api = stubApi({ "GET /api/me": respond(meBody("editor", ["konten", "komunikasi"])), [`GET ${LIST}`]: respond(envelope(CATALOG)) });
    renderApp("/resources");
    expect(await screen.findByRole("heading", { level: 1, name: "Akses ditolak" })).toBeTruthy();
    expect(api.count(`GET ${LIST}`)).toBe(0);
  });

  test("the empty list: the legacy sentence for someone who can add, a plain one for someone who cannot", async () => {
    stubApi({ "GET /api/me": respond(meBody(...editorWho)), [`GET ${LIST}`]: respond(envelope([])) });
    const view = renderApp("/resources");
    expect(await screen.findByText('Belum ada berkas. Klik "Tambah Berkas" untuk membuat entry pertama.')).toBeTruthy();
    view.unmount();
    stubApi({ "GET /api/me": respond(meBody("viewer")), [`GET ${LIST}`]: respond(envelope([])) });
    renderApp("/resources");
    expect(await screen.findByText("Belum ada berkas.")).toBeTruthy();
  });

  test("a list that fails to load says so, with 'Coba lagi', which asks again", async () => {
    const user = userEvent.setup();
    let fail = true;
    stubApi({ "GET /api/me": respond(meBody("viewer")), [`GET ${LIST}`]: () => Promise.resolve(fail ? respond({ error: "internal" }, 500) : respond(envelope(CATALOG))) });
    renderApp("/resources");
    expect((await screen.findByRole("alert")).textContent).toBe("Terjadi kesalahan di server. Coba lagi sebentar lagi.");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    await screen.findByRole("link", { name: "Panduan Pendaftaran" });
  });
});

describe("the list: filters live in the address", () => {
  test("category, type and search ask the Worker with the names it expects", async () => {
    const user = userEvent.setup();
    const { api } = await openList(["viewer", []]);
    await user.type(screen.getByLabelText("Cari"), "panduan");
    await user.selectOptions(screen.getByLabelText("Kategori"), "panduan");
    await user.selectOptions(screen.getByLabelText("Tipe"), "file");
    await user.click(screen.getByRole("button", { name: "Terapkan" }));
    await waitFor(() => expect(location()).toBe("/resources?q=panduan&category=panduan&contentType=file"));
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=100&q=panduan&category=panduan&contentType=file&sort=category`));
  });

  test("nothing matches: a sentence that says so, not 'Belum ada berkas'", async () => {
    stubApi({ "GET /api/me": respond(meBody(...editorWho)), [`GET ${LIST}`]: respond(envelope([])) });
    renderApp("/resources?q=zzz");
    expect(await screen.findByText("Tidak ada berkas yang cocok dengan filter.")).toBeTruthy();
  });
});

describe("the list: delete", () => {
  async function ask(user: ReturnType<typeof userEvent.setup>, routes: Parameters<typeof stubApi>[0] = {}) {
    const view = await openList(editorWho, routes);
    await user.click(screen.getByRole("button", { name: "Hapus Panduan Pendaftaran" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Hapus berkas?" });
    return { ...view, dialog };
  }

  test("a question that names the document and the file that goes with it, with the safe button focused", async () => {
    const user = userEvent.setup();
    const { dialog, api } = await ask(user);
    expect(dialog.textContent).toContain("Berkas “Panduan Pendaftaran” akan dihapus. Tindakan ini tidak bisa dibatalkan. File uploadnya juga akan dihapus.");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Batal" }));
    expect(api.calls.filter((call) => call.method === "DELETE")).toEqual([]);
  });

  test("confirming sends DELETE with the version of the row, once however often it is pressed, then the legacy notice and a fresh list", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const { dialog, api } = await ask(user, { [`DELETE ${LIST}/r1`]: () => gate.promise });
    const confirm = within(dialog).getByRole("button", { name: "Hapus" });
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(api.count(`DELETE ${LIST}/r1`)).toBe(1);
    expect(api.last(`DELETE ${LIST}/r1`)?.headers["if-match"]).toBe('"2026-10-01T00:00:00.000Z"');
    await act(async () => gate.resolve(respond(null, 204)));
    expect((await screen.findByRole("status", { name: "" })).textContent).toContain("Berkas berhasil dihapus.");
    expect(api.count(`GET ${LIST}`)).toBe(2);
  });
});

describe("the model", () => {
  test("the five categories, in the page's order, and a page grouped by them", () => {
    expect([...CATEGORIES]).toEqual(["panduan", "berkas-pendaftaran", "berkas-marketing", "tutorial", "lainnya"]);
    expect(groupByCategory(CATALOG).map((group) => [group.category, group.items.map((entry) => entry.id)])).toEqual([
      ["panduan", ["r1"]],
      ["berkas-pendaftaran", ["r2", "r3"]],
      ["berkas-marketing", ["r4"]],
      ["lainnya", ["r5"]],
    ]);
    expect(groupByCategory([])).toEqual([]);
  });

  test("sizes read like the legacy ones", () => {
    expect([formatBytes(512), formatBytes(2048), formatBytes(1_258_291)]).toEqual(["512 B", "2 KB", "1.2 MB"]);
  });

  test("the form starts where the legacy one did, and the body keeps every shape's fields", () => {
    expect(toValues(null)).toMatchObject({ category: "berkas-pendaftaran", displayOrder: "100", contentType: "file", filePath: "", fileSize: "" });
    expect(toBody({ ...toValues(null), title: "T", displayOrder: "7", filePath: "/uploads/resource/x", fileSize: "123" })).toMatchObject({ displayOrder: 7, filePath: "/uploads/resource/x", fileSize: 123, contentType: "file" });
    expect(toBody({ ...toValues(null), displayOrder: " ", filePath: "" }).displayOrder).toBe("");
    expect(toBody({ ...toValues(null), filePath: "" })).toMatchObject({ filePath: null, fileSize: null });
  });
});

// ---------------------------------------------------------------------------------- the form

async function openForm(who: Who, path: string, routes: Parameters<typeof stubApi>[0] = {}) {
  const api = stubApi({ "GET /api/me": respond(meBody(...who)), ...routes });
  const view = renderApp(path);
  await screen.findByRole("form");
  return { api, ...view };
}

const RESULT: UploadResult = { id: "11111111-2222-4333-8444-555555555555", path: "/uploads/resource/2026/11111111-2222-4333-8444-555555555555-panduan.pdf", contentType: "application/pdf", size: 4321, width: null, height: null };
const pdfFile = () => new File([new Uint8Array(4321)], "panduan.pdf", { type: "application/pdf" });
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

describe("the form: create", () => {
  test("the legacy sections, fields and hints; a file is the first type and its field says what is accepted", async () => {
    await openForm(editorWho, "/resources/new");
    expect(screen.getByRole("heading", { level: 1, name: "Berkas Baru" })).toBeTruthy();
    for (const name of ["Metadata", "Tipe Konten", "File", "Catatan Internal"]) expect(screen.getByRole("heading", { level: 2, name }), name).toBeTruthy();
    expect(screen.getByLabelText(/Judul/).getAttribute("placeholder")).toBe("Contoh: Panduan Pendaftaran Sakola Kembara Gen 6");
    expect(screen.getByText("Muncul di bawah judul di /gabung-siswa/docs. Boleh dikosongkan.")).toBeTruthy();
    expect((screen.getByLabelText(/Kategori/) as HTMLSelectElement).value).toBe("berkas-pendaftaran");
    expect(within(screen.getByLabelText(/Kategori/)).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Panduan Pendaftaran", "Berkas Pendaftaran", "Berkas Marketing", "Tutorial", "Lainnya",
    ]);
    expect((screen.getByLabelText(/Urutan Tampil/) as HTMLInputElement).value).toBe("100");
    expect(screen.getByText("Lebih kecil = lebih dulu di dalam kategori.")).toBeTruthy();
    const types = screen.getByRole("group", { name: /Tipe konten/ });
    expect(within(types).getAllByRole("radio").map((radio) => (radio as HTMLInputElement).value)).toEqual(["file", "url", "text"]);
    expect((within(types).getByRole("radio", { name: /^File/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("PDF, PNG, JPEG, atau WebP. Maksimal 25 MB.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pilih file" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Buat Berkas" })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe("Berkas Baru | Admin Sakola Kembara"));
  });

  test("only the fields of the chosen type are on the page, and what was typed for another type is kept until the save", async () => {
    const user = userEvent.setup();
    await openForm(editorWho, "/resources/new");
    const types = screen.getByRole("group", { name: /Tipe konten/ });

    await user.click(within(types).getByRole("radio", { name: /Link Eksternal/ }));
    expect(screen.queryByRole("button", { name: "Pilih file" })).toBeNull();
    expect(screen.getByLabelText(/^URL/).getAttribute("type")).toBe("url");
    await user.type(screen.getByLabelText(/^URL/), "https://drive.contoh.test/x");

    await user.click(within(types).getByRole("radio", { name: /^Teks/ }));
    expect(screen.queryByLabelText(/^URL/)).toBeNull();
    expect(screen.getByRole("textbox", { name: /^Teks/ })).toBeTruthy();
    expect(screen.getByText("Muncul di /gabung-siswa/docs dalam blok kode dengan tombol Salin.")).toBeTruthy();

    await user.click(within(types).getByRole("radio", { name: /Link Eksternal/ }));
    expect((screen.getByLabelText(/^URL/) as HTMLInputElement).value).toBe("https://drive.contoh.test/x");
  });

  test("a text: the body, once however often it is pressed, then the list with 'Berkas berhasil dibuat.'", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const { api } = await openForm(editorWho, "/resources/new", { [`POST ${LIST}`]: () => gate.promise, [`GET ${LIST}`]: respond(envelope([item({ id: "new-id", title: "Caption" })])) });
    await user.type(screen.getByLabelText(/Judul/), "Caption");
    await user.selectOptions(screen.getByLabelText(/Kategori/), "berkas-marketing");
    await user.click(within(screen.getByRole("group", { name: /Tipe konten/ })).getByRole("radio", { name: /^Teks/ }));
    await user.type(screen.getByRole("textbox", { name: /^Teks/ }), "Aku daftar!");
    const save = screen.getByRole("button", { name: "Buat Berkas" });
    await act(async () => {
      save.click();
      save.click();
    });
    expect(api.count(`POST ${LIST}`)).toBe(1);
    expect(api.last(`POST ${LIST}`)?.body).toEqual({
      title: "Caption", description: "", category: "berkas-marketing", displayOrder: 100, contentType: "text", filePath: null, fileSize: null, externalUrl: "", bodyText: "Aku daftar!", notes: "",
    });
    await act(async () => gate.resolve(respond({ item: item({ id: "new-id", title: "Caption" }) }, 201)));
    await waitFor(() => expect(location()).toBe("/resources"));
    expect((await screen.findByRole("status", { name: "" })).textContent).toContain("Berkas berhasil dibuat.");
    expect(screen.queryByRole("alertdialog")).toBeNull(); // the unsaved guard let the navigation pass
  });

  test("a file: picking it uploads it at once, the form keeps its path and size, and the save sends them", async () => {
    const user = userEvent.setup();
    setUploader(async () => ({ ok: true, result: RESULT }));
    const { api } = await openForm(editorWho, "/resources/new", { [`POST ${LIST}`]: respond({ item: item({ id: "new-id" }) }, 201), [`GET ${LIST}`]: respond(envelope([])) });
    await user.type(screen.getByLabelText(/Judul/), "Panduan 2027");
    await user.upload(fileInput(), pdfFile());
    expect(await screen.findByText("panduan.pdf")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Buat Berkas" }));
    await waitFor(() => expect(api.count(`POST ${LIST}`)).toBe(1));
    expect(api.last(`POST ${LIST}`)?.body).toMatchObject({ contentType: "file", filePath: RESULT.path, fileSize: 4321, title: "Panduan 2027" });
  });

  test("a file the browser refuses (Word) is refused before anything is sent, in the Worker's own words", async () => {
    // The file picker would not even offer a .docx; here it is handed over anyway, as a drag and drop could.
    const user = userEvent.setup({ applyAccept: false });
    let sent = 0;
    setUploader(async () => {
      sent += 1;
      return { ok: true, result: RESULT };
    });
    await openForm(editorWho, "/resources/new");
    const word = new File([new Uint8Array(100)], "templat.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    await user.upload(fileInput(), word);
    // Once as the field's error, once in the line a screen reader is read.
    expect((await screen.findAllByText(/Tipe file tidak didukung\. Gunakan: /)).length).toBeGreaterThan(0);
    expect(sent).toBe(0);
  });

  test("a refused form: each field says it, the summary links to it with the legacy label", async () => {
    const user = userEvent.setup();
    await openForm(editorWho, "/resources/new", {
      [`POST ${LIST}`]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { title: "Judul minimal 2 karakter", filePath: "File wajib diupload." } }, 400),
    });
    await user.type(screen.getByLabelText(/Judul/), "a");
    await user.click(screen.getByRole("button", { name: "Buat Berkas" }));
    const summary = await screen.findByRole("alert");
    expect(within(summary).getByRole("link", { name: "Judul: Judul minimal 2 karakter" })).toBeTruthy();
    expect(within(summary).getByRole("link", { name: "File: File wajib diupload." })).toBeTruthy();
    expect(screen.getByLabelText(/Judul/).getAttribute("aria-invalid")).toBe("true");
    expect(location()).toBe("/resources/new");
  });

  test("a link and a URL the Worker refuses: the sentence lands on the URL field", async () => {
    const user = userEvent.setup();
    await openForm(editorWho, "/resources/new", {
      [`POST ${LIST}`]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { externalUrl: "Format URL tidak valid" } }, 400),
    });
    await user.type(screen.getByLabelText(/Judul/), "Video");
    await user.click(within(screen.getByRole("group", { name: /Tipe konten/ })).getByRole("radio", { name: /Link Eksternal/ }));
    await user.type(screen.getByLabelText(/^URL/), "https://contoh.test/x");
    await user.click(screen.getByRole("button", { name: "Buat Berkas" }));
    expect(await screen.findByRole("link", { name: "URL: Format URL tidak valid" })).toBeTruthy();
    expect(screen.getByLabelText(/^URL/).getAttribute("aria-invalid")).toBe("true");
  });

  test("a viewer opening the form gets it read-only: disabled fields, no save, no way to pick a file", async () => {
    await openForm(["viewer", []], "/resources/new");
    expect(screen.queryByRole("button", { name: "Buat Berkas" })).toBeNull();
    expect(screen.getByLabelText(/Judul/).matches(":disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Pilih file" })).toBeNull();
    expect(screen.getByText(/Kamu hanya bisa melihat data ini/)).toBeTruthy();
  });
});

describe("the form: edit", () => {
  const loaded = item({ id: "r1" });

  test("the document is loaded into the fields, a file shows its name, and saving sends If-Match and stays with the legacy notice", async () => {
    const user = userEvent.setup();
    const { api } = await openForm(editorWho, "/resources/r1/edit", {
      [`GET ${LIST}/r1`]: respond({ item: loaded }),
      [`PUT ${LIST}/r1`]: respond({ item: { ...loaded, title: "Panduan baru", updatedAt: "2026-10-02T00:00:00.000Z" } }),
    });
    await waitFor(() => expect((screen.getByLabelText(/Judul/) as HTMLInputElement).value).toBe("Panduan Pendaftaran"));
    expect((screen.getByLabelText(/Deskripsi/) as HTMLTextAreaElement).value).toBe("Baca dulu sebelum mendaftar.");
    expect((screen.getByLabelText(/Kategori/) as HTMLSelectElement).value).toBe("panduan");
    expect((screen.getByLabelText(/Urutan Tampil/) as HTMLInputElement).value).toBe("10");
    expect((screen.getByLabelText(/Catatan/) as HTMLInputElement).value).toBe("Dari panitia");
    expect(screen.getByRole("link", { name: "panduan.pdf" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ganti" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Edit Berkas" })).toBeTruthy();

    await user.clear(screen.getByLabelText(/Judul/));
    await user.type(screen.getByLabelText(/Judul/), "Panduan baru");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    expect(await screen.findByText("Perubahan tersimpan.")).toBeTruthy();
    const put = api.last(`PUT ${LIST}/r1`)!;
    expect(put.headers["if-match"]).toBe('"2026-10-01T00:00:00.000Z"');
    // The stored file travels as it is: the same path and the size it already had.
    expect(put.body).toMatchObject({ title: "Panduan baru", contentType: "file", filePath: loaded.filePath, fileSize: loaded.fileSize, category: "panduan", displayOrder: 10 });
    expect(location()).toBe("/resources/r1/edit");
  });

  test("replacing the file sends the new path and size", async () => {
    const user = userEvent.setup();
    setUploader(async () => ({ ok: true, result: RESULT }));
    const { api } = await openForm(editorWho, "/resources/r1/edit", {
      [`GET ${LIST}/r1`]: respond({ item: loaded }),
      [`PUT ${LIST}/r1`]: respond({ item: { ...loaded, filePath: RESULT.path, updatedAt: "2026-10-02T00:00:00.000Z" } }),
    });
    await waitFor(() => expect((screen.getByLabelText(/Judul/) as HTMLInputElement).value).toBe("Panduan Pendaftaran"));
    await user.upload(fileInput(), pdfFile());
    expect(await screen.findByText("panduan.pdf")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(api.count(`PUT ${LIST}/r1`)).toBe(1));
    expect(api.last(`PUT ${LIST}/r1`)?.body).toMatchObject({ filePath: RESULT.path, fileSize: 4321 });
  });

  test("someone saved first (409 stale): the warning, and 'Muat ulang' replaces the form with the newer version", async () => {
    const user = userEvent.setup();
    let served = loaded;
    const { api } = await openForm(editorWho, "/resources/r1/edit", {
      [`GET ${LIST}/r1`]: () => Promise.resolve(respond({ item: served })),
      [`PUT ${LIST}/r1`]: respond({ error: "stale", message: "Data ini sudah diubah orang lain sejak kamu membukanya." }, 409),
    });
    await waitFor(() => expect((screen.getByLabelText(/Judul/) as HTMLInputElement).value).toBe("Panduan Pendaftaran"));
    await user.type(screen.getByLabelText(/Judul/), " saya");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    expect((await screen.findByText(/Data ini sudah diubah orang lain/)).textContent).toContain("Perubahan yang belum disimpan akan hilang");
    served = { ...loaded, title: "Judul dari orang lain", updatedAt: "2026-10-05T00:00:00.000Z" };
    await user.click(screen.getByRole("button", { name: "Muat ulang" }));
    await waitFor(() => expect((screen.getByLabelText(/Judul/) as HTMLInputElement).value).toBe("Judul dari orang lain"));
    expect(api.count(`GET ${LIST}/r1`)).toBe(2);
  });

  test("a read-only role sees the values and can change none of them", async () => {
    await openForm(["viewer", []], "/resources/r1/edit", { [`GET ${LIST}/r1`]: respond({ item: loaded }) });
    await waitFor(() => expect((screen.getByLabelText(/Judul/) as HTMLInputElement).value).toBe("Panduan Pendaftaran"));
    expect(screen.getByLabelText(/Judul/).matches(":disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Simpan Perubahan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ganti" })).toBeNull();
    expect(screen.getByRole("link", { name: "Tutup" })).toBeTruthy();
  });

  test("a document that is gone: the sentence and a way back", async () => {
    stubApi({ "GET /api/me": respond(meBody(...editorWho)), [`GET ${LIST}/gone`]: respond({ error: "not_found", message: "Data tidak ditemukan. Mungkin sudah dihapus." }, 404) });
    renderApp("/resources/gone/edit");
    expect((await screen.findByRole("alert")).textContent).toBe("Data tidak ditemukan. Mungkin sudah dihapus.");
    expect(screen.getByRole("link", { name: "Kembali ke daftar" }).getAttribute("href")).toBe("/resources");
  });
});
