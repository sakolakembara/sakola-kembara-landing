import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { RESET_REQUESTED_MESSAGE } from "~/lib/auth-errors";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

const location = () => screen.getByTestId("location").textContent;

describe("forgot password", () => {
  const email = () => screen.getByLabelText("Email") as HTMLInputElement;
  const send = () => screen.getByRole("button", { name: /^(Kirim tautan reset|Mengirim…)$/ }) as HTMLButtonElement;

  async function open(routes: Parameters<typeof stubApi>[0] = {}) {
    const api = stubApi(routes);
    renderApp("/forgot-password");
    await screen.findByRole("heading", { name: "Lupa password?" });
    return api;
  }

  test("the form is labelled, with email autocomplete, and links back to sign-in", async () => {
    await open();
    expect(email().type).toBe("email");
    expect(email().autocomplete).toBe("email");
    expect(email().required).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(email()));
    expect(screen.getByRole("link", { name: "Kembali ke halaman masuk" }).getAttribute("href")).toBe("/login");
    await waitFor(() => expect(document.title).toBe("Lupa Password | Admin Sakola Kembara"));
  });

  test("asks Better Auth for a link that lands on /reset-password", async () => {
    const user = userEvent.setup();
    const api = await open({ "POST /api/auth/request-password-reset": respond({ status: true }) });
    await user.type(email(), " Ani@Contoh.TEST ");
    await user.click(send());
    await screen.findByText(RESET_REQUESTED_MESSAGE);
    expect(api.last("POST /api/auth/request-password-reset")?.body).toEqual({
      email: "ani@contoh.test",
      redirectTo: "/reset-password",
    });
  });

  test("says the same thing whether or not the address has an account", async () => {
    // The Worker answers alike for both (test/auth.test.ts); the page must not tell them apart.
    const seen: string[] = [];
    for (const answer of [respond({ status: true }), respond({ status: true, message: "different text from the server" })]) {
      const user = userEvent.setup();
      stubApi({ "POST /api/auth/request-password-reset": answer });
      const view = renderApp("/forgot-password");
      await screen.findByRole("heading", { name: "Lupa password?" });
      await user.type(email(), "siapa-saja@contoh.test");
      await user.click(send());
      await screen.findByText(RESET_REQUESTED_MESSAGE);
      seen.push(document.body.textContent ?? "");
      view.unmount();
    }
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).not.toContain("tidak ditemukan");
    expect(seen[0]).not.toContain("belum terdaftar");
    expect(seen[0]).not.toContain("tidak terdaftar");
  });

  test("a badly shaped email is stopped before sending", async () => {
    const user = userEvent.setup();
    const api = await open();
    await user.type(email(), "bukan-email");
    await user.click(send());
    expect(screen.getByText("Format email belum benar")).toBeTruthy();
    expect(email().getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(email().getAttribute("aria-describedby")!)?.textContent).toBe("Format email belum benar");
    expect(api.count("POST /api/auth/request-password-reset")).toBe(0);
  });

  test("an empty email", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(send());
    expect(screen.getByText("Email wajib diisi")).toBeTruthy();
  });

  test("rate limited", async () => {
    const user = userEvent.setup();
    await open({ "POST /api/auth/request-password-reset": respond({ error: "rate_limited" }, 429, { "Retry-After": "60" }) });
    await user.type(email(), "ani@contoh.test");
    await user.click(send());
    expect((await screen.findByRole("alert")).textContent).toBe("Terlalu banyak permintaan. Silakan tunggu 1 menit lalu coba lagi.");
  });

  test("a server error and an unreachable server read the same for every address", async () => {
    const user = userEvent.setup();
    await open({ "POST /api/auth/request-password-reset": respond({ error: "internal" }, 500) });
    await user.type(email(), "ani@contoh.test");
    await user.click(send());
    expect((await screen.findByRole("alert")).textContent).toBe("Gagal mengirim permintaan. Silakan coba lagi.");
  });

  test("a bot that fills the hidden field gets the normal answer and nothing is sent", async () => {
    const user = userEvent.setup();
    const api = await open({ "POST /api/auth/request-password-reset": respond({ status: true }) });
    await user.type(email(), "ani@contoh.test");
    const trap = document.querySelector<HTMLInputElement>('input[name="website"]')!;
    expect(trap.tabIndex).toBe(-1);
    expect(trap.getAttribute("aria-hidden")).toBe("true");
    trap.value = "http://spam.example";
    await user.click(send());
    await screen.findByText(RESET_REQUESTED_MESSAGE);
    expect(api.count("POST /api/auth/request-password-reset")).toBe(0);
  });

  test("two quick submits send one request", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const api = await open({ "POST /api/auth/request-password-reset": () => gate.promise });
    await user.type(email(), "ani@contoh.test");
    await user.click(send());
    expect(send().disabled).toBe(true);
    expect(send().textContent).toBe("Mengirim…");
    fireEvent.submit(send().closest("form")!);
    fireEvent.submit(send().closest("form")!);
    expect(api.count("POST /api/auth/request-password-reset")).toBe(1);
    gate.resolve(respond({ status: true }));
    await screen.findByText(RESET_REQUESTED_MESSAGE);
    await waitFor(() => expect(send().disabled).toBe(false));
  });
});

