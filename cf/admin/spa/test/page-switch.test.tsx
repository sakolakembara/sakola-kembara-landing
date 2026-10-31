import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { clearReadCache } from "~/lib/crud/readCache";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

// Moving from page to page in the admin (SAKEM-115): nothing false is said while a page is on its way, nothing that
// is not there yet is added later under everything else, and a page opens at its top. Measured on the mock admin as
// "0 anggota" turning into the real count, a blank frame on Pendaftar, a description line popping in on Pesan and a
// page opening 66 px down; these are what keeps each of them from coming back.

const batch = { id: "b26", year: 2026, name: "Gen 7", description: null, opensAt: "2026-08-01T00:00:00.000Z", closesAt: "2026-09-30T00:00:00.000Z", resultsPublishedAt: null, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", phase: "open", pending: 0, underReview: 0 };
const envelope = (items: unknown[], extra: { total?: number } = {}) => ({ items, page: 1, pageSize: 20, total: extra.total ?? items.length });
const post = (id: string, title: string) => ({ id, slug: id, title, excerpt: "Ringkasan", category: "Tips", author: "Dzul", featured: false, status: "draft", date: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" });

const hasSkeleton = (root: HTMLElement) => root.querySelector('[aria-hidden="true"].animate-pulse') !== null;

describe("a description that counts the list", () => {
  test("says nothing, not '0 total artikel', until the list is there; then the real number", async () => {
    const list = deferred<Response>();
    stubApi({ "GET /api/me": respond(meBody("viewer")), "GET /api/admin/blog": () => list.promise });
    renderApp("/blog");
    const heading = await screen.findByRole("heading", { level: 1, name: "Blog" });
    const header = heading.parentElement!;
    expect(hasSkeleton(header)).toBe(true);
    expect(screen.queryByText(/total artikel/)).toBeNull();

    await act(async () => list.resolve(respond(envelope([post("p1", "Satu"), post("p2", "Dua")]))));
    expect(await screen.findByText("2 total artikel")).toBeTruthy();
    expect(hasSkeleton(header)).toBe(false);
  });

  test("a list that is asked for again keeps its description (rows from before are on screen): no skeleton", async () => {
    const user = userEvent.setup();
    const second = deferred<Response>();
    let call = 0;
    stubApi({
      "GET /api/me": respond(meBody("viewer")),
      "GET /api/admin/blog": () => (++call === 1 ? respond(envelope([post("p1", "Satu")])) : second.promise),
    });
    renderApp("/blog");
    await screen.findByText("1 total artikel");
    await user.selectOptions(screen.getByLabelText("Status"), "draft");
    await waitFor(() => expect(call).toBe(2));
    expect(screen.getByText("1 artikel ditampilkan")).toBeTruthy();
    expect(hasSkeleton(screen.getByRole("heading", { level: 1, name: "Blog" }).parentElement!)).toBe(false);
    await act(async () => second.resolve(respond(envelope([]))));
  });
});

describe("Pesan: the line with the two numbers", () => {
  const messages = "/api/admin/messages";

  test("is held while the numbers are on their way, and filled in; a request that fails leaves no line and no grey one", async () => {
    const counts = deferred<Response>();
    stubApi({ "GET /api/me": respond(meBody("viewer")), [`GET ${messages}`]: respond(envelope([])), [`GET ${messages}/counts`]: () => counts.promise });
    const first = renderApp("/messages");
    const heading = await screen.findByRole("heading", { level: 1, name: "Pesan" });
    expect(hasSkeleton(heading.parentElement!)).toBe(true);
    await act(async () => counts.resolve(respond({ total: 12, unread: 3 })));
    expect(await screen.findByText("12 total · 3 belum dibaca.")).toBeTruthy();
    first.unmount();

    // From nothing (no kept answer): the line is grey while the request is on its way, and gone once it has failed.
    clearReadCache();
    const failing = deferred<Response>();
    stubApi({ "GET /api/me": respond(meBody("viewer")), [`GET ${messages}`]: respond(envelope([])), [`GET ${messages}/counts`]: () => failing.promise });
    renderApp("/messages");
    const again = await screen.findByRole("heading", { level: 1, name: "Pesan" });
    expect(hasSkeleton(again.parentElement!)).toBe(true);
    await act(async () => failing.resolve(respond({ error: "internal" }, 500)));
    await waitFor(() => expect(hasSkeleton(again.parentElement!)).toBe(false));
    expect(screen.queryByText(/belum dibaca\./)).toBeNull();
  });

  test("coming back shows the numbers at once (the last answer is kept) and asks again", async () => {
    const second = deferred<Response>();
    let call = 0;
    const api = stubApi({
      "GET /api/me": respond(meBody("viewer")),
      [`GET ${messages}`]: respond(envelope([])),
      [`GET ${messages}/counts`]: () => (++call === 1 ? respond({ total: 12, unread: 3 }) : second.promise),
    });
    const first = renderApp("/messages");
    await screen.findByText("12 total · 3 belum dibaca.");
    first.unmount();
    renderApp("/messages");
    expect(await screen.findByText("12 total · 3 belum dibaca.")).toBeTruthy();
    await waitFor(() => expect(api.count(`GET ${messages}/counts`)).toBe(2));
    await act(async () => second.resolve(respond({ total: 13, unread: 4 })));
    expect(await screen.findByText("13 total · 4 belum dibaca.")).toBeTruthy();
  });
});

describe("Pendaftar while the batches are on their way", () => {
  const batches = "/api/admin/batches";
  const applications = "/api/admin/applications";
  const who: Parameters<typeof meBody> = ["editor", ["pendaftaran"]];

  test("the page is drawn with its parts in their places: title, tabs, the search switched off, grey rows; no 'Memuat data...' line alone", async () => {
    const gate = deferred<Response>();
    stubApi({ "GET /api/me": respond(meBody(...who)), [`GET ${batches}`]: () => gate.promise, [`GET ${applications}`]: respond(envelope([])) });
    renderApp("/applications");
    expect(await screen.findByRole("heading", { level: 1, name: "Pendaftar" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Bagian Pendaftar" })).toBeTruthy();
    expect(screen.getByLabelText("Cari").closest("fieldset")?.disabled).toBe(true);
    expect(screen.getByRole("table", { name: /Daftar pendaftar/ }).getAttribute("aria-busy") ?? screen.getByRole("status").textContent).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Memuat data...");
    expect(document.querySelectorAll("tbody tr[aria-hidden=true]")).toHaveLength(5);
    await act(async () => gate.resolve(respond(envelope([batch]))));
    await waitFor(() => expect(screen.getByLabelText("Cari").closest("fieldset")).toBeNull());
  });

  test("coming back, the page does not wait for the batches before asking for the applicants (the last answer is kept)", async () => {
    const second = deferred<Response>();
    let call = 0;
    const api = stubApi({
      "GET /api/me": respond(meBody(...who)),
      [`GET ${batches}`]: () => (++call === 1 ? respond(envelope([batch])) : second.promise),
      [`GET ${applications}`]: respond(envelope([])),
    });
    const first = renderApp("/applications");
    await waitFor(() => expect(screen.getByLabelText("Cari").closest("fieldset")).toBeNull());
    first.unmount();
    const before = api.count(`GET ${applications}`);
    renderApp("/applications");
    // The batches of the second visit are still on their way, and the applicants have been asked for already.
    await waitFor(() => expect(api.count(`GET ${applications}`)).toBe(before + 1));
    expect(api.count(`GET ${batches}`)).toBe(2);
    await act(async () => second.resolve(respond(envelope([batch]))));
  });

  test("once the batches are known the count waits for the applicants: a grey line, not '0 pendaftar', then the real number", async () => {
    const list = deferred<Response>();
    stubApi({ "GET /api/me": respond(meBody(...who)), [`GET ${batches}`]: respond(envelope([batch])), [`GET ${applications}`]: () => list.promise });
    renderApp("/applications?batch=b26");
    await waitFor(() => expect(screen.getByLabelText("Cari").closest("fieldset")).toBeNull());
    const header = screen.getByRole("heading", { level: 1, name: "Pendaftar" }).parentElement!;
    expect(hasSkeleton(header)).toBe(true);
    expect(screen.queryByText(/\d+ pendaftar\./)).toBeNull();
    await act(async () => list.resolve(respond(envelope([], { total: 0 }))));
    expect(await screen.findByText(/0 pendaftar\./)).toBeTruthy();
    expect(hasSkeleton(header)).toBe(false);
  });

  test("a failure to load the batches says so, with 'Coba lagi'", async () => {
    stubApi({ "GET /api/me": respond(meBody(...who)), [`GET ${batches}`]: respond({ error: "internal" }, 500) });
    renderApp("/applications");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(within(screen.getByRole("main")).getByRole("button", { name: "Coba lagi" })).toBeTruthy();
  });
});

describe("a page opens at its top", () => {
  test("going to another page scrolls <main> back to 0; changing a filter on the same page does not", async () => {
    const user = userEvent.setup();
    stubApi({
      "GET /api/me": respond(meBody("super_admin")),
      "GET /api/dashboard": respond({ attention: {} }),
      "GET /api/admin/blog": respond(envelope([post("p1", "Satu")])),
      "GET /api/admin/team": respond(envelope([])),
    });
    renderApp("/blog");
    await screen.findByText("Satu");
    const main = screen.getByRole("main");
    let top = 0;
    Object.defineProperty(main, "scrollTop", { configurable: true, get: () => top, set: (value: number) => void (top = value) });

    top = 500;
    await user.selectOptions(screen.getByLabelText("Status"), "draft");
    await screen.findByText("Satu");
    expect(top).toBe(500); // the same page, a new filter: the reader keeps their place

    await user.click(within(screen.getByRole("navigation", { name: "Menu utama" })).getByRole("link", { name: "Tim" }));
    await screen.findByRole("heading", { level: 1, name: "Tim" });
    expect(top).toBe(0);
  });
});
