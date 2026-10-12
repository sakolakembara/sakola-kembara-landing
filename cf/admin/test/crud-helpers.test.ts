import { getTableColumns } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Hono, type Context } from "hono";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  auditMetadata,
  booleanFilter,
  changedFields,
  conflict,
  DEFAULT_MAX_BODY_BYTES,
  enumFilter,
  escapeLike,
  etagOf,
  fail,
  fieldsOf,
  inUse,
  invalidJson,
  invalidQuery,
  isAllowedFilePath,
  isForeignKeyViolation,
  isUniqueViolation,
  jsonRequired,
  likePattern,
  matches,
  MAX_LIKE_PATTERN_BYTES,
  MAX_LABEL_LENGTH,
  nextVersion,
  notFound,
  pageOf,
  parseBody,
  parseEtag,
  parseListQuery,
  parsePage,
  parseSearch,
  parseSort,
  preconditionRequired,
  readIfMatch,
  stale,
  tooLarge,
  uploadPath,
  validationError,
} from "../src/api/crud";
import { auditLog } from "../src/db/schema";

// Unit tests of the helpers of src/api/crud (docs/cloudflare/admin-crud.md). They run in workerd
// like everything else but touch no database: a tiny Hono app answers each helper's Response.

const things = sqliteTable("things", { id: text("id").primaryKey(), name: text("name"), kind: text("kind"), active: text("active") });

