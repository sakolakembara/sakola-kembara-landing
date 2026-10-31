import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { crumbsFor } from "~/components/Breadcrumb";
import { api as callApi } from "~/lib/api";
import { navCounts } from "~/lib/dashboard";
import { deferred, meBody, openUserMenu, renderApp, respond, stubApi } from "./helpers";

// The frame around every page after the stage-2 polish (cf/admin/DESIGN.md, "Shell"): count badges from the
// dashboard's answer, the collapsible icon rail with Ctrl+B, the user menu, the breadcrumb and the link to the site.
// The menu's own contents, the drawer and Keluar are in sidebar.test.tsx and drawer.test.tsx.

const KEY = "sakem-admin:sidebar";

beforeEach(() => window.localStorage.clear());

function dashboardWith(pending?: number, unread?: number) {
  const attention: Record<string, unknown> = {};
  if (pending !== undefined) attention.pendingApplications = { count: pending, to: "/applications?status=pending" };
  if (unread !== undefined) attention.unreadMessages = { count: unread, to: "/messages?filter=unread" };
  return { attention };
}

type Dashboard = Response | (() => Response | Promise<Response>);

async function open(path = "/", dashboard: Dashboard = respond(dashboardWith(12, 3)), who: Parameters<typeof meBody> = ["super_admin"]) {
  const api = stubApi({
    "GET /api/me": respond(meBody(...who)),
    "GET /api/dashboard": dashboard as never,
    "POST /api/ping": respond({ ok: true }),
  });
  renderApp(path);
  const nav = await screen.findByRole("navigation", { name: "Menu utama" });
  return { api, nav };
}

const sidebar = () => document.querySelector("aside") as HTMLElement;
const toggle = () => screen.getByRole("button", { name: /menu samping$/ });

