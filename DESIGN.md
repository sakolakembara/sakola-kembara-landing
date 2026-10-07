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

Two layers: brand-named primitives in `:root` (`--catalina-blue`, `--sunglow`, `--may-green`, `--space-cadet`, …) hold the values, and `@theme` publishes them under the names components use. Use only these utility names (SAKEM-031 D1).

| Tailwind token | Hex | Use |
| --- | --- | --- |
| `primary-blue` | `#122E76` | Primary buttons, links, eyebrow text on light, headline emphasis, gradient start |
| `primary-blue-dark` | `#0D1F52` | Hover for primary buttons and filled card CTAs |
| `accent-navy` | `#233656` | Gradient end on navy surfaces, modal surface |
| `secondary-yellow` | `#FAD02B` | Eyebrow dot (always), figures and emphasis on navy, yellow CTAs on navy |
| `secondary-green` | `#4BA442` | Bullet dots, volunteer CTA |
| `blue-yonder` | `#51799A` | Gradient start of the "dark" impact metric card |

CSS-only variables (not utilities): `--light-blue` `#B4D9DB` is the global focus ring; `--celtic-blue` `#306FCC` is the blog link hover.

**Neutrals are Tailwind's grey scale** (`gray-50` … `gray-900`). `black` is remapped to the brand near-black `#1F2937`. A few neutrals stay as plain CSS variables for the blog styles and body text (`--dark-gray`, `--light-gray`, `--medium-gray`); they are not utilities.

**Status colors** (SAKEM-031 D2). Use these for errors, success, warnings and notices instead of raw `red-*`/`green-*`/`amber-*`. Each status has a text color, a subtle background, and a border:

| Status | Text | Background | Border | Based on |
| --- | --- | --- | --- | --- |
| Success | `text-success-fg` | `bg-success-bg` | `border-success-border` | green 700 / 50 / 200 |
| Warning | `text-warning-fg` | `bg-warning-bg` | `border-warning-border` | amber 800 / 50 / 200 |
| Danger | `text-danger-fg` | `bg-danger-bg` | `border-danger-border` | red 700 / 50 / 200 |
| Info | `text-info-fg` | `bg-info-bg` | `border-info-border` | blue 900 / 50 / 200 |

Brand green is too light for text (~3:1 on white), hence the Tailwind scales. Existing components still use raw palette classes; they move to these tokens as they are migrated.

**Rules**

- **Primary CTA:** `bg-primary-blue text-white`, hover `bg-primary-blue-dark`.
- **Yellow CTA** (`bg-secondary-yellow text-gray-900`) only on navy surfaces: donation box, PitchDeck download, the modal's "Tutup". Never the default on light.
- **White CTA on navy** (`bg-white text-primary-blue`, `<Button variant="white-on-navy">`): *Daftar Sekarang* on `/gabung-siswa` and the contact card on `/donasi`.
- **Green CTA** only for volunteering.
- **Orange** appears only in the `CTASection` card buttons. It is a sectional exception, not a palette color.
- **Text on light:** `text-gray-900` headings, `text-gray-600` body, `text-gray-500` muted.
- **Text on navy:** `text-white` headings, `text-white/85`–`/90` body, `text-white/70`–`/75` muted. Not `gray-300`/`gray-400`, which fail contrast on navy.
- **Dark surfaces are the navy family, never neutral charcoal.** `bg-gray-900` is not used as a section background anywhere on the public site.

## 3. Typography

| Role | Family | How |
| --- | --- | --- |
| H1s and big H2s | **Lora** (400–700) | `font-[family-name:var(--font-display)]` |
| Everything else | **Plus Jakarta Sans** (400–700) | Default on `body`; nothing to add |

**Write the Lora class exactly as `font-[family-name:var(--font-display)]`.** The shorter `font-[var(--font-display)]` looks right but Tailwind 4.3 compiles it to `font-weight`, so the heading silently falls back to Plus Jakarta Sans. Every heading on the site rendered that way until SAKEM-035 (2026-10-07).

H3/H4 and UI text stay on Plus Jakarta Sans for tightness.

