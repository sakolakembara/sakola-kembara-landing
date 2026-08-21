/**
 * Regenerates the branded placeholder photos under public/images/.
 *
 * These are stand-ins for real photography. To swap one out, just drop the
 * real photo in at the same path with the same filename — no code change
 * needed. See public/images/README.md for the full inventory.
 *
 * By default this SKIPS any file that already exists, so it can never
 * clobber a real photo that has already been dropped in. Pass --force to
 * regenerate every placeholder (destructive — only for restyling them).
 *
 * Usage: node scripts/generate-image-placeholders.mjs [--force]
 */
import sharp from "sharp";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const FORCE = process.argv.includes("--force");

/** True when the target already exists — i.e. a real asset is in place. */
async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

const BLUE = "#122E76";
const NAVY = "#233656";
const YELLOW = "#FAD02B";

/** @type {{path: string, width: number, height: number, label: string, hint: string}[]} */
const PLACEHOLDERS = [
  {
    path: "public/images/program/prapembinaan.jpg",
    width: 1200,
    height: 800,
    label: "Roadshow & Seleksi",
    hint: "Kartu program di beranda",
  },
  {
    path: "public/images/program/pembinaan.jpg",
    width: 1200,
    height: 800,
    label: "Pembelajaran Intensif",
    hint: "Kartu program di beranda",
  },
  {
    path: "public/images/program/pasca-pembinaan.jpg",
    width: 1200,
    height: 800,
    label: "Alumni & Beasiswa",
    hint: "Kartu program di beranda",
  },
  {
    path: "public/images/testimoni/daffa-najwan.jpg",
    width: 600,
    height: 800,
    label: "Daffa Najwan",
    hint: "Foto testimoni alumni",
  },
  {
    path: "public/images/testimoni/natia-nur-faza.jpg",
    width: 600,
    height: 800,
    label: "Natia Nur Faza",
    hint: "Foto testimoni alumni",
  },
  {
    path: "public/images/testimoni/chintya-dwi-azizah.jpg",
    width: 600,
    height: 800,
    label: "Chintya Dwi Azizah",
    hint: "Foto testimoni alumni",
  },
  {
    path: "public/images/testimoni/syahid-fattahul-ihsan.jpg",
    width: 600,
    height: 800,
    label: "Syahid Fattahul Ihsan",
    hint: "Foto testimoni alumni",
  },
  {
    path: "public/images/testimoni/muhammad-anwar-taufik.jpg",
    width: 600,
    height: 800,
    label: "Muhammad Anwar Taufik",
    hint: "Foto testimoni alumni",
  },
  {
    path: "public/images/testimoni/jesika-marsha-yoanika.jpg",
    width: 600,
    height: 800,
    label: "Jesika Marsha Yoanika",
    hint: "Foto testimoni alumni",
  },
  {
    path: "public/images/testimoni/fathya-sahla-humaira.jpg",
    width: 600,
    height: 800,
    label: "Fathya Sahla Humaira",
    hint: "Foto testimoni alumni",
  },
];

/**
 * Partner logo placeholders. These sit on a white card, so they use a light
 * treatment instead of the dark photo placeholder above.
 * @type {{path: string, label: string}[]}
 */
const LOGO_PLACEHOLDERS = [
  { path: "public/images/partners/itb.png", label: "ITB" },
  { path: "public/images/partners/talents-mapping.png", label: "Talents Mapping" },
  { path: "public/images/partners/zurich-syariah.png", label: "Zurich Syariah" },
  { path: "public/images/partners/rumah-amal-salman.png", label: "Rumah Amal Salman" },
  { path: "public/images/partners/itc.png", label: "ITC" },
  { path: "public/images/partners/salam-setara.png", label: "Salam Setara" },
];

/**
 * Program gallery placeholders. The gallery is read dynamically from
 * public/images/program/galeri/<program-id>/, so these are just numbered
 * files you overwrite or extend — 7.jpg, 8.jpg and so on are picked up with
 * no code change. See lib/gallery.ts.
 * @type {{path: string, width: number, height: number, label: string, hint: string}[]}
 */
const GALLERY_SETS = [
  { id: "prapembinaan", count: 3, hint: "Dokumentasi Roadshow & Seleksi" },
  { id: "pembinaan", count: 6, hint: "Dokumentasi Pembelajaran Intensif" },
  { id: "pasca-pembinaan", count: 3, hint: "Dokumentasi Alumni & Beasiswa" },
];

const GALLERY_PLACEHOLDERS = GALLERY_SETS.flatMap(({ id, count, hint }) =>
  Array.from({ length: count }, (_, i) => ({
    path: `public/images/program/galeri/${id}/${i + 1}.jpg`,
    width: 1200,
    height: 900,
    label: `Galeri ${i + 1}`,
    hint,
  })),
);

const LOGO_WIDTH = 400;
const LOGO_HEIGHT = 200;

