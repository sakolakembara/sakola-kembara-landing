import { afterEach, describe, expect, test, vi } from "vitest";
import { resetFailure, resetRequestFailureMessage, signInFailureMessage, verifyOutcome } from "../spa/src/lib/auth-errors";
import { parseMe } from "../spa/src/lib/me";
import {
  call,
  captureEmails,
  cookiesOf,
  createVerifiedUser,
  linkIn,
  PASSWORD,
  signedInCookie,
  signUp,
  uniqueEmail,
  withEmail,
} from "./helpers";

// What the SPA sends and expects back, checked against the real Worker in
// workerd. The SPA tests (spa/test) stub the API, so these are what keep the
// two sides honest: the request bodies and callback URLs the auth pages use
// (spa/src/pages/auth), the error codes `lib/auth-errors.ts` maps, and the
// redirects that land on /verify-email and /reset-password.

afterEach(() => {
  vi.restoreAllMocks();
});

const VERIFY_CALLBACK = "/verify-email?status=success"; // spa/src/pages/auth/Login.tsx
const RESET_PAGE = "/reset-password"; // spa/src/pages/auth/ForgotPassword.tsx

/** What `api()` in the SPA would make of a Response. */
async function failureOf(res: Response) {
  const body = (await res.json().catch(() => null)) as { code?: string; error?: string } | null;
  const retry = res.headers.get("retry-after");
  return {
    status: res.status,
    code: body?.code ?? body?.error,
    retryAfter: retry && /^\d+$/.test(retry) ? Number(retry) : undefined,
  };
}

describe("sign-in as the SPA sends it", () => {
  test("a verified account gets a session, and /api/me reads as a Me", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email, "editor");
    const res = await call("/api/auth/sign-in/email", {
      method: "POST",
      json: { email, password: PASSWORD, callbackURL: VERIFY_CALLBACK },
    });
    expect(res.status).toBe(200);

    const me = await call("/api/me", { cookie: cookiesOf(res) });
    expect(me.status).toBe(200);
    expect(parseMe(await me.json())).toMatchObject({ email, role: "editor", emailVerified: true });
  });

  test("a wrong password and an unknown address look the same, and map to one line", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    const wrong = await failureOf(await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: "salah salah salah" } }));
    const unknown = await failureOf(
      await call("/api/auth/sign-in/email", { method: "POST", json: { email: uniqueEmail("ghost"), password: PASSWORD } }),
    );
    expect(wrong).toEqual(unknown);
    expect(wrong.status).toBe(401);
    expect(signInFailureMessage(wrong)).toBe("Email atau password salah.");
  });

  test("an unverified account: 403, the SPA says a fresh link was sent, and that link lands on /verify-email", async () => {
    const { sent } = captureEmails();
    const email = uniqueEmail();
    await signUp(email);
    expect(sent).toHaveLength(1);

    const res = await call("/api/auth/sign-in/email", {
      method: "POST",
      json: { email, password: PASSWORD, callbackURL: VERIFY_CALLBACK },
      env: withEmail,
    });
    expect(res.status).toBe(403);
    expect(signInFailureMessage(await failureOf(res))).toContain("tautan verifikasi baru");

    // The fresh link carries the callback the SPA gave.
    expect(sent).toHaveLength(2);
    const link = linkIn(sent[1]!);
    expect(decodeURIComponent(link)).toContain(`callbackURL=${VERIFY_CALLBACK}`);

    // Following it verifies the account and lands on the success page.
    const verified = await call(link, { env: withEmail });
    expect(verified.status).toBe(302);
    expect(verified.headers.get("location")).toBe(VERIFY_CALLBACK);
    const landed = new URL(verified.headers.get("location")!, "https://admin.test");
    expect(verifyOutcome({ status: landed.searchParams.get("status"), error: landed.searchParams.get("error") }).ok).toBe(true);
  });

  test("a broken verification link lands on /verify-email with an error, which the SPA reports as failure", async () => {
    const { sent } = captureEmails();
    const email = uniqueEmail();
    await signUp(email);
    await call("/api/auth/sign-in/email", {
      method: "POST",
      json: { email, password: PASSWORD, callbackURL: VERIFY_CALLBACK },
      env: withEmail,
    });
    const link = linkIn(sent[1]!).replace(/token=([^&]+)/, (_, token: string) => `token=${token.slice(0, -3)}abc`);

    const res = await call(link, { env: withEmail });
    expect(res.status).toBe(302);
    const landed = new URL(res.headers.get("location")!, "https://admin.test");
    expect(landed.pathname).toBe("/verify-email");
    expect(landed.searchParams.get("error")).toBe("INVALID_TOKEN");
    // `status=success` is still in the URL; the error must win.
    expect(landed.searchParams.get("status")).toBe("success");
    expect(verifyOutcome({ status: landed.searchParams.get("status"), error: landed.searchParams.get("error") }).ok).toBe(false);
  });
});

