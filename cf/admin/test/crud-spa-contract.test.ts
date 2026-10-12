import { afterEach, describe, expect, test } from "vitest";
import { api, setTransport } from "../spa/src/lib/api";
import { describeFailure } from "../spa/src/lib/crud/errors";
import { ifMatch } from "../spa/src/lib/crud/etag";
import { type ListSpec, parseListQuery, toApiQuery, toSearchParams } from "../spa/src/lib/crud/query";
import { acceptFor, checkUploadFile, FILE_TYPES as SPA_FILE_TYPES, normaliseBase, UPLOAD_KINDS, UPLOAD_MESSAGES, uploadUrl } from "../spa/src/lib/crud/upload-kinds";
import { etagOf } from "../src/api/crud";
import { KIND_RULES, uploadKinds } from "../src/uploads/kinds";
import { FILE_TYPES } from "../src/uploads/sniff";
import { uploadsBase } from "../src/uploads/base-url";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { padTo, pdf, png, upload } from "./uploads-helpers";

// What the SPA's CRUD kit sends and expects, checked against the real Worker in workerd (the SPA tests stub the
// API, so these are what keep the two sides honest): the list query, the error mapping, the ETag, the upload
// table and its messages, and the address of a stored file. Same idea as test/spa-contract.test.ts.

afterEach(() => setTransport(null));

const LIST = "/api/admin/announcements";

/** The SPA's `api()` over the real Worker: what a page would get, with this session. */
function over(cookie: string) {
  setTransport(async (path, init) =>
    call(path, {
      method: init.method,
      headers: init.headers as Record<string, string> | undefined,
      body: init.body as string | undefined,
      cookie,
    }),
  );
}

const valid = { title: "Pendaftaran Dibuka", body: "Isi pengumuman", severity: "info", ctaLabel: "", ctaUrl: "", active: true, startsAt: null, endsAt: null };

describe("the list query the SPA builds is what the Worker's list accepts", () => {
  const spec: ListSpec = { filters: ["severity", "active"], sorts: ["createdAt", "updatedAt", "title", "startsAt"], defaultSort: "-createdAt" };

  test("the default query, a filtered and sorted one, and every sort and filter of the spec", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    over(cookie);
    for (const search of ["", "page=2&q=halo&severity=urgent&active=true&sort=-title", "sort=startsAt", "sort=-updatedAt", "active=false", "severity=warning"]) {
      const query = parseListQuery(new URLSearchParams(search), spec);
      const result = await api<{ items: unknown[]; page: number; pageSize: number; total: number }>(`${LIST}${toApiQuery(query, spec)}`);
      expect(result.ok, search).toBe(true);
      if (result.ok) expect(result.data).toMatchObject({ page: query.page, pageSize: 20 });
    }
  });

  test("the address-bar form of a query reads back to the same query (what the URL keeps)", () => {
    const query = parseListQuery(new URLSearchParams("page=3&q=halo&severity=urgent&sort=title"), spec);
    expect(parseListQuery(toSearchParams(query, spec), spec)).toEqual(query);
  });
});

