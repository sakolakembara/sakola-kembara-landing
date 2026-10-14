import { describe, expect, test } from "vitest";
import { MAX_BYTES_PER_APPLICATION, MAX_FILE_BYTES, MAX_FILES_PER_APPLICATION } from "../shared/application-form/limits";
import { SLOT_IDS, SLOTS } from "../shared/application-form/slots";
import { applicationFileKey, buildKey, extensionOf, isInlineContentType, isUuid, KEY_PATTERN, STORED_TYPES, typeOfContentType } from "../src/private-files/key";
import { REFUSALS, slotFull, unsupportedType } from "../src/private-files/refusal";
import { applicationFileKey as portalApplicationFileKey } from "../src/portal/rules";
import { downloadName, fileHeaders } from "../src/private-files/serve";
import { checkRoom } from "../src/private-files/state";
import { DEFAULT_BUDGET_BYTES, storageBudget } from "../src/private-files/storage";
import { md5Of } from "../src/private-files/stream";
import { declaredLength } from "../src/private-files/upload";

// The pure parts of the private files (SAKEM-083, P4): the key, the budget, the length, the room, the words, the headers.
// The routes that use them are in test/private-files-{upload,own,admin}.test.ts.

const APP = "5f1d2c3b-0000-4000-8000-000000000002";
const FILE = "c0ffee00-0000-4000-8000-000000000003";

