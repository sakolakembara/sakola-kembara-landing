import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import wranglerConfig from "../wrangler.jsonc?raw";
import type { GrantableArea } from "../src/auth/permissions";
import type { UserRole } from "../src/auth/roles";
import * as schema from "../src/db/schema";
import { KIND_RULES, uploadKinds, type UploadKind } from "../src/uploads/kinds";
import { deleteUploadByPath, storeUpload } from "../src/uploads/store";
import { checkLimits } from "../src/security/rate-limit";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { withFrozenDate } from "./limiter-clock";
import { auditRows, clearBucket, disguises, gif, jpeg, mediaRows, objectKeys, padTo, pdf, png, upload, webp, type Uploaded } from "./uploads-helpers";

// The upload API against the real workerd runtime: a real local D1 and a real
// (emulated) R2 bucket from wrangler.jsonc, the real rate limit binding.
// docs/cloudflare/uploads.md is the description; this file is the proof.

beforeEach(clearBucket);
// Spies are per file, not per test: without this `formData` would count the calls of earlier tests.
afterEach(() => vi.restoreAllMocks());

const callers: { label: string; role: UserRole; areas: GrantableArea[]; konten: boolean; pendaftaran: boolean }[] = [
  { label: "student", role: "student", areas: [], konten: false, pendaftaran: false },
  { label: "viewer", role: "viewer", areas: [], konten: false, pendaftaran: false },
  // A grant row on a viewer is inert: viewer is read-only by role.
  { label: "viewer with stray konten and pendaftaran grants", role: "viewer", areas: ["konten", "pendaftaran"], konten: false, pendaftaran: false },
  { label: "editor with no grants", role: "editor", areas: [], konten: false, pendaftaran: false },
  { label: "editor granted komunikasi only", role: "editor", areas: ["komunikasi"], konten: false, pendaftaran: false },
  { label: "editor granted konten", role: "editor", areas: ["konten"], konten: true, pendaftaran: false },
  { label: "editor granted pendaftaran", role: "editor", areas: ["pendaftaran"], konten: false, pendaftaran: true },
  { label: "editor granted konten and pendaftaran", role: "editor", areas: ["konten", "pendaftaran"], konten: true, pendaftaran: true },
  { label: "super_admin", role: "super_admin", areas: [], konten: true, pendaftaran: true },
];

/** One small valid file per kind (a report is a PDF, the rest take a PNG). */
function sample(kind: UploadKind) {
  return kind === "report" ? { bytes: pdf(), filename: "laporan.pdf", claimedType: "application/pdf" } : { bytes: png(20, 10), filename: "foto.png", claimedType: "image/png" };
}

async function editor(areas: GrantableArea[] = ["konten", "pendaftaran"]) {
  return signedInCookie(uniqueEmail("editor"), "editor", areas);
}

async function ok(response: Response): Promise<Uploaded> {
  expect(response.status).toBe(201);
  return (await response.json()) as Uploaded;
}

async function nothingStored() {
  expect(await objectKeys()).toEqual([]);
  expect(await mediaRows()).toEqual([]);
  expect(await auditRows()).toEqual([]);
}

describe("who may upload what (the area of the kind, from the guard)", () => {
  test("nobody signed in: 401 on every route, and nothing is read or stored", async () => {
    const formData = vi.spyOn(Request.prototype, "formData");
    expect((await upload()).status).toBe(401);
    expect((await call("/api/admin/uploads?kind=team-photo")).status).toBe(401);
    expect((await call(`/api/admin/uploads/${crypto.randomUUID()}`, { method: "DELETE" })).status).toBe(401);
    expect(formData).not.toHaveBeenCalled();
    await nothingStored();
  });

  // Negative check (scripts/negative-checks-uploads.mjs): drop the area check of the kind and
  // the cases where only one of the two areas is granted fail.
  for (const caller of callers) {
    test(`${caller.label}: konten kinds ${caller.konten ? "201" : "403"}, pendaftaran kinds ${caller.pendaftaran ? "201" : "403"}`, async () => {
      const cookie = await signedInCookie(uniqueEmail(caller.role), caller.role, caller.areas);
      for (const kind of uploadKinds) {
        const allowed = KIND_RULES[kind].area === "konten" ? caller.konten : caller.pendaftaran;
        const response = await upload({ kind, cookie, ...sample(kind) });
        expect(response.status, `${kind}`).toBe(allowed ? 201 : 403);
        if (!allowed) expect(await response.json()).toEqual({ error: "forbidden" });
      }
      // Only what was allowed exists.
      const allowedKinds = uploadKinds.filter((kind) => (KIND_RULES[kind].area === "konten" ? caller.konten : caller.pendaftaran));
      expect((await objectKeys()).map((key) => key.split("/")[1]).sort()).toEqual([...allowedKinds].sort());
      expect((await mediaRows()).length).toBe(allowedKinds.length);
      expect((await auditRows()).map((row) => row.action)).toEqual(allowedKinds.map(() => "upload.create"));
    });
  }

  test("a caller who cannot write any upload area is refused before the body is read, even with a huge declared length", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const formData = vi.spyOn(Request.prototype, "formData");
    const response = await upload({ cookie, contentLength: 99_000_000 });
    expect(response.status).toBe(403);
    expect(formData).not.toHaveBeenCalled();
  });

  test("the kind announced in ?kind= is checked against the area before the body is read", async () => {
    const cookie = await editor(["konten"]);
    const formData = vi.spyOn(Request.prototype, "formData");
    const response = await upload({ kind: "resource", query: "?kind=resource", cookie, ...sample("resource") });
    expect(response.status).toBe(403);
    expect(formData).not.toHaveBeenCalled();
    await nothingStored();
  });

  test("?kind= and the form field must agree, and an unknown ?kind= is refused", async () => {
    const cookie = await editor();
    const mismatch = await upload({ kind: "report", query: "?kind=team-photo", cookie, ...sample("report") });
    expect(mismatch.status).toBe(400);
    expect(((await mismatch.json()) as { error: string }).error).toBe("kind_mismatch");
    const unknown = await upload({ query: "?kind=avatar", cookie });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: string }).error).toBe("invalid_kind");
    await nothingStored();
  });
});

