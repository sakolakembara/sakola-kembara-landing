import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { ENDPOINTS } from "~/lib/paths";
import { meBody, renderApp, respond, stubApi } from "./helpers";

const AT = "2026-12-01T01:00:00.000Z";
const SENT = "2026-10-12T04:30:00.000Z";
const batch = { id: "b1", year: 2026, name: "Gen 6 - 2026/2027" };
const item = (result: unknown, extra: Record<string, unknown> = {}) => ({ id: "a1", batch, submittedAt: SENT, result, ...extra });

async function openStatus(items: unknown[]) {
  const api = stubApi({ [`GET ${ENDPOINTS.me}`]: respond(meBody()), [`GET ${ENDPOINTS.applications}`]: respond({ items }) });
  renderApp("/portal/status");
  await screen.findByRole("heading", { level: 1, name: "Rekap perjalanan pendaftaranmu" });
  return api;
}

describe("status: the page", () => {
  test("the band says when results appear, under one h1", async () => {
    await openStatus([]);
    expect(screen.getByText("Hasil hanya muncul setelah panitia mengumumkan keputusan seluruh batch.")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    await waitFor(() => expect(document.title).toBe("Status Pendaftaran | Portal Siswa"));
  });

  test("one call for the page", async () => {
    const api = await openStatus([item({ state: "processing" })]);
    await screen.findByRole("article");
    expect(api.calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET ${ENDPOINTS.me}`, `GET ${ENDPOINTS.applications}`]);
  });

  test("nothing sent yet: the legacy empty state and the way back", async () => {
    await openStatus([]);
    expect(await screen.findByRole("heading", { name: "Belum ada pendaftaran" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ke beranda portal" }).getAttribute("href")).toBe("/portal");
  });
});

describe("status: before the results are published", () => {
  test("'sedang diproses', the batch and when it was sent, and no verdict", async () => {
    await openStatus([item({ state: "processing" })]);
    const card = await screen.findByRole("article", { name: "Pendaftaran kamu sedang diproses" });
    expect(within(card).getByText("Sedang Diproses")).toBeTruthy();
    expect(within(card).getByText(/Batch 2026 · Gen 6 - 2026\/2027/)).toBeTruthy();
    expect(within(card).getByText(/Terima kasih sudah mendaftar\. Panitia akan mengabari hasilnya/)).toBeTruthy();
    expect(within(card).getByText(/^Dikirim/)).toBeTruthy();
    expect(within(card).queryByText(/^Diumumkan/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/Kamu diterima|Belum lolos/);
  });

  test("a verdict the API sent next to 'processing' by mistake is not shown", async () => {
    await openStatus([item({ state: "processing", decision: "accepted", notes: "Selamat, kamu lolos!" }, { status: "accepted", reviewNotes: "Selamat, kamu lolos!" })]);
    await screen.findByRole("article", { name: "Pendaftaran kamu sedang diproses" });
    expect(document.body.textContent).not.toMatch(/diterima|lolos|Selamat/i);
  });

  test("a result the page does not know is 'sedang diproses' too", async () => {
    await openStatus([item({ state: "something-new", decision: "accepted" })]);
    expect(await screen.findByRole("article", { name: "Pendaftaran kamu sedang diproses" })).toBeTruthy();
  });
});

describe("status: after the results are published", () => {
  test("accepted: the solid card, the default paragraph, and when it was announced", async () => {
    await openStatus([item({ state: "decided", decision: "accepted", announcedAt: AT, notes: null })]);
    const card = await screen.findByRole("article", { name: "Kamu diterima" });
    expect(within(card).getByText("Selamat")).toBeTruthy();
    expect(within(card).getByText(/Panitia akan menghubungi kamu lewat WhatsApp untuk langkah selanjutnya/)).toBeTruthy();
    expect(within(card).getByText(/^Diumumkan/)).toBeTruthy();
    expect(card.parentElement?.className).toContain("bg-secondary-green");
  });

  test("accepted with the committee's note: the note is the body", async () => {
    await openStatus([item({ state: "decided", decision: "accepted", announcedAt: AT, notes: "Datang ke Cililin pada 3 Agustus.\nBawa berkas asli." })]);
    const card = await screen.findByRole("article", { name: "Kamu diterima" });
    expect(within(card).getByText(/Datang ke Cililin pada 3 Agustus\./)).toBeTruthy();
    expect(within(card).queryByText(/Panitia akan menghubungi kamu lewat WhatsApp/)).toBeNull();
  });

  test("rejected: calm words, the default paragraph, and the way to the next batch", async () => {
    await openStatus([item({ state: "decided", decision: "rejected", announcedAt: AT, notes: null })]);
    const card = await screen.findByRole("article", { name: "Belum lolos tahun ini" });
    expect(within(card).getByText("Terima Kasih")).toBeTruthy();
    expect(within(card).getByText(/Kamu boleh mencoba lagi di batch berikutnya/)).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Lihat batch pendaftaran berikutnya" }).getAttribute("href")).toBe("/portal");
  });

  test("rejected with the committee's note", async () => {
    await openStatus([item({ state: "decided", decision: "rejected", announcedAt: AT, notes: "Kuota batch ini sudah penuh." })]);
    const card = await screen.findByRole("article", { name: "Belum lolos tahun ini" });
    expect(within(card).getByText("Kuota batch ini sudah penuh.")).toBeTruthy();
  });

  test("announced but undecided: the odd state, with the way to the committee", async () => {
    await openStatus([item({ state: "awaiting_decision", announcedAt: AT })]);
    const card = await screen.findByRole("article", { name: "Menunggu keputusan" });
    expect(within(card).getByText(/1×24 jam/)).toBeTruthy();
    expect(within(card).getByText(/^Diumumkan/)).toBeTruthy();
  });

  test("a note is shown as text, never as markup", async () => {
    await openStatus([item({ state: "decided", decision: "rejected", announcedAt: AT, notes: "<img src=x onerror=alert(1)> <b>tebal</b>" })]);
    const card = await screen.findByRole("article", { name: "Belum lolos tahun ini" });
    expect(card.querySelector("img")).toBeNull();
    const note = within(card).getByText(/<img src=x onerror=alert\(1\)> <b>tebal<\/b>/);
    expect(note.children).toHaveLength(0);
  });

  test("several batches: one card each, in the order the API sent", async () => {
    await openStatus([
      item({ state: "processing" }, { id: "a2", batch: { id: "b2", year: 2027, name: "Gen 7 - 2027/2028" } }),
      item({ state: "decided", decision: "rejected", announcedAt: AT, notes: null }),
    ]);
    const cards = await screen.findAllByRole("article");
    expect(cards.map((card) => within(card).getByRole("heading").textContent)).toEqual(["Pendaftaran kamu sedang diproses", "Belum lolos tahun ini"]);
  });
});

describe("status: when something is off", () => {
  test("it could not be read: it says so, nothing is lost, 'Coba lagi' tries again", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    stubApi({
      [`GET ${ENDPOINTS.me}`]: respond(meBody()),
      [`GET ${ENDPOINTS.applications}`]: () => (++attempt === 1 ? respond({ error: "internal" }, 500) : respond({ items: [item({ state: "processing" })] })),
    });
    renderApp("/portal/status");
    expect(await screen.findByText(/Pendaftaran kamu tidak terhapus/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByRole("article", { name: "Pendaftaran kamu sedang diproses" })).toBeTruthy();
  });

  test("an answer that is not a list is an error", async () => {
    stubApi({ [`GET ${ENDPOINTS.me}`]: respond(meBody()), [`GET ${ENDPOINTS.applications}`]: respond({ items: "x" }) });
    renderApp("/portal/status");
    expect(await screen.findByRole("button", { name: "Coba lagi" })).toBeTruthy();
  });

  test("while it loads there is a polite status line", async () => {
    stubApi({ [`GET ${ENDPOINTS.me}`]: respond(meBody()), [`GET ${ENDPOINTS.applications}`]: () => new Promise<Response>(() => undefined) });
    renderApp("/portal/status");
    expect(await screen.findByText("Memuat status pendaftaran…")).toBeTruthy();
  });
});
