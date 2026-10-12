import { describe, expect, test } from "vitest";
import { buildKey, idOfKey, keyForPath, keyRange, kindOfKey, KEY_PATTERN, MAX_SLUG_LENGTH, pathForKey, slugFromFilename } from "../src/uploads/key";
import { areaOfPurpose, isUploadKind, KIND_RULES, MAX_UPLOAD_BYTES, uploadAreas, uploadKinds } from "../src/uploads/kinds";
import { detectType, MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE, SNIFF_WINDOW, sniff } from "../src/uploads/sniff";
import { disguises, jpeg, padTo, pdf, png, webp } from "./uploads-helpers";

// Pure functions: what a file is from its bytes, the size of an image from its
// header, and the shape of an object key. No Worker, no storage.

const ok = (bytes: Uint8Array) => sniff(bytes.slice(0, SNIFF_WINDOW), bytes.length);

describe("what a file is, from its bytes", () => {
  // Negative check (scripts/negative-checks-uploads.mjs): make `sniff` believe the first bytes
  // are whatever they are and every disguised file below is accepted.
  test("PNG, JPEG, WebP (three flavours) and PDF are recognised", () => {
    expect(ok(png(640, 480))).toEqual({ ok: true, type: "png", width: 640, height: 480 });
    expect(ok(jpeg(1600, 900))).toEqual({ ok: true, type: "jpeg", width: 1600, height: 900 });
    expect(ok(webp("lossy", 800, 600))).toEqual({ ok: true, type: "webp", width: 800, height: 600 });
    expect(ok(webp("lossless", 801, 601))).toEqual({ ok: true, type: "webp", width: 801, height: 601 });
    expect(ok(webp("extended", 1920, 1080))).toEqual({ ok: true, type: "webp", width: 1920, height: 1080 });
    expect(ok(pdf())).toEqual({ ok: true, type: "pdf", width: null, height: null });
  });

  test("an executable, HTML, SVG, a zip, a GIF, text and an empty file are not any of them", () => {
    for (const [name, bytes] of Object.entries(disguises)) {
      expect(sniff(bytes, bytes.length), name).toEqual({ ok: false, reason: "unknown_type" });
    }
  });

  test("the header is judged at byte 0: a PDF with junk before it is refused", () => {
    expect(detectType(disguises.lateAndPdfish)).toBeNull();
    expect(detectType(new TextEncoder().encode("%PDF-3.0"))).toBeNull(); // no such version
    expect(detectType(new TextEncoder().encode("%PDF-1.x"))).toBeNull();
    expect(detectType(new TextEncoder().encode("%PDF-2.0"))).toBe("pdf");
  });

  test("right signature, wrong rest: corrupt, not accepted", () => {
    const badPng = png(10, 10);
    badPng.set(new TextEncoder().encode("IDAT"), 12); // IHDR must come first
    expect(ok(badPng)).toEqual({ ok: false, reason: "corrupt" });

    const badLength = png(10, 10);
    badLength[11] = 12; // IHDR length is always 13
    expect(ok(badLength)).toEqual({ ok: false, reason: "corrupt" });

    // An HTML document that starts with a PNG signature is not a PNG.
    const polyglot = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode("<script>alert(1)</script>")]);
    expect(ok(polyglot)).toEqual({ ok: false, reason: "corrupt" });
  });
});