describe("what is stored, and where", () => {
  // Every kind with every type it accepts.
  const cases: { kind: UploadKind; label: string; file: () => Uint8Array; name: string; type: string; ext: string; width: number | null; height: number | null }[] = [];
  for (const kind of uploadKinds) {
    const types = KIND_RULES[kind].types;
    if (types.includes("png")) cases.push({ kind, label: "png", file: () => png(640, 480), name: "Foto Kegiatan.PNG", type: "image/png", ext: "png", width: 640, height: 480 });
    if (types.includes("jpeg")) cases.push({ kind, label: "jpeg", file: () => jpeg(1600, 900, 70_000), name: "foto.jpeg", type: "image/jpeg", ext: "jpg", width: 1600, height: 900 });
    if (types.includes("webp")) {
      cases.push({ kind, label: "webp lossy", file: () => webp("lossy", 800, 600), name: "a.webp", type: "image/webp", ext: "webp", width: 800, height: 600 });
      cases.push({ kind, label: "webp lossless", file: () => webp("lossless", 801, 601), name: "b.webp", type: "image/webp", ext: "webp", width: 801, height: 601 });
      cases.push({ kind, label: "webp extended", file: () => webp("extended", 1920, 1080), name: "c.webp", type: "image/webp", ext: "webp", width: 1920, height: 1080 });
    }
    // Only the blog's images take a GIF (PM decision, 2026-10-12): the size comes from the header's canvas.
    if (types.includes("gif")) cases.push({ kind, label: "gif", file: () => gif(480, 270), name: "Animasi Belajar.GIF", type: "image/gif", ext: "gif", width: 480, height: 270 });
    if (types.includes("pdf")) cases.push({ kind, label: "pdf", file: () => pdf(), name: "Laporan Tahunan 2025.pdf", type: "application/pdf", ext: "pdf", width: null, height: null });
  }

  for (const c of cases) {
    test(`${c.kind}: ${c.label} is stored with its real type, size, dimensions and cache headers`, async () => {
      const email = uniqueEmail("editor");
      const cookie = await signedInCookie(email, "editor", ["konten", "pendaftaran"]);
      const bytes = c.file();
      const uploaded = await ok(await upload({ kind: c.kind, bytes, filename: c.name, claimedType: c.type, cookie }));

      expect(uploaded).toEqual({ id: uploaded.id, path: expect.stringMatching(/^\/uploads\//), contentType: c.type, size: bytes.length, width: c.width, height: c.height });
      // The path: /uploads/<kind>/<year>/<media id>-<slug>.<ext>, the extension from the BYTES.
      const key = uploaded.path.slice(1);
      expect(key).toMatch(new RegExp(`^uploads/${c.kind}/${new Date().getUTCFullYear()}/${uploaded.id}-[a-z0-9-]+\\.${c.ext}$`));

      // The object: the bytes as sent, the type found in them, a year of immutable caching.
      const object = await env.UPLOADS.get(key);
      expect(object).not.toBeNull();
      expect(new Uint8Array(await object!.arrayBuffer())).toEqual(bytes);
      expect(object!.httpMetadata?.contentType).toBe(c.type);
      expect(object!.httpMetadata?.cacheControl).toBe("public, max-age=31536000, immutable");
      expect(await objectKeys()).toEqual([key]);

      // The registry row.
      const rows = await mediaRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: uploaded.id, key, purpose: KIND_RULES[c.kind].purpose, content_type: c.type, size: bytes.length, width: c.width, height: c.height });
      expect(rows[0]!.uploaded_by).toBe((await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>())!.id);

      // The audit row: who, what, and where; no file content.
      const audit = await auditRows();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor_email: email, action: "upload.create", resource_type: "media", resource_id: uploaded.id });
      expect(JSON.parse(audit[0]!.metadata)).toEqual({ kind: c.kind, path: uploaded.path, contentType: c.type, size: bytes.length, width: c.width, height: c.height });
    });
  }

  test("the client's file name and claimed type decide nothing: PNG bytes named .exe and claimed as a zip are a .png", async () => {
    const cookie = await editor();
    const uploaded = await ok(await upload({ bytes: png(5, 5), filename: "../../virus.exe", claimedType: "application/zip", cookie }));
    expect(uploaded.contentType).toBe("image/png");
    expect(uploaded.path).toMatch(/^\/uploads\/team-photo\/\d{4}\/[0-9a-f-]{36}-virus\.png$/);
  });

  test("two uploads of the same file never share a key", async () => {
    const cookie = await editor();
    const a = await ok(await upload({ cookie, bytes: png(5, 5), filename: "same.png" }));
    const b = await ok(await upload({ cookie, bytes: png(5, 5), filename: "same.png" }));
    expect(a.path).not.toBe(b.path);
    expect(await objectKeys()).toHaveLength(2);
  });

  test("an object is never overwritten: a second put on a key that exists fails and leaves the first intact", async () => {
    const id = "11111111-2222-4333-8444-555555555555";
    const actor = { id: crypto.randomUUID(), email: "someone@example.test" };
    const db = drizzle(env.DB, { schema });
    const now = new Date("2026-03-04T05:06:07Z");
    // A user row for the foreign key.
    await env.DB.prepare("INSERT INTO users (id, name, email, email_verified, role) VALUES (?, 'U', ?, 1, 'editor')").bind(actor.id, actor.email).run();

    vi.spyOn(crypto, "randomUUID").mockReturnValue(id as `${string}-${string}-${string}-${string}-${string}`);
    const first = await storeUpload(env, db, actor, { kind: "blog-image", file: new File([png(3, 3)], "x.png"), type: "png", width: 3, height: 3 }, now);
    expect(first.path).toBe(`/uploads/blog-image/2026/${id}-x.png`);
    const before = new Uint8Array(await (await env.UPLOADS.get(first.path.slice(1)))!.arrayBuffer());

    await expect(storeUpload(env, db, actor, { kind: "blog-image", file: new File([png(9, 9)], "x.png"), type: "png", width: 9, height: 9 }, now)).rejects.toThrow("upload key already exists");
    expect(new Uint8Array(await (await env.UPLOADS.get(first.path.slice(1)))!.arrayBuffer())).toEqual(before);
  });
});

