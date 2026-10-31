import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { DRAFT_FILES_PATH, DRAFT_PURGE_MIN_DAYS, type DraftFilesRow, draftPurgePath, shortDraftId } from "~/pages/applications/model";
import { deferred, meBody, renderApp, respond, stubApi } from "../helpers";

// "Draf dengan berkas" (SAKEM-093): the tab of Pendaftar that lists the drafts that were never submitted and still hold
// files, and purges them. Against stubbed answers in the Worker's shape (test/private-files-drafts-spa-contract.test.ts
// proves the Worker answers that shape). The rules are the Worker's (test/private-files-drafts.test.ts): 30 days without a
// change, `pendaftaran` write, a confirmation in the request. This file proves the screen shows no one's data, offers the
// button only where it can work, asks first, and sends what the Worker takes.

const BATCHES = "/api/admin/batches";
const APPLICATIONS = "/api/admin/applications";
type Who = Parameters<typeof meBody>;
const editorWho: Who = ["editor", ["pendaftaran"]];
const location = () => screen.getByTestId("location").textContent;

const DAY = 86_400_000;
const ID_OLD = "5f1d2c3b-0000-4000-8000-0000000000a1";
const ID_NEW = "9a8b7c6d-0000-4000-8000-0000000000b2";

const draft = (id: string, over: Partial<DraftFilesRow> = {}): DraftFilesRow => ({
  id,
  batch: { id: "b26", year: 2026, name: "Gen 7 — 2026/2027" },
  files: 3,
  bytes: 2_400_000,
  updatedAt: new Date(Date.UTC(2026, 7, 1, 3, 0, 0)).toISOString(),
  purgeable: true,
  purgeableAt: new Date(Date.UTC(2026, 7, 31, 3, 0, 0)).toISOString(),
  ...over,
});

const OLD = draft(ID_OLD);
const NEW = draft(ID_NEW, { files: 1, bytes: 800_000, updatedAt: new Date(Date.UTC(2026, 9, 12, 3, 0, 0)).toISOString(), purgeable: false, purgeableAt: new Date(Date.UTC(2026, 10, 11, 12, 0, 0)).toISOString() });

const envelope = (items: unknown[], extra: { total?: number } = {}) => ({ items, page: 1, pageSize: 20, total: extra.total ?? items.length });

async function openDrafts(who: Who, items: DraftFilesRow[] = [OLD, NEW], routes: Parameters<typeof stubApi>[0] = {}) {
  const api = stubApi({
    "GET /api/me": respond(meBody(...who)),
    [`GET ${DRAFT_FILES_PATH}`]: respond(envelope(items)),
    ...routes,
  });
  const view = renderApp("/applications/drafts");
  await screen.findByRole("heading", { level: 1, name: "Draf dengan berkas" });
  // The rows arrive after the page: wait for the first of them (a test of the empty or the failed list passes none).
  if (items.length > 0) await screen.findByText(shortDraftId(items[0]!.id));
  return { api, ...view };
}

