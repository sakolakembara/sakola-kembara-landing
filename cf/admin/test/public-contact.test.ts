import { env } from "cloudflare:workers";
import { Hono } from "hono";
import wranglerConfig from "../wrangler.jsonc?raw";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createContactRoutes } from "../src/api/public/contact";
import { CONTACT_MESSAGES, CONTACT_RATE_LIMIT, isIpLiteral } from "../src/public/contact";
import { InMemoryRateLimiter, turnstileDisabled, type ContactDeps, type RateLimiter, type VerifyTurnstile } from "../src/public/contact-deps";
import { RATE_LIMITS } from "../src/security/rate-limit";
import { SITEVERIFY_URL, TURNSTILE_TEST_SECRETS } from "../src/security/turnstile";
import { call, fakeNetwork, uniqueEmail } from "./helpers";
import { CONTACT_CREATED, FIELD_ERRORS_EXAMPLE } from "./contract-examples";
import { internalFetch, internalFetchWith, internalFetchWithBindings, json, uniqueIp } from "./public-helpers";

// POST /api/public/contact: reachable only through the service binding.

const message = "Halo, saya ingin bertanya soal program.";
const valid = (over: Record<string, unknown> = {}) => ({ fullName: "  Budi Santoso ", email: uniqueEmail("budi"), subject: "other", message, website: "", ...over });

const rows = async () => (await env.DB.prepare("SELECT * FROM contact_messages ORDER BY created_at").all<Record<string, unknown>>()).results;
const auditRows = async () => (await env.DB.prepare("SELECT * FROM audit_log").all<Record<string, unknown>>()).results;
const count = async (table: string) => (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

/** Test collaborators: a limiter that records its keys and a bot check that records its inputs. */
function deps(over: Partial<ContactDeps> = {}): ContactDeps & { keys: string[]; checks: { token: string | null; ip: string }[] } {
  const keys: string[] = [];
  const checks: { token: string | null; ip: string }[] = [];
  const inner = new InMemoryRateLimiter(5, 60);
  const rateLimiter: RateLimiter = {
    async hit(key) {
      keys.push(key);
      return inner.hit(key);
    },
  };
  const verifyTurnstile: VerifyTurnstile = async (input) => {
    checks.push(input);
    return true;
  };
  return { rateLimiter, verifyTurnstile, now: Date.now, ...over, keys, checks };
}

const post = (body: unknown, clientIp: string | null = uniqueIp(), extra: RequestInit = {}) => internalFetch("/api/public/contact", { method: "POST", json: body, clientIp, ...extra });

afterEach(() => vi.restoreAllMocks());

describe("only through the service binding", () => {
  // Negative test (scripts/negative-checks.mjs): mount the contact route on the
  // public app, or drop the guard from the route, and these fail.
  test("the Worker's public face has no such route: a valid post from the internet is the ordinary 404 and stores nothing", async () => {
    const res = await call("/api/public/contact", { method: "POST", json: valid(), headers: { "x-sakem-client-ip": "198.51.100.77" } });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "not_found" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await count("contact_messages")).toBe(0);
    expect(await count("audit_log")).toBe(0);
  });

  test("a forged X-Sakem-Client-Ip changes nothing on the public face, however often it is sent", async () => {
    for (let i = 0; i < 12; i++) {
      const res = await call("/api/public/contact", { method: "POST", json: valid({ email: uniqueEmail() }), headers: { "x-sakem-client-ip": `198.51.100.${i + 1}` } });
      expect(res.status).toBe(404);
    }
    expect(await count("contact_messages")).toBe(0);
  });

  test("other methods and the read endpoints do not turn the route on", async () => {
    for (const method of ["GET", "PUT", "DELETE", "OPTIONS"]) {
      expect((await call("/api/public/contact", { method })).status, method).toBe(404);
    }
    expect((await internalFetch("/api/public/contact")).status).toBe(404);
  });

  test("a mistake in the wiring still fails closed: the route mounted without the entrypoint's mark answers 404", async () => {
    // What a careless edit would do: put the contact routes on an app that never marks its requests.
    const d = deps();
    const mistaken = new Hono().route("/api/public", createContactRoutes(() => d));
    const ctx = createExecutionContext();
    const res = await mistaken.fetch(
      new Request("https://admin.test/api/public/contact", { method: "POST", headers: { "content-type": "application/json", "x-sakem-client-ip": "198.51.100.5" }, body: JSON.stringify(valid()) }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    expect(d.keys).toEqual([]);
    expect(await count("contact_messages")).toBe(0);
  });

  test("through the PublicApi entrypoint the same post is saved", async () => {
    const res = await post(valid());
    expect(res.status).toBe(201);
    expect(await count("contact_messages")).toBe(1);
  });

  test("the entrypoint also serves the read endpoints, for a consumer that reads through the binding", async () => {
    const res = await internalFetch("/api/public/team");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ members: [] });
  });
});