describe("count badges", () => {
  test("Pendaftar and Pesan show what waits, and a screen reader hears what the number counts", async () => {
    const { nav } = await open();
    const pendaftar = await within(nav).findByRole("link", { name: "Pendaftar, 12 menunggu" });
    expect(pendaftar.textContent).toContain("12");
    expect(within(nav).getByRole("link", { name: "Pesan, 3 belum dibaca" }).textContent).toContain("3");
    // No number on the other entries.
    expect(within(nav).getByRole("link", { name: "Blog" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Batch" })).toBeTruthy();
  });

  test("nothing waiting, no badge: zero is not news", async () => {
    const { nav } = await open("/", respond(dashboardWith(0, 0)));
    // The answer is in once the dashboard page has drawn it (the shell's counts come from the same answer).
    await screen.findByRole("region", { name: "Perlu perhatian" });
    await act(async () => {});
    expect(within(nav).getByRole("link", { name: "Pendaftar" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Pesan" })).toBeTruthy();
  });

  test("a role the server sends nothing to gets no badge, and no badge shows before the answer comes", async () => {
    const gate = deferred<Response>();
    const { nav } = await open("/", () => gate.promise, ["super_admin"]);
    expect(within(nav).getByRole("link", { name: "Pendaftar" })).toBeTruthy();
    gate.resolve(respond({ attention: {} }));
    await waitFor(() => expect(screen.queryByText("Memuat dashboard…")).toBeNull());
    expect(within(nav).getByRole("link", { name: "Pendaftar" })).toBeTruthy();
  });

  test("above 99 it reads 99+ and the words still carry the real number", async () => {
    const { nav } = await open("/", respond(dashboardWith(150)));
    const link = await within(nav).findByRole("link", { name: "Pendaftar, 150 menunggu" });
    expect(link.textContent).toContain("99+");
  });

  test("a write asks again, and the old number stays until the new one is there", async () => {
    const second = deferred<Response>();
    let call = 0;
    const { api, nav } = await open("/blog", () => (++call === 1 ? respond(dashboardWith(12, 3)) : second.promise));
    await within(nav).findByRole("link", { name: "Pendaftar, 12 menunggu" });

    await act(async () => void (await callApi("/api/ping", { method: "POST", json: {} })));
    await waitFor(() => expect(api.count("GET /api/dashboard")).toBe(2));
    // The answer is on its way: the badge does not blink away.
    expect(within(nav).getByRole("link", { name: "Pendaftar, 12 menunggu" })).toBeTruthy();

    second.resolve(respond(dashboardWith(11, 3)));
    expect(await within(nav).findByRole("link", { name: "Pendaftar, 11 menunggu" })).toBeTruthy();
  });

  test("moving between pages does not ask again; coming back to the dashboard does", async () => {
    const user = userEvent.setup();
    const { api, nav } = await open("/blog");
    await within(nav).findByRole("link", { name: "Pendaftar, 12 menunggu" });
    expect(api.count("GET /api/dashboard")).toBe(1);

    await user.click(within(nav).getByRole("link", { name: "Laporan" }));
    await screen.findByRole("heading", { level: 1, name: "Laporan" });
    expect(api.count("GET /api/dashboard")).toBe(1);

    await user.click(within(nav).getByRole("link", { name: "Dashboard" }));
    await waitFor(() => expect(api.count("GET /api/dashboard")).toBe(2));
  });

  test("navCounts: only the two that wait for someone, only above zero", () => {
    expect(navCounts(null)).toEqual({});
    expect(navCounts({ attention: {} })).toEqual({});
    expect(
      navCounts({
        attention: {
          pendingApplications: { count: 4, to: "/applications?status=pending" },
          underReviewApplications: { count: 9, to: "/applications?status=under_review" },
          unreadMessages: { count: 0, to: "/messages?filter=unread" },
        },
      }),
    ).toEqual({ "/applications": { count: 4, what: "menunggu" } });
  });
});

describe("the icon rail", () => {
  test("the button collapses the sidebar to 72 px and back, and its name says what it does next", async () => {
    const user = userEvent.setup();
    await open();
    expect(toggle().getAttribute("aria-label")).toBe("Ciutkan menu samping");
    expect(sidebar().className).toContain("md:w-[248px]");

    await user.click(toggle());
    expect(toggle().getAttribute("aria-label")).toBe("Bentangkan menu samping");
    expect(sidebar().className).toContain("md:w-[72px]");

    await user.click(toggle());
    expect(sidebar().className).toContain("md:w-[248px]");
  });

  test("on the rail every entry still has its name, and the groups their labels, for screen readers", async () => {
    const user = userEvent.setup();
    const { nav } = await open();
    await user.click(toggle());
    for (const name of ["Dashboard", "Batch", "Pusat Dokumen", "Pengumuman", "Blog", "Shortlink", "Aktivitas", "Pengaturan"]) {
      const link = within(nav).getByRole("link", { name });
      expect(link.getAttribute("title"), name).toBe(name);
      // The name is the link's own text, not only its tooltip (a title is the weakest source of a name).
      expect(link.querySelector(".sr-only")?.textContent, name).toBe(name);
    }
    expect(within(nav).getByRole("list", { name: "Konten Situs" })).toBeTruthy();
    // A count is in the tooltip too.
    expect(within(nav).getByRole("link", { name: "Pendaftar, 12 menunggu" }).getAttribute("title")).toBe("Pendaftar (12 menunggu)");
  });

  test("open, the entries have no tooltip: their text is there", async () => {
    const { nav } = await open();
    expect(within(nav).getByRole("link", { name: "Blog" }).hasAttribute("title")).toBe(false);
  });

  test("the choice is kept in the browser, and read back on the next visit", async () => {
    const user = userEvent.setup();
    const first = await open();
    await user.click(toggle());
    expect(window.localStorage.getItem(KEY)).toBe("collapsed");
    first.nav.ownerDocument.body.innerHTML = "";

    window.localStorage.setItem(KEY, "collapsed");
    renderApp("/");
    await screen.findByRole("navigation", { name: "Menu utama" });
    expect(screen.getAllByRole("button", { name: "Bentangkan menu samping" }).length).toBeGreaterThan(0);
  });

  test("a browser that refuses storage still collapses it, for this visit", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await open();
    expect(sidebar().className).toContain("md:w-[248px]");
    await user.click(toggle());
    expect(sidebar().className).toContain("md:w-[72px]");
  });

  test("Ctrl+B and ⌘B toggle it; the shortcut takes the key over", async () => {
    await open();
    expect(fireEvent.keyDown(window, { key: "b", ctrlKey: true })).toBe(false);
    expect(sidebar().className).toContain("md:w-[72px]");
    fireEvent.keyDown(window, { key: "B", metaKey: true });
    expect(sidebar().className).toContain("md:w-[248px]");
  });

  test("other B shortcuts are left alone", async () => {
    await open();
    for (const init of [{ key: "b" }, { key: "b", ctrlKey: true, shiftKey: true }, { key: "b", ctrlKey: true, altKey: true }, { key: "n", ctrlKey: true }]) {
      expect(fireEvent.keyDown(window, init), JSON.stringify(init)).toBe(true);
    }
    expect(sidebar().className).toContain("md:w-[248px]");
  });

  test("typing in a field keeps Ctrl+B for the field (bold in an editor)", async () => {
    await open();
    for (const field of [document.createElement("input"), document.createElement("textarea"), document.createElement("select")]) {
      document.body.append(field);
      expect(fireEvent.keyDown(field, { key: "b", ctrlKey: true }), field.tagName).toBe(true);
      field.remove();
    }
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.append(editable);
    expect(fireEvent.keyDown(editable, { key: "b", ctrlKey: true })).toBe(true);
    expect(sidebar().className).toContain("md:w-[248px]");
  });
});

describe("the frame", () => {
  test("the shell and <main> are positioned boxes, so a `sr-only` element deep in a page cannot make the document taller", async () => {
    // jsdom has no layout. What can be checked is the cause: an absolutely positioned element is clipped only by a
    // box that is its containing block, and the editor's hidden file input is absolute. Without `relative` it stuck
    // out of the shell, the window got a scrollbar of its own and the whole shell scrolled away over white.
    await open("/blog/new");
    const main = screen.getByRole("main");
    expect(main.classList.contains("relative")).toBe(true);
    expect(main.classList.contains("overflow-auto")).toBe(true);
    const frame = main.parentElement!.parentElement!;
    expect(frame.classList.contains("relative")).toBe(true);
    expect(frame.classList.contains("overflow-hidden")).toBe(true);
  });
});

describe("the user menu", () => {
  const trigger = () => screen.getAllByRole("button", { name: /^Tester/ })[0]!;

  test("is closed until pressed: the email and Keluar are not in the page", async () => {
    await open();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Keluar" })).toBeNull();
    expect(screen.queryByText("tester@contoh.test")).toBeNull();
  });

  test("opens with the email and Keluar, and the button says it controls the panel", async () => {
    await open();
    await openUserMenu();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    const panelId = trigger().getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expect(within(document.getElementById(panelId!)!).getByText("tester@contoh.test")).toBeTruthy();
  });

  test("pressing the button again closes it", async () => {
    const user = userEvent.setup();
    await open();
    await openUserMenu();
    await user.click(trigger());
    expect(screen.queryByRole("button", { name: "Keluar" })).toBeNull();
  });

  test("Escape closes it and focus goes back to its button", async () => {
    const user = userEvent.setup();
    await open();
    const keluar = await openUserMenu();
    keluar.focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Keluar" })).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  test("a press outside closes it, also on text that takes no focus", async () => {
    const user = userEvent.setup();
    await open();
    await openUserMenu();
    // The breadcrumb is in no focusable area (the page is: <main> takes focus), so the press moves no focus and only
    // the press itself can tell the menu.
    await user.click(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(screen.queryByRole("button", { name: "Keluar" })).toBeNull();
  });

  test("a press inside it, on its text, keeps it open", async () => {
    const user = userEvent.setup();
    await open();
    await openUserMenu();
    await user.click(screen.getByText("tester@contoh.test"));
    expect(screen.getByRole("button", { name: "Keluar" })).toBeTruthy();
  });

  test("Tab from Keluar to something outside closes it", async () => {
    const user = userEvent.setup();
    await open();
    const keluar = await openUserMenu();
    keluar.focus();
    await user.tab();
    expect(screen.queryByRole("button", { name: "Keluar" })).toBeNull();
  });

  test("on the rail the avatar alone shows, and the button is still named after the user", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(toggle());
    expect(trigger().textContent).toContain("TE");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(trigger().querySelector(".sr-only")?.textContent).toContain("Tester");
  });
});

describe("the top bar", () => {
  test("the breadcrumb names the group and the entry, and marks the page", async () => {
    await open("/applications");
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(await crumbs.findByText("Pendaftaran")).toBeTruthy();
    expect(crumbs.getByText("Pendaftar").getAttribute("aria-current")).toBe("page");
  });

  test("below an entry, the entry links back to its list", async () => {
    await open("/blog/new");
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getByRole("link", { name: "Blog" }).getAttribute("href")).toBe("/blog");
  });

  test("an unknown page has no breadcrumb", async () => {
    await open("/tidak-ada");
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
  });

  test("crumbsFor", () => {
    expect(crumbsFor("/")).toEqual([{ label: "Dashboard", href: undefined }]);
    expect(crumbsFor("/blog")).toEqual([{ label: "Konten Situs" }, { label: "Blog", href: undefined }]);
    expect(crumbsFor("/blog/")).toEqual([{ label: "Konten Situs" }, { label: "Blog", href: undefined }]);
    expect(crumbsFor("/blog/abc/edit")).toEqual([{ label: "Konten Situs" }, { label: "Blog", href: "/blog" }]);
    expect(crumbsFor("/nope")).toEqual([]);
  });

  test("Lihat situs opens the public site in a new tab, and says so", async () => {
    await open();
    const link = screen.getByRole("link", { name: "Lihat situs (tab baru)" });
    expect(link.getAttribute("href")).toBe("https://sakolakembara.org");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