describe("every error the CRUD API answers maps to a sentence for a person (through the SPA's own api())", () => {
  const forbiddenSentence = "Kamu tidak punya izin untuk melakukan ini.";

  test("400 invalid: the Worker's message and fields, untouched", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);
    over(cookie);
    const result = await api(LIST, { method: "POST", json: { ...valid, title: "ab", body: "abc" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(describeFailure(result)).toEqual({
      message: "Periksa kembali isian formulir.",
      fields: { title: "Judul minimal 3 karakter", body: "Isi minimal 5 karakter" },
      stale: false,
    });
  });

  test("the field names the Worker reports are the names the SPA's form uses (the error summary links to #<name>)", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);
    over(cookie);
    const result = await api(LIST, { method: "POST", json: { title: "", body: "", severity: "loud", ctaLabel: "x", ctaUrl: "", startsAt: "bukan tanggal", endsAt: "bukan tanggal" } });
    if (result.ok) throw new Error("expected a failure");
    // The form's controls have ids title, body, severity, ctaLabel, ctaUrl, active, startsAt, endsAt.
    const formFields = ["title", "body", "severity", "ctaLabel", "ctaUrl", "active", "startsAt", "endsAt"];
    for (const name of Object.keys(describeFailure(result).fields)) expect(formFields, name).toContain(name);
  });

  test("403 forbidden, 401 unauthenticated and 404 not_found have a line of their own; 428 and 409 stale are recognised", async () => {
    const viewer = await signedInCookie(uniqueEmail("viewer"), "viewer");
    over(viewer);
    const denied = await api(LIST, { method: "POST", json: valid });
    if (denied.ok) throw new Error("expected a failure");
    expect(denied.status).toBe(403);
    expect(describeFailure(denied).message).toBe(forbiddenSentence);

    setTransport(async (path, init) => call(path, { method: init.method, headers: init.headers as Record<string, string> | undefined, body: init.body as string | undefined }));
    const nobody = await api(LIST);
    if (nobody.ok) throw new Error("expected a failure");
    expect(nobody.status).toBe(401);
    expect(describeFailure(nobody).message).toBe("Sesi kamu sudah berakhir. Masuk lagi untuk melanjutkan.");

    const editor = await signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);
    over(editor);
    const missing = await api(`${LIST}/tidak-ada`);
    if (missing.ok) throw new Error("expected a failure");
    expect(describeFailure(missing).message).toBe("Data tidak ditemukan. Mungkin sudah dihapus.");

    const created = await api<{ item: { id: string; updatedAt: string } }>(LIST, { method: "POST", json: valid });
    if (!created.ok) throw new Error("create failed");
    const { id, updatedAt } = created.data.item;

    const unconditional = await api(`${LIST}/${id}`, { method: "PUT", json: valid });
    if (unconditional.ok) throw new Error("expected a failure");
    expect(unconditional.status).toBe(428);
    expect(describeFailure(unconditional).message).toContain("Muat ulang halaman");

    // The SPA's If-Match, built from the updatedAt it was given, is accepted; the same one a second time is stale.
    const first = await api(`${LIST}/${id}`, { method: "PUT", json: { ...valid, title: "Versi pertama" }, ifMatch: ifMatch(updatedAt) });
    expect(first.ok).toBe(true);
    const second = await api(`${LIST}/${id}`, { method: "PUT", json: { ...valid, title: "Versi kedua" }, ifMatch: ifMatch(updatedAt) });
    if (second.ok) throw new Error("expected a failure");
    expect(second.status).toBe(409);
    expect(describeFailure(second)).toMatchObject({ stale: true, message: expect.stringContaining("Perubahan yang belum disimpan akan hilang") });
  });

  test("a body that is too large, and one that is not JSON", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);
    over(cookie);
    const huge = await api(LIST, { method: "POST", json: { ...valid, body: "x".repeat(600_000) } });
    if (huge.ok) throw new Error("expected a failure");
    expect(huge.status).toBe(413);
    expect(describeFailure(huge).message).toBe("Isi permintaan terlalu besar.");

    setTransport(async (path, init) => call(path, { method: init.method, headers: { "content-type": "application/json" }, body: "{nope", cookie }));
    const broken = await api(LIST, { method: "POST", json: {} });
    if (broken.ok) throw new Error("expected a failure");
    expect(broken.status).toBe(400);
    expect(describeFailure(broken).message).toBe("Isi permintaan bukan JSON yang valid.");
  });

  test("an unknown sort is a 400 the SPA cannot cause with its own spec, and still reads as a sentence", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    over(cookie);
    const bad = await api(`${LIST}?sort=createdBy`);
    if (bad.ok) throw new Error("expected a failure");
    expect(bad.code).toBe("invalid_query");
    expect(describeFailure(bad).message).toBe("Pencarian atau penyaringan tidak dikenal.");
  });
});

describe("the ETag the Worker sends is the one the SPA builds", () => {
  test("etagOf(updatedAt) equals ifMatch(iso), and the Worker's ETag header equals it for the item it answered", async () => {
    const date = new Date("2026-10-12T08:30:00.123Z");
    expect(ifMatch(date.toISOString())).toBe(etagOf(date));

    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);
    over(cookie);
    const created = await call(LIST, { method: "POST", cookie, json: valid });
    const { item } = (await created.json()) as { item: { updatedAt: string } };
    expect(created.headers.get("etag")).toBe(ifMatch(item.updatedAt));
  });
});

