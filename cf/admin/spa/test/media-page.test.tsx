import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resetUploadsBase, setUploader, type UploadRequest } from "~/lib/crud/upload-client";
import type { MediaItem } from "~/lib/crud/media";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

// The Media library page (SAKEM-117): the files as a grid or a list, the search and the filters in the address bar, the panel
// of one file (address, text alternative, where it is used, delete), ticking several, dropping new files. Through the whole
// app, as a person sees it; the API is a stand-in (the Worker's own tests are test/media-library.test.ts).

const WRITER: Parameters<typeof meBody> = ["editor", ["konten"]];
const VIEWER: Parameters<typeof meBody> = ["viewer"];
const LIST = "/api/admin/uploads";

const item = (id: string, change: Partial<MediaItem> = {}): MediaItem => ({
  id,
  path: `/uploads/blog-image/2026/${id}-${id}.webp`,
  name: `${id}.webp`,
  kind: "blog-image",
  contentType: "image/webp",
  size: 240_000,
  width: 1920,
  height: 1080,
  altText: null,
  uploadedByName: "Dewi Pengurus",
  createdAt: "2026-10-12T03:00:00.000Z",
  ...change,
});
const HERO = item("hero-kelas", { altText: "Siswa belajar di kelas" });
const WISUDA = item("wisuda-2026");
const LAPORAN = item("laporan-2025", { path: "/uploads/report/2026/laporan-2025-laporan-2025.pdf", name: "laporan-2025.pdf", kind: "report", contentType: "application/pdf", size: 2_400_000, width: null, height: null });
const FILES = [HERO, WISUDA, LAPORAN];

const listing = (items: MediaItem[] = FILES, extra: Record<string, unknown> = {}) => ({ items, page: 1, pageSize: 40, total: items.length, totalPages: 1, ...extra });
const where = () => screen.getByTestId("location").textContent;

async function open(routes: Parameters<typeof stubApi>[0] = {}, me: Parameters<typeof meBody> = WRITER, path = "/media") {
  const api = stubApi({
    "GET /api/me": respond(meBody(...me)),
    [`GET ${LIST}`]: respond(listing()),
    [`GET ${LIST}/hero-kelas`]: respond({ item: HERO, usedBy: ["Blog", "Pengumuman"] }),
    [`GET ${LIST}/wisuda-2026`]: respond({ item: WISUDA, usedBy: [] }),
    [`GET ${LIST}/laporan-2025`]: respond({ item: LAPORAN, usedBy: ["Laporan"] }),
    ...routes,
  });
  const view = renderApp(path);
  await screen.findByRole("heading", { level: 1, name: "Media" });
  return { api, user: userEvent.setup(), view };
}

const tile = (name: string) => screen.findByRole("button", { name });
const panel = () => screen.getByRole("complementary", { name: "Detail media" });

beforeEach(() => resetUploadsBase());
afterEach(() => {
  vi.unstubAllGlobals();
  setUploader(null);
});

