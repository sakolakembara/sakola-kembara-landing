# DESIGN.md — Sakola Kembara

The design system for the public site (`sakolakembara.org`): how it should look, read, and behave. Admin and the student portal follow it where it fits.

- **Values live in code.** Color and font tokens are defined in `app/globals.css` (`:root` vars, published to Tailwind by the `@theme inline` block; there is no `tailwind.config.ts`). Fonts load in `app/layout.tsx`. This file explains how to use them; if the two disagree, fix whichever is wrong in the same PR.
- **Voice lives in [`docs/context/tone-of-voice.md`](docs/context/tone-of-voice.md).** Section 9 here covers UI microcopy only.

## Changing the design

- **The Indonesian tone of voice is fixed.** Don't rewrite canonical copy for style.
- **The visual style changes only through a SAKEM ticket** (the refresh started with SAKEM-024), and the PR that changes it updates this file. Outside such a ticket, new work extends what is documented here rather than replacing it.
- Don't add a color, font, radius or motion pattern for a one-off need. Use what exists; if nothing fits, propose a token in a ticket.

---

## 1. Brand

**Warm-but-credible.** Deep catalina blue for trust, sunglow yellow for energy and emphasis, may green for hope and growth, soft greys for friendliness, and real student photography to keep it human.

Four moves define the look:

1. **Lora serif headlines over Plus Jakarta Sans body.** The serif is what makes the site read *foundation*, not *startup*.
2. **Navy gradients** (`from-primary-blue to-accent-navy`) for break sections and every sub-page hero, with sunglow for emphasis on top.
3. **The yellow-dot uppercase eyebrow** above section headings.
4. **Soft rounded geometry**: no sharp corners anywhere.

## 2. Color

| Tailwind token (alias) | Hex | Use |
| --- | --- | --- |
| `primary-blue` (`catalina-blue`) | `#122E76` | Primary buttons, links, eyebrow text on light, headline emphasis, gradient start |
| `primary-blue-dark` | `#0D1F52` | Hover for primary buttons and filled card CTAs |
| `accent-navy` (`space-cadet`) | `#233656` | Gradient end on navy surfaces, modal surface |
| `secondary-yellow` (`sunglow`) | `#FAD02B` | Eyebrow dot (always), figures and emphasis on navy, yellow CTAs on navy |
| `secondary-green` (`may-green`) | `#4BA442` | Bullet dots, volunteer CTA, success states |
| `celtic-blue` | `#306FCC` | Link hover variants |
| `light-blue` | `#B4D9DB` | The global focus ring |
| `blue-yonder` | `#51799A` | Gradient start of the "dark" impact metric card |

**Neutrals are Tailwind's grey scale** (`gray-50` … `gray-900`). The custom neutrals in `globals.css` (`light-gray`, `medium-gray`, `dark-gray`, `black`) only back the body text color and the legacy CSS classes (section 6, Legacy CSS); don't reach for them in components.

**Rules**

- **Primary CTA:** `bg-primary-blue text-white`, hover `bg-primary-blue-dark`.
- **Yellow CTA** (`bg-secondary-yellow text-gray-900`) only on navy surfaces: donation box, PitchDeck download, the modal's "Tutup". Never the default on light.
- **Green CTA** only for volunteering.
- **Orange** appears only in the `CTASection` card buttons. It is a sectional exception, not a palette color.
- **Text on light:** `text-gray-900` headings, `text-gray-600` body, `text-gray-500` muted.
- **Text on navy:** `text-white` headings, `text-white/85`–`/90` body, `text-white/70`–`/75` muted. Not `gray-300`/`gray-400`, which fail contrast on navy.
- **Dark surfaces are the navy family, never neutral charcoal.** `bg-gray-900` is not used as a section background anywhere on the public site.

## 3. Typography

| Role | Family | How |
| --- | --- | --- |
| H1s and big H2s | **Lora** (400–700) | `font-[var(--font-display)]` |
| Everything else | **Plus Jakarta Sans** (400–700) | Default on `body`; nothing to add |

