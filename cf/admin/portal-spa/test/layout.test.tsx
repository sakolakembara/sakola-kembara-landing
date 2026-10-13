import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { ENDPOINTS } from "~/lib/paths";
import { renderApp, respond, stubApi } from "./helpers";

// Dzul's requirement (SAKEM-083): the portal's sign-in, registration, forgot, reset and verification pages follow the
// admin's login layout: a narrow column in the middle of a white page, no card, the brand name once, one heading and
// one description, the form on top, then the "atau" rule and the Google button. The layout itself is
// shared/spa/AuthShell.tsx; these tests pin that every portal page really uses it, so a page that grows its own card
// or a second heading is noticed.

const config = { [`GET ${ENDPOINTS.config}`]: respond({ google: true, turnstileSiteKey: null, siteUrl: "" }) };

const PAGES = [
  ["login", "/portal/login"],
  ["register", "/portal/register"],
  ["forgot password", "/portal/forgot-password"],
  ["reset password (the form)", "/portal/reset-password?token=abc"],
  ["reset password (no token)", "/portal/reset-password"],
  ["verification result", "/portal/verify-email?status=success"],
  ["verification failure", "/portal/verify-email?error=INVALID_TOKEN"],
  ["OAuth error", "/portal/auth/error?error=access_denied"],
] as const;

async function open(path: string) {
  stubApi(config);
  renderApp(path);
  await screen.findByRole("heading", { level: 1 });
  return screen.getByRole("main");
}

describe.each(PAGES)("the %s page", (_name, path) => {
  test("is a narrow centered column on a plain white page", async () => {
    const main = await open(path);
    expect(main.className).toContain("bg-white");
    expect(main.className).toContain("min-h-screen");
    expect(main.className).toContain("items-center");
    const column = main.querySelector(".sm\\:max-w-sm");
    expect(column).not.toBeNull();
    expect(column!.className).toContain("sm:mx-auto");
  });

  test("has no card: no shadow, no big rounded surface, no tinted panel", async () => {
    const main = await open(path);
    const classes = [main, ...main.querySelectorAll("*")].map((element) => element.getAttribute("class") ?? "").join(" ");
    expect(classes).not.toMatch(/\bshadow(-\w+)?\b/);
    expect(classes).not.toMatch(/\brounded-(2xl|3xl)\b/);
    expect(classes).not.toMatch(/\bbg-gray-50\b/);
  });

  test("has exactly one heading, an h1, first in the column", async () => {
    const main = await open(path);
    const headings = main.querySelectorAll("h1, h2, h3, h4, h5, h6");
    expect(headings).toHaveLength(1);
    expect(headings[0]!.tagName).toBe("H1");
    expect(main.querySelector(".sm\\:max-w-sm")!.firstElementChild).toBe(headings[0]);
  });

  test("says the brand name at most once", async () => {
    const main = await open(path);
    expect((main.textContent!.match(/Sakola Kembara/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  test("has no menu and no footer of the portal around it (a sign-in page is not the signed-in portal)", async () => {
    await open(path);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("banner")).toBeNull();
  });
});

describe("the form on top, then the rule, then Google", () => {
  test.each([
    ["login", "/portal/login", "Masuk dengan Google"],
    ["register", "/portal/register", "Daftar dengan Google"],
  ])("%s", async (_name, path, label) => {
    await open(path);
    const google = await screen.findByRole("button", { name: label });
    const rule = screen.getByText("atau");
    const form = document.querySelector("form")!;
    const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(form, rule)).toBe(true);
    expect(follows(rule, google)).toBe(true);
  });
});

describe("the states of a page keep the layout too", () => {
  test("after a registration", async () => {
    const user = userEvent.setup();
    stubApi({ ...config, [`POST ${ENDPOINTS.register}`]: respond({ ok: true }) });
    renderApp("/portal/register");
    await screen.findByRole("heading", { name: "Daftar akun baru" });
    await user.type(screen.getByLabelText("Nama lengkap"), "Sari Dewi");
    await user.type(screen.getByLabelText("Email"), "sari@contoh.test");
    await user.type(screen.getByLabelText("Password"), "rahasia123");
    await user.type(screen.getByLabelText("Ulangi password"), "rahasia123");
    await user.click(screen.getByRole("button", { name: "Daftar" }));
    await screen.findByRole("heading", { name: "Cek email kamu" });
    const main = screen.getByRole("main");
    expect(main.className).toContain("bg-white");
    expect(main.querySelectorAll("h1, h2, h3")).toHaveLength(1);
    expect(main.innerHTML).not.toMatch(/shadow|rounded-2xl/);
  });

  test("after a sign-in on an address that is not verified", async () => {
    const user = userEvent.setup();
    stubApi({ ...config, [`POST ${ENDPOINTS.signIn}`]: respond({ code: "EMAIL_NOT_VERIFIED" }, 403) });
    renderApp("/portal/login");
    await screen.findByRole("heading", { name: "Selamat datang kembali" });
    await user.type(screen.getByLabelText("Email"), "sari@contoh.test");
    await user.type(screen.getByLabelText("Password"), "x");
    await user.click(screen.getByRole("button", { name: "Masuk" }));
    await screen.findByRole("heading", { name: "Verifikasi email kamu" });
    const main = screen.getByRole("main");
    expect(main.className).toContain("bg-white");
    expect(main.querySelectorAll("h1, h2, h3")).toHaveLength(1);
    expect(main.innerHTML).not.toMatch(/shadow|rounded-2xl/);
  });
});
