import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, test } from "vitest";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { RequireAuth } from "~/components/RequireAuth";
import { Shell } from "~/components/Shell";
import { takeConsoleProblems } from "./setup";
import { meBody, renderApp, respond, stubApi } from "./helpers";

const location = () => screen.getByTestId("location").textContent;
const dashboard404 = { "GET /api/dashboard": respond({ error: "not_found" }, 404) };

describe("route guard: not signed in", () => {
  test("a deep link goes to /login with the page in `from`", async () => {
    stubApi({ "GET /api/me": respond({ error: "unauthenticated" }, 401) });
    renderApp("/applications?status=pending");
    await screen.findByRole("heading", { name: "Masuk ke Admin Sakola Kembara" });
    expect(location()).toBe("/login?from=%2Fapplications%3Fstatus%3Dpending");
  });

  test("the dashboard goes to a bare /login", async () => {
    stubApi({ "GET /api/me": respond({ error: "unauthenticated" }, 401) });
    renderApp("/");
    await screen.findByRole("heading", { name: "Masuk ke Admin Sakola Kembara" });
    expect(location()).toBe("/login");
  });

  test("every menu path is guarded, and a made-up one too", async () => {
    for (const path of ["/batches", "/blog/new", "/audit", "/settings", "/nowhere"]) {
      stubApi({ "GET /api/me": respond({ error: "unauthenticated" }, 401) });
      const view = renderApp(path);
      await screen.findByRole("heading", { name: "Masuk ke Admin Sakola Kembara" });
      expect(location()).toBe(`/login?from=${encodeURIComponent(path)}`);
      view.unmount();
    }
  });

  test("the sign-in pages themselves ask nothing of the server about the session", async () => {
    const api = stubApi({ "GET /api/config": respond({ google: false }) });
    renderApp("/login");
    await screen.findByRole("heading", { name: "Masuk ke Admin Sakola Kembara" });
    expect(api.count("GET /api/me")).toBe(0);
  });
});

describe("route guard: loading and failure", () => {
  test("shows a status while the session loads", async () => {
    stubApi({ "GET /api/me": () => new Promise<Response>(() => {}) });
    renderApp("/");
    expect(screen.getByRole("status").textContent).toBe("Memuat…");
  });

  test("a failure to reach the server is not a sign-out, and Coba lagi tries again", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    stubApi({
      "GET /api/me": () => (++attempt === 1 ? respond({ error: "internal" }, 500) : respond(meBody("viewer"))),
      ...dashboard404,
    });
    renderApp("/");
    expect((await screen.findByRole("alert")).textContent).toContain("Tidak dapat terhubung ke server");
    expect(location()).toBe("/");
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    await screen.findByRole("navigation", { name: "Menu utama" });
    expect(attempt).toBe(2);
  });

  test("an unreadable /api/me is also an error, not an empty menu", async () => {
    stubApi({ "GET /api/me": respond({ nonsense: true }) });
    renderApp("/");
    expect((await screen.findByRole("alert")).textContent).toContain("Tidak dapat terhubung ke server");
  });
});

describe("route guard: accounts that are not admins", () => {
  test("a student gets a refusal with no menu, and can sign out", async () => {
    const user = userEvent.setup();
    const api = stubApi({
      "GET /api/me": respond(meBody("student")),
      "POST /api/auth/sign-out": respond({ success: true }),
    });
    renderApp("/applications");
    await screen.findByRole("heading", { name: "Akses ditolak" });
    expect(screen.getByRole("status").textContent).toBe("Halaman itu hanya untuk pengurus yayasan.");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByText("tester@contoh.test")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keluar" }));
    await screen.findByRole("heading", { name: "Masuk ke Admin Sakola Kembara" });
    expect(api.count("POST /api/auth/sign-out")).toBe(1);
  });
});