H3/H4 and UI text stay on Plus Jakarta Sans for tightness.

**Base heading rules** (`h1`–`h5`, `.text-display`, `.text-h1`–`.text-h5`) are fluid `clamp()` sizes in `globals.css`, and they **must stay inside `@layer base`**. In Tailwind v4 an unlayered rule beats every utility regardless of specificity; when these sat outside the layer, phones rendered every `h1` at 48px whatever the component asked for. Components set their own sizes with utilities; the base rules are only a fallback.

**Scale in use.** Start a step smaller on phones and step up at `sm`/`md`:

| Use | Classes |
| --- | --- |
| Homepage hero H1 | `font-bold text-[28px] sm:text-4xl md:text-5xl lg:text-[56px] leading-[1.2] md:leading-tight` |
| Section H2 | `text-[26px] sm:text-3xl md:text-4xl` (or `text-[28px]` base). A long H2 may go `md:text-[40px]` with `max-w-[760px] text-balance`, like *Apa saja yang dilalui…* |
| Card H3 | `text-xl font-bold text-gray-900` |
| Big figure on navy | `text-5xl md:text-[56px] font-extrabold text-secondary-yellow` |

**Body.** Default `text-base text-gray-600` (line-height 1.6 from `body`). Lead paragraph: `text-lg`, often `max-w-[600px] mx-auto`. Supporting text: `text-sm text-gray-500`.

**Eyebrow** (inline JSX, no utility class):

```tsx
<div className="inline-flex items-center gap-2 text-sm font-semibold text-primary-blue uppercase tracking-wider mb-4">
  <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
  Program Kami
</div>
```

On navy, swap `text-primary-blue` for `text-secondary-yellow`. The dot is always yellow.

**Emphasis.** One phrase per headline may take a brand color (*Membuka Pintu **Pendidikan Tinggi** untuk Setiap Anak Indonesia* in `text-primary-blue`). On navy, the punchline takes `text-secondary-yellow` (*Kami hadir untuk **mengubah realitas ini.***).

## 4. Layout & spacing

**Containers.** `max-w-[1200px] mx-auto px-6` is the default; when in doubt, use it. Narrower containers exist for focused reading: `1100px` (gabung-siswa documents), `1000px` (`/donasi` body), `800px` (blog article), and `max-w-[600px]` on a lead paragraph.

**Section spacing.** Each section sets its own padding:

- `py-16 md:py-24` — standard sections.
- `py-14 md:py-16` — lighter sections (News, CTA rows).

**Heroes clear the fixed navbar** with the `--hero-top` variable, never a hard-coded `pt-32`/`pt-40`. `.nav-clearance` in `globals.css` sets it to 6.5rem on phones and 8rem from `md`, and taller (11.5rem / 11rem) when the announcement strip is showing (`data-announced` on `<html>`).

- Sub-page hero: `bg-gradient-to-br from-primary-blue to-accent-navy text-white pt-[calc(var(--hero-top,8rem)_+_1.25rem)] md:pt-[calc(var(--hero-top,8rem)_+_2.5rem)] pb-14 md:pb-24`, serif H1.
- Homepage hero: `pt-[var(--hero-top,8rem)] md:pt-40 pb-16 md:pb-24 bg-gradient-to-b from-gray-50 to-white`.

**Grids.** Hero split `grid lg:grid-cols-2 gap-16 items-center` · three cards `grid md:grid-cols-3 gap-6` · two cards `grid md:grid-cols-2 gap-6` · team `grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6`. Most layout switches happen at `md` (768px) and `lg` (1024px).

**Homepage rhythm.** Light and navy alternate. Don't put two dark sections back to back without a break.

