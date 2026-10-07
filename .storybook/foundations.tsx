import { useEffect, useRef, useState } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading, headingVariants } from "@/components/ui/heading";
import { fontVariables } from "@/lib/fonts";
import designMd from "../DESIGN.md?raw";
import globalsCss from "../app/globals.css?raw";
import tailwindTheme from "tailwindcss/theme.css?raw";

/*
 * The Foundations pages (colors, typography). Every value is read from the
 * source at build time: tokens from app/globals.css, Tailwind's palette from
 * tailwindcss/theme.css, and the "use" of each brand color from the table in
 * DESIGN.md section 2. Nothing here needs updating when a token changes.
 */

/** The `--name: value;` declarations in the block opened by `selector {`. */
function declarations(css: string, selector: string): Record<string, string> {
  const open = css.indexOf(`${selector} {`);
  if (open === -1) return {};
  const body = css.slice(css.indexOf("{", open) + 1, css.indexOf("}", open));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

const root = declarations(globalsCss, ":root");
const theme = declarations(globalsCss, "@theme inline");
const palette: Record<string, string> = Object.fromEntries(
  [...tailwindTheme.matchAll(/--color-([a-z]+-\d+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
);
const brandUse: Record<string, string> = Object.fromEntries(
  [...designMd.matchAll(/^\| `([a-z-]+)` \| `#[0-9A-Fa-f]{6}` \| (.+) \|$/gm)].map(([, token, use]) => [token, use]),
);

/** Follows `var(--x)` through :root and Tailwind's palette to a literal color. */
function resolve(value: string): string {
  const ref = value.match(/^var\(--([\w-]+)\)$/)?.[1];
  if (!ref) return value;
  if (ref in root) return resolve(root[ref]);
  if (ref.startsWith("color-") && ref.slice(6) in palette) return palette[ref.slice(6)];
  return value;
}

/** The name a `var(--…)` points at, e.g. `catalina-blue` or `green-700`. */
function source(value: string): string {
  return value.match(/^var\(--(?:color-)?([\w-]+)\)$/)?.[1] ?? value;
}

/** Hex for a `#rgb`/`#rrggbb` or an `oklch(L% C H)` color (Tailwind's palette). */
function toHex(color: string): string {
  if (color.startsWith("#")) {
    const h = color.slice(1);
    return `#${(h.length === 3 ? [...h].map((c) => c + c).join("") : h).toUpperCase()}`;
  }
  const m = color.match(/oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)/);
  if (!m) return color;
  const [L, C, H] = [Number(m[1]) / 100, Number(m[2]), (Number(m[3]) * Math.PI) / 180];
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  return `#${linear
    .map((x) => {
      const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
      return Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")
    .toUpperCase()}`;
}

/** WCAG contrast ratio of two hex colors. */
function contrast(hexA: string, hexB: string): string {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(hexA), luminance(hexB)].sort((x, y) => y - x);
  return `${((hi + 0.05) / (lo + 0.05)).toFixed(1)}:1`;
}

const WHITE = toHex(resolve(theme["color-white"] ?? "#FFFFFF"));
const NEAR_BLACK = toHex(resolve(theme["color-black"] ?? "#1F2937"));

function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-xs text-gray-700">{children}</code>;
}

/** The brand colors published as Tailwind utilities (`bg-primary-blue`, …). */
export function BrandColors() {
  const tokens = Object.entries(theme).filter(
    ([name, value]) => name.startsWith("color-") && !/-(fg|bg|border)$/.test(name) && !value.includes("--color-"),
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tokens.map(([name, value]) => {
        const token = name.slice("color-".length);
        const hex = toHex(resolve(value));
        return (
          <div key={name} className="overflow-hidden rounded-xl border border-gray-200">
            <div className="h-24" style={{ background: hex }} />
            <div className="space-y-1 p-4">
              <p className="font-semibold text-gray-900">{token}</p>
              <p className="text-sm text-gray-600">
                <Code>{hex}</Code> · from <Code>--{source(value)}</Code>
              </p>
              <p className="text-xs text-gray-500">
                Contrast: white text {contrast(hex, WHITE)} · dark text {contrast(hex, NEAR_BLACK)}
              </p>
              {brandUse[token] && <p className="text-sm text-gray-600">{brandUse[token]}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The status colors (text, background, border), each as a sample banner. */
export function StatusColors() {
  const statuses = ["success", "warning", "danger", "info"];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {statuses.map((status) => {
        const [fg, bg, border] = ["fg", "bg", "border"].map((part) => {
          const value = theme[`color-${status}-${part}`] ?? "";
          return { part, from: source(value), hex: toHex(resolve(value)) };
        });
        return (
          <div key={status} className="space-y-3">
            <div
              className="rounded-lg border px-4 py-3 text-sm"
              style={{ color: fg.hex, background: bg.hex, borderColor: border.hex }}
            >
              <span className="font-semibold">{status[0].toUpperCase() + status.slice(1)}</span>: text {contrast(fg.hex, bg.hex)} on its
              background
            </div>
            <ul className="space-y-1 text-sm text-gray-600">
              {[fg, bg, border].map(({ part, from, hex }) => (
                <li key={part} className="flex items-center gap-2">
                  <span aria-hidden className="h-4 w-4 rounded border border-gray-200" style={{ background: hex }} />
                  <Code>
                    {status}-{part}
                  </Code>
                  <span className="text-xs text-gray-500">
                    {hex} · {from}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** Tailwind's gray scale, the neutrals used for text, borders and light surfaces. */
export function Neutrals() {
  const grays = Object.keys(palette).filter((name) => name.startsWith("gray-"));
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {grays.map((name) => {
        const hex = toHex(palette[name]);
        return (
          <div key={name}>
            <div className="h-14 rounded-lg border border-gray-200" style={{ background: hex }} />
            <p className="mt-1 text-sm font-semibold text-gray-900">{name}</p>
            <p className="text-xs text-gray-500">{hex}</p>
          </div>
        );
      })}
    </div>
  );
}

/** Live font size and line height of the first element inside `ref`, at the current width. */
function useMeasured() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState("");
  useEffect(() => {
    const el = ref.current?.firstElementChild;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      setSize(`${parseFloat(style.fontSize)}px / ${parseFloat(style.lineHeight) || "normal"}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

const FAMILIES = [
  { name: "Lora", variable: "--font-display", use: "H1s and big H2s (the first five heading levels)" },
  { name: "Plus Jakarta Sans", variable: "--font-body", use: "Everything else: body, UI, card and panel titles" },
];

/** The two families with their weights. */
export function FontFamilies() {
  return (
    <div className={`${fontVariables} grid gap-4 md:grid-cols-2`}>
      {FAMILIES.map(({ name, variable, use }) => (
        <div key={name} className="rounded-xl border border-gray-200 p-6" style={{ fontFamily: `var(${variable})` }}>
          <p className="text-5xl text-gray-900">Aa</p>
          <p className="mt-2 text-xl font-semibold text-gray-900">{name}</p>
          <p className="text-sm text-gray-600" style={{ fontFamily: "var(--font-body)" }}>
            <Code>var({variable})</Code> · {use}
          </p>
          <div className="mt-4 space-y-1 text-lg text-gray-900">
            {[400, 500, 600, 700].map((weight) => (
              <p key={weight} style={{ fontWeight: weight }}>
                {weight} · Membuka Pintu Pendidikan Tinggi
              </p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const LEVELS = [
  { level: "display", tag: "h1", sample: "Membuka Pintu Pendidikan Tinggi" },
  { level: "page", tag: "h1", sample: "Pahlawan di Balik Sakola Kembara" },
  { level: "article", tag: "h1", sample: "Judul artikel blog yang panjang" },
  { level: "section", tag: "h2", sample: "Pencapaian Sakola Kembara" },
  { level: "subsection", tag: "h2", sample: "Tim Pengurus" },
  { level: "panel", tag: "h3", sample: "Cara Berdonasi" },
  { level: "card", tag: "h3", sample: "Roadshow & Seleksi" },
] as const;

function ScaleRow({ level, tag, sample }: (typeof LEVELS)[number]) {
  const [ref, size] = useMeasured();
  return (
    <div className="border-b border-gray-100 py-5">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
        <span className="font-semibold text-gray-900">{level}</span>
        <span>
          default <Code>&lt;{tag}&gt;</Code>
        </span>
        <span className="text-xs text-gray-500">{size} at this width</span>
      </div>
      <div ref={ref}>
        <Heading level={level} as="p" className="text-gray-900">
          {sample}
        </Heading>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        <Code>{headingVariants({ level })}</Code>
      </p>
    </div>
  );
}

/** The heading scale (SAKEM-031 D3), rendered with `<Heading>` and its classes. */
export function HeadingScale() {
  return (
    <div className={fontVariables}>
      {LEVELS.map((row) => (
        <ScaleRow key={row.level} {...row} />
      ))}
    </div>
  );
}

const TEXT_STYLES = [
  { name: "Body", className: "text-base text-gray-600", sample: "Program bimbingan belajar gratis dan pendampingan intensif untuk siswa dari daerah terpencil." },
  { name: "Lead", className: "text-lg text-gray-600", sample: "Program pembinaan komprehensif dari penjangkauan siswa hingga pendampingan alumni." },
  { name: "Supporting", className: "text-sm text-gray-500", sample: "Diperbarui 7 Oktober 2026" },
  { name: "Form label", className: "text-sm font-medium text-gray-700", sample: "Nama Lengkap" },
  { name: "Hint", className: "text-xs text-gray-500", sample: "Kami hanya menghubungi lewat nomor ini." },
];

function TextRow({ name, className, sample }: (typeof TEXT_STYLES)[number]) {
  const [ref, size] = useMeasured();
  return (
    <div className="border-b border-gray-100 py-4">
      <div className="mb-1 flex flex-wrap items-center gap-x-3 text-sm">
        <span className="font-semibold text-gray-900">{name}</span>
        <Code>{className}</Code>
        <span className="text-xs text-gray-500">{size}</span>
      </div>
      <div ref={ref}>
        <p className={className}>{sample}</p>
      </div>
    </div>
  );
}

/** Body and UI text, plus the eyebrow. */
export function TextStyles() {
  return (
    <div className={fontVariables} style={{ fontFamily: "var(--font-body)" }}>
      {TEXT_STYLES.map((row) => (
        <TextRow key={row.name} {...row} />
      ))}
      <div className="py-4">
        <div className="mb-2 flex flex-wrap items-center gap-x-3 text-sm">
          <span className="font-semibold text-gray-900">Eyebrow</span>
          <Code>&lt;Eyebrow&gt;</Code>
        </div>
        <Eyebrow>Program Kami</Eyebrow>
      </div>
    </div>
  );
}
