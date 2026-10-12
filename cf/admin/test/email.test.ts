import { afterEach, describe, expect, test, vi } from "vitest";
import { accountExistsEmail, adminInviteEmail, passwordResetEmail, verificationEmail } from "../src/email/templates";
import { emailAvailable, mailbox, sendEmail, type EmailMessage } from "../src/email/send";
import { call, fakeNetwork, withEmail } from "./helpers";

// src/email/: Resend over fetch, templates, the in-memory mailbox.

afterEach(() => {
  vi.restoreAllMocks();
});

const LINK = "https://admin.test/api/auth/verify-email?token=SECRET-TOKEN-123&callbackURL=%2F";
const message: EmailMessage = { to: "siswa@example.test", subject: "Subjek", html: `<a href="${LINK}">x</a>`, text: `Buka ${LINK}`, purpose: "verify-email" };

function captureLogs() {
  const lines: string[] = [];
  for (const method of ["error", "warn", "info", "log", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")));
  }
  return lines;
}

describe("sending through Resend", () => {
  test("POSTs the message to the Resend API with the key, from address, recipient, bodies and a purpose tag", async () => {
    const network = fakeNetwork();
    expect(await sendEmail({ ...withEmail, ENVIRONMENT: "production" }, message)).toEqual({ ok: true });

    expect(network.resend).toHaveLength(1);
    expect(network.resend[0]).toMatchObject({
      from: "Sakola Kembara <no-reply@example.test>",
      to: "siswa@example.test",
      subject: "Subjek",
      text: message.text,
      html: message.html,
      tags: [{ name: "purpose", value: "verify-email" }],
    });
    const headers = network.resendRequests[0]!.headers;
    expect(headers.get("authorization")).toBe("Bearer re_fake_key_for_tests");
    expect(headers.get("content-type")).toBe("application/json");
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal); // there is a timeout
    expect(mailbox.messages).toHaveLength(0); // the mailbox is for runs without a key
  });

  test("any non-2xx answer is a failure, never a success, and logs one line with the status", async () => {
    for (const status of [400, 401, 403, 422, 500, 502, 503]) {
      const logs = captureLogs();
      const network = fakeNetwork();
      network.resendStatus = status;
      expect(await sendEmail({ ...withEmail, ENVIRONMENT: "production" }, message), `HTTP ${status}`).toEqual({ ok: false, reason: "provider_error" });
      expect(logs, `HTTP ${status}`).toEqual([`[email] provider rejected verify-email email: HTTP ${status} unknown`]);
      vi.restoreAllMocks();
    }
  });

  test("a 3xx is a failure too (fetch follows redirects, but a 304 or 300 is not 'sent')", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 304 }));
    expect(await sendEmail({ ...withEmail, ENVIRONMENT: "production" }, message)).toMatchObject({ ok: false });
  });

  test("429 is told apart, with Retry-After when Resend sends it, and the quota name in the log", async () => {
    const logs = captureLogs();
    const network = fakeNetwork();
    network.resendStatus = 429;
    network.resendHeaders = { "retry-after": "37" };
    network.resendBody = JSON.stringify({ name: "daily_quota_exceeded", message: "You have reached your daily email sending quota." });

    expect(await sendEmail({ ...withEmail, ENVIRONMENT: "production" }, message)).toEqual({ ok: false, reason: "provider_rate_limited", retryAfterSeconds: 37 });
    expect(logs.join("\n")).toContain("Resend limit reached for verify-email email: HTTP 429 daily_quota_exceeded");
  });

  test("429 without Retry-After has no retryAfterSeconds", async () => {
    const network = fakeNetwork();
    network.resendStatus = 429;
    const result = await sendEmail({ ...withEmail, ENVIRONMENT: "production" }, message);
    expect(result).toEqual({ ok: false, reason: "provider_rate_limited" });
  });

  test("a network error and a timeout are failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    expect(await sendEmail({ ...withEmail, ENVIRONMENT: "production" }, message)).toEqual({ ok: false, reason: "provider_error" });
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("The operation timed out", "TimeoutError"));
    expect(await sendEmail({ ...withEmail, ENVIRONMENT: "production" }, message)).toEqual({ ok: false, reason: "provider_error" });
  });

  test("logs hold the purpose, the status and Resend's short error name: never the address, the subject, the link or the key", async () => {
    const logs = captureLogs();
    const network = fakeNetwork();
    network.resendStatus = 422;
    network.resendBody = JSON.stringify({ name: "validation_error", message: `Invalid recipient siswa@example.test ${LINK}` });
    await sendEmail({ ...withEmail, ENVIRONMENT: "production" }, message);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error(`socket closed for ${LINK} re_fake_key_for_tests`));
    await sendEmail({ ...withEmail, ENVIRONMENT: "production" }, message);

    const all = logs.join("\n");
    expect(all).toContain("provider rejected verify-email email: HTTP 422 validation_error");
    expect(all).toContain("provider unreachable for verify-email email");
    for (const secret of ["siswa@example.test", "SECRET-TOKEN-123", "Subjek", "re_fake_key_for_tests", "token="]) expect(all).not.toContain(secret);
  });

  test("an unreadable error body logs 'unknown', not the body", async () => {
    const logs = captureLogs();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>SECRET-TOKEN-123</html>", { status: 500 }));
    await sendEmail({ ...withEmail, ENVIRONMENT: "production" }, message);
    expect(logs.join("\n")).toContain("HTTP 500 unknown");
    expect(logs.join("\n")).not.toContain("SECRET-TOKEN-123");
  });
});