| # | Section | Surface |
| --- | --- | --- |
| 1 | Hero | `bg-gradient-to-b from-gray-50 to-white` |
| 2 | Problem ("Mengapa Kami Ada?") | `bg-gradient-to-b from-primary-blue to-accent-navy` |
| 3 | Activities (programs) | `bg-gradient-to-br from-primary-blue to-accent-navy` |
| 4 | Impact | `bg-white` |
| 5 | Partners | `bg-[#F5F7FA]` |
| 6 | CTA | `bg-gradient-to-br from-primary-blue to-accent-navy` |
| 7 | News | `bg-white` |
| — | Footer | `bg-gradient-to-b from-accent-navy to-primary-blue` |

## 5. Shape, depth & decoration

| Element | Radius |
| --- | --- |
| Buttons (compact), inputs' error banners | `rounded-lg` (8px) |
| Big standalone CTAs, inputs, small cards | `rounded-xl` (12px) |
| Standard cards, image panels, map, modal | `rounded-2xl` (16px) |
| Hero photo panel, large feature cards (testimonials, featured blog post, donation box) | `rounded-3xl` (24px) |
| Avatars, eyebrow dot, progress-bar tracks | `rounded-full` |

Never `rounded-full` on a button or input: this is not a pill-button brand. Don't mix radii within a row.

**Shadows** are Tailwind defaults, used sparingly. Hover pattern: small cards `hover:-translate-y-1 hover:shadow-lg`; program cards `hover:-translate-y-2 hover:shadow-xl`.

**Decorative motifs.** Reuse these; don't invent new ornaments.

| Motif | Where |
| --- | --- |
| Soft radial blob | Top-right of the homepage hero |
| Floating photo badges (`rounded-2xl shadow-xl`) overlapping the hero photo | Homepage hero |
| Two soft orbs (`bg-white/10` + `bg-secondary-yellow/20`, `blur-3xl`) | Activities, CTA, program PitchDeck box |
| Low-opacity SVG diamond pattern | Problem section |
| White radial inside metric cards | Impact metrics |
| Pulsing map markers (`.animate-pulse-marker`) | Map |

## 6. Components

### Header (`components/Navbar.tsx`)

- `fixed` white bar (`bg-white/95 backdrop-blur-md border-b border-gray-100`). Container `max-w-[1200px] mx-auto px-6 py-4`.
- From `md`: a `grid-cols-[1fr_auto_1fr]` grid, so the menu sits centred on the page (not in the space the logo and button leave). Logo left (`h-10`), menu centre, auth button right.
- Menu (`navLinks` in `lib/data.ts`): Home · Team · Siswa · Donasi · Laporan · Blog. Kontak lives in the footer. There is no donation button in the header.
- Auth button (`AuthNavButton`): outlined grey, text only, `h-10` (40px) on desktop. *Masuk* when signed out, *Portal* or *Dashboard* once the session resolves. The mobile menu variant stays ≥44px tall.

### Footer (`components/Footer.tsx`)

- Navy gradient under a 4px `bg-secondary-yellow` hairline.
- Four columns from `lg` (`grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]`):
  1. Light logo, mission sentence, location.
  2. *Jelajahi*: `footerLinks` (menu minus Home, plus Kontak).
  3. *Kontak*.
  4. *Social Media*.
- Column headings `text-sm font-bold uppercase tracking-wider text-secondary-yellow`; text and links `text-white/75`, hover `text-white`.

### Buttons

**No arrows on buttons.** Buttons and text CTAs carry no arrow or chevron icons. A leading icon that names the action is fine (`ClipboardList` on *Daftar Sekarang*, `Download` on *Download PitchDeck*). The only exception is an icon-only control where the arrow *is* the button (testimonial carousel prev/next), which keeps an `aria-label`.

