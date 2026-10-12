// The Worker's own pieces: the mock answers Aktivitas with the Worker's cursor, day filters and projection of a
// row's metadata, so what is seen here is what the real API would say (this file is only ever bundled in mock
// mode). The declared lists are the SPA's copies (lib/audit.ts): a Worker test fails when they differ from the
// Worker's, and the Worker's own file cannot be imported here (it names types of the Worker's runtime).
import { dayBound, decodeCursor, encodeCursor } from "../../../../src/audit/cursor";
import { projectDetails } from "../../../../src/audit/present";
import { FILTER_ACTIONS, FILTER_RESOURCE_TYPES } from "~/lib/audit";
import { ifMatch } from "~/lib/crud/etag";
import type { MockHandler, MockRequest } from "../handlers";

// MOCK, local development only. Aktivitas and Pengaturan (the area `sistem`) without a backend: the audit log with
// a cursor and the filters of the Worker, and the admin users with their list, one admin, the edit form (`PUT`
// with `If-Match`), create, deactivate, reactivate and resend. Only a super_admin may use them; anyone else gets
// 403, as from the Worker, and the menu never offers them. An admin made, changed or deactivated here appears in
// Aktivitas, as it does for real.
//
// Made-up addresses in the invented rows are reserved example domains. A new admin's email can end in a name that
// plays up: `email-gagal@...` is created but the invitation fails to send (502), `email-tidak-tersedia@...` has no
// email service (503). Nothing leaves memory; a reload starts again from the seed.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

type Role = "super_admin" | "editor" | "viewer";
type Area = "pendaftaran" | "komunikasi" | "konten";
const AREAS: readonly Area[] = ["pendaftaran", "komunikasi", "konten"];

// ----------------------------------------------------------------------------------------------- audit

interface AuditRow {
  id: string;
  createdAt: number;
  action: string;
  actorEmail: string;
  actorName: string | null;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
}

const ADMINS = [
  { email: "dewi@contoh.test", name: "Dewi Pengurus" },
  { email: "budi@contoh.test", name: "Budi Editor" },
];

const PATTERNS: { action: string; type: string | null; actor: "admin" | "student" | "visitor"; metadata?: Record<string, unknown> }[] = [
  { action: "announcement.update", type: "announcement", actor: "admin", metadata: { fields: ["title", "body"], label: "Pendaftaran Angkatan 2026 Dibuka" } },
  { action: "student.register", type: "user", actor: "student", metadata: { via: "email" } },
  { action: "application.submit", type: "application", actor: "student" },
  { action: "blog.create", type: "blog", actor: "admin", metadata: { fields: ["title", "slug", "contentHtml"], label: "Cara memilih jurusan kuliah" } },
  { action: "contact_message.submit", type: "contact_message", actor: "visitor" },
  { action: "application.accepted", type: "application", actor: "admin" },
  { action: "user.email_verified", type: "user", actor: "student" },
  { action: "upload.create", type: "media", actor: "admin", metadata: { kind: "blog-image", contentType: "image/webp", size: 183_204, width: 1200, height: 630, path: "/uploads/blog-image/2026/nama-orang.webp" } },
  { action: "team.update", type: "team_member", actor: "admin", metadata: { fields: ["bio"], label: "Ahmad Fadillah" } },
  { action: "admin.update", type: "admin_user", actor: "admin", metadata: { email: "budi@contoh.test", roleFrom: "viewer", roleTo: "editor", areasBefore: [], areasAfter: ["pendaftaran"] } },
  { action: "batch.publish_results", type: "batch", actor: "admin" },
  { action: "report.create", type: "report", actor: "admin", metadata: { fields: ["title", "year", "filePath"], label: "Laporan Tahunan 2025" } },
  { action: "user.password_reset", type: "user", actor: "student" },
  // A name the page has a legacy label for but does not offer as a filter: shown, not filterable.
  { action: "admin.delete", type: "admin_user", actor: "admin", metadata: { email: "lama@contoh.test", role: "viewer" } },
];

