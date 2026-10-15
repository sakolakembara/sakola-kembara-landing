import { afterEach, describe, expect, test, vi } from "vitest";
import { contactWhatsapp, GROUP_URL_MAX_LENGTH, whatsappGroupUrl } from "../src/portal/contact";
import { portalCall } from "./portal-helpers";

// The two deployment-specific contact values of the wizard (src/portal/contact.ts): `PORTAL_CONTACT_WHATSAPP` and
// `PORTAL_WHATSAPP_GROUP_URL`, optional public variables of the portal Worker, answered by GET /portal/api/config as
// `contactWhatsapp` and `whatsappGroupUrl` ONLY when set and valid. Invented values throughout: the numbers and hosts
// below are not anyone's. docs/cloudflare/portal-api.md, 4.1.

afterEach(() => {
  vi.restoreAllMocks();
});

const NUMBER = "6281200000001";
const GROUP = "https://chat.contoh.test/grup-abc";

describe("contactWhatsapp: digits only, the country code first, 8 to 15 of them", () => {
  const valid: [string | undefined | null, string][] = [
    [NUMBER, NUMBER],
    [`  ${NUMBER}\n`, NUMBER], // surrounding space is the operator's typing, not part of the value
    ["62123456", "62123456"], // 8 digits
    ["628123456789012", "628123456789012"], // 15 digits
    ["14155550100", "14155550100"], // another country code is fine: the number is an international one
  ];
  for (const [input, expected] of valid) {
    test(`${JSON.stringify(input)} -> ${expected}`, () => {
      expect(contactWhatsapp(input)).toBe(expected);
    });
  }

  const invalid: (string | undefined | null)[] = [
    undefined,
    null,
    "",
    "   ",
    "081200000001", // a local number: wa.me needs the country code
    "0",
    "+6281200000001",
    "62 812 0000 0001",
    "62-812-0000-0001",
    "(62)8120000",
    "6281200000001a",
    "a6281200000001",
    "halo",
    "1234567", // 7 digits
    "1234567890123456", // 16 digits
    "٦٢٨١٢٠٠٠٠٠٠٠١", // Arabic-Indic digits are not digits here
    "６２８１２００００００１", // nor are full-width ones
    `${NUMBER}\n${NUMBER}`,
    "6281200000001.5",
    "6.28e12",
    "https://wa.me/6281200000001",
  ];
  for (const input of invalid) {
    test(`${JSON.stringify(input)} is not a number: absent`, () => {
      expect(contactWhatsapp(input)).toBeUndefined();
    });
  }
});

