# DESIGN.md — Admin Sakola Kembara

The design of the admin (`admin.sakolakembara.org`, `cf/admin/spa`). It **inherits the public site's [`DESIGN.md`](../../DESIGN.md)** (tokens, type, status colors, focus ring, accessibility, Indonesian copy) and lists only where the admin differs. If a rule is not here, the root file applies.

- **Values live in code.** Color tokens come from `app/globals.css`, imported by `spa/src/styles.css`; the shadcn variables (section 4) are defined in that same file. This file explains how to use them; if the two disagree, fix whichever is wrong in the same PR.
- **The visual style changes only through a SAKEM ticket** (SAKEM-115), and the PR that changes it updates this file.
- The admin is a working tool: **dense, calm, quick to scan**. It uses none of the public site's decoration (orbs, polaroid frames, gradients, heroes, scroll motion).

## 1. Shared with the public site

- **Palette:** `primary-blue` `#122E76`, `primary-blue-dark` `#0D1F52`, `secondary-yellow` `#FAD02B`, the Tailwind grays, the status colors (`success`, `warning`, `danger`, `info`: text, background, border). No new color for a one-off need.
- **Type: one family, Plus Jakarta Sans** (root section 0). Lora is not used in the admin; it stops being shipped with the polish.
- **Focus:** the global 3 px `--light-blue` outline with 2 px offset on every interactive element.
- **Copy:** Indonesian, labels in 1 to 2 words, buttons verb + object (*Tulis Artikel*), factual errors, long dates (*28 Oktober 2026*), blog categories stay in English. No emoji, no *Klik di sini*.
- **Accessibility:** contrast 4.5:1, touch targets 44 px on touch layouts, real `<button>`/`<a>`/`<label>`, icon-only buttons have an `aria-label`, one `<h1>` per page.

## 2. What differs

| Thing | Public site | Admin |
| --- | --- | --- |
| Base text | 16 px | **14 px** (tables, forms, menus); 13 px for hints and counts; 12 px for tags |
| Controls | 48 px inputs, `rounded-xl`, 2 px border | **40 px** (44 px on touch layouts), `rounded-lg`, **1 px** border |
| Cards | `rounded-2xl`, shadow on hover | `rounded-xl`, 1 px `gray-200` border, **no shadow** (shadow only on floating layers: menus, dialogs, toasts) |
| Page | cream bands | `bg-gray-50`, white cards |
| Dark surface | navy bands | **Sidebar `primary-blue-dark`**, never `gray-900` (root section 2: dark surfaces are the navy family) |
| Headings | `clamp()` display sizes | Page H1 `28px / 600 / -0.025em` in `primary-blue-dark`; section H2 `16px / 600`; no eyebrows |
| Motion | GSAP reveals | Only state feedback: 150 to 300 ms transitions, the progress bar, grey loading blocks; all off under `prefers-reduced-motion` |

## 3. Patterns

