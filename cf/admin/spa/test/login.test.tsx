import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

const config = { "GET /api/config": respond({ google: false }) };
const location = () => screen.getByTestId("location").textContent;
const email = () => screen.getByLabelText("Email") as HTMLInputElement;
const password = () => screen.getByLabelText("Password") as HTMLInputElement;
const submit = () => screen.getByRole("button", { name: /^(Masuk|Memproses…)$/ }) as HTMLButtonElement;

async function openLogin(path = "/login", routes: Parameters<typeof stubApi>[0] = {}) {
  const api = stubApi({ ...config, ...routes });
  renderApp(path);
  await screen.findByRole("heading", { name: "Masuk ke Admin Sakola Kembara" });
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
    // Nothing is marked invalid before anything is wrong.
    expect(email().getAttribute("aria-invalid")).toBeNull();
    expect(password().getAttribute("aria-invalid")).toBeNull();
  });

  test("the cursor starts in the email field", async () => {
    await openLogin();
    await waitFor(() => expect(document.activeElement).toBe(email()));
  });

  test("has the way to the password reset, and no registration link", async () => {
    await openLogin();
    expect(screen.getByRole("link", { name: "Lupa password?" }).getAttribute("href")).toBe("/forgot-password");
    expect(screen.queryByText(/Daftar/)).toBeNull();
    expect(screen.queryByRole("link", { name: /daftar/i })).toBeNull();
  });

  test("Google only when the server says it is configured", async () => {
    await openLogin();
    expect(screen.queryByRole("button", { name: "Masuk dengan Google" })).toBeNull();
  });

  test("Google when configured", async () => {
    await openLogin("/login", { "GET /api/config": respond({ google: true }) });
    expect(await screen.findByRole("button", { name: "Masuk dengan Google" })).toBeTruthy();
  });

  test("sets the tab title", async () => {
    await openLogin();
    await waitFor(() => expect(document.title).toBe("Masuk | Admin Sakola Kembara"));
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
      const described = document.getElementById(input.getAttribute("aria-describedby")!);
      expect(described?.textContent).toBe(message);
    }
    expect(api.count("POST /api/auth/sign-in/email")).toBe(0);
    // The cursor goes to the first problem.
    expect(document.activeElement).toBe(email());
  });

  test("a badly shaped email", async () => {
    const user = userEvent.setup();
    const api = await openLogin();
    await user.type(email(), "bukan-email");
    await user.type(password(), "rahasia");
    await user.click(submit());
    expect(screen.getByText("Format email belum benar")).toBeTruthy();
    expect(password().getAttribute("aria-invalid")).toBeNull();
    expect(api.count("POST /api/auth/sign-in/email")).toBe(0);
  });

  test("with only the password missing the cursor goes there", async () => {
    const user = userEvent.setup();
    await openLogin();
    await user.type(email(), "ani@contoh.test");
    await user.click(submit());
    expect(document.activeElement).toBe(password());
  });

  test("fixing the problem and sending again clears the messages", async () => {
    const user = userEvent.setup();
    await openLogin("/login", { "POST /api/auth/sign-in/email": respond({ error: "x" }, 500) });
    await user.click(submit());
    expect(screen.getByText("Email wajib diisi")).toBeTruthy();
    await user.type(email(), "ani@contoh.test");
    await user.type(password(), "rahasia");
    await user.click(submit());
    await waitFor(() => expect(screen.queryByText("Email wajib diisi")).toBeNull());
    expect(email().getAttribute("aria-invalid")).toBeNull();
  });
});

describe("login: signing in", () => {
  test("sends the email normalized, with the verification callback, then opens the dashboard", async () => {
    const user = userEvent.setup();
    const api = await openLogin("/login", {
      "POST /api/auth/sign-in/email": respond({ redirect: true, token: "t", user: {} }),
      "GET /api/me": respond(meBody("viewer")),
      "GET /api/dashboard": respond({ error: "not_found" }, 404),
    });
    await user.type(email(), "  Ani@Contoh.TEST ");
    await user.type(password(), "kata sandi saya");
    await user.click(submit());

    await screen.findByRole("navigation", { name: "Menu utama" });
    expect(api.last("POST /api/auth/sign-in/email")?.body).toEqual({
      email: "ani@contoh.test",
      password: "kata sandi saya",
      callbackURL: "/verify-email?status=success",
    });
    expect(location()).toBe("/");
  });

  test("goes back to the page asked for", async () => {
    const user = userEvent.setup();
    await openLogin("/login?from=%2Fapplications%3Fstatus%3Dpending", {
      "POST /api/auth/sign-in/email": respond({ redirect: true }),
      "GET /api/me": respond(meBody("viewer")),
    });
    await user.type(email(), "ani@contoh.test");
    await user.type(password(), "x");
    await user.click(submit());
    await screen.findByRole("navigation", { name: "Menu utama" });
    expect(location()).toBe("/applications?status=pending");
  });

  test.each(["https://evil.example/", "//evil.example", "/\\evil.example", "/login"])(
    "ignores an unsafe `from` (%s)",
    async (from) => {
      const user = userEvent.setup();
      await openLogin(`/login?from=${encodeURIComponent(from)}`, {
        "POST /api/auth/sign-in/email": respond({ redirect: true }),
        "GET /api/me": respond(meBody("viewer")),
        "GET /api/dashboard": respond({ error: "not_found" }, 404),
      });
      await user.type(email(), "ani@contoh.test");
      await user.type(password(), "x");
      await user.click(submit());
      await screen.findByRole("navigation", { name: "Menu utama" });
      expect(location()).toBe("/");
    },
  );
});

