import { IMAGE_JPEG_QUALITY, IMAGE_MAX_LONG_SIDE_PX } from "../../../../shared/application-form/limits";

// Re-encoding a photo in the browser before it is sent (docs/cloudflare/portal-architecture.md, 8.3 and 8.10). It is a
// service, not a rule the server can enforce (the server accepts whatever passes its checks), and it does two things:
//
//   * it makes the file smaller: a phone photo of 3 to 6 MB becomes about 0.3 to 1 MB (long side at most 2,000 px,
//     JPEG quality 0.85), which saves the student's data plan and the 10 GB of storage;
//   * it DROPS THE EXIF AND GPS DATA of the original: a photo of a house or a child taken with location on says where
//     it was taken. Re-encoding through a canvas carries none of it over. The server cannot do this (a re-encode does
//     not fit the Free plan's 10 ms of CPU), so the browser does it, and a client that skips it can only expose its own
//     data, to the few admins who may open the file.
//
// PDFs and anything that cannot be decoded are sent as they are. The picture is drawn on a white ground first, so a
// transparent PNG does not become a black rectangle. Pure decisions (`fitWithin`, `shouldReencode`) are separate from
// the browser glue (`browserImageCodec`), which takes the codec as an argument so the rest runs under test. The glue
// itself (createImageBitmap, a canvas) needs a real browser and is not exercised by the unit tests.

export const COMPRESSED_TYPE = "image/jpeg";

/** The largest side of a re-encoded image, and the quality: the shared constants, so the wizard and the tests say one thing. */
export const MAX_LONG_SIDE = IMAGE_MAX_LONG_SIDE_PX;
export const JPEG_QUALITY = IMAGE_JPEG_QUALITY;

/** The size an image of `width` x `height` is drawn at: the long side at most `maxLongSide`, the proportions kept, never larger than it was. */
export function fitWithin(width: number, height: number, maxLongSide: number = MAX_LONG_SIDE): { width: number; height: number } {
  const longSide = Math.max(width, height);
  if (longSide <= maxLongSide) return { width, height };
  const scale = maxLongSide / longSide;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Is this something a browser can re-encode as a picture? (PDFs and everything else go as they are.) */
export function shouldReencode(mime: string): boolean {
  return mime === "image/png" || mime === "image/jpeg" || mime === "image/webp";
}

/** What the glue needs from the browser, so the logic around it can be tested with a stand-in. */
export interface ImageCodec {
  /** Decodes the picture upright (the EXIF orientation applied: the pixels are what the person saw). Throws when the browser cannot read it. */
  decode(blob: Blob): Promise<{ width: number; height: number; release(): void; draw(width: number, height: number): Promise<Blob | null> }>;
}

export interface Prepared {
  /** What to send. */
  body: Blob;
  /** True when `body` is a re-encoded copy (so it carries no EXIF or GPS data of the original). */
  reencoded: boolean;
}

/**
 * The file as it should be sent: an image re-encoded as a JPEG at most 2,000 px on its long side, anything else (or
 * anything the browser cannot decode, or a codec that fails) unchanged. Never throws: a photo that cannot be shrunk
 * is still sent, and the server decides.
 */
export async function prepareForUpload(file: Blob & { type: string }, codec: ImageCodec | null = browserImageCodec()): Promise<Prepared> {
  if (!codec || !shouldReencode(file.type.toLowerCase())) return { body: file, reencoded: false };
  try {
    const image = await codec.decode(file);
    try {
      const { width, height } = fitWithin(image.width, image.height);
      const encoded = await image.draw(width, height);
      // An empty or missing result is a failed encode: keep the original.
      return encoded && encoded.size > 0 ? { body: encoded, reencoded: true } : { body: file, reencoded: false };
    } finally {
      image.release();
    }
  } catch {
    return { body: file, reencoded: false };
  }
}

// ─── The browser glue (needs a real browser) ───────────────────────────────

/** The codec of this browser, or null when it cannot decode or draw (an old browser, a test environment): then nothing is re-encoded. */
export function browserImageCodec(): ImageCodec | null {
  if (typeof createImageBitmap !== "function") return null;
  const canDraw = typeof OffscreenCanvas !== "undefined" || (typeof document !== "undefined" && typeof document.createElement === "function");
  if (!canDraw) return null;
  return {
    async decode(blob) {
      // "from-image" applies the EXIF orientation: the re-encoded copy has no EXIF, so the pixels must already be upright.
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return {
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
        draw: async (width, height) => {
          const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
          const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
          if (!context) return null;
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, width, height);
          context.drawImage(bitmap, 0, 0, width, height);
          if (canvas instanceof OffscreenCanvas) return canvas.convertToBlob({ type: COMPRESSED_TYPE, quality: JPEG_QUALITY });
          return new Promise<Blob | null>((resolve) => (canvas as HTMLCanvasElement).toBlob(resolve, COMPRESSED_TYPE, JPEG_QUALITY));
        },
      };
    },
  };
}