describe("what is refused", () => {
  // Negative check: remove the magic-byte check (sniff accepting any bytes) and every case below is accepted.
  const disguised: [string, Uint8Array, string, string][] = [
    ["an executable named .png", disguises.exe, "profil.png", "image/png"],
    ["HTML named .png", disguises.html, "foto.png", "image/png"],
    ["HTML named .pdf", disguises.html, "laporan.pdf", "application/pdf"],
    ["an executable named .pdf", disguises.exe, "laporan.pdf", "application/pdf"],
    ["SVG with a script, as image/png", disguises.svg, "logo.png", "image/png"],
    ["SVG with a script, as itself", disguises.svg, "logo.svg", "image/svg+xml"],
    ["a zip named .pdf", disguises.zip, "berkas.pdf", "application/pdf"],
    // A real GIF is not a disguise for the blog's images, but these kinds do not take one (whatever it is named).
    ["a GIF named .png", gif(10, 10), "anim.png", "image/png"],
    ["a GIF named .gif", gif(10, 10), "anim.gif", "image/gif"],
    ["a made-up GIF version", disguises.gifLookalike, "anim.gif", "image/gif"],
    ["plain text named .jpg", disguises.text, "catatan.jpg", "image/jpeg"],
    ["a PDF with junk before the header", disguises.lateAndPdfish, "laporan.pdf", "application/pdf"],
  ];
  for (const kind of ["team-photo", "report", "resource"] as const) {
    for (const [label, bytes, filename, claimedType] of disguised) {
      test(`${kind}: ${label} is refused (415)`, async () => {
        const cookie = await editor();
        const response = await upload({ kind, bytes, filename, claimedType, cookie });
        expect(response.status).toBe(415);
        const body = (await response.json()) as { error: string; message: string; allowed: string[] };
        expect(body.error).toBe("unsupported_type");
        expect(body.message).toMatch(/^Tipe file tidak didukung\. Gunakan: /);
        expect(body.allowed).toEqual(KIND_RULES[kind].types.map((type) => ({ png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", pdf: "application/pdf" })[type]));
        await nothingStored();
      });
    }
  }

  test("a real file of a type the kind does not take is refused: a PDF as a team photo, a PNG as a report", async () => {
    const cookie = await editor();
    expect((await upload({ kind: "team-photo", ...{ bytes: pdf(), filename: "x.png", claimedType: "image/png" }, cookie })).status).toBe(415);
    expect((await upload({ kind: "blog-image", bytes: pdf(), filename: "x.jpg", cookie })).status).toBe(415);
    expect((await upload({ kind: "report", bytes: png(5, 5), filename: "x.pdf", claimedType: "application/pdf", cookie })).status).toBe(415);
    await nothingStored();
  });

  test("an empty file, a missing file, a text field called file: 400", async () => {
    const cookie = await editor();
    const empty = await upload({ cookie, bytes: disguises.empty });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "empty_file", message: "File kosong." });
    const none = await upload({ cookie, bytes: null });
    expect(none.status).toBe(400);
    expect(await none.json()).toEqual({ error: "file_required", message: "Tidak ada file." });
    const text = await upload({ cookie, bytes: null, extraFields: { file: "not a file, just text" } });
    expect(text.status).toBe(400);
    expect(((await text.json()) as { error: string }).error).toBe("file_required");
    await nothingStored();
  });

  test("no kind, or an unknown kind, in the form: 400", async () => {
    const cookie = await editor();
    for (const kind of [null, "", "avatar", "TEAM-PHOTO", "../report", "constructor"]) {
      const response = await upload({ cookie, kind });
      expect(response.status, String(kind)).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe("invalid_kind");
    }
    await nothingStored();
  });

  test("not multipart: 415. Multipart that is not: 400", async () => {
    const cookie = await editor();
    const json = await call("/api/admin/uploads", { method: "POST", cookie, json: { kind: "team-photo" } });
    expect(json.status).toBe(415);
    expect(((await json.json()) as { error: string }).error).toBe("multipart_required");

    const body = "this is not a multipart body";
    const broken = await call("/api/admin/uploads", { method: "POST", cookie, headers: { "content-type": "multipart/form-data; boundary=xyz", "content-length": String(body.length) }, body });
    expect(broken.status).toBe(400);
    expect(((await broken.json()) as { error: string }).error).toBe("invalid_form");
    await nothingStored();
  });

  test("a cross-site form post is refused by the same-origin guard before the upload code runs", async () => {
    const cookie = await editor();
    const formData = vi.spyOn(Request.prototype, "formData");
    const response = await upload({ cookie, headers: { origin: "https://evil.example" } });
    // `call` only sets Origin when none is given, so this reaches the worker as a foreign origin.
    expect(response.status).toBe(403);
    expect(formData).not.toHaveBeenCalled();
    await nothingStored();
  });

  test("a corrupt header, a cut-off file and absurd dimensions are refused (422) with the reason", async () => {
    const cookie = await editor();
    const corrupt = png(10, 10);
    corrupt[11] = 12;
    const polyglot = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode("<script>alert(1)</script>")]);
    for (const [label, bytes, error] of [
      ["a PNG with a broken IHDR", corrupt, "invalid_file"],
      ["an HTML document under a PNG signature", polyglot, "invalid_file"],
      ["a PNG cut before its size", png(10, 10).slice(0, 20), "invalid_file"],
      ["a JPEG cut before its frame header", jpeg(10, 10).slice(0, 25), "invalid_file"],
      ["a WebP whose RIFF size runs past the file", webp("lossy", 10, 10).slice(0, 29), "invalid_file"],
      ["a 20000 x 20000 PNG", png(20_000, 20_000), "dimensions_too_large"],
      ["a 4294967295 x 4294967295 PNG", png(0xffffffff, 0xffffffff), "dimensions_too_large"],
      ["a 9000 x 9000 JPEG (81 MP)", jpeg(9000, 9000), "dimensions_too_large"],
      ["a WebP canvas of 16777216 x 16777216", webp("extended", 1, 1).map((byte, index) => (index >= 24 && index < 30 ? 0xff : byte)), "dimensions_too_large"],
      ["a JPEG with more than 1 MiB of metadata first", jpeg(100, 100, 1_100_000), "unreadable_size"],
    ] as const) {
      const response = await upload({ cookie, bytes, filename: "x.bin" });
      expect(response.status, label).toBe(422);
      const body = (await response.json()) as { error: string; message: string };
      expect(body.error, label).toBe(error);
      expect(body.message.length).toBeGreaterThan(10);
    }
    await nothingStored();
  });
});