| Variant | Classes |
| --- | --- |
| Primary | `px-6 py-3 text-[15px] font-semibold text-white bg-primary-blue rounded-lg hover:bg-primary-blue-dark` (the hero adds `hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary-blue/30`) |
| Big standalone CTA | `px-8 py-4 bg-primary-blue text-white font-semibold rounded-xl hover:bg-primary-blue-dark` |
| Big outlined (pairs with the big CTA, e.g. `/tim`) | `px-8 py-4 border-2 border-primary-blue text-primary-blue font-semibold rounded-xl hover:bg-primary-blue/5` |
| Outlined ("Lihat Detail" outside a card, "Lanjut ke Tahap N") | `h-11 px-5 rounded-lg border-[1.5px] border-primary-blue text-primary-blue text-[15px] font-semibold hover:bg-primary-blue/5` |
| Filled in a card ("Lihat Detail" on program cards) | `h-11 px-5 rounded-lg bg-primary-blue text-white text-[15px] font-semibold group-hover:bg-primary-blue-dark` |
| Outlined on navy | `border-[1.5px] border-white/60 text-white hover:bg-white/10` |
| Yellow on navy | `bg-secondary-yellow text-gray-900 font-semibold rounded-xl hover:bg-secondary-yellow/90` (the PitchDeck button still uses `hover:bg-yellow-400`) |
| Subtle | `px-6 py-3 text-[15px] font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 hover:text-primary-blue` |

- **A clickable card is one link.** The "button" inside it is a styled `<span>`, never a nested link.
- **External links** get `target="_blank" rel="noopener noreferrer"`.

### Cards

- **Program card** (`ActivitiesSection`): `group bg-white rounded-2xl overflow-hidden border border-gray-100 h-full flex flex-col hover:-translate-y-2 hover:shadow-xl`. Photo on top with the phase tag pill (`bg-primary-blue text-white px-3 py-1.5 rounded-md text-xs font-semibold`), title, green-dot bullets, then the filled *Lihat Detail*.
- **Infographic card** (`ProblemSection`): `flex flex-col gap-4 p-6 md:p-7 bg-white/[0.07] rounded-2xl border border-white/15`. From top to bottom:
  - a 124px chart slot;
  - the figure;
  - the sentence in `text-white/85`;
  - an optional full-width outlined-on-navy *Mengapa ini terjadi?* button that opens a modal.

  The charts are drawn from `problemStats[].chart` in `lib/data.ts`:
  - a one-row pictogram;
  - a 100% bar;
  - progress bars.

  Sunglow marks the highlighted part, `white/15`–`/45` the rest. Each chart is `role="img"` with an `aria-label`, and the figure stays plain text.
- **Metric card** (`ImpactSection`): `bg-gradient-to-br … rounded-2xl p-5 sm:p-8 text-white text-center`. The gradient is set per metric:
  - blue → `from-primary-blue to-accent-navy`
  - yellow → `from-secondary-yellow to-orange-500`
  - green → `from-secondary-green to-green-700`
  - dark → `from-blue-yonder to-accent-navy`
- **Team card** (`/tim`): `group text-center bg-white rounded-2xl p-6 border border-gray-100 hover:-translate-y-1 hover:shadow-lg`, with the same lift on `focus-visible` plus `ring-2 ring-primary-blue`. Avatar `w-28 h-28 rounded-full`.
- **Testimonial** (`ImpactSection` carousel, two at a time): `bg-gray-100 rounded-3xl overflow-hidden shadow-lg`, portrait `w-full h-44 sm:w-32 sm:h-40 rounded-xl`.

### Program stage stepper (`/program/[id]`)

A shared navy hero (*Program Kami* + *Apa saja yang dilalui penerima manfaat Sakola Kembara?*, as a display `<p>`) with a white stepper card overlapping its bottom edge (`-mt-20 md:-mt-24 rounded-2xl shadow-xl`). The card is a `<nav aria-label="Tahapan program">` around an `<ol>` of three links: a numbered circle, the phase tag, and (from `sm`) the stage title. Each link goes to that stage's own URL; the active one has `aria-current="page"` and a filled `primary-blue` circle. The page's `<h1>` is the stage title in the intro below.

### Forms

