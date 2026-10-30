import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { formatDateTime } from "~/lib/format";
import { areasOf, toCreateBody, toUpdateBody, toValues } from "~/pages/settings/model";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

// Pengaturan (docs/cloudflare/admin-sistem.md): the admins of the Sistem area, super_admin only. The list, the
// confirmations, the form to create and to edit, against stubbed answers in the Worker's shape.

const LIST = "/api/admin/users";
const SELF = "user-1"; // the id `meBody` gives the signed-in user

function admin(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    name: "Dewi Pengurus",
    email: "dewi@contoh.test",
    role: "editor",
    areas: ["komunikasi", "konten"],
    status: "active",
    emailVerified: true,
    deactivatedAt: null,
    lastSessionAt: "2026-10-12T02:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
    ...overrides,
  };
}

const envelope = (items: unknown[], extra: { page?: number; pageSize?: number; total?: number } = {}) => ({ items, users: items, page: extra.page ?? 1, pageSize: extra.pageSize ?? 50, total: extra.total ?? items.length });
const location = () => screen.getByTestId("location").textContent;

type Who = Parameters<typeof meBody>;

async function openList(routes: Parameters<typeof stubApi>[0] = {}, path = "/settings", who: Who = ["super_admin", []]) {
  const api = stubApi({ "GET /api/me": respond(meBody(...who)), [`GET ${LIST}`]: respond(envelope([admin()])), ...routes });
  const view = renderApp(path);
  await screen.findByRole("heading", { level: 1, name: "Pengaturan" });
  const table = await screen.findByRole("table", { name: /Daftar admin/ });
  await waitFor(() => expect(within(table).getAllByRole("row").length).toBeGreaterThan(1));
  return { api, ...view };
}

const grid = () => screen.getByRole("table", { name: /Daftar admin/ });

describe("only a super_admin opens it", () => {
  test.each([
    ["viewer", ["viewer", []]],
    ["editor with every area", ["editor", ["pendaftaran", "komunikasi", "konten"]]],
    ["editor with no area", ["editor", []]],
  ] as [string, Who][])("a %s gets the 403 page on the list, the new form and the edit form, and the Worker is not asked", async (_label, who) => {
    for (const path of ["/settings", "/settings/new", "/settings/u1/edit"]) {
      const api = stubApi({ "GET /api/me": respond(meBody(...who)), [`GET ${LIST}`]: respond(envelope([admin()])), [`GET ${LIST}/u1`]: respond({ item: admin() }) });
      const view = renderApp(path);
      expect(await screen.findByRole("heading", { level: 1, name: "Akses ditolak" }), path).toBeTruthy();
      expect(screen.queryByRole("table")).toBeNull();
      expect(api.calls.filter((call) => call.path.startsWith(LIST)), path).toEqual([]);
      view.unmount();
    }
  });
});