**Base heading rules** (`h1`–`h5`, `.text-display`, `.text-h1`–`.text-h5`) are fluid `clamp()` sizes in `globals.css`, and they **must stay inside `@layer base`**. In Tailwind v4 an unlayered rule beats every utility regardless of specificity; when these sat outside the layer, phones rendered every `h1` at 48px whatever the component asked for. Components set their own sizes with utilities; the base rules are only a fallback.

**Scale in use.** Start a step smaller on phones and step up at `sm`/`md`:

| Use | Classes |
| --- | --- |
| Homepage hero H1 | `font-bold text-[28px] sm:text-4xl md:text-5xl lg:text-[56px] leading-[1.2] md:leading-tight` |
| Section H2 | `text-[26px] leading-tight sm:text-3xl md:text-4xl` with `max-w-[760px] text-balance` (`<Heading level="section">` / `<SectionHeader>`). Some unmigrated pages still use `text-[28px]` base or `md:text-[40px]` |
| Card H3 | `text-xl font-bold text-gray-900` |
| Big figure on navy | `text-5xl md:text-[56px] font-extrabold text-secondary-yellow` |

**Body.** Default `text-base text-gray-600` (line-height 1.6 from `body`). Lead paragraph: `text-lg`, often `max-w-[600px] mx-auto`. Supporting text: `text-sm text-gray-500`.

**Eyebrow:** `<Eyebrow>` (`tone="dark"` on navy), or `<SectionHeader eyebrow=…>` with the heading. Unmigrated pages still inline it:

```tsx
<div className="inline-flex items-center gap-2 text-sm font-semibold text-primary-blue uppercase tracking-wider mb-4">
  <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
  Program Kami
</div>
```

On navy, swap `text-primary-blue` for `text-secondary-yellow`. The dot is always yellow. In a section header, eyebrow → heading is `mb-4` and heading → lead `mb-5 md:mb-6`.

**Emphasis.** One phrase per headline may take a brand color (*Membuka Pintu **Pendidikan Tinggi** untuk Setiap Anak Indonesia* in `text-primary-blue`). On navy, the punchline takes `text-secondary-yellow` (*Kami hadir untuk **mengubah realitas ini.***).

## 4. Layout & spacing

**Containers.** `max-w-[1200px] mx-auto px-6` is the default; when in doubt, use it. Narrower containers exist for focused reading: `1000px` (`/donasi` body), `800px` (blog article, closing CTAs on `/tim` and `/laporan`), and `max-w-[600px]` on a lead paragraph. `/laporan` and `/gabung-siswa(/docs)` moved from `1100px` to the default 1200 (D4).

**Section spacing.** Each section sets its own padding:

- `py-16 md:py-24` — standard sections.
- `py-14 md:py-16` — lighter sections (News, CTA rows).

**Heroes clear the fixed navbar** with the `--hero-top` variable, never a hard-coded `pt-32`/`pt-40`. `.nav-clearance` in `globals.css` sets it to 6.5rem on phones and 8rem from `md`, and taller (11.5rem / 11rem) when the announcement strip is showing (`data-announced` on `<html>`).

- Sub-page hero: `<PageHero title lead>` (`components/layout/page-hero.tsx`), used by `/tim`, `/laporan`, `/kontak`, `/donasi` and `/blog`. Navy gradient, `pt-[calc(var(--hero-top,8rem)_+_1.25rem)] md:pt-[calc(var(--hero-top,8rem)_+_2.5rem)] pb-14 md:pb-24`, page-level H1, lead `text-base md:text-lg text-white/90 max-w-[600px]`. `/program/[id]`, `/gabung-siswa` and blog articles have their own heroes.
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

### Header (`components/layout/navbar.tsx`)

- `fixed` white bar (`bg-white/95 backdrop-blur-md border-b border-gray-100`). Container `max-w-[1200px] mx-auto px-6 py-4`.
- From `md`: a `grid-cols-[1fr_auto_1fr]` grid, so the menu sits centred on the page (not in the space the logo and button leave). Logo left (`h-10`), menu centre, auth button right.
- Menu (`navLinks` in `lib/data.ts`): Home · Team · Siswa · Donasi · Laporan · Blog. Kontak lives in the footer. There is no donation button in the header.
- Auth button (`AuthNavButton`, `components/layout/auth-nav-button.tsx`): `<Button variant="neutral">`, text only, `sm` (40px) on desktop and `md` (44px) in the mobile menu. *Masuk* when signed out, *Portal* or *Dashboard* once the session resolves.

