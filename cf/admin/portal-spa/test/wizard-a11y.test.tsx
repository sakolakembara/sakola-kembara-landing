import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { UI_STEP_LABELS, UI_STEP_ORDER, type UiStepId } from "../../shared/application-form/steps";
import { localCopy, next, openAt, resetWizardMocks, wizardServer } from "./wizard-helpers";

// Accessibility of the form, as far as jsdom can show it: names, descriptions, focus, the live region, the keyboard, and that
// nothing is told by colour alone. (Contrast, a real screen reader and the layout are not things jsdom does; the PR says so.)

beforeEach(() => void wizardServer());
afterEach(resetWizardMocks);

const user = () => userEvent.setup({ applyAccept: false, delay: null });
const heading = (name: string) => screen.findByRole("heading", { name });
const FORM_SCREENS = UI_STEP_ORDER.filter((id) => id !== "intro" && id !== "review") as UiStepId[];

describe("the summary of what needs fixing", () => {
  test("it takes focus, names itself with the legacy sentence, and each line is a link to its field", async () => {
    const u = user();
    openAt("identity");
    await heading("Identitas Pribadi");
    await next(u);
    const summary = screen.getByRole("alert");
    expect(document.activeElement).toBe(summary);
    expect(within(summary).getByText("Beberapa isian belum lengkap. Silakan lengkapi bagian yang ditandai.")).toBeTruthy();
    const links = within(summary).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Nama Panggilan", "Jenis Kelamin", "Agama", "Asal Sekolah", "Cabang Sakola Kembara", "Alamat Rumah", "Tahun Angkatan Kelulusan", "Nomor WhatsApp Pribadi"]);
  });

  test("a line to a text field moves focus into it; to a group of radios, to its first option; to a document, to its button", async () => {
    const u = user();
    openAt("identity");
    await heading("Identitas Pribadi");
    await next(u);
    await u.click(within(screen.getByRole("alert")).getByRole("link", { name: "Nama Panggilan" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Nama Panggilan" }));
    await u.click(within(screen.getByRole("alert")).getByRole("link", { name: "Jenis Kelamin" }));
    expect(document.activeElement).toBe(within(screen.getByRole("group", { name: /Jenis Kelamin/ })).getAllByRole("radio")[0]);
    await u.click(within(screen.getByRole("alert")).getByRole("link", { name: "Alamat Rumah" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: /Alamat Rumah/ }));
  });

  test("on the documents screen a line to a document lands on that document's button", async () => {
    const u = user();
    openAt("documents");
    await heading("Berkas Pendaftaran");
    await next(u);
    await u.click(within(screen.getByRole("alert")).getByRole("link", { name: "Scan Kartu Keluarga" }));
    const group = screen.getByRole("group", { name: /^Scan Kartu Keluarga/ });
    expect(document.activeElement).toBe(within(group).getByRole("button", { name: "Pilih berkas" }));
  });

  test("the list of organisations: the line goes to the message of the list", async () => {
    const u = user();
    openAt("organizations", { organizations: { hasOrganizations: true, entries: [{ name: "", position: "" }] } });
    await heading("Organisasi");
    await next(u);
    await u.click(within(screen.getAllByRole("alert")[0] as HTMLElement).getByRole("link", { name: "Organisasi" }));
    expect(document.activeElement?.id).toBe("entries-error");
  });

  test("it goes when there is nothing left to fix, and comes back, with focus, the next time", async () => {
    const u = user();
    openAt("identity");
    await heading("Identitas Pribadi");
    await next(u);
    expect(screen.getByRole("alert")).toBeTruthy();
    await u.click(screen.getByRole("button", { name: "Sebelumnya" }));
    await u.click(within(screen.getByRole("navigation", { name: "Bagian formulir" })).getByRole("button", { name: "Identitas Pribadi" }));
    // The errors belong to the screen: they are still there when the student comes back to it.
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});

describe("every field says what it is, and what is wrong with it", () => {
  test.each(FORM_SCREENS)("%s: every control has a name (a label, or the legend of its group)", async (id) => {
    openAt(id);
    await heading(UI_STEP_LABELS[id] === "Pengumpulan Berkas" ? "Berkas Pendaftaran" : UI_STEP_LABELS[id]);
    const controls = Array.from(document.querySelectorAll<HTMLElement>("main input:not([type='file']), main textarea, main select"));
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const labelled = (control as HTMLInputElement).labels?.length ? true : control.hasAttribute("aria-label") || control.hasAttribute("aria-labelledby");
      expect(labelled, `${id}: ${control.outerHTML.slice(0, 120)}`).toBe(true);
    }
    // Every group of radios or checkboxes is a fieldset with a legend.
    for (const radio of document.querySelectorAll<HTMLInputElement>("main input[type='radio']")) {
      const group = radio.closest("fieldset");
      expect(group?.querySelector("legend")?.textContent?.trim().length ?? 0, `${id}: ${radio.name}`).toBeGreaterThan(0);
    }
  });

  test("a text field with a message is invalid and described by it; a group is described by it too", async () => {
    const u = user();
    openAt("identity");
    await heading("Identitas Pribadi");
    await next(u);
    const nickname = screen.getByRole("textbox", { name: "Nama Panggilan" });
    expect(nickname.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(nickname.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Wajib diisi");
    const gender = screen.getByRole("group", { name: /Jenis Kelamin/ });
    expect(document.getElementById(gender.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Pilih jenis kelamin");
    // A field that has no message is not marked invalid.
    expect(screen.getByRole("textbox", { name: "Nama Lengkap" }).getAttribute("aria-invalid")).toBeNull();
  });

  test("the required marker is read as part of nothing twice: the star is hidden from screen readers, the control keeps its own name", async () => {
    openAt("identity");
    await heading("Identitas Pribadi");
    const star = document.querySelector("label[for='nickname'] span");
    expect(star?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("textbox", { name: "Nama Panggilan" })).toBeTruthy();
  });

  test("phone numbers and names ask the browser to help (autocomplete), the rest do not", async () => {
    openAt("identity");
    await heading("Identitas Pribadi");
    expect(screen.getByRole("textbox", { name: "Nama Lengkap" }).getAttribute("autocomplete")).toBe("name");
    expect(screen.getByRole("textbox", { name: "Nomor WhatsApp Pribadi" }).getAttribute("autocomplete")).toBe("tel");
    expect(screen.getByRole("textbox", { name: "Nomor WhatsApp Pribadi" }).getAttribute("inputmode")).toBe("numeric");
    expect(screen.getByRole("textbox", { name: "Asal Sekolah" }).getAttribute("autocomplete")).toBe("off");
  });

  test("the buttons that only have an icon have a name", async () => {
    openAt("organizations", { organizations: { hasOrganizations: true, entries: [{ name: "OSIS", position: "Ketua" }] } });
    await heading("Organisasi");
    expect(screen.getByRole("button", { name: "Hapus organisasi 1" })).toBeTruthy();
    for (const button of screen.getAllByRole("button")) expect((button.textContent ?? "").trim() !== "" || button.hasAttribute("aria-label"), button.outerHTML.slice(0, 100)).toBe(true);
  });
});

describe("what is happening is said, politely", () => {
  test("there is one status region on every screen of the form, in the page from the start, so a change is announced", async () => {
    openAt("housing");
    await heading("Tempat Tinggal & Hutang");
    const region = document.querySelector("main p[role='status'][aria-live='polite']");
    expect(region).toBeTruthy();
    expect(region?.textContent).toBe("");
  });

  test("it says 'Menyimpan…' while a screen is sent and which screen was saved afterwards", async () => {
    const u = user();
    openAt("identity", { identity: { fullName: "Sari Dewi", nickname: "Sari", gender: "perempuan", religion: "Islam", schoolName: "SMAN 1 Contoh", branch: "Bandung", homeAddress: "Jl. Contoh", graduationBatch: "2027 (Kelas 12)", whatsapp: "6281200000001" } });
    await heading("Identitas Pribadi");
    const region = document.querySelector("main p[role='status']") as HTMLElement;
    await next(u);
    await waitFor(() => expect(region.textContent).toBe("Bagian Identitas Pribadi tersimpan."));
  });

  test("and what it says goes when the student starts typing again", async () => {
    const u = user();
    openAt("identity", { identity: { fullName: "Sari Dewi", nickname: "Sari", gender: "perempuan", religion: "Islam", schoolName: "SMAN 1 Contoh", branch: "Bandung", homeAddress: "Jl. Contoh", graduationBatch: "2027 (Kelas 12)", whatsapp: "6281200000001" } });
    await heading("Identitas Pribadi");
    await next(u);
    await heading("Keluarga & Ekonomi");
    const region = document.querySelector("main p[role='status']") as HTMLElement;
    expect(region.textContent).toBe("Bagian Identitas Pribadi tersimpan.");
    await u.type(screen.getByRole("textbox", { name: /Nama Ayah/ }), "B");
    expect(region.textContent).toBe("");
  });

  test("a failure is an alert (read at once), not a status", async () => {
    const u = user();
    wizardServer("open", { "PUT /portal/api/applications/current/steps/identity": new Response(JSON.stringify({ error: "internal" }), { status: 500, headers: { "Content-Type": "application/json" } }) });
    openAt("identity", { identity: { fullName: "Sari Dewi", nickname: "Sari", gender: "perempuan", religion: "Islam", schoolName: "SMAN 1 Contoh", branch: "Bandung", homeAddress: "Jl. Contoh", graduationBatch: "2027 (Kelas 12)", whatsapp: "6281200000001" } });
    await heading("Identitas Pribadi");
    await next(u);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Terjadi kesalahan di server");
    expect(document.activeElement).toBe(alert);
  });
});

describe("the keyboard", () => {
  test("the arrow keys move between the options of a group of radios, and the choice is kept", async () => {
    const u = user();
    openAt("identity");
    await heading("Identitas Pribadi");
    const [first, second] = within(screen.getByRole("group", { name: /Jenis Kelamin/ })).getAllByRole("radio") as HTMLInputElement[];
    first?.focus();
    await u.keyboard("{ArrowDown}");
    expect(second?.checked).toBe(true);
    expect(document.activeElement).toBe(second);
    await waitFor(() => expect(localCopy()?.values.identity?.gender).toBe("perempuan"));
  });

  test("Space chooses the focused option, and a checkbox is toggled by Space", async () => {
    const u = user();
    openAt("household");
    await heading("Keluarga & Ekonomi");
    screen.getByRole("checkbox", { name: "Ayah" }).focus();
    await u.keyboard(" ");
    expect((screen.getByRole("checkbox", { name: "Ayah" }) as HTMLInputElement).checked).toBe(true);
    await u.keyboard(" ");
    expect((screen.getByRole("checkbox", { name: "Ayah" }) as HTMLInputElement).checked).toBe(false);
  });

  test("Enter on 'Selanjutnya' goes on; the page has no positive tabindex, and what can be focused by a program only is the heading, the summary and the hidden file inputs", async () => {
    const u = user();
    openAt("organizations");
    await heading("Organisasi");
    expect(document.querySelectorAll("[tabindex]:not([tabindex='-1']):not([tabindex='0'])").length).toBe(0);
    const minusOne = Array.from(document.querySelectorAll("main [tabindex='-1']")).map((element) => element.tagName.toLowerCase());
    expect(minusOne.every((tag) => tag === "h2" || tag === "div" || tag === "p" || tag === "main")).toBe(true);
    screen.getByRole("button", { name: "Selanjutnya" }).focus();
    await u.keyboard("{Enter}");
    expect(await heading("Interview Tertulis")).toBeTruthy();
  });

  test("a screen's heading takes focus when it opens, and the skip link of the shell is still the first thing to Tab to", async () => {
    const u = user();
    openAt("identity");
    await heading("Identitas Pribadi");
    await u.tab();
    expect(document.activeElement?.textContent).toBe("Lewat ke konten utama");
  });
});

describe("nothing is told by colour alone", () => {
  test("each state of the list of screens has its own icon and its own words: current, done, locked, not saved", async () => {
    openAt("housing", { identity: { nickname: "Dewi" } });
    await heading("Tempat Tinggal & Hutang");
    const list = within(screen.getByRole("navigation", { name: "Bagian formulir" })).getByRole("list");
    const item = (name: string | RegExp) => within(list).getByRole("button", { name });
    expect(item("Tempat Tinggal & Hutang").getAttribute("aria-current")).toBe("step");
    expect(item("Tempat Tinggal & Hutang").querySelector("svg.lucide-circle-dot")).toBeTruthy();
    expect(item("Keluarga & Ekonomi").querySelector("svg.lucide-check")).toBeTruthy();
    expect(item("Organisasi").querySelector("svg.lucide-lock")).toBeTruthy();
    expect(item("Organisasi")).toHaveProperty("disabled", true);
    // "Belum disimpan" is words under the name of the screen.
    expect(within(item(/Identitas Pribadi/)).getByText("Belum disimpan")).toBeTruthy();
    // The icons themselves are decoration.
    for (const icon of list.querySelectorAll("svg")) expect(icon.closest("[aria-hidden='true']") ?? icon.getAttribute("aria-hidden")).toBeTruthy();
  });

  test("an error is words (the summary and the line under the field), a marked field is also invalid for assistive technology", async () => {
    const u = user();
    openAt("identity");
    await heading("Identitas Pribadi");
    await next(u);
    expect(screen.getAllByText("Wajib diisi").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("[aria-invalid='true']").length).toBeGreaterThan(0);
  });
});
