import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { ENDPOINTS } from "~/lib/paths";
import { fakeTurnstile } from "@shared/spa/test/fake-turnstile";
import { meBody, NOW, openBatch, overviewBody, renderApp, respond, stubApi } from "./helpers";

const me = respond(meBody());

async function openHome(overview: Record<string, unknown>, routes: Parameters<typeof stubApi>[0] = {}) {
  const api = stubApi({ [`GET ${ENDPOINTS.me}`]: me, [`GET ${ENDPOINTS.overview}`]: respond(overview), ...routes });
  renderApp("/portal/");
  await screen.findByRole("heading", { level: 1 });
  return api;
}

describe("home: the band", () => {
  test("greets the student by first name, with the legacy sentences, under one h1", async () => {
    await openHome(overviewBody());
    expect(await screen.findByRole("heading", { level: 1, name: "Selamat datang, Sari" })).toBeTruthy();
    expect(screen.getByText("Portal Siswa")).toBeTruthy();
    expect(screen.getByText(/Dari sini kamu bisa mendaftar sebagai calon siswa Sakola Kembara/)).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  test("a student whose name is empty is a Sakemers", async () => {
    await openHome(overviewBody({ student: { name: "", firstName: "" } }));
    expect(await screen.findByRole("heading", { level: 1, name: "Selamat datang, Sakemers" })).toBeTruthy();
  });
});

describe("home: the batch gate", () => {
  test("a batch is open and nothing is started: the star card with the dates, the days left from the SERVER's clock, and 'Mulai daftar'", async () => {
    const api = await openHome(overviewBody({ openBatch: openBatch({ description: "Baca dulu syaratnya.\nSiapkan berkas." }) }));
    const card = await screen.findByRole("region", { name: "Gen 6 - 2026/2027" });
    expect(within(card).getByText("Batch 2026 · Pendaftaran Dibuka")).toBeTruthy();
    expect(within(card).getByText("Tutup pendaftaran")).toBeTruthy();
    // closesAt is exactly 10 days after the API's `now`, whatever the phone's clock says.
    expect(within(card).getByText("10 hari lagi")).toBeTruthy();
    expect(within(card).getByText("Terbatas")).toBeTruthy();
    expect(within(card).getByText(/Baca dulu syaratnya\./)).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Mulai daftar" }).getAttribute("href")).toBe("/portal/daftar");
    expect(screen.queryByText("Belum ada batch yang dibuka")).toBeNull();
    // Two calls for the page, and the config only where the page needs a link of the public site.
    expect(api.calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET ${ENDPOINTS.me}`, `GET ${ENDPOINTS.overview}`]);
  });

  test("the last day says so instead of '0 hari lagi'", async () => {
    await openHome(overviewBody({ openBatch: openBatch({ closesAt: NOW }) }));
    expect(await screen.findByText("Ditutup hari ini")).toBeTruthy();
  });

  test("a draft saved on the server: the same card, 'Lanjutkan pendaftaran', to the same place", async () => {
    await openHome(overviewBody({ current: { state: "draft", updatedAt: "2026-10-12T00:00:00.000Z" } }));
    const link = await screen.findByRole("link", { name: "Lanjutkan pendaftaran" });
    expect(link.getAttribute("href")).toBe("/portal/daftar");
    expect(screen.queryByRole("link", { name: "Mulai daftar" })).toBeNull();
  });

  test("already sent: the thanks, the way to the status page, and no way to start again", async () => {
    await openHome(overviewBody({ current: { state: "submitted", submittedAt: "2026-10-12T00:00:00.000Z" } }));
    expect(await screen.findByRole("heading", { name: "Pendaftaran kamu untuk Gen 6 - 2026/2027 sudah kami terima" })).toBeTruthy();
    expect(screen.getByText(/Kamu tidak perlu mengirim ulang berkas/)).toBeTruthy();
    const statusLinks = screen.getAllByRole("link", { name: "Status Pendaftaran" });
    expect(statusLinks.map((link) => link.getAttribute("href"))).toEqual(["/portal/status", "/portal/status"]); // the nav's and the card's
    expect(screen.queryByRole("link", { name: /Mulai daftar|Lanjutkan pendaftaran/ })).toBeNull();
  });

  test("no batch is open: the legacy sentence, the way to Gabung Siswa on the public site, and no way to start", async () => {
    const api = await openHome(overviewBody({ openBatch: null }), {
      [`GET ${ENDPOINTS.config}`]: respond({ google: false, turnstileSiteKey: null, siteUrl: "https://www.example.org" }),
    });
    expect(await screen.findByRole("heading", { name: "Belum ada batch yang dibuka" })).toBeTruthy();
    expect(screen.getByText(/Pendaftaran Sakola Kembara dibuka sekali dalam setahun/)).toBeTruthy();
    // The public site is another Worker: its link is a plain one, with the site's own origin.
    await screen.findByRole("link", { name: "Gabung Siswa" });
    expect((await screen.findByRole("link", { name: "Gabung Siswa" })).getAttribute("href")).toBe("https://www.example.org/gabung-siswa");
    expect(screen.queryByRole("link", { name: /Mulai daftar|Lanjutkan pendaftaran/ })).toBeNull();
    expect(api.count(`GET ${ENDPOINTS.config}`)).toBe(1);
  });

  test("with no site address in the config the link is a path of this origin (the apex serves both)", async () => {
    await openHome(overviewBody({ openBatch: null }), { [`GET ${ENDPOINTS.config}`]: respond({ google: false, turnstileSiteKey: null, siteUrl: "" }) });
    expect((await screen.findByRole("link", { name: "Gabung Siswa" })).getAttribute("href")).toBe("/gabung-siswa");
  });
});

describe("home: the history is verdict-free", () => {
  test("nothing sent yet", async () => {
    await openHome(overviewBody());
    expect(await screen.findByRole("heading", { name: "Riwayat pendaftaran" })).toBeTruthy();
    expect(screen.getByText(/Kamu belum pernah mengirim pendaftaran/)).toBeTruthy();
  });

  test("sent, results not out: the batch, when it was sent, and a quiet link", async () => {
    await openHome(
      overviewBody({
        current: { state: "submitted", submittedAt: "2026-10-12T00:00:00.000Z" },
        history: [{ id: "a1", batch: { year: 2026, name: "Gen 6 - 2026/2027" }, submittedAt: "2026-10-12T00:00:00.000Z", published: false }],
      }),
    );
    const card = await screen.findByRole("region", { name: "Hasil belum diumumkan" });
    expect(within(card).getByText("2026 · Gen 6 - 2026/2027")).toBeTruthy();
    expect(within(card).getByText(/^Dikirim /)).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Buka Status Pendaftaran" }).getAttribute("href")).toBe("/portal/status");
  });

  test("results out: 'go and look', and not one word of the outcome (that is the status page's)", async () => {
    await openHome(
      overviewBody({
        openBatch: null,
        history: [{ id: "a1", batch: { year: 2026, name: "Gen 6 - 2026/2027" }, submittedAt: "2026-10-12T00:00:00.000Z", published: true, status: "accepted" }],
      }),
    );
    const card = await screen.findByRole("region", { name: "Hasil pendaftaran kamu sudah keluar" });
    expect(within(card).getByRole("link", { name: "Lihat hasil" }).getAttribute("href")).toBe("/portal/status");
    expect(document.body.textContent).not.toMatch(/diterima|lolos|ditolak/i);
  });
});

describe("home: when something is off", () => {
  test("the page could not be read: it says so, nothing is lost, and 'Coba lagi' tries again", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    stubApi({
      [`GET ${ENDPOINTS.me}`]: me,
      [`GET ${ENDPOINTS.overview}`]: () => (++attempt === 1 ? respond({ error: "internal" }, 500) : respond(overviewBody())),
    });
    renderApp("/portal/");
    expect(await screen.findByText(/Pendaftaran kamu tidak terhapus/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByRole("region", { name: "Gen 6 - 2026/2027" })).toBeTruthy();
  });

  test("an answer that is not an overview is an error, not a page of blanks", async () => {
    stubApi({ [`GET ${ENDPOINTS.me}`]: me, [`GET ${ENDPOINTS.overview}`]: respond({ hello: "world" }) });
    renderApp("/portal/");
    expect(await screen.findByRole("button", { name: "Coba lagi" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: /Gen 6/ })).toBeNull();
  });

  test("while it loads there is a polite status line", async () => {
    stubApi({ [`GET ${ENDPOINTS.me}`]: me, [`GET ${ENDPOINTS.overview}`]: () => new Promise<Response>(() => undefined) });
    renderApp("/portal/");
    expect(await screen.findByText("Memuat beranda…")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Selamat datang" })).toBeTruthy();
  });
});

describe("home: an account whose email is not verified (defence in depth: the Worker does not let one sign in)", () => {
  test("the banner offers 'Kirim ulang tautan', behind the security check, to the account's own address", async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    turnstile.preload();
    const api = stubApi({
      [`GET ${ENDPOINTS.me}`]: respond(meBody("student", { emailVerified: false })),
      [`GET ${ENDPOINTS.overview}`]: respond(overviewBody()),
      [`GET ${ENDPOINTS.config}`]: respond({ google: false, turnstileSiteKey: "site-key", siteUrl: "" }),
      [`POST ${ENDPOINTS.sendVerification}`]: respond({ status: true }),
    });
    renderApp("/portal/");
    expect(await screen.findByText("Verifikasi email kamu untuk mengaktifkan seluruh fitur")).toBeTruthy();
    expect(screen.getByText("sari@contoh.test")).toBeTruthy();

    await screen.findByRole("button", { name: "Memeriksa…" });
    turnstile.solve("token-1");
    await user.click(await screen.findByRole("button", { name: "Kirim ulang tautan" }));
    expect(await screen.findByText("Tautan baru sudah dikirim. Cek folder spam jika belum muncul.")).toBeTruthy();
    const call = api.last(`POST ${ENDPOINTS.sendVerification}`)!;
    expect(call.body).toEqual({ email: "sari@contoh.test", callbackURL: "/portal/login?verified=1" });
    expect(call.headers["x-turnstile-token"]).toBe("token-1");
    expect(turnstile.current().options.action).toBe("resend-verification");
  });

  test("a verified account has no banner", async () => {
    await openHome(overviewBody());
    expect(screen.queryByText("Verifikasi email kamu untuk mengaktifkan seluruh fitur")).toBeNull();
  });
});
