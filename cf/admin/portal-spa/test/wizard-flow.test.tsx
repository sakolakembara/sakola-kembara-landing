import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderApp } from "./helpers";
import { ANSWERS, fillAllTheWay, fillHousehold, fillIdentity, LOCAL_KEY, localCopy, next, openAt, resetWizardMocks, seedLocal, setText, wizardServer } from "./wizard-helpers";

// The way through the wizard: going on, going back, the list of screens, the review and the send, and what a student finds
// when they come back. The stand-in Worker is the mock's own wizard routes, which run the shared module's real rules.

// A whole run through the wizard is many screens: allow for a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => void wizardServer());
afterEach(resetWizardMocks);

const user = () => userEvent.setup({ applyAccept: false, delay: null });
const heading = (name: string) => screen.findByRole("heading", { name });
const STEP = (name: string) => `PUT /portal/api/applications/current/steps/${name}`;
const written = (api: ReturnType<typeof wizardServer>) => api.writes().map((call) => `${call.method} ${call.path.replace("/portal/api/applications/current", "")}`);

describe("a new student, from the first screen to the last", () => {
  test("every screen saves its bucket when 'Selanjutnya' is pressed, in the order of the screens, and the send comes last", async () => {
    const u = user();
    const api = wizardServer();
    renderApp("/portal/daftar");
    await fillAllTheWay(u);

    // The legacy order of the screens, each bucket once (the documents screen saves two); no step is saved twice.
    expect(written(api)).toEqual(["PUT /steps/identity", "PUT /steps/household", "PUT /steps/housing", "PUT /steps/organizations", "PUT /steps/interview", "PUT /steps/documents", "PUT /steps/marketing"]);

    await u.click(screen.getByRole("button", { name: "Kirim Pendaftaran" }));
    expect(await heading("Pendaftaran kamu sudah kami terima")).toBeTruthy();
    // Everything was saved: the send adds only the send.
    expect(written(api).slice(7)).toEqual(["POST /submit"]);
  });

  test("the bodies are what the rules store: trimmed, the number without spaces, no field of a switch that is off", async () => {
    const u = user();
    const api = wizardServer();
    renderApp("/portal/daftar");
    await heading("Sebelum Mulai Pendaftaran");
    await next(u);
    await heading("Identitas Pribadi");
    await fillIdentity(u, { schoolName: "  SMAN 1 Contoh  ", whatsapp: "62 812 0000 0001" });
    await next(u);
    await heading("Keluarga & Ekonomi");
    expect(api.last(STEP("identity"))?.body).toEqual({
      fullName: "Sari Dewi",
      nickname: "Sari",
      gender: "perempuan",
      religion: "Islam",
      schoolName: "SMAN 1 Contoh",
      branch: "Bandung",
      homeAddress: "Jl. Contoh No. 1, Kota Contoh",
      graduationBatch: "2027 (Kelas 12)",
      whatsapp: "6281200000001",
    });
    await fillHousehold(u);
    await next(u);
    await heading("Tempat Tinggal & Hutang");
    const household = api.last("PUT /portal/api/applications/current/steps/household")?.body;
    expect(household).toMatchObject({ livingWith: ["Ayah", "Ibu"], fatherIncome: "1.200.000", familySize: "4", hasOtherEarner1: false, hasOtherEarner2: false });
    expect(household).not.toHaveProperty("earner1Relation");
  });

  test("the review shows what was typed, the documents as a count of files and the Instagram name with its @, and each section can be changed", async () => {
    const u = user();
    wizardServer();
    renderApp("/portal/daftar");
    await fillAllTheWay(u);

    const section = (title: string) => screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;
    expect(within(section("Identitas Pribadi")).getByText("Sari Dewi")).toBeTruthy();
    expect(within(section("Identitas Pribadi")).getByText("6281200000001")).toBeTruthy();
    expect(within(section("Keluarga & Ekonomi")).getByText("Ayah, Ibu")).toBeTruthy();
    expect(within(section("Tempat Tinggal & Hutang")).getByText("60 m²")).toBeTruthy();
    expect(within(section("Organisasi")).getByText("Belum pernah")).toBeTruthy();
    expect(within(section("Berkas Pendaftaran")).getByText("Kartu Keluarga")).toBeTruthy();
    expect(within(section("Berkas Pendaftaran")).getAllByText("1 berkas")).toHaveLength(6);
    expect(within(section("Berkas Pendaftaran")).getAllByText("—").length).toBeGreaterThanOrEqual(5);
    expect(within(section("Berkas Marketing")).getByText("@sari_contoh")).toBeTruthy();
    expect(within(section("Berkas Marketing")).getAllByText("1 berkas")).toHaveLength(4);
    // Nothing is "belum disimpan": every screen went through "Selanjutnya".
    expect(screen.queryByText("Belum disimpan")).toBeNull();

    await u.click(within(section("Identitas Pribadi")).getByRole("button", { name: "Ubah Identitas Pribadi" }));
    expect(await heading("Identitas Pribadi")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Nama Panggilan" })).toBeTruthy();
  });

  test("the copy in the browser follows every change, with the time it was written, and is removed once the application is sent", async () => {
    const u = user();
    wizardServer();
    renderApp("/portal/daftar");
    await fillAllTheWay(u);
    const copy = localCopy();
    expect(copy).not.toBeNull();
    expect(typeof copy?.savedAt).toBe("number");
    expect(copy?.stepIndex).toBe(7);
    expect(copy?.values.identity).toMatchObject({ nickname: "Sari" });
    // What is kept is the answers and the place: never a file.
    expect(JSON.stringify(copy)).not.toMatch(/berkas\.pdf|foto\.jpg|bukti\.png/);

    await u.click(screen.getByRole("button", { name: "Kirim Pendaftaran" }));
    await heading("Pendaftaran kamu sudah kami terima");
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  test("the confirmation says what the legacy one said, shows the id and leads on", async () => {
    const u = user();
    wizardServer("open", {}, { config: { whatsappGroupUrl: "https://chat.contoh.test/grup" } });
    renderApp("/portal/daftar");
    await fillAllTheWay(u);
    await u.click(screen.getByRole("button", { name: "Kirim Pendaftaran" }));
    await heading("Pendaftaran kamu sudah kami terima");
    expect(screen.getByText(/Terima kasih sudah mengisi formulir pendaftaran\. Tim kesiswaan akan meninjau berkas kamu/)).toBeTruthy();
    expect(screen.getByText(/ID Pendaftaran: /).textContent).toMatch(/[0-9a-f-]{20,}/);
    expect(screen.getByRole("link", { name: "Gabung Grup WhatsApp" }).getAttribute("href")).toBe("https://chat.contoh.test/grup");
    expect(screen.getByRole("link", { name: "Lihat status pendaftaran" }).getAttribute("href")).toBe("/portal/status");
    expect(screen.getByRole("link", { name: "Kembali ke portal" }).getAttribute("href")).toBe("/portal");
    // The heading takes focus, so a screen reader starts at "Pendaftaran kamu sudah kami terima".
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Pendaftaran kamu sudah kami terima" }));
  });

  test("without a group address in the config there is no group button, and the review does not promise one", async () => {
    const u = user();
    wizardServer();
    renderApp("/portal/daftar");
    await fillAllTheWay(u);
    expect(screen.queryByText(/link grup WhatsApp/)).toBeNull();
    await u.click(screen.getByRole("button", { name: "Kirim Pendaftaran" }));
    await heading("Pendaftaran kamu sudah kami terima");
    expect(screen.queryByRole("link", { name: "Gabung Grup WhatsApp" })).toBeNull();
    expect(screen.queryByText("Langkah selanjutnya")).toBeNull();
  });
});

describe("going on, going back, and the list of screens", () => {
  test("the first screen asks for nothing and sends nothing; the next one opens with its heading focused", async () => {
    const u = user();
    const api = wizardServer();
    renderApp("/portal/daftar");
    await heading("Sebelum Mulai Pendaftaran");
    expect(screen.getByRole("heading", { level: 1, name: "Ceritakan tentang dirimu, Sari" })).toBeTruthy();
    await next(u);
    const identity = await heading("Identitas Pribadi");
    expect(document.activeElement).toBe(identity);
    expect(api.writes()).toEqual([]);
  });

  test("a screen that passes is saved before the next one opens, and the live region says so", async () => {
    const u = user();
    const api = wizardServer();
    openAt("identity");
    await heading("Identitas Pribadi");
    await fillIdentity(u);
    await next(u);
    expect(await heading("Keluarga & Ekonomi")).toBeTruthy();
    expect(api.count(STEP("identity"))).toBe(1);
    expect(api.writes().map((call) => call.path)).toEqual(["/portal/api/applications/current/steps/identity"]);
    expect(screen.getByText("Bagian Identitas Pribadi tersimpan.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Keluarga & Ekonomi" }));
  });

  test("while it is saving the button says so and cannot be pressed again; two quick presses send one request", async () => {
    const u = user();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const api = wizardServer("open", {
      [STEP("identity")]: async () => {
        await held;
        return Response.json({ step: "identity", savedAt: "2026-10-13T03:00:00.000Z", draft: { id: "d1", updatedAt: "2026-10-13T03:00:00.000Z", saved: ["identity"], missingFiles: [] }, removedSlots: [] });
      },
    });
    openAt("identity", { identity: { fullName: "Sari Dewi", nickname: "Sari", gender: "perempuan", religion: "Islam", schoolName: "SMAN 1 Contoh", branch: "Bandung", homeAddress: "Jl. Contoh", graduationBatch: "2027 (Kelas 12)", whatsapp: "6281200000001" } });
    await heading("Identitas Pribadi");
    const button = screen.getByRole("button", { name: "Selanjutnya" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByRole("button", { name: "Menyimpan…" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Menyimpan…", { selector: "p" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sebelumnya" })).toHaveProperty("disabled", true);
    release();
    await heading("Keluarga & Ekonomi");
    expect(api.count(STEP("identity"))).toBe(1);
    expect(api.writes()).toHaveLength(1);
    void u;
  });

  test("'Sebelumnya' sends nothing and keeps what was typed, and the first screen has no way back", async () => {
    const u = user();
    const api = wizardServer();
    const view = openAt("household");
    await heading("Keluarga & Ekonomi");
    setText(/Nama Ayah/, ANSWERS.household.fatherName);
    await u.click(screen.getByRole("button", { name: "Sebelumnya" }));
    await heading("Identitas Pribadi");
    expect(api.writes()).toEqual([]);
    await u.click(screen.getByRole("button", { name: "Selanjutnya" }));
    // Not valid (nothing is filled in), so it stays: the typed name of the father is still in the browser's copy.
    expect(localCopy()?.values.household?.fatherName).toBe(ANSWERS.household.fatherName);
    view.unmount();
    seedLocal("intro");
    renderApp("/portal/daftar");
    await heading("Sebelum Mulai Pendaftaran");
    expect(screen.getByRole("button", { name: "Sebelumnya" })).toHaveProperty("disabled", true);
  });

  test("the list names where the student is, locks the screens not reached yet, and lets them back to any they have seen", async () => {
    const u = user();
    wizardServer();
    openAt("housing");
    await heading("Tempat Tinggal & Hutang");
    const list = screen.getByRole("navigation", { name: "Bagian formulir" });
    expect(within(list).getByText("Bagian 4 dari 8")).toBeTruthy();
    const items = within(list).getAllByRole("listitem").map((item) => within(item).getByRole("button"));
    expect(items.map((button) => button.textContent)).toEqual(["Sebelum Mulai", "Identitas Pribadi", "Keluarga & Ekonomi", "Tempat Tinggal & Hutang", "Organisasi", "Interview Tertulis", "Pengumpulan Berkas", "Tinjau & Kirim"]);
    expect(items.map((button) => button.getAttribute("aria-current"))).toEqual([null, null, null, "step", null, null, null, null]);
    expect(items.map((button) => (button as HTMLButtonElement).disabled)).toEqual([false, false, false, false, true, true, true, true]);

    await u.click(items[1] as HTMLElement);
    expect(await heading("Identitas Pribadi")).toBeTruthy();
    expect(within(list).getByText("Bagian 2 dari 8")).toBeTruthy();
    // Still open to what was seen: the housing screen is one click away again.
    await u.click(within(list).getByRole("button", { name: "Tempat Tinggal & Hutang" }));
    expect(await heading("Tempat Tinggal & Hutang")).toBeTruthy();
  });

  test("the list is a real set of buttons: the keyboard reaches them and Enter opens the screen", async () => {
    const u = user();
    wizardServer();
    openAt("housing");
    await heading("Tempat Tinggal & Hutang");
    const identity = within(screen.getByRole("navigation", { name: "Bagian formulir" })).getByRole("button", { name: "Identitas Pribadi" });
    identity.focus();
    await u.keyboard("{Enter}");
    expect(await heading("Identitas Pribadi")).toBeTruthy();
  });

  test("on a phone the list is behind one button that says where the student is; from lg it is always open", async () => {
    const u = user();
    wizardServer();
    openAt("housing");
    await heading("Tempat Tinggal & Hutang");
    const toggle = within(screen.getByRole("navigation", { name: "Bagian formulir" })).getByRole("button", { name: "Tempat Tinggal & Hutang", expanded: false });
    expect(toggle.getAttribute("aria-controls")).toBe("daftar-bagian");
    expect(toggle.className).toContain("lg:hidden");
    const list = document.getElementById("daftar-bagian") as HTMLElement;
    expect(list.className).toContain("hidden lg:block");
    await u.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(list.className).not.toContain("hidden");
  });

  test("the progress is the legacy one: the screen over the last, as a percentage", async () => {
    openAt("housing");
    await heading("Tempat Tinggal & Hutang");
    expect(screen.getByText("43%")).toBeTruthy();
    const bar = screen.getByRole("progressbar", { name: "Kemajuan pengisian formulir" });
    expect(bar.getAttribute("aria-valuenow")).toBe("43");
  });
});

describe("the review, and sending what was changed after a screen was left", () => {
  test("a section changed through 'Ubah' and left without 'Selanjutnya' is marked 'Belum disimpan', and the send saves it first", async () => {
    const u = user();
    const api = wizardServer();
    renderApp("/portal/daftar");
    await fillAllTheWay(u);
    const before = api.writes().length;

    await u.click(within(screen.getByRole("heading", { name: "Identitas Pribadi" }).closest("section") as HTMLElement).getByRole("button", { name: "Ubah Identitas Pribadi" }));
    await heading("Identitas Pribadi");
    setText("Nama Panggilan", "Dewi");
    // Straight back to the review by the list, without saving.
    await u.click(within(screen.getByRole("navigation", { name: "Bagian formulir" })).getByRole("button", { name: /Tinjau & Kirim/ }));
    await heading("Tinjau & Kirim");
    expect(api.writes()).toHaveLength(before);
    const section = screen.getByRole("heading", { name: "Identitas Pribadi" }).closest("section") as HTMLElement;
    expect(within(section).getByText("Belum disimpan")).toBeTruthy();
    expect(screen.getByText("Bagian yang bertanda Belum disimpan akan disimpan otomatis saat kamu menekan Kirim Pendaftaran.")).toBeTruthy();

    await u.click(screen.getByRole("button", { name: "Kirim Pendaftaran" }));
    await heading("Pendaftaran kamu sudah kami terima");
    expect(written(api).slice(before)).toEqual(["PUT /steps/identity", "POST /submit"]);
    expect(api.last("PUT /portal/api/applications/current/steps/identity")?.body).toMatchObject({ nickname: "Dewi" });
  });

  test("an answer made invalid after the screen was left sends the student back to that screen with the message, and sends nothing", async () => {
    const u = user();
    const api = wizardServer();
    renderApp("/portal/daftar");
    await fillAllTheWay(u);
    const before = api.writes().length;
    await u.click(screen.getAllByRole("button", { name: /^Ubah / })[0] as HTMLElement);
    await heading("Identitas Pribadi");
    setText("Nomor WhatsApp Pribadi", "123");
    await u.click(within(screen.getByRole("navigation", { name: "Bagian formulir" })).getByRole("button", { name: /Tinjau & Kirim/ }));
    await u.click(screen.getByRole("button", { name: "Kirim Pendaftaran" }));
    await heading("Identitas Pribadi");
    expect(screen.getByText("Beberapa isian belum lengkap. Silakan lengkapi bagian yang ditandai.")).toBeTruthy();
    expect(within(screen.getByRole("alert")).getByText(/Gunakan format 62 diikuti 8–14 digit/)).toBeTruthy();
    expect(api.writes()).toHaveLength(before);
  });

  test("a required document removed after the documents screen was passed is found before anything is sent", async () => {
    const u = user();
    const api = wizardServer();
    renderApp("/portal/daftar");
    await fillAllTheWay(u);
    const before = api.writes().length;
    await u.click(screen.getAllByRole("button", { name: "Ubah Berkas Pendaftaran" })[0] as HTMLElement);
    await heading("Berkas Pendaftaran");
    await u.click(within(screen.getByRole("group", { name: /^Scan Kartu Keluarga/ })).getByRole("button", { name: "Hapus berkas 1 Scan Kartu Keluarga" }));
    await u.click(within(screen.getByRole("group", { name: /^Scan Kartu Keluarga/ })).getByRole("button", { name: "Ya, hapus" }));
    await waitFor(() => expect(within(screen.getByRole("group", { name: /^Scan Kartu Keluarga/ })).queryByText("Berkas 1")).toBeNull());
    await u.click(within(screen.getByRole("navigation", { name: "Bagian formulir" })).getByRole("button", { name: /Tinjau & Kirim/ }));
    await u.click(screen.getByRole("button", { name: "Kirim Pendaftaran" }));
    await heading("Berkas Pendaftaran");
    const alert = screen.getAllByRole("alert").find((box) => box.textContent?.includes("Berkas wajib belum lengkap"));
    expect(alert?.textContent).toContain("Berkas wajib belum lengkap: Scan Kartu Keluarga.");
    expect(api.writes().filter((call) => call.method === "POST")).toEqual([]);
  });
});

describe("coming back", () => {
  test("after a reload the student is where they left, with what they typed, and nothing is sent just for opening it", async () => {
    const u = user();
    const api = wizardServer();
    const first = renderApp("/portal/daftar");
    await heading("Sebelum Mulai Pendaftaran");
    await next(u);
    await heading("Identitas Pribadi");
    await fillIdentity(u);
    await next(u);
    await heading("Keluarga & Ekonomi");
    setText(/Nama Ayah/, ANSWERS.household.fatherName);
    first.unmount();
    const writes = api.writes().length;

    renderApp("/portal/daftar");
    await heading("Keluarga & Ekonomi");
    expect((screen.getByRole("textbox", { name: /Nama Ayah/ }) as HTMLInputElement).value).toBe(ANSWERS.household.fatherName);
    expect(api.writes()).toHaveLength(writes);
    // And what was saved is open to go back to.
    await u.click(within(screen.getByRole("navigation", { name: "Bagian formulir" })).getByRole("button", { name: "Identitas Pribadi" }));
    await heading("Identitas Pribadi");
    expect((screen.getByRole("textbox", { name: "Nama Panggilan" }) as HTMLInputElement).value).toBe("Sari");
  });

  test("on another device (nothing in the browser) the saved screens are there, and the student carries on where the server stops", async () => {
    wizardServer("draft");
    renderApp("/portal/daftar");
    await heading("Tempat Tinggal & Hutang");
    const list = screen.getByRole("navigation", { name: "Bagian formulir" });
    expect(within(list).getByRole("button", { name: "Identitas Pribadi" })).toHaveProperty("disabled", false);
    expect(within(list).getByRole("button", { name: "Keluarga & Ekonomi" })).toHaveProperty("disabled", false);
    expect(within(list).getByRole("button", { name: "Organisasi" })).toHaveProperty("disabled", true);
    // The server's answers are in the fields: the name, the school, the father.
    expect(screen.queryByRole("textbox", { name: "Nama Panggilan" })).toBeNull();
    await userEvent.setup().click(within(list).getByRole("button", { name: "Identitas Pribadi" }));
    expect((await screen.findByRole("textbox", { name: "Asal Sekolah" }) as HTMLInputElement).value).toBe("SMAN 1 Contoh");
    // A file the student had sent is listed under its slot.
    await userEvent.setup().click(within(list).getByRole("button", { name: "Tempat Tinggal & Hutang" }));
    expect(screen.queryByText("Belum disimpan")).toBeNull();
  });

  test("a copy in the browser NEWER than the server's draft and different is kept, and its screen is marked 'Belum disimpan'", async () => {
    const u = user();
    wizardServer("draft");
    seedLocal("household", { identity: { nickname: "Dewi" } }, Date.now());
    renderApp("/portal/daftar");
    await heading("Keluarga & Ekonomi");
    const list = screen.getByRole("navigation", { name: "Bagian formulir" });
    expect(within(within(list).getByRole("button", { name: /Identitas Pribadi/ })).getByText("Belum disimpan")).toBeTruthy();
    await u.click(within(list).getByRole("button", { name: /Identitas Pribadi/ }));
    expect((await screen.findByRole("textbox", { name: "Nama Panggilan" }) as HTMLInputElement).value).toBe("Dewi");
  });

  test("a copy OLDER than the server's draft does not override it", async () => {
    const u = user();
    wizardServer("draft");
    // The draft was saved two hours before the answer's clock; this copy was written three hours before it.
    seedLocal("household", { identity: { nickname: "Dewi" } }, Date.now() - 3 * 60 * 60 * 1000);
    renderApp("/portal/daftar");
    await heading("Tempat Tinggal & Hutang");
    await u.click(within(screen.getByRole("navigation", { name: "Bagian formulir" })).getByRole("button", { name: /Identitas Pribadi/ }));
    expect((await screen.findByRole("textbox", { name: "Nama Panggilan" }) as HTMLInputElement).value).toBe("Sari");
    expect(screen.queryByText("Belum disimpan")).toBeNull();
  });

  test("a copy that is 30 days old is not used, and is removed; the server's draft is", async () => {
    wizardServer("draft");
    seedLocal("organizations", { identity: { nickname: "Dewi" } }, Date.now() - 31 * 24 * 60 * 60 * 1000);
    renderApp("/portal/daftar");
    await heading("Tempat Tinggal & Hutang");
    await waitFor(() => expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull());
  });

  test("a copy of another student's, or of another batch, is not read", async () => {
    wizardServer();
    window.localStorage.setItem("sakem-portal:v1:user-2:8b7e0c1a-0000-4000-8000-000000000001", JSON.stringify({ version: 1, savedAt: Date.now(), stepIndex: 3, visited: ["intro"], values: { identity: { nickname: "Orang Lain" } } }));
    window.localStorage.setItem("sakem-portal:v1:user-1:batch-lama", JSON.stringify({ version: 1, savedAt: Date.now(), stepIndex: 3, visited: ["intro"], values: {} }));
    renderApp("/portal/daftar");
    await heading("Sebelum Mulai Pendaftaran");
    expect(window.localStorage.length).toBe(2);
  });

  test("opening the wizard does not write a copy: only a change does (the 30 days run from the last change, not the last visit)", async () => {
    const u = user();
    renderApp("/portal/daftar");
    await heading("Sebelum Mulai Pendaftaran");
    expect(window.localStorage.length).toBe(0);
    await next(u);
    await heading("Identitas Pribadi");
    expect(localCopy()?.stepIndex).toBe(1);
  });

  test("the time of the copy moves with each change", async () => {
    openAt("identity");
    await heading("Identitas Pribadi");
    const first = localCopy()?.savedAt ?? 0;
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
    setText("Nama Panggilan", "Sari");
    await waitFor(() => expect(localCopy()?.savedAt ?? 0).toBeGreaterThan(first));
    expect(localCopy()?.values.identity?.nickname).toBe("Sari");
  });

  test("a copy somebody edited in the browser cannot break the screen", async () => {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), stepIndex: 1, visited: ["intro", "identity"], values: { identity: { fullName: { x: 1 }, nickname: 5, gender: ["a"], extra: "x" }, household: { livingWith: "Ayah" } } }));
    renderApp("/portal/daftar");
    await heading("Identitas Pribadi");
    expect((screen.getByRole("textbox", { name: "Nama Lengkap" }) as HTMLInputElement).value).toBe("Sari Dewi");
    expect((screen.getByRole("textbox", { name: "Nama Panggilan" }) as HTMLInputElement).value).toBe("5");
  });
});
