# Components & Layout

> **Source of truth:** the component files under `components/` and the utility classes in `app/globals.css`. This doc explains the **visible patterns** that recur across the site so additions stay consistent.

## Layout containers

There is **no `.container-*` utility class** — every section uses inline Tailwind utilities.

The canonical container across the site is:

```
max-w-[1200px] mx-auto px-6
```

Variants:

| Container | Used for |
| --- | --- |
| `max-w-[1200px] mx-auto px-6` | Default for full-width sections (Hero, Activities, Impact, Partners, CTA, News, Footer, Navbar, all sub-page heroes) |
| `max-w-[1000px] mx-auto px-6` | `/donasi` body — narrower for a focused two-card layout |
| `max-w-[900px] mx-auto px-6` | `ProblemSection` — centered narrow column for the 3-card stat row |
| `max-w-[800px] mx-auto px-6` | Blog detail body, blog detail hero, CTA-only blocks |
| `max-w-[600px] mx-auto` | Constrained sub-headlines (max-width on a paragraph) |

When in doubt, use **1200px**.

## Section spacing

No `.section` utility. Each section sets its own padding:

| Pattern | Used by |
| --- | --- |
| `py-24` | Most homepage sections (Problem, Activities, Impact, Partners, ContactSection) |
| `py-16` | Lower-emphasis sections (NewsSection, CTASection on homepage) |
| `pt-40 pb-24` | Homepage Hero — extra top padding because the Navbar is `fixed` and overlaps |
| `pt-32 pb-20` | Sub-page heroes (Donasi, Tim, Kontak, Gabung Siswa, Blog) — same reason |
| `py-12` | Blog list inner sections |
| `py-16 md:py-24` | Mixed sub-page sections |

Horizontal gaps inside grids use `gap-6`, `gap-8`, `gap-12`, or `gap-16` depending on density. Two-column hero rows use `gap-16`; card grids use `gap-6` to `gap-8`.

## Buttons

There are **two button systems** in the codebase. Prefer the second (inline Tailwind) for all new work — it's what every modern page uses.

**No arrows on buttons.** Buttons and text CTAs ("Lihat Detail", "Baca Selengkapnya", "Kembali ke Blog", pagination) carry no arrow or chevron icons. A leading icon that names the action (e.g. `ClipboardList` on *Daftar Sekarang*) is fine. The one exception is an icon-only control where the arrow *is* the button — the testimonial carousel's previous/next — which must keep an `aria-label`.

**"Lihat Detail" is outlined; inside a card it is filled** (SAKEM-027). Both are `h-11` (44px), `px-5`, `rounded-lg`, `text-[15px] font-semibold`:

- Outlined (standalone): `border-[1.5px] border-primary-blue text-primary-blue hover:bg-primary-blue/5`.
- Filled (in a card): `bg-primary-blue text-white`, turning `bg-primary-blue-dark` on the card's `group-hover`. A clickable card is one link, so the button inside is a styled `<span>`, never a second link.

**Header auth button** (`AuthNavButton`, desktop): outlined grey, `h-10` (40px). The mobile menu variant stays ≥44px for touch.

### 1. Legacy `.btn-*` classes (in `app/globals.css`)

```css
.btn          { padding: 16px 24px; border-radius: var(--radius-md); ... }
.btn-primary  { background: var(--catalina-blue); color: white; }
.btn-secondary{ background: transparent; border: 2px solid var(--catalina-blue); }
.btn-accent   { background: var(--sunglow); color: var(--space-cadet); }
```

Used by the `.input` / `.label` companions on form-heavy surfaces. Don't extend this set — use inline utilities instead.

### 2. Inline-utility buttons (the de-facto system)

Primary blue CTA (most common):

```tsx
className="px-6 py-3 text-[15px] font-semibold text-white bg-primary-blue rounded-lg
           hover:bg-primary-blue-dark hover:-translate-y-0.5
           hover:shadow-lg hover:shadow-primary-blue/30 transition-all"
```

Subtle secondary (gray pill, lower emphasis):

