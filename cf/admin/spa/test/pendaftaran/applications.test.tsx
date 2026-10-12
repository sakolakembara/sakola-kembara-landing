import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { ALL_BATCHES, type ApplicationDetail, type ApplicationListed, needsDefaultBatch, newestBatch, REVOCATION_NOTES_MIN } from "~/pages/applications/model";
import { deferred, meBody, renderApp, respond, stubApi } from "../helpers";

// The Pendaftar screens (SAKEM-082): the list (which opens on the newest batch), the page of one applicant, and the
// review, against stubbed answers in the Worker's shape (test/pendaftaran-spa-contract.test.ts proves the Worker
// answers that shape). The rules of what the detail shows are in answers.test.ts; the review's rules are the
// Worker's (test/applications.test.ts), this file proves the form shows them and sends what the Worker takes.

const LIST = "/api/admin/applications";
const BATCHES = "/api/admin/batches";
type Who = Parameters<typeof meBody>;
const editorWho: Who = ["editor", ["pendaftaran"]];
const location = () => screen.getByTestId("location").textContent;

const batch = (id: string, year: number, name: string) => ({
  id, year, name, description: null, opensAt: "2026-08-01T00:00:00.000Z", closesAt: "2026-09-30T00:00:00.000Z", resultsPublishedAt: null,
  createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", phase: "open", pending: 0, underReview: 0,
});
const BATCH_LIST = [batch("b26", 2026, "Gen 7 — 2026/2027"), batch("b25", 2025, "Gen 6 — 2025/2026")];
const envelope = (items: unknown[], extra: { total?: number; page?: number } = {}) => ({ items, page: extra.page ?? 1, pageSize: 20, total: extra.total ?? items.length });

function row(over: Partial<ApplicationListed> = {}): ApplicationListed {
  return {
    id: "a1",
    fullName: "Siti Contoh",
    email: "siti@contoh.test",
    schoolName: "SMAN 1 Contoh",
    graduationYear: "2026",
    branchPreference: "Bandung",
    status: "pending",
    submittedAt: "2026-09-29T03:00:00.000Z",
    updatedAt: "2026-09-29T03:00:00.000Z",
    batch: { id: "b26", year: 2026, name: "Gen 7 — 2026/2027" },
    ...over,
  };
}

async function openList(who: Who, path = "/applications", routes: Parameters<typeof stubApi>[0] = {}) {
  const api = stubApi({
    "GET /api/me": respond(meBody(...who)),
    [`GET ${BATCHES}`]: respond(envelope(BATCH_LIST)),
    [`GET ${LIST}`]: respond(envelope([row(), row({ id: "a2", fullName: "Budi Contoh", email: "budi@contoh.test", status: "accepted", branchPreference: null })])),
    ...routes,
  });
  const view = renderApp(path);
  await screen.findByText("Siti Contoh");
  return { api, ...view };
}

const lastList = (api: ReturnType<typeof stubApi>) => api.last(`GET ${LIST}`)?.url;