describe("403 inside the shell", () => {
  test("a viewer opening Aktivitas gets the 403 page, with the menu still there", async () => {
    stubApi({ "GET /api/me": respond(meBody("viewer")) });
    renderApp("/audit");
    expect(await screen.findByRole("heading", { level: 1, name: "Akses ditolak" })).toBeTruthy();
    expect(screen.getByText("Akun ini tidak memiliki akses ke halaman tersebut.")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Menu utama" })).toBeTruthy();
    expect(screen.queryByText("Belum tersedia di admin baru")).toBeNull();
  });

  test("an editor opening an area that was not granted to them: the 403 page, for the list and every page below it", async () => {
    // [path, areas granted] of an editor who must be refused there.
    const refused: [string, ("pendaftaran" | "komunikasi" | "konten")[]][] = [
      ["/messages", ["konten"]],
      ["/announcements", ["pendaftaran", "konten"]],
      ["/applications/abc", ["komunikasi"]],
      ["/batches/new", ["komunikasi", "konten"]],
      ["/resources", []],
      ["/blog", ["pendaftaran"]],
      ["/blog/abc/edit", ["komunikasi"]],
      ["/shortlinks", []],
    ];
    for (const [path, granted] of refused) {
      const api = stubApi({ "GET /api/me": respond(meBody("editor", granted)), ...dashboard404 });
      const view = renderApp(path);
      expect(await screen.findByRole("heading", { level: 1, name: "Akses ditolak" }), path).toBeTruthy();
      expect(screen.queryByText("Belum tersedia di admin baru"), path).toBeNull();
      expect(api.calls.map((call) => call.path), path).toEqual(["/api/me"]);
      view.unmount();
    }
  });

  test("the same editor opens the areas that were granted, and the dashboard", async () => {
    stubApi({ "GET /api/me": respond(meBody("editor", ["konten"])), ...dashboard404 });
    const blog = renderApp("/blog");
    expect(await screen.findByRole("heading", { level: 1, name: "Blog" })).toBeTruthy();
    blog.unmount();
    stubApi({ "GET /api/me": respond(meBody("editor", [])), ...dashboard404 });
    renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: /^Halo, / })).toBeTruthy();
  });

  test("an editor opening Pengaturan, and a page below it", async () => {
    for (const path of ["/settings", "/settings/new", "/settings/abc/edit"]) {
      stubApi({ "GET /api/me": respond(meBody("editor", ["pendaftaran", "komunikasi", "konten"])) });
      const view = renderApp(path);
      expect(await screen.findByRole("heading", { level: 1, name: "Akses ditolak" })).toBeTruthy();
      view.unmount();
    }
  });

  test("super_admin opens Pengaturan: the page itself, no longer the placeholder (test/settings.test.tsx has the rest)", async () => {
    stubApi({ "GET /api/me": respond(meBody("super_admin")), "GET /api/admin/users": respond({ items: [], users: [], page: 1, pageSize: 50, total: 0 }) });
    renderApp("/settings");
    expect(await screen.findByRole("heading", { level: 1, name: "Pengaturan" })).toBeTruthy();
    expect(await screen.findByText("Belum ada admin terdaftar.")).toBeTruthy();
    expect(screen.queryByText("Belum tersedia di admin baru")).toBeNull();
  });
});