```tsx
className="px-6 py-3 text-[15px] font-semibold text-gray-700 bg-gray-100 rounded-lg
           hover:bg-gray-200 hover:text-primary-blue transition-all"
```

Outline (donation page secondary):

```tsx
className="px-6 py-3.5 rounded-xl border-2 border-primary-blue text-primary-blue font-semibold
           hover:bg-primary-blue/5 transition-colors"
```

Yellow CTA on dark surface:

```tsx
className="w-full py-4 bg-secondary-yellow text-gray-900 font-semibold text-base rounded-lg
           hover:bg-amber-400 transition-colors"
```

Big sub-page CTA (used at the bottom of `/tim`, `/gabung-siswa`):

```tsx
className="px-8 py-4 bg-primary-blue text-white font-semibold rounded-xl
           hover:bg-primary-blue-dark transition-colors"
```

**Radius rules**:
- Compact / inline buttons → `rounded-lg` (8px).
- Big / standalone CTAs → `rounded-xl` (12px).
- **Never `rounded-full`** for buttons. (The site is not a pill-button brand.)

**External links** always include `target="_blank" rel="noopener noreferrer"`.

## Eyebrow

Inline JSX pattern — no utility class. Standard shape:

```tsx
<div className="inline-flex items-center gap-2 text-sm font-semibold text-primary-blue uppercase tracking-wider mb-4">
  <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
  Program Kami
</div>
```

On dark/gradient backdrops: swap `text-primary-blue` → `text-secondary-yellow`. Dot stays yellow.

## Cards

### Program card (`ActivitiesSection`)

```
group bg-white rounded-2xl overflow-hidden border border-gray-100 h-full flex flex-col
hover:-translate-y-2 hover:shadow-xl hover:border-transparent transition-all duration-300
```

- Image at top (`h-[200px]`), `program.tag` pill overlaid top-left (`bg-primary-blue text-white px-3 py-1.5 rounded-md text-xs font-semibold`).
- Body padding `p-6`, title `text-xl font-bold`, green-dot bullets (`w-1.5 h-1.5 rounded-full bg-secondary-green`).
- Footer CTA: filled "Lihat Detail" button, full width (see Buttons).

### Stat card (`ProblemSection`)

```
p-8 bg-white/5 rounded-2xl border border-white/10
[hover:bg-white/10 hover:border-secondary-yellow/50 if clickable]
```

Yellow extruded number (`text-5xl md:text-6xl font-extrabold text-secondary-yellow`), gray-300 body.

### Metric card (`ImpactSection`)

Gradient card with per-metric color and a soft radial inside:

```
bg-gradient-to-br {metricColors[color]} rounded-2xl p-8 text-white text-center relative overflow-hidden
```

- `from-primary-blue to-accent-navy` for the "blue" metric
- `from-secondary-yellow to-orange-500` for "yellow"
- `from-secondary-green to-green-700` for "green"
- `from-blue-yonder to-accent-navy` for "dark"

### Donation tier card (`ContactSection` donation box)

Toggle button:

```
p-4 rounded-xl border-2 text-left transition-all
selected: bg-white/25 border-secondary-yellow
default:  bg-white/15 border-transparent hover:bg-white/20
```

### Team / partner / testimonial cards

- Team: `bg-white rounded-2xl p-6 text-center border border-gray-100 hover:-translate-y-1 hover:shadow-lg`.
- Partner: `w-40 h-20 bg-white/10 rounded-xl flex items-center justify-center opacity-70 hover:bg-white/20 hover:opacity-100`.
- Testimonial: `bg-gray-50 rounded-2xl p-8 flex gap-6` (portrait image + quote + author block).

### CTA-row cards (`CTASection`)

Horizontal cards: colored icon tile + content + colored pill button. The 4 buttons use 4 different brand-colored backgrounds (blue, orange, green, yellow) — this is the **one place** where orange and yellow are used as flat button surfaces. Treat it as a sectional exception, not a license to use orange elsewhere.

### Card radius convention

- Small / inline cards: `rounded-xl` (0.75rem).
- Standard content cards: `rounded-2xl` (1rem).
- Hero / focal feature panels (donation box, big CTAs): `rounded-3xl` (1.5rem).