describe("the visitor address", () => {
  test("is required, and must be a single IPv4 or IPv6 literal", async () => {
    for (const ip of [null, "", "   ", "not-an-ip", "203.0.113.7, 10.0.0.1", "203.0.113.7:8080", "999.1.1.1", "01.2.3.4", "1.2.3", "2001:db8::zz", "fe80::1%eth0", "[::1]", "example.org"]) {
      const d = deps();
      const res = await internalFetchWith(d, "/api/public/contact", { method: "POST", json: valid(), headers: ip === null ? {} : { "x-sakem-client-ip": ip } });
      expect(res.status, JSON.stringify(ip)).toBe(400);
      expect(await json(res), JSON.stringify(ip)).toEqual({ error: "invalid_client_ip" });
      expect(d.keys, JSON.stringify(ip)).toEqual([]);
    }
    expect(await count("contact_messages")).toBe(0);
  });

  // Negative test: fall back to either header and these fail.
  test("without X-Sakem-Client-Ip the post is refused, whatever CF-Connecting-IP and X-Forwarded-For say", async () => {
    const d = deps();
    const res = await internalFetchWith(d, "/api/public/contact", {
      method: "POST",
      json: valid(),
      headers: { "cf-connecting-ip": "198.51.100.1", "x-forwarded-for": "203.0.113.7", "x-real-ip": "203.0.113.8" },
    });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "invalid_client_ip" });
    expect(d.keys).toEqual([]);
    expect(await count("contact_messages")).toBe(0);
  });

  test("accepts IPv4 and IPv6 literals", async () => {
    for (const ip of ["203.0.113.7", "255.255.255.255", "0.0.0.0", "2001:db8::1", "::1", "2001:0db8:0000:0000:0000:0000:0000:0001", "::ffff:203.0.113.7"]) {
      expect(isIpLiteral(ip), ip).toBe(true);
    }
  });

  // Negative test: read cf-connecting-ip or x-forwarded-for instead and this fails.
  test("the rate limit bucket is the address the caller reported, never CF-Connecting-IP or X-Forwarded-For", async () => {
    const d = deps();
    await internalFetchWith(d, "/api/public/contact", {
      method: "POST",
      json: valid(),
      clientIp: "203.0.113.50",
      headers: { "cf-connecting-ip": "198.51.100.1", "x-forwarded-for": "192.0.2.1, 192.0.2.2", "x-real-ip": "192.0.2.3", forwarded: "for=192.0.2.4" },
    });
    expect(d.keys).toEqual(["contact:203.0.113.50"]);
  });

  test("the same reported address shares one bucket whatever else the request claims; another address has its own", async () => {
    const d = deps();
    const send = (clientIp: string, other: string) =>
      internalFetchWith(d, "/api/public/contact", { method: "POST", json: valid({ email: uniqueEmail() }), clientIp, headers: { "cf-connecting-ip": other, "x-forwarded-for": other } });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await send("203.0.113.60", `198.51.100.${i + 1}`)).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    expect((await send("203.0.113.61", "198.51.100.1")).status).toBe(201);
  });

  test("an IPv6 address is bucketed in lower case", async () => {
    const d = deps();
    await internalFetchWith(d, "/api/public/contact", { method: "POST", json: valid(), clientIp: "2001:DB8::ABCD" });
    expect(d.keys).toEqual(["contact:2001:db8::abcd"]);
  });
});