describe("password reset as the SPA drives it", () => {
  test("the request answers alike for a known and an unknown address, and the SPA shows one line", async () => {
    captureEmails();
    const known = uniqueEmail();
    await createVerifiedUser(known);
    const a = await call("/api/auth/request-password-reset", { method: "POST", json: { email: known, redirectTo: RESET_PAGE }, env: withEmail });
    const b = await call("/api/auth/request-password-reset", {
      method: "POST",
      json: { email: uniqueEmail("ghost"), redirectTo: RESET_PAGE },
      env: withEmail,
    });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
  });

  test("the emailed link lands on /reset-password with a token, and the new password then works", async () => {
    const { sent } = captureEmails();
    const email = uniqueEmail();
    await createVerifiedUser(email);
    const before = sent.length;
    await call("/api/auth/request-password-reset", { method: "POST", json: { email, redirectTo: RESET_PAGE }, env: withEmail });
    const link = linkIn(sent[before]!);

    const redirect = await call(link, { env: withEmail });
    expect(redirect.status).toBe(302);
    const landed = new URL(redirect.headers.get("location")!, "https://admin.test");
    expect(landed.pathname).toBe(RESET_PAGE);
    const token = landed.searchParams.get("token");
    expect(token).toBeTruthy();

    // The body the SPA sends.
    const newPassword = "kata sandi yang baru";
    const reset = await call("/api/auth/reset-password", { method: "POST", json: { newPassword, token } });
    expect(reset.status).toBe(200);

    const signIn = (password: string) => call("/api/auth/sign-in/email", { method: "POST", json: { email, password } });
    expect((await signIn(newPassword)).status).toBe(200);
    expect((await signIn(PASSWORD)).status).toBe(401);

    // The link is spent: the SPA offers a new one.
    const again = await call("/api/auth/reset-password", { method: "POST", json: { newPassword, token } });
    expect(again.status).toBe(400);
    expect(resetFailure(await failureOf(again))).toMatchObject({ linkExpired: true });
  });

  test("a link that is not valid redirects to /reset-password?error=INVALID_TOKEN", async () => {
    const res = await call(`/api/auth/reset-password/not-a-real-token?callbackURL=${encodeURIComponent(RESET_PAGE)}`);
    expect(res.status).toBe(302);
    const landed = new URL(res.headers.get("location")!, "https://admin.test");
    expect(landed.pathname).toBe(RESET_PAGE);
    expect(landed.searchParams.get("error")).toBe("INVALID_TOKEN");
    expect(landed.searchParams.get("token")).toBeNull();
  });

  test("the length rules the SPA states (8 to 128) are the Worker's, with the codes the SPA maps", async () => {
    const short = await call("/api/auth/reset-password", { method: "POST", json: { newPassword: "x".repeat(7), token: "whatever" } });
    expect(short.status).toBe(400);
    expect(resetFailure(await failureOf(short))).toEqual({ message: "Password minimal 8 karakter", field: "password" });

    const long = await call("/api/auth/reset-password", { method: "POST", json: { newPassword: "x".repeat(129), token: "whatever" } });
    expect(long.status).toBe(400);
    expect(resetFailure(await failureOf(long))).toEqual({ message: "Password maksimal 128 karakter", field: "password" });

    // Exactly at the limits it gets as far as the token, which is what the SPA expects.
    for (const length of [8, 128]) {
      const edge = await call("/api/auth/reset-password", { method: "POST", json: { newPassword: "x".repeat(length), token: "whatever" } });
      expect((await failureOf(edge)).code).toBe("INVALID_TOKEN");
    }
  });

  test("the limiter's answer carries a Retry-After the SPA turns into a wait", async () => {
    // One address floods the email routes: the per-IP bucket allows 10 a minute.
    captureEmails();
    const ip = "198.51.100.77";
    let last: Response | undefined;
    for (let i = 0; i < 12; i++) {
      last = await call("/api/auth/request-password-reset", {
        method: "POST",
        json: { email: uniqueEmail("flood"), redirectTo: RESET_PAGE },
        env: withEmail,
        ip,
      });
      if (last.status === 429) break;
    }
    expect(last?.status).toBe(429);
    const failure = await failureOf(last!);
    expect(failure.retryAfter).toBe(60);
    expect(resetRequestFailureMessage(failure)).toBe("Terlalu banyak permintaan. Silakan tunggu 1 menit lalu coba lagi.");
  });
});

describe("sign-out as the SPA sends it", () => {
  test("POST with an empty JSON body ends the session", async () => {
    const cookie = await signedInCookie(uniqueEmail(), "viewer");
    expect((await call("/api/me", { cookie })).status).toBe(200);

    const out = await call("/api/auth/sign-out", { method: "POST", json: {}, cookie });
    expect(out.status).toBe(200);
    expect((await call("/api/me", { cookie })).status).toBe(401);
  });
});