describe("the files", () => {
  test("every file the person may read, newest first as the Worker sends them, in a grid named for what it is; the page has a title and no description", async () => {
    const { api } = await open();
    const grid = await screen.findByRole("list", { name: "Daftar media" });
    expect(within(grid).getAllByRole("listitem")).toHaveLength(3);
    for (const name of ["hero-kelas.webp", "wisuda-2026.webp", "laporan-2025.pdf"]) expect(within(grid).getByRole("button", { name })).toBeTruthy();
    expect(document.title).toBe("Media | Admin Sakola Kembara");
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?pageSize=40`); // no kind: the library
  });

  test("the sidebar has Media in Konten Situs, and the page is the one it opens", async () => {
    await open();
    const link = within(screen.getByRole("navigation", { name: "Menu utama" })).getByRole("link", { name: "Media" });
    expect(link.getAttribute("href")).toBe("/media");
    expect(link.getAttribute("aria-current")).toBe("page");
  });

  test("a person who cannot open Konten Situs gets the refusal page, not the library", async () => {
    stubApi({ "GET /api/me": respond(meBody("editor", ["pendaftaran"])) });
    renderApp("/media");
    expect(await screen.findByRole("heading", { level: 1, name: /akses/i })).toBeTruthy();
  });

  test("a library with nothing in it says so, and tells a writer what to do", async () => {
    await open({ [`GET ${LIST}`]: respond(listing([])) });
    expect(await screen.findByText("Belum ada media. Tarik file ke area di atas, atau klik “Unggah”.")).toBeTruthy();
  });

  test("a viewer is told only that there is nothing", async () => {
    await open({ [`GET ${LIST}`]: respond(listing([])) }, VIEWER);
    expect(await screen.findByText("Belum ada media.")).toBeTruthy();
  });

  test("a failed load says why and 'Coba lagi' asks again", async () => {
    let failing = true;
    const { api, user } = await open({ [`GET ${LIST}`]: () => (failing ? respond({ error: "server_error" }, 500) : respond(listing())) });
    expect((await screen.findByRole("alert")).textContent).toContain("Terjadi kesalahan di server");
    failing = false;
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await tile("hero-kelas.webp")).toBeTruthy();
    expect(api.count(`GET ${LIST}`)).toBe(2);
  });

  test("more files than a page: the count, the pages as links that keep the filters, and the second page is asked for", async () => {
    const { api } = await open({ [`GET ${LIST}`]: respond(listing(FILES, { total: 52, totalPages: 2 })) });
    expect(await screen.findByText("Menampilkan 1 sampai 40 dari 52")).toBeTruthy();
    const next = screen.getByRole("link", { name: "Berikutnya" });
    expect(next.getAttribute("href")).toBe("/media?page=2");
    await userEvent.setup().click(next);
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=2&pageSize=40`));
  });

  test("a page past the end (the last file of the last page went) goes to the last page that exists", async () => {
    const { api } = await open({ [`GET ${LIST}`]: (call) => respond(call.url.includes("page=3") ? listing([], { page: 3, total: 52, totalPages: 2 }) : listing(FILES, { total: 52, totalPages: 2 })) }, WRITER, "/media?page=3");
    await waitFor(() => expect(where()).toBe("/media?page=2"));
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=2&pageSize=40`);
  });
});

describe("search and filters, kept in the address", () => {
  test("the search is asked for after a pause in typing, and the address says it; Enter does not wait", async () => {
    const { api, user } = await open();
    await user.type(screen.getByRole("searchbox", { name: /Cari nama file/ }), "hero");
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?q=hero&pageSize=40`));
    expect(where()).toBe("/media?q=hero");

    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "wisuda{Enter}");
    expect(api.last(`GET ${LIST}`)?.url).toContain("q=wisuda");
  });

  test("the type and the date window are chosen from lists; a filter also starts again from the first page", async () => {
    const { api, user } = await open({}, WRITER, "/media?page=2");
    await user.selectOptions(screen.getByRole("combobox", { name: "Jenis file" }), "pdf");
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?type=pdf&pageSize=40`));
    await user.selectOptions(screen.getByRole("combobox", { name: "Tanggal unggah" }), "30");
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toMatch(/^\/api\/admin\/uploads\?type=pdf&from=\d{4}-\d{2}-\d{2}&pageSize=40$/));
    expect(where()).toBe("/media?type=pdf&range=30");
  });

  test("nothing matches: a sentence and 'Tampilkan semua', which clears every filter", async () => {
    const { user } = await open({ [`GET ${LIST}`]: (call) => respond(listing(call.url.includes("q=") ? [] : FILES)) }, WRITER, "/media?q=zzz");
    expect(await screen.findByText("Tidak ada media yang cocok dengan filter.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Tampilkan semua" }));
    expect(await tile("hero-kelas.webp")).toBeTruthy();
    expect(where()).toBe("/media");
  });

  test("the list view is a table with the type, the size and who uploaded the file and when; it is in the address too", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Tampilan daftar" }));
    const table = await screen.findByRole("table", { name: /Daftar media/ });
    expect(where()).toBe("/media?view=list");
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]!).getByText("WebP")).toBeTruthy();
    expect(within(rows[1]!).getByText("240 KB")).toBeTruthy();
    expect(within(rows[1]!).getByText("oleh Dewi Pengurus")).toBeTruthy();
    expect(within(table).getByText("2,4 MB")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tampilan daftar" }).getAttribute("aria-pressed")).toBe("true");
    // The name opens the file, as a tile does.
    await user.click(within(table).getByRole("button", { name: "hero-kelas.webp" }));
    expect(within(panel()).getByRole("heading", { name: "hero-kelas.webp" })).toBeTruthy();
  });
});

describe("the panel of one file", () => {
  test("opens beside the files: what it is, the address to copy, the text alternative, and where it is used (each a link to its menu)", async () => {
    const { api, user } = await open();
    expect(within(panel()).getByText(/Pilih satu file/)).toBeTruthy();
    await user.click(await tile("hero-kelas.webp"));
    const side = panel();
    expect(within(side).getByRole("heading", { name: "hero-kelas.webp" })).toBeTruthy();
    expect(within(side).getByText("WebP · 1920 × 1080 · 240 KB · diunggah 12 Okt 2026 oleh Dewi Pengurus")).toBeTruthy();
    expect((within(side).getByLabelText("Tautan") as HTMLInputElement).value).toBe("/uploads/blog-image/2026/hero-kelas-hero-kelas.webp");
    expect((within(side).getByLabelText("Teks alternatif") as HTMLTextAreaElement).value).toBe("Siswa belajar di kelas");
    const used = await within(side).findByRole("link", { name: "Blog" });
    expect(used.getAttribute("href")).toBe("/blog");
    expect(within(side).getByRole("link", { name: "Pengumuman" }).getAttribute("href")).toBe("/announcements");
    expect(api.count(`GET ${LIST}/hero-kelas`)).toBe(1);
    expect(screen.getByRole("button", { name: "hero-kelas.webp", pressed: true })).toBeTruthy();
  });

  test("a file used nowhere says so; a PDF has no text alternative to write", async () => {
    const { user } = await open();
    await user.click(await tile("wisuda-2026.webp"));
    expect(await within(panel()).findByText("Belum dipakai di mana pun.")).toBeTruthy();
    await user.click(await tile("laporan-2025.pdf"));
    expect(within(panel()).queryByLabelText("Teks alternatif")).toBeNull();
    expect(await within(panel()).findByRole("link", { name: "Laporan" })).toBeTruthy();
    expect(within(panel()).getByText("PDF · 2,4 MB · diunggah 12 Okt 2026 oleh Dewi Pengurus")).toBeTruthy();
  });

  test("when the use cannot be checked, the panel says that instead of saying nothing uses the file", async () => {
    const { user } = await open({ [`GET ${LIST}/wisuda-2026`]: respond({ error: "server_error" }, 500) });
    await user.click(await tile("wisuda-2026.webp"));
    expect(await within(panel()).findByText("Tidak bisa memeriksa pemakaian file ini.")).toBeTruthy();
    expect(within(panel()).queryByText("Belum dipakai di mana pun.")).toBeNull();
  });

  test("the text alternative is saved with its button, trimmed, and the list is asked for again", async () => {
    const { api, user } = await open({ [`PATCH ${LIST}/wisuda-2026`]: respond({ item: { ...WISUDA, altText: "Para lulusan berfoto" } }) });
    await user.click(await tile("wisuda-2026.webp"));
    const save = within(panel()).getByRole("button", { name: "Simpan teks alt" });
    expect(save.hasAttribute("disabled")).toBe(true); // nothing changed yet
    await user.type(within(panel()).getByLabelText("Teks alternatif"), "  Para lulusan berfoto ");
    expect(within(panel()).getByText(/\d+\/300/)).toBeTruthy();
    await user.click(save);
    expect(await within(panel()).findByText("Tersimpan.")).toBeTruthy();
    expect(api.last(`PATCH ${LIST}/wisuda-2026`)?.body).toEqual({ altText: "Para lulusan berfoto" });
    expect(api.count(`GET ${LIST}`)).toBe(2);
  });

  test("a text alternative the Worker refuses is said under the box, in its words, and nothing is marked saved", async () => {
    const { user } = await open({ [`PATCH ${LIST}/wisuda-2026`]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { altText: "Teks alternatif maksimal 300 karakter." } }, 400) });
    await user.click(await tile("wisuda-2026.webp"));
    await user.type(within(panel()).getByLabelText("Teks alternatif"), "x");
    await user.click(within(panel()).getByRole("button", { name: "Simpan teks alt" }));
    expect(await within(panel()).findByText("Teks alternatif maksimal 300 karakter.")).toBeTruthy();
    expect(within(panel()).queryByText("Tersimpan.")).toBeNull();
  });

  test("the text has the Worker's limit, so a longer one cannot be typed", async () => {
    const { user } = await open();
    await user.click(await tile("wisuda-2026.webp"));
    expect((within(panel()).getByLabelText("Teks alternatif") as HTMLTextAreaElement).maxLength).toBe(300);
  });

  test("another file's panel starts from that file's text, not from what was being typed", async () => {
    const { user } = await open();
    await user.click(await tile("wisuda-2026.webp"));
    await user.type(within(panel()).getByLabelText("Teks alternatif"), "belum disimpan");
    await user.click(await tile("hero-kelas.webp"));
    expect((within(panel()).getByLabelText("Teks alternatif") as HTMLTextAreaElement).value).toBe("Siswa belajar di kelas");
  });
});

describe("deleting", () => {
  test("Hapus asks, names the file, deletes it, says so, and the panel closes and the list is asked for again", async () => {
    const { api, user } = await open({ [`DELETE ${LIST}/wisuda-2026`]: respond(null, 204) });
    await user.click(await tile("wisuda-2026.webp"));
    await user.click(within(panel()).getByRole("button", { name: "Hapus" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Hapus berkas?" });
    expect(within(dialog).getByText(/wisuda-2026\.webp/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Hapus" }));
    expect(await screen.findByText("Berkas “wisuda-2026.webp” berhasil dihapus.")).toBeTruthy();
    expect(api.count(`DELETE ${LIST}/wisuda-2026`)).toBe(1);
    expect(api.last(`DELETE ${LIST}/wisuda-2026`)?.headers["if-match"]).toBeUndefined(); // a media row has no version
    expect(within(panel()).getByText(/Pilih satu file/)).toBeTruthy();
    expect(api.count(`GET ${LIST}`)).toBe(2);
  });

  test("a file still in use is refused, with the menus that use it, and only 'Tutup' is left: asking again cannot work", async () => {
    const { user } = await open({
      [`DELETE ${LIST}/hero-kelas`]: respond({ error: "in_use", message: "File masih dipakai di: Blog, Pengumuman. Lepaskan dulu dari sana.", usedBy: ["Blog", "Pengumuman"] }, 409),
    });
    await user.click(await tile("hero-kelas.webp"));
    await user.click(within(panel()).getByRole("button", { name: "Hapus" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Hapus" }));
    expect(await within(dialog).findByText("File masih dipakai di: Blog, Pengumuman. Lepaskan dulu dari sana.")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Hapus" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Tutup" })).toBeTruthy();
    expect(within(panel()).getByRole("heading", { name: "hero-kelas.webp" })).toBeTruthy(); // still open, still there
  });

  test("the panel says plainly that what is used cannot be deleted", async () => {
    const { user } = await open();
    await user.click(await tile("hero-kelas.webp"));
    expect(within(panel()).getByText("Media yang masih dipakai tidak bisa dihapus.")).toBeTruthy();
  });

  test("several ticked files are deleted together; the one that is in use stays and the notice says which and why", async () => {
    const { api, user } = await open({
      [`DELETE ${LIST}/wisuda-2026`]: respond(null, 204),
      [`DELETE ${LIST}/hero-kelas`]: respond({ error: "in_use", message: "File masih dipakai di: Blog. Lepaskan dulu dari sana.", usedBy: ["Blog"] }, 409),
    });
    await user.click(await screen.findByRole("checkbox", { name: "Pilih wisuda-2026.webp" }));
    await user.click(screen.getByRole("checkbox", { name: "Pilih hero-kelas.webp" }));
    const bar = await screen.findByRole("group", { name: "Aksi untuk baris yang dipilih" });
    expect(within(bar).getByText("2 berkas dipilih")).toBeTruthy();
    await user.click(within(bar).getByRole("button", { name: "Hapus" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Hapus 2 berkas?" });
    expect(within(dialog).getByText("wisuda-2026.webp")).toBeTruthy();
    expect(within(dialog).getByText("hero-kelas.webp")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Hapus" }));
    const notice = await screen.findByText(/1 berkas dihapus\./);
    expect(notice.textContent).toContain("1 gagal: “hero-kelas.webp” (File masih dipakai di: Blog. Lepaskan dulu dari sana.)");
    expect(api.count(`DELETE ${LIST}/wisuda-2026`)).toBe(1);
    expect(api.count(`DELETE ${LIST}/hero-kelas`)).toBe(1);
    expect(api.count(`GET ${LIST}`)).toBe(2);
  });

  test("the ticks belong to the files on screen: another page starts with none", async () => {
    const { user } = await open({ [`GET ${LIST}`]: respond(listing(FILES, { total: 52, totalPages: 2 })) });
    await user.click(await screen.findByRole("checkbox", { name: "Pilih wisuda-2026.webp" }));
    expect(await screen.findByRole("group", { name: "Aksi untuk baris yang dipilih" })).toBeTruthy();
    expect(screen.getAllByText("1 berkas dipilih").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("link", { name: "Berikutnya" }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Aksi untuk baris yang dipilih" })).toBeNull());
  });
});

describe("uploading", () => {
  const PATH = "/uploads/blog-image/2026/0a1b2c3d-1111-4222-8333-444455556666-foto-baru.webp";
  const PDF = "/uploads/report/2026/0a1b2c3d-1111-4222-8333-777788889999-laporan.pdf";
  const fileInput = () => document.querySelector<HTMLInputElement>("main input[type='file']")!;

  test("a picture is sent as a blog image and a PDF as a report; the new file is open in the panel and the list is asked for again", async () => {
    const requests: UploadRequest[] = [];
    setUploader(async (request) => {
      requests.push(request);
      const pdf = request.kind === "report";
      return { ok: true as const, result: { id: pdf ? "u2" : "u1", path: pdf ? PDF : PATH, contentType: pdf ? "application/pdf" : "image/png", size: request.file.size, width: pdf ? null : 800, height: pdf ? null : 450 } };
    });
    const { api, user } = await open({ [`GET ${LIST}/u1`]: respond({ item: item("u1"), usedBy: [] }), [`GET ${LIST}/u2`]: respond({ item: LAPORAN, usedBy: [] }) });
    await user.upload(fileInput(), [new File([new Uint8Array(2000)], "foto-baru.png", { type: "image/png" }), new File([new Uint8Array(2000)], "laporan.pdf", { type: "application/pdf" })]);
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests.map((request) => request.kind)).toEqual(["blog-image", "report"]); // one after the other, by type
    expect(await screen.findByText("2 file diunggah.")).toBeTruthy();
    expect(api.count(`GET ${LIST}`)).toBeGreaterThanOrEqual(2);
    expect(within(panel()).getByRole("heading", { name: "laporan.pdf" })).toBeTruthy(); // the last one is open
  });

  test("the header's Unggah opens the same file chooser as the zone", async () => {
    const { user } = await open();
    const click = vi.spyOn(fileInput(), "click");
    await user.click(screen.getByRole("button", { name: "Unggah" }));
    expect(click).toHaveBeenCalledOnce();
  });

  test("the zone says what it takes: shrunk pictures, and the two limits", async () => {
    await open();
    expect(screen.getByText(/Gambar diperkecil otomatis \(maks 1920 px\)\. Hingga 5 MB per gambar, 20 MB per PDF\./)).toBeTruthy();
    expect(fileInput().accept).toBe("image/png,.png,image/jpeg,.jpg,.jpeg,image/webp,.webp,image/gif,.gif,application/pdf,.pdf");
  });

  test("a file the Worker refuses is said by name and in its words, and the others go on; the bar is a progress bar while a file is on its way", async () => {
    const gate = deferred<Awaited<ReturnType<typeof import("~/lib/crud/upload-client").uploadFile>>>();
    let calls = 0;
    setUploader(async (request) => {
      calls += 1;
      if (calls === 1) return gate.promise;
      return { ok: true as const, result: { id: "u3", path: PATH, contentType: "image/png", size: request.file.size, width: 8, height: 8 } };
    });
    const { user } = await open();
    await user.upload(fileInput(), [new File([new Uint8Array(2000)], "besar.png", { type: "image/png" }), new File([new Uint8Array(2000)], "kecil.png", { type: "image/png" })]);
    expect(await screen.findByRole("progressbar", { name: "Mengunggah besar.png" })).toBeTruthy();
    await act(async () => gate.resolve({ ok: false, status: 413, message: "Ukuran file maksimal 5 MB." }));
    expect((await screen.findByRole("alert")).textContent).toContain("besar.png: Ukuran file maksimal 5 MB.");
    expect(await screen.findByText("1 file diunggah, 1 gagal.")).toBeTruthy();
  });

  /** An uploader that never answers on its own: it records each request and ends only when the request is aborted, as the browser's does. */
  function hangingUploader() {
    const requests: UploadRequest[] = [];
    setUploader((request) => {
      requests.push(request);
      return new Promise((resolve) => request.signal?.addEventListener("abort", () => resolve({ ok: false, status: 0, message: "Unggahan dibatalkan.", code: "aborted" })));
    });
    return requests;
  }
  const two = () => [new File([new Uint8Array(100)], "satu.png", { type: "image/png" }), new File([new Uint8Array(100)], "dua.png", { type: "image/png" })];

  test("'Batal' stops the file on its way and forgets the one waiting: no second request, no message about a failure", async () => {
    const requests = hangingUploader();
    const { user } = await open();
    await user.upload(fileInput(), two());
    expect(await screen.findByRole("progressbar", { name: "Mengunggah satu.png" })).toBeTruthy();
    expect(screen.getByText("Menunggu")).toBeTruthy(); // the second waits its turn
    await user.click(screen.getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
    expect(requests).toHaveLength(1);
    expect(requests[0]!.signal!.aborted).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Menunggu")).toBeNull();
  });

  test("leaving the page stops what is on its way", async () => {
    const requests = hangingUploader();
    const { user, view } = await open();
    await user.upload(fileInput(), two());
    await screen.findByRole("progressbar", { name: "Mengunggah satu.png" });
    view.unmount();
    expect(requests[0]!.signal!.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requests).toHaveLength(1); // and the second is never sent
  });

  test("a file the browser can tell is wrong is refused before anything is sent", async () => {
    const uploader = vi.fn();
    setUploader(uploader);
    await open();
    // A chooser would not let this one through (`accept`); a drop can carry anything.
    fireEvent.change(fileInput(), { target: { files: [new File(["x"], "catatan.txt", { type: "text/plain" })] } });
    expect((await screen.findByRole("alert")).textContent).toContain("catatan.txt: Tipe file tidak didukung.");
    expect(uploader).not.toHaveBeenCalled();
  });
});

describe("a person who can only read", () => {
  test("sees every file and its panel, and none of what changes anything: no Unggah, no zone, no ticks, no Hapus, no way to edit the text", async () => {
    const { user } = await open({}, VIEWER);
    await user.click(await tile("hero-kelas.webp"));
    expect(screen.queryByRole("button", { name: "Unggah" })).toBeNull();
    expect(document.querySelector("main input[type='file']")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    const side = panel();
    expect(within(side).queryByRole("button", { name: "Hapus" })).toBeNull();
    expect(within(side).queryByRole("button", { name: "Simpan teks alt" })).toBeNull();
    expect((within(side).getByLabelText("Teks alternatif") as HTMLTextAreaElement).disabled).toBe(true);
    expect((within(side).getByLabelText("Tautan") as HTMLInputElement).value).toContain("hero-kelas");
  });
});

describe("a screen too narrow for a column", () => {
  test("the same panel opens in a window, and closing it leaves the files as they were", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
    const { user } = await open();
    expect(screen.queryByRole("complementary", { name: "Detail media" })).toBeNull();
    await user.click(await tile("hero-kelas.webp"));
    const dialog = await screen.findByRole("dialog", { name: "Detail media" });
    expect(within(dialog).getByRole("heading", { name: "hero-kelas.webp" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Tutup" }));
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    expect(await tile("hero-kelas.webp")).toBeTruthy();
  });
});