function seedAudit(now: number): AuditRow[] {
  const rows: AuditRow[] = [];
  for (let i = 0; i < 130; i++) {
    const pattern = PATTERNS[i % PATTERNS.length]!;
    const admin = ADMINS[i % ADMINS.length]!;
    const actor = pattern.actor === "admin" ? { email: admin.email, name: admin.name } : pattern.actor === "student" ? { email: `siswa${(i % 7) + 1}@contoh.test`, name: null } : { email: "pengirim@contoh.test", name: null };
    rows.push({
      // Two rows share each millisecond, so the cursor has equal timestamps to tell apart.
      id: `a${String(1000 - i).padStart(5, "0")}`,
      createdAt: now - Math.floor(i / 2) * 37 * MIN - 5 * MIN,
      action: pattern.action,
      actorEmail: actor.email,
      actorName: actor.name,
      resourceType: pattern.type,
      resourceId: pattern.type ? `mock-${pattern.type}-${(i % 5) + 1}` : null,
      metadata: pattern.metadata ?? null,
    });
  }
  return rows;
}

// ------------------------------------------------------------------------------------------------ admins

interface AdminRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  areas: Area[];
  hasAccount: boolean;
  deactivated: boolean;
  emailVerified: boolean;
  lastSessionAt: number | null;
  createdAt: number;
  updatedAt: number;
}

const statusOf = (row: AdminRow) => (row.deactivated ? "deactivated" : row.hasAccount ? "active" : "invited");