describe("the tabs", () => {
  test("a writer of Pendaftaran sees two tabs on the list of applicants, the first current; a link to the drafts goes to /applications/drafts", async () => {
    const user = userEvent.setup();
    stubApi({
      "GET /api/me": respond(meBody(...editorWho)),
      [`GET ${BATCHES}`]: respond(envelope([{ id: "b26", year: 2026, name: "Gen 7", description: null, opensAt: "2026-08-01T00:00:00.000Z", closesAt: "2026-09-30T00:00:00.000Z", resultsPublishedAt: null, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", phase: "open", pending: 0, underReview: 0 }])),
      [`GET ${APPLICATIONS}`]: respond(envelope([])),
      [`GET ${DRAFT_FILES_PATH}`]: respond(envelope([OLD])),
    });
    renderApp("/applications?batch=b26");
    // The tabs are there from the first frame, in the loading page too, which is then replaced by the page itself:
    // the search box sits in a switched-off fieldset until the batches are known.
    await waitFor(() => expect(screen.getByLabelText("Cari").closest("fieldset")).toBeNull());
    const tabs = await screen.findByRole("navigation", { name: "Bagian Pendaftar" });
    const [first, second] = within(tabs).getAllByRole("link");
    expect([first!.textContent, first!.getAttribute("aria-current")]).toEqual(["Pendaftar", "page"]);
    expect([second!.textContent, second!.getAttribute("aria-current")]).toEqual(["Draf dengan berkas", null]);
    await user.click(second!);
    expect(await screen.findByRole("heading", { level: 1, name: "Draf dengan berkas" })).toBeTruthy();
    expect(location()).toBe("/applications/drafts");
    // Here the second tab is the current one, and the first goes back to the list.
    const here = screen.getByRole("navigation", { name: "Bagian Pendaftar" });
    expect(within(here).getByRole("link", { name: "Draf dengan berkas" }).getAttribute("aria-current")).toBe("page");
    expect(within(here).getByRole("link", { name: "Pendaftar" }).getAttribute("href")).toBe("/applications");
  });

  test("a viewer has no tabs on the list: the page is the one it always was", async () => {
    stubApi({
      "GET /api/me": respond(meBody("viewer", [])),
      [`GET ${BATCHES}`]: respond(envelope([{ id: "b26", year: 2026, name: "Gen 7", description: null, opensAt: "2026-08-01T00:00:00.000Z", closesAt: "2026-09-30T00:00:00.000Z", resultsPublishedAt: null, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", phase: "open", pending: 0, underReview: 0 }])),
      [`GET ${APPLICATIONS}`]: respond(envelope([])),
    });
    renderApp("/applications?batch=b26");
    await screen.findByRole("heading", { level: 1, name: "Pendaftar" });
    await screen.findByText("Belum ada pendaftar untuk filter ini.");
    expect(screen.queryByRole("navigation", { name: "Bagian Pendaftar" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Draf dengan berkas" })).toBeNull();
  });
});

describe("who may open the page", () => {
  test("a viewer is told the page is not theirs (403 page) and the Worker is never asked for the list", async () => {
    const api = stubApi({ "GET /api/me": respond(meBody("viewer", [])), [`GET ${DRAFT_FILES_PATH}`]: respond(envelope([OLD])) });
    renderApp("/applications/drafts");
    expect(await screen.findByRole("heading", { level: 1, name: "Akses ditolak" })).toBeTruthy();
    expect(api.count(`GET ${DRAFT_FILES_PATH}`)).toBe(0);
    expect(screen.queryByRole("button", { name: /Hapus Berkas/ })).toBeNull();
  });

  test("an editor of other areas gets the same, and the same silence", async () => {
    const api = stubApi({ "GET /api/me": respond(meBody("editor", ["konten"])) });
    renderApp("/applications/drafts");
    expect(await screen.findByRole("heading", { level: 1, name: "Akses ditolak" })).toBeTruthy();
    expect(api.calls.map((call) => call.path)).not.toContain(DRAFT_FILES_PATH);
  });
});

describe("the list", () => {
  test("it says what it is, what it does not show, and the rule", async () => {
    await openDrafts(editorWho);
    expect(screen.getByText("Siswa yang sudah mengunggah berkas tetapi belum mengirim pendaftaran. Nama dan isian mereka tidak ditampilkan.")).toBeTruthy();
    expect(screen.getByText(`Berkas draf baru bisa dihapus setelah ${DRAFT_PURGE_MIN_DAYS} hari tanpa perubahan. Berkas tidak dihapus otomatis.`)).toBeTruthy();
    expect(DRAFT_PURGE_MIN_DAYS).toBe(30);
  });

  test("a row is an opaque short id, the batch, how many files and how big, and when it last changed; nothing else", async () => {
    await openDrafts(editorWho);
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const first = within(rows[0]!);
    expect(first.getByText(shortDraftId(ID_OLD))).toBeTruthy();
    expect(shortDraftId(ID_OLD)).toBe("5f1d2c3b");
    expect(first.getByText("2026 · Gen 7 — 2026/2027")).toBeTruthy();
    expect(first.getByText("3 berkas · 2,4 MB")).toBeTruthy();
    expect(first.getByText(/2026/, { selector: "td:nth-child(4)" })).toBeTruthy();
    // No name, address, answer, slot or file name anywhere on the page, and not the draft's whole id.
    // (The page's main area: the shell around it names the signed-in admin.)
    const text = document.getElementById("main")?.textContent ?? "";
    expect(text).toContain("Draf dengan berkas");
    expect(text).not.toContain(ID_OLD);
    expect(text).not.toMatch(/@|Kartu Keluarga|family-card|\.png|\.pdf/);
    expect(document.querySelector("img, iframe, a[href*='/files/']")).toBeNull();
  });

  test("the button is offered only for a draft that may be purged; any other says from when it may", async () => {
    await openDrafts(editorWho);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByRole("button", { name: `Hapus berkas draf ${shortDraftId(ID_OLD)}` })).toBeTruthy();
    expect(within(rows[1]!).queryByRole("button")).toBeNull();
    expect(within(rows[1]!).getByText(/Bisa dihapus mulai 11 Nov 2026/)).toBeTruthy();
  });

  test("it asks the Worker for a page of twenty and nothing else: no search, no filter, no sort, and never for a file", async () => {
    const { api } = await openDrafts(editorWho);
    expect(api.last(`GET ${DRAFT_FILES_PATH}`)!.url).toBe(`${DRAFT_FILES_PATH}?page=1&pageSize=20`);
    expect(api.calls.map((call) => `${call.method} ${call.path}`).sort()).toEqual(["GET /api/me", "GET /api/dashboard", `GET ${DRAFT_FILES_PATH}`].sort());
  });

  test("with no draft it says so; a failure to load says so and can be tried again", async () => {
    const user = userEvent.setup();
    let calls = 0;
    await openDrafts(editorWho, [], { [`GET ${DRAFT_FILES_PATH}`]: () => Promise.resolve(++calls === 1 ? respond({ error: "internal" }, 500) : respond(envelope([]))) });
    expect((await screen.findByRole("alert")).textContent).toContain("Terjadi kesalahan di server");
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("Tidak ada draf dengan berkas.")).toBeTruthy();
  });
});

describe("the purge", () => {
  const PURGE = draftPurgePath(ID_OLD);

  test("it asks first, naming the count and the short id and saying that the answers stay; 'Batal' sends nothing", async () => {
    const user = userEvent.setup();
    const { api } = await openDrafts(editorWho);
    await user.click(screen.getByRole("button", { name: `Hapus berkas draf ${shortDraftId(ID_OLD)}` }));
    const dialog = await screen.findByRole("alertdialog", { name: "Hapus berkas draf ini?" });
    expect(within(dialog).getByText(`3 berkas dari draf 5f1d2c3b akan dihapus permanen dan tidak bisa dikembalikan. Isian siswa tidak ikut dihapus. Penghapusan tercatat di Aktivitas, tanpa nama atau isi berkas.`)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    expect(api.count(`POST ${PURGE}`)).toBe(0);
  });

  test("confirming sends the confirmation once however often it is pressed, loads the list again and says it is done", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    let loads = 0;
    const { api } = await openDrafts(editorWho, [OLD, NEW], {
      [`GET ${DRAFT_FILES_PATH}`]: () => Promise.resolve(respond(envelope(++loads === 1 ? [OLD, NEW] : [NEW]))),
      [`POST ${PURGE}`]: () => gate.promise,
    });
    await user.click(screen.getByRole("button", { name: `Hapus berkas draf ${shortDraftId(ID_OLD)}` }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Hapus Berkas" });
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(api.count(`POST ${PURGE}`)).toBe(1);
    expect(api.last(`POST ${PURGE}`)!.body).toEqual({ confirm: true });
    expect(within(dialog).getByRole("button", { name: "Menghapus..." })).toHaveProperty("disabled", true);

    await act(async () => gate.resolve(respond({ purged: 3, pending: 0 })));
    expect((await screen.findByRole("status", { name: "" })).textContent).toContain("Berkas draf sudah dihapus.");
    await waitFor(() => expect(screen.queryByRole("button", { name: `Hapus berkas draf ${shortDraftId(ID_OLD)}` })).toBeNull());
    expect(screen.queryByRole("alertdialog", { name: "Hapus berkas draf ini?" })).toBeNull();
    expect(loads).toBe(2);
  });

  test("when some files could not be removed from storage yet it says so, and that the system will try again", async () => {
    const user = userEvent.setup();
    await openDrafts(editorWho, [OLD], { [`POST ${PURGE}`]: respond({ purged: 3, pending: 2 }) });
    await user.click(screen.getByRole("button", { name: `Hapus berkas draf ${shortDraftId(ID_OLD)}` }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Hapus Berkas" }));
    expect((await screen.findByRole("alert")).textContent).toContain("sebagian belum terhapus dari penyimpanan");
  });

  test("a draft the student changed meanwhile (409): the Worker's sentence stays in the dialog, and the list is loaded again so the row stops offering the button", async () => {
    const user = userEvent.setup();
    let loads = 0;
    const message = "Draf ini baru diubah. Berkasnya baru bisa dihapus setelah 30 hari tanpa perubahan.";
    const { api } = await openDrafts(editorWho, [OLD], {
      [`GET ${DRAFT_FILES_PATH}`]: () => Promise.resolve(respond(envelope(++loads === 1 ? [OLD] : [{ ...OLD, purgeable: false, purgeableAt: new Date(Date.now() + 5 * DAY).toISOString() }]))),
      [`POST ${PURGE}`]: respond({ error: "draft_active", message, minInactiveDays: 30, purgeableAt: new Date(Date.now() + 5 * DAY).toISOString() }, 409),
    });
    await user.click(screen.getByRole("button", { name: `Hapus berkas draf ${shortDraftId(ID_OLD)}` }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Hapus Berkas" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(message);
    await waitFor(() => expect(loads).toBe(2));
    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    expect(screen.queryByRole("button", { name: `Hapus berkas draf ${shortDraftId(ID_OLD)}` })).toBeNull();
    expect(api.count(`POST ${PURGE}`)).toBe(1);
  });

  test("a refusal that is not about the draft (500) stays in the dialog and the button can be pressed again; a lost grant (403) is told so", async () => {
    const user = userEvent.setup();
    let calls = 0;
    const { api } = await openDrafts(editorWho, [OLD], {
      [`POST ${PURGE}`]: () => Promise.resolve(++calls === 1 ? respond({ error: "internal" }, 500) : calls === 2 ? respond({ error: "forbidden" }, 403) : respond({ purged: 3, pending: 0 })),
    });
    await user.click(screen.getByRole("button", { name: `Hapus berkas draf ${shortDraftId(ID_OLD)}` }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Hapus Berkas" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Terjadi kesalahan di server");
    await user.click(within(dialog).getByRole("button", { name: "Hapus Berkas" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("Kamu tidak punya izin"));
    await user.click(within(dialog).getByRole("button", { name: "Hapus Berkas" }));
    await waitFor(() => expect(api.count(`POST ${PURGE}`)).toBe(3));
  });

  test("opening the dialog again forgets the last refusal", async () => {
    const user = userEvent.setup();
    await openDrafts(editorWho, [OLD], { [`POST ${PURGE}`]: respond({ error: "internal" }, 500) });
    const open = () => user.click(screen.getByRole("button", { name: `Hapus berkas draf ${shortDraftId(ID_OLD)}` }));
    await open();
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Hapus Berkas" }));
    await within(dialog).findByRole("alert");
    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    await open();
    expect(within(await screen.findByRole("alertdialog")).queryByRole("alert")).toBeNull();
  });
});
