import type { Editor } from "@tiptap/core";
import { articleMarkdown } from "~/pages/blog/editor/serialize";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resetUploadsBase, setUploader, type UploadRequest } from "~/lib/crud/upload-client";
import { API_PATH, PREVIEW_PATH, toBody, toValues } from "~/pages/blog/form";
import { describeCount } from "~/pages/blog/MetaDescriptionField";
import { describeSeoTitleCount } from "~/pages/blog/SeoTitleField";
import { altFromFileName, cleanMetaDescription, formatIsoDay } from "~/pages/blog/rules";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

// The blog screens: the list, the editor with its three tabs (Konten, Publikasi, SEO) under the shell's top bar, the preview, the image insertion, the draft and
// publish states, and what a read-only role is shown. What every block of the kit does by itself is proved in
// test/crud/*; the legacy texts are the ones of app/(admin)/admin/blog.

const LIST = API_PATH;

function article(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1",
    slug: "cara-belajar-efektif",
    title: "Cara Belajar Efektif",
    excerpt: "Ringkasan tentang cara belajar yang efektif untuk siswa.",
    metaDescription: null,
    seoTitle: null,
    noindex: false,
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
  const { contentMarkdown: _markdown, metaDescription: _meta, image: _image, imageWidth: _w, imageHeight: _h, ...rest } = article(overrides);
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

  test("a new article starts with the author the page gives it (the signed-in person's own name), and an opened one keeps its own", () => {
    expect(toValues(null, "Sari Contoh").author).toBe("Sari Contoh");
    expect(toValues(null, "  Sari Contoh  ").author).toBe("Sari Contoh");
    expect(toValues(null, "").author).toBe("Sakola Kembara");
    expect(toValues(null, "   ").author).toBe("Sakola Kembara");
    expect(toValues(null, null).author).toBe("Sakola Kembara");
    expect(toValues(null).author).toBe("Sakola Kembara");
    expect(toValues(article({ author: "Tim Sakola Kembara" }) as never, "Sari Contoh").author).toBe("Tim Sakola Kembara");
  });

  test("the alt text of a picture that has only a file name: the name, without its extension, dashes and underscores as spaces", () => {
    expect(altFromFileName("foto-siswa_belajar.PNG")).toBe("foto siswa belajar");
    expect(altFromFileName("a[b].png")).toBe("a b");
    expect(altFromFileName("tanpa-ekstensi")).toBe("tanpa ekstensi");
  });

  test("the form's values and the body of a save", () => {
    expect(toValues(null, "dzul")).toEqual({ title: "", slug: "", category: "Cerita", excerpt: "", metaDescription: "", seoTitle: "", noindex: false, contentMarkdown: "", author: "dzul", featured: false, date: "", image: "" });
    const item = article({ status: "published", date: "2026-05-21", image: "/uploads/blog-image/2026/a.png" }) as never;
    expect(toBody(toValues(item))).toEqual({
      title: "Cara Belajar Efektif",
      slug: "cara-belajar-efektif",
      category: "Tips",
      excerpt: "Ringkasan tentang cara belajar yang efektif untuk siswa.",
      metaDescription: null,
      seoTitle: null,
      noindex: false,
      contentMarkdown: expect.stringContaining("## Mulai"),
      author: "Dzul",
      featured: false,
      date: "2026-05-21",
      image: "/uploads/blog-image/2026/a.png",
    });
    expect(toBody(toValues(null))).toMatchObject({ date: null, image: null, slug: "", metaDescription: null });
    // A stored description goes back as it is, and an emptied field is `null`, never left out (the key is how a clear is told from "not sent").
    expect(toBody(toValues(article({ metaDescription: "Teks untuk mesin pencari." }) as never)).metaDescription).toBe("Teks untuk mesin pencari.");
    expect(toBody({ ...toValues(article({ metaDescription: "Teks." }) as never), metaDescription: "" })).toHaveProperty("metaDescription", null);
    // SAKEM-109: the SEO title the same way, and noindex as the boolean it is
    expect(toBody(toValues(article({ seoTitle: "Judul untuk Google", noindex: true }) as never))).toMatchObject({ seoTitle: "Judul untuk Google", noindex: true });
    expect(toBody({ ...toValues(article({ seoTitle: "Judul." }) as never), seoTitle: "" })).toHaveProperty("seoTitle", null);
  });

  test("the meta description's counter: what is said, and in which tone, for each length", () => {
    const ideal = "(disarankan 50-160, maksimal 300)";
    expect(describeCount(0, false)).toEqual({ text: `0 karakter ${ideal}`, tone: "neutral" });
    expect(describeCount(1, false)).toEqual({ text: `1 karakter ${ideal}`, tone: "warn" });
    expect(describeCount(49, false).tone).toBe("warn");
    expect(describeCount(50, false)).toEqual({ text: `50 karakter ${ideal}`, tone: "ok" });
    expect(describeCount(160, false)).toEqual({ text: `160 karakter ${ideal}`, tone: "ok" });
    expect(describeCount(161, false)).toEqual({ text: `161 karakter ${ideal}. Bagian akhir bisa terpotong di hasil pencarian.`, tone: "warn" });
    expect(describeCount(300, false)).toEqual({ text: `300 karakter ${ideal}. Bagian akhir bisa terpotong di hasil pencarian.`, tone: "warn" });
    // Over the hard limit it is an error only for a text the Worker would refuse; the one the article already has is allowed to stay.
    expect(describeCount(301, false)).toEqual({ text: "301 karakter, melebihi maksimal 300", tone: "over" });
    expect(describeCount(562, true)).toEqual({ text: `562 karakter ${ideal}. Bagian akhir bisa terpotong di hasil pencarian.`, tone: "warn" });
  });

  test("the cleaning the counter does is the Worker's: invisible characters go, whitespace is one space, the ends are trimmed", () => {
    expect(cleanMetaDescription("  satu \t dua\n\ntiga​  ")).toBe("satu dua tiga");
    expect(cleanMetaDescription("a b")).toBe("a b");
    expect(cleanMetaDescription("​ \u0000")).toBe("");
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

  test("an editor of Konten, and super_admin, get 'Tulis Artikel Baru', Edit and the row's menu (with Hapus in it) on every row", async () => {
    const user = userEvent.setup();
    for (const who of [WRITER, ["super_admin", []]] as Who[]) {
      const view = await openList(who);
      expect(screen.getByRole("link", { name: /Tulis Artikel Baru/ }).getAttribute("href")).toBe("/blog/new");
      expect(screen.getByRole("link", { name: "Edit Kisah Alumni" })).toBeTruthy();
      // Hapus is not next to Edit: the articles' row has a menu for what is not the one thing a row is for.
      expect(screen.queryByRole("button", { name: "Hapus Kisah Alumni" })).toBeNull();
      await user.click(screen.getByRole("button", { name: "Aksi lainnya untuk Kisah Alumni" }));
      expect(screen.getByRole("button", { name: "Hapus" })).toBeTruthy();
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
    await user.click(screen.getByRole("button", { name: "Aksi lainnya untuk Kisah Alumni" }));
    await user.click(screen.getByRole("button", { name: "Hapus" }));
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
  await waitFor(() => expect((screen.getByLabelText(/^Judul(?! SEO)/) as HTMLInputElement).value).toBe(String(item.title)));
  return view;
}

/** The text of the article: TipTap's editable element, which is on the page once the editor's file has loaded. */
const bodyField = () => screen.findByLabelText("Isi Artikel");
/** The TipTap editor behind it (TipTap keeps it on its element). */
const editorOf = async () => ((await bodyField()) as HTMLElement & { editor: Editor }).editor;
/** The Markdown the form would send as the text. */
const markdownOf = async () => articleMarkdown(await editorOf());
/** Writes at the end of the article, as typing there would. */
const writeBody = async (text: string) => {
  const editor = await editorOf();
  await act(async () => void editor.chain().focus("end").insertContent(text).run());
};
/** A panel of the editor by name. By id: the accessible name of a panel that is `hidden` is empty, which would make it unfindable by role. */
const panel = (name: "Konten" | "Publikasi" | "SEO") => document.getElementById(`panel-${name.toLowerCase()}`)!;
/** Opens a tab of the editor (a writer's page has three, in a tablist named "Bagian editor"; a field on a closed tab cannot be typed into). */
const openTab = (user: ReturnType<typeof userEvent.setup>, name: "Konten" | "Publikasi" | "SEO") => user.click(within(screen.getByRole("tablist", { name: "Bagian editor" })).getByRole("tab", { name }));
/** The notice after a save. (Not `getByRole("status")`: the file field keeps a quiet status line of its own.) */
const notice = (text: string) => screen.findByText(text);
/** Writes the Excerpt, which is on Publikasi (the tab stays open after it). */
const typeExcerpt = async (user: ReturnType<typeof userEvent.setup>, text = "Ringkasan tentang cara belajar yang efektif.") => {
  await openTab(user, "Publikasi");
  await user.type(screen.getByLabelText(/^Excerpt/), text);
};

describe("the form: create", () => {
  test("the editor: three tabs with their cards, the legacy defaults, and only Konten open at first", async () => {
    const user = userEvent.setup();
    await openForm(WRITER, "/blog/new");
    expect(screen.getByRole("heading", { level: 1, name: "Tulis Artikel" })).toBeTruthy();
    expect(within(screen.getByRole("tablist", { name: "Bagian editor" })).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Konten", "Publikasi", "SEO"]);
    expect(panel("Konten").hasAttribute("hidden")).toBe(false);
    expect(panel("Publikasi").hasAttribute("hidden")).toBe(true);
    expect(panel("SEO").hasAttribute("hidden")).toBe(true);
    expect(screen.getByLabelText("Judul")).toBeTruthy(); // the title is the first line of the page, not a field in a card
    expect(await screen.findByRole("textbox", { name: "Isi Artikel" })).toBeTruthy();
    // Konten is the page to write and nothing else: the address and the summary are on Publikasi
    expect(panel("Konten").querySelector("#slug, #excerpt")).toBeNull();
    expect(panel("Konten").querySelector("h2")).toBeNull();
    expect(screen.getByRole("button", { name: "Buat Artikel" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Terbitkan" })).toBeNull(); // nothing to publish before it exists

    await openTab(user, "Publikasi");
    for (const name of ["Publikasi", "Informasi Dasar", "Gambar Hero"]) expect(screen.getByRole("heading", { level: 2, name })).toBeTruthy();
    expect(panel("Publikasi").querySelector("#slug")).toBeTruthy();
    expect(panel("Publikasi").querySelector("#excerpt")).toBeTruthy();
    expect(screen.getByText("20-500 karakter. Muncul di list artikel dan SEO description.")).toBeTruthy();
    expect(screen.getByText("Kosongkan agar dibuat otomatis dari judul.")).toBeTruthy();
    expect((screen.getByLabelText(/^Kategori/) as HTMLSelectElement).value).toBe("Cerita");
    expect((screen.getByLabelText(/^Penulis/) as HTMLInputElement).value).toBe("Tester"); // the signed-in person's own name
    expect((screen.getByLabelText(/^Tanggal Publikasi/) as HTMLInputElement).type).toBe("date");
    expect((screen.getByLabelText(/^Tanggal Publikasi/) as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("switch", { name: /Featured/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("Tampilkan sebagai artikel unggulan di blog index.")).toBeTruthy();

    await openTab(user, "SEO");
    expect(screen.getByRole("heading", { level: 2, name: "Mesin Pencari" })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe("Tulis Artikel | Admin Sakola Kembara"));
  });

  test("SAKEM-109: the SEO title is counted as the Worker stores it, and 'Sembunyikan dari Google' is sent as noindex: true", async () => {
    const user = userEvent.setup();
    const { api } = await openForm(WRITER, "/blog/new", { [`POST ${LIST}`]: respond({ item: article({ id: "new-id" }) }, 201), [`GET ${LIST}/new-id`]: respond({ item: article({ id: "new-id" }) }) });
    await openTab(user, "SEO");
    const seo = screen.getByLabelText(/^Judul SEO/);
    // described by its hint and its counter, so a screen reader reads both on focus
    const described = (seo.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "");
    expect(described.join(" | ")).toMatch(/dipakai apa adanya.*\| 0 karakter \(disarankan 30-60, maksimal 70\)$/);
    await user.type(seo, "  Cara   Belajar Efektif untuk Siswa SMA  ");
    expect(screen.getByText("36 karakter (disarankan 30-60, maksimal 70)")).toBeTruthy();
    const box = screen.getByRole("switch", { name: /Sembunyikan dari Google/ });
    expect((box as HTMLInputElement).checked).toBe(false);
    await user.click(box);
    expect((box as HTMLInputElement).checked).toBe(true);
    await openTab(user, "Konten");
    await user.type(screen.getByLabelText(/^Judul(?! SEO)/), "Cara Belajar Efektif");
    await writeBody("Isi artikel yang cukup panjang untuk lolos batas lima puluh karakter.");
    await typeExcerpt(user);
    await user.click(screen.getByRole("button", { name: "Buat Artikel" }));
    await waitFor(() => expect(api.count(`POST ${LIST}`)).toBe(1));
    expect(api.last(`POST ${LIST}`)?.body).toMatchObject({ seoTitle: "  Cara   Belajar Efektif untuk Siswa SMA  ", noindex: true });
    await waitFor(() => expect(location()).toBe("/blog/new-id/edit")); // the save runs to its end before the test does
  });

  test("SAKEM-109: the SEO title counter says, in words, what a result shows and what the Worker refuses", () => {
    const guide = (n: number) => `${n} karakter (disarankan 30-60, maksimal 70)`;
    expect(describeSeoTitleCount(0)).toEqual({ text: guide(0), tone: "neutral" });
    expect(describeSeoTitleCount(12)).toEqual({ text: guide(12), tone: "warn" });
    expect(describeSeoTitleCount(45)).toEqual({ text: guide(45), tone: "ok" });
    expect(describeSeoTitleCount(65)).toEqual({ text: `${guide(65)}. Bagian akhir bisa terpotong di hasil pencarian.`, tone: "warn" });
    expect(describeSeoTitleCount(70).tone).toBe("warn");
    expect(describeSeoTitleCount(71)).toEqual({ text: "71 karakter, melebihi maksimal 70", tone: "over" });
  });

  test("submitting sends the body the Worker takes, once, then opens the edit page with 'berhasil dibuat'", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const { api } = await openForm(WRITER, "/blog/new", {
      [`POST ${LIST}`]: () => gate.promise,
      [`GET ${LIST}/new-id`]: respond({ item: article({ id: "new-id" }) }),
    });
    await user.type(screen.getByLabelText(/^Judul(?! SEO)/), "Cara Belajar Efektif");
    await writeBody("Isi artikel yang cukup panjang untuk lolos batas lima puluh karakter.");
    await typeExcerpt(user);
    await user.selectOptions(screen.getByLabelText(/^Kategori/), "Tips");
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
      metaDescription: null,
      seoTitle: null,
      noindex: false,
      contentMarkdown: "Isi artikel yang cukup panjang untuk lolos batas lima puluh karakter.",
      author: "Tester",
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
      [`POST ${LIST}`]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { contentMarkdown: "Isi minimal 50 karakter", seoTitle: "Judul SEO terlalu panjang" } }, 400),
    });
    await user.type(screen.getByLabelText(/^Judul(?! SEO)/), "Judul yang sah");
    await typeExcerpt(user); // the form is refused from another tab (Publikasi): the editor goes back to the one with the first error
    await user.click(screen.getByRole("button", { name: "Buat Artikel" }));

    const summary = await screen.findByRole("alert");
    // The first error is in the body: the Konten tab is shown, and both tabs carry the red dot.
    await waitFor(() => expect(panel("Konten").hasAttribute("hidden")).toBe(false));
    expect(panel("SEO").hasAttribute("hidden")).toBe(true);
    expect(screen.getAllByRole("img", { name: "Ada kesalahan" })).toHaveLength(2);
    await waitFor(async () => expect((await bodyField()).getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText("Isi minimal 50 karakter", { selector: "span" })).toBeTruthy();

    // The SEO title is on the other tab: its link shows the tab, then puts the cursor in the field.
    await user.click(within(summary).getByRole("link", { name: "Judul SEO: Judul SEO terlalu panjang" }));
    expect(panel("SEO").hasAttribute("hidden")).toBe(false);
    expect(document.activeElement).toBe(screen.getByLabelText(/^Judul SEO/));
    expect(screen.getByLabelText(/^Judul SEO/).getAttribute("aria-invalid")).toBe("true");
  });

  test("an Excerpt left empty is not stopped by the browser on a tab nobody sees: the save reaches the Worker, which refuses it, and Publikasi opens at the Excerpt", async () => {
    const user = userEvent.setup();
    const { api } = await openForm(WRITER, "/blog/new", {
      [`POST ${LIST}`]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { excerpt: "Excerpt minimal 20 karakter" } }, 400),
    });
    await user.type(screen.getByLabelText(/^Judul(?! SEO)/), "Judul yang sah");
    await writeBody("Isi artikel yang cukup panjang untuk lolos batas lima puluh karakter.");
    const excerpt = screen.getByLabelText(/^Excerpt/) as HTMLTextAreaElement;
    expect(excerpt.required).toBe(false); // a `required` one on a hidden tab makes the browser refuse the save without a word
    expect(excerpt.getAttribute("aria-required")).toBe("true"); // and a screen reader still hears that it is needed
    await user.click(screen.getByRole("button", { name: "Buat Artikel" }));
    await waitFor(() => expect(api.count(`POST ${LIST}`)).toBe(1)); // sent: nothing stopped it on the way
    await waitFor(() => expect(panel("Publikasi").hasAttribute("hidden")).toBe(false));
    expect(panel("Konten").hasAttribute("hidden")).toBe(true);
    expect(excerpt.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Excerpt minimal 20 karakter", { selector: "p" })).toBeTruthy();
  });

  test("a slug that is taken is a message on the slug field, with the slug tab shown", async () => {
    const user = userEvent.setup();
    await openForm(WRITER, "/blog/new", { [`POST ${LIST}`]: respond({ error: "conflict", message: "Data bentrok dengan data lain yang sudah ada.", fields: { slug: "Slug sudah dipakai" } }, 409) });
    await user.type(screen.getByLabelText(/^Judul(?! SEO)/), "Judul yang sah");
    await typeExcerpt(user);
    await user.type(screen.getByLabelText(/^Slug/), "halo");
    await openTab(user, "Konten"); // saved from another tab: the page has to bring the person back to the slug
    await user.click(screen.getByRole("button", { name: "Buat Artikel" }));
    expect(await screen.findByText("Slug sudah dipakai", { selector: "p" })).toBeTruthy();
    await waitFor(() => expect(panel("Publikasi").hasAttribute("hidden")).toBe(false));
    expect(screen.getByLabelText(/^Slug/).getAttribute("aria-invalid")).toBe("true");
  });

  test("leaving with typed text asks first: the body counts as a change", async () => {
    const user = userEvent.setup();
    await openForm(WRITER, "/blog/new");
    await writeBody("Sebuah draf yang belum disimpan.");
    await user.click(screen.getByRole("link", { name: "Batal" }));
    expect(await screen.findByRole("alertdialog", { name: "Tinggalkan halaman?" })).toBeTruthy();
    expect(location()).toBe("/blog/new");
  });
});

describe("the form: edit", () => {
  test("the article is loaded into all three tabs, and saving sends If-Match of the version loaded", async () => {
    const user = userEvent.setup();
    const loaded = article({ date: "2026-05-21", featured: true, category: "News" });
    const { api } = await openEdit(WRITER, loaded, {
      [`PUT ${LIST}/b1`]: respond({ item: { ...loaded, title: "Judul baru", updatedAt: "2026-10-02T00:00:00.000Z" } }),
    });
    expect(screen.getByRole("heading", { level: 1, name: "Edit Artikel" })).toBeTruthy();
    expect((screen.getByLabelText(/^Slug/) as HTMLInputElement).value).toBe("cara-belajar-efektif");
    expect((screen.getByLabelText(/^Slug/) as HTMLInputElement).disabled).toBe(false); // a draft
    expect(screen.getByText("Alamat artikel: /blog/slug. Bisa diubah selama artikel masih draf.")).toBeTruthy();
    expect(await markdownOf()).toContain("## Mulai dari jadwal");
    expect(within(await bodyField()).getByRole("heading", { level: 2, name: "Mulai dari jadwal" })).toBeTruthy(); // drawn as a heading, not as "##"
    expect(screen.getByText("/blog/cara-belajar-efektif")).toBeTruthy();
    // The status is in the top bar, next to the breadcrumb, and on the Publikasi tab.
    expect(await within(screen.getByRole("navigation", { name: "Breadcrumb" }).parentElement!).findByText("Draf")).toBeTruthy();
    expect(await within(screen.getByRole("navigation", { name: "Breadcrumb" })).findByText("Cara Belajar Efektif")).toBeTruthy();

    await openTab(user, "Publikasi");
    expect((screen.getByLabelText(/^Kategori/) as HTMLSelectElement).value).toBe("News");
    expect((screen.getByLabelText(/^Tanggal Publikasi/) as HTMLInputElement).value).toBe("2026-05-21");
    expect((screen.getByRole("switch", { name: /Featured/ }) as HTMLInputElement).checked).toBe(true);
    expect(within(panel("Publikasi")).getByText("Draf")).toBeTruthy();

    await openTab(user, "Konten");
    await user.clear(screen.getByLabelText(/^Judul(?! SEO)/));
    await user.type(screen.getByLabelText(/^Judul(?! SEO)/), "Judul baru");
    await user.click(screen.getByRole("button", { name: "Simpan" }));
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
    await waitFor(() => expect((screen.getByLabelText(/^Judul(?! SEO)/) as HTMLInputElement).value).toBe("Cara Belajar Efektif"));
    await user.type(screen.getByLabelText(/^Judul(?! SEO)/), " saya");
    await user.click(screen.getByRole("button", { name: "Simpan" }));
    expect((await screen.findByText(/Data ini sudah diubah orang lain/)).textContent).toContain("Perubahan yang belum disimpan akan hilang");

    served = article({ title: "Dari orang lain", updatedAt: "2026-10-05T00:00:00.000Z" });
    await user.click(screen.getByRole("button", { name: "Muat ulang" }));
    await waitFor(() => expect((screen.getByLabelText(/^Judul(?! SEO)/) as HTMLInputElement).value).toBe("Dari orang lain"));
    expect(api.count(`GET ${LIST}/b1`)).toBe(2);
  });

  test("a published article: the slug is locked and says so, the date is required, and the button takes it back to a draft", async () => {
    const user = userEvent.setup();
    await openEdit(WRITER, article({ status: "published", date: "2026-05-21" }));
    const slug = screen.getByLabelText(/^Slug/) as HTMLInputElement;
    expect(slug.disabled).toBe(true);
    expect(screen.getByText("Slug tidak bisa diubah setelah artikel terbit.")).toBeTruthy();
    // One way to save, and the status is in the top bar.
    expect(screen.getByRole("button", { name: "Simpan Perubahan" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Simpan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Terbitkan" })).toBeNull();
    expect(await within(screen.getByRole("navigation", { name: "Breadcrumb" }).parentElement!).findByText("Terbit")).toBeTruthy();

    await openTab(user, "Publikasi");
    expect((screen.getByLabelText(/^Tanggal Publikasi/) as HTMLInputElement).required).toBe(true);
    expect(screen.queryByText("Kosongkan agar terisi otomatis saat diterbitkan.")).toBeNull();
    expect(within(panel("Publikasi")).getByText("Terbit")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kembalikan ke Draf" })).toBeTruthy();
  });

  test("a draft's date field says it fills itself when the article is published", async () => {
    await openEdit(WRITER);
    expect(screen.getByText("Kosongkan agar terisi otomatis saat diterbitkan.")).toBeTruthy();
    expect((screen.getByLabelText(/^Tanggal Publikasi/) as HTMLInputElement).required).toBe(false);
  });

  describe("'Lihat di publik'", () => {
    const config = (siteUrl: unknown) => ({ "GET /api/config": respond({ google: false, uploadsBaseUrl: "", siteUrl }) });
    const published = (overrides: Record<string, unknown> = {}) => article({ status: "published", date: "2026-05-21", ...overrides });

    test("a published article links to its page on the public site (siteUrl of /api/config + /blog/<slug>), in a new tab, and the config is asked for once", async () => {
      const user = userEvent.setup();
      const { api } = await openEdit(WRITER, published(), config("https://sakolakembara.org"));
      await openTab(user, "Publikasi"); // the article's address is on Publikasi, under the Slug
      const link = await screen.findByRole("link", { name: "Lihat di publik" });
      expect(link.getAttribute("href")).toBe("https://sakolakembara.org/blog/cara-belajar-efektif");
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(api.count("GET /api/config")).toBe(1);
    });

    test("a viewer is offered it too: it only reads", async () => {
      await openEdit(["viewer", []], published(), config("https://sakolakembara.org"));
      expect((await screen.findByRole("link", { name: "Lihat di publik" })).getAttribute("href")).toBe("https://sakolakembara.org/blog/cara-belajar-efektif");
    });

    test("a draft is not on the site, so it has no link", async () => {
      const user = userEvent.setup();
      const { api } = await openEdit(WRITER, article(), config("https://sakolakembara.org"));
      await waitFor(() => expect(api.count("GET /api/config")).toBe(1));
      await openTab(user, "Publikasi"); // look where the link would be: a closed tab would answer "none" whatever it holds
      expect(within(panel("Publikasi")).getByText("Tautan:")).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Lihat di publik" })).toBeNull();
    });

    test("without the site's address (empty, missing, or not an origin) there is no link, and no guess", async () => {
      const user = userEvent.setup();
      for (const siteUrl of ["", undefined, "sakolakembara.org", "javascript:alert(1)", "https://sakolakembara.org/blog"]) {
        resetUploadsBase();
        const { api, unmount } = await openEdit(WRITER, published(), config(siteUrl));
        await waitFor(() => expect(api.count("GET /api/config")).toBe(1));
        await openTab(user, "Publikasi"); // look where the link would be
        expect(within(panel("Publikasi")).getByText("Tautan:"), String(siteUrl)).toBeTruthy();
        expect(screen.queryByRole("link", { name: "Lihat di publik" }), String(siteUrl)).toBeNull();
        unmount();
      }
    });

    test("an answer of /api/config that cannot be read leaves the editor working, without the link", async () => {
      const user = userEvent.setup();
      const { api } = await openEdit(WRITER, published(), { "GET /api/config": respond({ error: "internal" }, 500) });
      expect(screen.getByRole("button", { name: "Simpan Perubahan" })).toBeTruthy();
      await waitFor(() => expect(api.count("GET /api/config")).toBe(1));
      await openTab(user, "Publikasi"); // look where the link would be
      expect(within(panel("Publikasi")).getByText("Tautan:")).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Lihat di publik" })).toBeNull();
    });
  });

  test("an article that is gone: the sentence and a way back", async () => {
    stubApi({ "GET /api/me": respond(meBody(...WRITER)), [`GET ${LIST}/gone`]: respond({ error: "not_found", message: "Data tidak ditemukan. Mungkin sudah dihapus." }, 404) });
    renderApp("/blog/gone/edit");
    expect((await screen.findByRole("alert")).textContent).toBe("Data tidak ditemukan. Mungkin sudah dihapus.");
    expect(screen.getByRole("link", { name: "Kembali ke daftar" }).getAttribute("href")).toBe("/blog");
  });
});

describe("the form: the meta description (SAKEM-094)", () => {
  const HINT = "Tampil di bawah judul pada hasil pencarian. Kosongkan untuk memakai Excerpt.";
  const field = () => screen.getByLabelText("Deskripsi meta") as HTMLTextAreaElement;
  const counter = () => document.getElementById("metaDescription-count")!;
  const ideal = "(disarankan 50-160, maksimal 300)";
  /** 562 characters, the longest of the migrated descriptions: over the limit, but the one the article has. */
  const LONG = "Sakola Kembara membuka pintu pendidikan tinggi bagi siswa dari daerah terpencil. ".repeat(7).slice(0, 562).trim();
  const typeIn = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
    await user.click(field());
    await user.paste(text);
  };

  test("an optional textarea after the SEO title, in Mesin Pencari, with the hint and a counter that read on focus", async () => {
    const user = userEvent.setup();
    await openForm(WRITER, "/blog/new");
    await openTab(user, "SEO");
    const card = screen.getByRole("heading", { level: 2, name: "Mesin Pencari" }).closest("[data-slot='card']")!;
    expect(card.contains(field())).toBe(true);
    // Right after the SEO title.
    expect(screen.getByLabelText(/^Judul SEO/).compareDocumentPosition(field()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Optional: no asterisk on its label, no `required` on the control.
    expect(screen.getByText("Deskripsi meta", { selector: "label" }).textContent).toBe("Deskripsi meta");
    expect(field().required).toBe(false);
    expect(field().tagName).toBe("TEXTAREA");
    expect(field().value).toBe("");
    expect(screen.getByText(HINT)).toBeTruthy();
    expect(counter().textContent).toBe(`0 karakter ${ideal}`);
    // Described by the hint and the counter, so a screen reader hears both when the field is focused.
    const described = field().getAttribute("aria-describedby")!.split(" ");
    expect(described).toEqual(["metaDescription-hint", "metaDescription-count"]);
    for (const id of described) expect(document.getElementById(id)).toBeTruthy();
    expect(counter().getAttribute("aria-live")).toBeNull(); // not announced on every key
  });

  test("the counter counts what the Worker will store, and says how that compares with a search result, in words as well as in colour", async () => {
    const user = userEvent.setup();
    await openForm(WRITER, "/blog/new");
    await openTab(user, "SEO");
    await typeIn(user, "  halo   dunia \n ");
    expect(counter().textContent).toBe(`10 karakter ${ideal}`); // trimmed, one space between the words
    expect(counter().className).toContain("text-warning-fg"); // under 50

    await user.clear(field());
    await typeIn(user, "x".repeat(50));
    expect(counter().textContent).toBe(`50 karakter ${ideal}`);
    expect(counter().className).toContain("text-success-fg");

    await user.clear(field());
    await typeIn(user, "x".repeat(160));
    expect(counter().className).toContain("text-success-fg");
    await user.type(field(), "y");
    expect(counter().textContent).toBe(`161 karakter ${ideal}. Bagian akhir bisa terpotong di hasil pencarian.`);
    expect(counter().className).toContain("text-warning-fg");

    await user.clear(field());
    await typeIn(user, "x".repeat(300));
    expect(counter().className).toContain("text-warning-fg");
    await user.type(field(), "y");
    expect(counter().textContent).toBe("301 karakter, melebihi maksimal 300");
    expect(counter().className).toContain("text-danger-fg");
    // Nothing stops the writer: the field keeps what was typed, and the Worker is the one that refuses.
    expect(field().value).toHaveLength(301);

    await user.clear(field());
    expect(counter().textContent).toBe(`0 karakter ${ideal}`);
    expect(counter().className).toContain("text-gray-500");
  });

  test("the text goes to the Worker as typed, and an emptied field as null; a new article sends it in the create", async () => {
    const user = userEvent.setup();
    const { api } = await openForm(WRITER, "/blog/new", { [`POST ${LIST}`]: respond({ item: article({ id: "new-id" }) }, 201), [`GET ${LIST}/new-id`]: respond({ item: article({ id: "new-id" }) }) });
    await user.type(screen.getByLabelText(/^Judul(?! SEO)/), "Cara Belajar Efektif");
    await writeBody("Isi artikel yang cukup panjang untuk lolos batas lima puluh karakter.");
    await typeExcerpt(user);
    await openTab(user, "SEO");
    await typeIn(user, "Cara belajar efektif untuk siswa.");
    await user.click(screen.getByRole("button", { name: "Buat Artikel" }));
    await waitFor(() => expect(api.count(`POST ${LIST}`)).toBe(1));
    expect(api.last(`POST ${LIST}`)?.body).toMatchObject({ metaDescription: "Cara belajar efektif untuk siswa." });
  });

  test("an article opens with its description, saves it back as it is, and a cleared field is sent as null", async () => {
    const user = userEvent.setup();
    const loaded = article({ metaDescription: "Cara belajar efektif untuk siswa." });
    const { api } = await openEdit(WRITER, loaded, {
      [`PUT ${LIST}/b1`]: (call) => Promise.resolve(respond({ item: article({ ...(call.body as object), updatedAt: "2026-10-02T00:00:00.000Z" }) })),
    });
    expect(field().value).toBe("Cara belajar efektif untuk siswa.");
    expect(counter().textContent).toBe(`33 karakter ${ideal}`);
    // Nothing changed in it: the stored text goes back.
    await user.clear(screen.getByLabelText(/^Judul(?! SEO)/));
    await user.type(screen.getByLabelText(/^Judul(?! SEO)/), "Judul baru");
    await user.click(screen.getByRole("button", { name: "Simpan" }));
    expect(await notice("Artikel berhasil disimpan.")).toBeTruthy();
    expect(api.last(`PUT ${LIST}/b1`)?.body).toMatchObject({ title: "Judul baru", metaDescription: "Cara belajar efektif untuk siswa." });

    // Emptied: the key is there, null. (The form started again from the saved article, on its first tab.)
    await openTab(user, "SEO");
    await user.clear(field());
    await user.click(screen.getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(api.count(`PUT ${LIST}/b1`)).toBe(2));
    expect(api.last(`PUT ${LIST}/b1`)?.body).toMatchObject({ metaDescription: null });
    expect(api.last(`PUT ${LIST}/b1`)?.headers["if-match"]).toBe('"2026-10-02T00:00:00.000Z"');
  });

  test("a description over the maximum that the article already has is a warning, not an error; a different long text is the error", async () => {
    const user = userEvent.setup();
    const { api } = await openEdit(WRITER, article({ metaDescription: LONG }), {
      [`PUT ${LIST}/b1`]: (call) => Promise.resolve(respond({ item: article({ ...(call.body as object), updatedAt: "2026-10-02T00:00:00.000Z" }) })),
    });
    await openTab(user, "SEO");
    expect(field().value).toBe(LONG);
    expect(counter().textContent).toBe(`562 karakter ${ideal}. Bagian akhir bisa terpotong di hasil pencarian.`);
    expect(counter().className).toContain("text-warning-fg");

    await user.type(field(), " Tambahan.");
    expect(counter().textContent).toContain("melebihi maksimal 300");
    expect(counter().className).toContain("text-danger-fg");

    // Back to the stored text (typed with other spacing: the cleaned text is what counts).
    await user.clear(field());
    await typeIn(user, `  ${LONG}  `);
    expect(counter().className).toContain("text-warning-fg");

    // And the form sends it untouched, which the Worker accepts for the stored one.
    await user.click(screen.getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(api.count(`PUT ${LIST}/b1`)).toBe(1));
    expect(((api.last(`PUT ${LIST}/b1`)?.body as { metaDescription: string }).metaDescription).trim()).toBe(LONG);
  });

  test("the Worker's refusal is a message under the field in place of the hint, the summary links to it, and the counter stays", async () => {
    const user = userEvent.setup();
    await openEdit(WRITER, article(), {
      [`PUT ${LIST}/b1`]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { metaDescription: "Deskripsi meta hanya boleh berupa teks biasa, tanpa tag HTML" } }, 400),
    });
    await openTab(user, "SEO");
    await typeIn(user, "<b>tebal</b>");
    await user.click(screen.getByRole("button", { name: "Simpan" }));
    const summary = await screen.findByRole("alert");
    expect(await screen.findByText("Deskripsi meta hanya boleh berupa teks biasa, tanpa tag HTML", { selector: "p" })).toBeTruthy();
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(field().getAttribute("aria-describedby")).toBe("metaDescription-error metaDescription-count");
    expect(screen.queryByText(HINT)).toBeNull(); // the Field shows the error in its place
    expect(counter().textContent).toBe(`12 karakter ${ideal}`);
    expect(panel("SEO").hasAttribute("hidden")).toBe(false); // it is on the SEO tab, which is where the error opens
    await user.click(within(summary).getByRole("link", { name: "Deskripsi meta: Deskripsi meta hanya boleh berupa teks biasa, tanpa tag HTML" }));
    expect(document.activeElement).toBe(field());
  });

  test("typing in it is a change: leaving asks first", async () => {
    const user = userEvent.setup();
    await openEdit(WRITER);
    await openTab(user, "SEO");
    await typeIn(user, "Belum disimpan.");
    await user.click(screen.getByRole("link", { name: "Batal" }));
    expect(await screen.findByRole("alertdialog", { name: "Tinggalkan halaman?" })).toBeTruthy();
  });

  test("'Terbitkan' saves a description typed since the last save, then publishes", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const { api } = await openEdit(WRITER, article(), {
      [`PUT ${LIST}/b1`]: (call) => {
        order.push("PUT");
        return Promise.resolve(respond({ item: article({ ...(call.body as object), updatedAt: "2026-10-03T00:00:00.000Z" }) }));
      },
      [`POST ${LIST}/b1/publish`]: () => {
        order.push("POST");
        return Promise.resolve(respond({ item: article({ status: "published", date: "2026-10-12", metaDescription: "Siap terbit.", updatedAt: "2026-10-04T00:00:00.000Z" }) }));
      },
    });
    await openTab(user, "SEO");
    await typeIn(user, "Siap terbit.");
    await user.click(screen.getByRole("button", { name: "Terbitkan" }));
    expect(await notice("Artikel berhasil diterbitkan.")).toBeTruthy();
    expect(order).toEqual(["PUT", "POST"]);
    expect(api.last(`PUT ${LIST}/b1`)?.body).toMatchObject({ metaDescription: "Siap terbit." });
    expect(field().value).toBe("Siap terbit."); // the form starts again from what the Worker answered
  });

  test("a viewer sees it and cannot change it", async () => {
    await openEdit(["viewer", []], article({ metaDescription: "Cara belajar efektif untuk siswa." }));
    expect(field().value).toBe("Cara belajar efektif untuk siswa.");
    expect(field().matches(":disabled")).toBe(true);
  });
});

describe("the form: publish and unpublish", () => {
  const published =(overrides: Record<string, unknown> = {}) => article({ status: "published", date: "2026-10-12", updatedAt: "2026-10-02T00:00:00.000Z", ...overrides });

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
    expect(await within(screen.getByRole("navigation", { name: "Breadcrumb" }).parentElement!).findByText("Terbit")).toBeTruthy();
    expect((screen.getByLabelText(/^Slug/) as HTMLInputElement).disabled).toBe(true);
    await openTab(user, "Publikasi");
    expect(screen.getByRole("button", { name: "Kembalikan ke Draf" })).toBeTruthy();
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
    await user.clear(screen.getByLabelText(/^Judul(?! SEO)/));
    await user.type(screen.getByLabelText(/^Judul(?! SEO)/), "Judul baru");
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
    await openTab(user, "Publikasi");
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
    await openTab(user, "Publikasi");
    await user.click(screen.getByRole("button", { name: "Kembalikan ke Draf" }));
    expect(await notice("Artikel dikembalikan menjadi draf.")).toBeTruthy();
    expect(api.last(`POST ${LIST}/b1/unpublish`)?.headers["if-match"]).toBe('"2026-10-02T00:00:00.000Z"');
    expect(screen.getByRole("button", { name: "Terbitkan" })).toBeTruthy();
    expect((screen.getByLabelText(/^Slug/) as HTMLInputElement).disabled).toBe(false);
    expect(await within(screen.getByRole("navigation", { name: "Breadcrumb" }).parentElement!).findByText("Draf")).toBeTruthy();
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
    expect(screen.queryByRole("tab")).toBeNull(); // no tabs: all three parts are on the page
    for (const name of ["Konten", "Publikasi", "SEO"] as const) expect(panel(name).hasAttribute("hidden"), name).toBe(false);
    expect(screen.getByLabelText(/^Judul(?! SEO)/).matches(":disabled")).toBe(true);
    const body = await bodyField();
    expect(body.getAttribute("contenteditable")).toBe("false");
    expect(body.getAttribute("aria-readonly")).toBe("true");
    expect(within(body).getByRole("heading", { level: 2, name: "Mulai dari jadwal" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Simpan Perubahan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sisipkan Gambar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pratinjau" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pilih file" })).toBeNull();
    expect(screen.getByText(/Kamu hanya bisa melihat data ini/)).toBeTruthy();
  });
});

// ------------------------------------------------------------------------------------------------- preview

describe("the preview", () => {
  const PREVIEW = `POST ${PREVIEW_PATH}`;

  test("'Pratinjau' is a button of the top bar, and under the text there is only the count", async () => {
    await openEdit(WRITER, article());
    const button = screen.getByRole("button", { name: "Pratinjau" });
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).closest("header")!.contains(button)).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    const footer = document.getElementById("contentMarkdown-count")!.parentElement!;
    expect(within(footer).queryAllByRole("button")).toHaveLength(0); // no "Sisipkan Gambar" and no "Pratinjau" a long scroll under the text
    expect(screen.queryByRole("button", { name: "Sisipkan Gambar" })).toBeNull();
  });

  test("on a phone the button is its icon (the word is only for a screen reader), so four buttons fit in the bar at the bottom", async () => {
    await openEdit(WRITER, article());
    const word = screen.getByText("Pratinjau");
    expect(word.className).toContain("max-md:sr-only");
    expect(screen.getByRole("button", { name: "Pratinjau" })).toBeTruthy(); // still its name
  });

  test("'Pratinjau' works from any tab: it brings the person to the text, and the button then says 'Kembali menulis'", async () => {
    const user = userEvent.setup();
    await openEdit(WRITER, article(), { [PREVIEW]: respond({ html: "<p>Isi pratinjau.</p>" }) });
    await openTab(user, "SEO");
    await user.click(screen.getByRole("button", { name: "Pratinjau" }));
    await waitFor(() => expect(panel("Konten").hasAttribute("hidden")).toBe(false));
    expect(panel("SEO").hasAttribute("hidden")).toBe(true);
    expect(await screen.findByText("Isi pratinjau.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kembali menulis" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Kembali menulis" }));
    expect(await bodyField()).toBeTruthy(); // the text is back
    expect(screen.getByRole("button", { name: "Pratinjau" }).getAttribute("aria-pressed")).toBe("false");
  });

  test("'Pratinjau' asks the Worker to render the text, shows its HTML, and 'Kembali menulis' brings the text back, edits included", async () => {
    const user = userEvent.setup();
    const { api } = await openEdit(WRITER, article(), { [PREVIEW]: respond({ html: "<h2>Mulai dari jadwal</h2>\n<p>Isi <strong>tebal</strong>.</p>" }) });
    await writeBody(" Tambahan.");
    await user.click(screen.getByRole("button", { name: "Pratinjau" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Mulai dari jadwal" })).toBeTruthy();
    expect(api.count(PREVIEW)).toBe(1);
    expect(api.last(PREVIEW)?.body).toEqual({ contentMarkdown: `${article().contentMarkdown} Tambahan.` });
    expect(screen.queryByLabelText("Isi Artikel")).toBeNull(); // the editor is not on the page while the preview is
    expect(screen.queryByRole("button", { name: "Sisipkan Gambar" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Kembali menulis" }));
    expect(await markdownOf()).toBe(`${article().contentMarkdown} Tambahan.`);
    // Back to the preview without having typed: remembered, nothing asked again.
    await user.click(screen.getByRole("button", { name: "Pratinjau" }));
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
    await user.click(await screen.findByRole("button", { name: "Pratinjau" }));
    await waitFor(() => expect((screen.getByAltText("foto") as HTMLImageElement).getAttribute("src")).toBe(`https://files.example.org${path}`));
  });

  test("the hero picture of an older article (a path of the public site) is previewed from the public site", async () => {
    const user = userEvent.setup();
    const path = "/blog/images/2026/02/sampul-lama.jpg";
    await openEdit(WRITER, article({ image: path }) as never, { "GET /api/config": respond({ uploadsBaseUrl: "https://files.example.org", siteUrl: "https://sakolakembara.org" }) });
    await openTab(user, "Publikasi");
    await waitFor(() => expect((screen.getByAltText(/^Pratinjau/) as HTMLImageElement).getAttribute("src")).toBe(`https://sakolakembara.org${path}`));
  });

  test("an image of the older articles (a path of the public site) is shown from the public site in the preview too", async () => {
    const user = userEvent.setup();
    const path = "/blog/images/2026/02/foto-lama.jpg";
    await openEdit(WRITER, article(), {
      "GET /api/config": respond({ uploadsBaseUrl: "https://files.example.org", siteUrl: "https://sakolakembara.org" }),
      [PREVIEW]: respond({ html: `<p><img src="${path}" alt="lama"></p>` }),
    });
    await user.click(await screen.findByRole("button", { name: "Pratinjau" }));
    await waitFor(() => expect((screen.getByAltText("lama") as HTMLImageElement).getAttribute("src")).toBe(`https://sakolakembara.org${path}`));
  });

  test("an empty text says so and asks for nothing", async () => {
    const user = userEvent.setup();
    const { api } = await openForm(WRITER, "/blog/new", { [PREVIEW]: respond({ html: "<p>x</p>" }) });
    await user.click(await screen.findByRole("button", { name: "Pratinjau" }));
    expect(await screen.findByText("Belum ada isi.")).toBeTruthy();
    expect(api.count(PREVIEW)).toBe(0);
  });

  test("a failure shows its sentence and 'Coba lagi' asks again", async () => {
    const user = userEvent.setup();
    let fail = true;
    const { api } = await openEdit(WRITER, article(), { [PREVIEW]: () => Promise.resolve(fail ? respond({ error: "internal" }, 500) : respond({ html: "<p>Pulih.</p>" })) });
    await user.click(await screen.findByRole("button", { name: "Pratinjau" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Terjadi kesalahan di server. Coba lagi sebentar lagi.");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("Pulih.")).toBeTruthy();
    expect(api.count(PREVIEW)).toBe(2);
  });

  test("the preview does not stop the error summary: a link to the body shows the writing page again", async () => {
    const user = userEvent.setup();
    await openEdit(WRITER, article(), {
      [PREVIEW]: respond({ html: "<p>Pratinjau</p>" }),
      [`PUT ${LIST}/b1`]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { title: "Judul minimal 3 karakter", contentMarkdown: "Isi minimal 50 karakter" } }, 400),
    });
    await user.click(await screen.findByRole("button", { name: "Pratinjau" }));
    await screen.findByText("Pratinjau", { selector: "p" });
    await user.type(screen.getByLabelText(/^Judul(?! SEO)/), " ");
    await user.clear(screen.getByLabelText(/^Judul(?! SEO)/));
    await user.type(screen.getByLabelText(/^Judul(?! SEO)/), "ab");
    await user.click(screen.getByRole("button", { name: "Simpan" }));
    const summary = await screen.findByRole("alert");
    await user.click(within(summary).getByRole("link", { name: "Isi Artikel: Isi minimal 50 karakter" }));
    const body = await bodyField(); // the link shows the writing page again, then puts the cursor in it
    expect(document.activeElement).toBe(body);
  });
});


// ------------------------------------------------------------------------------------------------- images

describe("inserting an image", () => {
  const png = (name = "foto-siswa.png", size = 2000) => new File([new Uint8Array(size)], name, { type: "image/png" });
  const bodyPicker = async () => {
    await bodyField(); // the picker is part of the editor, which loads when it is first shown
    return document.querySelector<HTMLInputElement>("#panel-konten input[type='file']")!;
  };
  const uploaded = (request: UploadRequest) => ({
    ok: true as const,
    result: { id: "u1", path: "/uploads/blog-image/2026/0a1b2c3d-1111-4222-8333-444455556666-foto-siswa.png", contentType: "image/png", size: request.file.size, width: 800, height: 450 },
  });

  test("uploads the file as a blog image and writes it into the text at the cursor, with alt text made from its name", async () => {
    const user = userEvent.setup();
    const requests: UploadRequest[] = [];
    setUploader(async (request) => {
      requests.push(request);
      return uploaded(request);
    });
    const first = "Paragraf pertama yang cukup panjang untuk contoh.";
    await openEdit(WRITER, article({ contentMarkdown: `${first}\n\nParagraf kedua yang juga cukup panjang.` }));
    const editor = await editorOf();
    await act(async () => void editor.chain().focus().setTextSelection(1 + first.length).run());
    await user.upload(await bodyPicker(), png());

    const path = "/uploads/blog-image/2026/0a1b2c3d-1111-4222-8333-444455556666-foto-siswa.png";
    await waitFor(async () => expect(await markdownOf()).toContain(`![foto siswa](${path})`));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.kind).toBe("blog-image");
    const text = await markdownOf();
    expect(text.startsWith(first)).toBe(true);
    expect(text.indexOf("![foto siswa]")).toBeGreaterThan(first.length - 1); // after the first paragraph, where the cursor was
    expect(text.indexOf("![foto siswa]")).toBeLessThan(text.indexOf("Paragraf kedua"));
    expect(text.endsWith("Paragraf kedua yang juga cukup panjang.")).toBe(true);
    expect((await bodyField()).querySelector('img[alt="foto siswa"]')?.getAttribute("src")).toBe(path); // drawn in the page
  });

  test("a refusal (a file the kind does not take, a failed upload) is a sentence above the text, and the text is untouched", async () => {
    // Without `applyAccept`, user-event hands over a file the `accept` list does not name (a picker would not let one through).
    const user = userEvent.setup({ applyAccept: false });
    setUploader(async () => ({ ok: false, status: 413, message: "Ukuran file maksimal 5 MB." }));
    await openEdit(WRITER);
    const before = await markdownOf();
    await user.upload(await bodyPicker(), new File(["x"], "dokumen.pdf", { type: "application/pdf" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP, GIF.");
    await user.upload(await bodyPicker(), png("besar.png"));
    expect((await screen.findByText("Ukuran file maksimal 5 MB.")).closest("[role='alert']")).toBeTruthy();
    expect(await markdownOf()).toBe(before);
  });

  test("says which file is going up and refuses a second picking while one runs", async () => {
    const user = userEvent.setup();
    const gate = deferred<ReturnType<typeof uploaded>>();
    setUploader(() => gate.promise);
    await openEdit(WRITER);
    await user.upload(await bodyPicker(), png());
    expect((await screen.findByText("Mengunggah foto-siswa.png...")).getAttribute("role")).toBe("status"); // announced, not only drawn
    expect((await bodyPicker()).disabled).toBe(true);
    await act(async () => gate.resolve(uploaded({ file: png(), kind: "blog-image" })));
    await waitFor(() => expect(screen.queryByText("Mengunggah foto-siswa.png...")).toBeNull());
    expect((await bodyPicker()).disabled).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------- the hero

describe("the hero image", () => {
  test("the field uploads as a blog image, and the saved path is the one the Worker gave", async () => {
    const user = userEvent.setup();
    const path = "/uploads/blog-image/2026/0a1b2c3d-1111-4222-8333-444455556666-sampul.png";
    setUploader(async ({ file }) => ({ ok: true, result: { id: "u9", path, contentType: "image/png", size: file.size, width: 1200, height: 630 } }));
    const { api } = await openEdit(WRITER, article(), { [`PUT ${LIST}/b1`]: (call) => Promise.resolve(respond({ item: article({ ...(call.body as object), imageWidth: 1200, imageHeight: 630, updatedAt: "2026-10-02T00:00:00.000Z" }) })) });
    await openTab(user, "Publikasi");
    const field = screen.getByRole("group", { name: /Gambar Hero/ });
    await user.upload(field.querySelector<HTMLInputElement>("input[type='file']")!, new File([new Uint8Array(500)], "sampul.png", { type: "image/png" }));
    await waitFor(() => expect(within(field).getByRole("button", { name: "Ganti" })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Simpan" }));
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
    await user.type(screen.getByLabelText(/^Judul(?! SEO)/), " baru");
    await user.click(screen.getByRole("button", { name: "Simpan" }));
    await screen.findByText("Artikel berhasil disimpan.");
    expect(api.last(`PUT ${LIST}/b1`)?.body).toMatchObject({ image: "/blog/images/2026/05/sampul.jpg" });
  });
});