- **Shell.** Fixed sidebar (248 px) from `md`: brand, grouped menu (group labels `white/70`, sentence case), user block at the bottom. Menu text `white/85`; active item `white/12` with a 3 px `secondary-yellow` bar on its left edge. Every entry has an icon (`lib/nav.ts`, drawn by `NavIcon`). A menu item may carry a count badge (`white/18` pill, 12 px / 700, *99+* above 99) for what waits for someone: *Pendaftar* (waiting) and *Pesan* (unread), read from the dashboard payload and left out at zero; a screen reader hears the number after the entry's name (*Pendaftar, 12 menunggu*). The user block at the foot (avatar, name, role) opens a small panel with the email and *Keluar*: a disclosure, not an ARIA menu; Escape, a press outside or Tab out closes it. Beside the sidebar a white top bar (56 px) with the sidebar toggle, the breadcrumb (*Pendaftaran / Pendaftar*; below an entry, the entry links back to its list) and a *Lihat situs* link that opens a new tab. The toggle (and **Ctrl+B**, ⌘B on a Mac, except while typing in a field) collapses the sidebar to a 72 px icon rail: each entry's name becomes a tooltip and stays in the page for screen readers, a line replaces each group label, and the avatar stands for the user block; the choice is kept in the browser. On phones: a navy top bar with a menu button that opens the same menu, never collapsed, in a drawer.
- **List page.** Breadcrumb, H1, one-line description, the primary action on the right; then a toolbar card (search, filters, *Hapus filter*, result count); then the table card; then pagination. **Filters apply as soon as they are chosen**, with no *Terapkan* button; the search waits for a pause in typing or Enter.
- **Table.** Header row `gray-50`, 13 px / 600 / `gray-600`, sentence case, sticky while the page scrolls (from `md`, and only while the table fits its card: a table wider than the card scrolls sideways inside it, and a sticky header cannot work under a box that scrolls, so then it stays put). A sortable column is a button inside the `<th>` with `aria-sort`. Rows: hover `gray-50`, no zebra, a title with its slug under it, a status tag with a dot. Actions on the right: *Edit*, then *Hapus*, or, for a list whose resource has more to do to a row (the blog: *Terbitkan*, *Jadikan draf*; Pengaturan: *Kirim ulang undangan*, *Aktifkan kembali*, *Nonaktifkan*, with the reason under an item that is off), a "more" button (an `aria-label` naming the row, "Aksi lainnya untuk …") with a panel of ordinary buttons and *Hapus* last, in red. It is a disclosure, not `role="menu"`: Tab walks through it, Escape and a press outside close it. A menu of one thing would only be an extra press, so a list without such operations keeps *Hapus* in the row. On phones a list becomes a stack of cards, not a sideways scroll, with "Urutkan" (a select of the sortable columns, both ways) above them.
- **Selecting rows** (lists of a resource a writer can change). A checkbox column with a select-all in the header (a mixed state when only some are chosen; on a phone the box is in the card's corner and "Pilih semua" is in the bar above the cards); chosen rows get a `bg-primary/5` tint. The bar for them — *N artikel dipilih*, the operations that some chosen row can take (*Terbitkan*, *Jadikan draf*), *Hapus*, *Batal pilih* — is a card that comes **after** the list and sticks to the bottom edge of the page: a bar in front of the table pushed every row down under the pointer the moment the first was ticked. The count is also in the footer and in a live region. A bulk delete asks first, naming the rows, in the native `<dialog>`; each row is its own request with its own version, and the notice says what went through and what did not (a row someone else changed is named and stays ticked; a failure that would hit every row stops the run). Ticks belong to the rows on screen: another page, search, filter or sort starts with none.
- **Table controls.** A *Kolom* menu beside *Hapus filter* in the filter bar (a checkbox per column; the first column cannot be hidden; the choice is kept in this browser per list). Footer: the range ("Menampilkan 1 sampai 20 dari 87 · 2 dipilih"), *Baris per halaman* (10, 20, 50, 100, and the screen's own size; in the address as `pageSize=`, left out when it is the screen's own; shown while the list is longer than 10) and the numbered pages with *Sebelumnya* / *Berikutnya*. Empty result: one centered row, *Tidak ada artikel yang cocok.*
- **Many filters.** Controls stay as they are (a filter applies at once). A bar with three controls or more (the search counts: Pendaftar, Aktivitas) also lists what is set as chips under them (`Status: Draf ×`, `Aksi: Buat artikel ×`): a chip is a button that drops just that filter, with an `aria-label` ("Hapus filter Status: Draf"); *Hapus filter* still clears all. A chip says the option's label, not its value.
- **Empty states.** Not one line of gray text: an icon in a `gray-100` circle, a title, one sentence, and the one action that fixes it. First use: *Belum ada artikel* with *Tulis Artikel* (only for a role that can write). Nothing matches: *Tidak ada artikel yang cocok* with *Hapus filter*.
- **Loading.** The thin top progress bar (yellow, after 200 ms) for any request in flight; five grey pulsing rows in a table; a spinner for the first screen; a status text for screen readers every time (`role="status"`).
- **Feedback.** Toast for a success that needs no decision (*Artikel disimpan.*, `role="status"`, 5 s, may carry one action); `Alert` for what must stay on screen; a native `<dialog>` confirmation for anything destructive.
- **Forms.** Label above the control, hint or error under it, sections as cards, a sticky bar with *Simpan* and *Batal*, the unsaved-changes guard as built. Placeholders are examples, not instructions.
- **Status tags.** `rounded-full`, 12 px / 600, status tokens: *Terbit* success, *Draf* gray, *Menunggu* warning, *Ditolak* danger, *Diundang* info.
- **Dashboard.** Only *Perlu perhatian* and *Tindakan Cepat* (decided in SAKEM-082). Counts in `primary-blue-dark` 34 px / 600; each card ends in a link to the list it counts, and the cards that ask for action carry a status dot (amber waiting, blue in progress). The header shows when the data was read (*Diperbarui 14.32*) with a refresh button, since the page shows its last answer first and confirms it in the background.

## 4. shadcn/ui

shadcn/ui is a **source of components, copied into the repo**, not a runtime dependency; the look is ours, from the tokens above.

- **Where.** `cf/admin/spa/src/components/ui/`, alias `~/components/ui`. The root `components/ui` kit is shared with the legacy Next app and is not edited for the admin; screens move from `@/components/ui/*` to the admin's copies one component at a time. `components.json` sits in `cf/admin`.
- **Variables.** shadcn's CSS variables are defined once in `spa/src/styles.css` and point at our tokens:

| shadcn variable | Token | Hex |
| --- | --- | --- |
| `--background` | `gray-50` | `#F9FAFB` |
| `--foreground` | `gray-900` | `#111827` |
| `--card`, `--popover` | `white` | `#FFFFFF` |
| `--primary` / `--primary-foreground` | `primary-blue` / `white` | `#122E76` / `#FFFFFF` |
| `--secondary`, `--muted` | `gray-100` | `#F3F4F6` |
| `--muted-foreground` | `gray-500` | `#6B7280` |
| `--accent` | `primary-blue` at 7 % | |
| `--border` | `gray-200` | `#E5E7EB` |
| `--input` | `gray-300` | `#D1D5DB` |
| `--ring` | `light-blue` | `#B4D9DB` |
| `--destructive` | `danger-fg` | `#B91C1C` |
| `--radius` | `rounded-lg` | `0.5rem` |
| `--sidebar` / `--sidebar-primary` | `primary-blue-dark` / `secondary-yellow` | `#0D1F52` / `#FAD02B` |

- **Modals stay native.** Root section 6 prescribes `<dialog>` with `showModal()`; the admin keeps `ConfirmDialog` and does not add Radix Dialog.
- **Radix only where the browser has no answer** (menus, popovers, tooltips, tabs, a styled select). Every PR that adds a dependency states the gzip change that `pnpm check:spa` prints.
- **Our behavior stays.** `DataTable`, `FilterBar`, `ListPage`, `FormShell`, `useList`, the progress bar and the tests that cover them keep their contracts; a component is restyled or replaced underneath them.
