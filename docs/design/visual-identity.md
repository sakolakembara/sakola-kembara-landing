# Visual Identity

> **Hard rule.** The style documented here is the Sakola Kembara brand, and new work must stay coherent with it. The visual refresh (from SAKEM-024) changes it only through tickets, each updating these documents in the same PR.

## Brand feel in one line

**Warm-but-credible.** Deep catalina blue for trust, sunglow yellow for energy and emphasis, may green for hope/growth, soft grays for friendliness, real student photography to keep it human.

## The dominant moves

When you look at the site, four things define the brand:

1. **Lora serif headlines** on **Plus Jakarta Sans body** — most landing pages skip serif. Sakola Kembara doesn't. The serif is what makes the site feel *foundation*, not *startup*.
2. **Navy + sunglow yellow gradients** for major break sections (Activities, CTA, all sub-page heroes). The blue→navy gradient is the signature backdrop.
3. **Yellow-dot uppercase eyebrow** above every section heading — a small `bg-secondary-yellow rounded-full` dot + uppercase tracked label.
4. **Soft rounded geometry everywhere**: `rounded-lg` (8px) for buttons, `rounded-xl` / `rounded-2xl` for cards and image frames, `rounded-3xl` for hero panels and donation boxes. No sharp corners.

## Logo

- File: `public/images/logo-sakola-kembara.png` (300×103 source, rendered at `h-10 w-auto` ≈ 40px tall).
- **Navbar**: used at native colors on white surface.
- **Footer**: `public/images/logo-sakola-kembara-light.png` — the same artwork with the black wordmark recoloured white; the K mark and the pinwheel "o" keep their real colours on navy. (Replaced the old `invert(1) hue-rotate(180deg)` filter, which shifted the mark's colours.) If an official light-variant file arrives, drop it in at the same path.
- **Favicon & app icons** (Next.js file conventions, picked up automatically): the K mark alone, cropped from the logo — `app/favicon.ico` (16/32/48), `app/icon.png` (192), `app/apple-icon.png` (180, on a white tile because iOS shows transparency as black). The source mark is only ~93 px tall, so larger icons wait for a high-res or SVG mark; regenerate all three from it when it arrives.
- **Share image**: `public/og-default.jpg` (1200×630) — navy gradient, light logo, *Pendidikan Untuk Semua*, a real student photo. Used by every page that does not pass its own `ogImage`.

**Do**
- Keep adequate clear space around the logo (at minimum the height of the wordmark cap height).
- Use one of the two asset files — dark wordmark on light surfaces, light wordmark on navy. Don't recolour with CSS filters.

**Don't**
- Place the logo on busy photographic backgrounds without a solid pad.
- Skew, rotate, or add effects.

## Color identity at a glance

| Token | Hex | Where you see it |
| --- | --- | --- |
| `catalina-blue` (= `primary-blue`) | `#122E76` | Buttons, links, headings emphasis, hero gradient start |
| `accent-navy` (= `space-cadet`) | `#233656` | Gradient end on navy backdrops |
| `sunglow` (= `secondary-yellow`) | `#FAD02B` | Eyebrow dots, stat accents, donation button, emphasis text on dark |
| `may-green` (= `secondary-green`) | `#4BA442` | Volunteer CTA, bullet points, success states |
| `celtic-blue` | `#306FCC` | Form focus, link hover variants |
| `light-blue` | `#B4D9DB` | Focus rings |
| `gray-900` | (Tailwind default) | Footer, dark section backgrounds |
| `white` / `gray-50` / `gray-100` | — | Light section backgrounds, card surfaces, hero gradient end |

Full scale and usage rules in [`color-and-typography.md`](color-and-typography.md).

## Decorative motifs

The site uses a small, consistent set of visual decorations. Reuse these rather than inventing new ornaments.

| Motif | Where it's used | Behavior |
| --- | --- | --- |
| **Blue radial blob** (Hero) | Top-right of `HeroSection` | Large soft `bg-[radial-gradient(...)]` circle |
| **Two soft orbs** | `ActivitiesSection`, `CTASection`, `/program/[id]` CTA | `bg-white/10` + `bg-secondary-yellow/20`, `blur-3xl` |
| **SVG diamond pattern** | `ProblemSection` | Low-opacity inline SVG, white-on-dark |
| **White radial inside metric cards** | `ImpactSection` metrics | `bg-[radial-gradient(circle,rgba(255,255,255,0.1)_0%,transparent_70%)]` |
| **Yellow-dot eyebrow** | Every section across the site | `<span className="w-2 h-2 bg-secondary-yellow rounded-full" />` + uppercase text |
| **Floating image badges** | Hero | Two `rounded-2xl shadow-xl` photos overlapping the main hero photo at corners |
| **Map pulse markers** | `GISMap` | Custom Leaflet `divIcon` with CSS `pulse` keyframe |

## Photography style

- Hero and program imagery should be **real student photography** — outdoor, warm-lit, group-oriented when possible.
- Testimonial portraits are vertical `rounded-xl` crops featuring the student.
- Avatars are circular crops (`rounded-full`, ~96px) on the team page.

Current state: most photographs are **Unsplash placeholders** (see `known-gaps.md`). Replace with real org photos as they become available — keep the framing and tone.

**Keep**
- Real, candid, color photography.
- Warm tones; avoid heavy filters or duotone treatments.
- Crops that feature the student, not the environment.

**Avoid**
- Stock photography of unrelated students.
- Black-and-white or high-contrast treatments.
- Illustration-only sections.

## Rounded geometry

Consistent corner rounding is part of the "soft" brand read:

| Element | Radius |
| --- | --- |
| Buttons | `rounded-lg` (0.5rem / 8px) |
| Cards | `rounded-xl` (0.75rem) or `rounded-2xl` (1rem) |
| Section image panels | `rounded-2xl` |
| Hero photo panel | `rounded-3xl` |
| Donation box | `rounded-3xl` |
| Avatars | `rounded-full` |
| Map container | `rounded-2xl` |
| Yellow dot eyebrow | `rounded-full` |

Don't introduce square or sharp-corner UI without a strong reason.

## Shadows

Shadows are used sparingly, mostly via Tailwind defaults (`shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl`, `shadow-2xl`). The `app/globals.css` CSS vars (`--shadow-sm/md/lg`) carry tinted blue shadows for the legacy `.card` class. New components should reach for Tailwind's `shadow-*` utilities first.

The card-hover pattern across the site is:

```
hover:-translate-y-1 hover:shadow-lg     /* small cards */
hover:-translate-y-2 hover:shadow-xl     /* program cards */
hover:shadow-2xl                          /* CTA-card emphasis */
```

## Backgrounds & rhythm

The homepage alternates surfaces to create banding:

- `bg-gradient-to-b from-gray-50 to-white` (Hero)
- `bg-gradient-to-b from-primary-blue to-accent-navy` (Problem — navy break)
- `bg-gradient-to-br from-primary-blue to-accent-navy` (Activities — navy break)
- `bg-white` (Impact)
- `bg-[#F5F7FA]` (Partners — light break before the footer)
- `bg-gradient-to-br from-primary-blue to-accent-navy` (CTA)
- `bg-white` (News)
- `bg-gradient-to-b from-accent-navy to-primary-blue` (Footer)

Maintain alternation. Don't run two dark sections back-to-back without a visual break.

Dark surfaces are the brand navy family, never neutral charcoal. `bg-gray-900` used to carry Problem, Partners, and the footer; it reads cold and gloomy next to a palette built on navy and sunglow, so it is no longer used as a section background anywhere on the public site.

Sub-page heroes consistently use `bg-gradient-to-br from-primary-blue to-accent-navy` with `pt-32 pb-20` and a serif H1.

## Motion

Restraint, but not absent. The established motion is:

- **Scroll-reveal**: every section uses `useInView` + `motion.div` with `initial={{ opacity: 0, y: 20 (or 30) }}` → `{ opacity: 1, y: 0 }`, duration 0.5–0.6s, stagger by index.
- **Hover**: small `-translate-y` lifts (`-translate-y-0.5` / `-translate-y-1` / `-translate-y-2`) + shadow growth.
- **Carousel**: testimonials slide via `transform: translateX(-X%)` with `transition-transform duration-500 ease-in-out`.
- **Map markers**: CSS `pulse` keyframe scales 0.5 → 1.5 + fades over 2s, repeating.
- **Smooth scroll** for anchor links (`scroll-behavior: smooth`).

Do **not** add scroll-jacking, parallax, large reveal sequences, full-page transitions, or any motion library besides framer-motion.