describe("limits and the order of the checks", () => {
  test("a body over 32 KiB is body_too_large before anything else is looked at", async () => {
    const d = deps();
    const big = JSON.stringify(valid({ message: "x".repeat(40_000) }));
    const res = await internalFetchWith(d, "/api/public/contact", { method: "POST", body: big, headers: { "content-type": "application/json" } }); // no client address either
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "body_too_large" });
    expect(d.keys).toEqual([]);
    expect(await count("contact_messages")).toBe(0);
  });

  test("a declared length over the limit is refused without reading the body", async () => {
    const d = deps();
    const res = await internalFetchWith(d, "/api/public/contact", { method: "POST", body: "{}", headers: { "content-length": "99999", "content-type": "application/json" }, clientIp: uniqueIp() });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "body_too_large" });
    expect(d.keys.length + (await count("contact_messages"))).toBe(0);
  });

  test("a body just under the limit is accepted", async () => {
    const d = deps();
    const body = JSON.stringify(valid({ message: "é".repeat(5000) }));
    expect(new TextEncoder().encode(body).length).toBeLessThan(32 * 1024);
    const res = await internalFetchWith(d, "/api/public/contact", { method: "POST", body, clientIp: uniqueIp() });
    expect(res.status).toBe(201);
  });

  test("the address is checked before the rate limit, and the rate limit before the JSON", async () => {
    const d = deps();
    const bad = await internalFetchWith(d, "/api/public/contact", { method: "POST", body: "{not json", clientIp: "nope" });
    expect((await json<{ error: string }>(bad)).error).toBe("invalid_client_ip");
    expect(d.keys).toEqual([]);

    const ip = uniqueIp();
    for (let i = 0; i < 5; i++) await internalFetchWith(d, "/api/public/contact", { method: "POST", body: "{not json", clientIp: ip });
    const limited = await internalFetchWith(d, "/api/public/contact", { method: "POST", body: "{not json", clientIp: ip });
    expect(limited.status).toBe(429);
    expect((await json<{ error: string }>(limited)).error).toBe("rate_limited");
  });

  test("a body that is not JSON is invalid_json", async () => {
    for (const body of ["not json {", "", "{\"fullName\":", "<xml/>"]) {
      const res = await internalFetchWith(deps(), "/api/public/contact", { method: "POST", body, clientIp: uniqueIp() });
      expect(res.status, body).toBe(400);
      expect(await json(res), body).toEqual({ error: "invalid_json" });
    }
  });

  test("every response is no-store JSON, errors included", async () => {
    const d = deps();
    const ip = uniqueIp();
    const responses = [
      await internalFetchWith(d, "/api/public/contact", { method: "POST", json: valid(), clientIp: ip }),
      await internalFetchWith(d, "/api/public/contact", { method: "POST", json: {}, clientIp: ip }),
      await internalFetchWith(d, "/api/public/contact", { method: "POST", body: "x", clientIp: ip }),
      await internalFetchWith(d, "/api/public/contact", { method: "POST", json: valid(), clientIp: "bad" }),
      await internalFetchWith(d, "/api/public/contact", { method: "POST", json: valid({ email: "dup@example.test" }), clientIp: uniqueIp() }),
      await internalFetchWith(d, "/api/public/contact", { method: "POST", json: valid({ email: "dup@example.test" }), clientIp: uniqueIp() }),
    ];
    for (const res of responses) {
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("content-type")).toMatch(/^application\/json/);
      expect(res.headers.getSetCookie()).toEqual([]);
    }
    expect(responses.map((r) => r.status)).toEqual([201, 400, 400, 400, 201, 429]);
  });
});

