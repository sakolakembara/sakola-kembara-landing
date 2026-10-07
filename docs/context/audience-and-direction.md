# Audience & Strategic Direction

## Primary audience (in priority order)

1. **Donors** — individuals (recurring & one-off) who give via QRIS or bank transfer and confirm via the Google Form. They need credibility, transparency, and an obvious giving path.
2. **Partners** — institutional partners (universities, foundations, corporate CSR). They need legitimacy signals, impact evidence, and a clear contact point.
3. **Volunteers** — prospective relawan (pengajar / pengurus). They need to understand the program, see existing impact, and find the application path.

## Secondary audience

- **Prospective students** and their families. Still important — student registration must remain available — but the website is **not positioned as a student-first platform**. Student-facing content lives on a dedicated **Siswa** page (`/gabung-siswa`) and a registration form, not on the homepage hero.

## Strategic direction

The website's job is to make Sakola Kembara feel **credible enough to deserve donor and partner trust**. The homepage is a formal landing page that:

- Introduces the organization clearly.
- Communicates measurable impact (with a real GIS map of branches).
- Builds confidence — especially for first-time donors and institutional contacts.
- Provides a clear, single donation pathway (`/donasi`).
- Routes volunteers and students to their own dedicated pages.

Concretely, this rules out:

- Hero copy framed *at* students ("Daftar sekarang!" as the primary CTA).
- Gen-Z / playful language on the public landing.
- Mixing the donation page with reports/transparency content.
- Hiding impact and accountability evidence behind clicks.

## Implications for site structure

The current header (`navLinks` in `lib/data.ts`) is already donor/partner-led:

| Header item | Route | Purpose |
| --- | --- | --- |
| **Home** | `/` | Formal landing — org intro, mission, impact, primary CTAs (donate, partner, volunteer) |
| **Team** | `/tim` | Leadership credibility. MVP scope: C-level and core leadership only |
| **Siswa** | `/gabung-siswa` | Program overview + (planned) on-site student registration form |
| **Donasi** | `/donasi` | Dedicated donation page, separate from reports/transparency |
| **Blog** | `/blog` | SEO and public communication |
| **Kontak** | `/kontak` | Contact info and channels |

> The "Donasi Sekarang" CTA in the right of the header points to `/donasi` (`components/layout/navbar.tsx`), not to an external form. Keep it that way — the dedicated donation page is the brand-owned donor experience.

**Header item naming**: the report page label was originally locked to **"Impact & Reports"** during the strategy discussion. Once it shipped (Phase 6) we relaxed that to a plain Indonesian **"Laporan"** — the site is otherwise Indonesian-first and the English label felt out of place next to "Tim", "Siswa", "Donasi", "Blog", "Kontak". Subtitle on the page ("Komitmen kami untuk transparansi…") carries the impact + accountability framing instead. Alternatives considered (*Transparency*, *Reports*, *Accountability*, *Impact*, *Transparency & Impact*) were all rejected as too narrow or too clinical.

## What this means for each section of work

- **Copy decisions** default to formal Indonesian (see `tone-of-voice.md`). Existing English nav labels (`Home`, `Team`) are accepted as-is; do not rewrite them without product sign-off.
- **Visual decisions** keep the current style — navy (`#122E76`) + sunglow yellow (`#FAD02B`) + may green (`#4BA442`) + white, Lora serif headings on Plus Jakarta Sans body, framer-motion reveals, Leaflet map for branches. The brand is warm-but-serious; this matches both donor and student trust needs without redesign.
- **Feature decisions** prioritize donor confidence (transparent reports, clear donation page, real impact data) over student-acquisition features.
- **Content management** should move toward dashboard-managed for high-churn items (blog, announcements, reports, student applications); manual code edits in `lib/data.ts` remain acceptable for low-churn items (team page in MVP).