describe("the object key", () => {
  test("applications/<year>/<application id>/<file id>.<ext>, ids and a year and nothing else", () => {
    expect(buildKey({ year: 2026, applicationId: APP, fileId: FILE, type: "jpeg" })).toBe(`applications/2026/${APP}/${FILE}.jpg`);
    for (const [type, ext] of [["png", "png"], ["jpeg", "jpg"], ["webp", "webp"], ["pdf", "pdf"]] as const) {
      const key = buildKey({ year: 2031, applicationId: APP, fileId: FILE, type });
      expect(key).toBe(`applications/2031/${APP}/${FILE}.${ext}`);
      expect(key).toMatch(KEY_PATTERN);
    }
  });

  test("it refuses to build a key from anything that is not a year and two ids (a name, a path, a client's text)", () => {
    expect(() => buildKey({ year: 2026, applicationId: "../../x", fileId: FILE, type: "png" })).toThrow();
    expect(() => buildKey({ year: 2026, applicationId: APP, fileId: "Budi Santoso.pdf", type: "png" })).toThrow();
    expect(() => buildKey({ year: 2026.5, applicationId: APP, fileId: FILE, type: "png" })).toThrow();
    expect(() => buildKey({ year: 26, applicationId: APP, fileId: FILE, type: "png" })).toThrow();
    expect(() => buildKey({ year: 2026, applicationId: APP.toUpperCase(), fileId: FILE, type: "png" })).toThrow();
  });

  test("KEY_PATTERN accepts exactly that shape: not a public upload key, not a path trick, not another extension", () => {
    for (const bad of [
      `uploads/team-photo/2026/${FILE}-foto.png`,
      `applications/2026/${APP}/${FILE}.gif`,
      `applications/2026/${APP}/${FILE}.svg`,
      `applications/2026/${APP}/${FILE}.png/`,
      `applications/2026/${APP}/../${FILE}.png`,
      `applications/2026/${APP}/${FILE}.png.exe`,
      `/applications/2026/${APP}/${FILE}.png`,
      `applications/26/${APP}/${FILE}.png`,
      `applications/2026/${APP}/Budi-${FILE}.png`,
    ]) {
      expect(KEY_PATTERN.test(bad), bad).toBe(false);
    }
  });

  test("the key of a file row is null for anything it could not build a safe key from, never an exception", () => {
    const row = { year: 2026, applicationId: APP, fileId: FILE };
    expect(applicationFileKey({ ...row, contentType: "application/pdf" })).toBe(`applications/2026/${APP}/${FILE}.pdf`);
    expect(applicationFileKey({ ...row, contentType: "image/gif" })).toBeNull();
    expect(applicationFileKey({ ...row, applicationId: "not-an-id", contentType: "image/png" })).toBeNull();
    expect(applicationFileKey({ ...row, fileId: "x", contentType: "image/png" })).toBeNull();
    expect(applicationFileKey({ ...row, year: 0, contentType: "image/png" })).toBeNull();
    expect(applicationFileKey({ ...row, year: Number.NaN, contentType: "image/png" })).toBeNull();
  });

  test("the key shape is pinned: applications/<year>/<application id>/<file id>.<ext>, and it matches what KEY_PATTERN allows", () => {
    for (const [contentType, ext] of [["image/png", "png"], ["image/jpeg", "jpg"], ["image/webp", "webp"], ["application/pdf", "pdf"]] as const) {
      const key = applicationFileKey({ year: 2026, applicationId: APP, fileId: FILE, contentType });
      expect(key).toBe(`applications/2026/${APP}/${FILE}.${ext}`);
      expect(KEY_PATTERN.test(key!)).toBe(true);
    }
  });

  test("the application API (src/portal/rules.ts) re-exports this very function: there is one implementation of the key", () => {
    expect(portalApplicationFileKey).toBe(applicationFileKey);
  });

  test("the stored types are exactly the four of the table's CHECK, and an unknown content type has no extension of a real type", () => {
    expect(Object.values(STORED_TYPES).map((type) => type.contentType)).toEqual(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
    expect(typeOfContentType("image/gif")).toBeNull();
    expect(typeOfContentType("text/html")).toBeNull();
    expect(extensionOf("image/jpeg")).toBe("jpg");
    expect(extensionOf("text/html")).toBe("bin");
    expect(isInlineContentType("image/webp")).toBe(true);
    expect(isInlineContentType("application/pdf")).toBe(false);
  });

  test("isUuid is the lowercase 8-4-4-4-12 form crypto.randomUUID() writes", () => {
    expect(isUuid(crypto.randomUUID())).toBe(true);
    for (const bad of [undefined, null, 5, "", "x", APP.toUpperCase(), `${APP}x`, ` ${APP}`, APP.replace(/-/g, ""), "../" + APP]) expect(isUuid(bad), String(bad)).toBe(false);
  });
});

describe("the storage budget variable", () => {
  test("plain digits above zero; anything else is the default (8,000,000,000), never zero and never unlimited", () => {
    expect(storageBudget("8000000000")).toBe(8_000_000_000);
    expect(storageBudget(" 2000 ")).toBe(2000);
    expect(DEFAULT_BUDGET_BYTES).toBe(8_000_000_000);
    expect(DEFAULT_BUDGET_BYTES).toBeLessThan(10_000_000_000); // under the 10 GB-month of R2 Free
    for (const bad of [undefined, "", "0", "00", "-1", "1.5", "8e9", "8 GB", "abc", "Infinity", "NaN", "1".repeat(16)]) expect(storageBudget(bad), String(bad)).toBe(DEFAULT_BUDGET_BYTES);
  });
});

describe("Content-Length", () => {
  test("a usable header is a plain number of 1 to 10,000,000", () => {
    expect(declaredLength("1")).toBe(1);
    expect(declaredLength(" 10000000 ")).toBe(MAX_FILE_BYTES);
    expect(declaredLength("10000001")).toBe(REFUSALS.tooLarge);
    expect(declaredLength("0")).toBe(REFUSALS.emptyFile);
    for (const bad of [undefined, null, "", "abc", "-1", "1.5", "1e3", "0x10", "1 2", "12345678901234"]) expect(declaredLength(bad), String(bad)).toBe(REFUSALS.lengthRequired);
  });
});

describe("room in a slot and in an application (checkRoom)", () => {
  const counts = (bySlot: Record<string, number>, bytes = 0) => ({ bySlot, files: Object.values(bySlot).reduce((sum, n) => sum + n, 0), bytes });

  test("a slot holds its maximum and no more; a replaced file is not counted", () => {
    for (const slot of SLOT_IDS) {
      const max = SLOTS[slot].maxFiles;
      expect(checkRoom(slot, counts({ [slot]: max - 1 }), null, 1), slot).toBeNull();
      expect(checkRoom(slot, counts({ [slot]: max }), null, 1), slot).toEqual(slotFull(max));
      expect(checkRoom(slot, counts({ [slot]: max }), { size: 1 }, 1), slot).toBeNull();
    }
  });

  test("the application: files to 40 and bytes to 100,000,000, to the byte, in that order after the slot", () => {
    expect(checkRoom("self-photo", counts({ "house-photos": MAX_FILES_PER_APPLICATION - 1 }), null, 1)).toBeNull();
    expect(checkRoom("self-photo", counts({ "house-photos": MAX_FILES_PER_APPLICATION }), null, 1)).toBe(REFUSALS.applicationFull);
    expect(checkRoom("self-photo", counts({ "house-photos": MAX_FILES_PER_APPLICATION }), { size: 1 }, 1)).toBeNull();
    expect(checkRoom("self-photo", counts({ "house-photos": 3 }, MAX_BYTES_PER_APPLICATION - 10), null, 10)).toBeNull();
    expect(checkRoom("self-photo", counts({ "house-photos": 3 }, MAX_BYTES_PER_APPLICATION - 10), null, 11)).toBe(REFUSALS.applicationTooLarge);
    // A replace frees the old file's bytes.
    expect(checkRoom("self-photo", counts({ "self-photo": 1, "house-photos": 3 }, MAX_BYTES_PER_APPLICATION), { size: 500 }, 500)).toBeNull();
    // The slot is asked first.
    expect(checkRoom("self-photo", counts({ "self-photo": 1, "house-photos": 39 }, MAX_BYTES_PER_APPLICATION), null, 5)).toEqual(slotFull(1));
  });

  test("the sixteen slots hold at most 35 files in all, so the 40-file cap is a backstop and not a reachable limit", () => {
    expect(SLOT_IDS.reduce((sum, slot) => sum + SLOTS[slot].maxFiles, 0)).toBe(35);
    expect(MAX_FILES_PER_APPLICATION).toBeGreaterThan(35);
  });
});

describe("the words (docs/cloudflare/portal-api.md, 11.2 and 13)", () => {
  test("every refusal has the contract's status, code and Indonesian line", () => {
    const table = Object.fromEntries(Object.entries(REFUSALS).map(([name, refusal]) => [name, [refusal.status, refusal.error, refusal.message ?? null]]));
    expect(table).toEqual({
      notFound: [404, "not_found", null],
      unknownSlot: [404, "unknown_slot", null],
      fileNotFound: [404, "file_not_found", null],
      methodNotAllowed: [405, "method_not_allowed", null],
      lengthRequired: [411, "length_required", "Ukuran file tidak diketahui. Coba unggah lagi."],
      emptyFile: [400, "empty_file", "File kosong."],
      tooLarge: [413, "too_large", "Ukuran file maksimal 10 MB."],
      applicationFull: [409, "application_full", "Jumlah berkas sudah mencapai batas."],
      applicationTooLarge: [413, "application_too_large", "Total ukuran berkas sudah mencapai batas."],
      storageFull: [503, "storage_full", "Penyimpanan berkas sedang penuh. Hubungi panitia lewat WhatsApp."],
      storageUnavailable: [503, "storage_unavailable", "Penyimpanan berkas sedang tidak tersedia. Coba lagi nanti."],
      invalidFile: [422, "invalid_file", "File rusak atau tidak bisa dibaca. Coba simpan ulang lalu unggah lagi."],
      unreadableSize: [422, "unreadable_size", "Ukuran gambar tidak terbaca. Simpan ulang gambar tanpa metadata yang besar."],
      dimensionsTooLarge: [422, "dimensions_too_large", "Dimensi gambar terlalu besar (maksimal 10.000 piksel per sisi dan 50 megapiksel)."],
      bodyMismatch: [400, "body_mismatch", "Unggahan terputus. Coba lagi."],
      auditUnavailable: [503, "audit_unavailable", "Berkas belum bisa dibuka. Coba lagi."],
    });
    expect(REFUSALS.tooLarge.extra).toEqual({ maxBytes: 10_000_000 });
    expect(slotFull(3)).toEqual({ status: 409, error: "slot_full", message: "Slot ini sudah penuh. Hapus satu berkas dulu atau ganti berkas yang ada.", extra: { max: 3 } });
    expect(unsupportedType(SLOTS["family-card"].types)).toEqual({
      status: 415,
      error: "unsupported_type",
      message: "Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP, PDF.",
      extra: { allowed: ["image/png", "image/jpeg", "image/webp", "application/pdf"] },
    });
    expect(unsupportedType(SLOTS["self-photo"].types).message).toBe("Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP.");
  });
});

describe("what a served file carries (11.4)", () => {
  test("exactly these headers, and a name made of the slot and the id only", () => {
    const file = { id: FILE, slot: "family-card", contentType: "image/png" };
    const headers = fileHeaders(file, 1234);
    expect(Object.fromEntries(headers.entries())).toEqual({
      "cache-control": "private, no-store",
      "content-disposition": 'inline; filename="family-card-c0ffee00.png"',
      "content-length": "1234",
      "content-security-policy": "default-src 'none'; sandbox",
      "content-type": "image/png",
      "cross-origin-resource-policy": "same-origin",
      "x-content-type-options": "nosniff",
    });
    expect(fileHeaders({ ...file, contentType: "application/pdf" }, 1).get("content-disposition")).toBe('attachment; filename="family-card-c0ffee00.pdf"');
    expect(downloadName({ id: FILE, slot: "self-photo", contentType: "image/jpeg" })).toBe("self-photo-c0ffee00.jpg");
  });
});

describe("the checksum", () => {
  test("MD5 as 32 hex characters, from the checksum R2 reports or from a plain ETag; anything else is none", () => {
    const md5 = new Uint8Array([0xd4, 0x1d, 0x8c, 0xd9, 0x8f, 0x00, 0xb2, 0x04, 0xe9, 0x80, 0x09, 0x98, 0xec, 0xf8, 0x42, 0x7e]).buffer;
    expect(md5Of({ checksums: { md5 }, etag: "x" } as never)).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Of({ checksums: {}, etag: '"d41d8cd98f00b204e9800998ecf8427e"' } as never)).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Of({ checksums: {}, etag: "d41d8cd98f00b204e9800998ecf8427e-2" } as never)).toBeNull();
    expect(md5Of({ checksums: {}, etag: "abc" } as never)).toBeNull();
  });
});

