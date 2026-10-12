import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resetUploadsBase, setUploader, type UploadRequest } from "~/lib/crud/upload-client";
import { API_PATH, PREVIEW_PATH, toBody, toValues } from "~/pages/blog/form";
import { defaultAuthor, formatIsoDay, imageMarkdown, insertAtCursor } from "~/pages/blog/rules";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

// The blog screens: the list, the editor with its two tabs, the preview, the image insertion, the draft and
// publish states, and what a read-only role is shown. What every block of the kit does by itself is proved in
// test/crud/*; the legacy texts are the ones of app/(admin)/admin/blog.

const LIST = API_PATH;

function article(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1",
    slug: "cara-belajar-efektif",
    title: "Cara Belajar Efektif",
    excerpt: "Ringkasan tentang cara belajar yang efektif untuk siswa.",
    contentMarkdown: "## Mulai dari jadwal\n\nBuat jadwal belajar harian dan patuhi dengan **disiplin**. Istirahat itu penting.",
    category: "Tips",
    author: "Dzul",
    featured: false,
    status: "draft",
    date: null,
    image: null,
    imageWidth: null,
    imageHeight: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function listItem(overrides: Record<string, unknown> = {}) {
  const { contentMarkdown: _markdown, image: _image, imageWidth: _w, imageHeight: _h, ...rest } = article(overrides);
  return rest;
}

const envelope = (items: unknown[], extra: { page?: number; pageSize?: number; total?: number } = {}) => ({ items, page: extra.page ?? 1, pageSize: extra.pageSize ?? 20, total: extra.total ?? items.length });

type Who = Parameters<typeof meBody>;
const WRITER: Who = ["editor", ["konten"]];
const location = () => screen.getByTestId("location").textContent;

afterEach(() => {
  setUploader(null);
  resetUploadsBase();
  vi.useRealTimers();
});

// ------------------------------------------------------------------------------------------------- pure

describe("the pure helpers", () => {
  test("formatIsoDay writes the Indonesian long date, as the legacy formatDateIndonesian did", () => {
    expect(formatIsoDay("2026-05-21")).toBe("21 Mei 2026");
    expect(formatIsoDay("2026-01-01")).toBe("1 Januari 2026");
    expect(formatIsoDay("2026-12-31")).toBe("31 Desember 2026");
    expect(formatIsoDay(null)).toBe("");
    expect(formatIsoDay("kemarin")).toBe("kemarin");
    expect(formatIsoDay("2026-13-01")).toBe("2026-13-01");
  });

  test("a new article starts with the author the legacy page chose from the email", () => {
    expect(defaultAuthor("dzul.rahman_x-y@sakolakembara.org")).toBe("dzul rahman x y");
    expect(defaultAuthor("")).toBe("Sakola Kembara");
    expect(defaultAuthor(null)).toBe("Sakola Kembara");
  });

  test("insertAtCursor replaces the selection and says where the cursor goes", () => {
    expect(insertAtCursor("abcdef", 3, 3, "XY")).toEqual({ value: "abcXYdef", cursor: 5 });
    expect(insertAtCursor("abcdef", 1, 4, "-")).toEqual({ value: "a-ef", cursor: 2 });
    expect(insertAtCursor("abc", 99, 120, "Z")).toEqual({ value: "abcZ", cursor: 4 });
    expect(insertAtCursor("", 0, 0, "Z")).toEqual({ value: "Z", cursor: 1 });
  });

  test("the markdown of an inserted image is on its own lines, with the alt text made from the file name", () => {
    expect(imageMarkdown("foto-siswa_belajar.PNG", "/uploads/blog-image/2026/x.png")).toBe("\n![foto siswa belajar](/uploads/blog-image/2026/x.png)\n");
    expect(imageMarkdown("a[b].png", "/p.png")).toBe("\n![a b](/p.png)\n");
  });

  test("the form's values and the body of a save", () => {
    expect(toValues(null, "dzul@sakolakembara.org")).toEqual({ title: "", slug: "", category: "Cerita", excerpt: "", contentMarkdown: "", author: "dzul", featured: false, date: "", image: "" });
    const item = article({ status: "published", date: "2026-05-21", image: "/uploads/blog-image/2026/a.png" }) as never;
    expect(toBody(toValues(item))).toEqual({
      title: "Cara Belajar Efektif",
      slug: "cara-belajar-efektif",
      category: "Tips",
      excerpt: "Ringkasan tentang cara belajar yang efektif untuk siswa.",
      contentMarkdown: expect.stringContaining("## Mulai"),
      author: "Dzul",
      featured: false,
      date: "2026-05-21",
      image: "/uploads/blog-image/2026/a.png",
    });
    expect(toBody(toValues(null))).toMatchObject({ date: null, image: null, slug: "" });
  });
});

// ------------------------------------------------------------------------------------------------- list

async function openList(who: Who, routes: Parameters<typeof stubApi>[0] = {}, path = "/blog") {
  const api = stubApi({
    "GET /api/me": respond(meBody(...who)),
    [`GET ${LIST}`]: respond(envelope([listItem(), listItem({ id: "b2", slug: "kisah", title: "Kisah Alumni", status: "published", date: "2026-05-21", featured: true, category: "Career", excerpt: "Awal kalimat ..." })])),
    ...routes,
  });
  const view = renderApp(path);
  await screen.findByRole("heading", { level: 1, name: "Blog" });
  await screen.findByText("Kisah Alumni");
  return { api, ...view };
}

describe("the list", () => {
  test("a table in the legacy columns, with the status as a tag, the date written out and the Featured tag", async () => {
    await openList(["viewer", []]);
    const grid = screen.getByRole("table", { name: /Daftar artikel/ });
    expect(within(grid).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Judul", "Kategori", "Status", "Tanggal", "Aksi"]);
    const rows = within(grid).getAllByRole("row");
    const draft = rows.find((row) => within(row).queryByText("Cara Belajar Efektif"))!;
    const published = rows.find((row) => within(row).queryByText("Kisah Alumni"))!;
    expect(within(draft).getByText("Draf")).toBeTruthy();
    expect(within(draft).getByText("-")).toBeTruthy(); // no date yet
    expect(within(draft).queryByText("Featured")).toBeNull();
    expect(within(published).getByText("Terbit")).toBeTruthy();
    expect(within(published).getByText("21 Mei 2026")).toBeTruthy();
    expect(within(published).getByText("Featured")).toBeTruthy();
    expect(within(published).getByText("Career")).toBeTruthy();
    expect(screen.getByText("2 total artikel")).toBeTruthy();
  });

  test("a viewer reads the list and is offered nothing to change: no create button, no Edit, no Hapus, 'Lihat' instead", async () => {
    await openList(["viewer", []]);
    expect(screen.queryByRole("link", { name: /Tulis Artikel Baru/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Hapus/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Edit/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Lihat Kisah Alumni" }).getAttribute("href")).toBe("/blog/b2/edit");
  });

  test("an editor of Konten, and super_admin, get 'Tulis Artikel Baru' and Edit and Hapus on every row", async () => {
    for (const who of [WRITER, ["super_admin", []]] as Who[]) {
      const view = await openList(who);
      expect(screen.getByRole("link", { name: /Tulis Artikel Baru/ }).getAttribute("href")).toBe("/blog/new");
      expect(screen.getByRole("link", { name: "Edit Kisah Alumni" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Hapus Kisah Alumni" }).getAttribute("aria-haspopup")).toBe("dialog");
      view.unmount();
    }
  });

  test("an editor of other areas cannot open the page: the 403 page, and the list is never asked for", async () => {
    const api = stubApi({ "GET /api/me": respond(meBody("editor", ["pendaftaran", "komunikasi"])), [`GET ${LIST}`]: respond(envelope([listItem()])) });
    renderApp("/blog");
    expect(await screen.findByRole("heading", { level: 1, name: "Akses ditolak" })).toBeTruthy();
    expect(screen.queryByText("Kisah Alumni")).toBeNull();
    expect(api.count(`GET ${LIST}`)).toBe(0);
  });

  test("the filter bar uses the legacy words and asks the Worker with the names it expects", async () => {
    const user = userEvent.setup();
    const { api } = await openList(["viewer", []]);
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=20&sort=-updatedAt`);
    const category = screen.getByLabelText("Kategori") as HTMLSelectElement;
    expect([...category.options].map((option) => option.textContent)).toEqual(["Semua kategori", "Career", "Cerita", "Education", "Kiat kiat", "News", "Testimonials", "Tips", "Uncategorized"]);
    expect([...(screen.getByLabelText("Status") as HTMLSelectElement).options].map((option) => option.textContent)).toEqual(["Semua status", "Terbit", "Draf"]);
    expect((screen.getByLabelText("Cari") as HTMLInputElement).placeholder).toBe("Cari judul atau excerpt...");

    await user.type(screen.getByLabelText("Cari"), "kisah");
    await user.selectOptions(category, "Career");
    await user.selectOptions(screen.getByLabelText("Status"), "published");
    await user.click(screen.getByRole("button", { name: "Terapkan" }));
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=20&q=kisah&status=published&category=Career&sort=-updatedAt`));
    await waitFor(() => expect(location()).toBe("/blog?q=kisah&status=published&category=Career"));
    expect(await screen.findByText(/artikel ditampilkan/)).toBeTruthy();
  });

  test("the empty states: an invitation for someone who can write, the legacy sentence when a filter matches nothing", async () => {
    stubApi({ "GET /api/me": respond(meBody("super_admin")), [`GET ${LIST}`]: respond(envelope([])) });
    const view = renderApp("/blog");
    expect(await screen.findByText("Belum ada artikel. Klik “Tulis Artikel Baru” untuk membuat.")).toBeTruthy();
    view.unmount();

    stubApi({ "GET /api/me": respond(meBody("viewer")), [`GET ${LIST}`]: respond(envelope([])) });
    const filtered = renderApp("/blog?status=draft");
    expect(await screen.findByText("Tidak ada artikel yang cocok.")).toBeTruthy();
    filtered.unmount();
  });

  test("delete names the article and goes to the Worker with the row's version", async () => {
    const user = userEvent.setup();
    const { api } = await openList(WRITER, { [`DELETE ${LIST}/b2`]: respond(null, 204) });
    await user.click(screen.getByRole("button", { name: "Hapus Kisah Alumni" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Hapus artikel?" });
    expect(dialog.textContent).toContain("Artikel “Kisah Alumni” akan dihapus. Tindakan ini tidak bisa dibatalkan.");
    await user.click(within(dialog).getByRole("button", { name: "Hapus" }));
    expect(await notice("Artikel berhasil dihapus.")).toBeTruthy();
    expect(api.last(`DELETE ${LIST}/b2`)?.headers["if-match"]).toBe('"2026-10-01T00:00:00.000Z"');
  });
});

// ------------------------------------------------------------------------------------------------- form

async function openForm(who: Who, path: string, routes: Parameters<typeof stubApi>[0] = {}) {
  const api = stubApi({ "GET /api/me": respond(meBody(...who)), ...routes });
  const view = renderApp(path);
  await screen.findByRole("form");
  return { api, ...view };
}

async function openEdit(who: Who, item = article(), routes: Parameters<typeof stubApi>[0] = {}) {
  const view = await openForm(who, `/blog/${String(item.id)}/edit`, { [`GET ${LIST}/${String(item.id)}`]: respond({ item }), ...routes });
  await waitFor(() => expect((screen.getByLabelText(/^Judul/) as HTMLInputElement).value).toBe(String(item.title)));
  return view;
}

const bodyField = () => screen.getByLabelText("Isi Artikel") as HTMLTextAreaElement;
/** A panel of the editor by name. By id: the accessible name of a panel that is `hidden` is empty, which would make it unfindable by role. */
const panel = (name: "Detail" | "Konten") => document.getElementById(`panel-${name.toLowerCase()}`)!;
/** The notice after a save. (Not `getByRole("status")`: the file field keeps a quiet status line of its own.) */
const notice = (text: string) => screen.findByText(text);

describe("the form: create", () => {
  test("the legacy editor: the Detail tab with its three sections, the legacy defaults, the Konten tab hidden until chosen", async () => {
    await openForm(WRITER, "/blog/new");
    expect(screen.getByRole("heading", { level: 1, name: "Tulis Artikel" })).toBeTruthy();
    for (const name of ["Informasi Dasar", "Klasifikasi & Publikasi", "Gambar Hero"]) expect(screen.getByRole("heading", { level: 2, name })).toBeTruthy();
    expect((screen.getByLabelText(/^Kategori/) as HTMLSelectElement).value).toBe("Cerita");
    expect((screen.getByLabelText(/^Penulis/) as HTMLInputElement).value).toBe("tester");
    expect((screen.getByLabelText(/^Tanggal Publikasi/) as HTMLInputElement).type).toBe("date");
    expect((screen.getByLabelText(/^Tanggal Publikasi/) as HTMLInputElement).value).toBe("");
    expect(screen.getByText("20-500 karakter. Muncul di list artikel dan SEO description.")).toBeTruthy();
    expect(screen.getByText("Kosongkan agar dibuat otomatis dari judul.")).toBeTruthy();
    expect(screen.getByLabelText(/Tampilkan sebagai artikel unggulan/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Buat Artikel" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Terbitkan" })).toBeNull(); // nothing to publish before it exists
    expect(panel("Detail").hasAttribute("hidden")).toBe(false);
    expect(panel("Konten").hasAttribute("hidden")).toBe(true);
    expect(document.title).toBe("Tulis Artikel | Admin Sakola Kembara");
  });

  test("submitting sends the body the Worker takes, once, then opens the edit page with 'berhasil dibuat'", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const { api } = await openForm(WRITER, "/blog/new", {
      [`POST ${LIST}`]: () => gate.promise,
      [`GET ${LIST}/new-id`]: respond({ item: article({ id: "new-id" }) }),
    });
    await user.type(screen.getByLabelText(/^Judul/), "Cara Belajar Efektif");
    await user.type(screen.getByLabelText(/^Excerpt/), "Ringkasan tentang cara belajar yang efektif.");
    await user.selectOptions(screen.getByLabelText(/^Kategori/), "Tips");
    await user.click(screen.getByRole("tab", { name: /Konten/ }));
    await user.click(bodyField());
    await user.paste("Isi artikel yang cukup panjang untuk lolos batas lima puluh karakter.");
    const save = screen.getByRole("button", { name: "Buat Artikel" });
    await act(async () => {
      save.click();
      save.click();
    });
    expect(api.count(`POST ${LIST}`)).toBe(1);
    expect(api.last(`POST ${LIST}`)?.body).toEqual({
      title: "Cara Belajar Efektif",
      slug: "",
      category: "Tips",
      excerpt: "Ringkasan tentang cara belajar yang efektif.",
      contentMarkdown: "Isi artikel yang cukup panjang untuk lolos batas lima puluh karakter.",
      author: "tester",
      featured: false,
      date: null,
      image: null,
    });

    await act(async () => gate.resolve(respond({ item: article({ id: "new-id" }) }, 201)));
    await waitFor(() => expect(location()).toBe("/blog/new-id/edit"));
    expect(await notice("Artikel berhasil dibuat.")).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull(); // the unsaved guard let the navigation pass
  });

  test("a refused form opens the tab that holds the first error, marks both tabs, and the summary reaches a field on the other tab", async () => {
    const user = userEvent.setup();
    await openForm(WRITER, "/blog/new", {
      [`POST ${LIST}`]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { contentMarkdown: "Isi minimal 50 karakter", title: "Judul minimal 3 karakter" } }, 400),
    });
    await user.type(screen.getByLabelText(/^Judul/), "ab");
    await user.type(screen.getByLabelText(/^Excerpt/), "Ringkasan tentang cara belajar yang efektif.");
    await user.click(screen.getByRole("button", { name: "Buat Artikel" }));

    const summary = await screen.findByRole("alert");
    // The first error is in the body: the Konten tab is shown, and both tabs carry the red dot.
    await waitFor(() => expect(panel("Konten").hasAttribute("hidden")).toBe(false));
    expect(panel("Detail").hasAttribute("hidden")).toBe(true);
    expect(screen.getAllByRole("img", { name: "Ada kesalahan" })).toHaveLength(2);
    expect(bodyField().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Isi minimal 50 karakter", { selector: "span" })).toBeTruthy();

    // The title is on the other tab: its link shows the tab, then puts the cursor in the field.
    await user.click(within(summary).getByRole("link", { name: "Judul: Judul minimal 3 karakter" }));
    expect(panel("Detail").hasAttribute("hidden")).toBe(false);
    expect(document.activeElement).toBe(screen.getByLabelText(/^Judul/));
    expect(screen.getByLabelText(/^Judul/).getAttribute("aria-invalid")).toBe("true");
  });

  test("a slug that is taken is a message on the slug field, with the slug tab shown", async () => {
    const user = userEvent.setup();
    await openForm(WRITER, "/blog/new", { [`POST ${LIST}`]: respond({ error: "conflict", message: "Data bentrok dengan data lain yang sudah ada.", fields: { slug: "Slug sudah dipakai" } }, 409) });
    await user.type(screen.getByLabelText(/^Judul/), "Judul yang sah");
    await user.type(screen.getByLabelText(/^Excerpt/), "Ringkasan tentang cara belajar yang efektif.");
    await user.type(screen.getByLabelText(/^Slug/), "halo");
    await user.click(screen.getByRole("button", { name: "Buat Artikel" }));
    expect(await screen.findByText("Slug sudah dipakai", { selector: "p" })).toBeTruthy();
    expect(screen.getByLabelText(/^Slug/).getAttribute("aria-invalid")).toBe("true");
  });

  test("leaving with typed text asks first: the body counts as a change", async () => {
    const user = userEvent.setup();
    await openForm(WRITER, "/blog/new");
    await user.click(screen.getByRole("tab", { name: /Konten/ }));
    await user.click(bodyField());
    await user.paste("Sebuah draf yang belum disimpan.");
    await user.click(screen.getByRole("link", { name: "Batal" }));
    expect(await screen.findByRole("alertdialog", { name: "Tinggalkan halaman?" })).toBeTruthy();
    expect(location()).toBe("/blog/new");
  });
});

describe("the form: edit", () => {
  test("the article is loaded into both tabs, and saving sends If-Match of the version loaded", async () => {
    const user = userEvent.setup();
    const loaded = article({ date: "2026-05-21", featured: true, category: "News" });
    const { api } = await openEdit(WRITER, loaded, {
      [`PUT ${LIST}/b1`]: respond({ item: { ...loaded, title: "Judul baru", updatedAt: "2026-10-02T00:00:00.000Z" } }),
    });
    expect(screen.getByRole("heading", { level: 1, name: "Edit Artikel" })).toBeTruthy();
    expect((screen.getByLabelText(/^Slug/) as HTMLInputElement).value).toBe("cara-belajar-efektif");
    expect((screen.getByLabelText(/^Slug/) as HTMLInputElement).disabled).toBe(false); // a draft
    expect(screen.getByText("Alamat artikel: /blog/slug. Bisa diubah selama artikel masih draf.")).toBeTruthy();
    expect((screen.getByLabelText(/^Kategori/) as HTMLSelectElement).value).toBe("News");
    expect((screen.getByLabelText(/^Tanggal Publikasi/) as HTMLInputElement).value).toBe("2026-05-21");
    expect((screen.getByLabelText(/Tampilkan sebagai artikel unggulan/) as HTMLInputElement).checked).toBe(true);
    expect(bodyField().value).toContain("## Mulai dari jadwal");
    expect(screen.getByText("/blog/cara-belajar-efektif")).toBeTruthy();
    expect(screen.getByText("Draf")).toBeTruthy();

    await user.clear(screen.getByLabelText(/^Judul/));
    await user.type(screen.getByLabelText(/^Judul/), "Judul baru");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    expect(await notice("Artikel berhasil disimpan.")).toBeTruthy();
    const put = api.last(`PUT ${LIST}/b1`)!;
    expect(put.headers["if-match"]).toBe('"2026-10-01T00:00:00.000Z"');
    expect(put.body).toMatchObject({ title: "Judul baru", slug: "cara-belajar-efektif", category: "News", date: "2026-05-21", featured: true, image: null });
    expect(location()).toBe("/blog/b1/edit");
  });

  test("someone saved first (409 stale): the warning, and 'Muat ulang' replaces the form with the newer version", async () => {
    const user = userEvent.setup();
    let served = article();
    const { api } = await openForm(WRITER, "/blog/b1/edit", {
      [`GET ${LIST}/b1`]: () => Promise.resolve(respond({ item: served })),
      [`PUT ${LIST}/b1`]: respond({ error: "stale", message: "Data ini sudah diubah orang lain sejak kamu membukanya. Muat ulang untuk melihat versi terbaru." }, 409),
    });
    await waitFor(() => expect((screen.getByLabelText(/^Judul/) as HTMLInputElement).value).toBe("Cara Belajar Efektif"));
    await user.type(screen.getByLabelText(/^Judul/), " saya");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    expect((await screen.findByText(/Data ini sudah diubah orang lain/)).textContent).toContain("Perubahan yang belum disimpan akan hilang");

    served = article({ title: "Dari orang lain", updatedAt: "2026-10-05T00:00:00.000Z" });
    await user.click(screen.getByRole("button", { name: "Muat ulang" }));
    await waitFor(() => expect((screen.getByLabelText(/^Judul/) as HTMLInputElement).value).toBe("Dari orang lain"));
    expect(api.count(`GET ${LIST}/b1`)).toBe(2);
  });

  test("a published article: the slug is locked and says so, the date is required, and the button takes it back to a draft", async () => {
    await openEdit(WRITER, article({ status: "published", date: "2026-05-21" }));
    const slug = screen.getByLabelText(/^Slug/) as HTMLInputElement;
    expect(slug.disabled).toBe(true);
    expect(screen.getByText("Slug tidak bisa diubah setelah artikel terbit.")).toBeTruthy();
    expect((screen.getByLabelText(/^Tanggal Publikasi/) as HTMLInputElement).required).toBe(true);
    expect(screen.queryByText("Kosongkan agar terisi otomatis saat diterbitkan.")).toBeNull();
    expect(screen.getByText("Terbit")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kembalikan ke Draf" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Terbitkan" })).toBeNull();
  });

  test("a draft's date field says it fills itself when the article is published", async () => {
    await openEdit(WRITER);
    expect(screen.getByText("Kosongkan agar terisi otomatis saat diterbitkan.")).toBeTruthy();
    expect((screen.getByLabelText(/^Tanggal Publikasi/) as HTMLInputElement).required).toBe(false);
  });

  test("an article that is gone: the sentence and a way back", async () => {
    stubApi({ "GET /api/me": respond(meBody(...WRITER)), [`GET ${LIST}/gone`]: respond({ error: "not_found", message: "Data tidak ditemukan. Mungkin sudah dihapus." }, 404) });
    renderApp("/blog/gone/edit");
    expect((await screen.findByRole("alert")).textContent).toBe("Data tidak ditemukan. Mungkin sudah dihapus.");
    expect(screen.getByRole("link", { name: "Kembali ke daftar" }).getAttribute("href")).toBe("/blog");
  });
});

describe("the form: publish and unpublish", () => {
  const published = (overrides: Record<string, unknown> = {}) => article({ status: "published", date: "2026-10-12", updatedAt: "2026-10-02T00:00:00.000Z", ...overrides });

  test("'Terbitkan' on a clean form asks the Worker to publish the version that was loaded, once, and shows the result", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const { api } = await openEdit(WRITER, article(), { [`POST ${LIST}/b1/publish`]: () => gate.promise });
    const button = screen.getByRole("button", { name: "Terbitkan" });
    await act(async () => {
      button.click();
      button.click();
    });
    expect(api.count(`POST ${LIST}/b1/publish`)).toBe(1);
    expect(api.count(`PUT ${LIST}/b1`)).toBe(0); // nothing was edited: only the status changes
    expect(api.last(`POST ${LIST}/b1/publish`)?.headers["if-match"]).toBe('"2026-10-01T00:00:00.000Z"');

    await act(async () => gate.resolve(respond({ item: published() })));
    expect(await notice("Artikel berhasil diterbitkan.")).toBeTruthy();
    expect(screen.getByText("Terbit")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kembalikan ke Draf" })).toBeTruthy();
    expect((screen.getByLabelText(/^Slug/) as HTMLInputElement).disabled).toBe(true);
    // The day the Worker gave it is in the form.
    expect((screen.getByLabelText(/^Tanggal Publikasi/) as HTMLInputElement).value).toBe("2026-10-12");
  });

  test("'Terbitkan' with edits saves them first, then publishes the version that save answered", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const { api } = await openEdit(WRITER, article(), {
      [`PUT ${LIST}/b1`]: (call) => {
        order.push("PUT");
        return Promise.resolve(respond({ item: article({ ...(call.body as object), updatedAt: "2026-10-03T00:00:00.000Z" }) }));
      },
      [`POST ${LIST}/b1/publish`]: () => {
        order.push("POST");
        return Promise.resolve(respond({ item: published({ title: "Judul baru", updatedAt: "2026-10-04T00:00:00.000Z" }) }));
      },
    });
    await user.clear(screen.getByLabelText(/^Judul/));
    await user.type(screen.getByLabelText(/^Judul/), "Judul baru");
    await user.click(screen.getByRole("button", { name: "Terbitkan" }));
    expect(await notice("Artikel berhasil diterbitkan.")).toBeTruthy();
    expect(order).toEqual(["PUT", "POST"]);
    expect(api.last(`PUT ${LIST}/b1`)?.headers["if-match"]).toBe('"2026-10-01T00:00:00.000Z"');
    expect(api.last(`POST ${LIST}/b1/publish`)?.headers["if-match"]).toBe('"2026-10-03T00:00:00.000Z"');
  });

  test("if the save is refused nothing is published, and the errors are shown", async () => {
    const user = userEvent.setup();
    const { api } = await openEdit(WRITER, article(), {
      [`PUT ${LIST}/b1`]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { excerpt: "Excerpt minimal 20 karakter" } }, 400),
    });
    await user.clear(screen.getByLabelText(/^Excerpt/));
    await user.type(screen.getByLabelText(/^Excerpt/), "pendek");
    await user.click(screen.getByRole("button", { name: "Terbitkan" }));
    expect(await screen.findByRole("link", { name: "Excerpt: Excerpt minimal 20 karakter" })).toBeTruthy();
    expect(api.count(`POST ${LIST}/b1/publish`)).toBe(0);
  });

  test("a version that went stale is the same warning as for a save", async () => {
    const user = userEvent.setup();
    await openEdit(WRITER, article(), { [`POST ${LIST}/b1/publish`]: respond({ error: "stale", message: "Data ini sudah diubah orang lain sejak kamu membukanya. Muat ulang untuk melihat versi terbaru." }, 409) });
    await user.click(screen.getByRole("button", { name: "Terbitkan" }));
    expect((await screen.findByText(/Data ini sudah diubah orang lain/)).textContent).toContain("Muat ulang");
    expect(screen.getByRole("button", { name: "Muat ulang" })).toBeTruthy();
  });

  test("'Kembalikan ke Draf' unpublishes with the loaded version and unlocks the slug", async () => {
    const user = userEvent.setup();
    const { api } = await openEdit(WRITER, published(), {
      [`POST ${LIST}/b1/unpublish`]: respond({ item: article({ status: "draft", date: "2026-10-12", updatedAt: "2026-10-06T00:00:00.000Z" }) }),
    });
    await user.click(screen.getByRole("button", { name: "Kembalikan ke Draf" }));
    expect(await notice("Artikel dikembalikan menjadi draf.")).toBeTruthy();
    expect(api.last(`POST ${LIST}/b1/unpublish`)?.headers["if-match"]).toBe('"2026-10-02T00:00:00.000Z"');
    expect(screen.getByRole("button", { name: "Terbitkan" })).toBeTruthy();
    expect((screen.getByLabelText(/^Slug/) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText("Draf")).toBeTruthy();
  });

  test("a read-only role is offered neither", async () => {
    await openEdit(["viewer", []], article());
    expect(screen.queryByRole("button", { name: "Terbitkan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Kembalikan ke Draf" })).toBeNull();
    await openEdit(["viewer", []], published()).catch(() => undefined);
  });
});

describe("the form: read-only", () => {
  test("a viewer sees the details and the text on one page, can change none of it, and has no preview or image button", async () => {
    await openEdit(["viewer", []], article({ date: "2026-05-21" }));
    expect(screen.queryByRole("tab")).toBeNull(); // no tabs: both parts are on the page
    expect(panel("Detail").hasAttribute("hidden")).toBe(false);
    expect(panel("Konten").hasAttribute("hidden")).toBe(false);
    expect(screen.getByLabelText(/^Judul/).matches(":disabled")).toBe(true);
    expect(bodyField().readOnly).toBe(true);
    expect(bodyField().value).toContain("## Mulai dari jadwal");
    expect(screen.queryByRole("button", { name: "Simpan Perubahan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sisipkan Gambar" })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Preview/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pilih file" })).toBeNull();
    expect(screen.getByText(/Kamu hanya bisa melihat data ini/)).toBeTruthy();
  });
});

// ------------------------------------------------------------------------------------------------- preview

describe("the preview", () => {
  const PREVIEW = `POST ${PREVIEW_PATH}`;

  test("'Preview' asks the Worker to render the text, shows its HTML, and 'Tulis' brings the text back untouched", async () => {
    const user = userEvent.setup();
    const { api } = await openEdit(WRITER, article(), { [PREVIEW]: respond({ html: "<h2>Mulai dari jadwal</h2>\n<p>Isi <strong>tebal</strong>.</p>" }) });
    await user.click(screen.getByRole("tab", { name: /Konten/ }));
    await user.click(screen.getByRole("tab", { name: /Preview/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "Mulai dari jadwal" })).toBeTruthy();
    expect(api.count(PREVIEW)).toBe(1);
    expect(api.last(PREVIEW)?.body).toEqual({ contentMarkdown: article().contentMarkdown });
    expect(bodyField().hidden).toBe(true);

    await user.click(screen.getByRole("tab", { name: /Tulis/ }));
    expect(bodyField().hidden).toBe(false);
    expect(bodyField().value).toBe(article().contentMarkdown);
    // Back to the preview without having typed: remembered, nothing asked again.
    await user.click(screen.getByRole("tab", { name: /Preview/ }));
    await screen.findByRole("heading", { level: 2, name: "Mulai dari jadwal" });
    expect(api.count(PREVIEW)).toBe(1);
  });

  test("an image of an upload is shown from the files domain, not from this host", async () => {
    const user = userEvent.setup();
    const path = "/uploads/blog-image/2026/0a1b2c3d-1111-4222-8333-444455556666-foto.png";
    await openEdit(WRITER, article(), {
      "GET /api/config": respond({ uploadsBaseUrl: "https://files.example.org" }),
      [PREVIEW]: respond({ html: `<p><span class="block my-6"><img src="${path}" alt="foto" class="rounded-xl"></span></p>` }),
    });
    await user.click(screen.getByRole("tab", { name: /Konten/ }));
    await user.click(screen.getByRole("tab", { name: /Preview/ }));
    await waitFor(() => expect((screen.getByAltText("foto") as HTMLImageElement).getAttribute("src")).toBe(`https://files.example.org${path}`));
  });

  test("an empty text says so and asks for nothing", async () => {
    const user = userEvent.setup();
    const { api } = await openForm(WRITER, "/blog/new", { [PREVIEW]: respond({ html: "<p>x</p>" }) });
    await user.click(screen.getByRole("tab", { name: /Konten/ }));
    await user.click(screen.getByRole("tab", { name: /Preview/ }));
    expect(await screen.findByText("Belum ada isi.")).toBeTruthy();
    expect(api.count(PREVIEW)).toBe(0);
  });

  test("a failure shows its sentence and 'Coba lagi' asks again", async () => {
    const user = userEvent.setup();
    let fail = true;
    const { api } = await openEdit(WRITER, article(), { [PREVIEW]: () => Promise.resolve(fail ? respond({ error: "internal" }, 500) : respond({ html: "<p>Pulih.</p>" })) });
    await user.click(screen.getByRole("tab", { name: /Konten/ }));
    await user.click(screen.getByRole("tab", { name: /Preview/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("Terjadi kesalahan di server. Coba lagi sebentar lagi.");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("Pulih.")).toBeTruthy();
    expect(api.count(PREVIEW)).toBe(2);
  });

  test("the hidden textarea does not stop the error summary: a link to the body shows the writing mode again", async () => {
    const user = userEvent.setup();
    await openEdit(WRITER, article(), {
      [PREVIEW]: respond({ html: "<p>Pratinjau</p>" }),
      [`PUT ${LIST}/b1`]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { title: "Judul minimal 3 karakter", contentMarkdown: "Isi minimal 50 karakter" } }, 400),
    });
    await user.click(screen.getByRole("tab", { name: /Konten/ }));
    await user.click(screen.getByRole("tab", { name: /Preview/ }));
    await screen.findByText("Pratinjau");
    await user.click(screen.getByRole("tab", { name: /Detail/ }));
    await user.type(screen.getByLabelText(/^Judul/), " ");
    await user.clear(screen.getByLabelText(/^Judul/));
    await user.type(screen.getByLabelText(/^Judul/), "ab");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    const summary = await screen.findByRole("alert");
    await user.click(within(summary).getByRole("link", { name: "Isi Artikel: Isi minimal 50 karakter" }));
    expect(bodyField().hidden).toBe(false);
    expect(document.activeElement).toBe(bodyField());
  });
});


// ------------------------------------------------------------------------------------------------- images

describe("inserting an image", () => {
  const png = (name = "foto-siswa.png", size = 2000) => new File([new Uint8Array(size)], name, { type: "image/png" });
  const bodyPicker = () => document.querySelector<HTMLInputElement>("#panel-konten input[type='file']")!;
  const uploaded = (request: UploadRequest) => ({
    ok: true as const,
    result: { id: "u1", path: "/uploads/blog-image/2026/0a1b2c3d-1111-4222-8333-444455556666-foto-siswa.png", contentType: "image/png", size: request.file.size, width: 800, height: 450 },
  });

  test("uploads the file as a blog image and writes its markdown at the cursor, then shows the writing mode", async () => {
    const user = userEvent.setup();
    const requests: UploadRequest[] = [];
    setUploader(async (request) => {
      requests.push(request);
      return uploaded(request);
    });
    await openEdit(WRITER, article({ contentMarkdown: "Paragraf pertama yang cukup panjang untuk contoh.\n\nParagraf kedua yang juga cukup panjang." }));
    await user.click(screen.getByRole("tab", { name: /Konten/ }));
    bodyField().focus();
    bodyField().setSelectionRange(50, 50);
    await user.upload(bodyPicker(), png());

    await waitFor(() => expect(bodyField().value).toContain("![foto siswa](/uploads/blog-image/2026/0a1b2c3d-1111-4222-8333-444455556666-foto-siswa.png)"));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.kind).toBe("blog-image");
    const text = bodyField().value;
    expect(text.startsWith("Paragraf pertama yang cukup panjang untuk contoh.")).toBe(true);
    expect(text.indexOf("![foto siswa]")).toBe(50 + 1); // at the cursor, on its own line
    expect(text.endsWith("Paragraf kedua yang juga cukup panjang.")).toBe(true);
  });

  test("a refusal (a file the kind does not take, a failed upload) is a sentence above the text, and the text is untouched", async () => {
    // Without `applyAccept`, user-event hands over a file the `accept` list does not name (a picker would not let one through).
    const user = userEvent.setup({ applyAccept: false });
    setUploader(async () => ({ ok: false, status: 413, message: "Ukuran file maksimal 5 MB." }));
    await openEdit(WRITER);
    await user.click(screen.getByRole("tab", { name: /Konten/ }));
    const before = bodyField().value;
    await user.upload(bodyPicker(), new File(["x"], "dokumen.pdf", { type: "application/pdf" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP, GIF.");
    await user.upload(bodyPicker(), png("besar.png"));
    expect((await screen.findByText("Ukuran file maksimal 5 MB.")).closest("[role='alert']")).toBeTruthy();
    expect(bodyField().value).toBe(before);
  });

  test("shows 'Mengupload...' and refuses a second picking while one runs", async () => {
    const user = userEvent.setup();
    const gate = deferred<ReturnType<typeof uploaded>>();
    setUploader(() => gate.promise);
    await openEdit(WRITER);
    await user.click(screen.getByRole("tab", { name: /Konten/ }));
    await user.upload(bodyPicker(), png());
    expect(await screen.findByRole("button", { name: "Mengupload..." })).toHaveProperty("disabled", true);
    await act(async () => gate.resolve(uploaded({ file: png(), kind: "blog-image" })));
    expect(await screen.findByRole("button", { name: "Sisipkan Gambar" })).toHaveProperty("disabled", false);
  });
});

// ------------------------------------------------------------------------------------------------- the hero

describe("the hero image", () => {
  test("the field uploads as a blog image, and the saved path is the one the Worker gave", async () => {
    const user = userEvent.setup();
    const path = "/uploads/blog-image/2026/0a1b2c3d-1111-4222-8333-444455556666-sampul.png";
    setUploader(async ({ file }) => ({ ok: true, result: { id: "u9", path, contentType: "image/png", size: file.size, width: 1200, height: 630 } }));
    const { api } = await openEdit(WRITER, article(), { [`PUT ${LIST}/b1`]: (call) => Promise.resolve(respond({ item: article({ ...(call.body as object), imageWidth: 1200, imageHeight: 630, updatedAt: "2026-10-02T00:00:00.000Z" }) })) });
    const field = screen.getByRole("group", { name: /Gambar Hero/ });
    await user.upload(field.querySelector<HTMLInputElement>("input[type='file']")!, new File([new Uint8Array(500)], "sampul.png", { type: "image/png" }));
    await waitFor(() => expect(within(field).getByRole("button", { name: "Ganti" })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await screen.findByText("Artikel berhasil disimpan.");
    expect(api.last(`PUT ${LIST}/b1`)?.body).toMatchObject({ image: path });
    // The size is not sent: the Worker reads it from what it stored at upload.
    expect(api.last(`PUT ${LIST}/b1`)?.body).not.toHaveProperty("imageWidth");
  });

  test("a cover of the legacy blog is kept as it is when the article is saved", async () => {
    const user = userEvent.setup();
    const { api } = await openEdit(WRITER, article({ image: "/blog/images/2026/05/sampul.jpg", imageWidth: 1200, imageHeight: 800 }), {
      [`PUT ${LIST}/b1`]: respond({ item: article({ image: "/blog/images/2026/05/sampul.jpg", updatedAt: "2026-10-02T00:00:00.000Z" }) }),
    });
    await user.type(screen.getByLabelText(/^Judul/), " baru");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await screen.findByText("Artikel berhasil disimpan.");
    expect(api.last(`PUT ${LIST}/b1`)?.body).toMatchObject({ image: "/blog/images/2026/05/sampul.jpg" });
  });
});
