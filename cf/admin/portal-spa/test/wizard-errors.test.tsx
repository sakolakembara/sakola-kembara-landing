import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderApp, respond } from "./helpers";
import { currentBody, fillAllTheWay, type Handler, LOCAL_KEY, localCopy, next, openAt, resetWizardMocks, ROUTES, setText, summaryLines, wizardServer } from "./wizard-helpers";

// Everything the Worker can answer that is not a success, on a save and on the send: the fields it names, the three 409
// states of the gate, a lost session, a dropped connection, the limiter, a fault. Each one is said in Indonesian, in place,
// with what the student typed still on the screen and in the browser (except where the application cannot go on).

// A whole run through the wizard is many screens: allow for a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => void wizardServer());
afterEach(resetWizardMocks);

const user = () => userEvent.setup({ applyAccept: false, delay: null });
const heading = (name: string) => screen.findByRole("heading", { name });
const IDENTITY = "PUT /portal/api/applications/current/steps/identity";
const SUBMIT = "POST /portal/api/applications/current/submit";
const VALID_IDENTITY = { fullName: "Sari Dewi", nickname: "Sari", gender: "perempuan", religion: "Islam", schoolName: "SMAN 1 Contoh", branch: "Bandung", homeAddress: "Jl. Contoh", graduationBatch: "2027 (Kelas 12)", whatsapp: "6281200000001" };

/** The identity screen with a complete, valid identity in it, so that "Selanjutnya" goes to the Worker. */
async function identityReady(over: Record<string, Handler>) {
  const api = wizardServer("open", over);
  const view = openAt("identity", { identity: VALID_IDENTITY });
  await heading("Identitas Pribadi");
  return { api, view };
}

describe("a save the Worker refuses", () => {
  test("400 with fields: they are shown where they belong and in the summary; the student stays, typed answers intact, and nothing moves on", async () => {
    const u = user();
    const { api } = await identityReady({ [IDENTITY]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { schoolName: "Maksimal 200 karakter" } }, 400) });
    await next(u);
    await waitFor(() => expect(summaryLines()).toEqual(["Asal Sekolah: Maksimal 200 karakter"]));
    expect(screen.getByRole("heading", { name: "Identitas Pribadi" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Asal Sekolah" }).getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByRole("textbox", { name: "Asal Sekolah" }) as HTMLInputElement).value).toBe("SMAN 1 Contoh");
    expect(api.count(IDENTITY)).toBe(1);
    expect(localCopy()?.values.identity?.schoolName).toBe("SMAN 1 Contoh");
    // The summary has the focus, so a keyboard or screen reader user lands on what to fix.
    expect(document.activeElement).toBe(screen.getAllByRole("alert").find((box) => box.textContent?.includes("Maksimal 200 karakter")));
  });

  test("400 with no field to name says the Worker's sentence", async () => {
    const u = user();
    await identityReady({ [IDENTITY]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: {} }, 400) });
    await next(u);
    expect(await screen.findByText("Periksa kembali isian formulir.")).toBeTruthy();
  });

  test("offline: the connection line, the student stays, and the next try goes through", async () => {
    const u = user();
    let attempts = 0;
    const { api } = await identityReady({
      [IDENTITY]: () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError("offline");
        return respond({ step: "identity", savedAt: "2026-10-13T03:00:00.000Z", draft: { id: "d", updatedAt: "2026-10-13T03:00:00.000Z", saved: ["identity"], missingFiles: [] }, removedSlots: [] });
      },
    });
    await next(u);
    expect(await screen.findByText("Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Identitas Pribadi" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Selanjutnya" })).toHaveProperty("disabled", false);
    await next(u);
    expect(await heading("Keluarga & Ekonomi")).toBeTruthy();
    expect(api.count(IDENTITY)).toBe(2);
  });

  test("too many tries: the Worker's sentence when it sent one, else the SPA's with the wait", async () => {
    const u = user();
    let message: string | undefined = "Terlalu banyak percobaan. Silakan tunggu satu menit lalu coba lagi.";
    await identityReady({ [IDENTITY]: () => respond({ error: "rate_limited", message, retryAfterSeconds: 60 }, 429, { "Retry-After": "60" }) });
    await next(u);
    expect(await screen.findByText("Terlalu banyak percobaan. Silakan tunggu satu menit lalu coba lagi.")).toBeTruthy();
    message = undefined;
    await next(u);
    expect(await screen.findByText("Terlalu banyak percobaan. Coba lagi dalam 1 menit.")).toBeTruthy();
  });

  test("a fault of the Worker, and an answer that is not what the contract says: a plain sentence, the student stays", async () => {
    const u = user();
    let answer: Response = respond({ error: "internal" }, 500);
    await identityReady({ [IDENTITY]: () => answer.clone() });
    await next(u);
    expect(await screen.findByText("Terjadi kesalahan di server. Coba lagi sebentar lagi.")).toBeTruthy();
    answer = respond({ unexpected: true }, 200);
    await next(u);
    expect(await screen.findByText("Jawaban server tidak bisa dibaca. Coba lagi.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Identitas Pribadi" })).toBeTruthy();
  });

  test("an email that is not verified: the Worker's sentence", async () => {
    const u = user();
    wizardServer("unverified");
    openAt("identity", { identity: VALID_IDENTITY });
    await heading("Identitas Pribadi");
    await next(u);
    expect(await screen.findByText("Verifikasi email kamu dulu sebelum melanjutkan. Cek inbox atau folder spam untuk tautan verifikasi.")).toBeTruthy();
  });

  test("the message goes when the student next presses 'Selanjutnya' and it works, and does not stay on the next screen", async () => {
    const u = user();
    let fail = true;
    await identityReady({
      [IDENTITY]: () => (fail ? respond({ error: "internal" }, 500) : respond({ step: "identity", savedAt: "2026-10-13T03:00:00.000Z", draft: { id: "d", updatedAt: "2026-10-13T03:00:00.000Z", saved: ["identity"], missingFiles: [] }, removedSlots: [] })),
    });
    await next(u);
    await screen.findByText("Terjadi kesalahan di server. Coba lagi sebentar lagi.");
    fail = false;
    await next(u);
    await heading("Keluarga & Ekonomi");
    expect(screen.queryByText("Terjadi kesalahan di server. Coba lagi sebentar lagi.")).toBeNull();
  });
});

