import { fakeTurnstile, SCRIPT_SELECTOR } from "@shared/spa/test/fake-turnstile";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ENDPOINTS } from "~/lib/paths";
import { renderApp, respond, stubApi } from "./helpers";

// The security check (Turnstile) on the portal's four forms (docs/cloudflare/portal-architecture.md#63-turnstile-and-rate-limits):
// the page names its own action, the button waits for the token, the token goes in the header, and a token works once.
// The widget and its state are shared with the admin (shared/spa); these pin the portal's use of them.

const withKey = (extra: Record<string, Response> = {}) => ({ [`GET ${ENDPOINTS.config}`]: respond({ google: false, turnstileSiteKey: "site-key", siteUrl: "" }), ...extra });

async function type(user: ReturnType<typeof userEvent.setup>, label: string, text: string) {
  await user.type(screen.getByLabelText(label), text);
}

describe("sign-in", () => {
  test("action `login`; waits for the token; sends it in the header; the widget is reset for the next one", async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    turnstile.preload();
    const api = stubApi(withKey({ [`POST ${ENDPOINTS.signIn}`]: respond({ code: "INVALID_EMAIL_OR_PASSWORD" }, 401) }));
    renderApp("/portal/login");
    await screen.findByRole("heading", { name: "Selamat datang kembali" });
    await type(user, "Email", "sari@contoh.test");
    await type(user, "Password", "x");
    expect(await screen.findByRole("button", { name: "Memeriksa…" })).toHaveProperty("disabled", true);
    const widget = await turnstile.drawn("login");
    expect(widget.options.sitekey).toBe("site-key");

    turnstile.solve("token-1");
    await user.click(await screen.findByRole("button", { name: "Masuk" }));
    await screen.findByRole("alert");
    expect(api.last(`POST ${ENDPOINTS.signIn}`)?.headers["x-turnstile-token"]).toBe("token-1");
    expect(turnstile.current().resets).toBe(1);
    // The spent token is gone: the button waits for a new one.
    expect(await screen.findByRole("button", { name: "Memeriksa…" })).toHaveProperty("disabled", true);
  });

  test("an expired token is not sent: the button waits for a fresh one", async () => {
    const turnstile = fakeTurnstile();
    turnstile.preload();
    stubApi(withKey());
    renderApp("/portal/login");
    await screen.findByRole("button", { name: "Memeriksa…" });
    await turnstile.drawn("login");
    turnstile.solve("token-1");
    await screen.findByRole("button", { name: "Masuk" });
    turnstile.expire();
    expect(await screen.findByRole("button", { name: "Memeriksa…" })).toHaveProperty("disabled", true);
  });
});

describe("a form submitted by a script before the token arrives sends nothing (the button is disabled, but a script does not press it)", () => {
  test("sign-in", async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    turnstile.preload();
    const api = stubApi(withKey({ [`POST ${ENDPOINTS.signIn}`]: respond({ redirect: true }) }));
    renderApp("/portal/login");
    await screen.findByRole("heading", { name: "Selamat datang kembali" });
    await type(user, "Email", "sari@contoh.test");
    await type(user, "Password", "x");
    await screen.findByRole("button", { name: "Memeriksa…" });
    (screen.getByLabelText("Email").closest("form") as HTMLFormElement).requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.count(`POST ${ENDPOINTS.signIn}`)).toBe(0);
  });

  test("registration", async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    turnstile.preload();
    const api = stubApi(withKey({ [`POST ${ENDPOINTS.register}`]: respond({ ok: true }) }));
    renderApp("/portal/register");
    await screen.findByRole("heading", { name: "Daftar akun baru" });
    await type(user, "Nama lengkap", "Sari Dewi");
    await type(user, "Email", "sari@contoh.test");
    await type(user, "Password", "rahasia123");
    await type(user, "Ulangi password", "rahasia123");
    await screen.findByRole("button", { name: "Memeriksa…" });
    (screen.getByLabelText("Email").closest("form") as HTMLFormElement).requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.count(`POST ${ENDPOINTS.register}`)).toBe(0);
  });

  test("forgot password", async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    turnstile.preload();
    const api = stubApi(withKey({ [`POST ${ENDPOINTS.requestReset}`]: respond({ status: true }) }));
    renderApp("/portal/forgot-password");
    await screen.findByRole("heading", { name: "Lupa password?" });
    await type(user, "Email", "sari@contoh.test");
    await screen.findByRole("button", { name: "Memeriksa…" });
    (screen.getByLabelText("Email").closest("form") as HTMLFormElement).requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.count(`POST ${ENDPOINTS.requestReset}`)).toBe(0);
  });

  test("'Kirim ulang tautan'", async () => {
    const turnstile = fakeTurnstile();
    turnstile.preload();
    const api = stubApi({
      [`GET ${ENDPOINTS.me}`]: respond({ user: { id: "u1", name: "Sari", email: "sari@contoh.test", emailVerified: false, role: "student" } }),
      [`GET ${ENDPOINTS.overview}`]: respond({ now: "2026-10-13T03:00:00.000Z", student: { name: "Sari", firstName: "Sari" }, openBatch: null, current: { state: "none" }, history: [] }),
      ...withKey({ [`POST ${ENDPOINTS.sendVerification}`]: respond({ status: true }) }),
    });
    renderApp("/portal/");
    const button = (await screen.findByRole("button", { name: "Memeriksa…" })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    button.closest("form")!.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.count(`POST ${ENDPOINTS.sendVerification}`)).toBe(0);
  });
});

