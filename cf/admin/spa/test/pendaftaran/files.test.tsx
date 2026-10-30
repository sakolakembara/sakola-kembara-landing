import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import type { ApplicationFile, ApplicationWithFiles } from "~/pages/applications/model";
import { deferred, meBody, renderApp, respond, stubApi } from "../helpers";

// The files on the applicant's page (SAKEM-083, docs/cloudflare/portal-architecture.md, 8.8): the list by slot, who may
// open a file, the purge, and that nothing is loaded by itself (each open is a deliberate click and an audit row).
// Stubbed answers in the Worker's shape; test/private-files-admin.test.ts proves the Worker answers it.

const LIST = "/api/admin/applications";
type Who = Parameters<typeof meBody>;
const editorWho: Who = ["editor", ["pendaftaran"]];

const file = (id: string, slot: ApplicationFile["slot"], over: Partial<ApplicationFile> = {}): ApplicationFile => ({
  id,
  slot,
  contentType: "image/png",
  size: 1_000_000,
  width: 40,
  height: 30,
  uploadedAt: "2026-09-29T03:00:00.000Z",
  ...over,
});

const FILES: ApplicationFile[] = [
  file("11111111-0000-4000-8000-000000000001", "family-card", { contentType: "application/pdf", size: 812_345, width: null, height: null }),
  file("11111111-0000-4000-8000-000000000002", "family-card", { size: 2_000_000 }),
  file("11111111-0000-4000-8000-000000000003", "self-photo", { contentType: "image/jpeg", size: 450_000 }),
];

function detail(over: Partial<ApplicationWithFiles> = {}): ApplicationWithFiles {
  return {
    id: "a1",
    batch: { id: "b26", year: 2026, name: "Gen 7 — 2026/2027" },
    fullName: "Siti Contoh",
    email: "siti@contoh.test",
    whatsapp: "0812-3456-7890",
    schoolName: "SMAN 1 Contoh",
    graduationYear: "2026",
    branchPreference: "Bandung",
    motivation: null,
    economicBackground: null,
    formData: { formVersion: 3, documents: { dtksRegistered: false }, marketing: { instagramUsername: "siti" }, interview: { motivationSakem: "Ingin belajar", agreedToSignedStatement: true } },
    formVersion: 3,
    files: FILES,
    canOpenFiles: true,
    status: "pending",
    reviewNotes: null,
    reviewedAt: null,
    submittedAt: "2026-09-29T03:00:00.000Z",
    updatedAt: "2026-09-29T03:00:00.000Z",
    ...over,
  };
}

async function open(who: Who, application: ApplicationWithFiles, routes: Parameters<typeof stubApi>[0] = {}) {
  const api = stubApi({ "GET /api/me": respond(meBody(...who)), [`GET ${LIST}/${application.id}`]: respond({ item: application }), ...routes });
  const view = renderApp(`/applications/${application.id}`);
  await screen.findByRole("heading", { level: 1, name: application.fullName });
  return { api, ...view };
}

const section = (name: string) => screen.getByRole("region", { name });

