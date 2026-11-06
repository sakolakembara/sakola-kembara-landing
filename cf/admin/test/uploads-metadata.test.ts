import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";
import { stripJpegMetadata } from "../../../scripts/lib/strip-jpeg-metadata.mjs";
import { prepareUploadBody, stripJpeg, UnreadableUploadError } from "../src/uploads/strip-metadata";
import type { FileType } from "../src/uploads/sniff";
import {
  cat,
  cleanJpeg,
  containsText,
  exifChunk,
  exifSegment,
  GPS_XMP,
  ICC_MARK,
  iccWebpChunk,
  IPTC_NAME,
  MAKE,
  orientationOf,
  PNG_SIGNATURE,
  pngData,
  pngFile,
  pngHeader,
  photo,
  riffWebp,
  textChunk,
  timeChunk,
  vp8l,
  vp8x,
  VP8X_EXIF,
  VP8X_ICC,
  VP8X_XMP,
  withSegmentBeforeEoi,
  xmpChunk,
  xmpWebpChunk,
} from "./uploads-metadata-helpers";
import { signedInCookie, uniqueEmail } from "./helpers";
import { clearBucket, mediaRows, upload, type Uploaded } from "./uploads-helpers";

// SAKEM-101: what reaches the PUBLIC bucket carries no location, device or owner metadata, and nothing else changes.
// The fixtures carry INVENTED metadata (test/uploads-metadata-helpers.ts); every expected file is built clean by the
// helpers, never by running a stripper.

const file = (bytes: Uint8Array, name = "foto") => new File([bytes], name);

async function stored(bytes: Uint8Array, type: FileType) {
  const received = file(bytes);
  const result = await prepareUploadBody(received, type);
  return { ...result, received, bytes: new Uint8Array(await result.body.arrayBuffer()) };
}

const leaks = (bytes: Uint8Array) => [MAKE, "GPSLatitude", IPTC_NAME].filter((value) => containsText(bytes, value));

describe("JPEG", () => {
  test("a phone photo loses its Exif (GPS, device), XMP and IPTC; the colour profile and every other byte stay", async () => {
    const result = await stored(photo({ exif: { make: MAKE, gps: true }, xmp: true, iptc: true, icc: true }), "jpeg");
    expect(result.changed).toBe(true);
    expect(result.bytes).toEqual(photo({ icc: true }));
    expect(result.size).toBe(result.bytes.byteLength);
    expect(leaks(result.bytes)).toEqual([]);
    expect(containsText(result.bytes, ICC_MARK)).toBe(true);
  });

  test("a rotated photo keeps only its Orientation, so it stays upright", async () => {
    const result = await stored(photo({ exif: { orientation: 6, make: MAKE, gps: true } }), "jpeg");
    expect(result.bytes).toEqual(photo({ minimalOrientation: 6 }));
    expect(orientationOf(result.bytes)).toBe(6);
    expect(leaks(result.bytes)).toEqual([]);
  });

  test("a file with nothing to strip is the received Blob, not a copy", async () => {
    const result = await stored(photo({ icc: true }), "jpeg");
    expect(result.changed).toBe(false);
    expect(result.body).toBe(result.received);
    expect(result.size).toBe(result.received.size);
  });

  test("the header-only path gives byte for byte what the shared stripper makes of the whole file", () => {
    for (const dirty of [photo({ exif: { make: MAKE, gps: true } }), photo({ xmp: true, iptc: true, icc: true }), photo({ exif: { orientation: 3, gps: true }, icc: true })]) {
      const fast = stripJpeg(dirty);
      expect(fast.kind).toBe("stripped");
      const parts = fast.kind === "stripped" ? fast.parts : [];
      const joined = cat(...parts.map((part) => (part instanceof Uint8Array ? part : dirty.subarray(part.from, part.to))));
      expect(joined).toEqual(new Uint8Array(stripJpegMetadata(dirty).data));
    }
  });

  test("metadata hidden after the picture data is found too (the whole-file walk)", async () => {
    const result = await stored(withSegmentBeforeEoi(cleanJpeg(), exifSegment({ make: MAKE, gps: true })), "jpeg");
    expect(result.changed).toBe(true);
    expect(leaks(result.bytes)).toEqual([]);
  });

  test("a JPEG whose segments cannot be walked is refused, so nothing unknown is stored", async () => {
    const broken = photo({ exif: { make: MAKE, gps: true } }).slice(0, 30);
    await expect(prepareUploadBody(file(broken), "jpeg")).rejects.toBeInstanceOf(UnreadableUploadError);
  });
});