describe("reset password", () => {
  const fresh = () => screen.getByLabelText("Password baru") as HTMLInputElement;
  const confirm = () => screen.getByLabelText("Ulangi password baru") as HTMLInputElement;
  const save = () => screen.getByRole("button", { name: /^(Ganti password|Menyimpan…)$/ }) as HTMLButtonElement;

  async function open(path: string, routes: Parameters<typeof stubApi>[0] = {}) {
    const api = stubApi({ "GET /api/config": respond({ google: false }), ...routes });
    renderApp(path);
    await screen.findByRole("heading", { name: "Reset password" });
    return api;
  }

  describe("without a usable link", () => {
    test("no token", async () => {
      await open("/reset-password");
      expect(screen.getByRole("status").textContent).toBe("Tautan reset tidak lengkap. Silakan minta tautan baru.");
      expect(screen.getByRole("link", { name: "Minta tautan baru" }).getAttribute("href")).toBe("/forgot-password");
      expect(screen.queryByLabelText("Password baru")).toBeNull();
    });

    test("Better Auth sent ?error=INVALID_TOKEN (spent or expired link)", async () => {
      await open("/reset-password?error=INVALID_TOKEN");
      expect(screen.getByRole("status").textContent).toBe("Tautan reset tidak valid atau sudah kadaluarsa. Silakan minta tautan baru.");
      expect(screen.getByRole("link", { name: "Minta tautan baru" })).toBeTruthy();
    });

    test("a token and an error together: the error wins and the form is not offered", async () => {
      // Better Auth never sends both, but the page must not show a form for a link it was told is bad.
      await open("/reset-password?token=abc&error=INVALID_TOKEN");
      expect(screen.queryByLabelText("Password baru")).toBeNull();
      expect(screen.getByRole("link", { name: "Minta tautan baru" })).toBeTruthy();
    });
  });

  describe("the form", () => {
    test("labels, hint and autocomplete", async () => {
      await open("/reset-password?token=abc");
      expect(fresh().type).toBe("password");
      expect(fresh().autocomplete).toBe("new-password");
      expect(confirm().autocomplete).toBe("new-password");
      expect(screen.getByText("Minimal 8 karakter.")).toBeTruthy();
      expect(fresh().getAttribute("aria-describedby")).toBeTruthy();
      await waitFor(() => expect(document.activeElement).toBe(fresh()));
    });

    test("a short password is stopped, named, and focused", async () => {
      const user = userEvent.setup();
      const api = await open("/reset-password?token=abc");
      await user.type(fresh(), "pendek");
      await user.type(confirm(), "pendek");
      await user.click(save());
      expect(screen.getByText("Password minimal 8 karakter")).toBeTruthy();
      expect(fresh().getAttribute("aria-invalid")).toBe("true");
      expect(document.getElementById(fresh().getAttribute("aria-describedby")!)?.textContent).toBe("Password minimal 8 karakter");
      expect(document.activeElement).toBe(fresh());
      expect(api.count("POST /api/auth/reset-password")).toBe(0);
    });

    test("a mismatch is flagged on the second field", async () => {
      const user = userEvent.setup();
      const api = await open("/reset-password?token=abc");
      await user.type(fresh(), "kata sandi baru");
      await user.type(confirm(), "kata sandi lain");
      await user.click(save());
      expect(screen.getByText("Konfirmasi password tidak cocok")).toBeTruthy();
      expect(confirm().getAttribute("aria-invalid")).toBe("true");
      expect(fresh().getAttribute("aria-invalid")).toBeNull();
      expect(document.activeElement).toBe(confirm());
      expect(api.count("POST /api/auth/reset-password")).toBe(0);
    });

    test("success sends the token and the new password, then goes to sign-in", async () => {
      const user = userEvent.setup();
      const api = await open("/reset-password?token=tok-123", {
        "POST /api/auth/reset-password": respond({ status: true }),
      });
      await user.type(fresh(), "kata sandi baru");
      await user.type(confirm(), "kata sandi baru");
      await user.click(save());
      await screen.findByRole("heading", { name: "Masuk ke Admin Sakola Kembara" });
      expect(api.last("POST /api/auth/reset-password")?.body).toEqual({ newPassword: "kata sandi baru", token: "tok-123" });
      expect(location()).toBe("/login?reset=1");
      expect(screen.getByRole("status").textContent).toContain("Password berhasil diganti");
    });

    test("a link that turns out to be spent offers a new one", async () => {
      const user = userEvent.setup();
      await open("/reset-password?token=old", {
        "POST /api/auth/reset-password": respond({ code: "INVALID_TOKEN", message: "Invalid token" }, 400),
      });
      await user.type(fresh(), "kata sandi baru");
      await user.type(confirm(), "kata sandi baru");
      await user.click(save());
      expect((await screen.findByRole("status")).textContent).toBe(
        "Tautan reset tidak valid atau sudah kadaluarsa. Silakan minta tautan baru.",
      );
      expect(screen.getByRole("link", { name: "Minta tautan baru" })).toBeTruthy();
      expect(screen.queryByLabelText("Password baru")).toBeNull();
    });

    test("a length error from the server lands under the field", async () => {
      const user = userEvent.setup();
      await open("/reset-password?token=abc", {
        "POST /api/auth/reset-password": respond({ code: "PASSWORD_TOO_LONG" }, 400),
      });
      await user.type(fresh(), "kata sandi baru");
      await user.type(confirm(), "kata sandi baru");
      await user.click(save());
      expect(await screen.findByText("Password maksimal 128 karakter")).toBeTruthy();
      expect(fresh().getAttribute("aria-invalid")).toBe("true");
    });

    test("rate limited and offline", async () => {
      const user = userEvent.setup();
      let answer: () => Response = () => respond({ error: "rate_limited" }, 429, { "Retry-After": "120" });
      await open("/reset-password?token=abc", { "POST /api/auth/reset-password": () => answer() });
      await user.type(fresh(), "kata sandi baru");
      await user.type(confirm(), "kata sandi baru");
      await user.click(save());
      expect((await screen.findByRole("alert")).textContent).toBe("Terlalu banyak percobaan. Coba lagi dalam 2 menit.");

      answer = () => {
        throw new TypeError("Failed to fetch");
      };
      await user.click(save());
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe("Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi."),
      );
    });

    test("two quick submits send one request", async () => {
      const user = userEvent.setup();
      const gate = deferred<Response>();
      const api = await open("/reset-password?token=abc", { "POST /api/auth/reset-password": () => gate.promise });
      await user.type(fresh(), "kata sandi baru");
      await user.type(confirm(), "kata sandi baru");
      await user.click(save());
      expect(save().disabled).toBe(true);
      expect(save().textContent).toBe("Menyimpan…");
      fireEvent.submit(save().closest("form")!);
      fireEvent.submit(save().closest("form")!);
      expect(api.count("POST /api/auth/reset-password")).toBe(1);
      gate.resolve(respond({ status: true }));
      await screen.findByRole("heading", { name: "Masuk ke Admin Sakola Kembara" });
      expect(api.count("POST /api/auth/reset-password")).toBe(1);
    });
  });
});