describe("size limits", () => {
  const big = (size: number) => padTo(png(1000, 1000), size);

  // Negative check: remove the per-kind limit and the +1 cases below are accepted.
  test("team photo and blog image: 5 MB is the limit to the byte", async () => {
    const cookie = await editor();
    for (const kind of ["team-photo", "blog-image"] as const) {
      const exactly = await upload({ kind, cookie, bytes: big(5_000_000), filename: "besar.png", ip: "203.0.113.200" });
      expect(exactly.status, `${kind} at the limit`).toBe(201);
      expect(((await exactly.json()) as Uploaded).size).toBe(5_000_000);

      const over = await upload({ kind, cookie, bytes: big(5_000_001), filename: "besar.png", ip: "203.0.113.201" });
      expect(over.status, `${kind} one byte over`).toBe(413);
      expect(await over.json()).toEqual({ error: "too_large", message: "Ukuran file maksimal 5 MB.", maxBytes: 5_000_000 });
    }
    expect(await objectKeys()).toHaveLength(2); // only the two at the limit
  });

  test("report: 20 MB. The legacy limit, and the message of the legacy app", async () => {
    const cookie = await editor();
    const doc = (size: number) => padTo(pdf(), size);
    expect((await upload({ kind: "report", cookie, bytes: doc(20_000_000), filename: "laporan.pdf" })).status).toBe(201);
    const over = await upload({ kind: "report", cookie, bytes: doc(20_000_001), filename: "laporan.pdf" });
    expect(over.status).toBe(413);
    expect(await over.json()).toEqual({ error: "too_large", message: "Ukuran file maksimal 20 MB.", maxBytes: 20_000_000 });
  });

  // Four bodies of 25 MB go through the Worker: real work (3 s when other runs share the machine, against the default limit of 5 s).
  test("resource and registration document: 25 MB, the largest of all", { timeout: 60_000 }, async () => {
    const cookie = await editor();
    for (const kind of ["resource", "registration-document"] as const) {
      expect((await upload({ kind, cookie, bytes: padTo(pdf(), 25_000_000), filename: "panduan.pdf" })).status, `${kind} at the limit`).toBe(201);
      const over = await upload({ kind, cookie, bytes: padTo(pdf(), 25_000_001), filename: "panduan.pdf" });
      expect(over.status, `${kind} one byte over`).toBe(413);
      expect(((await over.json()) as { maxBytes: number }).maxBytes).toBe(25_000_000);
    }
  });

  test("the declared length is checked before the body is read: ?kind= narrows it to the kind, without it the largest kind applies", async () => {
    const cookie = await editor();
    const formData = vi.spyOn(Request.prototype, "formData");

    // 6 MB declared for a 5 MB kind: refused unread.
    const narrowed = await upload({ kind: "team-photo", query: "?kind=team-photo", cookie, contentLength: 6_000_000 });
    expect(narrowed.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();

    // Without the hint, only the global ceiling (25 MB plus the multipart envelope) can be applied.
    const unannounced = await upload({ cookie, contentLength: 25_000_000 + 64 * 1024 + 1 });
    expect(unannounced.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
    await nothingStored();
  });

  test("a request without a declared length (chunked) is refused: 411, unread", async () => {
    const cookie = await editor();
    const formData = vi.spyOn(Request.prototype, "formData");
    const response = await upload({ cookie, contentLength: null });
    expect(response.status).toBe(411);
    expect(((await response.json()) as { error: string }).error).toBe("length_required");
    // A declared length that is not a number is the same as none.
    expect((await upload({ cookie, headers: { "content-length": "12abc" }, contentLength: null })).status).toBe(411);
    expect(formData).not.toHaveBeenCalled();
  });
});

describe("rate limit", () => {
  // Negative check: remove the limiter call and the 21st upload succeeds.
  test("20 uploads a minute per user; the 21st is a 429 with Retry-After, and another user is not affected", async () => {
    const heavy = await editor();
    const other = await editor();
    const small = png(2, 2);

    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await upload({ cookie: heavy, bytes: small, filename: `f${i}.png`, ip: "203.0.113.50" })).status);
    expect(statuses).toEqual([...Array(20).fill(201), 429]);

    const refused = await upload({ cookie: heavy, bytes: small, ip: "203.0.113.51" }); // another address: the key is the user
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("60");
    expect(refused.headers.get("cache-control")).toBe("no-store");
    expect(await refused.json()).toEqual({ error: "rate_limited", message: "Terlalu banyak unggahan. Silakan tunggu satu menit lalu coba lagi.", retryAfterSeconds: 60 });
    expect(await objectKeys()).toHaveLength(20);

    expect((await upload({ cookie: other, bytes: small, ip: "203.0.113.50" })).status).toBe(201);
  }, 20_000);

  test("a refused upload (429) never reads the body", async () => {
    const cookie = await editor();
    for (let i = 0; i < 20; i++) await upload({ cookie, bytes: png(2, 2) });
    const formData = vi.spyOn(Request.prototype, "formData");
    expect((await upload({ cookie })).status).toBe(429);
    expect(formData).not.toHaveBeenCalled();
  }, 20_000);

  test("without the binding a local run falls back to memory with the same numbers; production would refuse", async () => {
    const cookie = await editor();
    // The fallback's window lasts a minute by the wall clock from the first upload: frozen, a slow run cannot outlast it.
    await withFrozenDate(async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 21; i++) statuses.push((await upload({ cookie, bytes: png(2, 2), env: { RL_UPLOAD: undefined } })).status);
      expect(statuses).toEqual([...Array(20).fill(201), 429]);
    });

    // The same lookup in production: no binding, nothing throttles, so the request is refused (503), not allowed.
    const verdict = await checkLimits({ ENVIRONMENT: "production" }, [{ name: "upload", key: "upload:someone" }]);
    expect(verdict).toEqual({ allowed: false, reason: "unavailable", name: "upload" });
  });
});