describe("image dimensions", () => {
  test("PNG: the full range of u32 is read as unsigned", () => {
    expect(ok(png(1, 1))).toMatchObject({ ok: true, width: 1, height: 1 });
    expect(ok(png(MAX_IMAGE_SIDE, 1))).toMatchObject({ ok: true, width: MAX_IMAGE_SIDE, height: 1 });
    // 4294967295 would be -1 as a signed 32-bit number and slip under every "too large" test.
    expect(ok(png(0xffffffff, 10))).toEqual({ ok: false, reason: "dimensions_too_large" });
    expect(ok(png(0x80000000, 0x80000000))).toEqual({ ok: false, reason: "dimensions_too_large" });
  });

  test("zero is not a size", () => {
    expect(ok(png(0, 10))).toEqual({ ok: false, reason: "corrupt" });
    expect(ok(png(10, 0))).toEqual({ ok: false, reason: "corrupt" });
    expect(ok(jpeg(0, 10))).toEqual({ ok: false, reason: "corrupt" });
    expect(ok(jpeg(10, 0))).toEqual({ ok: false, reason: "corrupt" });
  });

  // Negative check: remove the limits and the "huge" cases below are accepted.
  test("huge: a side above the limit, or too many pixels, is refused whatever the format", () => {
    expect(ok(png(MAX_IMAGE_SIDE + 1, 10))).toEqual({ ok: false, reason: "dimensions_too_large" });
    expect(ok(jpeg(10, MAX_IMAGE_SIDE + 1))).toEqual({ ok: false, reason: "dimensions_too_large" });
    expect(ok(webp("extended", MAX_IMAGE_SIDE + 1, 10))).toEqual({ ok: false, reason: "dimensions_too_large" });
    expect(ok(webp("extended", 1 << 24, 1 << 24))).toEqual({ ok: false, reason: "dimensions_too_large" });
    // Each side within the limit, the product above it.
    const side = Math.floor(Math.sqrt(MAX_IMAGE_PIXELS)) + 1;
    expect(side).toBeLessThanOrEqual(MAX_IMAGE_SIDE);
    expect(ok(png(side, side))).toEqual({ ok: false, reason: "dimensions_too_large" });
    // At the limit: accepted.
    expect(ok(png(7000, 7142))).toMatchObject({ ok: true });
  });

  test("a file cut short anywhere in its header is refused, never read past its end", () => {
    // `needed`: the first length at which the size fields are all there.
    for (const [name, file, needed] of [
      ["png", png(100, 100), 24],
      ["jpeg", jpeg(100, 100), 29],
      ["webp lossy", webp("lossy", 100, 100), webp("lossy", 100, 100).length],
      ["webp lossless", webp("lossless", 100, 100), webp("lossless", 100, 100).length],
      ["webp extended", webp("extended", 100, 100), webp("extended", 100, 100).length],
    ] as const) {
      for (let length = 0; length < needed; length++) {
        const cut = file.slice(0, length);
        // Either the signature is not recognisable yet, or the header is corrupt. Never a made-up size.
        expect(sniff(cut, cut.length).ok, `${name} cut at ${length}`).toBe(false);
      }
      const enough = file.slice(0, needed);
      expect(sniff(enough, enough.length), `${name} cut at ${needed}`).toMatchObject({ ok: true, width: 100, height: 100 });
    }
  });

  test("WebP: a RIFF size larger than the file means a cut-off download", () => {
    const file = webp("lossy", 100, 100);
    const lying = file.slice();
    lying.set([0xff, 0xff, 0xff, 0x7f], 4);
    expect(sniff(lying, lying.length)).toEqual({ ok: false, reason: "corrupt" });
  });

  test("WebP: an unknown first chunk is not a WebP we can size", () => {
    const file = webp("lossy", 100, 100);
    file.set(new TextEncoder().encode("JUNK"), 12);
    expect(ok(file)).toEqual({ ok: false, reason: "corrupt" });
  });

  test("JPEG: the size is found behind big metadata, up to the window", () => {
    // 3 x 60 kB of EXIF/ICC-like segments before the frame header: past 64 kB, like a phone photo.
    const phone = jpeg(4000, 3000, 180_000);
    expect(phone.length).toBeGreaterThan(65_536);
    expect(ok(phone)).toMatchObject({ ok: true, width: 4000, height: 3000 });
  });

  test("JPEG: a frame header beyond the 1 MiB window is 'unreadable', not guessed", () => {
    const huge = jpeg(4000, 3000, 1_100_000);
    expect(huge.length).toBeGreaterThan(SNIFF_WINDOW);
    expect(ok(huge)).toEqual({ ok: false, reason: "unreadable_size" });
  });

  test("JPEG: a scan or the end of the image before any frame header means there is no size", () => {
    const noFrame = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
    expect(ok(noFrame)).toEqual({ ok: false, reason: "corrupt" });
    const justEnd = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    expect(ok(justEnd)).toEqual({ ok: false, reason: "corrupt" });
  });

  test("JPEG: segment lengths that point outside the file, or below 2, are corrupt", () => {
    expect(ok(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 1, 2, 3]))).toEqual({ ok: false, reason: "corrupt" });
    expect(ok(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 1, 2, 3]))).toEqual({ ok: false, reason: "corrupt" });
  });

  test("JPEG: bounded work on a header made of endless tiny segments", () => {
    const parts: number[] = [0xff, 0xd8];
    for (let i = 0; i < 100_000; i++) parts.push(0xff, 0xfe, 0x00, 0x02); // an empty comment, forever
    const bytes = new Uint8Array(parts);
    const started = performance.now();
    expect(sniff(bytes.slice(0, SNIFF_WINDOW), bytes.length)).toEqual({ ok: false, reason: "corrupt" });
    expect(performance.now() - started).toBeLessThan(50);
  });

  test("an image padded to 25 MB is still identified from its first bytes only", () => {
    const big = padTo(png(2000, 1500), 25_000_000);
    expect(sniff(big.subarray(0, SNIFF_WINDOW), big.length)).toMatchObject({ ok: true, type: "png", width: 2000, height: 1500 });
  });
});