describe("login: every way it can fail, in Indonesian", () => {
  async function failWith(response: Response | (() => Response | Promise<Response>)) {
    const user = userEvent.setup();
    await openLogin("/login", { "POST /api/auth/sign-in/email": response as never });
    await user.type(email(), "ani@contoh.test");
    await user.type(password(), "x");
    await user.click(submit());
    return (await screen.findByRole("alert")).textContent;
  }

  test("wrong credentials", async () => {
    expect(await failWith(respond({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, 401))).toBe(
      "Email atau password salah.",
    );
  });

  test("the wrong-credentials message does not mark a field, so it says nothing about which is wrong", async () => {
    await failWith(respond({ code: "INVALID_EMAIL_OR_PASSWORD" }, 401));
    expect(email().getAttribute("aria-invalid")).toBeNull();
    expect(password().getAttribute("aria-invalid")).toBeNull();
  });

  test("email not verified", async () => {
    expect(await failWith(respond({ code: "EMAIL_NOT_VERIFIED", message: "Email not verified" }, 403))).toBe(
      "Email belum diverifikasi. Kami sudah mengirim tautan verifikasi baru ke email kamu.",
    );
  });

  test("rate limited, with the wait from Retry-After", async () => {
    expect(await failWith(respond({ error: "rate_limited" }, 429, { "Retry-After": "60" }))).toBe(
      "Terlalu banyak percobaan masuk. Silakan tunggu 1 menit lalu coba lagi.",
    );
  });

  test("rate limited without Retry-After", async () => {
    expect(await failWith(respond({ error: "rate_limited" }, 429))).toBe(
      "Terlalu banyak percobaan masuk. Silakan tunggu beberapa menit lalu coba lagi.",
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
    expect(await failWith(respond({ error: "internal" }, 500))).toBe("Gagal masuk. Silakan coba lagi.");
  });

  test("the form is usable again after a failure and keeps the email", async () => {
    await failWith(respond({ code: "INVALID_EMAIL_OR_PASSWORD" }, 401));
    expect(submit().disabled).toBe(false);
    expect(email().value).toBe("ani@contoh.test");
  });
});

describe("login: double submit", () => {
  test("two quick submits send one request, and the button says so while it waits", async () => {
    const user = userEvent.setup();
    const gate = deferred<Response>();
    const api = await openLogin("/login", {
      "POST /api/auth/sign-in/email": () => gate.promise,
      "GET /api/me": respond(meBody("viewer")),
      "GET /api/dashboard": respond({ error: "not_found" }, 404),
    });
    await user.type(email(), "ani@contoh.test");
    await user.type(password(), "x");

    await user.click(submit());
    expect(submit().disabled).toBe(true);
    expect(submit().textContent).toBe("Memproses…");
    expect(submit().closest("form")?.getAttribute("aria-busy")).toBe("true");
    // More submit events before the answer arrives (a held Enter, a script, two
    // events in one frame, before React has even drawn the disabled button).
    fireEvent.submit(submit().closest("form")!);
    fireEvent.submit(submit().closest("form")!);
    expect(api.count("POST /api/auth/sign-in/email")).toBe(1);

    gate.resolve(respond({ redirect: true }));
    await screen.findByRole("navigation", { name: "Menu utama" });
    expect(api.count("POST /api/auth/sign-in/email")).toBe(1);
  });
});

describe("login: links from elsewhere", () => {
  test("?error= shows its own line when known", async () => {
    await openLogin("/login?error=admin-only");
    expect((await screen.findByRole("alert")).textContent).toBe("Halaman itu hanya untuk pengurus yayasan.");
  });

  test("?error= with anything else shows the generic line and never the text", async () => {
    await openLogin("/login?error=%3Cb%3Ehalo%3C%2Fb%3E");
    expect((await screen.findByRole("alert")).textContent).toBe("Gagal masuk. Silakan coba lagi.");
    expect(document.body.innerHTML).not.toContain("<b>halo</b>");
  });

  test("?reset=1 says the password was changed", async () => {
    await openLogin("/login?reset=1");
    expect(screen.getByRole("status").textContent).toBe("Password berhasil diganti. Silakan masuk dengan password baru.");
  });
});