### Footer (`components/layout/footer.tsx`)

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
| Primary | `px-6 py-3 text-[15px] font-semibold text-white bg-primary-blue rounded-lg hover:bg-primary-blue-dark` on unmigrated pages; `<Button>` (`h-11 px-5`) on migrated ones. The homepage hero adds `transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary-blue/30` |
| Big standalone CTA | `px-8 py-4 bg-primary-blue text-white font-semibold rounded-xl hover:bg-primary-blue-dark` (`<Button size="lg">`) |
| Big outlined (pairs with the big CTA, e.g. `/tim`) | `px-8 py-4 border-2 border-primary-blue text-primary-blue font-semibold rounded-xl hover:bg-primary-blue/5`; `<Button variant="outline" size="lg">` on migrated pages, with the 1.5px border of every outlined button |
| Outlined ("Lihat Detail" outside a card, "Lanjut ke Tahap N") | `h-11 px-5 rounded-lg border-[1.5px] border-primary-blue text-primary-blue text-[15px] font-semibold hover:bg-primary-blue/5` |
| Filled in a card ("Lihat Detail" on program cards) | `h-11 px-5 rounded-lg bg-primary-blue text-white text-[15px] font-semibold group-hover:bg-primary-blue-dark` |
| Outlined on navy | `border-[1.5px] border-white/60 text-white hover:bg-white/10` |
| White on navy | `bg-white text-primary-blue hover:bg-gray-50` (`<Button variant="white-on-navy">`) |
| Yellow on navy | `bg-secondary-yellow text-gray-900 font-semibold rounded-xl hover:bg-secondary-yellow/90` (`<Button variant="yellow-on-navy">`; *Download PitchDeck* is `size="lg"`) |
| Subtle | `px-6 py-3 text-[15px] font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 hover:text-primary-blue` |

- **A clickable card is one link.** The "button" inside it is a styled `<span>`, never a nested link.
- **External links** get `target="_blank" rel="noopener noreferrer"`.

### Cards

- **Program card** (`ActivitiesSection`): `group bg-white rounded-2xl overflow-hidden border border-gray-100 h-full flex flex-col hover:-translate-y-2 hover:shadow-xl`. Photo on top with the phase `<Tag>` pill, title, green-dot bullets, then the filled *Lihat Detail*.
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

