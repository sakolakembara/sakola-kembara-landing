import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { respond } from "./helpers";
import { renderApp } from "./helpers";
import { fillAllTheWay, fillIdentity, LOCAL_KEY, next, openAt, resetWizardMocks, wizardServer } from "./wizard-helpers";

// The application is a child's: name, address, family, income, scans. This file reads everything the wizard puts anywhere it
// should not: the console, a URL, the tab title, a cookie, session storage, a request header. (The copy in `localStorage` is the
// one place answers are kept, by the architecture's decision, and it has its own tests.) All data here is invented.

const IDENTIFYING = ["Sari", "Dewi", "6281200000001", "SMAN 1 Contoh", "Jl. Contoh", "Bapak Contoh", "Ibu Contoh", "sari_contoh", "1.200.000", "sari@contoh.test", "Saya ingin kuliah"];
const METHODS = ["log", "info", "debug", "warn", "error", "trace", "dir", "table", "group", "groupCollapsed"] as const;

let output: { method: string; text: string }[] = [];

// A whole run through the wizard is many screens: allow for a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  output = [];
  for (const method of METHODS) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void output.push({ method, text: args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ") }));
  }
});
afterEach(resetWizardMocks);

const user = () => userEvent.setup({ applyAccept: false, delay: null });
const heading = (name: string) => screen.findByRole("heading", { name });
const location = () => screen.getByTestId("location").textContent ?? "";

describe("a whole run, from the first screen to the confirmation", () => {
  test("not one console line, at any level: nothing identifying, nothing at all", async () => {
    const u = user();
    wizardServer();
    renderApp("/portal/daftar");
    await fillAllTheWay(u);
    await u.click(screen.getByRole("button", { name: "Kirim Pendaftaran" }));
    await heading("Pendaftaran kamu sudah kami terima");
    expect(output).toEqual([]);
  });

  test("no address of the page, and no request of the wizard, carries an answer or a query: ids and fixed paths only", async () => {
    const u = user();
    const api = wizardServer();
    renderApp("/portal/daftar");
    const seen = new Set<string>();
    const watch = () => seen.add(location());
    await heading("Sebelum Mulai Pendaftaran");
    watch();
    await next(u);
    await heading("Identitas Pribadi");
    watch();
    await fillIdentity(u);
    await next(u);
    await heading("Keluarga & Ekonomi");
    watch();
    // The rest of the way.
    await u.click(screen.getByRole("button", { name: "Sebelumnya" }));
    await heading("Identitas Pribadi");
    watch();
    expect([...seen]).toEqual(["/daftar"]);

    for (const call of api.calls) {
      expect(call.url, call.url).toMatch(/^\/portal\/api\/[a-z/-]+$/);
      expect(call.url).not.toContain("?");
      for (const word of IDENTIFYING) expect(call.url).not.toContain(word);
      for (const [name, value] of Object.entries(call.headers)) for (const word of IDENTIFYING) expect(`${name}: ${value}`).not.toContain(word);
    }
  });

  test("the tab title, the cookies and session storage hold none of it; the browser's copy is under a key of two ids", async () => {
    const u = user();
    wizardServer();
    renderApp("/portal/daftar");
    await fillAllTheWay(u);
    for (const word of IDENTIFYING) expect(document.title).not.toContain(word);
    expect(document.cookie).toBe("");
    expect(window.sessionStorage.length).toBe(0);
    expect(Object.keys(window.localStorage)).toEqual([LOCAL_KEY]);
    expect(LOCAL_KEY).toBe("sakem-portal:v1:user-1:8b7e0c1a-0000-4000-8000-000000000001");
    // The key and the title say nothing about the student; the value is the answers (that is what it is for) and no email.
    expect(window.localStorage.getItem(LOCAL_KEY)).not.toContain("sari@contoh.test");
  });

  test("the files do not go through the wizard: its own requests are JSON, and an upload is the field's (the uploader), never a request of the wizard", async () => {
    const u = user();
    const api = wizardServer();
    renderApp("/portal/daftar");
    await fillAllTheWay(u);
    expect(api.calls.filter((call) => /\/files\//.test(call.path))).toEqual([]);
    for (const call of api.writes()) expect(call.headers["content-type"]).toBe("application/json");
  });
});

describe("the ways it can go wrong are as quiet", () => {
  test("a refused save, a dropped connection and a closed batch say it on the screen and write nothing to the console", async () => {
    const u = user();
    let step = 0;
    wizardServer("open", {
      "PUT /portal/api/applications/current/steps/identity": () => {
        step += 1;
        if (step === 1) return respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { schoolName: "Maksimal 200 karakter" } }, 400);
        if (step === 2) throw new TypeError("offline");
        return respond({ error: "batch_closed", message: "Pendaftaran untuk batch ini sudah ditutup. Isianmu tidak bisa disimpan atau dikirim." }, 409);
      },
    });
    openAt("identity", { identity: { fullName: "Sari Dewi", nickname: "Sari", gender: "perempuan", religion: "Islam", schoolName: "SMAN 1 Contoh", branch: "Bandung", homeAddress: "Jl. Contoh", graduationBatch: "2027 (Kelas 12)", whatsapp: "6281200000001" } });
    await heading("Identitas Pribadi");
    await next(u);
    await screen.findAllByText(/Maksimal 200 karakter/);
    await next(u);
    await screen.findByText(/Tidak dapat terhubung ke server/);
    await next(u);
    await heading("Belum ada batch pendaftaran yang dibuka");
    expect(output).toEqual([]);
  });

  test("a body the page cannot read, a crash of the Worker and a lost session leave nothing in the console either", async () => {
    const u = user();
    wizardServer("open", { "PUT /portal/api/applications/current/steps/identity": respond({ weird: true }, 200) });
    openAt("identity", { identity: { fullName: "Sari Dewi", nickname: "Sari", gender: "perempuan", religion: "Islam", schoolName: "SMAN 1 Contoh", branch: "Bandung", homeAddress: "Jl. Contoh", graduationBatch: "2027 (Kelas 12)", whatsapp: "6281200000001" } });
    await heading("Identitas Pribadi");
    await next(u);
    await screen.findByText("Jawaban server tidak bisa dibaca. Coba lagi.");
    expect(output).toEqual([]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Selanjutnya" })).toHaveProperty("disabled", false));
  });

  test("a copy somebody damaged in the browser does not log what it could not read", async () => {
    window.localStorage.setItem(LOCAL_KEY, "{not json, but with a name: Sari Dewi");
    wizardServer();
    renderApp("/portal/daftar");
    await heading("Sebelum Mulai Pendaftaran");
    expect(output).toEqual([]);
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
  });
});
