import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { MediaItem } from "~/lib/crud/media";
import { resetUploadsBase, setUploader, type UploadRequest } from "~/lib/crud/upload-client";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

// The media picker (SAKEM-117) as the file fields of Tim and Laporan open it: "Pilih dari media" beside the field's own upload,
// a dialog with the library of that field's kind and an "Unggah" tab. What the editor does with it is in blog-editor.test.tsx.

const LIST = "/api/admin/uploads";
const WRITER: Parameters<typeof meBody> = ["editor", ["konten"]];

const photo = (id: string, change: Partial<MediaItem> = {}): MediaItem => ({
  id,
  path: `/uploads/team-photo/2026/0a1b2c3d-1111-4222-8333-44445555${id.padStart(4, "0")}-${id}.webp`,
  name: `${id}.webp`,
  kind: "team-photo",
  contentType: "image/webp",
  size: 120_000,
  width: 800,
  height: 800,
  altText: null,
  uploadedByName: "Dewi Pengurus",
  createdAt: "2026-10-12T03:00:00.000Z",
  ...change,
});
const BUDI = photo("0001", { name: "foto-budi.webp", altText: "Budi tersenyum" });
const SARI = photo("0002", { name: "foto-sari.webp" });
const LAPORAN: MediaItem = photo("0003", { path: "/uploads/report/2026/0a1b2c3d-1111-4222-8333-444455550003-laporan-2025.pdf", name: "laporan-2025.pdf", kind: "report", contentType: "application/pdf", size: 2_400_000, width: null, height: null });

const listing = (items: MediaItem[], extra: Record<string, unknown> = {}) => ({ items, page: 1, pageSize: 20, total: items.length, totalPages: 1, ...extra });

async function openForm(path: string, routes: Parameters<typeof stubApi>[0] = {}, who: Parameters<typeof meBody> = WRITER) {
  const api = stubApi({ "GET /api/me": respond(meBody(...who)), "GET /api/config": respond({ uploadsBaseUrl: "" }), [`GET ${LIST}`]: respond(listing([BUDI, SARI])), ...routes });
  renderApp(path);
  await screen.findByRole("form");
  return { api, user: userEvent.setup() };
}
const openPicker = async (user: ReturnType<typeof userEvent.setup>, field: string) => {
  const group = screen.getByRole("group", { name: new RegExp(field) });
  await user.click(within(group).getByRole("button", { name: "Pilih dari media" }));
  return screen.findByRole("dialog");
};

beforeEach(() => resetUploadsBase());
afterEach(() => setUploader(null));

