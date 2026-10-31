import { describe, expect, test } from "vitest";
import { acceptFor, checkUploadFile, fileNameOf, megabytes, normaliseBase, storedFilePath, storedFileUrl, UPLOAD_KINDS, UPLOAD_MESSAGES, uploadUrl } from "~/lib/crud/upload-kinds";

// The client's copy of what the Worker accepts (the Worker's own test, test/crud-spa-contract.test.ts, fails when
// the table differs from KIND_RULES). These tests prove what the browser does with it: it refuses early.

const file = (name: string, size: number, type = "") => ({ name, size, type });

describe("checkUploadFile", () => {
  test("a good file may be tried", () => {
    expect(checkUploadFile(file("foto.png", 100_000, "image/png"), "team-photo")).toBeNull();
    expect(checkUploadFile(file("laporan.pdf", 19_000_000, "application/pdf"), "report")).toBeNull();
    expect(checkUploadFile(file("foto.jpg", 1, "image/jpeg"), "blog-image")).toBeNull();
  });

  test("GIF: the blog's images take it, nothing else does (the legacy blog took it, the team form did not)", () => {
    expect(checkUploadFile(file("animasi.gif", 100_000, "image/gif"), "blog-image")).toBeNull();
    expect(checkUploadFile(file("animasi.GIF", 100_000, ""), "blog-image")).toBeNull();
    expect(checkUploadFile(file("animasi.gif", 100_000, "image/gif"), "team-photo")).toBe("Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP.");
    expect(checkUploadFile(file("animasi.gif", 100_000, "image/gif"), "resource")).toBe("Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP, PDF.");
    expect(checkUploadFile(file("animasi.svg", 10, "image/svg+xml"), "blog-image")).toBe("Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP, GIF.");
  });

  test("an empty file", () => {
    expect(checkUploadFile(file("foto.png", 0, "image/png"), "team-photo")).toBe("File kosong.");
  });

  test("over the limit of the kind, to the byte, in the Worker's words", () => {
    expect(checkUploadFile(file("a.png", 5_000_000, "image/png"), "team-photo")).toBeNull();
    expect(checkUploadFile(file("a.png", 5_000_001, "image/png"), "team-photo")).toBe("Ukuran file maksimal 5 MB.");
    expect(checkUploadFile(file("a.pdf", 20_000_001, "application/pdf"), "report")).toBe("Ukuran file maksimal 20 MB.");
    expect(checkUploadFile(file("a.pdf", 25_000_001, "application/pdf"), "resource")).toBe("Ukuran file maksimal 25 MB.");
    expect(checkUploadFile(file("a.pdf", 25_000_000, "application/pdf"), "resource")).toBeNull();
  });

  test("a type the kind does not take, by the type the browser guessed", () => {
    expect(checkUploadFile(file("a.pdf", 10, "application/pdf"), "team-photo")).toBe("Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP.");
    expect(checkUploadFile(file("a.png", 10, "image/png"), "report")).toBe("Tipe file tidak didukung. Gunakan: PDF.");
    expect(checkUploadFile(file("a.svg", 10, "image/svg+xml"), "blog-image")).toBe(UPLOAD_MESSAGES.type(UPLOAD_KINDS["blog-image"].types));
    expect(checkUploadFile(file("a.docx", 10, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "resource")).toBe("Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP, PDF.");
  });

  test("with no guess (or the catch-all type), the extension decides", () => {
    expect(checkUploadFile(file("foto.PNG", 10, ""), "team-photo")).toBeNull();
    expect(checkUploadFile(file("foto.jpeg", 10, "application/octet-stream"), "team-photo")).toBeNull();
    expect(checkUploadFile(file("laporan.pdf", 10, ""), "report")).toBeNull();
    expect(checkUploadFile(file("program.exe", 10, ""), "team-photo")).toContain("Tipe file tidak didukung");
    expect(checkUploadFile(file("tanpa-ekstensi", 10, ""), "team-photo")).toContain("Tipe file tidak didukung");
  });

  test("the browser's guess is not trusted over the name in the other direction either (the Worker reads the bytes anyway)", () => {
    // A renamed file is only refused here when the guess says so; the Worker has the last word on the content.
    expect(checkUploadFile(file("virus.exe", 10, "image/png"), "team-photo")).toBeNull();
  });
});

describe("the kinds", () => {
  test("the limits are the legacy app's, in decimal megabytes", () => {
    expect(megabytes(5_000_000)).toBe("5 MB");
    expect(UPLOAD_KINDS["team-photo"]).toMatchObject({ area: "konten", maxBytes: 5_000_000 });
    expect(UPLOAD_KINDS.report).toMatchObject({ area: "konten", maxBytes: 20_000_000, types: ["pdf"] });
    expect(UPLOAD_KINDS.resource).toMatchObject({ area: "pendaftaran", maxBytes: 25_000_000 });
  });

  test("acceptFor lists types and extensions, so the picker filters by either", () => {
    expect(acceptFor("report")).toBe("application/pdf,.pdf");
    expect(acceptFor("team-photo")).toBe("image/png,.png,image/jpeg,.jpg,.jpeg,image/webp,.webp");
    expect(acceptFor("blog-image")).toBe("image/png,.png,image/jpeg,.jpg,.jpeg,image/webp,.webp,image/gif,.gif");
  });
});

describe("storedFileUrl: where the admin draws a stored file from", () => {
  const FILES = "https://files.example.org";
  const SITE = "https://sakolakembara.org";
  const upload = "/uploads/blog-image/2026/11111111-2222-3333-4444-555555555555-foto.png";
  const legacy = "/blog/images/2026/02/IMG-20251203-WA0016-1.jpg";

  test("an upload comes from the files domain, as before", () => {
    expect(storedFileUrl(upload, FILES, SITE)).toBe(`${FILES}${upload}`);
    expect(storedFileUrl(upload, "", SITE)).toBe(upload); // no files domain (development): the same host serves it
  });

  test("any other path of the site comes from the public site, because the admin's own host has no such file (the migrated articles' pictures)", () => {
    expect(storedFileUrl(legacy, FILES, SITE)).toBe(`${SITE}${legacy}`);
    expect(storedFileUrl("/images/team/dewi.jpg", FILES, SITE)).toBe(`${SITE}/images/team/dewi.jpg`);
    expect(storedFileUrl(legacy, FILES, `${SITE}/`)).toBe(`${SITE}${legacy}`); // a trailing slash of the variable does not double
  });

  test("with no public address to put in front, the path stays as it is", () => {
    expect(storedFileUrl(legacy, FILES, "")).toBe(legacy);
    expect(storedFileUrl(legacy, FILES, "sakolakembara.org")).toBe(legacy); // not an origin
    expect(storedFileUrl(legacy, FILES, null)).toBe(legacy);
  });

  test("an absolute address, an address without a scheme, a traversal, a query, a space and a backslash are left alone", () => {
    for (const odd of ["https://elsewhere.example/a.jpg", "//elsewhere.example/a.jpg", "/blog/../admin/a.jpg", "/../a.jpg", "/blog/..", "/a.jpg?x=1", "/a.jpg#top", "/blog/a b.jpg", "/blog\\a.jpg", "relative/a.jpg", ""]) {
      expect(storedFileUrl(odd, FILES, SITE), odd).toBe(odd);
    }
  });

  test("storedFilePath is the inverse: what was drawn from the files domain or the site comes back as the stored path, anything else is untouched", () => {
    expect(storedFilePath(`${FILES}${upload}`, FILES, SITE)).toBe(upload);
    expect(storedFilePath(`${SITE}${legacy}`, FILES, SITE)).toBe(legacy);
    expect(storedFilePath("https://elsewhere.example/a.jpg", FILES, SITE)).toBe("https://elsewhere.example/a.jpg");
    expect(storedFilePath(`${SITE}/../x.jpg`, FILES, SITE)).toBe(`${SITE}/../x.jpg`);
    expect(storedFilePath(`${SITE}.evil.example/a.jpg`, FILES, SITE)).toBe(`${SITE}.evil.example/a.jpg`); // another host that starts the same way
    expect(storedFilePath(legacy, FILES, SITE)).toBe(legacy);
    for (const path of [upload, legacy]) expect(storedFilePath(storedFileUrl(path, FILES, SITE), FILES, SITE)).toBe(path);
  });
});

describe("uploadUrl: where a stored file is shown", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const path = `/uploads/team-photo/2026/${id}-foto.png`;

  test("a base goes in front of an upload path, and only of that", () => {
    expect(uploadUrl(path, "https://files.example.org")).toBe(`https://files.example.org${path}`);
    expect(uploadUrl(path, "https://files.example.org/")).toBe(`https://files.example.org${path}`);
    expect(uploadUrl(path, "http://localhost:8787")).toBe(`http://localhost:8787${path}`);
    expect(uploadUrl("/images/team/ayu.jpg", "https://files.example.org")).toBe("/images/team/ayu.jpg");
    expect(uploadUrl("https://other.example/uploads/x.png", "https://files.example.org")).toBe("https://other.example/uploads/x.png");
    expect(uploadUrl(null, "https://files.example.org")).toBeNull();
  });

  test("no base, or one that is not an origin, leaves the path as it is", () => {
    for (const base of ["", "   ", null, undefined, "javascript:alert(1)", "https://x.example/path", 'https://x.example"><script>', "ftp://x.example", "files.example.org"]) {
      expect(uploadUrl(path, base), String(base)).toBe(path);
    }
  });

  test("a path with a traversal, a query or a space is left alone", () => {
    for (const odd of ["/uploads/../etc/passwd", "/uploads/a/../b.png", "/uploads/x.png?x=1", "/uploads/x.png#h", "/uploads/a b.png", "/uploads/a\\b.png"]) {
      expect(uploadUrl(odd, "https://files.example.org"), odd).toBe(odd);
    }
  });

  test("normaliseBase", () => {
    expect(normaliseBase(" https://files.example.org/// ")).toBe("https://files.example.org");
    expect(normaliseBase(42)).toBe("");
  });

  test("fileNameOf drops the id the Worker puts in front of the name", () => {
    expect(fileNameOf(path)).toBe("foto.png");
    expect(fileNameOf("/files/panduan.pdf")).toBe("panduan.pdf");
  });
});