describe("the upload table of the SPA is the Worker's", () => {
  test("every kind: the area, the limit and the accepted types", () => {
    expect(Object.keys(UPLOAD_KINDS).sort()).toEqual([...uploadKinds].sort());
    for (const kind of uploadKinds) {
      expect(UPLOAD_KINDS[kind], kind).toEqual({ area: KIND_RULES[kind].area, maxBytes: KIND_RULES[kind].maxBytes, types: KIND_RULES[kind].types });
    }
  });

  test("every file type: the content type and the extension (the SPA also lists the alternative spellings)", () => {
    expect(Object.keys(SPA_FILE_TYPES).sort()).toEqual(Object.keys(FILE_TYPES).sort());
    for (const [type, server] of Object.entries(FILE_TYPES)) {
      const spa = SPA_FILE_TYPES[type as keyof typeof SPA_FILE_TYPES];
      expect(spa.mime, type).toBe(server.contentType);
      expect(spa.extensions, type).toContain(`.${server.ext}`);
    }
    expect(acceptFor("report")).toContain("application/pdf");
  });

  test("the words the SPA refuses with are the words the Worker answers with", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["konten"]);
    // Too big: a real upload of one byte over the limit, as the SPA would have refused it.
    const big = await upload({ cookie, kind: "team-photo", bytes: padTo(png(10, 10), 5_000_001) });
    expect(big.status).toBe(413);
    expect(((await big.json()) as { message: string }).message).toBe(UPLOAD_MESSAGES.tooBig(KIND_RULES["team-photo"].maxBytes));
    expect(checkUploadFile({ name: "a.png", size: 5_000_001, type: "image/png" }, "team-photo")).toBe(UPLOAD_MESSAGES.tooBig(5_000_000));

    // Wrong type for the kind: a PDF as a team photo.
    const wrong = await upload({ cookie, kind: "team-photo", bytes: pdf(), filename: "a.pdf", claimedType: "application/pdf" });
    expect(wrong.status).toBe(415);
    expect(((await wrong.json()) as { message: string }).message).toBe(UPLOAD_MESSAGES.type(KIND_RULES["team-photo"].types));
    expect(checkUploadFile({ name: "a.pdf", size: 10, type: "application/pdf" }, "team-photo")).toBe(UPLOAD_MESSAGES.type(["png", "jpeg", "webp"]));

    // Empty.
    const empty = await upload({ cookie, kind: "team-photo", bytes: new Uint8Array(0) });
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { message: string }).message).toBe(UPLOAD_MESSAGES.empty);
  });

  test("a file the SPA lets through at the limit is one the Worker accepts", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["konten"]);
    const atLimit = padTo(png(10, 10), 5_000_000);
    expect(checkUploadFile({ name: "a.png", size: atLimit.length, type: "image/png" }, "team-photo")).toBeNull();
    expect((await upload({ cookie, kind: "team-photo", bytes: atLimit })).status).toBe(201);
  });
});

describe("where a stored file is shown", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const path = `/uploads/team-photo/2026/${id}-foto.png`;
  const FILES = "https://files.example.org";

  // The public site's own `uploadUrl` (cf/web/src/lib/uploads.ts) gives exactly these answers: the table was printed
  // by running that function on these inputs (the admin's test run cannot import cf/web, whose tsconfig extends
  // Astro's). If the public site's rule changes, change this table and the SPA's `uploadUrl` together.
  const expected: [string | null, string | null | undefined, string | null][] = [
    [path, FILES, `${FILES}${path}`],
    [path, `${FILES}/`, `${FILES}${path}`],
    [path, "http://localhost:8787", `http://localhost:8787${path}`],
    [path, "", path],
    [path, null, path],
    [path, "javascript:alert(1)", path],
    [path, "https://x.example/path", path],
    [path, 'https://x.example"><script>', path],
    ["/images/team/ayu.jpg", FILES, "/images/team/ayu.jpg"],
    ["https://other.example/uploads/x.png", FILES, "https://other.example/uploads/x.png"],
    ["//evil.example/uploads/x.png", FILES, "//evil.example/uploads/x.png"],
    ["/uploads/../etc/passwd", FILES, "/uploads/../etc/passwd"],
    ["/uploads/x.png?x=1", FILES, "/uploads/x.png?x=1"],
    ["/uploads/a b.png", FILES, "/uploads/a b.png"],
    ["/uploads/a\\b.png", FILES, "/uploads/a\\b.png"],
    [null, FILES, null],
  ];

  test("the SPA's uploadUrl gives what the public site's does on every input", () => {
    for (const [input, base, output] of expected) expect(uploadUrl(input as string, base), `${input} + ${base}`).toBe(output);
  });

  test("the normalisations of the base agree: the Worker's, the SPA's, and the public site's (as printed)", () => {
    const bases: [string, string][] = [
      [FILES, FILES],
      [`${FILES}/`, FILES],
      [` ${FILES}/// `, FILES],
      ["http://localhost:8787", "http://localhost:8787"],
      ["", ""],
      ["   ", ""],
      ["files.example.org", ""],
      ["ftp://x.example", ""],
      ["https://x.example/path", ""],
      ["javascript:alert(1)", ""],
      ['https://x.example"><script>', ""],
      ["https://a.b-c.example:8443", "https://a.b-c.example:8443"],
    ];
    for (const [base, output] of bases) {
      expect(normaliseBase(base), base).toBe(output);
      expect(uploadsBase(base), base).toBe(output);
    }
  });

  test("GET /api/config answers uploadsBaseUrl: the normalised variable, empty when it is unset or not an origin", async () => {
    const read = async (value: string | undefined) => ((await (await call("/api/config", { env: { UPLOADS_BASE_URL: value } })).json()) as { uploadsBaseUrl: string }).uploadsBaseUrl;
    expect(await read(undefined)).toBe("");
    expect(await read("")).toBe("");
    expect(await read("https://files.example.org/")).toBe("https://files.example.org");
    expect(await read("javascript:alert(1)")).toBe("");
    expect(await read("https://files.example.org/path")).toBe("");
  });
});
