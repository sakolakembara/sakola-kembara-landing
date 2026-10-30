import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { mailtoFor, SUBJECT_LINE } from "~/pages/messages/model";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

// Pesan, the inbox (docs/cloudflare/admin-komunikasi.md): the list with its pills and numbers, and the detail page
// with its explicit mark-as-read. Against stubbed answers in the Worker's shape.

const LIST = "/api/admin/messages";
const COUNTS = `${LIST}/counts`;

function listed(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    fullName: "Ayu Contoh",
    email: "ayu.contoh@example.test",
    subject: "partnership",
    preview: "Kami ingin bekerja sama mengadakan kelas membaca.",
    readAt: null,
    createdAt: "2026-10-10T03:00:00.000Z",
    ...overrides,
  };
}

function whole(overrides: Record<string, unknown> = {}) {
  const { preview: _preview, ...rest } = listed();
  return { ...rest, message: "Kami ingin bekerja sama mengadakan kelas membaca.\n\nBisakah kita berdiskusi?", ...overrides };
}

const envelope = (items: unknown[], extra: { page?: number; pageSize?: number; total?: number } = {}) => ({ items, page: extra.page ?? 1, pageSize: extra.pageSize ?? 20, total: extra.total ?? items.length });

type Who = Parameters<typeof meBody>;

async function openList(who: Who, routes: Parameters<typeof stubApi>[0] = {}, path = "/messages") {
  const api = stubApi({
    "GET /api/me": respond(meBody(...who)),
    [`GET ${LIST}`]: respond(envelope([listed(), listed({ id: "m2", fullName: "Budi Contoh", email: "budi.contoh@example.test", subject: "donation", readAt: "2026-10-11T00:00:00.000Z", createdAt: "2026-10-09T03:00:00.000Z" })])),
    [`GET ${COUNTS}`]: respond({ total: 12, unread: 3 }),
    ...routes,
  });
  const view = renderApp(path);
  await screen.findByRole("heading", { level: 1, name: "Pesan" });
  await screen.findByText("Ayu Contoh");
  return { api, ...view };
}