describe("email verification result", () => {
  test("success", async () => {
    stubApi({});
    renderApp("/verify-email?status=success");
    expect(await screen.findByRole("heading", { name: "Email kamu berhasil diverifikasi" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Akun kamu sekarang sudah aktif. Silakan masuk untuk melanjutkan.");
    expect(screen.getByRole("link", { name: "Masuk" }).getAttribute("href")).toBe("/login");
    await waitFor(() => expect(document.title).toBe("Verifikasi Email | Admin Sakola Kembara"));
  });

  test.each(["TOKEN_EXPIRED", "INVALID_TOKEN"])("%s: tells how to get a new link", async (code) => {
    stubApi({});
    renderApp(`/verify-email?error=${code}`);
    expect(await screen.findByRole("heading", { name: "Tautan verifikasi tidak dapat diproses" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("kami akan mengirim tautan baru");
  });

  test("an unknown account", async () => {
    stubApi({});
    renderApp("/verify-email?error=USER_NOT_FOUND");
    expect((await screen.findByRole("alert")).textContent).toContain("sudah tidak ada");
  });

  test("opened by hand, it does not claim success", async () => {
    stubApi({});
    renderApp("/verify-email");
    expect(await screen.findByRole("heading", { name: "Tautan verifikasi tidak lengkap" })).toBeTruthy();
    expect(screen.queryByText("Terverifikasi")).toBeNull();
  });

  test("calls nothing: Better Auth already did the work", async () => {
    const api = stubApi({});
    renderApp("/verify-email?status=success");
    await screen.findByRole("heading", { name: "Email kamu berhasil diverifikasi" });
    expect(api.calls).toEqual([]);
  });
});

describe("auth error page", () => {
  test("shows the line for a known code", async () => {
    stubApi({});
    renderApp("/auth/error?error=access_denied");
    expect(await screen.findByRole("heading", { name: "Gagal masuk" })).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toContain("Izin masuk dengan Google tidak diberikan");
    expect(screen.getByRole("link", { name: "Kembali ke halaman masuk" }).getAttribute("href")).toBe("/login");
  });

  test("the generic line for anything else", async () => {
    stubApi({});
    renderApp("/auth/error?error=whatever");
    expect((await screen.findByRole("alert")).textContent).toBe("Gagal masuk. Silakan coba lagi.");
  });

  test("with no error at all", async () => {
    stubApi({});
    renderApp("/auth/error");
    expect((await screen.findByRole("alert")).textContent).toBe("Gagal masuk. Silakan coba lagi.");
  });
});

// A signed-in admin who opens a sign-in page is not redirected (the pages do not
// ask the server who they are); this just pins that the pages are reachable.
describe("auth pages are public", () => {
  test.each(["/login", "/forgot-password", "/reset-password?token=x", "/verify-email?status=success", "/auth/error"])("%s", async (path) => {
    const api = stubApi({ "GET /api/me": respond(meBody("viewer")), "GET /api/config": respond({ google: false }) });
    renderApp(path);
    await waitFor(() => expect(screen.getByRole("main")).toBeTruthy());
    expect(screen.queryByRole("navigation", { name: "Menu utama" })).toBeNull();
    expect(api.count("GET /api/me")).toBe(0);
  });
});
