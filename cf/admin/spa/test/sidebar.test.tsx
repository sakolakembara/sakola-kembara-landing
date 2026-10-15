import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

async function openAs(role: Parameters<typeof meBody>[0], areas: Parameters<typeof meBody>[1] = [], path = "/") {
  const api = stubApi({
    "GET /api/me": respond(meBody(role, areas)),
    // The dashboard is not the subject here.
    "GET /api/dashboard": respond({ error: "not_found" }, 404),
  });
  renderApp(path);
  const nav = await screen.findByRole("navigation", { name: "Menu utama" });
  return { api, nav };
}

const names = (nav: HTMLElement) => within(nav).getAllByRole("link").map((link) => link.textContent);

describe("sidebar", () => {
  test("super_admin sees every entry, grouped, in the approved order", async () => {
    const { nav } = await openAs("super_admin");
    expect(names(nav)).toEqual([
      "Dashboard",
      "Batch",
      "Pendaftar",
      "Pusat Dokumen",
      "Pesan",
      "Pengumuman",
      "Blog",
      "Laporan",
      "Tim",
      "Shortlink",
      "Aktivitas",
      "Pengaturan",
    ]);
    // Group headings label their lists.
    for (const [group, items] of [
      ["Pendaftaran", ["Batch", "Pendaftar", "Pusat Dokumen"]],
      ["Komunikasi", ["Pesan", "Pengumuman"]],
      ["Konten Situs", ["Blog", "Laporan", "Tim", "Shortlink"]],
      ["Sistem", ["Aktivitas", "Pengaturan"]],
    ] as const) {
      const list = within(nav).getByRole("list", { name: group });
      expect(within(list).getAllByRole("link").map((link) => link.textContent)).toEqual(items);
    }
  });

  test("a viewer has no Sistem group", async () => {
    const { nav } = await openAs("viewer");
    expect(names(nav)).toEqual(["Dashboard", "Batch", "Pendaftar", "Pusat Dokumen", "Pesan", "Pengumuman", "Blog", "Laporan", "Tim", "Shortlink"]);
    expect(within(nav).queryByText("Sistem")).toBeNull();
    expect(screen.getAllByText("Hanya baca").length).toBeGreaterThan(0);
  });

  test("an editor sees the dashboard and the menus of the areas granted to them, not the others", async () => {
    const { nav } = await openAs("editor", ["konten"]);
    expect(names(nav)).toEqual(["Dashboard", "Blog", "Laporan", "Tim", "Shortlink"]);
    expect(within(nav).queryByText("Pendaftaran")).toBeNull();
    expect(within(nav).queryByText("Komunikasi")).toBeNull();
    expect(within(nav).queryByText("Sistem")).toBeNull();
  });

  test("an editor of two areas sees those two groups", async () => {
    const { nav } = await openAs("editor", ["pendaftaran", "komunikasi"]);
    expect(names(nav)).toEqual(["Dashboard", "Batch", "Pendaftar", "Pusat Dokumen", "Pesan", "Pengumuman"]);
    expect(within(nav).queryByText("Konten Situs")).toBeNull();
  });

  test("an editor with no areas has the dashboard alone", async () => {
    const { nav } = await openAs("editor", []);
    expect(names(nav)).toEqual(["Dashboard"]);
  });

  test("the current page is marked with aria-current, and only it", async () => {
    const { nav } = await openAs("super_admin", [], "/applications");
    const current = within(nav).getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual(["Pendaftar"]);
  });

  test("a page below an entry keeps that entry marked", async () => {
    const { nav } = await openAs("super_admin", [], "/blog/new");
    expect(within(nav).getByRole("link", { name: "Blog" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Dashboard" }).getAttribute("aria-current")).toBeNull();
  });

  test("the dashboard is only current at the root", async () => {
    const { nav } = await openAs("super_admin", [], "/");
    expect(within(nav).getByRole("link", { name: "Dashboard" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Blog" }).getAttribute("aria-current")).toBeNull();
  });

  test("shows who is signed in", async () => {
    await openAs("editor", ["konten"]);
    expect(screen.getAllByText("tester@contoh.test").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Editor").length).toBeGreaterThan(0);
  });

  test("following a link changes the page and moves focus to the content", async () => {
    const user = userEvent.setup();
    const { nav } = await openAs("super_admin");
    await user.click(within(nav).getByRole("link", { name: "Pesan" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Pesan" })).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/messages");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("main")));
    await waitFor(() => expect(document.title).toBe("Pesan | Admin Sakola Kembara"));
  });

  test("the skip link moves focus to the content", async () => {
    const user = userEvent.setup();
    await openAs("viewer");
    await user.tab();
    const skip = screen.getByRole("button", { name: "Lewati ke konten utama" });
    expect(document.activeElement).toBe(skip);
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });
});

describe("Keluar", () => {
  test("ends the session and goes to /login, without a from", async () => {
    const user = userEvent.setup();
    const { api } = await openAs("super_admin", [], "/applications");
    api.calls.length = 0;
    const out = stubApi({
      "GET /api/me": respond(meBody("super_admin")),
      "POST /api/auth/sign-out": respond({ success: true }),
    });
    await user.click(screen.getAllByRole("button", { name: "Keluar" })[0]!);
    await screen.findByRole("heading", { name: "Masuk ke Admin Sakola Kembara" });
    expect(out.count("POST /api/auth/sign-out")).toBe(1);
    expect(out.last("POST /api/auth/sign-out")?.body).toEqual({});
    expect(screen.getByTestId("location").textContent).toBe("/login");
  });

  test("a double click signs out once", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const api = stubApi({
      "GET /api/me": respond(meBody("viewer")),
      "GET /api/dashboard": respond({ error: "not_found" }, 404),
      "POST /api/auth/sign-out": () => gate.promise,
    });
    renderApp("/");
    const button = (await screen.findAllByRole("button", { name: "Keluar" }))[0]!;
    await user.dblClick(button);
    gate.resolve(respond({ success: true }));
    await screen.findByRole("heading", { name: "Masuk ke Admin Sakola Kembara" });
    expect(api.count("POST /api/auth/sign-out")).toBe(1);
  });

  test("a failure is reported and the user stays signed in", async () => {
    const user = userEvent.setup();
    stubApi({
      "GET /api/me": respond(meBody("viewer")),
      "GET /api/dashboard": respond({ error: "not_found" }, 404),
      "POST /api/auth/sign-out": respond({ error: "internal" }, 500),
    });
    renderApp("/");
    await user.click((await screen.findAllByRole("button", { name: "Keluar" }))[0]!);
    expect((await screen.findByRole("alert")).textContent).toBe("Gagal keluar. Silakan coba lagi.");
    await waitFor(() => expect((screen.getAllByRole("button", { name: "Keluar" })[0] as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId("location").textContent).toBe("/");
  });
});