describe("the list opens on the newest batch", () => {
  test("with nothing in the address it goes to the newest batch, replacing the address, and asks the Worker for that batch only", async () => {
    const { api } = await openList(["viewer", []]);
    await waitFor(() => expect(location()).toBe("/applications?batch=b26"));
    expect(lastList(api)).toBe(`${LIST}?page=1&pageSize=20&batch=b26&sort=-submittedAt`);
    // Never asked for every batch first: the redirect happens before the list is requested.
    expect(api.calls.filter((call) => call.path === LIST).every((call) => call.url.includes("batch=b26"))).toBe(true);
    expect(api.last(`GET ${BATCHES}`)?.url).toBe(`${BATCHES}?pageSize=100&sort=-year`);
    expect(screen.getByLabelText("Batch")).toHaveProperty("value", "b26");
    expect(screen.getByText(/Gen 7 — 2026\/2027/, { selector: "b" })).toBeTruthy();
  });

  test("a link that names a status and no batch (the dashboard's tiles count every batch) is left alone: every batch", async () => {
    const { api } = await openList(["viewer", []], "/applications?status=pending");
    expect(location()).toBe("/applications?status=pending");
    expect(lastList(api)).toBe(`${LIST}?page=1&pageSize=20&status=pending&sort=-submittedAt`);
    expect(screen.getByLabelText("Batch")).toHaveProperty("value", "");
    expect(screen.getByText(/Daftar pendaftar siswa Sakola Kembara\. 2 pendaftar \(filter aktif\)\./)).toBeTruthy();
  });

  test("a search with no batch is every batch as well, and `batch=all` is asked for as such", async () => {
    const first = await openList(["viewer", []], "/applications?q=siti");
    expect(lastList(first.api)).toBe(`${LIST}?page=1&pageSize=20&q=siti&sort=-submittedAt`);
    first.unmount();
    const second = await openList(["viewer", []], "/applications?batch=all");
    expect(lastList(second.api)).toBe(`${LIST}?page=1&pageSize=20&batch=all&sort=-submittedAt`);
    expect(screen.getByLabelText("Batch")).toHaveProperty("value", "");
  });

  test("a link to one batch and status, as the batch page's tiles make it, is followed as it is", async () => {
    const { api } = await openList(["viewer", []], "/applications?batch=b25&status=under_review");
    expect(lastList(api)).toBe(`${LIST}?page=1&pageSize=20&batch=b25&status=under_review&sort=-submittedAt`);
    expect(screen.getByLabelText("Batch")).toHaveProperty("value", "b25");
    expect(screen.getByLabelText("Status")).toHaveProperty("value", "under_review");
  });

  test("with no batch at all there is nothing to open on: the list asks for every applicant and says there are none", async () => {
    stubApi({ "GET /api/me": respond(meBody("viewer")), [`GET ${BATCHES}`]: respond(envelope([])), [`GET ${LIST}`]: respond(envelope([])) });
    renderApp("/applications");
    expect(await screen.findByText("Belum ada pendaftar.")).toBeTruthy();
    expect(location()).toBe("/applications");
  });

  test("the rule of the default, in one place", () => {
    expect(needsDefaultBatch(new URLSearchParams(""))).toBe(true);
    expect(needsDefaultBatch(new URLSearchParams("page=2"))).toBe(true);
    expect(needsDefaultBatch(new URLSearchParams("sort=fullName"))).toBe(true);
    for (const query of ["batch=all", "batch=b1", "status=pending", "q=siti", "batch="]) expect(needsDefaultBatch(new URLSearchParams(query)), query).toBe(false);
    expect(newestBatch([{ id: "n" }, { id: "o" }])).toEqual({ id: "n" });
    expect(newestBatch([])).toBeNull();
    expect(ALL_BATCHES).toBe("all");
  });

  test("when the batches cannot be loaded the page says so and 'Coba lagi' asks again", async () => {
    const user = userEvent.setup();
    let calls = 0;
    stubApi({
      "GET /api/me": respond(meBody("viewer")),
      [`GET ${BATCHES}`]: () => Promise.resolve(++calls === 1 ? respond({ error: "internal" }, 500) : respond(envelope(BATCH_LIST))),
      [`GET ${LIST}`]: respond(envelope([row()])),
    });
    renderApp("/applications");
    expect((await screen.findByRole("alert")).textContent).toBe("Terjadi kesalahan di server. Coba lagi sebentar lagi.");
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    await screen.findByText("Siti Contoh");
  });
});