describe("validation: the on-site form's rules and words", () => {
  const errorsOf = async (over: Record<string, unknown>) => {
    const res = await post(valid(over));
    expect(res.status).toBe(400);
    const body = await json<{ error: string; message: string; fieldErrors: Record<string, string[]> }>(res);
    expect(body.error).toBe("validation_failed");
    expect(body.message).toBe("Silakan periksa kembali isian formulir.");
    return body.fieldErrors;
  };

  test("an empty body names every field, in Indonesian", async () => {
    const res = await post({});
    const body = await json<{ fieldErrors: unknown }>(res);
    expect(res.status).toBe(400);
    expect(body.fieldErrors).toEqual({
      fullName: ["Nama lengkap minimal 2 karakter"],
      email: ["Format email belum benar"],
      subject: ["Pilih salah satu subjek"],
      message: ["Tulis minimal 10 karakter"],
    });
  });

  test("the contract's fieldErrors example", async () => {
    expect(await errorsOf({ email: "bukan-email" })).toEqual(FIELD_ERRORS_EXAMPLE);
  });

  test("fullName: 2 to 120 characters after trimming", async () => {
    for (const fullName of ["B", "  B  ", "", "   ", 7, null, ["Budi"]]) expect(await errorsOf({ fullName }), JSON.stringify(fullName)).toEqual({ fullName: ["Nama lengkap minimal 2 karakter"] });
    expect(await errorsOf({ fullName: "x".repeat(121) })).toEqual({ fullName: ["Maksimal 120 karakter"] });
    expect(await errorsOf({ fullName: `  ${"x".repeat(121)}  ` })).toEqual({ fullName: ["Maksimal 120 karakter"] });
    for (const fullName of ["Bu", "x".repeat(120), `  ${"x".repeat(120)}  `]) expect((await post(valid({ fullName }))).status, fullName.length.toString()).toBe(201);
  });

  test("email: a valid address after trimming and lower-casing, at most 254 characters", async () => {
    for (const email of ["bukan-email", "a@b", "@example.com", "a b@example.com", "", "   ", 5, null, "a@example", "a@@example.com", ".a@example.com", "a..b@example.com"]) {
      expect(await errorsOf({ email }), JSON.stringify(email)).toEqual({ email: ["Format email belum benar"] });
    }
    const long = `${"a".repeat(243)}@example.com`;
    expect(long).toHaveLength(255);
    expect(await errorsOf({ email: long })).toEqual({ email: ["Maksimal 254 karakter"] });
    expect((await post(valid({ email: `${"a".repeat(242)}@example.com` }))).status).toBe(201);
  });

  test("subject: partnership, donation or other, exactly", async () => {
    for (const subject of ["", "unknown", "OTHER", "Other", " other", "partnership ", 1, null, ["other"]]) expect(await errorsOf({ subject }), JSON.stringify(subject)).toEqual({ subject: ["Pilih salah satu subjek"] });
    for (const subject of ["partnership", "donation", "other"]) expect((await post(valid({ subject }))).status, subject).toBe(201);
  });

  test("message: 10 to 5000 characters after trimming", async () => {
    for (const msg of ["pendek", "123456789", "         x", "", 12345678901, null]) expect(await errorsOf({ message: msg }), JSON.stringify(msg)).toEqual({ message: ["Tulis minimal 10 karakter"] });
    expect(await errorsOf({ message: "x".repeat(5001) })).toEqual({ message: ["Maksimal 5000 karakter"] });
    for (const msg of ["1234567890", "x".repeat(5000)]) expect((await post(valid({ message: msg }))).status, String(msg.length)).toBe(201);
  });

  test("several wrong fields are all reported together", async () => {
    expect(await errorsOf({ fullName: "B", email: "bukan-email", subject: "unknown", message: "pendek" })).toEqual({
      fullName: ["Nama lengkap minimal 2 karakter"],
      email: ["Format email belum benar"],
      subject: ["Pilih salah satu subjek"],
      message: ["Tulis minimal 10 karakter"],
    });
  });

  test("a JSON body that is not an object is reported field by field, like an empty form", async () => {
    for (const body of ["[1,2,3]", '"teks"', "null", "42", "true"]) {
      const res = await internalFetchWith(deps(), "/api/public/contact", { method: "POST", body, clientIp: uniqueIp() });
      expect(res.status, body).toBe(400);
      expect(Object.keys((await json<{ fieldErrors: object }>(res)).fieldErrors).sort(), body).toEqual(["email", "fullName", "message", "subject"]);
    }
  });

  test("a refused message stores nothing and writes no audit row", async () => {
    await post({});
    await post(valid({ email: "bukan-email" }));
    expect(await count("contact_messages")).toBe(0);
    expect(await count("audit_log")).toBe(0);
  });

  test("fields the form does not have are ignored: a caller cannot set an id, a read mark or a date", async () => {
    const res = await post(valid({ id: "00000000-0000-4000-8000-000000000001", readAt: 123, createdAt: 1, isAdmin: true }));
    expect(res.status).toBe(201);
    const [row] = await rows();
    expect(row!.id).not.toBe("00000000-0000-4000-8000-000000000001");
    expect(row!.read_at).toBeNull();
    expect(Number(row!.created_at)).toBeGreaterThan(1_000_000_000_000);
  });
});

describe("the honeypot", () => {
  test("a filled website field looks like success and stores nothing", async () => {
    const res = await post(valid({ website: "http://spam.example" }));
    expect(res.status).toBe(201);
    expect(await json(res)).toEqual(CONTACT_CREATED);
    expect(await count("contact_messages")).toBe(0);
    expect(await count("audit_log")).toBe(0);
  });

  test("a hit wins over every other error, so the bot learns nothing", async () => {
    const res = await post({ fullName: "B", email: "x", website: "spam" });
    expect(res.status).toBe(201);
    expect(await json(res)).toEqual(CONTACT_CREATED);
  });

  test("omitted, empty or null is not a hit; anything else is", async () => {
    for (const website of [undefined, "", null]) expect((await post(valid({ website }))).status, String(website)).toBe(201);
    expect(await count("contact_messages")).toBe(3);
    for (const website of [" ", "x", 0, 1, false, true, {}, ["x"]]) {
      const before = await count("contact_messages");
      expect((await post(valid({ website }))).status, JSON.stringify(website)).toBe(201);
      expect(await count("contact_messages"), JSON.stringify(website)).toBe(before);
    }
  });

  test("a honeypot hit still uses a rate limit slot, so it cannot be hammered for free", async () => {
    const d = deps();
    const ip = uniqueIp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await internalFetchWith(d, "/api/public/contact", { method: "POST", json: valid({ website: "spam" }), clientIp: ip })).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });
});