describe("fails closed in production", () => {
  // Negative check: make sendEmail record-and-succeed when production has no key.
  test("no RESEND_API_KEY: not sent, `provider_not_configured`, one log line with the purpose only", async () => {
    const logs = captureLogs();
    const network = fakeNetwork();
    const result = await sendEmail({ ENVIRONMENT: "production", EMAIL_FROM: "a <a@example.test>" }, message);

    expect(result).toEqual({ ok: false, reason: "provider_not_configured" });
    expect(network.resend).toHaveLength(0);
    expect(mailbox.messages).toHaveLength(0); // nothing is kept either
    expect(logs).toEqual(["[email] provider not configured; verify-email email was not sent"]);
  });

  test("no EMAIL_FROM is the same, and so is an empty key", async () => {
    fakeNetwork();
    expect(await sendEmail({ ENVIRONMENT: "production", RESEND_API_KEY: "k" }, message)).toMatchObject({ ok: false, reason: "provider_not_configured" });
    expect(await sendEmail({ ENVIRONMENT: "production", RESEND_API_KEY: "", EMAIL_FROM: "a <a@example.test>" }, message)).toMatchObject({ ok: false, reason: "provider_not_configured" });
    expect(mailbox.messages).toHaveLength(0);
  });

  test("a missing or unknown ENVIRONMENT counts as production", async () => {
    fakeNetwork();
    for (const environment of [undefined, "", "prod", "staging", "Development"]) {
      expect(await sendEmail({ ENVIRONMENT: environment }, message), String(environment)).toMatchObject({ ok: false, reason: "provider_not_configured" });
    }
    expect(mailbox.messages).toHaveLength(0);
  });

  test("emailAvailable: the question the routes ask before they create anything", () => {
    expect(emailAvailable({ ENVIRONMENT: "production" })).toBe(false);
    expect(emailAvailable({ ENVIRONMENT: "production", RESEND_API_KEY: "k" })).toBe(false);
    expect(emailAvailable({ ENVIRONMENT: "production", RESEND_API_KEY: "k", EMAIL_FROM: "a" })).toBe(true);
    expect(emailAvailable({ ENVIRONMENT: undefined })).toBe(false);
    expect(emailAvailable({ ENVIRONMENT: "development" })).toBe(true);
    expect(emailAvailable({ ENVIRONMENT: "test" })).toBe(true);
  });
});

describe("outside production without a key: the in-memory mailbox", () => {
  test("the message is recorded and the send succeeds; nothing is printed and nothing goes out", async () => {
    const logs = captureLogs();
    const network = fakeNetwork();
    for (const environment of ["development", "test"]) {
      expect(await sendEmail({ ENVIRONMENT: environment }, message)).toEqual({ ok: true });
    }
    expect(logs).toEqual([]); // no link, token or address on the console
    expect(network.resend).toHaveLength(0);
    expect(mailbox.messages).toHaveLength(2);
    expect(mailbox.messages[0]).toMatchObject({ to: "siswa@example.test", subject: "Subjek", purpose: "verify-email", text: message.text });
    expect(mailbox.messages[0]!.at).toBeTypeOf("number");
  });

  test("it keeps the newest 50 only, and clear() empties it", async () => {
    for (let i = 0; i < 60; i++) await sendEmail({ ENVIRONMENT: "test" }, { ...message, subject: `n${i}` });
    expect(mailbox.messages).toHaveLength(50);
    expect(mailbox.messages[0]!.subject).toBe("n10");
    expect(mailbox.messages.at(-1)!.subject).toBe("n59");
    mailbox.clear();
    expect(mailbox.messages).toEqual([]);
  });

  test("a configured key wins over the mailbox, in any environment", async () => {
    const network = fakeNetwork();
    await sendEmail({ ...withEmail, ENVIRONMENT: "development" }, message);
    expect(network.resend).toHaveLength(1);
    expect(mailbox.messages).toHaveLength(0);
  });
});

