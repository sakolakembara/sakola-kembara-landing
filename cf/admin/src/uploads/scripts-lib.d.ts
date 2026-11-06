// Types for the two plain-JavaScript tools of the repository's `scripts/lib/` (SAKEM-099) that the admin
// Worker and its tests import by relative path. They stay where they are, written once: the blog importer,
// `pnpm images:strip-metadata` and the upload API (SAKEM-101) all run THE SAME stripper, so what the repository
// removes from a photo and what the public bucket receives cannot drift apart. A wildcard module name is the
// only form TypeScript accepts for a declaration that has to match a relative path; the pattern is the
// file's own name, so it cannot match anything else.

declare module "*/scripts/lib/strip-jpeg-metadata.mjs" {
  export class JpegFormatError extends Error {}

  export interface RemovedSegment {
    marker: string;
    kind: string;
    bytes: number;
  }

  export interface KeptSegment {
    marker: string;
    id: string;
    bytes: number;
  }

  export interface StripJpegResult {
    /** The input itself (same bytes, same buffer) when nothing had to change. A Node `Buffer`. */
    data: Uint8Array;
    changed: boolean;
    removed: RemovedSegment[];
    /** The Orientation (2 to 8) kept in the minimal Exif block, if any. */
    orientation: number | null;
    keptUnknown: KeptSegment[];
    warnings: string[];
  }

  export function isJpeg(bytes: Uint8Array): boolean;
  /** @throws {JpegFormatError} when the bytes are not a JPEG or its segments cannot be walked */
  export function stripJpegMetadata(input: Uint8Array): StripJpegResult;
}

declare module "*/scripts/lib/image-gps.mjs" {
  /** `hits` is empty when no GPS metadata was found; each entry says what and where, never a value. */
  export function findGpsMetadata(input: Uint8Array): { format: string; hits: string[] };
}