describe("a saved message", () => {
  test("answers 201 with the contract's body and no id", async () => {
    const res = await post(valid());
    expect(res.status).toBe(201);
    expect(await json(res)).toEqual(CONTACT_CREATED);
    expect(CONTACT_CREATED.message).toBe(CONTACT_MESSAGES.success);
  });

  test("stores the trimmed, lower-cased fields unread, and one audit row without the text", async () => {
    const res = await post({ fullName: "  Budi Santoso ", email: "  Budi.S@Example.COM ", subject: "donation", message: `  ${message}  `, website: "" });
    expect(res.status).toBe(201);
    const [row] = await rows();
    expect(row).toMatchObject({ full_name: "Budi Santoso", email: "budi.s@example.com", subject: "donation", message, read_at: null });

    const audit = await auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: null, actor_email: "budi.s@example.com", action: "contact_message.submit", resource_type: "contact_message", resource_id: row!.id });
    expect(JSON.parse(String(audit[0]!.metadata))).toEqual({ subject: "donation" });
    // Neither the message nor the name is anywhere in the audit trail.
    expect(JSON.stringify(audit)).not.toContain("Halo, saya");
    expect(JSON.stringify(audit)).not.toContain("Budi Santoso");
  });

  test("a message and its audit row are written together or not at all", async () => {
    await env.DB.prepare("CREATE TRIGGER audit_refuses BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END").run();
    try {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await post(valid());
      expect(res.status).toBe(500);
      expect(await json(res)).toEqual({ error: "internal" });
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await count("contact_messages")).toBe(0);
      spy.mockRestore();
    } finally {
      await env.DB.prepare("DROP TRIGGER audit_refuses").run();
    }
  });
});

