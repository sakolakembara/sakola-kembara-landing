import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

// Moving from page to page in the admin (SAKEM-115): nothing false is said while a page is on its way, nothing that
// is not there yet is added later under everything else, and a page opens at its top. Measured on the mock admin as
// a blank frame on Pendaftar and a page opening 66 px down; these are what keeps each of them from coming back. (The line
// under a title, "0 anggota" turning into the real count, is gone with it: a page has its title only, 2026-11-01.)

const batch = { id: "b26", year: 2026, name: "Gen 7", description: null, opensAt: "2026-08-01T00:00:00.000Z", closesAt: "2026-09-30T00:00:00.000Z", resultsPublishedAt: null, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", phase: "open", pending: 0, underReview: 0 };
const envelope = (items: unknown[], extra: { total?: number } = {}) => ({ items, page: 1, pageSize: 20, total: extra.total ?? items.length });
const post = (id: string, title: string) => ({ id, slug: id, title, excerpt: "Ringkasan", category: "Tips", author: "Dzul", featured: false, status: "draft", date: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" });

describe("Pesan: the numbers of the pills", () => {
  const messages = "/api/admin/messages";

  test("coming back shows the numbers at once (the last answer is kept) and asks again", async () => {
    const second = deferred<Response>();
    let call = 0;
    const api = stubApi({
      "GET /api/me": respond(meBody("viewer")),
      [`GET ${messages}`]: respond(envelope([])),
      [`GET ${messages}/counts`]: () => (++call === 1 ? respond({ total: 12, unread: 3 }) : second.promise),
    });
    const first = renderApp("/messages");
    await screen.findByRole("link", { name: "Semua (12)" });
    first.unmount();
    renderApp("/messages");
    expect(await screen.findByRole("link", { name: "Semua (12)" })).toBeTruthy();
    await waitFor(() => expect(api.count(`GET ${messages}/counts`)).toBe(2));
    await act(async () => second.resolve(respond({ total: 13, unread: 4 })));
    expect(await screen.findByRole("link", { name: "Semua (13)" })).toBeTruthy();
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