describe("the list of files on the page", () => {
  test("a section 'Berkas' with a row per slot: how many files and how big, and a dash for a slot with none", async () => {
    await open(editorWho, detail());
    const berkas = section("Berkas");
    expect(within(berkas).getByText("Scan Kartu Keluarga")).toBeTruthy();
    expect(within(berkas).getByText("2 berkas · 2,8 MB")).toBeTruthy(); // the two family-card files
    expect(within(berkas).getByText("1 berkas · 450 kB")).toBeTruthy();
    expect(within(berkas).getByText("Surat Keterangan Penghasilan Ayah").parentElement!.textContent).toContain("—");
    expect(screen.queryByRole("heading", { level: 2, name: "Tautan berkas" })).toBeNull();
    // The SKTM slot is asked of a DTKS family only.
    expect(within(berkas).queryByText(/SKTM/)).toBeNull();
  });

  test("each file says its type and size, and, for an image, its pixels", async () => {
    await open(editorWho, detail());
    const berkas = section("Berkas");
    expect(within(berkas).getByText("PDF · 812,3 kB")).toBeTruthy();
    expect(within(berkas).getByText("PNG · 2 MB · 40×30")).toBeTruthy();
    expect(within(berkas).getByText("JPEG · 450 kB · 40×30")).toBeTruthy();
  });

  test("who may open them gets a link per file, in a new tab, with no opener: an image 'Lihat', a PDF 'Unduh'", async () => {
    await open(editorWho, detail());
    const berkas = section("Berkas");
    const links = within(berkas).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Unduh berkas 1", "Lihat berkas 2", "Lihat berkas 1"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(FILES.map((entry) => `${LIST}/a1/files/${entry.id}`));
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  test("a viewer sees the same list and is told who can open the files: no link, no purge", async () => {
    await open(["viewer", []], detail({ canOpenFiles: false }));
    const berkas = section("Berkas");
    expect(within(berkas).getByText("2 berkas · 2,8 MB")).toBeTruthy();
    expect(within(berkas).queryAllByRole("link")).toEqual([]);
    expect(within(berkas).getAllByText("Berkas hanya bisa dibuka oleh tim Pendaftaran.").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Hapus Semua Berkas" })).toBeNull();
    expect(screen.queryByRole("link", { name: /berkas \d/ })).toBeNull();
  });

  test("nothing is loaded by itself: the page asks for the application and the session, never for a file", async () => {
    const { api } = await open(editorWho, detail());
    expect(api.calls.map((call) => `${call.method} ${call.path}`).sort()).toEqual(["GET /api/me", "GET /api/dashboard", `GET ${LIST}/a1`].sort());
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("iframe, embed, object")).toBeNull();
  });

  test("a version 2 application keeps its links and has nothing to purge", async () => {
    await open(editorWho, detail({ formVersion: 2, files: [], formData: { formVersion: 2, documents: { familyCardUrl: "https://drive.contoh.test/kk", dtksRegistered: false } } }));
    expect(screen.getByRole("heading", { level: 2, name: "Tautan berkas" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /drive\.contoh\.test\/kk/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hapus Semua Berkas" })).toBeNull();
  });

  test("a version 3 application with no files has nothing to purge either", async () => {
    await open(editorWho, detail({ files: [] }));
    expect(screen.queryByRole("button", { name: "Hapus Semua Berkas" })).toBeNull();
    expect(within(section("Berkas")).queryAllByRole("link")).toEqual([]);
  });
});

describe("the purge", () => {
  test("a card for who may open files: how many, how big, that nothing is deleted by itself, and the one red button", async () => {
    await open(editorWho, detail());
    expect(screen.getByRole("heading", { level: 2, name: "Berkas Pendaftar" })).toBeTruthy();
    expect(screen.getByText("3 berkas · 3,3 MB tersimpan di penyimpanan pribadi. Berkas tidak dihapus otomatis.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hapus Semua Berkas" })).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  test("it asks first, naming the applicant and the count; 'Batal' sends nothing", async () => {
    const user = userEvent.setup();
    const { api } = await open(editorWho, detail());
    await user.click(screen.getByRole("button", { name: "Hapus Semua Berkas" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Hapus semua berkas pendaftar ini?" });
    expect(within(dialog).getByText(/3 berkas milik Siti Contoh akan dihapus permanen dan tidak bisa dikembalikan/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    expect(api.count(`POST ${LIST}/a1/files/purge`)).toBe(0);
  });

  test("confirming sends the confirmation once however often it is pressed, then loads the page again and says it is done", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    let loads = 0;
    const { api } = await open(editorWho, detail(), {
      [`GET ${LIST}/a1`]: () => Promise.resolve(respond({ item: ++loads === 1 ? detail() : detail({ files: [] }) })),
      [`POST ${LIST}/a1/files/purge`]: () => gate.promise,
    });
    await user.click(screen.getByRole("button", { name: "Hapus Semua Berkas" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Hapus Semua Berkas" });
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(api.count(`POST ${LIST}/a1/files/purge`)).toBe(1);
    expect(api.last(`POST ${LIST}/a1/files/purge`)!.body).toEqual({ confirm: true });
    expect(within(dialog).getByRole("button", { name: "Menghapus..." })).toHaveProperty("disabled", true);

    await act(async () => gate.resolve(respond({ purged: 3, pending: 0 })));
    expect((await screen.findByRole("status", { name: "" })).textContent).toContain("Semua berkas pendaftar sudah dihapus.");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Hapus Semua Berkas" })).toBeNull());
    expect(within(section("Berkas")).queryAllByRole("link")).toEqual([]);
    expect(loads).toBe(2);
  });

  test("when some files could not be removed from storage yet it says so, and that the system will try again", async () => {
    const user = userEvent.setup();
    await open(editorWho, detail(), { [`POST ${LIST}/a1/files/purge`]: respond({ purged: 3, pending: 2 }) });
    await user.click(screen.getByRole("button", { name: "Hapus Semua Berkas" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Hapus Semua Berkas" }));
    expect((await screen.findByRole("alert")).textContent).toContain("sebagian belum terhapus dari penyimpanan");
  });

  test("a refusal stays in the dialog as a sentence, and the button can be pressed again", async () => {
    const user = userEvent.setup();
    let calls = 0;
    const { api } = await open(editorWho, detail(), {
      [`POST ${LIST}/a1/files/purge`]: () => Promise.resolve(++calls === 1 ? respond({ error: "internal" }, 500) : respond({ purged: 3, pending: 0 })),
    });
    await user.click(screen.getByRole("button", { name: "Hapus Semua Berkas" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Hapus Semua Berkas" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Terjadi kesalahan di server");
    await user.click(within(dialog).getByRole("button", { name: "Hapus Semua Berkas" }));
    await waitFor(() => expect(api.count(`POST ${LIST}/a1/files/purge`)).toBe(2));
  });

  test("a role that lost the grant meanwhile (403) is told so, and nothing else changes", async () => {
    const user = userEvent.setup();
    await open(editorWho, detail(), { [`POST ${LIST}/a1/files/purge`]: respond({ error: "forbidden" }, 403) });
    await user.click(screen.getByRole("button", { name: "Hapus Semua Berkas" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Hapus Semua Berkas" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Kamu tidak punya izin");
  });
});

describe("the review keeps the files", () => {
  test("the Worker's answer to a review has no files and no flags: the page keeps what it had, links and purge card included", async () => {
    const user = userEvent.setup();
    const { files: _files, formVersion: _version, canOpenFiles: _can, ...answer } = detail({ status: "accepted", reviewNotes: "Berkas lengkap.", reviewedAt: "2026-10-12T03:00:00.000Z", updatedAt: "2026-10-12T03:00:00.000Z" });
    await open(editorWho, detail(), { [`POST ${LIST}/a1/status`]: respond({ item: answer }) });
    const form = screen.getByRole("form", { name: "Ubah status pendaftar" });
    await user.selectOptions(within(form).getByLabelText("Status baru"), "accepted");
    await user.type(within(form).getByLabelText(/Catatan Review/), "Berkas lengkap.");
    await user.click(within(form).getByRole("button", { name: "Simpan Perubahan" }));
    expect((await screen.findByRole("status", { name: "" })).textContent).toContain("Status pendaftar berhasil diubah.");
    expect(within(section("Berkas")).getAllByRole("link")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Hapus Semua Berkas" })).toBeTruthy();
  });
});
