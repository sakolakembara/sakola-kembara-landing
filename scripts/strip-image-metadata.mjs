#!/usr/bin/env node
/**
 * Strips the Exif, XMP and IPTC metadata (GPS position included) from the JPEGs of this repository, without
 * decoding or re-encoding them (scripts/lib/strip-jpeg-metadata.mjs). SAKEM-099.
 *
 *   pnpm images:strip-metadata                 every JPEG under public/, rewritten in place when it changes
 *   pnpm images:strip-metadata path/to/dir …   the given files or folders instead
 *   pnpm images:strip-metadata --check         change nothing; exit 1 if a JPEG would change or any image
 *                                              (JPEG, PNG, WebP, ...) still carries GPS metadata
 *
 * The blog importer does this for every image it downloads (scripts/lib/blog-pipeline.mjs). Use this for a
 * photo added to the repository by hand. cf/web/tests/repo-image-metadata.test.ts fails while a file with
 * GPS metadata is in the repository, and points here. Run it again after: a second run changes nothing.
 *
 * Only counts and paths are printed, never metadata values.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findGpsMetadata } from "./lib/image-gps.mjs";
import { isJpeg, stripJpegMetadata } from "./lib/strip-jpeg-metadata.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMAGE_FILE = /\.(jpe?g|jpe|jfif|png|webp|gif|avif|heic|heif|tiff?)$/i;

const args = process.argv.slice(2);
const check = args.includes("--check");
const targets = args.filter((a) => !a.startsWith("--")).map((a) => path.resolve(a));
if (targets.length === 0) targets.push(path.join(ROOT, "public"));

function* walk(target) {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) {
    yield target;
    return;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    yield* walk(path.join(target, entry.name));
  }
}

const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");
let jpegs = 0;
let changed = 0;
let savedBytes = 0;
let withGps = 0;
const failed = [];

for (const target of targets) {
  for (const file of walk(target)) {
    if (!IMAGE_FILE.test(file)) continue;
    const bytes = fs.readFileSync(file);
    let next = bytes;
    if (isJpeg(bytes)) {
      jpegs++;
      try {
        const result = stripJpegMetadata(bytes);
        for (const warning of result.warnings) console.warn(`! ${rel(file)}: ${warning}`);
        for (const kept of result.keptUnknown) console.warn(`! ${rel(file)}: kept ${kept.marker} "${kept.id}" (${kept.bytes} bytes), not a known metadata block`);
        if (result.changed) {
          changed++;
          savedBytes += bytes.length - result.data.length;
          if (!check) {
            next = result.data;
            fs.writeFileSync(file, next);
          }
        }
      } catch (error) {
        failed.push(`${rel(file)}: ${error instanceof Error ? error.message : error}`);
        continue;
      }
    }
    // what is left: the stripped bytes, or in --check mode the file as it is
    if (findGpsMetadata(next).hits.length > 0) {
      withGps++;
      const hint = !isJpeg(bytes) ? "not a JPEG: this tool cannot strip it" : check ? "run without --check to strip it" : "it could not be stripped";
      failed.push(`${rel(file)}: carries GPS metadata (${hint})`);
    }
  }
}

const verb = check ? "would change" : "changed";
console.log(`images:strip-metadata: ${jpegs} JPEGs, ${verb} ${changed} (${(savedBytes / 1024).toFixed(0)} KiB of metadata), ${withGps} file(s) with GPS metadata ${check ? "now" : "left"}`);
for (const line of failed) console.error(`  ${line}`);
process.exit(failed.length > 0 || (check && changed > 0) ? 1 : 0);
