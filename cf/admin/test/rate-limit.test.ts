import { describe, expect, test } from "vitest";
import { call, captureEmails, createVerifiedUser, freshIp, PASSWORD, signIn, uniqueEmail, withEmail } from "./helpers";

// Local Miniflare runs the same rate limit binding as production, with the
// limits from wrangler.jsonc: pair 5/min, email 20/min, ip 10/min.

describe("login throttling", () => {
  // Negative test: remove `app.use(`${AUTH_BASE_PATH}/*`, authRateLimit)` in
  // src/worker.ts and the sixth attempt below succeeds.
  test("the sixth attempt in a minute from one client on one account is refused", async () => {
    const email = uniqueEmail();
    const ip = freshIp();
    await createVerifiedUser(email);

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await signIn(email, "wrong password", ip)).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);

    // Even the right password is refused while the window is full.
    const blocked = await signIn(email, PASSWORD, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
  });

  test("another client is not affected by that client's failures", async () => {
    const email = uniqueEmail();
    const ip = freshIp();
    await createVerifiedUser(email);
    for (let i = 0; i < 6; i++) await signIn(email, "wrong password", ip);

    expect((await signIn(email, PASSWORD, freshIp())).status).toBe(200);
  });

  test("a classroom behind one address can all sign in", async () => {
    const ip = freshIp();
    const emails = Array.from({ length: 12 }, () => uniqueEmail("student"));
    for (const email of emails) await createVerifiedUser(email);

    const statuses = await Promise.all(emails.map((email) => signIn(email, PASSWORD, ip).then((r) => r.status)));
    expect(statuses.every((status) => status === 200)).toBe(true);
  });

  test("one account attacked from many addresses is throttled after 20 tries a minute", async () => {
    const email = uniqueEmail();
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await signIn(email, "guess", freshIp())).status);
    expect(statuses.slice(0, 20).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });
});

describe("email-sending routes", () => {
  test("one address cannot start more than 10 sign-ups a minute", async () => {
    captureEmails();
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await call("/api/auth/sign-up/email", {
        method: "POST",
        ip,
        json: { email: uniqueEmail("flood"), password: PASSWORD, name: "Flood" },
        env: withEmail,
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  test("only the guarded routes are throttled, and only on POST", async () => {
    const ip = freshIp();
    for (let i = 0; i < 25; i++) expect((await call("/api/auth/get-session", { ip })).status).toBe(200);
  });
});