/** One helper's answer, as the status and body a client sees. */
async function answer(handler: (c: Context) => Response | Promise<Response>, request: Request | string = "http://x.test/") {
  const app = new Hono();
  app.all("*", (c) => handler(c));
  const res = await app.request(request);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

const reader = (query: Record<string, string>) => (name: string) => query[name];

describe("parsePage", () => {
  test("defaults, and what a good request gives", () => {
    expect(parsePage(reader({}))).toEqual({ page: 1, pageSize: 20, offset: 0 });
    expect(parsePage(reader({ page: "3", pageSize: "50" }))).toEqual({ page: 3, pageSize: 50, offset: 100 });
  });

  test("a number that is not a positive integer is the default, a number that is too big is clamped", () => {
    for (const page of ["0", "-2", "abc", "1.5", "", " ", "1e3", "0x10", "NaN"]) expect(parsePage(reader({ page })).page, `page=${page}`).toBe(1);
    for (const pageSize of ["0", "-1", "abc", "2.5", ""]) expect(parsePage(reader({ pageSize })).pageSize, `pageSize=${pageSize}`).toBe(20);
    expect(parsePage(reader({ pageSize: "100" })).pageSize).toBe(100);
    expect(parsePage(reader({ pageSize: "101" })).pageSize).toBe(100);
    expect(parsePage(reader({ pageSize: "1000000" })).pageSize).toBe(100);
    expect(parsePage(reader({ page: "99999999" })).page).toBe(10_000);
  });

  test("a resource may lower the defaults, never raise the maximum", () => {
    expect(parsePage(reader({}), { defaultPageSize: 10, maxPageSize: 30 }).pageSize).toBe(10);
    expect(parsePage(reader({ pageSize: "50" }), { defaultPageSize: 10, maxPageSize: 30 }).pageSize).toBe(30);
    // A default above the maximum is the maximum.
    expect(parsePage(reader({}), { defaultPageSize: 90, maxPageSize: 30 }).pageSize).toBe(30);
  });
});

describe("pageOf", () => {
  test("the envelope has exactly items, page, pageSize and total", () => {
    expect(pageOf(["a"], { page: 2, pageSize: 20 }, 21)).toEqual({ items: ["a"], page: 2, pageSize: 20, total: 21 });
  });
});

describe("parseSort", () => {
  const spec = { sorts: { name: things.name, kind: things.kind }, defaultSort: "-name", id: things.id };

  test("the default, ascending and descending, with the id as the last tie-breaker", () => {
    for (const raw of [undefined, "", "-name", "name", "-kind"]) {
      const result = parseSort(raw, spec);
      expect(result.ok, `sort=${raw}`).toBe(true);
      if (result.ok) expect(result.order, `sort=${raw}`).toHaveLength(2);
    }
    const asDefault = parseSort(undefined, spec);
    expect(asDefault.ok && asDefault.sort).toBe("-name");
  });

  test("a name outside the whitelist is refused, including names that exist on every object", () => {
    for (const raw of ["id", "-id", "createdBy", "name; drop table things", "__proto__", "-__proto__", "constructor", "toString", "hasOwnProperty", "NAME", " name"]) {
      expect(parseSort(raw, spec).ok, `sort=${raw}`).toBe(false);
    }
  });
});

describe("search", () => {
  test("parseSearch trims and cuts to 48 characters", () => {
    expect(parseSearch(undefined)).toBe("");
    expect(parseSearch("  halo  ")).toBe("halo");
    expect(parseSearch("x".repeat(500))).toHaveLength(48);
  });

  test("the LIKE pattern never exceeds D1's 50 bytes: escapes and multi-byte characters trim it further", () => {
    const bytes = (text: string) => new TextEncoder().encode(text).length;
    expect(likePattern("halo")).toBe("%halo%");
    expect(likePattern("x".repeat(48))).toBe(`%${"x".repeat(48)}%`); // exactly 50
    for (const text of ["x".repeat(48), "%".repeat(48), "_".repeat(48), "é".repeat(48), "日".repeat(48), "😀".repeat(48), "a%b_c!d".repeat(7)]) {
      const pattern = likePattern(text);
      expect(pattern, text).not.toBeNull();
      expect(bytes(pattern!), text).toBeLessThanOrEqual(MAX_LIKE_PATTERN_BYTES);
      expect(pattern!.startsWith("%") && pattern!.endsWith("%")).toBe(true);
    }
    expect(likePattern("%".repeat(48))).toBe(`%${"!%".repeat(24)}%`); // 24 escaped percents fit, the rest is dropped
  });

  test("escapeLike makes the wildcards literal", () => {
    expect(escapeLike("100%")).toBe("100!%");
    expect(escapeLike("a_b")).toBe("a!_b");
    expect(escapeLike("wow!")).toBe("wow!!");
    expect(escapeLike("plain")).toBe("plain");
  });
});

describe("filters", () => {
  test("an enum filter accepts its values only", () => {
    const filter = enumFilter(things.kind, ["a", "b"]);
    expect(filter("a").ok).toBe(true);
    for (const raw of ["c", "A", "a,b", "", "__proto__"]) expect(filter(raw).ok, raw).toBe(false);
  });

  test("a boolean filter accepts true and false only", () => {
    const filter = booleanFilter(things.active);
    expect(filter("true").ok).toBe(true);
    expect(filter("false").ok).toBe(true);
    for (const raw of ["1", "0", "yes", "TRUE", ""]) expect(filter(raw).ok, raw).toBe(false);
  });
});

describe("parseListQuery", () => {
  const spec = {
    sorts: { name: things.name },
    defaultSort: "name",
    id: things.id,
    search: [things.name],
    filters: { kind: enumFilter(things.kind, ["a", "b"]), active: booleanFilter(things.active) },
  };
  const run = async (query: string) =>
    answer((c) => {
      const result = parseListQuery(c, spec);
      return result.ok ? c.json({ ok: true, page: result.query.page, pageSize: result.query.pageSize, q: result.query.q, sort: result.query.sort, filtered: result.query.where !== undefined }) : result.response;
    }, `http://x.test/?${query}`);

  test("a good query", async () => {
    expect((await run("page=2&pageSize=5&q=%20halo%20&sort=-name&kind=a")).body).toEqual({ ok: true, page: 2, pageSize: 5, q: "halo", sort: "-name", filtered: true });
  });

  test("an empty filter value means no filter, other parameters are ignored", async () => {
    expect((await run("kind=&active=&unknown=1")).body).toMatchObject({ ok: true, filtered: false });
  });

  test("an unknown filter value or sort name is 400 invalid_query naming the parameter, never echoing the value", async () => {
    for (const [query, param] of [
      ["kind=zzz", "kind"],
      ["active=maybe", "active"],
      ["sort=password", "sort"],
    ] as const) {
      const res = await run(query);
      expect(res.status, query).toBe(400);
      expect(res.body).toEqual({ error: "invalid_query", message: expect.any(String), param });
      expect(JSON.stringify(res.body)).not.toContain("zzz");
    }
  });
});

describe("error helpers: one shape", () => {
  const cases: [string, (c: Context) => Response, number, Record<string, unknown>][] = [
    ["validationError", (c) => validationError(c, { title: "Judul wajib diisi" }), 400, { error: "invalid", message: "Periksa kembali isian formulir.", fields: { title: "Judul wajib diisi" } }],
    ["validationError with a form message and no fields", (c) => validationError(c, {}, "Isi salah satu."), 400, { error: "invalid", message: "Isi salah satu." }],
    ["invalidJson", invalidJson, 400, { error: "invalid_json", message: expect.any(String) }],
    ["jsonRequired", jsonRequired, 415, { error: "json_required", message: expect.any(String) }],
    ["invalidQuery", (c) => invalidQuery(c, "sort"), 400, { error: "invalid_query", message: expect.any(String), param: "sort" }],
    ["notFound", notFound, 404, { error: "not_found", message: expect.any(String) }],
    ["stale", stale, 409, { error: "stale", message: expect.stringContaining("diubah orang lain") }],
    ["inUse", (c) => inUse(c, ["Blog", "Tim"]), 409, { error: "in_use", message: "Masih dipakai di: Blog, Tim. Lepaskan dulu dari sana.", usedBy: ["Blog", "Tim"] }],
    ["conflict", (c) => conflict(c, { slug: "Slug sudah dipakai" }), 409, { error: "conflict", message: expect.any(String), fields: { slug: "Slug sudah dipakai" } }],
    ["tooLarge", (c) => tooLarge(c, 1024), 413, { error: "too_large", message: expect.any(String), maxBytes: 1024 }],
    ["preconditionRequired", preconditionRequired, 428, { error: "precondition_required", message: expect.any(String) }],
    ["fail without a message", (c) => fail(c, 429, "rate_limited"), 429, { error: "rate_limited" }],
  ];
  for (const [name, handler, status, body] of cases) {
    test(name, async () => {
      const res = await answer(handler);
      expect(res.status).toBe(status);
      expect(res.body).toEqual(body);
    });
  }

  test("a message is Indonesian text, never a code or an English sentence", async () => {
    for (const [, handler] of cases) {
      const { body } = await answer(handler);
      if (body.message) expect(body.message).not.toMatch(/\b(the|was|is|not found|invalid)\b/i);
    }
  });

  test("database errors are recognised through the wrapping Drizzle adds", () => {
    const inner = new Error("UNIQUE constraint failed: shortlinks.slug: SQLITE_CONSTRAINT");
    const wrapped = new Error("Failed query", { cause: new Error("D1_ERROR", { cause: inner }) });
    expect(isUniqueViolation(wrapped, "shortlinks.slug")).toBe(true);
    expect(isUniqueViolation(wrapped, "shortlinks.target_url")).toBe(false);
    expect(isUniqueViolation("UNIQUE constraint failed: shortlinks.slug", "shortlinks.slug")).toBe(false); // not an Error
    expect(isForeignKeyViolation(new Error("x", { cause: new Error("FOREIGN KEY constraint failed: SQLITE_CONSTRAINT") }))).toBe(true);
    expect(isForeignKeyViolation(new Error("other"))).toBe(false);
    expect(isForeignKeyViolation(undefined)).toBe(false);
  });
});

describe("fieldsOf", () => {
  const schema = z
    .object({
      a: z.string(),
      n: z.number().min(5),
      e: z.enum(["x"]),
      title: z.string().min(3, "Judul minimal 3 karakter").max(5, "Judul maksimal 5 karakter"),
      list: z.array(z.object({ institution: z.string().min(2, "Nama institusi minimal 2 karakter") })),
    })
    .refine(() => false, { message: "Formulir tidak lengkap" });

  test("our messages pass through, zod's English defaults become Indonesian, nested names are dotted paths", () => {
    const result = schema.safeParse({ n: 1, e: "y", title: "abcdefgh", list: [{ institution: "x" }, { institution: "ok" }, { institution: "y" }] });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = fieldsOf(result.error);
    expect(issues.fields).toEqual({
      a: "Wajib diisi.", // missing: "received undefined"
      n: "Isian belum benar.", // zod's default "Too small ..."
      e: "Isian belum benar.", // zod's default "Invalid option ..."
      title: "Judul maksimal 5 karakter",
      "list.0.institution": "Nama institusi minimal 2 karakter",
      "list.2.institution": "Nama institusi minimal 2 karakter",
    });
  });

  test("a rule about the whole form is `form`, not a field; the first message per field wins", () => {
    const whole = z.object({ x: z.string() }).refine(() => false, { message: "Formulir tidak lengkap" });
    const parsed = whole.safeParse({ x: "ok" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(fieldsOf(parsed.error)).toEqual({ fields: {}, form: "Formulir tidak lengkap" });

    const twice = z.object({ t: z.string().min(3, "pertama").regex(/^z/, "kedua") }).safeParse({ t: "a" });
    if (twice.success) throw new Error("expected a failure");
    expect(fieldsOf(twice.error).fields).toEqual({ t: "pertama" });
  });

  test("no English zod default survives in any message", () => {
    const messy = z.object({ a: z.string(), b: z.number(), c: z.boolean(), d: z.array(z.string()), e: z.email(), f: z.url(), g: z.string().min(9), h: z.string().max(1) });
    const result = messy.safeParse({ b: "x", c: 1, d: "s", e: "nope", f: "nope", g: "a", h: "bb" });
    if (result.success) throw new Error("expected a failure");
    for (const message of Object.values(fieldsOf(result.error).fields)) expect(["Wajib diisi.", "Isian belum benar."]).toContain(message);
  });
});

describe("parseBody", () => {
  const schema = z.object({ title: z.string().trim().min(3, "Judul minimal 3 karakter") });
  const post = (init: { type?: string | null; body?: string; length?: string; max?: number }) =>
    answer(async (c) => {
      const parsed = await parseBody(c, schema, { maxBytes: init.max });
      return parsed.ok ? c.json({ ok: true, data: parsed.data }) : parsed.response;
    }, new Request("http://x.test/", { method: "POST", body: init.body ?? "{}", headers: { ...(init.type === null ? {} : { "content-type": init.type ?? "application/json" }), ...(init.length ? { "content-length": init.length } : {}) } }));

  test("a good body is returned parsed (and trimmed by the schema)", async () => {
    expect((await post({ body: JSON.stringify({ title: "  Halo  " }) })).body).toEqual({ ok: true, data: { title: "Halo" } });
    expect((await post({ type: "Application/JSON; charset=utf-8", body: JSON.stringify({ title: "Halo" }) })).status).toBe(200);
  });

  test("one order: 415, 413, 400 invalid_json, 400 invalid", async () => {
    const wrongType = await post({ type: "text/plain", body: "{}" });
    expect([wrongType.status, wrongType.body.error]).toEqual([415, "json_required"]);
    expect((await post({ type: null, body: "{}" })).status).toBe(415);
    expect((await post({ type: "application/x-www-form-urlencoded", body: "title=Halo" })).status).toBe(415);

    const declaredHuge = await post({ body: "{}", length: String(DEFAULT_MAX_BODY_BYTES + 1) });
    expect([declaredHuge.status, declaredHuge.body]).toEqual([413, { error: "too_large", message: expect.any(String), maxBytes: DEFAULT_MAX_BODY_BYTES }]);

    const broken = await post({ body: "{nope" });
    expect([broken.status, broken.body.error]).toEqual([400, "invalid_json"]);
    expect((await post({ body: "" })).body.error).toBe("invalid_json");

    const invalid = await post({ body: JSON.stringify({ title: "ab" }) });
    expect([invalid.status, invalid.body]).toEqual([400, { error: "invalid", message: "Periksa kembali isian formulir.", fields: { title: "Judul minimal 3 karakter" } }]);
    expect((await post({ body: "[]" })).status).toBe(400); // JSON, but not an object
    expect((await post({ body: "null" })).status).toBe(400);
  });

  test("the size is checked on the text too, for a body sent without a Content-Length, and a resource may lower it", async () => {
    const big = JSON.stringify({ title: "x".repeat(600) });
    expect((await post({ body: big, max: 500 })).status).toBe(413);
    expect((await post({ body: big, max: 5000 })).status).toBe(200);
    expect((await post({ body: big, max: 500 })).body.maxBytes).toBe(500);
  });
});

describe("optimistic concurrency", () => {
  test("the ETag is the ISO time in double quotes, and parses back to the same instant", () => {
    const date = new Date("2026-10-12T08:30:00.123Z");
    expect(etagOf(date)).toBe('"2026-10-12T08:30:00.123Z"');
    expect(parseEtag(etagOf(date))?.getTime()).toBe(date.getTime());
    expect(parseEtag(`W/${etagOf(date)}`)?.getTime()).toBe(date.getTime());
  });

  test("anything that is not one of our ETags parses to null, including the wildcard", () => {
    for (const raw of ["", "*", "abc", '"not a date"', "2026-10-12T08:30:00.123Z", '""', '"2026-13-45"']) expect(parseEtag(raw), raw).toBeNull();
  });

  test("readIfMatch tells a missing header from a header that can never match", async () => {
    const read = (headers: Record<string, string>) => answer((c) => c.json(readIfMatch(c)), new Request("http://x.test/", { headers }));
    expect((await read({})).body).toEqual({ present: false });
    expect((await read({ "if-match": "*" })).body).toEqual({ present: true, version: null });
    expect((await read({ "if-match": '"2026-10-12T08:30:00.123Z"' })).body).toEqual({ present: true, version: "2026-10-12T08:30:00.123Z" });
  });

  test("matches is true only for the exact instant", () => {
    const current = new Date("2026-10-12T08:30:00.123Z");
    expect(matches({ present: true, version: new Date(current) }, current)).toBe(true);
    expect(matches({ present: true, version: new Date(current.getTime() + 1) }, current)).toBe(false);
    expect(matches({ present: true, version: null }, current)).toBe(false);
    expect(matches({ present: false }, current)).toBe(false);
  });

  test("the next version is now, but always after the previous one", () => {
    const previous = new Date("2026-10-12T08:30:00.123Z");
    expect(nextVersion(previous, new Date("2026-10-12T09:00:00.000Z")).toISOString()).toBe("2026-10-12T09:00:00.000Z");
    expect(nextVersion(previous, previous).getTime()).toBe(previous.getTime() + 1); // same millisecond
    expect(nextVersion(previous, new Date("2020-01-01T00:00:00.000Z")).getTime()).toBe(previous.getTime() + 1); // clock behind
  });
});

describe("audit notes", () => {
  test("metadata holds field names and a label, and nothing else", () => {
    expect(auditMetadata({})).toBeNull();
    expect(auditMetadata({ fields: [], label: "  " })).toBeNull();
    expect(JSON.parse(auditMetadata({ fields: ["title", "body"] })!)).toEqual({ fields: ["title", "body"] });
    expect(JSON.parse(auditMetadata({ fields: ["title"], label: " Judul " })!)).toEqual({ fields: ["title"], label: "Judul" });
    expect(JSON.parse(auditMetadata({ label: "Hapus ini" })!)).toEqual({ label: "Hapus ini" });
  });

  test("a long label is cut to 120 characters", () => {
    const label = JSON.parse(auditMetadata({ label: "x".repeat(500) })!).label as string;
    expect(label).toHaveLength(MAX_LABEL_LENGTH);
    expect(label.endsWith("…")).toBe(true);
  });

  test("changedFields lists the names whose value differs", () => {
    const before = { title: "A", at: new Date(5), list: [1, 2], meta: { a: 1 }, note: null, same: "x" };
    expect(changedFields(before, { title: "A", at: new Date(5), list: [1, 2], meta: { a: 1 }, note: undefined, same: "x" })).toEqual([]);
    expect(changedFields(before, { title: "B", at: new Date(6), list: [1, 3], meta: { a: 2 }, note: "n", same: "x" })).toEqual(["title", "at", "list", "meta", "note"]);
    expect(changedFields({}, { fresh: null })).toEqual([]); // absent and null are the same
    expect(changedFields({}, { fresh: 0 })).toEqual(["fresh"]);
  });

  test("withAudit fills every audit_log column (a new column must be handled there)", () => {
    expect(Object.keys(getTableColumns(auditLog)).sort()).toEqual(["action", "actorEmail", "actorId", "createdAt", "id", "metadata", "resourceId", "resourceType"]);
  });
});

describe("file paths in a form", () => {
  const id = "11111111-2222-3333-4444-555555555555";

  test("an upload of an allowed kind, and the legacy static paths", () => {
    expect(isAllowedFilePath(`/uploads/team-photo/2026/${id}-foto.jpg`, ["team-photo"])).toBe(true);
    expect(isAllowedFilePath("/images/team/ayu-ab12.jpg", ["team-photo"])).toBe(true);
    expect(isAllowedFilePath("/files/panduan.pdf", ["resource"])).toBe(true);
  });

  test("not another kind's upload, not a path that only looks like one, not an address", () => {
    for (const path of [
      `/uploads/report/2026/${id}-laporan.pdf`, // another kind
      `/uploads/team-photo/2026/${id}-foto.svg`, // an extension we do not make
      `/uploads/team-photo/2026/${id}-../x.jpg`,
      `/uploads/team-photo/2026/foto.jpg`,
      "/images/../etc/passwd",
      "//evil.example/x.jpg",
      "https://evil.example/x.jpg",
      "javascript:alert(1)",
      "uploads/team-photo/2026/x.jpg",
      "",
    ]) {
      expect(isAllowedFilePath(path, ["team-photo"]), path).toBe(false);
    }
    expect(isAllowedFilePath("/images/team/ayu.jpg", ["team-photo"], false)).toBe(false); // legacy switched off
  });

  test("uploadPath is a zod schema with an Indonesian message", () => {
    const schema = uploadPath(["team-photo"]);
    expect(schema.safeParse(`  /uploads/team-photo/2026/${id}-foto.jpg `).success).toBe(true);
    const bad = schema.safeParse("https://evil.example/x.jpg");
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]!.message).toBe("Berkas tidak valid. Unggah ulang berkasnya.");
    expect(schema.safeParse("/images/" + "a".repeat(600)).success).toBe(false);
  });
});