describe("placeholder pages", () => {
  test("every menu entry has a page with its title and an honest message", async () => {
    const titles: [string, string][] = [
      ["/blog", "Blog"],
      // Laporan, Tim and Shortlink are pages now (test/reports.test.tsx, team.test.tsx, shortlinks.test.tsx).
      // Aktivitas and Pengaturan are pages now (test/audit-page.test.tsx, test/settings.test.tsx).
    ];
    for (const [path, title] of titles) {
      stubApi({ "GET /api/me": respond(meBody("super_admin")) });
      const view = renderApp(path);
      expect(await screen.findByRole("heading", { level: 1, name: title }), path).toBeTruthy();
      expect(screen.getByText("Belum tersedia di admin baru"), path).toBeTruthy();
      // The tab title is set in an effect that can land just after the heading is drawn.
      await waitFor(() => expect(document.title, path).toBe(`${title} | Admin Sakola Kembara`));
      view.unmount();
    }
  });

  test("shows what the user will be able to do there", async () => {
    const check = async (me: Parameters<typeof meBody>, path: string, shown: string, hidden: string) => {
      stubApi({ "GET /api/me": respond(meBody(...me)) });
      const view = renderApp(path);
      const main = await screen.findByRole("main");
      await within(main).findByText("Belum tersedia di admin baru");
      expect(within(main).getByText(shown)).toBeTruthy();
      expect(within(main).queryByText(hidden)).toBeNull();
      view.unmount();
    };
    await check(["editor", ["konten"]], "/blog", "Bisa mengubah", "Hanya baca");
    await check(["viewer"], "/blog", "Hanya baca", "Bisa mengubah");
    await check(["super_admin"], "/blog", "Bisa mengubah", "Hanya baca");
  });

  test("a deep link below an entry works on reload and offers the way back", async () => {
    stubApi({ "GET /api/me": respond(meBody("super_admin")) });
    renderApp("/blog/abc/edit");
    expect(await screen.findByRole("heading", { level: 1, name: "Blog" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kembali ke daftar" }).getAttribute("href")).toBe("/blog");
    expect(screen.getByText("Belum tersedia di admin baru")).toBeTruthy();
  });

  test("a list page has no way-back link", async () => {
    stubApi({ "GET /api/me": respond(meBody("super_admin")) });
    renderApp("/blog/");
    await screen.findByRole("heading", { level: 1, name: "Blog" });
    expect(screen.queryByRole("link", { name: "Kembali ke daftar" })).toBeNull();
  });
});

describe("404", () => {
  test("an unknown path inside the shell", async () => {
    stubApi({ "GET /api/me": respond(meBody("viewer")) });
    renderApp("/tidak-ada");
    expect(await screen.findByRole("heading", { level: 1, name: "Halaman tidak ditemukan" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Menu utama" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kembali ke Dashboard" }).getAttribute("href")).toBe("/");
  });

  test("a path that only starts like a menu entry", async () => {
    stubApi({ "GET /api/me": respond(meBody("super_admin")) });
    renderApp("/blogger");
    expect(await screen.findByRole("heading", { level: 1, name: "Halaman tidak ditemukan" })).toBeTruthy();
  });
});

describe("error boundary", () => {
  function Bomb({ explode }: { explode: boolean }) {
    if (explode) throw new Error("kaboom");
    return <p>aman</p>;
  }

  test("shows an Indonesian message instead of a blank screen", () => {
    render(
      <MemoryRouter>
        <ErrorBoundary variant="page">
          <Bomb explode />
        </ErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Gagal memuat halaman admin" })).toBeTruthy();
    expect(screen.getByText(/Terjadi kesalahan di browser/)).toBeTruthy();
    // React reports the crash itself; that is expected here and nowhere else.
    expect(takeConsoleProblems().length).toBeGreaterThan(0);
  });

  test("Coba lagi tries the page again", async () => {
    const user = userEvent.setup();
    let explode = true;
    const tree = () => (
      <MemoryRouter>
        <ErrorBoundary>
          <Bomb explode={explode} />
        </ErrorBoundary>
      </MemoryRouter>
    );
    const view = render(tree());
    expect(screen.getByRole("heading", { name: "Gagal memuat halaman admin" })).toBeTruthy();
    takeConsoleProblems();
    explode = false;
    view.rerender(tree());
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(screen.getByText("aman")).toBeTruthy();
  });

  test("moving to another page clears it", () => {
    const tree = (key: string, explode: boolean) => (
      <MemoryRouter>
        <ErrorBoundary resetKey={key}>
          <Bomb explode={explode} />
        </ErrorBoundary>
      </MemoryRouter>
    );
    const view = render(tree("/a", true));
    takeConsoleProblems();
    view.rerender(tree("/b", false));
    expect(screen.getByText("aman")).toBeTruthy();
  });
});

describe("a page that crashes inside the shell", () => {
  function Bomb(): never {
    throw new Error("kaboom");
  }

  test("leaves the menu usable, and leaving the page clears the message", async () => {
    const user = userEvent.setup();
    stubApi({ "GET /api/me": respond(meBody("super_admin")) });
    render(
      <MemoryRouter initialEntries={["/boom"]}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route element={<Shell />}>
              <Route index element={<p>halaman aman</p>} />
              <Route path="boom" element={<Bomb />} />
              <Route path="*" element={<p>halaman lain</p>} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    const main = await screen.findByRole("main");
    expect(await within(main).findByRole("heading", { name: "Gagal memuat halaman admin" })).toBeTruthy();
    takeConsoleProblems(); // React logs the crash
    const nav = screen.getByRole("navigation", { name: "Menu utama" });

    await user.click(within(nav).getByRole("link", { name: "Dashboard" }));
    expect(await within(main).findByText("halaman aman")).toBeTruthy();
    expect(within(main).queryByRole("heading", { name: "Gagal memuat halaman admin" })).toBeNull();
  });
});
