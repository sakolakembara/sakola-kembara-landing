import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { ACTION_OPTIONS, RESOURCE_OPTIONS } from "~/lib/audit";
import { formatDateTime } from "~/lib/format";
import { EMPTY_QUERY, isFiltered, parseAuditQuery, toApiQuery, toSearchParams } from "~/pages/audit/model";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

// Aktivitas (docs/cloudflare/admin-sistem.md): the audit log of the Sistem area, read-only, with a cursor.
// Against stubbed answers in the Worker's shape.

const LIST = "/api/admin/audit";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    createdAt: "2026-10-12T03:15:00.000Z",
    action: "announcement.update",
    actorEmail: "dewi@contoh.test",
    actorName: "Dewi Pengurus",
    resourceType: "announcement",
    resourceId: "ann-1",
    details: { fields: ["title"], label: "Pendaftaran dibuka" },
    ...overrides,
  };
}

const page = (items: unknown[], nextCursor: string | null = null) => ({ items, pageSize: 50, nextCursor });

type Who = Parameters<typeof meBody>;

async function openAudit(routes: Parameters<typeof stubApi>[0] = {}, path = "/audit", who: Who = ["super_admin", []]) {
  const api = stubApi({ "GET /api/me": respond(meBody(...who)), [`GET ${LIST}`]: respond(page([row()])), ...routes });
  const view = renderApp(path);
  await screen.findByRole("heading", { level: 1, name: "Aktivitas" });
  return { api, ...view };
}

const grid = () => screen.getByRole("table", { name: /Daftar aktivitas/ });
// The labels are also the options of the "Aksi" select, so a text is looked for in the table.
const findInTable = async (text: string) => within(await screen.findByRole("table", { name: /Daftar aktivitas/ })).findByText(text);

