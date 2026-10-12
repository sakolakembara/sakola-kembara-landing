// Shrinks a PDF without a system tool (no Ghostscript, no qpdf): the big RGB
// JPEG images inside it are re-encoded at the same pixel size with mozjpeg, and
// the file is rewritten with object streams. Nothing is downscaled, no text,
// font, link or page is touched. Used by build-assets for the two deck PDFs
// that are above the 25 MiB Workers Static Assets limit.
//
// Only a DCTDecode (JPEG) image with three components and a stream above
// MIN_STREAM_BYTES is re-encoded, and only when that saves at least MIN_SAVING;
// everything else (Flate images, soft masks, CMYK, small images) is left as is.

import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import sharp from 'sharp';

const MIN_STREAM_BYTES = 500 * 1024;
const MIN_SAVING = 0.15;
const JPEG = { quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' };

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<{ bytes: Uint8Array; replaced: number; pages: number }>}
 */
export async function shrinkPdf(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPageCount();
  let replaced = 0;

  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue;
    if (dict.get(PDFName.of('Filter'))?.toString() !== '/DCTDecode') continue;
    if (obj.contents.length < MIN_STREAM_BYTES) continue;
    if ((await sharp(obj.contents).metadata()).channels !== 3) continue;

    const out = await sharp(obj.contents).jpeg(JPEG).toBuffer();
    if (out.length > obj.contents.length * (1 - MIN_SAVING)) continue;
    // Same dictionary (size, color space, masks, ...), new contents; /Length is rewritten on save.
    doc.context.assign(ref, PDFRawStream.of(dict, out));
    replaced++;
  }

  const shrunk = await doc.save({ useObjectStreams: true });
  const check = await PDFDocument.load(shrunk, { updateMetadata: false });
  if (check.getPageCount() !== pages) throw new Error(`shrinkPdf: page count changed (${pages} -> ${check.getPageCount()})`);
  return { bytes: shrunk, replaced, pages };
}