describe("the list: who sees it, and what it shows", () => {
  test("an editor of other areas opens the 403 page, and nothing is asked for", async () => {
    const api = stubApi({ "GET /api/me": respond(meBody("editor", ["konten"])), [`GET ${LIST}`]: respond(envelope([row()])), [`GET ${BATCHES}`]: respond(envelope(BATCH_LIST)) });
    renderApp("/applications");
    expect(await screen.findByRole("heading", { level: 1, name: "Akses ditolak" })).toBeTruthy();
    expect(api.count(`GET ${LIST}`)).toBe(0);
    expect(api.count(`GET ${BATCHES}`)).toBe(0);
  });

  test("the legacy columns, the status as a tag, and a dash for no branch; a viewer and an editor see the same list", async () => {
    for (const who of [["viewer", []], editorWho] as Who[]) {
      const view = await openList(who);
      const grid = screen.getByRole("table", { name: /Daftar pendaftar/ });
      expect(within(grid).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Nama", "Batch", "Asal Sekolah", "Cabang", "Status", "Dikirim", "Aksi"]);
      expect(within(grid).getAllByText("2026 · Gen 7 — 2026/2027")).toHaveLength(2);
      expect(within(grid).getByText("Pending")).toBeTruthy();
      expect(within(grid).getByText("Diterima")).toBeTruthy();
      expect(within(grid).getByText("siti@contoh.test")).toBeTruthy();
      expect(within(grid).getByText("—")).toBeTruthy();
      // Nothing to change from the list: it only opens the applicant.
      expect(screen.queryByRole("button", { name: /^Hapus (Siti|Budi)/ })).toBeNull();
      expect(screen.queryByRole("link", { name: /Baru|Tambah/ })).toBeNull();
      view.unmount();
    }
  });

  test("a row opens the applicant, remembering the list it came from", async () => {
    const user = userEvent.setup();
    await openList(["viewer", []], "/applications?batch=b26&status=pending", {
      "GET /api/admin/applications/a1": respond({ item: detail() }),
    });
    expect(screen.getByRole("link", { name: "Siti Contoh" }).getAttribute("href")).toBe("/applications/a1");
    await user.click(screen.getByRole("link", { name: "Lihat Siti Contoh" }));
    await waitFor(() => expect(location()).toBe("/applications/a1"));
    // "Kembali ke daftar" goes back to the list as it was: the batch and the status.
    expect((await screen.findByRole("link", { name: "Kembali ke daftar" })).getAttribute("href")).toBe("/applications?batch=b26&status=pending");
  });

  test("the empty list says 'Belum ada pendaftar untuk filter ini.'", async () => {
    stubApi({ "GET /api/me": respond(meBody("viewer")), [`GET ${BATCHES}`]: respond(envelope(BATCH_LIST)), [`GET ${LIST}`]: respond(envelope([])) });
    renderApp("/applications?batch=b26");
    expect(await screen.findByText("Belum ada pendaftar untuk filter ini.")).toBeTruthy();
  });

  test("a list that fails to load says so, with 'Coba lagi'", async () => {
    const user = userEvent.setup();
    let calls = 0;
    stubApi({
      "GET /api/me": respond(meBody("viewer")),
      [`GET ${BATCHES}`]: respond(envelope(BATCH_LIST)),
      [`GET ${LIST}`]: () => Promise.resolve(++calls === 1 ? respond({ error: "internal" }, 500) : respond(envelope([row()]))),
    });
    renderApp("/applications?batch=b26");
    expect((await screen.findByRole("alert")).textContent).toBe("Terjadi kesalahan di server. Coba lagi sebentar lagi.");
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    await screen.findByText("Siti Contoh");
  });
});

describe("the list: the filter bar writes the address, and the search says what it is", () => {
  test("batch, status and search apply together and go back to page 1", async () => {
    const user = userEvent.setup();
    const { api } = await openList(["viewer", []], "/applications?batch=b26&page=2");
    await user.selectOptions(screen.getByLabelText("Batch"), "b25");
    await user.selectOptions(screen.getByLabelText("Status"), "under_review");
    await user.type(screen.getByLabelText("Cari"), "siti");
    await user.click(screen.getByRole("button", { name: "Terapkan" }));
    await waitFor(() => expect(location()).toBe("/applications?q=siti&batch=b25&status=under_review"));
    await waitFor(() => expect(lastList(api)).toBe(`${LIST}?page=1&pageSize=20&q=siti&batch=b25&status=under_review&sort=-submittedAt`));
  });

  test("'Semua batch' is the address `batch=all`, not 'no batch' (which would open the newest again)", async () => {
    const user = userEvent.setup();
    const { api } = await openList(["viewer", []], "/applications?batch=b26");
    await user.selectOptions(screen.getByLabelText("Batch"), "");
    await user.click(screen.getByRole("button", { name: "Terapkan" }));
    await waitFor(() => expect(location()).toBe("/applications?batch=all"));
    await waitFor(() => expect(lastList(api)).toBe(`${LIST}?page=1&pageSize=20&batch=all&sort=-submittedAt`));
    expect(screen.getByLabelText("Batch")).toHaveProperty("value", "");
    expect(screen.getByText(/Daftar pendaftar siswa Sakola Kembara\. 2 pendaftar\./)).toBeTruthy();
  });

  test("'Hapus filter' goes back to where the page opens: the newest batch", async () => {
    const user = userEvent.setup();
    await openList(["viewer", []], "/applications?batch=b25&status=pending&q=budi");
    await user.click(screen.getByRole("button", { name: "Hapus filter" }));
    await waitFor(() => expect(location()).toBe("/applications?batch=b26"));
  });

  // Negative test (scripts/negative-checks-spa-pendaftaran.mjs): a search box that promises "contains" lies about the Worker.
  test("the search box says it looks at the start of a name or an email, and holds at most 48 characters (what the Worker keeps)", async () => {
    await openList(["viewer", []]);
    const box = screen.getByLabelText("Cari");
    expect(box.getAttribute("placeholder")).toBe("Awal nama atau email");
    expect(box.getAttribute("maxlength")).toBe("48");
  });

  test("the pages keep the batch and the filters in their links", async () => {
    const user = userEvent.setup();
    const { api } = await openList(["viewer", []], "/applications?batch=b26&status=pending", { [`GET ${LIST}`]: respond(envelope([row()], { total: 45 })) });
    expect(screen.getByText("Menampilkan 1 sampai 20 dari 45")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Berikutnya" }).getAttribute("href")).toBe("/applications?batch=b26&status=pending&page=2");
    await user.click(screen.getByRole("link", { name: "Berikutnya" }));
    await waitFor(() => expect(lastList(api)).toContain("page=2"));
    expect(lastList(api)).toContain("batch=b26");
    expect(lastList(api)).toContain("status=pending");
  });
});

// ------------------------------------------------------------------------------- one applicant

function detail(over: Partial<ApplicationDetail> = {}): ApplicationDetail {
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
    formData: {
      formVersion: 2,
      identity: { nickname: "Siti", gender: "perempuan", religion: "Islam", homeAddress: "Jl. Contoh 1" },
      documents: { familyCardUrl: "https://drive.contoh.test/kk", selfPhotoUrl: "javascript:alert(document.cookie)", dtksRegistered: false },
      marketing: { instagramUsername: "@siti.contoh", instagramFollowProofUrl: "https://drive.contoh.test/f", broadcastProofUrl: "", twibbonUploadUrl: "", storyUploadUrl: "" },
      interview: { motivationSakem: "Ingin belajar", agreedToSignedStatement: true },
    },
    status: "pending",
    reviewNotes: null,
    reviewedAt: null,
    submittedAt: "2026-09-29T03:00:00.000Z",
    updatedAt: "2026-09-29T03:00:00.000Z",
    ...over,
  };
}

async function openDetail(who: Who, application: ApplicationDetail, routes: Parameters<typeof stubApi>[0] = {}, path = `/applications/${application.id}`) {
  const api = stubApi({ "GET /api/me": respond(meBody(...who)), [`GET ${LIST}/${application.id}`]: respond({ item: application }), ...routes });
  const view = renderApp(path);
  await screen.findByRole("heading", { level: 1, name: application.fullName });
  return { api, ...view };
}

describe("the page of one applicant", () => {
  test("the header: the name, the status, the email, the batch it belongs to and the way back", async () => {
    await openDetail(["viewer", []], detail({ status: "under_review" }));
    expect(screen.getByText("Detail pendaftar")).toBeTruthy();
    expect(screen.getByText("Dalam Review")).toBeTruthy();
    expect(screen.getAllByText("siti@contoh.test").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "2026 · Gen 7 — 2026/2027" }).getAttribute("href")).toBe("/batches/b26");
    expect(screen.getByRole("link", { name: "Kembali ke daftar" }).getAttribute("href")).toBe("/applications");
    await waitFor(() => expect(document.title).toBe("Siti Contoh | Admin Sakola Kembara"));
  });

  test("the sections, each a heading, with the answers; what the applicant pasted is a link only when it is a web address", async () => {
    await openDetail(["viewer", []], detail());
    for (const name of ["Identitas", "Pendidikan", "Berkas yang diunggah", "Bukti Marketing", "Interview Tertulis", "Pengajuan"]) {
      expect(screen.getByRole("heading", { level: 2, name }), name).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: /0812-3456-7890/ }).getAttribute("href")).toBe("https://wa.me/081234567890");
    expect(screen.getByRole("link", { name: /drive\.contoh\.test\/kk/ }).getAttribute("href")).toBe("https://drive.contoh.test/kk");
    expect(screen.getByRole("link", { name: /drive\.contoh\.test\/kk/ }).getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("link", { name: /drive\.contoh\.test\/kk/ }).getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("link", { name: "@siti.contoh" }).getAttribute("href")).toBe("https://instagram.com/siti.contoh");
    // The `javascript:` one is shown as text and is not a link at all.
    expect(screen.getByText("javascript:alert(document.cookie)").closest("a")).toBeNull();
    expect(screen.getByText("Ingin belajar")).toBeTruthy();
    for (const link of screen.getAllByRole("link")) expect(link.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
  });

  test("an old application with no answers shows its legacy story", async () => {
    await openDetail(["viewer", []], detail({ formData: null, motivation: "Ingin kuliah", economicBackground: "Orang tua petani" }));
    expect(screen.getByRole("heading", { level: 2, name: "Cerita (Legacy)" })).toBeTruthy();
    expect(screen.getByText("Orang tua petani")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2, name: "Interview Tertulis" })).toBeNull();
  });

  test("an applicant that is gone: the sentence and a way back; a failure to load: 'Coba lagi'", async () => {
    const user = userEvent.setup();
    stubApi({ "GET /api/me": respond(meBody(...editorWho)), [`GET ${LIST}/gone`]: respond({ error: "not_found", message: "Data tidak ditemukan. Mungkin sudah dihapus." }, 404) });
    const view = renderApp("/applications/gone");
    expect((await screen.findByRole("alert")).textContent).toBe("Data tidak ditemukan. Mungkin sudah dihapus.");
    expect(screen.getByRole("link", { name: "Kembali ke daftar" }).getAttribute("href")).toBe("/applications");
    view.unmount();

    let calls = 0;
    stubApi({ "GET /api/me": respond(meBody(...editorWho)), [`GET ${LIST}/a1`]: () => Promise.resolve(++calls === 1 ? respond({ error: "internal" }, 500) : respond({ item: detail() })) });
    renderApp("/applications/a1");
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    await screen.findByRole("heading", { level: 1, name: "Siti Contoh" });
  });

  // Negative test (scripts/negative-checks-spa-pendaftaran.mjs): show the review form to a role that cannot write.
  test("a viewer reads everything and is offered no way to change the status", async () => {
    await openDetail(["viewer", []], detail());
    const aside = screen.getByRole("complementary", { name: "Ubah Status" });
    expect(within(aside).queryByRole("button")).toBeNull();
    expect(within(aside).queryByRole("combobox")).toBeNull();
    expect(within(aside).getByRole("status").textContent).toContain("Kamu hanya bisa melihat data ini");
    expect(screen.queryByRole("form", { name: "Ubah status pendaftar" })).toBeNull();
  });
});