Don't mix radii within a row.

## Navbar

`components/Navbar.tsx`. Built-in patterns:

- `fixed top-0 left-0 right-0 bg-white/95 backdrop-blur-md z-50 border-b border-gray-100`.
- Container `max-w-[1200px] mx-auto px-6 py-4 flex items-center justify-between`.
- Logo as `next/image`, 40px tall.
- Nav links: `text-gray-600 text-[15px] font-medium hover:text-primary-blue transition-colors`.
- CTA: blue `rounded-lg` button with hover lift.
- Mobile: lucide-react `Menu` / `X` toggle, full-width drop panel.

Because the navbar is `fixed`, every page that mounts it adds top padding manually (`pt-32` or `pt-40`).

## Footer

`components/Footer.tsx`:

- `bg-gradient-to-b from-accent-navy to-primary-blue text-white`, container `max-w-[1200px] mx-auto px-6 pt-12 md:pt-16 pb-8 md:pb-10`.
- A 4px `bg-secondary-yellow` hairline sits above the footer so it doesn't read as a slab of dark.
- 4-column grid on `lg:` — `grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]`, the wider first column holding logo + description (stacks to 2 / 1).
- Column headings are `text-secondary-yellow`; body copy and links are `text-white/75` (links `hover:text-white`), not `gray-400` — the old neutral greys failed contrast against the dark surface.
- Logo is the light variant `logo-sakola-kembara-light.png`: same mark as the navbar, wordmark in white. No CSS filter.
- Bottom strip: `border-t border-white/15`, `py-5`, copyright + legal entity name.

## Forms

The site has one real form UI (`/kontak`) and a few placeholder ones. The pattern is:

- Wrapper `<form className="space-y-5">`.
- Label: `block text-sm font-medium text-gray-700 mb-2`.
- Input/textarea/select: `w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-blue focus:outline-none` (+ `resize-none` for textarea).
- Placeholder text is example-style (`email@example.com`), not instruction-style.
- Submit: inline blue button matching the big-CTA pattern (`px-8 py-4 bg-primary-blue text-white font-semibold rounded-xl`), with a leading lucide icon (`Send`).

## Modals

`ProblemSection` is the lone modal in the site. Pattern:

- `<AnimatePresence>` wraps the conditional render.
- Backdrop: `fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-6` (closes on click).
- Panel: `bg-gray-800 rounded-2xl p-8 max-w-lg w-full border border-white/10 shadow-2xl` (stops propagation).
- Enter/exit: `opacity + scale + y`.
- Close button: full-width yellow.

If you need another modal, reuse this shape.

## Grid patterns to reuse

| Pattern | Class skeleton |
| --- | --- |
| Hero two-column | `grid lg:grid-cols-2 gap-16 items-center` |
| Three-card row | `grid md:grid-cols-3 gap-6` (or `gap-8`) |
| Four-card row (metrics) | `grid grid-cols-2 lg:grid-cols-4 gap-6` |
| Two-card pair (Donasi methods, CTAs) | `grid md:grid-cols-2 gap-6` |
| Team grid | `grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6` |
| Blog detail | single-column `max-w-[800px]` |

## Breakpoints

Tailwind defaults. Most layout switches happen at **`md` (768px)** and **`lg` (1024px)**. Sub-page heroes shift display size at `lg:text-6xl`. The Hero gets a unique pixel-size `lg:text-[56px]`.

## Accessibility checklist for new components

- Decorative images: `alt=""`. The big decorative blobs use `aria-hidden`-friendly absolutely-positioned divs, not `<img>`.
- Content images: meaningful Indonesian `alt`.
- Interactive icon-only buttons: `aria-label` (see Navbar hamburger, carousel prev/next).
- Sectioning: every major section uses `<section>`, not `<div>`.
- Lists of bullets use real `<ul>` / `<li>` (already done in Activities).
- Focus rings come from `:focus-visible { outline: 3px solid var(--light-blue); outline-offset: 2px; }` defined globally in `app/globals.css`.
