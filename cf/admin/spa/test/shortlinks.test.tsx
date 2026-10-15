import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { type ShortlinkItem, shortUrl, toBody, toValues } from "~/pages/shortlinks/model";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

// Shortlink, the screens: the list (ListPage, with a copy button) and the form (FormShell, the slug box with the
// site's name in front of it), against stubbed answers in the Worker's shape. What every block does by itself is
// proved in test/crud/*; this file proves they are wired the way the legacy admin's shortlinks page behaved, and
// that a read-only role is offered nothing to change.

const LIST = "/api/admin/shortlinks";

function link(overrides: Partial<ShortlinkItem> = {}): ShortlinkItem {
  return {
    id: "s1",
    slug: "rapat-2026",
    targetUrl: "https://forms.gle/abc123",
    note: "Dibagikan lewat broadcast",
    active: true,
    clickCount: 128,
    lastClickedAt: "2026-10-10T08:30:00.000Z",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const envelope = (items: unknown[], extra: { total?: number } = {}) => ({ items, page: 1, pageSize: 100, total: extra.total ?? items.length });
type Who = Parameters<typeof meBody>;

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "clipboard");
});

async function openList(who: Who, routes: Parameters<typeof stubApi>[0] = {}, path = "/shortlinks") {
  const api = stubApi({ "GET /api/me": respond(meBody(...who)), [`GET ${LIST}`]: respond(envelope([link()])), ...routes });
  const view = renderApp(path);
  await screen.findByRole("heading", { level: 1, name: "Shortlink" });
  await screen.findByText("/rapat-2026");
  return { api, ...view };
}

const createButton = () => screen.queryByRole("link", { name: /Shortlink Baru/ });

