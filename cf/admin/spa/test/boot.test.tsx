import { readFileSync } from "node:fs";
import path from "node:path";
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { asideClass, HEADER_CLASS, MOBILE_BAR_CLASS } from "~/components/shell-parts";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

// What the page shows from its first byte until the shell is there (SAKEM-115, the load sequence): the frame drawn in
// plain CSS by spa/index.html (`#boot`), the same frame drawn by React while `GET /api/me` is on its way
// (`ShellSkeleton`), then the shell filling in, and the dashboard asked for together with the session.

const KEY = "sakem-admin:sidebar";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const INDEX = readFileSync(path.join(HERE, "../index.html"), "utf8");
const APP = readFileSync(path.join(HERE, "../src/App.tsx"), "utf8");

beforeEach(() => window.localStorage.clear());

const dashboard = { attention: { pendingApplications: { count: 7, to: "/applications?status=pending" } } };

describe("while the session is on its way", () => {
  test("the frame is there with its brand and a spinner, and no menu, no page and no landmark yet", async () => {
    const me = deferred<Response>();
    stubApi({ "GET /api/me": () => me.promise, "GET /api/dashboard": respond(dashboard) });
    renderApp("/");
    expect(screen.getByRole("status").textContent).toBe("Memuat…");
    expect(screen.queryByRole("navigation", { name: "Menu utama" })).toBeNull();
    // The sidebar is a navy column with the brand in it, drawn for the eye only.
    const aside = document.querySelector("aside")!;
    expect(aside.getAttribute("aria-hidden")).toBe("true");
    expect(aside.className).toContain("bg-sidebar");
    expect(aside.textContent).toContain("Sakola Kembara");
    // The page's own landmark comes with the shell: a second one that is replaced at once would be announced twice.
    expect(screen.queryByRole("main")).toBeNull();

    await act(async () => me.resolve(respond(meBody("super_admin"))));
    expect(await screen.findByRole("navigation", { name: "Menu utama" })).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
  });

  test("the sidebar is as wide as the person left it: 248 px, or the 72 px rail", () => {
    stubApi({ "GET /api/me": () => new Promise<Response>(() => {}) });
    const first = renderApp("/");
    expect(document.querySelector("aside")!.className).toContain("md:w-[248px]");
    first.unmount();

    window.localStorage.setItem(KEY, "collapsed");
    renderApp("/");
    const aside = document.querySelector("aside")!;
    expect(aside.className).toContain("md:w-[72px]");
    // The rail shows the mark only; the name stays for screen readers (it is hidden from them here anyway).
    expect(within(aside).getByText("Sakola Kembara").parentElement!.className).toContain("sr-only");
  });

  test("the pieces both frames are built from are shared with the shell, so the skeleton cannot drift", async () => {
    const me = deferred<Response>();
    stubApi({ "GET /api/me": () => me.promise, "GET /api/dashboard": respond(dashboard) });
    renderApp("/");
    const skeleton = { aside: document.querySelector("aside")!.className, header: document.querySelector("header")!.className, bar: document.querySelector("aside")!.previousElementSibling!.className };
    expect(skeleton).toEqual({ aside: asideClass(false), header: HEADER_CLASS, bar: MOBILE_BAR_CLASS });
    await act(async () => me.resolve(respond(meBody("super_admin"))));
    await screen.findByRole("navigation", { name: "Menu utama" });
    expect(document.querySelector("aside")!.className).toBe(skeleton.aside);
    expect(document.querySelector("header")!.className).toBe(skeleton.header);
  });
});

describe("the frame spa/index.html draws before any script", () => {
  test("its sizes are those of the parts it stands in for", () => {
    expect(INDEX).toContain("width: 248px"); // the sidebar
    expect(INDEX).toContain('.style.width = "72px"'); // the rail
    expect(INDEX).toContain("height: 56px"); // the top bar: h-14
    expect(INDEX).toContain("height: 52px"); // the phone's bar: 4 + the 44 px menu button + 4
    expect(asideClass(false)).toContain("md:w-[248px]");
    expect(asideClass(true)).toContain("md:w-[72px]");
    expect(HEADER_CLASS).toContain("h-14");
    expect(MOBILE_BAR_CLASS).toContain("py-1");
  });

  /** Runs the page's own inline script on a page at `pathname`, with the frame in place, as the browser does before the module script. */
  function runInlineScript(pathname: string) {
    window.history.pushState({}, "", pathname);
    document.body.innerHTML = `<div id="root">${/<div id="boot"[\s\S]*?<\/div><\/div><\/div>/.exec(INDEX)![0]}</div>`;
    const script = /<script>([\s\S]*?)<\/script>/.exec(INDEX)![1]!;
    new Function(script)();
    return document.getElementById("boot");
  }

  afterEach(() => {
    document.body.innerHTML = "";
    window.history.pushState({}, "", "/");
  });

  test("a signed-in page keeps it; the sign-in pages lose it, and every route open to anyone is one of them", () => {
    expect(runInlineScript("/")).not.toBeNull();
    expect(runInlineScript("/blog")).not.toBeNull();
    expect(runInlineScript("/settings/u1/edit")).not.toBeNull();
    // The routes before `RequireAuth` in App.tsx are the ones open to anyone.
    const open = [...APP.slice(0, APP.indexOf("<RequireAuth />")).matchAll(/<Route path="(\/[^"]*)"/g)].map((match) => match[1]!);
    expect(open.sort()).toEqual(["/auth/error", "/forgot-password", "/login", "/reset-password", "/verify-email"]);
    for (const route of open) expect(runInlineScript(route), route).toBeNull();
    // A trailing slash is the same page; a page that merely starts like one is not.
    expect(runInlineScript("/login/")).toBeNull();
    expect(runInlineScript("/loginx")).not.toBeNull();
  });

  test("an icon rail that was kept makes the aside 72 px wide at once; storage that throws leaves 248 px", () => {
    window.localStorage.setItem(KEY, "collapsed");
    expect((runInlineScript("/")!.querySelector(".boot-aside") as HTMLElement).style.width).toBe("72px");
    window.localStorage.clear();
    expect((runInlineScript("/")!.querySelector(".boot-aside") as HTMLElement).style.width).toBe("");

    const original = Object.getOwnPropertyDescriptor(Storage.prototype, "getItem")!;
    Object.defineProperty(Storage.prototype, "getItem", {
      configurable: true,
      value: () => {
        throw new Error("blocked");
      },
    });
    try {
      expect(runInlineScript("/")).not.toBeNull();
    } finally {
      Object.defineProperty(Storage.prototype, "getItem", original);
    }
  });
});