describe("the button and the dialog", () => {
  test("'Pilih dari media' is the first button of the field, before its own upload; the dialog is named for what is chosen and for the field", async () => {
    const { api, user } = await openForm("/team/new");
    const group = screen.getByRole("group", { name: /Foto anggota/ });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual(["Pilih dari media", "Pilih file"]);
    expect(api.count(`GET ${LIST}`)).toBe(0); // nothing is loaded until someone asks
    const dialog = await openPicker(user, "Foto anggota");
    expect(within(dialog).getByRole("heading", { name: "Pilih gambar" })).toBeTruthy();
    expect(within(dialog).getByText("Untuk Foto anggota.")).toBeTruthy();
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
  });

  test("it is drawn outside the form that holds the field, so nothing in it belongs to that form; Enter in the search is the page's, never the form's", async () => {
    const { user } = await openForm("/team/new");
    const dialog = await openPicker(user, "Foto anggota");
    expect(dialog.closest("form")).toBeNull();
    expect(dialog.parentElement).toBe(document.body);
    // `fireEvent` answers false when the page took the key (prevented the browser's own answer: a submit).
    expect(fireEvent.keyDown(within(dialog).getByRole("searchbox"), { key: "Enter" })).toBe(false);
  });

  test("it lists the files of the field's kind only, 20 at a time, without a type or a date choice (a photo field takes pictures)", async () => {
    const { api, user } = await openForm("/team/new");
    const dialog = await openPicker(user, "Foto anggota");
    await within(dialog).findByRole("button", { name: "foto-budi.webp" });
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?kind=team-photo&pageSize=20`);
    expect(within(dialog).queryByRole("combobox")).toBeNull();
    expect(within(dialog).getByRole("tab", { name: "Pustaka media", selected: true })).toBeTruthy();
    expect(within(dialog).getByText("Belum ada gambar yang dipilih")).toBeTruthy();
  });

  test("a field that takes pictures and PDFs (Pusat Dokumen) can narrow the library to one of them", async () => {
    const { api, user } = await openForm("/resources/new", {}, ["editor", ["pendaftaran"]]); // a file is the first type of a new item
    const dialog = await openPicker(user, "File");
    expect(api.last(`GET ${LIST}`)?.url).toContain("kind=resource");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Jenis file" }), "pdf");
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?kind=resource&type=pdf&pageSize=20`));
  });

  test("the search is asked for after a pause, from page one; Enter in it asks at once and does not save the form that holds the field", async () => {
    const { api, user } = await openForm("/team/new");
    const dialog = await openPicker(user, "Foto anggota");
    await within(dialog).findByRole("button", { name: "foto-budi.webp" });
    await user.type(within(dialog).getByRole("searchbox"), "budi{Enter}");
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?kind=team-photo&q=budi&pageSize=20`);
    expect(api.count("POST /api/admin/team")).toBe(0);
  });

  test("nothing in the library, and nothing found, say different things", async () => {
    const { user } = await openForm("/team/new", { [`GET ${LIST}`]: (call) => respond(listing([], call.url.includes("q=") ? {} : {})) });
    const dialog = await openPicker(user, "Foto anggota");
    expect(await within(dialog).findByText("Belum ada gambar di pustaka. Buka tab Unggah untuk menambah.")).toBeTruthy();
    await user.type(within(dialog).getByRole("searchbox"), "zzz");
    expect(await within(dialog).findByText("Tidak ada gambar yang cocok.")).toBeTruthy();
  });

  test("a failed load says why, and 'Coba lagi' asks again", async () => {
    let failing = true;
    const { api, user } = await openForm("/team/new", { [`GET ${LIST}`]: () => (failing ? respond({ error: "server_error" }, 500) : respond(listing([BUDI]))) });
    const dialog = await openPicker(user, "Foto anggota");
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Terjadi kesalahan di server");
    failing = false;
    await user.click(within(dialog).getByRole("button", { name: "Coba lagi" }));
    expect(await within(dialog).findByRole("button", { name: "foto-budi.webp" })).toBeTruthy();
    expect(api.count(`GET ${LIST}`)).toBe(2);
  });

  test("more than a page: 'Halaman 1 dari 3', and the next page is asked for", async () => {
    const { api, user } = await openForm("/team/new", { [`GET ${LIST}`]: respond(listing([BUDI], { total: 45, totalPages: 3 })) });
    const dialog = await openPicker(user, "Foto anggota");
    expect(await within(dialog).findByText("Halaman 1 dari 3")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Sebelumnya" }).hasAttribute("disabled")).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Berikutnya" }));
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?kind=team-photo&page=2&pageSize=20`));
    expect(await within(dialog).findByText("Halaman 2 dari 3")).toBeTruthy();
  });
});

