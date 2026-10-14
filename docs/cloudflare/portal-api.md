# Student portal: API contract (SAKEM-083, step 1)

The contract the build workers implement and test against: every endpoint of the student portal and the admin's additions for applicants' files, the shapes of the wizard's steps (seven buckets behind the legacy's eight screens), the application states, the status page and its privacy promise, the file routes, the error codes. The reasoning, the alternatives, the costs and the work split are in [`portal-architecture.md`](portal-architecture.md); the auth routes, cookies, Turnstile and rate limits it builds on are in [`auth.md`](auth.md). The legacy rules and messages come from `app/(portal)/portal/**`, `app/(auth)/**`, `lib/application-status.ts`, `lib/admission-batches.ts`, `lib/student-applications.ts`, `lib/student-form-types.ts` and `lib/db/schema/student-applications.ts`.

**Status: a contract, partly built.** The foundation (the auth routes, `config`, `me`, the guard, the shared form module) is P1a's; the application routes of sections 4.3, 5, 6, 8, 9 and 10 (`overview`, `applications/current`, `steps/:step`, `submit`, `applications`) and the email budget of [`portal-architecture.md`](portal-architecture.md#92-the-resend-quota-at-the-season-peak) are P1b's and **are built** (`cf/admin/src/portal/{applications,rules,queries,present}.ts`; [section 17](#17-what-the-build-of-the-application-routes-settled) lists what the code settled and what it measured). The file routes of section 11 and the admin additions of section 12 are P4's and are not. Where this file and the code disagree after the build, the PR that made them disagree fixes the file. All names, people and numbers in examples are invented.

## Contents

[1. Conventions](#1-conventions) · [2. Endpoint index](#2-endpoint-index) · [3. Auth routes](#3-auth-routes) · [4. Account and overview](#4-account-and-overview) · [5. The application](#5-the-application) · [6. States and the gate](#6-states-and-the-gate) · [7. Step payloads](#7-step-payloads) · [8. Saving a step](#8-saving-a-step) · [9. Submitting](#9-submitting) · [10. Status and the privacy contract](#10-status-and-the-privacy-contract) · [11. File routes (student)](#11-file-routes-student) · [12. Admin additions](#12-admin-additions) · [13. Error codes](#13-error-codes) · [14. The shared form module](#14-the-shared-form-module) · [15. Examples](#15-examples) · [16. What every route's tests must cover](#16-what-every-routes-tests-must-cover) · [17. What the build of the application routes settled](#17-what-the-build-of-the-application-routes-settled)

## 1. Conventions

- **Base paths.** The student API is served by the Worker `sakem-portal` under **`/portal/api`** of the apex host. The admin's additions are on the admin Worker under `/api/admin`. In this file a path starting `/portal/api` is the portal's.
- **JSON.** Request and response bodies are JSON (`Content-Type: application/json`), UTF-8. A body must be at most **16 KiB** (`413 body_too_large`, `maxBytes` in the answer) unless a route says otherwise (`PUT steps/:step` takes 32 KiB: an interview of six 2,000-character answers can pass 16 KiB when it contains multi-byte characters); the file upload is a raw body. A non-JSON content type on a route that takes JSON is `415 json_required`; an unparseable body is `400 invalid_json`. Send `{}` when there is no body.
- **Dates** are ISO 8601 strings in UTC (`2026-10-13T03:24:56.000Z`); the server never sends a date in another shape. **Ids** are UUID strings. Money is a whole number of rupiah.
- **Errors** have the one shape of the CRUD kit ([`admin-crud.md`](admin-crud.md#5-errors)): `{ "error": "<code>", "message"?: "<Indonesian, ready to show>", "fields"?: { "<field>": "<one message>" }, ... }`. `fields` names the JSON property of the body; a nested one is a dotted path (`entries.0.name`); only the first message per field is kept. Never in an error: a stack, SQL, an id of someone else's row, the rejected value, or the body. The codes are in [section 13](#13-error-codes).
- **Headers on every answer:** `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. File answers add the headers of [section 11.4](#114-get-portalapifilesfileid).
- **No CORS.** The API is same-origin only and sends no `Access-Control-*` header.
- **The pipeline of a student route**, in this order, each step stopping the request: (1) the same-origin guard on every write (`403 forbidden` with `reason`); (2) the session (`401 unauthenticated`; a deactivated account has none); (3) the role: only `student` (`403 student_only`); (4) a verified email (`403 email_not_verified`, defence in depth: an unverified student cannot sign in); (5) the route's limiter, keyed by the **user id** (`429 rate_limited`, `Retry-After: 60`, `retryAfterSeconds`); (6) the body checks; (7) the route. `config` and the auth routes have no session; `me` stops after (2).
- **Turnstile** only where `auth.md` puts it (register, login, forgot, resend), in the header `X-Turnstile-Token`. The student routes of this file have none.
- **Nothing personal in logs.** No name, address, number, answer, file name, byte or token in any log line, on success or failure; counts and codes only. A test reads every console line of a full run.
- **Audit.** Besides the rows the auth flows already write (`student.register`, `user.email_verified`, `user.password_reset`), only `application.submit` (the student), `application_file.view` (an admin opening a file) and `application_file.purge` (the retention job). Draft saves and uploads are not audited. Audit rows hold ids and field names, never applicant data.

## 2. Endpoint index

Rate limit names are bindings of [`portal-architecture.md`](portal-architecture.md#63-turnstile-and-rate-limits). "D1" and "R2" say what a call touches beyond the session.

| Method and path | Caller | Limiter | Turnstile | Audit | D1 | R2 |
| --- | --- | --- | --- | --- | --- | --- |
| `GET /portal/api/config` | anyone | none | none | none | none | none |
| auth routes under `/portal/api/auth/*` | anyone, see [3](#3-auth-routes) | per `auth.md` | per `auth.md` | per `auth.md` | users, session, verification | none |
| `GET /portal/api/me` | signed in | none | none | none | none | none |
| `GET /portal/api/overview` | student | `RL_PORTAL_READ` | none | none | read: batches, drafts, applications | none |
| `GET /portal/api/applications/current` | student | `RL_PORTAL_READ` | none | none | read: batch, draft or application, files | none |
| `PUT /portal/api/applications/current/steps/:step` | student | `RL_PORTAL_SAVE` | none | none | read: batch, application; write: the draft (and `dtks` files when DTKS turns "tidak") | delete of the `dtks` objects, after the answer, only when DTKS turns "tidak" (8.1) |
| `POST /portal/api/applications/current/submit` | student | `RL_PORTAL_SUBMIT` | none | `application.submit` | read: batch, draft, files, applications; write: the application, the audit row, the draft (and later the email counter) | none |
| `GET /portal/api/applications` | student | `RL_PORTAL_READ` | none | none | read: the student's applications and their batches | none |
| `PUT /portal/api/applications/current/files/:slot` | student | `RL_PORTAL_UPLOAD` | none | none | read: batch, draft, counts, counter; write: the file row, the counter | put |
| `DELETE /portal/api/applications/current/files/:fileId` | student | `RL_PORTAL_UPLOAD` | none | none | write: the file row, the counter | delete |
| `GET /portal/api/files/:fileId` | student | `RL_PORTAL_READ` | none | none | read: the file and its owner | get |
| `GET /portal/api/dev/mailbox` | local development only | none | none | none | none | none |
| `GET /api/admin/applications/:id` (extended) | admin, `pendaftaran` read | none | none | none | read: as today, plus the files | none |
| `GET /api/admin/applications/:id/files/:fileId` | admin, `pendaftaran` **write** | `RL_ADMIN_FILE` | none | `application_file.view` | read: the file; write: the audit row | get |

Anything else under `/portal/api/` is `404 { "error": "not_found" }`. The admin's routes for applications that are not listed here (`GET /api/admin/applications`, `POST .../:id/status`) do not change.

## 3. Auth routes

The routes of [`auth.md`](auth.md#public-auth-routes) exist unchanged, with these differences only:

- **Base path `/portal/api/auth`** instead of `/api/auth` (the same route table, the same limits, the same Turnstile actions, the same error codes, the same cookie attributes). The table of `auth.md` is the contract; read every `/api/auth/` in it as `/portal/api/auth/`.
- **Cookie:** `__Host-sakem-student.session_token` in production, `sakem-student.session_token` in development and tests ([`portal-architecture.md`](portal-architecture.md#62-cookies-and-the-two-audiences)).
- **Redirect targets are SPA paths with the `/portal` prefix:** the `callbackURL` of the verification link is `/portal/verify-email?status=success`; the `redirectTo` of a reset request is `/portal/reset-password`; Better Auth's error page is `/portal/auth/error`; the Google `callbackURL` is the page the student came from or `/portal/`.
- **`POST /portal/api/auth/register`** keeps its body, answers and neutral behaviour ([`auth.md`](auth.md#registration-contract)); `callbackURL` should be `/portal/login?verified=1`. It gains one answer: **`503 email_quota`** `{ "error": "email_quota", "message": "Pendaftaran akun hari ini sudah penuh. Coba lagi besok, atau masuk dengan Google." }` when the day's email allowance is spent ([`portal-architecture.md`](portal-architecture.md#92-the-resend-quota-at-the-season-peak)); `send-verification-email` and `request-password-reset` answer the same way. It is a function of the day, not of the address. **As built:** the gate (`src/auth/gate.ts`) asks after the rate limits (a flood is throttled first) and before Turnstile (a refused request does not spend a token), costs one D1 row read, and applies to the portal's mount point only: the admin's account routes answer as they always did, whatever the counter says. The counter itself is in `src/email/send.ts` ([section 17](#17-what-the-build-of-the-application-routes-settled)).
- **A student cannot sign in until the address is verified** (`403 EMAIL_NOT_VERIFIED`, and a fresh link is sent). The legacy let an unverified student into the portal and showed a banner; there is no banner state any more. The SPA offers "Kirim ulang tautan" after a registration and after an unverified sign-in through `POST /portal/api/auth/send-verification-email` (Turnstile action `resend-verification`).
- **Role.** Any account can sign in on the apex. Data routes answer `403 student_only` for a role other than `student`.
- `GET /portal/api/auth/get-session` answers Better Auth's `{ session, user }` or `null`; `user.role` is the field the public site's navbar reads.

## 4. Account and overview

### 4.1 `GET /portal/api/config`

Public. `{ "google": boolean, "turnstileSiteKey": string | null, "siteUrl": string, "adminUrl": string }`. `siteUrl` is the public site's origin (variable `SITE_URL`, `""` when unset); the SPA uses it for the links to `/gabung-siswa`, `/gabung-siswa/docs` and the privacy policy. `adminUrl` is the admin host's origin (variable `ADMIN_URL`, `""` when unset): where the "this is an admin account" screen links. Both go through the same rule as the admin's `GET /api/config`: a plain http(s) origin without a trailing slash, anything else is `""`. (`adminUrl` was added by the build: the design named the variable but not where the SPA reads it.)

### 4.2 `GET /portal/api/me`

Signed in, any role (the one route that does not check the role). `200 { "user": { "id": uuid, "name": string, "email": string, "emailVerified": boolean, "role": "student" | "viewer" | "editor" | "super_admin" } }`; `401 unauthenticated`. The SPA shows the "this is an admin account" screen for any role other than `student`.

### 4.3 `GET /portal/api/overview`

The home page in one call (the legacy home read the open batch, the application for it, and the history).

```json
{
  "now": "2026-10-13T03:24:56.000Z",
  "student": { "name": "Sari Dewi", "firstName": "Sari" },
  "openBatch": null,
  "current": { "state": "none" },
  "history": []
}
```

| Field | Rule |
| --- | --- |
| `now` | the server's clock; the client counts "sisa waktu" from it (legacy: `ceil((closesAt - now) / 1 day)`, at least 0) |
| `student.firstName` | the first word of the name; `"Sakemers"` when the name is empty (legacy) |
| `openBatch` | `null`, or `{ id, year, name, description: string \| null, opensAt, closesAt }` of the batch that is open now ([6.2](#62-the-open-batch-gate)); `description` is shown as the legacy home page shows it |
| `current.state` | for the open batch: `"none"` (no draft, no application, or no open batch), `"draft"` (with `updatedAt`), `"submitted"` (with `submittedAt`) |
| `history` | every application of the student, newest `submittedAt` first: `{ id, batch: { year, name }, submittedAt, published: boolean }`. `published` is only whether the batch's results are published: **no verdict, no status** (the legacy history card was deliberately verdict-free). The verdict is only in [`GET /applications`](#10-status-and-the-privacy-contract) |

Reads: the session, the open batch (at most a few rows), the student's draft and applications by their unique index.

## 5. The application

### 5.1 `GET /portal/api/applications/current`

The wizard's bootstrap: the open batch, the draft or the submitted application of the student for it, and the files. `200`:

```json
{
  "now": "2026-10-13T03:24:56.000Z",
  "gate": "open",
  "batch": { "id": "8b7e0c1a-0000-4000-8000-000000000001", "year": 2026, "name": "Gen 6 - 2026/2027", "description": null, "opensAt": "2026-10-01T00:00:00.000Z", "closesAt": "2026-11-15T16:59:59.000Z" },
  "application": null,
  "user": { "name": "Sari Dewi", "email": "sari@example.org" },
  "draft": {
    "id": "5f1d2c3b-0000-4000-8000-000000000002",
    "updatedAt": "2026-10-13T03:20:00.000Z",
    "lastStep": "identity",
    "steps": { "identity": { "fullName": "Sari Dewi", "...": "..." } },
    "saved": ["identity"],
    "missingFiles": ["electricity-bill", "family-card", "parent-permission", "self-photo", "house-photos", "vehicle-photos", "marketing-follow-proof", "marketing-broadcast-proof", "marketing-twibbon-proof", "marketing-story-proof"]
  },
  "files": []
}
```

| Field | Rule |
| --- | --- |
| `gate` | `"open"` (a batch is open and the student has no application for it), `"no_open_batch"`, or `"submitted"` (an application for the open batch exists) |
| `batch` | the open batch as in the overview, or `null` when `gate` is `no_open_batch` |
| `application` | `{ id, submittedAt }` when `gate` is `submitted`, else `null` |
| `user` | the account's `name` and `email`, for the legacy prefill of `identity.fullName` from the account name |
| `draft` | `null` when the student has saved nothing (or `gate` is not `open`); else `{ id, updatedAt, lastStep, steps, saved, missingFiles }` |
| `draft.steps` | only the buckets saved so far, each **exactly as stored**: the validated input of the step in the shapes of [section 7](#7-step-payloads) |
| `draft.saved` | the keys of `steps`, in the order of the seven buckets (`STEP_IDS`: identity, household, housing, organizations, documents, marketing, interview) whatever order they were saved in. The SPA's screen order (`UI_STEP_ORDER`) is its own business |
| `draft.lastStep` | the bucket the student last saved, or `null` (resume point) |
| `draft.missingFiles` | the required slots that currently have no file, computed with `documents.dtksRegistered` (the `dtks` slot only counts when it is `"ya"`); `[]` when none, and all required slots while nothing is uploaded |
| `files` | the live files of the draft, or of the submitted application when `gate` is `submitted`: `[{ id, slot, contentType, size, width, height, uploadedAt }]` (`width` and `height` are `null` for a PDF); oldest first within a slot |

Rules: it **never creates** a draft (a draft is created by the first saved step or the first upload). It does not read the files' bytes. A student whose open batch has closed since they started sees `gate: "no_open_batch"`; the draft stays in D1 until retention removes it ([`portal-architecture.md`](portal-architecture.md#89-retention-and-deletion-proposal)) but is not returned. Reads: the session, the batch, the draft, the application (the unique index), the files (the `(application_id, slot)` index, at most 35 rows).

## 6. States and the gate

### 6.1 The states

The legacy statuses are exactly `pending`, `under_review`, `accepted`, `rejected` (`applicationStatus`). There is **no `waitlist` and no `revoked` status**. `draft` and `submitted` below are states of the student's side, not statuses.

| State | Where | How it is entered | How it is left |
| --- | --- | --- | --- |
| none | no row | | the first saved step or the first upload creates the draft (batch open) |
| draft | `application_drafts` | the first `PUT steps/:step` or `PUT files/:slot` | the submit (the draft is deleted in the same transaction); retention |
| submitted, `pending` | `student_applications.status = 'pending'` | `POST submit` | an admin sets another status |
| `under_review`, `accepted`, `rejected` | the same row | an admin (`POST /api/admin/applications/:id/status`) | an admin again |

Admin transitions are the legacy ones and unchanged ([`admin-pendaftaran.md`](admin-pendaftaran.md#pendaftar)): **any status can be set from any other**; `accepted` and `rejected` need a note; `accepted` to `rejected` is a revocation and needs a note of at least 20 characters (logged `application.revoke`). For the student there is nothing after the submit: **no edit, no withdrawal, no new draft for the same batch**.

### 6.2 The open-batch gate

The open batch is the row of `admission_batches` with `opens_at <= now < closes_at`; if several, the latest `opens_at` (legacy `getCurrentOpenBatch`); `now` is the server's clock at the request. Writes need it; reads of status and of one's own files do not.

| Situation | `overview` | `applications/current` | a write (`PUT steps`, `PUT/DELETE files`, `POST submit`) |
| --- | --- | --- | --- |
| a batch is open, nothing started | `openBatch` set, `current.state: "none"` | `gate: "open"`, `draft: null` | allowed |
| a batch is open, a draft exists | `current.state: "draft"` | `gate: "open"`, the draft | allowed |
| a batch is open, an application exists | `current.state: "submitted"` | `gate: "submitted"` | `409 already_submitted` |
| no batch is open | `openBatch: null`, `current.state: "none"` | `gate: "no_open_batch"` | `409 no_open_batch` |
| the draft's batch closed after the student started | as "no batch is open" | as "no batch is open" | `409 batch_closed` when a draft of a closed batch still exists, else `no_open_batch` (the submit follows the same rule: check 2 of [9.1](#91-post-portalapiapplicationscurrentsubmit) is this gate) |

One application per student per batch: the unique `(user_id, batch_id)` on both tables; a draft cannot be created when an application of the student for the batch exists.

## 7. Step payloads

The wizard has **seven buckets** and a submit. The ticket and the legacy list the screens differently (the legacy has an intro screen, shows the interview before the documents, and draws the marketing proofs under the documents on one screen); the API does not depend on that: a student saves each bucket when they finish it, in any order, and the submit checks all seven in the legacy order (**identity, household, housing, organizations, documents, marketing, interview**).

```ts
type StepId = "identity" | "household" | "housing" | "organizations" | "documents" | "marketing" | "interview";
```

Rules for every bucket:

- The body is **one JSON object**; unknown keys are dropped (not an error); a key of the wrong JSON type is a field error. All strings are trimmed before checking. The messages below are the legacy zod messages (`lib/student-form-types.ts`); where the legacy left a message to zod's English default ("String must contain at most N character(s)") this contract writes **"Maksimal N karakter"** (the wording the legacy register form used) and says so.
- What is stored is the **validated input** (strings trimmed, `whatsapp` without spaces, `instagramUsername` without a leading `@`; numbers as sent), so `GET applications/current` hands the wizard back exactly what it holds in its own state. The transformation to numbers happens at submit ([section 9.3](#93-what-is-written)).
- **Numeric fields** (`familySize`, `buildingArea`, `motorcycles`, `cars`, `debtInstallmentMonths`) accept a JSON number or a numeric string (the legacy `z.coerce.number()`); a value that is not a whole number gives the field's "angka" message.
- An empty string is a missing value: the field's "Wajib diisi" (or its minimum) message.

### 7.1 Primitive rules

| Rule | Definition | Messages |
| --- | --- | --- |
| `nonEmpty(max)` | string, trimmed, length 1 to `max` | `"Wajib diisi"`; `"Maksimal {max} karakter"` |
| `rupiah` | a string. Trimmed; empty is `"Wajib diisi"`; contains `rp` in any case: `'Hilangkan "Rp". Contoh benar: 1.200.000'`; contains a comma: `"Hilangkan koma. Contoh benar: 1.200.000"`; contains `-`: `"Isi satu angka pasti, bukan rentang."`; after removing the dots anything but digits: `"Hanya angka. Contoh: 1.200.000"`; the number is an integer from 0 to 1,000,000,000,000 (above: `"Angka terlalu besar"`, new; the legacy left it to zod's English). The checks run in this order and the first failure is the message | as listed |
| `whatsapp` | a string. Trimmed, **all whitespace removed**, then `^62\d{8,14}$` | `"Gunakan format 62 diikuti 8–14 digit. Contoh: 6281392254544"` |
| `choice(list)` | one of the listed strings, exactly | the field's own "Pilih ..." message |

### 7.2 `identity`

| Field | Type | Rule | Messages |
| --- | --- | --- | --- |
| `fullName` | string | 3 to 120 characters; **not** only capital letters and spaces (`^[A-ZÀ-ÿ ]+$` is refused) | `"Nama minimal 3 karakter"`; `"Maksimal 120 karakter"`; `"Jangan menggunakan huruf kapital semua. Contoh: Dadi Dinan Haris"` |
| `nickname` | string | `nonEmpty(60)` | |
| `gender` | string | `"laki-laki"` or `"perempuan"` | `"Pilih jenis kelamin"` |
| `religion` | string | one of `Islam`, `Kristen Protestan`, `Kristen Katolik`, `Hindu`, `Budha`, `Konghucu` | `"Pilih agama"` |
| `schoolName` | string | `nonEmpty(200)` | |
| `branch` | string | one of `Cililin`, `Bandung`, `Cirebon`, `Cibodas`, `Bojong`, `Purbalingga`, `Samarinda`, `Online` | `"Pilih cabang"` |
| `homeAddress` | string | `nonEmpty(500)` | |
| `graduationBatch` | string | one of `2025/2026 (Gap Year)`, `2027 (Kelas 12)` | `"Pilih tahun angkatan"` |
| `whatsapp` | string | `whatsapp` | |

The two lists that change every year (`branch`, `graduationBatch`) are constants of the shared module, hard-coded in the legacy too; updating them is a code change.

### 7.3 `household`

| Field | Type | Rule | Messages |
| --- | --- | --- | --- |
| `livingWith` | string[] | at least one item; each trimmed and non-empty (the options are `Ayah`, `Ibu`; free text is accepted as the legacy "Other"); at most 10 items of 60 characters (new bounds) | `"Pilih minimal satu"` |
| `fatherName`, `fatherOccupation` | string | `nonEmpty(120)` (the occupation options of the legacy form are suggestions; any text is accepted) | |
| `fatherIncome` | string | `rupiah` | |
| `motherName`, `motherOccupation` | string | `nonEmpty(120)` | |
| `motherIncome` | string | `rupiah` | |
| `hasOtherEarner1` | boolean | | |
| `earner1Relation` | string, optional | at most 120; **required when `hasOtherEarner1`** | `"Wajib diisi"` |
| `earner1Income` | string, optional | **when `hasOtherEarner1`: `rupiah`** (its own message, on this field) | |
| `hasOtherEarner2` | boolean | | |
| `earner2Relation`, `earner2Income` | as the first earner, when `hasOtherEarner2` | additionally, **`hasOtherEarner2` without `hasOtherEarner1`** is an error on `earner2Relation` | `"Isi anggota pertama dulu."` |
| `familySize` | number or numeric string | whole number, 1 to 20 | `"Wajib diisi"` (not a number); `"Minimal 1 (termasuk kamu)"`; `"Maksimal 20"`; not whole: `"Isi dengan angka bulat"` (new; the legacy used zod's default) |

### 7.4 `housing`

| Field | Type | Rule | Messages |
| --- | --- | --- | --- |
| `residenceStatus` | string | one of `Rumah Pribadi`, `Mengontrak/Menyewa`, `Menumpang Pada Orang Lain` | `"Pilih status tempat tinggal"` |
| `buildingArea` | number or numeric string | whole number, 0 to 10,000 | not a number: `"Isi luas dalam meter persegi"`; negative: `"Tidak boleh negatif"`; above: `"Maksimal 10000"` |
| `motorcycles`, `cars` | number or numeric string | whole number, 0 to 50 | `"Isi dengan angka"`; `"Tidak boleh negatif"`; `"Maksimal 50"` |
| `hasDebt` | boolean | | |
| `debtType` | string, optional | at most 200; **required when `hasDebt`** | `"Wajib diisi"` |
| `debtAmount` | string, optional | **when `hasDebt`: `rupiah`** | |
| `debtInstallmentMonths` | number or numeric string, optional | **when `hasDebt`:** whole number, 1 to 600 | `"Wajib diisi"` (not a number); `"Isi dalam angka bulan tanpa satuan"` (not whole); `"Minimal 1 bulan"`; `"Maksimal 600 bulan"` |
| `debtDescription` | string, optional | at most 500; **required when `hasDebt`** | `"Wajib diisi"` |

### 7.5 `organizations`

| Field | Type | Rule | Messages |
| --- | --- | --- | --- |
| `hasOrganizations` | boolean | | |
| `entries` | `{ name: string, position: string }[]` | at most 20 entries (new bound); `name` and `position` each at most 200. When `hasOrganizations`: at least one **filled** entry (a name or a position), and **every filled entry needs both** | `"Tambahkan minimal satu organisasi"` (on `entries`); `"Nama organisasi wajib diisi"` (on `entries.{i}.name`); `"Jabatan wajib diisi"` (on `entries.{i}.position`) |

When `hasOrganizations` is `false` the entries are ignored.

### 7.6 `documents` (the answers; the files are [section 11](#11-file-routes-student))

| Field | Type | Rule | Messages |
| --- | --- | --- | --- |
| `dtksRegistered` | string | `"ya"` or `"tidak"` | `"Pilih Ya atau Tidak"` |

DTKS = Data Terpadu Kesejahteraan Sosial. With `"ya"` the slot `dtks` becomes required (`"Wajib diisi karena kamu terdaftar DTKS. Unggah SKTM DTKS-mu."`, reported at submit as a missing file); with `"tidak"` any `dtks` file is removed when the step is saved. **The legacy `*Url` fields no longer exist**: every document is a file.

### 7.7 `marketing` (the answers; the proofs are files)

| Field | Type | Rule | Messages |
| --- | --- | --- | --- |
| `instagramUsername` | string | one leading `@` removed, then 1 to 30 characters of `[A-Za-z0-9._]` | `"Wajib diisi"`; `"Maksimal 30 karakter"`; `"Hanya huruf, angka, titik, dan garis bawah."` |

### 7.8 `interview`

| Field | Type | Rule | Messages |
| --- | --- | --- | --- |
| `motivationHigherEducation`, `motivationSakem`, `consistencyPlan`, `attendanceCommitment`, `parentResponse`, `ifParentChangesMind` | string | 20 to 2,000 characters | `"Tulis minimal 20 karakter"`; `"Maksimal 2000 karakter"` |
| `agreedToSignedStatement` | string | `"ya"` or `"tidak"`, and only `"ya"` passes | not one of the two: `"Pilih Ya atau Tidak"`; `"tidak"`: `"Pendaftaran hanya dapat dilanjutkan jika kamu bersedia menandatangani surat pernyataan bermaterai."` |

### 7.9 What the build settled

The rules above are implemented in `shared/application-form/rules.ts` and pinned, message by message, by `test/portal-foundation-form.test.ts`. Where the contract left a choice, the build made it as follows (the tests are the record):

- **What is stored when a toggle is off.** The fields that only exist when a toggle is on are **not stored** (not checked either) while it is off: `earner1Relation` and `earner1Income` without `hasOtherEarner1`, the same for the second earner, `debtType`, `debtAmount`, `debtInstallmentMonths` and `debtDescription` without `hasDebt`. `organizations.entries` is `[]` without `hasOrganizations` (the entries are ignored, whatever they hold) and holds the **filled** entries only (an empty row is not an entry) with it. A missing toggle key is "off"; a toggle that is not a boolean is `"Pilih Ya atau Tidak"`.
- **The index in `entries.{i}`** is the entry's place in the request body (the legacy counted among the filled entries, which put the message on the wrong row when an empty row came first). More than 20 entries is `"Maksimal 20 organisasi"` on `entries`; an entry that is not an object is `"Isian tidak valid"` on `entries.{i}`; a field over 200 characters is `"Maksimal 200 karakter"`.
- **Counts** (`familySize`, `buildingArea`, `motorcycles`, `cars`, `debtInstallmentMonths`) take a JSON number or a string that is a plain decimal number (`-?\d+(\.\d+)?` after trimming): `"1e3"`, `"0x10"`, `"4 orang"`, booleans, arrays and `null` are "not a number". An empty string reaches the **minimum's** message where the legacy did (it coerced `""` to 0: `familySize` is `"Minimal 1 (termasuk kamu)"`, the months are `"Minimal 1 bulan"`); where 0 is a valid answer (`buildingArea`, `motorcycles`, `cars`) an empty string is "not a number", so an untouched field does not pass as 0 (a deliberate tightening). What is stored is the value as sent (a number, or the trimmed string); the submit turns it into a number.
- **`livingWith`**: more than 10 items is `"Pilih maksimal 10"`; an item that is empty is `"Wajib diisi"` and one over 60 characters `"Maksimal 60 karakter"`, both on `livingWith.{i}`.
- **Wrong JSON type** for a text field (a number where text belongs) is `"Isian tidak valid"`; a missing field is `"Wajib diisi"` (or the field's own message). A rupiah field given a number is `"Hanya angka. Contoh: 1.200.000"` (it is text).
- **A body that is not a JSON object** fails with no field: `fields` is `{}` and the `message` is `"Periksa kembali isian formulir."`.
- **Order of the messages.** `issues` keeps the order the rules ran in (the plain fields in declaration order, then the conditional ones, as the legacy `superRefine` did); `fields` keeps the first message of each field. The submit's `message` is `issues[0].message`.

## 8. Saving a step

### 8.1 `PUT /portal/api/applications/current/steps/:step`

`:step` is one of the seven `StepId`s (`404 unknown_step` otherwise). The body is the bucket of [section 7](#7-step-payloads). Pipeline: the common checks (session, `student`, verified, `RL_PORTAL_SAVE` 30 per 60 s) → the step name → **the gate** (`409 no_open_batch`, `409 batch_closed`, `409 already_submitted`, [6.2](#62-the-open-batch-gate)) → the body (`415 json_required`, `413 body_too_large`, `400 invalid_json`) → the schema → the write.

`200`:

```json
{ "step": "household", "savedAt": "2026-10-13T03:24:56.000Z",
  "draft": { "id": "5f1d2c3b-0000-4000-8000-000000000002", "updatedAt": "2026-10-13T03:24:56.000Z", "saved": ["identity", "household"], "missingFiles": ["electricity-bill", "..."] },
  "removedSlots": [] }
```

- `400 invalid` carries `fields` (all failing fields of this step, one message each, the first message per field) and `message: "Periksa kembali isian formulir."`; **nothing is written**.
- Effects: the draft row is created if it does not exist (id made now; `INSERT ... WHERE NOT EXISTS (an application of this student for this batch)`), the bucket **replaces** `form_data.<step>` (a JSON patch of that one key, not a read-modify-write of the whole object), `last_step` is set to this step, `updated_at` moves. Saving `documents` with `dtksRegistered: "tidak"` removes the `dtks` files of the draft (rows and objects) and lists them in `removedSlots` (`["dtks"]`), else `[]`.
- Idempotent: the same body again is `200` and writes the same bucket. Two steps saved at once do not overwrite each other; the same step saved twice is last write wins.
- No audit row, no email, no log line with content. Writes: the draft row (1 row; 3 the first time).
- **As built.** The gate is read first (one statement) and the write is ONE `batch`: the upsert, a summary of what the answer needs (the buckets the draft holds, the DTKS answer) and the per-slot file counts, with the three statements of the DTKS cleanup in the same batch when `documents` is saved with `tidak`. The upsert carries the gate's two conditions itself (the batch is open at that instant, the student has no application), so a batch that closes, or an application that appears, between the read and the write returns no row: nothing is written and the answer is the `409` that is true now (`no_open_batch`, `batch_closed` or `already_submitted`). `updated_at` only grows (`max(now, previous + 1)`), so two saves in one millisecond still move the version the submit holds on to. The DTKS cleanup is tied to what the draft says after the save, not to what the request sent: the `dtks` files of the draft go when its stored answer is `tidak`. It marks the rows deleted and gives their bytes back to `private_storage` in the same batch; **after the answer** it deletes the objects from `PRIVATE_FILES` and then the rows. If the bucket is missing or a delete fails the rows stay marked (their bytes already given back) and the answer is still `200`, `removedSlots: ["dtks"]`. The key of those objects is built from the batch year, the draft's id, the file id and the sniffed type (`applicationFileKey`, [portal-architecture.md, 8.1](portal-architecture.md#81-the-bucket)); P4's `src/private-files/` owns the key, and the two must stay the same.

## 9. Submitting

### 9.1 `POST /portal/api/applications/current/submit`

Body `{}`. Limiter `RL_PORTAL_SUBMIT` (3 per 60 s per user). The legacy order of checks, then the new ones; the first failure answers:

| Order | Check | Answer |
| --- | --- | --- |
| 1 | the common checks (session, `student`, verified, limiter) | `401`, `403 student_only`, `403 email_not_verified` (`"Verifikasi email kamu dulu sebelum mengirim pendaftaran."`), `429` (`"Terlalu banyak percobaan pengiriman. Silakan tunggu beberapa menit lalu coba lagi."`) |
| 2 | a batch is open | `409 no_open_batch` (legacy sentence, [13](#13-error-codes)) |
| 3 | no application for this batch yet | `409 already_submitted` |
| 4 | a draft exists | `404 no_draft`: `"Belum ada isian yang tersimpan. Isi formulir pendaftaran dulu."` |
| 5 | each bucket, in the order **identity, household, housing, organizations, documents, marketing, interview**, is present and passes its schema again | `422 incomplete` with `step`, `message` = the first message of the schema (legacy: `issues[0].message`), or, for a bucket that was never saved, `"Isian identitas belum lengkap."`, `"Isian keluarga belum lengkap."`, `"Isian tempat tinggal belum lengkap."`, `"Isian organisasi belum lengkap."`, `"Isian berkas belum lengkap."`, `"Isian marketing belum lengkap."`, `"Isian interview belum lengkap."`; `fields` has the first failing field |
| 5b | after `documents` passes: every required `documents` slot has at least one file; after `marketing` passes: every marketing slot has one | `422 incomplete` with `step: "documents"` or `"marketing"`, `missingFiles: [slot ids]` and `message: "Berkas wajib belum lengkap: {labels}."` (the slot labels, comma separated) |
| 6 | the legacy soft anti-duplicate: no application with the **same WhatsApp number submitted in the last hour** (any student) | `409 duplicate_whatsapp` with `step: "identity"`: `"Pendaftaran dari nomor WhatsApp ini baru saja dikirim. Mohon tunggu sebelum mencoba lagi."` |
| 7 | the write (below) inserted a row | else `409 draft_changed`: `"Isianmu berubah saat dikirim. Periksa lagi lalu kirim ulang."` (a step was saved after the check) or `409 already_submitted` (a second submit won) |

**As built:** (a) the body of a submit (`{}`) is checked right after the common checks, before D1: `415 json_required`, `413 body_too_large` over 16 KiB, `400 invalid_json` (it is a JSON route like the others; no body and no content type is a `415`). (b) Check 2 is the gate of [6.2](#62-the-open-batch-gate), so a draft of a closed batch is `409 batch_closed`. (c) `403 email_not_verified` carries the shorter line above on this route only; every other route keeps the guard's. (d) The check 5 messages and `fields` are `validateStep`'s (`issues[0]`); `fields` is the first failing field only. (e) After the write fails, the route reads the gate again: an application now exists is `already_submitted`, a batch no longer open is `batch_closed` or `no_open_batch`, anything else is `draft_changed`. The unique `(user_id, batch_id)` index refusing the insert (a state the route does not make) is handled the same way: nothing was written, the answer is `already_submitted`.

### 9.2 `201`

```json
{ "applicationId": "5f1d2c3b-0000-4000-8000-000000000002", "submittedAt": "2026-10-13T03:40:00.000Z",
  "batch": { "id": "8b7e0c1a-0000-4000-8000-000000000001", "year": 2026, "name": "Gen 6 - 2026/2027" } }
```

### 9.3 What is written

One `db.batch` (one transaction), guarded so a changed or vanished draft writes nothing:

1. `INSERT INTO student_applications` with `id` = the draft's id; `user_id`, `batch_id`; `full_name` = `identity.fullName`; `email` = the account email, lower case, at this moment; `whatsapp`; `school_name` = `identity.schoolName`; `graduation_year` = `identity.graduationBatch`; `branch_preference` = `identity.branch`; `motivation` and `economic_background` null; `status` `pending`; `submitted_at` and `updated_at` now; `form_data` as below. The insert is an `INSERT ... SELECT ... WHERE EXISTS` over the draft with this id and the `updated_at` that was validated (and the batch still open).
2. The audit row `application.submit`, resource type `application`, resource id the application's id, metadata `{ "batchId": ..., "batchYear": ... }` **only** (the legacy row also carried the school, the intake and the branch; the audit rule since SAKEM-082 is ids and field names). It is an `INSERT ... SELECT ... WHERE EXISTS` of its own (the draft is still there at the validated version and the application exists), because `auditStatement` cannot be conditional: a test writes the same entry through both and compares the rows.
3. `DELETE FROM application_drafts WHERE id = ...` with the validated version, only if an application with that id exists.

After the response (`waitUntil`): the confirmation email ([`portal-architecture.md`](portal-architecture.md#91-which-emails-the-portal-sends)), counted in `email_daily` when it is sent and skipped when the day's count is already 80 or more ([`portal-architecture.md`](portal-architecture.md#92-the-resend-quota-at-the-season-peak)). Its failure is logged as the purpose and reason only and changes nothing.

`form_data` **version 3** (`formVersion: 3`):

```ts
{
  formVersion: 3,
  identity: { nickname, gender, religion, homeAddress },
  household: {
    livingWith: string[],
    father: { name, occupation, income: number },
    mother: { name, occupation, income: number },
    otherEarners: { relation: string, income: number }[],   // earner 1 then earner 2, only those switched on
    familySize: number
  },
  housing: {
    residenceStatus, buildingArea: number, motorcycles: number, cars: number,
    debt: { type, amount: number, installmentMonths: number, description } | null   // null when hasDebt is false
  },
  organizations: { name, position }[],                       // only entries with a name, trimmed; [] when hasOrganizations is false
  documents: { dtksRegistered: boolean },                    // "ya" is true; the files are application_files rows, not links
  marketing: { instagramUsername },
  interview: { motivationHigherEducation, motivationSakem, consistencyPlan, attendanceCommitment, parentResponse, ifParentChangesMind, agreedToSignedStatement: true }
}
```

Version 2 (the legacy: `documents` and `marketing` hold links) stays readable; the admin screen reads every part defensively already. The rupiah strings become numbers exactly as the legacy `rupiahSchema` did (`"1.200.000"` and `"1200000"` are 1200000). `agreedToSignedStatement` is the boolean `true` as above; see [14](#14-the-shared-form-module) for why the route sets it. In `src/db/schema/admission.ts` `CURRENT_FORM_DATA_VERSION` is 3 and `StudentApplicationFormData` is the union of the two versions.

## 10. Status and the privacy contract

> Students only see a verdict after `admission_batches.results_published_at` is set, even if the admin already flipped the internal status. (`docs/architecture/student-portal.md`)

The API enforces it: **before publication the answer contains no status, no review note and no review time at all.**

### 10.1 `GET /portal/api/applications`

`200 { "items": [ ... ] }`, the student's applications, newest `submittedAt` first (all batches; empty `items` is the "Belum ada pendaftaran" state). Limiter `RL_PORTAL_READ`. Not gated by the open batch.

```ts
interface StatusItem {
  id: string;
  batch: { id: string; year: number; name: string };
  submittedAt: string;
  result:
    | { state: "processing" }
    | { state: "awaiting_decision"; announcedAt: string }
    | { state: "decided"; decision: "accepted" | "rejected"; announcedAt: string; notes: string | null };
}
```

| The row | `result` |
| --- | --- |
| the batch's `results_published_at` is **null** (whatever the status, including `accepted` and `rejected`) | `{ "state": "processing" }` |
| published, status `accepted` | `{ "state": "decided", "decision": "accepted", "announcedAt": <results_published_at>, "notes": <review_notes trimmed, or null when empty> }` |
| published, status `rejected` | `{ "state": "decided", "decision": "rejected", "announcedAt": ..., "notes": ... }` |
| published, status still `pending` or `under_review` (the admin's publish guard should make this impossible; a manual database write could) | `{ "state": "awaiting_decision", "announcedAt": ... }` |

The SPA chooses the words (the legacy `statusView` in `app/(portal)/portal/status/page.tsx`): `processing` is "Pendaftaran kamu sedang diproses" (eyebrow "Sedang Diproses"); `decided` + `accepted` is "Kamu diterima" with `notes` as the body or the default acceptance paragraph; `decided` + `rejected` is "Belum lolos tahun ini" with `notes` or the default decline paragraph and the link "Lihat batch pendaftaran berikutnya"; `awaiting_decision` is "Menunggu keputusan" with the "hubungi panitia via WhatsApp ... 1×24 jam" line. The pills of the history are "Menunggu hasil", "Diterima", "Belum lolos".

**As built, the promise is kept in two places, each enough for what leaves the Worker:** the query of the status page (`statusQuery`) selects the status and the note through `CASE WHEN results_published_at IS NOT NULL`, so D1 hands over NULL for both until the batch is published; and `resultOf` (`src/portal/rules.ts`), the one function that builds `result`, answers `processing` for an unpublished batch whatever it is handed. The home page's history reads neither column. Each place has its own test and its own negative check.

**Never sent, in any state:** `status`, `review_notes` before publication, `reviewed_at`, `reviewed_by`, the review's author, other students' data, the form answers. A test publishes and unpublishes a batch around the same application and asserts the exact key sets of the answer in each state; a negative check removes the publication condition and the test must fail. If an admin cancels the publication (`POST /api/admin/batches/:id/unpublish`) the next read is `processing` again.

`notes` is the admin's `review_notes` (at most 2,000 characters), shown to the student as the legacy page showed it ([`portal-architecture.md`](portal-architecture.md#13-open-decisions-for-dzul), open decision 9).

## 11. File routes (student)

> **Decided 2026-10-13: no SSE-C.** Every clause of this section about `PRIVATE_FILES_KEY`, an SSE-C key passed to `put` or `get`, or a read that fails for the key (the `storage_unavailable` row of 11.2, "SSE-C when the key is configured" below it, and the last sentence of 11.4) is void: no key is declared and the routes pass none. `503 storage_unavailable` means a missing `PRIVATE_FILES` binding only. P4 removes the clauses when it builds the routes.

### 11.1 The slots (authoritative)

Sixteen slots; the identifier is what the URL, the table and the admin screen use. Types: `png`, `jpeg`, `webp`, `pdf` (sniffed from the bytes) unless noted. The code is `shared/application-form/slots.ts`; this table is the contract it is written from.

| Slot | Legacy field | Label | Required | Max files | Types |
| --- | --- | --- | --- | --- | --- |
| `father-income` | `fatherIncomeUrl` | Surat Keterangan Penghasilan Ayah | no | 1 | all four |
| `mother-income` | `motherIncomeUrl` | Surat Keterangan Penghasilan Ibu | no | 1 | all four |
| `other-earner-1-income` | `otherEarner1IncomeUrl` | Surat Penghasilan Anggota Keluarga Lain (1) | no | 1 | all four |
| `other-earner-2-income` | `otherEarner2IncomeUrl` | Surat Penghasilan Anggota Keluarga Lain (2) | no | 1 | all four |
| `debt-proof` | `debtProofUrl` | Bukti Hutang | no | 3 | all four |
| `electricity-bill` | `electricityBillUrl` | Tagihan/Token Listrik 3 Bulan Terakhir | yes | 3 | all four |
| `family-card` | `familyCardUrl` | Scan Kartu Keluarga | yes | 2 | all four |
| `parent-permission` | `parentPermissionUrl` | Surat Izin Orang Tua (bermaterai) | yes | 2 | all four |
| `self-photo` | `selfPhotoUrl` | Foto Diri | yes | 1 | `png`, `jpeg`, `webp` |
| `dtks` | `dtksUrl` | Surat Keterangan Tidak Mampu (SKTM) terdaftar DTKS | when `dtksRegistered` is `"ya"` | 1 | all four |
| `house-photos` | `houseImagesUrl` | Foto Rumah: depan, ruang tamu, kamar mandi | yes | 6 | all four |
| `vehicle-photos` | `vehicleImagesUrl` | Foto Kendaraan yang ada di rumah | yes | 6 | all four |
| `marketing-follow-proof` | `instagramFollowProofUrl` | Bukti Follow Instagram @sakolakembara | yes | 1 | all four |
| `marketing-broadcast-proof` | `broadcastProofUrl` | Bukti Share Poster + Broadcast ke 3 Grup WhatsApp | yes | 4 | all four |
| `marketing-twibbon-proof` | `twibbonUploadUrl` | Bukti Upload Twibbon di Feed Instagram | yes | 1 | all four |
| `marketing-story-proof` | `storyUploadUrl` | Bukti Share Poster di Story Instagram | yes | 1 | all four |

The documents slots belong to the `documents` step (the first twelve), the four marketing slots to the `marketing` step. **Limits** (`shared/application-form/limits.ts`): 10,000,000 bytes a file (decimal, as the admin's kinds), 40 live files and 100,000,000 bytes a file set per application, images at most 10,000 pixels a side and 50 megapixels.

### 11.2 `PUT /portal/api/applications/current/files/:slot`

The **raw file** as the request body. `Content-Length` is required; the `Content-Type` is ignored (the client sends `application/octet-stream`). Optional `?replace=<fileId>`: the new file takes the place of one of the student's live files **of the same slot**, in one step. No multipart, no form.

The order of the checks, cheapest first (the first failure answers):

| Check | Answer |
| --- | --- |
| session, `student`, verified | `401`, `403 student_only`, `403 email_not_verified` |
| `RL_PORTAL_UPLOAD` (20 per 60 s per user) | `429 rate_limited`: `"Terlalu banyak unggahan. Silakan tunggu satu menit lalu coba lagi."` |
| the slot is one of the sixteen | `404 unknown_slot` |
| `Content-Length` present | `411 length_required` |
| `Content-Length` is 0 | `400 empty_file`: `"File kosong."` |
| `Content-Length` at most 10,000,000 | `413 too_large`: `"Ukuran file maksimal 10 MB."` with `maxBytes` |
| the gate: a batch is open, the student has a draft there or can start one, no application | `409 no_open_batch`, `409 batch_closed`, `409 already_submitted` |
| `?replace` names a live file of this draft in this slot | `404 file_not_found` |
| the slot has room (the replaced file does not count): live files below the slot's maximum | `409 slot_full` with `max`: `"Slot ini sudah penuh. Hapus satu berkas dulu atau ganti berkas yang ada."` |
| the application stays within 40 files and 100,000,000 bytes (after the replace) | `409 application_full`: `"Jumlah berkas sudah mencapai batas."`; `413 application_too_large`: `"Total ukuran berkas sudah mencapai batas."` |
| the storage counter takes the bytes (`bytes + size <= PRIVATE_FILES_BUDGET_BYTES`) | `503 storage_full`: `"Penyimpanan berkas sedang penuh. Hubungi panitia lewat WhatsApp."` |
| production has the bucket and `PRIVATE_FILES_KEY` | `503 storage_unavailable`: `"Penyimpanan berkas sedang tidak tersedia. Coba lagi nanti."` |
| the first 1 MiB is read and sniffed | `415 unsupported_type` (`allowed`: the slot's content types; `"Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP, PDF."` or the slot's list), `422 invalid_file` (`"File rusak atau tidak bisa dibaca. Coba simpan ulang lalu unggah lagi."`), `422 unreadable_size` (`"Ukuran gambar tidak terbaca. Simpan ulang gambar tanpa metadata yang besar."`), `422 dimensions_too_large` (`"Dimensi gambar terlalu besar (maksimal 10.000 piksel per sisi dan 50 megapiksel)."`) |
| the body is exactly as long as declared | `400 body_mismatch`: `"Unggahan terputus. Coba lagi."` (nothing is stored) |

Then the object is stored (key `applications/<batch year>/<application id>/<file id>.<ext>`, `Content-Type` the sniffed one, `Cache-Control: private, no-store`, SSE-C when the key is configured) and the row is inserted in one guarded statement; if the insert writes nothing (the draft vanished, the slot filled up meanwhile) the object is deleted and the answer is the gate's or `slot_full`. On a replace the old row is marked deleted in the same batch and its object is deleted afterwards. `201`:

```json
{ "file": { "id": "c0ffee00-0000-4000-8000-000000000003", "slot": "family-card", "contentType": "application/pdf", "size": 812345, "width": null, "height": null, "uploadedAt": "2026-10-13T03:30:00.000Z" },
  "usage": { "slotCount": 1, "slotMax": 2, "applicationFiles": 5, "applicationBytes": 4123456 },
  "draft": { "id": "5f1d2c3b-0000-4000-8000-000000000002", "missingFiles": ["electricity-bill", "..."] } }
```

The first upload creates the draft when there is none. The file name the browser had is never sent, stored or logged.

### 11.3 `DELETE /portal/api/applications/current/files/:fileId`

Only the student's own live file, only while the application is a draft in an open batch (the gate's errors apply). `204`; `404 not_found` for an id that is not theirs or not live (never `403`). `RL_PORTAL_UPLOAD`. The row is marked deleted, the object deleted, the row removed; a failed object delete leaves the marked row for the daily job.

### 11.4 `GET /portal/api/files/:fileId`

The student's own file, in the draft or in a submitted application, in **any** batch. `404 not_found` for anything else, including another student's file (never `403`), a deleted file and a malformed id. `RL_PORTAL_READ`. `200` streams the object (no buffering) with exactly these headers:

| Header | Value |
| --- | --- |
| `Content-Type` | the stored, sniffed type |
| `Content-Disposition` | `inline; filename="<slot>-<first 8 of the id>.<ext>"` for an image; `attachment; filename="..."` for a PDF. The name is built from the slot and the id, never from client input |
| `Cache-Control` | `private, no-store` |
| `X-Content-Type-Options` | `nosniff` |
| `Content-Security-Policy` | `default-src 'none'; sandbox` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Content-Length` | the object's size |

`Range` and conditional headers are ignored (always a full `200`). With SSE-C configured the read passes the key; a read that fails for the key is `503 storage_unavailable`.

## 12. Admin additions

On `sakem-admin`; the rest of the Pendaftar API ([`admin-pendaftaran.md`](admin-pendaftaran.md#endpoints)) is unchanged.

### 12.1 `GET /api/admin/applications/:id`, extended

Guard `requireArea("pendaftaran", "read")` as today. `item` gains:

| Field | Value |
| --- | --- |
| `formVersion` | `2`, `3` or `null` (copied out of `formData.formVersion`; `null` when there is no `formData`) |
| `files` | the live files of the application: `[{ id, slot, contentType, size, width, height, uploadedAt }]`, oldest first within a slot; `[]` for version 2 or none |
| `canOpenFiles` | `true` for a super_admin and an editor with the `pendaftaran` grant, `false` for a viewer ([`portal-architecture.md`](portal-architecture.md#86-reading-a-file), open decision 1) |

Everything else in the answer, the `ETag` and the 404 are as today. `files` is one more statement in the same round trip (the `(application_id, slot)` index; at most 35 rows).

### 12.2 `GET /api/admin/applications/:id/files/:fileId`

Guard `requireArea("pendaftaran", "write")`. `RL_ADMIN_FILE` (120 per 60 s per admin id). The file must be a live file of application `:id` (`404 not_found` otherwise, for every kind of mismatch). **The audit row is written before the body is sent**: action `application_file.view`, resource type `application_file`, resource id the file id, metadata `{ "applicationId": ..., "slot": ... }`, actor the admin; if it cannot be written the answer is `503 audit_unavailable` (`"Berkas belum bisa dibuka. Coba lagi."`) and nothing is served. `200` streams the object with the headers of [11.4](#114-get-portalapifilesfileid) (inline for an image, attachment for a PDF). `401 unauthenticated`, `403 forbidden` (a viewer, an editor without the grant, a student), `429`, `503 storage_unavailable`.

### 12.3 The retention job (not a route)

> **Superseded, decided 2026-10-13 (the PM relayed Dzul):** nothing is deleted automatically, so this job is **not built**. It is replaced by a **manual purge action** (an admin editor with the `pendaftaran` grant, or a super_admin, deletes an applicant's files, with a confirmation and an audit row). The contract of that action (route, answers, audit row) is written by P4, which also removes this subsection. The foundation declares the three retention variables at `0` (never delete) and no code reads them; there is no retention table. What follows is kept as the record of the proposal.

The daily Cron Trigger of `sakem-admin` deletes as [`portal-architecture.md`](portal-architecture.md#89-retention-and-deletion-proposal) says, writes one `application_files.purge` audit row per application (resource type `application`, metadata `{ "reason": "draft_closed" | "rejected" | "accepted" | "orphan", "count": n }`, actor id null and actor email `system`), and logs one line with counts only.

## 13. Error codes

| Code | Status | Message (Indonesian) | Where |
| --- | --- | --- | --- |
| `unauthenticated` | 401 | none (the SPA has its own line) | every route but `config` |
| `forbidden` | 403 | none; `reason`: `origin_mismatch`, `cross_site`, `no_origin_signal` | a cross-origin write |
| `student_only` | 403 | `Halaman ini hanya untuk calon siswa. Pengurus yayasan masuk lewat halaman admin.` | student data routes |
| `email_not_verified` | 403 | `Verifikasi email kamu dulu sebelum melanjutkan. Cek inbox atau folder spam untuk tautan verifikasi.` (submit: the shorter line of 9.1) | student data routes |
| `rate_limited` | 429 | the limiter's message, `Retry-After: 60`, `retryAfterSeconds` | all limited routes |
| `json_required` | 415 | none | JSON routes |
| `body_too_large` | 413 | none; `maxBytes` | JSON routes |
| `invalid_json` | 400 | none | JSON routes |
| `invalid` | 400 | `Periksa kembali isian formulir.` + `fields` | `PUT steps/:step` |
| `unknown_step`, `unknown_slot` | 404 | none | |
| `not_found` | 404 | none | unknown path, file not yours, file not found |
| `no_open_batch` | 409 | `Belum ada batch pendaftaran yang dibuka. Silakan kembali saat pendaftaran berikutnya diumumkan.` | the gate |
| `batch_closed` | 409 | `Pendaftaran untuk batch ini sudah ditutup. Isianmu tidak bisa disimpan atau dikirim.` | the gate |
| `already_submitted` | 409 | `Kamu sudah mengirim pendaftaran untuk batch ini. Cek status di halaman Portal Siswa.` | the gate, the submit |
| `no_draft` | 404 | `Belum ada isian yang tersimpan. Isi formulir pendaftaran dulu.` | submit |
| `incomplete` | 422 | see 9.1; `step`, `fields?`, `missingFiles?` | submit |
| `duplicate_whatsapp` | 409 | see 9.1; `step: "identity"` | submit |
| `draft_changed` | 409 | see 9.1 | submit |
| `length_required` | 411 | `Ukuran file tidak diketahui. Coba unggah lagi.` | upload |
| `empty_file` | 400 | `File kosong.` | upload |
| `too_large` | 413 | `Ukuran file maksimal 10 MB.`; `maxBytes` | upload |
| `file_not_found` | 404 | none | `?replace` |
| `slot_full` | 409 | see 11.2; `max` | upload |
| `application_full`, `application_too_large` | 409, 413 | see 11.2 | upload |
| `unsupported_type`, `invalid_file`, `unreadable_size`, `dimensions_too_large` | 415, 422 | the admin upload's messages, see 11.2 | upload |
| `body_mismatch` | 400 | `Unggahan terputus. Coba lagi.` | upload |
| `storage_full` | 503 | see 11.2 | upload |
| `storage_unavailable` | 503 | see 11.2 | file routes |
| `audit_unavailable` | 503 | `Berkas belum bisa dibuka. Coba lagi.` | admin file open |
| `email_quota` | 503 | `Pendaftaran akun hari ini sudah penuh. Coba lagi besok, atau masuk dengan Google.` | register, resend, forgot |
| `email_unavailable`, `captcha_failed`, `captcha_unavailable`, `service_unavailable` | 503, 403 | as [`auth.md`](auth.md#error-shapes) | auth routes |
| `internal` | 500 | none; the Worker logs the error message only | |

## 14. The shared form module

`cf/admin/shared/application-form/`, pure TypeScript with no DOM, Worker or React; the Worker imports by relative path, the portal SPA by `@shared/...`. Written by P1a; the exported names are part of this contract so P1b, P3 and P4 can code against them.

| File | Exports |
| --- | --- |
| `slots.ts` (no dependency) | `SLOT_IDS`, `type SlotId`, `SLOTS: Record<SlotId, { id, label, step: "documents" \| "marketing", required: boolean \| "dtks", maxFiles, types }>`, `requiredSlots(dtksRegistered: boolean): SlotId[]`, `missingSlots(present: Record<string, number>, dtksRegistered): SlotId[]`, `slotLabel(id)`; also `isSlotId`, `slotsOfStep`, `slotAccepts(id, type)`, `missingSlotsOfStep(step, present, dtksRegistered)`, `missingFilesMessage(ids)` (the 422 message of 9.1, check 5b), `DTKS_FILE_REQUIRED_MESSAGE`, `IMAGE_FILE_TYPES`, `ALL_FILE_TYPES`, `type SlotFileType` (`"png" \| "jpeg" \| "webp" \| "pdf"`) |
| `limits.ts` (no dependency) | `MAX_FILE_BYTES` (10_000_000), `MAX_FILES_PER_APPLICATION` (40), `MAX_BYTES_PER_APPLICATION` (100_000_000); also `JSON_BODY_MAX_BYTES` (16 KiB), `STEP_BODY_MAX_BYTES` (32 KiB), `DRAFT_FORM_DATA_MAX_LENGTH` (98,304), `IMAGE_MAX_LONG_SIDE_PX` (2,000) and `IMAGE_JPEG_QUALITY` (0.85) for the browser's compression |
| `steps.ts` (no dependency) | `STEP_IDS` (the seven, in submit order), `type StepId`, `UI_STEP_ORDER` (the legacy screen order, for the SPA), the option lists (`RELIGIONS`, `BRANCHES`, `GRADUATION_BATCHES`, `RESIDENCE_STATUSES`, `LIVING_WITH_OPTIONS`, and the occupation and relation suggestions); also `isStepId`, `UI_STEP_LABELS`, `UI_STEP_BUCKETS` (which bucket(s) each screen saves), `STEP_NOT_SAVED_MESSAGE` (9.1, check 5), `GENDERS`, `YES_NO`, `INTERVIEW_ANSWER_KEYS`, `INTERVIEW_MIN_CHARS`, `INTERVIEW_MAX_CHARS` |
| `rules.ts` (no dependency; **not in the first draft of this table**) | The rules themselves as plain functions, so the wizard can validate per keystroke without paying for zod: `validateStep(step, body)`, `sanitizeStep(step, body)`, `parseRupiah(text)`, the stored shapes (`IdentityValue`, `HouseholdValue`, ..., `StepValues`), `INVALID_FORM_MESSAGE`, `RUPIAH_MESSAGES`, `WHATSAPP_MESSAGE`, `AGREEMENT_REFUSED_MESSAGE`, `type FieldIssue`, `type StepValidation`. `validateStep` answers `{ ok: true, value } \| { ok: false, fields, issues, message }` (`issues` in the order the rules ran, `message` is `issues[0].message`) |
| `schemas.ts` (imports `zod`) | `STEP_SCHEMAS: Record<StepId, ZodType>` (each runs the function of `rules.ts` and turns its issues into zod issues with the same messages, paths and order: parsing gives the stored value), `schemaFor(step)`; and, re-exported from `rules.ts` under the names of this contract, `validateStep(step, body): { ok: true, value } \| { ok: false, fields: Record<string, string>, ... }`, `sanitizeStep(step, body)` (what is stored, or `null`), `parseRupiah(text): { ok: true, value: number } \| { ok: false, message }` |
| `form-data.ts` | `type FormDataV3`, `buildFormData(buckets): FormDataV3`, `identityColumns(identity)` (the five top-level columns), `FORM_DATA_VERSION` (3) |
| `draft.ts` (no dependency; added at the request of the SPA shell) | The draft the **browser** keeps (`localStorage`): `type LocalDraft` (`{ version, savedAt, stepIndex, visited, values }`, with `savedAt` a required finite positive number of epoch milliseconds), `localDraftKey(userId, batchId)` (`sakem-portal:v1:<user id>:<batch id>`), `isLocalDraft(value)`, `isLocalDraftExpired(draft, now)` (30 days, `LOCAL_DRAFT_MAX_AGE_MS`), `readLocalDraft(text, now)` (the draft, or `null` for a text that is not worth keeping: not JSON, an unreadable shape, no numeric `savedAt`, expired), `writeLocalDraft(draft, now)`, `LOCAL_DRAFT_VERSION` (1). This is not the server's draft of section 5.1 |

**A difference found when the submit was built (not changed here: `shared/**` is P1a's).** `buildFormData` hands `interview.agreedToSignedStatement` over as the text it was asked with (`"ya"`, typed `"ya"`, and `test/portal-foundation-form.test.ts` pins it), while section 9.3, the legacy (`=== "ya"`, a boolean) and the admin's Pendaftar screen (`yesNo(value === true)`) want the boolean `true`: stored as is, every portal application would read "Siap Materai: Tidak". The submit therefore writes `formDataToStore(values)` (`src/portal/rules.ts`): the builder's output with that one field set to `true`, typed by `StudentApplicationFormDataV3` in `src/db/schema/admission.ts`, and a test pins the stored value. The right fix is in the builder (`form-data.ts`, its type and its test); when it lands `formDataToStore` is a no-op that can be deleted.

The legacy zod schemas use the zod 3 API (`errorMap`, `z.ZodIssueCode`, `invalid_type_error`); `cf/admin` is on zod 4, so the port re-expresses the same rules with the same messages, as plain functions (`rules.ts`) that `schemas.ts` wraps. `test/portal-foundation-form.test.ts` pins every message and boundary, the example of section 15, the table of 11.1 against `slots.ts`, and the transformation of 9.3. Section 7.9 lists what the build settled where the contract left a choice.

## 15. Examples

A step with errors (`PUT .../steps/household`, invented data):

```http
PUT /portal/api/applications/current/steps/household
Content-Type: application/json

{ "livingWith": ["Ayah", "Ibu"], "fatherName": "Bapak Contoh", "fatherOccupation": "Petani", "fatherIncome": "Rp1.200.000",
  "motherName": "Ibu Contoh", "motherOccupation": "Ibu rumah tangga", "motherIncome": "0",
  "hasOtherEarner1": true, "earner1Relation": "", "earner1Income": "1.500.000,00",
  "hasOtherEarner2": false, "familySize": 0 }
```

```http
HTTP/1.1 400
{ "error": "invalid", "message": "Periksa kembali isian formulir.",
  "fields": {
    "fatherIncome": "Hilangkan \"Rp\". Contoh benar: 1.200.000",
    "earner1Relation": "Wajib diisi",
    "earner1Income": "Hilangkan koma. Contoh benar: 1.200.000",
    "familySize": "Minimal 1 (termasuk kamu)" } }
```

A submit that is not complete:

```http
POST /portal/api/applications/current/submit

HTTP/1.1 422
{ "error": "incomplete", "message": "Berkas wajib belum lengkap: Scan Kartu Keluarga, Foto Diri.", "step": "documents", "missingFiles": ["family-card", "self-photo"] }
```

The status of an application whose batch is **not** published although the admin already accepted it:

```json
{ "items": [ { "id": "5f1d2c3b-0000-4000-8000-000000000002", "batch": { "id": "8b7e0c1a-0000-4000-8000-000000000001", "year": 2026, "name": "Gen 6 - 2026/2027" },
               "submittedAt": "2026-10-13T03:40:00.000Z", "result": { "state": "processing" } } ] }
```

The same application after the batch is published:

```json
{ "items": [ { "id": "5f1d2c3b-0000-4000-8000-000000000002", "batch": { "id": "8b7e0c1a-0000-4000-8000-000000000001", "year": 2026, "name": "Gen 6 - 2026/2027" },
               "submittedAt": "2026-10-13T03:40:00.000Z",
               "result": { "state": "decided", "decision": "accepted", "announcedAt": "2026-12-01T01:00:00.000Z", "notes": null } } ] }
```

An upload (the browser, abbreviated): `xhr.open("PUT", "/portal/api/applications/current/files/family-card"); xhr.setRequestHeader("Content-Type", "application/octet-stream"); xhr.send(file)`, with `xhr.upload.onprogress` for the bar.

## 16. What every route's tests must cover

The workers add these to the Worker suite (workerd, a real local D1, the emulated R2, the test double of the limiters) and to the negative checks (each safeguard broken in turn, the tests must fail).

- **Every route:** the pipeline order of [section 1](#1-conventions) with the exact status of each refusal (nobody, a viewer, an editor, a deactivated student, an unverified student, a cross-origin write, a non-JSON body, an oversized body), the limiter with a held clock, `Cache-Control: no-store`, no personal data in any console line of a full run.
- **Gate:** every row of the table in 6.2, with the batch opening and closing under the test's clock; a draft of a closed batch; a student with an application for the batch; two batches.
- **Steps:** every field rule and message of section 7 as a table (a valid value, each invalid value with its exact message, the conditional rules, the boundaries 3/120, 20/2000, 0/10000, 1/20, 1/600), the sanitising (trim, whatsapp spaces, `@`), unknown keys dropped, the draft created once, the bucket replaced and nothing else touched, two steps saved concurrently, the DTKS side effect.
- **Submit:** the check order of 9.1 (build a draft that fails each check and assert the first failure), the transformation to `formData` version 3 (a whole input and the exact output, rupiah to numbers, earners, debt, organizations), the five top-level columns (`full_name`, `whatsapp`, `school_name`, `graduation_year`, `branch_preference`; `identityColumns` of the shared module), **one transaction** (the audit row and the draft deletion; a draft changed between the check and the write inserts nothing), the audit metadata is only ids, the double submit (one `201`, one `409`), the anti-duplicate window, the confirmation email sent after the response and the submit still `201` when the provider fails.
- **Status and privacy:** the exact key set of every `result` state; the matrix status x published; publish then unpublish; an admin's review note never in the answer before publication; another student's application never listed.
- **Files:** the check order of 11.2; each sniff outcome; the body shorter and longer than declared (nothing stored, the counter released); the slot and application limits to the byte; the storage budget; replace; delete and the retry of a failed object delete; the key shape (no part from the client); the headers of 11.4; another student's and another application's file id are `404`; an admin viewer cannot open, an editor with the grant can, and every open writes exactly one audit row without a name in it; `GET /uploads/*` of the admin never serves a private key; `PRIVATE_FILES` is not referenced from `src/uploads/` and `UPLOADS` not from `src/private-files/`.
- **Retention:** each row of the table in the architecture's 8.9 with a frozen clock, the unreadable-setting-keeps rule, the bound per run, the purge audit row.
- **Contract with the SPAs:** the portal SPA's pure files (error maps, request builders, the slot table) run against the real Worker as `test/spa-contract.test.ts` does for the admin; the admin SPA's `files` and `canOpenFiles` parsing runs against the real admin route.

## 17. What the build of the application routes settled

Ticket SAKEM-083, task P1b. Everything here is read from the code and the tests; the real zone, the real D1 and the CPU of a Worker are SAKEM-084's.

**Where it is.** Routes: `cf/admin/src/portal/applications.ts` (mounted by one line in `src/portal/worker.ts`). Pure rules (the gate, the refusal of a write, `resultOf`, the submit's checks, `formDataToStore`, the object key): `rules.ts`. Every query, as unexecuted Drizzle queries and raw guarded statements: `queries.ts`. The answers, built field by field: `present.ts`. Email: the confirmation template (`applicationReceivedEmail`) in `src/email/templates.ts`, the budget in `src/email/send.ts`. Tests: `test/portal-applications{,-steps,-submit,-status,-email,-rules,-plans}.test.ts` and the shared fixtures `portal-applications-helpers.ts`; negative checks (`node scripts/negative-checks.mjs --only "portal api:"` in `cf/admin`): `scripts/negative-checks-portal-api.mjs`, 40 safeguards.

**One statement for the state of a student.** The batch that is open (a short walk down `admission_batches_opens_at_idx`, no sort), the student's application for it and the student's draft are ONE left-joined statement (`openStateQuery`), so the gate of every route costs one round trip and a handful of rows. The draft's answers (up to 96 KB of JSON) are read only by the bootstrap and the submit (`openStateWithAnswersQuery`). Drizzle reads the statement of a `db.batch` as objects keyed by column name, so the three `id` columns are aliased; a test (the overview, which batches this statement with the history) fails when one is not.

**The cost, measured on the local D1** (`test/portal-applications-plans.test.ts` pins budgets above these; every number is a paper-checked local figure, not a Cloudflare one). Round trips are the portal's own; the session read of Better Auth (2 trips, 2 rows) comes before every route and is not counted here.

| Route | Round trips | Rows read | Rows written |
| --- | --- | --- | --- |
| `GET overview` | 1 (a batch of 2 statements), whatever the history | 2 to 5 | 0 |
| `GET applications` (status) | 1 | 1 to 3 | 0 |
| `GET applications/current` | 1 with no draft, 2 with one (state, then files) | 1; 12 with a complete draft and 10 files | 0 |
| `PUT steps/:step` | 2 (the state, then one batch of 3) | about 10 to 14 | 1 (3 when the draft is made) |
| `PUT steps/documents`, `tidak` | 2 (the batch holds 6) | about 23 | 1, plus the counter and the file rows when a `dtks` file goes |
| `POST submit` | 3 (state; files and anti-duplicate in one batch; one batch of 3 writes), plus the email counter after the answer | about 20 | 17 (the application with its six indexes, the audit row, the draft's removal), plus 2 for the counter |

No route has an N+1 (a test runs the overview and the status page with ten applications and none, and the round trips and statements are the same). Every query is a seek on an index (`EXPLAIN QUERY PLAN` is asserted for all of them); the anti-duplicate is a range on `student_applications_submitted_at_idx`, that is the last hour's rows. The paper estimates of [`portal-architecture.md`](portal-architecture.md#10-cost-and-limits-of-the-hot-paths) (about 10, 11, 26, 8 and 30 rows read, 20 rows written for the submit) hold.

**CPU.** A Worker's CPU cannot be measured locally (workerd freezes its timers during synchronous code). What can be: in Node, warm, the work these routes add on top of the session is small: building the Drizzle handle with the whole schema takes about 90 microseconds (so `dbOf` builds it once per isolate and binding, and a test asserts it); the state statement's builder about 75 microseconds; `validateStep` 0.4 to 0.7 microseconds (the 12,000-character interview included); `checkSubmission` of all seven buckets about 2 microseconds; `formDataToStore` with `JSON.stringify` about 26 microseconds; `JSON.parse` of a 13,000-character draft about 6 microseconds. Through `wrangler dev`-like workerd, wall time per request (warm, 150 calls, which includes D1 and the session): no cookie 0.05 ms (nothing is built or read), `me` 1.4 ms, `status` 1.7 ms, `overview` and `applications/current` 2.3 ms, a step save 2.2 to 2.4 ms: the routes add 0.3 to 0.9 ms to the session read, which is the larger part and is the admin auth path's CPU work (SAKEM-091). A request without the portal's session cookie reaches none of this: `requireStudent` answers 401 before Better Auth or D1.

**The email budget** (portal-architecture.md, 9.2) is built in `src/email/send.ts`: every email that goes out through `sendEmail` (or into the local mailbox) is first counted in `email_daily` by one atomic statement (`INSERT ... ON CONFLICT DO UPDATE ... WHERE sent < limit RETURNING`, one row written, UTC day). The confirmation of an application is the one optional email: it stops at 80 (`EMAIL_CONFIRMATION_CEILING`), so the last 20 of Resend's 100 stay for verification and reset; it is skipped, not failed (`daily_budget`), the application is saved, and the log has the numbers and the purpose only. Every other purpose is counted up to 100 and still sent beyond it (Resend then answers its own 429, logged as before): the counter never stops an email a person waits for from being tried. At 100 the portal's registration, resend and forgot-password routes answer `503 email_quota` ([3](#3-auth-routes)). A counter that cannot be read or written never stops an email or turns a registration away; it logs that it failed and nothing else. The day is the UTC date, as Resend's; whether Resend's own day is the same is an assumption (not verified). Old `email_daily` rows are not removed (one row a day).

**Where the code differs from the contract above, and why.** (1) The submit checks its JSON body before D1 (9.1, (a)). (2) `draft.saved` follows `STEP_IDS`, not the screens' order (5.1). (3) The 403 `email_not_verified` of a submit has its own sentence, the others the guard's (9.1, (c)). (4) The DTKS cleanup of a step save deletes the objects after the answer, which the endpoint index showed as "R2: none" (8.1). (5) The submit writes `agreedToSignedStatement: true`, where the shared module's builder hands over `"ya"` (14). (6) A `400 invalid` of a step always carries `fields` (`{}` for a body that is not an object). (7) The 503 `email_quota` needed a few lines in `src/auth/gate.ts`, which is not a P1b file: auth.md assigned the counter and the answer to this task, and the gate is the only place that runs before anything is created.

**Not verified.** Real Resend (the quota behaviour, the delivery of the confirmation, whether its day matches ours), real D1 row counts and CPU, the order of `waitUntil` work on a real isolate, everything that needs a browser (the screens that call these routes are P2's and P3's), and the objects of a removed `dtks` file in a real R2 (only the emulated bucket was used; the key shape is the architecture's 8.1 and must stay equal to P4's).

