import { fakeTurnstile } from "@shared/spa/test/fake-turnstile";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { ENDPOINTS } from "~/lib/paths";
import { deferred, renderApp, respond, stubApi } from "./helpers";

const config = { [`GET ${ENDPOINTS.config}`]: respond({ google: false, turnstileSiteKey: null, siteUrl: "" }) };
const accepted = respond({ ok: true, message: "Pendaftaran diterima. Cek email kamu untuk langkah berikutnya (periksa juga folder spam)." });
const name = () => screen.getByLabelText("Nama lengkap") as HTMLInputElement;
const email = () => screen.getByLabelText("Email") as HTMLInputElement;
const password = () => screen.getByLabelText("Password") as HTMLInputElement;
const confirm = () => screen.getByLabelText("Ulangi password") as HTMLInputElement;
const submit = () => screen.getByRole("button", { name: /^(Daftar|Membuat akun…|Memeriksa…)$/ }) as HTMLButtonElement;

async function openRegister(path = "/portal/register", routes: Parameters<typeof stubApi>[0] = {}) {
  const api = stubApi({ ...config, ...routes });
  renderApp(path);
  await screen.findByRole("heading", { name: "Daftar akun baru" });
  return api;
}

async function fillIn(user: ReturnType<typeof userEvent.setup>, values: Partial<Record<"name" | "email" | "password" | "confirm", string>> = {}) {
  await user.type(name(), values.name ?? "Sari Dewi");
  await user.type(email(), values.email ?? "sari@contoh.test");
  await user.type(password(), values.password ?? "rahasia123");
  await user.type(confirm(), values.confirm ?? "rahasia123");
}

describe("register: the form", () => {
  test("labels, types, autocomplete values and the password hint", async () => {
    await openRegister();
    expect(name().autocomplete).toBe("name");
    expect(name().required).toBe(true);
    expect(email().type).toBe("email");
    expect(email().autocomplete).toBe("email");
    expect(password().type).toBe("password");
    expect(password().autocomplete).toBe("new-password");
    expect(confirm().type).toBe("password");
    expect(confirm().autocomplete).toBe("new-password");
    expect(document.getElementById(password().getAttribute("aria-describedby")!)?.textContent).toBe("Minimal 8 karakter.");
  });

  test("the legacy words: one heading and one description, then the form, then the way to sign in", async () => {
    await openRegister();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByText("Data pendaftaran kamu akan tersimpan pada akun ini agar bisa dibuka kembali kapan saja.")).toBeTruthy();
    expect(screen.getByText("Sudah punya akun?")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Masuk di sini" }).getAttribute("href")).toBe("/portal/login");
  });

  test("the way to sign in carries the page the student was heading for", async () => {
    await openRegister("/portal/register?from=%2Fdaftar");
    expect(screen.getByRole("link", { name: "Masuk di sini" }).getAttribute("href")).toBe("/portal/login?from=%2Fdaftar");
  });

  test("the cursor starts in the first field; the honeypot is hidden from people and from assistive technology", async () => {
    await openRegister();
    await waitFor(() => expect(document.activeElement).toBe(name()));
    const trap = document.querySelector<HTMLInputElement>('input[name="website"]')!;
    expect(trap.tabIndex).toBe(-1);
    expect(trap.getAttribute("aria-hidden")).toBe("true");
    expect(trap.autocomplete).toBe("off");
  });

  test("Google below the form, when configured", async () => {
    await openRegister("/portal/register", { [`GET ${ENDPOINTS.config}`]: respond({ google: true, turnstileSiteKey: null }) });
    expect(await screen.findByRole("button", { name: "Daftar dengan Google" })).toBeTruthy();
    expect(screen.getByText("atau")).toBeTruthy();
  });

  test("sets the tab title", async () => {
    await openRegister();
    await waitFor(() => expect(document.title).toBe("Daftar Akun | Portal Siswa"));
  });
});

