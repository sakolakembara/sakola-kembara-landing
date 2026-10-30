import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { meBody, openUserMenu, renderApp, respond, stubApi } from "./helpers";

async function ready(path = "/") {
  stubApi({
    "GET /api/me": respond(meBody("super_admin")),
    "GET /api/dashboard": respond({ error: "not_found" }, 404),
  });
  renderApp(path);
  return screen.findByRole("button", { name: "Buka menu" });
}

const dialog = () => screen.getByRole("dialog", { name: "Menu navigasi" });

describe("mobile drawer", () => {
  test("is closed until the menu button is pressed", async () => {
    const opener = await ready();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener.getAttribute("aria-expanded")).toBe("false");
    expect(opener.getAttribute("aria-haspopup")).toBe("dialog");
  });

  test("opens as a modal dialog with the same menu, and focus moves inside", async () => {
    const user = userEvent.setup();
    const opener = await ready();
    await user.click(opener);

    const panel = dialog();
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(opener.getAttribute("aria-expanded")).toBe("true");
    expect(within(panel).getByRole("navigation", { name: "Menu utama" })).toBeTruthy();
    expect(within(panel).getAllByRole("link")).toHaveLength(12);
    // The first thing to reach is the close button.
    expect(document.activeElement).toBe(within(panel).getByRole("button", { name: "Tutup menu" }));
  });

  test("Tab stays inside and wraps from the last control to the first, and back", async () => {
    const user = userEvent.setup();
    await user.click(await ready());
    const panel = dialog();
    const focusable = [...panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    expect(first).toBe(within(panel).getByRole("button", { name: "Tutup menu" }));
    // The user menu is closed: its button is the last control, Keluar is not in the page yet.
    expect(last).toBe(within(panel).getByRole("button", { name: /^Tester/ }));

    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(first);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);

    // A full lap never leaves the panel.
    for (let step = 0; step < focusable.length + 2; step++) {
      await user.tab();
      expect(panel.contains(document.activeElement)).toBe(true);
    }
  });

  test("Tab does not escape when focus was lost to the page", async () => {
    const user = userEvent.setup();
    await user.click(await ready());
    (document.activeElement as HTMLElement).blur();
    await user.tab();
    expect(dialog().contains(document.activeElement)).toBe(true);
  });

  test("Escape closes it and focus goes back to the menu button", async () => {
    const user = userEvent.setup();
    const opener = await ready();
    await user.click(opener);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
    expect(opener.getAttribute("aria-expanded")).toBe("false");
  });

  test("focus still goes back to the menu button when it was not focused on open (Safari does not focus a tapped button)", async () => {
    const user = userEvent.setup();
    const opener = await ready();
    opener.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(opener); // a tap that does not focus the button
    expect(dialog()).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  test("the close button closes it and focus goes back to the menu button", async () => {
    const user = userEvent.setup();
    const opener = await ready();
    await user.click(opener);
    await user.click(within(dialog()).getByRole("button", { name: "Tutup menu" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  test("tapping the backdrop closes it", async () => {
    const user = userEvent.setup();
    await user.click(await ready());
    const backdrop = dialog().previousElementSibling as HTMLElement;
    expect(backdrop.getAttribute("aria-hidden")).toBe("true");
    await user.click(backdrop);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("following a link closes it and lands on the new page's content", async () => {
    const user = userEvent.setup();
    await user.click(await ready());
    await user.click(within(dialog()).getByRole("link", { name: "Tim" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByRole("heading", { level: 1, name: "Tim" })).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/team");
    // Not back on the menu button: the page asked for the focus.
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  test("choosing the page you are already on still closes it", async () => {
    const user = userEvent.setup();
    const opener = await ready("/team");
    await user.click(opener);
    await user.click(within(dialog()).getByRole("link", { name: "Tim" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  test("the page behind it is inert and cannot scroll while it is open", async () => {
    const user = userEvent.setup();
    const opener = await ready();
    await user.click(opener);
    expect(screen.getByRole("main").hasAttribute("inert")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");

    await user.keyboard("{Escape}");
    expect(screen.getByRole("main").hasAttribute("inert")).toBe(false);
    expect(document.body.style.overflow).toBe("");
  });

  test("the current page is marked in the drawer too", async () => {
    const user = userEvent.setup();
    await user.click(await ready("/reports"));
    const current = within(dialog()).getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual(["Laporan"]);
  });

  test("the user menu is in the drawer too: it opens there, and Tab still cannot leave", async () => {
    const user = userEvent.setup();
    await user.click(await ready());
    const panel = dialog();
    const keluar = await openUserMenu(panel);
    expect(within(panel).getByText("tester@contoh.test")).toBeTruthy();
    // Keluar is now the last control: Tab from it wraps to the close button.
    keluar.focus();
    await user.tab();
    expect(document.activeElement).toBe(within(panel).getByRole("button", { name: "Tutup menu" }));
  });
});
