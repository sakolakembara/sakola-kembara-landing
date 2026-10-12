import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import {
  CAPTCHA_FAILED_MESSAGE,
  CAPTCHA_UNAVAILABLE_MESSAGE,
  EMAIL_UNAVAILABLE_MESSAGE,
  RESET_REQUESTED_MESSAGE,
  WIDGET_ERROR_MESSAGE,
} from "~/lib/auth-errors";
import { loadTurnstile, TURNSTILE_SCRIPT_SRC } from "~/lib/turnstile";
import { type FakeTurnstile, fakeTurnstile, SCRIPT_SELECTOR } from "./fake-turnstile";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

// The security check (Cloudflare Turnstile) on the pages that send a password
// or an email. Cloudflare's script is never loaded: test/fake-turnstile.ts
// plays it. What the Worker does with the token is tested in the Worker's suite
// (test/gate.test.ts, test/spa-contract.test.ts).

const SITE_KEY = "1x00000000000000000000AA";
const withKey = (extra: Record<string, unknown> = {}) => ({
  "GET /api/config": respond({ google: false, turnstileSiteKey: SITE_KEY, ...extra }),
});
const TOKEN_HEADER = "x-turnstile-token";
/** Lets the page read an answer that has already arrived. */
const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));

describe("login", () => {
  const email = () => screen.getByLabelText("Email") as HTMLInputElement;
  const password = () => screen.getByLabelText("Password") as HTMLInputElement;
  const button = () => screen.getByRole("button", { name: /^(Masuk|Memproses…|Memeriksa…)$/ }) as HTMLButtonElement;

  async function open(turnstile: FakeTurnstile, routes: Parameters<typeof stubApi>[0] = {}) {
    const api = stubApi({ ...withKey(), ...routes });
    renderApp("/login");
    await screen.findByRole("heading", { name: "Masuk ke Admin Sakola Kembara" });
    await turnstile.loadScript();
    return api;
  }
  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.type(email(), "ani@contoh.test");
    await user.type(password(), "kata sandi saya");
  }

  test("draws the widget with the site key and this page's action, in the light theme", async () => {
    const turnstile = fakeTurnstile();
    await open(turnstile);
    expect(turnstile.widgets).toHaveLength(1);
    expect(turnstile.current().options).toMatchObject({
      sitekey: SITE_KEY,
      action: "login",
      theme: "light",
      size: "flexible",
      language: "id",
    });
    // The page loaded Cloudflare's script, once, with explicit rendering.
    expect(document.querySelectorAll(SCRIPT_SELECTOR)).toHaveLength(1);
    expect(turnstile.script()?.src).toBe(TURNSTILE_SCRIPT_SRC);
    expect(TURNSTILE_SCRIPT_SRC).toContain("render=explicit");
  });

  test("the button waits, saying so, until the widget has a token", async () => {
    const turnstile = fakeTurnstile();
    await open(turnstile);
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe("Memeriksa…");

    turnstile.solve("token-1");
    expect(button().disabled).toBe(false);
    expect(button().textContent).toBe("Masuk");
  });

  test("before the script has even loaded the button already waits", async () => {
    const turnstile = fakeTurnstile();
    stubApi({ ...withKey() });
    renderApp("/login");
    await screen.findByRole("heading", { name: "Masuk ke Admin Sakola Kembara" });
    await waitFor(() => expect(turnstile.script()).not.toBeNull());
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe("Memeriksa…");
  });

  test("sends the token in the X-Turnstile-Token header, and nowhere else", async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    const api = await open(turnstile, { "POST /api/auth/sign-in/email": respond({ redirect: true }), "GET /api/me": respond(meBody("viewer")) });
    await fill(user);
    turnstile.solve("token-for-login");
    await user.click(button());

    await screen.findByRole("navigation", { name: "Menu utama" });
    const call = api.last("POST /api/auth/sign-in/email")!;
    expect(call.headers[TOKEN_HEADER]).toBe("token-for-login");
    // Not in the address, which ends up in logs and history, and not in the body.
    expect(call.url).toBe("/api/auth/sign-in/email");
    expect(JSON.stringify(call.body)).not.toContain("token-for-login");
    // The other calls of the page carry none.
    expect(api.calls.filter((c) => c.path !== "/api/auth/sign-in/email").every((c) => c.headers[TOKEN_HEADER] === undefined)).toBe(true);
  });

  test("a failed sign-in spends the token: the widget is reset, the button waits, and the next try carries the new token", async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    const api = await open(turnstile, { "POST /api/auth/sign-in/email": respond({ code: "INVALID_EMAIL_OR_PASSWORD" }, 401) });
    await fill(user);
    turnstile.solve("token-1");
    await user.click(button());

    expect((await screen.findByRole("alert")).textContent).toBe("Email atau password salah.");
    expect(turnstile.current().resets).toBe(1);
    // A fresh challenge is under way: nothing to send yet.
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe("Memeriksa…");

    turnstile.solve("token-2");
    expect(button().disabled).toBe(false);
    await user.click(button());
    await waitFor(() => expect(api.count("POST /api/auth/sign-in/email")).toBe(2));
    expect(api.calls.filter((c) => c.path === "/api/auth/sign-in/email").map((c) => c.headers[TOKEN_HEADER])).toEqual(["token-1", "token-2"]);
  });

  test("a form that fails validation sends nothing and keeps the token", async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    const api = await open(turnstile);
    turnstile.solve("token-1");
    await user.click(button());
    expect(screen.getByText("Email wajib diisi")).toBeTruthy();
    expect(api.count("POST /api/auth/sign-in/email")).toBe(0);
    expect(turnstile.current().resets).toBe(0);
    expect(button().disabled).toBe(false);
  });

  test("a submit that does not come from the button is ignored until there is a token", async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    const api = await open(turnstile, { "POST /api/auth/sign-in/email": respond({ code: "INVALID_EMAIL_OR_PASSWORD" }, 401) });
    await fill(user);
    fireEvent.submit(button().closest("form")!);
    expect(api.count("POST /api/auth/sign-in/email")).toBe(0);
    expect(turnstile.current().resets).toBe(0);

    turnstile.solve("token-1");
    fireEvent.submit(button().closest("form")!);
    await screen.findByRole("alert");
    expect(api.count("POST /api/auth/sign-in/email")).toBe(1);
  });

  test("two quick submits send one request and spend one token", async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    const gate = deferred<Response>();
    const api = await open(turnstile, { "POST /api/auth/sign-in/email": () => gate.promise });
    await fill(user);
    turnstile.solve("token-1");
    await user.click(button());
    fireEvent.submit(button().closest("form")!);
    fireEvent.submit(button().closest("form")!);
    expect(api.count("POST /api/auth/sign-in/email")).toBe(1);
    expect(turnstile.current().resets).toBe(1);
    gate.resolve(respond({ code: "INVALID_EMAIL_OR_PASSWORD" }, 401));
    await screen.findByRole("alert");
  });

  test("an expired token is dropped: the button waits and a fresh challenge is asked for", async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    const api = await open(turnstile, { "POST /api/auth/sign-in/email": respond({ code: "INVALID_EMAIL_OR_PASSWORD" }, 401) });
    await fill(user);
    turnstile.solve("token-1");
    expect(button().disabled).toBe(false);

    turnstile.expire();
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe("Memeriksa…");
    expect(turnstile.current().resets).toBe(1);
    // The old token is never sent.
    fireEvent.submit(button().closest("form")!);
    expect(api.count("POST /api/auth/sign-in/email")).toBe(0);

    turnstile.solve("token-2");
    expect(button().disabled).toBe(false);
    await user.click(button());
    await screen.findByRole("alert");
    expect(api.last("POST /api/auth/sign-in/email")?.headers[TOKEN_HEADER]).toBe("token-2");
  });

  test("an interactive challenge that times out is handled the same way", async () => {
    const turnstile = fakeTurnstile();
    await open(turnstile);
    turnstile.solve("token-1");
    expect(button().disabled).toBe(false);
    turnstile.timeout();
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe("Memeriksa…");
    expect(turnstile.current().resets).toBe(1);
  });

  test("when the widget errors, an Alert says so, the button stays off, and a later token clears it", async () => {
    const turnstile = fakeTurnstile();
    await open(turnstile);
    expect(screen.queryByRole("alert")).toBeNull();

    turnstile.error();
    expect((await screen.findByRole("alert")).textContent).toBe(WIDGET_ERROR_MESSAGE);
    expect(button().disabled).toBe(true);
    // Not "Memeriksa…": nothing is being checked any more.
    expect(button().textContent).toBe("Masuk");

    // The widget retries by itself; when it succeeds the page recovers.
    turnstile.solve("token-1");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(button().disabled).toBe(false);
  });

  test("when Cloudflare's script cannot be loaded, the same Alert, and the next attempt starts over", async () => {
    const turnstile = fakeTurnstile();
    stubApi({ ...withKey() });
    renderApp("/login");
    await screen.findByRole("heading", { name: "Masuk ke Admin Sakola Kembara" });
    await turnstile.failScript();

    expect((await screen.findByRole("alert")).textContent).toBe(WIDGET_ERROR_MESSAGE);
    expect(button().disabled).toBe(true);
    expect(turnstile.widgets).toHaveLength(0);
    // The failed element is gone, so a reload (or the next mount) asks again instead of waiting on it for ever.
    expect(turnstile.script()).toBeNull();
  });

  test("a widget that cannot be drawn is a failure too", async () => {
    const turnstile = fakeTurnstile();
    turnstile.api.render.mockImplementationOnce(() => undefined);
    stubApi({ ...withKey() });
    renderApp("/login");
    await screen.findByRole("heading", { name: "Masuk ke Admin Sakola Kembara" });
    await turnstile.loadScript({ drawn: false });
    expect((await screen.findByRole("alert")).textContent).toBe(WIDGET_ERROR_MESSAGE);
    expect(button().disabled).toBe(true);
  });

  test("Google sign-in does not wait for the token: that route has no security check", async () => {
    const turnstile = fakeTurnstile();
    await open(turnstile, withKey({ google: true }));
    const google = await screen.findByRole("button", { name: "Masuk dengan Google" });
    expect((google as HTMLButtonElement).disabled).toBe(false);
    expect(button().disabled).toBe(true);
  });

  test("leaving the page removes the widget", async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    await open(turnstile);
    const id = turnstile.current().id;
    await user.click(screen.getByRole("link", { name: "Lupa password?" }));
    await screen.findByRole("heading", { name: "Lupa password?" });
    expect(turnstile.api.remove).toHaveBeenCalledWith(id);
    expect(turnstile.widgets[0]?.removed).toBe(true);
  });

  describe("what the Worker can answer, in Indonesian", () => {
    async function failWith(response: Response) {
      const user = userEvent.setup();
      const turnstile = fakeTurnstile();
      await open(turnstile, { "POST /api/auth/sign-in/email": response });
      await fill(user);
      turnstile.solve("token-1");
      await user.click(button());
      const alert = (await screen.findByRole("alert")).textContent;
      // Whatever the answer, the token is spent and a new challenge was asked for.
      expect(turnstile.current().resets).toBe(1);
      return alert;
    }

    test("captcha_failed: try again", async () => {
      expect(await failWith(respond({ error: "captcha_failed", message: "Verifikasi keamanan gagal. Muat ulang halaman lalu coba lagi." }, 403))).toBe(
        CAPTCHA_FAILED_MESSAGE,
      );
    });

    test("captcha_unavailable: try again later", async () => {
      expect(await failWith(respond({ error: "captcha_unavailable" }, 503))).toBe(CAPTCHA_UNAVAILABLE_MESSAGE);
    });
  });
});