describe("only a super_admin opens it", () => {
  test.each([
    ["viewer", ["viewer", []]],
    ["editor with every area", ["editor", ["pendaftaran", "komunikasi", "konten"]]],
    ["editor with no area", ["editor", []]],
  ] as [string, Who][])("a %s gets the 403 page and the log is never asked for", async (_label, who) => {
    const api = stubApi({ "GET /api/me": respond(meBody(...who)), [`GET ${LIST}`]: respond(page([row()])) });
    renderApp("/audit");
    expect(await screen.findByRole("heading", { level: 1, name: "Akses ditolak" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(api.count(`GET ${LIST}`)).toBe(0);
  });

  test("the menu has no Sistem group for anyone else, and has Aktivitas and Pengaturan for a super_admin", async () => {
    for (const who of [["viewer", []], ["editor", ["pendaftaran", "komunikasi", "konten"]], ["editor", []]] as Who[]) {
      stubApi({ "GET /api/me": respond(meBody(...who)), "GET /api/dashboard": respond({ error: "not_found" }, 404) });
      const view = renderApp("/");
      const nav = await screen.findByRole("navigation", { name: "Menu utama" });
      expect(within(nav).queryByRole("link", { name: "Aktivitas" }), who.join()).toBeNull();
      expect(within(nav).queryByRole("link", { name: "Pengaturan" }), who.join()).toBeNull();
      expect(within(nav).queryByText("Sistem")).toBeNull();
      view.unmount();
    }
    stubApi({ "GET /api/me": respond(meBody("super_admin")), "GET /api/dashboard": respond({ error: "not_found" }, 404) });
    renderApp("/");
    const nav = await screen.findByRole("navigation", { name: "Menu utama" });
    expect(within(nav).getByRole("link", { name: "Aktivitas" }).getAttribute("href")).toBe("/audit");
    expect(within(nav).getByRole("link", { name: "Pengaturan" }).getAttribute("href")).toBe("/settings");
  });
});

describe("the table", () => {
  test("the legacy columns, named for screen readers, and the first request: the page size and nothing else", async () => {
    const { api } = await openAudit();
    await findInTable("Pengumuman diubah");
    expect(within(grid()).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Waktu", "Aksi", "Aktor", "Resource", "Detail"]);
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?pageSize=50`);
  });

  test("a row: when, the label and the code, who (the email and an admin's name), what it was about with a link, and the details", async () => {
    await openAudit();
    await findInTable("Pengumuman diubah");
    const cells = within(grid());
    expect(cells.getByText(formatDateTime("2026-10-12T03:15:00.000Z")).tagName).toBe("TIME");
    expect(cells.getByText("announcement.update").tagName).toBe("CODE");
    expect(cells.getByText("dewi@contoh.test")).toBeTruthy();
    expect(cells.getByText("Dewi Pengurus")).toBeTruthy();
    expect(cells.getByText("Pengumuman")).toBeTruthy(); // the resource type's label
    expect(cells.getByText("ann-1")).toBeTruthy();
    expect(cells.getByRole("link", { name: "Buka" }).getAttribute("href")).toBe("/announcements/ann-1/edit");
    const details = cells.getByText("Metadata");
    expect(details.closest("details")?.textContent).toContain('"label": "Pendaftaran dibuka"');
    expect(details.closest("details")?.textContent).toContain('"fields"');
  });

  test("an admin row opens that admin's edit form; a deletion, an upload and a row with no target have no link", async () => {
    await openAudit({
      [`GET ${LIST}`]: respond(
        page([
          row({ id: "a", action: "admin.update", resourceType: "admin_user", resourceId: "u-9", details: { email: "x@contoh.test", roleFrom: "viewer", roleTo: "editor" } }),
          row({ id: "b", action: "announcement.delete", resourceId: "ann-2", details: null }),
          row({ id: "c", action: "upload.create", resourceType: "media", resourceId: "m-1", details: { kind: "blog-image", size: 100 } }),
          row({ id: "d", action: "user.password_reset", resourceType: null, resourceId: null, actorName: null, details: null }),
        ]),
      ),
    });
    await findInTable("Admin diubah");
    const links = within(grid()).getAllByRole("link", { name: "Buka" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/settings/u-9/edit"]);
    expect(within(grid()).getByText("Berkas diunggah")).toBeTruthy(); // the new Worker's label
    expect(within(grid()).getByText("Berkas unggahan")).toBeTruthy(); // the new resource type
    expect(within(grid()).getAllByText("—").length).toBeGreaterThan(0);
  });

  test("an action nobody has a label for shows as it is, and a legacy one with its legacy label", async () => {
    await openAudit({ [`GET ${LIST}`]: respond(page([row({ id: "a", action: "admin.delete", resourceType: "admin_user" }), row({ id: "b", action: "something.new", resourceType: "mystery", details: null })])) });
    expect(await findInTable("Admin dihapus")).toBeTruthy();
    expect(within(grid()).getAllByText("something.new").length).toBe(2); // the label and the code
    expect(within(grid()).getByText("mystery")).toBeTruthy();
  });

  test("read-only: nothing to create, edit, delete or save on the page", async () => {
    await openAudit();
    await findInTable("Pengumuman diubah");
    for (const name of [/Tambah|Baru|Buat/, /^Hapus(?! filter)/, /^Edit/, /Simpan/]) {
      expect(screen.queryByRole("button", { name }), String(name)).toBeNull();
      expect(screen.queryByRole("link", { name }), String(name)).toBeNull();
    }
  });

  test("the description says what the log holds now: admin actions and system events", async () => {
    await openAudit();
    expect(screen.getByText(/Catatan aksi admin dan kejadian sistem/)).toBeTruthy();
    expect(screen.queryByText(/Total/)).toBeNull(); // nothing is counted any more
  });
});

describe("empty, loading and failed", () => {
  test("empty with no filter, with a filter, and past the last page", async () => {
    await openAudit({ [`GET ${LIST}`]: respond(page([])) });
    expect(await screen.findByText("Belum ada aktivitas.")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Halaman" })).toBeNull();
  });

  test("with a filter in the address bar: the filter's sentence", async () => {
    await openAudit({ [`GET ${LIST}`]: respond(page([])) }, "/audit?resource=blog");
    expect(await screen.findByText("Tidak ada aktivitas yang cocok dengan filter.")).toBeTruthy();
  });

  test("with a cursor and nothing older: that sentence, and the way back", async () => {
    await openAudit({ [`GET ${LIST}`]: respond(page([])) }, "/audit?cursor=abc");
    expect(await screen.findByText("Tidak ada aktivitas yang lebih lama.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kembali ke yang terbaru" }).getAttribute("href")).toBe("/audit");
  });

  test("while loading: a status row, and the table is busy", async () => {
    const held = deferred<Response>();
    stubApi({ "GET /api/me": respond(meBody("super_admin")), [`GET ${LIST}`]: () => held.promise });
    renderApp("/audit");
    expect(await screen.findByText("Memuat data...")).toBeTruthy();
    held.resolve(respond(page([row()])));
    expect(await findInTable("Pengumuman diubah")).toBeTruthy();
  });

  test("a failure says so in a sentence, with 'Coba lagi', which asks again", async () => {
    const user = userEvent.setup();
    let fail = true;
    const api = stubApi({ "GET /api/me": respond(meBody("super_admin")), [`GET ${LIST}`]: () => Promise.resolve(fail ? respond({ error: "internal" }, 500) : respond(page([row()]))) });
    renderApp("/audit");
    expect((await screen.findByRole("alert")).textContent).toBe("Terjadi kesalahan di server. Coba lagi sebentar lagi.");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    await findInTable("Pengumuman diubah");
    expect(api.count(`GET ${LIST}`)).toBe(2);
  });

  test("a 403 (the role changed while the page was open) is said in words, and so is no connection", async () => {
    stubApi({ "GET /api/me": respond(meBody("super_admin")), [`GET ${LIST}`]: respond({ error: "forbidden" }, 403) });
    const view = renderApp("/audit");
    expect((await screen.findByRole("alert")).textContent).toBe("Kamu tidak punya izin untuk melakukan ini.");
    view.unmount();
    const { setTransport } = await import("~/lib/api");
    setTransport(async (path) => {
      if (path === "/api/me") return respond(meBody("super_admin"));
      throw new TypeError("offline");
    });
    renderApp("/audit");
    expect((await screen.findByRole("alert")).textContent).toBe("Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.");
  });
});

describe("filters", () => {
  test("the selects offer every declared action and resource type, by their labels, and the dates are dates", async () => {
    await openAudit();
    const action = screen.getByLabelText("Aksi") as HTMLSelectElement;
    expect([...action.options].map((option) => option.textContent)).toEqual(["Semua aksi", ...ACTION_OPTIONS.map((option) => option.label)]);
    const resource = screen.getByLabelText("Tipe resource") as HTMLSelectElement;
    expect([...resource.options].map((option) => option.textContent)).toEqual(["Semua tipe", ...RESOURCE_OPTIONS.map((option) => option.label)]);
    expect((screen.getByLabelText("Dari") as HTMLInputElement).type).toBe("date");
    expect((screen.getByLabelText("Sampai") as HTMLInputElement).type).toBe("date");
    expect(screen.getByLabelText("Aktor (email lengkap)")).toBeTruthy();
  });

  test("Terapkan asks the Worker with the names it expects, and the address bar says what is applied", async () => {
    const user = userEvent.setup();
    const { api, router } = await openAudit();
    await user.selectOptions(screen.getByLabelText("Aksi"), "blog.create");
    await user.selectOptions(screen.getByLabelText("Tipe resource"), "blog");
    await user.type(screen.getByLabelText("Aktor (email lengkap)"), "dewi@contoh.test");
    await user.type(screen.getByLabelText("Dari"), "2026-10-01");
    await user.type(screen.getByLabelText("Sampai"), "2026-10-12");
    await user.click(screen.getByRole("button", { name: "Terapkan" }));
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?pageSize=50&action=blog.create&resource=blog&actor=dewi%40contoh.test&from=2026-10-01&to=2026-10-12`));
    expect(router.state.location.search).toBe("?action=blog.create&resource=blog&actor=dewi%40contoh.test&from=2026-10-01&to=2026-10-12");
    expect(screen.getByRole("button", { name: "Hapus filter" })).toBeTruthy();
  });

  test("'Hapus filter' goes back to the whole log", async () => {
    const user = userEvent.setup();
    const { api, router } = await openAudit({}, "/audit?action=blog.create&actor=dewi%40contoh.test");
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toContain("action=blog.create"));
    expect((screen.getByLabelText("Aksi") as HTMLSelectElement).value).toBe("blog.create");
    expect((screen.getByLabelText("Aktor (email lengkap)") as HTMLInputElement).value).toBe("dewi@contoh.test");
    await user.click(screen.getByRole("button", { name: "Hapus filter" }));
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?pageSize=50`));
    expect(router.state.location.search).toBe("");
    expect(screen.queryByRole("button", { name: "Hapus filter" })).toBeNull();
  });

  test("a hand-edited address cannot make the page ask for what it does not offer: the first page, no error", async () => {
    const { api } = await openAudit({}, "/audit?action=nope&resource=nope&from=garbage&to=2026-13&cursor=%25%25%25&actor=");
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?pageSize=50`);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the cursor", () => {
  test("'Berikutnya' is a link to the older page, with the filters kept; the browser's Back button is the way back", async () => {
    const user = userEvent.setup();
    let calls = 0;
    const { api, router } = await openAudit(
      {
        [`GET ${LIST}`]: (call) => {
          calls += 1;
          const cursor = new URL(call.url, "http://x").searchParams.get("cursor");
          return Promise.resolve(respond(cursor ? page([row({ id: "old", action: "blog.update", resourceType: "blog", resourceId: "b-1", details: null })], null) : page([row()], "CURSOR_1")));
        },
      },
      "/audit?resource=announcement",
    );
    await findInTable("Pengumuman diubah");
    expect(screen.getByText("Menampilkan 1 aktivitas")).toBeTruthy();
    const next = screen.getByRole("link", { name: "Berikutnya" });
    expect(next.getAttribute("href")).toBe("/audit?resource=announcement&cursor=CURSOR_1");
    expect(next.getAttribute("rel")).toBe("next");
    expect(screen.queryByRole("link", { name: "Kembali ke yang terbaru" })).toBeNull();

    await user.click(next);
    await findInTable("Artikel diubah");
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?pageSize=50&resource=announcement&cursor=CURSOR_1`);
    expect(router.state.location.search).toBe("?resource=announcement&cursor=CURSOR_1");
    // The last page: nothing to go on to, and the way back to the newest keeps the filter.
    expect(screen.queryByRole("link", { name: "Berikutnya" })).toBeNull();
    expect(screen.getByText("Berikutnya").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("link", { name: "Kembali ke yang terbaru" }).getAttribute("href")).toBe("/audit?resource=announcement");
    expect(calls).toBe(2);

    await router.navigate(-1);
    await findInTable("Pengumuman diubah");
  });

  test("applying a filter leaves the cursor behind: a filter changes what the list is", async () => {
    const user = userEvent.setup();
    const { api } = await openAudit({}, "/audit?cursor=CURSOR_9");
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?pageSize=50&cursor=CURSOR_9`));
    await user.selectOptions(screen.getByLabelText("Tipe resource"), "batch");
    await user.click(screen.getByRole("button", { name: "Terapkan" }));
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?pageSize=50&resource=batch`));
  });

  test("the rows of the page before stay on screen while the next one loads", async () => {
    const user = userEvent.setup();
    const held = deferred<Response>();
    let second = false;
    await openAudit({
      [`GET ${LIST}`]: (call) => {
        if (!new URL(call.url, "http://x").searchParams.has("cursor")) return Promise.resolve(respond(page([row()], "C")));
        second = true;
        return held.promise;
      },
    });
    await findInTable("Pengumuman diubah");
    await user.click(screen.getByRole("link", { name: "Berikutnya" }));
    await waitFor(() => expect(second).toBe(true));
    expect(within(grid()).getByText("Pengumuman diubah")).toBeTruthy();
    held.resolve(respond(page([row({ id: "later", action: "blog.update" })])));
    await findInTable("Artikel diubah");
  });
});

describe("the query of the address bar", () => {
  test("the empty query is the first page, and every field is carried both ways", () => {
    expect(toSearchParams(EMPTY_QUERY).toString()).toBe("");
    expect(toApiQuery(EMPTY_QUERY)).toBe("?pageSize=50");
    const query = { action: "blog.update", resource: "blog", actor: "a@b.test", from: "2026-10-01", to: "2026-10-02", cursor: "abc_-" };
    expect(parseAuditQuery(toSearchParams(query))).toEqual(query);
    expect(isFiltered(query)).toBe(true);
    expect(isFiltered({ ...EMPTY_QUERY, cursor: "abc" })).toBe(false); // a place in the list is not a filter
  });

  test("what the page could not have written is dropped", () => {
    const parsed = parseAuditQuery(new URLSearchParams({ action: "x.y", resource: "z", from: "1/2/2026", to: "2026-1-1", cursor: "a b", actor: `  ${"x".repeat(300)} ` }));
    expect(parsed).toEqual({ ...EMPTY_QUERY, actor: "x".repeat(254) });
  });
});
