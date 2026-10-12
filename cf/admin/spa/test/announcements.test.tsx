import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { formatWindow, fromLocalDatetime, isCurrentlyShown, toBody, toLocalDatetime, toValues } from "~/pages/announcements/model";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

// The reference screens of docs/cloudflare/admin-crud.md: the list (ListPage), and the form (FormShell with the
// hooks), against stubbed answers in the Worker's shape. What every block does by itself is proved in
// test/crud/*; this file proves they are wired together the way a worker copying it would wire them.

const LIST = "/api/admin/announcements";

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    title: "Pendaftaran Dibuka",
    body: "Isi pengumuman",
    severity: "info",
    ctaLabel: null,
    ctaUrl: null,
    active: true,
    startsAt: null,
    endsAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const envelope = (items: unknown[], extra: { page?: number; pageSize?: number; total?: number } = {}) => ({ items, page: extra.page ?? 1, pageSize: extra.pageSize ?? 20, total: extra.total ?? items.length });

type Who = Parameters<typeof meBody>;

async function openList(who: Who, routes: Parameters<typeof stubApi>[0] = {}, path = "/announcements") {
  const api = stubApi({ "GET /api/me": respond(meBody(...who)), [`GET ${LIST}`]: respond(envelope([item()])), ...routes });
  const view = renderApp(path);
  await screen.findByRole("heading", { level: 1, name: "Pengumuman" });
  await screen.findByText("Pendaftaran Dibuka");
  return { api, ...view };
}

const createButton = () => screen.queryByRole("link", { name: /Pengumuman Baru/ });

