# Donation form (SAKEM-128)

The site's own donation form replaces the Google Form "Form Donasi Sakola Kembara". A donor fills in who they are and how much on `/donasi`, sees the transfer details on `/donasi/bayar` (and, for a one-off donation, uploads the receipt there), and ends on `/donasi/terima-kasih`. The data lives in the admin's D1, the receipts in the private R2 bucket, and only the super admin sees them (menu **Donasi**, area `sistem`), with a CSV export for the spreadsheet.

Decided by Dzul on 2026-11-08: data in the admin, not straight to Google Sheets; super admin only (opening it to editors is a separate ticket); the flow of wireframe v5.

## The flow

| Step | Page | What happens |
| --- | --- | --- |
| 1 | `GET/POST /donasi` | Kind (Donasi Sekali / Donasi Bulanan), name, WhatsApp, amount (five buttons or "Nominal lain"); monthly also start month and reminder day. A plain HTML form: the monthly fields and "Nominal lain" show and hide with CSS `:has()`, so it works without JavaScript. Turnstile (action `donation`) guards a **new** donation only. A saved post answers **303** to `/donasi/bayar` and sets the cookie. |
| 2 | `GET /donasi/bayar` | The amount and the Bank Muamalat account, each with "Salin"; the QRIS image (large with "Download QR" on desktop, small with "Simpan Gambar QRIS" on a phone). One-off: the receipt upload and "Konfirmasi Donasi". Monthly: "Rekening untuk donasi bulanan Anda", the reminder day and "Selesai". "Ubah data" goes back to `/donasi?ubah=1`, filled from the cookie, until the donation is checked. |
| receipt | `PUT /donasi/bukti` | JavaScript only (`src/scripts/donation-proof.ts`): a photo over 1.5 MB is made into a 2000 px JPEG first, then the raw bytes are streamed through the site Worker to the API. Without JavaScript the page says to send the receipt on WhatsApp. |
| end | `GET/POST /donasi/terima-kasih` | Thanks, a link to `/laporan`, and the optional "Dari mana Anda mengenal Sakola Kembara?" as buttons (one POST, 303 back with `?tersimpan=1`). |

`/donasi` is in the sitemap again (priority 0.9, as the old sitemap had it); steps 2 and the end are `noindex`. Every page is `no-store`. The `/donasi` → `/donasi-sekarang` 307 of SAKEM-121 is gone; "Konfirmasi Donasi" on `/laporan` now opens `/donasi` in the same tab. The donate buttons (navbar, hero, homepage CTA) go straight to `/donasi` (`DONATION_PATH`, since 2026-11-09); `/donasi-sekarang`, the admin shortlink they used before, is a permanent redirect (308) to `/donasi` in `redirects.config.mjs`, so links already shared keep working, and a reserved shortlink name in the admin.

## The cookie and the token

The site keeps `sakem_donasi=<id>.<token>` (HttpOnly, Secure, SameSite=Lax, `Path=/donasi`, 7 days), so step 2 survives a reload or a trip to the banking app. The token is 32 random bytes (base64url, 43 characters); D1 stores only its SHA-256. The site sends it to the API in `X-Sakem-Donation-Token`; every donor route of the API needs it. A wrong or stale cookie reads as "not found": step 2 goes back to step 1.

## The API (cf/admin)

Donor side, internal, reached only through the service binding (`src/api/public/donations.ts`):

| Route | Does |
| --- | --- |
| `POST /api/public/donations` | Create (201 `{ donation, token }`; Turnstile, rate limit `donation:<ip>` on the contact binding), or with `{ id }` + token change it (200) while it is not checked. One-off starts as `awaiting_transfer`, monthly as `new`. |
| `GET /api/public/donations/:id` | The donor's own summary. |
| `PUT /api/public/donations/:id/proof` | The receipt, streamed: storage reserved first, content sniffed (PNG, JPEG, WebP, PDF), max 10 MB; a one-off becomes `new`. A replaced receipt is deleted and its bytes released. Monthly: 409 `proof_locked`. |
| `POST /api/public/donations/:id/source` | The optional answer. |

Admin side, area `sistem` (`src/api/donations.ts`, mounted at `/api/admin/donations`): the list (search, kind, status, month in WIB), the detail, `/:id/check` and `/:id/uncheck`, `PUT /:id/note`, `DELETE /:id` (also the receipt), `/:id/proof` (the receipt, every view audited; refused if the audit write fails) and `/export.csv` (UTF-8 with BOM, CRLF, formula-safe cells, at most 5000 rows, audited with the count). Audit actions: `donation.check`, `donation.uncheck`, `donation.note`, `donation.delete`, `donation.export`, `donation_proof.view`.

Statuses in the admin: **Belum transfer** (`awaiting_transfer`, a one-off without a receipt), **Baru** (`new`), **Dicek** (`checked`).

## Data

Table `donations` (migration `cf/admin/migrations/0016_donations.sql`), CHECK constraints for the kind fields, a receipt that is all-or-none, a WhatsApp number in `62…` form and an amount up to 1e9. Receipts count towards the private storage budget (`reconcileStorageStatement` sums them too).

## Deploy order

1. D1 migration 0016 on production.
2. The admin Worker (the API and the menu).
3. The site Worker (the pages).

The other way round, step 1 of the form answers "Data belum dapat dikirim saat ini" until the admin is deployed.

## Tests

- `cf/admin/test/donations.test.ts`: the rules, the token, the donor and admin routes, the receipt and storage budget, the CSV, the audit.
- `cf/web` e2e, group `donation-form`: the whole flow against the fixture's in-memory stand-in (`scripts/fixture-api.mjs`), the cookie, cross-site refusals, the API down.
- `cf/web/tests`: the redirect table, the sitemap, the inline-script policy (the shared copy and Turnstile scripts are single-entry components in `src/components/scripts/`).

## Not verified

- The receipt upload in a real phone browser (the shrink to JPEG and the stream) and the CSV opened in Google Sheets: both need a check on staging or production.