describe("one message per email per 5 minutes", () => {
  test("the second from the same email is duplicate_recent with a 5 minute Retry-After, and nothing more is stored", async () => {
    const email = uniqueEmail();
    expect((await post(valid({ email }))).status).toBe(201);
    const res = await post(valid({ email, message: "Pesan kedua yang berbeda isinya." }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("300");
    expect(await json(res)).toEqual({ error: "duplicate_recent", message: CONTACT_MESSAGES.duplicate, retryAfterSeconds: 300 });
    expect(await count("contact_messages")).toBe(1);
    expect(await count("audit_log")).toBe(1);
  });

  test("the email is compared after trimming and lower-casing; another email is not affected", async () => {
    expect((await post(valid({ email: "orang@example.test" }))).status).toBe(201);
    expect((await post(valid({ email: "  ORANG@Example.Test " }))).status).toBe(429);
    expect((await post(valid({ email: "orang2@example.test" }))).status).toBe(201);
  });

  test("the window is 5 minutes: 4:59 is a duplicate, 5:01 is not", async () => {
    const email = "tepi@example.test";
    const now = Date.now();
    const insertAt = (ms: number) => env.DB.prepare("INSERT INTO contact_messages (id, full_name, email, subject, message, created_at) VALUES (?, 'Lama', ?, 'other', 'pesan lama sekali', ?)").bind(crypto.randomUUID(), email, ms).run();

    await insertAt(now - (5 * 60 - 1) * 1000);
    expect((await post(valid({ email }))).status).toBe(429);
    await env.DB.prepare("DELETE FROM contact_messages").run();

    await insertAt(now - (5 * 60 + 1) * 1000);
    expect((await post(valid({ email }))).status).toBe(201);
    expect(await count("contact_messages")).toBe(2);
  });

  // Legacy read-then-write let two simultaneous posts both pass. Negative test:
  // split the insert from the check and this fails.
  test("two simultaneous posts with one email store one message", async () => {
    const email = uniqueEmail();
    const results = await Promise.all(Array.from({ length: 5 }, () => post(valid({ email }))));
    expect(results.map((r) => r.status).sort()).toEqual([201, 429, 429, 429, 429]);
    expect(await count("contact_messages")).toBe(1);
    expect(await count("audit_log")).toBe(1);
  });
});

describe("the rate limit", () => {
  test("with the configured binding: 5 a minute per address, the 6th is rate_limited with Retry-After", async () => {
    const ip = uniqueIp();
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 6; i++) {
      last = await post(valid({ email: uniqueEmail() }), ip);
      statuses.push(last.status);
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    expect(last!.headers.get("retry-after")).toBe("60");
    expect(await json(last!)).toEqual({ error: "rate_limited", message: CONTACT_MESSAGES.rateLimited, retryAfterSeconds: 60 });
    // The refused one stored nothing.
    expect(await count("contact_messages")).toBe(5);
    // Another visitor is not affected.
    expect((await post(valid(), uniqueIp())).status).toBe(201);
  });

  test("a refusal is checked before the body is parsed, so an over-limit client cannot probe validation", async () => {
    const d = deps({ rateLimiter: { hit: async () => ({ allowed: false, retryAfterSeconds: 17 }) } });
    const res = await internalFetchWith(d, "/api/public/contact", { method: "POST", body: "{not json", clientIp: uniqueIp() });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("17");
  });

  test("the in-memory limiter counts per window and reports the time left", async () => {
    let now = Date.UTC(2026, 0, 1, 0, 0, 10);
    const limiter = new InMemoryRateLimiter(5, 60, () => now);
    const verdicts = [];
    for (let i = 0; i < 6; i++) verdicts.push(await limiter.hit("a"));
    expect(verdicts.map((v) => v.allowed)).toEqual([true, true, true, true, true, false]);
    expect(verdicts[5]!.retryAfterSeconds).toBe(50);
    expect((await limiter.hit("b")).allowed).toBe(true);
    now += 51_000; // the next window
    expect((await limiter.hit("a")).allowed).toBe(true);
  });

  // Changed by SAKEM-081 part B: the limiter is the shared one (src/security/rate-limit.ts). The first version fell back to a
  // per-isolate counter in production with a warning, which on Workers limits nothing; now a missing binding refuses there.
  test("without the binding, production refuses (500, nothing stored, the binding named in the log, no personal data)", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    const bindings = { ...env, ENVIRONMENT: "production", RL_CONTACT: undefined, TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRETS.alwaysPass } as never;
    const email = uniqueEmail("lain");
    const res = await internalFetchWithBindings(bindings, "/api/public/contact", { method: "POST", json: valid({ email }), clientIp: uniqueIp() });
    expect(res.status).toBe(500);
    expect(await json(res)).toEqual({ error: "internal" });
    expect(await count("contact_messages")).toBe(0);
    const logged = lines.join("\n");
    expect(logged).toContain("[rate-limit] binding RL_CONTACT is not configured");
    expect(logged).toContain("[contact] failed (RateLimitUnavailable)");
    expect(logged).not.toContain(email);
  });

  test("without the binding, outside production, the shared in-memory counter limits 5 a minute", async () => {
    const bindings = { ...env, ENVIRONMENT: "test", RL_CONTACT: undefined } as never;
    const ip = uniqueIp();
    const run = () => internalFetchWithBindings(bindings, "/api/public/contact", { method: "POST", json: valid({ email: uniqueEmail() }), clientIp: ip });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await run()).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  test("one limiter only: the limit, the period and the words are the contract's, and the first version's binding is gone", async () => {
    expect(RATE_LIMITS.contact).toMatchObject({ binding: "RL_CONTACT", limit: CONTACT_RATE_LIMIT.limit, period: CONTACT_RATE_LIMIT.windowSeconds, message: CONTACT_MESSAGES.rateLimited });
    expect(Object.keys(env)).not.toContain("PUBLIC_CONTACT_LIMIT");
    expect(wranglerConfig.replace(/^\s*\/\/.*$/gm, "")).not.toContain("PUBLIC_CONTACT_LIMIT"); // comments may still say where it went
  });

  test("the key is contact:<address> and the address is X-Sakem-Client-Ip only, never a header the visitor can set", async () => {
    const keys: string[] = [];
    const spy = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }) };
    const bindings = { ...env, RL_CONTACT: spy } as never;
    const forged = { "cf-connecting-ip": "198.51.100.1", "x-forwarded-for": "6.6.6.6, 7.7.7.7", "x-real-ip": "8.8.8.8", forwarded: "for=9.9.9.9" };

    await internalFetchWithBindings(bindings, "/api/public/contact", { method: "POST", json: valid(), clientIp: "203.0.113.55", headers: forged });
    await internalFetchWithBindings(bindings, "/api/public/contact", { method: "POST", json: valid(), clientIp: "2001:DB8::1", headers: forged });
    expect(keys).toEqual(["contact:203.0.113.55", "contact:2001:db8::1"]);

    // No X-Sakem-Client-Ip: a 400 before the limiter is asked, whatever else the request carries.
    keys.length = 0;
    const missing = await internalFetchWithBindings(bindings, "/api/public/contact", { method: "POST", json: valid(), clientIp: null, headers: forged });
    expect(missing.status).toBe(400);
    expect(await json(missing)).toEqual({ error: "invalid_client_ip" });
    expect(keys).toEqual([]);
  });

  test("a refusal from the binding is rate_limited with the whole period as the wait", async () => {
    const bindings = { ...env, RL_CONTACT: { limit: async () => ({ success: false }) } } as never;
    const res = await internalFetchWithBindings(bindings, "/api/public/contact", { method: "POST", json: valid(), clientIp: uniqueIp() });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await json(res)).toEqual({ error: "rate_limited", message: CONTACT_MESSAGES.rateLimited, retryAfterSeconds: 60 });
    expect(await count("contact_messages")).toBe(0);
  });
});

