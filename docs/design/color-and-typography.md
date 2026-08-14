# Color & Typography

> **Source of truth:** `app/globals.css` (the `:root` CSS vars + the `@theme inline { ... }` block that publishes them as Tailwind utilities). There is **no `tailwind.config.ts`** in this repo — Tailwind v4 reads tokens from the `@theme` block. Don't introduce new colors or fonts without updating both the CSS and this doc.

## Color system

### Primary — catalina blue (trust + brand)

| Token | Hex | Tailwind class | Use |
| --- | --- | --- | --- |
| `--catalina-blue` / `--primary-blue` | `#122E76` | `bg-catalina-blue` / `bg-primary-blue` / `text-primary-blue` | Primary buttons, link text, focus, eyebrow text on light surfaces, headline emphasis in Hero, gradient start in section heroes |
| `--primary-blue-dark` | `#0D1F52` | `bg-primary-blue-dark` | Hover state for primary buttons |
| `--space-cadet` / `--accent-navy` | `#233656` | `bg-space-cadet` / `bg-accent-navy` | Gradient end on navy backdrops (Activities, CTA, sub-page heroes) |

### Accent — sunglow (energy + emphasis)

| Token | Hex | Tailwind class | Use |
| --- | --- | --- | --- |
| `--sunglow` / `--secondary-yellow` | `#FAD02B` | `bg-secondary-yellow` / `text-secondary-yellow` | Eyebrow dots (always), stat number emphasis, donation button (yellow CTA on navy), highlight text on dark, partner tag (Program detail), button-tier highlight (donation tiers) |

### Accent — may green (hope + growth)

| Token | Hex | Tailwind class | Use |
| --- | --- | --- | --- |
| `--may-green` / `--secondary-green` | `#4BA442` | `bg-secondary-green` / `text-secondary-green` | Volunteer CTA card, bullet dots in program cards, success state on the "Salin No Rekening" button |

### Supporting blues

| Token | Hex | Use |
| --- | --- | --- |
| `--blue-yonder` | `#51799A` | Input border (`.input` class), legacy gray-blue text |
| `--celtic-blue` | `#306FCC` | Input focus border, blog link hover |
| `--light-blue` | `#B4D9DB` | Focus ring (`:focus-visible { outline: 3px solid var(--light-blue) }`) |

### Neutrals

| Token | Hex | Use |
| --- | --- | --- |
| `--white` | `#FFFFFF` | Default background, text on dark, card surfaces |
| `--light-gray` | `#F5F5F5` | Section backgrounds (replaced by Tailwind `gray-50` in practice) |
| `--medium-gray` | `#6B7280` | Body text (replaced by Tailwind `gray-600` in practice) |
| `--dark-gray` | `#374151` | Headings (replaced by Tailwind `gray-900` in practice) |
| `--black` | `#1F2937` | Strong emphasis (replaced by Tailwind `gray-900` in practice) |

In components, you'll mostly see Tailwind defaults (`text-gray-900`, `text-gray-600`, `bg-gray-50`, `bg-gray-100`, `bg-gray-900`) rather than these custom neutrals — that's intentional. Reach for Tailwind defaults first; the custom neutrals exist only to power the `.input` / `.label` / `.card` legacy utility classes in `app/globals.css`.

### Usage rules