describe("the list", () => {
  test("the legacy inbox: the two numbers, three pills with counts, a row per message with its unread dot, sender, subject, a line of text and the time", async () => {
    await openList(["viewer", []]);
    expect(screen.getByText("12 total · 3 belum dibaca.")).toBeTruthy();
    const pills = within(screen.getByRole("navigation", { name: "Saring pesan" })).getAllByRole("link");
    expect(pills.map((pill) => pill.textContent)).toEqual(["Semua (12)", "Belum dibaca (3)", "Sudah dibaca (9)"]);
    expect(pills.map((pill) => pill.getAttribute("href"))).toEqual(["/messages", "/messages?filter=unread", "/messages?filter=read"]);

    const rows = within(screen.getByRole("main")).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const first = rows[0]!;
    expect(within(first).getByRole("link").getAttribute("href")).toBe("/messages/m1");
    expect(within(first).getByText("Ayu Contoh")).toBeTruthy();
    expect(within(first).getByText("ayu.contoh@example.test")).toBeTruthy();
    expect(within(first).getByText("Kerjasama")).toBeTruthy();
    expect(within(first).getByText("Kami ingin bekerja sama mengadakan kelas membaca.")).toBeTruthy();
    expect(within(first).getByRole("img", { name: "Belum dibaca" })).toBeTruthy();
    expect(within(rows[1]!).getByRole("img", { name: "Sudah dibaca" })).toBeTruthy();
    expect(within(rows[1]!).getByText("Donasi")).toBeTruthy();
    // The unread row reads heavier, as in the legacy list.
    expect(within(first).getByText("Ayu Contoh").className).toContain("font-semibold");
    expect(within(rows[1]!).getByText("Budi Contoh").className).not.toContain("font-semibold");
  });

  test("reading it changes nothing: the page asks the list and the counts, and never makes a POST or a DELETE", async () => {
    const { api } = await openList(["editor", ["komunikasi"]]);
    expect(api.calls.map((call) => `${call.method} ${call.path}`).filter((route) => !route.endsWith("/api/me") && !route.endsWith("/api/dashboard"))).toEqual([`GET ${LIST}`, `GET ${COUNTS}`]);
  });

  test("a viewer and an editor of Komunikasi see the same inbox: there is nothing to change in the list", async () => {
    for (const who of [["viewer", []], ["editor", ["komunikasi"]], ["super_admin", []]] as Who[]) {
      const view = await openList(who);
      expect(screen.queryByRole("button", { name: /Hapus/ })).toBeNull();
      expect(screen.queryByRole("link", { name: /Baru|Tambah/ })).toBeNull();
      view.unmount();
    }
  });

  test("an editor of other areas cannot open the page: the 403 page, and neither the list nor the counts are asked for", async () => {
    const api = stubApi({ "GET /api/me": respond(meBody("editor", ["konten", "pendaftaran"])), [`GET ${LIST}`]: respond(envelope([listed()])), [`GET ${COUNTS}`]: respond({ total: 1, unread: 1 }) });
    renderApp("/messages");
    expect(await screen.findByRole("heading", { level: 1, name: "Akses ditolak" })).toBeTruthy();
    expect(screen.queryByText("Ayu Contoh")).toBeNull();
    expect(api.count(`GET ${LIST}`)).toBe(0);
    expect(api.count(`GET ${COUNTS}`)).toBe(0);
  });

  test("the request is the one the Worker takes: 20 a page, newest first, and the filter from the address bar", async () => {
    const { api } = await openList(["viewer", []]);
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=20&sort=-createdAt`);
    expect(api.count(`GET ${COUNTS}`)).toBe(1);
  });

  test("a link with the filter in it (the dashboard's tile) opens the filtered list, and that pill is the current one", async () => {
    const { api } = await openList(["editor", ["komunikasi"]], {}, "/messages?filter=unread");
    expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=20&filter=unread&sort=-createdAt`);
    const pills = within(screen.getByRole("navigation", { name: "Saring pesan" })).getAllByRole("link");
    expect(pills.map((pill) => pill.getAttribute("aria-current"))).toEqual([null, "page", null]);
    expect(pills[1]!.className).toContain("bg-primary-blue");
  });

  test("pressing a pill goes to that filter, asks the Worker for it, and the counts stay as they are", async () => {
    const user = userEvent.setup();
    const { api } = await openList(["viewer", []]);
    await user.click(screen.getByRole("link", { name: "Sudah dibaca (9)" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/messages?filter=read"));
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toBe(`${LIST}?page=1&pageSize=20&filter=read&sort=-createdAt`));
    expect(api.count(`GET ${COUNTS}`)).toBe(1);
    await user.click(screen.getByRole("link", { name: "Semua (12)" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/messages"));
  });

  test("each empty state says its own sentence", async () => {
    const empty = { [`GET ${LIST}`]: respond(envelope([])), [`GET ${COUNTS}`]: respond({ total: 0, unread: 0 }) };
    for (const [path, text] of [
      ["/messages", "Belum ada pesan dari pengunjung."],
      ["/messages?filter=unread", "Tidak ada pesan yang belum dibaca."],
      ["/messages?filter=read", "Tidak ada pesan yang sudah dibaca."],
    ] as const) {
      stubApi({ "GET /api/me": respond(meBody("viewer")), ...empty });
      const view = renderApp(path);
      expect(await screen.findByText(text), path).toBeTruthy();
      expect(screen.getByText("0 total · 0 belum dibaca.")).toBeTruthy();
      view.unmount();
    }
  });

  test("pages: the summary and 'Berikutnya' keep the filter", async () => {
    const user = userEvent.setup();
    const { api } = await openList(["viewer", []], { [`GET ${LIST}`]: respond(envelope([listed()], { total: 45 })) }, "/messages?filter=unread");
    expect(screen.getByText("Menampilkan 1 sampai 20 dari 45")).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "Berikutnya" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/messages?filter=unread&page=2"));
    await waitFor(() => expect(api.last(`GET ${LIST}`)?.url).toContain("page=2"));
  });

  test("when the counts cannot be loaded the list still works, and the labels carry no number rather than a wrong one", async () => {
    await openList(["viewer", []], { [`GET ${COUNTS}`]: respond({ error: "internal" }, 500) });
    expect(screen.queryByText(/total ·/)).toBeNull();
    expect(within(screen.getByRole("navigation", { name: "Saring pesan" })).getAllByRole("link").map((pill) => pill.textContent)).toEqual(["Semua", "Belum dibaca", "Sudah dibaca"]);
  });

  test("a list that fails to load says so in a sentence; 'Coba lagi' asks for the list and the counts again", async () => {
    const user = userEvent.setup();
    let fail = true;
    const api = stubApi({
      "GET /api/me": respond(meBody("viewer")),
      [`GET ${LIST}`]: () => Promise.resolve(fail ? respond({ error: "internal" }, 500) : respond(envelope([listed()]))),
      [`GET ${COUNTS}`]: respond({ total: 1, unread: 1 }),
    });
    renderApp("/messages");
    expect((await screen.findByRole("alert")).textContent).toBe("Terjadi kesalahan di server. Coba lagi sebentar lagi.");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    await screen.findByText("Ayu Contoh");
    expect(api.count(`GET ${LIST}`)).toBe(2);
    expect(api.count(`GET ${COUNTS}`)).toBe(2);
  });

  test("a filter the Worker does not know (a hand-typed address) is its sentence, not an empty inbox", async () => {
    stubApi({
      "GET /api/me": respond(meBody("viewer")),
      [`GET ${LIST}`]: respond({ error: "invalid_query", message: "Pencarian atau penyaringan tidak dikenal.", param: "filter" }, 400),
      [`GET ${COUNTS}`]: respond({ total: 1, unread: 1 }),
    });
    renderApp("/messages?filter=bogus");
    expect((await screen.findByRole("alert")).textContent).toBe("Pencarian atau penyaringan tidak dikenal.");
  });

  test("a notice that came with the navigation (the delete) is shown and can be dismissed", async () => {
    const user = userEvent.setup();
    stubApi({ "GET /api/me": respond(meBody("editor", ["komunikasi"])), [`GET ${LIST}`]: respond(envelope([listed()])), [`GET ${COUNTS}`]: respond({ total: 1, unread: 1 }) });
    const view = renderApp("/messages");
    await screen.findByText("Ayu Contoh");
    // The detail page sends the person here with this state: see its delete test below.
    view.router.navigate("/messages", { state: { flash: { tone: "success", text: "Pesan berhasil dihapus." } } });
    expect((await screen.findByRole("status")).textContent).toContain("Pesan berhasil dihapus.");
    await user.click(screen.getByRole("button", { name: "Tutup pesan" }));
    expect(screen.queryByText("Pesan berhasil dihapus.")).toBeNull();
  });
});

// ----------------------------------------------------------------------------- the detail page

const ONE = `${LIST}/m1`;

async function openDetail(who: Who, routes: Parameters<typeof stubApi>[0] = {}, message: Record<string, unknown> = whole()) {
  const api = stubApi({
    "GET /api/me": respond(meBody(...who)),
    [`GET ${ONE}`]: respond({ item: message }),
    [`POST ${ONE}/read`]: () => respond({ item: { ...message, readAt: "2026-10-12T05:00:00.000Z" } }),
    [`POST ${ONE}/unread`]: () => respond({ item: { ...message, readAt: null } }),
    ...routes,
  });
  const view = renderApp("/messages/m1");
  await screen.findByRole("heading", { level: 1 }); // the sender's name, once the message is loaded
  return { api, ...view };
}

const toggleButton = () => screen.queryByRole("button", { name: /^Tandai/ });

describe("the detail page: what it shows", () => {
  test("the legacy page: back link, overline, the sender and address, the subject tag, when it was sent, the text as typed", async () => {
    await openDetail(["viewer", []]);
    expect(screen.getByRole("link", { name: "Kembali ke daftar" }).getAttribute("href")).toBe("/messages");
    expect(screen.getByText("Detail pesan")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Ayu Contoh");
    expect(screen.getByText("ayu.contoh@example.test")).toBeTruthy();
    expect(screen.getByText("Kerjasama")).toBeTruthy();
    expect(screen.getByText(/^Dikirim /)).toBeTruthy();
    const text = screen.getByText(/Kami ingin bekerja sama/);
    expect(text.className).toContain("whitespace-pre-wrap");
    expect(text.textContent).toBe("Kami ingin bekerja sama mengadakan kelas membaca.\n\nBisakah kita berdiskusi?");
    // The tab title does not carry a visitor's name.
    await waitFor(() => expect(document.title).toBe("Detail Pesan | Admin Sakola Kembara"));
  });

  test("text from a visitor is text: markup in it is not run or drawn", async () => {
    await openDetail(["viewer", []], {}, whole({ fullName: "<b>Tebal</b>", message: "<img src=x onerror=alert(1)> halo & selamat" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("<b>Tebal</b>");
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)> halo & selamat")).toBeTruthy();
  });

  test("'Balas via Email' is the legacy mailto, per subject, with the address and the subject line encoded", async () => {
    for (const subject of ["partnership", "donation", "other"] as const) {
      const view = await openDetail(["viewer", []], {}, whole({ subject, email: "ayu.contoh+kelas@example.test" }));
      const link = screen.getByRole("link", { name: /Balas via Email/ });
      expect(link.getAttribute("href")).toBe(`mailto:${encodeURIComponent("ayu.contoh+kelas@example.test")}?subject=${encodeURIComponent(SUBJECT_LINE[subject])}`);
      view.unmount();
    }
    expect(mailtoFor("a@b.test", "partnership")).toBe("mailto:a%40b.test?subject=Re%3A%20Kerjasama%20dengan%20Sakola%20Kembara");
    expect(mailtoFor("a@b.test", "unknown")).toBe("mailto:a%40b.test?subject=Re%3A%20Pesan");
  });

  test("a message that is not there: its sentence and a way back; a failure: 'Coba lagi'", async () => {
    const user = userEvent.setup();
    stubApi({ "GET /api/me": respond(meBody("viewer")), [`GET ${ONE}`]: respond({ error: "not_found", message: "Data tidak ditemukan. Mungkin sudah dihapus." }, 404) });
    const view = renderApp("/messages/m1");
    expect((await screen.findByRole("alert")).textContent).toBe("Data tidak ditemukan. Mungkin sudah dihapus.");
    expect(screen.getByRole("link", { name: "Kembali ke daftar" }).getAttribute("href")).toBe("/messages");
    view.unmount();

    let fail = true;
    const api = stubApi({ "GET /api/me": respond(meBody("viewer")), [`GET ${ONE}`]: () => Promise.resolve(fail ? respond({ error: "internal" }, 500) : respond({ item: whole() })) });
    renderApp("/messages/m1");
    expect((await screen.findByRole("alert")).textContent).toBe("Terjadi kesalahan di server. Coba lagi sebentar lagi.");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    await screen.findByRole("heading", { level: 1, name: "Ayu Contoh" });
    expect(api.count(`GET ${ONE}`)).toBe(2);
  });

  test("an editor of other areas gets the 403 page, and the message is never asked for", async () => {
    const api = stubApi({ "GET /api/me": respond(meBody("editor", ["konten"])), [`GET ${ONE}`]: respond({ item: whole() }) });
    renderApp("/messages/m1");
    expect(await screen.findByRole("heading", { level: 1, name: "Akses ditolak" })).toBeTruthy();
    expect(api.count(`GET ${ONE}`)).toBe(0);
  });
});

describe("the detail page: opening a message marks it read, once, by an explicit request", () => {
  // Negative test (scripts/negative-checks-spa-komunikasi.mjs): drop the permission check of the automatic mark and a
  // viewer's visit marks the message; drop the once-per-visit guard and a mark-unread is undone at once.
  test("an editor opening an unread message: the GET loads it, then one POST /read marks it; the screen then shows it read, with the legacy note", async () => {
    const { api } = await openDetail(["editor", ["komunikasi"]]);
    await waitFor(() => expect(api.count(`POST ${ONE}/read`)).toBe(1));
    // The load came first and carried no write.
    const order = api.calls.map((call) => `${call.method} ${call.path}`).filter((route) => route.includes("/messages/"));
    expect(order).toEqual([`GET ${ONE}`, `POST ${ONE}/read`]);
    expect(api.last(`POST ${ONE}/read`)?.body).toBeNull();
    expect(await screen.findByText("Pesan ini ditandai sebagai sudah dibaca saat kamu membukanya.")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Tandai belum dibaca" })).toBeTruthy();
    expect(api.count(`GET ${ONE}`)).toBe(1); // the answer of the POST is used: no second load
  });

  test("a viewer reads the message and leaves it unread: no request that writes, no toggle, no delete, no note", async () => {
    const { api } = await openDetail(["viewer", []]);
    // Give any stray effect time to fire.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(api.calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(toggleButton()).toBeNull();
    expect(screen.queryByRole("button", { name: /Hapus/ })).toBeNull();
    expect(screen.queryByText(/ditandai sebagai sudah dibaca/)).toBeNull();
    expect(screen.getByRole("link", { name: /Balas via Email/ })).toBeTruthy(); // reading includes replying
  });

  test("a message that is already read is not marked again, and has no note", async () => {
    const { api } = await openDetail(["editor", ["komunikasi"]], {}, whole({ readAt: "2026-10-11T00:00:00.000Z" }));
    expect(await screen.findByRole("button", { name: "Tandai belum dibaca" })).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(api.count(`POST ${ONE}/read`)).toBe(0);
    expect(screen.queryByText(/ditandai sebagai sudah dibaca/)).toBeNull();
  });

  test("if the automatic mark fails nothing is announced, and 'Tandai sudah dibaca' is there to try again", async () => {
    const user = userEvent.setup();
    let fail = true;
    const { api } = await openDetail(["editor", ["komunikasi"]], {
      [`POST ${ONE}/read`]: () => Promise.resolve(fail ? respond({ error: "internal" }, 500) : respond({ item: whole({ readAt: "2026-10-12T05:00:00.000Z" }) })),
    });
    const retry = await screen.findByRole("button", { name: "Tandai sudah dibaca" });
    expect(screen.queryByRole("alert")).toBeNull();
    fail = false;
    await user.click(retry);
    expect(await screen.findByRole("button", { name: "Tandai belum dibaca" })).toBeTruthy();
    expect(api.count(`POST ${ONE}/read`)).toBe(2);
  });
});

describe("the detail page: mark unread by hand", () => {
  test("it stays unread: the page does not mark it read again, and the button now offers the opposite", async () => {
    const user = userEvent.setup();
    const { api } = await openDetail(["editor", ["komunikasi"]]);
    await user.click(await screen.findByRole("button", { name: "Tandai belum dibaca" }));
    expect(await screen.findByRole("button", { name: "Tandai sudah dibaca" })).toBeTruthy();
    expect(api.count(`POST ${ONE}/unread`)).toBe(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(api.count(`POST ${ONE}/read`)).toBe(1); // the one of opening it, and no more
    // The note about the automatic mark is gone with it.
    expect(screen.queryByText(/ditandai sebagai sudah dibaca saat kamu membukanya/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Tandai sudah dibaca" }));
    expect(await screen.findByRole("button", { name: "Tandai belum dibaca" })).toBeTruthy();
    expect(api.count(`POST ${ONE}/read`)).toBe(2);
  });

  test("pressed twice quickly it is sent once", async () => {
    const gate = deferred<Response>();
    const { api } = await openDetail(["editor", ["komunikasi"]], { [`POST ${ONE}/unread`]: () => gate.promise });
    const button = await screen.findByRole("button", { name: "Tandai belum dibaca" });
    await act(async () => {
      button.click();
      button.click();
    });
    expect(api.count(`POST ${ONE}/unread`)).toBe(1);
    await act(async () => gate.resolve(respond({ item: whole({ readAt: null }) })));
    expect(await screen.findByRole("button", { name: "Tandai sudah dibaca" })).toBeTruthy();
  });

  test("a refusal is its sentence, and the message stays as it was", async () => {
    const user = userEvent.setup();
    await openDetail(["editor", ["komunikasi"]], { [`POST ${ONE}/unread`]: respond({ error: "forbidden" }, 403) });
    await user.click(await screen.findByRole("button", { name: "Tandai belum dibaca" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Kamu tidak punya izin untuk melakukan ini.");
    expect(screen.getByRole("button", { name: "Tandai belum dibaca" })).toBeTruthy();
  });
});

describe("the detail page: delete", () => {
  async function ask(user: ReturnType<typeof userEvent.setup>, routes: Parameters<typeof stubApi>[0] = {}) {
    const view = await openDetail(["editor", ["komunikasi"]], routes, whole({ readAt: "2026-10-11T00:00:00.000Z" }));
    await user.click(await screen.findByRole("button", { name: "Hapus" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Hapus pesan?" });
    return { ...view, dialog };
  }

  test("a question that names the sender, with the safe button focused; Batal changes nothing", async () => {
    const user = userEvent.setup();
    const { dialog, api } = await ask(user);
    expect(dialog.textContent).toContain("Pesan “Ayu Contoh” akan dihapus. Tindakan ini tidak bisa dibatalkan.");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Batal" }));
    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.calls.filter((call) => call.method === "DELETE")).toEqual([]);
  });

  test("confirming sends one DELETE (no version: a message has none), then the list with 'Pesan berhasil dihapus.'", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const { dialog, api } = await ask(user, {
      [`DELETE ${ONE}`]: () => gate.promise,
      [`GET ${LIST}`]: respond(envelope([])),
      [`GET ${COUNTS}`]: respond({ total: 0, unread: 0 }),
    });
    const confirm = within(dialog).getByRole("button", { name: "Hapus" });
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(api.count(`DELETE ${ONE}`)).toBe(1);
    expect(api.last(`DELETE ${ONE}`)?.headers["if-match"]).toBeUndefined();

    await act(async () => gate.resolve(respond(null, 204)));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/messages"));
    expect((await screen.findByRole("status")).textContent).toContain("Pesan berhasil dihapus.");
  });

  test("a message someone else deleted first (404) counts as deleted", async () => {
    const user = userEvent.setup();
    const { dialog } = await ask(user, { [`DELETE ${ONE}`]: respond({ error: "not_found" }, 404), [`GET ${LIST}`]: respond(envelope([])), [`GET ${COUNTS}`]: respond({ total: 0, unread: 0 }) });
    await user.click(within(dialog).getByRole("button", { name: "Hapus" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/messages"));
  });

  test("any other failure shows its sentence in the dialog and can be tried again", async () => {
    const user = userEvent.setup();
    const { dialog } = await ask(user, { [`DELETE ${ONE}`]: respond({ error: "internal" }, 500) });
    await user.click(within(dialog).getByRole("button", { name: "Hapus" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Terjadi kesalahan di server. Coba lagi sebentar lagi.");
    expect(screen.getByTestId("location").textContent).toBe("/messages/m1");
  });
});
