import { fakeTurnstile } from "@shared/spa/test/fake-turnstile";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { ENDPOINTS } from "~/lib/paths";
import { renderApp, respond, stubApi } from "./helpers";

const location = () => screen.getByTestId("location").textContent;
const config = { [`GET ${ENDPOINTS.config}`]: respond({ google: false, turnstileSiteKey: null, siteUrl: "" }) };
const REQUESTED = "Kalau email tersebut terdaftar, kami sudah mengirim tautan reset password. Cek inbox atau folder spam dalam beberapa menit.";

describe("forgot password", () => {
  const email = () => screen.getByLabelText("Email") as HTMLInputElement;
  const submit = () => screen.getByRole("button", { name: /^(Kirim tautan reset|Mengirim…|Memeriksa…)$/ }) as HTMLButtonElement;

  async function open(routes: Parameters<typeof stubApi>[0] = {}) {
    const api = stubApi({ ...config, ...routes });
    renderApp("/portal/forgot-password");
    await screen.findByRole("heading", { name: "Lupa password?" });
    return api;
  }

  test("the legacy words, one heading, the way back to sign-in under /portal", async () => {
    await open();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByText("Masukkan email akun kamu. Kami akan mengirim tautan untuk mengatur ulang password ke inbox tersebut.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kembali ke halaman masuk" }).getAttribute("href")).toBe("/portal/login");
    expect(email().autocomplete).toBe("email");
    expect(document.activeElement).toBe(email());
    expect(document.title).toBe("Lupa Password | Portal Siswa");
  });

  test("an empty or badly shaped address sends nothing", async () => {
    const user = userEvent.setup();
    const api = await open();
    await user.click(submit());
    expect(screen.getByText("Email wajib diisi")).toBeTruthy();
    await user.type(email(), "bukan-email");
    await user.click(submit());
    expect(screen.getByText("Format email belum benar")).toBeTruthy();
    expect(api.count(`POST ${ENDPOINTS.requestReset}`)).toBe(0);
  });

  test("asks for the link with the address and the reset page under /portal, and answers the same words whoever the address is", async () => {
    const user = userEvent.setup();
    const api = await open({ [`POST ${ENDPOINTS.requestReset}`]: respond({ status: true }) });
    await user.type(email(), "  Sari@Contoh.test ");
    await user.click(submit());
    expect((await screen.findByRole("status")).textContent).toBe(REQUESTED);
    expect(api.last(`POST ${ENDPOINTS.requestReset}`)?.body).toEqual({ email: "sari@contoh.test", redirectTo: "/portal/reset-password" });
  });

  test("a honeypot hit gets the same answer and nothing is sent", async () => {
    const user = userEvent.setup();
    const api = await open({ [`POST ${ENDPOINTS.requestReset}`]: respond({ status: true }) });
    await user.type(email(), "sari@contoh.test");
    fireEvent.change(document.querySelector('input[name="website"]')!, { target: { value: "spam" } });
    await user.click(submit());
    expect((await screen.findByRole("status")).textContent).toBe(REQUESTED);
    expect(api.count(`POST ${ENDPOINTS.requestReset}`)).toBe(0);
  });

  test.each([
    [respond({ error: "rate_limited" }, 429, { "Retry-After": "60" }), "Terlalu banyak permintaan. Silakan tunggu 1 menit lalu coba lagi."],
    [respond({ error: "email_unavailable" }, 503), "Layanan email sedang tidak tersedia, jadi tautan belum bisa dikirim. Silakan coba lagi nanti."],
    [respond({ error: "email_quota" }, 503), "Gagal mengirim permintaan. Silakan coba lagi."],
    [respond({ error: "internal" }, 500), "Gagal mengirim permintaan. Silakan coba lagi."],
  ])("a failure is said in Indonesian (%#)", async (response, text) => {
    const user = userEvent.setup();
    await open({ [`POST ${ENDPOINTS.requestReset}`]: response });
    await user.type(email(), "sari@contoh.test");
    await user.click(submit());
    expect((await screen.findByRole("alert")).textContent).toBe(text);
  });

  test("behind the security check: the button waits for the token, which is sent in the header and spent by the request", async () => {
    const user = userEvent.setup();
    const turnstile = fakeTurnstile();
    turnstile.preload();
    const api = await open({
      [`GET ${ENDPOINTS.config}`]: respond({ google: false, turnstileSiteKey: "site-key" }),
      [`POST ${ENDPOINTS.requestReset}`]: respond({ status: true }),
    });
    await user.type(email(), "sari@contoh.test");
    expect(await screen.findByRole("button", { name: "Memeriksa…" })).toHaveProperty("disabled", true);
    expect(turnstile.current().options.action).toBe("forgot-password");
    turnstile.solve("token-forgot");
    await user.click(await screen.findByRole("button", { name: "Kirim tautan reset" }));
    await screen.findByRole("status");
    expect(api.last(`POST ${ENDPOINTS.requestReset}`)?.headers["x-turnstile-token"]).toBe("token-forgot");
    expect(turnstile.current().resets).toBe(1);
  });
});

