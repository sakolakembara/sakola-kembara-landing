import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";
import { meBody, renderApp, respond } from "./helpers";
import { currentBody, LOCAL_KEY, resetWizardMocks, ROUTES, seedLocal, wizardServer } from "./wizard-helpers";

// What a student sees at /daftar when there is no form to fill in, and while the page finds out. The words are the legacy
// screen's (app/(portal)/portal/daftar/page.tsx).

afterEach(resetWizardMocks);

const heading = (name: string) => screen.findByRole("heading", { name });

describe("no batch is open", () => {
  test("the legacy screen: the sentence, the way to the program page, the way back; nothing of the form is drawn", async () => {
    const api = wizardServer("no-batch", {}, { config: { siteUrl: "https://situs.contoh.test" } });
    renderApp("/portal/daftar");
    expect(await heading("Belum ada batch pendaftaran yang dibuka")).toBeTruthy();
    const main = within(screen.getByRole("main"));
    expect(main.getByText("Pendaftaran")).toBeTruthy();
    expect(main.getByText(/Pendaftaran Sakola Kembara dibuka sekali dalam setahun\. Silakan kembali lagi setelah panitia mengumumkan batch berikutnya di halaman/)).toBeTruthy();
    // The public site is another Worker: a plain address, not the router's.
    await waitFor(() => expect(main.getByRole("link", { name: "Gabung Siswa" }).getAttribute("href")).toBe("https://situs.contoh.test/gabung-siswa"));
    expect(main.getByRole("link", { name: "Kembali ke portal" }).getAttribute("href")).toBe("/portal");
    expect(screen.queryByRole("navigation", { name: "Bagian formulir" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Selanjutnya" })).toBeNull();
    expect(api.writes()).toEqual([]);
  });

  test("there is nothing to resume, so every copy this student left in the browser is removed", async () => {
    seedLocal("household");
    window.localStorage.setItem("sakem-portal:v1:user-1:batch-lama", JSON.stringify({ version: 1, savedAt: Date.now(), stepIndex: 0, visited: ["intro"], values: {} }));
    window.localStorage.setItem("sakem-portal:v1:user-2:batch-lain", JSON.stringify({ version: 1, savedAt: Date.now(), stepIndex: 0, visited: ["intro"], values: {} }));
    wizardServer("no-batch");
    renderApp("/portal/daftar");
    await heading("Belum ada batch pendaftaran yang dibuka");
    await waitFor(() => expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull());
    expect(window.localStorage.getItem("sakem-portal:v1:user-1:batch-lama")).toBeNull();
    // Another student's is not this one's to remove.
    expect(window.localStorage.getItem("sakem-portal:v1:user-2:batch-lain")).not.toBeNull();
  });

  test.each(["published-accepted", "published-rejected", "published-undecided"] as const)("a batch that closed and was published (%s) is no open batch either", async (persona) => {
    wizardServer(persona);
    renderApp("/portal/daftar");
    expect(await heading("Belum ada batch pendaftaran yang dibuka")).toBeTruthy();
  });
});

describe("the application is already sent", () => {
  test("the legacy screen: the batch, the time it was sent and the way to the status page; no form", async () => {
    wizardServer("submitted");
    renderApp("/portal/daftar");
    expect(await heading("Pendaftaran kamu untuk Gen 6 - 2026/2027 sudah kami terima")).toBeTruthy();
    const main = within(screen.getByRole("main"));
    expect(main.getByText("Batch 2026")).toBeTruthy();
    expect(main.getByText(/Dikirim pada/).textContent).toMatch(/Dikirim pada .*20\d\d.*\. Untuk mengecek status, buka halaman Status Pendaftaran\./);
    expect(main.getByRole("link", { name: "Status Pendaftaran" }).getAttribute("href")).toBe("/portal/status");
    expect(screen.queryByRole("button", { name: "Selanjutnya" })).toBeNull();
  });

  test("the copy this student left for the batch is removed", async () => {
    seedLocal("household");
    wizardServer("submitted");
    renderApp("/portal/daftar");
    await heading("Pendaftaran kamu untuk Gen 6 - 2026/2027 sudah kami terima");
    await waitFor(() => expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull());
  });

  test("a student who has sent it cannot save anything from here: the wizard is never drawn, so no save is made", async () => {
    const api = wizardServer("submitted");
    renderApp("/portal/daftar");
    await heading("Pendaftaran kamu untuk Gen 6 - 2026/2027 sudah kami terima");
    expect(api.writes()).toEqual([]);
    expect(api.count(ROUTES.current.replace("GET ", "GET "))).toBe(1);
  });
});

describe("while the page finds out, and when it cannot", () => {
  test("a status line says it is loading, and no form is drawn yet", async () => {
    wizardServer("open", { [ROUTES.current]: () => new Promise<Response>(() => undefined) });
    renderApp("/portal/daftar");
    expect(await screen.findByText("Memuat formulir pendaftaran…")).toBeTruthy();
    expect(screen.getByText("Memuat formulir pendaftaran…").getAttribute("role")).toBe("status");
    expect(screen.queryByRole("button", { name: "Selanjutnya" })).toBeNull();
  });

  test("a fault of the Worker is a screen that offers to try again, and says nothing is lost; trying again works", async () => {
    const u = userEvent.setup();
    let attempts = 0;
    const api = wizardServer("open", { [ROUTES.current]: () => (++attempts === 1 ? respond({ error: "internal" }, 500) : null) });
    renderApp("/portal/daftar");
    expect(await screen.findByText(/Tidak dapat memuat halaman ini\. Periksa koneksi internet lalu coba lagi\. Pendaftaran kamu tidak terhapus\./)).toBeTruthy();
    await u.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await heading("Sebelum Mulai Pendaftaran")).toBeTruthy();
    expect(api.count(ROUTES.current)).toBe(2);
  });

  test("an answer that is not the contract's is an error screen, never a form of blanks", async () => {
    wizardServer("open", { [ROUTES.current]: respond({ gate: "open" }) });
    renderApp("/portal/daftar");
    expect(await screen.findByText(/Tidak dapat memuat halaman ini/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Selanjutnya" })).toBeNull();
  });

  test("offline: the same screen", async () => {
    wizardServer("open", {
      [ROUTES.current]: () => {
        throw new TypeError("offline");
      },
    });
    renderApp("/portal/daftar");
    expect(await screen.findByRole("button", { name: "Coba lagi" })).toBeTruthy();
  });

  test("the browser tab says what the page is", async () => {
    wizardServer();
    renderApp("/portal/daftar");
    await heading("Sebelum Mulai Pendaftaran");
    expect(document.title).toBe("Daftar Sekarang | Portal Siswa");
  });
});

describe("who may open it", () => {
  test("not signed in: to the sign-in page with the way back to /daftar, and the form is never asked for", async () => {
    const api = wizardServer("open", { [ROUTES.me]: respond({ error: "unauthenticated" }, 401) });
    renderApp("/portal/daftar");
    expect(await screen.findByRole("heading", { name: "Selamat datang kembali" })).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/login?from=%2Fdaftar");
    expect(api.count(ROUTES.current)).toBe(0);
  });

  test("an admin account gets the 'not a student' screen and not one request for an application", async () => {
    const api = wizardServer("open", { [ROUTES.me]: respond(meBody("editor")) });
    renderApp("/portal/daftar");
    expect(await screen.findByRole("heading", { name: "Akun ini bukan akun calon siswa" })).toBeTruthy();
    expect(api.count(ROUTES.current)).toBe(0);
  });

  test("the open batch is named in the heading of the form, with the student's first name", async () => {
    wizardServer();
    renderApp("/portal/daftar");
    await heading("Sebelum Mulai Pendaftaran");
    expect(screen.getByText("Formulir Pendaftaran · Gen 6 - 2026/2027")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Ceritakan tentang dirimu, Sari" })).toBeTruthy();
  });

  test("an account with no name is greeted as 'Sakemers' (the legacy word)", async () => {
    wizardServer("open", { [ROUTES.current]: respond(currentBody({ user: { name: "", email: "x@contoh.test" } })) });
    renderApp("/portal/daftar");
    expect(await screen.findByRole("heading", { level: 1, name: "Ceritakan tentang dirimu, Sakemers" })).toBeTruthy();
  });
});
