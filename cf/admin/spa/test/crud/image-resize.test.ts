import { afterEach, describe, expect, test, vi } from "vitest";
import { type Bitmap, fit, type ImageCodec, isResizable, MAX_DECODE_BYTES, MAX_SIDE, setImageCodec, shrinkImage, webpName } from "~/lib/crud/image-resize";
import { prepareUpload } from "~/lib/crud/upload-client";

// A picture is made smaller before it is sent. The logic is proved with a codec that says what the browser would: the sizes it
// is asked for, what it gives back, and every way it can fail (the picture is then sent as it is).

const file = (name: string, type: string, size = 3000) => new File([new Uint8Array(size)], name, { type });

/** A codec for a picture of `width` x `height`; what it writes is `written` bytes of `type`. */
function codec(width: number, height: number, written: { size: number; type?: string } | null = { size: 500 }) {
  const closed = vi.fn();
  const sizes: [number, number][] = [];
  const fake: ImageCodec = {
    decode: async () => ({ width, height, close: closed }) satisfies Bitmap,
    encode: async (_bitmap, w, h) => {
      sizes.push([w, h]);
      return written ? new Blob([new Uint8Array(written.size)], { type: written.type ?? "image/webp" }) : null;
    },
  };
  return { fake, sizes, closed };
}

afterEach(() => setImageCodec(undefined));