describe("reset password", () => {
  const password = () => screen.getByLabelText("Password baru") as HTMLInputElement;
  const confirm = () => screen.getByLabelText("Ulangi password baru") as HTMLInputElement;
  const submit = () => screen.getByRole("button", { name: /^(Ganti password|Menyimpan…)$/ }) as HTMLButtonElement;

  test("without a token it explains and offers a new link (under /portal), instead of the form", async () => {
    stubApi({});
    renderApp("/portal/reset-password");
    expect(await screen.findByRole("heading", { name: "Reset password" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Tautan reset tidak lengkap. Silakan minta tautan baru.");
    expect(screen.getByRole("link", { name: "Minta tautan baru" }).getAttribute("href")).toBe("/portal/forgot-password");
    expect(screen.queryByLabelText("Password baru")).toBeNull();
  });

  test("with ?error= (the link is spent or expired) it says so", async () => {
    stubApi({});
    renderApp("/portal/reset-password?error=INVALID_TOKEN&token=abc");
    expect(await screen.findByText("Tautan reset tidak valid atau sudah kadaluarsa. Silakan minta tautan baru.")).toBeTruthy();
    expect(screen.queryByLabelText("Password baru")).toBeNull();
  });

  test("the form: labels, autocomplete, the hint, the cursor", async () => {
    stubApi({});
    renderApp("/portal/reset-password?token=abc");
    await screen.findByRole("button", { name: "Ganti password" });
    expect(password().autocomplete).toBe("new-password");
    expect(confirm().autocomplete).toBe("new-password");
    expect(document.getElementById(password().getAttribute("aria-describedby")!)?.textContent).toBe("Minimal 8 karakter.");
    expect(document.activeElement).toBe(password());
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  test("checks the passwords before sending", async () => {
    const user = userEvent.setup();
    const api = stubApi({});
    renderApp("/portal/reset-password?token=abc");
    await screen.findByRole("button", { name: "Ganti password" });
    await user.click(submit());
    expect(screen.getByText("Password baru wajib diisi")).toBeTruthy();
    expect(document.getElementById("reset-confirm-error")?.textContent).toBe("Ulangi password baru");
    await user.type(password(), "rahasia123");
    await user.type(confirm(), "lain-lain");
    await user.click(submit());
    expect(screen.getByText("Konfirmasi password tidak cocok")).toBeTruthy();
    expect(api.count(`POST ${ENDPOINTS.resetPassword}`)).toBe(0);
  });

  test("sends the token and the new password, then goes to sign-in with the note, and the token is out of the history entry", async () => {
    const user = userEvent.setup();
    const api = stubApi({ ...config, [`POST ${ENDPOINTS.resetPassword}`]: respond({ status: true }) });
    renderApp("/portal/reset-password?token=abc123");
    await screen.findByRole("button", { name: "Ganti password" });
    await user.type(password(), "rahasia-baru-123");
    await user.type(confirm(), "rahasia-baru-123");
    await user.click(submit());
    expect(await screen.findByText("Password berhasil diganti. Silakan masuk dengan password baru.")).toBeTruthy();
    expect(location()).toBe("/login?reset=1");
    expect(api.last(`POST ${ENDPOINTS.resetPassword}`)?.body).toEqual({ newPassword: "rahasia-baru-123", token: "abc123" });
  });

  test.each([
    ["a spent link", respond({ code: "INVALID_TOKEN" }, 400), /Tautan reset tidak valid atau sudah kadaluarsa/],
    ["an expired link", respond({ code: "TOKEN_EXPIRED" }, 400), /Tautan reset tidak valid atau sudah kadaluarsa/],
  ])("%s offers a new link", async (_name, response, text) => {
    const user = userEvent.setup();
    stubApi({ [`POST ${ENDPOINTS.resetPassword}`]: response });
    renderApp("/portal/reset-password?token=abc");
    await screen.findByRole("button", { name: "Ganti password" });
    await user.type(password(), "rahasia-baru-123");
    await user.type(confirm(), "rahasia-baru-123");
    await user.click(submit());
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Minta tautan baru" }).getAttribute("href")).toBe("/portal/forgot-password");
  });

  test("a password the Worker refuses is said under the field; a server error on the form", async () => {
    const user = userEvent.setup();
    const answers = [respond({ code: "PASSWORD_TOO_SHORT" }, 400), respond({ error: "internal" }, 500)];
    stubApi({ [`POST ${ENDPOINTS.resetPassword}`]: () => (answers.shift() as Response).clone() });
    renderApp("/portal/reset-password?token=abc");
    await screen.findByRole("button", { name: "Ganti password" });
    await user.type(password(), "rahasia-baru-123");
    await user.type(confirm(), "rahasia-baru-123");
    await user.click(submit());
    expect(await screen.findByText("Password minimal 8 karakter")).toBeTruthy();
    await user.click(submit());
    expect((await screen.findByRole("alert")).textContent).toBe("Gagal mengganti password. Silakan coba lagi.");
  });
});