describe("the list", () => {
  test("the legacy columns, named for screen readers, and the first request", async () => {
    const { api } = await openList();
    expect(within(grid()).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Email", "Nama", "Peran", "Status", "Sesi Aktif", "Aksi"]);
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=50&sort=email`);
    expect(screen.getByText("Kelola admin yang dapat mengakses dashboard.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Tambah Admin/ }).getAttribute("href")).toBe("/settings/new");
  });

  test("a row: role, the areas of an editor, the status, the session; the signed-in admin is marked", async () => {
    await openList({
      [`GET ${LIST}`]: respond(
        envelope([
          admin(),
          admin({ id: SELF, email: "tester@contoh.test", name: "Tester", role: "super_admin", areas: [] }),
          admin({ id: "u3", email: "baru@contoh.test", name: "Guru Baru", role: "editor", areas: [], status: "invited", lastSessionAt: null }),
          admin({ id: "u4", email: "sari@contoh.test", name: "Sari", role: "viewer", areas: [], status: "deactivated", lastSessionAt: null }),
        ]),
      ),
    });
    const rows = within(grid()).getAllByRole("row").slice(1);
    const text = (index: number) => rows[index]!.textContent ?? "";
    expect(text(0)).toContain("dewi@contoh.test");
    expect(text(0)).toContain("Editor");
    expect(text(0)).toContain("Area: Komunikasi, Konten Situs");
    expect(text(0)).toContain("Aktif");
    expect(text(0)).toContain(`Sejak ${formatDateTime("2026-10-12T02:00:00.000Z")}`);
    expect(text(0)).not.toContain("Anda");
    expect(text(1)).toContain("Super Admin");
    expect(text(1)).toContain("Anda");
    expect(text(2)).toContain("Belum punya area");
    expect(text(2)).toContain("Diundang");
    expect(text(2)).toContain("Tidak ada");
    expect(text(3)).toContain("Viewer");
    expect(text(3)).toContain("Nonaktif");
  });

  test("the actions of a row follow its state: edit for all, resend only for an invitation, deactivate or reactivate, never deactivate yourself", async () => {
    await openList({
      [`GET ${LIST}`]: respond(
        envelope([
          admin(),
          admin({ id: SELF, email: "tester@contoh.test", role: "super_admin", areas: [] }),
          admin({ id: "u3", email: "baru@contoh.test", status: "invited" }),
          admin({ id: "u4", email: "sari@contoh.test", status: "deactivated" }),
        ]),
      ),
    });
    expect(screen.getByRole("link", { name: "Edit dewi@contoh.test" }).getAttribute("href")).toBe("/settings/u1/edit");
    expect(screen.getAllByRole("link", { name: /^Edit / })).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: /^Kirim ulang undangan/ }).map((button) => button.getAttribute("aria-label"))).toEqual(["Kirim ulang undangan baru@contoh.test"]);
    expect(screen.getAllByRole("button", { name: /^Aktifkan kembali/ }).map((button) => button.getAttribute("aria-label"))).toEqual(["Aktifkan kembali sari@contoh.test"]);
    expect(screen.getAllByRole("button", { name: /^Nonaktifkan / }).map((button) => button.getAttribute("aria-label"))).toEqual(["Nonaktifkan dewi@contoh.test", "Nonaktifkan baru@contoh.test"]);
    // Your own row: said before the question, as the Worker would say it after.
    expect(screen.queryByRole("button", { name: "Nonaktifkan tester@contoh.test" })).toBeNull();
    expect(within(grid()).getAllByTitle("Tidak dapat menonaktifkan akun sendiri")).toHaveLength(1);
    // Nothing deletes an admin any more.
    expect(screen.queryByRole("button", { name: /^Hapus/ })).toBeNull();
  });

  test("the filter bar: an email prefix, a role and a status, with the names the Worker expects, kept in the address bar", async () => {
    const user = userEvent.setup();
    const { api } = await openList();
    await user.type(screen.getByLabelText("Cari"), "rom");
    await user.selectOptions(screen.getByLabelText("Peran"), "editor");
    await user.selectOptions(screen.getByLabelText("Status"), "invited");
    await waitFor(() => expect(location()).toBe("/settings?q=rom&role=editor&status=invited"));
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=50&q=rom&role=editor&status=invited&sort=email`));
    expect([...(screen.getByLabelText("Peran") as HTMLSelectElement).options].map((option) => option.textContent)).toEqual(["Semua peran", "Super Admin", "Editor", "Viewer"]);
    expect([...(screen.getByLabelText("Status") as HTMLSelectElement).options].map((option) => option.textContent)).toEqual(["Semua status", "Aktif", "Diundang", "Nonaktif"]);
  });

  test("empty with no filter, and with one", async () => {
    stubApi({ "GET /api/me": respond(meBody("super_admin")), [`GET ${LIST}`]: respond(envelope([])) });
    const view = renderApp("/settings");
    expect(await screen.findByText("Belum ada admin terdaftar.")).toBeTruthy();
    view.unmount();
    stubApi({ "GET /api/me": respond(meBody("super_admin")), [`GET ${LIST}`]: respond(envelope([])) });
    renderApp("/settings?q=zzz");
    expect(await screen.findByText("Tidak ada admin yang cocok dengan filter.")).toBeTruthy();
  });

  test("a list that fails to load says so, with 'Coba lagi'", async () => {
    const user = userEvent.setup();
    let fail = true;
    const api = stubApi({ "GET /api/me": respond(meBody("super_admin")), [`GET ${LIST}`]: () => Promise.resolve(fail ? respond({ error: "internal" }, 500) : respond(envelope([admin()]))) });
    renderApp("/settings");
    expect((await screen.findByRole("alert")).textContent).toBe("Terjadi kesalahan di server. Coba lagi sebentar lagi.");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    await screen.findByText("dewi@contoh.test");
    expect(api.count(`GET ${LIST}`)).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────── deactivate and reactivate

describe("deactivate", () => {
  async function ask(user: ReturnType<typeof userEvent.setup>, routes: Parameters<typeof stubApi>[0] = {}) {
    const view = await openList(routes);
    await user.click(screen.getByRole("button", { name: "Nonaktifkan dewi@contoh.test" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Nonaktifkan admin?" });
    return { ...view, dialog };
  }

  test("a question that names the admin and says what happens, with the safe button focused; asking changes nothing", async () => {
    const user = userEvent.setup();
    const { dialog, api } = await ask(user);
    expect(dialog.textContent).toContain("Admin “dewi@contoh.test” tidak bisa masuk lagi dan semua sesinya langsung berakhir.");
    expect(dialog.textContent).toContain("Akunnya tidak dihapus");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Batal" }));
    expect(api.calls.filter((call) => call.method === "POST")).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.calls.filter((call) => call.method === "POST")).toEqual([]);
  });

  // Negative check: the screen stops asking for the kit's red button (`destructive: true` of the deactivate action).
  test("the confirm button is the kit's red one (it takes a person's way in away), and 'Batal' stays neutral", async () => {
    const user = userEvent.setup();
    const { dialog } = await ask(user);
    const confirm = within(dialog).getByRole("button", { name: "Nonaktifkan" });
    expect(confirm.className).toContain("bg-destructive");
    expect(confirm.className).not.toContain("bg-primary-blue");
    expect(within(dialog).getByRole("button", { name: "Batal" }).className).not.toContain("bg-destructive");
  });

  test("confirming sends the POST once, however often it is pressed, then a notice and a fresh list", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const { dialog, api } = await ask(user, { [`POST ${LIST}/u1/deactivate`]: () => gate.promise });
    const confirm = within(dialog).getByRole("button", { name: "Nonaktifkan" });
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(api.count(`POST ${LIST}/u1/deactivate`)).toBe(1);
    expect(within(dialog).getByRole("button", { name: "Menonaktifkan..." })).toHaveProperty("disabled", true);
    await act(async () => gate.resolve(respond({ user: admin({ status: "deactivated" }) })));
    expect((await screen.findByRole("status")).textContent).toContain("Admin dewi@contoh.test dinonaktifkan.");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.count(`GET ${LIST}`)).toBe(2);
  });

  test("the last super_admin: the Worker's sentence in the dialog, only 'Tutup' left (asking again cannot work), the list unchanged", async () => {
    const user = userEvent.setup();
    const message = "Tidak dapat menonaktifkan super admin terakhir. Tambah super admin lain terlebih dahulu.";
    const { dialog, api } = await ask(user, { [`POST ${LIST}/u1/deactivate`]: respond({ error: "last_super_admin", message }, 409) });
    await user.click(within(dialog).getByRole("button", { name: "Nonaktifkan" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(message);
    expect(within(dialog).queryByRole("button", { name: "Nonaktifkan" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Tutup" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.count(`POST ${LIST}/u1/deactivate`)).toBe(1);
    expect(api.count(`GET ${LIST}`)).toBe(1);
    expect(screen.queryByRole("status")).toBeNull(); // no "dinonaktifkan" notice
  });

  test("the other final answers are shown the same way (yourself, not a pending invite)", async () => {
    for (const [code, message] of [["cannot_deactivate_self", "Tidak dapat menonaktifkan akun sendiri."], ["not_pending_invite", "Undangan hanya bisa dikirim ulang untuk admin yang belum menerimanya."]] as const) {
      const user = userEvent.setup();
      const { dialog, unmount } = await ask(user, { [`POST ${LIST}/u1/deactivate`]: respond({ error: code, message }, 409) });
      await user.click(within(dialog).getByRole("button", { name: "Nonaktifkan" }));
      expect((await within(dialog).findByRole("alert")).textContent).toBe(message);
      expect(within(dialog).queryByRole("button", { name: "Nonaktifkan" })).toBeNull();
      unmount();
    }
  });

  test("any other failure shows its sentence and lets it be tried again", async () => {
    const user = userEvent.setup();
    const { dialog } = await ask(user, { [`POST ${LIST}/u1/deactivate`]: respond({ error: "internal" }, 500) });
    await user.click(within(dialog).getByRole("button", { name: "Nonaktifkan" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Terjadi kesalahan di server. Coba lagi sebentar lagi.");
    expect(within(dialog).getByRole("button", { name: "Nonaktifkan" })).toHaveProperty("disabled", false);
  });

  test("an admin that is already gone (404) closes the dialog and loads the list again", async () => {
    const user = userEvent.setup();
    const { dialog, api } = await ask(user, { [`POST ${LIST}/u1/deactivate`]: respond({ error: "not_found" }, 404) });
    await user.click(within(dialog).getByRole("button", { name: "Nonaktifkan" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(api.count(`GET ${LIST}`)).toBe(2);
  });
});

describe("reactivate", () => {
  test("the question names the role they come back with; confirming sends the POST and says so", async () => {
    const user = userEvent.setup();
    const { api } = await openList({ [`GET ${LIST}`]: respond(envelope([admin({ status: "deactivated", role: "viewer", areas: [] })])), [`POST ${LIST}/u1/reactivate`]: respond({ user: admin() }) });
    await user.click(screen.getByRole("button", { name: "Aktifkan kembali dewi@contoh.test" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Aktifkan kembali admin?" });
    expect(dialog.textContent).toContain("bisa masuk lagi dengan peran Viewer");
    expect(dialog.textContent).toContain("Sesi yang lama tidak dipulihkan");
    // A way back, not a loss: the kit's primary button, not the red one.
    const confirm = within(dialog).getByRole("button", { name: "Aktifkan kembali" });
    expect(confirm.className).toContain("bg-primary-blue");
    expect(confirm.className).not.toContain("bg-destructive");
    await user.click(confirm);
    expect((await screen.findByRole("status")).textContent).toContain("Admin dewi@contoh.test diaktifkan kembali.");
    expect(api.count(`POST ${LIST}/u1/reactivate`)).toBe(1);
    expect(api.count(`GET ${LIST}`)).toBe(2);
  });
});

describe("resend an invitation", () => {
  const invited = admin({ id: "u3", email: "baru@contoh.test", status: "invited" });
  const open = (routes: Parameters<typeof stubApi>[0]) => openList({ [`GET ${LIST}`]: respond(envelope([invited])), ...routes });

  test("one press sends it, once however often it is pressed, and says so", async () => {
    const gate = deferred<Response>();
    const { api } = await open({ [`POST ${LIST}/u3/resend-invite`]: () => gate.promise });
    const button = screen.getByRole("button", { name: "Kirim ulang undangan baru@contoh.test" });
    await act(async () => {
      button.click();
      button.click();
    });
    expect(api.count(`POST ${LIST}/u3/resend-invite`)).toBe(1);
    expect(button.textContent).toBe("Mengirim...");
    await act(async () => gate.resolve(respond({ user: invited, email: { sent: true, kind: "invite" } })));
    expect((await screen.findByRole("status")).textContent).toContain("Undangan dikirim ulang ke baru@contoh.test.");
    expect(button.textContent).toBe("Kirim ulang undangan");
  });

  test("when the email does not go out, the Worker's words are shown as an error, never a success", async () => {
    const user = userEvent.setup();
    await open({ [`POST ${LIST}/u3/resend-invite`]: respond({ error: "email_failed", message: "Email belum terkirim. Akun sudah dibuat; kirim ulang undangannya nanti." }, 502) });
    await user.click(screen.getByRole("button", { name: "Kirim ulang undangan baru@contoh.test" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Email belum terkirim.");
    expect(screen.queryByText(/Undangan dikirim ulang/)).toBeNull();
  });

  test("an invitation accepted meanwhile (409): the sentence, and the list is loaded again to show the new state", async () => {
    const user = userEvent.setup();
    const { api } = await open({ [`POST ${LIST}/u3/resend-invite`]: respond({ error: "not_pending_invite", message: "Undangan hanya bisa dikirim ulang untuk admin yang belum menerimanya." }, 409) });
    await user.click(screen.getByRole("button", { name: "Kirim ulang undangan baru@contoh.test" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Undangan hanya bisa dikirim ulang");
    await waitFor(() => expect(api.count(`GET ${LIST}`)).toBe(2));
  });
});

// ─────────────────────────────────────────────────────────────────────────── the form

async function openForm(path: string, routes: Parameters<typeof stubApi>[0] = {}, who: Who = ["super_admin", []]) {
  const api = stubApi({ "GET /api/me": respond(meBody(...who)), ...routes });
  const view = renderApp(path);
  await screen.findByRole("form");
  return { api, ...view };
}

describe("the form: create", () => {
  test("the legacy form: identity, role as three cards with their hints; an editor starts with the areas", async () => {
    await openForm("/settings/new");
    expect(screen.getByRole("heading", { level: 1, name: "Admin Baru" })).toBeTruthy();
    for (const name of ["Identitas", "Peran", "Area"]) expect(screen.getByRole("heading", { level: 2, name })).toBeTruthy();
    expect(screen.getByLabelText(/Email/)).toBeTruthy();
    expect(screen.getByLabelText(/Nama/)).toBeTruthy();
    expect(screen.getByLabelText(/Password/)).toBeTruthy();
    expect(screen.getByText(/Kosongkan untuk mengundang lewat email/)).toBeTruthy();
    const roles = screen.getByRole("group", { name: /Peran/ });
    expect(within(roles).getAllByRole("radio").map((radio) => (radio as HTMLInputElement).value)).toEqual(["super_admin", "editor", "viewer"]);
    expect((within(roles).getByRole("radio", { name: /Editor/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Hanya bisa membaca semua area, kecuali Sistem. Tidak bisa mengubah apa pun.")).toBeTruthy();
    const areas = screen.getByRole("group", { name: /Area editor/ });
    expect(within(areas).getAllByRole("checkbox")).toHaveLength(3);
    expect(within(areas).getByText("Batch, Pendaftar, Pusat Dokumen")).toBeTruthy();
    expect(within(areas).getByText("Pesan, Pengumuman")).toBeTruthy();
    expect(within(areas).getByText("Blog, Laporan, Tim, Shortlink")).toBeTruthy();
    expect(screen.getByText(/Sistem tidak bisa diberikan/)).toBeTruthy();
    expect(screen.getByText("Belum ada area dipilih: editor hanya akan melihat Dashboard.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Buat Admin" })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe("Admin Baru | Admin Sakola Kembara"));
  });

  test("the areas appear for an editor only, and a viewer or a super_admin sends none", async () => {
    const user = userEvent.setup();
    await openForm("/settings/new");
    await user.click(screen.getByRole("radio", { name: /Viewer/ }));
    expect(screen.queryByRole("group", { name: /Area editor/ })).toBeNull();
    await user.click(screen.getByRole("radio", { name: /Editor/ }));
    expect(screen.getByRole("group", { name: /Area editor/ })).toBeTruthy();
    expect(areasOf({ ...toValues(null), role: "viewer", konten: true })).toEqual([]);
    expect(toCreateBody({ ...toValues(null), email: "a@b.test", role: "super_admin", konten: true })).toEqual({ email: "a@b.test", name: "", role: "super_admin" });
  });

  test("an invitation: no password in the body, the areas ticked, sent once, then the edit page with 'berhasil dibuat' and where the email went", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const created = admin({ id: "new-id", email: "guru@contoh.test", name: "Guru", areas: ["pendaftaran", "konten"], status: "invited" });
    const { api } = await openForm("/settings/new", { [`POST ${LIST}`]: () => gate.promise, [`GET ${LIST}/new-id`]: respond({ item: created }) });
    await user.type(screen.getByLabelText(/Email/), "  guru@contoh.test ");
    await user.type(screen.getByLabelText(/Nama/), "Guru");
    await user.click(screen.getByRole("checkbox", { name: /Pendaftaran/ }));
    await user.click(screen.getByRole("checkbox", { name: /Konten Situs/ }));
    const save = screen.getByRole("button", { name: "Buat Admin" });
    await act(async () => {
      save.click();
      save.click();
    });
    expect(api.count(`POST ${LIST}`)).toBe(1);
    expect(api.last(`POST ${LIST}`)?.body).toEqual({ email: "guru@contoh.test", name: "Guru", role: "editor", areas: ["pendaftaran", "konten"] });

    await act(async () => gate.resolve(respond({ item: created, user: created, email: { sent: true, kind: "invite" } }, 201)));
    await waitFor(() => expect(location()).toBe("/settings/new-id/edit"));
    expect((await screen.findByText(/Admin berhasil dibuat\./)).textContent).toContain("Admin berhasil dibuat. Undangan dikirim ke guru@contoh.test.");
    expect(screen.queryByRole("alertdialog")).toBeNull(); // the unsaved guard let the navigation pass
  });

  // SAKEM-089: with a password nothing is mailed and the admin can sign in at once, so the notice says that and not "email".
  test("with a password the body carries it, and the notice says the admin can sign in at once (no email went out)", async () => {
    const user = userEvent.setup();
    const created = admin({ id: "new-id", email: "guru@contoh.test", status: "active", emailVerified: true });
    const { api } = await openForm("/settings/new", { [`POST ${LIST}`]: respond({ item: created, user: created }, 201), [`GET ${LIST}/new-id`]: respond({ item: created }) });
    await user.type(screen.getByLabelText(/Email/), "guru@contoh.test");
    await user.click(screen.getByRole("radio", { name: /Viewer/ }));
    await user.type(screen.getByLabelText(/Password/), "kata sandi awal");
    await user.type(screen.getByLabelText(/^Ketik ulang email/), "guru@contoh.test");
    await user.click(screen.getByRole("button", { name: "Buat Admin" }));
    await waitFor(() => expect(location()).toBe("/settings/new-id/edit"));
    expect(api.last(`POST ${LIST}`)?.body).toEqual({ email: "guru@contoh.test", name: "", role: "viewer", password: "kata sandi awal" });
    const notice = (await screen.findByText(/Admin berhasil dibuat\./)).textContent;
    expect(notice).toContain("Admin berhasil dibuat. Admin bisa langsung masuk dengan password yang kamu isi.");
    expect(notice).not.toMatch(/verifikasi|dikirim/i);
  });

  test("the password field says what a password means: the admin signs in at once, with no email verification, so the address must be right", async () => {
    await openForm("/settings/new");
    const hint = screen.getByText(/^Opsional\. Kosongkan untuk mengundang lewat email/).textContent!;
    expect(hint).toContain("admin langsung bisa masuk dengan password itu tanpa verifikasi email");
    expect(hint).toContain("pastikan emailnya benar");
    expect(hint).not.toContain("tetap harus");
  });

  // Dzul's decision (2026-10-13): an admin made with a password is never verified by email, so a mistyped address would
  // hand the role to its owner: the address is typed twice.
  describe("the address typed twice (only with a password)", () => {
    test("the second field appears when a password is typed, and not for an invitation", async () => {
      const user = userEvent.setup();
      await openForm("/settings/new");
      expect(screen.queryByLabelText(/^Ketik ulang email/)).toBeNull();
      await user.type(screen.getByLabelText(/Password/), "kata sandi awal");
      expect(screen.getByLabelText(/^Ketik ulang email/)).toBeTruthy();
      await user.clear(screen.getByLabelText(/Password/));
      expect(screen.queryByLabelText(/^Ketik ulang email/)).toBeNull();
    });

    test("a difference is refused on the field, nothing is sent, and what was typed stays", async () => {
      const user = userEvent.setup();
      const { api } = await openForm("/settings/new");
      await user.type(screen.getByLabelText(/Email/), "guru@contoh.test");
      await user.type(screen.getByLabelText(/Password/), "kata sandi awal");
      await user.type(screen.getByLabelText(/^Ketik ulang email/), "guru@contoh.tset");
      await user.click(screen.getByRole("button", { name: "Buat Admin" }));
      expect(await screen.findByText("Email tidak sama. Ketik ulang alamat yang sama dengan di atas.")).toBeTruthy();
      expect(api.count(`POST ${LIST}`)).toBe(0);
      expect(screen.getByLabelText(/^Ketik ulang email/).getAttribute("aria-invalid")).toBe("true");
      expect((screen.getByLabelText(/Email/) as HTMLInputElement).value).toBe("guru@contoh.test");
    });

    test("case and spaces around the address are not a difference, and the confirmation is not sent", async () => {
      const user = userEvent.setup();
      const created = admin({ id: "new-id", email: "guru@contoh.test", status: "active", emailVerified: true });
      const { api } = await openForm("/settings/new", { [`POST ${LIST}`]: respond({ item: created, user: created }, 201), [`GET ${LIST}/new-id`]: respond({ item: created }) });
      await user.type(screen.getByLabelText(/Email/), "guru@contoh.test");
      await user.type(screen.getByLabelText(/Password/), "kata sandi awal");
      await user.type(screen.getByLabelText(/^Ketik ulang email/), " Guru@Contoh.Test ");
      await user.click(screen.getByRole("button", { name: "Buat Admin" }));
      await waitFor(() => expect(location()).toBe("/settings/new-id/edit"));
      const body = api.last(`POST ${LIST}`)?.body as Record<string, unknown>;
      expect(body).toMatchObject({ email: "guru@contoh.test", password: "kata sandi awal" });
      expect(body).not.toHaveProperty("emailConfirm");
    });

    test("an invitation (no password) needs no second address", async () => {
      const user = userEvent.setup();
      const created = admin({ id: "new-id", email: "guru@contoh.test", status: "invited" });
      const { api } = await openForm("/settings/new", { [`POST ${LIST}`]: respond({ item: created, user: created }, 201), [`GET ${LIST}/new-id`]: respond({ item: created }) });
      await user.type(screen.getByLabelText(/Email/), "guru@contoh.test");
      await user.click(screen.getByRole("button", { name: "Buat Admin" }));
      await waitFor(() => expect(location()).toBe("/settings/new-id/edit"));
      expect(api.count(`POST ${LIST}`)).toBe(1);
    });
  });

  test("a refused form: each field says it, the summary links to it, and nothing was navigated", async () => {
    const user = userEvent.setup();
    await openForm("/settings/new", {
      [`POST ${LIST}`]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { email: "Format email tidak valid", password: "Password minimal 8 karakter" } }, 400),
    });
    // (A value the browser itself would refuse never reaches the Worker, so the address here is well formed.)
    await user.type(screen.getByLabelText(/Email/), "x@y");
    await user.type(screen.getByLabelText(/Password/), "pendek");
    await user.type(screen.getByLabelText(/^Ketik ulang email/), "x@y");
    await user.click(screen.getByRole("button", { name: "Buat Admin" }));
    const summary = await screen.findByRole("alert");
    expect(within(summary).getByRole("link", { name: "Email: Format email tidak valid" })).toBeTruthy();
    expect(within(summary).getByRole("link", { name: "Password: Password minimal 8 karakter" })).toBeTruthy();
    expect(screen.getByLabelText(/Email/).getAttribute("aria-invalid")).toBe("true");
    expect(location()).toBe("/settings/new");
  });

  test("an address that already has an account (409): said on the email field", async () => {
    const user = userEvent.setup();
    await openForm("/settings/new", { [`POST ${LIST}`]: respond({ error: "email_taken", message: "Email ini sudah terdaftar.", fields: { email: "Email sudah digunakan" } }, 409) });
    await user.type(screen.getByLabelText(/Email/), "ada@contoh.test");
    await user.click(screen.getByRole("button", { name: "Buat Admin" }));
    expect((await screen.findByRole("link", { name: "Email: Email sudah digunakan" })).getAttribute("href")).toBe("#email");
    expect(screen.getByLabelText(/Email/).getAttribute("aria-invalid")).toBe("true");
  });

  test("the account is made but the email did not go out (502): back to the list with the Worker's words, where the invitation can be sent again", async () => {
    const user = userEvent.setup();
    await openForm("/settings/new", {
      [`POST ${LIST}`]: respond({ error: "email_failed", message: "Email belum terkirim. Akun sudah dibuat; kirim ulang undangannya nanti.", user: admin({ id: "n", status: "invited" }) }, 502),
      [`GET ${LIST}`]: respond(envelope([admin({ id: "n", email: "guru@contoh.test", status: "invited" })])),
    });
    await user.type(screen.getByLabelText(/Email/), "guru@contoh.test");
    await user.click(screen.getByRole("button", { name: "Buat Admin" }));
    await waitFor(() => expect(location()).toBe("/settings"));
    expect((await screen.findByRole("alert")).textContent).toContain("Email belum terkirim. Akun sudah dibuat");
    expect(await screen.findByRole("button", { name: "Kirim ulang undangan guru@contoh.test" })).toBeTruthy();
  });

  test("an email service that is down (503) stays on the form, with its sentence", async () => {
    const user = userEvent.setup();
    await openForm("/settings/new", { [`POST ${LIST}`]: respond({ error: "email_unavailable", message: "Layanan email sedang tidak tersedia. Silakan coba lagi nanti." }, 503) });
    await user.type(screen.getByLabelText(/Email/), "guru@contoh.test");
    await user.click(screen.getByRole("button", { name: "Buat Admin" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Layanan email sedang tidak tersedia. Silakan coba lagi nanti.");
    expect(location()).toBe("/settings/new");
  });
});

describe("the form: edit", () => {
  const loaded = admin({ id: "u1", email: "dewi@contoh.test", name: "Dewi Pengurus", role: "editor", areas: ["komunikasi"], updatedAt: "2026-10-10T00:00:00.000Z" });

  test("the admin is loaded into the fields: the email cannot be changed, there is no password, the areas are ticked, the status is shown", async () => {
    await openForm("/settings/u1/edit", { [`GET ${LIST}/u1`]: respond({ item: loaded }) });
    await waitFor(() => expect((screen.getByLabelText(/Nama/) as HTMLInputElement).value).toBe("Dewi Pengurus"));
    const email = screen.getByLabelText(/Email/) as HTMLInputElement;
    expect(email.value).toBe("dewi@contoh.test");
    expect(email.readOnly).toBe(true);
    expect(screen.getByText("Email tidak dapat diubah setelah admin dibuat.")).toBeTruthy();
    expect(screen.queryByLabelText(/Password/)).toBeNull();
    expect((screen.getByRole("radio", { name: /Editor/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Komunikasi/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Pendaftaran/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("heading", { level: 1, name: "Edit Admin" })).toBeTruthy();
    expect(screen.getByText("Aktif")).toBeTruthy(); // the status next to the title
  });

  test("saving sends the whole form with the version loaded; the form is clean after, and the next save sends the NEW version", async () => {
    const user = userEvent.setup();
    let version = "2026-10-11T00:00:00.000Z";
    const { api } = await openForm("/settings/u1/edit", {
      [`GET ${LIST}/u1`]: respond({ item: loaded }),
      [`PUT ${LIST}/u1`]: (call) => {
        const body = call.body as { name: string; role: string; areas: string[] };
        const saved = { ...loaded, ...body, updatedAt: version };
        version = "2026-10-12T00:00:00.000Z";
        return Promise.resolve(respond({ item: saved }));
      },
    });
    await waitFor(() => expect((screen.getByLabelText(/Nama/) as HTMLInputElement).value).toBe("Dewi Pengurus"));
    await user.click(screen.getByRole("checkbox", { name: /Konten Situs/ }));
    await user.click(screen.getByRole("checkbox", { name: /Komunikasi/ }));
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    expect((await screen.findByRole("status")).textContent).toContain("Perubahan berhasil disimpan.");
    const put = api.last(`PUT ${LIST}/u1`)!;
    expect(put.headers["if-match"]).toBe('"2026-10-10T00:00:00.000Z"');
    expect(put.body).toEqual({ name: "Dewi Pengurus", role: "editor", areas: ["konten"] });
    expect(location()).toBe("/settings/u1/edit"); // stays

    await user.click(screen.getByRole("checkbox", { name: /Pendaftaran/ }));
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(api.count(`PUT ${LIST}/u1`)).toBe(2));
    expect(api.last(`PUT ${LIST}/u1`)?.headers["if-match"]).toBe('"2026-10-11T00:00:00.000Z"');
  });

  test("making an editor a viewer hides the areas and saves none", async () => {
    const user = userEvent.setup();
    const { api } = await openForm("/settings/u1/edit", { [`GET ${LIST}/u1`]: respond({ item: loaded }), [`PUT ${LIST}/u1`]: respond({ item: { ...loaded, role: "viewer", areas: [], updatedAt: "2026-10-11T00:00:00.000Z" } }) });
    await waitFor(() => expect((screen.getByLabelText(/Nama/) as HTMLInputElement).value).toBe("Dewi Pengurus"));
    await user.click(screen.getByRole("radio", { name: /Viewer/ }));
    expect(screen.queryByRole("group", { name: /Area editor/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await screen.findByText("Perubahan berhasil disimpan.");
    expect(api.last(`PUT ${LIST}/u1`)?.body).toEqual({ name: "Dewi Pengurus", role: "viewer", areas: [] });
  });

  test("the last super_admin cannot step down: the Worker's sentence and the role field both say it, and the form keeps what was typed", async () => {
    const user = userEvent.setup();
    const message = "Tidak dapat menurunkan peran super admin terakhir. Tambah super admin lain terlebih dahulu.";
    const root = admin({ id: SELF, email: "tester@contoh.test", name: "Tester", role: "super_admin", areas: [] });
    await openForm(`/settings/${SELF}/edit`, {
      [`GET ${LIST}/${SELF}`]: respond({ item: root }),
      [`PUT ${LIST}/${SELF}`]: respond({ error: "last_super_admin", message, fields: { role: "Minimal satu super admin harus tersedia" } }, 409),
    });
    await waitFor(() => expect((screen.getByLabelText(/Nama/) as HTMLInputElement).value).toBe("Tester"));
    await user.click(screen.getByRole("radio", { name: /Viewer/ }));
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    const summary = await screen.findByRole("alert");
    expect(summary.textContent).toContain(message);
    expect(within(summary).getByRole("link", { name: "Peran: Minimal satu super admin harus tersedia" })).toBeTruthy();
    // ...and under the role itself, where the person is looking when it was the role they changed.
    expect(within(screen.getByRole("group", { name: /Peran/ })).getByText("Minimal satu super admin harus tersedia")).toBeTruthy();
    expect(screen.queryByText(/Perubahan berhasil disimpan/)).toBeNull();
    expect((screen.getByRole("radio", { name: /Viewer/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("button", { name: "Muat ulang" })).toBeNull(); // not a stale save
  });

  test("someone saved first (409 stale): the warning, and 'Muat ulang' replaces the form with the newer version", async () => {
    const user = userEvent.setup();
    let served = loaded;
    const { api } = await openForm("/settings/u1/edit", {
      [`GET ${LIST}/u1`]: () => Promise.resolve(respond({ item: served })),
      [`PUT ${LIST}/u1`]: respond({ error: "stale", message: "Data ini sudah diubah orang lain sejak kamu membukanya." }, 409),
    });
    await waitFor(() => expect((screen.getByLabelText(/Nama/) as HTMLInputElement).value).toBe("Dewi Pengurus"));
    await user.click(screen.getByRole("checkbox", { name: /Konten Situs/ }));
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    expect((await screen.findByText(/Data ini sudah diubah orang lain/)).textContent).toContain("Perubahan yang belum disimpan akan hilang");
    served = { ...loaded, areas: ["pendaftaran"], updatedAt: "2026-10-15T00:00:00.000Z" };
    await user.click(screen.getByRole("button", { name: "Muat ulang" }));
    await waitFor(() => expect((screen.getByRole("checkbox", { name: /Pendaftaran/ }) as HTMLInputElement).checked).toBe(true));
    expect((screen.getByRole("checkbox", { name: /Konten Situs/ }) as HTMLInputElement).checked).toBe(false);
    expect(api.count(`GET ${LIST}/u1`)).toBe(2);
  });

  test("an admin that is gone: the sentence and a way back; a failure to load: 'Coba lagi'", async () => {
    const user = userEvent.setup();
    stubApi({ "GET /api/me": respond(meBody("super_admin")), [`GET ${LIST}/gone`]: respond({ error: "not_found", message: "Data tidak ditemukan. Mungkin sudah dihapus." }, 404) });
    const view = renderApp("/settings/gone/edit");
    expect((await screen.findByRole("alert")).textContent).toBe("Admin tidak ditemukan.");
    expect(screen.getByRole("link", { name: "Kembali ke daftar" }).getAttribute("href")).toBe("/settings");
    view.unmount();

    let calls = 0;
    stubApi({ "GET /api/me": respond(meBody("super_admin")), [`GET ${LIST}/u1`]: () => Promise.resolve(++calls === 1 ? respond({ error: "internal" }, 500) : respond({ item: loaded })) });
    renderApp("/settings/u1/edit");
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    await waitFor(() => expect((screen.getByLabelText(/Nama/) as HTMLInputElement).value).toBe("Dewi Pengurus"));
  });

  test("the bodies: create sends the password only when typed, update sends the whole form", () => {
    const values = { ...toValues(null), email: " a@b.test ", name: "A", role: "editor" as const, pendaftaran: true, konten: true };
    expect(toCreateBody(values)).toEqual({ email: "a@b.test", name: "A", role: "editor", areas: ["pendaftaran", "konten"] });
    expect(toCreateBody({ ...values, password: "rahasia123" })).toMatchObject({ password: "rahasia123" });
    expect(toUpdateBody(values)).toEqual({ name: "A", role: "editor", areas: ["pendaftaran", "konten"] });
    expect(toUpdateBody({ ...values, role: "viewer" })).toEqual({ name: "A", role: "viewer", areas: [] });
    expect(toValues(admin() as never)).toMatchObject({ role: "editor", pendaftaran: false, komunikasi: true, konten: true, password: "" });
  });
});
