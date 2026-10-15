import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, test } from "vitest";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { localDraftKey } from "~/lib/local-drafts";
import { ENDPOINTS } from "~/lib/paths";
import { CURRENT_PATH } from "~/lib/wizard/api";
import { meBody, overviewBody, renderApp, respond, SIGNED_IN, stubApi } from "./helpers";
import { takeConsoleProblems } from "./setup";
import { currentBody } from "./wizard-helpers";

const location = () => screen.getByTestId("location").textContent;
const status = { [`GET ${ENDPOINTS.applications}`]: respond({ items: [] }) };

describe("the guard", () => {
  test("not signed in: to /login with the page that was asked for", async () => {
    stubApi({ [`GET ${ENDPOINTS.me}`]: respond({ error: "unauthenticated" }, 401) });
    renderApp("/portal/status");
    expect(await screen.findByRole("heading", { name: "Selamat datang kembali" })).toBeTruthy();
    expect(location()).toBe("/login?from=%2Fstatus");
  });

  test("not signed in, from the front page: a plain /login", async () => {
    stubApi({ [`GET ${ENDPOINTS.me}`]: respond({ error: "unauthenticated" }, 401) });
    renderApp("/portal/");
    await screen.findByRole("heading", { name: "Selamat datang kembali" });
    expect(location()).toBe("/login");
  });

  test("while the session loads there is a status line and nothing of the portal", async () => {
    stubApi({ [`GET ${ENDPOINTS.me}`]: () => new Promise<Response>(() => undefined) });
    renderApp("/portal/");
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Memuat…");
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  test("when the session cannot be read (offline, 5xx) it says so and offers to try again, instead of showing the sign-in page", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const api = stubApi({
      [`GET ${ENDPOINTS.overview}`]: respond(overviewBody()),
      [`GET ${ENDPOINTS.me}`]: () => (++attempt === 1 ? respond({ error: "internal" }, 500) : respond(meBody())),
    });
    renderApp("/portal/");
    expect(await screen.findByRole("heading", { name: "Tidak dapat memuat akun" })).toBeTruthy();
    expect(location()).toBe("/");
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByRole("heading", { name: "Selamat datang, Sari" })).toBeTruthy();
    expect(api.count(`GET ${ENDPOINTS.me}`)).toBe(2);
  });

  test("an account that is not a student gets the 'not a student' screen, no page of the portal and not one data request", async () => {
    const api = stubApi({
      [`GET ${ENDPOINTS.me}`]: respond(meBody("editor", { email: "rina@contoh.test" })),
      [`GET ${ENDPOINTS.config}`]: respond({ google: false, turnstileSiteKey: null, siteUrl: "", adminUrl: "https://admin.contoh.test" }),
    });
    renderApp("/portal/");
    expect(await screen.findByRole("heading", { name: "Akun ini bukan akun calon siswa" })).toBeTruthy();
    expect(screen.getByText("Halaman ini hanya untuk calon siswa. Pengurus yayasan masuk lewat halaman admin.")).toBeTruthy();
    expect(screen.getByText("rina@contoh.test")).toBeTruthy();
    expect((await screen.findByRole("link", { name: "Buka halaman admin" })).getAttribute("href")).toBe("https://admin.contoh.test");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("link", { name: "Status Pendaftaran" })).toBeNull();
    expect(api.calls.map((call) => `${call.method} ${call.path}`).sort()).toEqual([`GET ${ENDPOINTS.config}`, `GET ${ENDPOINTS.me}`]);
  });

  test("the same on every page of the portal, and with no link when the deployment does not know the admin's address", async () => {
    stubApi({ [`GET ${ENDPOINTS.me}`]: respond(meBody("super_admin")) });
    renderApp("/portal/status");
    expect(await screen.findByRole("heading", { name: "Akun ini bukan akun calon siswa" })).toBeTruthy();
    // No link, and not a dead one either (an anchor with no address would not be a "link" to the accessibility tree).
    expect(screen.queryByText("Buka halaman admin")).toBeNull();
    expect(location()).toBe("/status");
  });

  test("a role the portal does not know is not a student either", async () => {
    stubApi({ [`GET ${ENDPOINTS.me}`]: respond(meBody("dosen")) });
    renderApp("/portal/");
    expect(await screen.findByRole("heading", { name: "Akun ini bukan akun calon siswa" })).toBeTruthy();
  });

  test("the not-a-student screen can sign out, and goes to /login", async () => {
    const user = userEvent.setup();
    const api = stubApi({ [`GET ${ENDPOINTS.me}`]: respond(meBody("editor")), [`POST ${ENDPOINTS.signOut}`]: respond({ success: true }) });
    renderApp("/portal/");
    await screen.findByRole("heading", { name: "Akun ini bukan akun calon siswa" });
    await user.click(screen.getByRole("button", { name: "Keluar" }));
    expect(await screen.findByRole("heading", { name: "Selamat datang kembali" })).toBeTruthy();
    expect(api.count(`POST ${ENDPOINTS.signOut}`)).toBe(1);
  });
});