describe("forgot password", () => {
  const email = () => screen.getByLabelText("Email") as HTMLInputElement;
  const send = () => screen.getByRole("button", { name: /^(Kirim tautan reset|Mengirim…|Memeriksa…)$/ }) as HTMLButtonElement;

  async function open(turnstile: FakeTurnstile, routes: Parameters<typeof stubApi>[0] = {}) {
    const api = stubApi({ ...withKey(), ...routes });
    renderApp("/forgot-password");
    await screen.findByRole("heading", { name: "Lupa password?" });
    await turnstile.loadScript();
    return api;
  }

  test("draws the widget for the forgot-password action and waits for its token", async () => {
    const turnstile = fakeTurnstile();
    await open(turnstile);
    expect(turnstile.current().options).toMatchObject({ sitekey: SITE_KEY, action: "forgot-password", theme: "light" });
    expect(send().disabled).toBe(true);
    expect(send().textContent).toBe("Memeriksa…");
    turnstile.solve("token-1");
    expect(send().disabled).toBe(false);
    expect(send().textContent).toBe("Kirim tautan reset");
  });

  test("sends the token in the header, and asks for a fresh one even after success, because the page stays open", async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    const api = await open(turnstile, { "POST /api/auth/request-password-reset": respond({ status: true }) });
    await user.type(email(), "ani@contoh.test");
    turnstile.solve("token-1");
    await user.click(send());
    await screen.findByText(RESET_REQUESTED_MESSAGE);

    const call = api.last("POST /api/auth/request-password-reset")!;
    expect(call.headers[TOKEN_HEADER]).toBe("token-1");
    expect(call.url).toBe("/api/auth/request-password-reset");
    expect(JSON.stringify(call.body)).not.toContain("token-1");
    expect(turnstile.current().resets).toBe(1);
    expect(send().disabled).toBe(true); // until the new token

    // Sending a second link uses the second token.
    turnstile.solve("token-2");
    await user.click(send());
    await waitFor(() => expect(api.count("POST /api/auth/request-password-reset")).toBe(2));
    expect(api.last("POST /api/auth/request-password-reset")?.headers[TOKEN_HEADER]).toBe("token-2");
  });

  test("a failed request resets the widget too", async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    await open(turnstile, { "POST /api/auth/request-password-reset": respond({ error: "internal" }, 500) });
    await user.type(email(), "ani@contoh.test");
    turnstile.solve("token-1");
    await user.click(send());
    await screen.findByRole("alert");
    expect(turnstile.current().resets).toBe(1);
    expect(send().textContent).toBe("Memeriksa…");
  });

  test("a bad email, and the hidden field, send nothing and keep the token", async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    const api = await open(turnstile, { "POST /api/auth/request-password-reset": respond({ status: true }) });
    turnstile.solve("token-1");

    await user.type(email(), "bukan-email");
    await user.click(send());
    expect(screen.getByText("Format email belum benar")).toBeTruthy();

    await user.clear(email());
    await user.type(email(), "ani@contoh.test");
    document.querySelector<HTMLInputElement>('input[name="website"]')!.value = "http://spam.example";
    await user.click(send());
    await screen.findByText(RESET_REQUESTED_MESSAGE);

    expect(api.count("POST /api/auth/request-password-reset")).toBe(0);
    expect(turnstile.current().resets).toBe(0);
  });

  test("a submit that does not come from the button is ignored until there is a token", async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    const api = await open(turnstile, { "POST /api/auth/request-password-reset": respond({ status: true }) });
    await user.type(email(), "ani@contoh.test");
    fireEvent.submit(send().closest("form")!);
    expect(api.count("POST /api/auth/request-password-reset")).toBe(0);
  });

  describe("what the Worker can answer, in Indonesian", () => {
    async function failWith(response: Response, address = "ani@contoh.test") {
      const user = userEvent.setup();
      const turnstile = fakeTurnstile();
      await open(turnstile, { "POST /api/auth/request-password-reset": response });
      await user.type(email(), address);
      turnstile.solve("token-1");
      await user.click(send());
      const alert = (await screen.findByRole("alert")).textContent;
      expect(turnstile.current().resets).toBe(1);
      return alert;
    }

    test("captcha_failed", async () => {
      expect(await failWith(respond({ error: "captcha_failed" }, 403))).toBe(CAPTCHA_FAILED_MESSAGE);
    });

    test("captcha_unavailable", async () => {
      expect(await failWith(respond({ error: "captcha_unavailable" }, 503))).toBe(CAPTCHA_UNAVAILABLE_MESSAGE);
    });

    // The same line for an address with an account and one without: it is the service that is missing, not the address.
    test.each(["ada@contoh.test", "tidak-ada@contoh.test"])("email_unavailable (%s)", async (address) => {
      expect(await failWith(respond({ error: "email_unavailable", message: "Layanan email sedang tidak tersedia." }, 503), address)).toBe(
        EMAIL_UNAVAILABLE_MESSAGE,
      );
    });
  });
});