describe("a session that ended", () => {
  test("401 on a save: back to the sign-in page, and every copy of this student's is gone", async () => {
    const u = user();
    window.localStorage.setItem("sakem-portal:v1:user-1:batch-lama", JSON.stringify({ version: 1, savedAt: Date.now(), stepIndex: 0, visited: ["intro"], values: {} }));
    window.localStorage.setItem("sakem-portal:v1:user-9:batch-x", JSON.stringify({ version: 1, savedAt: Date.now(), stepIndex: 0, visited: ["intro"], values: {} }));
    await identityReady({ [IDENTITY]: respond({ error: "unauthenticated" }, 401) });
    await next(u);
    expect(await screen.findByRole("heading", { name: "Selamat datang kembali" })).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/login?from=%2Fdaftar");
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
    expect(window.localStorage.getItem("sakem-portal:v1:user-1:batch-lama")).toBeNull();
    // Another student's copy is not this one's to remove.
    expect(window.localStorage.getItem("sakem-portal:v1:user-9:batch-x")).not.toBeNull();
  });

  test("401 when the wizard opens: the same, without the form ever drawn", async () => {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), stepIndex: 1, visited: ["intro", "identity"], values: {} }));
    wizardServer("open", { [ROUTES.current]: respond({ error: "unauthenticated" }, 401) });
    renderApp("/portal/daftar");
    expect(await screen.findByRole("heading", { name: "Selamat datang kembali" })).toBeTruthy();
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
  });
});

