import { fakeTurnstile } from "@shared/spa/test/fake-turnstile";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { ENDPOINTS } from "~/lib/paths";
import { deferred, meBody, overviewBody, renderApp, respond, stubApi } from "./helpers";

const config = { [`GET ${ENDPOINTS.config}`]: respond({ google: false, turnstileSiteKey: null, siteUrl: "" }) };
const signedIn = { [`GET ${ENDPOINTS.me}`]: respond(meBody()), [`GET ${ENDPOINTS.overview}`]: respond(overviewBody()) };
const location = () => screen.getByTestId("location").textContent;
const email = () => screen.getByLabelText("Email") as HTMLInputElement;
const password = () => screen.getByLabelText("Password") as HTMLInputElement;
const submit = () => screen.getByRole("button", { name: /^(Masuk|Memproses…)$/ }) as HTMLButtonElement;

async function openLogin(path = "/portal/login", routes: Parameters<typeof stubApi>[0] = {}) {
  const api = stubApi({ ...config, ...routes });
  renderApp(path);
  await screen.findByRole("heading", { name: "Selamat datang kembali" });
  return api;
}

describe("login: the form", () => {
  test("labels, types and autocomplete values", async () => {
    await openLogin();
    expect(email().type).toBe("email");
    expect(email().autocomplete).toBe("username");
    expect(email().required).toBe(true);
    expect(password().type).toBe("password");
    expect(password().autocomplete).toBe("current-password");
    expect(password().required).toBe(true);
    expect(email().getAttribute("aria-invalid")).toBeNull();
    expect(password().getAttribute("aria-invalid")).toBeNull();
  });

  test("the legacy words: one heading, one description (the brand name once), then the form", async () => {
    await openLogin();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByText("Masuk untuk mendaftar sebagai calon siswa Sakola Kembara.")).toBeTruthy();
  });

  test("the cursor starts in the email field", async () => {
    await openLogin();
    await waitFor(() => expect(document.activeElement).toBe(email()));
  });

  test("has the ways to the password reset and to registration, under /portal", async () => {
    await openLogin();
    expect(screen.getByRole("link", { name: "Lupa password?" }).getAttribute("href")).toBe("/portal/forgot-password");
    expect(screen.getByText("Belum punya akun?")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Daftar di sini" }).getAttribute("href")).toBe("/portal/register");
  });

  test("the way to registration carries the page the student was heading for", async () => {
    await openLogin("/portal/login?from=%2Fdaftar");
    expect(screen.getByRole("link", { name: "Daftar di sini" }).getAttribute("href")).toBe("/portal/register?from=%2Fdaftar");
  });

  test("Google only when the server says it is configured", async () => {
    await openLogin();
    expect(screen.queryByRole("button", { name: "Masuk dengan Google" })).toBeNull();
    expect(screen.queryByText("atau")).toBeNull();
  });

  test("Google when configured: the form first, then the rule, then the button", async () => {
    await openLogin("/portal/login", { [`GET ${ENDPOINTS.config}`]: respond({ google: true, turnstileSiteKey: null }) });
    const google = await screen.findByRole("button", { name: "Masuk dengan Google" });
    expect(screen.getByText("atau")).toBeTruthy();
    const form = screen.getByRole("button", { name: "Masuk" }).closest("form")!;
    expect(form.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("sets the tab title", async () => {
    await openLogin();
    await waitFor(() => expect(document.title).toBe("Masuk | Portal Siswa"));
  });
});

describe("login: validation before sending", () => {
  test("empty form names both fields, marks them invalid and sends nothing", async () => {
    const user = userEvent.setup();
    const api = await openLogin();
    await user.click(submit());
    expect(email().getAttribute("aria-invalid")).toBe("true");
    expect(password().getAttribute("aria-invalid")).toBe("true");
    for (const [input, message] of [
      [email(), "Email wajib diisi"],
      [password(), "Password wajib diisi"],
    ] as const) {
      expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe(message);
    }
    expect(api.count(`POST ${ENDPOINTS.signIn}`)).toBe(0);
    expect(document.activeElement).toBe(email());
  });

  test("a badly shaped email", async () => {
    const user = userEvent.setup();
    const api = await openLogin();
    await user.type(email(), "bukan-email");
    await user.type(password(), "rahasia");
    await user.click(submit());
    expect(screen.getByText("Format email belum benar")).toBeTruthy();
    expect(api.count(`POST ${ENDPOINTS.signIn}`)).toBe(0);
  });
});

describe("login: signing in", () => {
  test("sends the email normalized, with the verification callback under /portal, then opens the front page", async () => {
    const user = userEvent.setup();
    const api = await openLogin("/portal/login", { [`POST ${ENDPOINTS.signIn}`]: respond({ redirect: true, token: "t", user: {} }), ...signedIn });
    await user.type(email(), "  Sari@Contoh.TEST ");
    await user.type(password(), "kata sandi saya");
    await user.click(submit());
    await screen.findByRole("navigation", { name: "Menu portal" });
    expect(api.last(`POST ${ENDPOINTS.signIn}`)?.body).toEqual({
      email: "sari@contoh.test",
      password: "kata sandi saya",
      callbackURL: "/portal/verify-email?status=success",
    });
    expect(location()).toBe("/");
  });

  test("goes back to the page asked for", async () => {
    const user = userEvent.setup();
    await openLogin("/portal/login?from=%2Fstatus", {
      [`POST ${ENDPOINTS.signIn}`]: respond({ redirect: true }),
      ...signedIn,
      [`GET ${ENDPOINTS.applications}`]: respond({ items: [] }),
    });
    await user.type(email(), "sari@contoh.test");
    await user.type(password(), "x");
    await user.click(submit());
    await screen.findByRole("heading", { name: "Rekap perjalanan pendaftaranmu" });
    expect(location()).toBe("/status");
  });

  test.each(["https://evil.example/", "//evil.example", "/\\evil.example", "/login", "/register"])("ignores an unsafe or pointless `from` (%s)", async (from) => {
    const user = userEvent.setup();
    await openLogin(`/portal/login?from=${encodeURIComponent(from)}`, { [`POST ${ENDPOINTS.signIn}`]: respond({ redirect: true }), ...signedIn });
    await user.type(email(), "sari@contoh.test");
    await user.type(password(), "x");
    await user.click(submit());
    await screen.findByRole("navigation", { name: "Menu portal" });
    expect(location()).toBe("/");
  });

  test("an admin account signs in on the apex too: it lands on the 'not a student' screen", async () => {
    const user = userEvent.setup();
    await openLogin("/portal/login", { [`POST ${ENDPOINTS.signIn}`]: respond({ redirect: true }), [`GET ${ENDPOINTS.me}`]: respond(meBody("editor")) });
    await user.type(email(), "rina@contoh.test");
    await user.type(password(), "x");
    await user.click(submit());
    expect(await screen.findByRole("heading", { name: "Akun ini bukan akun calon siswa" })).toBeTruthy();
  });
});

describe("login: Google", () => {
  async function openGoogle(path: string) {
    return openLogin(path, {
      [`GET ${ENDPOINTS.config}`]: respond({ google: true, turnstileSiteKey: null }),
      [`POST ${ENDPOINTS.signInSocial}`]: respond({ url: "#google-went-here" }),
    });
  }

  test("starts the sign-in with the page the student came from, under /portal, and goes where Google says", async () => {
    const user = userEvent.setup();
    const api = await openGoogle("/portal/login?from=%2Fdaftar");
    await user.click(await screen.findByRole("button", { name: "Masuk dengan Google" }));
    await waitFor(() => expect(window.location.hash).toBe("#google-went-here"));
    expect(api.last(`POST ${ENDPOINTS.signInSocial}`)?.body).toEqual({ provider: "google", callbackURL: "/portal/daftar" });
  });

  test("without a page asked for it comes back to the portal's front page", async () => {
    const user = userEvent.setup();
    const api = await openGoogle("/portal/login");
    await user.click(await screen.findByRole("button", { name: "Masuk dengan Google" }));
    await waitFor(() => expect(api.count(`POST ${ENDPOINTS.signInSocial}`)).toBe(1));
    expect(api.last(`POST ${ENDPOINTS.signInSocial}`)?.body).toEqual({ provider: "google", callbackURL: "/portal/" });
  });

  test("a refusal is said in Indonesian", async () => {
    const user = userEvent.setup();
    await openLogin("/portal/login", {
      [`GET ${ENDPOINTS.config}`]: respond({ google: true, turnstileSiteKey: null }),
      [`POST ${ENDPOINTS.signInSocial}`]: respond({ error: "internal" }, 500),
    });
    await user.click(await screen.findByRole("button", { name: "Masuk dengan Google" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Gagal masuk. Silakan coba lagi.");
  });
});

describe("login: every way it can fail, in Indonesian", () => {
  async function failWith(response: Response | (() => Response | Promise<Response>)) {
    const user = userEvent.setup();
    await openLogin("/portal/login", { [`POST ${ENDPOINTS.signIn}`]: response as never });
    await user.type(email(), "sari@contoh.test");
    await user.type(password(), "x");
    await user.click(submit());
    return (await screen.findByRole("alert")).textContent;
  }

  test("wrong credentials, and no field is marked (it says nothing about which is wrong)", async () => {
    expect(await failWith(respond({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, 401))).toBe("Email atau password salah.");
    expect(email().getAttribute("aria-invalid")).toBeNull();
    expect(password().getAttribute("aria-invalid")).toBeNull();
  });

  test("rate limited, with the wait from Retry-After", async () => {
    expect(await failWith(respond({ error: "rate_limited" }, 429, { "Retry-After": "60" }))).toBe("Terlalu banyak percobaan masuk. Silakan tunggu 1 menit lalu coba lagi.");
  });

  test("the server cannot be reached", async () => {
    expect(
      await failWith(() => {
        throw new TypeError("Failed to fetch");
      }),
    ).toBe("Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.");
  });

  test("a server error", async () => {
    expect(await failWith(respond({ error: "internal" }, 500))).toBe("Gagal masuk. Silakan coba lagi.");
  });

  test("the form is usable again after a failure and keeps the email", async () => {
    await failWith(respond({ code: "INVALID_EMAIL_OR_PASSWORD" }, 401));
    expect(submit().disabled).toBe(false);
    expect(email().value).toBe("sari@contoh.test");
  });
});

describe("login: an address that is not verified", () => {
  async function failUnverified(routes: Parameters<typeof stubApi>[0] = {}, turnstile?: ReturnType<typeof fakeTurnstile>) {
    const user = userEvent.setup();
    const api = await openLogin("/portal/login", {
      [`POST ${ENDPOINTS.signIn}`]: respond({ code: "EMAIL_NOT_VERIFIED", message: "Email not verified" }, 403),
      ...routes,
    });
    await user.type(email(), "  Sari@Contoh.test ");
    await user.type(password(), "x");
    if (turnstile) {
      // With a site key the sign-in itself is behind the security check.
      await screen.findByRole("button", { name: "Memeriksa…" });
      await turnstile.drawn("login");
      turnstile.solve("token-login");
    }
    await user.click(await screen.findByRole("button", { name: "Masuk" }));
    await screen.findByRole("heading", { name: "Verifikasi email kamu" });
    return { api, user };
  }

  test("says so (the Worker has sent a fresh link already), in the same layout, and offers 'Kirim ulang tautan' instead of a form that would fail again", async () => {
    await failUnverified();
    expect(screen.getByRole("status").textContent).toBe("Email belum diverifikasi. Kami sudah mengirim tautan verifikasi baru ke email kamu.");
    expect(screen.getByRole("button", { name: "Kirim ulang tautan" })).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  test("'Kirim ulang tautan' asks for the address that was typed, with the page the link lands on", async () => {
    const turnstile = fakeTurnstile();
    turnstile.preload();
    const { api, user } = await failUnverified(
      {
        [`GET ${ENDPOINTS.config}`]: respond({ google: false, turnstileSiteKey: "site-key" }),
        [`POST ${ENDPOINTS.sendVerification}`]: respond({ status: true }),
      },
      turnstile,
    );
    await screen.findByRole("button", { name: "Memeriksa…" });
    await turnstile.drawn("resend-verification");
    turnstile.solve("token-resend");
    await user.click(await screen.findByRole("button", { name: "Kirim ulang tautan" }));
    expect(await screen.findByText("Tautan baru sudah dikirim. Cek folder spam jika belum muncul.")).toBeTruthy();
    const call = api.last(`POST ${ENDPOINTS.sendVerification}`)!;
    expect(call.body).toEqual({ email: "sari@contoh.test", callbackURL: "/portal/login?verified=1" });
    expect(call.headers["x-turnstile-token"]).toBe("token-resend");
  });

  test("the way back to the form", async () => {
    const { user } = await failUnverified();
    await user.click(screen.getByRole("button", { name: "Kembali ke halaman masuk" }));
    expect(await screen.findByRole("heading", { name: "Selamat datang kembali" })).toBeTruthy();
  });
});

describe("login: double submit", () => {
  test("two quick submits send one request, and the button says so while it waits", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const api = await openLogin("/portal/login", { [`POST ${ENDPOINTS.signIn}`]: () => gate.promise, ...signedIn });
    await user.type(email(), "sari@contoh.test");
    await user.type(password(), "x");
    await user.click(submit());
    expect(submit().disabled).toBe(true);
    expect(submit().textContent).toBe("Memproses…");
    expect(submit().closest("form")?.getAttribute("aria-busy")).toBe("true");
    fireEvent.submit(submit().closest("form")!);
    fireEvent.submit(submit().closest("form")!);
    expect(api.count(`POST ${ENDPOINTS.signIn}`)).toBe(1);
    gate.resolve(respond({ redirect: true }));
    await screen.findByRole("navigation", { name: "Menu portal" });
    expect(api.count(`POST ${ENDPOINTS.signIn}`)).toBe(1);
  });
});

describe("login: links from elsewhere", () => {
  test("?error= shows its own line when known (a Google refusal)", async () => {
    await openLogin("/portal/login?error=access_denied");
    expect((await screen.findByRole("alert")).textContent).toBe("Izin masuk dengan Google tidak diberikan. Silakan coba lagi jika itu tidak disengaja.");
  });

  test("the admin's own ?error= codes are not the portal's: they get the generic line", async () => {
    await openLogin("/portal/login?error=admin-only");
    expect((await screen.findByRole("alert")).textContent).toBe("Gagal masuk. Silakan coba lagi.");
  });

  test("?error= with anything else shows the generic line and never the text", async () => {
    await openLogin("/portal/login?error=%3Cb%3Ehalo%3C%2Fb%3E");
    expect((await screen.findByRole("alert")).textContent).toBe("Gagal masuk. Silakan coba lagi.");
    expect(document.body.innerHTML).not.toContain("<b>halo</b>");
  });

  test("?reset=1 says the password was changed", async () => {
    await openLogin("/portal/login?reset=1");
    expect(screen.getByRole("status").textContent).toBe("Password berhasil diganti. Silakan masuk dengan password baru.");
  });

  test("?verified=1 (the link of a registration email worked) says the address is verified", async () => {
    await openLogin("/portal/login?verified=1");
    expect(screen.getByRole("status").textContent).toBe("Email kamu berhasil diverifikasi. Silakan masuk untuk melanjutkan.");
  });

  test("?verified=1&error=... (the link was spent or expired) says so, and what to do", async () => {
    await openLogin("/portal/login?verified=1&error=INVALID_TOKEN");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Tautan verifikasi tidak valid atau sudah kadaluarsa");
    expect(screen.queryByText(/berhasil diverifikasi/)).toBeNull();
  });
});
