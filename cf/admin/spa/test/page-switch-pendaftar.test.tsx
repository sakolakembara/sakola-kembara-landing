import { act, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

// The frame in which Pendaftar has its batches and the address has not yet got the newest one. A `<Navigate>` draws
// nothing itself for the commit it takes to land, and the page went blank for it. Here `Navigate` is stood in by a
// component that never navigates, so that frame stays on screen to be looked at: the page must be up in it.

vi.mock("react-router", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-router")>()), Navigate: () => null }));

const batch = { id: "b26", year: 2026, name: "Gen 7", description: null, opensAt: "2026-08-01T00:00:00.000Z", closesAt: "2026-09-30T00:00:00.000Z", resultsPublishedAt: null, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", phase: "open", pending: 0, underReview: 0 };

describe("Pendaftar while the address is given the newest batch", () => {
  test("the page is not blank: its title, tabs, the switched-off search and the grey rows are still there", async () => {
    const gate = deferred<Response>();
    const api = stubApi({
      "GET /api/me": respond(meBody("editor", ["pendaftaran"])),
      "GET /api/admin/batches": () => gate.promise,
      "GET /api/admin/applications": respond({ items: [], page: 1, pageSize: 20, total: 0 }),
    });
    renderApp("/applications");
    await screen.findByRole("heading", { level: 1, name: "Pendaftar" });
    await act(async () => gate.resolve(respond({ items: [batch], page: 1, pageSize: 20, total: 1 })));
    await act(async () => {});
    // The batches are known and the address has no batch: the redirect is due, and has not happened.
    expect(screen.getByRole("heading", { level: 1, name: "Pendaftar" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Bagian Pendaftar" })).toBeTruthy();
    expect(screen.getByLabelText("Cari").closest("fieldset")?.disabled).toBe(true);
    expect(document.querySelectorAll("tbody tr[aria-hidden=true]")).toHaveLength(5);
    // Nothing is asked for under the wrong address.
    expect(api.count("GET /api/admin/applications")).toBe(0);
  });
});
