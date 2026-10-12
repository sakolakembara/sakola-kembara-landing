import { afterEach, describe, expect, test, vi } from "vitest";
import { accessTo } from "../spa/src/lib/access";
import {
  CAPTCHA_FAILED_MESSAGE,
  CAPTCHA_UNAVAILABLE_MESSAGE,
  EMAIL_UNAVAILABLE_MESSAGE,
  resetFailure,
  resetRequestFailureMessage,
  signInFailureMessage,
  verifyOutcome,
} from "../spa/src/lib/auth-errors";
import { parsePublicConfig, TURNSTILE_HEADER as SPA_TURNSTILE_HEADER, TURNSTILE_ROUTES } from "../spa/src/lib/captcha";
import { decideGuard } from "../spa/src/lib/guard";
import { parseMe } from "../spa/src/lib/me";
import { visibleNav, visibleQuickActions } from "../spa/src/lib/nav";
import { findPolicy } from "../src/auth/gate";
import { TURNSTILE_HEADER as WORKER_TURNSTILE_HEADER, TURNSTILE_TEST_SECRETS, TURNSTILE_TEST_SITE_KEYS } from "../src/security/turnstile";
import {
  call,
  CAPTCHA,
  cookiesOf,
  createVerifiedUser,
  emailsTo,
  fakeNetwork,
  linkIn,
  PASSWORD,
  productionLike,
  revokeArea,
  signedInCookie,
  signUp,
  uniqueEmail,
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
    await createVerifiedUser(email, "editor", ["konten"]);
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
    const email = uniqueEmail();
    await signUp(email);
    expect(emailsTo(email)).toHaveLength(1);

    const res = await call("/api/auth/sign-in/email", {
      method: "POST",
      json: { email, password: PASSWORD, callbackURL: VERIFY_CALLBACK },
    });
    expect(res.status).toBe(403);
    expect(signInFailureMessage(await failureOf(res))).toContain("tautan verifikasi baru");

    // The fresh link carries the callback the SPA gave.
    expect(emailsTo(email)).toHaveLength(2);
    const link = linkIn(emailsTo(email)[1]!);
    expect(decodeURIComponent(link)).toContain(`callbackURL=${VERIFY_CALLBACK}`);

    // Following it verifies the account and lands on the success page.
    const verified = await call(link);
    expect(verified.status).toBe(302);
    expect(verified.headers.get("location")).toBe(VERIFY_CALLBACK);
    const landed = new URL(verified.headers.get("location")!, "https://admin.test");
    expect(verifyOutcome({ status: landed.searchParams.get("status"), error: landed.searchParams.get("error") }).ok).toBe(true);
  });

  test("a broken verification link lands on /verify-email with an error, which the SPA reports as failure", async () => {
    const email = uniqueEmail();
    await signUp(email);
    await call("/api/auth/sign-in/email", {
      method: "POST",
      json: { email, password: PASSWORD, callbackURL: VERIFY_CALLBACK },
    });
    const link = linkIn(emailsTo(email)[1]!).replace(/token=([^&]+)/, (_, token: string) => `token=${token.slice(0, -3)}abc`);

    const res = await call(link);
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
    const known = uniqueEmail();
    await createVerifiedUser(known);
    const a = await call("/api/auth/request-password-reset", { method: "POST", json: { email: known, redirectTo: RESET_PAGE } });
    const b = await call("/api/auth/request-password-reset", {
      method: "POST",
      json: { email: uniqueEmail("ghost"), redirectTo: RESET_PAGE },
    });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
  });

  test("the emailed link lands on /reset-password with a token, and the new password then works", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    await call("/api/auth/request-password-reset", { method: "POST", json: { email, redirectTo: RESET_PAGE } });
    const link = linkIn(emailsTo(email).find((message) => message.purpose === "reset-password")!);

    const redirect = await call(link);
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
    // One address floods the reset route: the per-IP bucket allows 5 a minute.
    const ip = "198.51.100.77";
    let last: Response | undefined;
    for (let i = 0; i < 12; i++) {
      last = await call("/api/auth/request-password-reset", {
        method: "POST",
        json: { email: uniqueEmail("flood"), redirectTo: RESET_PAGE },
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

describe("/api/me as the SPA reads it: the menu and the write controls follow the real answer", () => {
  async function sidebarFor(role: "student" | "viewer" | "editor" | "super_admin", granted: ("pendaftaran" | "komunikasi" | "konten")[] = []) {
    const cookie = await signedInCookie(uniqueEmail(), role, granted);
    const res = await call("/api/me", { cookie });
    expect(res.status).toBe(200);
    const me = parseMe(await res.json());
    expect(me).not.toBeNull();
    return me!;
  }
  const labelsOf = (me: Parameters<typeof visibleNav>[0]) => visibleNav(me).flatMap((group) => group.items.map((item) => item.label));

  test("a viewer: every group but Sistem, nothing writable", async () => {
    const me = await sidebarFor("viewer");
    expect(labelsOf(me)).toEqual(["Dashboard", "Batch", "Pendaftar", "Pusat Dokumen", "Pesan", "Pengumuman", "Blog", "Laporan", "Tim", "Shortlink"]);
    expect(me.areas.writable).toEqual([]);
    expect(visibleQuickActions(me)).toEqual([]);
  });

  test("an editor granted Konten: sees and changes Konten only, nothing else and no Sistem", async () => {
    const me = await sidebarFor("editor", ["konten"]);
    expect(me.areas).toEqual({ granted: ["konten"], visible: ["konten"], writable: ["konten"] });
    expect(accessTo(me, "konten")).toBe("write");
    expect(accessTo(me, "komunikasi")).toBe("none");
    expect(accessTo(me, "pendaftaran")).toBe("none");
    expect(accessTo(me, "sistem")).toBe("none");
    expect(labelsOf(me)).toEqual(["Dashboard", "Blog", "Laporan", "Tim", "Shortlink"]);
    expect(visibleQuickActions(me).map((action) => action.href)).toEqual(["/blog/new", "/reports/new", "/team/new"]);
  });

  test("an editor granted Pendaftaran and Komunikasi: those groups only", async () => {
    const me = await sidebarFor("editor", ["pendaftaran", "komunikasi"]);
    expect(labelsOf(me)).toEqual(["Dashboard", "Batch", "Pendaftar", "Pusat Dokumen", "Pesan", "Pengumuman"]);
    expect(accessTo(me, "konten")).toBe("none");
  });

  test("an editor with no grants has the dashboard and nothing else", async () => {
    const me = await sidebarFor("editor");
    expect(me.areas).toEqual({ granted: [], visible: [], writable: [] });
    expect(labelsOf(me)).toEqual(["Dashboard"]);
    expect(visibleQuickActions(me)).toEqual([]);
  });

  test("a revoked grant is gone on the next request, and the area with it", async () => {
    const email = uniqueEmail();
    const id = await createVerifiedUser(email, "editor", ["komunikasi"]);
    const cookie = cookiesOf(await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: PASSWORD } }));
    expect(accessTo(parseMe(await (await call("/api/me", { cookie })).json())!, "komunikasi")).toBe("write");

    await revokeArea(id, "komunikasi");
    expect(accessTo(parseMe(await (await call("/api/me", { cookie })).json())!, "komunikasi")).toBe("none");
  });

  test("super_admin: everything, Sistem included", async () => {
    const me = await sidebarFor("super_admin");
    expect(labelsOf(me)).toHaveLength(12);
    expect(labelsOf(me)).toContain("Pengaturan");
    expect(visibleQuickActions(me)).toHaveLength(4);
  });

  test("a student has an account but no admin access: the SPA shows its refusal screen", async () => {
    const me = await sidebarFor("student");
    expect(me.role).toBe("student");
    expect(visibleNav(me)).toEqual([]);
    expect(decideGuard({ status: "ready", me }, { pathname: "/" }).kind).toBe("no-admin-access");
  });
});

// The security check (SAKEM-082): the widget's token goes in a header, each page
// names its own action, and three answers have Indonesian text in the SPA. The
// SPA's side is `spa/src/lib/captcha.ts` and `auth-errors.ts`, pure files read here.
describe("the security check as the SPA uses it", () => {
  const SPA_HEADERS = { [SPA_TURNSTILE_HEADER]: CAPTCHA };

  test("the header the SPA sends is the one the Worker reads", () => {
    expect(SPA_TURNSTILE_HEADER.toLowerCase()).toBe(WORKER_TURNSTILE_HEADER);
  });

  test("each action the SPA declares is the one the Worker asks for on that route", () => {
    for (const [action, route] of Object.entries(TURNSTILE_ROUTES)) {
      expect(findPolicy("POST", route)?.turnstile, route).toBe(action);
    }
  });

  test("sign-in the way the SPA sends it (token in the header) passes the check, and the token goes to Siteverify", async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email);
    const network = fakeNetwork();
    const res = await call("/api/auth/sign-in/email", {
      method: "POST",
      json: { email, password: PASSWORD, callbackURL: "/verify-email?status=success" },
      headers: SPA_HEADERS,
      env: productionLike,
    });
    expect(res.status).toBe(200);
    expect(network.siteverify.map((request) => request.response)).toEqual([CAPTCHA]);
  });

  test("forgot-password the way the SPA sends it passes the check too", async () => {
    const network = fakeNetwork();
    const res = await call("/api/auth/request-password-reset", {
      method: "POST",
      json: { email: uniqueEmail(), redirectTo: "/reset-password" },
      headers: SPA_HEADERS,
      env: productionLike,
    });
    expect(res.status).toBe(200);
    expect(network.siteverify.map((request) => request.response)).toEqual([CAPTCHA]);
  });

  test("without a token: 403 captcha_failed, and the SPA says to try again", async () => {
    fakeNetwork();
    const signIn = await failureOf(
      await call("/api/auth/sign-in/email", { method: "POST", json: { email: uniqueEmail(), password: PASSWORD }, env: productionLike }),
    );
    expect(signIn).toMatchObject({ status: 403, code: "captcha_failed" });
    expect(signInFailureMessage(signIn)).toBe(CAPTCHA_FAILED_MESSAGE);

    const forgot = await failureOf(
      await call("/api/auth/request-password-reset", {
        method: "POST",
        json: { email: uniqueEmail(), redirectTo: "/reset-password" },
        env: productionLike,
      }),
    );
    expect(forgot).toMatchObject({ status: 403, code: "captcha_failed" });
    expect(resetRequestFailureMessage(forgot)).toBe(CAPTCHA_FAILED_MESSAGE);
  });

  test("a token Cloudflare says was already used: the same 403, the same line", async () => {
    fakeNetwork();
    const spent = await failureOf(
      await call("/api/auth/sign-in/email", {
        method: "POST",
        json: { email: uniqueEmail(), password: PASSWORD },
        headers: SPA_HEADERS,
        env: { ...productionLike, TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRETS.spent },
      }),
    );
    expect(spent).toMatchObject({ status: 403, code: "captcha_failed" });
    expect(signInFailureMessage(spent)).toBe(CAPTCHA_FAILED_MESSAGE);
  });

  test("Siteverify unreachable, or no secret in production: 503 captcha_unavailable, and the SPA says to wait", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network down"));
    const down = await failureOf(
      await call("/api/auth/request-password-reset", {
        method: "POST",
        json: { email: uniqueEmail(), redirectTo: "/reset-password" },
        headers: SPA_HEADERS,
        env: productionLike,
      }),
    );
    expect(down).toMatchObject({ status: 503, code: "captcha_unavailable" });
    expect(resetRequestFailureMessage(down)).toBe(CAPTCHA_UNAVAILABLE_MESSAGE);

    const noSecret = await failureOf(
      await call("/api/auth/sign-in/email", {
        method: "POST",
        json: { email: uniqueEmail(), password: PASSWORD },
        headers: SPA_HEADERS,
        env: { ...productionLike, TURNSTILE_SECRET_KEY: undefined },
      }),
    );
    expect(noSecret).toMatchObject({ status: 503, code: "captcha_unavailable" });
    expect(signInFailureMessage(noSecret)).toBe(CAPTCHA_UNAVAILABLE_MESSAGE);
  });

  test("no email provider in production: forgot-password answers 503 email_unavailable before the token is spent", async () => {
    const network = fakeNetwork();
    const missing = await failureOf(
      await call("/api/auth/request-password-reset", {
        method: "POST",
        json: { email: uniqueEmail(), redirectTo: "/reset-password" },
        headers: SPA_HEADERS,
        env: { ENVIRONMENT: "production", TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRETS.alwaysPass },
      }),
    );
    expect(missing).toMatchObject({ status: 503, code: "email_unavailable" });
    expect(resetRequestFailureMessage(missing)).toBe(EMAIL_UNAVAILABLE_MESSAGE);
    expect(network.siteverify).toHaveLength(0);
  });

  test("GET /api/config gives the SPA the site key, and only the site key", async () => {
    const key = TURNSTILE_TEST_SITE_KEYS.alwaysPass;
    const withKey = await call("/api/config", { env: { TURNSTILE_SITE_KEY: key, TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRETS.alwaysPass } });
    const body = await withKey.json();
    expect(parsePublicConfig(body)).toEqual({ google: false, turnstileSiteKey: key });
    expect(JSON.stringify(body)).not.toContain(TURNSTILE_TEST_SECRETS.alwaysPass);

    // A Worker without Turnstile configured: no widget in the SPA.
    expect(parsePublicConfig(await (await call("/api/config")).json())).toEqual({ google: false, turnstileSiteKey: null });
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