- **Primary CTAs** use `bg-primary-blue text-white` + hover `bg-primary-blue-dark`. A `-translate-y-0.5` lift and `shadow-lg shadow-primary-blue/30` on hover is the established treatment (see `Navbar.tsx:45-48`, `HeroSection.tsx:42`).
- **Yellow CTAs** (`bg-secondary-yellow text-gray-900`) are reserved for **donate-from-navy** surfaces — the donation box in `ContactSection`, the QRIS confirmation surface, and the program PitchDeck download. Yellow on light is **not** the default CTA color.
- **Green CTAs** (`bg-secondary-green`) are reserved for **volunteer** CTAs (CTASection card #3).
- **Text on light**: `text-gray-900` (headings), `text-gray-600` / `text-gray-500` (body/muted).
- **Text on dark/navy**: `text-white` (heading), `text-white/90` / `text-white/80` (body), `text-gray-300` / `text-gray-400` (muted).
- **Eyebrow text color is contextual**: `text-primary-blue` on light sections, `text-secondary-yellow` on dark/gradient sections. The eyebrow **dot is always yellow** (`bg-secondary-yellow`).

Don't introduce new color tokens for one-off needs. Reach for the existing scale first; if nothing fits, propose a new token and update `app/globals.css` + this doc together.

## Typography

### Font families

Loaded via `next/font/google` in `app/layout.tsx`. Both expose CSS vars and are bound to Tailwind via `@theme inline`.

| Tailwind binding | Family | Weights | Use |
| --- | --- | --- | --- |
| `font-[var(--font-display)]` / `font-display` | **Lora** (serif) | 400 / 500 / 600 / 700 | **All H1s and big H2s on landing surfaces.** The signature brand voice. |
| `body` default + `font-[var(--font-body)]` / `font-body` | **Plus Jakarta Sans** (sans) | 400 / 500 / 600 / 700 | Everything else — small headings, body, UI |

The default `body { font-family: var(--font-body) }` rule in `app/globals.css` means components don't need to opt into Plus Jakarta Sans. Headlines opt into Lora explicitly via `className="font-[var(--font-display)]"`.

### Global type defaults (from `app/globals.css`)

```css
body {
  font-family: var(--font-body);
  color: var(--dark-gray);
  line-height: 1.6;
  background: var(--white);
}
```

Heading defaults (`h1`–`h5` style block), fluid so a bare heading still behaves on a phone:
- `h1` / `.text-h1` → `clamp(30px, 6vw, 48px)`, 700, line-height 130%
- `h2` / `.text-h2` → `clamp(26px, 5vw, 36px)`, 600, line-height 135%
- `h3` / `.text-h3` → `clamp(20px, 4vw, 28px)`, 600, line-height 140%
- `h4` / `.text-h4` → `clamp(18px, 3vw, 24px)`, 500, line-height 145%
- `h5` / `.text-h5` → `clamp(17px, 2.5vw, 20px)`, 500, line-height 150%
- `.text-display` → `clamp(36px, 8vw, 64px)` Lora, 700, line-height 114%, letter-spacing -0.01em

In practice **components override these with Tailwind utilities**, because Tailwind's type scale gives finer responsive control. Treat the `.text-h*` and `.text-display` classes as fallbacks, not the primary system.

> **These rules must stay inside `@layer base`.** Tailwind v4 gives every
> unlayered rule precedence over every layered one, regardless of
> specificity. While this block sat outside a layer it silently beat the
> utilities: a 390px viewport rendered every `h1` at 48px and every `h3` at
> 28px no matter what the component asked for, which is what made mobile
> headlines swallow the screen. If you add a base element rule here, keep it
> in the layer.

### Heading scale (as used in production)

| Use | Classes |
| --- | --- |
| Sub-page hero H1 | `text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-[var(--font-display)]` |
| Homepage Hero H1 | `text-[28px] sm:text-4xl md:text-5xl lg:text-[56px] font-bold font-[var(--font-display)]` |
| Section H2 (light) | `text-3xl sm:text-4xl md:text-5xl font-[var(--font-display)] text-gray-900` |
| Section H2 (dark) | `text-3xl sm:text-4xl md:text-5xl font-[var(--font-display)] text-white` |
| Card H3 | `text-xl font-bold text-gray-900` |
| Compact H3 (inside metrics / inside maps) | `text-xl sm:text-2xl md:text-3xl font-bold` |
| Big stat number | `text-[26px] sm:text-4xl md:text-5xl font-extrabold` (impact) / `text-4xl sm:text-5xl md:text-6xl font-extrabold` (problem) |
| Hero stat number | `text-[28px] sm:text-4xl font-extrabold` |

Every heading starts a step smaller than its desktop size and steps up at `sm`/`md`. A long headline may drop one more step — the Programs H2 is `text-[26px] sm:text-3xl md:text-[40px]` because its question runs seven words where its siblings run three.

The `font-[var(--font-display)]` is the brand signature for big headings — keep it on all H1s and most H2s. Smaller headings (H3, H4) stay on Plus Jakarta Sans for tightness.

### Body & supporting

| Use | Classes |
| --- | --- |
| Lead paragraph under section H2 | `text-lg text-gray-600 max-w-[600px] mx-auto` |
| Default body | `text-base text-gray-600` |
| Subtle / supporting | `text-sm text-gray-500` |
| Compact meta | `text-xs text-gray-400` / `text-[13px]` |
| Hero subhead | `text-lg text-gray-600 leading-relaxed` |
| Sub-page hero subhead | `text-lg md:text-xl text-white/90` |

### Eyebrow

The eyebrow is **not** a CSS utility class — it's an inline JSX pattern. Use this exact shape:

```tsx
<div className="inline-flex items-center gap-2 text-sm font-semibold text-primary-blue uppercase tracking-wider mb-4">
  <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
  Program Kami
</div>
```

On dark/gradient backgrounds swap `text-primary-blue` for `text-secondary-yellow`. The dot stays yellow.

### Inline emphasis

- **Stat numbers** inside body text use Tailwind's `font-extrabold` and a brand color (`text-primary-blue`, `text-secondary-yellow`).
- The closing line of `ProblemSection` puts the punchline phrase in `text-secondary-yellow` on the dark surface.
- The Hero H1 puts "Pendidikan Tinggi" in `text-primary-blue` to draw the eye.

### Letter spacing & leading

- Body line-height is `1.6` (set globally on `body`).
- Hero H1 uses `leading-tight` (≈ 1.25) to keep the serif from going lanky.
- Section H2s use `leading-tight` or the default `155%` from the global `h2` rule.
- Display class adds `letter-spacing: -0.01em` for the largest serif headings.

### Forms

Form labels and inputs use the `.label` and `.input` classes from `app/globals.css`, but most concrete forms (e.g. `/kontak`) inline Tailwind utilities for finer styling. Either approach is acceptable as long as the result respects:

- Label: `text-sm font-medium text-gray-700 mb-2`
- Input: `w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-blue focus:outline-none`
- Helper text: `text-sm text-gray-500`

> Inputs use `rounded-xl` — **never `rounded-full`** (pill shape is reserved for the yellow dot and avatars).