/** Escape the few characters that would break the inline SVG. */
const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function svgFor({ width, height, label, hint }) {
  // Scale type off the short edge so portrait and landscape read the same.
  const unit = Math.min(width, height);
  const labelSize = Math.round(unit * 0.075);
  const hintSize = Math.round(unit * 0.042);
  const dimSize = Math.round(unit * 0.038);
  const cy = height / 2;
  const iconR = Math.round(unit * 0.09);

  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${BLUE}"/>
      <stop offset="100%" stop-color="${NAVY}"/>
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity="0.06" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#grid)"/>
  <rect x="12" y="12" width="${width - 24}" height="${height - 24}" rx="16"
        fill="none" stroke="${YELLOW}" stroke-opacity="0.45"
        stroke-width="3" stroke-dasharray="18 12"/>

  <g transform="translate(${width / 2 - iconR}, ${cy - iconR * 3})"
     stroke="${YELLOW}" stroke-opacity="0.75" stroke-width="4" fill="none"
     stroke-linecap="round" stroke-linejoin="round">
    <rect x="0" y="0" width="${iconR * 2}" height="${iconR * 1.55}" rx="${iconR * 0.18}"/>
    <circle cx="${iconR * 0.55}" cy="${iconR * 0.5}" r="${iconR * 0.2}"/>
    <path d="M ${iconR * 0.18} ${iconR * 1.3}
             L ${iconR * 0.8} ${iconR * 0.72}
             L ${iconR * 1.25} ${iconR * 1.1}
             L ${iconR * 1.6} ${iconR * 0.82}
             L ${iconR * 1.82} ${iconR * 1.05}"/>
  </g>

  <text x="50%" y="${cy + labelSize * 0.4}" text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif" font-size="${labelSize}"
        font-weight="700" fill="#ffffff">${esc(label)}</text>
  <text x="50%" y="${cy + labelSize * 0.4 + hintSize * 1.7}" text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif" font-size="${hintSize}"
        fill="#ffffff" fill-opacity="0.72">${esc(hint)}</text>
  <text x="50%" y="${cy + labelSize * 0.4 + hintSize * 1.7 + dimSize * 2.1}"
        text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-size="${dimSize}" letter-spacing="1.5"
        fill="${YELLOW}" fill-opacity="0.85">GANTI FOTO INI &#183; ${width}&#215;${height}</text>
</svg>`);
}

for (const spec of PLACEHOLDERS) {
  const out = join(ROOT, spec.path);
  if (!FORCE && (await exists(out))) {
    console.log(`skip  ${spec.path} (already exists — pass --force to overwrite)`);
    continue;
  }
  await mkdir(dirname(out), { recursive: true });
  const buf = await sharp(svgFor(spec)).jpeg({ quality: 82 }).toBuffer();
  await writeFile(out, buf);
  console.log(`wrote ${spec.path} (${spec.width}x${spec.height}, ${(buf.length / 1024).toFixed(0)} KB)`);
}

/** Wrap a long partner name onto at most two lines so it fits the card. */
function wrapLabel(label, maxChars) {
  const words = label.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 2);
}

function logoSvgFor({ label }) {
  const lines = wrapLabel(label, 16);
  const size = lines.length > 1 ? 34 : 40;
  const startY = LOGO_HEIGHT / 2 + (lines.length > 1 ? -6 : 8);
  const tspans = lines
    .map((line, i) => `<tspan x="50%" dy="${i === 0 ? 0 : size * 1.15}">${esc(line)}</tspan>`)
    .join("");

  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}">
  <rect width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" fill="#F5F7FA"/>
  <rect x="8" y="8" width="${LOGO_WIDTH - 16}" height="${LOGO_HEIGHT - 16}" rx="12"
        fill="#ffffff" stroke="${BLUE}" stroke-opacity="0.28"
        stroke-width="2" stroke-dasharray="10 8"/>
  <text x="50%" y="${startY}" text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif" font-size="${size}"
        font-weight="700" fill="${BLUE}">${tspans}</text>
  <text x="50%" y="${LOGO_HEIGHT - 30}" text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif" font-size="17"
        letter-spacing="2" fill="${NAVY}" fill-opacity="0.45">LOGO PLACEHOLDER</text>
</svg>`);
}

for (const spec of LOGO_PLACEHOLDERS) {
  const out = join(ROOT, spec.path);
  if (!FORCE && (await exists(out))) {
    console.log(`skip  ${spec.path} (already exists — pass --force to overwrite)`);
    continue;
  }
  await mkdir(dirname(out), { recursive: true });
  // PNG, not JPEG — real logos will almost certainly need transparency.
  const buf = await sharp(logoSvgFor(spec)).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(out, buf);
  console.log(`wrote ${spec.path} (${LOGO_WIDTH}x${LOGO_HEIGHT}, ${(buf.length / 1024).toFixed(0)} KB)`);
}

for (const spec of GALLERY_PLACEHOLDERS) {
  const out = join(ROOT, spec.path);
  if (!FORCE && (await exists(out))) {
    console.log(`skip  ${spec.path} (already exists — pass --force to overwrite)`);
    continue;
  }
  await mkdir(dirname(out), { recursive: true });
  const buf = await sharp(svgFor(spec)).jpeg({ quality: 82 }).toBuffer();
  await writeFile(out, buf);
  console.log(`wrote ${spec.path} (${spec.width}x${spec.height}, ${(buf.length / 1024).toFixed(0)} KB)`);
}
