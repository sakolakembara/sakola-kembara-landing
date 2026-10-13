import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { ENDPOINTS } from "~/lib/paths";
import { meBody, overviewBody, renderApp, respond, SIGNED_IN, stubApi } from "./helpers";

const applications = { [`GET ${ENDPOINTS.applications}`]: respond({ items: [] }) };

async function openPortal(path = "/portal/", routes: Parameters<typeof stubApi>[0] = {}) {
  const api = stubApi({ ...SIGNED_IN, ...applications, ...routes });
  renderApp(path);
  await screen.findByRole("navigation", { name: "Menu portal" });
  return api;
}

describe("the nav", () => {
  test("the two pages, under /portal, once each (one list for every width, not two)", async () => {
    await openPortal();
    const nav = screen.getByRole("navigation", { name: "Menu portal" });
    expect(within(nav).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Beranda", "/portal"],
      ["Status Pendaftaran", "/portal/status"],
    ]);
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
  });

  test("the page the student is on is marked, and only that one", async () => {
    await openPortal("/portal/status");
    expect(screen.getByRole("link", { name: "Status Pendaftaran" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Beranda" }).getAttribute("aria-current")).toBeNull();
  });

  test("Beranda is current on the front page only: not on /status, and not on the wizard either (the legacy rule)", async () => {
    await openPortal("/portal/");
    expect(screen.getByRole("link", { name: "Beranda" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Status Pendaftaran" }).getAttribute("aria-current")).toBeNull();
  });

  test("on the wizard's page no entry is marked", async () => {
    await openPortal("/portal/daftar");
    for (const link of within(screen.getByRole("navigation", { name: "Menu portal" })).getAllByRole("link")) {
      expect(link.getAttribute("aria-current"), link.textContent ?? "").toBeNull();
    }
  });

  test("the brand goes to the public site with a plain link (another Worker), not to the router's /portal", async () => {
    await openPortal();
    const brand = screen.getByRole("img", { name: "Sakola Kembara" }).closest("a")!;
    expect(brand.getAttribute("href")).toBe("/");
  });

  test("shows who is signed in: the name, else the email", async () => {
    await openPortal();
    expect(screen.getByText("Masuk sebagai")).toBeTruthy();
    expect(screen.getByText("Sari Dewi", { selector: "[title]" })).toBeTruthy();
  });

  test("an account without a name shows its email", async () => {
    await openPortal("/portal/", { [`GET ${ENDPOINTS.me}`]: respond(meBody("student", { name: "  " })) });
    expect(screen.getByText("sari@contoh.test", { selector: "[title]" })).toBeTruthy();
  });
});

describe("the nav with the keyboard and a screen reader", () => {
  test("Tab goes brand, Beranda, Status Pendaftaran, Keluar, in that order", async () => {
    const user = userEvent.setup();
    await openPortal();
    const order = [
      screen.getByRole("link", { name: "Sakola Kembara" }),
      screen.getByRole("link", { name: "Beranda" }),
      screen.getByRole("link", { name: "Status Pendaftaran" }),
      screen.getByRole("button", { name: "Keluar" }),
    ];
    screen.getByRole("link", { name: "Lewati ke konten" }).focus();
    for (const element of order) {
      await user.tab();
      expect(document.activeElement).toBe(element);
    }
  });

  test("Enter on a link goes there, and focus moves to the content so a reader starts at the new page", async () => {
    const user = userEvent.setup();
    await openPortal();
    screen.getByRole("link", { name: "Status Pendaftaran" }).focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("heading", { level: 1, name: "Rekap perjalanan pendaftaranmu" });
    expect(screen.getByTestId("location").textContent).toBe("/status");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("main")));
  });

  test("the first page does not steal focus when it opens", async () => {
    await openPortal();
    expect(document.activeElement).toBe(document.body);
  });

  test("'Lewati ke konten' points at the main region", async () => {
    await openPortal();
    const skip = screen.getByRole("link", { name: "Lewati ke konten" });
    expect(skip.getAttribute("href")).toBe("#isi");
    expect(screen.getByRole("main").id).toBe("isi");
  });

  test("'Keluar' has its name on every width (icon-only on a phone), and is a real button", async () => {
    await openPortal();
    const button = screen.getByRole("button", { name: "Keluar" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    // The icon is decoration.
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  test("Enter on 'Keluar' signs out, once even if pressed twice, and goes to /login", async () => {
    const user = userEvent.setup();
    const api = await openPortal("/portal/", { [`POST ${ENDPOINTS.signOut}`]: respond({ success: true }) });
    const button = screen.getByRole("button", { name: "Keluar" });
    button.focus();
    await user.keyboard("{Enter}{Enter}");
    expect(await screen.findByRole("heading", { name: "Selamat datang kembali" })).toBeTruthy();
    expect(api.count(`POST ${ENDPOINTS.signOut}`)).toBe(1);
    expect(api.last(`POST ${ENDPOINTS.signOut}`)?.body).toEqual({});
  });

  test("the page's own name is announced: one h1, and the tab title follows", async () => {
    await openPortal("/portal/", { [`GET ${ENDPOINTS.overview}`]: respond(overviewBody()) });
    expect(await screen.findByRole("heading", { level: 1, name: "Selamat datang, Sari" })).toBeTruthy();
  });
});