describe("choosing", () => {
  test("a file chosen is the field's value, drawn from its path; the dialog closes and gives the focus back to its button", async () => {
    const { user } = await openForm("/team/new");
    const dialog = await openPicker(user, "Foto anggota");
    await user.click(await within(dialog).findByRole("button", { name: "foto-budi.webp" }));
    expect(within(dialog).getByText("WebP · 800 × 800 · 120 KB")).toBeTruthy();
    expect((within(dialog).getByLabelText("Teks alternatif") as HTMLTextAreaElement).value).toBe("Budi tersenyum");
    await user.click(within(dialog).getByRole("button", { name: "Pakai gambar ini" }));
    const group = screen.getByRole("group", { name: /Foto anggota/ });
    await waitFor(() => expect(within(group).getByRole("img", { name: "Pratinjau Foto anggota" }).getAttribute("src")).toBe(BUDI.path));
    expect(within(group).getByRole("button", { name: "Ganti" })).toBeTruthy();
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(within(group).getByRole("button", { name: "Pilih dari media" }));
    expect((await within(group).findByText(/foto-budi\.webp dipilih/)).getAttribute("role")).toBe("status");
  });

  test("a file from the library is not an upload of this form: emptying the field or replacing it never deletes it", async () => {
    const { api, user } = await openForm("/team/new", { [`DELETE ${LIST}/0001`]: respond(null, 204) });
    const dialog = await openPicker(user, "Foto anggota");
    await user.click(await within(dialog).findByRole("button", { name: "foto-budi.webp" }));
    await user.click(within(dialog).getByRole("button", { name: "Pakai gambar ini" }));
    const group = screen.getByRole("group", { name: /Foto anggota/ });
    await user.click(await within(group).findByRole("button", { name: "Hapus" }));
    expect(api.calls.filter((call) => call.method === "DELETE")).toEqual([]);
  });

  test("a file uploaded in this form and then replaced by one from the library is discarded, as when replaced by another upload", async () => {
    const uploaded = { id: "own-1", path: "/uploads/team-photo/2026/0a1b2c3d-1111-4222-8333-444455559999-baru.png", contentType: "image/png", size: 100, width: 8, height: 8 };
    setUploader(async () => ({ ok: true as const, result: uploaded }));
    const { api, user } = await openForm("/team/new", { [`DELETE ${LIST}/own-1`]: respond(null, 204) });
    await user.upload(document.querySelector<HTMLInputElement>("form input[type='file']")!, new File([new Uint8Array(100)], "baru.png", { type: "image/png" }));
    const group = screen.getByRole("group", { name: /Foto anggota/ });
    await within(group).findByRole("button", { name: "Ganti" });
    const dialog = await openPicker(user, "Foto anggota");
    await user.click(await within(dialog).findByRole("button", { name: "foto-sari.webp" }));
    await user.click(within(dialog).getByRole("button", { name: "Pakai gambar ini" }));
    await waitFor(() => expect(api.count(`DELETE ${LIST}/own-1`)).toBe(1));
  });

  test("choosing the file that is already the field's value does not discard it", async () => {
    const uploaded = { id: "own-1", path: BUDI.path, contentType: "image/webp", size: 100, width: 8, height: 8 };
    setUploader(async () => ({ ok: true as const, result: uploaded }));
    const { api, user } = await openForm("/team/new", { [`GET ${LIST}`]: respond(listing([{ ...BUDI, id: "own-1" }])), [`DELETE ${LIST}/own-1`]: respond(null, 204) });
    await user.upload(document.querySelector<HTMLInputElement>("form input[type='file']")!, new File([new Uint8Array(100)], "foto-budi.png", { type: "image/png" }));
    const group = screen.getByRole("group", { name: /Foto anggota/ });
    await within(group).findByRole("button", { name: "Ganti" });
    const dialog = await openPicker(user, "Foto anggota");
    await user.click(await within(dialog).findByRole("button", { name: "foto-budi.webp" }));
    await user.click(within(dialog).getByRole("button", { name: "Pakai gambar ini" }));
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    expect(api.calls.filter((call) => call.method === "DELETE")).toEqual([]);
  });

  test("a PDF chosen for a report brings its size with it, so the form saves it as an upload would", async () => {
    const { api, user } = await openForm("/reports/new", {
      [`GET ${LIST}`]: respond(listing([LAPORAN])),
      "POST /api/admin/reports": respond({ item: { id: "r1" } }, 201),
      "GET /api/admin/reports": respond({ items: [], page: 1, pageSize: 100, total: 0 }),
    });
    await user.type(screen.getByLabelText(/Judul/), "Laporan Dampak 2025");
    const dialog = await openPicker(user, "File PDF");
    expect(within(dialog).getByRole("heading", { name: "Pilih file" })).toBeTruthy();
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?kind=report&pageSize=20`);
    await user.click(await within(dialog).findByRole("button", { name: "laporan-2025.pdf" }));
    expect(within(dialog).queryByLabelText("Teks alternatif")).toBeNull(); // a PDF has none
    await user.click(within(dialog).getByRole("button", { name: "Pakai file ini" }));
    await user.click(screen.getByRole("button", { name: "Upload Laporan" }));
    await waitFor(() => expect(api.count("POST /api/admin/reports")).toBe(1));
    expect(api.last("POST /api/admin/reports")?.body).toMatchObject({ filePath: LAPORAN.path, fileSize: 2_400_000 });
    expect(api.count(`PATCH ${LIST}/0003`)).toBe(0);
  });

  test("a text alternative changed here is saved to the file before it is used; one the Worker refuses keeps the dialog open", async () => {
    const { api, user } = await openForm("/team/new", {
      [`PATCH ${LIST}/0002`]: (call) => (String(call.body?.altText).length > 5 ? respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { altText: "Teks alternatif maksimal 300 karakter." } }, 400) : respond({ item: { ...SARI, altText: "Sari" } })),
    });
    const dialog = await openPicker(user, "Foto anggota");
    await user.click(await within(dialog).findByRole("button", { name: "foto-sari.webp" }));
    await user.type(within(dialog).getByLabelText("Teks alternatif"), "Sari panjang");
    await user.click(within(dialog).getByRole("button", { name: "Pakai gambar ini" }));
    expect(await within(dialog).findByText("Teks alternatif maksimal 300 karakter.")).toBeTruthy();
    expect(dialog.hasAttribute("open")).toBe(true);
    await user.clear(within(dialog).getByLabelText("Teks alternatif"));
    await user.type(within(dialog).getByLabelText("Teks alternatif"), "Sari");
    await user.click(within(dialog).getByRole("button", { name: "Pakai gambar ini" }));
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    expect(api.last(`PATCH ${LIST}/0002`)?.body).toEqual({ altText: "Sari" });
  });
});

describe("a text alternative that is being saved", () => {
  test("keeps the window open: Escape, the backdrop, the cross and Batal wait, and the file is used when the save is done", async () => {
    const gate = deferred<Response>();
    const { user } = await openForm("/team/new", { [`PATCH ${LIST}/0002`]: () => gate.promise });
    const dialog = await openPicker(user, "Foto anggota");
    await user.click(await within(dialog).findByRole("button", { name: "foto-sari.webp" }));
    await user.type(within(dialog).getByLabelText("Teks alternatif"), "Sari");
    await user.click(within(dialog).getByRole("button", { name: "Pakai gambar ini" }));
    expect(await within(dialog).findByRole("button", { name: "Menyimpan..." })).toBeTruthy();

    fireEvent(dialog, new Event("cancel", { cancelable: true })); // Escape
    await user.click(dialog); // the backdrop
    await user.click(within(dialog).getByRole("button", { name: "Tutup" }));
    expect(within(dialog).getByRole("button", { name: "Batal" }).hasAttribute("disabled")).toBe(true);
    expect(dialog.hasAttribute("open")).toBe(true);

    gate.resolve(respond({ item: { ...SARI, altText: "Sari" } }));
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    const group = screen.getByRole("group", { name: /Foto anggota/ });
    expect(within(group).getByRole("img", { name: "Pratinjau Foto anggota" }).getAttribute("src")).toBe(SARI.path);
  });
});

describe("closing", () => {
  test("'Batal', Escape and the backdrop close it and leave the field as it was", async () => {
    const { user } = await openForm("/team/new");
    for (const close of [
      (dialog: HTMLElement) => user.click(within(dialog).getByRole("button", { name: "Batal" })),
      (dialog: HTMLElement) => user.click(within(dialog).getByRole("button", { name: "Tutup" })),
      (dialog: HTMLElement) => user.keyboard("{Escape}").then(() => fireEvent(dialog, new Event("cancel", { cancelable: true }))),
      (dialog: HTMLElement) => user.click(dialog),
    ]) {
      const dialog = await openPicker(user, "Foto anggota");
      await close(dialog);
      await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    }
    expect(within(screen.getByRole("group", { name: /Foto anggota/ })).queryByRole("img")).toBeNull();
  });

  test("it starts afresh each time: no search, nothing chosen", async () => {
    const { user } = await openForm("/team/new");
    let dialog = await openPicker(user, "Foto anggota");
    await user.type(within(dialog).getByRole("searchbox"), "budi");
    await user.click(await within(dialog).findByRole("button", { name: "foto-budi.webp" }));
    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    dialog = await openPicker(user, "Foto anggota");
    expect((within(dialog).getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(within(dialog).getByText("Belum ada gambar yang dipilih")).toBeTruthy();
  });
});

describe("'Unggah'", () => {
  test("sends one new file as the field's kind; it is then the file chosen, in the library, ready to use", async () => {
    const requests: UploadRequest[] = [];
    const path = "/uploads/team-photo/2026/0a1b2c3d-1111-4222-8333-444455559999-baru.png";
    setUploader(async (request) => {
      requests.push(request);
      return { ok: true as const, result: { id: "u9", path, contentType: "image/png", size: request.file.size, width: 8, height: 8 } };
    });
    const { user } = await openForm("/team/new");
    const dialog = await openPicker(user, "Foto anggota");
    await user.click(within(dialog).getByRole("tab", { name: "Unggah" }));
    expect(within(dialog).getByText(/PNG, JPEG, WebP\. Maksimal 5 MB\. Gambar diperkecil otomatis\./)).toBeTruthy();
    const input = dialog.querySelector<HTMLInputElement>("input[type='file']")!;
    expect(input.multiple).toBe(false);
    await user.upload(input, new File([new Uint8Array(100)], "baru.png", { type: "image/png" }));
    expect(await within(dialog).findByRole("tab", { name: "Pustaka media", selected: true })).toBeTruthy();
    expect(requests.map((request) => request.kind)).toEqual(["team-photo"]);
    expect(within(dialog).getAllByText("baru.png").length).toBeGreaterThan(0); // chosen, in the side column
    await user.click(within(dialog).getByRole("button", { name: "Pakai gambar ini" }));
    const group = screen.getByRole("group", { name: /Foto anggota/ });
    await waitFor(() => expect(within(group).getByRole("img", { name: "Pratinjau Foto anggota" }).getAttribute("src")).toBe(path));
  });

  test("a PDF field's zone says PDF and 20 MB, and does not talk of shrinking", async () => {
    const { user } = await openForm("/reports/new", { [`GET ${LIST}`]: respond(listing([])) });
    const dialog = await openPicker(user, "File PDF");
    await user.click(within(dialog).getByRole("tab", { name: "Unggah" }));
    const zone = within(dialog).getByRole("tabpanel");
    expect(within(zone).getByText(/PDF\. Maksimal 20 MB\./)).toBeTruthy();
    expect(within(zone).queryByText(/diperkecil/)).toBeNull();
  });
});