A shared navy hero (`<SectionHeader tone="dark" as="p">`: *Program Kami* + *Apa saja yang dilalui penerima manfaat Sakola Kembara?*, the same header as the homepage's Activities section) with a white stepper card overlapping its bottom edge (`-mt-20 md:-mt-24 rounded-2xl shadow-xl`). The card is a `<nav aria-label="Tahapan program">` around an `<ol>` of three links: a numbered circle, the phase tag, and (from `sm`) the stage title. Each link goes to that stage's own URL; the active one has `aria-current="page"` and a filled `primary-blue` circle. The page's `<h1>` is the stage title in the intro below, at the `article` heading level, under a `<Tag>` *Tahap N · tag*. Section titles (*Kegiatan*, *Timeline Kegiatan*, *Galeri Foto*) use `SectionHeader`; activity hours are a soft `<Tag>`; PDF attachments are outlined `Button`s.

### Forms

Build forms from `components/ui/field.tsx` and `alert.tsx` (SAKEM-042):

- `<form className="space-y-5">`.
- `<Field id label required hint error labelAside>` wraps one control: label `block text-sm font-medium text-gray-700 mb-2`, required asterisk in `text-danger-fg` (hidden from screen readers; the control keeps its own `required`), then a hint (`text-xs text-gray-500 mt-1.5`) or an error (`text-xs text-danger-fg mt-1.5`). It gives the control its id, `aria-describedby` and `aria-invalid`.
- `<Input>`, `<Textarea>`, `<Select>`: `w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-blue focus:outline-none`, 16px text (smaller text makes iOS zoom in on focus). Textareas don't resize unless given `resize-y`; selects are white.
- Placeholders are example-style (`email@example.com`), not instructions.
- Banners: `<Alert tone>` (`danger` by default, `success`, `warning`, `info`) in the status colors, `rounded-lg px-4 py-3 text-sm`. Errors use `role="alert"`, the rest `role="status"`.
- Submit: `<Button type="submit" size="lg">`, with a leading icon where one names the action. In the narrow auth cards it is `fullWidth`.

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

**Reduced motion is handled in two places:**

- `<MotionProvider>` (`components/MotionProvider.tsx`, mounted in `app/layout.tsx`) wraps the app in `MotionConfig reducedMotion="user"`. Every framer-motion animation then skips transforms and layout animation when the OS asks for less motion; opacity fades still run.
- The blanket `prefers-reduced-motion` rule in `globals.css` collapses CSS transitions and animations.

New motion gets both for free. Don't bypass them with `reducedMotion="never"` or hand-rolled JS animation.

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

Category and phase tags: `<Tag>`, white on `bg-primary-blue`, `text-xs font-semibold`, `rounded-full` (SAKEM-031 D5). Program/phase tags outside the homepage are still `rounded-md` until their pages are migrated. Blog categories from the WordPress migration stay in English (*News*, *Tips*).

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

## 11. Atomic design system (in progress)

The site is moving from copy-pasted utility strings to shared components, one small ticket and PR at a time (plan agreed in SAKEM-031). Until a page is migrated, its current classes stay as documented above.

**Structure** (D10):
- `components/ui/`: atoms and molecules (`Button`, `Eyebrow`, `Heading`, `Tag`, `Container`, `SectionHeader`, `Card`, form fields).
- `components/layout/`: structural organisms (`Navbar`, `Footer`, `PageHero`).
- `components/sections/`: page organisms, as today.
- `app/`: templates (layouts) and pages.

Make a pattern a component once it is used three or more times. One-offs stay inline.

**Catalog** (D9): `/design` renders every component. It only works when `DESIGN_CATALOG=1` (set on previews); otherwise it is a 404, and it is `noindex`. When you add or change a component, add it to the catalog.

**Class merging** (D8): variants are written with `class-variance-authority`. `cn()` in `lib/cn.ts` (built on `tailwind-merge`) joins classes so that a caller's `className` overrides a conflicting default. Keep overrides to layout (margin, width, position); a different look means a new variant, not an override.

**Display font.** Use `<Heading>`, or write the class as `font-[family-name:var(--font-display)]`. Without the `family-name:` hint, Tailwind 4.3 reads it as a font weight (see section 3).

**Components available** (`components/ui/`, SAKEM-034):

| Component | Level | Use |
| --- | --- | --- |
| `Button` | atom | `variant`: `primary` · `outline` · `outline-on-navy` · `yellow-on-navy` · `white-on-navy` · `subtle` · `neutral`. `size`: `sm` (40px, desktop header only) · `md` (44px, default) · `lg` (big CTA). `fullWidth`. With `href` it renders a link: `next/link` for app routes, new tab for external URLs, plain `<a>` for files (any path ending in an extension, e.g. `/reports/….pdf`), mail/tel and downloads (`linkKind`) |
| `buttonVariants` | style | The same classes for a CTA inside a card that is already one link: `<span className={buttonVariants({ fullWidth: true, className: "group-hover:bg-primary-blue-dark" })}>` |
| `Eyebrow` | atom | `tone`: `light` (blue text) · `dark` (yellow text, for navy) |
| `Heading` | atom | `level`: `display` · `page` · `article` · `section` · `subsection` · `panel` · `card` (D3 scale). Sets the default element (h1/h2/h3); `as` overrides it. Color is up to the caller |
| `Tag` | atom | `tone`: `brand` · `soft`; `size`: `sm` · `md`. Always `rounded-full` |
| `Container` | atom | `size`: `page` (1200) · `focused` (1000) · `reading` (800); `as` for the element |
| `SectionHeader` | molecule | `eyebrow`, `title`, `lead`, `tone` (`light`/`dark`), `align` (`center`/`left`), `as` |
| `PageHero` | organism (`components/layout/`) | `title`, `lead`. The navy hero that opens a sub-page; the title is the page's H1 (`page` level) |
| `Navbar` · `Footer` | organisms (`components/layout/`) | Site header (with `AnnouncementStrip` and `AuthNavButton`) and footer, mounted by `app/(public)/layout.tsx` |
| `SocialLinks` | molecule | `theme`: `dark` (navy) · `light`. The four social profiles as round icon links |
| `Field` | molecule | `id`, `label`, `required`, `hint`, `error`, `labelAside`. Label + control + hint/error, with the aria wiring (see Forms) |
| `Input` · `Textarea` · `Select` | atoms | The form controls; inside a `Field` they are labelled automatically |
| `Alert` | atom | `tone`: `danger` · `success` · `warning` · `info`. Message banner in the status colors |

**Migrated so far:** homepage (SAKEM-036): all seven sections use `Container`, `SectionHeader`/`Heading`, `Button`/`buttonVariants` and `Tag`. Exceptions kept inline: the `CTASection` card buttons (per-role colors), the Impact sub-headings (*Peta Penyebaran*, *Cerita Sukses Alumni*, not on the D3 scale yet) and the carousel's icon-only controls.

Sub-pages (SAKEM-037): `/tim`, `/laporan`, `/kontak`, `/donasi`, plus the `/blog` hero, use `PageHero`. Headings follow D3: team categories, report years and the `/laporan` closing heading are `subsection`; *Cara Berdonasi* and the `/kontak` column titles are `panel`. Kept inline: the colored report-category pills and the contact form (phase 4). The light *Hubungi Kami* on the navy `/donasi` card became `white-on-navy` in SAKEM-040.

Program pages (SAKEM-038): `/program/[id]` uses `Container`, `SectionHeader`, `Heading`, `Tag` and `Button` throughout; the stepper card stays custom.

Blog (SAKEM-039): `/blog` and `/blog/[id]` use `Container` (articles `reading`), `Tag` for every category label, `Heading level="article"` for the article H1 and `panel` for the featured post's title. Kept inline: the small uppercase section labels (*Artikel Terbaru*, *Semua Artikel*, *Artikel Lainnya*), the pagination control, the `text-lg` card titles (also on `/laporan`; D3 says `text-xl`, not applied yet) and the markdown body (`.blog-content`).

Gabung Siswa (SAKEM-040): `/gabung-siswa` and `/gabung-siswa/docs` use `Container`, `Heading` (`page` H1s, `subsection` category titles), `SectionHeader` and `Button`; both *Daftar Sekarang* buttons are `white-on-navy`. The heroes stay custom (recruitment chip, CTAs, back link). Kept inline: the recruitment chip, the docs table-of-contents chips and the small *Salin* button (its copied state uses the `success` tokens).

Layout (SAKEM-041): `Navbar`, `Footer`, `AuthNavButton` and `AnnouncementStrip` live in `components/layout/` and use `Container`; `SocialLinks` is a molecule in `components/ui/`. Kept as they are: the nav links, the footer column labels, the announcement strip's per-severity colors and its pill CTA (an exception to "no pill buttons", admin-configured), and the 36px social icons.

Forms (SAKEM-042): the `/kontak` form and the auth forms (`/login`, `/register`, `/forgot-password`, `/reset-password`) use `Field`, `Input`/`Select`/`Textarea`, `Alert` and `Button`; the auth cards move from their compact 40px, 14px fields to the standard 48px, 16px ones, and the black *Masuk* button becomes primary. The Google sign-in button is a `neutral` lg `Button`. The student registration wizard (`/portal/daftar`) is next (phase 4b).

**Standards decided, applied as each page is migrated:**

| Decision | Standard | Visible change when applied |
| --- | --- | --- |
| D3 Headings | Page H1 `text-3xl sm:text-4xl md:text-5xl lg:text-6xl` (article H1 `text-3xl md:text-4xl lg:text-5xl`). Section H2 `text-[26px] sm:text-3xl md:text-4xl`. Sub-section H2 `text-2xl md:text-3xl`. Card titles stay sans `text-xl`, panel titles sans `text-2xl` | Impact and Partners H2 shrink from `md:text-5xl` |
| D4 Containers | Containers `1200` (default) / `1000` (focused two-column) / `800` (reading). Text measures `760` (long headline) / `600` (lead) | `1100` pages widen to 1200; 820/720/700 move to 800 or 760 |
| D5 Tags | `rounded-full` | Program/phase tags become pills |
| D6 Yellow button hover | `hover:bg-secondary-yellow/90` | PitchDeck hover |
| D7 Text CTAs | "Lihat Semua" becomes an outlined button; "Baca Selengkapnya" stays a text link | News section header |
