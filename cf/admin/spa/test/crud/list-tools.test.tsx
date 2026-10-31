import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";
import { meBody, renderApp, respond, stubApi } from "../helpers";

// What a list gives to someone who can write, beyond its rows (SAKEM-115, stage 6): a checkbox per row and the bar
// over the list, the row's menu, "Kolom", "Baris per halaman", the sort select of a phone and the chips. They are
// tested here through the blog's list, the one with every piece; the pieces by themselves are in the other files of
// this folder.

const LIST = "/api/admin/blog";

function post(id: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    slug: id,
    title,
    excerpt: `Ringkasan ${title}`,
    category: "Tips",
    author: "Dzul",
    featured: false,
    status: "draft",
    date: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: `2026-10-0${id.slice(-1)}T00:00:00.000Z`,
    ...overrides,
  };
}

const ROWS = [post("p1", "Satu"), post("p2", "Dua", { status: "published", date: "2026-05-21" }), post("p3", "Tiga")];

const envelope = (items: unknown[], extra: { pageSize?: number; total?: number } = {}) => ({ items, page: 1, pageSize: extra.pageSize ?? 20, total: extra.total ?? items.length });

async function open(routes: Parameters<typeof stubApi>[0] = {}, who: Parameters<typeof meBody> = ["editor", ["konten"]], path = "/blog") {
  const api = stubApi({ "GET /api/me": respond(meBody(...who)), [`GET ${LIST}`]: respond(envelope(ROWS)), ...routes });
  const view = renderApp(path);
  await screen.findByRole("heading", { level: 1, name: "Blog" });
  await screen.findByText("Dua");
  return { api, ...view };
}

const tick = (user: ReturnType<typeof userEvent.setup>, title: string) => user.click(screen.getByRole("checkbox", { name: `Pilih ${title}` }));
const bar = () => screen.queryByRole("group", { name: "Aksi untuk baris yang dipilih" });

afterEach(() => window.localStorage.clear());