describe("the list: who sees what", () => {
  test("a viewer reads the list and is offered nothing to change: no create button, no Edit, no Hapus, 'Lihat' instead", async () => {
    await openList(["viewer", []]);
    expect(createButton()).toBeNull();
    expect(screen.queryByRole("button", { name: /^Hapus/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Edit/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Lihat Pendaftaran Dibuka" }).getAttribute("href")).toBe("/announcements/m1/edit");
  });

  test("an editor of Komunikasi, and super_admin, get the create button and Edit and Hapus on every row", async () => {
    for (const who of [["editor", ["komunikasi"]], ["super_admin", []]] as Who[]) {
      const view = await openList(who);
      expect(createButton()?.getAttribute("href")).toBe("/announcements/new");
      expect(screen.getByRole("link", { name: "Edit Pendaftaran Dibuka" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Hapus Pendaftaran Dibuka" }).getAttribute("aria-haspopup")).toBe("dialog");
      view.unmount();
    }
  });

  test("an editor of other areas cannot open the page at all: the 403 page, and the list is never asked for", async () => {
    const api = stubApi({ "GET /api/me": respond(meBody("editor", ["konten", "pendaftaran"])), [`GET ${LIST}`]: respond(envelope([item()])) });
    renderApp("/announcements");
    expect(await screen.findByRole("heading", { level: 1, name: "Akses ditolak" })).toBeTruthy();
    expect(screen.queryByText("Pendaftaran Dibuka")).toBeNull();
    expect(createButton()).toBeNull();
    expect(api.count(`GET ${LIST}`)).toBe(0);
  });

  test("the empty state: 'Klik ... untuk membuat' only for someone who can create", async () => {
    stubApi({ "GET /api/me": respond(meBody("super_admin")), [`GET ${LIST}`]: respond(envelope([])) });
    const view = renderApp("/announcements");
    expect(await screen.findByText("Belum ada pengumuman. Klik “Pengumuman Baru” untuk membuat.")).toBeTruthy();
    view.unmount();

    stubApi({ "GET /api/me": respond(meBody("viewer")), [`GET ${LIST}`]: respond(envelope([])) });
    renderApp("/announcements");
    expect(await screen.findByText("Belum ada pengumuman.")).toBeTruthy();
  });
});

describe("the list: loading, errors, rows", () => {
  test("a table named for screen readers, the legacy columns, the severity as a tag, the window and the status", async () => {
    await openList(["viewer", []], {
      [`GET ${LIST}`]: respond(
        envelope([
          item(),
          item({ id: "m2", title: "Jadwal berubah", severity: "urgent", active: true, startsAt: "2999-01-01T00:00:00.000Z" }),
          item({ id: "m3", title: "Lama", severity: "warning", active: false }),
        ]),
      ),
    });
    const grid = screen.getByRole("table", { name: /Daftar pengumuman/ });
    expect(within(grid).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Pesan", "Severity", "Jadwal", "Status", "Aksi"]);
    expect(within(grid).getByText("Info")).toBeTruthy();
    expect(within(grid).getByText("Mendesak")).toBeTruthy();
    expect(within(grid).getByText("Peringatan")).toBeTruthy();
    expect(within(grid).getByText("Tampil")).toBeTruthy(); // active, inside its window
    expect(within(grid).getByText("Aktif, di luar jadwal")).toBeTruthy(); // active, starts in 2999
    expect(within(grid).getByText("Tidak aktif")).toBeTruthy();
    expect(screen.getByText("3 total pengumuman. Strip pengumuman tampil di seluruh halaman publik saat ada satu yang aktif dan dalam jendela jadwal.")).toBeTruthy();
  });

  test("a list that fails to load says so in a sentence, with 'Coba lagi', which asks again", async () => {
    const user = userEvent.setup();
    let fail = true;
    const api = stubApi({ "GET /api/me": respond(meBody("viewer")), [`GET ${LIST}`]: () => Promise.resolve(fail ? respond({ error: "internal" }, 500) : respond(envelope([item()]))) });
    renderApp("/announcements");
    expect((await screen.findByRole("alert")).textContent).toBe("Terjadi kesalahan di server. Coba lagi sebentar lagi.");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    await screen.findByText("Pendaftaran Dibuka");
    expect(api.count(`GET ${LIST}`)).toBe(2);
  });

  test("no connection reads as such", async () => {
    stubApi({ "GET /api/me": respond(meBody("viewer")) });
    const { setTransport } = await import("~/lib/api");
    setTransport(async (path) => {
      if (path === "/api/me") return respond(meBody("viewer"));
      throw new TypeError("offline");
    });
    renderApp("/announcements");
    expect((await screen.findByRole("alert")).textContent).toBe("Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.");
  });
});

describe("the list: filter, search, sort and pages live in the address bar", () => {
  test("the filter bar asks the Worker with the names it expects, and the address bar says what is applied", async () => {
    const user = userEvent.setup();
    const { api } = await openList(["viewer", []]);
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=20&sort=-createdAt`);

    await user.type(screen.getByLabelText("Cari"), "dibuka");
    await user.selectOptions(screen.getByLabelText("Severity"), "urgent");
    await user.selectOptions(screen.getByLabelText("Status"), "true");
    await user.click(screen.getByRole("button", { name: "Terapkan" }));

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/announcements?q=dibuka&severity=urgent&active=true"));
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=20&q=dibuka&severity=urgent&active=true&sort=-createdAt`));

    await user.click(screen.getByRole("button", { name: "Hapus filter" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/announcements"));
  });

  test("a link with filters in it opens the filtered list (the dashboard's tiles do this)", async () => {
    const { api } = await openList(["viewer", []], {}, "/announcements?severity=warning&page=2");
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=2&pageSize=20&severity=warning&sort=-createdAt`);
    expect((screen.getByLabelText("Severity") as HTMLSelectElement).value).toBe("warning");
  });

  test("nothing matches the filter: a sentence that says so, not 'Belum ada'", async () => {
    stubApi({ "GET /api/me": respond(meBody("viewer")), [`GET ${LIST}`]: respond(envelope([])) });
    renderApp("/announcements?q=zzz");
    expect(await screen.findByText("Tidak ada pengumuman yang cocok dengan filter.")).toBeTruthy();
  });

  test("pages: the summary, 'Berikutnya' goes to page 2 and the Worker is asked for it", async () => {
    const user = userEvent.setup();
    const { api } = await openList(["viewer", []], { [`GET ${LIST}`]: respond(envelope([item()], { total: 45 })) });
    expect(screen.getByText("Menampilkan 1 sampai 20 dari 45")).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "Berikutnya" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/announcements?page=2"));
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toContain("page=2"));
  });
});

describe("the list: delete", () => {
  async function ask(user: ReturnType<typeof userEvent.setup>, routes: Parameters<typeof stubApi>[0] = {}) {
    const view = await openList(["editor", ["komunikasi"]], routes);
    await user.click(screen.getByRole("button", { name: "Hapus Pendaftaran Dibuka" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Hapus pengumuman?" });
    return { ...view, dialog };
  }

  test("a question that names the item, in the legacy words, with the safe button focused", async () => {
    const user = userEvent.setup();
    const { dialog, api } = await ask(user);
    expect(dialog.textContent).toContain("Pengumuman “Pendaftaran Dibuka” akan dihapus. Tindakan ini tidak bisa dibatalkan.");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Batal" }));
    expect(api.calls.filter((call) => call.method === "DELETE")).toEqual([]); // asking changes nothing
    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.calls.filter((call) => call.method === "DELETE")).toEqual([]);
  });

  test("confirming sends DELETE with the version of the row, once however often it is pressed; then a notice and a fresh list", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const { dialog, api } = await ask(user, { [`DELETE ${LIST}/m1`]: () => gate.promise });
    const confirm = within(dialog).getByRole("button", { name: "Hapus" });
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(api.count(`DELETE ${LIST}/m1`)).toBe(1);
    expect(api.last(`DELETE ${LIST}/m1`)?.headers["if-match"]).toBe('"2026-10-01T00:00:00.000Z"');
    expect(within(dialog).getByRole("button", { name: "Menghapus..." })).toHaveProperty("disabled", true);

    await act(async () => gate.resolve(respond(null, 204)));
    expect((await screen.findByRole("status")).textContent).toContain("Pengumuman berhasil dihapus.");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.count(`GET ${LIST}`)).toBe(2); // the list is loaded again
  });

  test("a row someone else deleted first (404) counts as deleted", async () => {
    const user = userEvent.setup();
    const { dialog } = await ask(user, { [`DELETE ${LIST}/m1`]: respond({ error: "not_found" }, 404) });
    await user.click(within(dialog).getByRole("button", { name: "Hapus" }));
    expect((await screen.findByRole("status")).textContent).toContain("Pengumuman berhasil dihapus.");
  });

  test("a row edited since the list was loaded (409 stale): the dialog says so and offers 'Muat ulang', which reloads", async () => {
    const user = userEvent.setup();
    const { dialog, api } = await ask(user, { [`DELETE ${LIST}/m1`]: respond({ error: "stale", message: "Data ini sudah diubah orang lain sejak kamu membukanya." }, 409) });
    await user.click(within(dialog).getByRole("button", { name: "Hapus" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Perubahan yang belum disimpan akan hilang");
    expect(within(dialog).queryByRole("button", { name: "Hapus" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Muat ulang" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(api.count(`GET ${LIST}`)).toBe(2);
  });

  test("any other failure shows its sentence and lets it be tried again", async () => {
    const user = userEvent.setup();
    const { dialog } = await ask(user, { [`DELETE ${LIST}/m1`]: respond({ error: "internal" }, 500) });
    await user.click(within(dialog).getByRole("button", { name: "Hapus" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Terjadi kesalahan di server. Coba lagi sebentar lagi.");
    expect(within(dialog).getByRole("button", { name: "Hapus" })).toHaveProperty("disabled", false);
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
  test("the legacy form: sections, labels, hints, the three severities as radios, the schedule", async () => {
    await openForm(["editor", ["komunikasi"]], "/announcements/new");
    expect(screen.getByRole("heading", { level: 1, name: "Pengumuman Baru" })).toBeTruthy();
    for (const name of ["Konten", "Tampilan", "Jadwal"]) expect(screen.getByRole("heading", { level: 2, name })).toBeTruthy();
    expect(screen.getByLabelText(/Judul/)).toBeTruthy();
    expect(screen.getByLabelText(/Isi/)).toBeTruthy();
    expect(screen.getByText("Pesan singkat (5-500 karakter).")).toBeTruthy();
    const group = screen.getByRole("group", { name: /Severity/ });
    expect(within(group).getAllByRole("radio").map((radio) => (radio as HTMLInputElement).value)).toEqual(["info", "warning", "urgent"]);
    expect((within(group).getByRole("radio", { name: /Info/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText(/Aktifkan/)).toBeTruthy();
    expect(screen.getByLabelText(/Mulai/).getAttribute("type")).toBe("datetime-local");
    expect(screen.getByRole("button", { name: "Buat Pengumuman" })).toBeTruthy();
    expect(document.title).toBe("Pengumuman Baru | Admin Sakola Kembara");
  });

  test("submitting sends the body the Worker takes, once, then opens the edit page with 'berhasil dibuat'", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const { api } = await openForm(["editor", ["komunikasi"]], "/announcements/new", {
      [`POST ${LIST}`]: () => gate.promise,
      [`GET ${LIST}/new-id`]: respond({ item: item({ id: "new-id", title: "Judul baru" }) }),
    });
    await user.type(screen.getByLabelText(/Judul/), "Judul baru");
    await user.type(screen.getByLabelText(/Isi/), "Isi pengumuman baru");
    await user.click(screen.getByRole("radio", { name: /Mendesak/ }));
    await user.click(screen.getByLabelText(/Aktifkan/));
    const save = screen.getByRole("button", { name: "Buat Pengumuman" });
    await act(async () => {
      save.click();
      save.click();
    });
    expect(api.count(`POST ${LIST}`)).toBe(1);
    expect(api.last(`POST ${LIST}`)?.body).toEqual({ title: "Judul baru", body: "Isi pengumuman baru", severity: "urgent", ctaLabel: "", ctaUrl: "", active: true, startsAt: null, endsAt: null });

    await act(async () => gate.resolve(respond({ item: item({ id: "new-id", title: "Judul baru" }) }, 201)));
    await waitFor(() => expect(location()).toBe("/announcements/new-id/edit"));
    expect((await screen.findByRole("status")).textContent).toContain("Pengumuman berhasil dibuat.");
    expect(screen.queryByRole("alertdialog")).toBeNull(); // the unsaved guard let the navigation pass
  });

  test("a refused form: each field says it, the red state is set, the summary links to the field, nothing was navigated", async () => {
    const user = userEvent.setup();
    await openForm(["editor", ["komunikasi"]], "/announcements/new", {
      [`POST ${LIST}`]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { title: "Judul minimal 3 karakter", ctaLabel: "Label dan URL CTA harus diisi keduanya" } }, 400),
    });
    await user.type(screen.getByLabelText(/Judul/), "ab");
    await user.type(screen.getByLabelText(/Isi/), "Isi pengumuman baru");
    await user.click(screen.getByRole("button", { name: "Buat Pengumuman" }));

    const summary = await screen.findByRole("alert");
    expect(within(summary).getByRole("link", { name: "Judul: Judul minimal 3 karakter" })).toBeTruthy();
    expect(within(summary).getByRole("link", { name: "Label CTA: Label dan URL CTA harus diisi keduanya" })).toBeTruthy();
    expect(screen.getByLabelText(/Judul/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText(/Label CTA/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText(/Isi/).getAttribute("aria-invalid")).toBeNull();
    expect(location()).toBe("/announcements/new");

    await user.click(within(summary).getByRole("link", { name: /^Judul:/ }));
    expect(document.activeElement).toBe(screen.getByLabelText(/Judul/));
  });

  test("a viewer opening the form gets it read-only: disabled fields, no save", async () => {
    await openForm(["viewer", []], "/announcements/new");
    expect(screen.queryByRole("button", { name: "Buat Pengumuman" })).toBeNull();
    expect(screen.getByLabelText(/Judul/).matches(":disabled")).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Kamu hanya bisa melihat data ini");
  });
});

describe("the form: edit", () => {
  const loaded = item({ id: "m1", title: "Judul lama", body: "Isi lama", severity: "warning", active: true, ctaLabel: "Daftar", ctaUrl: "/gabung-siswa", startsAt: "2026-11-01T01:30:00.000Z", endsAt: null });

  test("the item is loaded into the fields (dates in local time), and saving sends If-Match of the version loaded", async () => {
    const user = userEvent.setup();
    const { api } = await openForm(["editor", ["komunikasi"]], "/announcements/m1/edit", {
      [`GET ${LIST}/m1`]: respond({ item: loaded }),
      [`PUT ${LIST}/m1`]: respond({ item: { ...loaded, title: "Judul baru", updatedAt: "2026-10-02T00:00:00.000Z" } }),
    });
    await waitFor(() => expect((screen.getByLabelText(/Judul/) as HTMLInputElement).value).toBe("Judul lama"));
    expect((screen.getByLabelText(/Isi/) as HTMLTextAreaElement).value).toBe("Isi lama");
    expect((screen.getByRole("radio", { name: /Peringatan/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Aktifkan/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Label CTA/) as HTMLInputElement).value).toBe("Daftar");
    expect((screen.getByLabelText(/Mulai/) as HTMLInputElement).value).toBe(toLocalDatetime("2026-11-01T01:30:00.000Z"));
    expect((screen.getByLabelText(/Berakhir/) as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("heading", { level: 1, name: "Edit Pengumuman" })).toBeTruthy();

    await user.clear(screen.getByLabelText(/Judul/));
    await user.type(screen.getByLabelText(/Judul/), "Judul baru");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));

    expect((await screen.findByRole("status")).textContent).toContain("Pengumuman berhasil disimpan.");
    const put = api.last(`PUT ${LIST}/m1`)!;
    expect(put.headers["if-match"]).toBe('"2026-10-01T00:00:00.000Z"');
    expect(put.body).toMatchObject({ title: "Judul baru", severity: "warning", ctaLabel: "Daftar", ctaUrl: "/gabung-siswa", endsAt: null });
    expect(put.body!.startsAt).toBe("2026-11-01T01:30:00.000Z");
    expect(location()).toBe("/announcements/m1/edit"); // stays, as the legacy admin did
  });

  test("after a save the form is clean and the next save sends the NEW version", async () => {
    const user = userEvent.setup();
    let version = "2026-10-02T00:00:00.000Z";
    const { api } = await openForm(["editor", ["komunikasi"]], "/announcements/m1/edit", {
      [`GET ${LIST}/m1`]: respond({ item: loaded }),
      [`PUT ${LIST}/m1`]: (call) => {
        const saved = { ...loaded, ...(call.body as object), updatedAt: version };
        version = "2026-10-03T00:00:00.000Z";
        return Promise.resolve(respond({ item: saved }));
      },
    });
    await waitFor(() => expect((screen.getByLabelText(/Judul/) as HTMLInputElement).value).toBe("Judul lama"));
    await user.type(screen.getByLabelText(/Judul/), " satu");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await screen.findByText("Pengumuman berhasil disimpan.");
    await waitFor(() => expect(api.last(`PUT ${LIST}/m1`)).toBeTruthy());

    await user.type(screen.getByLabelText(/Judul/), " dua");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(api.count(`PUT ${LIST}/m1`)).toBe(2));
    expect(api.last(`PUT ${LIST}/m1`)?.headers["if-match"]).toBe('"2026-10-02T00:00:00.000Z"');
  });

  test("someone saved first (409 stale): the warning, and 'Muat ulang' replaces the form with the newer version", async () => {
    const user = userEvent.setup();
    let served = loaded;
    const { api } = await openForm(["editor", ["komunikasi"]], "/announcements/m1/edit", {
      [`GET ${LIST}/m1`]: () => Promise.resolve(respond({ item: served })),
      [`PUT ${LIST}/m1`]: respond({ error: "stale", message: "Data ini sudah diubah orang lain sejak kamu membukanya. Muat ulang untuk melihat versi terbaru." }, 409),
    });
    await waitFor(() => expect((screen.getByLabelText(/Judul/) as HTMLInputElement).value).toBe("Judul lama"));
    await user.type(screen.getByLabelText(/Judul/), " saya");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));

    const warning = await screen.findByText(/Data ini sudah diubah orang lain/);
    expect(warning.textContent).toContain("Perubahan yang belum disimpan akan hilang");
    expect((screen.getByLabelText(/Judul/) as HTMLInputElement).value).toBe("Judul lama saya"); // nothing was thrown away yet

    served = { ...loaded, title: "Judul dari orang lain", updatedAt: "2026-10-05T00:00:00.000Z" };
    await user.click(screen.getByRole("button", { name: "Muat ulang" }));
    await waitFor(() => expect((screen.getByLabelText(/Judul/) as HTMLInputElement).value).toBe("Judul dari orang lain"));
    expect(screen.queryByText(/Data ini sudah diubah orang lain/)).toBeNull();
    expect(api.count(`GET ${LIST}/m1`)).toBe(2);
    expect(screen.queryByRole("alertdialog")).toBeNull(); // reloading is not "leaving with unsaved changes"
  });

  test("a read-only role sees the values and can change none of them", async () => {
    await openForm(["viewer", []], "/announcements/m1/edit", { [`GET ${LIST}/m1`]: respond({ item: loaded }) });
    await waitFor(() => expect((screen.getByLabelText(/Judul/) as HTMLInputElement).value).toBe("Judul lama"));
    expect(screen.getByLabelText(/Judul/).matches(":disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Simpan Perubahan" })).toBeNull();
    expect(screen.getByRole("link", { name: "Tutup" })).toBeTruthy();
  });

  test("an announcement that is gone: the sentence and a way back; a failure to load: 'Coba lagi'", async () => {
    const user = userEvent.setup();
    stubApi({ "GET /api/me": respond(meBody("editor", ["komunikasi"])), [`GET ${LIST}/gone`]: respond({ error: "not_found", message: "Data tidak ditemukan. Mungkin sudah dihapus." }, 404) });
    const view = renderApp("/announcements/gone/edit");
    expect((await screen.findByRole("alert")).textContent).toBe("Data tidak ditemukan. Mungkin sudah dihapus.");
    expect(screen.getByRole("link", { name: "Kembali ke daftar" }).getAttribute("href")).toBe("/announcements");
    view.unmount();

    let calls = 0;
    stubApi({ "GET /api/me": respond(meBody("editor", ["komunikasi"])), [`GET ${LIST}/m1`]: () => Promise.resolve(++calls === 1 ? respond({ error: "internal" }, 500) : respond({ item: loaded })) });
    renderApp("/announcements/m1/edit");
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    await screen.findByRole("form");
  });

  test("changes that were not saved are asked about before leaving by the sidebar", async () => {
    const user = userEvent.setup();
    await openForm(["editor", ["komunikasi"]], "/announcements/m1/edit", { [`GET ${LIST}/m1`]: respond({ item: loaded }) });
    await waitFor(() => expect((screen.getByLabelText(/Judul/) as HTMLInputElement).value).toBe("Judul lama"));
    await user.type(screen.getByLabelText(/Judul/), " ubah");
    await user.click(screen.getByRole("link", { name: "Dashboard" }));
    expect(await screen.findByRole("alertdialog", { name: "Tinggalkan halaman?" })).toBeTruthy();
    expect(location()).toBe("/announcements/m1/edit");
    await user.click(screen.getByRole("button", { name: "Tinggalkan" }));
    await waitFor(() => expect(location()).toBe("/"));
  });
});

describe("routes below the menu entry", () => {
  test("an unregistered page below it is still the placeholder, with the way back", async () => {
    stubApi({ "GET /api/me": respond(meBody("super_admin")) });
    renderApp("/announcements/a/b/c");
    expect(await screen.findByText("Belum tersedia di admin baru")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kembali ke daftar" }).getAttribute("href")).toBe("/announcements");
  });
});

describe("the model", () => {
  test("a window is described as the legacy list did", () => {
    expect(formatWindow(null, null)).toBe("Tanpa batas");
    expect(formatWindow("2026-11-01T00:00:00.000Z", null)).toMatch(/^Mulai /);
    expect(formatWindow(null, "2026-11-01T00:00:00.000Z")).toMatch(/^Berakhir /);
    expect(formatWindow("2026-11-01T00:00:00.000Z", "2026-11-30T00:00:00.000Z")).toContain(" – ");
  });

  test("shown means active and inside the window", () => {
    const now = Date.parse("2026-11-15T00:00:00.000Z");
    expect(isCurrentlyShown({ active: true, startsAt: null, endsAt: null }, now)).toBe(true);
    expect(isCurrentlyShown({ active: false, startsAt: null, endsAt: null }, now)).toBe(false);
    expect(isCurrentlyShown({ active: true, startsAt: "2026-11-16T00:00:00.000Z", endsAt: null }, now)).toBe(false);
    expect(isCurrentlyShown({ active: true, startsAt: null, endsAt: "2026-11-14T00:00:00.000Z" }, now)).toBe(false);
    expect(isCurrentlyShown({ active: true, startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-11-30T00:00:00.000Z" }, now)).toBe(true);
  });

  test("a local date-time and the ISO the API takes round-trip, whatever the time zone", () => {
    const iso = "2026-11-01T01:30:00.000Z";
    expect(fromLocalDatetime(toLocalDatetime(iso))).toBe(iso);
    expect(toLocalDatetime(null)).toBe("");
    expect(toLocalDatetime("not a date")).toBe("");
    expect(fromLocalDatetime("")).toBeNull();
    expect(fromLocalDatetime("garbage")).toBe("garbage"); // the Worker answers "Format tanggal tidak valid"
  });

  test("a new form starts from the defaults, an item from its values, and the body is what the Worker takes", () => {
    expect(toValues(null)).toEqual({ title: "", body: "", severity: "info", ctaLabel: "", ctaUrl: "", active: false, startsAt: "", endsAt: "" });
    const values = toValues(item({ ctaLabel: "Daftar", ctaUrl: "/x", startsAt: "2026-11-01T01:30:00.000Z" }) as never);
    expect(toBody(values)).toEqual({ title: "Pendaftaran Dibuka", body: "Isi pengumuman", severity: "info", ctaLabel: "Daftar", ctaUrl: "/x", active: true, startsAt: "2026-11-01T01:30:00.000Z", endsAt: null });
  });
});