describe("no site key: the form works as it did before there was a widget", () => {
  const configs: [string, Response | undefined][] = [
    ["the key is missing", respond({ google: false })],
    ["the key is null", respond({ google: false, turnstileSiteKey: null })],
    ["the key is an empty string", respond({ google: false, turnstileSiteKey: "" })],
    ["the key is not a string", respond({ google: false, turnstileSiteKey: 42 })],
    ["the config cannot be read", respond({ error: "internal" }, 500)],
    ["there is no config route", undefined],
  ];

  test.each(configs)("%s", async (_name, answer) => {
    const user = userEvent.setup();
    const api = stubApi({
      ...(answer ? { "GET /api/config": answer } : {}),
      "POST /api/auth/sign-in/email": respond({ redirect: true }),
      "GET /api/me": respond(meBody("viewer")),
    });
    renderApp("/login");
    await screen.findByRole("heading", { name: "Masuk ke Admin Sakola Kembara" });
    await waitFor(() => expect(api.count("GET /api/config")).toBe(1));
    await settle(); // the answer has been read

    const submit = screen.getByRole("button", { name: "Masuk" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
    expect(window.turnstile).toBeUndefined();

    await user.type(screen.getByLabelText("Email"), "ani@contoh.test");
    await user.type(screen.getByLabelText("Password"), "x");
    await user.click(submit);
    await screen.findByRole("navigation", { name: "Menu utama" });
    expect(api.last("POST /api/auth/sign-in/email")?.headers[TOKEN_HEADER]).toBeUndefined();
  });

  test("forgot password: no widget, the button is ready, nothing extra is sent", async () => {
    const user = userEvent.setup();
    const api = stubApi({
      "GET /api/config": respond({ google: false }),
      "POST /api/auth/request-password-reset": respond({ status: true }),
    });
    renderApp("/forgot-password");
    await screen.findByRole("heading", { name: "Lupa password?" });
    await waitFor(() => expect(api.count("GET /api/config")).toBe(1));
    await settle();
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
    await user.type(screen.getByLabelText("Email"), "ani@contoh.test");
    await user.click(screen.getByRole("button", { name: "Kirim tautan reset" }));
    await screen.findByText(RESET_REQUESTED_MESSAGE);
    expect(api.last("POST /api/auth/request-password-reset")?.headers[TOKEN_HEADER]).toBeUndefined();
  });
});

describe("pages whose route has no security check", () => {
  test("choosing a new password draws no widget and loads no script", async () => {
    const user = userEvent.setup();
    const api = stubApi({ ...withKey(), "POST /api/auth/reset-password": respond({ status: true }) });
    renderApp("/reset-password?token=abc");
    await screen.findByRole("heading", { name: "Reset password" });
    await user.type(screen.getByLabelText("Password baru"), "kata sandi baru");
    await user.type(screen.getByLabelText("Ulangi password baru"), "kata sandi baru");
    await settle();
    // Nothing asked for the site key, and nothing is waited for.
    expect(api.count("GET /api/config")).toBe(0);
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
    const save = screen.getByRole("button", { name: "Ganti password" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);

    await user.click(save);
    await waitFor(() => expect(api.count("POST /api/auth/reset-password")).toBe(1));
    expect(api.last("POST /api/auth/reset-password")?.headers[TOKEN_HEADER]).toBeUndefined();
  });
});

describe("the development mock", () => {
  test("never loads Cloudflare's script: with its own widget in place, nothing is added to the page", async () => {
    vi.stubEnv("VITE_ADMIN_MOCK", "true");
    const turnstile = fakeTurnstile();
    turnstile.preload(); // what mock/install.ts does before the app starts
    stubApi({ ...withKey() });
    renderApp("/login");
    await screen.findByRole("heading", { name: "Masuk ke Admin Sakola Kembara" });
    await waitFor(() => expect(turnstile.widgets).toHaveLength(1));
    expect(document.querySelector("script[data-sakem-turnstile]")).toBeNull();
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
  });

  test("and if the mock's widget is missing it fails in the page instead of reaching Cloudflare", async () => {
    vi.stubEnv("VITE_ADMIN_MOCK", "true");
    stubApi({ ...withKey() });
    renderApp("/login");
    await screen.findByRole("heading", { name: "Masuk ke Admin Sakola Kembara" });
    expect((await screen.findByRole("alert")).textContent).toBe(WIDGET_ERROR_MESSAGE);
    expect(document.querySelector("script[data-sakem-turnstile]")).toBeNull();
  });
});

describe("loadTurnstile", () => {
  test("adds the script once however many callers ask, and shares the answer", async () => {
    const turnstile = fakeTurnstile();
    const first = loadTurnstile();
    const second = loadTurnstile();
    expect(document.querySelectorAll(SCRIPT_SELECTOR)).toHaveLength(1);
    window.turnstile = turnstile.api;
    turnstile.script()!.dispatchEvent(new Event("load"));
    expect(await first).toBe(turnstile.api);
    expect(await second).toBe(turnstile.api);
    // Once it is there, nobody adds another.
    expect(await loadTurnstile()).toBe(turnstile.api);
    expect(document.querySelectorAll(SCRIPT_SELECTOR)).toHaveLength(1);
  });

  test("a script that fails is removed, so the next call tries again", async () => {
    const turnstile = fakeTurnstile();
    const failed = loadTurnstile();
    turnstile.script()!.dispatchEvent(new Event("error"));
    await expect(failed).rejects.toThrow();
    expect(turnstile.script()).toBeNull();

    const again = loadTurnstile();
    expect(document.querySelectorAll(SCRIPT_SELECTOR)).toHaveLength(1);
    window.turnstile = turnstile.api;
    turnstile.script()!.dispatchEvent(new Event("load"));
    expect(await again).toBe(turnstile.api);
  });

  test("a script that ran and left no window.turnstile is a failure, and is replaced next time", async () => {
    const turnstile = fakeTurnstile();
    const broken = loadTurnstile();
    turnstile.script()!.dispatchEvent(new Event("load"));
    await expect(broken).rejects.toThrow();

    const again = loadTurnstile();
    expect(document.querySelectorAll(SCRIPT_SELECTOR)).toHaveLength(1);
    window.turnstile = turnstile.api;
    turnstile.script()!.dispatchEvent(new Event("load"));
    expect(await again).toBe(turnstile.api);
  });

  test("with Cloudflare already loaded no script is added", async () => {
    const turnstile = fakeTurnstile();
    turnstile.preload();
    expect(await loadTurnstile()).toBe(turnstile.api);
    expect(turnstile.script()).toBeNull();
  });
});