- `<form className="space-y-5">`.
- Label: `block text-sm font-medium text-gray-700 mb-2`.
- Input, textarea, select: `w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-blue focus:outline-none` (add `resize-none` on textareas).
- Placeholders are example-style (`email@example.com`), not instructions.
- Errors: banner `bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700`; per-field `text-xs text-red-600 mt-1`.
- Submit: the big-CTA pattern with a leading icon.

### Modals

Use the native `<dialog>` opened with `showModal()`. The browser supplies the focus trap, Escape to close, and focus return.

- **Trigger:** a real `<button aria-haspopup="dialog">`.
- **Dialog:**
  - Classes: `m-auto w-[calc(100%-2.5rem)] max-w-lg max-h-[calc(100dvh-2.5rem)] overflow-y-auto rounded-2xl border border-white/15 bg-accent-navy p-0 text-white`, plus `backdrop:bg-accent-navy/80 backdrop:backdrop-blur-sm`.
  - Keep `m-auto`: Tailwind's preflight zeroes the margin that native centring relies on.
  - Set `aria-labelledby` to the dialog's heading.
- **Close:**
  - A full-width yellow *Tutup* inside `<form method="dialog">`.
  - A click handler that closes when the click lands on the dialog element itself, which is the backdrop.

### Legacy CSS

`globals.css` still defines `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-accent`, `.card`, `.input`, `.label`, `.text-body*`, `.text-caption` and `.image-placeholder`. No component uses them. Don't start using them; style with utilities.

## 7. Imagery & logo

| Asset | File | Notes |
| --- | --- | --- |
| Logo, light surfaces | `public/images/logo-sakola-kembara.png` (300×103) | Native colors, `h-10 w-auto` |
| Logo, navy surfaces | `public/images/logo-sakola-kembara-light.png` | Same artwork, wordmark recoloured white; the K mark and pinwheel "o" keep their colors. Replace in place if an official light file arrives |
| Favicon & app icons | `app/favicon.ico` (16/32/48), `app/icon.png` (192), `app/apple-icon.png` (180, on white) | K mark only, cropped from the logo. Regenerate all three from a high-res/SVG mark when one exists |
| Share image | `public/og-default.jpg` (1200×630) | Navy gradient, light logo, *Pendidikan Untuk Semua*, a real student photo. Default `og:image` for pages without their own (programs and blog posts use their cover photo) |

- Never recolour the logo with CSS filters. Use the file that matches the surface.
- Keep clear space around the logo, at least the wordmark's cap height.
- Don't place the logo on a busy photo without a solid pad.
- **Photography:** real, candid, warm, color photos of Sakola Kembara students; crops that feature the student. No stock photos of unrelated students, no black-and-white or duotone, no illustration-only sections. Testimonial portraits are vertical `rounded-xl` crops; team avatars are `rounded-full`.

## 8. Motion

Restrained:

- **Scroll reveal:** framer-motion `useInView` + `initial={{ opacity: 0, y: 20–30 }}` → `{ opacity: 1, y: 0 }`, 0.5–0.6s, staggered by index.
- **Hover:** small lifts (`-translate-y-0.5` to `-translate-y-2`) plus shadow growth.
- **Carousel:** `transition-transform duration-500 ease-in-out`.
- **Other:** map markers pulse; anchor links scroll smoothly.

No scroll-jacking, parallax, long reveal sequences, page transitions, or motion libraries other than framer-motion.

**Reduced motion: known gap.** `globals.css` collapses CSS transitions and animations under `prefers-reduced-motion: reduce`, but the framer-motion reveals are JavaScript-driven and still play: nothing uses `MotionConfig reducedMotion="user"` or `useReducedMotion`, despite what the CSS comment says. New motion must respect the setting.

## 9. UI copy

Voice and canonical copy: [`docs/context/tone-of-voice.md`](docs/context/tone-of-voice.md). Formal, warm, credible Indonesian, EYD-correct.

### Headlines