describe("GET /api/dev/mailbox (local development only)", () => {
  test("serves the recorded messages when ENVIRONMENT is exactly 'development'", async () => {
    await sendEmail({ ENVIRONMENT: "development" }, message);
    const res = await call("/api/dev/mailbox", { env: { ENVIRONMENT: "development" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: { to: string; text: string }[] };
    expect(body.messages.map((m) => m.to)).toEqual(["siswa@example.test"]);
    expect(body.messages[0]!.text).toContain("SECRET-TOKEN-123");
  });

  test("does not exist in production, in tests, or when ENVIRONMENT is anything else or missing", async () => {
    await sendEmail({ ENVIRONMENT: "development" }, message);
    for (const environment of ["production", "test", "", "staging", "Development", undefined]) {
      const res = await call("/api/dev/mailbox", { env: { ENVIRONMENT: environment } });
      expect(res.status, String(environment)).toBe(404);
      expect(await res.text(), String(environment)).not.toContain("SECRET-TOKEN-123");
    }
  });
});

describe("templates", () => {
  const url = "https://admin.test/api/auth/reset-password/TOKEN?callbackURL=%2Freset-password";

  test("subjects are the legacy ones (verification, reset) and the new ones, constant and Indonesian", () => {
    expect(verificationEmail("a@example.test", url).subject).toBe("Verifikasi email Sakola Kembara");
    expect(passwordResetEmail("a@example.test", url).subject).toBe("Reset password akun Sakola Kembara");
    expect(adminInviteEmail("a@example.test", url, { role: "editor" }).subject).toBe("Undangan admin Sakola Kembara");
    expect(accountExistsEmail("a@example.test", url).subject).toBe("Kamu sudah punya akun Sakola Kembara");
  });

  test("each has the purpose it is logged and tagged with", () => {
    expect([verificationEmail, passwordResetEmail, accountExistsEmail].map((make) => make("a@example.test", url).purpose)).toEqual(["verify-email", "reset-password", "account-exists"]);
    expect(adminInviteEmail("a@example.test", url, { role: "viewer" }).purpose).toBe("admin-invite");
  });

  test("the link is in both bodies, the lifetimes are the legacy ones, and the voice is 'kamu'", () => {
    const verify = verificationEmail("a@example.test", url);
    expect(verify.text).toContain(url);
    expect(verify.html).toContain(`href="${url}"`);
    expect(verify.text).toContain("berlaku selama 24 jam");
    expect(verify.html).toContain('<html lang="id">');
    const reset = passwordResetEmail("a@example.test", url);
    expect(reset.text).toContain("berlaku selama 30 menit");
    expect(reset.text).toContain("password kamu tidak akan berubah");
    const invite = adminInviteEmail("a@example.test", url, { role: "editor" });
    expect(invite.text).toContain("berlaku selama 7 hari");
    expect(invite.text).toContain("hanya bisa dipakai sekali");
  });

  test("plain text ends with the foundation's name, like the legacy mail", () => {
    for (const email of [verificationEmail("a@example.test", url), passwordResetEmail("a@example.test", url), accountExistsEmail("a@example.test", url)]) {
      expect(email.text.endsWith("— Yayasan Sakola Kembara Indonesia")).toBe(true);
    }
  });

  test("the account-exists notice carries no token, only the sign-in page", () => {
    const notice = accountExistsEmail("a@example.test", "https://admin.test/login");
    expect(notice.text).toContain("https://admin.test/login");
    expect(notice.text).toContain("Lupa password");
    expect(notice.text).not.toContain("token");
  });

  test("the inviter's name is escaped in the HTML, trimmed and capped, and never reaches the subject", () => {
    const evil = `<script>alert(1)</script> "Bob" & Co`;
    const invite = adminInviteEmail("a@example.test", url, { role: "super_admin", inviterName: evil });
    expect(invite.html).not.toContain("<script>");
    expect(invite.html).toContain("&lt;script&gt;");
    expect(invite.html).toContain("&quot;Bob&quot; &amp; Co");
    expect(invite.subject).toBe("Undangan admin Sakola Kembara");
    expect(invite.html).toContain("Super Admin");
    expect(adminInviteEmail("a@example.test", url, { role: "editor", inviterName: "x".repeat(500) }).text).not.toContain("x".repeat(121));
    expect(adminInviteEmail("a@example.test", url, { role: "editor", inviterName: "   " }).text).toContain("Seorang super admin");
  });

  test("a URL with quotes or markup cannot break out of the HTML attribute", () => {
    const hostile = `https://admin.test/x?a="><script>alert(1)</script>&b='1'`;
    const html = verificationEmail("a@example.test", hostile).html;
    expect(html).not.toContain("<script>");
    expect(html).toContain('href="https://admin.test/x?a=&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;b=&#39;1&#39;"');
  });

  test("role labels are human, an unknown role is shown as given", () => {
    expect(adminInviteEmail("a@example.test", url, { role: "viewer" }).text).toContain("Viewer (hanya bisa membaca)");
    expect(adminInviteEmail("a@example.test", url, { role: "editor" }).text).toContain("menjadi Editor");
  });
});
