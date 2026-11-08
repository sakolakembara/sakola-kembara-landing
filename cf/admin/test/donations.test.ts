import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, test } from "vitest";
import { createInternalApp } from "../src/api/public";
import { csvCell, csvOf, wibDateTime } from "../src/api/donations";
import { DONATION_MESSAGES, FIELD_MESSAGES, normaliseWhatsapp, parseAmount, parseDonationInput } from "../src/donations/rules";
import { hashDonationToken } from "../src/donations/token";
import { InMemoryRateLimiter, type ContactDeps } from "../src/public/contact-deps";
import { resolveContactDeps } from "../src/public/contact-deps";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { bytesOf, emptyBucketBeforeEach, privateKeys, storage } from "./private-files-helpers";
import { INTERNAL_ORIGIN, uniqueIp } from "./public-helpers";

// The /donasi form's two halves (SAKEM-128, docs/cloudflare/donations.md): the donor's side, reachable only through the
// service binding (src/api/public/donations.ts), and the super admin's Donasi menu (src/api/donations.ts).

emptyBucketBeforeEach();

interface Deps extends ContactDeps {
  keys: string[];
  checks: number;
}

function deps(over: { turnstile?: boolean; limit?: number } = {}): Deps {
  const inner = new InMemoryRateLimiter(over.limit ?? 50, 60);
  const d: Deps = {
    keys: [],
    checks: 0,
    rateLimiter: {
      async hit(key) {
        d.keys.push(key);
        return inner.hit(key);
      },
    },
    verifyTurnstile: async () => {
      d.checks += 1;
      return over.turnstile ?? true;
    },
    now: Date.now,
  };
  return d;
}

interface Init {
  method?: string;
  json?: unknown;
  body?: Uint8Array;
  token?: string;
  ip?: string | null;
  headers?: Record<string, string>;
}

async function internal(path: string, init: Init = {}, d: Deps = deps()): Promise<Response> {
  const headers = new Headers(init.headers);
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  } else if (init.body) {
    headers.set("content-length", String(init.body.byteLength));
    body = init.body;
  }
  const ip = init.ip === undefined ? uniqueIp() : init.ip;
  if (ip) headers.set("x-sakem-client-ip", ip);
  if (init.token) headers.set("x-sakem-donation-token", init.token);
  const ctx = createExecutionContext();
  const response = await createInternalApp(resolveContactDeps, () => d).fetch(
    new Request(`${INTERNAL_ORIGIN}${path}`, { method: init.method ?? "GET", headers, body }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

const once = (over: Record<string, unknown> = {}) => ({ kind: "once", name: "  Rina   A. ", whatsapp: "0812-3456 7890", amount: "Rp250.000", ...over });
const monthly = (over: Record<string, unknown> = {}) => ({ kind: "monthly", name: "Budi Santoso", whatsapp: "+62 813 1111 2222", amount: 100000, startMonth: "2026-12", remindDay: "25", ...over });

interface Created {
  donation: { id: string; kind: string; name: string; whatsapp: string; amount: number; status: string; hasProof: boolean; startMonth: string | null; remindDay: number | null; source: string | null };
  token: string;
}

async function create(body: unknown = once(), d?: Deps): Promise<Created> {
  const res = await internal("/api/public/donations", { method: "POST", json: body }, d);
  expect(res.status).toBe(201);
  return (await res.json()) as Created;
}

const row = (id: string) => env.DB.prepare("SELECT * FROM donations WHERE id = ?").bind(id).first<Record<string, unknown>>();
const count = async (table: string) => (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
const auditRows = async () =>
  (await env.DB.prepare("SELECT action, resource_type, resource_id, metadata FROM audit_log ORDER BY created_at, rowid").all<{ action: string; resource_type: string; resource_id: string; metadata: string | null }>()).results;

const putProof = (id: string, token: string, body: Uint8Array = bytesOf("png"), d?: Deps) => internal(`/api/public/donations/${id}/proof`, { method: "PUT", body, token }, d);

describe("rules (pure)", () => {
  test("WhatsApp numbers are normalised to 62..., and anything that is not an Indonesian mobile number is refused", () => {
    expect(normaliseWhatsapp("0812-3456 7890")).toBe("6281234567890");
    expect(normaliseWhatsapp("+62 812 3456 7890")).toBe("6281234567890");
    expect(normaliseWhatsapp("6281234567890")).toBe("6281234567890");
    expect(normaliseWhatsapp("81234567890")).toBe("6281234567890");
    for (const bad of ["", "0812", "021-555-1234", "+1 415 555 0100", "0812abc4567", "08123456789012345"]) expect(normaliseWhatsapp(bad), bad).toBeNull();
  });

  test("amounts: whole rupiah from a number or Indonesian notation, nothing else", () => {
    expect(parseAmount("Rp250.000")).toBe(250000);
    expect(parseAmount("150.000")).toBe(150000);
    expect(parseAmount(50000)).toBe(50000);
    expect(parseAmount("1.500.000")).toBe(1500000);
    for (const bad of ["", "abc", "1,5", "-1000", "12.5", "1.50.000", 1.5]) expect(parseAmount(bad), String(bad)).toBeNull();
  });

  test("every field is checked at once, with the Indonesian messages; monthly needs a month and a day", () => {
    const result = parseDonationInput({ kind: "monthly", name: " ", whatsapp: "1", amount: "500", startMonth: "2026-13", remindDay: 32 });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { name: FIELD_MESSAGES.name, whatsapp: FIELD_MESSAGES.whatsapp, amount: FIELD_MESSAGES.amountMin, startMonth: FIELD_MESSAGES.startMonth, remindDay: FIELD_MESSAGES.remindDay },
    });
    expect(parseDonationInput({ kind: "x" })).toMatchObject({ ok: false, fieldErrors: { kind: FIELD_MESSAGES.kind } });
  });

  test("CSV cells are quoted and a spreadsheet formula is defused", () => {
    expect(csvCell('Rina "A"')).toBe('"Rina ""A"""');
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell("+62")).toBe(`"'+62"`);
    expect(csvCell(null)).toBe('""');
    expect(wibDateTime(new Date("2026-11-08T07:20:00Z"))).toBe("2026-11-08 14:20");
  });
});