describe("the size and the name", () => {
  test("the longer side fits 1920 px, the proportions stay, and nothing is made larger", () => {
    expect(MAX_SIDE).toBe(1920);
    expect(fit(4000, 3000)).toEqual({ width: 1920, height: 1440 });
    expect(fit(3000, 4000)).toEqual({ width: 1440, height: 1920 });
    expect(fit(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(fit(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fit(10_000, 1)).toEqual({ width: 1920, height: 1 }); // a sliver keeps a pixel
  });

  test("only PNG, JPEG and WebP are made again: a GIF would lose its motion and a PDF is no picture", () => {
    expect(isResizable({ name: "a.png", type: "image/png" })).toBe(true);
    expect(isResizable({ name: "a.jpg", type: "image/jpeg" })).toBe(true);
    expect(isResizable({ name: "a.webp", type: "image/webp" })).toBe(true);
    expect(isResizable({ name: "a.gif", type: "image/gif" })).toBe(false);
    expect(isResizable({ name: "a.pdf", type: "application/pdf" })).toBe(false);
    expect(isResizable({ name: "IMG_0001.JPG", type: "" })).toBe(true); // no guess from the browser: the extension
    expect(isResizable({ name: "catatan.txt", type: "" })).toBe(false);
  });

  test("the new file is a .webp of the same stem", () => {
    expect(webpName("foto-ibu.jpg")).toBe("foto-ibu.webp");
    expect(webpName("a.b.c.png")).toBe("a.b.c.webp");
    expect(webpName("tanpa-ekstensi")).toBe("tanpa-ekstensi.webp");
    expect(webpName(".png")).toBe("gambar.webp");
  });
});

describe("shrinkImage", () => {
  test("a picture over 1920 px is written again as WebP at the new size, with the new name and type", async () => {
    const { fake, sizes, closed } = codec(4000, 3000);
    setImageCodec(fake);
    const original = file("IMG_0001.JPG", "image/jpeg", 6_000_000);
    const result = await shrinkImage(original);
    expect(result).not.toBe(original);
    expect([result.name, result.type, result.size]).toEqual(["IMG_0001.webp", "image/webp", 500]);
    expect(sizes).toEqual([[1920, 1440]]);
    expect(closed).toHaveBeenCalledOnce(); // the decoded picture is let go
  });

  test("a picture that already fits is written again only when the WebP is the smaller file", async () => {
    setImageCodec(codec(1200, 800, { size: 500 }).fake);
    expect((await shrinkImage(file("a.png", "image/png", 3000))).name).toBe("a.webp");
    setImageCodec(codec(1200, 800, { size: 4000 }).fake);
    const kept = file("b.png", "image/png", 3000);
    expect(await shrinkImage(kept)).toBe(kept); // the WebP would be larger: the file as it is
  });

  test("a WebP that already fits is never written again (that only costs quality), and one that is too large is", async () => {
    const { fake, sizes } = codec(1200, 800, { size: 100 });
    setImageCodec(fake);
    const small = file("a.webp", "image/webp");
    expect(await shrinkImage(small)).toBe(small);
    expect(sizes).toEqual([]);

    setImageCodec(codec(3840, 2160, { size: 100 }).fake);
    expect((await shrinkImage(file("b.webp", "image/webp"))).size).toBe(100);
  });

  test("a GIF and a PDF are sent as they are, and the browser is not asked", async () => {
    const decode = vi.fn();
    setImageCodec({ decode, encode: vi.fn() });
    for (const original of [file("a.gif", "image/gif"), file("a.pdf", "application/pdf")]) expect(await shrinkImage(original)).toBe(original);
    expect(decode).not.toHaveBeenCalled();
  });

  test("whatever goes wrong, the picture is sent as it is: no browser support, a file it cannot read, one it cannot write as WebP", async () => {
    const original = file("a.jpg", "image/jpeg", 4000);

    setImageCodec(null); // no createImageBitmap
    expect(await shrinkImage(original)).toBe(original);

    setImageCodec({ decode: async () => Promise.reject(new Error("not an image")), encode: vi.fn() });
    expect(await shrinkImage(original)).toBe(original);

    setImageCodec(codec(4000, 3000, null).fake); // the canvas gave nothing
    expect(await shrinkImage(original)).toBe(original);

    setImageCodec(codec(4000, 3000, { size: 500, type: "image/png" }).fake); // a browser that cannot write WebP gives a PNG
    expect(await shrinkImage(original)).toBe(original);

    setImageCodec(codec(4000, 3000, { size: 0 }).fake);
    expect(await shrinkImage(original)).toBe(original);

    setImageCodec(codec(0, 0).fake); // a picture with no size
    expect(await shrinkImage(original)).toBe(original);

    const failing = codec(4000, 3000);
    failing.fake.encode = async () => Promise.reject(new Error("canvas"));
    setImageCodec(failing.fake);
    expect(await shrinkImage(original)).toBe(original);
    expect(failing.closed).toHaveBeenCalled(); // and it is still let go
  });

  test("an empty file and a file too large to decode safely are left alone", async () => {
    const decode = vi.fn();
    setImageCodec({ decode, encode: vi.fn() });
    const empty = file("a.png", "image/png", 0);
    expect(await shrinkImage(empty)).toBe(empty);
    const huge = new File([new Uint8Array(1)], "b.png", { type: "image/png" });
    Object.defineProperty(huge, "size", { value: MAX_DECODE_BYTES + 1 });
    expect(await shrinkImage(huge)).toBe(huge);
    expect(decode).not.toHaveBeenCalled();
  });
});

describe("prepareUpload: the limit applies to what is sent", () => {
  test("a 12 MB photo of a team member is refused only if it is still over 5 MB after it was made smaller", async () => {
    setImageCodec(codec(4000, 3000, { size: 300_000 }).fake);
    const big = file("IMG.jpg", "image/jpeg", 12_000_000);
    const accepted = await prepareUpload(big, "team-photo");
    expect(accepted.ok && accepted.file.name).toBe("IMG.webp");

    setImageCodec(null); // no way to make it smaller: the Worker's limit, in its words
    expect(await prepareUpload(big, "team-photo")).toEqual({ ok: false, message: "Ukuran file maksimal 5 MB." });
  });

  test("the empty and type checks come first, so a wrong file is not decoded", async () => {
    const decode = vi.fn();
    setImageCodec({ decode, encode: vi.fn() });
    expect(await prepareUpload(file("a.png", "image/png", 0), "team-photo")).toEqual({ ok: false, message: "File kosong." });
    expect(await prepareUpload(file("a.gif", "image/gif"), "team-photo")).toEqual({ ok: false, message: "Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP." });
    expect(decode).not.toHaveBeenCalled();
  });

  test("a file of the wrong type that is also too large is a type problem: that is what the person can fix", async () => {
    setImageCodec(codec(1, 1).fake);
    expect(await prepareUpload(file("animasi.gif", "image/gif", 12_000_000), "team-photo")).toEqual({ ok: false, message: "Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP." });
  });

  test("a PDF is not touched, and is held to its own limit", async () => {
    setImageCodec(codec(1, 1).fake);
    const pdf = file("laporan.pdf", "application/pdf", 19_000_000);
    expect(await prepareUpload(pdf, "report")).toEqual({ ok: true, file: pdf });
    expect(await prepareUpload(file("besar.pdf", "application/pdf", 20_000_001), "report")).toEqual({ ok: false, message: "Ukuran file maksimal 20 MB." });
  });
});