describe("the review: what the form shows before the Worker is asked", () => {
  test("the legacy form: the status as it is, the options, the note, 'Simpan Perubahan', and what the change is recorded as", async () => {
    await openDetail(editorWho, detail({ status: "under_review", reviewNotes: "Menunggu wawancara." }));
    const form = screen.getByRole("form", { name: "Ubah status pendaftar" });
    expect(within(form).getByLabelText("Status baru")).toHaveProperty("value", "under_review");
    expect(within(form).getAllByRole("option").map((option) => option.textContent)).toEqual(["Pending", "Dalam Review", "Diterima", "Ditolak"]);
    expect(within(form).getByLabelText(/Catatan Review/)).toHaveProperty("value", "Menunggu wawancara.");
    expect(within(form).getByRole("button", { name: "Simpan Perubahan" })).toBeTruthy();
    expect(within(form).getByText(/Perubahan status dicatat di Aktivitas/)).toBeTruthy();
    // No promise that the note is in an audit log: it is not.
    expect(form.textContent).not.toMatch(/audit_log|audit log/i);
    expect(within(form).queryByText("application.revoke")).toBeNull();
  });

  test("picking 'Ditolak' for someone who was accepted is a revocation: the warning, the reason's label and count, a red button", async () => {
    const user = userEvent.setup();
    await openDetail(editorWho, detail({ status: "accepted", reviewNotes: "Diterima." }));
    const form = screen.getByRole("form", { name: "Ubah status pendaftar" });
    expect(within(form).queryByText("Kamu akan mencabut penerimaan siswa ini.")).toBeNull();
    await user.selectOptions(within(form).getByLabelText("Status baru"), "rejected");

    expect(within(form).getByText("Kamu akan mencabut penerimaan siswa ini.")).toBeTruthy();
    expect(within(form).getByText(new RegExp(`minimal ${REVOCATION_NOTES_MIN} karakter`))).toBeTruthy();
    expect(within(form).getByLabelText(/Alasan pencabutan/)).toBeTruthy();
    expect(within(form).queryByLabelText(/Catatan Review/)).toBeNull();
    expect(within(form).getByText("9 / 20 karakter minimum")).toBeTruthy(); // "Diterima." is 9 characters
    expect(within(form).getByRole("button", { name: "Cabut Penerimaan" })).toBeTruthy();
    expect(within(form).queryByRole("button", { name: "Simpan Perubahan" })).toBeNull();
    expect(within(form).getByText("application.revoke")).toBeTruthy();

    await user.clear(within(form).getByLabelText(/Alasan pencabutan/));
    await user.type(within(form).getByLabelText(/Alasan pencabutan/), "Siswa mengundurkan diri.");
    expect(within(form).getByText(`${"Siswa mengundurkan diri.".length} / 20 karakter minimum`)).toBeTruthy();

    // Back to a status that is not a revocation: the ordinary form again.
    await user.selectOptions(within(form).getByLabelText("Status baru"), "pending");
    expect(within(form).queryByText("Kamu akan mencabut penerimaan siswa ini.")).toBeNull();
    expect(within(form).getByRole("button", { name: "Simpan Perubahan" })).toBeTruthy();
  });

  test("rejecting someone who was only pending is an ordinary decision, not a revocation", async () => {
    const user = userEvent.setup();
    await openDetail(editorWho, detail({ status: "pending" }));
    const form = screen.getByRole("form", { name: "Ubah status pendaftar" });
    await user.selectOptions(within(form).getByLabelText("Status baru"), "rejected");
    expect(within(form).queryByText("Kamu akan mencabut penerimaan siswa ini.")).toBeNull();
    expect(within(form).getByRole("button", { name: "Simpan Perubahan" })).toBeTruthy();
    expect(within(form).getByPlaceholderText("Wajib diisi saat menerima atau menolak. Catatan ini disimpan di data pendaftar.")).toBeTruthy();
  });
});