describe("ticking rows", () => {
  test("a writer has a checkbox per row and one for the page; a reader has none", async () => {
    const view = await open();
    expect(screen.getAllByRole("checkbox", { name: /^Pilih (Satu|Dua|Tiga)$/ })).toHaveLength(3);
    expect(screen.getByRole("checkbox", { name: "Pilih semua baris di halaman ini" })).toBeTruthy();
    view.unmount();

    await open({}, ["viewer", []]);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  test("the bar appears with the count and goes with the last tick; the footer counts too", async () => {
    const user = userEvent.setup();
    await open();
    expect(bar()).toBeNull();
    await tick(user, "Satu");
    await tick(user, "Dua");
    expect(within(bar()!).getByText("2 artikel dipilih")).toBeTruthy();
    // The same words for a screen reader, in a live region that was there before the first tick.
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe("2 artikel dipilih");
    await tick(user, "Satu");
    await tick(user, "Dua");
    expect(bar()).toBeNull();
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe("");
  });

  test("the bar comes after the table and floats at the bottom edge, so ticking a row moves nothing above it", async () => {
    const user = userEvent.setup();
    await open();
    await tick(user, "Satu");
    const table = screen.getByRole("table", { name: /Daftar artikel/ });
    expect(table.compareDocumentPosition(bar()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar()!.className).toContain("sticky bottom-4");
  });

  test("the box of the page ticks every row, is half-ticked for some, and unticks them all", async () => {
    const user = userEvent.setup();
    await open();
    const all = screen.getByRole("checkbox", { name: "Pilih semua baris di halaman ini" }) as HTMLInputElement;
    await tick(user, "Satu");
    expect(all.indeterminate).toBe(true);
    expect(all.checked).toBe(false);
    await user.click(all);
    expect(within(bar()!).getByText("3 artikel dipilih")).toBeTruthy();
    expect(all.checked).toBe(true);
    expect(all.indeterminate).toBe(false);
    await user.click(all);
    expect(bar()).toBeNull();
  });

  test("'Batal pilih' unticks everything", async () => {
    const user = userEvent.setup();
    await open();
    await tick(user, "Satu");
    await user.click(screen.getByRole("button", { name: "Batal pilih" }));
    expect(bar()).toBeNull();
    expect((screen.getByRole("checkbox", { name: "Pilih Satu" }) as HTMLInputElement).checked).toBe(false);
  });

  test("another page, search or filter starts with no ticks", async () => {
    const user = userEvent.setup();
    await open();
    await tick(user, "Satu");
    await user.selectOptions(screen.getByLabelText("Status"), "draft");
    await waitFor(() => expect(bar()).toBeNull());
  });
});

describe("what the bar does to the ticked rows", () => {
  test("Hapus asks first, naming the rows; confirming sends one DELETE per row with its version, then the notice", async () => {
    const user = userEvent.setup();
    const { api } = await open({ [`DELETE ${LIST}/p1`]: respond(null, 204), [`DELETE ${LIST}/p3`]: respond(null, 204) });
    await tick(user, "Satu");
    await tick(user, "Tiga");
    await user.click(within(bar()!).getByRole("button", { name: "Hapus" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Hapus 2 artikel?" });
    expect(dialog.textContent).toContain("2 artikel akan dihapus. Tindakan ini tidak bisa dibatalkan.");
    expect(within(dialog).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Satu", "Tiga"]);
    expect(api.count(`DELETE ${LIST}/p1`)).toBe(0); // nothing before the answer

    await user.click(within(dialog).getByRole("button", { name: "Hapus" }));
    expect(await screen.findByText("2 artikel dihapus.")).toBeTruthy();
    expect(api.last(`DELETE ${LIST}/p1`)?.headers["if-match"]).toBe('"2026-10-01T00:00:00.000Z"');
    expect(api.last(`DELETE ${LIST}/p3`)?.headers["if-match"]).toBe('"2026-10-03T00:00:00.000Z"');
    expect(api.count(`GET ${LIST}`)).toBe(2); // the list is asked for again
    expect(bar()).toBeNull();
  });

  test("a row that changed under the person is named with the reason, the rest still go through, and it stays ticked", async () => {
    const user = userEvent.setup();
    const stale = respond({ error: "stale", message: "Versi sudah berubah." }, 409);
    const { api } = await open({ [`DELETE ${LIST}/p1`]: stale, [`DELETE ${LIST}/p3`]: respond(null, 204) });
    await tick(user, "Satu");
    await tick(user, "Tiga");
    await user.click(within(bar()!).getByRole("button", { name: "Hapus" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Hapus" }));
    const notice = await screen.findByText(/1 artikel dihapus\./);
    expect(notice.textContent).toBe("1 artikel dihapus. 1 gagal: “Satu” (sudah diubah orang lain, muat ulang daftar).");
    expect(api.count(`DELETE ${LIST}/p3`)).toBe(1);
    await waitFor(() => expect(within(bar()!).getByText("1 artikel dipilih")).toBeTruthy());
    expect((screen.getByRole("checkbox", { name: "Pilih Satu" }) as HTMLInputElement).checked).toBe(true);
  });

  test("a failure that would hit every row (no permission) stops the run: the rest are not tried, and the notice says so", async () => {
    const user = userEvent.setup();
    const { api } = await open({ [`DELETE ${LIST}/p1`]: respond({ error: "forbidden" }, 403), [`DELETE ${LIST}/p2`]: respond(null, 204) });
    await user.click(screen.getByRole("checkbox", { name: "Pilih semua baris di halaman ini" }));
    await user.click(within(bar()!).getByRole("button", { name: "Hapus" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Hapus" }));
    const notice = await screen.findByText(/Tidak ada artikel yang dihapus\./);
    expect(notice.textContent).toContain("1 gagal: “Satu” (Kamu tidak punya izin untuk melakukan ini.)");
    expect(notice.textContent).toContain("2 lagi tidak diproses karena prosesnya berhenti.");
    expect(api.count(`DELETE ${LIST}/p2`)).toBe(0);
  });

  test("a row someone else already deleted (404) counts as deleted", async () => {
    const user = userEvent.setup();
    await open({ [`DELETE ${LIST}/p1`]: respond({ error: "not_found" }, 404) });
    await tick(user, "Satu");
    await user.click(within(bar()!).getByRole("button", { name: "Hapus" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Hapus" }));
    expect(await screen.findByText("1 artikel dihapus.")).toBeTruthy();
  });

  test("'Batal' on the question sends nothing and keeps the ticks", async () => {
    const user = userEvent.setup();
    const { api } = await open();
    await tick(user, "Satu");
    await user.click(within(bar()!).getByRole("button", { name: "Hapus" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Batal" }));
    expect(api.calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
    expect(within(bar()!).getByText("1 artikel dipilih")).toBeTruthy();
  });

  test("'Terbitkan' goes to the articles that are drafts, with their versions; 'Jadikan draf' only to the published ones", async () => {
    const user = userEvent.setup();
    const { api } = await open({ [`POST ${LIST}/p1/publish`]: respond({ item: ROWS[0] }), [`POST ${LIST}/p3/publish`]: respond({ item: ROWS[2] }) });
    await user.click(screen.getByRole("checkbox", { name: "Pilih semua baris di halaman ini" }));
    expect(within(bar()!).getByRole("button", { name: "Jadikan draf" })).toBeTruthy(); // "Dua" is published
    await user.click(within(bar()!).getByRole("button", { name: "Terbitkan" }));
    expect(await screen.findByText("2 artikel diterbitkan.")).toBeTruthy(); // not 3: the published one is left out
    expect(api.last(`POST ${LIST}/p1/publish`)?.headers["if-match"]).toBe('"2026-10-01T00:00:00.000Z"');
    expect(api.count(`POST ${LIST}/p2/publish`)).toBe(0);
  });

  test("an operation that has no ticked row to work on is not offered", async () => {
    const user = userEvent.setup();
    await open();
    await tick(user, "Satu"); // a draft
    expect(within(bar()!).queryByRole("button", { name: "Jadikan draf" })).toBeNull();
    expect(within(bar()!).getByRole("button", { name: "Terbitkan" })).toBeTruthy();
    await tick(user, "Dua"); // and a published one
    expect(within(bar()!).getByRole("button", { name: "Jadikan draf" })).toBeTruthy();
  });
});

describe("a row's menu", () => {
  test("it offers what applies to that row, and Hapus, and closes on Escape with the focus back on its button", async () => {
    const user = userEvent.setup();
    await open();
    const draft = screen.getByRole("button", { name: "Aksi lainnya untuk Satu" });
    expect(draft.getAttribute("aria-expanded")).toBe("false");
    await user.click(draft);
    expect(draft.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(draft.getAttribute("aria-controls")!)!;
    expect(within(panel).getAllByRole("button").map((button) => button.textContent)).toEqual(["Terbitkan", "Hapus"]);
    // Fixed to the window, not inside the table's box: a table clips what sticks out of its card.
    expect(panel.className).toContain("fixed");
    // The focus is inside the panel when Escape is pressed (Tab walked into it), and goes back to the button that opened it.
    await user.tab();
    expect(panel.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(document.getElementById(draft.getAttribute("aria-controls") ?? "none")).toBeNull();
    expect(document.activeElement).toBe(draft);

    await user.click(screen.getByRole("button", { name: "Aksi lainnya untuk Dua" }));
    expect(within(document.getElementById(screen.getByRole("button", { name: "Aksi lainnya untuk Dua" }).getAttribute("aria-controls")!)!).getAllByRole("button").map((button) => button.textContent)).toEqual(["Jadikan draf", "Hapus"]);
  });

  test("Terbitkan in the menu publishes that row with its version, says so, and loads the list again", async () => {
    const user = userEvent.setup();
    const { api } = await open({ [`POST ${LIST}/p1/publish`]: respond({ item: ROWS[0] }) });
    await user.click(screen.getByRole("button", { name: "Aksi lainnya untuk Satu" }));
    await user.click(screen.getByRole("button", { name: "Terbitkan" }));
    expect(await screen.findByText("1 artikel diterbitkan.")).toBeTruthy();
    expect(api.last(`POST ${LIST}/p1/publish`)?.headers["if-match"]).toBe('"2026-10-01T00:00:00.000Z"');
    expect(api.count(`GET ${LIST}`)).toBe(2);
  });

  test("a press outside closes it", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "Aksi lainnya untuk Satu" }));
    await user.click(document.body);
    expect(screen.queryByRole("button", { name: "Terbitkan" })).toBeNull();
  });
});

describe("Kolom", () => {
  test("every column but the first is offered; unticking one removes it from the table and the choice is kept for the next visit", async () => {
    const user = userEvent.setup();
    const view = await open();
    const table = () => screen.getByRole("table", { name: /Daftar artikel/ });
    expect(within(table()).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["", "Judul", "Kategori", "Status", "Tanggal", "Aksi"]);

    await user.click(screen.getByRole("button", { name: "Kolom" }));
    const group = screen.getByRole("group", { name: "Kolom yang ditampilkan" });
    expect(within(group).getAllByRole("checkbox").map((box) => box.parentElement?.textContent)).toEqual(["Kategori", "Status", "Tanggal"]);
    await user.click(within(group).getByRole("checkbox", { name: "Kategori" }));
    expect(within(table()).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["", "Judul", "Status", "Tanggal", "Aksi"]);
    expect(within(table()).queryByText("Tips")).toBeNull();
    expect(window.localStorage.getItem("sakem-admin:columns:/api/admin/blog")).toBe('["category"]');

    view.unmount();
    await open();
    expect(within(screen.getByRole("table", { name: /Daftar artikel/ })).queryByRole("columnheader", { name: "Kategori" })).toBeNull();
  });

  test("Escape closes the panel and the focus is back on 'Kolom'", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "Kolom" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Kolom yang ditampilkan" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Kolom" }));
  });

  test("'Tampilkan semua' brings them back and forgets the choice", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "Kolom" }));
    expect(screen.queryByRole("button", { name: "Tampilkan semua" })).toBeNull(); // nothing hidden yet
    await user.click(screen.getByRole("checkbox", { name: "Status" }));
    await user.click(screen.getByRole("button", { name: "Tampilkan semua" }));
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeTruthy();
    expect(window.localStorage.getItem("sakem-admin:columns:/api/admin/blog")).toBeNull();
  });

  test("a stored choice of a column that no longer exists is ignored", async () => {
    window.localStorage.setItem("sakem-admin:columns:/api/admin/blog", '["gone","status"]');
    await open();
    expect(screen.queryByRole("columnheader", { name: "Status" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Kategori" })).toBeTruthy();
  });

  test("a stored choice cannot hide the first column, the one that names the row", async () => {
    window.localStorage.setItem("sakem-admin:columns:/api/admin/blog", '["title","category"]');
    await open();
    expect(screen.getByRole("columnheader", { name: "Judul" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Kategori" })).toBeNull();
  });

  test("storage that throws does not stop the list from showing every column", async () => {
    const spy = Object.getOwnPropertyDescriptor(Storage.prototype, "getItem")!;
    Object.defineProperty(Storage.prototype, "getItem", { configurable: true, value: () => { throw new Error("blocked"); } });
    try {
      await open();
      expect(screen.getByRole("columnheader", { name: "Kategori" })).toBeTruthy();
    } finally {
      Object.defineProperty(Storage.prototype, "getItem", spy);
    }
  });
});

describe("Baris per halaman", () => {
  test("a list longer than the smallest size has the select; choosing a size asks for it, writes the address and goes to page 1", async () => {
    const user = userEvent.setup();
    const { api } = await open({ [`GET ${LIST}`]: respond(envelope(ROWS, { total: 87 })) }, ["editor", ["konten"]], "/blog?page=2");
    const select = screen.getByLabelText("Baris per halaman") as HTMLSelectElement;
    expect(select.value).toBe("20");
    await user.selectOptions(select, "50");
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/blog?pageSize=50"));
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=50&sort=-updatedAt`);
    expect((screen.getByLabelText("Baris per halaman") as HTMLSelectElement).value).toBe("50");
  });

  test("a short list has no select", async () => {
    await open();
    expect(screen.queryByLabelText("Baris per halaman")).toBeNull();
  });
});

describe("the sort select of a phone", () => {
  test("it lists the sortable columns both ways, shows the sort in force, and choosing writes it to the address", async () => {
    const user = userEvent.setup();
    const { api } = await open();
    const select = screen.getByLabelText("Urutkan") as HTMLSelectElement;
    // The blog's default sort is by update time, which is not a column: it is shown as "Urutan bawaan".
    expect([...select.options].map((option) => option.textContent)).toEqual(["Urutan bawaan", "Judul (naik)", "Judul (turun)"]);
    expect(select.value).toBe("-updatedAt");
    await user.selectOptions(select, "-title");
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/blog?sort=-title"));
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=20&sort=-title`);
  });
});

describe("the chips of a bar with many filters", () => {
  test("a bar with three controls lists what is set; a chip drops just that filter", async () => {
    const user = userEvent.setup();
    await open({}, ["editor", ["konten"]], "/blog?status=draft&category=Tips&q=halo");
    const chips = screen.getByRole("list", { name: "Filter yang aktif" });
    expect(within(chips).getAllByRole("button").map((chip) => chip.getAttribute("aria-label"))).toEqual([
      "Hapus filter Cari: halo",
      "Hapus filter Kategori: Tips",
      "Hapus filter Status: Draf",
    ]);
    await user.click(within(chips).getByRole("button", { name: "Hapus filter Status: Draf" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/blog?q=halo&category=Tips"));
    await user.click(within(screen.getByRole("list", { name: "Filter yang aktif" })).getByRole("button", { name: "Hapus filter Cari: halo" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/blog?category=Tips"));
    expect((screen.getByLabelText("Cari") as HTMLInputElement).value).toBe("");
  });

  test("no chips while nothing is set", async () => {
    await open();
    expect(screen.queryByRole("list", { name: "Filter yang aktif" })).toBeNull();
  });
});