// ─── The sources: nothing can build a public address ───────────────────

const sources = {
  ...import.meta.glob<string>("../src/private-files/**/*.ts", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob<string>("../src/portal/files.ts", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob<string>("../src/api/application-files.ts", { query: "?raw", import: "default", eager: true }),
};

/** The source without its comments, so the explanations may say what the code must never do. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("no code path can build a public URL for an applicant's file", () => {
  test("the folder and the two route files are found (so the checks below look at something)", () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(12);
  });

  test("no address, no presigned or public link, no public-bucket helper, no redirect to a file", () => {
    for (const [file, source] of Object.entries(sources)) {
      const text = code(source);
      expect(text, file).not.toMatch(/https?:\/\//);
      expect(text, file).not.toMatch(/r2\.dev|r2\.cloudflarestorage|createPresigned|presign|getSignedUrl|publicUrl|PUBLIC_URL|UPLOADS_BASE_URL|pathForKey|Response\.redirect|\.redirect\(|Location/i);
    }
  });

  test("the only bucket they touch is PRIVATE_FILES, never UPLOADS", () => {
    for (const [file, source] of Object.entries(sources)) {
      expect(code(source), file).not.toMatch(/\bUPLOADS\b/);
      expect(code(source), file).not.toMatch(/src\/uploads|\.\.\/uploads\/(store|key|kinds|base-url|references)/);
    }
  });

  test("they read nothing of the client's: no file name, no content type", () => {
    for (const [file, source] of Object.entries(sources)) {
      const text = code(source);
      expect(text, file).not.toMatch(/\bfile\.(name|type)\b|formData\(|FormData/);
      expect(text, file).not.toMatch(/header\(["']content-type["']\)|get\(["']content-type["']\)|header\(["']content-disposition["']\)/i);
    }
  });

  test("the file routes do not log: the only console calls are the fixed lines of the allowed set", () => {
    const calls = Object.entries(sources).flatMap(([file, source]) => [...code(source).matchAll(/console\.(\w+)\(([^)]*)\)/g)].map((match) => ({ file, method: match[1]!, argument: match[2]! })));
    expect(calls.length).toBeGreaterThan(0);
    for (const { file, method, argument } of calls) {
      expect(method, file).toBe("error");
      // A fixed string literal, nothing interpolated into it.
      expect(argument.trim(), `${file}: ${argument}`).toMatch(/^"\[private-files\][^"$`]*"$/);
    }
  });
});