describe("the application can no longer be saved or sent (409)", () => {
  test("the batch is not open any more: the legacy screen, with the Worker's sentence on top, and the copy in the browser goes", async () => {
    const u = user();
    await identityReady({ [IDENTITY]: respond({ error: "no_open_batch", message: "Belum ada batch pendaftaran yang dibuka. Silakan kembali saat pendaftaran berikutnya diumumkan." }, 409) });
    expect(localCopy()).not.toBeNull();
    await next(u);
    expect(await screen.findByRole("heading", { name: "Belum ada batch pendaftaran yang dibuka" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Belum ada batch pendaftaran yang dibuka. Silakan kembali saat pendaftaran berikutnya diumumkan.");
    expect(screen.getByRole("link", { name: "Gabung Siswa" }).getAttribute("href")).toBe("/gabung-siswa");
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Belum ada batch pendaftaran yang dibuka" }));
  });

  test("the batch closed while the student was filling the form in: the Worker's own sentence says it can no longer be saved", async () => {
    const u = user();
    await identityReady({ [IDENTITY]: respond({ error: "batch_closed", message: "Pendaftaran untuk batch ini sudah ditutup. Isianmu tidak bisa disimpan atau dikirim." }, 409) });
    await next(u);
    await screen.findByRole("heading", { name: "Belum ada batch pendaftaran yang dibuka" });
    expect(screen.getByRole("alert").textContent).toBe("Pendaftaran untuk batch ini sudah ditutup. Isianmu tidak bisa disimpan atau dikirim.");
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
  });

  test("a 409 that has no sentence of its own gets the legacy one", async () => {
    const u = user();
    await identityReady({ [IDENTITY]: respond({ error: "batch_closed" }, 409) });
    await next(u);
    await screen.findByRole("heading", { name: "Belum ada batch pendaftaran yang dibuka" });
    expect(screen.getByRole("alert").textContent).toBe("Pendaftaran untuk batch ini sudah ditutup. Isianmu tidak bisa disimpan atau dikirim.");
  });

  test("the application was sent from another tab: the page reads where the student stands now, and shows 'sudah kami terima'", async () => {
    const u = user();
    let sent = false;
    await identityReady({
      [IDENTITY]: () => {
        sent = true;
        return respond({ error: "already_submitted", message: "Kamu sudah mengirim pendaftaran untuk batch ini. Cek status di halaman Portal Siswa." }, 409);
      },
      [ROUTES.current]: () => respond(sent ? currentBody({ gate: "submitted", application: { id: "a1", submittedAt: "2026-10-13T02:30:00.000Z" } }) : currentBody()),
    });
    await next(u);
    expect(await screen.findByRole("heading", { name: "Pendaftaran kamu untuk Gen 6 - 2026/2027 sudah kami terima" })).toBeTruthy();
    expect(within(screen.getByRole("main")).getByRole("link", { name: "Status Pendaftaran" }).getAttribute("href")).toBe("/portal/status");
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
  });
});

describe("the send", () => {
  /** A whole run up to the review, with the Worker's answer to the send chosen by the test. */
  async function atReview(answer: (call: number) => Response | Promise<Response>, extra: Record<string, Handler> = {}) {
    const u = user();
    let calls = 0;
    const api = wizardServer("open", { [SUBMIT]: () => answer(++calls), ...extra });
    renderApp("/portal/daftar");
    await fillAllTheWay(u);
    return { u, api };
  }
  const press = (u: ReturnType<typeof user>) => u.click(screen.getByRole("button", { name: "Kirim Pendaftaran" }));
  const ok = () => respond({ applicationId: "5f1d2c3b-0000-4000-8000-000000000002", submittedAt: "2026-10-13T03:40:00.000Z", batch: { id: "b", year: 2026, name: "Gen 6" } }, 201);

  test("the same WhatsApp number was sent a moment ago: the identity screen, the number's field says so, and the student can fix it", async () => {
    const { u } = await atReview(() => respond({ error: "duplicate_whatsapp", message: "Pendaftaran dari nomor WhatsApp ini baru saja dikirim. Mohon tunggu sebelum mencoba lagi.", step: "identity" }, 409));
    await press(u);
    await heading("Identitas Pribadi");
    expect(summaryLines()).toEqual(["Nomor WhatsApp Pribadi: Pendaftaran dari nomor WhatsApp ini baru saja dikirim. Mohon tunggu sebelum mencoba lagi."]);
    expect(screen.getByRole("textbox", { name: "Nomor WhatsApp Pribadi" }).getAttribute("aria-invalid")).toBe("true");
  });

  test("the draft changed while it was sent: the Worker's sentence on the review, and the next press sends it", async () => {
    const { u, api } = await atReview((call) => (call === 1 ? respond({ error: "draft_changed", message: "Isianmu berubah saat dikirim. Periksa lagi lalu kirim ulang." }, 409) : ok()));
    await press(u);
    expect(await screen.findByText("Isianmu berubah saat dikirim. Periksa lagi lalu kirim ulang.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Tinjau & Kirim" })).toBeTruthy();
    await press(u);
    await heading("Pendaftaran kamu sudah kami terima");
    expect(api.count(SUBMIT)).toBe(2);
  });

  test("the Worker says something is missing that the screen thought was there: its sentence, and the screen reads the server again (the files and the saved steps) instead of repeating itself", async () => {
    const { u, api } = await atReview((call) => (call === 1 ? respond({ error: "incomplete", message: "Berkas wajib belum lengkap: Foto Diri.", step: "documents", missingFiles: ["self-photo"] }, 422) : ok()));
    const reads = () => api.count(ROUTES.current);
    expect(reads()).toBe(1);
    await press(u);
    expect(await screen.findByText("Berkas wajib belum lengkap: Foto Diri.")).toBeTruthy();
    await waitFor(() => expect(reads()).toBe(2));
    expect(screen.getByRole("heading", { name: "Tinjau & Kirim" })).toBeTruthy();
  });

  test("no draft on the server: its sentence, and every step is sent again with the next press (the server holds none of them now)", async () => {
    let apiRef: ReturnType<typeof wizardServer> | null = null;
    const { u, api } = await atReview((call) => (call === 1 ? respond({ error: "no_draft", message: "Belum ada isian yang tersimpan. Isi formulir pendaftaran dulu." }, 404) : ok()), {
      // The server's answer when it is asked again: the files are there, the draft is not.
      [ROUTES.current]: async () => {
        const real = apiRef?.apps.handle("GET", "/portal/api/applications/current", {});
        return real ? respond({ ...(await real.json()), draft: null }) : null;
      },
    });
    apiRef = api;
    await press(u);
    expect(await screen.findByText("Belum ada isian yang tersimpan. Isi formulir pendaftaran dulu.")).toBeTruthy();
    await press(u);
    await heading("Pendaftaran kamu sudah kami terima");
    expect(api.writes().filter((call) => call.method === "PUT").length).toBe(14);
  });

  test("the limiter: its sentence, and the button is there to try again", async () => {
    const { u } = await atReview((call) => (call === 1 ? respond({ error: "rate_limited", message: "Terlalu banyak percobaan pengiriman. Silakan tunggu beberapa menit lalu coba lagi." }, 429, { "Retry-After": "60" }) : ok()));
    await press(u);
    expect(await screen.findByText("Terlalu banyak percobaan pengiriman. Silakan tunggu beberapa menit lalu coba lagi.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kirim Pendaftaran" })).toHaveProperty("disabled", false);
  });

  test("offline: the connection line, nothing is lost, and the send can be repeated", async () => {
    const { u, api } = await atReview((call) => {
      if (call === 1) throw new TypeError("offline");
      return ok();
    });
    await press(u);
    expect(await screen.findByText("Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.")).toBeTruthy();
    expect(localCopy()).not.toBeNull();
    await press(u);
    await heading("Pendaftaran kamu sudah kami terima");
    expect(api.count(SUBMIT)).toBe(2);
  });

  test("the session ended: the sign-in page, and the copy goes", async () => {
    const { u } = await atReview(() => respond({ error: "unauthenticated" }, 401));
    await press(u);
    expect(await screen.findByRole("heading", { name: "Selamat datang kembali" })).toBeTruthy();
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
  });

  test("the batch closed at the last moment: the gate screen, with the Worker's sentence", async () => {
    const { u } = await atReview(() => respond({ error: "batch_closed", message: "Pendaftaran untuk batch ini sudah ditutup. Isianmu tidak bisa disimpan atau dikirim." }, 409));
    await press(u);
    await screen.findByRole("heading", { name: "Belum ada batch pendaftaran yang dibuka" });
    expect(screen.getByRole("alert").textContent).toContain("sudah ditutup");
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
  });

  test("a save that fails on the way to the send stops there: the send is not made", async () => {
    const u = user();
    let failing = false;
    const api = wizardServer("open", { [IDENTITY]: () => (failing ? respond({ error: "internal" }, 500) : null) });
    renderApp("/portal/daftar");
    await fillAllTheWay(u);
    // A section changed through "Ubah" and left without saving: the send saves it first, and the Worker refuses that.
    await u.click(screen.getAllByRole("button", { name: "Ubah Identitas Pribadi" })[0] as HTMLElement);
    await heading("Identitas Pribadi");
    setText("Nama Panggilan", "Dewi");
    await u.click(within(screen.getByRole("navigation", { name: "Bagian formulir" })).getByRole("button", { name: /Tinjau & Kirim/ }));
    failing = true;
    await press(u);
    expect(await screen.findByText("Terjadi kesalahan di server. Coba lagi sebentar lagi.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Tinjau & Kirim" })).toBeTruthy();
    expect(api.count(SUBMIT)).toBe(0);
  });
});