describe("register: validation before sending", () => {
  test("an empty form names every field and sends nothing", async () => {
    const user = userEvent.setup();
    const api = await openRegister();
    await user.click(submit());
    const said = (input: HTMLElement) => document.getElementById(input.getAttribute("aria-describedby")!)?.textContent;
    expect(said(name())).toBe("Nama wajib diisi");
    expect(said(email())).toBe("Email wajib diisi");
    expect(said(password())).toBe("Password wajib diisi");
    expect(said(confirm())).toBe("Ulangi password kamu");
    for (const input of [name(), email(), password(), confirm()]) expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(api.count(`POST ${ENDPOINTS.register}`)).toBe(0);
    expect(document.activeElement).toBe(name());
  });

  test("a confirmation that does not match, and the cursor goes there", async () => {
    const user = userEvent.setup();
    const api = await openRegister();
    await fillIn(user, { confirm: "lain-lain" });
    await user.click(submit());
    expect(screen.getByText("Konfirmasi password tidak cocok")).toBeTruthy();
    expect(document.activeElement).toBe(confirm());
    expect(api.count(`POST ${ENDPOINTS.register}`)).toBe(0);
  });

  test("a short password", async () => {
    const user = userEvent.setup();
    await openRegister();
    await fillIn(user, { password: "pendek", confirm: "pendek" });
    await user.click(submit());
    expect(screen.getByText("Password minimal 8 karakter")).toBeTruthy();
  });
});

describe("register: sending", () => {
  test("sends the trimmed name and the lower-cased email, with the callback under /portal, then says 'Cek email kamu'", async () => {
    const user = userEvent.setup();
    const api = await openRegister("/portal/register", { [`POST ${ENDPOINTS.register}`]: accepted });
    await fillIn(user, { name: "  Sari Dewi ", email: "  Sari@Contoh.TEST " });
    await user.click(submit());
    expect(await screen.findByRole("heading", { name: "Cek email kamu" })).toBeTruthy();
    expect(api.last(`POST ${ENDPOINTS.register}`)?.body).toEqual({
      name: "Sari Dewi",
      email: "sari@contoh.test",
      password: "rahasia123",
      confirmPassword: "rahasia123",
      callbackURL: "/portal/login?verified=1",
    });
  });

  test("after it: the same words whoever the address is, no form, 'Kirim ulang tautan', and the way to sign in", async () => {
    const user = userEvent.setup();
    await openRegister("/portal/register", { [`POST ${ENDPOINTS.register}`]: accepted });
    await fillIn(user);
    await user.click(submit());
    await screen.findByRole("heading", { name: "Cek email kamu" });
    expect(screen.getByText(/Pendaftaran diterima\. Kami sudah mengirim tautan verifikasi ke email kamu/)).toBeTruthy();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.getByRole("button", { name: "Kirim ulang tautan" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Masuk di sini" }).getAttribute("href")).toBe("/portal/login");
  });

  test("'Kirim ulang tautan' goes to the address that registered, behind its own security check", async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    turnstile.preload();
    const api = await openRegister("/portal/register", {
      [`GET ${ENDPOINTS.config}`]: respond({ google: false, turnstileSiteKey: "site-key" }),
      [`POST ${ENDPOINTS.register}`]: accepted,
      [`POST ${ENDPOINTS.sendVerification}`]: respond({ status: true }),
    });
    await screen.findByRole("button", { name: "Memeriksa…" });
    await turnstile.drawn("register");
    turnstile.solve("token-register");
    await fillIn(user);
    await user.click(await screen.findByRole("button", { name: "Daftar" }));
    await screen.findByRole("heading", { name: "Cek email kamu" });

    await screen.findByRole("button", { name: "Memeriksa…" });
    await turnstile.drawn("resend-verification");
    turnstile.solve("token-resend");
    await user.click(await screen.findByRole("button", { name: "Kirim ulang tautan" }));
    expect(await screen.findByText("Tautan baru sudah dikirim. Cek folder spam jika belum muncul.")).toBeTruthy();
    expect(api.last(`POST ${ENDPOINTS.register}`)?.headers["x-turnstile-token"]).toBe("token-register");
    const resend = api.last(`POST ${ENDPOINTS.sendVerification}`)!;
    expect(resend.body).toEqual({ email: "sari@contoh.test", callbackURL: "/portal/login?verified=1" });
    expect(resend.headers["x-turnstile-token"]).toBe("token-resend");
  });

  test("a bot that filled the honeypot is shown the same page as everyone and nothing is sent", async () => {
    const user = userEvent.setup();
    const api = await openRegister("/portal/register", { [`POST ${ENDPOINTS.register}`]: accepted });
    await fillIn(user);
    fireEvent.change(document.querySelector('input[name="website"]')!, { target: { value: "http://spam.example" } });
    await user.click(submit());
    expect(await screen.findByRole("heading", { name: "Cek email kamu" })).toBeTruthy();
    expect(api.count(`POST ${ENDPOINTS.register}`)).toBe(0);
  });

  test("two quick submits send one request", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const api = await openRegister("/portal/register", { [`POST ${ENDPOINTS.register}`]: () => gate.promise });
    await fillIn(user);
    await user.click(submit());
    expect(submit().disabled).toBe(true);
    expect(submit().textContent).toBe("Membuat akun…");
    fireEvent.submit(submit().closest("form")!);
    fireEvent.submit(submit().closest("form")!);
    expect(api.count(`POST ${ENDPOINTS.register}`)).toBe(1);
    gate.resolve(accepted.clone());
    await screen.findByRole("heading", { name: "Cek email kamu" });
  });
});