describe("the donor's side, only through the service binding", () => {
  test("the Worker's public face has no such route: a valid post from the internet is the ordinary 404 and stores nothing", async () => {
    const res = await call("/api/public/donations", { method: "POST", json: once(), headers: { "x-sakem-client-ip": "198.51.100.7" } });
    expect(res.status).toBe(404);
    expect(await count("donations")).toBe(0);
  });

  test("a one-off donation: 201 with a token, the row waits for its receipt, only the token's hash is stored", async () => {
    const created = await create();
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.donation).toMatchObject({ kind: "once", name: "Rina A.", whatsapp: "6281234567890", amount: 250000, status: "awaiting_transfer", hasProof: false });
    const stored = (await row(created.donation.id))!;
    expect(stored.token_hash).toBe(await hashDonationToken(created.token));
    expect(JSON.stringify(stored)).not.toContain(created.token);
  });

  test("a monthly pledge is complete at once (no receipt), with its month and reminder day", async () => {
    const created = await create(monthly());
    expect(created.donation).toMatchObject({ kind: "monthly", status: "new", startMonth: "2026-12", remindDay: 25, whatsapp: "6281311112222" });
  });

  test("invalid fields: 400 with every field message, nothing stored, and the bot check is not spent", async () => {
    const d = deps();
    const res = await internal("/api/public/donations", { method: "POST", json: once({ whatsapp: "12", amount: "" }) }, d);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "validation_failed", message: DONATION_MESSAGES.invalid, fieldErrors: { whatsapp: FIELD_MESSAGES.whatsapp, amount: FIELD_MESSAGES.amount } });
    expect(d.checks).toBe(0);
    expect(await count("donations")).toBe(0);
  });

  test("a failed bot check: 400 turnstile_failed and nothing stored", async () => {
    const res = await internal("/api/public/donations", { method: "POST", json: once() }, deps({ turnstile: false }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "turnstile_failed", message: DONATION_MESSAGES.botCheckFailed });
    expect(await count("donations")).toBe(0);
  });

  test("rate limited per visitor address under its own key", async () => {
    const d = deps({ limit: 2 });
    const ip = uniqueIp();
    expect((await internal("/api/public/donations", { method: "POST", json: once(), ip }, d)).status).toBe(201);
    expect((await internal("/api/public/donations", { method: "POST", json: once(), ip }, d)).status).toBe(201);
    const third = await internal("/api/public/donations", { method: "POST", json: once(), ip }, d);
    expect(third.status).toBe(429);
    expect(d.keys).toEqual([`donation:${ip}`, `donation:${ip}`, `donation:${ip}`]);
    expect(await count("donations")).toBe(2);
  });

  test("no visitor address: 400 and nothing stored", async () => {
    expect((await internal("/api/public/donations", { method: "POST", json: once(), ip: null })).status).toBe(400);
    expect(await count("donations")).toBe(0);
  });

  test("the summary opens with the token only: a wrong, malformed or missing token is the same 404", async () => {
    const { donation, token } = await create();
    const ok = await internal(`/api/public/donations/${donation.id}`, { token });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as Created).donation).toMatchObject({ id: donation.id, name: "Rina A." });
    const other = await create();
    for (const wrong of [other.token, "x", undefined]) expect((await internal(`/api/public/donations/${donation.id}`, { token: wrong })).status, String(wrong)).toBe(404);
    expect((await internal(`/api/public/donations/not-a-uuid`, { token })).status).toBe(404);
  });

  test("Ubah data: the same row changes, without a bot check; a checked row is locked", async () => {
    const d = deps();
    const { donation, token } = await create(once(), d);
    const checks = d.checks;
    const res = await internal("/api/public/donations", { method: "POST", json: { ...once({ amount: 300000 }), id: donation.id }, token }, d);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Created).donation).toMatchObject({ id: donation.id, amount: 300000, status: "awaiting_transfer" });
    expect(d.checks).toBe(checks);
    expect(await count("donations")).toBe(1);

    await env.DB.prepare("UPDATE donations SET status = 'checked' WHERE id = ?").bind(donation.id).run();
    const locked = await internal("/api/public/donations", { method: "POST", json: { ...once(), id: donation.id }, token }, d);
    expect(locked.status).toBe(409);
    expect(await locked.json()).toEqual({ error: "locked", message: DONATION_MESSAGES.locked });
    const wrongToken = await internal("/api/public/donations", { method: "POST", json: { ...once(), id: donation.id }, token: (await create()).token }, d);
    expect(wrongToken.status).toBe(404);
  });

  test("the receipt: streamed to the private bucket, counted in the budget, the row becomes new", async () => {
    const { donation, token } = await create();
    const before = await storage();
    const body = bytesOf("png");
    const res = await putProof(donation.id, token, body);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Created).donation).toMatchObject({ status: "new", hasProof: true });
    const stored = (await row(donation.id))!;
    expect(stored.proof_key).toMatch(new RegExp(`^donations/${donation.id}/[0-9a-f-]{36}\\.png$`));
    expect(stored).toMatchObject({ proof_type: "image/png", proof_size: body.byteLength });
    expect(await privateKeys()).toEqual([stored.proof_key]);
    expect(await storage()).toEqual({ bytes: before.bytes + body.byteLength, files: before.files + 1 });
  });

  test("a new receipt replaces the old one: the old object goes and its bytes come back", async () => {
    const { donation, token } = await create();
    expect((await putProof(donation.id, token, bytesOf("png"))).status).toBe(200);
    const first = (await row(donation.id))!.proof_key as string;
    const second = bytesOf("pdf");
    expect((await putProof(donation.id, token, second)).status).toBe(200);
    const after = (await row(donation.id))!;
    expect(after.proof_key).not.toBe(first);
    expect(after.proof_type).toBe("application/pdf");
    expect(await privateKeys()).toEqual([after.proof_key]);
    expect(await storage()).toMatchObject({ bytes: second.byteLength, files: 1 });
  });

  test("a receipt that is not a picture or a PDF is refused by its bytes: nothing stored, the budget unchanged", async () => {
    const { donation, token } = await create();
    const before = await storage();
    const res = await putProof(donation.id, token, new TextEncoder().encode("<html><script>alert(1)</script></html>"));
    expect(res.status).toBe(415);
    expect(await privateKeys()).toEqual([]);
    expect(await storage()).toEqual(before);
    expect((await row(donation.id))!.status).toBe("awaiting_transfer");
  });

  test("a monthly pledge takes no receipt, a wrong token opens nothing, a checked row cannot change it", async () => {
    const m = await create(monthly());
    expect((await putProof(m.donation.id, m.token)).status).toBe(409);
    const o = await create();
    expect((await putProof(o.donation.id, m.token)).status).toBe(404);
    await env.DB.prepare("UPDATE donations SET status = 'checked' WHERE id = ?").bind(o.donation.id).run();
    expect((await putProof(o.donation.id, o.token)).status).toBe(409);
    expect(await privateKeys()).toEqual([]);
  });

  test("the optional source: one of the six answers, by token", async () => {
    const { donation, token } = await create();
    expect((await internal(`/api/public/donations/${donation.id}/source`, { method: "POST", json: { source: "friend" }, token })).status).toBe(200);
    expect((await row(donation.id))!.source).toBe("friend");
    expect((await internal(`/api/public/donations/${donation.id}/source`, { method: "POST", json: { source: "tiktok" }, token })).status).toBe(400);
    expect((await internal(`/api/public/donations/${donation.id}/source`, { method: "POST", json: { source: "friend" }, token: "x" })).status).toBe(404);
  });
});