describe("whatsappGroupUrl: https only, with a host, nothing that could break out of a link", () => {
  test("the bound is 300 characters (a group link is about 60)", () => {
    expect(GROUP_URL_MAX_LENGTH).toBe(300);
  });

  const valid: [string, string][] = [
    [GROUP, GROUP],
    [`  ${GROUP}  `, GROUP],
    ["https://chat.contoh.test", "https://chat.contoh.test/"], // as the URL parser writes it
    ["HTTPS://CHAT.CONTOH.TEST/Grup", "https://chat.contoh.test/Grup"],
    ["https://chat.contoh.test/grup?src=portal#top", "https://chat.contoh.test/grup?src=portal#top"],
    ["https://chat.contoh.test:8443/grup", "https://chat.contoh.test:8443/grup"],
    ["https://chat.contoh.test/%C3%A9", "https://chat.contoh.test/%C3%A9"],
    [`https://chat.contoh.test/${"x".repeat(GROUP_URL_MAX_LENGTH - "https://chat.contoh.test/".length)}`, `https://chat.contoh.test/${"x".repeat(GROUP_URL_MAX_LENGTH - "https://chat.contoh.test/".length)}`],
  ];
  for (const [input, expected] of valid) {
    test(`${JSON.stringify(input.length > 80 ? `${input.slice(0, 60)}... (${input.length})` : input)} is kept`, () => {
      expect(whatsappGroupUrl(input)).toBe(expected);
    });
  }

  const invalid: (string | undefined | null)[] = [
    undefined,
    null,
    "",
    "   ",
    "http://chat.contoh.test/grup", // not https
    "HTTP://chat.contoh.test/grup",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://chat.contoh.test/grup",
    "//chat.contoh.test/grup",
    "chat.contoh.test/grup",
    "/grup",
    "https:/chat.contoh.test/grup",
    "https:///grup",
    "https://",
    "https:// chat.contoh.test/grup",
    "https://user:pass@chat.contoh.test/grup", // credentials in a link
    "https://user@chat.contoh.test/grup",
    "https://:pass@chat.contoh.test/grup",
    'https://chat.contoh.test/"onmouseover="x',
    "https://chat.contoh.test/'x",
    "https://chat.contoh.test/<x>",
    "https://chat.contoh.test/a b",
    "https://chat.contoh.test/a\tb",
    "https://chat.contoh.test/a\nb",
    "https://chat.contoh.test/\u0000",
    "https://chat.contoh.test/\u007f",
    "https://chat.contoh.test/`x`",
    "https://chat.contoh.test/\\x",
    "https://chat.contoh.test/ x", // a line separator is whitespace to the check
    "https://[::1",
    "https://chat.contoh.test:99999/grup", // not a port
    `https://chat.contoh.test/${"x".repeat(GROUP_URL_MAX_LENGTH - "https://chat.contoh.test/".length + 1)}`, // one over the bound
    `https://${"a".repeat(GROUP_URL_MAX_LENGTH)}.test/`,
  ];
  for (const input of invalid) {
    test(`${JSON.stringify(typeof input === "string" && input.length > 80 ? `${input.slice(0, 60)}... (${input.length})` : input)} is not a group link: absent`, () => {
      expect(whatsappGroupUrl(input)).toBeUndefined();
    });
  }

  test("what is kept is safe to put in an href: https, a host, no credentials, no character that ends an attribute", () => {
    for (const [input] of valid) {
      const kept = whatsappGroupUrl(input)!;
      const url = new URL(kept);
      expect(url.protocol).toBe("https:");
      expect(url.hostname).not.toBe("");
      expect(url.username + url.password).toBe("");
      expect(kept).not.toMatch(/[\s"'<>`\\\u0000-\u001f]/);
    }
  });
});

describe("GET /portal/api/config: the two keys are in the answer only when their variable is set and valid", () => {
  const BASE = { google: false, turnstileSiteKey: null, siteUrl: "", adminUrl: "" };
  const config = async (env: Record<string, string | undefined> = {}) => {
    const res = await portalCall("/portal/api/config", { env });
    return { res, text: await res.clone().text(), body: (await res.json()) as Record<string, unknown> };
  };

  test("neither configured: the keys are ABSENT (not null, not an empty string), the rest is what it was", async () => {
    const { res, body } = await config();
    expect(res.status).toBe(200);
    expect(body).toEqual(BASE);
    expect(Object.keys(body).sort()).toEqual(["adminUrl", "google", "siteUrl", "turnstileSiteKey"]);
    expect("contactWhatsapp" in body).toBe(false);
    expect("whatsappGroupUrl" in body).toBe(false);
    // Empty is unset.
    expect(await config({ PORTAL_CONTACT_WHATSAPP: "", PORTAL_WHATSAPP_GROUP_URL: "" })).toMatchObject({ body: BASE });
    expect((await config({ PORTAL_CONTACT_WHATSAPP: "   ", PORTAL_WHATSAPP_GROUP_URL: "  " })).body).toEqual(BASE);
  });

  test("both configured: both keys, exactly the shape the wizard reads", async () => {
    const { body } = await config({ PORTAL_CONTACT_WHATSAPP: NUMBER, PORTAL_WHATSAPP_GROUP_URL: GROUP });
    expect(body).toEqual({ ...BASE, contactWhatsapp: NUMBER, whatsappGroupUrl: GROUP });
    expect(typeof body.contactWhatsapp).toBe("string");
    expect(typeof body.whatsappGroupUrl).toBe("string");
  });

  test("each on its own: only its key appears", async () => {
    expect((await config({ PORTAL_CONTACT_WHATSAPP: NUMBER })).body).toEqual({ ...BASE, contactWhatsapp: NUMBER });
    expect((await config({ PORTAL_WHATSAPP_GROUP_URL: GROUP })).body).toEqual({ ...BASE, whatsappGroupUrl: GROUP });
  });

  test("the answer is the validated value, not the raw variable: spaces around it are gone, a bare host gets its slash", async () => {
    const { body } = await config({ PORTAL_CONTACT_WHATSAPP: ` ${NUMBER} `, PORTAL_WHATSAPP_GROUP_URL: " https://chat.contoh.test " });
    expect(body).toMatchObject({ contactWhatsapp: NUMBER, whatsappGroupUrl: "https://chat.contoh.test/" });
  });

  test("an invalid number is treated as absent, the valid link beside it is kept, and the bad value is not in the answer anywhere", async () => {
    for (const bad of ["081200000001", "+6281200000001", "62 812 0000 0001", "halo-leakmarker", "6281200000001a", "1234567", "1234567890123456", "٦٢٨١٢٠٠٠٠٠٠٠١"]) {
      const { body, text } = await config({ PORTAL_CONTACT_WHATSAPP: bad, PORTAL_WHATSAPP_GROUP_URL: GROUP });
      expect(body, bad).toEqual({ ...BASE, whatsappGroupUrl: GROUP });
      expect("contactWhatsapp" in body, bad).toBe(false);
      expect(text, bad).not.toContain(bad.trim());
    }
  });

  test("an invalid link is treated as absent, the valid number beside it is kept, and the bad value is not in the answer anywhere", async () => {
    for (const bad of [
      "http://leakmarker.contoh.test/grup",
      "javascript:alert('leakmarker')",
      "data:text/html,leakmarker",
      "//leakmarker.contoh.test/grup",
      "leakmarker.contoh.test/grup",
      "https://user:leakmarker@chat.contoh.test/grup",
      'https://chat.contoh.test/"leakmarker',
      "https://chat.contoh.test/<leakmarker>",
      "https://chat.contoh.test/a leakmarker",
      `https://chat.contoh.test/${"leakmarker".repeat(40)}`,
    ]) {
      const { body, text } = await config({ PORTAL_CONTACT_WHATSAPP: NUMBER, PORTAL_WHATSAPP_GROUP_URL: bad });
      expect(body, bad).toEqual({ ...BASE, contactWhatsapp: NUMBER });
      expect("whatsappGroupUrl" in body, bad).toBe(false);
      expect(text, bad).not.toContain("leakmarker");
    }
  });

  test("a bad value in each variable: both absent, and the answer is the unconfigured one, byte for byte", async () => {
    const unconfigured = (await config()).text;
    const bad = await config({ PORTAL_CONTACT_WHATSAPP: "not-a-number", PORTAL_WHATSAPP_GROUP_URL: "not a url" });
    expect(bad.text).toBe(unconfigured);
  });

  test("the answer is cached exactly as before: the headers of every answer of the API, with or without the two values", async () => {
    const plain = (await config()).res;
    const configured = (await config({ PORTAL_CONTACT_WHATSAPP: NUMBER, PORTAL_WHATSAPP_GROUP_URL: GROUP })).res;
    for (const res of [plain, configured]) {
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("content-type")).toContain("application/json");
    }
    expect([...configured.headers.keys()].sort()).toEqual([...plain.headers.keys()].sort());
  });

  test("nothing else about the answer changed: the same fields and the same rules for the other values as before", async () => {
    const { body } = await config({
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      TURNSTILE_SITE_KEY: "site-key",
      SITE_URL: "https://sakola.test/",
      ADMIN_URL: "https://admin.sakola.test",
      PORTAL_CONTACT_WHATSAPP: NUMBER,
      PORTAL_WHATSAPP_GROUP_URL: GROUP,
    });
    expect(body).toEqual({
      google: true,
      turnstileSiteKey: "site-key",
      siteUrl: "https://sakola.test",
      adminUrl: "https://admin.sakola.test",
      contactWhatsapp: NUMBER,
      whatsappGroupUrl: GROUP,
    });
  });

  test("the values are public by design but still only ever answered by this route (not by me, not by an error, not by the dev mailbox)", async () => {
    const env = { PORTAL_CONTACT_WHATSAPP: NUMBER, PORTAL_WHATSAPP_GROUP_URL: GROUP };
    for (const path of ["/portal/api/me", "/portal/api/nothing-here", "/portal/api/dev/mailbox", "/portal/api/auth/get-session"]) {
      const res = await portalCall(path, { env });
      const text = await res.text();
      expect(text, path).not.toContain(NUMBER);
      expect(text, path).not.toContain("chat.contoh.test");
    }
  });
});

describe("no value ever appears in a console line", () => {
  test("not a valid number or link, not an invalid one, on the config route or any other", async () => {
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug", "trace"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" ")));
    }
    const valid = { PORTAL_CONTACT_WHATSAPP: NUMBER, PORTAL_WHATSAPP_GROUP_URL: GROUP };
    const invalid = { PORTAL_CONTACT_WHATSAPP: "081200leakmarker", PORTAL_WHATSAPP_GROUP_URL: "http://leakmarker.contoh.test/grup" };
    const requests: [string, Record<string, string>][] = [
      ["/portal/api/config", valid],
      ["/portal/api/config", invalid],
      ["/portal/api/config", { PORTAL_CONTACT_WHATSAPP: "x".repeat(5000), PORTAL_WHATSAPP_GROUP_URL: `https://chat.contoh.test/${"leakmarker".repeat(500)}` }],
      ["/portal/api/me", valid],
      ["/portal/api/nothing-here", valid],
      ["/portal/api/auth/get-session", valid],
      ["/portal/api/me", invalid],
    ];
    for (const [path, env] of requests) await portalCall(path, { env });
    // And the error path, with the values around: a missing secret makes the Worker log its one line.
    await portalCall("/portal/api/me", { env: { ...valid, BETTER_AUTH_SECRET: undefined }, cookie: "sakem-student.session_token=abc.def" });

    const output = lines.join("\n");
    expect(lines.length).toBeGreaterThan(0); // the error line above: the spy was in place
    for (const secret of [NUMBER, GROUP, "chat.contoh.test", "leakmarker", "081200"]) expect(output, secret).not.toContain(secret);
  });
});