describe("the routes", () => {
  test("/portal/ is the front page and /portal/status the status page; the wizard holds /daftar; anything else is the 404", async () => {
    stubApi({ ...SIGNED_IN, ...status, [`GET ${CURRENT_PATH}`]: respond(currentBody()) });
    const first = renderApp("/portal/");
    expect(await screen.findByRole("heading", { name: "Selamat datang, Sari" })).toBeTruthy();
    first.unmount();

    const second = renderApp("/portal/status");
    expect(await screen.findByRole("heading", { name: "Rekap perjalanan pendaftaranmu" })).toBeTruthy();
    second.unmount();

    const third = renderApp("/portal/daftar");
    // The wizard is its own chunk, loaded when the route opens; it opens on its first screen (wizard-flow.test.tsx has the rest).
    expect(await screen.findByRole("heading", { name: "Sebelum Mulai Pendaftaran" })).toBeTruthy();
    third.unmount();

    renderApp("/portal/tidak-ada");
    expect(await screen.findByRole("heading", { name: "Halaman tidak ditemukan" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kembali ke beranda portal" }).getAttribute("href")).toBe("/portal");
  });

  test("every public auth page is open to anyone, and nothing is asked of the session for them", async () => {
    const api = stubApi({});
    for (const [path, heading] of [
      ["/portal/login", "Selamat datang kembali"],
      ["/portal/register", "Daftar akun baru"],
      ["/portal/forgot-password", "Lupa password?"],
      ["/portal/reset-password", "Reset password"],
      ["/portal/verify-email", "Tautan verifikasi tidak lengkap"],
      ["/portal/auth/error", "Gagal masuk"],
    ] as const) {
      const view = renderApp(path);
      expect(await screen.findByRole("heading", { level: 1, name: heading }), path).toBeTruthy();
      view.unmount();
    }
    expect(api.count(`GET ${ENDPOINTS.me}`)).toBe(0);
  });

  test("the tab title says Portal Siswa", async () => {
    stubApi({ ...SIGNED_IN, ...status });
    renderApp("/portal/");
    await screen.findByRole("heading", { name: "Selamat datang, Sari" });
    expect(document.title).toBe("Beranda | Portal Siswa");
    await userEvent.setup().click(screen.getByRole("link", { name: "Status Pendaftaran" }));
    await waitFor(() => expect(document.title).toBe("Status Pendaftaran | Portal Siswa"));
  });
});

describe("what the browser keeps of a half-typed application", () => {
  const key = localDraftKey("user-1", "b1");
  const other = localDraftKey("user-2", "b1");
  const fresh = () => JSON.stringify({ savedAt: Date.now(), steps: {} });

  test("sign-out removes this student's copies and leaves other students' alone", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(key, fresh());
    window.localStorage.setItem(other, fresh());
    stubApi({ ...SIGNED_IN, [`POST ${ENDPOINTS.signOut}`]: respond({ success: true }) });
    renderApp("/portal/");
    await screen.findByRole("heading", { name: "Selamat datang, Sari" });
    expect(window.localStorage.getItem(key)).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Keluar" }));
    await screen.findByRole("heading", { name: "Selamat datang kembali" });
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(window.localStorage.getItem(other)).not.toBeNull();
  });

  test("a failed sign-out keeps them (the session is still there) and the student stays signed in", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(key, fresh());
    stubApi({ ...SIGNED_IN, [`POST ${ENDPOINTS.signOut}`]: respond({ error: "internal" }, 500) });
    renderApp("/portal/");
    await screen.findByRole("heading", { name: "Selamat datang, Sari" });
    await user.click(screen.getByRole("button", { name: "Keluar" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Keluar" }) as HTMLButtonElement).disabled).toBe(false));
    expect(window.localStorage.getItem(key)).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Selamat datang, Sari" })).toBeTruthy();
  });

  test("a 401 on a data call (the session ended in another tab) goes to the sign-in page and removes them too", async () => {
    window.localStorage.setItem(key, fresh());
    stubApi({ [`GET ${ENDPOINTS.me}`]: respond(meBody()), [`GET ${ENDPOINTS.overview}`]: respond({ error: "unauthenticated" }, 401) });
    renderApp("/portal/");
    expect(await screen.findByRole("heading", { name: "Selamat datang kembali" })).toBeTruthy();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  test("a copy older than 30 days is removed when the portal opens", async () => {
    window.localStorage.setItem(key, JSON.stringify({ savedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 }));
    stubApi({ ...SIGNED_IN });
    renderApp("/portal/");
    await screen.findByRole("heading", { name: "Selamat datang, Sari" });
    expect(window.localStorage.getItem(key)).toBeNull();
  });
});

describe("the crash screen", () => {
  // The way home is a router link: it needs a router around it, as it has in the app.
  const inRouter = { wrapper: ({ children }: { children: React.ReactNode }) => <MemoryRouter basename="/portal" initialEntries={["/portal/status"]}>{children}</MemoryRouter> };

  function Boom({ explode }: { explode: boolean }) {
    if (explode) throw new Error("boom");
    return <p>aman</p>;
  }

  test("has the legacy portal's words and clears when the page changes", () => {
    const view = render(
      <ErrorBoundary variant="page" resetKey="/a">
        <Boom explode />
      </ErrorBoundary>,
      inRouter,
    );
    expect(takeConsoleProblems().length).toBeGreaterThan(0); // React reports the crash itself
    expect(screen.getByRole("heading", { name: "Portal siswa bermasalah" })).toBeTruthy();
    expect(screen.getByText(/pendaftaran kamu tidak terhapus/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ke beranda" }).getAttribute("href")).toBe("/portal");

    view.rerender(
      <ErrorBoundary variant="page" resetKey="/b">
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("aman")).toBeTruthy();
  });

  test("'Coba lagi' tries the page again", async () => {
    const user = userEvent.setup();
    let explode = true;
    function Flaky() {
      return <Boom explode={explode} />;
    }
    render(
      <ErrorBoundary variant="page">
        <Flaky />
      </ErrorBoundary>,
      inRouter,
    );
    takeConsoleProblems();
    explode = false;
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(screen.getByText("aman")).toBeTruthy();
  });
});