describe("file names and object keys", () => {
  const ID = "0b9d8f7e-1234-4abc-9def-0123456789ab";
  const now = new Date("2026-10-12T08:00:00Z");

  test("the key is uploads/<kind>/<year>/<id>-<slug>.<ext>, and nothing else", () => {
    const key = buildKey({ kind: "team-photo", now, id: ID, slug: slugFromFilename("Foto Ibu Rahmá.JPG"), ext: "jpg" });
    expect(key).toBe(`uploads/team-photo/2026/${ID}-foto-ibu-rahma.jpg`);
    expect(pathForKey(key)).toBe(`/uploads/team-photo/2026/${ID}-foto-ibu-rahma.jpg`);
    expect(KEY_PATTERN.test(key)).toBe(true);
    expect(kindOfKey(key)).toBe("team-photo");
    expect(idOfKey(key)).toBe(ID);
    expect(keyForPath(pathForKey(key))).toBe(key);
  });

  // Negative check: let the raw file name into the key and every case below fails.
  test.each([
    ["../../etc/passwd", "passwd"],
    ["..\\..\\windows\\system32\\evil.png", "evil"],
    ["/absolute/path/file.png", "file"],
    ["a/../../b.png", "b"],
    ["%2e%2e%2fsecret.png", "2e-2e-2fsecret"],
    ["foto\u0000.png.exe", "foto-png"],
    ["foto‮gnp.exe", "foto-gnp"],
    ["   .png", "file"],
    [".png", "file"],
    ["", "file"],
    ["日本語.png", "file"],
    ["emoji 🙂 photo.png", "emoji-photo"],
    ["UPPER Case & symbols!!.png", "upper-case-symbols"],
    ["x".repeat(500) + ".png", "x".repeat(MAX_SLUG_LENGTH)],
    ["kartu--tanda---nama.pdf", "kartu-tanda-nama"],
    ["Café Résumé.pdf", "cafe-resume"],
    ["a.b.c.d.png", "a-b-c-d"],
  ])("the file name %j becomes the slug %j", (name, slug) => {
    expect(slugFromFilename(name)).toBe(slug);
  });

  test("whatever the name, the key stays inside uploads/<kind>/<year>/ and has the one valid shape", () => {
    const nasty = ["../../x.png", "..", "../", "\\\\server\\share\\x.png", "x/../../../etc/passwd", "%00", "\u0000", "a b\tc\nd.png", "😀".repeat(100), "-".repeat(100), "..png", "a".repeat(10_000)];
    for (const name of nasty) {
      for (const kind of uploadKinds) {
        const key = buildKey({ kind, now, id: ID, slug: slugFromFilename(name), ext: "png" });
        expect(KEY_PATTERN.test(key), `${kind} ${JSON.stringify(name).slice(0, 40)}`).toBe(true);
        expect(key.startsWith(`uploads/${kind}/2026/${ID}-`)).toBe(true);
        expect(key.split("/")).toHaveLength(4);
        expect(key).not.toContain("..");
      }
    }
  });

  test("a path that is not exactly ours maps to no key", () => {
    const good = `/uploads/blog-image/2026/${ID}-x.png`;
    expect(keyForPath(good)).toBe(good.slice(1));
    for (const bad of [
      "/blog/images/2025/10/1.png", // the legacy static assets: not ours
      "/files/pitchdeck-sakola-kembara.pdf",
      "/images/team/foto.jpg",
      `/uploads/unknown-kind/2026/${ID}-x.png`,
      `/uploads/blog-image/26/${ID}-x.png`,
      `/uploads/blog-image/2026/${ID}-x.exe`,
      `/uploads/blog-image/2026/${ID.toUpperCase()}-x.png`,
      `/uploads/blog-image/2026/../2026/${ID}-x.png`,
      `/uploads/blog-image/2026/${ID}-x.png/extra`,
      `/uploads/blog-image/2026/${ID}-X.png`,
      `/uploads/blog-image/2026/${ID}-.png`,
      `/uploads/blog-image/2026/${ID}-${"a".repeat(MAX_SLUG_LENGTH + 1)}.png`,
      `//uploads/blog-image/2026/${ID}-x.png`,
      `https://files.example/uploads/blog-image/2026/${ID}-x.png`,
      `uploads/blog-image/2026/${ID}-x.png`,
      `/uploads/blog-image/2026/${ID}-x.png?x=1`,
      "/uploads/",
      "",
    ]) {
      expect(keyForPath(bad), bad).toBeNull();
    }
  });

  test("the key range of a kind holds that kind's keys and no other", () => {
    for (const kind of uploadKinds) {
      const { from, to } = keyRange(kind);
      const inside = `uploads/${kind}/2026/${ID}-x.png`;
      expect(inside >= from && inside < to).toBe(true);
      for (const other of uploadKinds.filter((k) => k !== kind)) {
        const outside = `uploads/${other}/2026/${ID}-x.png`;
        expect(outside >= from && outside < to, `${other} in ${kind}`).toBe(false);
      }
    }
  });
});