describe("registration", () => {
  test("action `register`; the token goes in the header", async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    turnstile.preload();
    const api = stubApi(withKey({ [`POST ${ENDPOINTS.register}`]: respond({ ok: true }) }));
    renderApp("/portal/register");
    await screen.findByRole("heading", { name: "Daftar akun baru" });
    expect(await screen.findByRole("button", { name: "Memeriksa…" })).toHaveProperty("disabled", true);
    await turnstile.drawn("register");
    turnstile.solve("token-reg");
    await type(user, "Nama lengkap", "Sari Dewi");
    await type(user, "Email", "sari@contoh.test");
    await type(user, "Password", "rahasia123");
    await type(user, "Ulangi password", "rahasia123");
    await user.click(await screen.findByRole("button", { name: "Daftar" }));
    await screen.findByRole("heading", { name: "Cek email kamu" });
    expect(api.last(`POST ${ENDPOINTS.register}`)?.headers["x-turnstile-token"]).toBe("token-reg");
  });

  test("a refusal of the check is said, and the next try needs a fresh token", async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    turnstile.preload();
    stubApi(withKey({ [`POST ${ENDPOINTS.register}`]: respond({ error: "captcha_failed" }, 403) }));
    renderApp("/portal/register");
    await screen.findByRole("button", { name: "Memeriksa…" });
    await turnstile.drawn("register");
    turnstile.solve("token-reg");
    await type(user, "Nama lengkap", "Sari Dewi");
    await type(user, "Email", "sari@contoh.test");
    await type(user, "Password", "rahasia123");
    await type(user, "Ulangi password", "rahasia123");
    await user.click(await screen.findByRole("button", { name: "Daftar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Verifikasi keamanan gagal. Tunggu pemeriksaan selesai, lalu coba lagi.");
    expect(turnstile.current().resets).toBe(1);
    expect(await screen.findByRole("button", { name: "Memeriksa…" })).toHaveProperty("disabled", true);
  });
});

describe("the widget that cannot run", () => {
  test("the page says so (the button would otherwise wait with no reason), and the form is not sent", async () => {
    const turnstile = fakeTurnstile();
    stubApi(withKey());
    renderApp("/portal/register");
    await screen.findByRole("heading", { name: "Daftar akun baru" });
    await turnstile.failScript();
    expect((await screen.findByRole("alert")).textContent).toBe("Pemeriksaan keamanan tidak dapat dijalankan. Periksa koneksi internet, lalu muat ulang halaman.");
    // Not "Memeriksa…": nothing is being checked any more. The button just stays shut.
    expect(screen.getByRole("button", { name: "Daftar" })).toHaveProperty("disabled", true);
  });

  test("a deployment with no site key shows no widget and waits for nothing", async () => {
    stubApi({ [`GET ${ENDPOINTS.config}`]: respond({ google: false, turnstileSiteKey: null, siteUrl: "" }) });
    renderApp("/portal/login");
    await screen.findByRole("heading", { name: "Selamat datang kembali" });
    expect((screen.getByRole("button", { name: "Masuk" }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
  });

  test("in the portal's mock (VITE_PORTAL_MOCK) Cloudflare's script is never fetched", async () => {
    vi.stubEnv("VITE_PORTAL_MOCK", "true");
    stubApi(withKey());
    renderApp("/portal/login");
    await screen.findByRole("heading", { name: "Selamat datang kembali" });
    expect((await screen.findByRole("alert")).textContent).toContain("Pemeriksaan keamanan tidak dapat dijalankan");
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
  });

  test("outside the mock the script is requested", async () => {
    stubApi(withKey());
    renderApp("/portal/login");
    await waitFor(() => expect(document.querySelector(SCRIPT_SELECTOR)).not.toBeNull());
  });
});