describe("register: every way it can fail, in Indonesian", () => {
  async function failWith(response: Response | (() => Response | Promise<Response>)) {
    const user = userEvent.setup();
    await openRegister("/portal/register", { [`POST ${ENDPOINTS.register}`]: response as never });
    await fillIn(user);
    await user.click(submit());
    return (await screen.findByRole("alert")).textContent;
  }

  test("rate limited, with the wait", async () => {
    expect(await failWith(respond({ error: "rate_limited" }, 429, { "Retry-After": "60" }))).toBe("Terlalu banyak percobaan pendaftaran. Silakan tunggu 1 menit lalu coba lagi.");
  });

  test("the security check refused", async () => {
    expect(await failWith(respond({ error: "captcha_failed" }, 403))).toBe("Verifikasi keamanan gagal. Tunggu pemeriksaan selesai, lalu coba lagi.");
  });

  test("no email service", async () => {
    expect(await failWith(respond({ error: "email_unavailable" }, 503))).toBe("Layanan email sedang tidak tersedia, jadi tautan belum bisa dikirim. Silakan coba lagi nanti.");
  });

  test("the day's emails are spent: the sentence for the whole day, the same for everyone", async () => {
    expect(await failWith(respond({ error: "email_quota", message: "teks server yang tidak dipakai" }, 503))).toBe(
      "Pendaftaran akun hari ini sudah penuh. Coba lagi besok, atau masuk dengan Google.",
    );
  });

  test("the server cannot be reached", async () => {
    expect(
      await failWith(() => {
        throw new TypeError("Failed to fetch");
      }),
    ).toBe("Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.");
  });

  test("a server error", async () => {
    expect(await failWith(respond({ error: "internal" }, 500))).toBe("Gagal mendaftar. Silakan coba lagi.");
  });

  test("the fields the Worker names get its Indonesian line, the cursor goes to the first, and the rest of the form is kept", async () => {
    const user = userEvent.setup();
    await openRegister("/portal/register", {
      [`POST ${ENDPOINTS.register}`]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fieldErrors: { email: ["Format email belum benar"], password: ["Password minimal 8 karakter"] } }, 400),
    });
    await fillIn(user);
    await user.click(submit());
    expect((await screen.findByRole("alert")).textContent).toBe("Periksa kembali isian formulir.");
    expect(document.getElementById(email().getAttribute("aria-describedby")!)?.textContent).toBe("Format email belum benar");
    expect(document.getElementById(password().getAttribute("aria-describedby")!)?.textContent).toBe("Password minimal 8 karakter");
    expect(document.activeElement).toBe(email());
    expect(name().value).toBe("Sari Dewi");
    expect(submit().disabled).toBe(false);
  });
});

describe("register: Google", () => {
  test("starts the sign-in under /portal and goes where Google says", async () => {
    const user = userEvent.setup();
    const api = await openRegister("/portal/register?from=%2Fdaftar", {
      [`GET ${ENDPOINTS.config}`]: respond({ google: true, turnstileSiteKey: null }),
      [`POST ${ENDPOINTS.signInSocial}`]: respond({ url: "#google-register" }),
    });
    await user.click(await screen.findByRole("button", { name: "Daftar dengan Google" }));
    await waitFor(() => expect(window.location.hash).toBe("#google-register"));
    expect(api.last(`POST ${ENDPOINTS.signInSocial}`)?.body).toEqual({ provider: "google", callbackURL: "/portal/daftar" });
  });
});
