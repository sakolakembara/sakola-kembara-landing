import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { type Column, DataTable } from "~/components/crud/DataTable";
import { Flash } from "~/components/crud/Flash";
import { FilterBar } from "~/components/crud/FilterBar";
import { Pagination } from "~/components/crud/Pagination";
import { makeStatusMap, StatusTag } from "~/components/crud/StatusTag";
import { flashState, readFlash, useFlash } from "~/lib/crud/flash";
import type { ListQuery } from "~/lib/crud/query";
import { renderAt } from "../helpers";

interface Row {
  id: string;
  name: string;
}

const COLUMNS: Column<Row>[] = [
  { key: "name", header: "Nama", cell: (row) => row.name },
  { key: "id", header: "Kode", cell: (row) => row.id },
];
const ROWS: Row[] = [
  { id: "a1", name: "Satu" },
  { id: "b2", name: "Dua" },
];

function table(overrides: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return (
    <DataTable<Row>
      caption="Daftar contoh"
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(row) => row.id}
      state="ready"
      emptyText="Belum ada contoh."
      {...overrides}
    />
  );
}

describe("DataTable", () => {
  test("rows, a header per column with scope, and a caption that names the table", () => {
    render(table());
    const grid = screen.getByRole("table", { name: /Daftar contoh/ });
    expect(within(grid).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Nama", "Kode"]);
    for (const header of within(grid).getAllByRole("columnheader")) expect(header.getAttribute("scope")).toBe("col");
    expect(within(grid).getAllByRole("row")).toHaveLength(3); // header + 2
    expect(within(grid).getByText("Dua")).toBeTruthy();
    // The caption names the table for screen readers; a phone draws the rows as cards, so it no longer says to scroll.
    expect(grid.querySelector("caption")?.textContent).toBe("Daftar contoh.");
  });

  test("loading: one status row, the table is busy, the header stays", () => {
    const { container } = render(table({ rows: [], state: "loading" }));
    expect(screen.getByRole("status").textContent).toBe("Memuat data...");
    expect(container.firstElementChild?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
  });

  test("loading: grey pulsing rows, one cell per column, hidden from screen readers (the status row speaks for them)", () => {
    const { container } = render(table({ rows: [], state: "loading", actions: () => null }));
    const grey = container.querySelectorAll("tbody tr[aria-hidden=true]");
    expect(grey).toHaveLength(5);
    for (const row of grey) {
      expect(row.querySelectorAll("td")).toHaveLength(3);
      expect(row.querySelectorAll(".animate-pulse")).toHaveLength(3);
    }
    // Only the status row is in the accessibility tree besides the header.
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  test("rows that are shown again while the new answer comes dim only after a delay, so a quick confirmation does not flash", () => {
    const { container, rerender } = render(table({ rows: ROWS, state: "ready", refreshing: true }));
    expect(container.querySelector("tbody")?.className).toContain("delay-300");
    rerender(table({ rows: ROWS, state: "ready", refreshing: false }));
    expect(container.querySelector("tbody")?.className).not.toContain("delay-300");
  });

  test("error: an alert with the sentence and 'Coba lagi', which calls retry", async () => {
    const retry = vi.fn();
    render(table({ rows: [], state: "error", errorMessage: "Tidak dapat terhubung ke server.", onRetry: retry }));
    expect(screen.getByRole("alert").textContent).toBe("Tidak dapat terhubung ke server.");
    await userEvent.setup().click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  test("error without a retry has no button; without a message it has a default one", () => {
    render(table({ rows: [], state: "error" }));
    expect(screen.getByRole("alert").textContent).toBe("Gagal memuat data.");
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("empty: the sentence of the caller, in one row that spans every column", () => {
    render(table({ rows: [] }));
    const cell = screen.getByText("Belum ada contoh.").closest("td")!;
    expect(cell.getAttribute("colspan")).toBe("2");
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("an error never shows old rows next to the failure", () => {
    render(table({ state: "error", errorMessage: "Gagal." }));
    expect(screen.queryByText("Satu")).toBeNull();
  });

  test("refreshing keeps the rows and marks the table busy", () => {
    const { container } = render(table({ refreshing: true }));
    expect(screen.getByText("Satu")).toBeTruthy();
    expect(container.firstElementChild?.getAttribute("aria-busy")).toBe("true");
  });

  test("an actions column: a header for screen readers only, and the buttons of each row", () => {
    render(table({ actions: (row) => <button>{`Edit ${row.name}`}</button> }));
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(screen.getByRole("columnheader", { name: "Aksi" }).querySelector(".sr-only")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Satu" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Dua" })).toBeTruthy();
    // The empty and error rows span the actions column too.
    render(table({ rows: [], actions: () => null }));
    expect(screen.getAllByText("Belum ada contoh.").at(-1)!.closest("td")!.getAttribute("colspan")).toBe("3");
  });
});

describe("Pagination", () => {
  const searchFor = (page: number) => `?page=${page}`;

  test("nothing when there is no data; a count when it all fits on one page", () => {
    const { container, rerender } = render(<Pagination page={1} pageSize={20} total={0} searchFor={searchFor} />);
    expect(container.firstChild).toBeNull();
    rerender(<Pagination page={1} pageSize={20} total={13} searchFor={searchFor} />);
    expect(screen.getByText("13 data")).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  test("a middle page: links to the neighbours with their query, the current page marked, the range in words", () => {
    renderAt(<Pagination page={3} pageSize={20} total={87} searchFor={searchFor} />);
    const nav = screen.getByRole("navigation", { name: "Halaman" });
    expect(screen.getByText("Menampilkan 41 sampai 60 dari 87")).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Sebelumnya" }).getAttribute("href")).toBe("/?page=2");
    expect(within(nav).getByRole("link", { name: "Berikutnya" }).getAttribute("href")).toBe("/?page=4");
    expect(within(nav).getByRole("link", { name: "Halaman 5" }).getAttribute("href")).toBe("/?page=5");
    const current = nav.querySelector('[aria-current="page"]')!;
    expect(current.textContent).toBe("3");
    expect(current.tagName).not.toBe("A"); // the current page is not a link to itself
  });

  test("the first page has no 'Sebelumnya' link, the last has no 'Berikutnya' link: text, marked disabled", () => {
    const first = renderAt(<Pagination page={1} pageSize={20} total={87} searchFor={searchFor} />);
    expect(screen.queryByRole("link", { name: "Sebelumnya" })).toBeNull();
    expect(screen.getByText("Sebelumnya").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("link", { name: "Berikutnya" })).toBeTruthy();
    first.unmount();
    renderAt(<Pagination page={5} pageSize={20} total={87} searchFor={searchFor} />);
    expect(screen.queryByRole("link", { name: "Berikutnya" })).toBeNull();
    expect(screen.getByText("Menampilkan 81 sampai 87 dari 87")).toBeTruthy();
  });

  test("many pages: the ends and the neighbours, gaps hidden from assistive technology", () => {
    renderAt(<Pagination page={10} pageSize={10} total={200} searchFor={searchFor} />);
    const nav = screen.getByRole("navigation", { name: "Halaman" });
    const labels = within(nav)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(labels).toEqual(["1", "…", "9", "10", "11", "…", "20"]);
    expect(nav.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });

  test("it is keyboard-usable: the links are in the tab order and Enter follows one", async () => {
    const user = userEvent.setup();
    renderAt(<Pagination page={2} pageSize={20} total={87} searchFor={searchFor} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Sebelumnya" }));
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("location").textContent).toBe("/?page=1");
  });

  test("numbers use the Indonesian thousands separator", () => {
    renderAt(<Pagination page={1} pageSize={20} total={12345} searchFor={searchFor} />);
    expect(screen.getByText("Menampilkan 1 sampai 20 dari 12.345")).toBeTruthy();
  });
});

describe("FilterBar", () => {
  const query = (overrides: Partial<ListQuery> = {}): ListQuery => ({ page: 1, q: "", sort: "", filters: {}, ...overrides });
  const FILTERS = [{ name: "severity", label: "Severity", allLabel: "Semua severity", options: [{ value: "info", label: "Info" }, { value: "urgent", label: "Mendesak" }] }];

  function bar(q: ListQuery) {
    const apply = vi.fn();
    const reset = vi.fn();
    const ui = (current: ListQuery) => <FilterBar list={{ query: current, apply, reset }} search={{ placeholder: "Judul atau isi" }} filters={FILTERS} />;
    const view = render(ui(q));
    return { apply, reset, view, rerender: (next: ListQuery) => view.rerender(ui(next)) };
  }

  test("every control has a label, and the form is a search landmark; there is no button to press to apply", () => {
    bar(query());
    expect(screen.getByRole("search", { name: "Saring daftar" })).toBeTruthy();
    expect(screen.getByLabelText("Cari")).toBeTruthy();
    expect(screen.getByLabelText("Severity")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Terapkan" })).toBeNull();
    expect(screen.getByRole("option", { name: "Semua severity" })).toBeTruthy();
  });

  test("a filter applies the moment it is chosen, together with the search as it stands", async () => {
    const user = userEvent.setup();
    const { apply } = bar(query());
    await user.type(screen.getByLabelText("Cari"), "halo dunia");
    await user.selectOptions(screen.getByLabelText("Severity"), "urgent");
    expect(apply).toHaveBeenCalledWith({ q: "halo dunia", filters: { severity: "urgent" } });
  });

  test("choosing the 'all' option drops that filter and keeps the others out of the call when empty", async () => {
    const user = userEvent.setup();
    const { apply } = bar(query({ filters: { severity: "info" } }));
    await user.selectOptions(screen.getByLabelText("Severity"), "");
    expect(apply).toHaveBeenCalledWith({ q: "", filters: {} });
  });

  test("the search applies after a pause in typing, not at every key", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { apply } = bar(query({ filters: { severity: "info" } }));
      fireEvent.change(screen.getByLabelText("Cari"), { target: { value: "halo" } });
      act(() => void vi.advanceTimersByTime(349));
      expect(apply).not.toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(1));
      expect(apply).toHaveBeenCalledOnce();
      expect(apply).toHaveBeenCalledWith({ q: "halo", filters: { severity: "info" } });
    } finally {
      vi.useRealTimers();
    }
  });

  test("Enter in the search box applies at once", async () => {
    const user = userEvent.setup();
    const { apply } = bar(query());
    await user.type(screen.getByLabelText("Cari"), "halo{Enter}");
    expect(apply).toHaveBeenCalledWith({ q: "halo", filters: {} });
  });

  test("the address bar echoing the search does not overwrite what was typed since", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { apply, rerender } = bar(query());
      fireEvent.change(screen.getByLabelText("Cari"), { target: { value: "ab" } });
      act(() => void vi.advanceTimersByTime(350));
      expect(apply).toHaveBeenCalledWith({ q: "ab", filters: {} });
      fireEvent.change(screen.getByLabelText("Cari"), { target: { value: "abc" } });
      rerender(query({ q: "ab" }));
      expect((screen.getByLabelText("Cari") as HTMLInputElement).value).toBe("abc");
    } finally {
      vi.useRealTimers();
    }
  });

  test("it shows what the address bar says, and follows it when it changes (the back button)", () => {
    const { rerender } = bar(query({ q: "halo", filters: { severity: "info" } }));
    expect((screen.getByLabelText("Cari") as HTMLInputElement).value).toBe("halo");
    expect((screen.getByLabelText("Severity") as HTMLSelectElement).value).toBe("info");
    rerender(query({ q: "lain", filters: {} }));
    expect((screen.getByLabelText("Cari") as HTMLInputElement).value).toBe("lain");
    expect((screen.getByLabelText("Severity") as HTMLSelectElement).value).toBe("");
  });

  test("'Hapus filter' appears only when something narrows the list, and resets", async () => {
    const user = userEvent.setup();
    const { reset, rerender } = bar(query());
    expect(screen.queryByRole("button", { name: "Hapus filter" })).toBeNull();
    rerender(query({ q: "halo" }));
    await user.click(screen.getByRole("button", { name: "Hapus filter" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  test("a bar with no search and no filters renders nothing", () => {
    const { container } = render(<FilterBar list={{ query: query(), apply: vi.fn(), reset: vi.fn() }} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("StatusTag", () => {
  const MAP = makeStatusMap({ info: { label: "Info", tone: "blue" }, urgent: { label: "Mendesak", tone: "red" } });

  test("a known value is its label in its tone", () => {
    render(<StatusTag map={MAP} value="urgent" />);
    expect(screen.getByText("Mendesak").className).toContain("bg-danger-bg");
  });

  test("an unknown value is a gray pill with the raw value, never a crash or an empty cell", () => {
    const { rerender } = render(<StatusTag map={MAP} value="baru" />);
    expect(screen.getByText("baru").className).toContain("bg-gray-100");
    rerender(<StatusTag map={MAP} value="" />);
    expect(screen.getByText("-")).toBeTruthy();
    rerender(<StatusTag map={MAP} value={null} />);
    expect(screen.getByText("-")).toBeTruthy();
  });

  test("a value that is a property of every object is not a status", () => {
    for (const value of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const view = render(<StatusTag map={MAP} value={value} />);
      expect(view.getByText(value).className).toContain("bg-gray-100");
      view.unmount();
    }
  });
});

describe("Flash", () => {
  test("a success is a polite status, an error an alert; both can be dismissed", async () => {
    const user = userEvent.setup();
    const dismiss = vi.fn();
    const { rerender } = render(<Flash flash={{ tone: "success", text: "Pengumuman berhasil disimpan." }} dismiss={dismiss} />);
    expect(screen.getByRole("status").textContent).toContain("Pengumuman berhasil disimpan.");
    rerender(<Flash flash={{ tone: "danger", text: "Gagal." }} dismiss={dismiss} />);
    expect(screen.getByRole("alert").textContent).toContain("Gagal.");
    await user.click(screen.getByRole("button", { name: "Tutup pesan" }));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  test("nothing without a message", () => {
    const { container } = render(<Flash flash={null} dismiss={() => undefined} />);
    expect(container.firstChild).toBeNull();
  });

  test("readFlash only believes its own shape", () => {
    expect(readFlash(flashState({ tone: "success", text: "Halo." }))).toEqual({ tone: "success", text: "Halo." });
    for (const odd of [null, undefined, "x", {}, { flash: null }, { flash: { tone: "weird", text: "a" } }, { flash: { tone: "success", text: "" } }, { flash: { tone: "success", text: 5 } }, { flash: "x" }]) {
      expect(readFlash(odd), JSON.stringify(odd)).toBeNull();
    }
  });
});

describe("useFlash: a notice that survives a route change", () => {
  function Page() {
    const notice = useFlash();
    return (
      <div>
        <Flash flash={notice.flash} dismiss={notice.dismiss} />
        <button onClick={() => notice.show({ tone: "success", text: "Dari halaman ini." })}>tampilkan</button>
      </div>
    );
  }

  test("a notice that came with the navigation is shown, and taken out of the history entry so a reload does not show it again", async () => {
    const view = renderAt(<Page />, "/daftar");
    expect(screen.queryByRole("status")).toBeNull();
    await view.router.navigate("/daftar?x=1", { state: flashState({ tone: "success", text: "Pengumuman berhasil dibuat." }) });
    expect((await screen.findByRole("status")).textContent).toContain("Pengumuman berhasil dibuat.");
    // The history entry no longer holds it.
    await vi.waitFor(() => expect(view.router.state.location.state).toBeNull());
    expect(screen.getByRole("status").textContent).toContain("Pengumuman berhasil dibuat."); // still on screen
  });

  test("it is there from the first render when the page opens with one", async () => {
    const router = renderAt(<Page />, "/daftar").router;
    await router.navigate("/lain", { state: flashState({ tone: "danger", text: "Tidak ditemukan." }) });
    expect((await screen.findByRole("alert")).textContent).toContain("Tidak ditemukan.");
  });

  test("show() raises one on the page itself; dismiss removes it", async () => {
    const user = userEvent.setup();
    renderAt(<Page />, "/daftar");
    fireEvent.click(screen.getByText("tampilkan"));
    expect(screen.getByRole("status").textContent).toContain("Dari halaman ini.");
    await user.click(screen.getByRole("button", { name: "Tutup pesan" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("DataTable: sort buttons", () => {
  const SORTABLE: Column<Row>[] = [
    { key: "name", header: "Nama", sort: "name", cell: (row) => row.name },
    { key: "id", header: "Kode", sort: "code", sortFirst: "desc", cell: (row) => row.id },
    { key: "plain", header: "Biasa", cell: () => "-" },
  ];
  const header = (name: string) => screen.getByRole("columnheader", { name });

  test("a sortable column has a button in its header, and aria-sort says what is in force", () => {
    render(table({ columns: SORTABLE, sort: { value: "-code", onChange: vi.fn() } }));
    expect(header("Nama").getAttribute("aria-sort")).toBe("none");
    expect(header("Kode").getAttribute("aria-sort")).toBe("descending");
    expect(within(header("Nama")).getByRole("button", { name: "Nama" })).toBeTruthy();
    // A column with no sort is plain text and says nothing about order.
    expect(header("Biasa").hasAttribute("aria-sort")).toBe(false);
    expect(within(header("Biasa")).queryByRole("button")).toBeNull();
  });

  test("pressing it sorts ascending, then flips each press", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const view = render(table({ columns: SORTABLE, sort: { value: "code", onChange } }));
    await user.click(screen.getByRole("button", { name: "Nama" }));
    expect(onChange).toHaveBeenLastCalledWith("name");
    view.rerender(table({ columns: SORTABLE, sort: { value: "name", onChange } }));
    await user.click(screen.getByRole("button", { name: "Nama" }));
    expect(onChange).toHaveBeenLastCalledWith("-name");
    view.rerender(table({ columns: SORTABLE, sort: { value: "-name", onChange } }));
    await user.click(screen.getByRole("button", { name: "Nama" }));
    expect(onChange).toHaveBeenLastCalledWith("name");
  });

  test("a date or an amount starts with the biggest first, then flips", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const view = render(table({ columns: SORTABLE, sort: { value: "name", onChange } }));
    await user.click(screen.getByRole("button", { name: "Kode" }));
    expect(onChange).toHaveBeenLastCalledWith("-code");
    view.rerender(table({ columns: SORTABLE, sort: { value: "-code", onChange } }));
    await user.click(screen.getByRole("button", { name: "Kode" }));
    expect(onChange).toHaveBeenLastCalledWith("code");
  });

  test("without a sort the headers are plain text, whatever the columns say", () => {
    render(table({ columns: SORTABLE }));
    expect(screen.queryByRole("button", { name: "Nama" })).toBeNull();
    expect(header("Nama").hasAttribute("aria-sort")).toBe(false);
  });
});

describe("DataTable: empty states", () => {
  test("an icon over the sentence, and the action when there is one", () => {
    const { container } = render(table({ rows: [], emptyAction: <button type="button">Tampilkan semua</button> }));
    expect(screen.getByText("Belum ada contoh.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tampilkan semua" })).toBeTruthy();
    expect(container.querySelector(".lucide-inbox")).toBeTruthy();
    // The icon is decoration.
    expect(container.querySelector(".lucide-inbox")?.closest("[aria-hidden=true]")).toBeTruthy();
  });

  test("a search that found nothing has its own icon, and no action unless given", () => {
    const { container } = render(table({ rows: [], emptyFiltered: true }));
    expect(container.querySelector(".lucide-search-x")).toBeTruthy();
    expect(container.querySelector(".lucide-inbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("DataTable: cards on a phone", () => {
  // jsdom draws no CSS, so this checks what the CSS works from: the labels, the roles and the classes that switch at `md`.
  test("every cell after the first carries its column's name; the first is the card's title", () => {
    render(table());
    const cells = within(screen.getAllByRole("row")[1]!).getAllByRole("cell");
    expect(cells.map((cell) => cell.getAttribute("data-label"))).toEqual(["Nama", "Kode"]);
    expect(cells[0]!.className).toContain("max-md:before:hidden");
    expect(cells[1]!.className).toContain("max-md:before:content-[attr(data-label)]");
  });

  test("a column whose header is not text has no label (an empty one would leave a gap)", () => {
    render(table({ columns: [COLUMNS[0]!, { key: "x", header: <span>Ikon</span>, cell: () => "x" }] }));
    const cells = within(screen.getAllByRole("row")[1]!).getAllByRole("cell");
    expect(cells[1]!.hasAttribute("data-label")).toBe(false);
    expect(cells[1]!.className).toContain("max-md:before:hidden");
  });

  test("the table's semantics are written out, because a table drawn as blocks loses them in some browsers", () => {
    render(table());
    const grid = screen.getByRole("table");
    expect(grid.getAttribute("role")).toBe("table");
    expect(grid.className).toContain("max-md:block");
    expect(within(grid).getAllByRole("rowgroup")).toHaveLength(2);
    expect(within(grid).getAllByRole("row")).toHaveLength(3);
    expect(within(grid).getAllByRole("cell")).toHaveLength(4);
    expect(within(grid).getAllByRole("columnheader")).toHaveLength(2);
  });

  test("the header row stays for screen readers on a phone, not on screen", () => {
    render(table());
    expect(screen.getAllByRole("columnheader")[0]!.closest("thead")!.className).toContain("max-md:sr-only");
  });

  test("the actions go last in the card, under the cells", () => {
    render(table({ actions: () => <button type="button">Ubah</button> }));
    const cells = within(screen.getAllByRole("row")[1]!).getAllByRole("cell");
    expect(cells).toHaveLength(3);
    expect(within(cells[2]!).getByRole("button", { name: "Ubah" })).toBeTruthy();
    expect(cells[2]!.className).toContain("max-md:flex");
  });
});