describe("the list: who sees what", () => {
  test("a viewer reads the list and is offered nothing to change, but can still copy an address", async () => {
    await openList(["viewer", []]);
    expect(createButton()).toBeNull();
    expect(screen.queryByRole("button", { name: /^Hapus/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Edit/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Lihat /rapat-2026" }).getAttribute("href")).toBe("/shortlinks/s1/edit");
    expect(screen.getByRole("button", { name: "Salin https://sakolakembara.org/rapat-2026" })).toBeTruthy();
  });

  test("an editor of Konten, and super_admin, get the create button and Edit and Hapus on every row", async () => {
    for (const who of [["editor", ["konten"]], ["super_admin", []]] as Who[]) {
      const view = await openList(who);
      expect(createButton()?.getAttribute("href")).toBe("/shortlinks/new");
      expect(screen.getByRole("link", { name: "Edit /rapat-2026" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Hapus /rapat-2026" })).toBeTruthy();
      view.unmount();
    }
  });

  test("an editor of other areas cannot open the page at all: the 403 page, and the list is never asked for", async () => {
    const api = stubApi({ "GET /api/me": respond(meBody("editor", ["komunikasi"])), [`GET ${LIST}`]: respond(envelope([link()])) });
    renderApp("/shortlinks");
    expect(await screen.findByRole("heading", { level: 1, name: "Akses ditolak" })).toBeTruthy();
    expect(screen.queryByText("/rapat-2026")).toBeNull();
    expect(api.count(`GET ${LIST}`)).toBe(0);
  });

  test("the empty state: 'Klik ... untuk membuat' only for someone who can create", async () => {
    stubApi({ "GET /api/me": respond(meBody("super_admin")), [`GET ${LIST}`]: respond(envelope([])) });
    const view = renderApp("/shortlinks");
    expect(await screen.findByText("Belum ada shortlink. Klik “Shortlink Baru” untuk membuat.")).toBeTruthy();
    view.unmount();
    stubApi({ "GET /api/me": respond(meBody("viewer")), [`GET ${LIST}`]: respond(envelope([])) });
    renderApp("/shortlinks");
    expect(await screen.findByText("Belum ada shortlink.")).toBeTruthy();
  });
});

describe("the list: what a row shows", () => {
  test("the legacy columns: the address and its note, where it goes, the clicks and the last one, and whether it is on", async () => {
    await openList(["viewer", []], {
      [`GET ${LIST}`]: respond(
        envelope([
          link(),
          link({ id: "s2", slug: "bio", targetUrl: "/gabung-siswa", note: null, clickCount: 0, lastClickedAt: null }),
          link({ id: "s3", slug: "lama", active: false, clickCount: 2310, lastClickedAt: "2026-09-01T00:00:00.000Z" }),
        ]),
      ),
    });
    const grid = screen.getByRole("table", { name: /Daftar shortlink/ });
    expect(within(grid).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Alamat pendek", "Tujuan", "Klik", "Status", "Aksi"]);
    expect(within(grid).getAllByText("Dibagikan lewat broadcast")).toHaveLength(2); // rows 1 and 3; row 2 has no note
    // The target opens in a new tab.
    const target = within(grid).getAllByRole("link", { name: "https://forms.gle/abc123" })[0]!; // rows 1 and 3 share the default target
    expect(target.getAttribute("href")).toBe("https://forms.gle/abc123");
    expect(target.getAttribute("target")).toBe("_blank");
    expect(target.getAttribute("rel")).toBe("noopener noreferrer");
    expect(within(grid).getByText("128")).toBeTruthy();
    expect(within(grid).getByText("2.310")).toBeTruthy(); // Indonesian thousands
    expect(within(grid).getByText("Belum diklik")).toBeTruthy();
    expect(within(grid).getAllByText("Aktif")).toHaveLength(2);
    expect(within(grid).getByText("Nonaktif")).toBeTruthy();
    expect(within(grid).getByRole("link", { name: "/bio" }).getAttribute("href")).toBe("/shortlinks/s2/edit");
  });

  test("the sentence above the table counts the links and, when it can, the active ones", async () => {
    await openList(["viewer", []], { [`GET ${LIST}`]: respond(envelope([link(), link({ id: "s2", slug: "dua", active: false })])) });
    expect(screen.getByText(/2 shortlink, 1 aktif\. Alamat pendek di/)).toBeTruthy();
    expect(screen.getByText("https://sakolakembara.org/slug")).toBeTruthy();
  });

  test("when the page holds only some of the links the active count is left out (it would be wrong)", async () => {
    await openList(["viewer", []], { [`GET ${LIST}`]: respond(envelope([link()], { total: 150 })) });
    expect(screen.getByText(/150 shortlink\. Alamat pendek di/)).toBeTruthy();
    expect(screen.queryByText(/aktif\. Alamat/)).toBeNull();
  });

  test("the Worker is asked for every link the page can hold, newest first, and the filter asks with its names", async () => {
    const user = userEvent.setup();
    const { api } = await openList(["viewer", []]);
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=100&sort=-createdAt`);
    expect(within(screen.getByLabelText("Status")).getAllByRole("option").map((option) => option.textContent)).toEqual(["Semua status", "Aktif", "Nonaktif"]);
    await user.type(screen.getByLabelText("Cari"), "rapat");
    await user.selectOptions(screen.getByLabelText("Status"), "true");
    await user.click(screen.getByRole("button", { name: "Terapkan" }));
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=100&q=rapat&active=true&sort=-createdAt`));
  });
});

describe("the copy button", () => {
  test("it copies the full address and says so for a moment", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await openList(["viewer", []]);
    fireEvent.click(screen.getByRole("button", { name: "Salin https://sakolakembara.org/rapat-2026" }));
    expect(await screen.findByText("Tersalin")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith("https://sakolakembara.org/rapat-2026");
    await act(async () => void vi.advanceTimersByTime(1800));
    expect(screen.queryByText("Tersalin")).toBeNull();
    expect(screen.getByText("Salin")).toBeTruthy();
  });

  test("where the clipboard cannot be used (plain http), it says to copy by hand, and does not pretend", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openList(["viewer", []]); // jsdom has no navigator.clipboard
    fireEvent.click(screen.getByRole("button", { name: "Salin https://sakolakembara.org/rapat-2026" }));
    expect(await screen.findByText("Salin manual")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Salin https://sakolakembara.org/rapat-2026" }).getAttribute("title")).toBe("Gagal menyalin — salin manual");
    await act(async () => void vi.advanceTimersByTime(2500));
    expect(screen.queryByText("Salin manual")).toBeNull();
  });
});

describe("the list: delete", () => {
  test("the question names the address and says what stops working; the notice is the legacy one", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const { api } = await openList(["editor", ["konten"]], { [`DELETE ${LIST}/s1`]: () => gate.promise });
    await user.click(screen.getByRole("button", { name: "Hapus /rapat-2026" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Hapus shortlink?" });
    expect(dialog.textContent).toContain("Shortlink “/rapat-2026” akan dihapus. Tindakan ini tidak bisa dibatalkan. Alamat yang sudah tersebar tidak akan berfungsi lagi.");
    await user.click(within(dialog).getByRole("button", { name: "Hapus" }));
    expect(api.last(`DELETE ${LIST}/s1`)?.headers["if-match"]).toBe('"2026-10-01T00:00:00.000Z"');
    await act(async () => gate.resolve(respond(null, 204)));
    expect((await screen.findByRole("status")).textContent).toContain("Shortlink berhasil dihapus.");
  });
});

// ---------------------------------------------------------------------------------- the form

async function openForm(who: Who, path: string, routes: Parameters<typeof stubApi>[0] = {}) {
  const api = stubApi({ "GET /api/me": respond(meBody(...who)), ...routes });
  const view = renderApp(path);
  await screen.findByRole("form");
  return { api, ...view };
}
const location = () => screen.getByTestId("location").textContent;

describe("the form: create", () => {
  test("the legacy form: its sections, the site's name in front of the slug, the sentence that shows the address as it is typed, the switch on", async () => {
    const user = userEvent.setup();
    await openForm(["editor", ["konten"]], "/shortlinks/new");
    expect(screen.getByRole("heading", { level: 1, name: "Shortlink Baru" })).toBeTruthy();
    for (const name of ["Alamat pendek", "Tujuan", "Status"]) expect(screen.getByRole("heading", { level: 2, name })).toBeTruthy();
    expect(screen.getByText("sakolakembara.org/")).toBeTruthy();
    expect(screen.getByText("https://sakolakembara.org/slug-anda")).toBeTruthy();
    await user.type(screen.getByLabelText(/Slug/), " Rapat-2026 ");
    expect(screen.getByText("https://sakolakembara.org/rapat-2026")).toBeTruthy();
    expect(screen.getByText("URL lengkap (https://...) atau jalur di situs ini (/gabung-siswa).")).toBeTruthy();
    expect(screen.getByText("Hanya terlihat di admin. Contoh: dipakai di bio Instagram.")).toBeTruthy();
    expect((screen.getByLabelText(/Aktifkan/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText(/Slug/).getAttribute("aria-describedby")).toBe("slug-help");
    expect(screen.getByRole("button", { name: "Buat Shortlink" })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe("Shortlink Baru | Admin Sakola Kembara"));
  });

  test("submitting sends the body the Worker takes, once, then opens the edit page with 'berhasil dibuat'", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const { api } = await openForm(["editor", ["konten"]], "/shortlinks/new", {
      [`POST ${LIST}`]: () => gate.promise,
      [`GET ${LIST}/new-id`]: respond({ item: link({ id: "new-id" }) }),
    });
    await user.type(screen.getByLabelText(/Slug/), "Rapat-2026");
    await user.type(screen.getByLabelText(/URL tujuan/), "https://forms.gle/abc123");
    await user.type(screen.getByLabelText(/Catatan/), "Untuk rapat");
    await user.click(screen.getByLabelText(/Aktifkan/));
    const save = screen.getByRole("button", { name: "Buat Shortlink" });
    await act(async () => {
      save.click();
      save.click();
    });
    expect(api.count(`POST ${LIST}`)).toBe(1);
    // As typed: the Worker lower-cases and trims the slug and checks the target.
    expect(api.last(`POST ${LIST}`)?.body).toEqual({ slug: "Rapat-2026", targetUrl: "https://forms.gle/abc123", note: "Untuk rapat", active: false });

    await act(async () => gate.resolve(respond({ item: link({ id: "new-id" }) }, 201)));
    await waitFor(() => expect(location()).toBe("/shortlinks/new-id/edit"));
    expect((await screen.findByRole("status")).textContent).toContain("Shortlink berhasil dibuat.");
    expect(screen.queryByRole("alertdialog")).toBeNull(); // the unsaved guard let the navigation pass
  });

  test("a slug that is taken (409): the sentence on the slug, the red state, the description now points at it, the summary links to the box", async () => {
    const user = userEvent.setup();
    await openForm(["editor", ["konten"]], "/shortlinks/new", {
      [`POST ${LIST}`]: respond({ error: "conflict", message: "Periksa kembali isian formulir.", fields: { slug: "Slug ini sudah dipakai shortlink lain." } }, 409),
    });
    await user.type(screen.getByLabelText(/Slug/), "rapat-2026");
    await user.type(screen.getByLabelText(/URL tujuan/), "https://forms.gle/abc123");
    await user.click(screen.getByRole("button", { name: "Buat Shortlink" }));
    const summary = await screen.findByRole("alert");
    expect(within(summary).getByRole("link", { name: "Slug: Slug ini sudah dipakai shortlink lain." })).toBeTruthy();
    expect(screen.getByText("Slug ini sudah dipakai shortlink lain.", { selector: "#slug-error" })).toBeTruthy();
    expect(screen.getByLabelText(/Slug/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText(/Slug/).getAttribute("aria-describedby")).toBe("slug-error");
    expect(screen.getByLabelText(/URL tujuan/).getAttribute("aria-invalid")).toBeNull();
    await user.click(within(summary).getByRole("link", { name: /^Slug:/ }));
    expect(document.activeElement).toBe(screen.getByLabelText(/Slug/));
    expect(location()).toBe("/shortlinks/new");
  });

  test("a refused target is shown on the target field, in the Worker's words", async () => {
    const user = userEvent.setup();
    await openForm(["editor", ["konten"]], "/shortlinks/new", {
      [`POST ${LIST}`]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { targetUrl: "Hanya URL http:// atau https:// yang diizinkan." } }, 400),
    });
    await user.type(screen.getByLabelText(/Slug/), "bahaya");
    await user.type(screen.getByLabelText(/URL tujuan/), "javascript:alert(1)");
    await user.click(screen.getByRole("button", { name: "Buat Shortlink" }));
    expect((await screen.findByRole("alert")).textContent).toContain("URL tujuan: Hanya URL http:// atau https:// yang diizinkan.");
    expect(screen.getByLabelText(/URL tujuan/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText(/Slug/).getAttribute("aria-invalid")).toBeNull();
  });

  test("a viewer, or an editor of other areas, is not offered an empty form: the 403 page", async () => {
    for (const who of [["viewer", []], ["editor", ["pendaftaran"]]] as Who[]) {
      stubApi({ "GET /api/me": respond(meBody(...who)) });
      const view = renderApp("/shortlinks/new");
      expect(await screen.findByRole("heading", { level: 1, name: "Akses ditolak" })).toBeTruthy();
      expect(screen.queryByRole("form")).toBeNull();
      view.unmount();
    }
  });
});

describe("the form: edit", () => {
  const loaded = link({ slug: "lama", targetUrl: "https://example.org/a", note: null, active: true });

  test("the link is loaded into the fields; saving sends If-Match of the version loaded and says 'berhasil disimpan'", async () => {
    const user = userEvent.setup();
    const { api } = await openForm(["editor", ["konten"]], "/shortlinks/s1/edit", {
      [`GET ${LIST}/s1`]: respond({ item: loaded }),
      [`PUT ${LIST}/s1`]: respond({ item: { ...loaded, note: "Baru", updatedAt: "2026-10-02T00:00:00.000Z" } }),
    });
    await waitFor(() => expect((screen.getByLabelText(/Slug/) as HTMLInputElement).value).toBe("lama"));
    expect((screen.getByLabelText(/URL tujuan/) as HTMLInputElement).value).toBe("https://example.org/a");
    expect((screen.getByLabelText(/Aktifkan/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("heading", { level: 1, name: "Edit Shortlink" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Simpan Perubahan" })).toBeTruthy();

    await user.type(screen.getByLabelText(/Catatan/), "Baru");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    expect((await screen.findByRole("status")).textContent).toContain("Shortlink berhasil disimpan.");
    const put = api.last(`PUT ${LIST}/s1`)!;
    expect(put.headers["if-match"]).toBe('"2026-10-01T00:00:00.000Z"');
    expect(put.body).toEqual({ slug: "lama", targetUrl: "https://example.org/a", note: "Baru", active: true });
    expect(location()).toBe("/shortlinks/s1/edit"); // stays, as the legacy admin did
  });

  test("renaming says that the old address stops working (the legacy sentence)", async () => {
    const user = userEvent.setup();
    await openForm(["editor", ["konten"]], "/shortlinks/s1/edit", {
      [`GET ${LIST}/s1`]: respond({ item: loaded }),
      [`PUT ${LIST}/s1`]: respond({ item: { ...loaded, slug: "baru", updatedAt: "2026-10-02T00:00:00.000Z" } }),
    });
    await waitFor(() => expect((screen.getByLabelText(/Slug/) as HTMLInputElement).value).toBe("lama"));
    await user.clear(screen.getByLabelText(/Slug/));
    await user.type(screen.getByLabelText(/Slug/), "baru");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    expect(await screen.findByText("Shortlink berhasil disimpan. Slug lama /lama tidak lagi aktif.")).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText(/Slug/) as HTMLInputElement).value).toBe("baru"));
  });

  test("a link can be switched off: the checkbox is sent as false", async () => {
    const user = userEvent.setup();
    const { api } = await openForm(["editor", ["konten"]], "/shortlinks/s1/edit", {
      [`GET ${LIST}/s1`]: respond({ item: loaded }),
      [`PUT ${LIST}/s1`]: respond({ item: { ...loaded, active: false, updatedAt: "2026-10-02T00:00:00.000Z" } }),
    });
    await waitFor(() => expect((screen.getByLabelText(/Slug/) as HTMLInputElement).value).toBe("lama"));
    await user.click(screen.getByLabelText(/Aktifkan/));
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(api.count(`PUT ${LIST}/s1`)).toBe(1));
    expect(api.last(`PUT ${LIST}/s1`)?.body).toMatchObject({ active: false });
  });

  test("someone saved first (409 stale): the warning, and 'Muat ulang' replaces the form with the newer version", async () => {
    const user = userEvent.setup();
    let served = loaded;
    await openForm(["editor", ["konten"]], "/shortlinks/s1/edit", {
      [`GET ${LIST}/s1`]: () => Promise.resolve(respond({ item: served })),
      [`PUT ${LIST}/s1`]: respond({ error: "stale", message: "Data ini sudah diubah orang lain sejak kamu membukanya. Muat ulang untuk melihat versi terbaru." }, 409),
    });
    await waitFor(() => expect((screen.getByLabelText(/Slug/) as HTMLInputElement).value).toBe("lama"));
    await user.type(screen.getByLabelText(/Catatan/), "punyaku");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    expect((await screen.findByText(/Data ini sudah diubah orang lain/)).textContent).toContain("Perubahan yang belum disimpan akan hilang");
    served = { ...loaded, targetUrl: "https://example.org/dari-orang-lain", updatedAt: "2026-10-05T00:00:00.000Z" };
    await user.click(screen.getByRole("button", { name: "Muat ulang" }));
    await waitFor(() => expect((screen.getByLabelText(/URL tujuan/) as HTMLInputElement).value).toBe("https://example.org/dari-orang-lain"));
  });

  test("a read-only role sees the values and can change none of them", async () => {
    await openForm(["viewer", []], "/shortlinks/s1/edit", { [`GET ${LIST}/s1`]: respond({ item: loaded }) });
    await waitFor(() => expect((screen.getByLabelText(/Slug/) as HTMLInputElement).value).toBe("lama"));
    expect(screen.getByLabelText(/Slug/).matches(":disabled")).toBe(true);
    expect(screen.getByLabelText(/URL tujuan/).matches(":disabled")).toBe(true);
    expect(screen.getByLabelText(/Aktifkan/).matches(":disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Simpan Perubahan" })).toBeNull();
    expect(screen.getByRole("link", { name: "Tutup" })).toBeTruthy();
  });

  test("a link that is gone: the sentence and a way back", async () => {
    stubApi({ "GET /api/me": respond(meBody("editor", ["konten"])), [`GET ${LIST}/gone`]: respond({ error: "not_found", message: "Data tidak ditemukan. Mungkin sudah dihapus." }, 404) });
    renderApp("/shortlinks/gone/edit");
    expect((await screen.findByRole("alert")).textContent).toBe("Data tidak ditemukan. Mungkin sudah dihapus.");
    expect(screen.getByRole("link", { name: "Kembali ke daftar" }).getAttribute("href")).toBe("/shortlinks");
  });
});

describe("the model", () => {
  test("the short address is the site, a slash and the slug", () => {
    expect(shortUrl("rapat-2026")).toBe("https://sakolakembara.org/rapat-2026");
  });

  test("a new link starts on; the body is exactly what the Worker's form takes", () => {
    expect(toValues(null)).toEqual({ slug: "", targetUrl: "", note: "", active: true });
    expect(toBody(toValues(link()))).toEqual({ slug: "rapat-2026", targetUrl: "https://forms.gle/abc123", note: "Dibagikan lewat broadcast", active: true });
    expect(toValues(link({ note: null, active: false }))).toMatchObject({ note: "", active: false });
  });
});