describe("the Donasi menu: the super admin only", () => {
  const BASE = "/api/admin/donations";

  test("editors (whatever they were granted) and viewers get 403; nobody signed in gets 401", async () => {
    const { donation } = await create();
    expect((await call(BASE)).status).toBe(401);
    const editor = await signedInCookie(uniqueEmail("editor"), "editor", ["pendaftaran", "komunikasi", "konten"]);
    const viewer = await signedInCookie(uniqueEmail("viewer"), "viewer");
    for (const cookie of [editor, viewer]) {
      expect((await call(BASE, { cookie })).status).toBe(403);
      expect((await call(`${BASE}/${donation.id}`, { cookie })).status).toBe(403);
      expect((await call(`${BASE}/${donation.id}/proof`, { cookie })).status).toBe(403);
      expect((await call(`${BASE}/export.csv`, { cookie })).status).toBe(403);
      expect((await call(`${BASE}/${donation.id}/check`, { method: "POST", cookie })).status).toBe(403);
    }
    expect((await row(donation.id))!.status).toBe("awaiting_transfer");
  });

  test("list, filters and search; check, uncheck and note are audited with ids only", async () => {
    const admin = await signedInCookie(uniqueEmail("admin"), "super_admin");
    const a = await create();
    const b = await create(monthly());
    const listed = (await (await call(`${BASE}?kind=monthly`, { cookie: admin })).json()) as { items: { id: string }[]; total: number };
    expect(listed.items.map((item) => item.id)).toEqual([b.donation.id]);
    const searched = (await (await call(`${BASE}?q=Rina`, { cookie: admin })).json()) as { items: { id: string }[] };
    expect(searched.items.map((item) => item.id)).toEqual([a.donation.id]);
    expect((await call(`${BASE}?status=nope`, { cookie: admin })).status).toBe(400);

    expect((await call(`${BASE}/${a.donation.id}/check`, { method: "POST", cookie: admin })).status).toBe(200);
    expect((await call(`${BASE}/${a.donation.id}/check`, { method: "POST", cookie: admin })).status).toBe(200);
    expect((await row(a.donation.id))!.status).toBe("checked");
    expect((await call(`${BASE}/${a.donation.id}/uncheck`, { method: "POST", cookie: admin })).status).toBe(200);
    expect((await row(a.donation.id))!.status).toBe("new");
    const noted = await call(`${BASE}/${a.donation.id}/note`, { method: "PUT", json: { note: "Masuk di mutasi 8 Nov" }, cookie: admin });
    expect(noted.status).toBe(200);
    expect((await row(a.donation.id))!.note).toBe("Masuk di mutasi 8 Nov");

    const audit = await auditRows();
    expect(audit.map((r) => r.action)).toEqual(["donation.check", "donation.uncheck", "donation.note"]);
    expect(JSON.stringify(audit)).not.toMatch(/Rina|6281|Masuk di mutasi/);
  });

  test("the receipt opens for the super admin only, private and sandboxed, and each open is audited", async () => {
    const admin = await signedInCookie(uniqueEmail("admin"), "super_admin");
    const { donation, token } = await create();
    expect((await call(`${BASE}/${donation.id}/proof`, { cookie: admin })).status).toBe(404);
    const body = bytesOf("png");
    await putProof(donation.id, token, body);
    const res = await call(`${BASE}/${donation.id}/proof`, { cookie: admin });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(body);
    expect((await auditRows()).map((r) => [r.action, r.resource_id])).toEqual([["donation_proof.view", donation.id]]);
  });

  test("CSV export: the filtered rows, Excel-friendly, formulas defused, audited with a count", async () => {
    const admin = await signedInCookie(uniqueEmail("admin"), "super_admin");
    await create(once({ name: "=SUM(A1)" }));
    await create(monthly());
    const res = await call(`${BASE}/export.csv?kind=once`, { cookie: admin });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="donasi-\d{4}-\d{2}-\d{2}\.csv"$/);
    const raw = new Uint8Array(await res.arrayBuffer());
    expect([...raw.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // the byte order mark Excel needs
    const lines = new TextDecoder().decode(raw).trimEnd().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('"Masuk (WIB)","Nama","WhatsApp","Jenis","Nominal","Mulai","Tanggal pengingat","Tahu dari","Status","Bukti transfer","Catatan"');
    expect(lines[1]).toContain(`"'=SUM(A1)","6281234567890","Sekali","250000"`);
    expect((await auditRows()).map((r) => [r.action, r.metadata])).toEqual([["donation.export", JSON.stringify({ count: 1 })]]);
    expect(csvOf([])).toBe(`﻿${lines[0]}\r\n`);
  });

  test("delete removes the row, its receipt and its bytes from the budget", async () => {
    const admin = await signedInCookie(uniqueEmail("admin"), "super_admin");
    const { donation, token } = await create();
    await putProof(donation.id, token);
    const res = await call(`${BASE}/${donation.id}`, { method: "DELETE", cookie: admin });
    expect(res.status).toBe(204);
    expect(await row(donation.id)).toBeNull();
    expect(await privateKeys()).toEqual([]);
    expect(await storage()).toMatchObject({ bytes: 0, files: 0 });
    expect((await auditRows()).map((r) => r.action)).toEqual(["donation.delete"]);
    expect((await call(`${BASE}/${donation.id}`, { method: "DELETE", cookie: admin })).status).toBe(404);
  });
});