describe("the Turnstile seam", () => {
  test("is skipped outside production when no secret is set: no token is needed", async () => {
    expect(await turnstileDisabled({ token: null, ip: "203.0.113.1" })).toBe(true); // the test double
    const network = fakeNetwork();
    expect((await post(valid())).status).toBe(201); // the default resolver: ENVIRONMENT=test, no TURNSTILE_SECRET_KEY
    expect(network.siteverify).toHaveLength(0);
  });

  test("a failing check is turnstile_failed, stores nothing and is not cacheable", async () => {
    const d = deps({ verifyTurnstile: async () => false });
    const res = await internalFetchWith(d, "/api/public/contact", { method: "POST", json: valid(), clientIp: uniqueIp() });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "turnstile_failed", message: CONTACT_MESSAGES.botCheckFailed });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await count("contact_messages")).toBe(0);
  });

  test("is given the forwarded token and the trusted address", async () => {
    const d = deps();
    await internalFetchWith(d, "/api/public/contact", { method: "POST", json: valid(), clientIp: "203.0.113.90", headers: { "x-sakem-turnstile-token": "  token-abc " } });
    await internalFetchWith(d, "/api/public/contact", { method: "POST", json: valid(), clientIp: "203.0.113.91" });
    expect(d.checks).toEqual([
      { token: "token-abc", ip: "203.0.113.90" },
      { token: null, ip: "203.0.113.91" },
    ]);
  });

  test("runs after the rate limit and the field checks, and not for a honeypot hit or a duplicate", async () => {
    const d = deps();
    const ip = uniqueIp();
    await internalFetchWith(d, "/api/public/contact", { method: "POST", body: "{not json", clientIp: ip });
    await internalFetchWith(d, "/api/public/contact", { method: "POST", json: {}, clientIp: ip });
    await internalFetchWith(d, "/api/public/contact", { method: "POST", json: valid({ website: "spam" }), clientIp: ip });
    expect(d.checks).toEqual([]);

    const limited = deps({ rateLimiter: { hit: async () => ({ allowed: false, retryAfterSeconds: 60 }) } });
    await internalFetchWith(limited, "/api/public/contact", { method: "POST", json: valid(), clientIp: ip });
    expect(limited.checks).toEqual([]);

    const email = uniqueEmail();
    await internalFetchWith(d, "/api/public/contact", { method: "POST", json: valid({ email }), clientIp: uniqueIp() });
    expect(d.checks).toHaveLength(1);
  });

  test("an infrastructure failure of the check is a 500 and stores nothing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({
      verifyTurnstile: async () => {
        throw new Error("siteverify unreachable");
      },
    });
    const res = await internalFetchWith(d, "/api/public/contact", { method: "POST", json: valid(), clientIp: uniqueIp() });
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await count("contact_messages")).toBe(0);
  });
});