describe("PNG", () => {
  test("the text, XMP and time chunks go; the header and the picture stay", async () => {
    const result = await stored(pngFile(2, 1, textChunk("Author", IPTC_NAME), xmpChunk(GPS_XMP), timeChunk(), pngData()), "png");
    expect(result.changed).toBe(true);
    expect(result.bytes).toEqual(pngFile(2, 1, pngData()));
    expect(leaks(result.bytes)).toEqual([]);
  });

  test("a clean PNG is stored as received", async () => {
    const result = await stored(pngFile(2, 1, pngData()), "png");
    expect(result.changed).toBe(false);
    expect(result.body).toBe(result.received);
  });

  test("a PNG without its end chunk is refused", async () => {
    await expect(prepareUploadBody(file(cat(PNG_SIGNATURE, pngHeader(2, 1), pngData())), "png")).rejects.toBeInstanceOf(UnreadableUploadError);
  });
});

describe("WebP", () => {
  test("EXIF and XMP chunks go, their VP8X flags are cleared, the colour profile and the picture stay", async () => {
    const dirty = riffWebp(vp8x(VP8X_ICC | VP8X_EXIF | VP8X_XMP, 2, 1), iccWebpChunk(), vp8l(2, 1), exifChunk({ make: MAKE, gps: true }), xmpWebpChunk(GPS_XMP));
    const result = await stored(dirty, "webp");
    expect(result.changed).toBe(true);
    expect(result.bytes).toEqual(riffWebp(vp8x(VP8X_ICC, 2, 1), iccWebpChunk(), vp8l(2, 1)));
    expect(leaks(result.bytes)).toEqual([]);
  });
});

describe("other types", () => {
  test("a PDF and a GIF are stored as received, without being read", async () => {
    for (const type of ["pdf", "gif"] as const) {
      const received = file(Uint8Array.of(1, 2, 3));
      const result = await prepareUploadBody(received, type);
      expect(result.body).toBe(received);
      expect(result.changed).toBe(false);
    }
  });
});

describe("through the upload route", () => {
  beforeEach(clearBucket);

  test("the object in the public bucket has no location, and the media row and the answer give the stored size", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["konten"]);
    const dirty = photo({ exif: { make: MAKE, gps: true }, xmp: true, iptc: true });
    const res = await upload({ cookie, kind: "team-photo", bytes: dirty, filename: "foto.jpg", claimedType: "image/jpeg" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Uploaded;
    const key = body.path.replace(/^\/+/, "");
    const object = await env.UPLOADS.get(key);
    const kept = new Uint8Array(await object!.arrayBuffer());
    expect(kept).toEqual(photo());
    expect(leaks(kept)).toEqual([]);
    expect(body.size).toBe(kept.byteLength);
    expect((await mediaRows()).map((row) => row.size)).toEqual([kept.byteLength]);
  });

  test("an image whose structure cannot be walked is answered like any broken image (422) and nothing is stored", async () => {
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["konten"]);
    const broken = cat(PNG_SIGNATURE, pngHeader(2, 1), pngData());
    const res = await upload({ cookie, kind: "team-photo", bytes: broken, filename: "foto.png", claimedType: "image/png" });
    expect(res.status).toBe(422);
    expect(await mediaRows()).toEqual([]);
  });
});
