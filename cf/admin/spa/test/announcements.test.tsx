import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

const row = {
  id: "m1",
  title: "Pendaftaran Dibuka",
  body: "Isi pengumuman",
  severity: "info",
  ctaLabel: null,
  ctaUrl: null,
  active: true,
  startsAt: null,
  endsAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
};

async function open(role: Parameters<typeof meBody>[0], areas: Parameters<typeof meBody>[1], extra: Parameters<typeof stubApi>[0] = {}) {
  const api = stubApi({
    "GET /api/me": respond(meBody(role, areas)),
    "GET /api/announcements": respond({ announcements: [row] }),
    ...extra,
  });
  renderApp("/announcements");
  await screen.findByRole("heading", { level: 1, name: "Pengumuman" });
  await screen.findByText("Pendaftaran Dibuka");
  return api;
}

const form = () => screen.queryByRole("heading", { name: "Pengumuman Baru" });

describe("announcements page", () => {
  test("a viewer reads the list and is offered no form", async () => {
    await open("viewer", []);
    expect(form()).toBeNull();
    expect(screen.queryByRole("button", { name: "Buat Pengumuman" })).toBeNull();
  });

  test("an editor of Komunikasi gets the form", async () => {
    await open("editor", ["komunikasi"]);
    expect(form()).not.toBeNull();
  });

  test("an editor of another area does not", async () => {
    await open("editor", ["konten", "pendaftaran"]);
    expect(form()).toBeNull();
  });

  test("super_admin gets the form", async () => {
    await open("super_admin", []);
    expect(form()).not.toBeNull();
  });

  test("the pages below it are placeholders for now", async () => {
    stubApi({ "GET /api/me": respond(meBody("super_admin")) });
    renderApp("/announcements/new");
    expect(await screen.findByText("Belum tersedia di admin baru")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kembali ke daftar" }).getAttribute("href")).toBe("/announcements");
  });

  test("a list that fails to load says so", async () => {
    stubApi({ "GET /api/me": respond(meBody("viewer")), "GET /api/announcements": respond({ error: "internal" }, 500) });
    renderApp("/announcements");
    expect((await screen.findByRole("alert")).textContent).toBe("Gagal memuat pengumuman.");
  });

  test("creating one sends the form once, however many times it is submitted", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const api = await open("editor", ["komunikasi"], { "POST /api/announcements": () => gate.promise });

    await user.type(screen.getByLabelText(/Judul/), "Judul baru");
    await user.type(screen.getByLabelText(/Isi/), "Isi pengumuman baru");
    const button = screen.getByRole("button", { name: "Buat Pengumuman" });
    await user.click(button);
    expect((screen.getByRole("button", { name: "Menyimpan..." }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(button.closest("form")!);
    fireEvent.submit(button.closest("form")!);
    expect(api.count("POST /api/announcements")).toBe(1);

    gate.resolve(respond({ announcement: row }, 201));
    expect(await screen.findByText("Pengumuman berhasil disimpan.")).toBeTruthy();
    expect(api.count("POST /api/announcements")).toBe(1);
    expect(api.count("GET /api/announcements")).toBe(2); // the list reloads
    expect(api.last("POST /api/announcements")?.body).toMatchObject({ title: "Judul baru", severity: "info", active: false });
  });

  test("a refused form shows the server's field message", async () => {
    const user = userEvent.setup();
    await open("editor", ["komunikasi"], {
      "POST /api/announcements": respond({ error: "invalid", fieldErrors: { title: ["Judul minimal 3 karakter"] } }, 400),
    });
    await user.type(screen.getByLabelText(/Judul/), "ab");
    await user.type(screen.getByLabelText(/Isi/), "Isi pengumuman baru");
    await user.click(screen.getByRole("button", { name: "Buat Pengumuman" }));
    expect(await screen.findByText("Judul minimal 3 karakter")).toBeTruthy();
    expect(screen.getByText("Periksa kembali isian formulir.")).toBeTruthy();
    expect(screen.getByLabelText(/Judul/).getAttribute("aria-invalid")).toBe("true");
  });
});