function presentAdmin(row: AdminRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    areas: row.role === "editor" ? row.areas : [],
    status: statusOf(row),
    emailVerified: row.emailVerified,
    deactivatedAt: row.deactivated ? new Date(row.updatedAt).toISOString() : null,
    lastSessionAt: row.lastSessionAt === null ? null : new Date(row.lastSessionAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function seedAdmins(self: MockRequest["self"], now: number): AdminRow[] {
  const base = { hasAccount: true, deactivated: false, emailVerified: true, lastSessionAt: null as number | null };
  return [
    { ...base, id: self.id, name: self.name, email: self.email, role: "super_admin", areas: [], lastSessionAt: now - 12 * MIN, createdAt: now - 90 * DAY, updatedAt: now - 90 * DAY },
    { ...base, id: "mock-admin-dewi", name: "Dewi Pengurus", email: "dewi@contoh.test", role: "editor", areas: ["komunikasi", "konten"], lastSessionAt: now - 2 * DAY, createdAt: now - 60 * DAY, updatedAt: now - 20 * DAY },
    { ...base, id: "mock-admin-budi", name: "Budi Editor", email: "budi@contoh.test", role: "editor", areas: ["pendaftaran"], createdAt: now - 45 * DAY, updatedAt: now - 10 * DAY },
    { ...base, id: "mock-admin-sari", name: "Sari Pembaca", email: "sari@contoh.test", role: "viewer", areas: [], lastSessionAt: now - 3 * HOUR, createdAt: now - 30 * DAY, updatedAt: now - 30 * DAY },
    { ...base, id: "mock-admin-baru", name: "Guru Baru", email: "guru-baru@contoh.test", role: "editor", areas: [], hasAccount: false, emailVerified: false, createdAt: now - 1 * DAY, updatedAt: now - 1 * DAY },
    { ...base, id: "mock-admin-lama", name: "Mantan Pengurus", email: "mantan@contoh.test", role: "viewer", areas: [], deactivated: true, createdAt: now - 200 * DAY, updatedAt: now - 15 * DAY },
  ];
}

// ------------------------------------------------------------------------------------------------ helpers

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const error = (status: number, code: string, message?: string, extra: Record<string, unknown> = {}) => json({ error: code, ...(message ? { message } : {}), ...extra }, status);

const NOT_FOUND = "Data tidak ditemukan. Mungkin sudah dihapus.";
const INVALID = "Periksa kembali isian formulir.";
const INVALID_QUERY = "Pencarian atau penyaringan tidak dikenal.";
const STALE = "Data ini sudah diubah orang lain sejak kamu membukanya. Muat ulang untuk melihat versi terbaru.";
const LAST_DEMOTE = "Tidak dapat menurunkan peran super admin terakhir. Tambah super admin lain terlebih dahulu.";
const LAST_DEACTIVATE = "Tidak dapat menonaktifkan super admin terakhir. Tambah super admin lain terlebih dahulu.";

function positiveInt(raw: string | null, fallback: number, max: number): number {
  if (raw === null || !/^\d{1,30}$/.test(raw.trim())) return fallback;
  const value = Number(raw);
  return value >= 1 ? Math.min(value, max) : fallback;
}

function bodyOf(init: RequestInit): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(String(init.body ?? "null"));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const compare = (a: unknown, b: unknown) => (a === b ? 0 : String(a) < String(b) ? -1 : 1);

// ----------------------------------------------------------------------------------------------- handler

/** A fresh store per call: the page makes one (the default export), a test makes its own. */
export function createSistemMock(): MockHandler {
  let audit: AuditRow[] | null = null;
  let admins: AdminRow[] | null = null;
  let counter = 0;

  function record(request: MockRequest, action: string, resourceId: string, metadata: Record<string, unknown>) {
    counter += 1;
    // "z..." sorts after the seed's ids: a row made now is the newest, and the first of its millisecond.
    audit!.unshift({ id: `z${String(counter).padStart(5, "0")}`, createdAt: Date.now(), action, actorEmail: request.self.email, actorName: request.self.name, resourceType: "admin_user", resourceId, metadata });
  }

  const activeSuperAdmins = (except?: string) => admins!.filter((row) => row.role === "super_admin" && !row.deactivated && row.id !== except).length;

  // ---------------------------------------------------------------------------------------- GET /audit
  function listAudit(url: URL): Response {
    const params = url.searchParams;
    const pageSize = positiveInt(params.get("pageSize"), 50, 100);
    const bad = (param: string) => error(400, "invalid_query", INVALID_QUERY, { param });

    const action = params.get("action") ?? "";
    if (action !== "" && !(FILTER_ACTIONS as readonly string[]).includes(action)) return bad("action");
    const resource = params.get("resource") ?? "";
    if (resource !== "" && !(FILTER_RESOURCE_TYPES as readonly string[]).includes(resource)) return bad("resource");
    const actor = (params.get("actor") ?? "").trim().toLowerCase();
    if (actor.length > 254) return bad("actor");
    const from = params.get("from") ?? "";
    const start = from === "" ? null : dayBound(from, false);
    if (from !== "" && !start) return bad("from");
    const to = params.get("to") ?? "";
    const end = to === "" ? null : dayBound(to, true);
    if (to !== "" && !end) return bad("to");
    const rawCursor = params.get("cursor") ?? "";
    const cursor = rawCursor === "" ? null : decodeCursor(rawCursor);
    if (rawCursor !== "" && !cursor) return bad("cursor");

    const rows = audit!
      .filter(
        (row) =>
          (action === "" || row.action === action) &&
          (resource === "" || row.resourceType === resource) &&
          (actor === "" || row.actorEmail === actor) &&
          (!start || row.createdAt >= start.getTime()) &&
          (!end || row.createdAt <= end.getTime()) &&
          (!cursor || row.createdAt < cursor.createdAt || (row.createdAt === cursor.createdAt && row.id < cursor.id)),
      )
      .sort((a, b) => b.createdAt - a.createdAt || compare(b.id, a.id));

    const page = rows.slice(0, pageSize);
    const last = page.at(-1);
    return json({
      items: page.map((row) => ({
        id: row.id,
        createdAt: new Date(row.createdAt).toISOString(),
        action: row.action,
        actorEmail: row.actorEmail,
        actorName: row.actorName,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        details: projectDetails(row.action, row.metadata),
      })),
      pageSize,
      nextCursor: rows.length > pageSize && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    });
  }

  // ---------------------------------------------------------------------------------------- GET /users
  function listAdmins(url: URL): Response {
    const params = url.searchParams;
    const page = positiveInt(params.get("page"), 1, 10_000);
    const pageSize = positiveInt(params.get("pageSize"), 50, 100);
    const bad = (param: string) => error(400, "invalid_query", INVALID_QUERY, { param });

    const wanted = params.get("sort") || "email";
    const field = wanted.startsWith("-") ? wanted.slice(1) : wanted;
    if (!["email", "name", "role", "createdAt"].includes(field)) return bad("sort");
    const role = params.get("role") ?? "";
    if (role !== "" && !["super_admin", "editor", "viewer"].includes(role)) return bad("role");
    const status = params.get("status") ?? "";
    if (status !== "" && !["active", "invited", "deactivated"].includes(status)) return bad("status");
    const q = (params.get("q") ?? "").trim().slice(0, 48).toLowerCase();

    const direction = wanted.startsWith("-") ? -1 : 1;
    const rows = admins!
      .filter((row) => (role === "" || row.role === role) && (status === "" || statusOf(row) === status) && (q === "" || row.email.startsWith(q)))
      .sort((a, b) => direction * compare(a[field as "email" | "name" | "role" | "createdAt"], b[field as "email" | "name" | "role" | "createdAt"]) || compare(a.id, b.id));
    const items = rows.slice((page - 1) * pageSize, page * pageSize).map(presentAdmin);
    return json({ items, users: items, page, pageSize, total: rows.length });
  }

  // ------------------------------------------------------------------------------------- the form's rules
  function checkForm(body: Record<string, unknown>, create: boolean): { ok: true; name: string; role: Role; areas: Area[]; password: string; email: string } | { ok: false; fields: Record<string, string> } {
    const fields: Record<string, string> = {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length > 120) fields.name = "Maksimal 120 karakter";
    else if (!create && name === "") fields.name = "Nama wajib diisi";
    const role = body.role;
    if (role !== "super_admin" && role !== "editor" && role !== "viewer") fields.role = "Peran tidak dikenal";
    const wanted = Array.isArray(body.areas) ? body.areas : [];
    if (wanted.length > AREAS.length) fields.areas = "Terlalu banyak area";
    else if (!wanted.every((area) => (AREAS as readonly unknown[]).includes(area))) fields.areas = "Area tidak dikenal";
    else if (role !== "editor" && wanted.length > 0 && !fields.role) fields.areas = "Area hanya untuk peran Editor.";
    let email = "";
    let password = "";
    if (create) {
      email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fields.email = "Format email tidak valid";
      else if (email.length < 5) fields.email = "Email terlalu pendek";
      else if (email.length > 200) fields.email = "Email terlalu panjang";
      password = typeof body.password === "string" ? body.password : "";
      if (password !== "" && password.length < 8) fields.password = "Password minimal 8 karakter";
      else if (password.length > 128) fields.password = "Password maksimal 128 karakter";
    }
    if (Object.keys(fields).length > 0) return { ok: false, fields };
    const ordered = AREAS.filter((area) => wanted.includes(area));
    return { ok: true, name, role: role as Role, areas: role === "editor" ? ordered : [], password, email };
  }

  function create(request: MockRequest): Response {
    const body = bodyOf(request.init);
    if (!body) return error(400, "invalid_json", "Isi permintaan bukan JSON yang valid.");
    const form = checkForm(body, true);
    if (!form.ok) return error(400, "invalid", INVALID, { fields: form.fields });
    if (admins!.some((row) => row.email === form.email)) return error(409, "email_taken", "Email ini sudah terdaftar.", { fields: { email: "Email sudah digunakan" } });
    const local = form.email.split("@")[0]!;
    if (local === "email-tidak-tersedia") return error(503, "email_unavailable", "Layanan email sedang tidak tersedia. Silakan coba lagi nanti.");

    const now = Date.now();
    counter += 1;
    const row: AdminRow = {
      id: `mock-admin-${counter}-${local}`,
      name: form.name || local,
      email: form.email,
      role: form.role,
      areas: form.areas,
      hasAccount: form.password !== "",
      deactivated: false,
      emailVerified: false,
      lastSessionAt: null,
      createdAt: now,
      updatedAt: now,
    };
    admins!.push(row);
    record(request, "admin.create", row.id, { email: row.email, role: row.role, mode: form.password !== "" ? "password" : "invite", ...(row.areas.length > 0 ? { areasAfter: row.areas } : {}) });
    // The account exists either way; only the email can fail.
    if (local === "email-gagal") return error(502, "email_failed", "Email belum terkirim. Akun sudah dibuat; kirim ulang undangannya nanti.", { user: presentAdmin(row) });
    return json({ item: presentAdmin(row), user: presentAdmin(row), email: { sent: true, kind: form.password !== "" ? "verification" : "invite" } }, 201, { ETag: ifMatch(new Date(row.updatedAt).toISOString()) });
  }

  function update(request: MockRequest, row: AdminRow | undefined): Response {
    const precondition = new Headers(request.init.headers).get("If-Match");
    if (precondition === null) return error(428, "precondition_required", "Versi data tidak disertakan. Muat ulang halaman lalu coba lagi.");
    const body = bodyOf(request.init);
    if (!body) return error(400, "invalid_json", "Isi permintaan bukan JSON yang valid.");
    const form = checkForm(body, false);
    if (!form.ok) return error(400, "invalid", INVALID, { fields: form.fields });
    if (!row) return error(404, "not_found", NOT_FOUND);
    if (precondition !== ifMatch(new Date(row.updatedAt).toISOString())) return error(409, "stale", STALE);

    const changes = form.role !== row.role || form.name !== row.name || form.areas.join() !== (row.role === "editor" ? row.areas : []).join();
    if (!changes) return json({ item: presentAdmin(row) }, 200, { ETag: ifMatch(new Date(row.updatedAt).toISOString()) });
    if (form.role !== row.role && row.role === "super_admin" && !row.deactivated && activeSuperAdmins(row.id) === 0) {
      return error(409, "last_super_admin", LAST_DEMOTE, { fields: { role: "Minimal satu super admin harus tersedia" } });
    }
    const before = { role: row.role, name: row.name, areas: row.role === "editor" ? [...row.areas] : [] };
    Object.assign(row, { role: form.role, name: form.name, areas: form.areas, updatedAt: Math.max(Date.now(), row.updatedAt + 1) });
    record(request, "admin.update", row.id, {
      email: row.email,
      ...(before.role !== row.role ? { roleFrom: before.role, roleTo: row.role } : {}),
      ...(before.name !== row.name ? { nameChanged: true } : {}),
      ...(before.areas.join() !== row.areas.join() ? { areasBefore: before.areas, areasAfter: row.areas } : {}),
    });
    return json({ item: presentAdmin(row) }, 200, { ETag: ifMatch(new Date(row.updatedAt).toISOString()) });
  }

  function verb(request: MockRequest, row: AdminRow | undefined, name: string): Response {
    if (!row) return error(404, "not_found", NOT_FOUND);
    const touch = () => (row.updatedAt = Math.max(Date.now(), row.updatedAt + 1));
    if (name === "deactivate") {
      if (row.deactivated) return json({ user: presentAdmin(row) });
      if (row.id === request.self.id) return error(409, "cannot_deactivate_self", "Tidak dapat menonaktifkan akun sendiri.");
      if (row.role === "super_admin" && activeSuperAdmins(row.id) === 0) return error(409, "last_super_admin", LAST_DEACTIVATE);
      row.deactivated = true;
      row.lastSessionAt = null;
      touch();
      record(request, "admin.deactivate", row.id, { email: row.email, role: row.role });
      return json({ user: presentAdmin(row) });
    }
    if (name === "reactivate") {
      if (!row.deactivated) return json({ user: presentAdmin(row) });
      row.deactivated = false;
      touch();
      record(request, "admin.reactivate", row.id, { email: row.email, role: row.role });
      return json({ user: presentAdmin(row) });
    }
    if (name === "resend-invite") {
      if (statusOf(row) !== "invited") return error(409, "not_pending_invite", "Undangan hanya bisa dikirim ulang untuk admin yang belum menerimanya.");
      record(request, "admin.invite_resend", row.id, { email: row.email, role: row.role });
      return json({ user: presentAdmin(row), email: { sent: true, kind: "invite" } });
    }
    return error(404, "not_found");
  }

  return (request) => {
    const { method, url, accessOf } = request;
    const path = url.pathname;
    const isAudit = path === "/api/admin/audit";
    const isUsers = path === "/api/admin/users" || path.startsWith("/api/admin/users/");
    if (!isAudit && !isUsers) return null;

    // The Worker's guard: Sistem is for a super_admin and for nobody else, to read or to change.
    if (accessOf("sistem") === "none") return error(403, "forbidden");

    audit ??= seedAudit(Date.now());
    admins ??= seedAdmins(request.self, Date.now());

    if (isAudit) return method === "GET" ? listAudit(url) : error(404, "not_found");

    const rest = path === "/api/admin/users" ? [] : path.slice("/api/admin/users/".length).split("/").map(decodeURIComponent);
    if (rest.length === 0) {
      if (method === "GET") return listAdmins(url);
      if (method === "POST") return create(request);
      return error(404, "not_found");
    }
    const row = admins.find((candidate) => candidate.id === rest[0]);
    if (rest.length === 1) {
      if (method === "GET") return row ? json({ item: presentAdmin(row) }, 200, { ETag: ifMatch(new Date(row.updatedAt).toISOString()) }) : error(404, "not_found", NOT_FOUND);
      if (method === "PUT") return update(request, row);
      return error(404, "not_found");
    }
    if (rest.length === 2 && method === "POST") return verb(request, row, rest[1]!);
    return error(404, "not_found");
  };
}

export default createSistemMock();