describe("the dashboard leaves with the session", () => {
  test("it is asked for before the session has answered, and once", async () => {
    const me = deferred<Response>();
    const api = stubApi({ "GET /api/me": () => me.promise, "GET /api/dashboard": respond(dashboard) });
    renderApp("/");
    await waitFor(() => expect(api.count("GET /api/dashboard")).toBe(1));
    expect(api.count("GET /api/me")).toBe(1);

    await act(async () => me.resolve(respond(meBody("super_admin"))));
    await screen.findByRole("navigation", { name: "Menu utama" });
    // The badge is there with the shell, from the answer that was already in.
    expect(await screen.findByText(", 7 menunggu")).toBeTruthy();
    expect(api.count("GET /api/dashboard")).toBe(1);
  });

  test("a shell that mounts while it is still on its way joins it instead of asking again", async () => {
    const me = deferred<Response>();
    const slow = deferred<Response>();
    const api = stubApi({ "GET /api/me": () => me.promise, "GET /api/dashboard": () => slow.promise });
    renderApp("/");
    await waitFor(() => expect(api.count("GET /api/dashboard")).toBe(1));
    await act(async () => me.resolve(respond(meBody("super_admin"))));
    await screen.findByRole("navigation", { name: "Menu utama" });
    expect(api.count("GET /api/dashboard")).toBe(1);
    await act(async () => slow.resolve(respond(dashboard)));
    expect(await screen.findByText(", 7 menunggu")).toBeTruthy();
    expect(api.count("GET /api/dashboard")).toBe(1);
  });

  test("a server without the dashboard is asked once too (the 404 is the answer of this visit)", async () => {
    const api = stubApi({ "GET /api/me": respond(meBody("viewer")), "GET /api/dashboard": respond({ error: "not_found" }, 404) });
    renderApp("/");
    await screen.findByRole("navigation", { name: "Menu utama" });
    await act(async () => {});
    expect(api.count("GET /api/dashboard")).toBe(1);
  });

  test("a write while it is on its way brings a new request: the answer that left before the write is not joined", async () => {
    const old = deferred<Response>();
    let asked = 0;
    const api = stubApi({
      "GET /api/me": respond(meBody("super_admin")),
      "GET /api/dashboard": () => (++asked === 1 ? old.promise : Promise.resolve(respond({ attention: { pendingApplications: { count: 9, to: "/applications?status=pending" } } }))),
      "POST /api/ping": respond({ ok: true }),
    });
    renderApp("/");
    await screen.findByRole("navigation", { name: "Menu utama" });
    expect(api.count("GET /api/dashboard")).toBe(1);
    const { api: callApi } = await import("~/lib/api");
    await act(async () => void (await callApi("/api/ping", { method: "POST", json: {} })));
    await waitFor(() => expect(api.count("GET /api/dashboard")).toBe(2));
    expect(await screen.findByText(", 9 menunggu")).toBeTruthy();
    // The old answer comes in late and is not what the screen shows.
    await act(async () => old.resolve(respond(dashboard)));
    expect(screen.queryByText(", 7 menunggu")).toBeNull();
  });

  test("asking again later still asks: a write brings a new request and its answer", async () => {
    const api = stubApi({
      "GET /api/me": respond(meBody("super_admin")),
      "GET /api/dashboard": respond(dashboard),
      "POST /api/ping": respond({ ok: true }),
    });
    renderApp("/");
    await screen.findByText(", 7 menunggu");
    expect(api.count("GET /api/dashboard")).toBe(1);
    const { api: callApi } = await import("~/lib/api");
    await act(async () => void (await callApi("/api/ping", { method: "POST", json: {} })));
    await waitFor(() => expect(api.count("GET /api/dashboard")).toBe(2));
  });
});