describe("the Turnstile check is the shared one (src/security/turnstile.ts, action contact)", () => {
  const withSecret = (secret: string | undefined, environment = "test") => ({ ...env, ENVIRONMENT: environment, TURNSTILE_SECRET_KEY: secret }) as never;
  const send = (bindings: never, over: { token?: string; ip?: string; body?: Record<string, unknown> } = {}) =>
    internalFetchWithBindings(bindings, "/api/public/contact", {
      method: "POST",
      json: over.body ?? valid(),
      clientIp: over.ip ?? uniqueIp(),
      headers: over.token === undefined ? {} : { "x-sakem-turnstile-token": over.token },
    });

  // Negative check: make the contact seam skip the shared check, or fail open in production.
  test("production without TURNSTILE_SECRET_KEY refuses (500, nothing stored, the reason in the log, never the token)", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    const network = fakeNetwork();
    for (const secret of [undefined, ""]) {
      const res = await send(withSecret(secret, "production"), { token: "SECRET-TOKEN-XYZ" });
      expect(res.status, String(secret)).toBe(500);
      expect(await json(res)).toEqual({ error: "internal" });
    }
    expect(await count("contact_messages")).toBe(0);
    expect(network.siteverify).toHaveLength(0);
    const logged = lines.join("\n");
    expect(logged).toContain("[turnstile] TURNSTILE_SECRET_KEY is not set");
    expect(logged).toContain("[contact] failed (TurnstileUnavailable)");
    expect(logged).not.toContain("SECRET-TOKEN-XYZ");
  });

  test("a missing ENVIRONMENT is production too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bindings = { ...env, ENVIRONMENT: undefined, TURNSTILE_SECRET_KEY: undefined } as never;
    expect((await send(bindings)).status).toBe(500);
    expect(await count("contact_messages")).toBe(0);
  });

  test("a failing check answers 400 turnstile_failed and stores nothing", async () => {
    const network = fakeNetwork();
    const res = await send(withSecret(TURNSTILE_TEST_SECRETS.alwaysFail), { token: "any-token" });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "turnstile_failed", message: CONTACT_MESSAGES.botCheckFailed });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await count("contact_messages")).toBe(0);
    expect(network.siteverify).toHaveLength(1);
  });

  test("a spent token, and no token at all, are turnstile_failed too (the latter without asking Cloudflare)", async () => {
    const network = fakeNetwork();
    const spent = await send(withSecret(TURNSTILE_TEST_SECRETS.spent), { token: "used-before" });
    expect(spent.status).toBe(400);
    expect(await json(spent)).toMatchObject({ error: "turnstile_failed" });

    const before = network.siteverify.length;
    const none = await send(withSecret(TURNSTILE_TEST_SECRETS.alwaysPass));
    expect(none.status).toBe(400);
    expect(await json(none)).toMatchObject({ error: "turnstile_failed" });
    expect(network.siteverify).toHaveLength(before);
    expect(await count("contact_messages")).toBe(0);
  });

  test("a good token is read from X-Sakem-Turnstile-Token only and sent with the trusted address as remoteip", async () => {
    const network = fakeNetwork();
    const res = await internalFetchWithBindings(withSecret(TURNSTILE_TEST_SECRETS.alwaysPass), "/api/public/contact", {
      method: "POST",
      json: { ...valid(), turnstileToken: "from-the-body", "cf-turnstile-response": "from-the-body-too" },
      clientIp: "203.0.113.77",
      headers: { "x-sakem-turnstile-token": "  from-the-header ", "x-turnstile-token": "the-admin-routes-header", "cf-connecting-ip": "198.51.100.2" },
    });
    expect(res.status).toBe(201);
    expect(network.siteverify).toEqual([{ secret: TURNSTILE_TEST_SECRETS.alwaysPass, response: "from-the-header", remoteip: "203.0.113.77" }]);
    expect(await count("contact_messages")).toBe(1);
  });

  test("Siteverify unreachable or answering an error is a 500 that stores nothing (the check never fails open)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if ((typeof input === "string" ? input : input instanceof URL ? input.href : input.url) === SITEVERIFY_URL) throw new TypeError("network down");
      throw new Error("unexpected outbound request");
    });
    expect((await send(withSecret(TURNSTILE_TEST_SECRETS.alwaysPass), { token: "t" })).status).toBe(500);
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("oops", { status: 502 }));
    expect((await send(withSecret(TURNSTILE_TEST_SECRETS.alwaysPass), { token: "t" })).status).toBe(500);
    expect(await count("contact_messages")).toBe(0);
  });

  test("the order is unchanged: after the limit and the fields, so a typo does not spend a token", async () => {
    const network = fakeNetwork();
    const bindings = withSecret(TURNSTILE_TEST_SECRETS.alwaysPass);
    const invalid = await send(bindings, { token: "t", body: valid({ email: "not an email" }) });
    expect(invalid.status).toBe(400);
    expect(await json(invalid)).toMatchObject({ error: "validation_failed" });
    const honeypot = await send(bindings, { token: "t", body: valid({ website: "spam" }) });
    expect(honeypot.status).toBe(201);
    expect(network.siteverify).toHaveLength(0);
  });

  test("a token minted for another form is refused (the widget's action must be 'contact', when it sets one)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ success: true, action: "login" }));
    const res = await send(withSecret(TURNSTILE_TEST_SECRETS.alwaysPass), { token: "t" });
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ error: "turnstile_failed" });
  });
});

describe("personal data stays out of the logs", () => {
  test("no email, name or message text is logged on any path", async () => {
    const lines: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, level).mockImplementation((...args) => void lines.push(args.map(String).join(" ")));

    const email = "rahasia.pengirim@example.test";
    const text = "ISI-PESAN-RAHASIA-yang-panjang";
    const d = deps();
    const ip = uniqueIp();
    const send = (body: unknown, over: Partial<ContactDeps> = {}, clientIp = ip) => internalFetchWith({ ...d, ...over }, "/api/public/contact", { method: "POST", json: body, clientIp });

    await send(valid({ email, message: text, fullName: "Nama Rahasia" })); // saved
    await send(valid({ email, message: text, fullName: "Nama Rahasia" })); // duplicate
    await send(valid({ email: "bukan", message: text, fullName: "Nama Rahasia" })); // invalid
    await send(valid({ email, message: text, website: "x" })); // honeypot
    await send(valid({ email: "lain@example.test", message: text }), { verifyTurnstile: async () => false }); // bot check
    await env.DB.prepare("CREATE TRIGGER audit_refuses_log BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'x'); END").run();
    try {
      await send(valid({ email: "baru@example.test", message: text, fullName: "Nama Rahasia" })); // 500
    } finally {
      await env.DB.prepare("DROP TRIGGER audit_refuses_log").run();
    }

    const everything = lines.join("\n");
    for (const secret of [email, "rahasia.pengirim", text, "Nama Rahasia", "baru@example.test", "lain@example.test"]) expect(everything).not.toContain(secret);
  });
});