describe("the kinds table", () => {
  test("every kind maps to an area and a purpose; the area follows the legacy menus", () => {
    expect(KIND_RULES["team-photo"].area).toBe("konten");
    expect(KIND_RULES.report.area).toBe("konten");
    expect(KIND_RULES["blog-image"].area).toBe("konten");
    expect(KIND_RULES.resource.area).toBe("pendaftaran");
    expect(KIND_RULES["registration-document"].area).toBe("pendaftaran");
    expect([...uploadAreas].sort()).toEqual(["konten", "pendaftaran"]);
    // The row's purpose leads back to the same area, which is what DELETE checks.
    for (const kind of uploadKinds) expect(areaOfPurpose(KIND_RULES[kind].purpose), kind).toBe(KIND_RULES[kind].area);
  });

  test("the limits are the legacy app's: team 5 MB, blog image 5 MB, report 20 MB, resource 25 MB", () => {
    expect(KIND_RULES["team-photo"].maxBytes).toBe(5_000_000);
    expect(KIND_RULES["blog-image"].maxBytes).toBe(5_000_000);
    expect(KIND_RULES.report.maxBytes).toBe(20_000_000);
    expect(KIND_RULES.resource.maxBytes).toBe(25_000_000);
    expect(MAX_UPLOAD_BYTES).toBe(25_000_000);
  });

  test("a kind is accepted only if it is in the table", () => {
    for (const kind of uploadKinds) expect(isUploadKind(kind)).toBe(true);
    for (const bad of ["", "avatar", "TEAM-PHOTO", "team-photo ", "__proto__", "constructor", "toString", null, undefined, 1, {}]) expect(isUploadKind(bad)).toBe(false);
  });
});