- **H1:** one sentence in Lora, no terminal punctuation.
  - Examples: *Membuka Pintu Pendidikan Tinggi untuk Setiap Anak Indonesia*, *Dukung Perjalanan Mereka*, *Mari Bergerak Bersama*.
- **Section H2:** Lora, 2–6 words, a noun phrase or short statement, no terminal punctuation.
  - Examples: *Pencapaian Sakola Kembara*, *Bersama Mewujudkan Perubahan*, *Jadilah Bagian dari Perubahan*, *Cerita & Inspirasi*.
  - Exceptions: *Mengapa Kami Ada?* and *Apa saja yang dilalui penerima manfaat Sakola Kembara?* end with "?".
- **Card H3:** Plus Jakarta Sans bold, 2–5 words.
  - Examples: *Roadshow & Seleksi*, *Pembelajaran Intensif*, *Alumni & Beasiswa*.

### Eyebrows

2–4 uppercase words: *Pendidikan Untuk Semua · Program Kami · Dampak Kami · Partner Kami · Bergabung Bersama Kami · Tim Kami · Hubungi Kami · Blog*.

### Body text

- Full sentences, 1–3 short paragraphs per section.
- No em-dashes; use commas or sentence breaks.
- *Anda* for donors; *kamu* on student-facing pages (`/gabung-siswa`, portal).

### Buttons

- 2–3 word imperatives, verb + object: *Daftar Sekarang*, *Hubungi Kami*, *Konfirmasi Donasi*, *Salin No Rekening*, *Lihat Detail*.
- Volunteer CTAs use *Menjadi …* / *Gabung …*.
- *Sekarang* is allowed for primary emphasis.
- **Never:** *Klik di sini*, *Yuk*/*Ayo*, *Sign Up*/*Learn More*, or emoji.

### Forms

- Labels: 1–2 words in Title Case (*Nama Lengkap*, *Email*, *Pesan*).
- Errors are factual, not chiding: *Format email belum benar.*

### Numbers and dates

- **Currency:** `Rp50.000`, with no space after Rp and dots as thousands separators. This is display only; form input deliberately takes bare digits (`rupiahSchema`).
- **Dates:** long Indonesian form (*7 Desember 2025*). ISO dates are never shown to users.
- **Figures on navy:** the `%`, `+` or `x` suffix may take `text-secondary-yellow`.

### Tags

Category and phase tags: white on `bg-primary-blue`, `text-xs font-semibold`, `rounded-md`. Blog categories from the WordPress migration stay in English (*News*, *Tips*).

### English

Allowed only in this set: *Home*, *Team*, *Blog*, *Social Media*, and blog category labels. Don't add more English microcopy.

### Footer

The mission sentence (*Yayasan Sakola Kembara berkomitmen untuk memberikan kesempatan pendidikan yang setara kepada seluruh anak Indonesia.*), then the location. The copyright year is computed live.

## 10. Accessibility

- **Focus:** the global `:focus-visible { outline: 3px solid var(--light-blue); outline-offset: 2px }` shows on every interactive element. Inputs replace it with a `border-primary-blue` border on focus. Don't remove focus styles elsewhere.
- **Touch targets:** at least 44px on touch layouts. The 40px header button is desktop-only.
- **Images:** decorative images get `alt=""` and decorative shapes are divs, not `<img>`. Content images get a meaningful Indonesian `alt`.
- **Icon-only buttons** need an `aria-label` (hamburger, carousel prev/next).
- **Charts and infographics:** `role="img"` plus an `aria-label`, with the numbers repeated as text.
- **Semantics:**
  - Use real `<section>`, `<ul>`/`<li>` and `<button>` elements.
  - Use links for navigation, including tab-like navigation between pages (`aria-current="page"`, not an ARIA tablist).
  - Each page has exactly one `<h1>`.
- **Modals** use `<dialog>` (section 6).
- **Text contrast:** at least 4.5:1. On navy, use `white/70` or stronger for text.