describe("listing for pickers", () => {
  test("newest first, one kind at a time, paginated, without the uploader or the key", async () => {
    const cookie = await editor();
    const paths: string[] = [];
    for (let i = 0; i < 5; i++) {
      paths.push((await ok(await upload({ kind: "blog-image", cookie, bytes: png(10 + i, 20), filename: `gambar-${i}.png`, ip: "203.0.113.60" }))).path);
      await new Promise((resolve) => setTimeout(resolve, 3)); // distinct created_at
    }
    await ok(await upload({ kind: "team-photo", cookie, filename: "tim.png", ip: "203.0.113.61" }));
    await ok(await upload({ kind: "resource", cookie, filename: "res.png", ip: "203.0.113.62" }));
    await ok(await upload({ kind: "registration-document", cookie, filename: "reg.png", ip: "203.0.113.63" }));

    const first = await call("/api/admin/uploads?kind=blog-image&pageSize=2", { cookie });
    expect(first.status).toBe(200);
    const page1 = (await first.json()) as { items: Record<string, unknown>[]; page: number; pageSize: number; total: number; totalPages: number };
    expect(page1).toMatchObject({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
    expect(page1.items.map((item) => item.path)).toEqual([paths[4], paths[3]]);
    expect(Object.keys(page1.items[0]!).sort()).toEqual(["contentType", "createdAt", "height", "id", "path", "size", "width"]);
    expect(page1.items[0]).toMatchObject({ contentType: "image/png", width: 14, height: 20 });
    expect(new Date(page1.items[0]!.createdAt as string).toISOString()).toBe(page1.items[0]!.createdAt);

    const third = (await (await call("/api/admin/uploads?kind=blog-image&pageSize=2&page=3", { cookie })).json()) as { items: { path: string }[] };
    expect(third.items.map((item) => item.path)).toEqual([paths[0]]);

    // Kinds are separate, even the two that share a purpose.
    const resources = (await (await call("/api/admin/uploads?kind=resource", { cookie })).json()) as { total: number; items: { path: string }[] };
    expect(resources.total).toBe(1);
    expect(resources.items[0]!.path).toContain("/uploads/resource/");
    const registration = (await (await call("/api/admin/uploads?kind=registration-document", { cookie })).json()) as { total: number; items: { path: string }[] };
    expect(registration.total).toBe(1);
    expect(registration.items[0]!.path).toContain("/uploads/registration-document/");
    expect(((await (await call("/api/admin/uploads?kind=report", { cookie })).json()) as { total: number }).total).toBe(0);
  });

  test("page size is bounded, junk falls back to the defaults, a bad kind is a 400", async () => {
    const cookie = await editor();
    const big = (await (await call("/api/admin/uploads?kind=blog-image&pageSize=9999&page=-3", { cookie })).json()) as { page: number; pageSize: number };
    expect(big).toMatchObject({ page: 1, pageSize: 50 });
    const junk = (await (await call("/api/admin/uploads?kind=blog-image&pageSize=abc&page=x", { cookie })).json()) as { page: number; pageSize: number };
    expect(junk).toMatchObject({ page: 1, pageSize: 20 });
    for (const query of ["", "?kind=", "?kind=avatar", "?kind=uploads/", "?kind=%25"]) expect((await call(`/api/admin/uploads${query}`, { cookie })).status, query).toBe(400);
  });

  test("who may list: not students; viewers, super_admin and an editor of the owning area may", async () => {
    const student = await signedInCookie(uniqueEmail("student"), "student");
    const viewer = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const konten = await editor(["konten"]);
    const admin = await signedInCookie(uniqueEmail("admin"), "super_admin");
    expect((await call("/api/admin/uploads?kind=blog-image", { cookie: student })).status).toBe(403);
    expect((await call("/api/admin/uploads?kind=blog-image", { cookie: viewer })).status).toBe(200);
    expect((await call("/api/admin/uploads?kind=blog-image", { cookie: konten })).status).toBe(200);
    expect((await call("/api/admin/uploads?kind=resource", { cookie: admin })).status).toBe(200);
  });

  // An editor has no read-only level (SAKEM-082, docs/cloudflare/d1-schema.md): a picker lists the
  // kinds of the areas granted to them and nothing else. Viewers read every area but Sistem, so
  // every kind. Negative checks (scripts/negative-checks-uploads.mjs and negative-checks.mjs): drop
  // the read check of the route, or give editors the old "read everywhere" rule back, and this fails.
  for (const caller of callers) {
    test(`${caller.label}: lists ${caller.role === "editor" ? "only the kinds of the areas granted" : caller.role === "student" ? "nothing" : "every kind"}`, async () => {
      const uploader = await editor();
      for (const kind of uploadKinds) await ok(await upload({ kind, cookie: uploader, ...sample(kind), ip: "203.0.113.70" }));

      const cookie = await signedInCookie(uniqueEmail(caller.role), caller.role, caller.areas);
      for (const kind of uploadKinds) {
        const mayList =
          caller.role === "student" ? false : caller.role === "viewer" || caller.role === "super_admin" ? true : KIND_RULES[kind].area === "konten" ? caller.konten : caller.pendaftaran;
        const response = await call(`/api/admin/uploads?kind=${kind}`, { cookie });
        expect(response.status, `${caller.label} ${kind}`).toBe(mayList ? 200 : 403);
        const body = (await response.json()) as { items?: unknown[]; total?: number; error?: string };
        if (mayList) expect(body.total, `${caller.label} ${kind}`).toBe(1);
        // A refusal says nothing about what is there: no items, no count.
        else expect(body, `${caller.label} ${kind}`).toEqual({ error: "forbidden" });
      }
    });
  }

  test("an editor of konten lists konten kinds only and an editor of pendaftaran lists pendaftaran kinds only (both kinds of a shared purpose included)", async () => {
    const uploader = await editor();
    await ok(await upload({ kind: "blog-image", cookie: uploader, ip: "203.0.113.71" }));
    await ok(await upload({ kind: "resource", cookie: uploader, ip: "203.0.113.72", ...sample("resource") }));
    const konten = await editor(["konten"]);
    const pendaftaran = await editor(["pendaftaran"]);
    expect((await call("/api/admin/uploads?kind=blog-image", { cookie: konten })).status).toBe(200);
    expect((await call("/api/admin/uploads?kind=resource", { cookie: konten })).status).toBe(403);
    expect((await call("/api/admin/uploads?kind=registration-document", { cookie: konten })).status).toBe(403);
    expect((await call("/api/admin/uploads?kind=resource", { cookie: pendaftaran })).status).toBe(200);
    expect((await call("/api/admin/uploads?kind=blog-image", { cookie: pendaftaran })).status).toBe(403);
    expect((await call("/api/admin/uploads?kind=report", { cookie: pendaftaran })).status).toBe(403);
  });
});

// ─── Delete, and the references that block it ──────────────────────────

type Where = "report" | "team" | "resource" | "resource-link" | "blog-image" | "blog-html" | "blog-markdown" | "blog-html-absolute" | "announcement" | "shortlink";

/** The table a reference was inserted into, to remove it again. */
const TABLE_OF: Record<Where, string> = {
  report: "reports",
  team: "team_members",
  resource: "site_resources",
  "resource-link": "site_resources",
  "blog-image": "blog_posts",
  "blog-html": "blog_posts",
  "blog-markdown": "blog_posts",
  "blog-html-absolute": "blog_posts",
  announcement: "announcements",
  shortlink: "shortlinks",
};

async function insertReference(path: string, where: Where) {
  const id = crypto.randomUUID();
  switch (where) {
    case "resource-link":
      await env.DB.prepare("INSERT INTO site_resources (id, title, category, display_order, content_type, external_url) VALUES (?, 'Tautan', 'panduan', 1, 'url', ?)")
        .bind(id, `https://files.example.org${path}`)
        .run();
      break;
    case "announcement":
      await env.DB.prepare("INSERT INTO announcements (id, title, body, severity, cta_label, cta_url) VALUES (?, 'Judul', 'Isi pengumuman', 'info', 'Unduh', ?)").bind(id, path).run();
      break;
    case "shortlink":
      await env.DB.prepare("INSERT INTO shortlinks (id, slug, target_url) VALUES (?, ?, ?)").bind(id, `s-${id.slice(0, 8)}`, path).run();
      break;
    case "report":
      await env.DB.prepare("INSERT INTO reports (id, title, category, year, file_path, file_size) VALUES (?, 'Laporan', 'yearly', '2025', ?, 10)").bind(id, path).run();
      break;
    case "team":
      await env.DB.prepare("INSERT INTO team_members (id, name, role, image) VALUES (?, 'Nama', 'Peran', ?)").bind(id, path).run();
      break;
    case "resource":
      await env.DB.prepare("INSERT INTO site_resources (id, title, category, display_order, content_type, file_path, file_size) VALUES (?, 'Dok', 'panduan', 1, 'file', ?, 10)").bind(id, path).run();
      break;
    default: {
      const image = where === "blog-image" ? path : null;
      const html = where === "blog-html" ? `<p>Teks</p><img src="${path}" alt="">` : where === "blog-html-absolute" ? `<img src="https://files.example.org${path}">` : "<p>Teks</p>";
      const markdown = where === "blog-markdown" ? `![alt](${path})` : "Teks";
      await env.DB.prepare(
        "INSERT INTO blog_posts (id, slug, title, excerpt, content_markdown, content_html, category, author, status, image, image_width, image_height) VALUES (?, ?, 'Judul', 'Ringkas', ?, ?, 'News', 'Penulis', 'draft', ?, ?, ?)",
      )
        .bind(id, `slug-${id.slice(0, 8)}`, markdown, html, image, image ? 10 : null, image ? 10 : null)
        .run();
    }
  }
  return id;
}

describe("DELETE /api/admin/uploads/:id", () => {
  test("an unreferenced file: the object, the row and nothing else is removed, and the audit row says who", async () => {
    const email = uniqueEmail("editor");
    const cookie = await signedInCookie(email, "editor", ["konten"]);
    const uploaded = await ok(await upload({ cookie, kind: "blog-image", bytes: png(5, 5) }));
    const keep = await ok(await upload({ cookie, kind: "blog-image", bytes: png(6, 6) }));

    const response = await call(`/api/admin/uploads/${uploaded.id}`, { method: "DELETE", cookie });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(await env.UPLOADS.head(uploaded.path.slice(1))).toBeNull();
    expect(await objectKeys()).toEqual([keep.path.slice(1)]);
    expect((await mediaRows()).map((row) => row.id)).toEqual([keep.id]);

    const audit = await auditRows();
    expect(audit.map((row) => row.action)).toEqual(["upload.create", "upload.create", "upload.delete"]);
    expect(audit[2]).toMatchObject({ actor_email: email, resource_type: "media", resource_id: uploaded.id });
    expect(JSON.parse(audit[2]!.metadata)).toEqual({ path: uploaded.path });

    // Gone is gone.
    expect((await call(`/api/admin/uploads/${uploaded.id}`, { method: "DELETE", cookie })).status).toBe(404);
  });

  // Negative check: remove the reference check and these deletes go through.
  const places: readonly (readonly [string, Where, string, UploadKind, "pdf" | "png"])[] = [
    ["a report's file", "report", "Laporan", "report", "pdf"],
    ["a team member's photo", "team", "Tim", "team-photo", "png"],
    ["a document's file", "resource", "Pusat Dokumen", "resource", "pdf"],
    ["a blog hero image", "blog-image", "Blog", "blog-image", "png"],
    ["an image inside a blog article's HTML", "blog-html", "Blog", "blog-image", "png"],
    ["an image inside a blog article's markdown", "blog-markdown", "Blog", "blog-image", "png"],
    ["an image inside HTML as an absolute URL on the files domain", "blog-html-absolute", "Blog", "blog-image", "png"],
    ["a document's link to the file on the files domain", "resource-link", "Pusat Dokumen", "resource", "pdf"],
    ["an announcement's button", "announcement", "Pengumuman", "report", "pdf"],
    ["a shortlink to the file", "shortlink", "Shortlink", "report", "pdf"],
  ];
  for (const [label, where, menu, kind, type] of places) {
    test(`refused (409) while ${label} references it; allowed once it does not`, async () => {
      const cookie = await editor();
      const uploaded = await ok(await upload({ cookie, kind, ...(type === "pdf" ? { bytes: pdf(), filename: "a.pdf" } : { bytes: png(5, 5) }) }));
      const rowId = await insertReference(uploaded.path, where);

      const refused = await call(`/api/admin/uploads/${uploaded.id}`, { method: "DELETE", cookie });
      expect(refused.status).toBe(409);
      const body = (await refused.json()) as { error: string; message: string; usedBy: string[] };
      expect(body).toMatchObject({ error: "in_use", usedBy: [menu] });
      expect(body.message).toContain(menu);
      // Nothing changed: object, row, and no delete audit.
      expect(await env.UPLOADS.head(uploaded.path.slice(1))).not.toBeNull();
      expect((await mediaRows()).map((row) => row.id)).toEqual([uploaded.id]);
      expect((await auditRows()).map((row) => row.action)).toEqual(["upload.create"]);

      // Remove the reference (what the CRUD screen does when the content row changes), then delete.
      await env.DB.prepare(`DELETE FROM ${TABLE_OF[where]} WHERE id = ?`).bind(rowId).run();
      expect((await call(`/api/admin/uploads/${uploaded.id}`, { method: "DELETE", cookie })).status).toBe(204);
      expect(await objectKeys()).toEqual([]);
      expect((await auditRows()).map((row) => row.action)).toEqual(["upload.create", "upload.delete"]);
    });
  }

  test("every menu that references the file is named, once", async () => {
    const cookie = await editor();
    const uploaded = await ok(await upload({ cookie, kind: "blog-image", bytes: png(5, 5) }));
    await insertReference(uploaded.path, "blog-image");
    await insertReference(uploaded.path, "blog-html");
    await insertReference(uploaded.path, "team");
    const refused = await call(`/api/admin/uploads/${uploaded.id}`, { method: "DELETE", cookie });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { usedBy: string[] }).usedBy.sort()).toEqual(["Blog", "Tim"]);
  });

  test("a file whose name merely contains another file's path is not 'referenced' by it", async () => {
    const cookie = await editor();
    const a = await ok(await upload({ cookie, kind: "blog-image", bytes: png(5, 5), filename: "a.png" }));
    const b = await ok(await upload({ cookie, kind: "blog-image", bytes: png(6, 6), filename: "a.png" }));
    await insertReference(a.path, "blog-html");
    expect((await call(`/api/admin/uploads/${b.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect((await call(`/api/admin/uploads/${a.id}`, { method: "DELETE", cookie })).status).toBe(409);
  });

  test("SQL wildcards in a path are inert: the check compares text, it does not pattern-match", async () => {
    const cookie = await editor();
    const uploaded = await ok(await upload({ cookie, kind: "blog-image", bytes: png(5, 5) }));
    // `%` would match everything under LIKE.
    await insertReference("/uploads/%", "blog-image");
    await insertReference("%", "blog-html");
    expect((await call(`/api/admin/uploads/${uploaded.id}`, { method: "DELETE", cookie })).status).toBe(204);
  });

  test("404 for an unknown id and for anything that is not an id; the owning area is checked on the row", async () => {
    const konten = await editor(["konten"]);
    const pendaftaran = await editor(["pendaftaran"]);
    const viewer = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const student = await signedInCookie(uniqueEmail("student"), "student");
    const resource = await ok(await upload({ cookie: pendaftaran, kind: "resource", bytes: png(5, 5) }));
    const photo = await ok(await upload({ cookie: konten, kind: "team-photo", bytes: png(5, 5) }));

    for (const id of [crypto.randomUUID(), "x", "..", "%00", "undefined", "1; DROP TABLE media"]) {
      expect((await call(`/api/admin/uploads/${encodeURIComponent(id)}`, { method: "DELETE", cookie: konten })).status, id).toBe(404);
    }

    // A konten editor may not delete a file of the pendaftaran area, and the other way round.
    expect((await call(`/api/admin/uploads/${resource.id}`, { method: "DELETE", cookie: konten })).status).toBe(403);
    expect((await call(`/api/admin/uploads/${photo.id}`, { method: "DELETE", cookie: pendaftaran })).status).toBe(403);
    expect((await call(`/api/admin/uploads/${photo.id}`, { method: "DELETE", cookie: viewer })).status).toBe(403);
    expect((await call(`/api/admin/uploads/${photo.id}`, { method: "DELETE", cookie: student })).status).toBe(403);
    expect(await objectKeys()).toHaveLength(2);

    expect((await call(`/api/admin/uploads/${resource.id}`, { method: "DELETE", cookie: pendaftaran })).status).toBe(204);
    expect((await call(`/api/admin/uploads/${photo.id}`, { method: "DELETE", cookie: konten })).status).toBe(204);
  });

  test("if the object cannot be deleted after the row went, the delete still succeeds and logs a fixed sentence", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    const cookie = await editor();
    const uploaded = await ok(await upload({ cookie, kind: "blog-image", bytes: png(5, 5), filename: "rahasia-nama-orang.png" }));
    const flaky = new Proxy(env.UPLOADS, {
      get(target, property) {
        if (property === "delete") return async () => { throw new Error("r2 is down: key rahasia-nama-orang"); };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const response = await call(`/api/admin/uploads/${uploaded.id}`, { method: "DELETE", cookie, env: { UPLOADS: flaky as R2Bucket } });
    expect(response.status).toBe(204);
    expect((await mediaRows()).length).toBe(0);
    expect(lines).toEqual(["[uploads] the media row was removed but its object could not be deleted"]);
  });

  test("deleteUploadByPath, for the CRUD screens: legacy static paths are not ours, referenced files stay, the rest goes", async () => {
    const cookie = await editor();
    const actor = { id: (await env.DB.prepare("SELECT id FROM users LIMIT 1").first<{ id: string }>())!.id, email: "editor@example.test" };
    const uploaded = await ok(await upload({ cookie, kind: "team-photo", bytes: png(5, 5) }));

    for (const legacy of ["/blog/images/2025/10/1.png", "/files/pitchdeck-sakola-kembara.pdf", "/images/team/foto.jpg", "https://example.org/x.png", "", "/uploads/team-photo/2026/not-a-key.png"]) {
      expect(await deleteUploadByPath(env, actor, legacy), legacy).toEqual({ status: "not_found" });
    }
    expect(await objectKeys()).toHaveLength(1);

    const rowId = await insertReference(uploaded.path, "team");
    expect(await deleteUploadByPath(env, actor, uploaded.path)).toEqual({ status: "in_use", usedBy: ["Tim"] });
    await env.DB.prepare("DELETE FROM team_members WHERE id = ?").bind(rowId).run();
    expect(await deleteUploadByPath(env, actor, uploaded.path)).toEqual({ status: "deleted" });
    expect(await objectKeys()).toEqual([]);
    expect(await deleteUploadByPath(env, actor, uploaded.path)).toEqual({ status: "not_found" });
  });
});

describe("failures", () => {
  test("if the database write fails after the object was stored, the object is removed again", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    const cookie = await editor();

    const puts: string[] = [];
    const deletes: string[] = [];
    const bucket = new Proxy(env.UPLOADS, {
      get(target, property) {
        if (property === "put") return async (key: string, ...rest: unknown[]) => { puts.push(key); return (target.put as (...a: unknown[]) => unknown)(key, ...rest); };
        if (property === "delete") return async (key: string) => { deletes.push(key); return target.delete(key); };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const database = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch") return async () => { throw new Error("D1 is down"); };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const response = await upload({ cookie, kind: "blog-image", bytes: png(5, 5), env: { UPLOADS: bucket as R2Bucket, DB: database as D1Database } });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal" });
    // It got as far as storing the object, and then took it away again.
    expect(puts).toHaveLength(1);
    expect(deletes).toEqual(puts);
    expect(await objectKeys()).toEqual([]);
    expect(await mediaRows()).toEqual([]);
    expect(lines).toEqual(["[worker] unhandled error: D1 is down"]);
  });

  test("if R2 refuses the put, nothing is recorded: no row, no audit entry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cookie = await editor();
    const bucket = new Proxy(env.UPLOADS, {
      get(target, property) {
        if (property === "put") return async () => { throw new Error("R2 is down"); };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const response = await upload({ cookie, env: { UPLOADS: bucket as R2Bucket } });
    expect(response.status).toBe(500);
    await nothingStored();
  });

  test("nothing personal reaches the logs: not the file name, the e-mail address, the session cookie or the file's bytes", async () => {
    const lines: string[] = [];
    for (const method of ["error", "warn", "info", "log", "debug"] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")));
    const email = uniqueEmail("editor");
    const cookie = await signedInCookie(email, "editor", ["konten", "pendaftaran"]);
    lines.length = 0;

    const secretName = "ktp-budi-santoso-1234567890.png";
    const uploaded = await ok(await upload({ cookie, kind: "team-photo", bytes: png(30, 30), filename: secretName }));
    await upload({ cookie, kind: "team-photo", bytes: disguises.html, filename: secretName });
    await upload({ cookie, kind: "team-photo", bytes: padTo(png(30, 30), 5_000_001), filename: secretName });
    await call("/api/admin/uploads?kind=team-photo", { cookie });
    await call(`/api/admin/uploads/${uploaded.id}`, { method: "DELETE", cookie });

    const logged = lines.join("\n");
    expect(logged).not.toContain("ktp-budi");
    expect(logged).not.toContain(email);
    expect(logged).not.toContain(cookie.split("=")[1]!.split(";")[0]!);
    expect(logged).not.toContain("<script>");
    expect(logged).toBe("");
  });
});

describe("local-only GET /uploads/*", () => {
  async function uploadedPng() {
    const cookie = await editor();
    return ok(await upload({ cookie, kind: "blog-image", bytes: png(40, 30), filename: "lokal.png" }));
  }

  test("ENVIRONMENT=development serves the object with its type, immutable caching and nosniff", async () => {
    const uploaded = await uploadedPng();
    const response = await call(uploaded.path, { env: { ENVIRONMENT: "development" }, ip: null });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("etag")).toBeTruthy();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png(40, 30));
  });

  // Negative check: remove the production guard and the first two cases below serve the file.
  test("in production the route does not exist: 404 for a file that is in the bucket", async () => {
    const uploaded = await uploadedPng();
    expect((await call(uploaded.path, { env: { ENVIRONMENT: "production" } })).status).toBe(404);
    expect((await call(uploaded.path, { env: { ENVIRONMENT: undefined } })).status).toBe(404); // unset is production
    expect((await call(uploaded.path, { env: { ENVIRONMENT: "staging" } })).status).toBe(404);
    expect((await call(uploaded.path)).status).toBe(404); // the test environment is not development either
    const body = await call(uploaded.path, { env: { ENVIRONMENT: "production" } });
    expect(await body.json()).toEqual({ error: "not_found" });
  });

  test("it only ever looks up a key of the exact shape we write: nothing else in the bucket can be read", async () => {
    const uploaded = await uploadedPng();
    await env.UPLOADS.put("secret.txt", "not for you");
    await env.UPLOADS.put("uploads/secret.txt", "not for you");
    for (const path of [
      "/uploads/secret.txt",
      "/uploads/../secret.txt",
      "/uploads/%2e%2e/secret.txt",
      "/uploads/blog-image/2026/../../secret.txt",
      "/uploads/blog-image/",
      "/uploads/",
      "/uploads",
      `${uploaded.path}/x`,
      `${uploaded.path}%00`,
      `${uploaded.path}.html`,
      uploaded.path.replace("blog-image", "other"),
    ]) {
      const response = await call(path, { env: { ENVIRONMENT: "development" } });
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).not.toContain("not for you");
    }
    expect((await call(`/uploads/blog-image/2026/${crypto.randomUUID()}-nope.png`, { env: { ENVIRONMENT: "development" } })).status).toBe(404);
  });

  test("the Worker is told to run for /uploads/* and is bound to a placeholder bucket, with no ids in the file", () => {
    const json = wranglerConfig.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1");
    const config = JSON.parse(json) as { assets: { run_worker_first: string[] }; r2_buckets: { binding: string; bucket_name: string }[] };
    expect(config.assets.run_worker_first).toEqual(["/api/*", "/uploads/*"]);
    expect(config.r2_buckets.find((bucket) => bucket.binding === "UPLOADS")).toEqual({ binding: "UPLOADS", bucket_name: "sakem-files" });
    // The applicants' bucket (SAKEM-083) is a second binding and a bucket of its own: test/portal-foundation-config.test.ts.
    expect(config.r2_buckets.map((bucket) => bucket.binding).sort()).toEqual(["PRIVATE_FILES", "UPLOADS"]);
    expect(wranglerConfig).not.toMatch(/"(?:database_id|account_id|id)"\s*:/);
  });
});