describe("the review: saving", () => {
  test("sends the status and the note with the version loaded, once however often it is pressed; then the page shows it with a notice", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const saved = detail({ status: "accepted", reviewNotes: "Berkas lengkap.", reviewedAt: "2026-10-12T03:00:00.000Z", updatedAt: "2026-10-12T03:00:00.000Z" });
    const { api } = await openDetail(editorWho, detail(), { [`POST ${LIST}/a1/status`]: () => gate.promise });
    const form = screen.getByRole("form", { name: "Ubah status pendaftar" });
    await user.selectOptions(within(form).getByLabelText("Status baru"), "accepted");
    await user.type(within(form).getByLabelText(/Catatan Review/), "Berkas lengkap.");
    const button = within(form).getByRole("button", { name: "Simpan Perubahan" });
    await act(async () => {
      button.click();
      button.click();
    });
    expect(api.count(`POST ${LIST}/a1/status`)).toBe(1);
    const post = api.last(`POST ${LIST}/a1/status`)!;
    expect(post.body).toEqual({ status: "accepted", reviewNotes: "Berkas lengkap." });
    expect(post.headers["if-match"]).toBe('"2026-09-29T03:00:00.000Z"');
    expect(within(form).getByRole("button", { name: "Menyimpan..." })).toHaveProperty("disabled", true);

    await act(async () => gate.resolve(respond({ item: saved })));
    expect((await screen.findByRole("status", { name: "" })).textContent).toContain("Status pendaftar berhasil diubah.");
    expect(screen.getByText("Diterima", { selector: "span" })).toBeTruthy(); // the tag at the top
    expect(within(screen.getByRole("region", { name: "Pengajuan" })).getByText("Berkas lengkap.")).toBeTruthy();
    // The form starts again from what was saved: the next save carries the NEW version.
    expect(within(screen.getByRole("form", { name: "Ubah status pendaftar" })).getByLabelText("Status baru")).toHaveProperty("value", "accepted");
  });

  test("a refusal about the note lands under the note, the cursor goes there, and nothing else says it again", async () => {
    const user = userEvent.setup();
    const message = "Catatan review wajib diisi saat menerima atau menolak.";
    await openDetail(editorWho, detail(), { [`POST ${LIST}/a1/status`]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { reviewNotes: message } }, 400) });
    const form = screen.getByRole("form", { name: "Ubah status pendaftar" });
    await user.selectOptions(within(form).getByLabelText("Status baru"), "accepted");
    await user.click(within(form).getByRole("button", { name: "Simpan Perubahan" }));
    expect(await within(form).findByText(message)).toBeTruthy();
    const notes = within(form).getByLabelText(/Catatan Review/);
    expect(notes.getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(notes));
    expect(within(form).queryByText("Periksa kembali isian formulir.")).toBeNull();
  });

  test("a revocation with a short reason shows the Worker's sentence under the reason", async () => {
    const user = userEvent.setup();
    const message = "Alasan pencabutan wajib diisi minimal 20 karakter — jelaskan mengapa penerimaan ini dibatalkan.";
    await openDetail(editorWho, detail({ status: "accepted" }), { [`POST ${LIST}/a1/status`]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { reviewNotes: message } }, 400) });
    const form = screen.getByRole("form", { name: "Ubah status pendaftar" });
    await user.selectOptions(within(form).getByLabelText("Status baru"), "rejected");
    await user.type(within(form).getByLabelText(/Alasan pencabutan/), "Mundur.");
    await user.click(within(form).getByRole("button", { name: "Cabut Penerimaan" }));
    expect(await within(form).findByText(message)).toBeTruthy();
  });

  test("somebody decided first (409 stale): the warning, nothing thrown away yet, and 'Muat ulang' shows the newer decision", async () => {
    const user = userEvent.setup();
    let served = detail();
    const { api } = await openDetail(editorWho, detail(), {
      [`GET ${LIST}/a1`]: () => Promise.resolve(respond({ item: served })),
      [`POST ${LIST}/a1/status`]: respond({ error: "stale", message: "Data ini sudah diubah orang lain sejak kamu membukanya." }, 409),
    });
    const form = screen.getByRole("form", { name: "Ubah status pendaftar" });
    await user.selectOptions(within(form).getByLabelText("Status baru"), "accepted");
    await user.type(within(form).getByLabelText(/Catatan Review/), "Versi saya.");
    await user.click(within(form).getByRole("button", { name: "Simpan Perubahan" }));
    expect((await within(form).findByText(/Data ini sudah diubah orang lain/)).textContent).toContain("Perubahan yang belum disimpan akan hilang");
    expect(within(form).getByLabelText(/Catatan Review/)).toHaveProperty("value", "Versi saya.");

    served = detail({ status: "rejected", reviewNotes: "Dari orang lain.", reviewedAt: "2026-10-12T03:00:00.000Z", updatedAt: "2026-10-12T03:00:00.000Z" });
    await user.click(within(form).getByRole("button", { name: "Muat ulang" }));
    await waitFor(() => expect(within(screen.getByRole("form", { name: "Ubah status pendaftar" })).getByLabelText("Status baru")).toHaveProperty("value", "rejected"));
    expect(within(screen.getByRole("form", { name: "Ubah status pendaftar" })).getByLabelText(/Catatan Review/)).toHaveProperty("value", "Dari orang lain.");
    expect(api.count(`GET ${LIST}/a1`)).toBe(2);
  });

  test("any other failure is a sentence at the top of the form, and the form can be sent again", async () => {
    const user = userEvent.setup();
    await openDetail(editorWho, detail(), { [`POST ${LIST}/a1/status`]: respond({ error: "internal" }, 500) });
    const form = screen.getByRole("form", { name: "Ubah status pendaftar" });
    await user.click(within(form).getByRole("button", { name: "Simpan Perubahan" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("Terjadi kesalahan di server. Coba lagi sebentar lagi.");
    expect(within(form).getByRole("button", { name: "Simpan Perubahan" })).toHaveProperty("disabled", false);
  });

  test("a role that lost the grant meanwhile (403) is told so in a sentence", async () => {
    const user = userEvent.setup();
    await openDetail(editorWho, detail(), { [`POST ${LIST}/a1/status`]: respond({ error: "forbidden" }, 403) });
    const form = screen.getByRole("form", { name: "Ubah status pendaftar" });
    await user.click(within(form).getByRole("button", { name: "Simpan Perubahan" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("Kamu tidak punya izin untuk melakukan ini.");
  });
});
