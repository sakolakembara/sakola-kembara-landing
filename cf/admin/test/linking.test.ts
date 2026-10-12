import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vitest";
import { call, createVerifiedUser, cookiesOf, PASSWORD, signUp, uniqueEmail } from "./helpers";

// Account linking is left at Better Auth's defaults on purpose. Setting
// `trustedProviders: ["google"]` together with `requireLocalEmailVerified:
// false` would let a Google sign-in attach to ANY local account with the same
// email, verified or not. Because sign-up needs no proof of the address until
// the link is clicked, a stranger could register someone else's address first
// and keep its password after the real owner signs in with Google. That is the
// takeover RBT-D76 (Ruang Bakat) documents as the cost of those settings; here
// email verification is required at sign-up, and the defaults stay.

const google = { GOOGLE_CLIENT_ID: "fake-client-id", GOOGLE_CLIENT_SECRET: "fake-client-secret" };

afterEach(() => {
  vi.restoreAllMocks();
});

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Runs the whole Google flow with a faked Google token endpoint. Returns the callback response. */
async function signInWithGoogle(profile: { email: string; email_verified: boolean; sub?: string; name?: string }) {
  const start = await call("/api/auth/sign-in/social", {
    method: "POST",
    json: { provider: "google", callbackURL: "/announcements" },
    env: google,
  });
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state")!;

  const idToken = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({
    iss: "https://accounts.google.com",
    aud: google.GOOGLE_CLIENT_ID,
    sub: profile.sub ?? "google-sub-1",
    name: profile.name ?? "Google User",
    ...profile,
  })}.sig`;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (target.startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "fake-access", id_token: idToken, expires_in: 3600, token_type: "Bearer" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected outbound request: ${target}`);
  });

  return call(`/api/auth/callback/google?code=fake-code&state=${state}`, { env: google, cookie: cookiesOf(start) });
}

async function accountsOf(email: string) {
  const { results } = await env.DB.prepare(
    "SELECT a.provider_id AS provider FROM account a JOIN users u ON u.id = a.user_id WHERE u.email = ? ORDER BY a.provider_id",
  )
    .bind(email)
    .all<{ provider: string }>();
  return results.map((row) => row.provider);
}

describe("Google sign-in and account linking", () => {
  test("a new Google user becomes a verified student", async () => {
    const email = uniqueEmail("google-new");
    const res = await signInWithGoogle({ email, email_verified: true });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/announcements");
    expect(cookiesOf(res)).toContain("better-auth.session_token=");
    // The callback sets the session cookie AND clears the OAuth state cookie(s). Every one
    // must reach the browser as its own Set-Cookie header (a comma-joined header would corrupt them).
    expect(res.headers.getSetCookie().length).toBeGreaterThanOrEqual(2);
    const user = await env.DB.prepare("SELECT role, email_verified AS verified FROM users WHERE email = ?").bind(email).first<{ role: string; verified: number }>();
    expect(user).toEqual({ role: "student", verified: 1 });
  });

  test("Google links to an existing local account whose email is verified", async () => {
    const email = uniqueEmail("google-link");
    await createVerifiedUser(email);

    const res = await signInWithGoogle({ email, email_verified: true });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/announcements");
    expect(await accountsOf(email)).toEqual(["credential", "google"]);
  });

  // Negative test: add `account: { accountLinking: { trustedProviders: ["google"],
  // requireLocalEmailVerified: false } }` to the auth factory and this fails.
  test("Google does NOT link to a local account that never verified its email", async () => {
    const email = uniqueEmail("squatted");
    await signUp(email, "attacker chosen password"); // someone registered this address; the owner never clicked the link
    vi.restoreAllMocks();

    const res = await signInWithGoogle({ email, email_verified: true });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/auth\/error\?error=/);
    expect(cookiesOf(res)).not.toContain("session_token");
    expect(await accountsOf(email)).toEqual(["credential"]); // no Google account attached
    const user = await env.DB.prepare("SELECT email_verified AS verified FROM users WHERE email = ?").bind(email).first<{ verified: number }>();
    expect(user?.verified).toBe(0);
  });

  test("an email Google does not call verified is refused", async () => {
    const email = uniqueEmail("unverified-google");
    const res = await signInWithGoogle({ email, email_verified: false });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/auth\/error\?error=/);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM users WHERE email = ?").bind(email).first<{ n: number }>()).toEqual({ n: 0 });
  });

  test("linking Google does not change the role and the password keeps working", async () => {
    const email = uniqueEmail("keeps-role");
    await createVerifiedUser(email, "editor");
    await signInWithGoogle({ email, email_verified: true });

    const user = await env.DB.prepare("SELECT role FROM users WHERE email = ?").bind(email).first<{ role: string }>();
    expect(user?.role).toBe("editor");
    vi.restoreAllMocks();
    const res = await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: PASSWORD } });
    expect(res.status).toBe(200);
  });
});
